import { Hono } from "hono";
import { count } from "drizzle-orm";
import { runBackup } from "./backup";
import { getDb } from "./db/client";
import { households } from "./db/schema";
import type { AppEnv, Env } from "./env";
import { noteVersion, version } from "./lib/version";
import { requireProfile, requireSession } from "./middleware/auth";
import { add } from "./routes/add";
import { api } from "./routes/api";
import { auth } from "./routes/auth";
import { entriesRoutes } from "./routes/entries";
import { gallery } from "./routes/gallery";
import { guide } from "./routes/guide";
import { wrapped } from "./routes/wrapped";
import { history } from "./routes/history";
import { legal } from "./routes/legal";
import { settings } from "./routes/settings";
import { setup } from "./routes/setup";
import { spending } from "./routes/spending";

const app = new Hono<AppEnv>();

app.use(async (c, next) => {
  noteVersion(c.env);
  await next();
});

app.get("/healthz", async (c) => {
  const [row] = await getDb(c.env).select({ n: count() }).from(households);
  return c.json({ ok: true, households: row.n });
});

// Asked by an open app (public/js/update.js) to spot a newer deploy; never from a cache, or it would never see one.
app.get("/version", (c) => c.json({ version: version() }, 200, { "Cache-Control": "no-store" }));

app.route("/", auth);
app.route("/", setup);
app.route("/", guide);
app.route("/", legal);

app.use("/api/*", requireSession, requireProfile);
app.route("/api", api);
app.route("/", add);
app.route("/", spending);
app.route("/", history);
app.route("/", gallery);
app.route("/", wrapped);
app.route("/", entriesRoutes);
app.route("/", settings);

// Nightly backup to R2 — only runs once a BACKUPS bucket and a cron trigger are configured (see README).
async function scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
  const bucket = env.BACKUPS;
  if (bucket) ctx.waitUntil(runBackup({ ...env, BACKUPS: bucket }, Date.now()));
}

export { app };
export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
