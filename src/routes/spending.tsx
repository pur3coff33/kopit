import { Hono } from "hono";
import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { entries, profiles } from "../db/schema";
import type { AppEnv } from "../env";
import { getCategory } from "../lib/categories";
import { categoryColor } from "../lib/colors";
import { monthGarden, monthName, rangeDays, todayMissions, wholePastMonth } from "../lib/garden";
import { formatPeso } from "../lib/money";
import { breakdown, categoryPace, pace, paceText, rangeTotal, weeklyTotals } from "../lib/stats";
import { addMonths, dayStart, isNight, rangeLabel, resolveRange, toDateInput, type Range, type RangeKind } from "../lib/time";
import { requireProfile, requireSession } from "../middleware/auth";
import { Plant, Sky } from "../views/garden";
import { Layout } from "../views/layout";
import { householdProfiles } from "./setup";

export const spending = new Hono<AppEnv>();

spending.use("/spending", requireSession, requireProfile);
spending.use("/spending/*", requireSession, requireProfile);

type Who = "all" | number;
type View = { range: Range; who: Who; from?: string; to?: string; people: { id: number; name: string }[] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDay(ms: number): string {
  const [, m, d] = toDateInput(ms).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function qs(v: { kind: RangeKind; who: Who; from?: string; to?: string }): string {
  const p = new URLSearchParams({ range: v.kind });
  if (v.kind === "custom" && v.from && v.to) {
    p.set("from", v.from);
    p.set("to", v.to);
  }
  p.set("who", String(v.who));
  return p.toString();
}

async function readView(c: { env: AppEnv["Bindings"]; req: { query: (k: string) => string | undefined } }, householdId: number): Promise<View> {
  const now = Date.now();
  const kind = (["this", "last", "custom"] as const).find((k) => k === c.req.query("range")) ?? "this";
  const range = resolveRange(kind, now, c.req.query("from"), c.req.query("to"));
  const people = (await householdProfiles(c.env, householdId)).map((p) => ({ id: p.id, name: p.name }));
  const rawWho = c.req.query("who") ?? "all";
  const who: Who = people.find((p) => String(p.id) === rawWho)?.id ?? "all";
  const from = range.kind === "custom" ? toDateInput(range.start) : undefined;
  const to = range.kind === "custom" ? toDateInput(range.end - 1) : undefined;
  return { range, who, from, to, people };
}

function Filters({ view }: { view: View }) {
  const now = Date.now();
  const k = view.range.kind;
  const base = { who: view.who, from: view.from, to: view.to };
  const customDefault = { from: toDateInput(resolveRange("this", now).start), to: toDateInput(now) };
  return (
    <>
      <nav class="seg" aria-label="Period">
        <a class={k === "this" ? "on" : ""} href={`/spending?${qs({ ...base, kind: "this" })}`}>This month</a>
        <a class={k === "last" ? "on" : ""} href={`/spending?${qs({ ...base, kind: "last" })}`}>Last month</a>
        <a class={k === "custom" ? "on" : ""} href={`/spending?${qs({ who: view.who, kind: "custom", ...(view.from ? base : customDefault) })}`}>Custom</a>
      </nav>
      {k === "custom" && (
        <form class="form range-form" method="get" action="/spending">
          <input type="hidden" name="range" value="custom" />
          <input type="hidden" name="who" value={String(view.who)} />
          <label>
            From
            <input type="date" name="from" value={view.from} required />
          </label>
          <label>
            To
            <input type="date" name="to" value={view.to} required />
          </label>
          <button class="save" type="submit">Show</button>
        </form>
      )}
      <div class="chips">
        <a class={view.who === "all" ? "chip on" : "chip"} href={`/spending?${qs({ ...base, kind: k, who: "all" })}`}>Everyone</a>
        {view.people.map((p) => (
          <a class={view.who === p.id ? "chip on" : "chip"} href={`/spending?${qs({ ...base, kind: k, who: p.id })}`}>{p.name}</a>
        ))}
      </div>
    </>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

spending.get("/spending", async (c) => {
  const householdId = c.get("householdId");
  const createdAt = c.get("householdCreatedAt");
  const now = Date.now();
  const view = await readView(c, householdId);
  const profileId = view.who === "all" ? null : view.who;
  const filter = { householdId, profileId, start: view.range.start, end: view.range.end };
  const pastMonth = wholePastMonth(view.range, now);
  // The garden (leaves, bud, bloom) is always the whole household's, whoever is picked; the pace pill follows the pick.
  const thisMonth = view.range.kind === "this";
  const [b, p, householdPace, days, g, missions] = await Promise.all([
    breakdown(c.env, filter),
    thisMonth ? pace(c.env, householdId, profileId, now) : Promise.resolve(null),
    thisMonth && profileId !== null ? pace(c.env, householdId, null, now) : Promise.resolve(null),
    // A finished month's days come with its garden below; only count them here for other ranges.
    pastMonth === null ? rangeDays(c.env, householdId, createdAt, view.range.start, view.range.end, now) : Promise.resolve(null),
    pastMonth === null ? Promise.resolve(null) : monthGarden(c.env, householdId, pastMonth, createdAt, now),
    thisMonth ? todayMissions(c.env, householdId, now) : Promise.resolve(null),
  ]);
  const leafCount = g ? g.goodDays : (days?.goodDays ?? 0);
  const perfectCount = g ? g.perfectDays : (days?.perfectDays ?? 0);
  const beforeGarden = !!g && g.end <= dayStart(createdAt); // the household didn't exist yet: nothing to grade
  const hp = profileId === null ? p : householdPace;
  const bud = !!hp && hp.diff < 0;
  const top = Math.max(1, ...b.rows.map((r) => r.amount));
  const q = qs({ kind: view.range.kind, who: view.who, from: view.from, to: view.to });
  const label = rangeLabel(view.range.start, view.range.end, now);
  const plant = <Plant leaves={leafCount} perfect={perfectCount} bud={bud} bloom={!!g?.bloomed} width={104} />;
  const tally = `${plural(leafCount, "good day", "good days")} · ${perfectCount} perfect · ${plural(b.count, "expense", "expenses")}`;
  return c.html(
    <Layout title="Garden" tab="spending" profileName={c.get("profileName")} profileIndex={c.get("profileIndex")} scripts={["/js/sky.js"]}>
      <Filters view={view} />
      <section class="terrarium">
        <div class="terra-plant">
          {/* Only this month's plant stands under today's sky; past months are records. */}
          {thisMonth ? <Sky night={isNight(now)}>{plant}</Sky> : plant}
          {view.who !== "all" && <span class="caption">the household's garden</span>}
        </div>
        <div class="terra-text">
          {g ? (
            <>
              <p class="headline">
                {beforeGarden
                  ? "Before your garden began"
                  : g.bloomed
                  ? `${monthName(g.start)} bloomed 🌸`
                  : g.goodDays === 0
                    ? `${monthName(g.start)} stayed a sprout`
                    : `${monthName(g.start)} grew ${plural(g.goodDays, "leaf", "leaves")}`}
              </p>
              <div class="total">{formatPeso(b.total)}</div>
              {g.bloomed && g.prevTotal !== null ? (
                <p class="muted">
                  {view.who === "all" ? "" : "The household spent "}
                  {formatPeso(g.total)}
                  {view.who === "all" ? " spent" : ""}, {formatPeso(g.prevTotal - g.total)} less than {monthName(addMonths(g.start, -1))}.
                </p>
              ) : (
                <p class="muted">{plural(b.count, "expense", "expenses")}</p>
              )}
            </>
          ) : (
            <>
              <p class="muted">Spent {label}</p>
              <div class="total">{formatPeso(b.total)}</div>
              {p &&
                (p.diff < 0 && profileId === null ? (
                  <span class="pill">↓ {formatPeso(-p.diff)} · 🌸 on track</span>
                ) : (
                  <span class="pill neutral">{paceText(p.diff)}</span>
                ))}
              <p class="muted tally">🍃 {tally}</p>
            </>
          )}
          <div class="terra-links">
            {g && !beforeGarden && (
              <a class="chip" href={`/wrapped/${toDateInput(g.start).slice(0, 7)}`}>
                ▶ Replay Wrapped
              </a>
            )}
            <a class="chip gallery-link" href="/gallery">
              🪴 Gallery
            </a>
          </div>
        </div>
      </section>
      {missions && (
        <section class="missions">
          <div class="missions-head">
            <span>Today's missions</span>
            <span>
              {missions.onTrack} of {missions.items.length} on track
            </span>
          </div>
          <ul>
            {missions.items.map((m) => (
              <li class={`m ${m.status}`}>
                <span class="st" aria-hidden="true">
                  {m.status === "missed" ? "–" : ""}
                </span>
                <span class="t">
                  {m.title}
                  <small>
                    <span class="sr">{m.status === "track" ? "On track: " : "Not today: "}</span>
                    {m.status === "missed" ? `${m.note} · not today` : m.note}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {b.rows.length === 0 ? (
        <p class="muted" style="margin-top:18px">Nothing logged yet.</p>
      ) : (
        <ul class="rows">
          {b.rows.map((r) => {
            const col = categoryColor(r.categoryId);
            return (
              <li>
                <a class="row" href={`/spending/category/${r.categoryId ?? "none"}?${q}`} style={`--fill:${col.fill};--tint:${col.tint}`}>
                  <span class="ic">{r.emoji}</span>
                  <span class="mid">
                    <span class="nm">
                      <span>{r.name}</span>
                      <span>{formatPeso(r.amount)}</span>
                    </span>
                    <span class="bar">
                      <i style={`width:${Math.max(2, Math.round((r.amount / top) * 100))}%`}></i>
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Layout>,
  );
});

spending.get("/spending/category/:id", async (c) => {
  const householdId = c.get("householdId");
  const raw = c.req.param("id");
  let categoryId: number | null = null;
  let emoji = "·";
  let name = "Uncategorized";
  if (raw !== "none") {
    const cat = /^\d+$/.test(raw) ? await getCategory(c.env, householdId, Number(raw)) : undefined;
    if (!cat) return c.notFound();
    categoryId = cat.id;
    emoji = cat.emoji;
    name = cat.name;
  }
  const title = `${emoji} ${name}`;
  const view = await readView(c, householdId);
  const now = Date.now();
  const profileId = view.who === "all" ? null : view.who;
  const filter = { householdId, profileId, start: view.range.start, end: view.range.end };
  const [everything, weeks, delta] = await Promise.all([
    rangeTotal(c.env, filter),
    weeklyTotals(c.env, filter, categoryId, now),
    view.range.kind === "this" ? categoryPace(c.env, householdId, profileId, categoryId, now) : Promise.resolve(null),
  ]);
  const rows = await getDb(c.env)
    .select({ id: entries.id, amount: entries.amountCentavos, note: entries.note, spentAt: entries.spentAt, who: profiles.name })
    .from(entries)
    .innerJoin(profiles, eq(profiles.id, entries.profileId))
    .where(
      and(
        eq(entries.householdId, householdId),
        categoryId === null ? isNull(entries.categoryId) : eq(entries.categoryId, categoryId),
        view.who === "all" ? undefined : eq(entries.profileId, view.who),
        gte(entries.spentAt, view.range.start),
        lt(entries.spentAt, view.range.end),
      ),
    )
    .orderBy(desc(entries.spentAt), desc(entries.createdAt));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const q = qs({ kind: view.range.kind, who: view.who, from: view.from, to: view.to });
  const col = categoryColor(categoryId);
  const whoName = view.people.find((p) => p.id === view.who)?.name ?? "Everyone";
  const share = everything > 0 ? Math.round((total / everything) * 100) : 0;
  const change = delta && delta.diff !== 0 ? ` · ${delta.diff > 0 ? "↑" : "↓"} ${formatPeso(Math.abs(delta.diff))} vs ${delta.prevMonth}` : "";
  const tallest = Math.max(1, ...weeks.map((w) => w.total));
  const thisWeek = weeks.at(-1)?.start;
  return c.html(
    <Layout title={title} tab="spending" profileName={c.get("profileName")} profileIndex={c.get("profileIndex")}>
      <p>
        <a href={`/spending?${q}`}>‹ Garden</a>
      </p>
      <div class="cat-head" style={`--tint:${col.tint}`}>
        <span class="badge" aria-hidden="true">{emoji}</span>
        <div>
          <h1>{name}</h1>
          <p class="muted">
            {rangeLabel(view.range.start, view.range.end, now)} · {whoName} · {rows.length} expense{rows.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <div class="total" style="margin-top:6px">{formatPeso(total)}</div>
      {total > 0 && (
        <span class="pill neutral">
          {share}% of everything{change}
        </span>
      )}
      {weeks.length >= 2 && (
        <div class="weeks" aria-hidden="true">
          {weeks.map((w) => (
            <div class={w.start === thisWeek && view.range.end > now ? "wk now" : "wk"}>
              <i style={`height:${Math.max(4, Math.round((w.total / tallest) * 78))}%;background:${col.fill}`}></i>
              <span>{shortDay(Math.max(w.start, view.range.start))}</span>
            </div>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <p class="muted">Nothing here for this range.</p>
      ) : (
        <ul class="rows">
          {rows.map((r) => (
            <li>
              <a class="row" href={`/entries/${r.id}/edit?back=${encodeURIComponent(c.req.path + "?" + q)}`}>
                <span class="mid">
                  <span class="nm">
                    <span>{r.note ?? shortDay(r.spentAt)}</span>
                    <span>{formatPeso(r.amount)}</span>
                  </span>
                  <span class="sub">{r.note ? `${shortDay(r.spentAt)} · ${r.who}` : r.who}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Layout>,
  );
});
