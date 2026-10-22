import type { Child } from "hono/jsx";

/**
 * The first-time tours: a few stops on each screen, shown once per person the first time they open it. Each stop points
 * at the parts of the screen carrying its `data-spot` name (all of them, if several do); a stop without a spot dims the
 * whole screen, and a stop whose spot isn't on the screen right now (no expenses yet, say) is skipped.
 *
 * Moving, renaming or removing one of these parts of a screen means updating its stop here (see CONTRIBUTING.md).
 * test/tour.test.ts fails if a stop's spot is missing from its screen.
 */
export type TourStep = { spot: string | null; title: Child; text: Child };

export const TOUR_SCREENS = ["add", "garden", "history", "shed"] as const;
export type TourScreen = (typeof TOUR_SCREENS)[number];

export const isTourScreen = (v: unknown): v is TourScreen => TOUR_SCREENS.includes(v as TourScreen);

export function tourSteps(screen: TourScreen, profileName: string): TourStep[] {
  switch (screen) {
    case "add":
      return [
        {
          spot: null,
          title: `Hi ${profileName}! Welcome to kop.it 🌱`,
          text: "Log what your household spends in a few seconds, and watch a plant grow when you spend a little less. Each screen shows you around the first time you open it.",
        },
        { spot: "keypad", title: "Type what you spent", text: "The amount shows big at the top. Pesos, up to ₱1,000,000." },
        {
          spot: "categories",
          title: "Tap what it was for",
          text: (
            <>
              Optional. <b>More</b> has every category and lets you add your own. <b>＋ note</b> adds a word or two, like
              “Jollibee”.
            </>
          ),
        },
        {
          spot: "save",
          title: "Save it",
          text: (
            <>
              Works with no signal: it waits on this phone and sends itself later. Tapped by mistake? <b>Undo</b> shows for
              a few seconds.
            </>
          ),
        },
      ];
    case "garden":
      return [
        {
          spot: "garden",
          title: "Your garden",
          text: (
            <>
              This month's total, your pace against last month, and the plant. Good days grow leaves; a cheaper month
              blooms. <b>📖 Guide</b> explains it all.
            </>
          ),
        },
        {
          spot: "missions",
          title: "Today's missions",
          text: "Three small goals made from your own spending, checked as you log. Meet half and tomorrow brings a leaf; all of them, a flower.",
        },
        {
          spot: "eye",
          title: "Rather not see it?",
          text: "Tap the eye to hide the total, all but its first digit. Only for you, on any phone you use.",
        },
      ];
    case "history":
      return [
        {
          spot: "day",
          title: "Every expense, by day",
          text: "Newest first, from everyone. Tap one to fix or delete it. Quiet days get a leaf of their own.",
        },
        { spot: "day-result", title: "How each day went", text: "A day's missions fold under it. Tap the line to see which ones were met." },
        { spot: "people", title: "Just one person", text: "See only what one person logged. Tap Everyone to see the whole household again." },
      ];
    case "shed":
      return [
        {
          spot: "household",
          title: "Your household",
          text: (
            <>
              Add or rename people. <b>Switch</b> if this phone belongs to someone else now.
            </>
          ),
        },
        { spot: "pin", title: "Change the PIN", text: "Everyone logs in with the same 6-digit PIN. Changing it logs out the other phones." },
      ];
  }
}

/**
 * One screen's tour: the screen dims, the part each stop is about lights up, and a note beside it says what it does.
 * /js/tour.js moves the light and the note. Always in the page, so "Take the tour again" works even offline; `due`
 * opens it by itself, for a person who hasn't had it yet. The add screen's tour also lists the other screens (`then`),
 * so taking the tour again plays theirs next time they're opened.
 */
export function Tour(props: { screen: TourScreen; profileId: number; profileName: string; seen: string[] }) {
  const steps = tourSteps(props.screen, props.profileName);
  return (
    <dialog
      class="tour"
      id="tour"
      aria-labelledby={`tour-title-0`}
      data-screen={props.screen}
      data-profile-id={String(props.profileId)}
      data-due={props.seen.includes(props.screen) ? undefined : "1"}
      data-then={props.screen === "add" ? TOUR_SCREENS.filter((s) => s !== "add").join(",") : undefined}
    >
      <div class="tour-spot" aria-hidden="true"></div>
      <div class="tour-note">
        {steps.map((s, i) => (
          <section class="tour-step" data-step-spot={s.spot ?? undefined} hidden={i > 0}>
            <h2 id={`tour-title-${i}`}>{s.title}</h2>
            <p>{s.text}</p>
          </section>
        ))}
        <div class="tour-btns">
          <button class="tour-skip" type="button" data-skip>
            Skip tour
          </button>
          <button class="tour-back" type="button" data-back hidden>
            Back
          </button>
          <span class="tour-count" aria-hidden="true"></span>
          <button class="tour-next" type="button" data-next data-first="Show me" data-label="Next" data-last="Got it" autofocus>
            Next
          </button>
        </div>
      </div>
    </dialog>
  );
}
