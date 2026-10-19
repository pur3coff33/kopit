// Asia/Manila is a fixed UTC+8 with no DST, so plain offset math is exact.
export const MANILA_OFFSET_MS = 8 * 3_600_000;
export const DAY_MS = 86_400_000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function local(ms: number): Date {
  return new Date(ms + MANILA_OFFSET_MS);
}

/** Days since epoch in Manila time. Mirrored in SQL as (spent_at + 28800000) / 86400000. */
export function dayKey(ms: number): number {
  return Math.floor((ms + MANILA_OFFSET_MS) / DAY_MS);
}

export function dayStart(ms: number): number {
  return dayKey(ms) * DAY_MS - MANILA_OFFSET_MS;
}

export function weekStart(ms: number): number {
  const start = dayStart(ms);
  const sinceMonday = (local(start).getUTCDay() + 6) % 7;
  return start - sinceMonday * DAY_MS;
}

export function monthStart(ms: number): number {
  return addMonths(ms, 0);
}

/** Start of the Manila month `n` months after the month containing `ms`. */
export function addMonths(ms: number, n: number): number {
  const d = local(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1) - MANILA_OFFSET_MS;
}

export function toDateInput(ms: number): string {
  return local(ms).toISOString().slice(0, 10);
}

export function fromDateInput(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const utc = Date.UTC(y, mo, d);
  const back = new Date(utc);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo || back.getUTCDate() !== d) return null;
  return utc - MANILA_OFFSET_MS;
}

export type RangeKind = "this" | "last" | "custom";
export type Range = { kind: RangeKind; start: number; end: number };

export function resolveRange(kind: RangeKind, now: number, from?: string, to?: string): Range {
  if (kind === "last") return { kind, start: addMonths(now, -1), end: monthStart(now) };
  if (kind === "custom") {
    let a = from ? fromDateInput(from) : null;
    let b = to ? fromDateInput(to) : null;
    if (a !== null && b !== null) {
      if (a > b) [a, b] = [b, a];
      return { kind, start: a, end: b + DAY_MS };
    }
  }
  return { kind: "this", start: monthStart(now), end: addMonths(now, 1) };
}

function shortDate(ms: number): string {
  const d = local(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function rangeLabel(start: number, endExclusive: number, now: number): string {
  const last = Math.max(start, Math.min(endExclusive - 1, now));
  if (dayKey(last) === dayKey(start)) return shortDate(start);
  const sameMonth = monthStart(start) === monthStart(last);
  return `${shortDate(start)} – ${sameMonth ? local(last).getUTCDate() : shortDate(last)}`;
}
