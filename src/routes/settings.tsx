import { Hono } from "hono";
import type { Context } from "hono";
import { and, count, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { entries, households, profiles } from "../db/schema";
import type { AppEnv } from "../env";
import { cleanName, listCategories, renameCategory, setCategoryHidden } from "../lib/categories";
import { getCookie } from "hono/cookie";
import { deleteHousehold } from "../lib/households";
import { attemptPin } from "../lib/login";
import { PROFILE_COOKIE, SESSION_COOKIE, clearCookie, deleteOtherSessions } from "../lib/session";
import { hashPin, isValidPin } from "../lib/pin";
import { clockTime } from "../lib/time";
import { requireProfile, requireSession } from "../middleware/auth";
import { Avatar, Welcome } from "../views/garden";
import { InlineScript, Layout } from "../views/layout";
import { REPO_URL } from "./guide";
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

      <section class="card">
        <h2>Help and info</h2>
        <div class="chips">
          <a class="chip" href="/guide">📖 Guide</a>
          <a class="chip" href="/privacy">Privacy</a>
          <a class="chip" href="/terms">Terms</a>
        </div>
        <p class="muted">
          Want to help, or found a problem? <a href={REPO_URL}>kop.it is on GitHub</a>.
        </p>
      </section>

      <form method="post" action="/logout" style="margin-top:22px">
        <button class="save plain" type="submit">Log out of this phone</button>
      </form>
      {/* Kept out of the way on purpose: small, grey, last, and behind its own page with two confirmations. */}
      <p class="far-away">
        <a href="/settings/delete">Delete household…</a>
      </p>
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

// ---------- deleting the household: a page of its own, the PIN again, and DELETE typed out ----------

async function DeletePage({ c, message }: { c: Context<AppEnv>; message?: string }) {
  const householdId = c.get("householdId");
  const db = getDb(c.env);
  const [home, people, spent] = await Promise.all([
    db.select({ username: households.username }).from(households).where(eq(households.id, householdId)).get(),
    householdProfiles(c.env, householdId),
    db.select({ n: count() }).from(entries).where(eq(entries.householdId, householdId)).get(),
  ]);
  const n = spent?.n ?? 0;
  return (
    <Layout title="Delete household" profileName={c.get("profileName")} profileIndex={c.get("profileIndex")}>
      <p>
        <a href="/settings">‹ Garden shed</a>
      </p>
      <h1>Delete the {home?.username} household?</h1>
      <section class="card danger-card">
        <p>This erases everything, for everyone in the household:</p>
        <ul>
          <li>
            {people.length === 1 ? "1 person" : `${people.length} people`}: {people.map((p) => p.name).join(", ")}
          </li>
          <li>{n === 0 ? "no expenses yet" : n === 1 ? "1 expense, with its note" : `${n} expenses, with their notes`}</li>
          <li>your categories</li>
          <li>the garden: every leaf, flower and month, and the Wrapped recaps</li>
        </ul>
        <p>
          Every phone is logged out. <b>This can't be undone in the app.</b>
        </p>
      </section>
      {message && <p class="msg">{message}</p>}
      <form class="form delete-form" method="post" action="/settings/delete">
        <label>
          Household PIN
          <input name="pin" type="password" inputmode="numeric" autocomplete="current-password" pattern="\d{6}" maxlength={6} required />
        </label>
        <label>
          Type DELETE to confirm
          <input name="confirm" autocomplete="off" autocapitalize="characters" spellcheck={false} pattern="DELETE" required />
        </label>
        <button class="save danger" type="submit">
          Delete household forever
        </button>
      </form>
      <a class="save plain" href="/settings" style="text-align:center;text-decoration:none">
        Keep my household
      </a>
    </Layout>
  );
}

/** Shown once, right after the delete: also clears what this phone kept (offline copy, unsent expenses, notes). */
function DeletedPage() {
  return (
    <Layout title="Household deleted" bare>
      <Welcome />
      <h1>Your household was deleted</h1>
      <p class="muted">Everything in it is gone from kop.it, and every phone is logged out. Thanks for gardening with us.</p>
      <a class="save" href="/setup" style="text-align:center;text-decoration:none;margin-top:14px">
        Start a new household
      </a>
      <InlineScript code="try{if(self.caches)caches.delete('kopit-v1');if(self.indexedDB)indexedDB.deleteDatabase('kopit');for(var k of Object.keys(localStorage))if(k.indexOf('kopit')===0)localStorage.removeItem(k)}catch(e){}" />
    </Layout>
  );
}

const deletePage = (c: Context<AppEnv>, message?: string, status: 200 | 400 = 200) => c.html(<DeletePage c={c} message={message} />, status);

settings.get("/settings/delete", (c) => deletePage(c));

settings.post("/settings/delete", async (c) => {
  const body = await c.req.parseBody();
  // The typed word first, so a typo doesn't use up one of the PIN tries.
  if (String(body.confirm ?? "").trim() !== "DELETE") return deletePage(c, "Type DELETE in capitals to confirm.", 400);
  const householdId = c.get("householdId");
  const h = (await getDb(c.env).query.households.findFirst({ where: eq(households.id, householdId) }))!;
  const a = await attemptPin(c.env, h, String(body.pin ?? ""), Date.now());
  if (!a.ok) return deletePage(c, a.lockedUntil ? `Too many tries. Try again at ${clockTime(a.lockedUntil)}.` : "That PIN didn't match.", 400);
  await deleteHousehold(c.env, householdId);
  clearCookie(c, SESSION_COOKIE);
  clearCookie(c, PROFILE_COOKIE);
  return c.html(<DeletedPage />);
});
