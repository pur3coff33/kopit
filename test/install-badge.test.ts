import { describe, expect, it } from "vitest";
// @ts-ignore plain browser module
import { installMode } from "../public/js/install.js";
import { req } from "./helpers";

const phone = { standalone: false, coarse: true, ios: false, canPrompt: false, dismissed: false };

describe("installMode", () => {
  it("offers the install button on phones that support the prompt", () => {
    expect(installMode({ ...phone, canPrompt: true })).toBe("prompt");
  });
  it("explains Add to Home Screen on iPhone", () => {
    expect(installMode({ ...phone, ios: true })).toBe("ios");
  });
  it("stays hidden once installed, on computers, after dismissal, or when nothing can be offered", () => {
    expect(installMode({ ...phone, canPrompt: true, standalone: true })).toBe("hidden");
    expect(installMode({ ...phone, canPrompt: true, coarse: false })).toBe("hidden");
    expect(installMode({ ...phone, ios: true, dismissed: true })).toBe("hidden");
    expect(installMode(phone)).toBe("hidden");
  });
});

describe("page head and badge", () => {
  it("colors the status bar for light and dark phones", async () => {
    const body = await (await req("/login")).text();
    expect(body).toContain('<meta name="theme-color" content="#FBF7EF" media="(prefers-color-scheme: light)"/>');
    expect(body).toContain('<meta name="theme-color" content="#3A322A" media="(prefers-color-scheme: dark)"/>');
    expect(body).toContain('name="apple-mobile-web-app-status-bar-style" content="default"');
  });

  it("ships a hidden install badge and its script on every page", async () => {
    const body = await (await req("/login")).text();
    expect(body).toMatch(/<div class="install" id="install" hidden="">/);
    expect(body).toContain('src="/js/install.js"');
  });
});
