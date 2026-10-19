import { describe, expect, it } from "vitest";
import { authCookie, html, req, seedHousehold } from "./helpers";

describe("add screen", () => {
  it("shows the top 7 tiles, More, the full sheet and the keypad", async () => {
    const { householdId, profileIds } = await seedHousehold();
    const res = await req("/", { cookie: await authCookie(householdId, profileIds[1]) });
    expect(res.status).toBe(200);
    const body = await html(res);
    const tiles = body.slice(body.indexOf('id="tiles"'), body.indexOf('id="sheet"'));
    const names = [...tiles.matchAll(/data-name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(["Groceries", "Food", "Transport", "Bills", "Home", "Health", "Shopping"]);
    expect(tiles).toContain("More");
    const sheet = body.slice(body.indexOf('id="sheet"'));
    expect([...sheet.matchAll(/data-name="([^"]+)"/g)]).toHaveLength(12);
    expect(body).toContain(`data-profile-id="${profileIds[1]}"`);
    expect(body).toContain("Save it ✓");
    expect(body).toContain('src="/js/add.js"');
    expect(body).toContain("Partner");
  });
});
