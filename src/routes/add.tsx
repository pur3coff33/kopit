import { Hono } from "hono";
import type { AppEnv } from "../env";
import { FIXED, listCategories } from "../lib/categories";
import { todayGarden } from "../lib/garden";
import { DAY_MS, fromDateInput, weekdayDate } from "../lib/time";
import { noteSuggestions } from "../lib/notes";
import { requireProfile, requireSession } from "../middleware/auth";
import { Amount, CategoryTiles, Keypad, Toast } from "../views/components";
import { Plant } from "../views/garden";
import { Layout } from "../views/layout";

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
  const [cats, notes, garden] = await Promise.all([
    listCategories(c.env, householdId),
    noteSuggestions(c.env, householdId),
    todayGarden(c.env, householdId, c.get("householdCreatedAt"), now),
  ]);
  const presets = Object.fromEntries(cats.map((c) => [c.id, FIXED.find((f) => f.key === c.key)!.presets]));
  const leafAt = garden.leafDay ? (fromDateInput(garden.leafDay) ?? now - DAY_MS) : null;
  return c.html(
    <Layout title="kop.it" tab="add" profileName={c.get("profileName")} profileIndex={c.get("profileIndex")} scripts={["/js/add.js"]}>
      <section
        id="add"
        data-profile-id={String(c.get("profileId"))}
        data-notes={JSON.stringify(notes)}
        data-presets={JSON.stringify(presets)}
        data-day={garden.today}
        data-leaf={garden.leafDay ?? undefined}
        data-wrapped={garden.wrappedMonth ?? undefined}
        style="display:flex;flex-direction:column;flex:1"
      >
        <Amount />
        <CategoryTiles cats={cats} />
        <div class="note-row">
          <button type="button" class="note-toggle" id="note-toggle">
            ＋ note
          </button>
          <div class="note-box" id="note-box" hidden>
            <input id="note" maxlength={60} placeholder="What was it? (optional)" autocomplete="off" enterkeyhint="done" aria-label="Note" />
            <div class="suggest" id="suggest"></div>
          </div>
        </div>
        <Keypad />
        <button class="save" id="save" type="button" disabled>
          Save it ✓
        </button>
        <div class="sync" id="sync"></div>
      </section>
      <dialog class="sheet note-sheet" id="note-sheet" aria-labelledby="note-sheet-title">
        <div class="sheet-head">
          <h2 id="note-sheet-title" style="margin:0"></h2>
          <button class="x" type="button" id="note-close" aria-label="Close">
            ×
          </button>
        </div>
        <div class="chips" id="note-chips"></div>
        <input id="note-other" maxlength={60} placeholder="Something else…" autocomplete="off" enterkeyhint="done" aria-label="Something else" />
        <button class="linkbtn" type="button" id="note-skip"></button>
      </dialog>
      {garden.leafDay && leafAt !== null && (
        <dialog class="sheet leaf-sheet" id="leaf-sheet" aria-labelledby="leaf-title">
          <Plant leaves={garden.leafNumber} newLeaf width={140} />
          <h2 id="leaf-title">{garden.perfect ? "A perfect day! 🌸" : "A new leaf! 🍃"}</h2>
          <p>
            {garden.perfect
              ? "Every mission done yesterday"
              : `You finished ${garden.leafDone} of ${garden.leafMissions} missions yesterday`}{" "}
            (<span class="nowrap">{weekdayDate(leafAt)}</span>). That's your {ordinal(garden.leafNumber)} leaf{" "}
            {garden.leafMonthIsCurrent ? "this month" : `in ${garden.leafMonth}`}.
          </p>
          <form method="dialog">
            <button class="save" type="submit">
              Nice, thanks
            </button>
          </form>
        </dialog>
      )}
      <Toast />
    </Layout>,
  );
});
