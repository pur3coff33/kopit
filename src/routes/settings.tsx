import { Hono } from "hono";
import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { households, profiles } from "../db/schema";
import type { AppEnv } from "../env";
import { cleanName, listCategories, renameCategory, setCategoryHidden } from "../lib/categories";
import { getCookie } from "hono/cookie";
import { attemptPin } from "../lib/login";
import { SESSION_COOKIE, deleteOtherSessions } from "../lib/session";
import { hashPin, isValidPin } from "../lib/pin";
import { clockTime } from "../lib/time";
import { requireProfile, requireSession } from "../middleware/auth";
import { Avatar } from "../views/garden";
import { Layout } from "../views/layout";
import { householdProfiles } from "./setup";

export const settings = new Hono<AppEnv>();

settings.use("/settings", requireSession, requireProfile);
settings.use("/settings/*", requireSession, requireProfile);

const OK: Record<string, string> = {
  people: "Saved.",
  cat: "Category saved.",
  pin: "PIN changed. Other phones will need to log in again with the new PIN.",
};

async function SettingsPage({ c, message }: { c: Context<AppEnv>; message?: string }) {
  const householdId = c.get("householdId");
  const [people, cats, home] = await Promise.all([
    householdProfiles(c.env, householdId),
    listCategories(c.env, householdId, { includeHidden: true }),
    getDb(c.env).select({ username: households.username }).from(households).where(eq(households.id, householdId)).get(),
  ]);
  const ok = OK[c.req.query("ok") ?? ""];
  return (
    <Layout title="Garden shed" profileName={c.get("profileName")} profileIndex={c.get("profileIndex")}>
      <p>
        <a href="/">‹ Back</a>
      </p>
      <h1>Garden shed</h1>
      <p class="muted">Settings for the {home?.username} household</p>
      {(message ?? ok) && <p class="msg">{message ?? ok}</p>}

      <div class="card gardener">
        <Avatar index={c.get("profileIndex")} name={c.get("profileName")} size={42} />
        <div>
          <b>{c.get("profileName")}</b>
          <span class="muted">This phone's gardener</span>
        </div>
        <a class="chip" href="/profile">
          Switch
        </a>
      </div>


      <section class="card">
        <h2>People</h2>
        {people.map((p) => (
          <form class="form inline" method="post" action={`/settings/profiles/${p.id}`}>
            <label>
              <input name="name" value={p.name} maxlength={24} required aria-label="Name" />
            </label>
            <button class="save" type="submit">Rename</button>
          </form>
        ))}
        <form class="form inline" method="post" action="/settings/profiles">
          <label>
            <input name="name" maxlength={24} required placeholder="Add a person" aria-label="New person" />
          </label>
          <button class="save" type="submit">Add</button>
        </form>

      </section>

      <section class="card">
        <h2>Categories</h2>
        <p class="muted">Hidden categories stay on old expenses but leave the add screen.</p>
        {cats.map((cat) => (
          <div style={cat.hidden ? "opacity:.55" : ""}>
            <form class="form inline" method="post" action={`/settings/categories/${cat.id}`} style="margin-bottom:4px">
              <label style="flex:0 0 58px">
                <input name="emoji" value={cat.emoji} maxlength={8} aria-label="Emoji" />
              </label>
              <label>
                <input name="name" value={cat.name} maxlength={24} required aria-label="Name" />
              </label>
              <button class="save" type="submit">Save</button>
            </form>
            <form method="post" action={`/settings/categories/${cat.id}/hidden`} style="margin:0 0 10px">
              <input type="hidden" name="hidden" value={cat.hidden ? "0" : "1"} />
              <button class="linkbtn" type="submit">{cat.hidden ? "Show on add screen" : "Hide"}</button>
            </form>
          </div>
        ))}

      </section>

      <section class="card">
        <h2>Change PIN</h2>
        <form class="form" method="post" action="/settings/pin">
          <label>
            Current PIN
            <input name="current" type="password" inputmode="numeric" autocomplete="current-password" pattern="\d{6}" maxlength={6} required />
          </label>
          <label>
            New PIN
            <input name="next" type="password" inputmode="numeric" autocomplete="new-password" pattern="\d{6}" maxlength={6} required />
          </label>
          <label>
            New PIN again
            <input name="nextConfirm" type="password" inputmode="numeric" autocomplete="new-password" pattern="\d{6}" maxlength={6} required />
          </label>
          <button class="save" type="submit">Change PIN</button>
        </form>

      </section>

      <form method="post" action="/logout" style="margin-top:22px">
        <button class="save plain" type="submit">Log out of this phone</button>
      </form>
    </Layout>
  );
}

const page = (c: Context<AppEnv>, message?: string, status: 200 | 400 = 200) => c.html(<SettingsPage c={c} message={message} />, status);

settings.get("/settings", (c) => page(c));

settings.post("/settings/profiles", async (c) => {
  const name = cleanName(String((await c.req.parseBody()).name ?? ""));
  if (!name) return page(c, "Names can be 1–24 characters.", 400);
  await getDb(c.env).insert(profiles).values({ householdId: c.get("householdId"), name, createdAt: Date.now() });
  return c.redirect("/settings?ok=people");
});

settings.post("/settings/profiles/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const name = cleanName(String((await c.req.parseBody()).name ?? ""));
  const where = and(eq(profiles.id, id), eq(profiles.householdId, c.get("householdId")));
  if (!Number.isInteger(id) || !(await getDb(c.env).query.profiles.findFirst({ where }))) return c.notFound();
  if (!name) return page(c, "Names can be 1–24 characters.", 400);
  await getDb(c.env).update(profiles).set({ name }).where(where);
  return c.redirect("/settings?ok=people");
});

settings.post("/settings/categories/:id", async (c) => {
  const body = await c.req.parseBody();
  const result = await renameCategory(c.env, c.get("householdId"), Number(c.req.param("id")), String(body.name ?? ""), String(body.emoji ?? ""));
  if (result === "not-found") return c.notFound();
  if (result === "exists") return page(c, "That category already exists.", 400);
  if (result === "invalid") return page(c, "Category names can be 1–24 characters.", 400);
  return c.redirect("/settings?ok=cat");
});

settings.post("/settings/categories/:id/hidden", async (c) => {
  const hidden = String((await c.req.parseBody()).hidden ?? "") === "1";
  if (!(await setCategoryHidden(c.env, c.get("householdId"), Number(c.req.param("id")), hidden))) return c.notFound();
  return c.redirect("/settings?ok=cat");
});

settings.post("/settings/pin", async (c) => {
  const body = await c.req.parseBody();
  const [current, next, confirm] = [body.current, body.next, body.nextConfirm].map((v) => String(v ?? ""));
  const householdId = c.get("householdId");
  const h = (await getDb(c.env).query.households.findFirst({ where: eq(households.id, householdId) }))!;
  const now = Date.now();
  const a = await attemptPin(c.env, h, current, now);
  if (!a.ok) return page(c, a.lockedUntil ? `Too many tries. Try again at ${clockTime(a.lockedUntil)}.` : "Current PIN didn't match.", 400);
  if (!isValidPin(next)) return page(c, "PIN must be 6 digits.", 400);
  if (next !== confirm) return page(c, "PINs don't match. Try again?", 400);
  const { hash, salt } = await hashPin(c.env.PIN_PEPPER, next);
  await getDb(c.env).update(households).set({ pinHash: hash, pinSalt: salt }).where(eq(households.id, householdId));
  await deleteOtherSessions(c.env, householdId, getCookie(c, SESSION_COOKIE) ?? "");
  return c.redirect("/settings?ok=pin");
});
