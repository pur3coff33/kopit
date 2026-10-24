// Where the lines come from: Workers AI on the live app, a made-up sample in local dev (DUMMY_NOTES).
import type { Env } from "../../env";
import { formatPeso } from "../money";
import { factAmounts, readAnswer } from "./check";
import type { NoteFacts } from "./facts";
import { SCHEMA, VOICE, diff, factsText } from "./prompt";
import type { Lines, NoteLine } from "./types";

/** Good at following the voice and the facts, and returns JSON to a schema. About 75 neurons a note (of 10,000 free a day). */
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Cloudflare's "you have used up your daily free allocation of 10,000 neurons" (error 4006), or the AI out of reach. */
const FREE_FAILURE = /\b4006\b|daily free allocation|neurons|network|fetch failed|ECONN/i;

/**
 * What asking the AI came to: the lines that held up, or none. `charged`: whether the ask used up some of the daily
 * allowance (an answer came back, even one that didn't hold up), as opposed to being turned away (the allowance is used
 * up, or the AI couldn't be reached), which costs nothing.
 */
export type Written = { lines: Lines | null; charged: boolean };

/** Asks the AI for the day's lines. */
export async function writeLines(ai: NonNullable<Env["AI"]>, f: NoteFacts): Promise<Written> {
  try {
    const res = await ai.run(MODEL, {
      messages: [
        { role: "system", content: VOICE },
        { role: "user", content: factsText(f) },
      ],
      response_format: { type: "json_schema", json_schema: SCHEMA },
      max_tokens: 400,
      temperature: 0.4,
    });
    return { lines: readAnswer((res as { response?: unknown }).response, factAmounts(f)), charged: true };
  } catch (err) {
    console.warn("day note: the AI didn't answer", err);
    return { lines: null, charged: !FREE_FAILURE.test(String(err)) };
  }
}

/** Local dev's stand-in for the AI: made-up lines around the day's real numbers, at no cost. */
export function dummyLines(f: NoteFacts): Lines {
  const weekday = f.date.split(",")[0];
  const top = f.cats[0];
  const lines: NoteLine[] = [
    { emoji: "🧪", text: `Sample note: ${weekday} came to ${formatPeso(f.total)}` + (f.usual === null ? "." : `, ${diff(f.total, f.usual)} than usual.`) },
  ];
  if (top) lines.push({ emoji: top.emoji, text: `${top.name} was the biggest part, at ${formatPeso(top.amount)}.` });
  return { lines, tip: `Made up for local dev: on the live app the AI writes this. ${f.next} is a fresh day.` };
}
