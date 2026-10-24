// What the AI is told: how to write (VOICE), the shape to answer in (SCHEMA), and the day's facts as plain lines.
// To change how notes sound, edit VOICE; to change what the AI knows, edit factsText (and facts.ts behind it).
import { formatPeso } from "../money";
import { PH_FAMILY_DAY, ranHigh, type NoteFacts } from "./facts";

/** "₱280 more" / "₱120 less": how `a` compares with `b`. */
export const diff = (a: number, b: number) => `${formatPeso(Math.abs(a - b))} ${a >= b ? "more" : "less"}`;

export const VOICE = `You write a short note about one day of a household's spending, for kop.it, a shared expense tracker in the
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

/** The answer's shape (Workers AI's JSON mode holds the AI to it). */
export const SCHEMA = {
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
