import { describe, expect, it } from "vitest";
import { GENTLE } from "../src/lib/gentle";
import { html, req } from "./helpers";

describe("guide", () => {
  it("opens without logging in, with every section", async () => {
    const res = await req("/guide");
    expect(res.status).toBe(200);
    const body = await html(res);
    for (const id of ["about", "plant", "sky", "missions", "help", "legal"]) expect(body, id).toContain(`id="${id}"`);
    for (const stage of ["Sprout", "A leaf a good day", "Perfect days", "On track", "Bloom"]) expect(body, stage).toContain(stage);
  });

  it("gives each mission an example on today's categories, only ever a want", () => {
    const examples = GENTLE.map((d) => d.build(d.demo).title).join(" | ");
    for (const old of ["Food", "🎮", "🛒", "💡", "🚌", "💊", "📚", "🧴"]) expect(examples).not.toContain(old);
    expect(examples).toContain("🍜 Eating out");
  });

  it("shows all eight skies, fixed, so the live weather script leaves them alone", async () => {
    const body = await html(await req("/guide"));
    for (const p of ["day", "night"]) for (const w of ["clear", "cloudy", "rain", "storm"]) expect(body).toContain(`data-phase="${p}" data-weather="${w}"`);
    expect(body).not.toContain("data-sky");
    expect(body).not.toContain("/js/sky.js");
  });

  it("lists every current mission, and none of the retired time bans", async () => {
    const body = await html(await req("/guide"));
    for (const d of GENTLE) expect(body, d.type).toContain(d.name);
    expect(body).not.toContain("Nothing spent");
  });
});

describe("legal pages", () => {
  it("open without logging in, dated, with GitHub as the contact", async () => {
    for (const [path, title] of [
      ["/privacy", "Privacy"],
      ["/terms", "Terms"],
    ]) {
      const res = await req(path);
      expect(res.status, path).toBe(200);
      const body = await html(res);
      expect(body).toContain(`<h1>${title}</h1>`);
      expect(body).toMatch(/Last updated \w+ \d+, \d{4}/);
      expect(body).toContain('href="https://github.com/pur3coff33/kopit/issues"');
    }
  });

  it("are linked from the login and setup pages", async () => {
    for (const path of ["/login", "/setup"]) {
      const body = await html(await req(path));
      expect(body, path).toContain('href="/privacy"');
      expect(body, path).toContain('href="/terms"');
    }
  });
});
