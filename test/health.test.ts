import { expect, it } from "vitest";
import { req } from "./helpers";

it("GET /healthz reports the database is reachable", async () => {
  const res = await req("/healthz");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, households: 0 });
});
