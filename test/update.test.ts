import { describe, expect, it } from "vitest";
// @ts-ignore plain browser module
import { needsUpdate } from "../public/js/update.js";
// @ts-ignore plain browser module
import { readDraft } from "../public/js/add.js";
import { req } from "./helpers";

describe("deploy version", () => {
  it("tells an open app which version is live, never from a cache", async () => {
    const res = await req("/version");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const { version } = (await res.json()) as { version: string };
    expect(version).toBeTruthy();
  });

  it("stamps each page with the version it was made by", async () => {
    const { version } = (await (await req("/version")).json()) as { version: string };
    expect(await (await req("/login")).text()).toContain(`<meta name="kopit-version" content="${version}"/>`);
  });
});

describe("needsUpdate", () => {
  const older = "2026-10-20T08:00:00.000Z";
  const newer = "2026-10-23T09:30:00.000Z";

  it("asks for a reload when a newer version is live", () => {
    expect(needsUpdate(older, newer)).toBe(true);
  });

  it("stays quiet on the same version, or when an older one answers mid-deploy", () => {
    expect(needsUpdate(newer, newer)).toBe(false);
    expect(needsUpdate(newer, older)).toBe(false);
  });

  it("stays quiet when either side is unknown (an old page without a stamp, no answer)", () => {
    expect(needsUpdate("", newer)).toBe(false);
    expect(needsUpdate(null, newer)).toBe(false);
    expect(needsUpdate(older, undefined)).toBe(false);
  });
});

describe("readDraft", () => {
  it("brings back an amount, category and note kept across an update", () => {
    const raw = JSON.stringify({ typed: "125.5", categoryId: 4, note: "jeep" });
    expect(readDraft(raw)).toEqual({ typed: "125.5", categoryId: 4, note: "jeep" });
  });

  it("brings back an amount without a category or note", () => {
    expect(readDraft(JSON.stringify({ typed: "80" }))).toEqual({ typed: "80", categoryId: null, note: "" });
  });

  it("ignores nothing typed, junk and missing drafts", () => {
    expect(readDraft(JSON.stringify({ typed: "0", categoryId: 4 }))).toBeNull();
    expect(readDraft(JSON.stringify({ typed: "abc" }))).toBeNull();
    expect(readDraft("{not json")).toBeNull();
    expect(readDraft(null)).toBeNull();
  });
});
