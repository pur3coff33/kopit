// Today's sky behind the garden's plant. The server draws day or night from the Manila clock; this swaps in the
// weather and the real sunrise and sunset where the phone is, from Open-Meteo (free, no account). Location is asked
// for once; after that it's only refreshed when the phone already allows it, so nobody is nagged. No location, or no
// signal: the sky just follows the clock.
const MANILA_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
const FETCH_EVERY_MS = 30 * 60_000;
const WEATHER_FOR_MS = 3 * 3_600_000; // older than this, a rain cloud is a guess: show a clear sky
const CACHE_KEY = "kopit-sky";
const ASKED_KEY = "kopit-sky-asked";
const WHERE_KEY = "kopit-sky-where";

/** Open-Meteo's WMO weather code → the sky we draw. Drizzle, rain and showers are rain; snow never falls here. */
export function weatherKind(code) {
  if (code >= 95) return "storm";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
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

/** Whether to read the location now. `permission`: the Permissions API state, or null where it's missing. */
export function shouldLocate(permission, asked) {
  if (permission === "granted") return true;
  if (permission === "denied") return false;
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

export function skyState(cache, nowMs) {
  return {
    phase: phaseAt(nowMs, cache && { rise: cache.rise, set: cache.set }),
    weather: cache && nowMs - cache.at < WEATHER_FOR_MS ? weatherKind(cache.code) : "clear",
  };
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

/** Starts the sky on the garden screen; returns a function that stops it. */
export function mount() {
  const sky = document.querySelector("[data-sky]");
  if (!sky) return;
  let stopped = false;
  let busy = false;

  const paint = () => {
    const { phase, weather } = skyState(load(CACHE_KEY), Date.now());
    sky.dataset.phase = phase;
    sky.dataset.weather = weather;
  };

  async function refresh() {
    if (busy || !("geolocation" in navigator) || !needsFetch(load(CACHE_KEY), Date.now())) return;
    busy = true;
    try {
      let where = load(WHERE_KEY);
      if (shouldLocate(await permission(), !!load(ASKED_KEY))) {
        save(ASKED_KEY, true);
        const here = await locate();
        if (here) save(WHERE_KEY, (where = here));
      }
      if (!where || stopped) return;
      const res = await fetch(forecastUrl(where.lat, where.lon));
      if (!res.ok) return;
      const forecast = readForecast(await res.json(), Date.now());
      if (!forecast || stopped) return;
      save(CACHE_KEY, forecast);
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
