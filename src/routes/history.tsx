import { Hono } from "hono";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { getDb } from "../db/client";
import { categories, entries, profiles } from "../db/schema";
import type { AppEnv } from "../env";
import { formatPeso } from "../lib/money";
import { clockTime, dayKey, toDateInput } from "../lib/time";
import { requireProfile, requireSession } from "../middleware/auth";
import { Layout } from "../views/layout";
import { householdProfiles } from "./setup";

export const history = new Hono<AppEnv>();
history.use("/history", requireSession, requireProfile);

export const HISTORY_PAGE = 50;

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

function parseCursor(raw: string | undefined): { spentAt: number; id: string } | null {
  const m = /^(\d+)_([0-9a-f-]{36})$/.exec(raw ?? "");
  return m ? { spentAt: Number(m[1]), id: m[2] } : null;
}

history.get("/history", async (c) => {
  const householdId = c.get("householdId");
  const now = Date.now();
  const people = await householdProfiles(c.env, householdId);
  const rawWho = c.req.query("who") ?? "all";
  const who = people.find((p) => String(p.id) === rawWho)?.id ?? "all";
  const cursor = parseCursor(c.req.query("before"));

  const rows = await getDb(c.env)
    .select({
      id: entries.id,
      amount: entries.amountCentavos,
      note: entries.note,
      spentAt: entries.spentAt,
      who: profiles.name,
      category: categories.name,
      emoji: categories.emoji,
    })
    .from(entries)
    .innerJoin(profiles, eq(profiles.id, entries.profileId))
    .leftJoin(categories, eq(categories.id, entries.categoryId))
    .where(
      and(
        eq(entries.householdId, householdId),
        who === "all" ? undefined : eq(entries.profileId, who),
        cursor
          ? or(lt(entries.spentAt, cursor.spentAt), and(eq(entries.spentAt, cursor.spentAt), lt(entries.id, cursor.id)))
          : undefined,
      ),
    )
    .orderBy(desc(entries.spentAt), desc(entries.id))
    .limit(HISTORY_PAGE + 1);

  const page = rows.slice(0, HISTORY_PAGE);
  const last = page.at(-1);
  const nextHref =
    rows.length > HISTORY_PAGE && last ? `/history?who=${who}&before=${last.spentAt}_${last.id}` : null;
  const back = encodeURIComponent(`/history?who=${who}`);

  const days: Array<{ heading: string; items: typeof page }> = [];
  for (const r of page) {
    const heading = dayHeading(r.spentAt, now);
    if (days.at(-1)?.heading !== heading) days.push({ heading, items: [] });
    days.at(-1)!.items.push(r);
  }

  return c.html(
    <Layout title="History" tab="history" profileName={c.get("profileName")} scripts={["/js/history.js"]}>
      <div class="chips">
        <a class={who === "all" ? "chip on" : "chip"} href="/history?who=all">Everyone</a>
        {people.map((p) => (
          <a class={who === p.id ? "chip on" : "chip"} href={`/history?who=${p.id}`}>{p.name}</a>
        ))}
      </div>
      {days.length === 0 && !cursor ? (
        <p class="muted" style="margin-top:18px">Nothing logged yet.</p>
      ) : (
        <section class="history" id="history">
          {days.map((d) => (
            <>
              <h2 class="day">{d.heading}</h2>
              <ul class="rows">
                {d.items.map((r) => {
                  const what = r.category ?? "Uncategorized";
                  return (
                    <li>
                      <a class="row" href={`/entries/${r.id}/edit?back=${back}`}>
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
            </>
          ))}
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
