import type { TodayGarden } from "../lib/garden";
import { DAY_MS, fromDateInput, weekdayDate } from "../lib/time";
import { NoteSkeleton } from "./daynote";
import { Plant } from "./garden";

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * The morning card, on whichever screen a person opens first that day (/js/morning.js puts it in and opens it): yesterday's
 * leaf when they haven't celebrated it yet, under its own heading, and yesterday's note (`note`, its date) when they
 * haven't had it, its placeholder until /js/morning.js fetches it. With only the note, it's headed as the note.
 */
export function MorningCard({ garden, leaf, note, now }: { garden: TodayGarden; leaf: string | null; note: string | null; now: number }) {
  const leafAt = leaf ? (fromDateInput(leaf) ?? now - DAY_MS) : null;
  const noteAt = note ? (fromDateInput(note) ?? now - DAY_MS) : null;
  return (
    <dialog class="sheet leaf-sheet" id="morning-card" aria-labelledby={leafAt !== null ? "leaf-title" : "note-title"}>
      {leafAt !== null ? (
        <div class="leaf-head">
          <Plant leaves={garden.leafNumber} newLeaf width={140} />
          <h2 id="leaf-title">{garden.perfect ? "A perfect day! 🌸" : "A new leaf! 🍃"}</h2>
          <p>
            {garden.perfect ? "Every mission done yesterday" : `You finished ${garden.leafDone} of ${garden.leafMissions} missions yesterday`}{" "}
            (<span class="nowrap">{weekdayDate(leafAt)}</span>). That's your {ordinal(garden.leafNumber)} leaf{" "}
            {garden.leafMonthIsCurrent ? "this month" : `in ${garden.leafMonth}`}.
          </p>
        </div>
      ) : (
        noteAt !== null && (
          <div class="note-head">
            <h2 id="note-title">Yesterday, in a few words</h2>
            <p>
              <span class="nowrap">{weekdayDate(noteAt)}</span>
              {garden.leafMissions > 0 && ` · ${garden.leafDone} of ${garden.leafMissions} missions`}
            </p>
          </div>
        )
      )}
      {note && (
        <div class="dn-slot" aria-live="polite">
          <NoteSkeleton full />
        </div>
      )}
      <form method="dialog">
        <button class="save" type="submit">
          {leafAt !== null ? "Nice, thanks" : "Got it"}
        </button>
      </form>
    </dialog>
  );
}
