// The start of a person's day in kop.it, on whichever screen they open first (/js/morning.js asks for it): last month's
// Wrapped and last week's recap when they're due (as one story when both are), then the morning card with yesterday's
// leaf and its note. Each plays once per person, wherever they open kop.it: what they've had is kept on their profile.
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { profiles } from "../db/schema";
import type { Env } from "../env";
import { noteDue } from "./daynote";
import { todayGarden, type TodayGarden } from "./garden";

/** What a person has already had: the leaf and note by yesterday's date, the recaps by their month and Monday. */
export type Seen = { leaf?: string; note?: string; wrapped?: string; week?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/** A Seen sent by a phone, keeping only well-formed parts; null when there's nothing to keep. */
export function cleanSeen(raw: unknown): Seen | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: Seen = {};
  for (const k of ["leaf", "note", "week"] as const) if (typeof r[k] === "string" && DATE.test(r[k])) out[k] = r[k];
  if (typeof r.wrapped === "string" && MONTH.test(r.wrapped)) out.wrapped = r.wrapped;
  return Object.keys(out).length ? out : null;
}

/**
 * Which recap plays: last month's Wrapped (with last week's in it, as one story, when both are due), else last week's,
 * else none. Each counts as had once it starts, and so does yesterday's leaf: the recap shows instead of its card.
 */
export function recapToPlay(g: Pick<TodayGarden, "wrappedMonth" | "weekRecap" | "leafDay">, seen: Seen): { url: string; marks: Seen } | null {
  const month = g.wrappedMonth && g.wrappedMonth !== seen.wrapped ? g.wrappedMonth : null;
  const week = g.weekRecap && g.weekRecap !== seen.week ? g.weekRecap : null;
  if (!month && !week) return null;
  const url = month ? (week ? `/wrapped/${month}?week=${week}` : `/wrapped/${month}`) : `/week/${week}`;
  const marks: Seen = {};
  if (month) marks.wrapped = month;
  if (week) marks.week = week;
  if (g.leafDay) marks.leaf = g.leafDay;
  return { url, marks };
}

export type Morning =
  | { kind: "recap"; url: string; marks: Seen }
  | { kind: "card"; garden: TodayGarden; leaf: string | null; note: string | null }
  | { kind: "none" };

/** What this person's day starts with now: a recap, the morning card (its leaf, its note, or both), or nothing. */
export async function morning(env: Env, householdId: number, createdAt: number, profileId: number, now: number): Promise<Morning> {
  const [garden, noteDay, row] = await Promise.all([
    todayGarden(env, householdId, createdAt, now),
    noteDue(env, householdId, now),
    getDb(env)
      .select({ seen: profiles.morningSeen })
      .from(profiles)
      .where(and(eq(profiles.id, profileId), eq(profiles.householdId, householdId)))
      .get(),
  ]);
  let seen: Seen = {};
  try {
    seen = cleanSeen(JSON.parse(row?.seen ?? "{}")) ?? {};
  } catch {}
  const recap = recapToPlay(garden, seen);
  if (recap) return { kind: "recap", ...recap };
  const leaf = garden.leafDay && garden.leafDay !== seen.leaf ? garden.leafDay : null;
  const note = noteDay && noteDay !== seen.note ? noteDay : null;
  return leaf || note ? { kind: "card", garden, leaf, note } : { kind: "none" };
}

/** This person has had `had` (a recap starting, or the morning card closing): kept with what they'd had already. */
export async function markSeen(env: Env, householdId: number, profileId: number, had: Seen): Promise<void> {
  await env.DB.prepare("UPDATE profiles SET morning_seen = json_patch(morning_seen, ?) WHERE id = ? AND household_id = ?")
    .bind(JSON.stringify(had), profileId, householdId)
    .run();
}
