import { expect, it } from "vitest";
import { households } from "../src/db/schema";
import { db, form, html, req, seedHousehold } from "./helpers";

it("closes setup once 5 households exist", async () => {
  for (let i = 0; i < 5; i++) await seedHousehold();
  expect(await html(await req("/setup"))).toContain("kopit is full right now");
  const res = await req("/setup", form({ username: "late", pin: "482913", pinConfirm: "482913" }));
  expect(await html(res)).toContain("kopit is full right now");
  expect(await db().select().from(households)).toHaveLength(5);
});
