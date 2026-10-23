import type { Env } from "../env";

export const MAX_NOTE = 60;

/** Trims and collapses spaces; "" becomes null. Returns undefined when the note is not acceptable. */
export function cleanNote(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const note = raw.trim().replace(/\s+/g, " ");
  if (!note) return null;
  return note.length <= MAX_NOTE ? note : undefined;
}

export type NoteSuggestion = { note: string; categoryId: number | null; count: number };

/**
 * The household's notes, most used first (case-insensitive), each with the category it was last used with.
 * One pass over the notes: the latest use of each note is its first row in a window, so nothing is looked up per note
 * (that took a scan of every expense for each distinct note, and slowed the add screen as history grew).
 */
export async function noteSuggestions(env: Env, householdId: number, limit = 100): Promise<NoteSuggestion[]> {
  const { results } = await env.DB.prepare(
    `SELECT note, categoryId, count FROM (
       SELECT note, category_id AS categoryId, spent_at,
              ROW_NUMBER() OVER (PARTITION BY lower(note) ORDER BY spent_at DESC, created_at DESC) AS latest,
              COUNT(*) OVER (PARTITION BY lower(note)) AS count
       FROM entries
       WHERE household_id = ? AND note IS NOT NULL
     )
     WHERE latest = 1
     ORDER BY count DESC, spent_at DESC
     LIMIT ?`,
  )
    .bind(householdId, limit)
    .all<NoteSuggestion>();
  return results;
}
