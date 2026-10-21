import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getEntry } from "../src/lib/entries";
import { safeBack } from "../src/routes/entries";
import { addEntry, authCookie, form, html, req, seedHousehold } from "./helpers";

async function setup() {
  const h = await seedHousehold();
  const cookie = await authCookie(h.householdId, h.profileIds[0]);
  const spentAt = Date.UTC(2026, 9, 15, 2, 30); // 10:30 Manila Oct 15
  const id = await addEntry(h, { amount: 35000, at: spentAt, category: "Food" });
  return { h, cookie, id, spentAt };
}

describe("edit expense", () => {
  it("prefills the form", async () => {
    const { cookie, id } = await setup();
    const body = await html(await req(`/entries/${id}/edit`, { cookie }));
    expect(body).toContain('value="2026-10-15"');
    expect(body).toContain('id="amt">350<');
    expect(body).toMatch(/<input type="radio" name="categoryId" value="\d+" checked=""\/>\s*🍜 Food/);
    expect(body).toMatch(/<input type="radio" name="categoryId" value=""\/>\s*No category/);
    expect(body).not.toContain("<select");
  });

  it("changes the amount and category, keeping the time when the date is unchanged", async () => {
    const { h, cookie, id, spentAt } = await setup();
    const res = await req(`/entries/${id}`, { ...form({ amount: "99.5", categoryId: String(h.categoryIds.Bills), date: "2026-10-15" }), cookie });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`/spending/category/${h.categoryIds.Bills}`);
    expect(await getEntry(env, h.householdId, id)).toMatchObject({ amountCentavos: 9950, categoryId: h.categoryIds.Bills, spentAt });
  });

  it("moves to noon Manila on a new date and can clear the category", async () => {
    const { h, cookie, id } = await setup();
    const res = await req(`/entries/${id}`, { ...form({ amount: "350", categoryId: "", date: "2026-10-02" }), cookie });
    expect(res.headers.get("Location")).toBe("/spending/category/none");
    expect(await getEntry(env, h.householdId, id)).toMatchObject({ spentAt: Date.UTC(2026, 9, 2, 4), categoryId: null });
  });

  it("refuses a bad amount", async () => {
    const { h, cookie, id } = await setup();
    const res = await req(`/entries/${id}`, { ...form({ amount: "0", categoryId: "", date: "2026-10-15" }), cookie });
    expect(res.status).toBe(400);
    expect(await html(res)).toContain("Enter an amount");
    expect((await getEntry(env, h.householdId, id))?.amountCentavos).toBe(35000);
  });

  it("edits the note, and clears it when emptied", async () => {
    const { h, cookie, id } = await setup();
    await req(`/entries/${id}`, { ...form({ amount: "350", categoryId: "", date: "2026-10-15", note: "  Jollibee  " }), cookie });
    expect((await getEntry(env, h.householdId, id))?.note).toBe("Jollibee");
    expect(await html(await req(`/entries/${id}/edit`, { cookie }))).toContain('value="Jollibee"');
    await req(`/entries/${id}`, { ...form({ amount: "350", categoryId: "", date: "2026-10-15", note: "" }), cookie });
    expect((await getEntry(env, h.householdId, id))?.note).toBeNull();
  });

  it("goes back to where you came from after saving", async () => {
    const { cookie, id } = await setup();
    const back = "/history?who=all";
    const res = await req(`/entries/${id}`, { ...form({ amount: "350", categoryId: "", date: "2026-10-15", back }), cookie });
    expect(res.headers.get("Location")).toBe(back);
    const evil = await req(`/entries/${id}`, { ...form({ amount: "350", categoryId: "", date: "2026-10-15", back: "//evil.example" }), cookie });
    expect(evil.headers.get("Location")).toBe("/spending/category/none");
  });

  it("deletes", async () => {
    const { h, cookie, id } = await setup();
    const res = await req(`/entries/${id}/delete`, { method: "POST", cookie });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/spending");
    expect(await getEntry(env, h.householdId, id)).toBeUndefined();
  });

  it("is a 404 for another household's expense and changes nothing", async () => {
    const { id } = await setup();
    const other = await seedHousehold();
    const cookie = await authCookie(other.householdId, other.profileIds[0]);
    expect((await req(`/entries/${id}/edit`, { cookie })).status).toBe(404);
    expect((await req(`/entries/${id}`, { ...form({ amount: "1", categoryId: "", date: "2026-10-15" }), cookie })).status).toBe(404);
    expect((await req(`/entries/${id}/delete`, { method: "POST", cookie })).status).toBe(404);
  });

  it("refuses another household's category", async () => {
    const { h, cookie, id } = await setup();
    const other = await seedHousehold();
    const res = await req(`/entries/${id}`, { ...form({ amount: "1", categoryId: String(other.categoryIds.Food), date: "2026-10-15" }), cookie });
    expect(res.status).toBe(400);
    expect((await getEntry(env, h.householdId, id))?.categoryId).toBe(h.categoryIds.Food);
  });
});

describe("safeBack", () => {
  it("keeps same-site paths and refuses anything a browser could read as another site", () => {
    expect(safeBack("/history?who=all")).toBe("/history?who=all");
    expect(safeBack("//evil.com")).toBeNull();
    expect(safeBack("/\\evil.com")).toBeNull();
    expect(safeBack("/\t/evil.com")).toBeNull(); // browsers drop the tab and land on //evil.com
    expect(safeBack("/\n/evil.com")).toBeNull();
    expect(safeBack("https://evil.com")).toBeNull();
  });
});
