import { Hono } from "hono";
import type { AppEnv } from "../env";
import { RULES, TEMPLATES, TYPE_NAMES, type Baseline } from "../lib/missions";
import { Plant, Sky, type Weather } from "../views/garden";
import { Layout } from "../views/layout";

export const guide = new Hono<AppEnv>();

export const REPO_URL = "https://github.com/pur3coff33/kopit";

/** A made-up household's last 28 days, so every mission can show a real-looking example. */
const DEMO: Baseline = {
  day: 20_382, // a Wednesday
  rules: RULES,
  historyDays: 28,
  usualDay: 80_000,
  usualCount: 3,
  bigBuy: 50_000,
  yesterdayTotal: 90_000,
  lastWeekTotal: 85_000,
  cats: [
    { cat: { id: 1, name: "Food", emoji: "🍜" }, daysWith: 26, usualOnDay: 15_000, buysOnDay: 1.6 },
    { cat: { id: 2, name: "Groceries", emoji: "🛒" }, daysWith: 12, usualOnDay: 40_000, buysOnDay: 1 },
    { cat: { id: 3, name: "Transport", emoji: "🚌" }, daysWith: 9, usualOnDay: 8_000, buysOnDay: 2 },
    { cat: { id: 4, name: "Shopping", emoji: "🛍️" }, daysWith: 5, usualOnDay: 120_000, buysOnDay: 1 },
  ],
};

function missionExamples(level: 1 | 2) {
  return TEMPLATES.filter((t) => t.level === level && (t.since ?? 1) <= RULES).map((t) => ({
    name: TYPE_NAMES[t.type],
    example: t.make(DEMO, () => 0)?.title,
  }));
}

const STAGES = [
  { plant: <Plant leaves={0} width={84} />, title: "Sprout", text: "Every month starts as a sprout." },
  { plant: <Plant leaves={4} width={84} />, title: "A leaf a good day", text: "Meet at least half of a day's missions and the plant grows a leaf." },
  { plant: <Plant leaves={7} perfect={2} width={84} />, title: "Perfect days", text: "Meet all of them and that leaf gets a small pink flower." },
  { plant: <Plant leaves={11} perfect={3} bud width={84} />, title: "On track", text: "A dashed bud on top: the household is spending less than this time last month." },
  { plant: <Plant leaves={15} perfect={5} bloom width={84} />, title: "Bloom", text: "A month that ends lower than the one before blooms, and stays that way in the gallery." },
];

const SKIES: Array<{ night: boolean; weather: Weather; label: string }> = (["day", "night"] as const).flatMap((p) =>
  (["clear", "cloudy", "rain", "storm"] as const).map((w) => ({
    night: p === "night",
    weather: w,
    label: `${p === "day" ? "Day" : "Night"} · ${w[0].toUpperCase()}${w.slice(1)}`,
  })),
);

guide.get("/guide", (c) => {
  const easy = missionExamples(1);
  const medium = missionExamples(2);
  return c.html(
    <Layout title="Guide">
      <p>
        <a href="/">‹ Back to kop.it</a>
      </p>
      <h1>The kop.it guide</h1>
      <nav class="chips toc" aria-label="On this page">
        <a class="chip" href="#plant">The plant</a>
        <a class="chip" href="#sky">The sky</a>
        <a class="chip" href="#missions">Missions</a>
        <a class="chip" href="#help">Help</a>
        <a class="chip" href="#legal">Legal</a>
      </nav>

      <section class="card guide-sec" id="about">
        <h2>What kop.it is</h2>
        <p>
          A small expense tracker for a household. Everyone logs what they spend from their own phone in a few seconds, even
          without signal, and the garden screen shows where the money went.
        </p>
        <p>
          Spending less grows a plant. Every day brings a few small missions, checked automatically from what you log. Good
          days grow leaves, perfect days grow flowers, and a cheaper month blooms. It only ever rewards, never scolds.
        </p>
      </section>

      <section class="card guide-sec" id="plant">
        <h2>How the plant grows</h2>
        <ul class="stages">
          {STAGES.map((s) => (
            <li>
              {s.plant}
              <b>{s.title}</b>
              <span class="muted">{s.text}</span>
            </li>
          ))}
        </ul>
        <p class="muted">
          Only finished days count: today's leaf shows up after midnight, and the add screen celebrates it the next morning.
          The plant is always the whole household's, whoever is picked on the garden screen.
        </p>
      </section>

      <section class="card guide-sec" id="sky">
        <h2>The sky</h2>
        <p>This month's plant stands under the sky where you are right now: day or night, and the weather.</p>
        <ul class="skies">
          {SKIES.map((s) => (
            <li>
              <Sky night={s.night} weather={s.weather} still>
                <Plant leaves={10} perfect={3} width={64} />
              </Sky>
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
        <p class="muted">
          The weather comes from <a href="https://open-meteo.com">Open-Meteo</a>, a free service built on national weather
          forecasts, every 30 minutes. The phone asks for your location once and sends only a rounded one (about a
          kilometre). Say no, or have no signal, and the sky stays clear and follows the clock.
        </p>
      </section>

      <section class="card guide-sec" id="missions">
        <h2>Missions</h2>
        <p>
          Every day the household gets 3 to 5 of these, at least two of them easy. Amounts come from your own last 28 days, so
          the examples below use a made-up household. Missions about amounts and categories start after about two weeks of
          expenses.
        </p>
        <h3>Easy</h3>
        <ul class="missions-list">
          {easy.map((m) => (
            <li>
              <b>{m.name}</b>
              {m.example && <span class="muted">“{m.example}”</span>}
            </li>
          ))}
        </ul>
        <h3>Medium</h3>
        <ul class="missions-list">
          {medium.map((m) => (
            <li>
              <b>{m.name}</b>
              {m.example && <span class="muted">“{m.example}”</span>}
            </li>
          ))}
        </ul>
        <p class="muted">
          Half of the day's missions met is a good day (a leaf). All of them is a perfect day (a flower). Spending nothing
          always meets every mission, but it's never needed. A day's missions don't change once the day has started.
        </p>
      </section>

      <section class="card guide-sec" id="help">
        <h2>Want to help, or found a problem?</h2>
        <p>
          kop.it is open source. Ideas, bug reports and fixes are welcome on GitHub.
        </p>
        <div class="chips">
          <a class="chip" href={`${REPO_URL}/issues`}>Report a problem or idea</a>
          <a class="chip" href={REPO_URL}>See the code</a>
        </div>
        <p class="muted">
          Found a security problem? Please report it <a href={`${REPO_URL}/security/advisories/new`}>privately</a> instead of
          in a public issue.
        </p>
      </section>

      <section class="card guide-sec" id="legal">
        <h2>Legal</h2>
        <ul class="plain-links">
          <li>
            <a href="/privacy">Privacy policy</a>
          </li>
          <li>
            <a href="/terms">Terms and conditions</a>
          </li>
          <li>
            <a href={`${REPO_URL}/blob/main/LICENSE`}>MIT License</a> (the code)
          </li>
        </ul>
      </section>
    </Layout>,
  );
});
