import { describe, expect, it } from "vitest";
import { GENTLE } from "../src/lib/gentle";
import { authCookie, html, req, seedHousehold } from "./helpers";

describe("guide", () => {
  it("opens without logging in, with every section", async () => {
    const res = await req("/guide");
    expect(res.status).toBe(200);
    const body = await html(res);
    expect(body).toContain("<title>Guide · kop.it</title>");
    for (const id of ["about", "plant", "sky", "missions", "help", "legal"]) expect(body, id).toContain(`id="${id}"`);
    for (const stage of ["Sprout", "A leaf a good day", "Perfect days", "On track", "Bloom"]) expect(body, stage).toContain(stage);
  });

  it("shows all eight skies, fixed, so the live weather script leaves them alone", async () => {
    const body = await html(await req("/guide"));
    for (const p of ["day", "night"]) for (const w of ["clear", "cloudy", "rain", "storm"]) expect(body).toContain(`data-phase="${p}" data-weather="${w}"`);
    expect(body).not.toContain("data-sky");
    expect(body).not.toContain("/js/sky.js");
  });

  it("lists every current mission with an example, and the starters a new household gets", async () => {
    const body = await html(await req("/guide"));
    for (const d of GENTLE) expect(body, d.type).toContain(d.name);
    expect(body).toContain("“Keep 🍜 Food under ₱300”");
    expect(body).toContain("“Keep merienda (2 to 5 pm) under ₱100”");
    expect(body).toContain("about 9 of 10");
    expect(body).toContain("While your garden is new");
    expect(body).toContain("“No single buy over ₱1,000”");
    expect(body).toContain("“Keep today under ₱1,500”");
    expect(body).not.toContain("Nothing spent");
  });

  it("links GitHub for help, privately for security, and the legal pages", async () => {
    const body = await html(await req("/guide"));
    expect(body).toContain('href="https://github.com/pur3coff33/kopit/issues"');
    expect(body).toContain('href="https://github.com/pur3coff33/kopit/security/advisories/new"');
    expect(body).toContain('href="/privacy"');
    expect(body).toContain('href="/terms"');
  });

  it("is a chip on the garden screen", async () => {
    const h = await seedHousehold();
    const body = await html(await req("/spending", { cookie: await authCookie(h.householdId, h.profileIds[0]) }));
    expect(body).toMatch(/class="chip" href="\/guide"/);
  });
});

describe("legal pages", () => {
  it("open without logging in, dated, with GitHub as the contact", async () => {
    for (const [path, title] of [
      ["/privacy", "Privacy policy"],
      ["/terms", "Terms and conditions"],
    ]) {
      const res = await req(path);
      expect(res.status, path).toBe(200);
      const body = await html(res);
      expect(body).toContain(`<h1>${title}</h1>`);
      expect(body).toMatch(/Last updated \w+ \d+, \d{4}/);
      expect(body).toContain('href="https://github.com/pur3coff33/kopit/issues"');
    }
  });

  it("say how deleting works, how long the restore history lasts, and where the location goes", async () => {
    const body = await html(await req("/privacy"));
    expect(body).toContain("Delete household");
    expect(body).toContain("up to 30 days");
    expect(body).toContain("Open-Meteo");
    expect(body).toContain("never sent to kop.it's server");
    expect(body).toContain("Data Privacy Act of 2012");
  });

  it("are linked from the login and setup pages", async () => {
    for (const path of ["/login", "/setup"]) {
      const body = await html(await req(path));
      expect(body, path).toContain('href="/privacy"');
      expect(body, path).toContain('href="/terms"');
    }
  });
});
