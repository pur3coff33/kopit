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

/** The household's notes, most used first (case-insensitive), each with the category it was last used with. */
export async function noteSuggestions(env: Env, householdId: number, limit = 100): Promise<NoteSuggestion[]> {
  const { results } = await env.DB.prepare(
    `SELECT
       (SELECT l.note FROM entries l WHERE l.household_id = e.household_id AND lower(l.note) = lower(e.note)
          ORDER BY l.spent_at DESC LIMIT 1) AS note,
       (SELECT l.category_id FROM entries l WHERE l.household_id = e.household_id AND lower(l.note) = lower(e.note)
          ORDER BY l.spent_at DESC LIMIT 1) AS categoryId,
       COUNT(*) AS count
     FROM entries e
     WHERE e.household_id = ? AND e.note IS NOT NULL
     GROUP BY lower(e.note)
     ORDER BY count DESC, MAX(e.spent_at) DESC
     LIMIT ?`,
  )
    .bind(householdId, limit)
    .all<NoteSuggestion>();
  return results;
}
