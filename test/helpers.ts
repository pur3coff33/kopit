import { env } from "cloudflare:test";
import { app } from "../src/index";
import { getDb } from "../src/db/client";
import { households, profiles } from "../src/db/schema";

let counter = 0;

export function db() {
  return getDb(env);
}

export async function seedHousehold(opts: { username?: string; pin?: string; profiles?: string[]; createdAt?: number } = {}) {
  const username = opts.username ?? `house${++counter}`;
  const createdAt = opts.createdAt ?? Date.now();
  const [h] = await db()
    .insert(households)
    .values({ username, pinHash: "placeholder", pinSalt: "placeholder", createdAt })
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
