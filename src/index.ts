import { Hono } from "hono";
import { count } from "drizzle-orm";
import { getDb } from "./db/client";
import { households } from "./db/schema";
import type { AppEnv, Env } from "./env";
import { requireProfile, requireSession } from "./middleware/auth";
import { auth } from "./routes/auth";

const app = new Hono<AppEnv>();

app.get("/healthz", async (c) => {
  const [row] = await getDb(c.env).select({ n: count() }).from(households);
  return c.json({ ok: true, households: row.n });
});

app.route("/", auth);

app.use("/api/*", requireSession, requireProfile);
app.get("/", requireSession, requireProfile, (c) => c.text("add screen coming soon"));

async function scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext) {}

export { app };
export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
