import { describe, expect, it } from "vitest";
// @ts-ignore plain browser module
import { forecastUrl, needsFetch, phaseAt, readForecast, shouldLocate, skyState, weatherKind } from "../public/js/sky.js";

const MIN = 60_000;
const HOUR = 3_600_000;
// Oct 21 2026 in Manila: sunrise 5:48 AM, sunset 5:34 PM.
const rise = Date.UTC(2026, 9, 20, 21, 48);
const set = Date.UTC(2026, 9, 21, 9, 34);
const noon = Date.UTC(2026, 9, 21, 4, 0);

describe("sky helpers (garden screen)", () => {
  it("sorts the weather codes into the four skies", () => {
    expect([0, 1].map(weatherKind)).toEqual(["clear", "clear"]);
    expect([2, 3, 45, 48].map(weatherKind)).toEqual(["cloudy", "cloudy", "cloudy", "cloudy"]);
    expect([51, 61, 65, 80, 82].map(weatherKind)).toEqual(["rain", "rain", "rain", "rain", "rain"]);
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
    expect(skyState(cache, noon + HOUR)).toEqual({ phase: "day", weather: "storm" });
    expect(skyState(cache, noon + 3 * HOUR)).toEqual({ phase: "day", weather: "clear" });
    expect(skyState(cache, set + HOUR)).toEqual({ phase: "night", weather: "clear" });
    expect(skyState(null, Date.UTC(2026, 9, 21, 15, 0))).toEqual({ phase: "night", weather: "clear" });
  });
});
