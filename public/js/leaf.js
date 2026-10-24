// Small date checks for the garden bits of the add screen. The server stamps the dates; the phone checks them,
// because the add screen can come from the offline cache, rendered on an earlier day.
const MANILA_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" in Manila time. */
export function manilaDate(ms) {
  return new Date(ms + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The screen was rendered on an earlier day (an add screen served from the offline cache). */
export function isStale(stampDay, nowMs) {
  return stampDay !== manilaDate(nowMs);
}

/** Play last month's Wrapped once per phone. */
export function shouldShowWrapped(month, seen) {
  return !!month && month !== seen;
}

/**
 * Which recap to play, once per phone each: last month's Wrapped (with last week's in it, as one story, when both are
 * due), else last week's, else none. `month` and `week` are what's due ("YYYY-MM", the Monday "YYYY-MM-DD", or null).
 */
export function recapToPlay(month, week, seenMonth, seenWeek) {
  const playMonth = shouldShowWrapped(month, seenMonth);
  const playWeek = !!week && week !== seenWeek;
  if (playMonth) return playWeek ? `/wrapped/${month}?week=${week}` : `/wrapped/${month}`;
  return playWeek ? `/week/${week}` : null;
}

/** Celebrate yesterday's leaf, once per phone. */
export function shouldCelebrate(leafDay, nowMs, lastSeen) {
  return !!leafDay && leafDay === manilaDate(nowMs - DAY_MS) && leafDay !== lastSeen;
}

/**
 * What the morning card shows, once per phone each: yesterday's leaf (`leafDay`) and yesterday's note (`noteDay`), as
 * "YYYY-MM-DD" or null. `leaf`: celebrate the leaf (its heading); `note`: fetch the note into the card.
 */
export function morningCard(leafDay, noteDay, nowMs, seenLeaf, seenNote) {
  return { leaf: shouldCelebrate(leafDay, nowMs, seenLeaf), note: shouldCelebrate(noteDay, nowMs, seenNote) };
}
