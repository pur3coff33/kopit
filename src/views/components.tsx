import type { Cat } from "../lib/categories";
import { categoryColor } from "../lib/colors";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];

export function Keypad() {
  return (
    <div class="keys" id="keys">
      {KEYS.map((k) => (
        <button type="button" data-key={k} aria-label={k === "back" ? "Delete" : k}>
          {k === "back" ? "⌫" : k}
        </button>
      ))}
    </div>
  );
}

export function Tile({ cat, id }: { cat: Cat; id?: string }) {
  return (
    <button type="button" class="cat" id={id} data-id={String(cat.id)} data-key={cat.key} data-name={cat.name} data-emoji={cat.emoji} style={`--tint:${categoryColor(cat.key).tint}`}>
      <span class="e">{cat.emoji}</span>
      {cat.name}
    </button>
  );
}

const GROUPS = [
  { group: "need", label: "Needs" },
  { group: "want", label: "Wants" },
] as const;

/** The ten tiles, always in the same places: needs on top, wants below. */
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

/** The eye by a total: hides the totals for this phone's person (or shows them again), then comes back to `back`. */
export function AmountsEye({ hidden, back }: { hidden: boolean; back: string }) {
  return (
    <form class="eye" method="post" action="/settings/amounts">
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
