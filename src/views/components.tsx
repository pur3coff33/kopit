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
    <button type="button" class="cat" id={id} data-id={String(cat.id)} data-name={cat.name} data-emoji={cat.emoji} style={`--tint:${categoryColor(cat.id).tint}`}>
      <span class="e">{cat.emoji}</span>
      {cat.name}
    </button>
  );
}

export function CategoryTiles({ cats }: { cats: Cat[] }) {
  return (
    <div class="cats" id="tiles">
      {cats.map((cat) => (
        <Tile cat={cat} />
      ))}
      <button type="button" class="cat" id="more">
        <span class="e">✏️</span>More
      </button>
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
