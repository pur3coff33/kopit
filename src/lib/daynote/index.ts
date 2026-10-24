// Each finished day's note: a few gentle lines on how the household's day went and one idea for the next, shown on the
// morning card (/js/morning.js) and in the day's receipt in History.
//
// How a note is made, one file each:
//   facts.ts   kop.it works out every number itself, from the day's expenses and the weeks before
//   prompt.ts  what the AI is told: its voice and rules, and the facts as plain lines
//   writer.ts  asks the AI (or makes up a sample in local dev) for the lines
//   check.ts   reads the AI's answer and drops any line with a peso amount the facts don't have
//   store.ts   when a note is written, kept and cleared: one phone at a time, a few paid tries at most
//
// Nothing runs on a schedule: a note is only written when a phone asks for it, so a household nobody opens costs nothing.
export { NOTES_FROM, MAX_TRIES, dayNote, forgetNote, noteDue, noteRows, noteable } from "./store";
export { PH_FAMILY_DAY, noteFacts, ranHigh, type NoteFacts } from "./facts";
export { factsText } from "./prompt";
export { factAmounts, keepLine, pesoAmounts, readAnswer } from "./check";
export { dummyLines, writeLines, type Written } from "./writer";
export type { DayNote, Lines, NoteLine } from "./types";
