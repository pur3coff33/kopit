import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { verifyLogin } from "../lib/login";
import { PROFILE_COOKIE, SESSION_COOKIE, clearCookie, createSession, deleteSession, setLongCookie } from "../lib/session";
import { clockTime } from "../lib/time";
import { PinInput } from "../views/components";
import { Welcome } from "../views/garden";
import { InlineScript, Layout } from "../views/layout";

export const auth = new Hono<AppEnv>();

/**
 * The way in leads with starting a garden, for whoever lands here new; logging in waits under "Already growing?",
 * and opens on its own when it has something to say (a wrong PIN) or a username to keep.
 */
function LoginPage(props: { username?: string; message?: string; bye?: boolean }) {
  const back = Boolean(props.message || props.username);
  return (
    <Layout title="Log in" bare roof="day">
      <Welcome small />
      <p class="pitch">Log what you spend in a few seconds. Spend a little less, and a plant grows for the whole household.</p>
      <ul class="perks">
        <li>
          <b>Quick</b>a few taps, even offline
        </li>
        <li>
          <b>Shared</b>everyone, their own phone
        </li>
        <li>
          <b>Kind</b>it rewards, never scolds
        </li>
      </ul>
      <a class="save" href="/setup">
        Start your garden
      </a>
      <p class="or">
        <i></i>Already growing?<i></i>
      </p>
      <details class="login" open={back}>
        <summary>Log in</summary>
        {props.message && <p class="msg">{props.message}</p>}
        <form class="form" method="post" action="/login">
          <label>
            Username
            <input name="username" autocomplete="username" autocapitalize="none" spellcheck={false} required value={props.username ?? ""} />
          </label>
          <label>
            PIN
            <PinInput name="pin" />
          </label>
          <button class="save" type="submit">Open the garden</button>
        </form>
      </details>
      <p class="fine">
        <a href="/guide">Guide</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
      </p>
      {props.bye && <InlineScript code="if(self.caches)caches.open('kopit-v2').then(function(c){return c.delete('/')})" />}
    </Layout>
  );
}

auth.get("/login", (c) => c.html(<LoginPage bye={c.req.query("bye") === "1"} />));

auth.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const username = String(body.username ?? "");
  const result = await verifyLogin(c.env, username, String(body.pin ?? ""), Date.now());
  if (result.ok) {
    setLongCookie(c, SESSION_COOKIE, await createSession(c.env, result.householdId, Date.now()));
    return c.redirect("/profile");
  }
  const message =
    result.reason === "locked"
      ? `Too many tries. Try again at ${clockTime(result.lockedUntil)}.`
      : "That PIN didn't match. Try again?";
  return c.html(<LoginPage username={username} message={message} />);
});

auth.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deleteSession(c.env, token);
  clearCookie(c, SESSION_COOKIE);
  clearCookie(c, PROFILE_COOKIE);
  return c.redirect("/login?bye=1");
});
