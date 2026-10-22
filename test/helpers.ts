import { env } from "cloudflare:test";
import { app } from "../src/index";
import { getDb } from "../src/db/client";
import { eq } from "drizzle-orm";
import { categories, entries, households, profiles } from "../src/db/schema";
import { seedCategories } from "../src/lib/households";
import { hashPin } from "../src/lib/pin";
import { PROFILE_COOKIE, SESSION_COOKIE, createSession } from "../src/lib/session";

let counter = 0;

export function db() {
  return getDb(env);
}

export async function seedHousehold(opts: { username?: string; pin?: string; profiles?: string[]; createdAt?: number } = {}) {
  const username = opts.username ?? `house${++counter}`;
  const createdAt = opts.createdAt ?? Date.now();
  const { hash, salt } = await hashPin(env.PIN_PEPPER, opts.pin ?? "482913");
  const [h] = await db()
    .insert(households)
    .values({ username, pinHash: hash, pinSalt: salt, createdAt })
    .returning();
  const profileIds: number[] = [];
  for (const name of opts.profiles ?? ["Jon", "Partner"]) {
    const [p] = await db().insert(profiles).values({ householdId: h.id, name, createdAt }).returning();
    profileIds.push(p.id);
  }
  await seedCategories(env, h.id, createdAt);
  const categoryIds: Record<string, number> = {};
  for (const c of await db().select().from(categories).where(eq(categories.householdId, h.id))) categoryIds[c.name] = c.id;
  return { householdId: h.id, profileIds, categoryIds };
}

/** The twelve categories every household started with before the fixed ten. */
export const LEGACY_STARTERS: ReadonlyArray<{ emoji: string; name: string }> = [
  { emoji: "🛒", name: "Groceries" },
  { emoji: "🍜", name: "Food" },
  { emoji: "🚌", name: "Transport" },
  { emoji: "💡", name: "Bills" },
  { emoji: "🏠", name: "Home" },
  { emoji: "💊", name: "Health" },
  { emoji: "🛍️", name: "Shopping" },
  { emoji: "🎉", name: "Fun" },
  { emoji: "☕", name: "Coffee" },
  { emoji: "📱", name: "Load / Data" },
  { emoji: "🎁", name: "Gifts" },
  { emoji: "✈️", name: "Travel" },
];

/** A household from before the fixed categories: its own old ones (plus `extra`), not switched yet. */
export async function seedLegacyHousehold(opts: { createdAt?: number; extra?: string[] } = {}) {
  const createdAt = opts.createdAt ?? Date.now();
  const { hash, salt } = await hashPin(env.PIN_PEPPER, "482913");
  const [h] = await db()
    .insert(households)
    .values({ username: `old${++counter}`, pinHash: hash, pinSalt: salt, createdAt, categoriesSet: 1 })
    .returning();
  const profileIds: number[] = [];
  for (const name of ["Jon", "Partner"]) profileIds.push((await db().insert(profiles).values({ householdId: h.id, name, createdAt }).returning())[0].id);
  const cats = [...LEGACY_STARTERS, ...(opts.extra ?? []).map((name) => ({ emoji: "🏷️", name }))];
  await db()
    .insert(categories)
    .values(cats.map((c, i) => ({ householdId: h.id, name: c.name, emoji: c.emoji, sortOrder: i, createdAt })));
  const categoryIds: Record<string, number> = {};
  for (const c of await db().select().from(categories).where(eq(categories.householdId, h.id))) categoryIds[c.name] = c.id;
  return { householdId: h.id, profileIds, categoryIds };
}

type Seeded = Awaited<ReturnType<typeof seedHousehold>>;

/** Inserts an expense directly. `category` is a starter name or null; `profile` an index into profileIds. */
export async function addEntry(h: Seeded, o: { amount: number; at: number; category: string | null; profile?: number }) {
  const id = crypto.randomUUID();
  // Seeded expenses look like they were written when they were spent (not "just now"), as real history would.
  const now = Math.min(Date.now(), o.at);
  await db()
    .insert(entries)
    .values({
      id,
      householdId: h.householdId,
      profileId: h.profileIds[o.profile ?? 0],
      categoryId: o.category === null ? null : h.categoryIds[o.category],
      amountCentavos: o.amount,
      spentAt: o.at,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

export function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookie) headers.set("Cookie", cookie);
  return app.request(path, { ...rest, headers }, env);
}

/** Real session (+ optional profile) as a Cookie header value. */
export async function authCookie(householdId: number, profileId?: number): Promise<string> {
  const token = await createSession(env, householdId, Date.now());
  return `${SESSION_COOKIE}=${token}` + (profileId !== undefined ? `; ${PROFILE_COOKIE}=${profileId}` : "");
}

/** Response body with the common HTML entities decoded, for readable assertions. */
export async function html(res: Response): Promise<string> {
  return (await res.text())
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function form(data: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data).toString(),
  };
}
