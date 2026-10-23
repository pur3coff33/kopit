import { describe, expect, it } from "vitest";
import { addMonths, monthStart, toDateInput } from "../src/lib/time";
import { addEntry, authCookie, html, req, seedHousehold } from "./helpers";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const label = (ms: number) => `<b>${MONTHS[Number(toDateInput(ms).slice(5, 7)) - 1]}</b>`;

describe("garden gallery", () => {
  it("shows every month's plant since the household began, newest first, three to a shelf, linking to each month", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: addMonths(now, -3) + 86_400_000 });
    await addEntry(h, { amount: 50000, at: addMonths(now, -2) + 86_400_000, category: "Bills" });
    await addEntry(h, { amount: 40000, at: addMonths(now, -1) + 86_400_000, category: "Bills" });
    const body = await html(await req("/gallery", { cookie: await authCookie(h.householdId, h.profileIds[0]) }));
    expect(body).toContain("<title>Gallery · kop.it</title>");
    const order = [0, -1, -2, -3].map((k) => body.indexOf(label(addMonths(now, k))));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order); // newest first
    expect(body).toMatch(/class="month-card growing"[^>]*>[\s\S]*?<b>\w+<\/b><span>\d+ so far/);
    expect(body).toContain(`<span>${toDateInput(addMonths(now, -1)).slice(0, 4)} · `); // a finished month says its year
    expect(body.match(/class="pot-shelf"/g)).toHaveLength(2); // 4 months: 3 on the first shelf, 1 on the next
    const last = addMonths(now, -1);
    expect(body).toContain(`from=${toDateInput(last)}&to=${toDateInput(monthStart(now) - 1)}`);
    expect(body.match(/class="month-card[^"]*"/g)).toHaveLength(4);
    expect(body).toContain("🌸"); // last month ended lower than the one before
  });

  it("needs a login", async () => {
    expect((await req("/gallery")).status).toBe(302);
  });
});
