import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authCookie, form, req, seedHousehold } from "./helpers";

const asset = (path: string) => env.ASSETS.fetch(`http://kopit.test${path}`);

describe("installable app", () => {
  it("serves a standalone manifest with both icon sizes", async () => {
    const res = await asset("/manifest.webmanifest");
    expect(res.status).toBe(200);
    const m = JSON.parse(await res.text());
    expect(m).toMatchObject({ start_url: "/", scope: "/", display: "standalone" });
    expect(m.icons.map((i: { sizes: string }) => i.sizes).sort()).toEqual(["192x192", "512x512"]);
  });

  it("serves the icons, and a service worker that precaches the router under the cache logout clears", async () => {
    for (const p of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"]) expect((await asset(p)).status, p).toBe(200);
    const swText = await (await asset("/sw.js")).text();
    expect(swText).toContain('"/js/router.js"'); // precached, so screens still switch with no signal
    expect(swText).toContain('"/js/update.js"'); // the router imports it: missing offline, the router wouldn't load
  });

  it("uses one cache name everywhere, new since the fixed categories, so a phone never mixes old and new add screens", async () => {
    const h = await seedHousehold();
    const cookie = await authCookie(h.householdId, h.profileIds[0]);
    const texts = [
      await (await asset("/sw.js")).text(),
      await (await asset("/js/add.js")).text(),
      await (await req("/login?bye=1")).text(),
      await (await req("/settings/delete", { ...form({ pin: "482913", confirm: "DELETE" }), cookie })).text(),
    ];
    for (const t of texts) {
      const names = [...t.matchAll(/kopit-v\d+/g)].map((m) => m[0]);
      expect(names.length).toBeGreaterThan(0);
      expect(new Set(names)).toEqual(new Set(["kopit-v2"]));
    }
  });

  it("clears the cached add screen after logout", async () => {
    // raw text on purpose: script bodies must not be HTML-escaped or the browser can't run them
    expect(await (await req("/login?bye=1")).text()).toContain("caches.open('kopit-v2')");
    expect(await (await req("/login")).text()).not.toContain("caches.open('kopit-v2')");
  });

  it("starts pages with a real doctype and registers the service worker with runnable script", async () => {
    const text = await (await req("/login")).text();
    expect(text.startsWith("<!doctype html>")).toBe(true);
    expect(text).toContain("navigator.serviceWorker.register('/sw.js')");
  });
});
