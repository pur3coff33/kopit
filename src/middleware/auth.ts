import { and, eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { getDb } from "../db/client";
import { profiles } from "../db/schema";
import type { AppEnv } from "../env";
import { PROFILE_COOKIE, SESSION_COOKIE, lookupSession } from "../lib/session";

const isApi = (path: string) => path.startsWith("/api/");

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const householdId = token ? await lookupSession(c.env, token, Date.now()) : null;
  if (householdId === null) return isApi(c.req.path) ? c.json({ error: "auth" }, 401) : c.redirect("/login");
  c.set("householdId", householdId);
  await next();
});

export const requireProfile = createMiddleware<AppEnv>(async (c, next) => {
  const raw = getCookie(c, PROFILE_COOKIE) ?? "";
  const id = /^\d+$/.test(raw) ? Number(raw) : null;
  const profile =
    id === null
      ? undefined
      : await getDb(c.env).query.profiles.findFirst({
          where: and(eq(profiles.id, id), eq(profiles.householdId, c.get("householdId"))),
        });
  if (!profile) return isApi(c.req.path) ? c.json({ error: "profile" }, 401) : c.redirect("/profile");
  c.set("profileId", profile.id);
  c.set("profileName", profile.name);
  await next();
});
