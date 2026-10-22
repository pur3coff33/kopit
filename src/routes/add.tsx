import { Hono } from "hono";
import type { AppEnv } from "../env";
import { listCategories, topCategories } from "../lib/categories";
import { todayGarden } from "../lib/garden";
import { DAY_MS, fromDateInput, weekdayDate } from "../lib/time";
import { noteSuggestions } from "../lib/notes";
import { requireProfile, requireSession } from "../middleware/auth";
import { Amount, CategoryTiles, Keypad, Tile, Toast } from "../views/components";
import { Plant } from "../views/garden";
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
  const [top, all, notes, garden] = await Promise.all([
    topCategories(c.env, householdId),
    listCategories(c.env, householdId),
    noteSuggestions(c.env, householdId),
    todayGarden(c.env, householdId, c.get("householdCreatedAt"), now),
  ]);
  const leafAt = garden.leafDay ? (fromDateInput(garden.leafDay) ?? now - DAY_MS) : null;
  return c.html(
    <Layout title="kop.it" tab="add" profileName={c.get("profileName")} profileIndex={c.get("profileIndex")} scripts={["/js/add.js"]}>
      <section
        id="add"
        data-profile-id={String(c.get("profileId"))}
        data-notes={JSON.stringify(notes)}
        data-day={garden.today}
        data-leaf={garden.leafDay ?? undefined}
        data-wrapped={garden.wrappedMonth ?? undefined}
        style="display:flex;flex-direction:column;flex:1"
      >
        <Amount />
        <CategoryTiles cats={top} />
        <div class="note-row" data-spot="categories">
          <button type="button" class="note-toggle" id="note-toggle">
            ＋ note
          </button>
          <div class="note-box" id="note-box" hidden>
            <input id="note" maxlength={60} placeholder="What was it? (optional)" autocomplete="off" enterkeyhint="done" aria-label="Note" />
            <div class="suggest" id="suggest"></div>
          </div>
        </div>
        <Keypad />
        <button class="save" id="save" type="button" data-spot="save" disabled>
          Save it ✓
        </button>
        <div class="sync" id="sync"></div>
      </section>
      <dialog class="sheet" id="sheet">
        <div class="sheet-head">
          <h2 style="margin:0">All categories</h2>
          <button class="x" type="button" id="close" aria-label="Close">
            ×
          </button>
        </div>
        <div class="cats" id="all">
          {all.map((cat) => (
            <Tile cat={cat} />
          ))}
        </div>
        <form class="form inline" id="newcat">
          <label style="flex:0 0 64px">
            Emoji
            <input name="emoji" maxlength={8} placeholder="🏷️" autocomplete="off" />
          </label>
          <label>
            New category
            <input name="name" maxlength={24} required autocomplete="off" />
          </label>
          <button class="save" type="submit">
            Add
          </button>
        </form>
        <p class="muted" id="offline-note" hidden>
          Connect to the internet to add a category.
        </p>
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
      <Tour screen="add" profileId={c.get("profileId")} profileName={c.get("profileName")} seen={c.get("toursSeen")} />
      <Toast />
    </Layout>,
  );
});
