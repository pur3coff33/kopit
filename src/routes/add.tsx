import { Hono } from "hono";
import type { AppEnv } from "../env";
import { FIXED, listCategories, usualCategories } from "../lib/categories";
import { noteDue } from "../lib/daynote";
import { NoteSkeleton } from "../views/daynote";
import { todayGarden } from "../lib/garden";
import { DAY_MS, dayStart, fromDateInput, isNight, weekdayDate } from "../lib/time";
import { noteSuggestions } from "../lib/notes";
import { requireProfile, requireSession } from "../middleware/auth";
import { Amount, CategoryPicker, CategorySheet, Keypad, Toast } from "../views/components";
import { Plant, Sky } from "../views/garden";
import { Layout } from "../views/layout";
import { Tour } from "../views/tour";

export const add = new Hono<AppEnv>();

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

add.get("/", requireSession, requireProfile, async (c) => {
  const householdId = c.get("householdId");
  const now = Date.now();
  const [cats, usual, notes, garden, noteDay] = await Promise.all([
    listCategories(c.env, householdId),
    usualCategories(c.env, householdId, now),
    noteSuggestions(c.env, householdId),
    todayGarden(c.env, householdId, c.get("householdCreatedAt"), now),
    noteDue(c.env, householdId, now),
  ]);
  const presets = Object.fromEntries(cats.map((c) => [c.id, FIXED.find((f) => f.key === c.key)!.presets]));
  const leafAt = garden.leafDay ? (fromDateInput(garden.leafDay) ?? now - DAY_MS) : null;
  const yesterdayAt = dayStart(now) - DAY_MS;
  return c.html(
    <Layout title="kop.it" tab="add" profileName={c.get("profileName")} profileIndex={c.get("profileIndex")} scripts={["/js/add.js", "/js/sky.js"]}>
      {/* The garden's live sky, as a band behind the header and the amount. */}
      <Sky night={isNight(now)} band label class="add-sky" />
      <section
        id="add"
        data-profile-id={String(c.get("profileId"))}
        data-notes={JSON.stringify(notes)}
        data-presets={JSON.stringify(presets)}
        data-day={garden.today}
        data-leaf={garden.leafDay ?? undefined}
        data-note={noteDay ?? undefined}
        data-wrapped={garden.wrappedMonth ?? undefined}
        data-week={garden.weekRecap ?? undefined}
      >
        <Amount />
        <CategoryPicker usual={usual} />
        <div class="note-row" data-spot="categories">
          <button type="button" class="note-toggle" id="note-toggle">
            ＋ note
          </button>
          <div class="note-box" id="note-box" hidden>
            <input id="note" maxlength={60} placeholder="What was it? (optional)" autocomplete="off" enterkeyhint="done" aria-label="Note" />
            <div class="suggest" id="suggest"></div>
          </div>
        </div>
        {/* One piece to the stylesheet: it stands beside the categories on a wide screen, and does nothing on a phone. */}
        <div class="pad-pane">
          <Keypad />
          <button class="save" id="save" type="button" data-spot="save" disabled>
            Save it ✓
          </button>
          <div class="sync" id="sync"></div>
          {/* Only where there is a keyboard (see .key-hint in app.css). */}
          <p class="key-hint" aria-hidden="true">
            Type the amount · <kbd>Enter</kbd> saves
          </p>
        </div>
      </section>
      {/* For a phone still running the add.js from before the fixed categories (loaded before an update): it looks these
          up when it starts and empties #more on every save. Never shown. Can go once phones have moved on. */}
      <span id="more" hidden></span>
      <dialog id="sheet" hidden>
        <div id="all"></div>
        <button id="close" type="button"></button>
        <form id="newcat"></form>
      </dialog>
      <CategorySheet cats={cats} />
      <dialog class="sheet bottom note-sheet" id="note-sheet" aria-labelledby="note-sheet-title" aria-describedby="note-sheet-desc">
        <div class="sheet-head">
          <h2 id="note-sheet-title" style="margin:0"></h2>
          <button class="x" type="button" id="note-close" aria-label="Close">
            ×
          </button>
        </div>
        <p class="sheet-desc" id="note-sheet-desc"></p>
        <div class="chips" id="note-chips"></div>
        <div class="other">
          <input id="note-other" maxlength={60} placeholder="Something else…" autocomplete="off" enterkeyhint="done" aria-label="Something else" />
          <button class="use" type="button" id="note-use" disabled>
            Use
          </button>
        </div>
        <button class="skip" type="button" id="note-skip"></button>
      </dialog>
      {/* The morning card: yesterday's leaf, its note (fetched into .dn-slot by /js/add.js), or both. Each part shows
          once per phone; the heading is the leaf's when there's one still to celebrate, the note's otherwise. */}
      {((garden.leafDay && leafAt !== null) || noteDay) && (
        <dialog class="sheet leaf-sheet" id="leaf-sheet" aria-labelledby={garden.leafDay ? "leaf-title" : "note-title"}>
          {garden.leafDay && leafAt !== null && (
            <div class="leaf-head">
              <Plant leaves={garden.leafNumber} newLeaf width={140} />
              <h2 id="leaf-title">{garden.perfect ? "A perfect day! 🌸" : "A new leaf! 🍃"}</h2>
              <p>
                {garden.perfect
                  ? "Every mission done yesterday"
                  : `You finished ${garden.leafDone} of ${garden.leafMissions} missions yesterday`}{" "}
                (<span class="nowrap">{weekdayDate(leafAt)}</span>). That's your {ordinal(garden.leafNumber)} leaf{" "}
                {garden.leafMonthIsCurrent ? "this month" : `in ${garden.leafMonth}`}.
              </p>
            </div>
          )}
          {noteDay && (
            <div class="note-head" hidden={!!garden.leafDay}>
              <h2 id="note-title">Yesterday, in a few words</h2>
              <p>
                <span class="nowrap">{weekdayDate(yesterdayAt)}</span>
                {garden.leafMissions > 0 && ` · ${garden.leafDone} of ${garden.leafMissions} missions`}
              </p>
            </div>
          )}
          {noteDay && (
            <div class="dn-slot" aria-live="polite">
              <NoteSkeleton full />
            </div>
          )}
          <form method="dialog">
            <button class="save" type="submit" data-leaf-label="Nice, thanks" data-note-label="Got it">
              {garden.leafDay ? "Nice, thanks" : "Got it"}
            </button>
          </form>
        </dialog>
      )}
      <Tour screen="add" profileId={c.get("profileId")} profileName={c.get("profileName")} seen={c.get("toursSeen")} />
      <Toast />
    </Layout>,
  );
});
