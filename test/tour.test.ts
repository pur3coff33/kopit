import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { profiles } from "../src/db/schema";
import { TOUR_SCREENS } from "../src/views/tour";
// @ts-ignore plain browser module
import { placeNote, shouldTour } from "../public/js/tour.js";
import { addEntry, authCookie, db, html, req, seedHousehold } from "./helpers";

const PATHS = { add: "/", garden: "/spending", history: "/history", shed: "/settings" } as const;

const page = async (path: string, cookie: string) => html(await req(path, { cookie }));
const due = (body: string) => body.includes('data-due="1"');
const markTour = (cookie: string, screen: unknown) =>
  req("/api/tour", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ screen }), cookie });

describe("the first-time tours", () => {
  it("are offered on every screen to everyone who hasn't had them, including people from before they existed", async () => {
    const h = await seedHousehold(); // profiles inserted without the column set: as after the migration
    for (const id of h.profileIds) {
      const cookie = await authCookie(h.householdId, id);
      for (const [screen, path] of Object.entries(PATHS)) expect(due(await page(path, cookie)), screen).toBe(true);
    }
  });

  it("are had once per person and screen, on every phone, and not for the others in the household", async () => {
    const h = await seedHousehold();
    const jon = await authCookie(h.householdId, h.profileIds[0]);
    expect((await markTour(jon, "garden")).status).toBe(200);
    expect((await markTour(jon, "garden")).status).toBe(200); // twice is fine

    const row = await db().query.profiles.findFirst({ where: eq(profiles.id, h.profileIds[0]) });
    expect(row?.toursSeen).toBe("garden");
    expect(due(await page("/spending", jon))).toBe(false);
    expect(due(await page("/spending", await authCookie(h.householdId, h.profileIds[0])))).toBe(false); // another phone
    expect(due(await page("/", jon))).toBe(true); // the other screens still have theirs
    expect(due(await page("/spending", await authCookie(h.householdId, h.profileIds[1])))).toBe(true);
  });

  it("only knows its own screens, and needs a person picked", async () => {
    const h = await seedHousehold();
    expect((await markTour(await authCookie(h.householdId, h.profileIds[0]), "gallery")).status).toBe(400);
    expect((await markTour(await authCookie(h.householdId), "add")).status).toBe(401);
  });

  it("point only at parts their screen has", async () => {
    const h = await seedHousehold();
    await addEntry(h, { amount: 25_000, at: Date.now() - 60_000, category: "Eating out" }); // history needs a day to show
    const cookie = await authCookie(h.householdId, h.profileIds[0]);
    for (const screen of TOUR_SCREENS) {
      const body = await page(PATHS[screen], cookie);
      const spots = [...body.matchAll(/data-step-spot="([^"]+)"/g)].map((m) => m[1]);
      expect(spots.length, screen).toBeGreaterThan(0);
      for (const spot of spots) expect(body, `${screen}: ${spot}`).toMatch(new RegExp(`data-spot="(?:[^"]* )?${spot}(?: [^"]*)?"`));
    }
  });

  it("stay in the page once had, so they can be played again", async () => {
    const h = await seedHousehold();
    const jon = await authCookie(h.householdId, h.profileIds[0]);
    await markTour(jon, "add");
    const body = await page("/", jon);
    expect(body).toContain('id="tour"');
    expect(body).toContain('data-then="garden,history,shed"');
    expect(await html(await req("/guide"))).toContain('href="/?tour"');
  });

  it("show the garden's only on this month, the one with a plant growing and missions", async () => {
    const h = await seedHousehold();
    const jon = await authCookie(h.householdId, h.profileIds[0]);
    expect(await page("/spending?range=last", jon)).not.toContain('id="tour"');
  });
});

describe("on the phone", () => {
  it("opens when due and not yet closed here, or when asked for again", () => {
    expect(shouldTour(true, false, false)).toBe(true);
    expect(shouldTour(true, true, false)).toBe(false); // closed offline here; the server hasn't heard yet
    expect(shouldTour(false, false, false)).toBe(false);
    expect(shouldTour(false, true, true)).toBe(true);
  });

  it("puts the note below the lit-up part, above when there's no room, and always on the screen", () => {
    const note = { width: 300, height: 120 };
    const below = placeNote({ left: 20, top: 100, width: 350, height: 160 }, note, 390, 844);
    expect(below).toMatchObject({ side: "below", top: 272 });
    const above = placeNote({ left: 20, top: 760, width: 350, height: 44 }, note, 390, 844);
    expect(above).toMatchObject({ side: "above", top: 628 });
    const corner = placeNote({ left: 300, top: 8, width: 80, height: 30 }, note, 390, 844);
    expect(corner.left).toBe(390 - 300 - 12); // pushed back onto the screen
    expect(corner.tip).toBeGreaterThan(200); // the arrow still points at the corner
    expect(placeNote(null, note, 390, 844)).toMatchObject({ side: null, left: 45, top: 362 });
  });
});
