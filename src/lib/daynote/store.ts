// When a day's note is written, kept and cleared. Written once and kept in day_notes; an expense on that day changing
// clears it. One phone writes a day's note at a time, and a day gets at most MAX_TRIES paid tries. Without the AI binding,
// or past the free plan's daily allowance, a day simply has no note.
import { and, eq, gte, lt } from "drizzle-orm";
import { getDb } from "../../db/client";
import { dayNotes, entries } from "../../db/schema";
import type { Env } from "../../env";
import { dayKey, toDateInput } from "../time";
import { PH_FAMILY_DAY, noteFacts, startOf } from "./facts";
import type { DayNote } from "./types";
import { dummyLines, writeLines, type Written } from "./writer";

/** Notes start with the day before they shipped (Fri, Oct 23, 2026), so the first morning has one: no earlier day gets one. */
export const NOTES_FROM = 20_749;
/** Tries at writing a day's note that cost something, before it's left without one (until its expenses change). */
export const MAX_TRIES = 2;
/** How long one phone has to write a note before another may try: an AI answer takes a few seconds, 20 at the most. */
const CLAIM_MS = 60_000;

/** Whether a day can have a note at all: a finished day since notes began, with something spent (`spent`). */
export function noteable(day: number, today: number, spent: boolean): boolean {
  return spent && day >= NOTES_FROM && day < today;
}

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
  if (!(await takeClaim(env, householdId, day, claim))) return null;
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

/** Takes the day for this writer (counting a try), unless it's written, out of tries, or another phone has it this minute. */
async function takeClaim(env: Env, householdId: number, day: number, claim: string): Promise<boolean> {
  const at = Date.now();
  const took = await env.DB.prepare(
    `INSERT INTO day_notes (household_id, day, note, tries, claim, claimed_at, created_at) VALUES (?1, ?2, NULL, 1, ?3, ?4, ?4)
     ON CONFLICT (household_id, day) DO UPDATE SET tries = tries + 1, claim = ?3, claimed_at = ?4
     WHERE day_notes.note IS NULL AND day_notes.tries < ?5 AND (day_notes.claim IS NULL OR day_notes.claimed_at < ?6)
     RETURNING tries`,
  )
    .bind(householdId, day, claim, at, MAX_TRIES, at - CLAIM_MS)
    .first();
  return !!took;
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
