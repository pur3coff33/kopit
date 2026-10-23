// Today's sky behind the garden's plant. The server draws day or night from the Manila clock; this swaps in the
// weather and the real sunrise and sunset where the phone is, from Open-Meteo (free, no account), and the town's name
// for the line across the top ("CAMALIGAN — DRIZZLE"), from BigDataCloud (free, no account, asked once per place).
// Location is asked for once; after that it's only refreshed when the phone already allows it, so nobody is nagged.
// No location, or no signal: the sky just follows the clock, with no line.
const MANILA_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
const FETCH_EVERY_MS = 30 * 60_000;
const WEATHER_FOR_MS = 3 * 3_600_000; // older than this, a rain cloud is a guess: show a clear sky
const CACHE_KEY = "kopit-sky";
const ASKED_KEY = "kopit-sky-asked";
const WHERE_KEY = "kopit-sky-where";
const PLACE_KEY = "kopit-sky-place";
const MOVED_DEG = 0.03; // about 3 km: further than this from where the town was looked up, look it up again

/**
 * Open-Meteo's WMO weather code → the sky we draw. Drizzle is its own, lighter sky: in a wet month the forecast calls
 * a tenth of a millimetre "light drizzle" for hours, and that isn't rain. Rain and showers are rain; snow never falls here.
 */
export function weatherKind(code) {
  if (code >= 95) return "storm";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (code >= 2) return "cloudy";
  return "clear";
}

/** "day" or "night". With sun times, day runs sunrise to sunset (times from an earlier day still line up, the way
 * they would offline); without, 6 AM to 6 PM Manila, like the server's isNight. */
export function phaseAt(nowMs, sun) {
  if (sun) return (((nowMs - sun.rise) % DAY_MS) + DAY_MS) % DAY_MS < sun.set - sun.rise ? "day" : "night";
  const h = new Date(nowMs + MANILA_OFFSET_MS).getUTCHours();
  return h >= 6 && h < 18 ? "day" : "night";
}

/**
 * Whether to read the location now. `permission`: the Permissions API state, or null where it's missing. `quiet`: a
 * screen that never asks (add, history), so only once it's been allowed.
 */
export function shouldLocate(permission, asked, quiet = false) {
  if (permission === "granted") return true;
  if (permission === "denied" || quiet) return false;
  return !asked;
}

export function needsFetch(cache, nowMs) {
  return !cache || nowMs - cache.at >= FETCH_EVERY_MS;
}

/** Rounded to about a kilometre: enough for the weather, no more. */
export function forecastUrl(lat, lon) {
  const round = (n) => String(Math.round(n * 100) / 100);
  const q = new URLSearchParams({
    latitude: round(lat),
    longitude: round(lon),
    current: "weather_code",
    daily: "sunrise,sunset",
    timeformat: "unixtime",
    timezone: "GMT",
    forecast_days: "1",
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

export function readForecast(json, nowMs) {
  const code = json?.current?.weather_code;
  const rise = json?.daily?.sunrise?.[0];
  const set = json?.daily?.sunset?.[0];
  if (![code, rise, set].every(Number.isFinite)) return null;
  return { at: nowMs, code, rise: rise * 1000, set: set * 1000 };
}

/** `known`: the weather is a recent reading, not the clear sky we fall back to. */
export function skyState(cache, nowMs) {
  const known = !!cache && nowMs - cache.at < WEATHER_FOR_MS;
  return {
    phase: phaseAt(nowMs, cache && { rise: cache.rise, set: cache.set }),
    weather: known ? weatherKind(cache.code) : "clear",
    known,
  };
}

const GOLDEN_MS = 75 * 60_000; // the last stretch of daylight before sunset

/**
 * "morning", "afternoon", "golden" (the hour or so before sunset) or "night". With sun times, from them; without,
 * from the Manila clock (golden from 5 PM).
 */
export function partOfDay(nowMs, sun) {
  if (phaseAt(nowMs, sun) === "night") return "night";
  const h = new Date(nowMs + MANILA_OFFSET_MS).getUTCHours();
  const left = sun ? sun.set - sun.rise - ((((nowMs - sun.rise) % DAY_MS) + DAY_MS) % DAY_MS) : null;
  if (left !== null ? left <= GOLDEN_MS : h >= 17) return "golden";
  return h < 11 ? "morning" : "afternoon";
}

/** The weather in words, warmer for the time of day. */
const WORDS = {
  clear: { morning: "Sunny morning", afternoon: "Clear afternoon", golden: "Golden hour", night: "Starry night" },
  cloudy: { morning: "Grey morning", afternoon: "Grey skies", golden: "Cloudy evening", night: "Cloudy night" },
  drizzle: { morning: "Light drizzle", afternoon: "Light drizzle", golden: "Light drizzle", night: "Drizzly night" },
  rain: { morning: "Steady rain", afternoon: "Steady rain", golden: "Steady rain", night: "Rainy night" },
  storm: { morning: "Thunderstorm", afternoon: "Thunderstorm", golden: "Thunderstorm", night: "Thunderstorm" },
};

/** The line across the sky: the town and the weather in words, or null unless both are known. */
export function skyLabel(state, place, part) {
  return state.known && place?.name ? { place: place.name, weather: WORDS[state.weather][part] } : null;
}

/** Look the town up again when there's none yet, or the phone is now somewhere else. */
export function needsPlace(place, where) {
  return !!where && (!place || Math.abs(place.lat - where.lat) > MOVED_DEG || Math.abs(place.lon - where.lon) > MOVED_DEG);
}

/** BigDataCloud's free lookup made for browsers, with the same rounded location the weather gets. */
export function placeUrl(lat, lon) {
  const round = (n) => String(Math.round(n * 100) / 100);
  const q = new URLSearchParams({ latitude: round(lat), longitude: round(lon), localityLanguage: "en" });
  return `https://api.bigdatacloud.net/data/reverse-geocode-client?${q}`;
}

/** The town or city from BigDataCloud's answer; null when it doesn't name one. */
export function readPlace(json, where) {
  const name = [json?.city, json?.locality].find((n) => typeof n === "string" && n.trim())?.trim();
  return name ? { lat: where.lat, lon: where.lon, name } : null;
}

// ---------- in the browser ----------

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

async function permission() {
  try {
    return (await navigator.permissions.query({ name: "geolocation" })).state;
  } catch {
    return null;
  }
}

function locate() {
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: FETCH_EVERY_MS, timeout: 15_000 },
    ),
  );
}

/** Starts the sky on the garden, add or history screen; returns a function that stops it. */
export function mount() {
  const sky = document.querySelector("[data-sky]");
  if (!sky) return;
  const quiet = sky.dataset.sky !== "ask";
  let stopped = false;
  let busy = false;

  const line = sky.querySelector("[data-sky-label]");
  const paint = () => {
    const cache = load(CACHE_KEY);
    const state = skyState(cache, Date.now());
    sky.dataset.phase = state.phase;
    sky.dataset.weather = state.weather;
    if (!line) return;
    const label = skyLabel(state, load(PLACE_KEY), partOfDay(Date.now(), cache && { rise: cache.rise, set: cache.set }));
    const text = label ? `${label.place} — ${label.weather}` : "";
    if (line.dataset.text === text) return;
    line.dataset.text = text;
    line.hidden = !label;
    if (!label) return;
    line.querySelector(".where").textContent = label.place;
    line.querySelector(".what").textContent = label.weather;
    // Drift in again, like a film title, whenever the words change.
    line.classList.remove("play");
    void line.offsetWidth;
    line.classList.add("play");
  };

  async function refresh() {
    if (busy || !("geolocation" in navigator) || !needsFetch(load(CACHE_KEY), Date.now())) return;
    busy = true;
    try {
      let where = load(WHERE_KEY);
      if (shouldLocate(await permission(), !!load(ASKED_KEY), quiet)) {
        if (!quiet) save(ASKED_KEY, true);
        const here = await locate();
        if (here) save(WHERE_KEY, (where = here));
      }
      if (!where || stopped) return;
      const res = await fetch(forecastUrl(where.lat, where.lon));
      if (!res.ok) return;
      const forecast = readForecast(await res.json(), Date.now());
      if (!forecast || stopped) return;
      save(CACHE_KEY, forecast);
      if (needsPlace(load(PLACE_KEY), where)) {
        const at = await fetch(placeUrl(where.lat, where.lon)).catch(() => null);
        const place = at?.ok ? readPlace(await at.json(), where) : null;
        if (place) save(PLACE_KEY, place);
      }
      if (stopped) return;
      paint();
    } catch {
      // offline or the weather service is down: keep the sky we have
    } finally {
      busy = false;
    }
  }

  paint();
  refresh();
  const timer = setInterval(() => {
    paint();
    refresh();
  }, 60_000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
