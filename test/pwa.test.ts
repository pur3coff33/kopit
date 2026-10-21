import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authCookie, html, req, seedHousehold } from "./helpers";

const asset = (path: string) => env.ASSETS.fetch(`http://kopit.test${path}`);

describe("installable app", () => {
  it("serves a standalone manifest with both icon sizes", async () => {
    const res = await asset("/manifest.webmanifest");
    expect(res.status).toBe(200);
    const m = JSON.parse(await res.text());
    expect(m).toMatchObject({ name: "kop.it", short_name: "kop.it", description: "Your household's money garden.", start_url: "/", scope: "/", display: "standalone", background_color: "#EEF4EA", theme_color: "#EEF4EA" });
    expect(m.icons.map((i: { sizes: string }) => i.sizes).sort()).toEqual(["192x192", "512x512"]);
  });

  it("serves the icons and the service worker", async () => {
    for (const p of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"]) {
      const res = await asset(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("Content-Type"), p).toContain("image/png");
    }
    const sw = await asset("/sw.js");
    expect(sw.status).toBe(200);
    expect(sw.headers.get("Content-Type")).toContain("javascript");
    const swText = await sw.text();
    expect(swText).toContain("kopit-v1");
    expect(swText).toContain('"/js/router.js"'); // precached, so screens still switch with no signal
    expect((await asset("/js/queue.js")).status).toBe(200);
    expect((await asset("/js/router.js")).status).toBe(200);
  });

  it("links the manifest and icon from pages", async () => {
    const { householdId, profileIds } = await seedHousehold();
    const body = await html(await req("/", { cookie: await authCookie(householdId, profileIds[0]) }));
    expect(body).toContain('rel="manifest"');
    expect(body).toContain("apple-touch-icon");
  });

  it("clears the cached add screen after logout", async () => {
    // raw text on purpose: script bodies must not be HTML-escaped or the browser can't run them
    expect(await (await req("/login?bye=1")).text()).toContain("caches.open('kopit-v1')");
    expect(await (await req("/login")).text()).not.toContain("caches.open('kopit-v1')");
  });

  it("starts pages with a real doctype, not escaped text", async () => {
    const text = await (await req("/login")).text();
    expect(text.startsWith("<!doctype html>")).toBe(true);
    expect(text).not.toContain("&lt;!doctype");
  });

  it("registers the service worker with runnable script", async () => {
    expect(await (await req("/login")).text()).toContain("navigator.serviceWorker.register('/sw.js')");
  });
});
