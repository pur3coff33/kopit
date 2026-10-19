import { Hono } from "hono";
import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { entries, households, profiles } from "../db/schema";
import type { AppEnv } from "../env";
import { getCategory } from "../lib/categories";
import { formatPeso } from "../lib/money";
import { breakdown, noSpendDays, noSpendText, pace, paceText } from "../lib/stats";
import { rangeLabel, resolveRange, toDateInput, type Range, type RangeKind } from "../lib/time";
import { requireProfile, requireSession } from "../middleware/auth";
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
      <div class="chips">
        <a class={k === "this" ? "chip on" : "chip"} href={`/spending?${qs({ ...base, kind: "this" })}`}>This month</a>
        <a class={k === "last" ? "chip on" : "chip"} href={`/spending?${qs({ ...base, kind: "last" })}`}>Last month</a>
        <a class={k === "custom" ? "chip on" : "chip"} href={`/spending?${qs({ who: view.who, kind: "custom", ...(view.from ? base : customDefault) })}`}>Custom</a>
      </div>
      {k === "custom" && (
        <form class="form inline" method="get" action="/spending">
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

spending.get("/spending", async (c) => {
  const householdId = c.get("householdId");
  const now = Date.now();
  const view = await readView(c, householdId);
  const profileId = view.who === "all" ? null : view.who;
  const filter = { householdId, profileId, start: view.range.start, end: view.range.end };
  const household = await getDb(c.env).query.households.findFirst({ where: eq(households.id, householdId) });
  const [b, p, ns] = await Promise.all([
    breakdown(c.env, filter),
    view.range.kind === "this" ? pace(c.env, householdId, profileId, now) : Promise.resolve(null),
    noSpendDays(c.env, filter, household!.createdAt, now),
  ]);
  const top = Math.max(1, ...b.rows.map((r) => r.amount));
  const nsText = noSpendText(ns, view.range.kind);
  const q = qs({ kind: view.range.kind, who: view.who, from: view.from, to: view.to });
  return c.html(
    <Layout title="Spending" tab="spending" profileName={c.get("profileName")}>
      <Filters view={view} />
      <div class="total">{formatPeso(b.total)}</div>
      <p class="muted" style="margin-top:0">
        {rangeLabel(view.range.start, view.range.end, now)} · {b.count} expense{b.count === 1 ? "" : "s"}
      </p>
      {p && <div class="nudge">{paceText(p.diff)}</div>}
      {nsText && <div class="nudge">{nsText}</div>}
      {b.rows.length === 0 ? (
        <p class="muted" style="margin-top:18px">Nothing logged yet.</p>
      ) : (
        <ul class="rows">
          {b.rows.map((r) => (
            <li>
              <a class="row" href={`/spending/category/${r.categoryId ?? "none"}?${q}`}>
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
          ))}
        </ul>
      )}
    </Layout>,
  );
});

spending.get("/spending/category/:id", async (c) => {
  const householdId = c.get("householdId");
  const raw = c.req.param("id");
  let categoryId: number | null = null;
  let title = "· Uncategorized";
  if (raw !== "none") {
    const cat = /^\d+$/.test(raw) ? await getCategory(c.env, householdId, Number(raw)) : undefined;
    if (!cat) return c.notFound();
    categoryId = cat.id;
    title = `${cat.emoji} ${cat.name}`;
  }
  const view = await readView(c, householdId);
  const rows = await getDb(c.env)
    .select({ id: entries.id, amount: entries.amountCentavos, spentAt: entries.spentAt, who: profiles.name })
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
  return c.html(
    <Layout title={title} tab="spending" profileName={c.get("profileName")}>
      <p>
        <a href={`/spending?${q}`}>‹ Spending</a>
      </p>
      <h1>{title}</h1>
      <div class="total" style="margin-top:0">{formatPeso(total)}</div>
      <p class="muted" style="margin-top:0">
        {rangeLabel(view.range.start, view.range.end, Date.now())} · {rows.length} expense{rows.length === 1 ? "" : "s"}
      </p>
      {rows.length === 0 ? (
        <p class="muted">Nothing here for this range.</p>
      ) : (
        <ul class="rows">
          {rows.map((r) => (
            <li>
              <a class="row" href={`/entries/${r.id}/edit`}>
                <span class="mid">
                  <span class="nm">
                    <span>{shortDay(r.spentAt)}</span>
                    <span>{formatPeso(r.amount)}</span>
                  </span>
                  <span class="sub">{r.who}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Layout>,
  );
});
