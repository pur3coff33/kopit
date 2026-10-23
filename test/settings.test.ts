import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { households, profiles } from "../src/db/schema";
import { FIXED, listCategories } from "../src/lib/categories";
import { verifyLogin } from "../src/lib/login";
import { authCookie, db, form, html, req, seedHousehold } from "./helpers";

async function setup() {
  const h = await seedHousehold({ username: "jon", pin: "482913" });
  return { h, cookie: await authCookie(h.householdId, h.profileIds[0]) };
}

describe("settings page", () => {
  it("has every section", async () => {
    const { cookie } = await setup();
    const body = await html(await req("/settings", { cookie }));
    for (const s of ["This phone's gardener", "People", "Change PIN", "Log out of this phone", 'action="/logout"', 'href="/profile"']) {
      expect(body, s).toContain(s);
    }
  });
});

describe("the shed's parts", () => {
  it("lists everyone with their own rename form, marks this phone's, and keeps Change PIN folded", async () => {
    const { h, cookie } = await setup();
    const body = await html(await req("/settings", { cookie }));
    for (const id of h.profileIds) expect(body).toContain(`action="/settings/profiles/${id}"`);
    expect(body.match(/<small>This phone<\/small>/g)).toHaveLength(1);
    expect(body).toMatch(/<section class="card fold" data-spot="pin"><details>/);
    for (const href of ['href="/guide"', 'href="/privacy"', 'href="/terms"']) expect(body).toMatch(new RegExp(`class="link" ${href}`));
  });

  it("opens the part that went wrong: Change PIN after a wrong PIN, a person's name box after a bad name", async () => {
    const { h, cookie } = await setup();
    const pin = await html(await req("/settings/pin", { ...form({ current: "000000", next: "123456", nextConfirm: "123456" }), cookie }));
    expect(pin).toContain("Current PIN didn't match.");
    expect(pin).toMatch(/data-spot="pin"><details open="">/);
    const name = await html(await req(`/settings/profiles/${h.profileIds[1]}`, { ...form({ name: "   " }), cookie }));
    expect(name).toMatch(new RegExp(`<li class="editing">(?:(?!</li>)[\\s\\S])*action="/settings/profiles/${h.profileIds[1]}"`));
    expect(name.match(/class="editing"/g)).toHaveLength(1);
  });
});

describe("people", () => {
  it("renames a profile and shows it in the header", async () => {
    const { h, cookie } = await setup();
    const res = await req(`/settings/profiles/${h.profileIds[0]}`, { ...form({ name: "Jonathan" }), cookie });
    expect(res.status).toBe(302);
    expect(await html(await req("/settings", { cookie }))).toMatch(/class="me" href="\/settings">[\s\S]*?<span>Jonathan<\/span>/);
  });

  it("adds a profile", async () => {
    const { h, cookie } = await setup();
    await req("/settings/profiles", { ...form({ name: "Lola" }), cookie });
    const names = (await db().select().from(profiles).where(eq(profiles.householdId, h.householdId))).map((p) => p.name);
    expect(names).toContain("Lola");
  });

  it("is a 404 for another household's profile", async () => {
    const { cookie } = await setup();
    const other = await seedHousehold();
    expect((await req(`/settings/profiles/${other.profileIds[0]}`, { ...form({ name: "X" }), cookie })).status).toBe(404);
  });
});

describe("categories", () => {
  it("can't be renamed or hidden any more", async () => {
    const { h, cookie } = await setup();
    expect((await req(`/settings/categories/${h.categoryIds.Groceries}/hidden`, { ...form({ hidden: "1" }), cookie })).status).toBe(404);
    expect((await req(`/settings/categories/${h.categoryIds.Groceries}`, { ...form({ name: "Food", emoji: "🍔" }), cookie })).status).toBe(404);
    expect((await listCategories(env, h.householdId)).map((c) => c.name)).toEqual(FIXED.map((c) => c.name));
  });
});

describe("change PIN", () => {
  it("changes the PIN when the current one is right", async () => {
    const { h, cookie } = await setup();
    const res = await req("/settings/pin", { ...form({ current: "482913", next: "135790", nextConfirm: "135790" }), cookie });
    expect(res.status).toBe(302);
    expect(await verifyLogin(env, "jon", "135790", Date.now())).toEqual({ ok: true, householdId: h.householdId });
    expect((await verifyLogin(env, "jon", "482913", Date.now())).ok).toBe(false);
  });

  it("logs out every other phone but keeps this one", async () => {
    const { h, cookie } = await setup();
    const otherPhone = await authCookie(h.householdId, h.profileIds[1]);
    await req("/settings/pin", { ...form({ current: "482913", next: "135790", nextConfirm: "135790" }), cookie });
    expect((await req("/spending", { cookie })).status).toBe(200);
    const kicked = await req("/spending", { cookie: otherPhone });
    expect(kicked.status).toBe(302);
    expect(kicked.headers.get("Location")).toBe("/login");
  });

  it("counts a wrong current PIN as a failed try and locks after 5", async () => {
    const { h, cookie } = await setup();
    const wrong = () => req("/settings/pin", { ...form({ current: "000000", next: "135790", nextConfirm: "135790" }), cookie });
    expect(await html(await wrong())).toContain("Current PIN didn't match");
    const [after1] = await db().select().from(households).where(eq(households.id, h.householdId));
    expect(after1.failedAttempts).toBe(1);
    for (let i = 0; i < 4; i++) await wrong();
    expect((await verifyLogin(env, "jon", "482913", Date.now())).ok).toBe(false);
  });

  it("checks the new PIN", async () => {
    const { cookie } = await setup();
    expect(await html(await req("/settings/pin", { ...form({ current: "482913", next: "1357", nextConfirm: "1357" }), cookie }))).toContain("PIN must be 6 digits");
    expect(await html(await req("/settings/pin", { ...form({ current: "482913", next: "135790", nextConfirm: "135791" }), cookie }))).toContain("PINs don't match");
  });
});
