import { Hono } from "hono";
import { count } from "drizzle-orm";
import { getDb } from "./db/client";
import { households } from "./db/schema";
import type { AppEnv, Env } from "./env";
import { requireProfile, requireSession } from "./middleware/auth";
import { add } from "./routes/add";
import { api } from "./routes/api";
import { auth } from "./routes/auth";
import { entriesRoutes } from "./routes/entries";
import { setup } from "./routes/setup";
import { spending } from "./routes/spending";

const app = new Hono<AppEnv>();

app.get("/healthz", async (c) => {
  const [row] = await getDb(c.env).select({ n: count() }).from(households);
  return c.json({ ok: true, households: row.n });
});

app.route("/", auth);
app.route("/", setup);

app.use("/api/*", requireSession, requireProfile);
app.route("/api", api);
app.route("/", add);
app.route("/", spending);
app.route("/", entriesRoutes);

async function scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext) {}

export { app };
export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
