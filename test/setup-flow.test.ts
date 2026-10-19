import { describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { categories, households, profiles } from "../src/db/schema";
import { authCookie, db, form, html, req, seedHousehold } from "./helpers";

const sessionFrom = (res: Response) => res.headers.get("Set-Cookie")!.split(";")[0];

describe("create household", () => {
  it("creates the household, signs in and seeds starter categories", async () => {
    const res = await req("/setup", form({ username: "Jon", pin: "482913", pinConfirm: "482913" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/setup/profiles");
    expect(sessionFrom(res)).toMatch(/^kopit_session=/);
    const [h] = await db().select().from(households);
    expect(h.username).toBe("jon");
    const cats = await db().select().from(categories).where(eq(categories.householdId, h.id)).orderBy(asc(categories.sortOrder));
    expect(cats.map((c) => `${c.emoji} ${c.name}`)).toEqual([
      "🛒 Groceries", "🍜 Food", "🚌 Transport", "💡 Bills", "🏠 Home", "💊 Health",
      "🛍️ Shopping", "🎉 Fun", "☕ Coffee", "📱 Load / Data", "🎁 Gifts", "✈️ Travel",
    ]);
  });

  it("explains bad input", async () => {
    await seedHousehold({ username: "jon" });
    const cases: Array<[Record<string, string>, string]> = [
      [{ username: "ana", pin: "482913", pinConfirm: "482914" }, "PINs don't match"],
      [{ username: "JON", pin: "482913", pinConfirm: "482913" }, "That username is taken"],
      [{ username: "ana", pin: "4829", pinConfirm: "4829" }, "PIN must be 6 digits"],
      [{ username: "a b", pin: "482913", pinConfirm: "482913" }, "Username"],
    ];
    for (const [data, message] of cases) {
      const res = await req("/setup", form(data));
      expect(res.status).toBe(200);
      expect(await html(res), message).toContain(message);
    }
    expect(await db().select().from(households)).toHaveLength(1);
  });
});

describe("profiles", () => {
  it("adds profiles and then picks one for this device", async () => {
    const res = await req("/setup", form({ username: "jon", pin: "482913", pinConfirm: "482913" }));
    const cookie = sessionFrom(res);
    await req("/setup/profiles", { ...form({ name: " Jon " }), cookie });
    await req("/setup/profiles", { ...form({ name: "Ana" }), cookie });
    const page = await html(await req("/setup/profiles", { cookie }));
    expect(page).toContain("Jon");
    expect(page).toContain("Ana");
    expect(page).toContain('href="/profile"');

    const ps = await db().select().from(profiles);
    expect(ps.map((p) => p.name)).toEqual(["Jon", "Ana"]);
    const pick = await req("/profile", { ...form({ profileId: String(ps[1].id) }), cookie });
    expect(pick.status).toBe(302);
    expect(pick.headers.get("Location")).toBe("/?fresh=1"); // never show a saved add screen that belongs to the previous profile
    expect(pick.headers.get("Set-Cookie")).toMatch(new RegExp(`^kopit_profile=${ps[1].id};.*Max-Age=31536000`));
  });

  it("refuses another household's profile", async () => {
    const mine = await seedHousehold();
    const other = await seedHousehold();
    const res = await req("/profile", { ...form({ profileId: String(other.profileIds[0]) }), cookie: await authCookie(mine.householdId) });
    expect(res.status).toBe(400);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("lists this household's profiles to pick from", async () => {
    const { householdId } = await seedHousehold({ profiles: ["Jon", "Ana"] });
    const page = await html(await req("/profile", { cookie: await authCookie(householdId) }));
    expect(page).toContain("Jon");
    expect(page).toContain("Ana");
  });
});
