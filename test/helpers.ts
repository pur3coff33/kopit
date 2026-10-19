import { env } from "cloudflare:test";
import { app } from "../src/index";
import { getDb } from "../src/db/client";
import { households, profiles } from "../src/db/schema";
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
  const categoryIds: Record<string, number> = {};
  return { householdId: h.id, profileIds, categoryIds };
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
