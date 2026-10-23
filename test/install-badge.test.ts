import { describe, expect, it } from "vitest";
// @ts-ignore plain browser module
import { cannotInstall, chromeLink, installMode, shouldAutoOpen } from "../public/js/install.js";
import { req } from "./helpers";

const phone = { standalone: false, coarse: true, ios: false, canPrompt: false, dismissed: false };

describe("installMode", () => {
  it("offers the install button on phones that support the prompt", () => {
    expect(installMode({ ...phone, canPrompt: true })).toBe("prompt");
  });
  it("explains Add to Home Screen on iPhone", () => {
    expect(installMode({ ...phone, ios: true })).toBe("ios");
  });
  it("suggests Chrome in a browser that can't install it, but never ahead of a real install", () => {
    expect(installMode({ ...phone, noInstall: true })).toBe("chrome");
    expect(installMode({ ...phone, noInstall: true, canPrompt: true })).toBe("prompt");
    expect(installMode({ ...phone, noInstall: true, dismissed: true })).toBe("hidden");
    expect(installMode({ ...phone, noInstall: true, coarse: false })).toBe("hidden");
  });
  it("stays hidden once installed, on computers, after dismissal, or when nothing can be offered", () => {
    expect(installMode({ ...phone, canPrompt: true, standalone: true })).toBe("hidden");
    expect(installMode({ ...phone, canPrompt: true, coarse: false })).toBe("hidden");
    expect(installMode({ ...phone, ios: true, dismissed: true })).toBe("hidden");
    expect(installMode(phone)).toBe("hidden");
  });
});

describe("cannotInstall", () => {
  const android = (browser: string) => `Mozilla/5.0 (Linux; Android 14; Pixel 8) ${browser}`;
  it("is true for Firefox and the browsers inside other apps, on Android", () => {
    expect(cannotInstall("Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0")).toBe(true);
    expect(cannotInstall(android("AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0]"))).toBe(true);
    expect(cannotInstall(android("AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 Instagram 330.0"))).toBe(true);
    expect(cannotInstall("Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36")).toBe(true);
  });
  it("is false for Chrome, Samsung Internet and Edge, and for other systems", () => {
    expect(cannotInstall(android("AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36"))).toBe(false);
    expect(cannotInstall(android("AppleWebKit/537.36 SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36"))).toBe(false);
    expect(cannotInstall(android("AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 EdgA/126.0"))).toBe(false);
    expect(cannotInstall("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 FxiOS/127.0")).toBe(false);
  });
  it("builds a link that opens the same page in Chrome", () => {
    expect(chromeLink({ protocol: "https:", host: "kop.it", pathname: "/history", search: "?who=2" })).toBe(
      "intent://kop.it/history?who=2#Intent;scheme=https;package=com.android.chrome;end",
    );
  });
});

describe("shouldAutoOpen", () => {
  const ok = { mode: "ios", seen: false, onMainScreen: true, busy: false };
  it("opens the full-screen steps the first time, on a main screen, when nothing else is open", () => {
    expect(shouldAutoOpen(ok)).toBe(true);
    expect(shouldAutoOpen({ ...ok, mode: "prompt" })).toBe(true);
  });
  it("leaves it to the badge once closed, on the log-in page, with nothing to offer, or while something else is open", () => {
    expect(shouldAutoOpen({ ...ok, seen: true })).toBe(false);
    expect(shouldAutoOpen({ ...ok, onMainScreen: false })).toBe(false);
    expect(shouldAutoOpen({ ...ok, mode: "hidden" })).toBe(false);
    expect(shouldAutoOpen({ ...ok, busy: true })).toBe(false);
  });
});

describe("install badge", () => {
  it("ships a hidden install badge and its script on every page", async () => {
    const body = await (await req("/login")).text();
    expect(body).toMatch(/<div class="install" id="install" hidden="">/);
    expect(body).toContain('src="/js/install.js"');
  });
  it("carries the full-screen steps, with the iPhone ones and an install button", async () => {
    const body = await (await req("/login")).text();
    expect(body).toMatch(/<dialog class="install-modal" id="install-modal"/);
    expect(body).toContain("Add to Home Screen");
    expect(body).toContain("data-install");
    expect(body).toContain("data-howto");
    expect(body).toContain("data-chrome");
  });
});
