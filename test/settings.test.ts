import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { households, profiles } from "../src/db/schema";
import { listCategories, topCategories } from "../src/lib/categories";
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
    for (const s of ["This phone is", "People", "Categories", "Change PIN", "Log out", 'action="/logout"', 'href="/profile"']) {
      expect(body, s).toContain(s);
    }
  });
});

describe("people", () => {
  it("renames a profile and shows it in the header", async () => {
    const { h, cookie } = await setup();
    const res = await req(`/settings/profiles/${h.profileIds[0]}`, { ...form({ name: "Jonathan" }), cookie });
    expect(res.status).toBe(302);
    expect(await html(await req("/settings", { cookie }))).toContain('class="me" href="/settings">Jonathan<');
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
  it("hides and shows a category", async () => {
    const { h, cookie } = await setup();
    await req(`/settings/categories/${h.categoryIds.Groceries}/hidden`, { ...form({ hidden: "1" }), cookie });
    expect((await topCategories(env, h.householdId)).map((c) => c.name)).not.toContain("Groceries");
    expect(await html(await req("/", { cookie }))).not.toContain('data-name="Groceries"');
    expect((await listCategories(env, h.householdId, { includeHidden: true })).map((c) => c.name)).toContain("Groceries");
    await req(`/settings/categories/${h.categoryIds.Groceries}/hidden`, { ...form({ hidden: "0" }), cookie });
    expect((await topCategories(env, h.householdId)).map((c) => c.name)).toContain("Groceries");
  });

  it("renames, but not onto an existing name", async () => {
    const { h, cookie } = await setup();
    const ok = await req(`/settings/categories/${h.categoryIds.Fun}`, { ...form({ name: "Movies", emoji: "🎬" }), cookie });
    expect(ok.status).toBe(302);
    const clash = await req(`/settings/categories/${h.categoryIds.Fun}`, { ...form({ name: "FOOD", emoji: "" }), cookie });
    expect(await html(clash)).toContain("That category already exists");
    expect((await listCategories(env, h.householdId)).find((c) => c.id === h.categoryIds.Fun)?.name).toBe("Movies");
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
