import { Hono } from "hono";
import type { AppEnv } from "../env";
import { affirmation, monthGarden, monthName, type MonthGarden } from "../lib/garden";
import { addMonths, fromDateInput, monthStart } from "../lib/time";
import { requireProfile, requireSession } from "../middleware/auth";
import { Plant } from "../views/garden";
import { Layout } from "../views/layout";

export const wrapped = new Hono<AppEnv>();
wrapped.use("/wrapped/*", requireSession, requireProfile);

/** The start of the finished month "YYYY-MM" names, if it's a real month that ended after the household began. */
function finishedMonth(raw: string, createdAt: number, now: number): number | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return null;
  const start = fromDateInput(`${raw}-01`);
  if (start === null || start >= monthStart(now) || addMonths(start, 1) <= createdAt) return null;
  return start;
}

/** How much lower than the month before, in whole percent; null when it wasn't lower (then: an affirmation). */
function lowerBy(g: MonthGarden): number | null {
  if (g.prevTotal === null || g.prevTotal <= 0 || g.total >= g.prevTotal) return null;
  return Math.max(1, Math.round(((g.prevTotal - g.total) / g.prevTotal) * 100));
}

const year = (ms: number) => new Date(ms + 8 * 3_600_000).getUTCFullYear();

/** A month's recap as tap-through story slides, ending with its share picture. */
wrapped.get("/wrapped/:month", async (c) => {
  const now = Date.now();
  const month = c.req.param("month");
  const start = finishedMonth(month, c.get("householdCreatedAt"), now);
  if (start === null) return c.notFound();
  const g = await monthGarden(c.env, c.get("householdId"), start, c.get("householdCreatedAt"), now);
  const name = monthName(start);
  const pct = lowerBy(g);
  const slides = 4 + (g.topTitle ? 1 : 0);
  return c.html(
    <Layout title={`${name}, wrapped`} bare scripts={["/js/wrapped.js"]}>
      <div class="wrapped" data-month={month}>
        <div class="dots" aria-hidden="true">
          {Array.from({ length: slides }, () => (
            <i></i>
          ))}
        </div>
        <section class="slide">
          <div class="k">
            {name} {year(start)}
          </div>
          <h1>{name}, wrapped</h1>
          <Plant leaves={g.goodDays} perfect={g.perfectDays} bloom={g.bloomed} width={170} />
          <p class="tap">Tap to continue</p>
        </section>
        <section class="slide">
          <div class="big">{g.goodDays}</div>
          <p>good days in the garden</p>
          <p class="sub">
            {g.perfectDays} perfect day{g.perfectDays === 1 ? "" : "s"} · {g.missionsDone} missions done
          </p>
        </section>
        <section class="slide">
          {pct !== null ? (
            <>
              <div class="big">−{pct}%</div>
              <p>less than {monthName(addMonths(start, -1))}</p>
              {g.bloomed && <p class="sub">and the garden bloomed 🌸</p>}
            </>
          ) : (
            <p class="affirm">{affirmation(start)}</p>
          )}
        </section>
        {g.topTitle && (
          <section class="slide">
            <div class="big word">{g.topTitle}</div>
            <p>
              your most-beaten mission, {g.topCount} time{g.topCount === 1 ? "" : "s"}
            </p>
          </section>
        )}
        <section class="slide last">
          <img class="card" src={`/wrapped/${month}/card.svg`} width="216" height="384" alt={`${name}'s garden: ${g.goodDays} good days`} />
          <button class="save" type="button" id="share">
            Share
          </button>
          <a class="save plain" href="/">
            Done
          </a>
        </section>
      </div>
    </Layout>,
  );
});

/** Break text into lines of about `max` characters, on spaces. */
function lines(text: string, max: number): string[] {
  const out: string[] = [];
  for (const word of text.split(" ")) {
    const last = out.at(-1);
    if (last !== undefined && `${last} ${word}`.length <= max) out[out.length - 1] = `${last} ${word}`;
    else out.push(word);
  }
  return out;
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The share picture: a 1080×1920 story card. Never peso amounts or names. Nunito is embedded so it renders anywhere. */
wrapped.get("/wrapped/:month/card.svg", async (c) => {
  const now = Date.now();
  const month = c.req.param("month");
  const start = finishedMonth(month, c.get("householdCreatedAt"), now);
  if (start === null) return c.notFound();
  const [g, font] = await Promise.all([
    monthGarden(c.env, c.get("householdId"), start, c.get("householdCreatedAt"), now),
    c.env.ASSETS.fetch(new URL("/fonts/nunito-latin-wght-normal.woff2", c.req.url)).then((r) => (r.ok ? r.arrayBuffer() : null)),
  ]);
  const pct = lowerBy(g);
  const change =
    pct !== null
      ? `<text x="540" y="930" font-size="150">−${pct}%</text>` +
        `<text x="540" y="1010" class="s" font-size="46">less than ${escapeXml(monthName(addMonths(start, -1)))}</text>`
      : lines(affirmation(start), 26)
          .map((l, i) => `<text x="540" y="${880 + i * 62}" font-size="48">${escapeXml(l)}</text>`)
          .join("");
  const plant = String(<Plant leaves={g.goodDays} perfect={g.perfectDays} bloom={g.bloomed} width={480} />);
  const fontFace = font
    ? `@font-face { font-family: "Nunito"; font-weight: 200 1000; src: url(data:font/woff2;base64,${base64(font)}) format("woff2"); }`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
<defs>
  <style>
    ${fontFace}
    text { font-family: Nunito, sans-serif; text-anchor: middle; fill: #ffffff; font-weight: 900; }
    .s { fill: #d9ecd9; font-weight: 800; }
    .end { text-anchor: end; }
    .start { text-anchor: start; }
  </style>
  <linearGradient id="bg" x1="0" y1="0" x2="0.25" y2="1">
    <stop offset="0" stop-color="#1f3326"/><stop offset="0.7" stop-color="#3e7a4a"/><stop offset="1" stop-color="#7fb08c"/>
  </linearGradient>
</defs>
<rect width="1080" height="1920" fill="url(#bg)"/>
<text x="523" y="190" font-size="76" class="end">kop</text>
<ellipse cx="539" cy="172" rx="11" ry="17" fill="#b9e3a5" transform="rotate(30 539 172)"/>
<text x="555" y="190" font-size="76" class="start">it</text>
<text x="540" y="280" class="s" font-size="40" letter-spacing="8">${escapeXml(monthName(start).toUpperCase())} ${year(start)}</text>
<text x="540" y="560" font-size="250">${g.goodDays}</text>
<text x="540" y="650" class="s" font-size="50">good days in the garden</text>
<text x="540" y="725" class="s" font-size="40">✿ ${g.perfectDays} perfect · ${g.missionsDone} missions done</text>
${change}
<g transform="translate(300 1110)">${plant}</g>
<text x="540" y="1860" class="s" font-size="34">grown with kop.it</text>
</svg>`;
  return c.body(svg, 200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "private, max-age=300" });
});
