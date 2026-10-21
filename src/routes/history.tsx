import { Hono } from "hono";
import { and, desc, eq, gte, lt, min, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { categories, entries, profiles } from "../db/schema";
import type { AppEnv } from "../env";
import { categoryColor } from "../lib/colors";
import { amounts } from "../lib/money";
import { DAY_MS, MANILA_OFFSET_MS, clockTime, dayKey, fromDateInput, rangeLabel, toDateInput } from "../lib/time";
import { requireProfile, requireSession } from "../middleware/auth";
import { AmountsEye } from "../views/components";
import { Layout } from "../views/layout";
import { householdProfiles } from "./setup";

export const history = new Hono<AppEnv>();
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

  const nextHref = more && oldest !== undefined ? `/history?who=${who}&before=${toDateInput(startOf(oldest))}` : null;
  const back = encodeURIComponent(`/history?who=${who}`);
  const nothing = whoName && who !== "all" ? `nothing by ${whoName}` : "nothing spent";
  const hidden = c.get("hideAmounts");
  const { peso } = amounts(hidden);

  return c.html(
    <Layout title="History" tab="history" profileName={c.get("profileName")} profileIndex={c.get("profileIndex")} scripts={["/js/history.js"]}>
      <div class="chips">
        <a class={who === "all" ? "chip on" : "chip"} href="/history?who=all">Everyone</a>
        {people.map((p) => (
          <a class={who === p.id ? "chip on" : "chip"} href={`/history?who=${p.id}`}>{p.name}</a>
        ))}
        {/* Back to the top of history: a "Show more" batch isn't a screen of its own. */}
        <AmountsEye hidden={hidden} back={`/history?who=${who}`} />
      </div>
      {days.length === 0 && before === null ? (
        <p class="muted" style="margin-top:18px">Nothing logged yet.</p>
      ) : (
        <section class="history path" id="history">
          {items.map((item) => {
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
            const list = byDay.get(item.day) ?? [];
            return (
              <div class="day-group">
                <h2 class="day">
                  <span>{dayHeading(startOf(item.day), now)}</span>
                  <span>{peso(list.reduce((s, r) => s + r.amount, 0))}</span>
                </h2>
                <ul class="rows">
                  {list.map((r) => {
                    const what = r.category ?? "Uncategorized";
                    return (
                      <li>
                        <a class="row" href={`/entries/${r.id}/edit?back=${back}`} style={`--tint:${categoryColor(r.categoryId).tint}`}>
                          <span class="ic">{r.emoji ?? "·"}</span>
                          <span class="mid">
                            <span class="nm">
                              <span>{r.note ?? what}</span>
                              <span>{peso(r.amount)}</span>
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
    </Layout>,
  );
});
