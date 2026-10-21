import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { PROFILE_COOKIE, SESSION_COOKIE, lookupAuth } from "../lib/session";

const isApi = (path: string) => path.startsWith("/api/");

/** Checks the login and, in the same query, looks up this phone's profile for requireProfile. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const raw = getCookie(c, PROFILE_COOKIE) ?? "";
  const profileId = /^\d+$/.test(raw) ? Number(raw) : null;
  const auth = token ? await lookupAuth(c.env, token, profileId, Date.now()) : null;
  if (!auth) return isApi(c.req.path) ? c.json({ error: "auth" }, 401) : c.redirect("/login");
  c.set("householdId", auth.householdId);
  c.set("householdCreatedAt", auth.householdCreatedAt);
  c.set("profile", auth.profile);
  await next();
});

/** Must run after requireSession. Sends phones without a valid profile of this household to /profile. */
export const requireProfile = createMiddleware<AppEnv>(async (c, next) => {
  const profile = c.get("profile");
  if (!profile) return isApi(c.req.path) ? c.json({ error: "profile" }, 401) : c.redirect("/profile");
  c.set("profileId", profile.id);
  c.set("profileName", profile.name);
  c.set("profileIndex", profile.index);
  c.set("hideAmounts", profile.hideAmounts);
  await next();
});
