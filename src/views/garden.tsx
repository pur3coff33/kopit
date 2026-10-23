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

/** The log-in frame: big wordmark, tagline and the sprout under its glass dome. `small`: a smaller dome, when there's more to say under it. */
export function Welcome({ small }: { small?: boolean }) {
  return (
    <div class={small ? "welcome small" : "welcome"}>
      <Wordmark big />
      <p>your household's money garden</p>
      <div class="cloche">
        <Plant leaves={3} width={120} />
      </div>
    </div>
  );
}

/**
 * The greenhouse's glass roof: its sun and light, the frame, and motes in the air. `children` hang under the frame.
 * `sun={false}` when a live Sky behind the glass brings its own sun.
 */
export function RoofGlass({ children, sun = true }: { children?: Child; sun?: boolean }) {
  return (
    <>
      {sun && <span class="g-sun"></span>}
      {sun && <span class="g-rays"></span>}
      {children}
      <svg class="frame" viewBox="0 0 390 150" preserveAspectRatio="none">
        <path d="M0 120 Q 195 0 390 120" fill="rgba(255,255,255,.14)" stroke="rgba(255,255,255,.9)" stroke-width="5" />
        <path d="M97 66 V150 M195 50 V150 M293 66 V150" stroke="rgba(255,255,255,.8)" stroke-width="3" />
        <path d="M30 104 L70 140 M130 60 L180 110 M230 60 L280 110" stroke="rgba(255,255,255,.3)" stroke-width="6" stroke-linecap="round" />
      </svg>
      {[12, 30, 47, 63, 81, 92].map((x, k) => (
        <i class="g-mote" style={`left:${x}%;top:${40 + ((k * 17) % 50)}%;--dx:${(k % 2 ? 1 : -1) * (10 + k * 4)}px;animation-delay:-${k * 1.6}s`}></i>
      ))}
    </>
  );
}

export type Weather = "clear" | "cloudy" | "drizzle" | "rain" | "storm";

/**
 * The garden's daytime company, each showing in its weather (app.css): a bee and a butterfly when it's clear, a
 * dragonfly and a bird when it's cloudy, a grasshopper sheltering in drizzle and rain. A storm sends them all under cover;
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

// Where the stars, drops and fireflies sit, as [left %, top %] or [left %, height px]: fixed, so every page draws the same sky.
const STARS = [[6, 10], [14, 34], [22, 8], [31, 22], [40, 6], [47, 30], [58, 12], [66, 26], [73, 6], [82, 18], [90, 34], [52, 44]];
const DROPS = Array.from({ length: 24 }, (_, i) => [(i * 41 + 7) % 104 - 4, 9 + ((i * 7) % 8)]);
const FLIES = [[18, 52], [72, 34], [64, 70], [34, 76], [88, 58]];
// The stars that carry on above a sky that reaches up behind the header: [left %, how far up, as a share of the way to the top of the screen].
const UP_STARS = [[10, 0.9], [20, 0.5], [35, 0.75], [44, 0.2], [57, 0.88], [64, 0.4], [78, 0.65], [87, 0.3], [95, 0.82]];

/** A soft cloud; `kind` says from which weather it shows (app.css). `x`, `top`, `width`: where it rests (with less motion) and how big, in % of the sky. */
function Cloud(props: { kind: "clear" | "cloudy" | "wet"; x: number; top: number; width: number; drift: number; delay: number }) {
  return (
    <svg
      class={`cloud ${props.kind}`}
      viewBox="0 0 60 28"
      style={`--x:${props.x};top:${props.top}%;--w:${props.width};animation-duration:${props.drift}s;animation-delay:-${props.delay}s`}
    >
      <ellipse class="shade" cx="30" cy="22" rx="27" ry="6"></ellipse>
      <circle cx="18" cy="17" r="9"></circle>
      <circle cx="31" cy="12" r="12"></circle>
      <circle cx="44" cy="17" r="8"></circle>
      <rect x="10" y="16" width="42" height="8" rx="4"></rect>
    </svg>
  );
}

/**
 * Today's sky, holding whatever stands under it: on the garden, this month's whole card (plant and words); in the
 * guide, a small tile. Day or night comes from the Manila clock, then /js/sky.js swaps in the real weather and sunset
 * for where the phone is. Every layer is drawn; data-phase and data-weather pick what shows (app.css).
 * `label`: the line across the top naming the town and the weather, filled in by /js/sky.js once both are known.
 * `still`: a fixed sky for showing the looks (the guide); /js/sky.js leaves it alone.
 * `ask`: the one screen that may ask for the location (the garden). Elsewhere /js/sky.js keeps the sky up to date
 * from what the garden already knows.
 * `band`: just the sky, for a strip across the top of a screen: no hills, nothing living in it.
 * `lift`: a sky that doesn't start at the top of the screen but reaches up behind the header (the garden's, history's):
 * its stars carry on up there once /js/sky.js has measured how far.
 */
export function Sky(props: { night: boolean; weather?: Weather; still?: boolean; ask?: boolean; band?: boolean; lift?: boolean; label?: boolean; class?: string; children?: Child }) {
  return (
    <div
      class={props.class ? `sky ${props.class}` : "sky"}
      data-sky={props.still ? undefined : props.ask ? "ask" : ""}
      data-phase={props.night ? "night" : "day"}
      data-weather={props.weather ?? "clear"}
    >
      <div class="sky-back" aria-hidden="true">
        <span class="sun"></span>
        <span class="moon"></span>
        <span class="stars">
          {STARS.map(([x, y], i) => (
            <i class={i % 4 === 0 ? "big" : undefined} style={`left:${x}%;top:${y}%;animation-delay:-${(i * 0.7) % 3}s`}></i>
          ))}
          {props.lift &&
            UP_STARS.map(([x, up], i) => (
              <i class={i % 3 === 0 ? "up big" : "up"} style={`left:${x}%;top:calc(var(--above, 0px) * -${up});animation-delay:-${(i * 0.9) % 3}s`}></i>
            ))}
        </span>
        <Cloud kind="clear" x={58} top={8} width={16} drift={70} delay={20} />
        <Cloud kind="cloudy" x={6} top={24} width={11} drift={95} delay={60} />
        <Cloud kind="cloudy" x={34} top={14} width={18} drift={60} delay={38} />
        <Cloud kind="wet" x={70} top={2} width={14} drift={80} delay={8} />
        <Cloud kind="wet" x={18} top={30} width={20} drift={52} delay={30} />
        <svg class="bolt" viewBox="0 0 20 40">
          <path d="M12 0 L2 22 H9 L6 40 L18 14 H11 Z"></path>
        </svg>
        {!props.band && (
          <svg class="hills" viewBox="0 0 100 30" preserveAspectRatio="none">
            <path class="far" d="M0 18 Q 25 4 50 14 T 100 10 V30 H0Z"></path>
            <path class="near" d="M0 25 Q 30 15 62 22 T 100 20 V30 H0Z"></path>
          </svg>
        )}
        <span class="mist"></span>
        <span class="flash"></span>
      </div>
      {props.label && (
        <p class="sky-label" data-sky-label="" hidden>
          <span class="where"></span>
          <span class="rule" aria-hidden="true"></span>
          <span class="what"></span>
        </p>
      )}
      {props.children}
      <div class="sky-front" aria-hidden="true">
        <span class="rain">
          {DROPS.map(([x, h], i) => (
            <i class={i % 3 === 0 ? "d" : undefined} style={`left:${x}%;--h:${h}px;animation-delay:-${((i * 0.37) % 1).toFixed(2)}s`}></i>
          ))}
        </span>
        {!props.band && (
          <>
            <span class="splash">
              {[8, 24, 41, 57, 73, 90].map((x, i) => (
                <i style={`left:${x}%;animation-delay:-${(i * 0.19).toFixed(2)}s`}></i>
              ))}
            </span>
            <span class="fireflies">
              {FLIES.map(([x, y], i) => (
                <i style={`left:${x}%;top:${y}%;animation-delay:-${i * 1.1}s`}></i>
              ))}
            </span>
            <Critters />
          </>
        )}
      </div>
    </div>
  );
}
