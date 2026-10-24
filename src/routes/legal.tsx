import { Hono } from "hono";
import type { Child } from "hono/jsx";
import type { AppEnv } from "../env";
import { Back, TitleCard } from "../views/components";
import { Layout } from "../views/layout";
import { REPO_URL } from "./guide";

export const legal = new Hono<AppEnv>();

const UPDATED = "October 24, 2026";

function LegalPage(props: { title: string; heading: string; children?: Child }) {
  return (
    <Layout title={props.title} roof="day">
      <Back href="/guide#legal">Guide</Back>
      <article class="legal">
        <TitleCard
          kicker="kop.it"
          place="Legal"
          title={props.heading}
          sub={`Last updated ${UPDATED}. Written in plain language; it hasn't been reviewed by a lawyer yet.`}
        />
        {props.children}
        <h2>Questions</h2>
        <p>
          Ask on <a href={`${REPO_URL}/issues`}>kop.it's GitHub page</a>. Please don't post your username, PIN or expenses
          there: issues are public.
        </p>
      </article>
    </Layout>
  );
}

legal.get("/privacy", (c) =>
  c.html(
    <LegalPage title="Privacy" heading="Privacy">
      <h2>Who runs kop.it</h2>
      <p>
        kop.it is an open-source project, maintained on <a href={REPO_URL}>GitHub</a>. Anyone can run their own copy. If
        someone else gave you the link to theirs, they run it, and they're the one who can see its database.
      </p>

      <h2>What kop.it keeps</h2>
      <ul>
        <li>Your household's username, and its PIN as a salted hash (never the PIN itself).</li>
        <li>The names of the people in the household, whether each one has hidden the total with the eye, and which screens' first-time tours they've seen.</li>
        <li>Every expense: the amount, its category, the optional note, who logged it and when.</li>
        <li>How each day's missions went (to grow the plant).</li>
        <li>Each day's note: a few lines about that day's spending, written by AI (see below).</li>
        <li>Logins (as hashed tokens) and failed PIN tries, to keep the household safe.</li>
        <li>When an expense is deleted, only its random id and the time, so an offline phone can't send it back.</li>
      </ul>
      <p>That's all. kop.it doesn't ask for an email, a phone number or your real name.</p>

      <h2>What stays on your phone</h2>
      <ul>
        <li>Two cookies: one keeps you logged in, the other remembers who the phone belongs to.</li>
        <li>Expenses saved without signal, until they're sent.</li>
        <li>A copy of the add screen, so it opens offline.</li>
        <li>Small notes like "this leaf was already celebrated", and the last weather, rounded location and town name for the sky.</li>
      </ul>

      <h2>Your location and the weather</h2>
      <p>
        The garden's sky asks for your location once. If you say yes, your phone rounds it to about a kilometre and asks{" "}
        <a href="https://open-meteo.com/en/terms">Open-Meteo</a> for the weather directly. To write your town's name across
        the sky, it also sends that rounded location to{" "}
        <a href="https://www.bigdatacloud.com/terms-of-use">BigDataCloud</a> once, and again only if you move a few
        kilometres. Your location is never sent to kop.it's server. Say no and nothing is sent anywhere; the sky just
        follows the clock.
      </p>

      <h2>Each day's note</h2>
      <p>
        To write a day's note, kop.it sends that day's expenses (amounts, categories, notes, and the names of who logged
        them) with a few totals it worked out to{" "}
        <a href="https://developers.cloudflare.com/workers-ai/platform/data-usage/">Workers AI</a>, run by Cloudflare,
        which also hosts kop.it. Cloudflare says it doesn't keep them after the note is written and doesn't use them to
        train AI. The note is kept with the household until the day's expenses change or the household is deleted.
      </p>

      <h2>Where it's stored</h2>
      <p>
        kop.it runs on Cloudflare, which hosts the app and its database and sees the internet traffic to it (such as IP
        addresses) as part of that. There are no ads, no analytics, no trackers, and nothing is sold or shared.
      </p>

      <h2>Who can see your data</h2>
      <p>
        Anyone with your household's username and PIN, and every phone logged in to it, can see and change all of its
        expenses. Whoever runs the copy can see the database.
      </p>

      <h2>How long it's kept, and deleting it</h2>
      <p>
        Everything is kept until you delete it. You can delete single expenses at any time, or the whole household from the
        garden shed: tap your name, then <b>Delete household</b> at the very bottom. That erases the household right away and
        logs out every phone.
      </p>
      <p>
        The database keeps its own restore history for up to 30 days, so a deleted household stays recoverable there for up
        to 30 days before it's gone for good. If nightly backups are turned on for a copy, they're kept for 30 days too.
      </p>

      <h2>Your rights</h2>
      <p>
        Under the Philippine Data Privacy Act of 2012, you can ask what's kept about you, have it corrected, have it erased,
        and object to how it's used. Most of this you can do in the app yourself: see and edit your expenses, rename people,
        or delete the household. You can also complain to the{" "}
        <a href="https://privacy.gov.ph">National Privacy Commission</a>.
      </p>

      <h2>Children</h2>
      <p>kop.it is made for households. Anyone under 18 should use it with a parent or guardian.</p>

      <h2>Changes</h2>
      <p>If this policy changes, the date at the top changes with it.</p>
    </LegalPage>,
  ),
);

legal.get("/terms", (c) =>
  c.html(
    <LegalPage title="Terms" heading="Terms">
      <p>By creating or using a household on kop.it, you agree to these terms.</p>

      <h2>What kop.it is</h2>
      <p>
        A free tool for a household to keep track of its own spending. Its code is open source under the{" "}
        <a href={`${REPO_URL}/blob/main/LICENSE`}>MIT License</a>.
      </p>

      <h2>Your household</h2>
      <ul>
        <li>Keep your username and PIN to yourselves. Anyone who has them can see and change everything in the household.</li>
        <li>You're responsible for what's logged in your household.</li>
        <li>Each copy of kop.it holds at most 15 households.</li>
      </ul>

      <h2>Not financial advice</h2>
      <p>
        Missions, leaves, blooms and each day's note are encouragement, not advice. A day's note is written by AI from
        kop.it's own numbers, and can still get things wrong. Totals are only as right as what's logged. For decisions that
        matter, check your own records.
      </p>

      <h2>No guarantees</h2>
      <p>
        kop.it is provided as it is, without warranties of any kind. It may have bugs, be unavailable at times, change, or
        stop. Data could be lost. To the extent the law allows, whoever runs kop.it isn't liable for losses that come from
        using it or not being able to.
      </p>

      <h2>Fair use</h2>
      <p>
        Don't try to get into other households, guess PINs, overload the service, or use it for anything unlawful. A
        household that does may be removed.
      </p>

      <h2>Ending</h2>
      <p>
        You can stop at any time, and delete your household from the garden shed. How deletion works is in the{" "}
        <a href="/privacy">privacy policy</a>.
      </p>

      <h2>Law</h2>
      <p>These terms follow the laws of the Philippines.</p>

      <h2>Changes</h2>
      <p>If these terms change, the date at the top changes with them. Using kop.it after that means you accept the new terms.</p>
    </LegalPage>,
  ),
);
