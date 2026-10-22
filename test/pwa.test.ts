import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { req } from "./helpers";

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
    expect(swText).toContain("kopit-v1");
    expect(swText).toContain('"/js/router.js"'); // precached, so screens still switch with no signal
    expect(swText).toContain('"/js/update.js"'); // the router imports it: missing offline, the router wouldn't load
  });

  it("clears the cached add screen after logout", async () => {
    // raw text on purpose: script bodies must not be HTML-escaped or the browser can't run them
    expect(await (await req("/login?bye=1")).text()).toContain("caches.open('kopit-v1')");
    expect(await (await req("/login")).text()).not.toContain("caches.open('kopit-v1')");
  });

  it("starts pages with a real doctype and registers the service worker with runnable script", async () => {
    const text = await (await req("/login")).text();
    expect(text.startsWith("<!doctype html>")).toBe(true);
    expect(text).toContain("navigator.serviceWorker.register('/sw.js')");
  });
});
