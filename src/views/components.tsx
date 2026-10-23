import { FIXED, type Cat } from "../lib/categories";
import { categoryColor } from "../lib/colors";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];

export function Keypad() {
  return (
    <div class="keys" id="keys" data-spot="keypad">
      {KEYS.map((k) => (
        <button type="button" data-key={k} aria-label={k === "back" ? "Delete" : k}>
          {k === "back" ? "⌫" : k}
        </button>
      ))}
    </div>
  );
}

const DESCRIPTION = new Map(FIXED.map((c) => [c.key, c.description]));

export function Tile({ cat, id }: { cat: Cat; id?: string }) {
  return (
    <button
      type="button"
      class="cat"
      id={id}
      data-id={String(cat.id)}
      data-key={cat.key}
      data-name={cat.name}
      data-emoji={cat.emoji}
      data-desc={DESCRIPTION.get(cat.key)}
      style={`--tint:${categoryColor(cat.key).tint}`}
    >
      <span class="e">{cat.emoji}</span>
      {cat.name}
    </button>
  );
}

/**
 * The add screen's category spot: one big button that opens the picker (CategorySheet), and the household's usual ones
 * as chips to pick straight away. The button shows what's picked.
 */
export function CategoryPicker({ usual }: { usual: Cat[] }) {
  return (
    <div class="picker" data-spot="categories">
      <button type="button" class="cat-pick" id="pick" aria-haspopup="dialog">
        <span class="e" id="pick-e" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="2"></rect>
            <rect x="14" y="3" width="7" height="7" rx="2"></rect>
            <rect x="3" y="14" width="7" height="7" rx="2"></rect>
            <rect x="14" y="14" width="7" height="7" rx="2"></rect>
          </svg>
        </span>
        <span class="t">
          <span id="pick-name">What was it for?</span>
          <span class="s" id="pick-sub">
            Optional · tap to pick a category
          </span>
        </span>
        <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6"></path>
        </svg>
      </button>
      <div class="cat-label">Your usual</div>
      <div class="usual" id="usual">
        {usual.map((cat) => (
          <Tile cat={cat} />
        ))}
      </div>
    </div>
  );
}

/** Every category as a big tile, needs then wants, in a sheet that slides up from the picker button. */
export function CategorySheet({ cats }: { cats: Cat[] }) {
  return (
    <dialog class="sheet bottom cat-sheet" id="cat-sheet" aria-labelledby="cat-sheet-title">
      <div class="sheet-head">
        <h2 id="cat-sheet-title" style="margin:0">
          What was it for?
        </h2>
        <button class="x" type="button" id="cat-close" aria-label="Close">
          ×
        </button>
      </div>
      <CategoryTiles cats={cats} />
      <button class="skip" type="button" id="cat-none">
        No category
      </button>
    </dialog>
  );
}

const GROUPS = [
  { group: "need", label: "Needs" },
  { group: "want", label: "Wants" },
] as const;

/** The category tiles, always in the same places: needs on top, wants below. */
export function CategoryTiles({ cats }: { cats: Cat[] }) {
  return (
    <div class="tiles" id="tiles">
      {GROUPS.map((g) => (
        <div class="cat-group">
          <div class="cat-label">{g.label}</div>
          <div class={`cats ${g.group}s`}>
            {cats
              .filter((c) => c.group === g.group)
              .map((cat) => (
                <Tile cat={cat} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Toast() {
  return (
    <div class="toast" id="toast" role="status" aria-live="polite">
      <span id="toast-text"></span>
      <button type="button" class="toast-undo" id="toast-undo" hidden>
        Undo
      </button>
    </div>
  );
}

export function Amount({ value = "0" }: { value?: string }) {
  return (
    <>
      <div class="amount">
        <span class="cur">₱</span>
        <span id="amt">{value}</span>
      </div>
      <div class="underline"></div>
    </>
  );
}

/**
 * A 6-digit PIN box, dotted out. Deliberately not a password field: Chrome checks typed passwords against leaked
 * ones, and nearly every 6-digit number is on that list, so it kept warning people. The cost is that password
 * managers don't save or fill the PIN; a login lasts a year, so it's rarely typed.
 */
export function PinInput({ name }: { name: string }) {
  return (
    <input
      class="pin"
      name={name}
      type="text"
      inputmode="numeric"
      autocomplete="off"
      autocapitalize="off"
      spellcheck={false}
      data-1p-ignore=""
      data-lpignore="true"
      pattern="\d{6}"
      maxlength={6}
      required
    />
  );
}

/** The eye by a total: hides the totals for this phone's person (or shows them again), then comes back to `back`. */
export function AmountsEye({ hidden, back }: { hidden: boolean; back: string }) {
  return (
    <form class="eye" method="post" action="/settings/amounts" data-spot="eye">
      <input type="hidden" name="hide" value={hidden ? "0" : "1"} />
      <input type="hidden" name="back" value={back} />
      <button type="submit" aria-label={hidden ? "Show total" : "Hide total"} title={hidden ? "Show total" : "Hide total"}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
          <circle cx="12" cy="12" r="3" />
          {hidden && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </form>
  );
}

/** The path and query of the screen on show, for an AmountsEye to come back to. */
export const herePath = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};
