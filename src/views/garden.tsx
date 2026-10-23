// Drawings for the money garden: the kop.it wordmark, people's flowers and the plant. All decorative SVG;
// whatever they mean is always also said in text next to them.
import type { Child } from "hono/jsx";
import { flowerFor } from "../lib/colors";

const MAX_LEAVES = 20;
const LEAF_GREENS = ["#7FB08C", "#6AA279", "#8FC19B", "#9FD0AA"];

export function Wordmark(props: { big?: boolean }) {
  return (
    <span class={props.big ? "wm big" : "wm"} role="img" aria-label="kop.it">
      kop<i aria-hidden="true"></i>it
    </span>
  );
}

/** A person's flower with their initial in the middle. */
export function Avatar(props: { index: number; name: string; size?: number }) {
  const f = flowerFor(props.index);
  const initial = (Array.from(props.name.trim())[0] ?? "?").toUpperCase();
  const petals =
    f.shape === "round"
      ? [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
          const r = (a * Math.PI) / 180;
          return <circle cx={(30 + 16 * Math.cos(r)).toFixed(1)} cy={(30 + 16 * Math.sin(r)).toFixed(1)} r="9" />;
        })
      : [0, 90, 180, 270].map((a) => <ellipse cx="30" cy="15" rx="9" ry="12" transform={`rotate(${a} 30 30)`} />);
  return (
    <svg class="avatar" viewBox="0 0 60 60" width={props.size ?? 24} height={props.size ?? 24} aria-hidden="true">
      <g fill={f.petal}>{petals}</g>
      <circle cx="30" cy="30" r="12" fill={f.centre} />
      <text x="30" y="35" text-anchor="middle" font-size="14" font-weight="900" fill="#fff" font-family="Nunito, sans-serif">
        {initial}
      </text>
    </svg>
  );
}

/**
 * The household's plant in its pot: one leaf per good day (up to 20 drawn), alternating left and right up a stem
 * that grows with them. No leaves yet → a small sprout. `perfect`: that many leaves carry a small flower (perfect days).
 * `bud`: the month's flower is on track. `bloom`: the month bloomed.
 */
export function Plant(props: { leaves: number; perfect?: number; bud?: boolean; bloom?: boolean; newLeaf?: boolean; width?: number }) {
  const n = Math.max(0, Math.min(MAX_LEAVES, Math.floor(props.leaves)));
  const p = Math.max(0, Math.min(n, Math.floor(props.perfect ?? 0)));
  // Spread the perfect-day flowers evenly up the stem.
  const flowered = new Set(Array.from({ length: p }, (_, k) => Math.min(n - 1, Math.floor(((k + 0.5) * n) / p))));
  const base = 124; // where the stem leaves the pot
  const gap = n === 0 ? 0 : Math.min(12, 100 / n);
  const top = n === 0 ? 100 : Math.max(16, base - 14 - gap * n);
  const leaves = Array.from({ length: n }, (_, i) => {
    const y = base - 10 - gap * (i + 0.5);
    const left = i % 2 === 0;
    // Leaves get smaller as the plant gets fuller, and younger ones near the top are smaller still.
    const full = n > 10 ? Math.min(5, (n - 10) * 0.5) : 0;
    const size = 15 - full - Math.min(4, (i / Math.max(1, n)) * 4);
    const cls = props.newLeaf && i === n - 1 ? "leaf new" : "leaf";
    const cx = (left ? 60 - size + 1 : 60 + size - 1).toFixed(1);
    const cy = y.toFixed(1);
    // The tilt lives on a wrapping group: CSS transform-origin on the leaf itself (the grow-in) would wrap the
    // rotate attribute and swing the leaf off the stem.
    const tip = (left ? 60 - size * 2 + 2 : 60 + size * 2 - 2).toFixed(1);
    // Each leaf flutters from where it meets the stem (its inner end, after the ±28° tilt), on its own timing so
    // no two move together. Its perfect-day flower rides along.
    const pivotX = (left ? Number(cx) + size * 0.883 : Number(cx) - size * 0.883).toFixed(1);
    const pivotY = (y - size * 0.469).toFixed(1);
    const flutter = `transform-origin:${pivotX}px ${pivotY}px;animation-delay:-${((i * 0.73) % 3).toFixed(2)}s;animation-duration:${(2.6 + ((i * 0.41) % 1.4)).toFixed(2)}s`;
    return (
      <g class="flutter" style={flutter}>
        <g transform={`rotate(${left ? -28 : 28} ${cx} ${cy})`}>
          <ellipse class={cls} cx={cx} cy={cy} rx={size.toFixed(1)} ry={(size * 0.5).toFixed(1)} fill={LEAF_GREENS[i % LEAF_GREENS.length]} />
        </g>
        {flowered.has(i) && (
          <g class="pf" transform={`translate(${tip} ${(y - 5).toFixed(1)})`}>
            <g class="bob" style={`animation-delay:-${((i * 0.53) % 2).toFixed(2)}s`}>
              <circle r="4.2" fill="#F0A3B5" />
              <circle r="1.7" fill="#F2C94C" />
            </g>
          </g>
        )}
      </g>
    );
  });
  return (
    <svg class="plant" viewBox="0 0 120 150" width={props.width ?? 110} height={Math.round((props.width ?? 110) * 1.25)} aria-hidden="true">
      <path d="M40 148 L80 148 L75 128 L45 128 Z" fill="#C98B5E" />
      <rect x="42" y="122" width="36" height="8" rx="4" fill="#B07548" />
      {/* Everything above the pot sways gently from where the stem leaves it (see .sway in app.css). */}
      <g class="sway">
        <path d={`M60 ${base} C60 ${(base + top) / 2} 59 ${top + 10} 61 ${top}`} stroke="#3E7A4A" stroke-width="3" fill="none" stroke-linecap="round" />
        {n === 0 ? (
          <g class="sprout">
            <ellipse cx="52" cy="106" rx="8" ry="4" fill="#8FC19B" transform="rotate(-30 52 106)" />
            <ellipse cx="68" cy="102" rx="8" ry="4" fill="#7FB08C" transform="rotate(30 68 102)" />
          </g>
        ) : (
          leaves
        )}
        {props.bud && !props.bloom && <circle class="bud" cx="61" cy={top - 5} r="5" fill="none" stroke="#E98AA3" stroke-width="2" stroke-dasharray="3 3" />}
        {props.bloom && (
          <g class="flower" transform={`translate(61 ${top - 6})`}>
            <g class="petals" fill="#F0A3B5">
              <ellipse cx="0" cy="-7" rx="4.5" ry="6.5" />
              <ellipse cx="7" cy="0" rx="6.5" ry="4.5" />
              <ellipse cx="0" cy="7" rx="4.5" ry="6.5" />
              <ellipse cx="-7" cy="0" rx="6.5" ry="4.5" />
            </g>
            <circle r="4.5" fill="#F2C94C" />
          </g>
        )}
      </g>
    </svg>
  );
}

/** The log-in frame: big wordmark, tagline and the sprout under its glass dome. Log in and set up share it. */
export function Welcome() {
  return (
    <div class="welcome">
      <Wordmark big />
      <p>your household's money garden</p>
      <div class="cloche">
        <Plant leaves={3} width={120} />
      </div>
    </div>
  );
}

export type Weather = "clear" | "cloudy" | "rain" | "storm";

/**
 * Today's sky behind the live plant: day or night from the Manila clock, then /js/sky.js swaps in the real weather
 * and sunset for where the phone is. Every layer is drawn; data-phase and data-weather pick what shows (app.css).
 * `still`: a fixed sky for showing the looks (the guide); /js/sky.js leaves it alone.
 */
/**
 * The garden's daytime company, each showing in its weather (app.css): a bee and a butterfly when it's clear, a
 * dragonfly and a bird when it's cloudy, a grasshopper sheltering in the rain. A storm sends them all under cover;
 * at night the fireflies come out instead.
 */
function Critters() {
  return (
    <>
      <span class="critter bee">
        <svg viewBox="0 0 20 14">
          <g class="wings" fill="#fff" opacity="0.85">
            <ellipse cx="9" cy="4" rx="4" ry="3"></ellipse>
            <ellipse cx="13" cy="4" rx="3.5" ry="2.6"></ellipse>
          </g>
          <ellipse cx="10" cy="9" rx="7" ry="4.2" fill="#f2c230"></ellipse>
          <path d="M8 5.2v7.6M11.5 5v8" stroke="#2b2a26" stroke-width="1.6"></path>
          <circle cx="16.4" cy="8.4" r="2.4" fill="#2b2a26"></circle>
        </svg>
      </span>
      <span class="critter butterfly">
        <svg viewBox="0 0 20 16">
          <g class="wings">
            <path d="M10 8C6 1 1 2 2 7c.6 3 4 3 8 1z" fill="#f2a65a"></path>
            <path d="M10 8c4-7 9-6 8-1-.6 3-4 3-8 1z" fill="#f2a65a"></path>
            <path d="M10 8c-3 2-6 6-3 7 2 .6 3-3 3-7z" fill="#e88a6a"></path>
            <path d="M10 8c3 2 6 6 3 7-2 .6-3-3-3-7z" fill="#e88a6a"></path>
          </g>
          <path d="M10 4v9" stroke="#3b2f2a" stroke-width="1.2" stroke-linecap="round"></path>
        </svg>
      </span>
      <span class="critter dragonfly">
        <svg viewBox="0 0 24 12">
          <g class="wings" fill="#e6f6f9" opacity="0.9">
            <ellipse cx="8" cy="3.5" rx="5" ry="1.8" transform="rotate(-12 8 3.5)"></ellipse>
            <ellipse cx="8" cy="8.5" rx="5" ry="1.8" transform="rotate(12 8 8.5)"></ellipse>
            <ellipse cx="13" cy="3.8" rx="4.4" ry="1.6" transform="rotate(12 13 3.8)"></ellipse>
            <ellipse cx="13" cy="8.2" rx="4.4" ry="1.6" transform="rotate(-12 13 8.2)"></ellipse>
          </g>
          <path d="M3 6h17" stroke="#2f8f9d" stroke-width="1.6" stroke-linecap="round"></path>
          <circle cx="20.5" cy="6" r="1.8" fill="#2f8f9d"></circle>
        </svg>
      </span>
      <span class="critter bird">
        <svg viewBox="0 0 16 8">
          <path class="wings" d="M1 6c2-3 5-3 7 0 2-3 5-3 7 0" fill="none" stroke="#4a5e50" stroke-width="1.6" stroke-linecap="round"></path>
        </svg>
      </span>
      <span class="critter grasshopper">
        <svg viewBox="0 0 22 12">
          <path d="M4 7c3-3 10-3 14-1" stroke="#6aa84f" stroke-width="3.2" stroke-linecap="round" fill="none"></path>
          <circle cx="18.5" cy="5.8" r="2.2" fill="#6aa84f"></circle>
          <path d="M9 6l4-4 3 9" stroke="#4f8a3a" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>
          <path d="M14 8l-2 3M17 8l1 3" stroke="#4f8a3a" stroke-width="1.1" stroke-linecap="round"></path>
          <path d="M20 4l2-3" stroke="#4f8a3a" stroke-width="0.8" stroke-linecap="round"></path>
        </svg>
      </span>
    </>
  );
}

export function Sky(props: { night: boolean; weather?: Weather; still?: boolean; children?: Child }) {
  const drops = Array.from({ length: 10 }, () => <i></i>);
  return (
    <div class="sky" data-sky={props.still ? undefined : ""} data-phase={props.night ? "night" : "day"} data-weather={props.weather ?? "clear"}>
      <div class="sky-back" aria-hidden="true">
        <span class="sun"></span>
        <span class="moon"></span>
        <span class="stars">
          <i></i>
          <i></i>
          <i></i>
          <i></i>
          <i></i>
        </span>
        <span class="cloud c1"></span>
        <span class="cloud c2"></span>
        <span class="flash"></span>
      </div>
      {props.children}
      <div class="sky-front" aria-hidden="true">
        <span class="rain">{drops}</span>
        <span class="fireflies">
          <i></i>
          <i></i>
          <i></i>
        </span>
        <Critters />
      </div>
    </div>
  );
}
