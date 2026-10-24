// The AI's answer, checked before it's shown: a line naming a peso amount the facts don't have is dropped, so a note
// can never make a number up.
import { PH_FAMILY_DAY, type NoteFacts } from "./facts";
import type { Lines, NoteLine } from "./types";

/** Every amount the facts hold (centavos): a line may only name these, give or take rounding. */
export function factAmounts(f: NoteFacts): number[] {
  const out = [f.total, f.needs, f.wants, f.other, PH_FAMILY_DAY, Math.abs(f.total - PH_FAMILY_DAY)];
  if (f.usual !== null) out.push(f.usual, Math.abs(f.total - f.usual));
  for (const i of f.items) out.push(i.amount);
  for (const c of f.cats) {
    out.push(c.amount, c.week);
    if (c.usual !== null) out.push(c.usual, Math.abs(c.amount - c.usual));
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

/** The AI's answer (JSON, or text with JSON in it), checked: the lines (at most 3) and tip that hold up, or null when no line does. */
export function readAnswer(raw: unknown, allowed: number[]): Lines | null {
  let a = raw;
  if (typeof a === "string") {
    try {
      a = JSON.parse(a.slice(a.indexOf("{"), a.lastIndexOf("}") + 1));
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
