import { Hono } from "hono";
import type { Context } from "hono";
import { and, count, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { entries, households, profiles } from "../db/schema";
import type { AppEnv } from "../env";
import { cleanName } from "../lib/categories";
import { getCookie } from "hono/cookie";
import { deleteHousehold } from "../lib/households";
import { attemptPin } from "../lib/login";
import { PROFILE_COOKIE, SESSION_COOKIE, clearCookie, deleteOtherSessions } from "../lib/session";
import { hashPin, isValidPin } from "../lib/pin";
import { clockTime } from "../lib/time";
import { requireProfile, requireSession } from "../middleware/auth";
import { Back, PinInput, TitleCard } from "../views/components";
import { Avatar, Welcome } from "../views/garden";
import { InlineScript, Layout } from "../views/layout";
import { Tour } from "../views/tour";
import { safeBack } from "./entries";
import { REPO_URL } from "./guide";
import { householdProfiles } from "./setup";

export const settings = new Hono<AppEnv>();

settings.use("/settings", requireSession, requireProfile);
settings.use("/settings/*", requireSession, requireProfile);

const OK: Record<string, string> = {
  people: "Saved.",
  pin: "PIN changed. Other phones will need to log in again with the new PIN.",
};

/** Which part of the shed starts open: a person's name box (by id), the new person's, or Change PIN. */
type Open = number | "add" | "pin";

/** A row of the help list: an icon, a name with a line under it, and a chevron. */
function Link({ icon, href, name, sub }: { icon: string; href: string; name: string; sub?: string }) {
  return (
    <a class="link" href={href}>
      <span class="ic" aria-hidden="true">
        {icon}
      </span>
      <span class="t">
        {name}
        {sub && <small>{sub}</small>}
      </span>
      <span class="chev" aria-hidden="true">
        ›
      </span>
    </a>
  );
}

async function SettingsPage({ c, message, open }: { c: Context<AppEnv>; message?: string; open?: Open }) {
  const householdId = c.get("householdId");
  const [people, home] = await Promise.all([
    householdProfiles(c.env, householdId),
    getDb(c.env).select({ username: households.username }).from(households).where(eq(households.id, householdId)).get(),
  ]);
  const ok = OK[c.req.query("ok") ?? ""];
  return (
    <Layout
      title="Garden shed"
      profileName={c.get("profileName")}
      profileIndex={c.get("profileIndex")}
      scripts={["/js/tour-page.js", "/js/shed.js"]}
      roof="day"
    >
      <Back href="/">Back</Back>
      <TitleCard kicker="Settings" place={home?.username} title="Garden shed" />
      {(message ?? ok) && <p class="msg">{message ?? ok}</p>}

      <div class="card gardener" data-spot="household">
        <Avatar index={c.get("profileIndex")} name={c.get("profileName")} size={42} />
        <div>
          <b>{c.get("profileName")}</b>
          <span class="muted">This phone's gardener</span>
        </div>
        <a class="chip" href="/profile">
          Switch
        </a>
      </div>

      {/* Each person is a row; their ✎ turns it into a name box with Save (/js/shed.js). */}
      <section class="card" data-spot="household">
        <h2>People</h2>
        <ul class="people">
          {people.map((p, i) => (
            <li class={open === p.id ? "editing" : undefined}>
              <Avatar index={i} name={p.name} size={38} />
              <span class="n">
                {p.name}
                {p.id === c.get("profileId") && <small>This phone</small>}
              </span>
              <button class="edit" type="button" data-edit="" aria-label={`Rename ${p.name}`}>
                ✎
              </button>
              <form class="rename" method="post" action={`/settings/profiles/${p.id}`}>
                <input name="name" value={p.name} maxlength={24} required aria-label={`New name for ${p.name}`} />
                <button class="ok" type="submit">
                  Save
                </button>
              </form>
            </li>
          ))}
          <li class={open === "add" ? "add editing" : "add"}>
            <button class="new" type="button" data-edit="">
              <span class="plus" aria-hidden="true">
                +
              </span>
              <span class="n">Add a person</span>
            </button>
            <form class="rename" method="post" action="/settings/profiles">
              <input name="name" maxlength={24} required placeholder="Their name" aria-label="New person" />
              <button class="ok" type="submit">
                Add
              </button>
            </form>
          </li>
        </ul>
      </section>

      <section class="card fold" data-spot="pin">
        <details open={open === "pin"}>
          <summary>
            <h2>
              Change PIN
              <small>The 6 digits everyone logs in with</small>
            </h2>
            <span class="dots" aria-hidden="true">
              <i></i>
              <i></i>
              <i></i>
              <i></i>
              <i></i>
              <i></i>
            </span>
            <span class="chev" aria-hidden="true">
              ›
            </span>
          </summary>
          <form class="form" method="post" action="/settings/pin">
            <label>
              Current PIN
              <PinInput name="current" />
            </label>
            <label>
              New PIN
              <PinInput name="next" />
            </label>
            <label>
              New PIN again
              <PinInput name="nextConfirm" />
            </label>
            <button class="save" type="submit">Change PIN</button>
          </form>
        </details>
      </section>

      <section class="card">
        <h2>Help and info</h2>
        <div class="links">
          <Link icon="📖" href="/guide" name="Guide" sub="How the garden grows" />
          <Link icon="🌿" href="/privacy" name="Privacy" sub="What kop.it keeps, in plain words" />
          <Link icon="📜" href="/terms" name="Terms" />
          <Link icon="🛠️" href={REPO_URL} name="kop.it on GitHub" sub="Help out, or tell us what broke" />
        </div>
      </section>

      <form method="post" action="/logout" style="margin-top:22px">
        <button class="save plain" type="submit">Log out of this phone</button>
      </form>
      {/* Kept out of the way on purpose: small, grey, last, and behind its own page with two confirmations. */}
      <p class="far-away">
        <a href="/settings/delete">Delete household…</a>
      </p>
      <Tour screen="shed" profileId={c.get("profileId")} profileName={c.get("profileName")} seen={c.get("toursSeen")} />
    </Layout>
  );
}

const page = (c: Context<AppEnv>, message?: string, status: 200 | 400 = 200, open?: Open) =>
  c.html(<SettingsPage c={c} message={message} open={open} />, status);

settings.get("/settings", (c) => page(c));

settings.post("/settings/profiles", async (c) => {
  const name = cleanName(String((await c.req.parseBody()).name ?? ""));
  if (!name) return page(c, "Names can be 1–24 characters.", 400, "add");
  await getDb(c.env).insert(profiles).values({ householdId: c.get("householdId"), name, createdAt: Date.now() });
  return c.redirect("/settings?ok=people");
});

settings.post("/settings/profiles/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const name = cleanName(String((await c.req.parseBody()).name ?? ""));
  const where = and(eq(profiles.id, id), eq(profiles.householdId, c.get("householdId")));
  if (!Number.isInteger(id) || !(await getDb(c.env).query.profiles.findFirst({ where }))) return c.notFound();
  if (!name) return page(c, "Names can be 1–24 characters.", 400, id);
  await getDb(c.env).update(profiles).set({ name }).where(where);
  return c.redirect("/settings?ok=people");
});

// The eye by the totals. Per person, so it follows them to any phone they pick themselves on.
settings.post("/settings/amounts", async (c) => {
  const body = await c.req.parseBody();
  await getDb(c.env)
    .update(profiles)
    .set({ hideAmounts: String(body.hide ?? "") === "1" })
    .where(and(eq(profiles.id, c.get("profileId")), eq(profiles.householdId, c.get("householdId"))));
  return c.redirect(safeBack(body.back) ?? "/spending");
});

settings.post("/settings/pin", async (c) => {
  const body = await c.req.parseBody();
  const [current, next, confirm] = [body.current, body.next, body.nextConfirm].map((v) => String(v ?? ""));
  const householdId = c.get("householdId");
  const h = (await getDb(c.env).query.households.findFirst({ where: eq(households.id, householdId) }))!;
  const now = Date.now();
  const a = await attemptPin(c.env, h, current, now);
  if (!a.ok) return page(c, a.lockedUntil ? `Too many tries. Try again at ${clockTime(a.lockedUntil)}.` : "Current PIN didn't match.", 400, "pin");
  if (!isValidPin(next)) return page(c, "PIN must be 6 digits.", 400, "pin");
  if (next !== confirm) return page(c, "PINs don't match. Try again?", 400, "pin");
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
    <Layout title="Delete household" profileName={c.get("profileName")} profileIndex={c.get("profileIndex")} roof="dusk">
      <Back href="/settings">Garden shed</Back>
      <TitleCard kicker="Garden shed" place="Delete" title={`Delete ${home?.username}?`} sub="Read this first. There's no undo." />
      <section class="card danger-card">
        <p>This erases everything, for everyone in the household:</p>
        <ul>
          <li>
            {people.length === 1 ? "1 person" : `${people.length} people`}: {people.map((p) => p.name).join(", ")}
          </li>
          <li>{n === 0 ? "no expenses yet" : n === 1 ? "1 expense, with its note" : `${n} expenses, with their notes`}</li>
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
          <PinInput name="pin" />
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
      <InlineScript code="try{if(self.caches)caches.delete('kopit-v2');if(self.indexedDB)indexedDB.deleteDatabase('kopit');for(var k of Object.keys(localStorage))if(k.indexOf('kopit')===0)localStorage.removeItem(k)}catch(e){}" />
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
