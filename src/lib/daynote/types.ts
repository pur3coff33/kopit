export type NoteLine = { emoji: string; text: string };

/** The AI's part of a note: a few lines, and one idea for the next day (null when the AI's didn't hold up). */
export type Lines = { lines: NoteLine[]; tip: string | null };

/** What a day's note shows: kop.it's own numbers (the bars) and the AI's lines. Stored as JSON in day_notes. */
export type DayNote = Lines & {
  total: number;
  /** The household's average day over the 4 weeks before; null with less than a week of history. */
  usual: number | null;
  /** The average Filipino family's day (PH_FAMILY_DAY) when this day went past it; null otherwise. */
  ph: number | null;
};
