import { Hono } from "hono";
import type { AppEnv } from "../env";
import { gardenMonths, monthName } from "../lib/garden";
import { monthStart, toDateInput } from "../lib/time";
import { requireProfile, requireSession } from "../middleware/auth";
import { plural } from "../lib/aligned";
import { Back, PotShelves, TitleCard } from "../views/components";
import { Plant } from "../views/garden";
import { Layout } from "../views/layout";

export const gallery = new Hono<AppEnv>();
gallery.use("/gallery", requireSession, requireProfile);

/** Every month's plant since the household began, newest first, three to a greenhouse shelf. Each opens that month's garden. */
gallery.get("/gallery", async (c) => {
  const now = Date.now();
  const months = (await gardenMonths(c.env, c.get("householdId"), c.get("householdCreatedAt"), now)).reverse();
  const current = monthStart(now);
  return c.html(
    <Layout title="Gallery" tab="spending" profileName={c.get("profileName")} profileIndex={c.get("profileIndex")} roof="day">
      <Back href="/spending">Garden</Back>
      <TitleCard kicker="Garden" place="Every month" title="Gallery" sub="A leaf for each good day, a small flower for each perfect one." />
      <PotShelves
        items={months.map((m, i) => {
          const growing = m.start === current;
          const year = toDateInput(m.start).slice(0, 4);
          const href = growing ? "/spending" : `/spending?range=custom&from=${toDateInput(m.start)}&to=${toDateInput(m.end - 1)}&who=all`;
          return (
            <a class={growing ? "month-card growing" : "month-card"} href={href} style={`--i:${i}`}>
              <Plant leaves={m.goodDays} perfect={m.perfectDays} bloom={m.bloomed} width={84} />
              <span class="tag">
                <b>{monthName(m.start)}</b>
                <span>
                  {growing ? `${m.goodDays} so far` : `${year} · ${plural(m.goodDays, "good day")}`}
                  {m.bloomed ? " · 🌸" : ""}
                </span>
              </span>
            </a>
          );
        })}
      />
    </Layout>,
  );
});
