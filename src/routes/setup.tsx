import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { profiles } from "../db/schema";
import type { AppEnv, Env } from "../env";
import { createHousehold, isFull } from "../lib/households";
import { PROFILE_COOKIE, SESSION_COOKIE, createSession, setLongCookie } from "../lib/session";
import { requireSession } from "../middleware/auth";
import { Avatar, Welcome } from "../views/garden";
import { PinInput, TitleCard } from "../views/components";
import { Layout } from "../views/layout";

export const setup = new Hono<AppEnv>();

const MESSAGES = {
  "bad-username": "Username must be 3–32 letters, numbers, dots, dashes or underscores.",
  "bad-pin": "PIN must be 6 digits.",
  mismatch: "PINs don't match. Try again?",
  taken: "That username is taken. Try another?",
} as const;

export function householdProfiles(env: Env, householdId: number) {
  return getDb(env).select().from(profiles).where(eq(profiles.householdId, householdId)).orderBy(asc(profiles.id));
}

function Full() {
  return (
    <Layout title="Set up" bare>
      <Welcome />
      <h1>kop.it is full right now</h1>
      <p class="muted">No new households can be created. Already have one?</p>
      <a class="save plain" href="/login" style="text-align:center;text-decoration:none">
        Log in
      </a>
    </Layout>
  );
}

function SetupPage(props: { username?: string; message?: string }) {
  return (
    <Layout title="Set up" bare roof="day">
      <Welcome small />
      <TitleCard
        kicker="Step 1 of 2"
        place="The household"
        title="Start a garden"
        sub="Pick a username and a 6-digit PIN. Everyone in the household logs in with the same two."
      />
      {props.message && <p class="msg">{props.message}</p>}
      <form class="form" method="post" action="/setup">
        <label>
          Username
          <input name="username" autocomplete="username" autocapitalize="none" spellcheck={false} required value={props.username ?? ""} />
        </label>
        <label>
          6-digit PIN
          <PinInput name="pin" />
        </label>
        <label>
          PIN again
          <PinInput name="pinConfirm" />
        </label>
        <button class="save" type="submit">
          Create household
        </button>
      </form>
      <p class="muted">
        Already set up? <a href="/login">Log in</a>
      </p>
      <p class="fine">
        Creating a household means you agree to the <a href="/terms">terms</a> and <a href="/privacy">privacy policy</a>.
      </p>
    </Layout>
  );
}

setup.get("/setup", async (c) => c.html((await isFull(c.env)) ? <Full /> : <SetupPage />));

setup.post("/setup", async (c) => {
  const body = await c.req.parseBody();
  const input = { username: String(body.username ?? ""), pin: String(body.pin ?? ""), pinConfirm: String(body.pinConfirm ?? "") };
  const result = await createHousehold(c.env, input, Date.now());
  if (result.ok) {
    setLongCookie(c, SESSION_COOKIE, await createSession(c.env, result.householdId, Date.now()));
    return c.redirect("/setup/profiles");
  }
  if (result.reason === "closed") return c.html(<Full />);
  return c.html(<SetupPage username={input.username} message={MESSAGES[result.reason]} />);
});

function ProfilesPage(props: { names: string[]; message?: string }) {
  return (
    <Layout title="People" roof="day">
      <TitleCard kicker="Step 2 of 2" place="The people" title="Who's in it?" sub="Add one name per person. Each phone picks one." />
      {props.names.length > 0 && (
        <ul class="rows">
          {props.names.map((n, i) => (
            <li class="row">
              <Avatar index={i} name={n} size={34} />
              <span class="mid">{n}</span>
            </li>
          ))}
        </ul>
      )}
      {props.message && <p class="msg">{props.message}</p>}
      <form class="form inline" method="post" action="/setup/profiles">
        <label>
          Name
          <input name="name" maxlength={24} required autocomplete="off" />
        </label>
        <button class="save" type="submit">
          Add
        </button>
      </form>
      {props.names.length > 0 && (
        <a class="save" href="/profile" style="text-align:center;text-decoration:none;margin-top:18px">
          Done
        </a>
      )}
    </Layout>
  );
}

setup.get("/setup/profiles", requireSession, async (c) => {
  const ps = await householdProfiles(c.env, c.get("householdId"));
  return c.html(<ProfilesPage names={ps.map((p) => p.name)} />);
});

setup.post("/setup/profiles", requireSession, async (c) => {
  const name = String((await c.req.parseBody()).name ?? "").trim();
  if (name.length < 1 || name.length > 24) {
    const ps = await householdProfiles(c.env, c.get("householdId"));
    return c.html(<ProfilesPage names={ps.map((p) => p.name)} message="Names can be 1–24 characters." />);
  }
  await getDb(c.env).insert(profiles).values({ householdId: c.get("householdId"), name, createdAt: Date.now() });
  return c.redirect("/setup/profiles");
});

setup.get("/profile", requireSession, async (c) => {
  const ps = await householdProfiles(c.env, c.get("householdId"));
  if (ps.length === 0) return c.redirect("/setup/profiles");
  // Everyone's flower in a pot, three to a shelf, and an empty pot at the end for someone new.
  const pots = [
    ...ps.map((p, i) => (
      <form method="post" action="/profile">
        <input type="hidden" name="profileId" value={String(p.id)} />
        <button class="who-card" type="submit" style={`--i:${i}`}>
          <Avatar index={i} name={p.name} size={64} />
          <span class="stem"></span>
          <span class="pot"></span>
          <span class="tag">{p.name}</span>
        </button>
      </form>
    )),
    <a class="who-card add" href="/setup/profiles" style={`--i:${ps.length}`}>
      <span class="plus" aria-hidden="true">
        +
      </span>
      <span class="pot"></span>
      <span class="tag">Add a person</span>
    </a>,
  ];
  return c.html(
    <Layout title="Who are you?" roof="day">
      <TitleCard kicker="This phone" title="Who's gardening?" sub="Tap your flower. Each phone remembers its gardener." />
      {Array.from({ length: Math.ceil(pots.length / 3) }, (_, r) => (
        <div class="flower-shelf">
          <div class="pick">{pots.slice(r * 3, r * 3 + 3)}</div>
          <div class="g-plank"></div>
        </div>
      ))}
    </Layout>,
  );
});

setup.post("/profile", requireSession, async (c) => {
  const raw = String((await c.req.parseBody()).profileId ?? "");
  const id = /^\d+$/.test(raw) ? Number(raw) : -1;
  const p = await getDb(c.env).query.profiles.findFirst({
    where: and(eq(profiles.id, id), eq(profiles.householdId, c.get("householdId"))),
  });
  if (!p) return c.text("Unknown profile", 400);
  setLongCookie(c, PROFILE_COOKIE, String(p.id));
  // ?fresh makes the service worker fetch a new add screen instead of the saved one (which has the old profile).
  return c.redirect("/?fresh=1");
});
