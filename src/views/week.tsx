// A week's recap as story slides, in Wrapped's look (and played by its script). No share picture: it ends in Done.
import { formatPeso, maskPeso } from "../lib/money";
import { rangeLabel } from "../lib/time";
import { WEEK_MS, type WeekRecap } from "../lib/week";
import { Plant } from "./garden";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Oct 12 – 18". */
export const weekLabel = (start: number) => rangeLabel(start, start + WEEK_MS, start + WEEK_MS);

/** Against the week before: less is celebrated, more is said plainly, and never scolded. */
function compare(r: WeekRecap, peso: (c: number) => string): string | null {
  if (r.prevTotal === null) return null;
  if (r.total < r.prevTotal) return `↓ ${peso(r.prevTotal - r.total)} less than the week before 🌸`;
  if (r.total > r.prevTotal) return `${peso(r.total - r.prevTotal)} more than the week before. A new week is a fresh start 🌱`;
  return "The same as the week before";
}

/** The four slides. `done` is where Done goes; null when the slides are part of a longer story that ends elsewhere. */
export function WeekSlides({ r, hidden, done }: { r: WeekRecap; hidden: boolean; done: string | null }) {
  const peso = (c: number) => (hidden ? maskPeso(c) : formatPeso(c));
  const vs = compare(r, peso);
  const split = r.needs + r.wants;
  return (
    <>
      <section class="slide">
        <div class="k">{weekLabel(r.start)}</div>
        <h1>Your week</h1>
        <Plant leaves={r.goodDays} perfect={r.perfectDays} width={170} />
        <p class="tap">Tap to continue</p>
      </section>
      <section class="slide">
        <div class="big money">{peso(r.total)}</div>
        <p>spent this week, all of you</p>
        {vs && <p class="week-pill">{vs}</p>}
        <p class="sub">
          {plural(r.count, "expense")} · {plural(r.noSpendDays, "day")} with no spending
        </p>
      </section>
      <section class="slide week-where">
        <h2>Where it went</h2>
        {split > 0 ? (
          <>
            <div class="week-split" role="img" aria-label={`Needs ${Math.round((r.needs / split) * 100)} percent, wants ${Math.round((r.wants / split) * 100)} percent`}>
              <i class="n" style={`width:${(r.needs / split) * 100}%`}></i>
              <i class="w" style={`width:${(r.wants / split) * 100}%`}></i>
            </div>
            <div class="week-legend">
              <span>
                Needs <b>{peso(r.needs)}</b>
              </span>
              <span>
                Wants <b>{peso(r.wants)}</b>
              </span>
            </div>
            <div class="week-top">
              {r.top.map((t) => (
                <div class="row">
                  <span class="e">{t.emoji}</span>
                  <span class="n">
                    {t.name}
                    {t.notes.length > 0 && <small>{t.notes.join(", ")}</small>}
                  </span>
                  <b>{peso(t.total)}</b>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p class="sub">Nothing had a category this week.</p>
        )}
      </section>
      <section class={done === null ? "slide" : "slide last"}>
        <div class="big">{r.goodDays}</div>
        <p>good days in the garden</p>
        <p class="sub">
          {plural(r.perfectDays, "perfect day")} · {plural(r.missionsDone, "mission")} done
        </p>
        <div class="week-days" role="img" aria-label={`${plural(r.goodDays, "good day")}, ${plural(r.perfectDays, "perfect day")}, Monday to Sunday`}>
          {r.days.map((d, i) => (
            <span class={d}>
              <i>{d === "perfect" ? "🌸" : d === "good" ? "🍃" : ""}</i>
              {WEEKDAYS[i]}
            </span>
          ))}
        </div>
        {done !== null && (
          <a class="save" href={done}>
            Done
          </a>
        )}
      </section>
    </>
  );
}
