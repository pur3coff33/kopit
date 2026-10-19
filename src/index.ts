import { Hono } from "hono";
import { count } from "drizzle-orm";
import { getDb } from "./db/client";
import { households } from "./db/schema";
import type { AppEnv, Env } from "./env";

const app = new Hono<AppEnv>();

app.get("/healthz", async (c) => {
  const [row] = await getDb(c.env).select({ n: count() }).from(households);
  return c.json({ ok: true, households: row.n });
});

async function scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext) {}

export { app };
export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
