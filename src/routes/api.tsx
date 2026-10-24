import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { profiles } from "../db/schema";
import type { AppEnv } from "../env";
import { resolveCategory } from "../lib/categories";
import { dayNote, noteRows, noteable } from "../lib/daynote";
import { deleteEntry, insertEntry } from "../lib/entries";
import { MAX_CENTAVOS, formatPeso } from "../lib/money";
import { cleanSeen, markSeen, morning } from "../lib/morning";
import { cleanNote } from "../lib/notes";
import { weekCategoryTotal } from "../lib/stats";
import { DAY_MS, dayKey, fromDateInput } from "../lib/time";
import { DayNoteBody } from "../views/daynote";
import { MorningCard } from "../views/morning";
import { isTourScreen } from "../views/tour";

export const api = new Hono<AppEnv>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

api.post("/entries", async (c) => {
  const b = await readJson(c.req.raw);
  if (!b) return c.json({ error: "body" }, 400);
  const householdId = c.get("householdId");
  if (typeof b.id !== "string" || !UUID.test(b.id)) return c.json({ error: "id" }, 400);
  const amount = b.amountCentavos;
  if (!Number.isInteger(amount) || (amount as number) < 1 || (amount as number) > MAX_CENTAVOS) return c.json({ error: "amountCentavos" }, 400);
  if (typeof b.spentAt !== "number" || !Number.isFinite(b.spentAt)) return c.json({ error: "spentAt" }, 400);
  const entryNote = cleanNote(b.note);
  if (entryNote === undefined) return c.json({ error: "note" }, 400);
  const profile = isId(b.profileId)
    ? await getDb(c.env).query.profiles.findFirst({ where: and(eq(profiles.id, b.profileId), eq(profiles.householdId, householdId)) })
    : undefined;
  if (!profile) return c.json({ error: "profileId" }, 400);
  let category: { categoryId: number | null; name: string | null; note: string | null } = { categoryId: null, name: null, note: null };
  if (b.categoryId !== null && b.categoryId !== undefined) {
    const resolved = isId(b.categoryId) ? await resolveCategory(c.env, householdId, b.categoryId) : undefined;
    if (!resolved) return c.json({ error: "categoryId" }, 400);
    category = resolved;
  }
  const { categoryId, name: categoryName } = category;
  const now = Date.now();
  const status = await insertEntry(
    c.env,
    householdId,
    { id: b.id.toLowerCase(), profileId: profile.id, categoryId, amountCentavos: amount as number, note: entryNote ?? category.note, spentAt: Math.round(b.spentAt) },
    now,
  );
  const total = formatPeso(await weekCategoryTotal(c.env, householdId, categoryId, now));
  const note = categoryName ? `Saved ✓ · ${categoryName} this week: ${total}` : `Saved ✓ · This week: ${total}`;
  return c.json({ status, note }, 201);
});

// Undo right after saving. Uses the same tombstone as a normal delete, so a resend can't bring it back.
api.delete("/entries/:id", async (c) => {
  const ok = await deleteEntry(c.env, c.get("householdId"), c.req.param("id").toLowerCase());
  return ok ? c.json({ ok: true }) : c.json({ error: "not-found" }, 404);
});

// A screen's first-time tour was closed (finished or skipped): don't offer it to this person again, on any phone.
api.post("/tour", async (c) => {
  const b = await readJson(c.req.raw);
  const screen = b?.screen;
  if (!isTourScreen(screen)) return c.json({ error: "screen" }, 400);
  const seen = c.get("toursSeen");
  if (!seen.includes(screen)) {
    await getDb(c.env)
      .update(profiles)
      .set({ toursSeen: [...seen, screen].join(",") })
      .where(and(eq(profiles.id, c.get("profileId")), eq(profiles.householdId, c.get("householdId"))));
  }
  return c.json({ ok: true });
});

// A finished day's note, as the piece of page it goes in: the morning card's (?full) or a receipt's in History. Written on
// the first ask, so it can take a few seconds. 204: the day has none and won't (nothing spent, no AI, or its tries are
// used up). 503: not right now (another phone is writing it, or the AI turned it away): asking later may get it.
api.get("/day-note/:date", async (c) => {
  const ms = fromDateInput(c.req.param("date"));
  if (ms === null) return c.json({ error: "date" }, 400);
  const householdId = c.get("householdId");
  const day = dayKey(ms);
  const note = await dayNote(c.env, householdId, c.get("householdCreatedAt"), day, Date.now());
  if (!note) {
    const spent = await c.env.DB.prepare("SELECT 1 FROM entries WHERE household_id = ? AND spent_at >= ? AND spent_at < ? LIMIT 1")
      .bind(householdId, ms, ms + DAY_MS)
      .first();
    const later =
      (c.env.AI || c.env.DUMMY_NOTES === "1") &&
      noteable(day, dayKey(Date.now()), !!spent) &&
      !(await noteRows(c.env, householdId, [day])).has(day);
    return later ? c.json({ error: "later" }, 503, { "Retry-After": "60" }) : c.body(null, 204);
  }
  return c.html(<DayNoteBody note={note} full={c.req.query("full") !== undefined} />, 200, { "Cache-Control": "no-store" });
});

// What this person's day starts with, asked by /js/morning.js on whichever screen they open first: a recap to play, or
// the morning card. 204: nothing, or nothing more today.
api.get("/morning", async (c) => {
  const now = Date.now();
  const m = await morning(c.env, c.get("householdId"), c.get("householdCreatedAt"), c.get("profileId"), now);
  const fresh = { "Cache-Control": "no-store" };
  if (m.kind === "none") return c.body(null, 204, fresh);
  if (m.kind === "recap") return c.json({ recap: m.url, marks: m.marks }, 200, fresh);
  const card = String(await (<MorningCard garden={m.garden} leaf={m.leaf} note={m.note} now={now} />).toString());
  return c.json({ card, leaf: m.leaf, note: m.note }, 200, fresh);
});

// This person has had part of their day's start (a recap starting, the morning card closing): don't show it again.
api.post("/morning/seen", async (c) => {
  const had = cleanSeen(await readJson(c.req.raw));
  if (!had) return c.json({ error: "seen" }, 400);
  await markSeen(c.env, c.get("householdId"), c.get("profileId"), had);
  return c.json({ ok: true });
});
