import { Hono } from "hono";
import type { AppEnv } from "../env";
import { MIN_SPENDING_DAYS, type Ctx } from "../lib/aligned";
import { GENTLE, GENTLE_BY_TYPE, starters } from "../lib/gentle";
import { Back, TitleCard } from "../views/components";
import { Plant, Sky, type Weather } from "../views/garden";
import { Layout } from "../views/layout";

export const guide = new Hono<AppEnv>();

export const REPO_URL = "https://github.com/pur3coff33/kopit";

/** Every mission of the current set, with an example setting from a made-up household. */
function missionExamples() {
  return GENTLE.map((d) => ({ name: d.name, example: d.build(d.demo).title }));
}

/** What a household still new gets until it has enough days to try missions on: its very first day's. */
function starterExamples() {
  return starters(NEW_HOUSEHOLD).map((a) => GENTLE_BY_TYPE.get(a.type)!.build(a.params).title);
}

const NEW_HOUSEHOLD: Ctx = { days: [], cats: [], people: 1, day: 20_382, yesterday: [], lastWeek: [], weekBefore: 0 };

const STAGES = [
  { plant: <Plant leaves={0} width={84} />, title: "Sprout", text: "Every month starts as a sprout." },
  { plant: <Plant leaves={4} width={84} />, title: "A leaf a good day", text: "Meet at least half of a day's missions and the plant grows a leaf." },
  { plant: <Plant leaves={7} perfect={2} width={84} />, title: "Perfect days", text: "Meet all of them and that leaf gets a small pink flower." },
  { plant: <Plant leaves={11} perfect={3} bud width={84} />, title: "On track", text: "A dashed bud on top: the household is spending less than this time last month." },
  { plant: <Plant leaves={15} perfect={5} bloom width={84} />, title: "Bloom", text: "A month that ends lower than the one before blooms, and stays that way in the gallery." },
];

const SKIES: Array<{ night: boolean; weather: Weather; label: string }> = (["day", "night"] as const).flatMap((p) =>
  (["clear", "cloudy", "drizzle", "rain", "storm"] as const).map((w) => ({
    night: p === "night",
    weather: w,
    label: `${p === "day" ? "Day" : "Night"} · ${w[0].toUpperCase()}${w.slice(1)}`,
  })),
);

guide.get("/guide", (c) => {
  const missions = missionExamples();
  const starters = starterExamples();
  return c.html(
    <Layout title="Guide" roof="day">
      <Back href="/">Back to kop.it</Back>
      <TitleCard kicker="kop.it" place="How it works" title="The guide" />
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
          without signal. A category and a note are optional.
        </p>
        <p>
          Spending less grows a plant: a few small missions each day, leaves for good days, flowers for perfect ones. It only
          ever rewards, never scolds.
        </p>
        <p>Every week and month ends with a short recap. Replay any of them from History: a week's from its shelf, a month's from its sign.</p>
        <p>
          <a href="/?tour">Take the tour again</a>
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
        <p>
          This month's garden is the sky where you are right now: day or night, and the weather, with your town's name and
          the weather written across the top. The same sky shows at the top of the add screen and through History's glass
          roof, so all three turn to night or rain together.
        </p>
        <ul class="skies">
          {SKIES.map((s) => (
            <li>
              <Sky night={s.night} weather={s.weather} still>
                <Plant leaves={10} perfect={3} width={48} />
              </Sky>
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
        <p class="muted">
          The weather comes from <a href="https://open-meteo.com">Open-Meteo</a>, a free service built on national weather
          forecasts, every 30 minutes, and the town's name from <a href="https://www.bigdatacloud.com">BigDataCloud</a>. The
          phone asks for your location once and sends only a rounded one (about a kilometre). A light drizzle gets its own
          lighter sky, so a wet day doesn't look like a downpour. Say no, or have no signal, and the sky stays clear,
          follows the clock and names no town.
        </p>
      </section>

      <section class="card guide-sec" id="missions">
        <h2>Missions</h2>
        <p>
          Every day the household gets 3 missions: two easy, one medium. They're only ever about how much you spend, never
          about who buys or when to stop, and none of them asks for a day without spending. The amounts and categories come
          from your own last 28 days.
        </p>
        <p>
          Each one is tried on those days first. An <b>easy</b> mission is one you'd have met on about 9 of 10 of them, a{" "}
          <b>medium</b> one on about 6 of 10. So an ordinary day meets the easy ones, and only a heavier one than usual
          misses them. A mission only ever names a want (eating out, shopping, fun, gifts, vices), never a need, and a category is
          only ever skipped if it's one you buy now and then anyway.
        </p>
        <ul class="missions-list">
          {missions.map((m) => (
            <li>
              <b>{m.name}</b>
              <span class="muted">“{m.example}”</span>
            </li>
          ))}
        </ul>
        <p class="muted">The examples are from a made-up household; yours use your own numbers.</p>
        <h3>While your garden is new</h3>
        <p>
          Until the household has {MIN_SPENDING_DAYS} days with spending in its last 28, there's not enough to go on yet, so
          the missions are simple ones like these:
        </p>
        <ul class="missions-list">
          {starters.map((t) => (
            <li>
              <span class="muted">“{t}”</span>
            </li>
          ))}
        </ul>
        <p class="muted">
          Half of the day's missions met is a good day (a leaf). All of them is a perfect day (a flower). Spending nothing
          always meets every mission, but it's never needed. A day's missions don't change once the day has started. To
          look back at a day's missions, open History, tap that day's pot and tap the line in its receipt.
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
