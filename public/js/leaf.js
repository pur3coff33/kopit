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

/** Celebrate yesterday's leaf, once per phone. */
export function shouldCelebrate(leafDay, nowMs, lastSeen) {
  return !!leafDay && leafDay === manilaDate(nowMs - DAY_MS) && leafDay !== lastSeen;
}
