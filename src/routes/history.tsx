import { Hono } from "hono";
import { and, desc, eq, gte, lt, min, sql, sum } from "drizzle-orm";
import { getDb } from "../db/client";
import { categories, entries, profiles } from "../db/schema";
import type { AppEnv } from "../env";
import type { CategoryKey } from "../lib/categories";
import { categoryColor } from "../lib/colors";
import { missionDays, monthName, type DayMissions } from "../lib/garden";
import { formatPeso } from "../lib/money";
import { DAY_MS, MANILA_OFFSET_MS, addMonths, clockTime, dayKey, fromDateInput, monthStart, rangeLabel, toDateInput, weekStart } from "../lib/time";
import { WEEK_MS } from "../lib/week";
import { weekLabel } from "../views/week";
import { requireProfile, requireSession } from "../middleware/auth";
import { Layout } from "../views/layout";
import { Tour } from "../views/tour";
import { householdProfiles } from "./setup";

export const history = new Hono<AppEnv>();

/** A day's missions under its heading: a one-line summary that opens into the list. The household's, so Everyone only. */
function DayMissionsLine({ m, today, spot }: { m: DayMissions; today: boolean; spot?: boolean }) {
  const n = m.items.length;
  if (n === 0) return null;
  const icon = today ? "🌱" : m.done === n ? "🌸" : m.done * 2 >= n ? "🍃" : "·";
  const summary = today ? `${m.done} of ${n} missions on track so far` : `${m.done} of ${n} missions met`;
  return (
    <details class="missions day-missions" data-spot={spot ? "day-result" : undefined}>
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

/** How many days with spending each batch of history loads. A day is never split across batches. */
export const HISTORY_DAYS = 5;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

export type HistoryItem = { kind: "day"; day: number } | { kind: "quiet"; from: number; to: number };

/**
 * Spending days (day keys, newest first) with the quiet days around them as runs, newest first.
 * Only days from `low` to `high` can be quiet: not before the household existed, not today (it isn't over).
 */
export function historyItems(days: number[], low: number, high: number): HistoryItem[] {
  const items: HistoryItem[] = [];
  const quiet = (from: number, to: number) => {
    const a = Math.max(from, low);
    const b = Math.min(to, high);
    if (a <= b) items.push({ kind: "quiet", from: a, to: b });
  };
  let above = Infinity;
  for (const day of days) {
    quiet(day + 1, above - 1);
    items.push({ kind: "day", day });
    above = day;
  }
  quiet(low, above - 1);
  return items;
}

const startOf = (day: number) => day * DAY_MS - MANILA_OFFSET_MS;

type Recaps = { week?: number; month?: number };

/**
 * Which spending days (day keys, newest first) get a recap row above them: the newest day of each finished week and
 * month that ended after the household began. A period whose newest day was on an earlier page (at or after `before`)
 * already had its row there.
 */
export function recapRows(days: number[], before: number | null, createdAt: number, now: number): Map<number, Recaps> {
  const out = new Map<number, Recaps>();
  const weeks = new Set<number>();
  const months = new Set<number>();
  if (before !== null) {
    weeks.add(weekStart(startOf(before)));
    months.add(monthStart(startOf(before)));
  }
  for (const day of days) {
    const w = weekStart(startOf(day));
    const m = monthStart(startOf(day));
    const r: Recaps = {};
    if (!weeks.has(w) && w < weekStart(now) && w + WEEK_MS > createdAt) r.week = w;
    if (!months.has(m) && m < monthStart(now) && addMonths(m, 1) > createdAt) r.month = m;
    weeks.add(w);
    months.add(m);
    if (r.week !== undefined || r.month !== undefined) out.set(day, r);
  }
  return out;
}

export type Placed = HistoryItem | { kind: "week"; start: number } | { kind: "month"; start: number };

/**
 * The history items with the recap rows placed where their week or month ended (above its last day), splitting a
 * quiet run that crosses that line. On the same line, the month's row goes first.
 */
export function placeRecaps(items: HistoryItem[], rows: Map<number, Recaps>): Placed[] {
  const marks: Array<{ at: number; row: Placed }> = [];
  for (const r of rows.values()) {
    if (r.month !== undefined) marks.push({ at: dayKey(addMonths(r.month, 1)) - 1, row: { kind: "month", start: r.month } });
    if (r.week !== undefined) marks.push({ at: dayKey(r.week) + 6, row: { kind: "week", start: r.week } });
  }
  marks.sort((a, b) => b.at - a.at || (a.row.kind === "month" ? -1 : 1));
  const out: Placed[] = [];
  let k = 0;
  for (const item of items) {
    let rest: HistoryItem | null = item;
    while (rest) {
      const top: number = rest.kind === "day" ? rest.day : rest.to;
      while (k < marks.length && marks[k].at >= top) out.push(marks[k++].row);
      if (rest.kind === "quiet" && k < marks.length && marks[k].at >= rest.from) {
        out.push({ kind: "quiet", from: marks[k].at + 1, to: rest.to });
        rest = { kind: "quiet", from: rest.from, to: marks[k].at };
        continue;
      }
      out.push(rest);
      rest = null;
    }
  }
  for (; k < marks.length; k++) out.push(marks[k].row);
  return out;
}

/** `before=2026-10-16`: show days before that date. */
function parseBefore(raw: string | undefined): number | null {
  const ms = raw ? fromDateInput(raw) : null;
  return ms === null ? null : dayKey(ms);
}

history.get("/history", async (c) => {
  const householdId = c.get("householdId");
  const now = Date.now();
  const people = await householdProfiles(c.env, householdId);
  const rawWho = c.req.query("who") ?? "all";
  const who = people.find((p) => String(p.id) === rawWho)?.id ?? "all";
  const whoName = people.find((p) => p.id === who)?.name;
  const before = parseBefore(c.req.query("before"));

  const db = getDb(c.env);
  const scope = and(
    eq(entries.householdId, householdId),
    who === "all" ? undefined : eq(entries.profileId, who),
    before === null ? undefined : lt(entries.spentAt, startOf(before)),
  );
  // The newest days with spending (one extra to know if there's more), then every expense on them. The day lookup
  // can't use the index's order, so it looks back through a window (an index range) that widens only when needed.
  const dayOf = sql<number>`(${entries.spentAt} + 28800000) / 86400000`;
  const upper = before === null ? now : startOf(before);
  let found: Array<{ day: number }> = [];
  let oldestAt: number | null | undefined;
  for (let span = 45 * DAY_MS; ; span *= 4) {
    found = await db
      .selectDistinct({ day: dayOf })
      .from(entries)
      .where(and(scope, gte(entries.spentAt, upper - span)))
      .orderBy(desc(dayOf))
      .limit(HISTORY_DAYS + 1);
    if (found.length > HISTORY_DAYS) break;
    if (oldestAt === undefined) {
      const [row] = await db.select({ t: min(entries.spentAt) }).from(entries).where(scope);
      oldestAt = row?.t ?? null;
    }
    if (oldestAt === null || upper - span <= oldestAt) break;
  }
  const days = found.slice(0, HISTORY_DAYS).map((r) => Number(r.day));
  const more = found.length > HISTORY_DAYS;
  const oldest = days.at(-1);
  const rows =
    oldest === undefined
      ? []
      : await db
          .select({
            id: entries.id,
            amount: entries.amountCentavos,
            note: entries.note,
            spentAt: entries.spentAt,
            who: profiles.name,
            categoryId: entries.categoryId,
            category: categories.name,
            key: categories.key,
            emoji: categories.emoji,
          })
          .from(entries)
          .innerJoin(profiles, eq(profiles.id, entries.profileId))
          .leftJoin(categories, eq(categories.id, entries.categoryId))
          .where(and(scope, gte(entries.spentAt, startOf(oldest))))
          .orderBy(desc(entries.spentAt), desc(entries.id));

  const byDay = new Map<number, typeof rows>();
  for (const r of rows) {
    const k = dayKey(r.spentAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(r);
  }
  // Quiet days stop at the household's first day, and at yesterday. With more to load, the quiet days
  // below the oldest day shown belong to the next batch, which starts right under it.
  const floor = dayKey(c.get("householdCreatedAt"));
  const low = more && oldest !== undefined ? Math.max(oldest, floor) : floor;
  const high = Math.min(dayKey(now) - 1, (before ?? Infinity) - 1);
  const items = historyItems(days, low, high);
  const missions = who === "all" ? await missionDays(c.env, householdId, c.get("householdCreatedAt"), days, now) : null;
  const today = dayKey(now);
  // The household's recaps (Everyone only, like its missions): a row where each finished week and month ended.
  const recaps = who === "all" ? recapRows(days, before, c.get("householdCreatedAt"), now) : new Map<number, Recaps>();
  const placed = placeRecaps(items, recaps);
  const first = placed.findIndex((item) => item.kind === "day"); // the day the tour points at
  const weekStarts = [...recaps.values()].flatMap((r) => (r.week === undefined ? [] : [r.week]));
  const weekTotals = new Map(
    await Promise.all(
      weekStarts.map(async (w) => {
        const [row] = await db
          .select({ total: sum(entries.amountCentavos) })
          .from(entries)
          .where(and(eq(entries.householdId, householdId), gte(entries.spentAt, w), lt(entries.spentAt, w + WEEK_MS)));
        return [w, Number(row?.total ?? 0)] as const;
      }),
    ),
  );

  const nextHref = more && oldest !== undefined ? `/history?who=${who}&before=${toDateInput(startOf(oldest))}` : null;
  const back = encodeURIComponent(`/history?who=${who}`);
  const nothing = whoName && who !== "all" ? `nothing by ${whoName}` : "nothing spent";

  return c.html(
    <Layout title="History" tab="history" profileName={c.get("profileName")} profileIndex={c.get("profileIndex")} scripts={["/js/history.js", "/js/tour-page.js"]}>
      <div class="chips" data-spot="people">
        <a class={who === "all" ? "chip on" : "chip"} href="/history?who=all">Everyone</a>
        {people.map((p) => (
          <a class={who === p.id ? "chip on" : "chip"} href={`/history?who=${p.id}`}>{p.name}</a>
        ))}
      </div>
      {days.length === 0 && before === null ? (
        <p class="muted" style="margin-top:18px">Nothing logged yet.</p>
      ) : (
        <section class="history path" id="history">
          {placed.map((item, i) => {
            if (item.kind === "quiet") {
              const n = item.to - item.from + 1;
              const label = n === 1 ? dayHeading(startOf(item.from), now) : rangeLabel(startOf(item.from), startOf(item.to + 1), now);
              return (
                <p class="quiet">
                  {who === "all" ? "🍃 " : ""}
                  <b>{label}</b> · {nothing}
                  {n > 1 ? ` · ${n} days` : ""}
                </p>
              );
            }
            if (item.kind === "month") {
              return (
                <a class="recap-row" href={`/wrapped/${toDateInput(item.start).slice(0, 7)}?from=history`}>
                  <span class="ic" aria-hidden="true">
                    ▶
                  </span>
                  <span class="mid">
                    <b>{monthName(item.start)}, wrapped</b>
                    <span>The month's garden</span>
                  </span>
                </a>
              );
            }
            if (item.kind === "week") {
              return (
                <a class="recap-row" href={`/week/${toDateInput(item.start)}?from=history`}>
                  <span class="ic" aria-hidden="true">
                    ▶
                  </span>
                  <span class="mid">
                    <b>Week of {weekLabel(item.start)}</b>
                    <span>{formatPeso(weekTotals.get(item.start) ?? 0)} · your week's recap</span>
                  </span>
                </a>
              );
            }
            const list = byDay.get(item.day) ?? [];
            return (
              <div class="day-group">
                <h2 class="day">
                  <span>{dayHeading(startOf(item.day), now)}</span>
                  <span>{formatPeso(list.reduce((s, r) => s + r.amount, 0))}</span>
                </h2>
                {missions?.has(item.day) && <DayMissionsLine m={missions.get(item.day)!} today={item.day === today} spot={i === first} />}
                <ul class="rows" data-spot={i === first ? "day" : undefined}>
                  {list.map((r) => {
                    const what = r.category ?? "No category";
                    return (
                      <li>
                        <a class="row" href={`/entries/${r.id}/edit?back=${back}`} style={`--tint:${categoryColor(r.key as CategoryKey | null).tint}`}>
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
                  })}
                </ul>
              </div>
            );
          })}
        </section>
      )}
      {nextHref && (
        <a class="more" id="more-history" href={nextHref}>
          Show more
        </a>
      )}
      <Tour screen="history" profileId={c.get("profileId")} profileName={c.get("profileName")} seen={c.get("toursSeen")} />
    </Layout>,
  );
});
