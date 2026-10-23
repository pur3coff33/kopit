import { describe, expect, it } from "vitest";
// @ts-ignore plain browser module
import { forecastUrl, needsFetch, needsPlace, partOfDay, phaseAt, placeUrl, readForecast, readPlace, shouldLocate, skyLabel, skyState, weatherKind } from "../public/js/sky.js";

const MIN = 60_000;
const HOUR = 3_600_000;
// Oct 21 2026 in Manila: sunrise 5:48 AM, sunset 5:34 PM.
const rise = Date.UTC(2026, 9, 20, 21, 48);
const set = Date.UTC(2026, 9, 21, 9, 34);
const noon = Date.UTC(2026, 9, 21, 4, 0);

describe("sky helpers (garden screen)", () => {
  it("sorts the weather codes into the five skies", () => {
    expect([0, 1].map(weatherKind)).toEqual(["clear", "clear"]);
    expect([2, 3, 45, 48].map(weatherKind)).toEqual(["cloudy", "cloudy", "cloudy", "cloudy"]);
    expect([51, 53, 55].map(weatherKind)).toEqual(["drizzle", "drizzle", "drizzle"]); // a wet day's "light drizzle" isn't rain
    expect([61, 65, 80, 82].map(weatherKind)).toEqual(["rain", "rain", "rain", "rain"]);
    expect([95, 96, 99].map(weatherKind)).toEqual(["storm", "storm", "storm"]);
    expect(weatherKind(undefined)).toBe("clear");
  });

  it("is day between sunrise and sunset, even with yesterday's times", () => {
    expect(phaseAt(noon, { rise, set })).toBe("day");
    expect(phaseAt(set + MIN, { rise, set })).toBe("night");
    expect(phaseAt(rise - MIN, { rise, set })).toBe("night");
    expect(phaseAt(noon + 24 * HOUR, { rise, set })).toBe("day"); // offline the next day, times a day old
    expect(phaseAt(set + 24 * HOUR + MIN, { rise, set })).toBe("night");
  });

  it("falls back to Manila's 6 to 6 without sun times", () => {
    expect(phaseAt(noon, null)).toBe("day");
    expect(phaseAt(Date.UTC(2026, 9, 21, 15, 0), null)).toBe("night"); // 11 PM
  });

  it("asks for the location only once, and refreshes it only when already allowed", () => {
    expect(shouldLocate("granted", true)).toBe(true);
    expect(shouldLocate("prompt", false)).toBe(true);
    expect(shouldLocate("prompt", true)).toBe(false);
    expect(shouldLocate("denied", false)).toBe(false);
    expect(shouldLocate(null, false)).toBe(true); // no permissions API (older iPhones)
    expect(shouldLocate(null, true)).toBe(false);
    // Add and History never ask: they follow once it's allowed (asked on the garden).
    expect(shouldLocate("granted", false, true)).toBe(true);
    expect(shouldLocate("prompt", false, true)).toBe(false);
    expect(shouldLocate(null, false, true)).toBe(false);
  });

  it("refetches the weather after 30 minutes", () => {
    expect(needsFetch(null, noon)).toBe(true);
    expect(needsFetch({ at: noon - 29 * MIN }, noon)).toBe(false);
    expect(needsFetch({ at: noon - 30 * MIN }, noon)).toBe(true);
  });

  it("sends only a rounded location", () => {
    const url = new URL(forecastUrl(14.599512, 120.984222));
    expect(url.origin).toBe("https://api.open-meteo.com");
    expect(url.searchParams.get("latitude")).toBe("14.6");
    expect(url.searchParams.get("longitude")).toBe("120.98");
  });

  it("reads Open-Meteo's answer", () => {
    const json = { current: { weather_code: 61 }, daily: { sunrise: [rise / 1000], sunset: [set / 1000] } };
    expect(readForecast(json, noon)).toEqual({ at: noon, code: 61, rise, set });
    expect(readForecast({}, noon)).toBeNull();
  });

  it("shows the weather while it's recent, and only the clock after that", () => {
    const cache = { at: noon, code: 95, rise, set };
    expect(skyState(cache, noon + HOUR)).toEqual({ phase: "day", weather: "storm", known: true });
    expect(skyState(cache, noon + 3 * HOUR)).toEqual({ phase: "day", weather: "clear", known: false });
    expect(skyState(cache, set + HOUR)).toEqual({ phase: "night", weather: "clear", known: false });
    expect(skyState(null, Date.UTC(2026, 9, 21, 15, 0))).toEqual({ phase: "night", weather: "clear", known: false });
  });

  it("names the town and the weather only when both are known", () => {
    const place = { lat: 13.62, lon: 123.17, name: "Camaligan" };
    expect(skyLabel({ phase: "day", weather: "drizzle", known: true }, place, "afternoon")).toEqual({ place: "Camaligan", weather: "Light drizzle" });
    expect(skyLabel({ phase: "day", weather: "rain", known: true }, place, "morning")).toEqual({ place: "Camaligan", weather: "Steady rain" });
    expect(skyLabel({ phase: "night", weather: "clear", known: true }, place, "night")).toEqual({ place: "Camaligan", weather: "Starry night" });
    expect(skyLabel({ phase: "day", weather: "clear", known: false }, place, "morning")).toBeNull(); // an old reading: no "Sunny morning"
    expect(skyLabel({ phase: "day", weather: "rain", known: true }, null, "morning")).toBeNull();
  });

  it("knows the morning, the afternoon, the golden hour before sunset and the night", () => {
    expect(partOfDay(Date.UTC(2026, 9, 20, 23, 30), { rise, set })).toBe("morning"); // 7:30 AM
    expect(partOfDay(noon, { rise, set })).toBe("afternoon");
    expect(partOfDay(set - 30 * MIN, { rise, set })).toBe("golden");
    expect(partOfDay(set + MIN, { rise, set })).toBe("night");
    expect(partOfDay(Date.UTC(2026, 9, 21, 9, 15), null)).toBe("golden"); // 5:15 PM, no sun times
  });

  it("looks the town up once per place", () => {
    const place = { lat: 13.62, lon: 123.17, name: "Camaligan" };
    expect(needsPlace(null, { lat: 13.62, lon: 123.17 })).toBe(true);
    expect(needsPlace(place, { lat: 13.63, lon: 123.18 })).toBe(false); // the same town
    expect(needsPlace(place, { lat: 13.62, lon: 123.21 })).toBe(true); // moved to Naga
    expect(needsPlace(place, null)).toBe(false);
  });

  it("sends the town lookup only a rounded location, and reads its answer", () => {
    const url = new URL(placeUrl(13.621834, 123.168812));
    expect(url.origin).toBe("https://api.bigdatacloud.net");
    expect(url.searchParams.get("latitude")).toBe("13.62");
    expect(url.searchParams.get("longitude")).toBe("123.17");
    const where = { lat: 13.62, lon: 123.17 };
    expect(readPlace({ city: "Camaligan", locality: "Camaligan" }, where)).toEqual({ ...where, name: "Camaligan" });
    expect(readPlace({ city: "", locality: "Naga" }, where)).toEqual({ ...where, name: "Naga" });
    expect(readPlace({ city: " " }, where)).toBeNull();
    expect(readPlace(null, where)).toBeNull();
  });
});
