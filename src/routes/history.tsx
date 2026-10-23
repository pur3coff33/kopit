import { Hono } from "hono";
import type { Child } from "hono/jsx";
import { and, desc, eq, gte, lt, min, sum } from "drizzle-orm";
import { getDb } from "../db/client";
import { categories, entries, profiles } from "../db/schema";
import type { AppEnv } from "../env";
import type { CategoryKey } from "../lib/categories";
import { categoryColor } from "../lib/colors";
import { dayResults, isGood, isPerfect, missionDays, monthGardens, monthKey, monthName, spentMonth, type DayMissions, type DayResult } from "../lib/garden";
import { formatPeso } from "../lib/money";
import { DAY_MS, MANILA_OFFSET_MS, addMonths, clockTime, dayKey, dayStart, fromDateInput, isNight, monthStart, toDateInput, weekStart } from "../lib/time";
import { WEEK_MS } from "../lib/week";
import { weekLabel } from "../views/week";
import { requireProfile, requireSession } from "../middleware/auth";
import { Hideable } from "../views/components";
import { RoofGlass, Sky } from "../views/garden";
import { Layout } from "../views/layout";
import { Tour } from "../views/tour";
import { householdProfiles } from "./setup";

export const history = new Hono<AppEnv>();

/** A day's missions in its receipt: a one-line summary that opens into the list. The household's, so Everyone only. */
function DayMissionsLine({ m, today }: { m: DayMissions; today: boolean }) {
  const n = m.items.length;
  if (n === 0) return null;
  const icon = today ? "🌱" : m.done === n ? "🌸" : m.done * 2 >= n ? "🍃" : "·";
  const summary = today ? `${m.done} of ${n} missions on track so far` : `${m.done} of ${n} missions met`;
  return (
    <details class="missions day-missions">
      <summary>
        <span aria-hidden="true">{icon}</span> {summary}
      </summary>
      <ul>
        {m.items.map((i) => (
          <li class={`m ${i.ok ? (today ? "track" : "met") : "missed"}`}>
            <span class="st" aria-hidden="true">
              {i.ok ? (today ? "" : "✓") : "–"}
            </span>
            <span class="t">
              {i.title}
              <small>
                <span class="sr">{i.ok ? (today ? "On track: " : "Met: ") : "Not met: "}</span>
                {i.note}
              </small>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

history.use("/history", requireSession, requireProfile);

/** How many weeks (shelves) each batch of history loads. */
export const HISTORY_WEEKS = 4;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** "Today", "Yesterday", "Mon, Oct 12", or with the year when it isn't this year. */
export function dayHeading(ms: number, now: number): string {
  const diff = dayKey(now) - dayKey(ms);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const [y, m, d] = toDateInput(ms).split("-").map(Number);
  const weekday = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const label = `${weekday}, ${MONTHS[m - 1]} ${d}`;
  return y === Number(toDateInput(now).slice(0, 4)) ? label : `${label}, ${y}`;
}

const startOf = (day: number) => day * DAY_MS - MANILA_OFFSET_MS;

/**
 * The weeks (Monday starts, newest first) a batch shows: from this week, or the one above `before` (the Monday where
 * the last batch stopped), down to the week of `floor` (the household's first day, or an older back-dated expense).
 */
export function historyWeeks(before: number | null, floor: number, now: number, n = HISTORY_WEEKS): { weeks: number[]; more: boolean } {
  const bottom = weekStart(floor);
  const weeks: number[] = [];
  for (let w = before === null ? weekStart(now) : before - WEEK_MS; w >= bottom && weeks.length < n; w -= WEEK_MS) weeks.push(w);
  const last = weeks.at(-1);
  return { weeks, more: last !== undefined && last - WEEK_MS >= bottom };
}

/** The month a week's shelf sits under: where it ends, or this month while it's this week. */
export function shelfMonth(week: number, now: number): number {
  return monthStart(Math.min(week + 6 * DAY_MS, now));
}

export type PotKind = "none" | "today" | "quiet" | "perfect" | "good" | "missed" | "plain";

/**
 * How a day's pot looks. An empty pot for days still to come or before the garden began; today still growing; a
 * butterfly on a sprout when nothing was spent; otherwise the household's day: flowering when every mission was met,
 * leafy when at least half were, droopy when fewer, and plain when it has no result.
 */
export function potKind(day: number, today: number, firstDay: number, spent: boolean, r: DayResult | undefined): PotKind {
  if (day > today) return "none";
  if (day === today) return "today";
  if (!spent) return day < firstDay ? "none" : "quiet";
  if (!r || r.missions === 0) return "plain";
  return isPerfect(r) ? "perfect" : isGood(r) ? "good" : "missed";
}

/** A day's potted plant; app.css drops it onto its shelf and grows it in, part by part, from its place `--d`. */
function PotPlant({ kind }: { kind: PotKind }) {
  const pot = (
    <>
      <path d="M12 50 L28 50 L30.5 37 L9.5 37 Z" fill="#C98B5E" />
      <rect x="8.5" y="34" width="23" height="5" rx="2.5" fill="#B07548" />
    </>
  );
  if (kind === "none") {
    return (
      <svg viewBox="0 0 40 52" aria-hidden="true">
        {pot}
        <ellipse cx="20" cy="35" rx="9" ry="1.6" fill="#7a5233" opacity=".5" />
      </svg>
    );
  }
  let n = 0;
  const leaf = (x: number, y: number, r: number, color = "#7FB08C", s = 5.5) => (
    <g class="lf" style={`transition-delay:calc(var(--d) + ${(0.9 + 0.16 * n++).toFixed(2)}s)`}>
      <ellipse cx={x} cy={y} rx={s} ry={(s / 2.1).toFixed(2)} fill={color} transform={`rotate(${r} ${x} ${y})`} />
    </g>
  );
  const stem = (h: number) => (
    <path class="stem" pathLength="1" d={`M20 35 C20 ${35 - h / 2} 19.5 ${35 - h + 4} 20.5 ${35 - h}`} stroke="#3E7A4A" stroke-width="2" fill="none" stroke-linecap="round" />
  );
  const body =
    kind === "today" ? (
      <>
        <circle class="glow" cx="20" cy="24" r="17" fill="#fff6c9" />
        {stem(16)}
        {leaf(15, 28, -30, "#8FC19B")}
        {leaf(25, 25, 30, "#9FD0AA", 4.5)}
        <circle cx="20.5" cy="15" r="3.4" fill="none" stroke="#E98AA3" stroke-width="1.4" stroke-dasharray="2 2" />
      </>
    ) : kind === "good" || kind === "perfect" ? (
      <>
        {stem(kind === "perfect" ? 25 : 24)}
        {leaf(14.5, 29, -30)}
        {leaf(25.5, 25, 30, "#6AA279")}
        {leaf(15, 19.5, -30, "#8FC19B", 5)}
        {kind === "good" && leaf(25, 15, 30, "#9FD0AA", 4.2)}
        {kind === "perfect" && (
          <>
            <g class="fl">
              <g transform="translate(20.5 8.5)" fill="#F0A3B5">
                <ellipse cy="-4" rx="2.6" ry="3.8" />
                <ellipse cx="4" rx="3.8" ry="2.6" />
                <ellipse cy="4" rx="2.6" ry="3.8" />
                <ellipse cx="-4" rx="3.8" ry="2.6" />
                <circle r="2.4" fill="#F2C94C" />
              </g>
            </g>
            <path class="spark" d="M32 4l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z" fill="#F2C94C" />
          </>
        )}
      </>
    ) : kind === "missed" ? (
      <>
        <path class="stem" pathLength="1" d="M20 35 C20 28 22 24 28 23" stroke="#6f8a55" stroke-width="2" fill="none" stroke-linecap="round" />
        {leaf(18, 28, 60, "#C9B07A", 4.6)}
        {leaf(26, 26.5, 75, "#B89A62", 4.2)}
        {leaf(31, 33, 10, "#B89A62", 3.4)}
      </>
    ) : kind === "plain" ? (
      <>
        {stem(18)}
        {leaf(15, 28, -30)}
        {leaf(25, 24, 30, "#8FC19B", 5)}
      </>
    ) : (
      <>
        {stem(7)}
        {leaf(16.5, 29, -30, "#8FC19B", 4)}
        {leaf(24, 28, 30, "#9FD0AA", 4)}
        <g class="bf">
          <g transform="translate(30 19)">
            <path d="M0 0C-3-5-7-4-6.5-1c.4 2 3 2 6.5 1zM0 0c3-5 7-4 6.5-1-.4 2-3 2-6.5 1z" fill="#f2a65a" />
            <path d="M0 0c-2 1.5-4 4-2 5 1.5.4 2-2 2-5zM0 0c2 1.5 4 4 2 5-1.5.4-2-2-2-5z" fill="#e88a6a" />
          </g>
        </g>
      </>
    );
  return (
    <svg viewBox="0 0 40 52" aria-hidden="true">
      {pot}
      <g class="sway">{body}</g>
    </svg>
  );
}

const CAN = (
  <svg viewBox="0 0 24 18" aria-hidden="true">
    <path d="M6 6h11v10H6z" fill="#cfe9f5" />
    <path d="M6 8 L1 4" stroke="#cfe9f5" stroke-width="2.2" stroke-linecap="round" />
    <path d="M17 8c4 0 4 6 0 6" stroke="#cfe9f5" stroke-width="1.8" fill="none" />
  </svg>
);

const VINE = (side: "left" | "right") => (
  <svg class={`g-vine ${side}`} viewBox="0 0 40 110" aria-hidden="true">
    <path d="M20 0 C 16 36 24 72 20 104" stroke="#4f8a3a" stroke-width="1.6" fill="none" />
    {[0, 1, 2, 3, 4, 5, 6].map((j) => (
      <ellipse cx={j % 2 ? 26 : 14} cy={10 + j * 14} rx="7" ry="3.4" fill={["#6AA279", "#7FB08C", "#8FC19B"][j % 3]} transform={`rotate(${j % 2 ? 30 : -30} ${j % 2 ? 26 : 14} ${10 + j * 14})`} />
    ))}
  </svg>
);

type Row = { id: string; amount: number; note: string | null; spentAt: number; who: string; key: string | null; category: string | null; emoji: string | null };

/** One expense in a receipt; `back` makes it a link to fix or delete it (none in the tour's example). */
function ExpenseRow({ r, i, back }: { r: Row; i: number; back?: string }) {
  const what = r.category ?? "No category";
  return (
    <li style={`--i:${i}`}>
      <a class="row" href={back && `/entries/${r.id}/edit?back=${back}`} style={`--tint:${categoryColor(r.key as CategoryKey | null).tint}`}>
        <span class="ic">{r.emoji ?? "·"}</span>
        <span class="mid">
          <span class="nm">
            <span>{r.note ?? what}</span>
            <span>{formatPeso(r.amount)}</span>
          </span>
          <span class="sub">{[r.note ? what : null, r.who, clockTime(r.spentAt)].filter(Boolean).join(" · ")}</span>
        </span>
      </a>
    </li>
  );
}

type Day = { day: number; kind: PotKind; rows: Row[]; total: number; missions?: DayMissions; big?: boolean };

/** A week's shelf: seven pots with their price tags, and under it the receipt of the day that's open. */
function Shelf(props: {
  week: number;
  days: Day[];
  now: number;
  label: string;
  sub: string;
  lights: boolean;
  recap?: { total: number };
  open: number | null;
  nothing: string;
  back?: string;
  /** Where the tour points: this week's pots, and the open receipt. */
  spot?: boolean;
}) {
  const { week, days, now, open } = props;
  const headings = days.map((d) => dayHeading(startOf(d.day), now));
  // Pots and their tags build in left to right, a beat apart.
  const delay = (k: number) => `--d:${(0.25 + k * 0.09).toFixed(2)}s`;
  const pots = days.map((d, k) => {
    const said = d.kind === "none" ? "" : d.rows.length ? formatPeso(d.total) : props.nothing;
    return (
      <button
        type="button"
        class={`g-pot ${d.kind}${k === open ? " sel" : ""}`}
        data-k={k}
        style={delay(k)}
        disabled={d.kind === "none"}
        aria-pressed={d.kind === "none" ? undefined : k === open ? "true" : "false"}
        aria-label={d.kind === "none" ? undefined : `${headings[k]}: ${said}`}
      >
        <PotPlant kind={d.kind} />
        <span class="puff"></span>
      </button>
    );
  });
  return (
    <div class="g-shelf" data-week={toDateInput(week)}>
      <div class="g-sh">
        <span class="lbl">
          {props.label}
          <small>{props.sub}</small>
        </span>
        {props.recap && (
          <a class="g-can" href={`/week/${toDateInput(week)}?from=history`} aria-label={`Week of ${weekLabel(week)}: replay your week's recap`}>
            {CAN}
            <span class="drops" aria-hidden="true">
              <i></i>
              <i></i>
              <i></i>
            </span>
            ▶ {formatPeso(props.recap.total)}
          </a>
        )}
      </div>
      {props.lights && (
        <div class="g-lights" aria-hidden="true">
          {Array.from({ length: 11 }, (_, k) => (
            <i style={`left:${((k / 10) * 96 + 1).toFixed(1)}%;top:${(Math.sin((Math.PI * k) / 10) * 12).toFixed(1)}px;animation-delay:-${((k * 0.37) % 1.6).toFixed(2)}s`}></i>
          ))}
        </div>
      )}
      <div class="g-pots" data-spot={props.spot ? "day-result" : undefined}>
        {pots}
      </div>
      <div class="g-plank"></div>
      <div class="g-tags" aria-hidden="true">
        {days.map((d, k) => (
          <div class={`g-tag ${d.kind === "none" ? "f" : d.kind === "today" ? "today" : !d.rows.length ? "q" : ""}`} style={delay(k)}>
            <i>
              {LETTERS[k]} {Number(toDateInput(startOf(d.day)).slice(8))}
            </i>
            <b>{d.kind === "none" ? "·" : d.rows.length ? formatPeso(Math.round(d.total / 100) * 100) : d.kind === "quiet" ? "🦋" : "₱0"}</b>
          </div>
        ))}
      </div>
      <div class={open === null ? "g-drawer" : "g-drawer open"}>
        <div>
          {days.map((d, k) =>
            d.kind === "none" ? null : (
              <div class="g-receipt" data-k={k} hidden={k !== open} style={`--x:${(((k + 0.5) / 7) * 100).toFixed(1)}%`} data-spot={props.spot && k === open ? "day" : undefined}>
                <div class="sh">
                  <b>{headings[k]}</b>
                  <span>{formatPeso(d.total)}</span>
                </div>
                {d.big && <p class="sm">📈 Biggest day this week</p>}
                {d.missions && <DayMissionsLine m={d.missions} today={d.kind === "today"} />}
                {d.rows.length ? (
                  <ul class="rows">
                    {d.rows.map((r, i) => (
                      <ExpenseRow r={r} i={i} back={props.back} />
                    ))}
                  </ul>
                ) : (
                  <p class="quiet-day">{d.kind === "today" ? "Nothing logged yet today." : `🦋 ${props.nothing}, a quiet day`}</p>
                )}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/** A month's sign, hanging above its shelves: its chapter in the household's story, its total, and its Wrapped once over. */
function Chapter(props: { start: number; chapter: number; stats: Child; wrapped: boolean }) {
  return (
    <div class="g-chapter">
      <div class="board">
        {props.chapter > 0 && <div class="k">Chapter {props.chapter}</div>}
        <h2 class="m">{monthName(props.start)}</h2>
        <div class="s">{props.stats}</div>
        {props.wrapped && (
          <a class="g-wrap" href={`/wrapped/${monthKey(props.start)}?from=history`}>
            ▶ {monthName(props.start)}, wrapped
          </a>
        )}
      </div>
    </div>
  );
}

/** The glass house the shelves stand in (decorative), its roof the garden's own live sky: the same weather, day or night. */
function Greenhouse({ children, night }: { children: Child; night: boolean }) {
  return (
    <div class="greenhouse">
      <div class="g-far" aria-hidden="true">
        {Array.from({ length: 12 }, (_, k) => (
          <i class="g-drip" style={`left:${[24, 49, 74][k % 3]}%;top:${(k * 8.3 + 3).toFixed(1)}%;animation-delay:-${((k * 1.7) % 9).toFixed(1)}s;animation-duration:${(6 + (k % 4) * 1.5).toFixed(1)}s`}></i>
        ))}
      </div>
      <div class="g-roof" aria-hidden="true">
        <Sky night={night} band lift label class="roof-sky" />
        <RoofGlass sun={false}>
          {VINE("left")}
          {VINE("right")}
        </RoofGlass>
      </div>
      {children}
      <div class="g-bed" aria-hidden="true">
        <svg viewBox="0 0 400 30" preserveAspectRatio="none">
          {Array.from({ length: 40 }, (_, k) => {
            const x = k * 10 + 4;
            const h = 8 + ((k * 7) % 9);
            return <path d={`M${x} 30 C${x - 2} ${30 - h / 2} ${x - 4} ${30 - h} ${x - 5} ${28 - h} M${x} 30 C${x + 1} ${30 - h / 2} ${x + 3} ${28 - h} ${x + 5} ${26 - h}`} />;
          })}
          {[30, 110, 190, 270, 350].map((x, k) => (
            <circle cx={x + (k % 2) * 14} cy={14 + (k % 3) * 2} r="3" class={k % 2 ? "pink" : "gold"} />
          ))}
        </svg>
      </div>
    </div>
  );
}

/**
 * A made-up week for the tour of an empty History (/js/tour.js puts it in place of "Nothing logged yet" while the tour
 * plays), so its stops have something to point at. Labelled Example, and never a link.
 */
function HistorySample({ name, now }: { name: string; now: number }) {
  const today = dayKey(now);
  const week = weekStart(now);
  const at = (h: number, m: number) => dayStart(now) + h * 3_600_000 + m * 60_000;
  const rows: Row[] = [
    { id: "a", emoji: "🍱", note: "Office lunch", category: "Meals", amount: 15_000, key: "meals", at: at(12, 10) },
    { id: "b", emoji: "🚌", note: "Jeepney", category: "Transport", amount: 2_600, key: "transport", at: at(7, 45) },
    { id: "c", emoji: "🛒", note: "Wet market", category: "Groceries", amount: 30_000, key: "groceries", at: at(6, 30) },
  ].map((r) => ({ ...r, who: name, spentAt: r.at }));
  const missions: DayMissions = {
    done: 2,
    items: [
      { title: "Keep today under ₱1,500", level: 1, ok: true, note: "₱476 so far" },
      { title: "At most 6 buys today", level: 1, ok: true, note: "3 buys" },
      { title: "No eating out today", level: 2, ok: false, note: "none yet" },
    ],
  };
  const looks: PotKind[] = ["good", "perfect", "quiet", "good", "missed", "good", "plain"];
  const days: Day[] = Array.from({ length: 7 }, (_, k) => {
    const day = dayKey(week) + k;
    const kind = day > today ? "none" : day === today ? "today" : looks[k];
    const mine = day === today ? rows : kind === "quiet" ? [] : [{ ...rows[0], spentAt: startOf(day) + 12 * 3_600_000 }];
    return { day, kind, rows: mine, total: mine.reduce((s, r) => s + r.amount, 0), missions: day === today ? missions : undefined };
  });
  return (
    <template data-tour-sample="#history-empty">
      <div class="tour-sample">
        <span class="pill tour-example">Example</span>
        <div class="g-house sample">
          <Shelf week={week} days={days} now={now} label={`This week · ${weekLabel(week)}`} sub="still growing" lights={false} open={today - dayKey(week)} nothing="nothing spent" spot />
        </div>
      </div>
    </template>
  );
}

/** `before=2026-10-12`: show the weeks before that Monday. */
function parseBefore(raw: string | undefined): number | null {
  const ms = raw ? fromDateInput(raw) : null;
  return ms === null || weekStart(ms) !== ms ? null : ms;
}

history.get("/history", async (c) => {
  const householdId = c.get("householdId");
  const createdAt = c.get("householdCreatedAt");
  const now = Date.now();
  const today = dayKey(now);
  const people = await householdProfiles(c.env, householdId);
  const rawWho = c.req.query("who") ?? "all";
  const who = people.find((p) => String(p.id) === rawWho)?.id ?? "all";
  const whoName = people.find((p) => p.id === who)?.name;
  const everyone = who === "all";
  const before = parseBefore(c.req.query("before"));

  const db = getDb(c.env);
  const scope = and(eq(entries.householdId, householdId), everyone ? undefined : eq(entries.profileId, who));
  const [first] = await db.select({ t: min(entries.spentAt) }).from(entries).where(scope);
  const oldest = first?.t ?? null;
  const chips = (
    <div class="chips" data-spot="people">
      <a class={everyone ? "chip on" : "chip"} href="/history?who=all">
        Everyone
      </a>
      {people.map((p) => (
        <a class={who === p.id ? "chip on" : "chip"} href={`/history?who=${p.id}`}>
          {p.name}
        </a>
      ))}
    </div>
  );
  const page = (body: Child) => (
    <Layout title="History" tab="history" profileName={c.get("profileName")} profileIndex={c.get("profileIndex")} scripts={["/js/history.js", "/js/sky.js", "/js/tour-page.js"]}>
      {chips}
      {body}
      <Tour screen="history" profileId={c.get("profileId")} profileName={c.get("profileName")} seen={c.get("toursSeen")} />
    </Layout>
  );
  if (oldest === null && before === null) {
    return c.html(
      page(
        <>
          <p class="muted" id="history-empty" style="margin-top:18px">
            Nothing logged yet.
          </p>
          <HistorySample name={c.get("profileName")} now={now} />
        </>,
      ),
    );
  }

  const firstDay = dayKey(createdAt);
  const { weeks, more } = historyWeeks(before, Math.min(createdAt, oldest ?? createdAt), now);
  const from = weeks.at(-1) ?? weekStart(now);
  const to = (weeks[0] ?? from) + WEEK_MS;
  const rows = await db
    .select({
      id: entries.id,
      amount: entries.amountCentavos,
      note: entries.note,
      spentAt: entries.spentAt,
      who: profiles.name,
      key: categories.key,
      category: categories.name,
      emoji: categories.emoji,
    })
    .from(entries)
    .innerJoin(profiles, eq(profiles.id, entries.profileId))
    .leftJoin(categories, eq(categories.id, entries.categoryId))
    .where(and(scope, gte(entries.spentAt, from), lt(entries.spentAt, to)))
    .orderBy(desc(entries.spentAt), desc(entries.id));
  const byDay = new Map<number, Row[]>();
  for (const r of rows) {
    const k = dayKey(r.spentAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(r);
  }
  // The plants are the household's garden whoever is picked; the missions behind them show for Everyone only.
  const months = [...new Set(weeks.map((w) => shelfMonth(w, now)))].sort((a, b) => a - b);
  // One day-results lookup covers both the shelves and, for Everyone, the month signs above them.
  const lastDay = Math.max(to, months.length ? addMonths(months[months.length - 1], 1) : to);
  const days = dayResults(c.env, householdId, createdAt, dayKey(Math.min(from, months[0] ?? from)), dayKey(lastDay), now);
  const [results, missions, gardens, mine] = await Promise.all([
    days,
    everyone ? missionDays(c.env, householdId, createdAt, [...byDay.keys()], now) : Promise.resolve(null),
    everyone ? monthGardens(c.env, householdId, createdAt, now, months, days) : Promise.resolve([]),
    everyone || months.length === 0
      ? Promise.resolve([])
      : db
          .select({ month: spentMonth, total: sum(entries.amountCentavos) })
          .from(entries)
          .where(and(scope, gte(entries.spentAt, months[0]), lt(entries.spentAt, addMonths(months[months.length - 1], 1))))
          .groupBy(spentMonth),
  ]);
  const hidden = c.get("hideAmounts");
  const monthStats = (m: number): Child => {
    const so = m === monthStart(now) ? " so far" : "";
    if (everyone) {
      const g = gardens.find((x) => x.start === m)!;
      return (
        <>
          <Hideable centavos={g.total} hidden={hidden} />
          {so} · {g.goodDays} 🍃 · {g.perfectDays} 🌸
        </>
      );
    }
    const total = Number(mine.find((x) => x.month === monthKey(m))?.total ?? 0);
    return (
      <>
        <Hideable centavos={total} hidden={hidden} />
        {so} by {whoName} · the household's plants
      </>
    );
  };
  const chapterOf = (m: number) => {
    const [y, mo] = toDateInput(m).split("-").map(Number);
    const [cy, cmo] = toDateInput(createdAt).split("-").map(Number);
    return y * 12 + mo - (cy * 12 + cmo) + 1;
  };

  const back = encodeURIComponent(`/history?who=${who}`);
  const nothing = !everyone && whoName ? `nothing by ${whoName}` : "nothing spent";
  const shelves: Child[] = [];
  const thisMonday = weekStart(now);
  let month = before === null ? null : shelfMonth(before, now); // the month the last batch ended in already has its sign
  for (const w of weeks) {
    const m = shelfMonth(w, now);
    if (m !== month) {
      month = m;
      shelves.push(<Chapter start={m} chapter={chapterOf(m)} stats={monthStats(m)} wrapped={everyone && m < monthStart(now) && addMonths(m, 1) > createdAt} />);
    }
    const lists = Array.from({ length: 7 }, (_, k) => byDay.get(dayKey(w) + k) ?? []);
    const totals = lists.map((list) => list.reduce((s, r) => s + r.amount, 0));
    // "Biggest day this week", once there are at least three finished days with spending to compare.
    const spent = totals.map((t, k) => (lists[k].length && dayKey(w) + k < today ? k : -1)).filter((k) => k >= 0);
    const biggest = spent.length >= 3 ? spent.reduce((a, b) => (totals[b] > totals[a] ? b : a)) : -1;
    const days: Day[] = lists.map((list, k) => {
      const day = dayKey(w) + k;
      return {
        day,
        kind: potKind(day, today, firstDay, list.length > 0, results.get(day)),
        rows: list,
        total: totals[k],
        missions: missions?.get(day),
        big: k === biggest,
      };
    });
    const thisWeek = w === thisMonday;
    const shown = days.filter((d) => d.kind !== "none" && d.day < today);
    const grew = shown.filter((d) => {
      const r = results.get(d.day);
      return r && isGood(r);
    }).length;
    const weekTotal = totals.reduce((s, t) => s + t, 0);
    const sub = thisWeek ? "still growing" : everyone ? (grew === 7 ? "✨ every day grew" : `${grew} of ${shown.length} days grew`) : `${formatPeso(weekTotal)} by ${whoName}`;
    shelves.push(
      <Shelf
        week={w}
        days={days}
        now={now}
        label={thisWeek ? `This week · ${weekLabel(w)}` : weekLabel(w)}
        sub={sub}
        lights={everyone && grew === 7}
        recap={everyone && !thisWeek && w + WEEK_MS > createdAt ? { total: weekTotal } : undefined}
        open={thisWeek ? today - dayKey(w) : null}
        nothing={nothing}
        back={back}
        spot={thisWeek}
      />,
    );
  }

  const nextHref = more ? `/history?who=${who}&before=${toDateInput(from)}` : null;
  // The bottom of the last batch: where the garden began (or the oldest back-dated expense).
  if (!more) shelves.push(<p class="g-start">🌱 Your garden began here · {dayHeading(Math.min(createdAt, oldest ?? createdAt), now)}</p>);
  const batch = (
    <>
      <section class="g-house" id="history">
        {shelves}
      </section>
      {nextHref && (
        <a class="more" id="more-history" href={nextHref}>
          Show more
        </a>
      )}
    </>
  );
  // "Show more" (/js/history.js) only wants the next shelves and the link after them, not the whole page around them.
  if (before !== null && c.req.query("part") === "shelves") return c.html(batch);
  return c.html(page(<Greenhouse night={isNight(now)}>{batch}</Greenhouse>));
});
