import { expect, it } from "vitest";
import { households } from "../src/db/schema";
import { db, form, html, req, seedHousehold } from "./helpers";

it("keeps setup open until 15 households exist, then closes it", async () => {
  for (let i = 0; i < 14; i++) await seedHousehold();
  const open = await html(await req("/setup"));
  expect(open).not.toContain("kop.it is full right now");
  expect(open).toContain('class="wm big"'); // set up wears the log-in frame
  expect(open).not.toContain('<header class="top">');
  await seedHousehold();
  const full = await html(await req("/setup"));
  expect(full).toContain("kop.it is full right now");
  expect(full).toContain('class="wm big"');
  const res = await req("/setup", form({ username: "late", pin: "482913", pinConfirm: "482913" }));
  expect(await html(res)).toContain("kop.it is full right now");
  expect(await db().select().from(households)).toHaveLength(15);
});
