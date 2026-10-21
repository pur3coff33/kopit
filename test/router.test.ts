import { describe, expect, it } from "vitest";
// @ts-ignore plain browser module
import { fetchPage, navTarget, skeletonKind } from "../public/js/router.js";
import { authCookie, html, req, seedHousehold } from "./helpers";

const here = "https://kopit.test/spending?range=this&who=all";
const click = { target: "", download: false, button: 0, modified: false };

describe("navTarget", () => {
  it("opens same-site links in place, keeping the query", () => {
    expect(navTarget({ ...click, href: "https://kopit.test/history?who=2" }, here)).toBe("/history?who=2");
    expect(navTarget({ ...click, href: "/" }, here)).toBe("/");
  });

  it("leaves other sites, new tabs, downloads and modified or non-primary clicks to the browser", () => {
    expect(navTarget({ ...click, href: "https://example.com/" }, here)).toBeNull();
    expect(navTarget({ ...click, href: "/history", target: "_blank" }, here)).toBeNull();
    expect(navTarget({ ...click, href: "/history", download: true }, here)).toBeNull();
    expect(navTarget({ ...click, href: "/history", modified: true }, here)).toBeNull();
    expect(navTarget({ ...click, href: "/history", button: 1 }, here)).toBeNull();
  });

  it("never opens API endpoints or in-page anchors as screens", () => {
    expect(navTarget({ ...click, href: "/api/entries" }, here)).toBeNull();
    expect(navTarget({ ...click, href: "#top" }, here)).toBeNull();
  });
});

describe("fetchPage", () => {
  const page = (o: { ok?: boolean; redirected?: boolean; type?: string; body?: string }) => () =>
    Promise.resolve({
      ok: o.ok ?? true,
      redirected: o.redirected ?? false,
      headers: new Headers({ "Content-Type": o.type ?? "text/html; charset=utf-8" }),
      text: async () => o.body ?? "<main></main>",
    });

  it("returns the next screen's HTML", async () => {
    expect(await fetchPage("/history", { fetchImpl: page({ body: "<main>hi</main>" }) })).toBe("<main>hi</main>");
  });

  it("leaves redirects, errors and non-pages to a normal page load", async () => {
    expect(await fetchPage("/", { fetchImpl: page({ redirected: true }) })).toBeNull();
    expect(await fetchPage("/", { fetchImpl: page({ ok: false }) })).toBeNull();
    expect(await fetchPage("/", { fetchImpl: page({ type: "application/json" }) })).toBeNull();
  });

  it("gives up on a connection that never answers, so the offline copy can take over", async () => {
    const hang = (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const started = Date.now();
    await expect(fetchPage("/", { fetchImpl: hang, timeoutMs: 50 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("skeletonKind", () => {
  it("matches the placeholder to the screen being opened", () => {
    expect(skeletonKind("/")).toBe("add");
    expect(skeletonKind("/spending")).toBe("spending");
    expect(skeletonKind("/history")).toBe("history");
    expect(skeletonKind("/spending/category/4")).toBe("list");
    expect(skeletonKind("/settings")).toBe("list");
  });
});

describe("page scripts", () => {
  it("load without touching the page, and start only when mounted", async () => {
    for (const path of ["../public/js/add.js", "../public/js/history.js", "../public/js/edit.js"]) {
      const mod = await import(/* @vite-ignore */ path);
      expect(typeof mod.mount, path).toBe("function");
    }
  });

  it("are marked for the router, which every page loads", async () => {
    const { householdId, profileIds } = await seedHousehold();
    const body = await html(await req("/", { cookie: await authCookie(householdId, profileIds[0]) }));
    expect(body).toContain('<script type="module" src="/js/router.js"></script>');
    expect(body).toMatch(/<script type="module" src="\/js\/add.js" data-page=""><\/script>/);
    expect(await (await req("/login")).text()).toContain('src="/js/router.js"');
  });
});
