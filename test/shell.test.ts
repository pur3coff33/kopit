import { describe, expect, it } from "vitest";
import { authCookie, html, req, seedHousehold } from "./helpers";

async function authed(path: string, profile = 0) {
  const h = await seedHousehold();
  return html(await req(path, { cookie: await authCookie(h.householdId, h.profileIds[profile]) }));
}

describe("app shell", () => {
  it("is called kop.it in every title", async () => {
    expect(await html(await req("/login"))).toContain("<title>Log in · kop.it</title>");
    expect(await authed("/")).toContain("<title>kop.it</title>");
  });

  it("puts garden, the big Add button and history in the bottom bar, in that order", async () => {
    const body = await authed("/");
    const nav = body.slice(body.indexOf("<nav"));
    const at = [nav.indexOf('href="/spending"'), nav.indexOf('aria-label="Add"'), nav.indexOf('href="/history"')];
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("highlights the garden tab on the spending page", async () => {
    const body = await authed("/spending");
    expect(body).toMatch(/<a href="\/spending" class="tab on"[^>]*>[\s\S]*?garden<\/a>/);
  });

  it("shows the person's own flower in the header", async () => {
    const body = await authed("/", 1);
    const me = body.slice(body.indexOf('class="me"'), body.indexOf("</header>"));
    expect(me).toContain('href="/settings"');
    expect(me).toContain("#F0A3B5"); // the household's 2nd person gets the pink blossom
    expect(me).toContain("<span>Partner</span>");
  });
});
