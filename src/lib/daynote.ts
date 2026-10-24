// Each finished day's note: a few gentle lines on how the household's day went and one idea for the next, shown on
// the morning card (add screen) and in the day's receipt in History. kop.it works out every number itself (noteFacts);
// the AI only puts them into words, and a line with a peso amount the facts don't have is dropped (keepLine), so a
// note can't make one up.
//
// Nothing runs on a schedule: a note is only written when a phone asks for it (the morning card, or opening the day in
// History), so a household nobody opens costs nothing. Written once and kept in day_notes; an expense on that day changing
// clears it. One phone writes a day's note at a time, and a day gets at most MAX_TRIES paid tries. Without the AI binding,
// or past the free plan's daily allowance, a day simply has no note. Local dev (DUMMY_NOTES) never asks the AI.
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { categories, dayNotes, entries, profiles } from "../db/schema";
import type { Env } from "../env";
import { FIXED, type CategoryKey, type Group } from "./categories";
import { missionDays } from "./garden";
import { formatPeso } from "./money";
import { DAY_MS, MANILA_OFFSET_MS, clockTime, dayKey, toDateInput, weekStart } from "./time";

/** Notes start with the day before they shipped (Fri, Oct 23, 2026), so the first morning has one: no earlier day gets one. */
export const NOTES_FROM = 20_749;

/**
 * The average Filipino family's spending in a day: ₱258,050 a year (PSA, 2023 Family Income and Expenditure Survey,
 * preliminary results released Aug 2024) over 365 days. In centavos.
 */
export const PH_FAMILY_DAY = 70_700;

/** Days of history a usual day is the average of. */
const USUAL_DAYS = 28;
/** Fewer days of history than this and there's no usual day yet: too few to call anything usual. */
const MIN_USUAL_DAYS = 7;

/** Good at following the voice and the facts, and returns JSON to a schema. About 75 neurons a note (of 10,000 free a day). */
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export type NoteLine = { emoji: string; text: string };

/** What a day's note shows: kop.it's own numbers (the bars) and the AI's lines. Stored as JSON in day_notes. */
export type DayNote = {
  total: number;
  /** The household's average day over the 4 weeks before; null with less than a week of history. */
  usual: number | null;
  /** The average Filipino family's day (PH_FAMILY_DAY) when this day went past it; null otherwise. */
  ph: number | null;
  lines: NoteLine[];
  /** One idea for the next day; null when the AI's didn't hold up. */
  tip: string | null;
};

export type NoteFacts = {
  /** "Wednesday, October 21" */
  date: string;
  /** "Thursday" */
  next: string;
  total: number;
  needs: number;
  wants: number;
  /** Expenses without a category. */
  other: number;
  usual: number | null;
  items: Array<{ what: string; category: string | null; group: Group | null; who: string; amount: number; time: string }>;
  /** Each category the day had: its usual day, and the week so far (Monday up to and including this day). */
  cats: Array<{
    key: CategoryKey;
    name: string;
    emoji: string;
    group: Group;
    amount: number;
    usual: number | null;
    daysThisWeek: number;
    week: number;
  }>;
  missions: { met: string[]; missed: string[] } | null;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const startOf = (day: number) => day * DAY_MS - MANILA_OFFSET_MS;
const groupOf = (key: string | null): Group | null => FIXED.find((f) => f.key === (key as CategoryKey))?.group ?? null;

function longDate(day: number): string {
  const d = new Date(day * DAY_MS);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Everything the note may say about `day`, worked out here; null when nothing was spent that day. */
export async function noteFacts(env: Env, householdId: number, createdAt: number, day: number, now: number): Promise<NoteFacts | null> {
  const db = getDb(env);
  const firstDay = Math.max(day - USUAL_DAYS, dayKey(createdAt));
  const historyDays = day - firstDay;
  const weekFirst = dayKey(weekStart(startOf(day)));
  const [rows, past, missions] = await Promise.all([
    db
      .select({
        amount: entries.amountCentavos,
        note: entries.note,
        spentAt: entries.spentAt,
        who: profiles.name,
        categoryId: entries.categoryId,
        key: categories.key,
        name: categories.name,
        emoji: categories.emoji,
      })
      .from(entries)
      .innerJoin(profiles, eq(profiles.id, entries.profileId))
      .leftJoin(categories, eq(categories.id, entries.categoryId))
      .where(and(eq(entries.householdId, householdId), gte(entries.spentAt, startOf(day)), lt(entries.spentAt, startOf(day + 1))))
      .orderBy(asc(entries.spentAt)),
    db
      .select({ amount: entries.amountCentavos, spentAt: entries.spentAt, categoryId: entries.categoryId })
      .from(entries)
      .where(and(eq(entries.householdId, householdId), gte(entries.spentAt, startOf(Math.min(firstDay, weekFirst))), lt(entries.spentAt, startOf(day)))),
    missionDays(env, householdId, createdAt, [day], now),
  ]);
  if (rows.length === 0) return null;

  const usualOn = historyDays >= MIN_USUAL_DAYS;
  const inWindow = past.filter((e) => dayKey(e.spentAt) >= firstDay);
  const avg = (sum: number) => (usualOn ? Math.round(sum / historyDays) : null);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const sumOf = (g: Group | null) => rows.filter((r) => groupOf(r.key) === g).reduce((s, r) => s + r.amount, 0);

  const cats = new Map<number, NoteFacts["cats"][number]>();
  for (const r of rows) {
    const group = groupOf(r.key);
    if (r.categoryId === null || !group) continue;
    const c = cats.get(r.categoryId);
    if (c) {
      c.amount += r.amount;
      c.week += r.amount;
    }
    else {
      const thisWeek = past.filter((e) => e.categoryId === r.categoryId && dayKey(e.spentAt) >= weekFirst);
      const days = new Set(thisWeek.map((e) => dayKey(e.spentAt)));
      const before = inWindow.filter((e) => e.categoryId === r.categoryId).reduce((s, e) => s + e.amount, 0);
      const week = thisWeek.reduce((s, e) => s + e.amount, 0);
      cats.set(r.categoryId, { key: r.key as CategoryKey, name: r.name!, emoji: r.emoji!, group, amount: r.amount, usual: avg(before), daysThisWeek: days.size + 1, week: week + r.amount });
    }
  }
  const m = missions.get(day);
  return {
    date: longDate(day),
    next: WEEKDAYS[new Date((day + 1) * DAY_MS).getUTCDay()],
    total,
    needs: sumOf("need"),
    wants: sumOf("want"),
    other: sumOf(null),
    usual: avg(inWindow.reduce((s, e) => s + e.amount, 0)),
    items: rows.map((r) => ({
      what: r.note ?? r.name ?? "Something",
      category: r.note && r.name ? r.name : null,
      group: groupOf(r.key),
      who: r.who,
      amount: r.amount,
      time: clockTime(r.spentAt),
    })),
    cats: [...cats.values()].sort((a, b) => b.amount - a.amount),
    missions: m ? { met: m.items.filter((i) => i.ok).map((i) => i.title), missed: m.items.filter((i) => !i.ok).map((i) => i.title) } : null,
  };
}

const diff = (a: number, b: number) => `${formatPeso(Math.abs(a - b))} ${a >= b ? "more" : "less"}`;

/** A want that ran at least twice its usual day (and ₱100 over it): one the note should point out. */
export const ranHigh = (c: NoteFacts["cats"][number]) => c.group === "want" && c.usual !== null && c.amount >= 2 * c.usual && c.amount - c.usual >= 10_000;

/** The facts as the AI reads them: plain lines, every amount already worked out. */
export function factsText(f: NoteFacts): string {
  const out = [
    `Day: ${f.date} (the next day is ${f.next})`,
    `Spent: ${formatPeso(f.total)} on ${f.items.length} ${f.items.length === 1 ? "expense" : "expenses"}`,
    `Needs ${formatPeso(f.needs)} · Wants ${formatPeso(f.wants)}${f.other ? ` · No category ${formatPeso(f.other)}` : ""}`,
    f.usual === null
      ? "Their usual day: not known yet (too new)"
      : `Their usual day (average of the last 4 weeks): ${formatPeso(f.usual)}, so this day was ${diff(f.total, f.usual)} than usual`,
    f.total > PH_FAMILY_DAY
      ? `Average Filipino family's day (government survey): ${formatPeso(PH_FAMILY_DAY)}, so this day was ${diff(f.total, PH_FAMILY_DAY)} than that`
      : `Average Filipino family's day (government survey): ${formatPeso(PH_FAMILY_DAY)}, and this day was under it`,
    "Expenses:",
    ...f.items.map((i) => `- ${i.what}${i.category ? ` (${i.category})` : ""}${i.group ? `, a ${i.group}` : ""}: ${formatPeso(i.amount)}, by ${i.who} at ${i.time}`),
    "By category:",
    ...f.cats.map(
      (c) =>
        `- ${c.emoji} ${c.name} (${c.key === "vices" ? "a vice: drinking, smoking or gambling" : c.group}): ${formatPeso(c.amount)}` +
        (c.usual === null ? "" : `, usually ${formatPeso(c.usual)} a day`) +
        (ranHigh(c) ? " (much more than usual)" : "") +
        `, bought on ${c.daysThisWeek} ${c.daysThisWeek === 1 ? "day" : "days"} this week so far, ${formatPeso(c.week)} this week so far`,
    ),
  ];
  const vices = f.cats.find((c) => c.key === "vices");
  if (vices) out.push(`Vices this day: ${formatPeso(vices.amount)} (${formatPeso(vices.week)} this week so far). Give them a line of their own.`);
  if (f.missions) {
    out.push(`Garden missions met: ${f.missions.met.length ? f.missions.met.join("; ") : "none"}`);
    out.push(`Garden missions missed: ${f.missions.missed.length ? f.missions.missed.join("; ") : "none"}`);
  }
  return out.join("\n");
}

const VOICE = `You write a short note about one day of a household's spending, for kop.it, a shared expense tracker in the
Philippines. They read it the next morning, and again later in their history.

Voice: warm, gentle and plain, like a kind friend who is good with money. Simple English.
- Never scold, shame or guilt anyone. Never write "should", "must", "stop", "don't" or "avoid".
- If the day ran high, say so plainly and kindly, and say what made it high. If it went well, enjoy it with them.
- Needs (groceries, meals, bills, transport, health, school, family) are necessary: you may explain them, never suggest
  cutting one. You may suggest spending less on a want, always as an option ("maybe", "if you feel like it").
- Vices (drinking, smoking, gambling) come first. When the day had any, always give them a line of their own: say
  plainly what was spent on them, without judging or preaching, and make the idea for the next day about less of them
  (or none), as an option. A short caring word about health or family is fine; a lecture is not.
- After vices, point out the wants marked "much more than usual".
- Using people's names is fine.
- Call the day by its weekday ("Saturday"), never "today", "yesterday" or "tomorrow". Call the next day by its weekday too.

Facts: use only the facts you're given, and be specific: name the categories, things, people and amounts that matter.
Copy every peso amount exactly as the facts write it, with the ₱ sign. Never work out a new amount, never guess a
reason the facts don't show, never mention income or savings.

Write:
- "lines": 2 or 3 lines, each one full sentence of 10 to 22 words with one fitting emoji, each saying something
  different. The first says how the day went against their usual day.
- "tip": one idea for the next day, 10 to 25 words, about something in these facts (the want that ran high, or what
  went well). Not generic advice.

Example, for a different household (its facts are not yours):
{"lines":[{"emoji":"📈","text":"Thursday came to ₱2,150, ₱900 more than usual, mostly from Ana's ₱1,200 shoes."},{"emoji":"🛒","text":"Groceries stayed right around usual at ₱540, so the basics were steady."},{"emoji":"🧋","text":"Milk tea showed up again: the 4th day this week, ₱180 this time."}],"tip":"Friday could skip the milk tea run if you feel like it; the shoes already made it a treat week."}

Only answer with JSON in that shape.`;

const SCHEMA = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: { type: "object", properties: { emoji: { type: "string" }, text: { type: "string" } }, required: ["emoji", "text"] },
    },
    tip: { type: "string" },
  },
  required: ["lines", "tip"],
};

/** Every amount the facts hold (centavos): a line may only name these, give or take rounding. */
export function factAmounts(f: NoteFacts): number[] {
  const out = [f.total, f.needs, f.wants, f.other, PH_FAMILY_DAY, Math.abs(f.total - PH_FAMILY_DAY)];
  if (f.usual !== null) out.push(f.usual, Math.abs(f.total - f.usual));
  for (const i of f.items) out.push(i.amount);
  for (const c of f.cats) {
    out.push(c.amount);
    if (c.usual !== null) out.push(c.usual, Math.abs(c.amount - c.usual));
    out.push(c.week);
  }
  return out.filter((a) => a > 0);
}

/** The peso amounts a line names (centavos): "₱1,415", "P300", "300 pesos". */
export function pesoAmounts(text: string): number[] {
  const out: number[] = [];
  const re = /(?:₱|\bPHP ?|\bP(?=\d))\s?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s?pesos?\b/gi;
  for (const m of text.matchAll(re)) out.push(Math.round(Number((m[1] ?? m[2]).replace(/,/g, "")) * 100));
  return out;
}

/** A line holds up when every amount it names is one of the facts', rounded at most ₱1 or 5% ("about ₱300" for ₱305). */
export function keepLine(text: string, allowed: number[]): boolean {
  return pesoAmounts(text).every((x) => allowed.some((a) => Math.abs(x - a) <= Math.max(100, a * 0.05)));
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The AI's answer, checked: the lines (at most 3) and tip that hold up, or null when no line does. */
export function readAnswer(raw: unknown, allowed: number[]): { lines: NoteLine[]; tip: string | null } | null {
  let a = raw;
  if (typeof a === "string") {
    const json = a.slice(a.indexOf("{"), a.lastIndexOf("}") + 1);
    try {
      a = JSON.parse(json);
    } catch {
      return null;
    }
  }
  if (!a || typeof a !== "object") return null;
  const { lines, tip } = a as { lines?: unknown; tip?: unknown };
  const kept = (Array.isArray(lines) ? lines : [])
    .map((l) => ({ emoji: clean((l as NoteLine)?.emoji, 8) || "🌱", text: clean((l as NoteLine)?.text, 200) }))
    .filter((l) => l.text && keepLine(l.text, allowed))
    .slice(0, 3);
  if (kept.length === 0) return null;
  const t = clean(tip, 240);
  return { lines: kept, tip: t && keepLine(t, allowed) ? t : null };
}

export type Lines = { lines: NoteLine[]; tip: string | null };

/**
 * What asking the AI came to: the lines that held up, or none. `charged`: whether the ask used up some of the daily
 * allowance (an answer came back, even one that didn't hold up), as opposed to being turned away (the allowance is used
 * up, or the AI couldn't be reached), which costs nothing.
 */
export type Written = { lines: Lines | null; charged: boolean };

/** Cloudflare's "you have used up your daily free allocation of 10,000 neurons" (error 4006), or the AI out of reach. */
const FREE_FAILURE = /\b4006\b|daily free allocation|neurons|network|fetch failed|ECONN/i;

/** Asks the AI for the day's lines. */
export async function writeLines(ai: NonNullable<Env["AI"]>, f: NoteFacts): Promise<Written> {
  try {
    const res = await ai.run(MODEL, {
      messages: [
        { role: "system", content: VOICE },
        { role: "user", content: factsText(f) },
      ],
      response_format: { type: "json_schema", json_schema: SCHEMA },
      max_tokens: 400,
      temperature: 0.4,
    });
    return { lines: readAnswer((res as { response?: unknown }).response, factAmounts(f)), charged: true };
  } catch (err) {
    console.warn("day note: the AI didn't answer", err);
    return { lines: null, charged: !FREE_FAILURE.test(String(err)) };
  }
}

/** Local dev's stand-in for the AI (DUMMY_NOTES): made-up lines around the day's real numbers, at no cost. */
export function dummyLines(f: NoteFacts): Lines {
  const weekday = f.date.split(",")[0];
  const top = f.cats[0];
  const lines: NoteLine[] = [
    {
      emoji: "🧪",
      text: `Sample note: ${weekday} came to ${formatPeso(f.total)}` + (f.usual === null ? "." : `, ${diff(f.total, f.usual)} than usual.`),
    },
  ];
  if (top) lines.push({ emoji: top.emoji, text: `${top.name} was the biggest part, at ${formatPeso(top.amount)}.` });
  return { lines, tip: `Made up for local dev: on the live app the AI writes this. ${f.next} is a fresh day.` };
}

/** Tries at writing a day's note that cost something, before it's left without one (until its expenses change). */
export const MAX_TRIES = 2;
/** How long one phone has to write a note before another may try: an AI answer takes a few seconds, 20 at the most. */
const CLAIM_MS = 60_000;

/**
 * `day`'s note: the stored one, or a new one written now (and kept). Null for today or later, days before notes began,
 * a day with nothing spent, or when it can't be written right now: no AI, another phone is writing it this minute, its
 * tries are used up, or the AI turned it away.
 *
 * Each day's row holds its note once written, and until then its tries and who's writing it (`claim`). Taking the claim
 * counts a try; one turned away for free is given back. An expense on the day changing deletes the row (forgetNote), so
 * a note from old numbers is never kept, and an older writer can never overwrite a newer one's row.
 */
export async function dayNote(env: Env, householdId: number, createdAt: number, day: number, now: number): Promise<DayNote | null> {
  if (day < NOTES_FROM || day >= dayKey(now)) return null;
  const known = await noteRows(env, householdId, [day]);
  if (known.has(day)) return known.get(day) ?? null;
  const dummy = env.DUMMY_NOTES === "1";
  const ai = env.AI;
  if (!dummy && !ai) return null;
  const f = await noteFacts(env, householdId, createdAt, day, now);
  if (!f) return null;

  const claim = crypto.randomUUID();
  const at = Date.now();
  const took = await env.DB.prepare(
    `INSERT INTO day_notes (household_id, day, note, tries, claim, claimed_at, created_at) VALUES (?1, ?2, NULL, 1, ?3, ?4, ?4)
     ON CONFLICT (household_id, day) DO UPDATE SET tries = tries + 1, claim = ?3, claimed_at = ?4
     WHERE day_notes.note IS NULL AND day_notes.tries < ?5 AND (day_notes.claim IS NULL OR day_notes.claimed_at < ?6)
     RETURNING tries`,
  )
    .bind(householdId, day, claim, at, MAX_TRIES, at - CLAIM_MS)
    .first();
  if (!took) return null;

  const written: Written = dummy ? { lines: dummyLines(f), charged: false } : await writeLines(ai!, f);
  const mine = "WHERE household_id = ? AND day = ? AND claim = ?";
  if (!written.lines) {
    await env.DB.prepare(`UPDATE day_notes SET claim = NULL${written.charged ? "" : ", tries = tries - 1"} ${mine}`)
      .bind(householdId, day, claim)
      .run();
    return null;
  }
  const note: DayNote = { total: f.total, usual: f.usual, ph: f.total > PH_FAMILY_DAY ? PH_FAMILY_DAY : null, ...written.lines };
  const kept = await env.DB.prepare(`UPDATE day_notes SET note = ?, claim = NULL, created_at = ? ${mine}`)
    .bind(JSON.stringify(note), Date.now(), householdId, day, claim)
    .run();
  // Not kept: an expense on the day changed while it was being written, so this note is from the old numbers.
  return kept.meta.changes > 0 ? note : null;
}

/**
 * What's known about `days`' notes: a day with its note, or null for one whose tries are used up. A day not in the map
 * hasn't been tried yet, or is being tried right now.
 */
export async function noteRows(env: Env, householdId: number, days: number[]): Promise<Map<number, DayNote | null>> {
  const out = new Map<number, DayNote | null>();
  if (days.length === 0) return out;
  const rows = await getDb(env)
    .select({ day: dayNotes.day, note: dayNotes.note, tries: dayNotes.tries, claim: dayNotes.claim })
    .from(dayNotes)
    .where(and(eq(dayNotes.householdId, householdId), gte(dayNotes.day, Math.min(...days)), lt(dayNotes.day, Math.max(...days) + 1)));
  for (const r of rows) {
    if (!days.includes(r.day)) continue;
    if (r.note !== null) out.set(r.day, JSON.parse(r.note) as DayNote);
    else if (r.tries >= MAX_TRIES && r.claim === null) out.set(r.day, null);
  }
  return out;
}

/** An expense on `spentAt` changed: that day's note is out of date. */
export async function forgetNote(env: Env, householdId: number, spentAt: number): Promise<void> {
  await getDb(env)
    .delete(dayNotes)
    .where(and(eq(dayNotes.householdId, householdId), eq(dayNotes.day, dayKey(spentAt))));
}

/** Whether a day can have a note at all: a finished day since notes began, with something spent (`spent`). */
export function noteable(day: number, today: number, spent: boolean): boolean {
  return spent && day >= NOTES_FROM && day < today;
}

/** Yesterday's date ("YYYY-MM-DD") when it can have a note: the morning card asks for it. */
export async function noteDue(env: Env, householdId: number, now: number): Promise<string | null> {
  const yesterday = dayKey(now) - 1;
  const [row] = await getDb(env)
    .select({ id: entries.id })
    .from(entries)
    .where(and(eq(entries.householdId, householdId), gte(entries.spentAt, startOf(yesterday)), lt(entries.spentAt, startOf(yesterday + 1))))
    .limit(1);
  if (!noteable(yesterday, dayKey(now), !!row)) return null;
  // Its tries used up: there's nothing to show, so no card that would only say so.
  const known = await noteRows(env, householdId, [yesterday]);
  return known.has(yesterday) && known.get(yesterday) === null ? null : toDateInput(startOf(yesterday));
}
