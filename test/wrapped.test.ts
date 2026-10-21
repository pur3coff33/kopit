import { describe, expect, it } from "vitest";
// @ts-ignore plain browser module
import { shouldShowWrapped } from "../public/js/leaf.js";
import { addMonths, toDateInput } from "../src/lib/time";
import { addEntry, authCookie, html, req, seedHousehold } from "./helpers";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const name = (ms: number) => MONTHS[Number(toDateInput(ms).slice(5, 7)) - 1];
const key = (ms: number) => toDateInput(ms).slice(0, 7);
const DAY = 86_400_000;

async function household(before: number, last: number) {
  const now = Date.now();
  const h = await seedHousehold({ createdAt: addMonths(now, -3) });
  await addEntry(h, { amount: before, at: addMonths(now, -2) + DAY, category: "Bills" });
  await addEntry(h, { amount: last, at: addMonths(now, -1) + DAY, category: "Bills" });
  const cookie = await authCookie(h.householdId, h.profileIds[0]);
  return { h, cookie, last: addMonths(now, -1), before: addMonths(now, -2) };
}

describe("Wrapped", () => {
  it("tells a month that went down how much lower it was, with its plant and good days", async () => {
    const { cookie, last, before } = await household(50000, 40000);
    const body = await html(await req(`/wrapped/${key(last)}`, { cookie }));
    expect(body).toContain(`${name(last)}, wrapped`);
    expect(body).toContain(`data-month="${key(last)}"`);
    expect(body).toContain("−20%");
    expect(body).toContain(`less than ${name(before)}`);
    expect(body).toContain("good days in the garden");
    expect(body).toContain("your most-beaten mission");
    expect(body.match(/<section class="slide/g)!.length).toBeGreaterThanOrEqual(5);
    expect(body).not.toContain('<nav class="nav">'); // full-screen story
  });

  it("never shows a worse number: a month that went up gets an affirmation instead", async () => {
    const { cookie, last } = await household(40000, 50000);
    const body = await html(await req(`/wrapped/${key(last)}`, { cookie }));
    expect(body).toContain('class="affirm"');
    expect(body).not.toMatch(/[+−-]\d+%/);
    expect(body).not.toContain("more than");
  });

  it("only exists for finished months since the household began", async () => {
    const { cookie } = await household(50000, 40000);
    const now = Date.now();
    expect((await req(`/wrapped/${key(now)}`, { cookie })).status).toBe(404); // still growing
    expect((await req(`/wrapped/${key(addMonths(now, -6))}`, { cookie })).status).toBe(404); // before the household
    expect((await req("/wrapped/2026-13", { cookie })).status).toBe(404);
    expect((await req(`/wrapped/${key(addMonths(now, -1))}`)).status).toBe(302); // needs a login
  });

  it("makes a story-sized share picture with no peso amounts", async () => {
    const { cookie, last } = await household(50000, 40000);
    const res = await req(`/wrapped/${key(last)}/card.svg`, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
    const svg = await res.text();
    expect(svg).toContain('width="1080" height="1920"');
    expect(svg).toContain("good days");
    expect(svg).toContain("@font-face");
    expect(svg).not.toContain("₱");
  });

  it("is due on the add screen once last month is over", async () => {
    const { cookie, last } = await household(50000, 40000);
    expect(await html(await req("/", { cookie }))).toContain(`data-wrapped="${key(last)}"`);
  });

  it("plays once per phone", () => {
    expect(shouldShowWrapped("2026-10", null)).toBe(true);
    expect(shouldShowWrapped("2026-10", "2026-09")).toBe(true);
    expect(shouldShowWrapped("2026-10", "2026-10")).toBe(false);
    expect(shouldShowWrapped(null, null)).toBe(false);
  });
});
