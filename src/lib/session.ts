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
