import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { profiles } from "../db/schema";
import type { AppEnv } from "../env";
import { resolveCategory } from "../lib/categories";
import { deleteEntry, insertEntry } from "../lib/entries";
import { MAX_CENTAVOS, formatPeso } from "../lib/money";
import { cleanNote } from "../lib/notes";
import { weekCategoryTotal } from "../lib/stats";

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
