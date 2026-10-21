import { Hono } from "hono";
import type { AppEnv } from "../env";
import { gardenMonths, monthName } from "../lib/garden";
import { monthStart, toDateInput } from "../lib/time";
import { requireProfile, requireSession } from "../middleware/auth";
import { Plant } from "../views/garden";
import { Layout } from "../views/layout";

export const gallery = new Hono<AppEnv>();
gallery.use("/gallery", requireSession, requireProfile);

/** Every month's plant since the household began, newest first. Each opens that month's garden. */
gallery.get("/gallery", async (c) => {
  const now = Date.now();
  const months = (await gardenMonths(c.env, c.get("householdId"), c.get("householdCreatedAt"), now)).reverse();
  const current = monthStart(now);
  return c.html(
    <Layout title="Gallery" tab="spending" profileName={c.get("profileName")} profileIndex={c.get("profileIndex")}>
      <p>
        <a href="/spending">‹ Garden</a>
      </p>
      <h1>Gallery</h1>
      <p class="muted">Every month's plant: a leaf for each good day, a small flower for each perfect one.</p>
      <div class="gallery">
        {months.map((m) => {
          const growing = m.start === current;
          const year = toDateInput(m.start).slice(0, 4);
          const href = growing ? "/spending" : `/spending?range=custom&from=${toDateInput(m.start)}&to=${toDateInput(m.end - 1)}&who=all`;
          return (
            <a class={growing ? "month-card growing" : "month-card"} href={href}>
              <Plant leaves={m.goodDays} perfect={m.perfectDays} bloom={m.bloomed} width={84} />
              <b>
                {monthName(m.start)} {year}
                {growing ? " (growing)" : ""}
              </b>
              <span>
                {m.goodDays} good day{m.goodDays === 1 ? "" : "s"}
                {m.bloomed ? " · 🌸" : ""}
              </span>
            </a>
          );
        })}
      </div>
    </Layout>,
  );
});
