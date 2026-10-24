import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { MAX_TRIES, NOTES_FROM, PH_FAMILY_DAY, dayNote, factAmounts, factsText, keepLine, noteFacts, noteRows, pesoAmounts, readAnswer } from "../src/lib/daynote";
import { deleteEntry, insertEntry } from "../src/lib/entries";
import { DAY_MS, MANILA_OFFSET_MS, dayKey, toDateInput } from "../src/lib/time";
import { addEntry, authCookie, html, seedHousehold } from "./helpers";

const startOf = (day: number) => day * DAY_MS - MANILA_OFFSET_MS;
const at = (day: number, hour: number) => startOf(day) + hour * 3_600_000;

/** A stand-in for Workers AI that answers `answer` (or throws it, if it's an Error) and remembers what it was asked. */
function fakeAI(answer: unknown) {
  const asked: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const ai = {
    run: async (_model: string, input: (typeof asked)[number]) => {
      asked.push(input);
      if (answer instanceof Error) throw answer;
      return { response: answer };
    },
  } as unknown as Ai;
  return { ai, asked };
}

const GOOD = {
  lines: [
    { emoji: "🛒", text: "Groceries were ₱965, most of the day." },
    { emoji: "☕", text: "Eating out came to ₱160." },
  ],
  tip: "With groceries done, the next day could be a light one.",
};

describe("checking the AI's lines against the facts", () => {
  it("finds peso amounts however they're written", () => {
    expect(pesoAmounts("₱1,415 today, about P300 more, and 50 pesos on load")).toEqual([141_500, 30_000, 5_000]);
    expect(pesoAmounts("3 coffee days this week")).toEqual([]);
  });

  it("keeps a line whose amounts are the facts' (give or take rounding) and drops one that makes an amount up", () => {
    const allowed = [141_500, 30_500];
    expect(keepLine("₱1,415 spent, about ₱300 more than usual", allowed)).toBe(true);
    expect(keepLine("You could save ₱2,000 a week", allowed)).toBe(false);
    expect(keepLine("A calm day", allowed)).toBe(true);
  });

  it("reads JSON or text with JSON in it, keeps at most 3 lines, and drops the tip if it doesn't hold up", () => {
    const allowed = [96_500, 16_000];
    expect(readAnswer(GOOD, allowed)).toEqual(GOOD);
    expect(readAnswer(`Here you go: ${JSON.stringify(GOOD)}`, allowed)).toEqual(GOOD);
    const many = { lines: Array.from({ length: 5 }, () => GOOD.lines[0]), tip: "Save ₱9,999 tomorrow" };
    expect(readAnswer(many, allowed)).toEqual({ lines: [GOOD.lines[0], GOOD.lines[0], GOOD.lines[0]], tip: null });
    expect(readAnswer({ lines: [{ emoji: "💸", text: "That was ₱5,000!" }], tip: "x" }, allowed)).toBeNull();
    expect(readAnswer("not json", allowed)).toBeNull();
    expect(readAnswer(null, allowed)).toBeNull();
  });
});

describe("a day's facts", () => {
  it("works out the day, its usual day, needs and wants, and each category's week from the household's own expenses", async () => {
    const day = NOTES_FROM;
    const h = await seedHousehold({ profiles: ["Maya", "Leo"], createdAt: startOf(day - 14) });
    // Two weeks before: ₱100 of groceries every day (₱1,400), so the usual day is ₱100.
    for (let d = day - 14; d < day; d++) await addEntry(h, { amount: 10_000, at: at(d, 9), category: "Groceries", profile: 1 });
    await addEntry(h, { amount: 96_500, at: at(day, 10), category: "Groceries", profile: 1 });
    await addEntry(h, { amount: 16_000, at: at(day, 15), category: "Eating out" });
    await addEntry(h, { amount: 5_000, at: at(day, 18), category: null });

    const f = (await noteFacts(env, h.householdId, startOf(day - 14), day, at(day + 1, 9)))!;
    expect(f.date).toBe("Friday, October 23");
    expect(f.next).toBe("Saturday");
    expect([f.total, f.needs, f.wants, f.other, f.usual]).toEqual([117_500, 96_500, 16_000, 5_000, 10_000]);
    expect(f.items.map((i) => [i.what, i.who, i.amount])).toEqual([
      ["Groceries", "Leo", 96_500],
      ["Eating out", "Maya", 16_000],
      ["Something", "Maya", 5_000],
    ]);
    const groceries = f.cats.find((c) => c.name === "Groceries")!;
    expect(groceries.usual).toBe(10_000);
    expect(groceries.daysThisWeek).toBe(5); // Monday Oct 19 to Friday Oct 23
    expect(f.missions).not.toBeNull();

    const text = factsText(f);
    expect(text).toContain("Spent: ₱1,175 on 3 expenses");
    expect(text).toContain("₱1,075 more than usual");
    expect(text).toContain(`family's day (government survey): ₱${PH_FAMILY_DAY / 100}, so this day was ₱468 more`);
    expect(factAmounts(f)).toEqual(expect.arrayContaining([117_500, 107_500, 96_500, 16_000]));
  });

  it("singles out vices, with the week so far, and wants that ran far above usual", async () => {
    const day = NOTES_FROM;
    const h = await seedHousehold({ createdAt: startOf(day - 14) });
    for (let d = day - 14; d < day; d++) await addEntry(h, { amount: 5_000, at: at(d, 20), category: "Eating out" }); // ₱50 a day
    await addEntry(h, { amount: 18_000, at: at(day - 2, 21), category: "Vices" }); // Wednesday
    await addEntry(h, { amount: 25_000, at: at(day, 22), category: "Vices" });
    await addEntry(h, { amount: 30_000, at: at(day, 19), category: "Eating out" });
    const f = (await noteFacts(env, h.householdId, startOf(day - 14), day, at(day + 1, 9)))!;
    const text = factsText(f);
    expect(text).toContain("Vices (a vice: drinking, smoking or gambling): ₱250");
    expect(text).toContain("Vices this day: ₱250 (₱430 this week so far). Give them a line of their own.");
    expect(text).toMatch(/Eating out \(want\): ₱300, usually ₱50 a day \(much more than usual\)/);
    expect(factAmounts(f)).toEqual(expect.arrayContaining([25_000, 43_000]));
  });

  it("has no usual day in the household's first week, and no facts for a day with nothing spent", async () => {
    const day = NOTES_FROM;
    const h = await seedHousehold({ createdAt: startOf(day - 2) });
    await addEntry(h, { amount: 20_000, at: at(day, 12), category: "Meals" });
    expect((await noteFacts(env, h.householdId, startOf(day - 2), day, at(day + 1, 9)))!.usual).toBeNull();
    expect(await noteFacts(env, h.householdId, startOf(day - 2), day - 1, at(day + 1, 9))).toBeNull();
  });
});

describe("a day's note", () => {
  const setup = async () => {
    const day = NOTES_FROM;
    const h = await seedHousehold({ createdAt: startOf(day - 3) });
    await addEntry(h, { amount: 96_500, at: at(day, 10), category: "Groceries" });
    await addEntry(h, { amount: 16_000, at: at(day, 15), category: "Eating out" });
    return { day, h, createdAt: startOf(day - 3), now: at(day + 1, 9) };
  };

  it("is written once, kept, and read back without asking the AI again", async () => {
    const { day, h, createdAt, now } = await setup();
    const { ai, asked } = fakeAI(GOOD);
    const note = await dayNote({ ...env, AI: ai }, h.householdId, createdAt, day, now);
    expect(note).toEqual({ total: 112_500, usual: null, ph: PH_FAMILY_DAY, lines: GOOD.lines, tip: GOOD.tip });
    expect(asked).toHaveLength(1);
    expect(asked[0].messages[1].content).toContain("Groceries");
    expect(await dayNote({ ...env, AI: ai }, h.householdId, createdAt, day, now)).toEqual(note);
    expect(asked).toHaveLength(1);
  });

  const tries = async (householdId: number, day: number) =>
    (await env.DB.prepare("SELECT tries FROM day_notes WHERE household_id = ? AND day = ?").bind(householdId, day).first<{ tries: number }>())?.tries ?? 0;

  it("isn't written for today, a day before notes began, or without an AI", async () => {
    const { day, h, createdAt, now } = await setup();
    const { ai, asked } = fakeAI(GOOD);
    expect(await dayNote({ ...env, AI: ai }, h.householdId, createdAt, day + 1, now)).toBeNull();
    expect(await dayNote({ ...env, AI: ai }, h.householdId, createdAt, NOTES_FROM - 1, now)).toBeNull();
    expect(await dayNote({ ...env, AI: undefined }, h.householdId, createdAt, day, now)).toBeNull();
    expect(asked).toHaveLength(0);
    expect(await tries(h.householdId, day)).toBe(0);
  });

  it("gives up after a few paid tries that didn't hold up, until the day's expenses change", async () => {
    const { day, h, createdAt, now } = await setup();
    const made = fakeAI({ lines: [{ emoji: "💸", text: "That was ₱99,999!" }], tip: "" });
    const e = { ...env, AI: made.ai };
    for (let i = 0; i < MAX_TRIES + 2; i++) expect(await dayNote(e, h.householdId, createdAt, day, now)).toBeNull();
    expect(made.asked).toHaveLength(MAX_TRIES);
    expect((await noteRows(env, h.householdId, [day])).get(day)).toBeNull(); // given up: History shows no line
    await insertEntry(env, h.householdId, { id: crypto.randomUUID(), profileId: h.profileIds[0], categoryId: null, amountCentavos: 1_000, spentAt: at(day, 20) }, Date.now());
    expect(await dayNote({ ...env, AI: fakeAI(GOOD).ai }, h.householdId, createdAt, day, now)).not.toBeNull();
  });

  it("doesn't count a try the AI turned away for free (the daily allowance used up)", async () => {
    const { day, h, createdAt, now } = await setup();
    const full = fakeAI(new Error("4006: you have used up your daily free allocation of 10,000 neurons"));
    for (let i = 0; i < MAX_TRIES + 1; i++) expect(await dayNote({ ...env, AI: full.ai }, h.householdId, createdAt, day, now)).toBeNull();
    expect(full.asked).toHaveLength(MAX_TRIES + 1);
    expect(await tries(h.householdId, day)).toBe(0);
    expect(await dayNote({ ...env, AI: fakeAI(GOOD).ai }, h.householdId, createdAt, day, now)).not.toBeNull();
  });

  it("is written by one phone at a time: a second ask meanwhile doesn't ask the AI again", async () => {
    const { day, h, createdAt, now } = await setup();
    let answer!: (v: unknown) => void;
    let calls = 0;
    const slow = { run: () => (calls++, new Promise((r) => (answer = r))) } as unknown as Ai;
    const first = dayNote({ ...env, AI: slow }, h.householdId, createdAt, day, now);
    while (calls === 0) await new Promise((r) => setTimeout(r, 5));
    expect(await dayNote({ ...env, AI: slow }, h.householdId, createdAt, day, now)).toBeNull();
    expect(calls).toBe(1);
    answer({ response: GOOD });
    expect((await first)?.lines).toEqual(GOOD.lines);
  });

  it("isn't kept when an expense on its day changes while it's being written", async () => {
    const { day, h, createdAt, now } = await setup();
    const racing = {
      run: async () => {
        await insertEntry(env, h.householdId, { id: crypto.randomUUID(), profileId: h.profileIds[0], categoryId: null, amountCentavos: 1_000, spentAt: at(day, 20) }, Date.now());
        return { response: GOOD };
      },
    } as unknown as Ai;
    expect(await dayNote({ ...env, AI: racing }, h.householdId, createdAt, day, now)).toBeNull();
    expect((await noteRows(env, h.householdId, [day])).size).toBe(0);
  });

  it("is cleared when an expense on its day is added or deleted, and only that day's", async () => {
    const { day, h, createdAt, now } = await setup();
    const e = { ...env, AI: fakeAI(GOOD).ai };
    await dayNote(e, h.householdId, createdAt, day, now);
    const id = crypto.randomUUID();
    await insertEntry(env, h.householdId, { id, profileId: h.profileIds[0], categoryId: null, amountCentavos: 1_000, spentAt: at(day + 3, 20) }, Date.now());
    expect((await noteRows(env, h.householdId, [day])).size).toBe(1);
    await deleteEntry(env, h.householdId, (await addEntry(h, { amount: 500, at: at(day, 21), category: null })), 0);
    expect((await noteRows(env, h.householdId, [day])).size).toBe(0);
  });

  it("is made up around the real numbers in local dev, without asking the AI", async () => {
    const { day, h, createdAt, now } = await setup();
    const { ai, asked } = fakeAI(GOOD);
    const note = await dayNote({ ...env, AI: ai, DUMMY_NOTES: "1" }, h.householdId, createdAt, day, now);
    expect(asked).toHaveLength(0);
    expect(note?.total).toBe(112_500);
    expect(note?.lines[0].text).toBe("Sample note: Friday came to ₱1,125.");
    expect(note?.lines[1].text).toBe("Groceries was the biggest part, at ₱965.");
    expect(await dayNote({ ...env, AI: undefined, DUMMY_NOTES: "1" }, h.householdId, createdAt, day, now)).toEqual(note);
  });

  it("comes as a piece of page from /api/day-note, with the bars on the morning card's", async () => {
    const { day, h } = await setup();
    const { ai } = fakeAI(GOOD);
    const cookie = await authCookie(h.householdId, h.profileIds[0]);
    const get = (path: string, AI?: Ai) => app.request(path, { headers: { Cookie: cookie } }, { ...env, AI });
    const date = toDateInput(startOf(day));
    expect((await get(`/api/day-note/${date}`)).status).toBe(204); // no AI: no note
    const full = await html(await get(`/api/day-note/${date}?full`, ai));
    expect(full).toContain("dn-bars");
    expect(full).toContain("PH family");
    expect(full).toContain("For today");
    expect(full).toContain("Groceries were ₱965");
    const receipt = await html(await get(`/api/day-note/${date}`, ai));
    expect(receipt).not.toContain("dn-bars");
    expect(receipt).toContain("Next day:");
    expect((await get("/api/day-note/2026-13-40", ai)).status).toBe(400);
  });

  it("tells a note that may still come (503) from one that won't (204)", async () => {
    const { day, h } = await setup();
    const cookie = await authCookie(h.householdId, h.profileIds[0]);
    const get = (date: string, AI?: Ai) => app.request(`/api/day-note/${date}`, { headers: { Cookie: cookie } }, { ...env, AI });
    const date = toDateInput(startOf(day));
    const full = fakeAI(new Error("4006: you have used up your daily free allocation of 10,000 neurons")).ai;
    const later = await get(date, full);
    expect(later.status).toBe(503);
    expect(later.headers.get("Retry-After")).toBe("60");
    expect((await get(toDateInput(startOf(day - 1)), full)).status).toBe(204); // nothing spent that day
    expect((await get(toDateInput(startOf(NOTES_FROM - 1)), full)).status).toBe(204); // before notes began
    const made = fakeAI({ lines: [{ emoji: "💸", text: "That was ₱99,999!" }], tip: "" }).ai;
    for (let i = 1; i < MAX_TRIES; i++) expect((await get(date, made)).status).toBe(503);
    expect((await get(date, made)).status).toBe(204); // its last try didn't hold up either: given up
  });
});

describe("where a note shows", () => {
  it("opens the morning card with the note's heading after a day without a leaf", async () => {
    const now = Date.now();
    const yesterday = dayKey(now) - 1;
    const h = await seedHousehold({ createdAt: startOf(yesterday - 3) });
    const cats = ["Groceries", "Eating out", "Transport", "Bills", "Household", "Shopping"];
    const amounts = [500_000, 4_000, 90_000, 200_000, 60_000, 120_000];
    for (let i = 0; i < cats.length; i++) await addEntry(h, { amount: amounts[i], at: at(yesterday, 7 + i * 2), category: cats[i] });
    const res = await app.request("/api/morning", { headers: { Cookie: await authCookie(h.householdId, h.profileIds[0]) } }, env);
    const m = (await res.json()) as { card: string; leaf: string | null; note: string };
    expect(m.leaf).toBeNull();
    expect(m.note).toBe(toDateInput(startOf(yesterday)));
    const body = m.card;
    expect(body).toContain('aria-labelledby="note-title"');
    expect(body).toContain("Yesterday, in a few words");
    expect(body).toContain('class="dn-slot"');
    expect(body).toMatch(/class="dn-slot"[^>]*>\s*<div class="dn-loading" role="status">/); // its placeholder, until the note comes
    expect(body).not.toContain('class="leaf-head"');
  });

  it("has no morning card (and no History line) for a day whose tries are used up", async () => {
    const now = Date.now();
    const yesterday = dayKey(now) - 1;
    const h = await seedHousehold({ createdAt: startOf(yesterday - 3) });
    await addEntry(h, { amount: 96_500, at: at(yesterday, 10), category: "Groceries" });
    const made = fakeAI({ lines: [{ emoji: "💸", text: "That was ₱99,999!" }], tip: "" }).ai;
    for (let i = 0; i < MAX_TRIES; i++) await dayNote({ ...env, AI: made }, h.householdId, startOf(yesterday - 3), yesterday, now);
    const cookie = await authCookie(h.householdId, h.profileIds[0]);
    const m = await app.request("/api/morning", { headers: { Cookie: cookie } }, env);
    if (m.status !== 204) expect(((await m.json()) as { note: unknown }).note).toBeNull(); // the leaf may still be due
    expect(await html(await app.request("/history", { headers: { Cookie: cookie } }, env))).not.toContain("The day in a few words");
  });

  it("puts the note in the day's receipt for Everyone, written or still to ask for, and not for one person", async () => {
    const now = Date.now();
    const yesterday = dayKey(now) - 1;
    const h = await seedHousehold({ createdAt: startOf(yesterday - 3) });
    await addEntry(h, { amount: 96_500, at: at(yesterday, 10), category: "Groceries" });
    const cookie = await authCookie(h.householdId, h.profileIds[0]);
    const page = async (who: string) => html(await app.request(`/history?who=${who}`, { headers: { Cookie: cookie } }, env));
    const date = toDateInput(startOf(yesterday));
    const waiting = await page("all");
    expect(waiting).toContain(`data-note="${date}"`);
    expect(waiting).toContain('class="dn-loading"');
    await dayNote({ ...env, AI: fakeAI(GOOD).ai }, h.householdId, startOf(yesterday - 3), yesterday, now);
    const written = await page("all");
    expect(written).toContain("The day in a few words");
    expect(written).toContain("Groceries were ₱965");
    expect(written).not.toContain(`data-note="${date}"`);
    expect(await page(String(h.profileIds[0]))).not.toContain("The day in a few words");
  });
});
