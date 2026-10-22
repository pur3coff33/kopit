import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { households, sessions } from "../src/db/schema";
import { authCookie, db, form, html, req, seedHousehold } from "./helpers";

describe("login page", () => {
  it("is autofill-friendly and links to setup", async () => {
    const res = await req("/login");
    expect(res.status).toBe(200);
    const body = await html(res);
    expect(body).toContain('autocomplete="username"');
    expect(body).toContain('inputmode="numeric"');
    expect(body).toContain('autocomplete="current-password"');
    expect(body).toContain('maxlength="6"');
    expect(body).toContain('href="/setup"');
  });

  it("logs in and sets a long-lived secure cookie", async () => {
    await seedHousehold({ username: "jon", pin: "482913" });
    const res = await req("/login", form({ username: "Jon", pin: "482913" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/profile");
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(/^kopit_session=/);
    for (const part of ["HttpOnly", "Secure", "SameSite=Lax", "Max-Age=31536000", "Path=/"]) expect(cookie).toContain(part);
  });

  it("says when the PIN is wrong", async () => {
    await seedHousehold({ username: "jon", pin: "482913" });
    const res = await req("/login", form({ username: "jon", pin: "111111" }));
    expect(res.status).toBe(200);
    expect(await html(res)).toContain("That PIN didn't match. Try again?");
  });

  it("says when to try again while locked", async () => {
    const { householdId } = await seedHousehold({ username: "jon", pin: "482913" });
    const lockedUntil = Date.UTC(2030, 0, 1, 8, 5); // 4:05 PM Manila
    await db().update(households).set({ lockedUntil }).where(eq(households.id, householdId));
    const res = await req("/login", form({ username: "jon", pin: "482913" }));
    expect(await html(res)).toContain("Too many tries. Try again at 4:05 PM.");
  });
});

describe("auth middleware", () => {
  it("sends anonymous visitors to login and rejects anonymous API calls", async () => {
    const page = await req("/");
    expect(page.status).toBe(302);
    expect(page.headers.get("Location")).toBe("/login");
    const api = await req("/api/entries", { method: "POST" });
    expect(api.status).toBe(401);
  });

  it("lets a session with a valid profile through", async () => {
    const { householdId, profileIds } = await seedHousehold();
    const res = await req("/", { cookie: await authCookie(householdId, profileIds[0]) });
    expect(res.status).toBe(200);
  });

  it("sends sessions without a usable profile to /profile", async () => {
    const { householdId } = await seedHousehold();
    const other = await seedHousehold();
    const base = await authCookie(householdId);
    for (const cookie of [base, `${base}; kopit_profile=abc`, `${base}; kopit_profile=${other.profileIds[0]}`]) {
      const res = await req("/", { cookie });
      expect(res.status, cookie).toBe(302);
      expect(res.headers.get("Location")).toBe("/profile");
    }
  });
});

describe("logout", () => {
  it("deletes the session and clears cookies", async () => {
    const { householdId, profileIds } = await seedHousehold();
    const cookie = await authCookie(householdId, profileIds[0]);
    const res = await req("/logout", { method: "POST", cookie });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login?bye=1");
    const setCookies = res.headers.getSetCookie().join("\n");
    expect(setCookies).toMatch(/kopit_session=;.*Max-Age=0/);
    expect(setCookies).toMatch(/kopit_profile=;.*Max-Age=0/);
    expect(await db().select().from(sessions)).toHaveLength(0);
  });
});
