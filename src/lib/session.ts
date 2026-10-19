import { and, eq, ne } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { getDb } from "../db/client";
import { sessions } from "../db/schema";
import type { Env } from "../env";

export const SESSION_COOKIE = "kopit_session";
export const PROFILE_COOKIE = "kopit_profile";
export const COOKIE_MAX_AGE = 31_536_000;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createSession(env: Env, householdId: number, now: number): Promise<string> {
  const token = randomToken();
  await getDb(env)
    .insert(sessions)
    .values({ tokenHash: await sha256Hex(token), householdId, createdAt: now, expiresAt: now + COOKIE_MAX_AGE * 1000 });
  return token;
}

export async function lookupSession(env: Env, token: string, now: number): Promise<number | null> {
  const row = await getDb(env).query.sessions.findFirst({ where: eq(sessions.tokenHash, await sha256Hex(token)) });
  if (!row || row.expiresAt <= now) return null;
  return row.householdId;
}

export type AuthInfo = {
  householdId: number;
  householdCreatedAt: number;
  profile: { id: number; name: string } | null;
};

/**
 * Session, household and this phone's profile in one query (each D1 round trip costs time).
 * `profile` is null when the cookie's profile is missing or belongs to another household.
 */
export async function lookupAuth(env: Env, token: string, profileId: number | null, now: number): Promise<AuthInfo | null> {
  const row = await env.DB.prepare(
    `SELECT s.household_id AS householdId, h.created_at AS householdCreatedAt, p.id AS profileId, p.name AS profileName
     FROM sessions s
     JOIN households h ON h.id = s.household_id
     LEFT JOIN profiles p ON p.id = ? AND p.household_id = s.household_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(profileId, await sha256Hex(token), now)
    .first<{ householdId: number; householdCreatedAt: number; profileId: number | null; profileName: string | null }>();
  if (!row) return null;
  return {
    householdId: row.householdId,
    householdCreatedAt: row.householdCreatedAt,
    profile: row.profileId !== null && row.profileName !== null ? { id: row.profileId, name: row.profileName } : null,
  };
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  await getDb(env).delete(sessions).where(eq(sessions.tokenHash, await sha256Hex(token)));
}

/** Logs out every other device of the household, keeping the session with this token. */
export async function deleteOtherSessions(env: Env, householdId: number, keepToken: string): Promise<void> {
  await getDb(env)
    .delete(sessions)
    .where(and(eq(sessions.householdId, householdId), ne(sessions.tokenHash, await sha256Hex(keepToken))));
}

export function setLongCookie(c: Context, name: string, value: string): void {
  setCookie(c, name, value, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: COOKIE_MAX_AGE });
}

export function clearCookie(c: Context, name: string): void {
  deleteCookie(c, name, { path: "/", secure: true });
}
