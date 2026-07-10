// crosbynews.com — Crosby, TX weather, served from the edge.
//
// scheduled(): every 15 min, pull the NWS forecast (daily + hourly) and active
//   alerts and cache the result as JSON in KV under "weather".
// fetch(): render that cached JSON as HTML. On a cold cache (before the first
//   cron run) it fetches live, renders, and warms the cache.

const LAT = 29.9119;
const LON = -95.0608;

// NWS requires a descriptive User-Agent on every request.
const NWS_HEADERS = {
  "User-Agent": "crosbynews.com",
  Accept: "application/geo+json",
};

const KV_KEY = "weather";
const TZ = "America/Chicago";
// Canonical origin — used for robots.txt, sitemap, canonical link, and Link
// headers so everything consolidates to the brand domain.
const SITE = "https://crosbynews.com";

// Brand favicon (a small sun behind a cloud). Served as a real file at
// /favicon.ico and /favicon.svg, and inlined as a data URI in the page <head>.
const FAVICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
  "<circle cx='13' cy='15' r='8' fill='#f5b301'/>" +
  "<ellipse cx='19' cy='20' rx='10' ry='6' fill='#dfe7ee'/></svg>";

// App icon for the PWA manifest (/icon.svg): the favicon art on a full-bleed
// brand-navy square. Full-bleed (no rounded corners) because it's declared
// `purpose: "any maskable"` — platforms cut maskable icons to their own shape,
// and transparent corners would show through the mask. The art stays inside
// the maskable safe zone (a centered circle of 40% radius).
const ICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'>" +
  "<rect width='512' height='512' fill='#0b3d61'/>" +
  "<circle cx='216' cy='240' r='92' fill='#f5b301'/>" +
  "<ellipse cx='286' cy='298' rx='118' ry='68' fill='#dfe7ee'/></svg>";

// Web app manifest (/manifest.json) — makes the site installable and names
// the PWA. `display: standalone` so an installed copy opens app-like; colors
// match the brand navy and BASE_CSS light background.
const MANIFEST = {
  name: "Crosby News — Crosby, TX Weather",
  short_name: "Crosby News",
  description: "Live weather, alerts, water levels, local news, and school events for Crosby, Texas.",
  id: "/",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#eef2f6",
  theme_color: "#0b3d61",
  lang: "en-US",
  icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
};

// Service worker (/sw.js) — offline resilience for storm time, when Crosby's
// connectivity is at its flakiest exactly when the site matters most. Served
// as a Worker route (no static assets, per the repo rule) with `no-cache` so
// deploys pick up on the next visit. Strategy: precache the storm-critical
// pages at install, then network-first for navigations (always fresh online)
// with the last-good cached copy as the offline fallback. Bump CACHE when
// changing this script's behavior so old caches are swept on activate.
// Registered from HOME_SCRIPT (its CSP hash recomputes automatically).
const SW_SCRIPT = `// crosbynews.com service worker - offline cache of storm-critical pages
// plus severe-alert Web Push (empty wake-up + local composition).
var CACHE = "crosby-v2";
var PRECACHE = ["/", "/alerts", "/es", "/es/alerts", "/manifest.json", "/favicon.svg"];
// Warning events that earn a push (life-threatening; warnings only, never
// watches/advisories - avoids alert fatigue). Kept in sync with the Worker's
// SEVERE_PUSH_EVENTS.
var PUSH_EVENTS = ["Tornado Warning", "Flash Flood Warning", "Hurricane Warning", "Hurricane Force Wind Warning", "Extreme Wind Warning", "Tropical Storm Warning"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(PRECACHE); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Navigations: network first so pages are always fresh online; cache the
  // successful copy (query-less URLs only, so variants can't bloat the cache)
  // and fall back to it - or to the language hub - when the network dies.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res.ok && !url.search) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function (err) {
        // ignoreVary: the content pages send "Vary: Accept", and a navigation's
        // Accept header never equals the precache fetch's "*/*" - without it
        // every offline match misses and falls through to the hub.
        return caches.match(req, { ignoreVary: true }).then(function (hit) {
          if (hit) return hit;
          var hub = url.pathname === "/es" || url.pathname.indexOf("/es/") === 0 ? "/es" : "/";
          return caches.match(hub, { ignoreVary: true }).then(function (fb) { if (fb) return fb; throw err; });
        });
      })
    );
    return;
  }

  // Precached assets (favicon, manifest): cache first, network fallback.
  if (PRECACHE.indexOf(url.pathname) !== -1) {
    e.respondWith(caches.match(req, { ignoreVary: true }).then(function (hit) { return hit || fetch(req); }));
  }
});

// Severe-alert push. The Worker sends an EMPTY wake-up (no encrypted payload),
// so the SW composes the notification here from live data - it fetches the
// current alerts and shows the active severe warning(s). userVisibleOnly
// requires we always show something, so an expired-by-now race falls back to a
// generic prompt rather than a silent (penalized) push.
self.addEventListener("push", function (e) {
  e.waitUntil(
    fetch("/api/weather", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var alerts = (data && data.alerts) || [];
        var severe = alerts.filter(function (a) { return PUSH_EVENTS.indexOf(a.event) !== -1; });
        if (!severe.length) {
          return self.registration.showNotification("Crosby, TX weather alert", {
            body: "A severe weather alert may be active. Tap for details.",
            icon: "/icon.svg", badge: "/icon.svg", tag: "crosby-alert", data: { url: "/alerts" },
          });
        }
        return Promise.all(severe.map(function (a) {
          return self.registration.showNotification("\\u26A0\\uFE0F " + a.event + " - Crosby, TX", {
            body: a.headline || (a.description ? String(a.description).split("\\n")[0] : "Take shelter and follow official guidance."),
            icon: "/icon.svg", badge: "/icon.svg",
            tag: a.id || a.event, renotify: true, requireInteraction: true,
            data: { url: "/alerts" },
          });
        }));
      })
      .catch(function () {
        return self.registration.showNotification("Crosby, TX weather alert", {
          body: "A severe weather alert may be active. Tap for details.",
          icon: "/icon.svg", badge: "/icon.svg", tag: "crosby-alert", data: { url: "/alerts" },
        });
      })
  );
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || "/alerts";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(target) !== -1 && "focus" in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
`;

async function getJson(url) {
  const res = await fetch(url, { headers: NWS_HEADERS });
  if (!res.ok) {
    throw new Error(`NWS request failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json();
}

// Pull the daily + hourly forecast and active alerts for Crosby, TX.
async function fetchWeather() {
  // 1. Resolve the point to its forecast endpoints.
  const points = await getJson(`https://api.weather.gov/points/${LAT},${LON}`);
  const { forecast: forecastUrl, forecastHourly: hourlyUrl } = points.properties;
  const place = points.properties.relativeLocation?.properties;

  // 2. Daily forecast, hourly forecast, active alerts, the EPA UV forecast,
  // and the modeled air-quality index are independent. UV and AQI are each
  // failure-tolerant (null on error) so a third-party hiccup can never block
  // the NWS refresh.
  const [forecast, hourly, alertsData, uv, aqi] = await Promise.all([
    getJson(forecastUrl),
    getJson(hourlyUrl),
    getJson(`https://api.weather.gov/alerts/active?point=${LAT},${LON}`),
    fetchUv().catch((e) => {
      console.error("EPA UV fetch failed:", e && e.message);
      return null;
    }),
    fetchAqi().catch((e) => {
      console.error("Open-Meteo AQI fetch failed:", e && e.message);
      return null;
    }),
  ]);

  return {
    updated: new Date().toISOString(),
    place: place ? `${place.city}, ${place.state}` : "Crosby, TX",
    periods: forecast.properties.periods ?? [],
    // Keep 48 hours: the homepage shows the first 12, /hourly shows them all.
    hourly: (hourly.properties.periods ?? []).slice(0, 48),
    alerts: (alertsData.features ?? []).map((f) => f.properties),
    uv,
    aqi,
  };
}

// UV index — the EPA's hourly UV forecast for Crosby's ZIP (Envirofacts, no
// API key; Worker reachability canary-verified before shipping, like NHC).
// The one weather number on the site sourced from EPA rather than NWS. EPA
// publishes DATE_TIME in the ZIP's LOCAL wall-clock time (Central here) and
// the product only covers roughly 6 AM–8 PM — and its row list can wrap into
// the previous day's evening hours, so consumers always filter by CT date.
const UV_ZIP = "77532"; // Crosby
const UV_MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
async function fetchUv() {
  const res = await fetch(`https://data.epa.gov/efservice/getEnvirofactsUVHOURLY/ZIP/${UV_ZIP}/JSON`, {
    headers: { "User-Agent": "crosbynews.com", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`EPA UV request failed: ${res.status}`);
  const rows = await res.json();
  const hourly = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    // DATE_TIME like "Jul/04/2026 01 PM" (local Central wall time).
    const m = /^([A-Za-z]{3})\/(\d{2})\/(\d{4})\s+(\d{1,2})\s+(AM|PM)$/.exec(String(r.DATE_TIME || "").trim());
    const mon = m && UV_MONTHS[m[1].toUpperCase()];
    if (!mon) continue;
    let hour = Number(m[4]) % 12;
    if (m[5].toUpperCase() === "PM") hour += 12;
    hourly.push({ date: `${m[3]}-${mon}-${m[2]}`, hour, value: Number(r.UV_VALUE) || 0 });
  }
  if (!hourly.length) throw new Error("EPA UV: no parseable rows");
  return { hourly };
}

// Current-hour and peak-of-today UV from the stored entries, matched on the
// CT wall clock (the convention EPA publishes in). Null-safe: cache entries
// written before this feature have no `uv`, and hours outside the product's
// window simply don't match.
const ctDateStr = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ });
function uvCurrent(data) {
  const entries = data?.uv?.hourly;
  if (!Array.isArray(entries)) return null;
  const now = Date.now();
  const date = ctDateStr(now);
  const hour = Number(new Date(now).toLocaleString("en-US", { timeZone: TZ, hour: "2-digit", hour12: false })) % 24;
  const hit = entries.find((e) => e.date === date && e.hour === hour);
  return hit ? hit.value : null;
}
function uvPeakToday(data) {
  const entries = data?.uv?.hourly;
  if (!Array.isArray(entries)) return null;
  const date = ctDateStr(Date.now());
  const today = entries.filter((e) => e.date === date);
  return today.length ? Math.max(...today.map((e) => e.value)) : null;
}
// EPA/WHO UV index categories.
function uvCategory(v, lang = "en") {
  if (v == null) return null;
  if (v >= 11) return T(lang, "Extreme", "Extremo");
  if (v >= 8) return T(lang, "Very High", "Muy alto");
  if (v >= 6) return T(lang, "High", "Alto");
  if (v >= 3) return T(lang, "Moderate", "Moderado");
  return T(lang, "Low", "Bajo");
}

// Air quality (US AQI) — the site's one MODELED number, and the only one from
// a non-US-government source. There's no EPA/AirNow monitor in Crosby, so
// rather than misattribute a distant monitor's reading, we show Open-Meteo's
// modeled US AQI for Crosby's coordinates (its CAMS-based forecast, no API
// key) and label it "modeled" everywhere it appears — never as a measurement.
// Worker reachability to air-quality-api.open-meteo.com was canary-verified
// from the deployed runtime before shipping. Folded into the `weather` KV
// entry as `aqi:{...}`, failure-tolerant (aqi:null on any error) so it can
// never block the NWS refresh. Unlike UV, AQI is meaningful day and night.
const AQI_POLLUTANTS = {
  us_aqi_pm2_5: ["PM2.5", "PM2.5"],
  us_aqi_pm10: ["PM10", "PM10"],
  us_aqi_ozone: ["ozone", "ozono"],
  us_aqi_nitrogen_dioxide: ["nitrogen dioxide", "dióxido de nitrógeno"],
  us_aqi_sulphur_dioxide: ["sulfur dioxide", "dióxido de azufre"],
  us_aqi_carbon_monoxide: ["carbon monoxide", "monóxido de carbono"],
};
async function fetchAqi() {
  const fields = ["us_aqi", ...Object.keys(AQI_POLLUTANTS), "pm2_5", "pm10", "ozone"].join(",");
  const res = await fetch(
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}&current=${fields}&timezone=America%2FChicago`,
    { headers: { "User-Agent": "crosbynews.com", Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`Open-Meteo AQI request failed: ${res.status}`);
  const j = await res.json();
  const c = j.current || {};
  const usAqi = typeof c.us_aqi === "number" ? Math.round(c.us_aqi) : null;
  if (usAqi == null) throw new Error("Open-Meteo AQI: no us_aqi value");
  // Dominant pollutant = the component whose sub-AQI drives the overall (the
  // max component AQI; overall US AQI is the max of the components).
  let dominant = null, best = -1;
  for (const key of Object.keys(AQI_POLLUTANTS)) {
    const v = c[key];
    if (typeof v === "number" && v > best) { best = v; dominant = key; }
  }
  return {
    usAqi,
    dominant, // internal key, mapped to a label at render time
    pm25: typeof c.pm2_5 === "number" ? c.pm2_5 : null,
    pm10: typeof c.pm10 === "number" ? c.pm10 : null,
    ozone: typeof c.ozone === "number" ? c.ozone : null,
    time: c.time || null,
  };
}
// EPA US AQI categories (the official 0–500 bands).
function aqiCategory(v, lang = "en") {
  if (v == null) return null;
  if (v > 300) return T(lang, "Hazardous", "Peligroso");
  if (v > 200) return T(lang, "Very Unhealthy", "Muy insalubre");
  if (v > 150) return T(lang, "Unhealthy", "Insalubre");
  if (v > 100) return T(lang, "Unhealthy for Sensitive Groups", "Insalubre para grupos sensibles");
  if (v > 50) return T(lang, "Moderate", "Moderada");
  return T(lang, "Good", "Buena");
}
function aqiDominantLabel(key, lang = "en") {
  const pair = AQI_POLLUTANTS[key];
  return pair ? T(lang, pair[0], pair[1]) : null;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nl2br(value) {
  return esc(value).replace(/\n/g, "<br>");
}

// Probability of precipitation as a whole number (NWS gives {value:null|number}).
function pop(period) {
  const v = period?.probabilityOfPrecipitation?.value;
  return typeof v === "number" ? Math.round(v) : 0;
}

// "Feels like" temperature — computed in-Worker from NWS's own published
// formulas (heat index; NWS wind-chill equation), applied to the
// temperature/humidity/wind NWS already gives us. Not a separate NWS field,
// so it's derived, not fetched — kept honest by documenting the source
// (OpenAPI schema, /about) rather than presenting it as raw upstream data.
// Heat index follows NWS's actual two-step algorithm: the simple Steadman
// form is computed first for ANY warm temperature, and only upgraded to the
// full Rothfusz regression when the result reaches 80 — so a muggy 79°F Gulf
// night still gets its honest ~81° heat index instead of a gap. Applied for
// T > 50°F (at and below 50, wind chill takes over).
function heatIndexF(tempF, rhPercent) {
  if (typeof tempF !== "number" || typeof rhPercent !== "number" || tempF <= 50) return null;
  const T = tempF, R = rhPercent;
  let hi = 0.5 * (T + 61 + (T - 68) * 1.2 + R * 0.094);
  if (hi < 80) return Math.round(hi);
  hi =
    -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 0.00683783 * T * T -
    0.05481717 * R * R + 0.00122874 * T * T * R + 0.00085282 * T * R * R - 0.00000199788 * T * T * R * R;
  if (R < 13 && T >= 80 && T <= 112) hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  else if (R > 85 && T >= 80 && T <= 87) hi += ((R - 85) / 10) * ((87 - T) / 5);
  return Math.round(hi);
}
// Wind chill: valid at T <= 50°F and wind >= 3 mph (NWS's own applicability window).
function windChillF(tempF, windMph) {
  if (typeof tempF !== "number" || typeof windMph !== "number" || tempF > 50 || windMph < 3) return null;
  const v16 = Math.pow(windMph, 0.16);
  return Math.round(35.74 + 0.6215 * tempF - 35.75 * v16 + 0.4275 * tempF * v16);
}
// Combine both into one "feels like" value for a period, or null if neither
// heat index nor wind chill applies.
function feelsLikeRawF(period) {
  const t = period?.temperature;
  if (typeof t !== "number") return null;
  const rh = period?.relativeHumidity?.value;
  const windMph = parseInt(period?.windSpeed, 10);
  return heatIndexF(t, rh) ?? windChillF(t, Number.isFinite(windMph) ? windMph : NaN);
}
// The hourly period covering the wall clock RIGHT NOW. NWS's forecastHourly
// product regenerates on its own lazy schedule — its first period is the hour
// the product was generated, which can lag the real clock by an hour or more
// even when our KV cache is fresh (user screenshots: hero said "5:00 PM" at
// 6:19 PM). Never trust hourly[0] to be "now"; pick the period whose
// start/end straddle Date.now(), else the latest already-started one.
function currentHourly(data) {
  const hours = data?.hourly ?? [];
  const now = Date.now();
  let started = null;
  for (const h of hours) {
    const s = Date.parse(h.startTime);
    if (!Number.isFinite(s) || s > now) continue;
    const e = Date.parse(h.endTime);
    if (Number.isFinite(e) && now < e) return h;
    started = h;
  }
  return started || hours[0] || null;
}

// Gated version for prominent single-value displays (hero, homepage markdown,
// MCP text): only surfaces when meaningfully different from the air
// temperature, so a table-free reader doesn't see noisy "88° feels like 89°".
function feelsLikeF(period) {
  const t = period?.temperature;
  const fl = feelsLikeRawF(period);
  return fl != null && typeof t === "number" && Math.abs(fl - t) >= 3 ? fl : null;
}

// Sunrise/sunset for Crosby — computed astronomically in-Worker (the standard
// sunrise equation, same formulation as the SunCalc library), no fetch and no
// dependency. Validated against published Houston-area sun times across
// summer/winter/equinox dates (within ~2 min; the equation itself is good to
// about a minute at this latitude).
const SUN_RAD = Math.PI / 180, SUN_J1970 = 2440588, SUN_J2000 = 2451545;
function sunTimes(ms) {
  const lw = SUN_RAD * -LON, phi = SUN_RAD * LAT;
  const d = ms / 86400000 - 0.5 + SUN_J1970 - SUN_J2000; // days since J2000
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI)); // Julian cycle
  const ds = 0.0009 + lw / (2 * Math.PI) + n; // approx solar transit
  const M = SUN_RAD * (357.5291 + 0.98560028 * ds); // solar mean anomaly
  const L = M + SUN_RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + SUN_RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(SUN_RAD * 23.4397)); // declination
  const Jnoon = SUN_J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  // -0.833° accounts for refraction + solar disc radius (standard rise/set zenith).
  const cosH = (Math.sin(-0.833 * SUN_RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH < -1 || cosH > 1) return null; // polar day/night — never at 29.9°N
  const w = Math.acos(cosH) / (2 * Math.PI); // half day length, in days
  const toMs = (j) => (j + 0.5 - SUN_J1970) * 86400000;
  return { sunrise: toMs(Jnoon - w), sunset: toMs(Jnoon + w) };
}
// Anchor a timestamp to noon Central of its own calendar date (18:00 UTC ≈
// solar noon at 95°W) before computing, so an evening hour can't round into
// the next solar day's sunrise/sunset.
function sunTimesForCtDate(ms) {
  const [y, m, d] = new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ }).split("-").map(Number);
  return sunTimes(Date.UTC(y, m - 1, d, 18));
}

// NWS icon URLs carry a ?size= param; bump it for crisper rendering, and
// rewrite api.weather.gov hotlinks to our own /icons proxy. NWS's robots.txt
// disallows all crawling, so hotlinked images are uncrawlable (and slower) —
// serving them from our origin makes them indexable and edge-cacheable.
function iconUrl(url, size) {
  if (!url) return "";
  const sized = url.replace(/size=\w+/, `size=${size}`);
  return esc(sized.replace("https://api.weather.gov/icons/", "/icons/"));
}

// Date/time formatting. `lang` is optional and defaults to English, so every
// existing English call site is unchanged; the Spanish (/es) render paths pass
// "es" to get es-MX month/weekday/AM-PM rendering. Times stay in Central (CT).
function fmt(iso, opts, lang) {
  try {
    return new Date(iso).toLocaleString(lang === "es" ? "es-MX" : "en-US", { timeZone: TZ, ...opts });
  } catch {
    return "";
  }
}
const fullTime = (iso, lang) => fmt(iso, { dateStyle: "medium", timeStyle: "short" }, lang);
const clockTime = (iso, lang) => fmt(iso, { hour: "numeric", minute: "2-digit" }, lang);
const hourLabel = (iso, lang) => fmt(iso, { hour: "numeric" }, lang);
const dayLabel = (iso, lang) => fmt(iso, { weekday: "long", month: "short", day: "numeric" }, lang);
// Spanish correctly lowercases weekday/month names in running text, but our
// UI uses them as HEADINGS ("Sábado 4 de jul"), where a leading capital is
// the site-wide convention (the calendar page already does this).
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// Compact relative freshness ("6 min ago") for the glance data-source
// footnote, computed at render time from the cache's `updated` stamp. Paired
// with the absolute clock time so it stays unambiguous even if a tab lingers.
function relTime(iso, lang) {
  const ms = Date.now() - Date.parse(iso);
  if (!(ms >= 0)) return T(lang, "just now", "hace un momento");
  const min = Math.round(ms / 60000);
  if (min < 1) return T(lang, "just now", "hace un momento");
  if (min < 60) return T(lang, `${min} min ago`, `hace ${min} min`);
  const hr = Math.round(min / 60);
  if (hr < 24) return T(lang, `${hr} hr ago`, `hace ${hr} h`);
  const d = Math.round(hr / 24);
  return T(lang, `${d} day${d === 1 ? "" : "s"} ago`, `hace ${d} día${d === 1 ? "" : "s"}`);
}

// --- i18n: English + Mexican Spanish (es-MX) ------------------------------
// The site renders in English at the root paths and in Spanish under /es.
// Approach: keep English literals inline (so the English output is unchanged
// and easy to review) and supply the Spanish alongside via T(). Live NWS text
// is handled deterministically — short conditions go through a hand-written
// dictionary (NO machine translation), while free-form detailed-forecast
// paragraphs and safety-critical alert wording stay in NWS's official English.
// (NWS has no Spanish forecast/alert API, and its experimental auto-translation
// was paused in 2025 — so English is the only authoritative source.)
const T = (lang, en, es) => (lang === "es" ? es : en);

// Map an English content path to its Spanish counterpart, and build canonical /
// hreflang URLs from a page's English path. "/" pairs with "/es".
const esPath = (enPath) => (enPath === "/" ? "/es" : "/es" + enPath);
const canonicalFor = (enPath, lang) => SITE + (lang === "es" ? esPath(enPath) : enPath);

// Reciprocal hreflang alternates linking the en/es versions of a page (plus an
// x-default pointing at English). Emitted in both languages' <head>.
function hreflangTags(enPath) {
  const en = SITE + enPath;
  const es = SITE + esPath(enPath);
  return `<link rel="alternate" hreflang="en-US" href="${en}">
<link rel="alternate" hreflang="es-MX" href="${es}">
<link rel="alternate" hreflang="x-default" href="${en}">`;
}

// Short-conditions dictionary (NWS `shortForecast`). Hand-authored, not machine
// translation. Compound values like "Mostly Sunny then Chance Rain Showers" are
// split on " then " and each segment looked up; anything unmapped falls back to
// the original English (honest, and rare for Gulf Coast conditions).
const ES_SHORT = {
  Sunny: "Soleado",
  "Mostly Sunny": "Mayormente soleado",
  "Partly Sunny": "Parcialmente soleado",
  Clear: "Despejado",
  "Mostly Clear": "Mayormente despejado",
  "Partly Cloudy": "Parcialmente nublado",
  "Mostly Cloudy": "Mayormente nublado",
  Cloudy: "Nublado",
  Hot: "Caluroso",
  "Sunny and Hot": "Soleado y caluroso",
  "Areas Of Fog": "Áreas de niebla",
  "Patchy Fog": "Niebla dispersa",
  Fog: "Niebla",
  Haze: "Bruma",
  Smoke: "Humo",
  Breezy: "Brisa ligera",
  Windy: "Ventoso",
  Rain: "Lluvia",
  "Light Rain": "Lluvia ligera",
  "Heavy Rain": "Lluvia fuerte",
  Drizzle: "Llovizna",
  Showers: "Chubascos",
  "Rain Showers": "Chubascos",
  "Light Rain Showers": "Chubascos ligeros",
  "Rain Likely": "Lluvia probable",
  "Showers Likely": "Chubascos probables",
  "Rain Showers Likely": "Chubascos probables",
  "Chance Rain": "Probabilidad de lluvia",
  "Chance Light Rain": "Probabilidad de lluvia ligera",
  "Chance Rain Showers": "Probabilidad de chubascos",
  "Slight Chance Rain": "Ligera probabilidad de lluvia",
  "Slight Chance Rain Showers": "Ligera probabilidad de chubascos",
  Thunderstorms: "Tormentas eléctricas",
  "Thunderstorms Likely": "Tormentas eléctricas probables",
  "Showers And Thunderstorms": "Chubascos y tormentas eléctricas",
  "Showers And Thunderstorms Likely": "Chubascos y tormentas probables",
  "Chance Showers And Thunderstorms": "Probabilidad de chubascos y tormentas",
  "Slight Chance Showers And Thunderstorms": "Ligera probabilidad de chubascos y tormentas",
  "Chance Thunderstorms": "Probabilidad de tormentas eléctricas",
  "Slight Chance Thunderstorms": "Ligera probabilidad de tormentas",
  "Isolated Thunderstorms": "Tormentas aisladas",
  "Scattered Showers And Thunderstorms": "Chubascos y tormentas dispersos",
  Snow: "Nieve",
  "Light Snow": "Nieve ligera",
  "Chance Snow": "Probabilidad de nieve",
  "Rain And Snow": "Lluvia y nieve",
  "Wintry Mix": "Mezcla invernal",
  "Freezing Rain": "Lluvia helada",
  Sleet: "Aguanieve",
  Frost: "Heladas",
  "Blowing Dust": "Polvo en suspensión",
};

function translateConditions(text, lang) {
  if (lang !== "es" || !text) return text;
  return String(text)
    .split(/ then /i)
    .map((seg) => {
      const s = seg.trim();
      return ES_SHORT[s] || s;
    })
    .join(" luego ");
}

// NWS period names ("Tonight", "This Afternoon", "Monday", "Monday Night", ...).
const ES_WEEKDAY = {
  Sunday: "Domingo", Monday: "Lunes", Tuesday: "Martes", Wednesday: "Miércoles",
  Thursday: "Jueves", Friday: "Viernes", Saturday: "Sábado",
};
const ES_PERIOD = {
  Today: "Hoy",
  Tonight: "Esta noche",
  "This Morning": "Esta mañana",
  "This Afternoon": "Esta tarde",
  "This Evening": "Esta tarde-noche",
  Overnight: "Durante la madrugada",
  "Late Tonight": "Tarde por la noche",
};
function translatePeriodName(name, lang) {
  if (lang !== "es" || !name) return name;
  if (ES_PERIOD[name]) return ES_PERIOD[name];
  if (ES_WEEKDAY[name]) return ES_WEEKDAY[name];
  const m = name.match(/^(\w+) Night$/);
  if (m && ES_WEEKDAY[m[1]]) return `${ES_WEEKDAY[m[1]]} por la noche`;
  return name; // holidays / unusual labels stay English (honest fallback)
}

// Wind speed ("5 to 10 mph" -> "5 a 10 mph") and direction (W -> O, SW -> SO).
function translateWind(speed, lang) {
  if (lang !== "es" || !speed) return speed;
  return String(speed).replace(/\bto\b/g, "a");
}
const ES_DIR = {
  N: "N", NNE: "NNE", NE: "NE", ENE: "ENE", E: "E", ESE: "ESE", SE: "SE", SSE: "SSE",
  S: "S", SSW: "SSO", SW: "SO", WSW: "OSO", W: "O", WNW: "ONO", NW: "NO", NNW: "NNO",
};
const translateDir = (dir, lang) => (lang === "es" && dir ? ES_DIR[dir] || dir : dir);

// One honest line shown on the Spanish weather pages so the English NWS text
// isn't a surprise. Kept in the i18n block so it can't drift between pages.
const ES_NWS_NOTE =
  "Las condiciones se traducen al español. Las descripciones detalladas del pronóstico y las alertas provienen del Servicio Meteorológico Nacional de EE.&nbsp;UU. y se muestran en su idioma oficial (inglés).";
// --- end i18n -------------------------------------------------------------

function renderAlerts(alerts, lang) {
  if (!alerts.length) return "";
  const cards = alerts
    .map(
      (a) => `
      <article class="alert">
        <h3>&#9888; ${esc(a.event)}</h3>
        ${a.headline ? `<p class="headline">${esc(a.headline)}</p>` : ""}
        ${a.description ? `<p>${nl2br(a.description)}</p>` : ""}
        ${a.instruction ? `<p class="instruction"><strong>${T(lang, "What to do:", "Qué hacer:")}</strong> ${nl2br(a.instruction)}</p>` : ""}
        ${a.expires ? `<p class="meta">${T(lang, "In effect until", "Vigente hasta")} ${esc(fullTime(a.expires, lang))}</p>` : ""}
      </article>`
    )
    .join("");
  return `<section class="alerts" aria-label="${T(lang, "Active weather alerts", "Alertas meteorológicas activas")}">${cards}</section>`;
}

function renderHero(data, lang) {
  const now = currentHourly(data);
  const lead = data.periods?.[0];
  // Degenerate NWS response (zero hourly periods): suppress the hero panel but
  // still emit the page's single <h1> so it never renders heading-less.
  if (!now) return `<h1>${T(lang, `${esc(data.place)} Weather`, `Clima en ${esc(data.place)}`)}</h1>`;
  const feels = feelsLikeF(now);
  const sun = sunTimesForCtDate(Date.now());
  const uvNow = uvCurrent(data);
  const aqi = data.aqi;
  return `
    <section class="hero">
      ${now.icon ? `<img class="hero-icon" src="${iconUrl(now.icon, "large")}" alt="${esc(translateConditions(now.shortForecast, lang))}" width="128" height="128" fetchpriority="high">` : ""}
      <div class="hero-now">
        <h1 class="hero-h1">${T(lang, `${esc(data.place)} Weather`, `Clima en ${esc(data.place)}`)}</h1>
        <p class="hero-temp">${esc(now.temperature)}&deg;<span>${esc(now.temperatureUnit)}</span></p>
        <p class="hero-cond">${esc(translateConditions(now.shortForecast, lang))}</p>
        ${feels != null ? `<p class="hero-feels">${T(lang, "Feels like", "Sensación térmica de")} ${esc(feels)}&deg;</p>` : ""}
        <p class="hero-meta">${esc(data.place)} &middot; ${T(lang, "as of", "a las")} ${esc(clockTime(now.startTime, lang))} CT${pop(now) ? ` &middot; ${pop(now)}% ${T(lang, "precip", "prob. lluvia")}` : ""}${uvNow ? ` &middot; ${T(lang, "UV", "UV")} ${esc(uvNow)} (${esc(uvCategory(uvNow, lang))})` : ""}${aqi?.usAqi != null ? ` &middot; ${T(lang, "Air", "Aire")} ${esc(aqi.usAqi)} (${esc(aqiCategory(aqi.usAqi, lang))}, ${T(lang, "modeled", "modelado")})` : ""}</p>
        ${sun ? `<p class="hero-meta">${T(lang, "Sunrise", "Amanecer")} ${esc(clockTime(sun.sunrise, lang))} &middot; ${T(lang, "Sunset", "Atardecer")} ${esc(clockTime(sun.sunset, lang))}</p>` : ""}
      </div>
    </section>
    ${lead ? `<p class="lead"><strong>${esc(translatePeriodName(lead.name, lang))}:</strong> ${esc(lead.detailedForecast)}</p>` : ""}`;
}

function renderHourly(hourly, lang) {
  if (!hourly?.length) return "";
  const cells = hourly
    .map(
      (h) => `
      <div class="hour">
        <span class="hour-time">${esc(hourLabel(h.startTime, lang))}</span>
        ${h.icon ? `<img src="${iconUrl(h.icon, "small")}" alt="${esc(translateConditions(h.shortForecast, lang))}" width="44" height="44" loading="lazy">` : ""}
        <span class="hour-temp">${esc(h.temperature)}&deg;</span>
        <span class="hour-pop${pop(h) >= 30 ? " wet" : ""}">${pop(h)}%</span>
      </div>`
    )
    .join("");
  return `<section class="card">
    <h2>${T(lang, "Next 12 hours", "Próximas 12 horas")}</h2>
    <div class="hourly">${cells}</div>
  </section>`;
}

function renderDaily(periods, lang) {
  if (!periods.length) return `<p class="none">${T(lang, "No forecast available.", "Pronóstico no disponible.")}</p>`;
  const cards = periods
    .map(
      (p) => `
      <article class="period ${p.isDaytime ? "day" : "night"}">
        <div class="period-head">
          <h3>${esc(translatePeriodName(p.name, lang))}</h3>
          ${p.icon ? `<img src="${iconUrl(p.icon, "medium")}" alt="${esc(translateConditions(p.shortForecast, lang))}" width="52" height="52" loading="lazy">` : ""}
        </div>
        <p class="temp">${p.isDaytime ? T(lang, "High", "Máx.") : T(lang, "Low", "Mín.")} ${esc(p.temperature)}&deg;${esc(p.temperatureUnit)}</p>
        <p class="short">${esc(translateConditions(p.shortForecast, lang))}</p>
        <p class="meta">${pop(p) ? `${pop(p)}% ${T(lang, "precip", "prob. lluvia")} &middot; ` : ""}${T(lang, "Wind", "Viento")} ${esc(translateWind(p.windSpeed, lang))} ${esc(translateDir(p.windDirection, lang))}</p>
        <p class="detail">${esc(p.detailedForecast)}</p>
      </article>`
    )
    .join("");
  return `<section class="daily-sec">
    <h2>${T(lang, "7-Day Forecast", "Pronóstico a 7 días")}</h2>
    <div class="periods">${cards}</div>
  </section>`;
}

// Shared CSS used by every HTML page (weather + about), so styling can't drift.
const BASE_CSS = `
  :root { color-scheme: light dark; --blue:#0b3d61; --accent:#2c7fb8; --sun:#f5b301; --bg:#eef2f6; --card:#fff; --ink:#16222e; --muted:#5a6b7b; --line:#d8dee5; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1620; --card:#1a2430; --ink:#e6ebf1; --muted:#94a3b2; --line:#2a3744; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; line-height:1.5; background:var(--bg); color:var(--ink); }
  .topbar .skip-link { position:absolute; left:-9999px; z-index:100; background:var(--card); color:var(--ink); padding:0.5rem 0.9rem; border-radius:0 0 8px 0; }
  .topbar .skip-link:focus { position:fixed; left:0; top:0; }
  .topbar { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.4rem 1rem; background:var(--blue); color:#fff; padding:0.6rem 1rem; }
  .topbar a { color:#fff; text-decoration:none; }
  .topbar .brand { font-weight:800; letter-spacing:0.09em; text-transform:uppercase; font-size:1rem; }
  .topbar nav { display:flex; flex-wrap:wrap; gap:0.5rem 1rem; align-items:center; font-size:0.9rem; }
  .topbar nav a { opacity:0.85; white-space:nowrap; }
  .topbar nav a:hover, .topbar nav a[aria-current="page"] { opacity:1; text-decoration:underline; }
  .topbar nav a.lang { opacity:1; border:1px solid rgba(255,255,255,0.45); border-radius:6px; padding:0.02rem 0.45rem; }
  .nav-menu { display:contents; }
  .nav-menu summary { display:none; }
  .nav-links { display:contents; }
  /* Group headers and mobile-only links belong to the hamburger menu only —
     hidden on the flat desktop bar (shown in the @media block below). */
  .nav-group-label, .nav-links a.m-only { display:none; }
  /* Desktop: show the nav links inline. Modern Chromium hides closed-<details>
     content via ::details-content { content-visibility:hidden }, which
     display:contents does NOT override — without this the desktop nav vanishes. */
  .nav-menu::details-content { content-visibility: visible; }
  /* Collapse to the grouped hamburger below 920px. The full inline bar needs
     ~920px to fit the (longer) Spanish labels on one row; below that it wrapped
     to two rows on landscape phones, so the hamburger is cleaner there. */
  @media (max-width:920px) {
    .topbar { gap:0.35rem 0.6rem; padding:0.55rem 0.85rem; flex-wrap:nowrap; }
    .topbar .brand { font-size:0.88rem; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .topbar nav { gap:0.4rem 0.95rem; font-size:0.86rem; flex:0 0 auto; flex-wrap:nowrap; }
    .topbar nav .lang { order:1; }
    .topbar nav .nav-menu { order:2; }
    .nav-menu { display:block; position:relative; }
    /* A real 44px tap target for the hamburger, comfortably clear of Español. */
    .nav-menu summary { display:flex; align-items:center; justify-content:center; cursor:pointer; list-style:none; font-size:1.5rem; line-height:1; opacity:0.95; color:#fff; width:2.2rem; height:2.2rem; margin-right:-0.4rem; }
    .nav-menu summary::-webkit-details-marker { display:none; }
    .nav-links { display:none; }
    .nav-menu[open] .nav-links { display:flex; flex-direction:column; position:absolute; right:0; top:calc(100% + 0.5rem); background:var(--blue); padding:0.7rem 1.1rem 0.9rem; border-radius:10px; z-index:10; gap:0.15rem; min-width:13rem; box-shadow:0 6px 16px rgba(0,0,0,0.35); }
    .nav-links a { opacity:0.92; white-space:nowrap; padding:0.35rem 0; }
    .nav-links a:hover, .nav-links a[aria-current="page"] { opacity:1; text-decoration:underline; }
    .nav-menu[open] .nav-links a.m-only { display:block; }
    .nav-menu[open] .nav-links .nav-group-label { display:block; font-size:0.66rem; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:rgba(255,255,255,0.5); margin:0.55rem 0 0.05rem; padding-top:0.5rem; border-top:1px solid rgba(255,255,255,0.14); }
  }
  main { max-width:920px; margin:0 auto; padding:1rem; }
  h2 { font-size:1.1rem; margin:1.4rem 0 0.6rem; }
  .none { color:var(--muted); font-style:italic; }
  footer { max-width:920px; margin:1rem auto; padding:0 1rem 2rem; font-size:0.8rem; color:var(--muted); text-align:center; }
  footer a { color:inherit; }
  .footer-links { display:flex; flex-wrap:wrap; justify-content:center; gap:0.3rem 0.75rem; margin-top:0.5rem; }
  .footer-disclaimer { margin-top:0.5rem; font-size:0.75rem; }
  .nws-note { font-size:0.85rem; opacity:0.9; }
`;

// Site header with cross-page nav. \`current\` is the active EN path key for
// aria-current; \`lang\` selects English vs Spanish labels and the /es hrefs, and
// adds a language toggle linking to the same page in the other language.
function topbar(current, lang = "en") {
  const es = lang === "es";
  // `cls` marks a link mobile-menu-only (m-only): shown in the grouped
  // hamburger, hidden from the flat desktop bar so the desktop nav stays lean.
  const link = (enHref, label, cls) =>
    `<a href="${es ? esPath(enHref) : enHref}"${cls ? ` class="${cls}"` : ""}${current === enHref ? ' aria-current="page"' : ""}>${label}</a>`;
  const t = (en, esLabel) => (es ? esLabel : en);
  // Section labels are hidden on desktop (flat inline bar) and shown as
  // group headers only when the mobile menu is open. One markup, two layouts.
  const group = (label) => `<span class="nav-group-label">${label}</span>`;
  const toggle = es
    ? `<a class="lang" hreflang="en-US" lang="en" href="${current}">English</a>`
    : `<a class="lang" hreflang="es-MX" lang="es" href="${esPath(current)}">Español</a>`;
  return `<header class="topbar">
  <a class="skip-link" href="#main">${t("Skip to content", "Saltar al contenido")}</a>
  <a class="brand" href="${es ? "/es" : "/"}">crosbynews.com</a>
  <nav>
    <details class="nav-menu">
      <summary aria-label="${t("Menu", "Menú")}">&#9776;</summary>
      <div class="nav-links">${link("/", t("Home", "Inicio"))} ${group(t("Weather", "Clima"))} ${link("/weather", t("Weather", "Clima"))} ${link("/hourly", t("Hourly", "Por hora"), "m-only")} ${link("/radar", t("Radar", "Radar"))} ${link("/alerts", t("Alerts", "Alertas"))} ${link("/water", t("Water Levels", "Niveles de agua"))} ${link("/tropics", t("Tropics", "Trópicos"), "m-only")} ${group(t("Community", "Comunidad"))} ${link("/news", t("News", "Noticias"))} ${link("/calendar", t("School Calendar", "Calendario escolar"))} ${group(t("More", "Más"))} ${link("/emergency", t("Emergency", "Emergencias"), "m-only")} ${link("/about", t("About", "Acerca de"))} ${link("/developers", t("Developers", "Desarrolladores"), "m-only")}</div>
    </details>
    ${toggle}
  </nav>
</header>`;
}

const WEATHER_PAGES = new Set(["/", "/weather", "/hourly", "/radar", "/alerts"]);

function footer({ page, lang = "en", source, data }) {
  const es = lang === "es";
  const lk = (enHref, label) => `<a href="${es ? esPath(enHref) : enHref}">${label}</a>`;
  const mdHref = (es ? esPath(page) : page) + "?format=md";

  const weatherLine = WEATHER_PAGES.has(page) && data
    ? `${!(data.alerts ?? []).length ? T(lang, "No active weather alerts. ", "Sin alertas meteorológicas activas. ") : ""}${source}<br>
  ${T(lang, "Updated", "Actualizado")} ${esc(fullTime(data.updated, lang))} CT &middot; ${T(lang, "refreshes every 15 minutes.", "se actualiza cada 15 minutos.")}`
    : source;

  const links = `<div class="footer-links">${lk("/", T(lang, "Home", "Inicio"))} &middot; ${lk("/emergency", T(lang, "Emergency", "Emergencias"))} &middot; ${lk("/about", T(lang, "About", "Acerca de"))} &middot; ${lk("/developers", T(lang, "Developers", "Desarrolladores"))} &middot; ${lk("/privacy", T(lang, "Privacy", "Privacidad"))} &middot; ${lk("/contact", T(lang, "Contact", "Contacto"))} &middot; ${lk("/sitemap", T(lang, "Sitemap", "Mapa del sitio"))} &middot; <a href="${mdHref}">${T(lang, "View as Markdown", "Ver en Markdown")}</a></div>`;

  const disclaimer = `<div class="footer-disclaimer">${T(lang, "crosbynews.com is an independent project and is not affiliated with the National Weather Service, NOAA, or any government agency.", "crosbynews.com es un proyecto independiente y no está afiliado al Servicio Meteorológico Nacional, la NOAA ni ninguna agencia gubernamental.")}</div>`;

  return `<footer>
  ${weatherLine}
  ${links}
  ${disclaimer}
</footer>`;
}

// Homepage inline script (15-min auto-refresh + WebMCP tool registration). Kept
// as one constant so its Content-Security-Policy hash can be derived from the
// exact bytes that ship — the same can't-drift trick used for the SKILL.md
// digest. Editing this string automatically changes the CSP hash to match.
const HOME_SCRIPT = `
// Auto-refresh the page every 15 minutes to keep the forecast current.
// (Done in JS rather than a meta-refresh http-equiv tag, which search engines
// flag.) Only reloads a foreground tab, so a background tab isn't thrashed.
setTimeout(function () {
  if (document.visibilityState === "visible") location.reload();
  else document.addEventListener("visibilitychange", function once() {
    if (document.visibilityState === "visible") { document.removeEventListener("visibilitychange", once); location.reload(); }
  });
}, 900000);

// Offline resilience: register the service worker (storm-time cache of the
// hub + alerts — see SW_SCRIPT). Progressive enhancement: rejected/absent
// registration is silently ignored.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(function () {});
}

// WebMCP: expose Crosby weather as in-browser agent tools. Progressive
// enhancement — a no-op in browsers without navigator.modelContext.
(function () {
  var mc = navigator.modelContext;
  if (!mc) return;
  async function weather() { return (await fetch("/api/weather")).json(); }
  var tools = [
    {
      name: "get_crosby_forecast",
      description: "Current conditions and forecast for Crosby, TX.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async function () {
        var w = await weather(), c = w.current;
        var text = c ? "Crosby, TX: " + c.temperature + "°" + c.temperatureUnit + ", " + c.shortForecast : "unavailable";
        return { content: [{ type: "text", text: text }] };
      },
    },
    {
      name: "get_crosby_alerts",
      description: "Active NWS weather alerts for Crosby, TX.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async function () {
        var w = await weather();
        var text = (w.alerts && w.alerts.length) ? w.alerts.map(function (a) { return a.event; }).join(", ") : "No active weather alerts.";
        return { content: [{ type: "text", text: text }] };
      },
    },
  ];
  try {
    if (typeof mc.provideContext === "function") mc.provideContext({ tools: tools });
    else if (typeof mc.registerTool === "function") tools.forEach(function (t) { mc.registerTool(t); });
  } catch (e) {}
})();
`;

// Severe-alert push opt-in (the /alerts page). One constant so its CSP hash is
// derived from the exact bytes shipped (like HOME_SCRIPT). Language-agnostic:
// all user-facing strings are read from data-* attributes on the container, so
// the same bytes (one hash) serve both languages. Progressive enhancement —
// the container stays hidden unless the browser supports push AND the server
// returns a VAPID key.
const PUSH_CLIENT_SCRIPT = `
(function () {
  var el = document.getElementById("push-optin");
  if (!el) return;
  var d = el.dataset;
  var descEl = el.querySelector(".push-desc");
  var btn = el.querySelector(".push-btn");
  var statusEl = el.querySelector(".push-status");
  var vapidKey = null, reg = null;

  // iOS Safari exposes Push ONLY to Home-Screen web apps. In a plain Safari
  // tab, don't hide the feature's existence - show how to get it instead.
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone && d.ios) {
      descEl.textContent = d.ios;
      if (btn) btn.hidden = true;
      el.hidden = false;
    }
    return;
  }

  function toBytes(s) {
    // base64url -> Uint8Array. Pad to a multiple of 4 (same loop as the
    // Worker-side decoder - a slicker closed-form version shipped broken once).
    while (s.length % 4) s += "=";
    var b = s.replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(b), arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  function setState(subbed) {
    descEl.textContent = subbed ? d.on : d.off;
    btn.textContent = subbed ? d.unsub : d.sub;
    btn.setAttribute("aria-pressed", subbed ? "true" : "false");
    btn.dataset.subbed = subbed ? "1" : "";
  }

  async function init() {
    try { vapidKey = (await (await fetch("/api/push/vapid-key")).json()).key; } catch (e) {}
    if (!vapidKey) return;
    try { await navigator.serviceWorker.register("/sw.js"); reg = await navigator.serviceWorker.ready; } catch (e) { return; }
    var sub = null;
    try { sub = await reg.pushManager.getSubscription(); } catch (e) {}
    setState(!!sub);
    el.hidden = false;
  }

  btn && btn.addEventListener("click", async function () {
    btn.disabled = true; statusEl.textContent = "";
    try {
      if (btn.dataset.subbed) {
        var sub = await reg.pushManager.getSubscription();
        if (sub) {
          try { await fetch("/api/push/unsubscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch (e) {}
          await sub.unsubscribe();
        }
        setState(false);
      } else {
        // Permission FIRST: Safari only honors the prompt while the tap's
        // transient activation is alive, so no other awaits may come before it.
        var perm = await Notification.requestPermission();
        if (perm !== "granted") { statusEl.textContent = d.blocked; btn.disabled = false; return; }
        var newSub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(vapidKey) });
        var r = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(newSub) });
        if (!r.ok) throw new Error("subscribe failed");
        setState(true);
      }
    } catch (e) { statusEl.textContent = d.error; }
    btn.disabled = false;
  });

  init();
})();
`;

// Sitewide structured data (schema.org JSON-LD): the site's identity + publisher.
// Static, so it's built once at module load; it's a non-executable data block, so
// CSP `script-src` doesn't apply (no hash needed). Pages can add a page-specific
// node (e.g. AboutPage) alongside it. Kept honest — no invented schema for the
// forecast (there's no truthful schema.org type for it) and no fake ratings/FAQ.
const ORG_ID = SITE + "/#org";
const WEBSITE_ID = SITE + "/#website";
const JSONLD_SITE = `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: "crosbynews.com",
      alternateName: "Crosby News",
      url: SITE + "/",
      description: "Independent live weather and local news for Crosby, Texas.",
      email: "contact@crosbynews.com",
      sameAs: ["https://github.com/reloru/new-relo"],
    },
    {
      "@type": "WebSite",
      "@id": WEBSITE_ID,
      url: SITE + "/",
      name: "crosbynews.com",
      description: "Live weather and local news for Crosby, Texas — fast, ad-free, no trackers.",
      inLanguage: "en-US",
      publisher: { "@id": ORG_ID },
    },
  ],
})}</script>`;

// schema.org Dataset describing the public weather API — emitted on /developers
// (both languages; the API itself is English-only and language-neutral) so
// dataset search engines (e.g. Google Dataset Search) can discover it. Honest:
// unlike forecast markup, a Dataset is a truthful schema type for what the API
// actually is. Static, so built once at module load, like JSONLD_SITE.
const JSONLD_DATASET = `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Dataset",
  "@id": SITE + "/#weather-dataset",
  name: "Crosby, TX weather — current conditions, forecast, and alerts",
  description:
    "Current conditions, hourly forecast, 7-day forecast, and active National Weather Service alerts for Crosby, Texas (northeast Harris County), refreshed every 15 minutes from the U.S. National Weather Service (api.weather.gov). Free public JSON API, no authentication.",
  url: SITE + "/developers",
  isAccessibleForFree: true,
  license: "https://www.weather.gov/disclaimer",
  creator: { "@id": ORG_ID },
  spatialCoverage: {
    "@type": "Place",
    name: "Crosby, TX",
    geo: { "@type": "GeoCoordinates", latitude: LAT, longitude: LON },
  },
  distribution: [
    { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: SITE + "/api/weather" },
  ],
})}</script>`;

// Invariant Open Graph / Twitter tags every page repeats. og:url is per-page
// (it mirrors <link rel="canonical">). No og:image — that would need a binary
// asset, which the "no static assets" rule forbids; cards still render the
// title, description, and site name.
const OG_COMMON = `<meta property="og:site_name" content="Crosby News">
<meta name="twitter:card" content="summary">`;

function renderHtml(data, lang) {
  const hasAlerts = (data.alerts ?? []).length > 0;
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T(lang, "Crosby, TX Weather", "Clima de Crosby, TX")} &mdash; crosbynews.com</title>
<meta name="description" content="${T(lang, "Live weather forecast and active alerts for Crosby, Texas, refreshed every 15 minutes from the U.S. National Weather Service.", "Pronóstico del tiempo y alertas activas para Crosby, Texas, actualizado cada 15 minutos del Servicio Meteorológico Nacional de EE. UU.")}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${T(lang, "Crosby, TX Weather", "Clima de Crosby, TX")}">
<meta property="og:description" content="${T(lang, "Live forecast and active alerts for Crosby, Texas.", "Pronóstico del tiempo y alertas activas para Crosby, Texas.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/weather", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/weather", lang)}">
${hreflangTags("/weather")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .hero { display:flex; align-items:center; gap:1rem; background:linear-gradient(135deg,var(--blue),var(--accent)); color:#fff; border-radius:16px; padding:1.1rem 1.3rem; margin-top:0.5rem; }
  .hero-h1 { margin:0 0 0.15rem; font-size:1rem; font-weight:600; opacity:0.9; letter-spacing:0.01em; }
  .hero-icon { border-radius:12px; background:rgba(255,255,255,0.12); flex:none; }
  .hero-temp { margin:0; font-size:3.4rem; font-weight:800; line-height:1; }
  .hero-temp span { font-size:1.2rem; font-weight:600; vertical-align:super; opacity:0.85; }
  .hero-cond { margin:0.2rem 0 0; font-size:1.2rem; font-weight:600; }
  .hero-feels { margin:0.15rem 0 0; font-size:0.95rem; opacity:0.9; }
  .hero-meta { margin:0.35rem 0 0; font-size:0.85rem; opacity:0.85; }
  .lead { margin:0.8rem 0 0; color:var(--muted); }

  .card { background:var(--card); border-radius:12px; padding:0.8rem 1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.6rem; }
  .hourly { display:flex; gap:0.4rem; overflow-x:auto; padding-bottom:0.3rem; }
  .hour { flex:0 0 auto; width:62px; display:flex; flex-direction:column; align-items:center; gap:0.15rem; text-align:center; }
  .hour-time { font-size:0.8rem; color:var(--muted); }
  .hour-temp { font-weight:700; }
  .hour-pop { font-size:0.75rem; color:var(--muted); }
  .hour-pop.wet { color:var(--accent); font-weight:700; }

  .periods { display:grid; gap:0.75rem; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); }
  .period { background:var(--card); border-radius:12px; padding:0.85rem 1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .period.night { background:color-mix(in srgb,var(--card) 92%, var(--blue)); }
  .period-head { display:flex; justify-content:space-between; align-items:center; gap:0.5rem; }
  .period-head h3 { margin:0; font-size:1.02rem; }
  .period .temp { margin:0.2rem 0; font-size:1.5rem; font-weight:800; color:var(--accent); }
  .period .short { margin:0.2rem 0; font-weight:600; }
  .period .meta { margin:0.2rem 0; font-size:0.82rem; color:var(--muted); }
  .period .detail { margin:0.5rem 0 0; font-size:0.9rem; }

  .alerts { display:grid; gap:0.6rem; margin-top:0.5rem; }
  .alert { background:#fff4f3; border-left:5px solid #c0392b; border-radius:10px; padding:0.8rem 1rem; }
  .alert h3 { margin:0 0 0.3rem; color:#a3271b; }
  .alert .headline { font-weight:700; }
  .alert .instruction { background:rgba(255,255,255,0.65); border-radius:6px; padding:0.5rem 0.7rem; }
  .alert .meta { font-size:0.8rem; color:var(--muted); }
  @media (prefers-color-scheme: dark) { .alert { background:#2a1715; } .alert .instruction { background:rgba(0,0,0,0.25); } }
</style>
</head>
<body>
${topbar("/weather", lang)}
<main id="main">
  ${renderAlerts(data.alerts ?? [], lang)}
  ${renderHero(data, lang)}
  ${lang === "es" ? `<p class="lead nws-note">${ES_NWS_NOTE}</p>` : ""}
  ${renderHourly((data.hourly ?? []).slice(0, 12), lang)}
  ${renderDaily(data.periods ?? [], lang)}
  <p class="lead"><a href="${lang === "es" ? "/es/hourly" : "/hourly"}">${T(lang, "Full 48-hour hourly forecast", "Pronóstico por hora de 48 horas")}</a> &middot; <a href="${lang === "es" ? "/es/radar" : "/radar"}">${T(lang, "Radar", "Radar")}</a> &middot; <a href="${lang === "es" ? "/es/water" : "/water"}">${T(lang, "Water levels", "Niveles de agua")}</a></p>
</main>
${footer({ page: "/weather", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`), data })}
<script>${HOME_SCRIPT}</script>
</body>
</html>`;
}

// --- Homepage hub ---------------------------------------------------------
// The root (/ and /es) is the "front page of Crosby": current conditions up
// top (kept prominent so the root retains its weather relevance) plus at-a-
// glance cards linking into Weather, Water, News, and the School Calendar. The
// full forecast lives at /weather. The hub loads all four datasets in parallel
// (cheap KV reads) so one slow source can't serially block the page.
function hubWaterSummary(water, lang) {
  const gauges = water.gauges ?? [];
  const flooding = gauges.filter((g) => WATER_FLOOD_CATS.includes(g.category));
  if (flooding.length) {
    const rank = (c) => WATER_CAT_ORDER.indexOf(c);
    const worst = flooding.reduce((a, b) => (rank(b.category) > rank(a.category) ? b : a));
    return { cls: waterCatClass(worst.category), label: waterCatLabel(worst.category, lang), detail: `${esc(worst.name)}` };
  }
  if (!gauges.length) return { cls: "w-unknown", label: T(lang, "Unavailable", "No disponible"), detail: T(lang, "Water data temporarily unavailable", "Datos de agua no disponibles temporalmente") };
  return { cls: "w-normal", label: T(lang, "All normal", "Todo normal"), detail: T(lang, "No area gauges at flood stage", "Ningún medidor del área en etapa de inundación") };
}

// Compass abbreviations spelled out for the hero's plain-language wind line
// ("8 mph from the southeast"). Same 16-point set NWS uses.
const DIR_WORDS_EN = { N: "north", NNE: "north-northeast", NE: "northeast", ENE: "east-northeast", E: "east", ESE: "east-southeast", SE: "southeast", SSE: "south-southeast", S: "south", SSW: "south-southwest", SW: "southwest", WSW: "west-southwest", W: "west", WNW: "west-northwest", NW: "northwest", NNW: "north-northwest" };
const DIR_WORDS_ES = { N: "norte", NNE: "nornoreste", NE: "noreste", ENE: "estenoreste", E: "este", ESE: "estesureste", SE: "sureste", SSE: "sursureste", S: "sur", SSW: "sursuroeste", SW: "suroeste", WSW: "oestesuroeste", W: "oeste", WNW: "oestenoroeste", NW: "noroeste", NNW: "nornoroeste" };
const dirWord = (dir, lang) => (lang === "es" ? DIR_WORDS_ES : DIR_WORDS_EN)[dir] || dir || "";

// NWS alert severity, worst-first, for picking the banner's primary alert.
const ALERT_SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 };
const alertRank = (a) => ALERT_SEVERITY_RANK[a?.severity] ?? 0;

// One short verbatim-NWS line summarizing an alert: the first line of the
// description when it reads like a title (SWS products lead with one, e.g.
// "Dangerous Heat Likely Through Holiday Weekend"), else the NWS headline,
// truncated. Display-only; the full official text lives on /alerts.
function alertSummaryLine(a) {
  const first = String(a?.description || "").split(/\n/).map((s) => s.trim()).find(Boolean) || "";
  // Only use the first line when it reads like a title — warning products
  // start with "* WHAT..." / "..." section markup, which is not a summary.
  const line = first && first.length <= 110 && !/^[.*]/.test(first) ? first : String(a?.headline || "");
  return line.length > 110 ? line.slice(0, 109).trimEnd() + "…" : line;
}

// Progressive disclosure for alerts on the hub (full products live on
// /alerts): nothing when quiet; a compact banner with count, condensed
// type list, and the primary alert's one-line summary for 1–3 alerts; just
// count + worst type when 4+. Alert text itself stays official NWS English.
function hubAlertsBanner(alerts, lang) {
  if (!alerts.length) return "";
  const aUrl = lang === "es" ? "/es/alerts" : "/alerts";
  const byType = new Map();
  for (const a of alerts) byType.set(a.event, (byType.get(a.event) || 0) + 1);
  const primary = alerts.reduce((x, y) => (alertRank(y) > alertRank(x) ? y : x));
  const n = alerts.length;
  const sameType = byType.size === 1;
  // English pluralizer good for NWS event nouns (Statement/Warning/Watch/Advisory).
  const plural = (s) => (/y$/.test(s) ? s.replace(/y$/, "ies") : /(ch|sh|s|x)$/.test(s) ? s + "es" : s + "s");
  const title =
    n === 1
      ? esc(primary.event)
      : sameType
        ? T(lang, `${n} Active ${esc(plural(alerts[0].event))}`, `${n} alertas activas: ${esc(alerts[0].event)}`)
        : T(lang, `${n} Active Weather Alerts`, `${n} alertas meteorológicas activas`);
  let body = "";
  if (n <= 3) {
    const types = !sameType && n > 1 ? `<ul class="ab-types">${[...byType].map(([ev, c]) => `<li>${esc(ev)}${c > 1 ? ` &times;${c}` : ""}</li>`).join("")}</ul>` : "";
    const summary = alertSummaryLine(primary);
    body = `${types}${summary ? `<p class="ab-headline">${esc(summary)}</p>` : ""}`;
  } else {
    body = `<p class="ab-headline">${T(lang, "Highest severity:", "Mayor severidad:")} ${esc(primary.event)}</p>`;
  }
  return `<a class="alert-banner" href="${aUrl}">
    <p class="ab-title">&#9888;&#65039; ${title}</p>
    ${body}
    <p class="ab-link">${T(lang, "View all alerts", "Ver todas las alertas")} &rarr;</p>
  </a>`;
}

// Compact tropical-activity strip for the hub — self-hides when the Atlantic
// is quiet (most of the year), so the front page carries zero hurricane noise
// off-season. Deliberately calmer than the red alerts banner: activity in the
// basin is watch-this news, not act-now news (act-now arrives as NWS alerts).
function hubTropicsBanner(tropics, lang) {
  const storms = tropics?.storms ?? [];
  if (!storms.length) return "";
  const tUrl = lang === "es" ? "/es/tropics" : "/tropics";
  const list = storms.map((s) => tropicsStormLine(s, lang)).join(" · ");
  return `<a class="tropics-banner" href="${tUrl}">
    <p class="tb-title">&#127744; ${storms.length === 1 ? T(lang, "Tropical system in the Atlantic", "Sistema tropical en el Atlántico") : T(lang, `${storms.length} tropical systems in the Atlantic`, `${storms.length} sistemas tropicales en el Atlántico`)}</p>
    <p class="tb-detail">${esc(list)}</p>
    <p class="tb-link">${T(lang, "Track them", "Seguirlos")} &rarr;</p>
  </a>`;
}

// "Today at a Glance" numbers, all from the cached NWS data: daily periods
// for high/low, the REMAINING hourly periods of today (Central calendar day,
// current hour onward — hours already past are excluded even when the NWS
// product still carries them, so the peaks are stable and honestly
// forward-looking) for feels-like max, peak rain chance, wind range +
// prevailing direction and gusts, and the current hour for humidity/dew
// point. Every aggregate row is a peak or range, never an average, and the
// labels say which (user feedback: comparing against a phone app, they
// couldn't tell highs from averages or "today" from a rolling 24 h — the
// card carries a date + Updated stamp and per-row wording for exactly that).
// In the evening NWS drops today's daytime period, so the first daytime
// period is tomorrow's — the High row relabels itself instead of silently
// showing tomorrow's number under "Today".
function todayGlance(weather, lang) {
  const ctDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
  const nowMs = Date.now();
  const today = ctDay(new Date(nowMs).toISOString());
  const hours = (weather.hourly ?? []).filter((h) => ctDay(h.startTime) === today && Date.parse(h.endTime) > nowMs);
  const periods = weather.periods ?? [];
  const dayP = periods.find((p) => p.isDaytime);
  const nightP = periods.find((p) => !p.isDaytime);
  const now = currentHourly(weather);

  // Two groups, the way weather apps present it (weather.com, AccuWeather, NWS):
  // the day's outlook (highs/peaks/ranges for today) and the current-hour
  // readings. Labels are bare metric names — the time basis ("today's high" vs
  // "right now") lives in the group heading and each metric's expandable
  // explainer, not in the row label.
  const todayRows = [];
  const nowRows = [];
  const addTo = (arr) => (label, val) => {
    if (val != null && val !== "") arr.push([label, val]);
  };
  const addDay = addTo(todayRows);
  const addNow = addTo(nowRows);

  // "High" stays "High tomorrow" in the evening once NWS drops today's daytime
  // period — a correctness label (the number really is tomorrow's), not a
  // decorative time qualifier.
  const dayIsToday = dayP && ctDay(dayP.startTime) === today;
  addDay(dayIsToday ? T(lang, "High", "Máx.") : T(lang, "High tomorrow", "Máx. mañana"), dayP ? `${dayP.temperature}°` : null);
  addDay(T(lang, "Low", "Mín."), nightP ? `${nightP.temperature}°` : null);
  const feelsMax = hours.reduce((m, h) => Math.max(m, feelsLikeRawF(h) ?? -Infinity), -Infinity);
  if (feelsMax > -Infinity && dayP && feelsMax >= dayP.temperature) addDay(T(lang, "Feels like", "Sensación térmica"), `${feelsMax}°`);
  const popMax = hours.reduce((m, h) => Math.max(m, pop(h)), 0);
  addDay(T(lang, "Rain chance", "Prob. de lluvia"), `${popMax}%`);
  // UV gates on > 0: at night EPA's remaining hours for "today" are all 0, and
  // "UV index 0" would read as if the day never had any. Daytime Crosby is
  // always ≥ 1, so a 0 reliably means the daylight hours have passed.
  const uvPeak = uvPeakToday(weather);
  if (uvPeak) addDay(T(lang, "UV index", "Índice UV"), `${uvPeak} (${uvCategory(uvPeak, lang)})`);
  const speeds = hours.flatMap((h) => String(h.windSpeed || "").match(/\d+/g) || []).map(Number);
  const dirs = hours.map((h) => h.windDirection).filter(Boolean);
  if (speeds.length) {
    const mode = dirs.length ? [...dirs.reduce((m, d) => m.set(d, (m.get(d) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0][0] : "";
    const lo = Math.min(...speeds), hi = Math.max(...speeds);
    addDay(T(lang, "Wind", "Viento"), `${translateDir(mode, lang)} ${lo === hi ? lo : `${lo}–${hi}`} mph`);
  }
  const gusts = hours.flatMap((h) => String(h.windGust || "").match(/\d+/g) || []).map(Number);
  if (gusts.length) addDay(T(lang, "Gusts", "Rachas"), `${Math.max(...gusts)} mph`);
  // Current-hour readings. Air quality drops its inline "modeled" tag — the
  // "About air quality" explainer states it — so the row no longer wraps.
  const rh = now?.relativeHumidity?.value;
  if (typeof rh === "number") addNow(T(lang, "Humidity", "Humedad"), `${Math.round(rh)}%`);
  const dpC = now?.dewpoint?.value;
  if (typeof dpC === "number") addNow(T(lang, "Dew point", "Punto de rocío"), `${Math.round((dpC * 9) / 5 + 32)}°`);
  const aqi = weather.aqi;
  if (aqi?.usAqi != null) addNow(T(lang, "Air quality", "Calidad del aire"), `${aqi.usAqi} (${aqiCategory(aqi.usAqi, lang)})`);
  return { today: todayRows, now: nowRows };
}

// The glance card's date context: which Central calendar day the card
// describes (answers "is this today?"). The cache's freshness moved to the
// data-source footnote (glanceSourceLine) at the bottom of the card.
function glanceStamp(weather, lang) {
  return esc(capFirst(dayLabel(new Date().toISOString(), lang)));
}

// Tiny provenance + freshness footnote under the glance explainers: which
// upstreams the card's numbers come from and how fresh our cache is (absolute
// CT time plus a relative "N min ago"). Returns "" when we have no timestamp.
// Plain text (locale date/time strings need no escaping) so it serves both the
// HTML card and the ?format=md view.
function glanceSourceLine(weather, lang) {
  if (!weather.updated) return "";
  // ES: "Datos" + "del Servicio…" so it reads "Datos del…" (not "de el").
  const src = T(lang, "the National Weather Service, EPA, and Open-Meteo", "del Servicio Meteorológico Nacional, la EPA y Open-Meteo");
  return `${T(lang, "Data from", "Datos")} ${src} · ${T(lang, "updated", "actualizado")} ${clockTime(weather.updated, lang)} CT (${relTime(weather.updated, lang)})`;
}

// Short, honest explainers for the glance numbers people ask about most.
// Native <details> — progressive disclosure with zero JS.
function glanceExplainers(lang) {
  const items = [
    [
      T(lang, "About feels-like temperature", "Acerca de la sensación térmica"),
      T(
        lang,
        "This is the highest “feels like” expected for the rest of today — the peak, not an average. It's the heat index or wind chill: what the air feels like to your body once humidity or wind is factored in, computed with the National Weather Service's own formulas. Phone weather apps often use their own gentler “feels like” formulas, so theirs can read several degrees cooler than the NWS heat index on humid days.",
        "Es la sensación térmica más alta prevista para lo que resta del día — el máximo, no un promedio. Es el índice de calor o la sensación por viento: cómo se siente el aire para tu cuerpo al considerar la humedad o el viento, calculado con las fórmulas oficiales del Servicio Meteorológico Nacional. Las apps del teléfono suelen usar sus propias fórmulas más suaves, así que pueden marcar varios grados menos que el índice de calor del NWS en días húmedos."
      ),
    ],
    [
      T(lang, "About humidity", "Acerca de la humedad"),
      T(
        lang,
        "This is the humidity right now — how much moisture the air holds relative to its maximum. High humidity slows the evaporation of sweat, so hot days feel hotter.",
        "Es la humedad en este momento — cuánta humedad contiene el aire en relación con su máximo. La humedad alta frena la evaporación del sudor, así que los días calurosos se sienten más calurosos."
      ),
    ],
    [
      T(lang, "About dew point", "Acerca del punto de rocío"),
      T(
        lang,
        "This is the dew point right now — the temperature the air would have to cool to for dew to form. Above about 70° feels muggy; below about 55° feels dry.",
        "Es el punto de rocío en este momento — la temperatura a la que el aire tendría que enfriarse para que se forme rocío. Arriba de unos 70° se siente bochornoso; abajo de unos 55° se siente seco."
      ),
    ],
    [
      T(lang, "About the UV index", "Acerca del índice UV"),
      T(
        lang,
        "This is the highest UV index expected today — the EPA's forecast of peak sunburn-causing UV radiation, on a scale where 3–5 is moderate, 6–7 high, 8–10 very high, and 11+ extreme. At 6 or above, use sunscreen and seek shade around midday — Gulf Coast summers routinely reach very high.",
        "Es el índice UV más alto previsto para hoy — el pronóstico de la EPA sobre la radiación UV máxima que causa quemaduras, en una escala donde 3–5 es moderado, 6–7 alto, 8–10 muy alto y 11+ extremo. Con 6 o más, usa protector solar y busca sombra al mediodía — los veranos de la costa del Golfo llegan seguido a muy alto."
      ),
    ],
    [
      T(lang, "About air quality", "Acerca de la calidad del aire"),
      T(
        lang,
        "This is the air quality right now, on the U.S. AQI's standard 0–500 scale: 0–50 good, 51–100 moderate, 101–150 unhealthy for sensitive groups, 151+ unhealthy for everyone. Unlike every other number here, this one is modeled — there's no EPA air monitor in Crosby, so it comes from Open-Meteo's forecast rather than a nearby instrument, and it's a useful estimate (helpful during wildfire-smoke days) rather than an official reading.",
        "Es la calidad del aire en este momento, en la escala estándar de 0 a 500 del Índice de Calidad del Aire de EE. UU.: 0–50 buena, 51–100 moderada, 101–150 insalubre para grupos sensibles, 151+ insalubre para todos. A diferencia de los demás datos aquí, este es modelado: no hay un monitor de aire de la EPA en Crosby, así que proviene del pronóstico de Open-Meteo y no de un instrumento cercano; es una estimación útil (sobre todo en días con humo de incendios), no una medición oficial."
      ),
    ],
  ];
  return items.map(([q, a]) => `<details class="about"><summary>&#9432; ${q}</summary><p>${a}</p></details>`).join("");
}

function homeHtml(weather, water, news, cal, tropics, lang) {
  const now = currentHourly(weather);
  const feels = now ? feelsLikeF(now) : null;
  const alerts = weather.alerts ?? [];
  const wUrl = lang === "es" ? "/es/weather" : "/weather";

  // Hero: temp + condition on one line, then plain-language lines — feels
  // like, wind spelled out, rain chance — then NWS's own prose summary (the
  // lead period's detailedForecast IS the natural-language forecast, no
  // invention needed) and the cache's freshness stamp instead of a clock
  // time that can't be trusted to the minute.
  const lead = (weather.periods ?? [])[0];
  const windLine =
    now?.windSpeed && now?.windDirection
      ? `${esc(translateWind(now.windSpeed, lang))} ${T(lang, "from the", "del")} ${esc(dirWord(now.windDirection, lang))}`
      : "";
  const popNow = now ? pop(now) : 0;
  const updatedLine = weather.updated ? `${T(lang, "Updated", "Actualizado")} ${esc(clockTime(weather.updated, lang))} CT` : "";
  const hero = now
    ? `<section class="hub-hero">
      ${now.icon ? `<img class="hero-icon" src="${iconUrl(now.icon, "large")}" alt="${esc(translateConditions(now.shortForecast, lang))}" width="104" height="104" fetchpriority="high">` : ""}
      <div class="hub-hero-now">
        <p class="hub-eyebrow">${T(lang, "Currently in Crosby, Texas", "Actualmente en Crosby, Texas")}</p>
        <p class="hub-temp">${esc(now.temperature)}&deg;<span>${esc(now.temperatureUnit)}</span> <span class="hub-cond-inline">${esc(translateConditions(now.shortForecast, lang))}</span></p>
        ${feels != null ? `<p class="hub-line">${T(lang, "Feels like", "Sensación térmica de")} ${esc(feels)}&deg;</p>` : ""}
        ${windLine ? `<p class="hub-line">${windLine}</p>` : ""}
        ${popNow ? `<p class="hub-line">${popNow}% ${T(lang, "chance of precipitation", "de probabilidad de lluvia")}</p>` : ""}
        <p class="hub-hero-meta">${updatedLine}</p>
      </div>
      <a class="hub-cta" href="${wUrl}">${T(lang, "Full forecast", "Pronóstico completo")} &rarr;</a>
    </section>
    ${lead?.detailedForecast ? `<p class="hub-summary"><strong>${esc(translatePeriodName(lead.name, lang))}:</strong> ${esc(lead.detailedForecast)}</p>` : ""}`
    : `<section class="hub-hero"><div class="hub-hero-now"><p class="hub-cond">${T(lang, "Live weather for Crosby, Texas", "Clima en vivo para Crosby, Texas")}</p><p class="hub-hero-meta">${T(lang, "Conditions temporarily unavailable.", "Condiciones no disponibles temporalmente.")}</p></div><a class="hub-cta" href="${wUrl}">${T(lang, "Forecast", "Pronóstico")} &rarr;</a></section>`;

  const dayPeek = (weather.periods ?? [])
    .slice(0, 2)
    .map((p) => `<li><span class="pk-label">${esc(translatePeriodName(p.name, lang))}</span><span class="pk-val">${esc(p.temperature)}&deg; &middot; ${esc(translateConditions(p.shortForecast, lang))}</span></li>`)
    .join("");
  const ws = hubWaterSummary(water, lang);
  const newsItems = (news.items ?? []).filter((n) => !n.crime).slice(0, 3);
  const newsList = newsItems.length
    ? newsItems.map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener nofollow">${esc(n.title)}</a></li>`).join("")
    : `<li class="muted">${T(lang, "No recent headlines.", "Sin titulares recientes.")}</li>`;
  const events = upcomingEvents(cal.events ?? []).slice(0, 3);
  const calList = events.length
    ? events
        .map((e) => {
          const when = new Date(e.start).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { timeZone: "UTC", month: "short", day: "numeric" });
          return `<li><span class="pk-label">${esc(when)}</span><span class="pk-val">${esc(translateEvent(e.summary, lang))}</span></li>`;
        })
        .join("")
    : `<li class="muted">${T(lang, "No upcoming events posted.", "No hay eventos próximos publicados.")}</li>`;

  const lk = (en, es) => (lang === "es" ? esPath(en) : en);
  const glance = todayGlance(weather, lang);
  const glanceList = (rows) => rows.map(([k, v]) => `<li><span class="pk-label">${k}</span><span class="pk-val">${v}</span></li>`).join("");
  const glanceTodayRows = glanceList(glance.today);
  const glanceNowRows = glanceList(glance.now);
  const glanceSrc = glanceSourceLine(weather, lang);
  const alertsUpdated = weather.updated ? `${T(lang, "Updated", "Actualizado")} ${esc(clockTime(weather.updated, lang))}` : "";
  const waterUpdated = water.updated ? `${T(lang, "Updated", "Actualizado")} ${esc(clockTime(water.updated, lang))}` : "";
  const alertTypes = [...new Set(alerts.map((a) => a.event))];
  const cards = `<div class="hub-grid">
      ${glanceTodayRows || glanceNowRows ? `<section class="hub-card">
        <h2>${T(lang, "Today at a Glance", "Hoy de un vistazo")}</h2>
        <p class="hub-stamp">${glanceStamp(weather, lang)}</p>
        ${glanceTodayRows ? `<ul class="peek">${glanceTodayRows}</ul>` : ""}
        ${glanceNowRows ? `<p class="glance-group">${T(lang, "Right now", "Ahora mismo")}</p><ul class="peek">${glanceNowRows}</ul>` : ""}
        ${glanceExplainers(lang)}
        ${glanceSrc ? `<p class="glance-source">${glanceSrc}</p>` : ""}
      </section>` : ""}
      <section class="hub-card">
        <h2><a href="${lk("/weather")}">${T(lang, "Weather", "Clima")}</a></h2>
        <ul class="peek">${dayPeek || `<li class="muted">${T(lang, "Forecast unavailable.", "Pronóstico no disponible.")}</li>`}</ul>
        <p class="hub-links"><a href="${lk("/hourly")}">${T(lang, "Hourly", "Por hora")}</a> &middot; <a href="${lk("/radar")}">Radar</a> &middot; <a href="${lk("/alerts")}">${T(lang, "Alerts", "Alertas")}</a></p>
      </section>
      <section class="hub-card">
        <h2><a href="${lk("/alerts")}">${T(lang, "Alerts", "Alertas")}</a></h2>
        <p class="hub-water ${alerts.length ? "w-moderate" : "w-normal"}"><span class="hub-water-badge">${alerts.length ? `${alerts.length} ${T(lang, "Active", "Activas")}` : T(lang, "None", "Ninguna")}</span></p>
        <p class="hub-water-detail">${alerts.length ? esc(alertTypes.slice(0, 3).join(" · ")) + (alertTypes.length > 3 ? " …" : "") : T(lang, "No active weather alerts", "Sin alertas meteorológicas activas")}</p>
        ${alertsUpdated ? `<p class="hub-stamp">${alertsUpdated}</p>` : ""}
      </section>
      <section class="hub-card">
        <h2><a href="${lk("/water")}">${T(lang, "Water Levels", "Niveles de agua")}</a></h2>
        <p class="hub-water ${ws.cls}"><span class="hub-water-badge">${esc(ws.label)}</span></p>
        ${WATER_FLOOD_CATS.some((c) => ws.cls === waterCatClass(c)) || ws.cls === "w-unknown" ? `<p class="hub-water-detail">${ws.detail}</p>` : ""}
        ${waterUpdated ? `<p class="hub-stamp">${waterUpdated}</p>` : ""}
      </section>
      <section class="hub-card">
        <h2><a href="${lk("/news")}">${T(lang, "Local News", "Noticias locales")}</a></h2>
        <ul class="hub-news">${newsList}</ul>
      </section>
      <section class="hub-card">
        <h2><a href="${lk("/calendar")}">${T(lang, "School Calendar", "Calendario escolar")}</a></h2>
        <ul class="peek">${calList}</ul>
      </section>
    </div>`;

  const title = T(lang, "Crosby, TX — Weather, Water, News & Schools", "Crosby, TX — Clima, agua, noticias y escuelas");
  const desc = T(
    lang,
    "The front page for Crosby, Texas: live National Weather Service conditions, river and bayou flood levels, local headlines, and the Crosby ISD school calendar. Fast, ad-free, no trackers.",
    "La página principal de Crosby, Texas: condiciones en vivo del Servicio Meteorológico Nacional, niveles de inundación de ríos y arroyos, titulares locales y el calendario escolar de Crosby ISD. Rápida, sin anuncios, sin rastreadores."
  );
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0b3d61">
<meta name="msvalidate.01" content="71B0F51AEDA395D9136070A67436D4F9">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${T(lang, "Live weather, flood levels, local news, and school calendar for Crosby, Texas.", "Clima en vivo, niveles de inundación, noticias locales y calendario escolar para Crosby, Texas.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/", lang)}">
${hreflangTags("/")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .hub-hero { display:flex; align-items:center; gap:1rem; background:linear-gradient(135deg,var(--blue),var(--accent)); color:#fff; border-radius:16px; padding:1.1rem 1.3rem; margin-top:0.8rem; flex-wrap:wrap; }
  .hub-hero .hero-icon { border-radius:12px; background:rgba(255,255,255,0.12); flex:none; }
  .hub-hero-now { flex:1 1 auto; min-width:0; }
  .hub-temp { margin:0; font-size:3rem; font-weight:800; line-height:1; }
  .hub-temp span { font-size:1.1rem; font-weight:600; vertical-align:super; opacity:0.85; }
  .hub-cond { margin:0.2rem 0 0; font-size:1.15rem; font-weight:600; }
  .hub-hero-meta { margin:0.3rem 0 0; font-size:0.85rem; opacity:0.85; }
  .hub-eyebrow { margin:0 0 0.2rem; font-size:0.72rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; opacity:0.85; }
  .hub-cta { flex:none; background:rgba(255,255,255,0.16); color:#fff; text-decoration:none; font-weight:700; padding:0.5rem 0.9rem; border-radius:10px; white-space:nowrap; }
  .hub-cta:hover { background:rgba(255,255,255,0.28); }
  .hub-grid { display:grid; gap:0.8rem; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); margin-top:1rem; }
  .hub-card { background:var(--card); border-radius:12px; padding:0.9rem 1.05rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .hub-card h2 { margin:0 0 0.5rem; font-size:1.05rem; }
  .hub-card h2 a { color:var(--ink); text-decoration:none; }
  .hub-card h2 a:hover { color:var(--accent); }
  .peek { list-style:none; margin:0; padding:0; }
  .peek li { display:flex; justify-content:space-between; gap:0.6rem; padding:0.28rem 0; border-bottom:1px solid var(--line); font-size:0.9rem; }
  .peek li:last-child { border-bottom:none; }
  .pk-label { color:var(--muted); flex:none; }
  .pk-val { text-align:right; }
  .hub-links { margin:0.55rem 0 0; font-size:0.85rem; color:var(--muted); }
  .hub-links a { color:var(--accent); text-decoration:none; }
  .hub-news { list-style:none; margin:0; padding:0; }
  .hub-news li { padding:0.3rem 0; border-bottom:1px solid var(--line); font-size:0.9rem; }
  .hub-news li:last-child { border-bottom:none; }
  .hub-news a { color:var(--ink); text-decoration:none; }
  .hub-news a:hover { color:var(--accent); text-decoration:underline; }
  .hub-water { margin:0.3rem 0 0.4rem; }
  .hub-water-badge { display:inline-block; font-size:0.9rem; font-weight:800; padding:0.3rem 0.7rem; border-radius:999px; color:#fff; background:var(--muted); }
  .hub-water.w-normal .hub-water-badge { background:#1f8b4c; }
  .hub-water.w-action .hub-water-badge { background:#b8860b; }
  .hub-water.w-minor .hub-water-badge { background:#c85a08; }
  .hub-water.w-moderate .hub-water-badge { background:#b5301f; }
  .hub-water.w-major .hub-water-badge { background:#6f1fa0; }
  .hub-water-detail { margin:0; font-size:0.85rem; color:var(--muted); }
  .hub-stamp { margin:0.35rem 0 0; font-size:0.78rem; color:var(--muted); }
  .glance-group { margin:0.75rem 0 0.15rem; font-size:0.72rem; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:var(--muted); }
  .glance-source { margin:0.6rem 0 0; font-size:0.72rem; line-height:1.35; color:var(--muted); }
  .muted { color:var(--muted); font-style:italic; }
  .hub-cond-inline { font-size:1.15rem; font-weight:600; vertical-align:baseline; margin-left:0.3rem; }
  .hub-line { margin:0.22rem 0 0; font-size:0.95rem; opacity:0.95; }
  .hub-summary { margin:0.7rem 0 0; color:var(--muted); font-size:0.95rem; }
  .alert-banner { display:block; background:linear-gradient(135deg,#a3271b,#d44230); color:#fff; text-decoration:none; border-radius:12px; padding:0.85rem 1.05rem; margin-top:0.8rem; }
  .alert-banner:hover .ab-link { text-decoration:underline; }
  .tropics-banner { display:block; background:linear-gradient(135deg,#6f1fa0,#8e2ec2); color:#fff; text-decoration:none; border-radius:12px; padding:0.85rem 1.05rem; margin-top:0.8rem; }
  .tropics-banner:hover .tb-link { text-decoration:underline; }
  .tb-title { margin:0; font-weight:800; font-size:1.05rem; }
  .tb-detail { margin:0.35rem 0 0; font-size:0.9rem; opacity:0.95; }
  .tb-link { margin:0.45rem 0 0; font-size:0.88rem; font-weight:700; }
  .ab-title { margin:0; font-weight:800; font-size:1.05rem; }
  .ab-types { margin:0.3rem 0 0; padding-left:1.15rem; font-size:0.9rem; }
  .ab-headline { margin:0.35rem 0 0; font-size:0.9rem; opacity:0.95; }
  .ab-link { margin:0.45rem 0 0; font-size:0.88rem; font-weight:700; }
  .about { margin-top:0.45rem; font-size:0.85rem; }
  .about summary { cursor:pointer; color:var(--accent); list-style:none; }
  .about summary::-webkit-details-marker { display:none; }
  .about p { margin:0.3rem 0 0.2rem; color:var(--muted); }
  .alerts { display:grid; gap:0.6rem; margin-top:0.8rem; }
  .alert { background:#fff4f3; border-left:5px solid #c0392b; border-radius:10px; padding:0.8rem 1rem; }
  .alert h3 { margin:0 0 0.3rem; color:#a3271b; }
  .alert .headline { font-weight:700; }
  .alert .instruction { background:rgba(255,255,255,0.65); border-radius:6px; padding:0.5rem 0.7rem; }
  .alert .meta { font-size:0.8rem; color:var(--muted); }
  @media (prefers-color-scheme: dark) { .alert { background:#2a1715; } .alert .instruction { background:rgba(0,0,0,0.25); } }
  .hub-intro { color:var(--muted); margin:0.2rem 0 0; }
  .visually-h1 { font-size:1.25rem; margin:0.2rem 0 0; letter-spacing:0.01em; }
</style>
</head>
<body>
${topbar("/", lang)}
<main id="main">
  <h1 class="visually-h1">${T(lang, "Crosby, Texas", "Crosby, Texas")}</h1>
  ${hubAlertsBanner(alerts, lang)}
  ${hubTropicsBanner(tropics, lang)}
  ${hero}
  ${cards}
</main>
${footer({ page: "/", lang, source: T(lang, `Weather from the U.S. National Weather Service; water levels from NOAA/NWS; news aggregated from public sources.`, `Clima del Servicio Meteorológico Nacional de EE. UU.; niveles de agua de NOAA/NWS; noticias recopiladas de fuentes públicas.`), data: weather })}
<script>${HOME_SCRIPT}</script>
</body>
</html>`;
}

function homeMarkdown(weather, water, news, cal, tropics, lang) {
  const now = currentHourly(weather);
  const feels = now ? feelsLikeF(now) : null;
  const out = [`# ${T(lang, "Crosby, Texas", "Crosby, Texas")}`, "", `_${T(lang, "The front page for Crosby, TX — weather, water levels, local news, and school calendar.", "La página principal de Crosby, TX — clima, niveles de agua, noticias locales y calendario escolar.")}_`, ""];
  if (now) {
    const windLine = now.windSpeed && now.windDirection ? `; ${T(lang, "wind", "viento")} ${translateWind(now.windSpeed, lang)} ${T(lang, "from the", "del")} ${dirWord(now.windDirection, lang)}` : "";
    const popNow = pop(now) ? `; ${pop(now)}% ${T(lang, "chance of precipitation", "de probabilidad de lluvia")}` : "";
    out.push(`**${T(lang, "Currently in Crosby, Texas", "Actualmente en Crosby, Texas")}:** ${now.temperature}°${now.temperatureUnit} — ${translateConditions(now.shortForecast, lang)}${feels != null ? ` (${T(lang, "feels like", "sensación térmica de")} ${feels}°)` : ""}${windLine}${popNow}. [${T(lang, "Full forecast", "Pronóstico completo")}](${canonicalFor("/weather", lang)})`, "");
    if (weather.updated) out.push(`_${T(lang, "Updated", "Actualizado")} ${clockTime(weather.updated, lang)} CT_`, "");
  }
  const alerts = weather.alerts ?? [];
  if (alerts.length) {
    const primary = alerts.reduce((x, y) => (alertRank(y) > alertRank(x) ? y : x));
    const summary = alertSummaryLine(primary);
    out.push(`**⚠️ ${alerts.length} ${T(lang, alerts.length === 1 ? "active alert" : "active alerts", alerts.length === 1 ? "alerta activa" : "alertas activas")}:** ${[...new Set(alerts.map((a) => a.event))].join("; ")}${summary ? ` — ${summary}` : ""}. [${T(lang, "View all alerts", "Ver todas las alertas")}](${canonicalFor("/alerts", lang)})`, "");
  }
  const storms = tropics?.storms ?? [];
  if (storms.length) {
    out.push(`**🌀 ${T(lang, "Tropical activity in the Atlantic", "Actividad tropical en el Atlántico")}:** ${storms.map((s) => tropicsStormLine(s, lang)).join("; ")}. [${T(lang, "Track them", "Seguirlos")}](${canonicalFor("/tropics", lang)})`, "");
  }
  const glance = todayGlance(weather, lang);
  if (glance.today.length || glance.now.length) {
    // glanceStamp's esc() is a no-op on locale date strings, so the same date
    // serves the markdown view. "Right now" mirrors the HTML card's grouping.
    out.push(`## ${T(lang, "Today at a glance", "Hoy de un vistazo")}`, "", `_${glanceStamp(weather, lang)}_`, "");
    for (const [k, v] of glance.today) out.push(`- ${k}: ${v}`);
    if (glance.now.length) {
      out.push("", `**${T(lang, "Right now", "Ahora mismo")}**`, "");
      for (const [k, v] of glance.now) out.push(`- ${k}: ${v}`);
    }
    const glanceSrc = glanceSourceLine(weather, lang);
    if (glanceSrc) out.push("", `_${glanceSrc}_`);
    out.push("");
  }
  const ws = hubWaterSummary(water, lang);
  const wsNormal = ws.cls === "w-normal";
  const wsStamp = water.updated ? ` (${T(lang, "updated", "actualizado")} ${clockTime(water.updated, lang)} CT)` : "";
  out.push(`**${T(lang, "Water levels", "Niveles de agua")}:** ${ws.label.replace(/&[a-z]+;/g, "")}${wsNormal ? "" : ` — ${String(ws.detail).replace(/<[^>]+>/g, "")}`}${wsStamp}. [${T(lang, "All gauges", "Todos los medidores")}](${canonicalFor("/water", lang)})`, "");
  const newsItems = (news.items ?? []).filter((n) => !n.crime).slice(0, 3);
  if (newsItems.length) {
    out.push("", `## ${T(lang, "Local news", "Noticias locales")}`, "");
    for (const n of newsItems) out.push(`- [${n.title}](${n.link})${n.source ? ` — ${n.source}` : ""}`);
  }
  const events = upcomingEvents(cal.events ?? []).slice(0, 3);
  if (events.length) {
    out.push("", `## ${T(lang, "Upcoming Crosby ISD events", "Próximos eventos de Crosby ISD")}`, "");
    for (const e of events) {
      const when = new Date(e.start).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
      out.push(`- ${when}: ${translateEvent(e.summary, lang)}`);
    }
  }
  out.push("", "---", `[${T(lang, "Weather", "Clima")}](${canonicalFor("/weather", lang)}) · [${T(lang, "Water", "Agua")}](${canonicalFor("/water", lang)}) · [${T(lang, "News", "Noticias")}](${canonicalFor("/news", lang)}) · [${T(lang, "Calendar", "Calendario")}](${canonicalFor("/calendar", lang)})`);
  return out.join("\n");
}
// --- end Homepage hub -----------------------------------------------------

function renderError(err) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crosby, TX Weather &mdash; temporarily unavailable</title></head>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem">
<h1>Weather temporarily unavailable</h1>
<p>We couldn't reach the National Weather Service just now. Please try again shortly.</p>
<pre style="background:#f4f6f8;padding:1rem;border-radius:6px;overflow:auto">${esc(err && err.message)}</pre>
</body></html>`;
}

// --- RSS feeds (RSS 2.0) ----------------------------------------------------
// /alerts.xml and /news.xml — the no-accounts, no-tracking notification
// channel: feed readers (and automations built on them) get storm alerts and
// curated town news without the site knowing who they are. English-only,
// like the API. Rendered from the same KV data as the HTML pages.
const rssDate = (x) => {
  const d = new Date(x ?? Date.now());
  return (isNaN(d.getTime()) ? new Date() : d).toUTCString();
};

function alertsRss(data) {
  const items = (data.alerts ?? [])
    .map(
      (a) => `
  <item>
    <title>${esc(a.event || "Weather alert")}</title>
    <link>${SITE}/alerts</link>
    <guid isPermaLink="false">${esc(a.id || `${a.event} ${a.sent || a.effective || ""}`)}</guid>
    <pubDate>${rssDate(a.sent || a.effective || data.updated)}</pubDate>
    <description>${esc([a.headline, a.description, a.instruction ? `What to do: ${a.instruction}` : ""].filter(Boolean).join("\n\n"))}</description>
  </item>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Crosby, TX Weather Alerts — crosbynews.com</title>
  <link>${SITE}/alerts</link>
  <description>Active National Weather Service alerts for Crosby, Texas. The feed is empty when no alerts are active — items appear only when NWS issues one. Not a substitute for official warning channels.</description>
  <language>en-us</language>
  <ttl>15</ttl>
  <lastBuildDate>${rssDate(data.updated)}</lastBuildDate>${items}
</channel>
</rss>
`;
}

function newsRss(data) {
  const items = (data.items ?? [])
    .map(
      (n) => `
  <item>
    <title>${esc(n.title)}</title>
    <link>${esc(n.link)}</link>
    <guid isPermaLink="true">${esc(n.link)}</guid>${n.ts ? `
    <pubDate>${rssDate(n.ts)}</pubDate>` : ""}
    <category>${n.crime ? "incident" : "community"}</category>
    <description>${esc(n.source ? `Via ${n.source}. ` : "")}Curated for relevance to Crosby, TX by crosbynews.com.</description>
  </item>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Crosby, TX News — crosbynews.com</title>
  <link>${SITE}/news</link>
  <description>Recent local news headlines for Crosby, Texas and nearby northeast Harris County communities, aggregated from public sources and filtered for relevance. Links go to the original outlets.</description>
  <language>en-us</language>
  <ttl>60</ttl>
  <lastBuildDate>${rssDate(data.updated)}</lastBuildDate>${items}
</channel>
</rss>
`;
}
// --- end RSS feeds ----------------------------------------------------------

// /llms.txt — concise site summary for LLMs (llmstxt.org spec).
function llmsTxt() {
  return `# crosbynews.com

> Live weather and local news for Crosby, Texas — fast, no ads, no trackers.

crosbynews.com is an independent weather and news site for Crosby, TX (northeast Harris County). Weather data comes exclusively from the U.S. National Weather Service (api.weather.gov) and is refreshed every 15 minutes. Local news headlines are aggregated daily from Texas and Houston-area outlets and filtered for relevance to the Crosby community.

## Pages

- [Home](${SITE}/): The Crosby, TX front page — current conditions, water levels, local news, and school events at a glance, linking into each full section.
- [Weather](${SITE}/weather): Current conditions, 12-hour hourly strip, and 7-day forecast for Crosby, TX.
- [Hourly](${SITE}/hourly): Full 48-hour hour-by-hour forecast table grouped by day.
- [Radar](${SITE}/radar): Live NWS KHGX (Houston-Galveston) radar loop covering Crosby and northeast Harris County.
- [Alerts](${SITE}/alerts): Active NWS weather alerts for Crosby, TX plus a plain-language severe-weather guide.
- [Water Levels](${SITE}/water): Live river and bayou levels with NWS flood stages for Cedar Bayou, the San Jacinto River, Luce Bayou and other waters that flood the Crosby / NE Harris County area.
- [Tropics](${SITE}/tropics): Active Atlantic tropical storms and hurricanes from the NOAA National Hurricane Center, plus what hurricane season means for Crosby — shows an all-clear when the basin is quiet.
- [News](${SITE}/news): Recent local headlines about Crosby, TX and nearby communities, filtered for relevance.
- [School Calendar](${SITE}/calendar): Upcoming Crosby ISD school calendar events (first day, holidays, no-school/early-release days, testing, athletics) rendered from the district's public iCal feed, plus one-tap subscribe links.
- [Emergency Resources](${SITE}/emergency): Emergency contacts for Crosby, TX — 911 and non-emergency numbers, power outage and gas leak reporting, the CAER industrial-incident line, live flood and road conditions, evacuation-zone lookup, shelters, and disaster assistance.
- [About](${SITE}/about): What this site is, where its data comes from, how often it updates, and how it's built.
- [Developers & Agents](${SITE}/developers): The public JSON API, OpenAPI spec, MCP server, RSS feeds, agent skills, and Markdown views — all in one place, no authentication.
- [Privacy](${SITE}/privacy): Privacy policy — no cookies, no trackers, no personal data.
- [Contact](${SITE}/contact): How to reach us — general inquiries and security reporting.
- [Sitemap](${SITE}/sitemap): Human-readable site map with every page and endpoint.

## Languages

Every page is also available in Mexican Spanish (es-MX) under the /es prefix — e.g. ${SITE}/es, ${SITE}/es/hourly, ${SITE}/es/alerts, ${SITE}/es/about. The English and Spanish URLs are linked with hreflang. Forecast conditions are translated with a hand-built dictionary; detailed NWS forecast descriptions and weather alerts remain in official English (NWS publishes no Spanish forecast/alert API). The JSON API and MCP server are English-only.

## API & agent access

Every page supports \`Accept: text/markdown\` (or \`?format=md\`) for a clean markdown rendering.

- REST API: \`GET ${SITE}/api/weather\` — JSON with current conditions, hourly, 7-day forecast, alerts, sun times, the EPA UV index, and a modeled air-quality index (labeled as modeled, not a monitor reading). No auth.
- News API: \`GET ${SITE}/api/news\` — recent Crosby-area headlines (JSON).
- School calendar API: \`GET ${SITE}/api/calendar\` — upcoming Crosby ISD events (JSON).
- Water levels API: \`GET ${SITE}/api/water\` — river/bayou stage + NWS flood stages (JSON).
- OpenAPI spec: \`${SITE}/openapi.json\`
- MCP server (Streamable HTTP): \`${SITE}/mcp\` — tools: \`get_current_conditions\`, \`get_forecast\`, \`get_alerts\`, \`get_river_levels\`, \`get_crosby_news\`, \`get_school_events\`
- MCP server card: \`${SITE}/.well-known/mcp/server-card.json\`

## Data policy

Source data is U.S. government public domain (NWS). No authentication required. No rate limits. Attribution: "U.S. National Weather Service".

## Optional

- [Alerts RSS](${SITE}/alerts.xml): Active NWS weather alerts as an RSS 2.0 feed (empty when all clear).
- [News RSS](${SITE}/news.xml): Curated Crosby-area headlines as an RSS 2.0 feed.
- [Weather badge](${SITE}/badge.svg): Hotlinkable live SVG badge — current temperature, conditions, feels-like, and an alert flag.
- [Sitemap](${SITE}/sitemap.xml): All pages in both languages, with hreflang alternates.
- [API catalog](${SITE}/.well-known/api-catalog): Machine-readable index of the API endpoints (RFC 9727 linkset).
- [Security contact](${SITE}/.well-known/security.txt): How to report a security issue (RFC 9116).
`;
}

// /robots.txt — RFC 9309 crawl rules, explicit AI-crawler entries, and a
// sitemap reference. Open by design: this is public-domain NWS data and the
// site wants to be discoverable by agents. (No Content-Signal line — it
// confused some crawlers when present, so it's intentionally omitted.)
function robotsTxt() {
  return `# crosbynews.com — robots.txt (RFC 9309)
# Crosby, TX weather, derived from the U.S. National Weather Service
# (public-domain data). Crawlers and AI agents are welcome.

User-agent: *
Allow: /

# AI crawlers and agents — explicitly allowed.
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: CCBot
Allow: /

User-agent: cohere-ai
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;
}

// /sitemap.xml — every page in both languages. Each <url> carries xhtml:link
// alternates (en-US, es-MX, x-default → English) so Google ties the English and
// Spanish versions together, the same pairing the in-page hreflang tags assert.
function sitemapXml() {
  const today = new Date().toISOString().slice(0, 10);
  const pages = [
    { path: "/", changefreq: "hourly", priority: "1.0", lastmod: true },
    { path: "/weather", changefreq: "hourly", priority: "0.9", lastmod: true },
    { path: "/hourly", changefreq: "hourly", priority: "0.8", lastmod: true },
    { path: "/radar", changefreq: "daily", priority: "0.7" },
    { path: "/alerts", changefreq: "hourly", priority: "0.7" },
    { path: "/water", changefreq: "hourly", priority: "0.7" },
    { path: "/tropics", changefreq: "daily", priority: "0.6" },
    { path: "/news", changefreq: "daily", priority: "0.6" },
    { path: "/calendar", changefreq: "daily", priority: "0.6" },
    { path: "/emergency", changefreq: "monthly", priority: "0.5" },
    { path: "/about", changefreq: "monthly", priority: "0.5" },
    { path: "/developers", changefreq: "monthly", priority: "0.4" },
    { path: "/privacy", changefreq: "monthly", priority: "0.3" },
    { path: "/contact", changefreq: "monthly", priority: "0.3" },
    { path: "/sitemap", changefreq: "monthly", priority: "0.3" },
  ];
  const entry = (loc, page) => {
    const en = SITE + page.path;
    const es = SITE + esPath(page.path);
    const alts =
      `\n    <xhtml:link rel="alternate" hreflang="en-US" href="${en}"/>` +
      `\n    <xhtml:link rel="alternate" hreflang="es-MX" href="${es}"/>` +
      `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>`;
    const lastmod = page.lastmod ? `\n    <lastmod>${today}</lastmod>` : "";
    return `  <url>
    <loc>${loc}</loc>${lastmod}
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>${alts}
  </url>`;
  };
  const urls = [];
  for (const page of pages) {
    urls.push(entry(SITE + page.path, page));
    urls.push(entry(SITE + esPath(page.path), page));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;
}

// --- About page -----------------------------------------------------------
// Static "what this site is" page. Content lives in one structured place so the
// HTML and markdown renderings can't drift. Strengthens E-E-A-T (clear source,
// authorship, and method) and gives the site a second indexable page.
const ABOUT = {
  title: "About crosbynews.com",
  description:
    "What crosbynews.com is, where its weather and local data come from, how often it updates, and how it's built.",
  intro:
    "crosbynews.com is a fast, ad-free front page for Crosby, Texas — live National Weather Service conditions and forecast, river and bayou flood levels, local news, and the Crosby ISD school calendar, all in one place. No ads, no trackers, no sign-up.",
  sections: [
    {
      h: "Where the data comes from",
      p: [
        "Every forecast, conditions reading, and alert on this site comes directly from the U.S. National Weather Service (api.weather.gov) for Crosby, TX (latitude 29.9119, longitude -95.0608). NWS data is in the public domain. The UV index is the one weather number sourced elsewhere — the U.S. EPA's public UV forecast for Crosby's ZIP code (77532).",
        "The air quality index (AQI) is different, and we label it so wherever it appears: it's modeled, not measured. There's no EPA air monitor in Crosby, so rather than borrow a distant monitor's reading and call it local, we show Open-Meteo's modeled forecast for Crosby's coordinates. Treat it as a useful estimate — genuinely handy on wildfire-smoke days — not an official measurement.",
        "We don't editorialize or adjust the numbers — the site is a clean presentation layer over the official government forecast for the Crosby area. Two values we compute ourselves: \"feels like\" temperature (the heat index or wind chill, using the National Weather Service's own published formulas applied to its temperature, humidity, and wind data — shown only when it's meaningfully different from the air temperature) and sunrise/sunset times (standard astronomical formulas; the NWS forecast API doesn't provide them).",
      ],
    },
    {
      h: "How often it updates",
      p: [
        "The forecast and alerts are refreshed every 15 minutes from the National Weather Service. The page you load is served from a cached copy at the edge for speed, and an open browser tab reloads itself every 15 minutes to stay current.",
      ],
    },
    {
      h: "For developers & agents",
      p: [
        "The same data powering this site is available as a free, public, no-authentication JSON API — plus an OpenAPI spec, a Model Context Protocol (MCP) server, RSS feeds, and a Markdown version of every page. It's all documented on one page:",
      ],
      links: [
        { href: "/developers", label: "Developers & agents", note: "the API, MCP server, feeds, and agent integrations" },
      ],
    },
    {
      h: "Privacy",
      p: [
        "No cookies, no ads, no trackers, no personal data. crosbynews.com doesn't set cookies, show ads, or run third-party tracking or advertising networks, and it never asks for or collects personal information about you.",
        "Page visits are counted anonymously and in aggregate — without cookies, without fingerprinting, and without anything that identifies you or follows you across other sites.",
      ],
      links: [{ href: "/privacy", label: "Full privacy policy", note: "no cookies, ads, trackers, or personal data" }],
    },
    {
      h: "Contact",
      p: ["Questions, corrections, or a local news tip? Email us:"],
      links: [
        { href: "mailto:contact@crosbynews.com", label: "contact@crosbynews.com", note: "general questions, corrections, and news tips" },
        { href: "mailto:security@crosbynews.com", label: "security@crosbynews.com", note: "security issues and vulnerability reports" },
        { href: "/contact", label: "Contact page", note: "all contact information" },
      ],
    },
    {
      h: "Disclaimer",
      p: [
        "crosbynews.com is an independent project and is not affiliated with the National Weather Service, NOAA, or any government agency. Always rely on official sources and local authorities for life-safety decisions during severe weather.",
      ],
    },
  ],
};

// Mexican-Spanish (es-MX) translation of the About content, same shape as ABOUT
// so aboutHtml()/aboutMarkdown() render either from one set of functions. API
// endpoints stay English (they're language-neutral); only the self-referential
// markdown link points at the Spanish page.
const ABOUT_ES = {
  title: "Acerca de crosbynews.com",
  description:
    "Qué es crosbynews.com, de dónde provienen sus datos meteorológicos y locales, con qué frecuencia se actualiza y cómo está construido.",
  intro:
    "crosbynews.com es una página principal rápida y sin anuncios para Crosby, Texas: condiciones y pronóstico en vivo del Servicio Meteorológico Nacional, niveles de inundación de ríos y arroyos, noticias locales y el calendario escolar de Crosby ISD, todo en un solo lugar. Sin anuncios, sin rastreadores, sin registro.",
  sections: [
    {
      h: "De dónde provienen los datos",
      p: [
        "Cada pronóstico, lectura de condiciones y alerta de este sitio proviene directamente del Servicio Meteorológico Nacional de EE. UU. (api.weather.gov) para Crosby, TX (latitud 29.9119, longitud -95.0608). Los datos del NWS son de dominio público. El índice UV es el único dato meteorológico de otra fuente: el pronóstico UV público de la EPA de EE. UU. para el código postal de Crosby (77532).",
        "El índice de calidad del aire (AQI) es distinto, y lo etiquetamos así donde aparece: es modelado, no medido. No hay un monitor de aire de la EPA en Crosby, así que en lugar de tomar la lectura de un monitor lejano y llamarla local, mostramos el pronóstico modelado de Open-Meteo para las coordenadas de Crosby. Tómalo como una estimación útil — de veras práctica en días con humo de incendios — no como una medición oficial.",
        "No editorializamos ni ajustamos las cifras: el sitio es una capa de presentación limpia sobre el pronóstico oficial del gobierno para la zona de Crosby. Dos valores los calculamos nosotros mismos: la \"sensación térmica\" (el índice de calor o la sensación por viento, con las fórmulas oficiales del Servicio Meteorológico Nacional aplicadas a su temperatura, humedad y viento, y solo se muestra cuando difiere de forma notable de la temperatura del aire) y las horas de amanecer y atardecer (fórmulas astronómicas estándar; la API de pronóstico del NWS no las ofrece). Las condiciones se traducen al español con un diccionario propio; las descripciones detalladas del pronóstico y las alertas se muestran en su idioma oficial, inglés.",
      ],
    },
    {
      h: "Con qué frecuencia se actualiza",
      p: [
        "El pronóstico y las alertas se actualizan cada 15 minutos desde el Servicio Meteorológico Nacional. La página que cargas se sirve desde una copia en caché en el borde de la red para mayor velocidad, y una pestaña abierta del navegador se recarga sola cada 15 minutos para mantenerse al día.",
      ],
    },
    {
      h: "Para desarrolladores y agentes",
      p: [
        "Los mismos datos que alimentan este sitio están disponibles como una API JSON gratuita, pública y sin autenticación, además de una especificación OpenAPI, un servidor del Protocolo de Contexto de Modelo (MCP), feeds RSS y una versión en Markdown de cada página. Todo está documentado en una sola página:",
      ],
      links: [
        { href: "/es/developers", label: "Desarrolladores y agentes", note: "la API, el servidor MCP, los feeds y las integraciones para agentes" },
      ],
    },
    {
      h: "Privacidad",
      p: [
        "Sin cookies, sin anuncios, sin rastreadores, sin datos personales. crosbynews.com no usa cookies, no muestra anuncios ni ejecuta redes de rastreo o publicidad de terceros, y nunca pide ni recopila información personal sobre ti.",
        "Las visitas se cuentan de forma anónima y agregada, sin cookies, sin huellas digitales (fingerprinting) y sin nada que te identifique o te siga por otros sitios.",
      ],
      links: [{ href: "/es/privacy", label: "Política de privacidad completa", note: "sin cookies, anuncios, rastreadores ni datos personales" }],
    },
    {
      h: "Contacto",
      p: ["¿Preguntas, correcciones o un dato de noticias local? Escríbenos:"],
      links: [
        { href: "mailto:contact@crosbynews.com", label: "contact@crosbynews.com", note: "preguntas generales, correcciones y datos de noticias" },
        { href: "mailto:security@crosbynews.com", label: "security@crosbynews.com", note: "problemas de seguridad y reportes de vulnerabilidades" },
        { href: "/es/contact", label: "Página de contacto", note: "toda la información de contacto" },
      ],
    },
    {
      h: "Aviso legal",
      p: [
        "crosbynews.com es un proyecto independiente y no está afiliado al Servicio Meteorológico Nacional, la NOAA ni ninguna agencia gubernamental. Para decisiones de vida o muerte durante condiciones meteorológicas severas, confía siempre en las fuentes oficiales y las autoridades locales.",
      ],
    },
  ],
};

// --- Privacy page --------------------------------------------------------------
const PRIVACY = {
  title: "Privacy Policy",
  description: "How crosbynews.com handles your data — no cookies, no trackers, no personal information.",
  intro: "crosbynews.com doesn't set cookies, show ads, or run third-party tracking or advertising networks, and it never asks for or collects personal information about you.",
  sections: [
    {
      h: "What we don't collect",
      p: [
        "No cookies, no fingerprinting, no sign-up, no login. There is no personal data to collect because the site never asks for any. There are no third-party analytics scripts, advertising networks, social-media widgets, or tracking pixels on any page.",
      ],
    },
    {
      h: "Third-party data sources",
      p: [
        "The site displays data from several external, public sources. All of it is fetched server-side and cached — your browser never contacts these sources directly, and none of it involves sharing any user data:",
        "U.S. National Weather Service (api.weather.gov) — public-domain forecasts, conditions, and alerts for Crosby, TX; and the U.S. EPA (UV index) and NOAA (river/bayou levels, tropical outlook).",
        "Open-Meteo — a modeled air-quality index for Crosby's coordinates (labeled as modeled throughout).",
        "Google News — local news headlines aggregated from public RSS feeds by an out-of-band process and cached.",
        "Crosby ISD (crosbyisd.org) — the school district's public iCal calendar feed.",
      ],
    },
    {
      h: "Push notifications (optional)",
      p: [
        "If you opt in to severe-weather alerts on the Alerts page, your browser creates an anonymous \"push subscription\" — a unique address at your browser vendor's push service (Google, Apple, Mozilla, or Microsoft) plus a pair of keys. We store only that subscription, so we can wake your device when a tornado, flash-flood, or hurricane warning is issued for Crosby. It carries no personal information and isn't tied to any identity.",
        "We never send message content through it: the wake-up is empty, and the notification text is assembled on your own device from the public alerts feed. Turn it off anytime with the same button (or in your browser's site settings) and the stored subscription is deleted. Dead subscriptions are also pruned automatically.",
      ],
    },
    {
      h: "Analytics",
      p: [
        "Page visits are counted anonymously and in aggregate — without cookies, without fingerprinting, and without anything that identifies you or follows you across other sites.",
      ],
    },
    {
      h: "Questions",
      p: ["If you have questions about this privacy policy:"],
      links: [{ href: "mailto:contact@crosbynews.com", label: "contact@crosbynews.com", note: "general questions" }],
    },
  ],
};

const PRIVACY_ES = {
  title: "Política de privacidad",
  description: "Cómo crosbynews.com maneja tus datos: sin cookies, sin rastreadores, sin información personal.",
  intro: "crosbynews.com no usa cookies, no muestra anuncios ni ejecuta redes de rastreo o publicidad de terceros, y nunca pide ni recopila información personal sobre ti.",
  sections: [
    {
      h: "Lo que no recopilamos",
      p: [
        "Sin cookies, sin huellas digitales (fingerprinting), sin registro, sin inicio de sesión. No hay datos personales que recopilar porque el sitio nunca los solicita. No hay scripts de analítica de terceros, redes publicitarias, widgets de redes sociales ni píxeles de seguimiento en ninguna página.",
      ],
    },
    {
      h: "Fuentes de datos de terceros",
      p: [
        "El sitio muestra datos de varias fuentes externas y públicas. Todo se obtiene del lado del servidor y se almacena en caché — tu navegador nunca contacta estas fuentes directamente, y ninguna implica compartir datos de usuario:",
        "Servicio Meteorológico Nacional de EE. UU. (api.weather.gov) — pronósticos, condiciones y alertas de dominio público para Crosby, TX; además de la EPA de EE. UU. (índice UV) y la NOAA (niveles de ríos/arroyos, panorama tropical).",
        "Open-Meteo — un índice de calidad del aire modelado para las coordenadas de Crosby (etiquetado como modelado en todo el sitio).",
        "Google News — titulares de noticias locales recopilados de fuentes RSS públicas mediante un proceso externo y almacenados en caché.",
        "Crosby ISD (crosbyisd.org) — el calendario público iCal del distrito escolar.",
      ],
    },
    {
      h: "Notificaciones push (opcional)",
      p: [
        "Si te suscribes a las alertas de clima severo en la página de Alertas, tu navegador crea una «suscripción push» anónima: una dirección única en el servicio push de tu navegador (Google, Apple, Mozilla o Microsoft) más un par de claves. Solo guardamos esa suscripción para poder despertar tu dispositivo cuando se emita un aviso de tornado, inundación repentina o huracán para Crosby. No contiene información personal ni está vinculada a ninguna identidad.",
        "Nunca enviamos contenido a través de ella: el aviso de despertar va vacío y el texto de la notificación se arma en tu propio dispositivo a partir del feed público de alertas. Desactívala cuando quieras con el mismo botón (o en la configuración del sitio de tu navegador) y la suscripción guardada se elimina. Las suscripciones inactivas también se depuran automáticamente.",
      ],
    },
    {
      h: "Analítica",
      p: [
        "Las visitas se cuentan de forma anónima y agregada, sin cookies, sin huellas digitales (fingerprinting) y sin nada que te identifique o te siga por otros sitios.",
      ],
    },
    {
      h: "Preguntas",
      p: ["Si tienes preguntas sobre esta política de privacidad:"],
      links: [{ href: "mailto:contact@crosbynews.com", label: "contact@crosbynews.com", note: "preguntas generales" }],
    },
  ],
};

// --- Contact page -------------------------------------------------------------
const CONTACT = {
  title: "Contact Us",
  description: "How to reach crosbynews.com — general inquiries, news tips, and security reporting.",
  intro: "crosbynews.com is an independent community weather and news project for Crosby, Texas. We welcome questions, corrections, and local news tips.",
  sections: [
    {
      h: "General inquiries",
      p: ["For questions, corrections, or a local news tip:"],
      links: [{ href: "mailto:contact@crosbynews.com", label: "contact@crosbynews.com", note: "general questions, corrections, and news tips" }],
    },
    {
      h: "Security",
      p: ["To report a security issue or vulnerability:"],
      links: [
        { href: "mailto:security@crosbynews.com", label: "security@crosbynews.com", note: "security issues and vulnerability reports" },
        { href: "/.well-known/security.txt", label: "security.txt", note: "machine-readable security contact (RFC 9116)" },
      ],
    },
    {
      h: "About this project",
      p: [
        "crosbynews.com is an independent project and is not affiliated with the National Weather Service, NOAA, Crosby ISD, or any government agency. Weather data comes from the U.S. National Weather Service; local news headlines are aggregated from public sources; and the school calendar is rendered from Crosby ISD's public feed.",
      ],
    },
  ],
};

const CONTACT_ES = {
  title: "Contacto",
  description: "Cómo comunicarte con crosbynews.com — consultas generales, datos de noticias y reportes de seguridad.",
  intro: "crosbynews.com es un proyecto comunitario independiente de clima y noticias para Crosby, Texas. Recibimos con gusto preguntas, correcciones y datos de noticias locales.",
  sections: [
    {
      h: "Consultas generales",
      p: ["Para preguntas, correcciones o un dato de noticias local:"],
      links: [{ href: "mailto:contact@crosbynews.com", label: "contact@crosbynews.com", note: "preguntas generales, correcciones y datos de noticias" }],
    },
    {
      h: "Seguridad",
      p: ["Para reportar un problema de seguridad o vulnerabilidad:"],
      links: [
        { href: "mailto:security@crosbynews.com", label: "security@crosbynews.com", note: "problemas de seguridad y reportes de vulnerabilidades" },
        { href: "/.well-known/security.txt", label: "security.txt", note: "contacto de seguridad legible por máquinas (RFC 9116)" },
      ],
    },
    {
      h: "Acerca de este proyecto",
      p: [
        "crosbynews.com es un proyecto independiente y no está afiliado al Servicio Meteorológico Nacional, la NOAA, Crosby ISD ni ninguna agencia gubernamental. Los datos del tiempo provienen del Servicio Meteorológico Nacional de EE. UU.; los titulares de noticias locales se recopilan de fuentes públicas; y el calendario escolar se genera a partir del feed público de Crosby ISD.",
      ],
    },
  ],
};

// AboutPage node for /about, linked to the sitewide WebSite/Organization by @id.
function jsonldAbout(lang) {
  const A = lang === "es" ? ABOUT_ES : ABOUT;
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": canonicalFor("/about", lang) + "#webpage",
    url: canonicalFor("/about", lang),
    name: A.title,
    description: A.description,
    inLanguage: lang === "es" ? "es-MX" : "en-US",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORG_ID },
  })}</script>`;
}

function aboutHtml(lang) {
  const A = lang === "es" ? ABOUT_ES : ABOUT;
  const body = A.sections
    .map((s) => {
      const paras = (s.p || []).map((t) => `<p>${esc(t)}</p>`).join("\n      ");
      const links = s.links
        ? `<ul class="links">${s.links
            .map((l) => `<li><a href="${l.href}"><code>${esc(l.label)}</code></a> &mdash; ${esc(l.note)}</li>`)
            .join("")}</ul>`
        : "";
      return `      <section class="card">
        <h2>${esc(s.h)}</h2>
        ${paras}
        ${links}
      </section>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(A.title)} &mdash; ${T(lang, "Crosby, TX Weather", "Clima de Crosby, TX")}</title>
<meta name="description" content="${esc(A.description)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(A.title)}">
<meta property="og:description" content="${esc(A.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/about", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/about", lang)}">
${hreflangTags("/about")}
${JSONLD_SITE}
${jsonldAbout(lang)}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .card { background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.5rem; }
  .card p { margin:0.5rem 0; }
  .lede { font-size:1.05rem; color:var(--ink); }
  .links { margin:0.5rem 0 0; padding-left:1.1rem; }
  .links li { margin:0.3rem 0; }
  code { background:color-mix(in srgb,var(--ink) 10%, transparent); padding:0.05rem 0.3rem; border-radius:4px; font-size:0.9em; }
</style>
</head>
<body>
${topbar("/about", lang)}
<main id="main">
  <h1>${esc(A.title)}</h1>
  <p class="lede">${esc(A.intro)}</p>
${body}
</main>
${footer({ page: "/about", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`) })}
</body>
</html>`;
}

function aboutMarkdown(lang) {
  const A = lang === "es" ? ABOUT_ES : ABOUT;
  const out = [`# ${A.title}`, "", A.intro, ""];
  for (const s of A.sections) {
    out.push(`## ${s.h}`, "");
    for (const t of s.p || []) out.push(t, "");
    for (const l of s.links || []) out.push(`- [${l.label}](${l.href}) — ${l.note}`);
    if (s.links) out.push("");
  }
  out.push("---", `[crosbynews.com](${canonicalFor("/", lang)}) · ${T(lang, "weather for Crosby, Texas", "clima para Crosby, Texas")}`);
  return out.join("\n");
}
// --- end About page -------------------------------------------------------

// --- Developers & agents page ---------------------------------------------
// The site's agent/developer surface, gathered onto one page (moved off /about
// during the 2026 restructure so /about stays human-facing). Same {h,p,links}
// content-object shape as ABOUT so developersHtml/developersMarkdown render it
// without drift. The API + MCP are English-only, so both languages list the
// same endpoints; only the prose and self-referential markdown link localize.
const DEVELOPERS = {
  title: "Developers & Agents",
  description:
    "The crosbynews.com API, MCP server, RSS feeds, and agent integrations for Crosby, TX — free, public, no authentication.",
  intro:
    "crosbynews.com is built to be read by machines as well as people. Everything below is public and free, with no API key or sign-up. Source data is U.S. government public domain (NWS/NOAA) — attribute it as \"U.S. National Weather Service.\"",
  sections: [
    {
      h: "JSON API",
      p: ["Every dataset behind the site is a plain JSON endpoint with open CORS (Access-Control-Allow-Origin: *) and no rate limits. The polled endpoints also support conditional GET (ETag / If-None-Match → 304):"],
      links: [
        { href: "/api/weather", label: "/api/weather", note: "current conditions, hourly, 7-day forecast, alerts, plus feels-like and sun times" },
        { href: "/api/water", label: "/api/water", note: "river/bayou stage, flow, and NWS flood stages" },
        { href: "/api/news", label: "/api/news", note: "recent local Crosby-area headlines" },
        { href: "/api/calendar", label: "/api/calendar", note: "upcoming Crosby ISD school events" },
        { href: "/api/health", label: "/api/health", note: "service status and cache freshness" },
      ],
    },
    {
      h: "Specs & discovery",
      p: ["Machine-readable descriptions and a discovery catalog:"],
      links: [
        { href: "/openapi.json", label: "/openapi.json", note: "OpenAPI 3.1 description of every endpoint" },
        { href: "/.well-known/api-catalog", label: "/.well-known/api-catalog", note: "RFC 9727 API catalog (linkset)" },
      ],
    },
    {
      h: "Markdown for every page",
      p: ["Any page returns clean Markdown instead of HTML when you send an Accept: text/markdown header or append ?format=md — handy for LLMs and text pipelines. The forecast, hub, water, news, alerts, and calendar pages all support it."],
      links: [
        { href: "/weather?format=md", label: "/weather?format=md", note: "the forecast, rendered as Markdown" },
        { href: "/llms.txt", label: "/llms.txt", note: "plain-language site summary for LLMs (llmstxt.org)" },
      ],
    },
    {
      h: "MCP server",
      p: [
        "A stateless Model Context Protocol server (Streamable HTTP, JSON-RPC) exposes the data as callable tools — get_current_conditions, get_forecast, get_alerts, get_river_levels, get_crosby_news, get_school_events — plus a crosby_briefing prompt and readable resources.",
        "Connect from Claude Code: claude mcp add --transport http crosbynews https://crosbynews.com/mcp",
      ],
      links: [
        { href: "/mcp", label: "/mcp", note: "MCP endpoint (POST JSON-RPC); a GET shows a human explainer" },
        { href: "/.well-known/mcp/server-card.json", label: "MCP server card", note: "discovery metadata" },
      ],
    },
    {
      h: "Agent skills",
      p: ["An agentskills.io (v0.2.0) discovery index points to a real SKILL.md for the Crosby weather data; its digest is a runtime hash of the file, so the two can't drift."],
      links: [
        { href: "/.well-known/agent-skills/index.json", label: "/.well-known/agent-skills/index.json", note: "agent-skills discovery index" },
      ],
    },
    {
      h: "RSS feeds",
      p: ["Watch alerts and local news in any feed reader — the no-account, no-tracking notification channel:"],
      links: [
        { href: "/alerts.xml", label: "/alerts.xml", note: "active NWS alerts (RSS 2.0; empty when all clear)" },
        { href: "/news.xml", label: "/news.xml", note: "curated Crosby-area headlines (RSS 2.0)" },
      ],
    },
    {
      h: "Embeddable weather badge",
      p: ["Put live Crosby weather on your own site with one image tag — a small SVG (300×80) showing the current temperature, conditions, feels-like, and an alert flag. Edge-cached and refreshed on the same 15-minute cycle as everything else; no key, no script, CORS open."],
      links: [
        { href: "/badge.svg", label: "/badge.svg", note: `the live badge — embed with <img src="https://crosbynews.com/badge.svg" width="300" height="80" alt="Crosby, TX weather">` },
      ],
    },
    {
      h: "Terms & attribution",
      p: [
        "Public and unauthenticated, no rate limits — please be reasonable with polling (the data refreshes every 15 minutes). Weather and water data are U.S. government public domain from the National Weather Service and NOAA; news headlines link to their original publishers.",
        "crosbynews.com is an independent project and is not affiliated with the National Weather Service, NOAA, Crosby ISD, or any government agency.",
      ],
    },
  ],
};

const DEVELOPERS_ES = {
  title: "Desarrolladores y agentes",
  description:
    "La API de crosbynews.com, el servidor MCP, los feeds RSS y las integraciones para agentes de Crosby, TX — gratis, público, sin autenticación.",
  intro:
    "crosbynews.com está hecho para que lo lean tanto las máquinas como las personas. Todo lo de abajo es público y gratuito, sin clave de API ni registro. Los datos provienen del dominio público del gobierno de EE. UU. (NWS/NOAA); atribúyelos como «U.S. National Weather Service». La API y el servidor MCP se ofrecen en inglés.",
  sections: [
    {
      h: "API JSON",
      p: ["Cada conjunto de datos del sitio es un endpoint JSON con CORS abierto (Access-Control-Allow-Origin: *) y sin límites de tasa. Los endpoints consultados con frecuencia también admiten GET condicional (ETag / If-None-Match → 304):"],
      links: [
        { href: "/api/weather", label: "/api/weather", note: "condiciones actuales, por hora, pronóstico a 7 días, alertas, sensación térmica y horas de sol" },
        { href: "/api/water", label: "/api/water", note: "nivel y caudal de ríos/arroyos y etapas de inundación del NWS" },
        { href: "/api/news", label: "/api/news", note: "titulares locales recientes del área de Crosby" },
        { href: "/api/calendar", label: "/api/calendar", note: "próximos eventos escolares de Crosby ISD" },
        { href: "/api/health", label: "/api/health", note: "estado del servicio y antigüedad de la caché" },
      ],
    },
    {
      h: "Especificaciones y descubrimiento",
      p: ["Descripciones legibles por máquinas y un catálogo de descubrimiento:"],
      links: [
        { href: "/openapi.json", label: "/openapi.json", note: "descripción OpenAPI 3.1 de cada endpoint" },
        { href: "/.well-known/api-catalog", label: "/.well-known/api-catalog", note: "catálogo de API RFC 9727 (linkset)" },
      ],
    },
    {
      h: "Markdown en cada página",
      p: ["Cualquier página devuelve Markdown limpio en lugar de HTML si envías un encabezado Accept: text/markdown o agregas ?format=md — útil para LLM y flujos de texto."],
      links: [
        { href: "/es/weather?format=md", label: "/es/weather?format=md", note: "el pronóstico, en Markdown" },
        { href: "/llms.txt", label: "/llms.txt", note: "resumen del sitio en lenguaje sencillo para LLM (llmstxt.org)" },
      ],
    },
    {
      h: "Servidor MCP",
      p: [
        "Un servidor del Protocolo de Contexto de Modelo sin estado (Streamable HTTP, JSON-RPC) expone los datos como herramientas invocables — get_current_conditions, get_forecast, get_alerts, get_river_levels, get_crosby_news, get_school_events — además de un prompt crosby_briefing y recursos legibles.",
        "Conéctate desde Claude Code: claude mcp add --transport http crosbynews https://crosbynews.com/mcp",
      ],
      links: [
        { href: "/mcp", label: "/mcp", note: "endpoint MCP (POST JSON-RPC); un GET muestra una página explicativa" },
        { href: "/.well-known/mcp/server-card.json", label: "Tarjeta del servidor MCP", note: "metadatos de descubrimiento" },
      ],
    },
    {
      h: "Habilidades para agentes",
      p: ["Un índice de descubrimiento agentskills.io (v0.2.0) apunta a un SKILL.md real para los datos del clima de Crosby; su digest es un hash del archivo en tiempo de ejecución, así que no pueden desincronizarse."],
      links: [
        { href: "/.well-known/agent-skills/index.json", label: "/.well-known/agent-skills/index.json", note: "índice de descubrimiento de habilidades" },
      ],
    },
    {
      h: "Feeds RSS",
      p: ["Sigue las alertas y las noticias locales en cualquier lector de feeds — el canal de notificaciones sin cuentas ni rastreo:"],
      links: [
        { href: "/alerts.xml", label: "/alerts.xml", note: "alertas activas del NWS (RSS 2.0; vacío cuando no hay ninguna)" },
        { href: "/news.xml", label: "/news.xml", note: "titulares seleccionados del área de Crosby (RSS 2.0)" },
      ],
    },
    {
      h: "Insignia del clima para incrustar",
      p: ["Pon el clima de Crosby en vivo en tu propio sitio con una sola etiqueta de imagen — un SVG pequeño (300×80) con la temperatura actual, las condiciones, la sensación térmica y un indicador de alertas. Con caché en el borde y actualizado en el mismo ciclo de 15 minutos que todo lo demás; sin clave, sin scripts, CORS abierto. El texto de la insignia está en inglés."],
      links: [
        { href: "/badge.svg", label: "/badge.svg", note: `la insignia en vivo — incrústala con <img src="https://crosbynews.com/badge.svg" width="300" height="80" alt="Crosby, TX weather">` },
      ],
    },
    {
      h: "Términos y atribución",
      p: [
        "Público y sin autenticación, sin límites de tasa — sé razonable con la frecuencia de consulta (los datos se actualizan cada 15 minutos). Los datos meteorológicos y de agua son de dominio público del gobierno de EE. UU. (NWS y NOAA); los titulares enlazan a sus editores originales.",
        "crosbynews.com es un proyecto independiente y no está afiliado al Servicio Meteorológico Nacional, la NOAA, Crosby ISD ni ninguna agencia gubernamental.",
      ],
    },
  ],
};

function jsonldDevelopers(lang) {
  const D = lang === "es" ? DEVELOPERS_ES : DEVELOPERS;
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": canonicalFor("/developers", lang) + "#webpage",
    url: canonicalFor("/developers", lang),
    name: D.title,
    description: D.description,
    inLanguage: lang === "es" ? "es-MX" : "en-US",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORG_ID },
  })}</script>`;
}

function developersHtml(lang) {
  const D = lang === "es" ? DEVELOPERS_ES : DEVELOPERS;
  const body = D.sections
    .map((s) => {
      const paras = (s.p || []).map((t) => `<p>${esc(t)}</p>`).join("\n      ");
      const links = s.links
        ? `<ul class="links">${s.links
            .map((l) => `<li><a href="${l.href}"><code>${esc(l.label)}</code></a> &mdash; ${esc(l.note)}</li>`)
            .join("")}</ul>`
        : "";
      return `      <section class="card">
        <h2>${esc(s.h)}</h2>
        ${paras}
        ${links}
      </section>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(D.title)} &mdash; crosbynews.com</title>
<meta name="description" content="${esc(D.description)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(D.title)}">
<meta property="og:description" content="${esc(D.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/developers", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/developers", lang)}">
${hreflangTags("/developers")}
${JSONLD_SITE}
${JSONLD_DATASET}
${jsonldDevelopers(lang)}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .card { background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.5rem; }
  .card p { margin:0.5rem 0; }
  .lede { font-size:1.05rem; color:var(--ink); }
  .links { margin:0.5rem 0 0; padding-left:1.1rem; }
  .links li { margin:0.3rem 0; }
  code { background:color-mix(in srgb,var(--ink) 10%, transparent); padding:0.05rem 0.3rem; border-radius:4px; font-size:0.9em; }
</style>
</head>
<body>
${topbar("/developers", lang)}
<main id="main">
  <h1>${esc(D.title)}</h1>
  <p class="lede">${esc(D.intro)}</p>
${body}
</main>
${footer({ page: "/developers", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>) and NOAA/NWS.`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>) y de NOAA/NWS.`) })}
</body>
</html>`;
}

function developersMarkdown(lang) {
  const D = lang === "es" ? DEVELOPERS_ES : DEVELOPERS;
  const out = [`# ${D.title}`, "", D.intro, ""];
  for (const s of D.sections) {
    out.push(`## ${s.h}`, "");
    for (const t of s.p || []) out.push(t, "");
    for (const l of s.links || []) out.push(`- [${l.label}](${l.href}) — ${l.note}`);
    if (s.links) out.push("");
  }
  out.push("---", `[crosbynews.com](${canonicalFor("/", lang)}) · ${T(lang, "weather for Crosby, Texas", "clima para Crosby, Texas")}`);
  return out.join("\n");
}
// --- end Developers & agents page -----------------------------------------

// --- Privacy page ---------------------------------------------------------

function jsonldPrivacy(lang) {
  const P = lang === "es" ? PRIVACY_ES : PRIVACY;
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": canonicalFor("/privacy", lang) + "#webpage",
    url: canonicalFor("/privacy", lang),
    name: P.title,
    description: P.description,
    inLanguage: lang === "es" ? "es-MX" : "en-US",
    isPartOf: { "@id": WEBSITE_ID },
  })}</script>`;
}

function privacyHtml(lang) {
  const P = lang === "es" ? PRIVACY_ES : PRIVACY;
  const body = P.sections
    .map((s) => {
      const paras = (s.p || []).map((t) => `<p>${esc(t)}</p>`).join("\n      ");
      const links = s.links
        ? `<ul class="links">${s.links
            .map((l) => `<li><a href="${l.href}"><code>${esc(l.label)}</code></a> &mdash; ${esc(l.note)}</li>`)
            .join("")}</ul>`
        : "";
      return `      <section class="card">
        <h2>${esc(s.h)}</h2>
        ${paras}
        ${links}
      </section>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(P.title)} &mdash; ${T(lang, "Crosby, TX Weather", "Clima de Crosby, TX")}</title>
<meta name="description" content="${esc(P.description)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(P.title)}">
<meta property="og:description" content="${esc(P.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/privacy", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/privacy", lang)}">
${hreflangTags("/privacy")}
${JSONLD_SITE}
${jsonldPrivacy(lang)}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .card { background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.5rem; }
  .card p { margin:0.5rem 0; }
  .lede { font-size:1.05rem; color:var(--ink); }
  .links { margin:0.5rem 0 0; padding-left:1.1rem; }
  .links li { margin:0.3rem 0; }
</style>
</head>
<body>
${topbar("/privacy", lang)}
<main id="main">
  <h1>${esc(P.title)}</h1>
  <p class="lede">${esc(P.intro)}</p>
${body}
</main>
${footer({ page: "/privacy", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`) })}
</body>
</html>`;
}

function privacyMarkdown(lang) {
  const P = lang === "es" ? PRIVACY_ES : PRIVACY;
  const out = [`# ${P.title}`, "", P.intro, ""];
  for (const s of P.sections) {
    out.push(`## ${s.h}`, "");
    for (const t of s.p || []) out.push(t, "");
    for (const l of s.links || []) out.push(`- [${l.label}](${l.href}) — ${l.note}`);
    if (s.links) out.push("");
  }
  out.push("---", `[crosbynews.com](${canonicalFor("/", lang)}) · ${T(lang, "weather for Crosby, Texas", "clima para Crosby, Texas")}`);
  return out.join("\n");
}
// --- end Privacy page -----------------------------------------------------

// --- Contact page ---------------------------------------------------------

function jsonldContact(lang) {
  const C = lang === "es" ? CONTACT_ES : CONTACT;
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ContactPage",
    "@id": canonicalFor("/contact", lang) + "#webpage",
    url: canonicalFor("/contact", lang),
    name: C.title,
    description: C.description,
    inLanguage: lang === "es" ? "es-MX" : "en-US",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORG_ID },
  })}</script>`;
}

function contactHtml(lang) {
  const C = lang === "es" ? CONTACT_ES : CONTACT;
  const body = C.sections
    .map((s) => {
      const paras = (s.p || []).map((t) => `<p>${esc(t)}</p>`).join("\n      ");
      const links = s.links
        ? `<ul class="links">${s.links
            .map((l) => `<li><a href="${l.href}"><code>${esc(l.label)}</code></a> &mdash; ${esc(l.note)}</li>`)
            .join("")}</ul>`
        : "";
      return `      <section class="card">
        <h2>${esc(s.h)}</h2>
        ${paras}
        ${links}
      </section>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(C.title)} &mdash; ${T(lang, "Crosby, TX Weather", "Clima de Crosby, TX")}</title>
<meta name="description" content="${esc(C.description)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(C.title)}">
<meta property="og:description" content="${esc(C.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/contact", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/contact", lang)}">
${hreflangTags("/contact")}
${JSONLD_SITE}
${jsonldContact(lang)}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .card { background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.5rem; }
  .card p { margin:0.5rem 0; }
  .lede { font-size:1.05rem; color:var(--ink); }
  .links { margin:0.5rem 0 0; padding-left:1.1rem; }
  .links li { margin:0.3rem 0; }
</style>
</head>
<body>
${topbar("/contact", lang)}
<main id="main">
  <h1>${esc(C.title)}</h1>
  <p class="lede">${esc(C.intro)}</p>
${body}
</main>
${footer({ page: "/contact", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`) })}
</body>
</html>`;
}

function contactMarkdown(lang) {
  const C = lang === "es" ? CONTACT_ES : CONTACT;
  const out = [`# ${C.title}`, "", C.intro, ""];
  for (const s of C.sections) {
    out.push(`## ${s.h}`, "");
    for (const t of s.p || []) out.push(t, "");
    for (const l of s.links || []) out.push(`- [${l.label}](${l.href}) — ${l.note}`);
    if (s.links) out.push("");
  }
  out.push("---", `[crosbynews.com](${canonicalFor("/", lang)}) · ${T(lang, "weather for Crosby, Texas", "clima para Crosby, Texas")}`);
  return out.join("\n");
}
// --- end Contact page -----------------------------------------------------

// --- Emergency resources page ----------------------------------------------
// A static, evergreen directory of official emergency contacts for Crosby /
// NE Harris County — 911 guidance, outage reporting, flood + road conditions,
// shelters, disaster recovery. Pure content, zero new dependencies; same
// content-object + shared-renderer pattern as ABOUT/DEVELOPERS so the two
// languages can't drift. Every external link and phone number was verified
// live before shipping (texaspoison.com is a parked domain now — hence
// poison.org); federal sites (ready.gov, disasterassistance.gov) WAF-block
// datacenter curl but are canonical.
const EMERGENCY = {
  title: "Emergency Resources",
  description:
    "Emergency contacts for Crosby, TX — 911 and non-emergency numbers, power outage and gas leak reporting, the CAER industrial-incident line, flood and road conditions, shelters, and disaster help for northeast Harris County.",
  intro:
    "In an immediate emergency — a medical crisis, a fire, a crime in progress, or water coming into your home — call 911 now. The rest of this page is for everything around that moment: the right number when it's not a 911 call, live flood and road conditions, how to report outages, and where to find help after a disaster.",
  sections: [
    {
      h: "Numbers to save",
      p: [
        "Put these in your phone before you need them. In a widespread storm, calls can fail while text and data still work — 911 also takes texts in Harris County, and most services below have a website.",
        "One thing that trips up new residents: Crosby is unincorporated Harris County, so Houston's 311 line doesn't cover it. For county problems that aren't emergencies — debris, drainage, stray animals — start with the sheriff's non-emergency line or 211.",
      ],
      links: [
        { href: "tel:911", label: "911", note: "police, fire, or medical emergency — call or text (Harris County supports text-to-911)" },
        { href: "tel:7132216000", label: "713-221-6000", note: "Harris County Sheriff's Office non-emergency line — the law enforcement agency covering Crosby" },
        { href: "tel:18002221222", label: "1-800-222-1222", note: "Poison Control — free, 24/7, interpreters available (poison.org)" },
        { href: "tel:988", label: "988", note: "Suicide & Crisis Lifeline — call or text, free, 24/7" },
        { href: "tel:211", label: "211", note: "211 Texas — community resources, shelter locations, disaster assistance" },
      ],
    },
    {
      h: "Weather alerts",
      p: ["These are the official warning channels for Crosby and northeast Harris County. Also keep Wireless Emergency Alerts turned on in your phone's settings — tornado and flash-flood warnings come through even when cell networks are congested."],
      links: [
        { href: "/alerts", label: "crosbynews.com/alerts", note: "active NWS alerts for Crosby, refreshed every 15 minutes — also an RSS feed at /alerts.xml" },
        { href: "https://www.readyharris.org", label: "ReadyHarris", note: "Harris County emergency management — sign up for official emergency alerts by call, text, or email" },
        { href: "https://www.weather.gov/hgx", label: "NWS Houston/Galveston", note: "the National Weather Service office that issues warnings for Crosby" },
      ],
    },
    {
      h: "Flooding & high water",
      p: ["Crosby floods from its bayous and the San Jacinto River. Never drive into water on a road — turn around, don't drown. Most flood deaths around Houston are people in vehicles."],
      links: [
        { href: "/water", label: "crosbynews.com/water", note: "live levels for Cedar Bayou, the San Jacinto River, Luce Bayou, and nearby gauges, with NWS flood stages" },
        { href: "https://www.harriscountyfws.org", label: "Harris County Flood Warning System", note: "county rainfall and channel gauges with live inundation mapping" },
        { href: "https://www.harriscountyfemt.org", label: "Harris County Flood Education Mapping Tool", note: "look up whether an address sits in a mapped floodplain" },
        { href: "https://www.hcfcd.org", label: "Harris County Flood Control District", note: "floodplain maps and drainage projects" },
        { href: "https://www.floodsmart.gov", label: "FloodSmart.gov", note: "the National Flood Insurance Program — homeowner's policies don't cover flood damage, and a new flood policy typically takes 30 days to take effect, so buy before a storm is named" },
      ],
    },
    {
      h: "Roads & traffic",
      p: ["Check before you drive in severe weather — high-water spots close Crosby's routes fast:"],
      links: [
        { href: "https://traffic.houstontranstar.org", label: "Houston TranStar", note: "real-time Houston-area traffic, incidents, and high-water road closures" },
        { href: "https://drivetexas.org", label: "DriveTexas", note: "TxDOT statewide highway conditions and closures" },
      ],
    },
    {
      h: "Power & gas outages",
      p: ["If a power line is down or you smell gas, get clear of the area and call 911 first — then the utility. Most of Crosby gets electric delivery and natural gas from CenterPoint Energy."],
      links: [
        { href: "https://www.centerpointenergy.com/outage", label: "CenterPoint Outage Center", note: "report an electric outage and track restoration on the outage map" },
        { href: "tel:7132072222", label: "713-207-2222", note: "CenterPoint electric — report outages and downed power lines" },
        { href: "tel:18888765786", label: "888-876-5786", note: "CenterPoint natural gas — report a gas leak or gas odor after you've left the area" },
      ],
    },
    {
      h: "Industrial incidents",
      p: ["Crosby has chemical plants of its own and sits near the east Harris County industrial corridor. When you see smoke or flaring or hear a boom, the CAER Line carries recorded updates straight from area plants and emergency officials — and any shelter-in-place order comes through ReadyHarris and Wireless Emergency Alerts."],
      links: [
        { href: "tel:2814762237", label: "281-476-2237", note: "East Harris County CAER Line — recorded industrial-incident and flaring updates, 24/7" },
        { href: "https://www.ehcma.org", label: "EHCMA / CAER Online", note: "the same updates on the web, from the East Harris County Manufacturers Association" },
      ],
    },
    {
      h: "Shelter & disaster recovery",
      p: ["When a disaster displaces people, shelters are announced through ReadyHarris, local media, and the organizations below:"],
      links: [
        { href: "https://www.redcross.org", label: "American Red Cross", note: "open shelters, emergency supplies, and recovery help — 1-800-733-2767" },
        { href: "https://www.disasterassistance.gov", label: "DisasterAssistance.gov", note: "apply for FEMA assistance after a federally declared disaster — or call 1-800-621-3362" },
        { href: "https://www.211texas.org", label: "211 Texas", note: "dial 211 for shelter, food, housing, and disaster recovery programs" },
      ],
    },
    {
      h: "Before the storm",
      p: ["Hurricane season runs June through November. Crosby sits inland of the coastal storm-surge evacuation zones, but coastal evacuations route through northeast Harris County — expect heavy traffic on US-90 and I-10 when zones toward the coast are called. Build a kit (water, food, medicine, flashlights, batteries) before a storm has a name."],
      links: [
        { href: "https://www.h-gac.com/hurricane-evacuation-planning", label: "H-GAC evacuation planning", note: "the regional Zip-Zone hurricane evacuation maps — check whether an address is in a zone (Crosby isn't, but family toward the coast may be)" },
        { href: "https://www.ready.gov", label: "Ready.gov", note: "FEMA's preparedness guides — build a kit, make a family plan" },
        { href: "/weather", label: "crosbynews.com/weather", note: "the Crosby forecast — check timing before severe weather arrives" },
      ],
    },
    {
      h: "About this page",
      p: [
        "Every link and number here was checked when this page was last updated, but services change — if a number stops working, dial 211 and they can route you, and please tell us so we can fix it.",
        "crosbynews.com is an independent project, not a government service. This page is a directory of official resources, not a live status board — in a life-threatening situation, don't read a website: call 911.",
      ],
      links: [
        { href: "/contact", label: "/contact", note: "report a broken link or a number that's changed" },
      ],
    },
  ],
};

const EMERGENCY_ES = {
  title: "Recursos de emergencia",
  description:
    "Contactos de emergencia para Crosby, TX — el 911 y números que no son de emergencia, reportes de apagones y fugas de gas, la línea CAER de incidentes industriales, condiciones de inundación y de caminos, refugios y ayuda por desastre para el noreste del condado de Harris.",
  intro:
    "En una emergencia inmediata — una crisis médica, un incendio, un delito en curso o agua entrando a tu casa — llama al 911 ahora. El resto de esta página es para todo lo demás: el número correcto cuando no es una llamada al 911, condiciones de inundación y caminos en vivo, cómo reportar apagones y dónde encontrar ayuda después de un desastre.",
  sections: [
    {
      h: "Números para guardar",
      p: [
        "Guárdalos en tu teléfono antes de necesitarlos. En una tormenta fuerte las llamadas pueden fallar mientras los mensajes de texto y los datos siguen funcionando — el 911 también acepta mensajes de texto en el condado de Harris, y casi todos los servicios de abajo tienen sitio web.",
        "Algo que confunde a los residentes nuevos: Crosby es parte no incorporada del condado de Harris, así que el 311 de Houston no lo cubre. Para problemas del condado que no son emergencias — escombros, drenaje, animales callejeros — empieza con la línea que no es de emergencia del sheriff o con el 211.",
      ],
      links: [
        { href: "tel:911", label: "911", note: "emergencia policiaca, de incendio o médica — llama o manda mensaje de texto (el condado de Harris acepta texto al 911)" },
        { href: "tel:7132216000", label: "713-221-6000", note: "línea que no es de emergencia de la Oficina del Sheriff del Condado de Harris — la policía que cubre Crosby" },
        { href: "tel:18002221222", label: "1-800-222-1222", note: "Control de Envenenamientos — gratis, 24/7, con intérpretes en español (poison.org)" },
        { href: "tel:988", label: "988", note: "Línea de Prevención del Suicidio y Crisis — llama o manda texto, gratis, 24/7; oprime 2 para español" },
        { href: "tel:211", label: "211", note: "211 Texas — recursos comunitarios, refugios y asistencia por desastre, con atención en español" },
      ],
    },
    {
      h: "Alertas del clima",
      p: ["Estos son los canales oficiales de aviso para Crosby y el noreste del condado de Harris. Mantén también activadas las Alertas Inalámbricas de Emergencia (WEA) en la configuración de tu teléfono — los avisos de tornado e inundación repentina llegan aun cuando la red celular está congestionada. Las alertas del NWS se publican en inglés."],
      links: [
        { href: "/es/alerts", label: "crosbynews.com/es/alerts", note: "alertas activas del NWS para Crosby, actualizadas cada 15 minutos — también como feed RSS en /alerts.xml" },
        { href: "https://www.readyharris.org", label: "ReadyHarris", note: "manejo de emergencias del condado de Harris — regístrate para recibir alertas oficiales por llamada, texto o correo" },
        { href: "https://www.weather.gov/hgx", label: "NWS Houston/Galveston", note: "la oficina del Servicio Meteorológico Nacional que emite los avisos para Crosby" },
      ],
    },
    {
      h: "Inundaciones y agua alta",
      p: ["Crosby se inunda por sus arroyos (bayous) y el río San Jacinto. Nunca manejes por un camino con agua — da la vuelta, no te ahogues. La mayoría de las muertes por inundación en la zona de Houston son de personas en vehículos."],
      links: [
        { href: "/es/water", label: "crosbynews.com/es/water", note: "niveles en vivo de Cedar Bayou, el río San Jacinto, Luce Bayou y estaciones cercanas, con las etapas de inundación del NWS" },
        { href: "https://www.harriscountyfws.org", label: "Harris County Flood Warning System", note: "pluviómetros y medidores de canales del condado con mapas de inundación en vivo" },
        { href: "https://www.harriscountyfemt.org", label: "Harris County Flood Education Mapping Tool", note: "consulta si una dirección está en una zona inundable oficial" },
        { href: "https://www.hcfcd.org", label: "Harris County Flood Control District", note: "mapas de zonas inundables y proyectos de drenaje" },
        { href: "https://www.floodsmart.gov/es", label: "FloodSmart.gov (en español)", note: "el Programa Nacional de Seguro contra Inundaciones — las pólizas de casa no cubren daños por inundación, y una póliza nueva normalmente tarda 30 días en entrar en vigor, así que cómprala antes de que la tormenta tenga nombre" },
      ],
    },
    {
      h: "Caminos y tráfico",
      p: ["Consulta antes de manejar con mal tiempo — los puntos de agua alta cierran rápido las rutas de Crosby:"],
      links: [
        { href: "https://traffic.houstontranstar.org", label: "Houston TranStar", note: "tráfico del área de Houston en tiempo real, incidentes y cierres por agua alta" },
        { href: "https://drivetexas.org", label: "DriveTexas", note: "condiciones y cierres de carreteras estatales de TxDOT" },
      ],
    },
    {
      h: "Apagones y fugas de gas",
      p: ["Si hay un cable de luz caído o hueles a gas, aléjate del área y llama primero al 911 — después a la compañía. La mayor parte de Crosby recibe la electricidad y el gas natural de CenterPoint Energy."],
      links: [
        { href: "https://www.centerpointenergy.com/outage", label: "Centro de apagones de CenterPoint", note: "reporta un apagón eléctrico y sigue la restauración en el mapa de apagones" },
        { href: "tel:7132072222", label: "713-207-2222", note: "CenterPoint electricidad — reporta apagones y cables de luz caídos" },
        { href: "tel:18888765786", label: "888-876-5786", note: "CenterPoint gas natural — reporta una fuga u olor a gas después de alejarte del lugar" },
      ],
    },
    {
      h: "Incidentes industriales",
      p: ["Crosby tiene plantas químicas propias y está cerca del corredor industrial del este del condado de Harris. Cuando veas humo o quema en antorcha o escuches un estruendo, la Línea CAER tiene actualizaciones grabadas directamente de las plantas de la zona y de las autoridades — y cualquier orden de refugiarse en casa llega por ReadyHarris y las Alertas Inalámbricas de Emergencia."],
      links: [
        { href: "tel:2814762237", label: "281-476-2237", note: "Línea CAER del este del condado de Harris — actualizaciones grabadas de incidentes industriales y quemas en antorcha, 24/7 (en inglés)" },
        { href: "https://www.ehcma.org", label: "EHCMA / CAER Online", note: "las mismas actualizaciones en la web, de la asociación de manufactureras del este del condado de Harris" },
      ],
    },
    {
      h: "Refugios y recuperación",
      p: ["Cuando un desastre desplaza a la gente, los refugios se anuncian por ReadyHarris, los medios locales y las organizaciones de abajo:"],
      links: [
        { href: "https://www.redcross.org/cruz-roja.html", label: "Cruz Roja Americana", note: "refugios abiertos, suministros de emergencia y ayuda para recuperarse — 1-800-733-2767" },
        { href: "https://www.disasterassistance.gov", label: "DisasterAssistance.gov", note: "solicita ayuda de FEMA tras un desastre con declaración federal (disponible en español) — o llama al 1-800-621-3362" },
        { href: "https://www.211texas.org", label: "211 Texas", note: "marca 211 para refugio, comida, vivienda y programas de recuperación, con atención en español" },
      ],
    },
    {
      h: "Antes de la tormenta",
      p: ["La temporada de huracanes va de junio a noviembre. Crosby está tierra adentro, fuera de las zonas costeras de evacuación por marejada, pero las evacuaciones de la costa pasan por el noreste del condado de Harris — espera tráfico pesado en la US-90 y la I-10 cuando se ordene evacuar las zonas hacia la costa. Arma un kit (agua, comida, medicinas, linternas, pilas) antes de que la tormenta tenga nombre."],
      links: [
        { href: "https://www.h-gac.com/hurricane-evacuation-planning", label: "Planeación de evacuación de H-GAC", note: "los mapas regionales de zonas de evacuación por huracán (Zip-Zone), con versión en español — consulta si una dirección está en una zona (Crosby no lo está, pero tu familia hacia la costa quizá sí)" },
        { href: "https://www.ready.gov/es", label: "Listo (Ready.gov en español)", note: "guías de preparación de FEMA en español — arma un kit, haz un plan familiar" },
        { href: "/es/weather", label: "crosbynews.com/es/weather", note: "el pronóstico de Crosby — revisa los tiempos antes del mal tiempo" },
      ],
    },
    {
      h: "Sobre esta página",
      p: [
        "Cada enlace y número se verificó en la última actualización de esta página, pero los servicios cambian — si un número deja de funcionar, marca 211 para que te canalicen, y avísanos para corregirlo.",
        "crosbynews.com es un proyecto independiente, no un servicio del gobierno. Esta página es un directorio de recursos oficiales, no un tablero de estado en vivo — en una situación de riesgo para la vida, no leas un sitio web: llama al 911.",
      ],
      links: [
        { href: "/es/contact", label: "/es/contact", note: "reporta un enlace roto o un número que cambió" },
      ],
    },
  ],
};

function jsonldEmergency(lang) {
  const E = lang === "es" ? EMERGENCY_ES : EMERGENCY;
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": canonicalFor("/emergency", lang) + "#webpage",
    url: canonicalFor("/emergency", lang),
    name: E.title,
    description: E.description,
    inLanguage: lang === "es" ? "es-MX" : "en-US",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORG_ID },
  })}</script>`;
}

function emergencyHtml(lang) {
  const E = lang === "es" ? EMERGENCY_ES : EMERGENCY;
  const body = E.sections
    .map((s) => {
      const paras = (s.p || []).map((t) => `<p>${esc(t)}</p>`).join("\n      ");
      const links = s.links
        ? `<ul class="links">${s.links
            .map((l) => `<li><a href="${l.href}"><code>${esc(l.label)}</code></a> &mdash; ${esc(l.note)}</li>`)
            .join("")}</ul>`
        : "";
      return `      <section class="card">
        <h2>${esc(s.h)}</h2>
        ${paras}
        ${links}
      </section>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(E.title)} &mdash; Crosby, TX &mdash; crosbynews.com</title>
<meta name="description" content="${esc(E.description)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(E.title)}">
<meta property="og:description" content="${esc(E.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/emergency", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/emergency", lang)}">
${hreflangTags("/emergency")}
${JSONLD_SITE}
${jsonldEmergency(lang)}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .card { background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.5rem; }
  .card p { margin:0.5rem 0; }
  .lede { font-size:1.05rem; color:var(--ink); }
  .links { margin:0.5rem 0 0; padding-left:1.1rem; }
  .links li { margin:0.3rem 0; }
  code { background:color-mix(in srgb,var(--ink) 10%, transparent); padding:0.05rem 0.3rem; border-radius:4px; font-size:0.9em; }
</style>
</head>
<body>
${topbar("/emergency", lang)}
<main id="main">
  <h1>${esc(E.title)}</h1>
  <p class="lede">${esc(E.intro)}</p>
${body}
</main>
${footer({ page: "/emergency", lang, source: T(lang, "Links on this page go to official government, utility, and nonprofit services.", "Los enlaces de esta página llevan a servicios oficiales del gobierno, de las compañías de servicios y de organizaciones sin fines de lucro.") })}
</body>
</html>`;
}

function emergencyMarkdown(lang) {
  const E = lang === "es" ? EMERGENCY_ES : EMERGENCY;
  const out = [`# ${E.title}`, "", E.intro, ""];
  for (const s of E.sections) {
    out.push(`## ${s.h}`, "");
    for (const t of s.p || []) out.push(t, "");
    for (const l of s.links || []) out.push(`- [${l.label}](${l.href}) — ${l.note}`);
    if (s.links) out.push("");
  }
  out.push("---", `[crosbynews.com](${canonicalFor("/", lang)}) · ${T(lang, "weather for Crosby, Texas", "clima para Crosby, Texas")}`);
  return out.join("\n");
}
// --- end Emergency resources page -------------------------------------------

// --- Sitemap page (human-readable) ----------------------------------------

function sitemapPageHtml(lang) {
  const t = (en, es) => T(lang, en, es);
  const lk = (enHref, label, desc) => {
    const href = lang === "es" ? esPath(enHref) : enHref;
    return `<li><a href="${href}">${label}</a> &mdash; ${desc}</li>`;
  };
  const extLk = (href, label, desc) => `<li><a href="${href}">${label}</a> &mdash; ${desc}</li>`;

  const title = t("Sitemap", "Mapa del sitio");
  const description = t(
    "Every page and endpoint on crosbynews.com, organized by category.",
    "Todas las páginas y endpoints de crosbynews.com, organizados por categoría.",
  );

  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} &mdash; ${t("Crosby, TX Weather", "Clima de Crosby, TX")}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/sitemap", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/sitemap", lang)}">
${hreflangTags("/sitemap")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .card { background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.5rem; }
  .card ul { margin:0.5rem 0; padding-left:1.3rem; }
  .card li { margin:0.3rem 0; }
  .lede { font-size:1.05rem; color:var(--ink); }
</style>
</head>
<body>
${topbar("/sitemap", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="lede">${esc(description)}</p>

  <section class="card">
    <h2>${t("Weather &amp; Forecast", "Clima y pronóstico")}</h2>
    <ul>
      ${lk("/", t("Home", "Inicio"), t("The Crosby front page — conditions, water, news, and school events at a glance.", "La página principal de Crosby — condiciones, agua, noticias y eventos escolares de un vistazo."))}
      ${lk("/weather", t("Weather", "Clima"), t("Current conditions, 12-hour hourly strip, and 7-day forecast.", "Condiciones actuales, franja horaria de 12 horas y pronóstico a 7 días."))}
      ${lk("/hourly", t("Hourly Forecast", "Pronóstico por hora"), t("Full 48-hour hour-by-hour forecast table.", "Tabla completa de pronóstico hora por hora de 48 horas."))}
      ${lk("/radar", t("Radar", "Radar"), t("Live NWS KHGX radar loop for the Crosby area.", "Radar en vivo del NWS KHGX para la zona de Crosby."))}
      ${lk("/alerts", t("Alerts", "Alertas"), t("Active NWS weather alerts plus a severe-weather guide.", "Alertas meteorológicas activas del NWS más una guía de clima severo."))}
      ${lk("/water", t("Water Levels", "Niveles de agua"), t("Live river and bayou levels with NWS flood stages.", "Niveles de ríos y arroyos en vivo con las etapas de inundación del NWS."))}
      ${lk("/tropics", t("Tropics", "Trópicos"), t("Active Atlantic tropical systems from the National Hurricane Center.", "Sistemas tropicales activos del Atlántico según el Centro Nacional de Huracanes."))}
    </ul>
  </section>

  <section class="card">
    <h2>${t("Community", "Comunidad")}</h2>
    <ul>
      ${lk("/news", t("News", "Noticias"), t("Local headlines about Crosby, TX and nearby communities.", "Titulares locales sobre Crosby, TX y comunidades cercanas."))}
      ${lk("/calendar", t("School Calendar", "Calendario escolar"), t("Upcoming Crosby ISD school calendar events.", "Próximos eventos del calendario escolar de Crosby ISD."))}
      ${lk("/emergency", t("Emergency Resources", "Recursos de emergencia"), t("911 and non-emergency numbers, outages, flooding, shelters, and disaster help.", "El 911 y números que no son de emergencia, apagones, inundaciones, refugios y ayuda por desastre."))}
    </ul>
  </section>

  <section class="card">
    <h2>${t("About &amp; Policies", "Acerca de y políticas")}</h2>
    <ul>
      ${lk("/about", t("About", "Acerca de"), t("What this site is, data sources, API, and MCP server.", "Qué es este sitio, fuentes de datos, API y servidor MCP."))}
      ${lk("/privacy", t("Privacy Policy", "Política de privacidad"), t("No cookies, no trackers — how we handle your data.", "Sin cookies, sin rastreadores — cómo manejamos tus datos."))}
      ${lk("/contact", t("Contact", "Contacto"), t("How to reach us for questions, tips, and security reports.", "Cómo comunicarte con nosotros para preguntas, datos y reportes de seguridad."))}
    </ul>
  </section>

  <section class="card">
    <h2>${t("For Developers &amp; Agents", "Para desarrolladores y agentes")}</h2>
    <ul>
      ${lk("/developers", t("Developers &amp; Agents", "Desarrolladores y agentes"), t("Start here — the API, MCP server, feeds, and agent integrations, documented on one page.", "Empieza aquí — la API, el servidor MCP, los feeds y las integraciones para agentes, en una sola página."))}
      ${extLk("/api/weather", t("Weather API", "API del clima"), t("JSON: current conditions, hourly, 7-day, and alerts.", "JSON: condiciones actuales, por hora, 7 días y alertas."))}
      ${extLk("/api/news", t("News API", "API de noticias"), t("JSON: recent local headlines.", "JSON: titulares locales recientes."))}
      ${extLk("/api/calendar", t("School Calendar API", "API del calendario escolar"), t("JSON: upcoming Crosby ISD events.", "JSON: próximos eventos de Crosby ISD."))}
      ${extLk("/api/health", t("Health Check", "Estado del servicio"), t("Service status and cache freshness.", "Estado del servicio y antigüedad de la caché."))}
      ${extLk("/openapi.json", "OpenAPI 3.1", t("Machine-readable API description.", "Descripción de la API legible por máquinas."))}
      ${extLk("/mcp", t("MCP Server", "Servidor MCP"), t("Model Context Protocol server (Streamable HTTP).", "Servidor del Protocolo de Contexto de Modelo (Streamable HTTP)."))}
      ${extLk("/llms.txt", "llms.txt", t("Plain-language site summary for LLMs.", "Resumen del sitio en lenguaje sencillo para LLM."))}
      ${extLk("/alerts.xml", t("Alerts RSS", "RSS de alertas"), t("Active weather alerts as an RSS feed.", "Alertas meteorológicas activas como feed RSS."))}
      ${extLk("/news.xml", t("News RSS", "RSS de noticias"), t("Local headlines as an RSS feed.", "Titulares locales como feed RSS."))}
      ${extLk("/badge.svg", t("Weather Badge", "Insignia del clima"), t("Hotlinkable live SVG weather badge for other sites.", "Insignia SVG del clima en vivo para enlazar desde otros sitios."))}
      ${extLk("/.well-known/api-catalog", t("API Catalog", "Catálogo de API"), t("RFC 9727 machine-readable API index.", "Índice de API legible por máquinas (RFC 9727)."))}
      ${extLk("/sitemap.xml", t("XML Sitemap", "Sitemap XML"), t("Machine-readable sitemap for crawlers.", "Sitemap legible por máquinas para rastreadores."))}
    </ul>
  </section>
</main>
${footer({ page: "/sitemap", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`) })}
</body>
</html>`;
}

function sitemapPageMarkdown(lang) {
  const t = (en, es) => T(lang, en, es);
  const lk = (enHref, label, desc) => `- [${label}](${SITE}${lang === "es" ? esPath(enHref) : enHref}) — ${desc}`;
  const extLk = (href, label, desc) => `- [${label}](${SITE}${href}) — ${desc}`;

  const out = [
    `# ${t("Sitemap", "Mapa del sitio")}`,
    "",
    t("Every page and endpoint on crosbynews.com.", "Todas las páginas y endpoints de crosbynews.com."),
    "",
    `## ${t("Weather & Forecast", "Clima y pronóstico")}`,
    "",
    lk("/", t("Home", "Inicio"), t("The Crosby front page.", "La página principal de Crosby.")),
    lk("/weather", t("Weather", "Clima"), t("Current conditions, hourly, and 7-day forecast.", "Condiciones actuales, por hora y pronóstico a 7 días.")),
    lk("/hourly", t("Hourly Forecast", "Pronóstico por hora"), t("Full 48-hour table.", "Tabla completa de 48 horas.")),
    lk("/radar", t("Radar", "Radar"), t("Live NWS KHGX radar loop.", "Radar en vivo del NWS KHGX.")),
    lk("/alerts", t("Alerts", "Alertas"), t("Active weather alerts plus severe-weather guide.", "Alertas activas más guía de clima severo.")),
    lk("/water", t("Water Levels", "Niveles de agua"), t("River and bayou levels with NWS flood stages.", "Niveles de ríos y arroyos con las etapas de inundación del NWS.")),
    lk("/tropics", t("Tropics", "Trópicos"), t("Active Atlantic systems from the NHC.", "Sistemas activos del Atlántico según el NHC.")),
    "",
    `## ${t("Community", "Comunidad")}`,
    "",
    lk("/news", t("News", "Noticias"), t("Local headlines.", "Titulares locales.")),
    lk("/calendar", t("School Calendar", "Calendario escolar"), t("Crosby ISD events.", "Eventos de Crosby ISD.")),
    lk("/emergency", t("Emergency Resources", "Recursos de emergencia"), t("911, outages, flooding, shelters, disaster help.", "911, apagones, inundaciones, refugios, ayuda por desastre.")),
    "",
    `## ${t("About & Policies", "Acerca de y políticas")}`,
    "",
    lk("/about", t("About", "Acerca de"), t("Data sources, API, MCP server.", "Fuentes de datos, API, servidor MCP.")),
    lk("/privacy", t("Privacy", "Privacidad"), t("No cookies, no trackers.", "Sin cookies, sin rastreadores.")),
    lk("/contact", t("Contact", "Contacto"), t("Questions, tips, security.", "Preguntas, datos, seguridad.")),
    "",
    `## ${t("For Developers & Agents", "Para desarrolladores y agentes")}`,
    "",
    lk("/developers", t("Developers & Agents", "Desarrolladores y agentes"), t("Start here — API, MCP, feeds, agents on one page.", "Empieza aquí — API, MCP, feeds y agentes en una página.")),
    extLk("/api/weather", t("Weather API", "API del clima"), "JSON"),
    extLk("/api/news", t("News API", "API de noticias"), "JSON"),
    extLk("/api/calendar", t("School Calendar API", "API del calendario escolar"), "JSON"),
    extLk("/api/health", t("Health", "Estado"), t("Status + cache.", "Estado + caché.")),
    extLk("/openapi.json", "OpenAPI 3.1", t("API spec.", "Especificación de la API.")),
    extLk("/mcp", t("MCP Server", "Servidor MCP"), "Streamable HTTP"),
    extLk("/llms.txt", "llms.txt", t("LLM summary.", "Resumen para LLM.")),
    extLk("/alerts.xml", t("Alerts RSS", "RSS de alertas"), "RSS 2.0"),
    extLk("/news.xml", t("News RSS", "RSS de noticias"), "RSS 2.0"),
    extLk("/badge.svg", t("Weather Badge", "Insignia del clima"), t("Hotlinkable SVG.", "SVG para enlazar.")),
    extLk("/.well-known/api-catalog", t("API Catalog", "Catálogo de API"), "RFC 9727"),
    extLk("/sitemap.xml", t("XML Sitemap", "Sitemap XML"), t("For crawlers.", "Para rastreadores.")),
    "",
    "---",
    `[crosbynews.com](${canonicalFor("/", lang)}) · ${t("weather for Crosby, Texas", "clima para Crosby, Texas")}`,
  ];
  return out.join("\n");
}
// --- end Sitemap page -----------------------------------------------------

// --- Radar page -----------------------------------------------------------
// Embeds the NOAA/NWS Houston-Galveston (KHGX) radar loop, which covers Crosby.
// The image is proxied through /radar-image so it lives on our crawlable origin
// and is edge-cached. Static-ish page; the image itself carries a short TTL.
function radarHtml(lang, data) {
  const title = T(lang, "Crosby, TX Weather Radar", "Radar meteorológico de Crosby, TX");
  const desc = T(lang, "Live NWS weather radar loop for Crosby, Texas and the greater Houston area (KHGX), updated continuously.", "Radar meteorológico en vivo del NWS para Crosby, Texas y el área metropolitana de Houston (KHGX), actualizado continuamente.");
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/radar", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/radar", lang)}">
${hreflangTags("/radar")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .radar-wrap { margin-top:1rem; background:var(--card); border-radius:12px; padding:0.8rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .radar-wrap img { width:100%; height:auto; border-radius:8px; display:block; background:#000; }
  .radar-meta { margin:0.6rem 0 0; font-size:0.85rem; color:var(--muted); }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
</style>
</head>
<body>
${topbar("/radar", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="intro">${T(lang, "Live radar for the Crosby / northeast Houston area from the U.S. National Weather Service KHGX (Houston-Galveston) radar. The loop animates the most recent reflectivity scans, showing showers and thunderstorms moving across the region.", "Radar en vivo para Crosby y el noreste de Houston, del radar KHGX (Houston-Galveston) del Servicio Meteorológico Nacional de EE. UU. La animación reproduce los escaneos de reflectividad más recientes, mostrando chubascos y tormentas que se desplazan por la región.")}</p>
  <div class="radar-wrap">
    <img src="/radar-image" alt="${T(lang, "Animated NWS weather radar loop for Crosby, TX (KHGX)", "Animación del radar meteorológico del NWS para Crosby, TX (KHGX)")}" width="600" height="550" loading="eager">
    <p class="radar-meta">${T(lang, "Source: NOAA/NWS KHGX radar &middot; the loop refreshes as new scans publish (roughly every few minutes).", "Fuente: radar KHGX de NOAA/NWS &middot; la animación se actualiza conforme se publican nuevos escaneos (cada pocos minutos).")} <a href="/radar-image?still=1">${T(lang, "Prefer a still image? View the latest single frame.", "¿Prefieres una imagen fija? Ver el último escaneo.")}</a></p>
  </div>
  <section class="card">
    <h2>${T(lang, "Reading this radar", "Cómo leer este radar")}</h2>
    <p>${T(lang, "Color indicates precipitation intensity. Blues and greens are light rain; yellows and oranges are moderate; reds and purples indicate heavy rainfall or large hail. The animation plays the most recent reflectivity scans in sequence so you can see storms moving across the region.", "El color indica la intensidad de la precipitación. Los azules y verdes son lluvia ligera; los amarillos y naranjas, moderada; los rojos y morados indican lluvia intensa o granizo grande. La animación reproduce los escaneos de reflectividad más recientes en secuencia para que veas las tormentas moverse por la región.")}</p>
    <p>${T(lang, `The KHGX radar is sited at Galveston Bay, roughly 40 miles south of Crosby, giving it a low-angle view of storms approaching from the Gulf. Crosby sits in northeast Harris County, a low-lying area that is especially prone to flash flooding during slow-moving Gulf Coast storms. A rotating hook echo or tight circulation on the southwest flank of a storm cell can indicate a tornado threat &mdash; check <a href="/alerts">active alerts</a> for any warnings already issued by the National Weather Service.`, `El radar KHGX está ubicado en la bahía de Galveston, a unos 65 km al sur de Crosby, lo que le da una vista de ángulo bajo de las tormentas que se acercan desde el Golfo. Crosby se encuentra en el noreste del condado de Harris, una zona baja especialmente propensa a inundaciones repentinas durante las tormentas lentas de la costa del Golfo. Un eco en forma de gancho o una circulación cerrada en el flanco suroeste de una celda de tormenta puede indicar amenaza de tornado &mdash; consulta las <a href="/es/alerts">alertas activas</a> para ver cualquier aviso ya emitido por el Servicio Meteorológico Nacional.`)}</p>
    <p>${T(lang, `During hurricane season (June&ndash;November) the radar helps track the outer rain bands of tropical systems well before they make landfall. The <a href="https://www.weather.gov/hgx/">NWS Houston/Galveston office</a> is the authoritative source for warnings and watches covering Crosby.`, `Durante la temporada de huracanes (junio&ndash;noviembre) el radar ayuda a rastrear las bandas de lluvia exteriores de los sistemas tropicales mucho antes de que toquen tierra. La <a href="https://www.weather.gov/hgx/">oficina del NWS en Houston/Galveston</a> es la fuente autorizada de avisos y vigilancias para Crosby.`)}</p>
  </section>
  <p class="intro"><a href="${lang === "es" ? "/es/weather" : "/weather"}">&larr; ${T(lang, "Back to the forecast", "Volver al pronóstico")}</a></p>
</main>
${footer({ page: "/radar", lang, source: T(lang, `Radar imagery from the U.S. National Weather Service (<a href="https://radar.weather.gov">radar.weather.gov</a>).`, `Imágenes de radar del Servicio Meteorológico Nacional de EE. UU. (<a href="https://radar.weather.gov">radar.weather.gov</a>).`), data })}
</body>
</html>`;
}

function radarMarkdown(lang) {
  return [
    `# ${T(lang, "Crosby, TX Weather Radar", "Radar meteorológico de Crosby, TX")}`,
    "",
    T(lang, "Live NWS weather radar for the Crosby / northeast Houston area, from the U.S. National Weather Service KHGX (Houston-Galveston) radar.", "Radar meteorológico en vivo del NWS para Crosby y el noreste de Houston, del radar KHGX (Houston-Galveston) del Servicio Meteorológico Nacional de EE. UU."),
    "",
    `![${T(lang, "Crosby TX radar loop", "Animación del radar de Crosby, TX")}](${SITE}/radar-image)`,
    "",
    T(lang, "The loop animates the most recent reflectivity scans (refreshed every few minutes) so you can see showers and thunderstorms moving across the region.", "La animación reproduce los escaneos de reflectividad más recientes (actualizados cada pocos minutos) para que veas chubascos y tormentas moverse por la región."),
    "",
    "---",
    `[crosbynews.com](${canonicalFor("/", lang)}) · [${T(lang, "forecast", "pronóstico")}](${canonicalFor("/weather", lang)}) · [${T(lang, "hourly", "por hora")}](${canonicalFor("/hourly", lang)})`,
  ].join("\n");
}
// --- end Radar page -------------------------------------------------------

// --- Hourly page ----------------------------------------------------------
// Full multi-day hourly forecast (the cache holds 48h; the homepage shows 12).
// Rows are grouped by day. Reuses the NWS hourly data already in KV.
function hourlyHtml(data, lang) {
  const hours = data.hourly ?? [];
  const groups = [];
  for (const h of hours) {
    const day = dayLabel(h.startTime, lang);
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) {
      g = { day, rows: [] };
      groups.push(g);
    }
    g.rows.push(h);
  }
  const body = groups
    .map((g) => {
      const rows = g.rows
        .map((h) => {
          const feels = feelsLikeRawF(h);
          return `<tr>
        <td>${esc(hourLabel(h.startTime, lang))}</td>
        <td><span class="cond">${h.icon ? `<img src="${iconUrl(h.icon, "small")}" alt="${esc(translateConditions(h.shortForecast, lang))}" width="32" height="32" loading="lazy">` : ""}<span>${esc(translateConditions(h.shortForecast, lang))}</span></span></td>
        <td class="num">${esc(h.temperature)}&deg;<span class="tunit">${esc(h.temperatureUnit)}</span>${feels != null ? `<span class="feels-inline"> (${esc(feels)}°)</span>` : ""}</td>
        <td class="num feels-col">${feels != null ? esc(feels) + "°" : "–"}</td>
        <td class="num${pop(h) >= 30 ? " wet" : ""}">${pop(h)}%</td>
        <td class="wind">${esc(translateWind(h.windSpeed, lang))} ${esc(translateDir(h.windDirection, lang))}</td>
      </tr>`;
        })
        .join("\n");
      const sun = sunTimesForCtDate(Date.parse(g.rows[0].startTime));
      const sunLine = sun
        ? ` <span class="day-sun">${T(lang, "Sunrise", "Amanecer")} ${esc(clockTime(sun.sunrise, lang))} &middot; ${T(lang, "Sunset", "Atardecer")} ${esc(clockTime(sun.sunset, lang))}</span>`
        : "";
      return `  <section class="day">
    <h2>${esc(capFirst(g.day))}${sunLine}</h2>
    <table>
      <thead><tr><th scope="col" class="c-time">${T(lang, "Time", "Hora")}</th><th scope="col" class="c-cond">${T(lang, "Conditions", "Condiciones")}</th><th scope="col" class="num c-temp">${T(lang, "Temp", "Temp")}</th><th scope="col" class="num c-feels feels-col">${T(lang, "Feels", "Sensación")}</th><th scope="col" class="num c-rain">${T(lang, "Rain", "Lluvia")}</th><th scope="col" class="c-wind">${T(lang, "Wind", "Viento")}</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </section>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T(lang, "Crosby, TX Hourly Forecast", "Pronóstico por hora de Crosby, TX")} &mdash; crosbynews.com</title>
<meta name="description" content="${T(lang, "Hour-by-hour weather forecast for Crosby, Texas for the next two days, from the U.S. National Weather Service: temperature, conditions, precipitation chance, and wind.", "Pronóstico del tiempo hora por hora para Crosby, Texas para los próximos dos días, del Servicio Meteorológico Nacional de EE. UU.: temperatura, condiciones, probabilidad de lluvia y viento.")}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${T(lang, "Crosby, TX Hourly Forecast", "Pronóstico por hora de Crosby, TX")}">
<meta property="og:description" content="${T(lang, "Hour-by-hour forecast for Crosby, Texas from the National Weather Service.", "Pronóstico hora por hora para Crosby, Texas del Servicio Meteorológico Nacional.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/hourly", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/hourly", lang)}">
${hreflangTags("/hourly")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .day { margin-top:1rem; background:var(--card); border-radius:12px; padding:0.5rem 0.9rem 0.9rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); overflow-x:auto; }
  .day h2 { font-size:1.05rem; }
  .day-sun { font-weight:400; font-size:0.78rem; color:var(--muted); margin-left:0.5rem; white-space:nowrap; }
  /* Fixed layout + shared column widths: every day's table gets IDENTICAL
     columns (they line up down the page), long condition names wrap whole at
     spaces inside their known-width column (no hyphenation needed), and wind
     stays on one line. Widths sum to 100%. */
  table { width:100%; border-collapse:collapse; font-size:0.9rem; table-layout:fixed; }
  .c-time { width:9%; } .c-cond { width:39%; } .c-temp { width:11%; } .c-feels { width:12%; } .c-rain { width:9%; } .c-wind { width:20%; }
  th, td { text-align:left; padding:0.4rem 0.5rem; border-bottom:1px solid var(--line); vertical-align:middle; }
  th { font-size:0.78rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); }
  td img { vertical-align:middle; border-radius:4px; }
  /* Keep conditions text beside the icon — as plain inline content, a wrapped
     second word drops UNDER the icon on narrow (portrait phone) screens. */
  .cond { display:flex; align-items:center; gap:0.45rem; }
  .cond img { flex:none; }
  .num { text-align:right; white-space:nowrap; }
  .wet { color:var(--accent); font-weight:700; }
  .wind { color:var(--muted); white-space:nowrap; }
  /* "(88°)" feels-like inline in the Temp cell is a phone-only rendering. */
  .feels-inline { display:none; }
  .feels-note { display:none; font-size:0.8rem; }
  tr:last-child td { border-bottom:none; }
  @media (max-width:600px) {
    .day { padding:0.5rem 0.6rem 0.7rem; }
    table { font-size:0.84rem; }
    th, td { padding:0.35rem 0.2rem; }
    th { letter-spacing:0.01em; font-size:0.66rem; }
    .cond { gap:0.3rem; }
    .cond img { width:22px; height:22px; }
    /* Phones: fold the Feels column into Temp ("82° (88°)") so five roomy
       columns replace six cramped ones — full-word headers, aligned days. */
    .feels-col { display:none; }
    .feels-inline { display:inline; }
    .feels-note { display:block; }
    .tunit { display:none; }
    .c-time { width:10%; } .c-cond { width:34%; } .c-temp { width:19%; } .c-rain { width:12%; } .c-wind { width:25%; }
    /* Gutters so adjacent headers/columns can't visually run together
       (HORA|CONDICIONES and the right-aligned Rain against Wind). */
    th.c-cond { padding-left:0.5rem; }
    th.c-wind, td.wind { padding-left:0.4rem; }
    td.num { padding-left:0.35rem; }
    .wind { white-space:normal; }
  }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
</style>
</head>
<body>
${topbar("/hourly", lang)}
<main id="main">
  <h1>${T(lang, "Crosby, TX Hourly Forecast", "Pronóstico por hora de Crosby, TX")}</h1>
  <p class="intro">${T(lang, `Hour-by-hour forecast for Crosby, Texas from the U.S. National Weather Service, covering the next ${hours.length} hours. Updated ${esc(fullTime(data.updated))} CT.`, `Pronóstico hora por hora para Crosby, Texas del Servicio Meteorológico Nacional de EE. UU., para las próximas ${hours.length} horas. Actualizado ${esc(fullTime(data.updated, lang))} CT.`)}</p>
  ${lang === "es" ? `<p class="intro nws-note">${ES_NWS_NOTE}</p>` : ""}
  <p class="intro feels-note">${T(lang, "Temp shows the “feels like” temperature in parentheses.", "La temperatura muestra la sensación térmica entre paréntesis.")}</p>
${body || `<p class="none">${T(lang, "Hourly forecast is temporarily unavailable.", "El pronóstico por hora no está disponible temporalmente.")}</p>`}
  <p class="intro"><a href="${lang === "es" ? "/es/weather" : "/weather"}">&larr; ${T(lang, "Back to the forecast", "Volver al pronóstico")}</a> &middot; <a href="${lang === "es" ? "/es/radar" : "/radar"}">Radar</a></p>
</main>
${footer({ page: "/hourly", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`), data })}
</body>
</html>`;
}

function hourlyMarkdown(data, lang) {
  const hours = data.hourly ?? [];
  const out = [
    `# ${T(lang, "Crosby, TX Hourly Forecast", "Pronóstico por hora de Crosby, TX")}`,
    "",
    `_${T(lang, `Hour-by-hour forecast for Crosby, Texas (next ${hours.length} hours) — source: U.S. National Weather Service. Updated ${fullTime(data.updated)} CT.`, `Pronóstico hora por hora para Crosby, Texas (próximas ${hours.length} horas) — fuente: Servicio Meteorológico Nacional de EE. UU. Actualizado ${fullTime(data.updated, lang)} CT.`)}_`,
    "",
  ];
  let curDay = "";
  for (const h of hours) {
    const day = dayLabel(h.startTime, lang);
    if (day !== curDay) {
      curDay = day;
      const sun = sunTimesForCtDate(Date.parse(h.startTime));
      out.push(`## ${capFirst(day)}`, "");
      if (sun) out.push(`_${T(lang, "Sunrise", "Amanecer")} ${clockTime(sun.sunrise, lang)} · ${T(lang, "Sunset", "Atardecer")} ${clockTime(sun.sunset, lang)}_`, "");
      out.push(T(lang, "| Time | Conditions | Temp | Feels | Rain | Wind |", "| Hora | Condiciones | Temp | Sensación | Lluvia | Viento |"), "| --- | --- | --- | --- | --- | --- |");
    }
    const cell = (s) => String(s ?? "").replace(/\|/g, "/");
    const feels = feelsLikeRawF(h);
    out.push(`| ${hourLabel(h.startTime, lang)} | ${cell(translateConditions(h.shortForecast, lang))} | ${h.temperature}°${h.temperatureUnit} | ${feels != null ? feels + "°" : "–"} | ${pop(h)}% | ${cell(translateWind(h.windSpeed, lang))} ${cell(translateDir(h.windDirection, lang))} |`);
  }
  out.push("", "---", `[crosbynews.com](${canonicalFor("/", lang)}) · [${T(lang, "forecast", "pronóstico")}](${canonicalFor("/weather", lang)}) · [radar](${canonicalFor("/radar", lang)})`);
  return out.join("\n");
}
// --- end Hourly page ------------------------------------------------------

// --- Alerts hub -----------------------------------------------------------
// Stable URL for active NWS alerts in Crosby. When nothing is active (the usual
// case) it stays substantial with an evergreen guide to the alert types common
// on the Texas Gulf Coast and what to do — so it isn't a thin/empty page.
const ALERT_GUIDE = [
  { event: "Tornado Warning", what: "A tornado is occurring or imminent (radar-indicated or spotted).", do: "Shelter immediately on the lowest floor, interior room, away from windows. Do not wait to see it." },
  { event: "Severe Thunderstorm Warning", what: "Damaging winds (58+ mph) and/or large hail are occurring or imminent.", do: "Move indoors, away from windows. Be ready for possible tornado warnings to follow." },
  { event: "Flash Flood Warning", what: "Rapid flooding is occurring or imminent — common with the area's heavy downpours.", do: "Move to higher ground. Never drive through flooded roads — turn around, don't drown." },
  { event: "Hurricane / Tropical Storm Warning", what: "Tropical-storm or hurricane conditions are expected within 36 hours — relevant in Gulf season (Jun–Nov).", do: "Follow local officials, finish preparations, and evacuate if told to." },
  { event: "Heat Advisory / Excessive Heat Warning", what: "Dangerous heat and humidity, frequent in a Gulf Coast summer.", do: "Hydrate, limit midday exertion, check on neighbors, and never leave anyone in a parked car." },
];

// Spanish (es-MX) version of the severe-weather guide. The event names keep the
// official English term (what you'll actually see in a live alert) followed by
// the Spanish, so a reader learns to recognize both. The explanations are
// general educational reference — not live warnings — so translating them is
// both safe and useful.
const ALERT_GUIDE_ES = [
  { event: "Tornado Warning (Aviso de tornado)", what: "Hay un tornado en curso o es inminente (detectado por radar o avistado).", do: "Refúgiate de inmediato en el piso más bajo, en una habitación interior y lejos de ventanas. No esperes a verlo." },
  { event: "Severe Thunderstorm Warning (Aviso de tormenta severa)", what: "Vientos dañinos (90+ km/h) o granizo grande en curso o inminentes.", do: "Métete bajo techo, lejos de ventanas. Prepárate por si se emiten avisos de tornado después." },
  { event: "Flash Flood Warning (Aviso de inundación repentina)", what: "Inundación rápida en curso o inminente, común con los aguaceros fuertes de la zona.", do: "Busca terreno alto. Nunca conduzcas por caminos inundados: da la vuelta, no te arriesgues." },
  { event: "Hurricane / Tropical Storm Warning (Aviso de huracán / tormenta tropical)", what: "Se esperan condiciones de tormenta tropical o huracán dentro de 36 horas; relevante en la temporada del Golfo (jun–nov).", do: "Sigue a las autoridades locales, termina los preparativos y evacúa si te lo indican." },
  { event: "Heat Advisory / Excessive Heat Warning (Advertencia de calor)", what: "Calor y humedad peligrosos, frecuentes en el verano de la costa del Golfo.", do: "Hidrátate, limita el esfuerzo al mediodía, revisa a tus vecinos y nunca dejes a nadie en un auto estacionado." },
];

function alertsHtml(data, lang) {
  const alerts = data.alerts ?? [];
  // The page's dominant message is the current status: a big reassuring green
  // panel when all-clear, or the active alerts when there are any. Alert event
  // names + body text stay in NWS's official English (no translation of
  // life-safety wording); only the surrounding labels are localized.
  const status = alerts.length
    ? `<section class="alerts" aria-label="${T(lang, "Active weather alerts", "Alertas meteorológicas activas")}">
    <div class="status status-alert">
      <span class="status-icon">&#9888;</span>
      <div><p class="status-title">${T(lang, `${alerts.length} active weather ${alerts.length === 1 ? "alert" : "alerts"}`, `${alerts.length} ${alerts.length === 1 ? "alerta meteorológica activa" : "alertas meteorológicas activas"}`)}</p>
      <p class="status-sub">${T(lang, "for Crosby, TX &mdash; details below. Follow official guidance.", "para Crosby, TX &mdash; detalles abajo. Sigue la guía oficial.")}</p></div>
    </div>${alerts
      .map(
        (a) => `
    <article class="alert">
      <h3>&#9888; ${esc(a.event)}</h3>
      ${a.headline ? `<p class="headline">${esc(a.headline)}</p>` : ""}
      ${a.description ? `<p>${nl2br(a.description)}</p>` : ""}
      ${a.instruction ? `<p class="instruction"><strong>${T(lang, "What to do:", "Qué hacer:")}</strong> ${nl2br(a.instruction)}</p>` : ""}
      ${a.expires ? `<p class="meta">${T(lang, "In effect until", "Vigente hasta")} ${esc(fullTime(a.expires, lang))}</p>` : ""}
    </article>`
      )
      .join("")}</section>`
    : `<div class="status status-ok" role="status">
    <span class="status-icon">&#10004;</span>
    <div><p class="status-title">${T(lang, "All clear", "Todo despejado")}</p>
    <p class="status-sub">${T(lang, "No active weather alerts for Crosby, TX right now. This page checks for new alerts every 15 minutes.", "Sin alertas meteorológicas activas para Crosby, TX en este momento. Esta página busca nuevas alertas cada 15 minutos.")}</p></div>
  </div>`;

  // The guide is reference material, clearly framed as "what these mean" so the
  // alert names below the all-clear panel aren't mistaken for active warnings.
  const guide = (lang === "es" ? ALERT_GUIDE_ES : ALERT_GUIDE).map(
    (g) => `
    <article class="ref">
      <h3>${esc(g.event)}</h3>
      <p class="ref-line"><span class="ref-label">${T(lang, "Means", "Significa")}</span> ${esc(g.what)}</p>
      <p class="ref-line"><span class="ref-label">${T(lang, "Do", "Qué hacer")}</span> ${esc(g.do)}</p>
    </article>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T(lang, "Crosby, TX Weather Alerts", "Alertas meteorológicas de Crosby, TX")} &mdash; crosbynews.com</title>
<meta name="robots" content="max-snippet:160">
<meta name="description" content="${T(lang, "Active National Weather Service alerts, warnings, and watches for Crosby, Texas, plus a plain-language guide to what each severe-weather alert means and what to do.", "Alertas, avisos y vigilancias activas del Servicio Meteorológico Nacional para Crosby, Texas, además de una guía en lenguaje sencillo sobre qué significa cada alerta de clima severo y qué hacer.")}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${T(lang, "Crosby, TX Weather Alerts", "Alertas meteorológicas de Crosby, TX")}">
<meta property="og:description" content="${T(lang, "Active NWS alerts for Crosby, Texas and a plain-language severe-weather guide.", "Alertas activas del NWS para Crosby, Texas y una guía de clima severo en lenguaje sencillo.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/alerts", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/alerts", lang)}">
${hreflangTags("/alerts")}
<link rel="alternate" type="application/rss+xml" title="Crosby, TX Weather Alerts (RSS)" href="/alerts.xml">
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  /* Big, calm status panel — the first thing you see. */
  .status { display:flex; align-items:center; gap:1rem; border-radius:16px; padding:1.4rem 1.5rem; margin-top:0.8rem; }
  .status-icon { font-size:2.6rem; line-height:1; flex:none; }
  .status-title { margin:0; font-size:1.7rem; font-weight:800; line-height:1.1; }
  .status-sub { margin:0.35rem 0 0; font-size:1rem; opacity:0.95; }
  .status-ok { background:linear-gradient(135deg,#1f8b4c,#2eb86a); color:#fff; }
  .status-alert { background:linear-gradient(135deg,#a3271b,#d44230); color:#fff; }

  /* Active-alert detail cards (only shown when alerts exist). */
  .alerts { display:grid; gap:0.6rem; margin-top:0.5rem; }
  .alert { background:#fff4f3; border-left:5px solid #c0392b; border-radius:10px; padding:0.8rem 1rem; }
  .alert h3 { margin:0 0 0.3rem; color:#a3271b; }
  .alert .headline { font-weight:700; }
  .alert .instruction { background:rgba(255,255,255,0.65); border-radius:6px; padding:0.5rem 0.7rem; }
  .alert .meta { font-size:0.8rem; color:var(--muted); }
  @media (prefers-color-scheme: dark) { .alert { background:#2a1715; } .alert .instruction { background:rgba(0,0,0,0.25); } }

  /* Reference section — deliberately calm/muted so it reads as a glossary,
     not as active warnings. */
  .ref-head { margin-top:2rem; }
  .ref-note { color:var(--muted); margin:0.5rem 0 1rem; font-size:0.95rem; line-height:1.55; }
  .ref-grid { display:grid; gap:0.5rem; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); margin-top:0.7rem; }
  .ref { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:0.7rem 0.9rem; }
  .ref h3 { margin:0 0 0.35rem; font-size:0.98rem; color:var(--muted); font-weight:700; }
  .ref-line { margin:0.25rem 0; font-size:0.85rem; }
  .ref-label { display:inline-block; min-width:3.1rem; font-size:0.7rem; text-transform:uppercase; letter-spacing:0.04em; font-weight:700; color:var(--accent); }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .push-optin { margin-top:1rem; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:0.9rem 1.1rem; }
  .push-optin .push-desc { margin:0 0 0.6rem; font-size:0.95rem; }
  .push-btn { font:inherit; font-weight:700; color:#fff; background:var(--accent); border:none; border-radius:8px; padding:0.55rem 1rem; cursor:pointer; }
  .push-btn:hover { filter:brightness(1.07); }
  .push-btn:disabled { opacity:0.6; cursor:default; }
  .push-status { margin:0.5rem 0 0; font-size:0.85rem; color:var(--muted); }
</style>
</head>
<body>
${topbar("/alerts", lang)}
<main id="main">
  <h1>${T(lang, "Crosby, TX Weather Alerts", "Alertas meteorológicas de Crosby, TX")}</h1>
  ${status}
  <p class="intro"><a href="${lang === "es" ? "/es/weather" : "/weather"}">&larr; ${T(lang, "Back to the forecast", "Volver al pronóstico")}</a> &middot; <a href="${lang === "es" ? "/es/radar" : "/radar"}">Radar</a> &middot; <a href="${lang === "es" ? "/es/emergency" : "/emergency"}"><strong>${T(lang, "Emergency resources", "Recursos de emergencia")}</strong></a> &middot; ${T(lang, `Official source: <a href="https://www.weather.gov/hgx/">NWS Houston/Galveston</a>. In an emergency, call 911.`, `Fuente oficial: <a href="https://www.weather.gov/hgx/">NWS Houston/Galveston</a>. En una emergencia, llama al 911.`)}</p>

  <section class="push-optin" id="push-optin" hidden aria-label="${T(lang, "Severe weather alerts on this device", "Alertas de clima severo en este dispositivo")}"
    data-sub="${T(lang, "Turn on severe alerts", "Activar alertas severas")}"
    data-unsub="${T(lang, "Turn off alerts on this device", "Desactivar alertas en este dispositivo")}"
    data-off="${T(lang, "Get a push notification on this device when a tornado, flash flood, or hurricane warning is issued for Crosby. No account needed, and you can turn it off anytime. Detailed alert text stays in official NWS English.", "Recibe una notificación en este dispositivo cuando se emita un aviso de tornado, inundación repentina o huracán para Crosby. Sin cuenta, y puedes desactivarla cuando quieras. El texto detallado de la alerta permanece en el inglés oficial del NWS.")}"
    data-on="${T(lang, "Alerts are on for this device. You'll be notified of tornado, flash-flood, and hurricane warnings for Crosby.", "Las alertas están activadas en este dispositivo. Se te notificará de avisos de tornado, inundación repentina y huracán para Crosby.")}"
    data-blocked="${T(lang, "Notifications are blocked in your browser settings. Enable them for this site to receive alerts.", "Las notificaciones están bloqueadas en la configuración de tu navegador. Actívalas para este sitio para recibir alertas.")}"
    data-error="${T(lang, "Couldn't update alerts just now. Please try again.", "No se pudieron actualizar las alertas ahora. Inténtalo de nuevo.")}"
    data-ios="${T(lang, "To get severe-weather alerts on an iPhone, first add this site to your Home Screen: tap the Share button, choose “Add to Home Screen,” then open Crosby News from that icon and come back to this page.", "Para recibir alertas de clima severo en un iPhone, primero agrega este sitio a tu pantalla de inicio: toca el botón Compartir, elige «Agregar a pantalla de inicio», luego abre Crosby News desde ese ícono y vuelve a esta página.")}">
    <p class="push-desc"></p>
    <button type="button" class="push-btn" aria-pressed="false"></button>
    <p class="push-status" role="status"></p>
  </section>

  <div data-nosnippet>
  <h2 class="ref-head">${T(lang, "Severe Weather Guide", "Guía de clima severo")}</h2>
  <p class="ref-note">${T(lang, `The guide below explains common NWS alert types in plain language &mdash; what each one means and what to do if one is issued. It&rsquo;s here for reference; no action is needed when the status above shows &ldquo;All clear.&rdquo; If an alert is active for Crosby, the panel at the top of this page turns red and shows the full alert. In any emergency, call&nbsp;911 and follow guidance from local officials and the <a href="https://www.weather.gov/hgx/">NWS Houston/Galveston</a> office.`, `La guía siguiente explica en lenguaje sencillo los tipos de alerta más comunes del NWS: qué significa cada una y qué hacer si se emite. Está aquí como referencia; no se requiere ninguna acción cuando el estado de arriba indica «Todo despejado». Si hay una alerta activa para Crosby, el panel de la parte superior de esta página se vuelve rojo y muestra la alerta completa. En cualquier emergencia, llama al&nbsp;911 y sigue las indicaciones de las autoridades locales y de la <a href="https://www.weather.gov/hgx/">oficina del NWS en Houston/Galveston</a>.`)}</p>
  <div class="ref-grid">${guide}</div>
  </div>
</main>
${footer({ page: "/alerts", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`), data })}
<script>${PUSH_CLIENT_SCRIPT}</script>
</body>
</html>`;
}

function alertsMarkdown(data, lang) {
  const alerts = data.alerts ?? [];
  const out = [`# ${T(lang, "Crosby, TX Weather Alerts", "Alertas meteorológicas de Crosby, TX")}`, "", `_${T(lang, `Active NWS alerts for Crosby, Texas. Updated ${fullTime(data.updated)} CT.`, `Alertas activas del NWS para Crosby, Texas. Actualizado ${fullTime(data.updated, lang)} CT.`)}_`, ""];
  out.push(T(lang, "## Active alerts", "## Alertas activas"));
  if (alerts.length) {
    for (const a of alerts) {
      out.push(`### ${a.event}`);
      if (a.headline) out.push(`**${a.headline}**`, "");
      if (a.description) out.push(String(a.description).replace(/\s*\n\s*/g, " "), "");
      if (a.instruction) out.push(`${T(lang, "What to do:", "Qué hacer:")} ${String(a.instruction).replace(/\s*\n\s*/g, " ")}`, "");
      if (a.expires) out.push(`_${T(lang, "In effect until", "Vigente hasta")} ${fullTime(a.expires, lang)} CT_`, "");
    }
  } else {
    out.push(T(lang, "None right now. ✓", "Ninguna en este momento. ✓"), "");
  }
  out.push(T(lang, "## Severe-weather guide (Texas Gulf Coast)", "## Guía de clima severo (costa del Golfo de Texas)"), "");
  for (const g of lang === "es" ? ALERT_GUIDE_ES : ALERT_GUIDE) {
    out.push(`### ${g.event}`, `- **${T(lang, "Means:", "Significa:")}** ${g.what}`, `- **${T(lang, "Do:", "Qué hacer:")}** ${g.do}`, "");
  }
  out.push("---", `${T(lang, "Official source: NWS Houston/Galveston. In an emergency, call 911.", "Fuente oficial: NWS Houston/Galveston. En una emergencia, llama al 911.")} · [${T(lang, "Emergency resources", "Recursos de emergencia")}](${canonicalFor("/emergency", lang)}) · [crosbynews.com](${canonicalFor("/", lang)})`);
  return out.join("\n");
}
// --- end Alerts hub -------------------------------------------------------

// --- Local news (rendered from KV; fetched out-of-band) ------------------
// The Worker is a pure renderer: /news serves the WEATHER KV "news" key,
// which is written by scripts/fetch-news.mjs run on a Claude routine. Google
// News (the only source with real Crosby coverage) blocks Cloudflare Worker
// IPs, but a routine environment can reach it — so the Worker never fetches
// news itself; it just renders what the routine wrote.
const NEWS_KV_KEY = "news";

// Read the routine-written news from KV (read-only; no live fetch).
async function loadNews(env) {
  const data = await env.WEATHER.get(NEWS_KV_KEY, "json");
  return data && Array.isArray(data.items) ? data : { updated: null, items: [] };
}

function newsDate(ts, lang) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function newsList(items, lang) {
  return `<ul class="news-list">${items
    .map(
      (n) => `
      <li class="news-item">
        <a class="news-title" href="${esc(n.link)}" target="_blank" rel="noopener nofollow">${esc(n.title)}</a>
        <p class="news-meta">${esc(n.source)}${n.source && n.ts ? " &middot; " : ""}${esc(newsDate(n.ts, lang))}</p>
      </li>`
    )
    .join("")}</ul>`;
}

function newsHtml(data, lang) {
  const items = data.items ?? [];
  const community = items.filter((n) => !n.crime);
  const incidents = items.filter((n) => n.crime);
  const list = items.length
    ? `${community.length ? newsList(community, lang) : ""}${
        incidents.length
          ? `<h2 class="incidents-head">${T(lang, "Public safety &amp; incidents", "Seguridad pública e incidentes")}</h2>${newsList(incidents, lang)}`
          : ""
      }`
    : `<p class="none">${T(lang, "No recent Crosby news right now. This page refreshes automatically.", "No hay noticias recientes de Crosby por ahora. Esta página se actualiza automáticamente.")}</p>`;
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T(lang, "Crosby, TX News", "Noticias de Crosby, TX")} &mdash; crosbynews.com</title>
<meta name="description" content="${T(lang, "Recent local news headlines for Crosby, Texas, gathered from Texas and Houston-area news sources and filtered for relevance to the Crosby community.", "Titulares recientes de noticias locales de Crosby, Texas, recopilados de fuentes de noticias de Texas y del área de Houston y filtrados por relevancia para la comunidad de Crosby.")}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${T(lang, "Crosby, TX News", "Noticias de Crosby, TX")}">
<meta property="og:description" content="${T(lang, "Recent local news headlines for Crosby, Texas.", "Titulares recientes de noticias locales de Crosby, Texas.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/news", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/news", lang)}">
${hreflangTags("/news")}
<link rel="alternate" type="application/rss+xml" title="Crosby, TX News (RSS)" href="/news.xml">
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .news-list { list-style:none; padding:0; margin:1rem 0 0; }
  .news-item { background:var(--card); border-radius:10px; padding:0.7rem 0.95rem; margin-bottom:0.6rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .news-title { font-weight:600; color:var(--ink); text-decoration:none; display:block; }
  .news-title:hover { text-decoration:underline; color:var(--accent); }
  .news-meta { margin:0.3rem 0 0; font-size:0.8rem; color:var(--muted); }
  .incidents-head { font-size:0.95rem; color:var(--muted); margin-top:1.6rem; border-top:1px solid var(--line); padding-top:0.9rem; }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .disclaimer { margin-top:1.4rem; font-size:0.8rem; color:var(--muted); border-top:1px solid var(--line); padding-top:0.7rem; }
</style>
</head>
<body>
${topbar("/news", lang)}
<main id="main">
  <h1>${T(lang, "Crosby, TX News", "Noticias de Crosby, TX")}</h1>
  <p class="intro">${T(lang, `Recent headlines about Crosby, Texas and the Crosby ISD community, gathered automatically from Texas and Houston-area news outlets and filtered for relevance to Crosby. Links open the original source.${data.updated ? ` Last updated ${esc(newsDate(data.updated))}.` : ""}`, `Titulares recientes sobre Crosby, Texas y la comunidad de Crosby ISD, recopilados automáticamente de medios de Texas y del área de Houston y filtrados por relevancia para Crosby. Los enlaces abren la fuente original; los titulares se muestran en su idioma original.${data.updated ? ` Última actualización: ${esc(newsDate(data.updated, lang))}.` : ""}`)}</p>
  ${list}
  <section class="card">
    <h2>${T(lang, "About Crosby, Texas", "Acerca de Crosby, Texas")}</h2>
    <p>${T(lang, "Crosby is a community in northeast Harris County, Texas, situated along the San Jacinto River corridor between Houston and Baytown. The area includes Barrett Station and surrounding neighborhoods in the 77532 zip code. Crosby ISD serves the local schools, including Crosby High School, home of the Cougars.", "Crosby es una comunidad en el noreste del condado de Harris, Texas, ubicada a lo largo del corredor del río San Jacinto, entre Houston y Baytown. La zona incluye Barrett Station y los vecindarios cercanos del código postal 77532. El distrito Crosby ISD atiende a las escuelas locales, entre ellas Crosby High School, hogar de los Cougars.")}</p>
    <p>${T(lang, "The community regularly experiences Gulf Coast weather events &mdash; tropical storms, flash flooding, and severe thunderstorms &mdash; making it a distinct news beat separate from the wider Houston metro. Stories here focus on Crosby and the nearby northeast Harris County communities of Huffman, Highlands, Channelview, and Atascocita.", "La comunidad vive con frecuencia fenómenos meteorológicos de la costa del Golfo &mdash; tormentas tropicales, inundaciones repentinas y tormentas severas &mdash; lo que la convierte en un tema de noticias propio, distinto del área metropolitana de Houston. Las notas aquí se centran en Crosby y en las comunidades cercanas del noreste del condado de Harris: Huffman, Highlands, Channelview y Atascocita.")}</p>
    <p class="disclaimer">${T(lang, "Headlines are aggregated from public news sources and filtered to stories about Crosby, TX and nearby communities. crosbynews.com isn&rsquo;t the publisher &mdash; each link goes to the original outlet. Spotted something off-topic? It&rsquo;s automated filtering and we tune it over time.", "Los titulares se recopilan de fuentes de noticias públicas y se filtran para notas sobre Crosby, TX y comunidades cercanas. crosbynews.com no es el editor &mdash; cada enlace lleva al medio original. ¿Viste algo fuera de tema? Es un filtrado automático y lo ajustamos con el tiempo.")}</p>
  </section>
  <p class="intro"><a href="${lang === "es" ? "/es/weather" : "/weather"}">&larr; ${T(lang, "Back to the forecast", "Volver al pronóstico")}</a></p>
</main>
${footer({ page: "/news", lang, source: T(lang, "Weather data from the U.S. National Weather Service. News headlines aggregated from public sources.", "Datos del tiempo del Servicio Meteorológico Nacional de EE. UU. Titulares de noticias recopilados de fuentes públicas.") })}
</body>
</html>`;
}

function newsMarkdown(data, lang) {
  const items = data.items ?? [];
  const updatedNote = data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${fullTime(data.updated, lang)} CT.` : "";
  const out = [`# ${T(lang, "Crosby, TX News", "Noticias de Crosby, TX")}`, "", `_${T(lang, `Recent headlines about Crosby, Texas, filtered for local relevance.${updatedNote}`, `Titulares recientes sobre Crosby, Texas, filtrados por relevancia local.${updatedNote}`)}_`, ""];
  const row = (n) => `- [${n.title}](${n.link})${n.source ? ` — ${n.source}` : ""}${n.ts ? ` (${newsDate(n.ts, lang)})` : ""}`;
  if (items.length) {
    const community = items.filter((n) => !n.crime);
    const incidents = items.filter((n) => n.crime);
    for (const n of community) out.push(row(n));
    if (incidents.length) {
      out.push("", T(lang, "## Public safety & incidents", "## Seguridad pública e incidentes"), "");
      for (const n of incidents) out.push(row(n));
    }
  } else {
    out.push(T(lang, "No recent Crosby news right now.", "No hay noticias recientes de Crosby por ahora."));
  }
  out.push("", "---", `${T(lang, "Headlines aggregated from public sources, filtered for Crosby, TX.", "Titulares recopilados de fuentes públicas, filtrados para Crosby, TX.")} · [crosbynews.com](${canonicalFor("/", lang)})`);
  return out.join("\n");
}
// --- end Local news -------------------------------------------------------

// --- Crosby ISD school calendar (iCal, cron-owned KV) --------------------
// Crosby ISD publishes public iCal feeds. We render the combined "All
// Calendars" feed (the union of every campus) so the page always has content
// and automatically picks up the District academic dates — first day, holidays,
// breaks — once they're posted. The feed is a small static .ics (no RRULE), so
// a tiny hand-rolled parser suffices; no dependency, in keeping with the repo.
// The Worker CAN reach crosbyisd.org (unlike Google News), so this uses the
// cron + KV pattern (key "calendar", cron-owned), not the out-of-band routine.
const CALENDAR_KV_KEY = "calendar";
const CISD_SITE = "https://www.crosbyisd.org/";
const CISD_FEED_ALL_ICS =
  "https://www.crosbyisd.org/cf_calendar/feed.cfm?type=ical&feedID=BB92BE3D0A3744EA9AF7870F2D07E0A2";
const CISD_FEED_ALL_WEBCAL =
  "webcal://www.crosbyisd.org/cf_calendar/feed.cfm?type=ical&feedID=BB92BE3D0A3744EA9AF7870F2D07E0A2";
const CISD_FEED_ALL_GOOGLE =
  "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(CISD_FEED_ALL_ICS);
// Per-campus feeds (calendar_<id>.ics). 350 is the District academic calendar.
const CISD_CAMPUSES = [
  { id: 350, en: "District", es: "Distrito" },
  { id: 354, en: "Crosby High School", es: "Crosby High School" },
  { id: 359, en: "Crosby Middle School", es: "Crosby Middle School" },
  { id: 351, en: "Barrett Elementary", es: "Barrett Elementary" },
  { id: 357, en: "Crosby Elementary", es: "Crosby Elementary" },
  { id: 353, en: "Drew Elementary", es: "Drew Elementary" },
  { id: 356, en: "Newport Elementary", es: "Newport Elementary" },
  { id: 355, en: "Kindergarten Center", es: "Centro de Kínder" },
];
const campusWebcal = (id) => `webcal://www.crosbyisd.org/calendar/calendar_${id}.ics`;

// A handful of evergreen event names; everything else keeps the district's
// official English (honest fallback), with Spanish hints appended for the few
// high-utility patterns parents scan for. Same policy as the NWS/news text.
const ES_EVENT = {
  "FIRST DAY OF SCHOOL!": "¡PRIMER DÍA DE CLASES!",
  "FIRST DAY OF SCHOOL": "Primer día de clases",
  "LAST DAY OF SCHOOL": "Último día de clases",
  "LABOR DAY- NO SCHOOL!": "Día del Trabajo — ¡no hay clases!",
  TUTORIALS: "Tutorías",
  "STAAR/EOC TESTING": "Exámenes STAAR/EOC",
  "SUMMER BAND CAMP": "Campamento de banda de verano",
};
function translateEvent(summary, lang) {
  if (lang !== "es" || !summary) return summary;
  const key = summary.trim().toUpperCase();
  if (ES_EVENT[key]) return ES_EVENT[key];
  if (/no school/i.test(summary)) return `${summary} (no hay clases)`;
  if (/early release|early dismissal/i.test(summary)) return `${summary} (salida temprana)`;
  return summary;
}

// Minimal RFC 5545 reader: unfold continuation lines, then pull VEVENT fields.
// The CISD feed has no RRULE, so no recurrence expansion is needed.
function parseIcs(text) {
  const unfolded = String(text).replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const events = [];
  let cur = null;
  for (const line of unfolded.split(/\r\n|\n|\r/)) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i === -1) continue;
    const name = line.slice(0, i).split(";")[0].toUpperCase();
    const value = line.slice(i + 1);
    if (name === "DTSTART") cur.start = parseIcsDate(value);
    else if (name === "DTEND") cur.end = parseIcsDate(value);
    else if (name === "SUMMARY") cur.summary = unescapeIcs(value);
    else if (name === "LOCATION") cur.location = unescapeIcs(value);
  }
  return events;
}

// Parse an iCal date/date-time. Times in this feed are floating local (Central),
// so build the instant from the literal components as UTC and later format with
// timeZone "UTC" — that preserves the authored wall-clock without shifting it.
function parseIcsDate(v) {
  const m = String(v).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const hasTime = h !== undefined;
  return { ms: Date.UTC(+y, +mo - 1, +d, hasTime ? +h : 0, hasTime ? +mi : 0, hasTime ? +(se || 0) : 0), hasTime };
}

function unescapeIcs(v) {
  return String(v).replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

async function fetchCalendar() {
  const res = await fetch(CISD_FEED_ALL_ICS, {
    headers: { "User-Agent": "crosbynews.com", Accept: "text/calendar,*/*" },
  });
  if (!res.ok) throw new Error(`CISD calendar fetch failed: ${res.status}`);
  const events = parseIcs(await res.text())
    .filter((e) => e.start && e.summary)
    .map((e) => ({ summary: e.summary, location: e.location || "", start: e.start.ms, allDay: !e.start.hasTime, end: e.end ? e.end.ms : null }))
    .sort((a, b) => a.start - b.start);
  return { updated: new Date().toISOString(), events };
}

// Read the cached calendar, self-healing on a missing/malformed entry (the cron
// keeps it fresh; this is the cold-cache fallback, mirroring loadWeather).
async function loadCalendar(env) {
  let data = null;
  try {
    data = await env.WEATHER.get(CALENDAR_KV_KEY, "json");
  } catch (e) {
    console.error("KV calendar parse failed:", e && e.stack);
  }
  if (!data || !Array.isArray(data.events)) {
    try {
      data = await fetchCalendar();
      await env.WEATHER.put(CALENDAR_KV_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("calendar cold fetch failed:", e && e.stack);
      data = { updated: null, events: [] };
    }
  }
  return data;
}

// Upcoming only (include today / in-progress), soonest first, capped.
function upcomingEvents(events) {
  const cutoff = Date.now() - 18 * 3600 * 1000;
  return (events ?? [])
    .filter((e) => typeof e.start === "number" && (e.end ?? e.start) >= cutoff)
    .sort((a, b) => a.start - b.start)
    .slice(0, 60);
}

const calDow = (ms, lang) => new Date(ms).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { timeZone: "UTC", weekday: "short" });
const calDayNum = (ms) => new Date(ms).toLocaleDateString("en-US", { timeZone: "UTC", day: "numeric" });
const calTime = (ms, lang) => new Date(ms).toLocaleTimeString(lang === "es" ? "es-MX" : "en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
const calMonth = (ms, lang) => new Date(ms).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { timeZone: "UTC", month: "long", year: "numeric" });

// schema.org Event JSON-LD for the shown events — honest structured data (Event
// is a real type, unlike the forecast). Floating local datetimes are emitted
// without an offset (valid ISO 8601); all-day events as plain dates.
function jsonldEvents(events, lang) {
  const nodes = events.slice(0, 25).map((e) => {
    const startIso = new Date(e.start).toISOString();
    const node = {
      "@type": "Event",
      name: translateEvent(e.summary, lang),
      startDate: e.allDay ? startIso.slice(0, 10) : startIso.slice(0, 19),
      eventStatus: "https://schema.org/EventScheduled",
      organizer: { "@type": "Organization", name: "Crosby Independent School District", url: CISD_SITE },
    };
    if (e.end) {
      const endIso = new Date(e.end).toISOString();
      node.endDate = e.allDay ? endIso.slice(0, 10) : endIso.slice(0, 19);
    }
    // Every Event needs a location (Google requires it). Use the feed's location
    // when present, else default to the district — these are Crosby ISD dates in
    // Crosby, TX, so the address is honest even for venue-less all-day events.
    node.location = {
      "@type": "Place",
      name: e.location || "Crosby Independent School District",
      address: { "@type": "PostalAddress", addressLocality: "Crosby", addressRegion: "TX", addressCountry: "US" },
    };
    return node;
  });
  if (!nodes.length) return "";
  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": nodes })}</script>`;
}

function calendarSubscribe(lang) {
  const campuses = CISD_CAMPUSES.map(
    (c) => `<li><a href="${campusWebcal(c.id)}">${esc(T(lang, c.en, c.es))}</a></li>`
  ).join("");
  return `<section class="subscribe">
    <h2>${T(lang, "Subscribe — never miss a date", "Suscríbete — no te pierdas ninguna fecha")}</h2>
    <p>${T(lang, "Add the full Crosby ISD calendar to your phone or computer. It updates automatically as the district changes it.", "Agrega el calendario completo de Crosby ISD a tu teléfono o computadora. Se actualiza automáticamente cuando el distrito hace cambios.")}</p>
    <div class="sub-btns">
      <a class="sub-btn" href="${CISD_FEED_ALL_WEBCAL}">${T(lang, "Add to phone (one tap)", "Agregar al teléfono (un toque)")}</a>
      <a class="sub-btn alt" href="${CISD_FEED_ALL_GOOGLE}" target="_blank" rel="noopener">${T(lang, "Add to Google Calendar", "Agregar a Google Calendar")}</a>
      <a class="sub-btn alt" href="${CISD_FEED_ALL_ICS}">${T(lang, "Download .ics", "Descargar .ics")}</a>
    </div>
    <p class="cal-note">${T(lang, "Want only the district holiday &amp; first/last-day calendar?", "¿Solo el calendario de días festivos y de inicio/fin de clases del distrito?")} <a href="${campusWebcal(350)}">${T(lang, "Subscribe to the District calendar", "Suscríbete al calendario del Distrito")}</a>.</p>
    <p class="cal-note">${T(lang, "Or subscribe to a specific campus:", "O suscríbete a un plantel específico:")}</p>
    <ul class="campus-list">${campuses}</ul>
  </section>`;
}

function calendarHtml(data, lang) {
  const events = upcomingEvents(data.events ?? []);
  // Group consecutive events by month heading.
  let body = "";
  if (events.length) {
    let curMonth = "";
    for (const e of events) {
      const month = calMonth(e.start, lang);
      if (month !== curMonth) {
        if (curMonth) body += `</ul></section>`;
        curMonth = month;
        body += `<section class="cal-month"><h2>${esc(month.charAt(0).toUpperCase() + month.slice(1))}</h2><ul class="cal-list">`;
      }
      const meta = [];
      if (e.allDay) meta.push(T(lang, "All day", "Todo el día"));
      else meta.push(esc(calTime(e.start, lang)) + (e.end && e.end > e.start ? "&ndash;" + esc(calTime(e.end, lang)) : ""));
      if (e.location) meta.push(esc(e.location));
      body += `<li class="cal-item">
        <div class="cal-date"><span class="cal-dow">${esc(calDow(e.start, lang))}</span><span class="cal-day">${esc(calDayNum(e.start))}</span></div>
        <div class="cal-body"><p class="cal-title">${esc(translateEvent(e.summary, lang))}</p><p class="cal-meta">${meta.join(" &middot; ")}</p></div>
      </li>`;
    }
    body += `</ul></section>`;
  } else {
    body = `<p class="none">${T(lang, "No upcoming events are posted right now — subscribe below and they'll appear as the district adds them.", "No hay eventos próximos publicados por ahora; suscríbete abajo y aparecerán conforme el distrito los agregue.")}</p>`;
  }
  const title = T(lang, "Crosby ISD School Calendar", "Calendario escolar de Crosby ISD");
  const desc = T(lang, "Upcoming Crosby ISD school calendar events — first day of school, holidays, no-school and early-release days, testing windows, and campus activities — plus one-tap subscribe links. Source: Crosby ISD.", "Próximos eventos del calendario escolar de Crosby ISD: primer día de clases, días festivos, días sin clases y de salida temprana, exámenes y actividades de los planteles, además de enlaces de suscripción con un toque. Fuente: Crosby ISD.");
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${T(lang, "Upcoming Crosby ISD events plus one-tap calendar subscribe links.", "Próximos eventos de Crosby ISD y enlaces de suscripción con un toque.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/calendar", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/calendar", lang)}">
${hreflangTags("/calendar")}
${JSONLD_SITE}
${jsonldEvents(events, lang)}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .cal-month { margin-top:1.4rem; }
  .cal-month h2 { margin:0 0 0.5rem; font-size:1.05rem; }
  .cal-list { list-style:none; padding:0; margin:0; }
  .cal-item { display:flex; gap:0.85rem; align-items:flex-start; background:var(--card); border-radius:10px; padding:0.6rem 0.9rem; margin-bottom:0.5rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .cal-date { flex:0 0 auto; text-align:center; min-width:3rem; }
  .cal-dow { display:block; font-size:0.68rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); }
  .cal-day { display:block; font-size:1.45rem; font-weight:800; color:var(--accent); line-height:1.05; }
  .cal-body { flex:1; min-width:0; }
  .cal-title { margin:0; font-weight:600; }
  .cal-meta { margin:0.15rem 0 0; font-size:0.82rem; color:var(--muted); }
  .subscribe { background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; margin-top:1.6rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .subscribe h2 { margin:0 0 0.4rem; font-size:1.1rem; }
  .subscribe p { margin:0.45rem 0; }
  .sub-btns { display:flex; flex-wrap:wrap; gap:0.5rem; margin:0.6rem 0; }
  .sub-btn { display:inline-block; background:var(--accent); color:#fff; text-decoration:none; padding:0.45rem 0.85rem; border-radius:8px; font-weight:600; font-size:0.9rem; }
  .sub-btn.alt { background:transparent; color:var(--accent); border:1px solid var(--accent); }
  .cal-note { font-size:0.88rem; color:var(--muted); }
  .campus-list { display:flex; flex-wrap:wrap; gap:0.35rem 0.9rem; padding:0; margin:0.3rem 0 0; list-style:none; font-size:0.9rem; }
  .campus-list a { color:var(--accent); }
  .disclaimer { margin-top:1.4rem; font-size:0.8rem; color:var(--muted); border-top:1px solid var(--line); padding-top:0.7rem; }
</style>
</head>
<body>
${topbar("/calendar", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="intro">${T(lang, "Upcoming events from the Crosby Independent School District calendar — first day of school, holidays, early-release and no-school days, testing, and campus activities.", "Próximos eventos del calendario del Distrito Escolar Independiente de Crosby: primer día de clases, días festivos, días de salida temprana y sin clases, exámenes y actividades de los planteles.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${esc(fullTime(data.updated, lang))} CT.` : ""}</p>
  ${body}
  ${calendarSubscribe(lang)}
  <p class="disclaimer">${T(lang, `crosbynews.com isn't affiliated with Crosby ISD. Events are pulled from the district's public calendar feed (<a href="${CISD_SITE}">crosbyisd.org</a>); event titles are shown in the district's original English. Always confirm dates with the district.`, `crosbynews.com no está afiliado a Crosby ISD. Los eventos provienen del calendario público del distrito (<a href="${CISD_SITE}">crosbyisd.org</a>); los títulos de los eventos se muestran en el inglés original del distrito. Confirma siempre las fechas con el distrito.`)}</p>
  <p class="intro"><a href="${lang === "es" ? "/es/weather" : "/weather"}">&larr; ${T(lang, "Back to the forecast", "Volver al pronóstico")}</a></p>
</main>
${footer({ page: "/calendar", lang, source: T(lang, `Calendar data from <a href="${CISD_SITE}">Crosby ISD</a>.`, `Datos del calendario de <a href="${CISD_SITE}">Crosby ISD</a>.`) })}
</body>
</html>`;
}

function calendarMarkdown(data, lang) {
  const events = upcomingEvents(data.events ?? []);
  const out = [
    `# ${T(lang, "Crosby ISD School Calendar", "Calendario escolar de Crosby ISD")}`,
    "",
    `_${T(lang, "Upcoming Crosby ISD events. Source: Crosby ISD.", "Próximos eventos de Crosby ISD. Fuente: Crosby ISD.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${fullTime(data.updated, lang)} CT.` : ""}_`,
    "",
  ];
  if (events.length) {
    let curMonth = "";
    for (const e of events) {
      const month = calMonth(e.start, lang);
      if (month !== curMonth) {
        curMonth = month;
        out.push("", `## ${month.charAt(0).toUpperCase() + month.slice(1)}`, "");
      }
      const when = `${calDow(e.start, lang)} ${calDayNum(e.start)}` + (e.allDay ? ` (${T(lang, "all day", "todo el día")})` : ` ${calTime(e.start, lang)}`);
      const loc = e.location ? ` — ${e.location}` : "";
      out.push(`- **${when}** ${translateEvent(e.summary, lang)}${loc}`);
    }
  } else {
    out.push(T(lang, "No upcoming events are posted right now.", "No hay eventos próximos publicados por ahora."));
  }
  out.push(
    "",
    `## ${T(lang, "Subscribe", "Suscríbete")}`,
    "",
    `- ${T(lang, "All events (one tap)", "Todos los eventos (un toque)")}: ${CISD_FEED_ALL_WEBCAL}`,
    `- ${T(lang, "All events (.ics)", "Todos los eventos (.ics)")}: ${CISD_FEED_ALL_ICS}`,
    `- ${T(lang, "District calendar", "Calendario del Distrito")}: ${campusWebcal(350)}`,
    "",
    "---",
    `${T(lang, "Calendar data from Crosby ISD", "Datos del calendario de Crosby ISD")} (${CISD_SITE}) · [crosbynews.com](${canonicalFor("/", lang)})`
  );
  return out.join("\n");
}
// --- end Crosby ISD school calendar ---------------------------------------

// --- Water levels (NWPS river/bayou gauges, cron-owned KV) ----------------
// Crosby's defining hazard is flooding. This renders live stage + flood-
// category for the waters that flood Crosby / NE Harris County, from NOAA/NWS
// National Water Prediction Service (water.noaa.gov) — the same agency family
// as the NWS weather we already serve, so attribution stays consistent and no
// API key is needed. The Worker CAN reach NWPS, so this uses the cron + KV
// pattern (key "water", cron-owned, refreshed every 15 min since levels move
// fast in a flood), like weather/calendar. NWPS gives observed stage, flow, and
// the flood-category THRESHOLDS all keyed to the same gauge datum, so the
// current reading and the thresholds are directly comparable (never mixed
// across datums). NWPS's own `floodCategory` is used verbatim for the badge —
// we don't invent classifications on a life-safety page.
const WATER_KV_KEY = "water";
// The Crosby-core gauges (NWPS location IDs), the waters that actually flood
// Crosby and the surrounding NE Harris County / San Jacinto corridor.
const WATER_GAUGES = [
  { lid: "HCDT2", en: "Cedar Bayou near Crosby", es: "Cedar Bayou cerca de Crosby" },
  { lid: "SHLT2", en: "San Jacinto River near Sheldon", es: "Río San Jacinto cerca de Sheldon" },
  { lid: "HSJT2", en: "San Jacinto River at Lake Houston", es: "Río San Jacinto en Lake Houston" },
  { lid: "HFFT2", en: "Luce Bayou near Huffman", es: "Luce Bayou cerca de Huffman" },
  { lid: "GMKT2", en: "Goose Creek near McNair", es: "Goose Creek cerca de McNair" },
  { lid: "NCET2", en: "East Fork San Jacinto River near New Caney", es: "Bifurcación Este del Río San Jacinto cerca de New Caney" },
];
const nwpsGaugeUrl = (lid) => `https://water.noaa.gov/gauges/${lid}`;

// NWPS uses -9999 (undefined threshold) and -999 (no current forecast) as
// sentinels; treat anything that low as "not a real reading".
const waterNum = (v) => (typeof v === "number" && v > -900 ? v : null);

// NWPS floodCategory -> display label. Order low→high for context math.
const WATER_CAT_ORDER = ["no_flooding", "action", "minor", "moderate", "major"];
function waterCatLabel(cat, lang) {
  return (
    {
      no_flooding: T(lang, "Normal", "Normal"),
      action: T(lang, "Action stage", "Etapa de acción"),
      minor: T(lang, "Minor flooding", "Inundación menor"),
      moderate: T(lang, "Moderate flooding", "Inundación moderada"),
      major: T(lang, "Major flooding", "Inundación mayor"),
    }[cat] || T(lang, "Level unavailable", "Nivel no disponible")
  );
}
const waterCatClass = (cat) =>
  ({ no_flooding: "w-normal", action: "w-action", minor: "w-minor", moderate: "w-moderate", major: "w-major" }[cat] || "w-unknown");
// Only real NWS flood categories count as "elevated" for the top status panel.
const WATER_FLOOD_CATS = ["action", "minor", "moderate", "major"];
// Display state per gauge: a real NWS flood category (colored), a neutral
// "monitored" level when the gauge reports a stage but NWS defines no flood
// categories for it (e.g. the Lake Houston reservoir gauge, category
// "not_defined"), or "unavailable" when the gauge is offline. Never invents a
// classification NWS didn't publish.
function waterState(g, lang) {
  if (g.stage == null) return { cls: "w-unknown", label: T(lang, "Unavailable", "No disponible") };
  if (g.category === "no_flooding" || WATER_FLOOD_CATS.includes(g.category))
    return { cls: waterCatClass(g.category), label: waterCatLabel(g.category, lang) };
  return { cls: "w-monitored", label: T(lang, "Monitored", "Monitoreado") };
}

// Fetch each gauge, extract a compact record. Per-gauge try/catch so one bad
// gauge never sinks the batch; throw only if EVERY gauge failed, so the cron
// aborts-without-writing on a total NWPS outage and the last snapshot survives.
async function fetchWater() {
  const results = await Promise.all(
    WATER_GAUGES.map(async (g) => {
      try {
        const res = await fetch(`https://api.water.noaa.gov/nwps/v1/gauges/${g.lid}`, {
          headers: { "User-Agent": "crosbynews.com", Accept: "application/json" },
        });
        if (!res.ok) return null;
        const d = await res.json();
        const obs = d.status?.observed ?? {};
        const cats = d.flood?.categories ?? {};
        const thresholds = {};
        for (const k of ["action", "minor", "moderate", "major"]) {
          const s = waterNum(cats[k]?.stage);
          if (s != null) thresholds[k] = s;
        }
        return {
          lid: g.lid,
          name: d.name || g.en,
          usgsId: d.usgsId || null,
          stage: waterNum(obs.primary),
          stageUnit: obs.primaryUnit || "ft",
          flow: waterNum(obs.secondary), // kcfs
          category: obs.floodCategory || "unknown",
          validTime: obs.validTime || null,
          thresholds,
        };
      } catch {
        return null;
      }
    })
  );
  const gauges = results.filter(Boolean);
  if (!gauges.length) throw new Error("NWPS: all gauge fetches failed");
  return { updated: new Date().toISOString(), gauges };
}

// Read the cached water levels, self-healing on a cold/malformed entry (the
// cron keeps it fresh; this mirrors loadCalendar).
async function loadWater(env) {
  let data = null;
  try {
    data = await env.WEATHER.get(WATER_KV_KEY, "json");
  } catch (e) {
    console.error("KV water parse failed:", e && e.stack);
  }
  if (!data || !Array.isArray(data.gauges)) {
    try {
      data = await fetchWater();
      await env.WEATHER.put(WATER_KV_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("water cold fetch failed:", e && e.stack);
      data = { updated: null, gauges: [] };
    }
  }
  return data;
}

// Discharge for display: NWPS gives kcfs; cfs reads better for these waters.
const waterFlowCfs = (flowKcfs) => (flowKcfs == null ? null : Math.round(flowKcfs * 1000));

// A short, safe context line. Only the reassuring "below action" headroom in
// the normal case (action defined + stage below it); flooding states let the
// badge speak for itself rather than compute anything fragile.
function waterContext(g, lang) {
  if (g.stage == null) return T(lang, "Reading temporarily unavailable", "Lectura no disponible temporalmente");
  const action = g.thresholds.action;
  if (g.category === "no_flooding" && typeof action === "number" && g.stage < action) {
    return T(
      lang,
      `${(action - g.stage).toFixed(1)} ft below action stage`,
      `${(action - g.stage).toFixed(1)} ft por debajo de la etapa de acción`
    );
  }
  return "";
}

function waterThresholdLine(g, lang) {
  const parts = [];
  for (const k of ["action", "minor", "moderate", "major"]) {
    if (typeof g.thresholds[k] === "number") parts.push(`${waterCatLabel(k, lang)} ${g.thresholds[k]} ft`);
  }
  return parts.join(" &middot; ");
}

function waterHtml(data, lang) {
  const gauges = data.gauges ?? [];
  const anyFlooding = gauges.some((g) => WATER_FLOOD_CATS.includes(g.category));
  const cards = gauges
    .map((g) => {
      const cfs = waterFlowCfs(g.flow);
      const ctx = waterContext(g, lang);
      const th = waterThresholdLine(g, lang);
      const st = waterState(g, lang);
      return `      <article class="gauge ${st.cls}">
        <div class="gauge-head">
          <h2><a href="${nwpsGaugeUrl(g.lid)}" target="_blank" rel="noopener">${esc(T(lang, g.name, (WATER_GAUGES.find((x) => x.lid === g.lid) || {}).es || g.name))}</a></h2>
          <span class="gauge-badge">${esc(st.label)}</span>
        </div>
        <p class="gauge-stage">${g.stage != null ? `${esc(g.stage)}<span class="u"> ft</span>` : "&ndash;"}${cfs != null ? ` <span class="gauge-flow">&middot; ${esc(cfs.toLocaleString(lang === "es" ? "es-MX" : "en-US"))} ${T(lang, "cfs", "pie³/s")}</span>` : ""}</p>
        <p class="gauge-meta">${ctx ? `${esc(ctx)} &middot; ` : ""}${g.validTime ? `${T(lang, "as of", "a las")} ${esc(clockTime(g.validTime, lang))} CT` : ""}</p>
        ${th ? `<p class="gauge-th">${th}</p>` : ""}
      </article>`;
    })
    .join("\n");

  const title = T(lang, "Crosby, TX Water Levels", "Niveles de agua de Crosby, TX");
  const desc = T(
    lang,
    "Live river and bayou levels with National Weather Service flood stages for Crosby, TX and the northeast Harris County / San Jacinto corridor — Cedar Bayou, the San Jacinto River, Luce Bayou and more.",
    "Niveles de ríos y arroyos en vivo con las etapas de inundación del Servicio Meteorológico Nacional para Crosby, TX y el corredor del noreste del condado de Harris / San Jacinto: Cedar Bayou, el río San Jacinto, Luce Bayou y más."
  );
  const status = gauges.length
    ? anyFlooding
      ? `<div class="status status-alert" role="status"><span class="status-icon">&#9888;</span><div><p class="status-title">${T(lang, "Elevated water levels", "Niveles de agua elevados")}</p><p class="status-sub">${T(lang, "One or more gauges are at or above flood stage &mdash; see below and follow official guidance.", "Uno o más medidores están en etapa de inundación o por encima &mdash; ver abajo y seguir la guía oficial.")}</p></div></div>`
      : `<div class="status status-ok" role="status"><span class="status-icon">&#10004;</span><div><p class="status-title">${T(lang, "All gauges normal", "Todos los medidores normales")}</p><p class="status-sub">${T(lang, "No area gauges are at flood stage right now. Levels refresh every 15 minutes.", "Ningún medidor del área está en etapa de inundación ahora. Los niveles se actualizan cada 15 minutos.")}</p></div></div>`
    : `<p class="none">${T(lang, "Water level data is temporarily unavailable.", "Los datos de nivel de agua no están disponibles temporalmente.")}</p>`;

  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${T(lang, "Live river and bayou levels with NWS flood stages for the Crosby, TX area.", "Niveles de ríos y arroyos en vivo con las etapas de inundación del NWS para la zona de Crosby, TX.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/water", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/water", lang)}">
${hreflangTags("/water")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .status { display:flex; align-items:center; gap:1rem; border-radius:16px; padding:1.2rem 1.4rem; margin-top:0.8rem; color:#fff; }
  .status-icon { font-size:2.4rem; line-height:1; flex:none; }
  .status-title { margin:0; font-size:1.5rem; font-weight:800; line-height:1.1; }
  .status-sub { margin:0.35rem 0 0; font-size:0.98rem; opacity:0.95; }
  .status-ok { background:linear-gradient(135deg,#1f8b4c,#2eb86a); }
  .status-alert { background:linear-gradient(135deg,#a3271b,#d44230); }
  .gauges { display:grid; gap:0.7rem; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); margin-top:1rem; }
  .gauge { background:var(--card); border-radius:12px; padding:0.85rem 1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); border-left:5px solid var(--muted); }
  .gauge-head { display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem; }
  .gauge-head h2 { margin:0; font-size:1rem; }
  .gauge-head a { color:var(--ink); text-decoration:none; }
  .gauge-head a:hover { text-decoration:underline; }
  .gauge-badge { flex:none; font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; padding:0.15rem 0.5rem; border-radius:999px; color:#fff; background:var(--muted); white-space:nowrap; }
  .gauge-stage { margin:0.5rem 0 0; font-size:1.9rem; font-weight:800; line-height:1; }
  .gauge-stage .u { font-size:0.9rem; font-weight:600; opacity:0.7; }
  .gauge-flow { font-size:0.85rem; font-weight:600; color:var(--muted); }
  .gauge-meta { margin:0.3rem 0 0; font-size:0.82rem; color:var(--muted); }
  .gauge-th { margin:0.4rem 0 0; font-size:0.78rem; color:var(--muted); }
  .w-normal { border-left-color:#2eb86a; } .w-normal .gauge-badge { background:#1f8b4c; }
  .w-action { border-left-color:#e0a800; } .w-action .gauge-badge { background:#b8860b; }
  .w-minor { border-left-color:#e8720c; } .w-minor .gauge-badge { background:#c85a08; }
  .w-moderate { border-left-color:#d44230; } .w-moderate .gauge-badge { background:#b5301f; }
  .w-major { border-left-color:#8e2ec2; } .w-major .gauge-badge { background:#6f1fa0; }
  .w-monitored { border-left-color:var(--accent); } .w-monitored .gauge-badge { background:var(--accent); }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .safety { margin-top:1.4rem; font-size:0.85rem; color:var(--muted); border-top:1px solid var(--line); padding-top:0.8rem; }
</style>
</head>
<body>
${topbar("/water", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="intro">${T(lang, "Current water levels for the rivers and bayous that flood Crosby and northeast Harris County, with each gauge's National Weather Service flood stages. Readings and flood stages both come from the same NWS gauge, so they're directly comparable.", "Niveles de agua actuales de los ríos y arroyos que inundan Crosby y el noreste del condado de Harris, con las etapas de inundación del Servicio Meteorológico Nacional de cada medidor. Las lecturas y las etapas de inundación provienen del mismo medidor del NWS, por lo que son directamente comparables.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${esc(fullTime(data.updated, lang))} CT.` : ""}</p>
  ${status}
  <div class="gauges">
${cards}
  </div>
  <p class="safety">${T(lang, "In a flood emergency call 911. Never drive or walk into floodwater &mdash; turn around, don't drown. This page mirrors official NWS data for convenience; the authoritative source for each gauge is linked in its title, and warnings appear on the <a href=\"/alerts\">alerts page</a>.", "En una emergencia por inundación llama al 911. Nunca conduzcas ni camines hacia el agua de inundación &mdash; da la vuelta, no te arriesgues. Esta página refleja datos oficiales del NWS por comodidad; la fuente autorizada de cada medidor está enlazada en su título, y los avisos aparecen en la <a href=\"/es/alerts\">página de alertas</a>.")}</p>
  <p class="intro"><a href="${lang === "es" ? "/es/weather" : "/weather"}">&larr; ${T(lang, "Back to the forecast", "Volver al pronóstico")}</a> &middot; <a href="${lang === "es" ? "/es/radar" : "/radar"}">Radar</a></p>
</main>
${footer({ page: "/water", lang, source: T(lang, `Water data from the NOAA/NWS <a href="https://water.noaa.gov">National Water Prediction Service</a>.`, `Datos de agua del <a href="https://water.noaa.gov">Servicio Nacional de Predicción de Agua</a> de NOAA/NWS.`) })}
</body>
</html>`;
}

function waterMarkdown(data, lang) {
  const gauges = data.gauges ?? [];
  const out = [
    `# ${T(lang, "Crosby, TX Water Levels", "Niveles de agua de Crosby, TX")}`,
    "",
    `_${T(lang, "Live river and bayou levels with NWS flood stages for the Crosby, TX area.", "Niveles de ríos y arroyos en vivo con las etapas de inundación del NWS para la zona de Crosby, TX.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${fullTime(data.updated, lang)} CT.` : ""}_`,
    "",
  ];
  if (gauges.length) {
    for (const g of gauges) {
      const cfs = waterFlowCfs(g.flow);
      out.push(`## ${T(lang, g.name, (WATER_GAUGES.find((x) => x.lid === g.lid) || {}).es || g.name)}`);
      out.push(
        `- **${waterState(g, lang).label}**${g.stage != null ? ` — ${g.stage} ft` : ""}${cfs != null ? `, ${cfs.toLocaleString(lang === "es" ? "es-MX" : "en-US")} ${T(lang, "cfs", "pie³/s")}` : ""}${g.validTime ? ` (${T(lang, "as of", "a las")} ${clockTime(g.validTime, lang)} CT)` : ""}`
      );
      const th = ["action", "minor", "moderate", "major"]
        .filter((k) => typeof g.thresholds[k] === "number")
        .map((k) => `${waterCatLabel(k, lang)} ${g.thresholds[k]} ft`)
        .join(", ");
      if (th) out.push(`- ${T(lang, "Flood stages", "Etapas de inundación")}: ${th}`);
      out.push(`- ${T(lang, "Official gauge", "Medidor oficial")}: ${nwpsGaugeUrl(g.lid)}`, "");
    }
  } else {
    out.push(T(lang, "Water level data is temporarily unavailable.", "Los datos de nivel de agua no están disponibles temporalmente."));
  }
  out.push(
    "---",
    `${T(lang, "In a flood emergency call 911. Never drive into floodwater.", "En una emergencia por inundación llama al 911. Nunca conduzcas hacia el agua de inundación.")} ${T(lang, "Data from the NOAA/NWS National Water Prediction Service.", "Datos del Servicio Nacional de Predicción de Agua de NOAA/NWS.")} · [crosbynews.com](${canonicalFor("/", lang)})`
  );
  return out.join("\n");
}

// JSON shape served at /api/water — the same NWPS data behind /water.
function apiWater(data) {
  return {
    location: "Crosby, TX area (northeast Harris County / San Jacinto corridor)",
    source: "NOAA/NWS National Water Prediction Service (water.noaa.gov)",
    updated: data.updated ?? null,
    gauges: (data.gauges ?? []).map((g) => ({
      id: g.lid,
      name: g.name,
      usgsId: g.usgsId,
      stage: g.stage,
      stageUnit: g.stageUnit || "ft",
      flow: waterFlowCfs(g.flow),
      flowUnit: "cfs",
      category: g.category,
      validTime: g.validTime,
      thresholds: g.thresholds,
      thresholdUnit: "ft",
      officialUrl: nwpsGaugeUrl(g.lid),
    })),
  };
}
// --- end Water levels -----------------------------------------------------

// --- Tropical outlook (NOAA NHC) --------------------------------------------
// Cron + KV pattern like water/calendar: the cron refreshes the `tropics` key
// (throttled ~hourly — NHC advisories update every 2-6h) from NHC's
// CurrentStorms.json, filtered to the Atlantic basin (storm ids "al..." —
// East/Central Pacific storms don't threaten Crosby). The /tropics page and
// the homepage strip self-hide when nothing is active, which is most of the
// year. Worker reachability to www.nhc.noaa.gov was canary-verified from the
// deployed Worker runtime before this shipped (200, real body).
const TROPICS_KV_KEY = "tropics";

// NHC classification codes → bilingual labels. Hand dictionary with English
// fallback, same deterministic-translation policy as NWS text elsewhere.
const NHC_CLASS = {
  TD: ["Tropical Depression", "Depresión tropical"],
  TS: ["Tropical Storm", "Tormenta tropical"],
  HU: ["Hurricane", "Huracán"],
  MH: ["Major Hurricane", "Huracán mayor"],
  STD: ["Subtropical Depression", "Depresión subtropical"],
  STS: ["Subtropical Storm", "Tormenta subtropical"],
  PTC: ["Potential Tropical Cyclone", "Posible ciclón tropical"],
  PC: ["Post-tropical Cyclone", "Ciclón postropical"],
  RL: ["Remnant Low", "Baja remanente"],
};
function tropicsClassLabel(code, lang) {
  const pair = NHC_CLASS[String(code || "").toUpperCase()];
  return pair ? T(lang, pair[0], pair[1]) : String(code || "").toUpperCase() || T(lang, "System", "Sistema");
}

// NHC's CurrentStorms.json reports intensity in KNOTS; advisories quote mph
// rounded to 5, so match that. (movementSpeed's unit isn't clearly documented,
// so we show movement direction only — never guess a unit.)
const ktToMph = (kt) => (Number.isFinite(Number(kt)) ? Math.round((Number(kt) * 1.15078) / 5) * 5 : null);
function degToCompass(deg) {
  const d = Number(deg);
  if (!Number.isFinite(d)) return null;
  const pts = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return pts[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];
}

// Fetch active Atlantic systems. Throws on failure so the cron
// aborts-without-writing and the last snapshot survives (the water pattern).
// An empty storms array is a normal, meaningful result — quiet basin.
async function fetchTropics() {
  const res = await fetch("https://www.nhc.noaa.gov/CurrentStorms.json", {
    headers: { "User-Agent": "crosbynews.com", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`NHC request failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  const storms = (json.activeStorms ?? [])
    .filter((s) => String(s.id || "").toLowerCase().startsWith("al"))
    .map((s) => ({
      id: s.id,
      name: s.name,
      classification: String(s.classification || "").toUpperCase(),
      intensityKt: Number.isFinite(Number(s.intensity)) ? Number(s.intensity) : null,
      pressureMb: Number.isFinite(Number(s.pressure)) ? Number(s.pressure) : null,
      lat: typeof s.latitudeNumeric === "number" ? s.latitudeNumeric : null,
      lon: typeof s.longitudeNumeric === "number" ? s.longitudeNumeric : null,
      movementDeg: Number.isFinite(Number(s.movementDir)) ? Number(s.movementDir) : null,
      lastUpdate: s.lastUpdate || null,
      advisoryUrl: s.publicAdvisory?.url || "https://www.nhc.noaa.gov/",
    }));
  return { updated: new Date().toISOString(), storms };
}

// Read the cached outlook, self-healing on a cold/malformed entry and
// degrading to an empty shape on total failure (mirrors loadWater).
async function loadTropics(env) {
  let data = null;
  try {
    data = await env.WEATHER.get(TROPICS_KV_KEY, "json");
  } catch (e) {
    console.error("KV tropics parse failed:", e && e.stack);
  }
  if (!data || !Array.isArray(data.storms)) {
    try {
      data = await fetchTropics();
      await env.WEATHER.put(TROPICS_KV_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("tropics cold fetch failed:", e && e.stack);
      data = { updated: null, storms: [] };
    }
  }
  return data;
}

// One-line storm description shared by the page, the hub strip, and markdown:
// "Hurricane Nadine — 105 mph".
function tropicsStormLine(s, lang) {
  const mph = ktToMph(s.intensityKt);
  return `${tropicsClassLabel(s.classification, lang)} ${s.name}${mph != null ? ` — ${mph} mph` : ""}`;
}

function tropicsHtml(data, lang) {
  const storms = data.storms ?? [];
  const title = T(lang, "Atlantic Tropical Weather", "Tiempo tropical del Atlántico");
  const desc = T(
    lang,
    "Active Atlantic tropical storms and hurricanes from the National Hurricane Center, plus what hurricane season means for Crosby, TX. Quiet-basin friendly: shows nothing scary when nothing is happening.",
    "Tormentas tropicales y huracanes activos del Atlántico según el Centro Nacional de Huracanes, y qué significa la temporada de huracanes para Crosby, TX."
  );
  const cards = storms
    .map((s) => {
      const mph = ktToMph(s.intensityKt);
      const compass = degToCompass(s.movementDeg);
      const rows = [];
      if (mph != null) rows.push(`<li><span class="pk-label">${T(lang, "Max sustained winds", "Vientos máximos sostenidos")}</span><span class="pk-val">${mph} mph</span></li>`);
      if (s.pressureMb != null) rows.push(`<li><span class="pk-label">${T(lang, "Central pressure", "Presión central")}</span><span class="pk-val">${esc(s.pressureMb)} mb</span></li>`);
      if (s.lat != null && s.lon != null) rows.push(`<li><span class="pk-label">${T(lang, "Position", "Posición")}</span><span class="pk-val">${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? "N" : "S"}, ${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? "E" : "W"}</span></li>`);
      if (compass) rows.push(`<li><span class="pk-label">${T(lang, "Moving", "Movimiento")}</span><span class="pk-val">${translateDir(compass, lang)}</span></li>`);
      return `      <article class="storm">
        <div class="storm-head">
          <h2>&#127744; ${esc(tropicsClassLabel(s.classification, lang))} ${esc(s.name)}</h2>
        </div>
        <ul class="peek">${rows.join("")}</ul>
        <p class="storm-meta">${s.lastUpdate ? `${T(lang, "NHC update", "Actualización del NHC")}: ${esc(fullTime(s.lastUpdate, lang))} CT &middot; ` : ""}<a href="${esc(s.advisoryUrl)}" target="_blank" rel="noopener">${T(lang, "Official NHC advisory", "Aviso oficial del NHC")}</a></p>
      </article>`;
    })
    .join("\n");

  const status = storms.length
    ? `<div class="status status-storm" role="status"><span class="status-icon">&#127744;</span><div><p class="status-title">${storms.length === 1 ? esc(tropicsStormLine(storms[0], lang)) : T(lang, `${storms.length} active systems in the Atlantic`, `${storms.length} sistemas activos en el Atlántico`)}</p><p class="status-sub">${T(lang, "Details below. For what it means locally, watch official guidance and the alerts page.", "Detalles abajo. Para saber qué significa localmente, sigue la guía oficial y la página de alertas.")}</p></div></div>`
    : `<div class="status status-ok" role="status"><span class="status-icon">&#10004;</span><div><p class="status-title">${T(lang, "Nothing active in the Atlantic", "Nada activo en el Atlántico")}</p><p class="status-sub">${T(lang, "The National Hurricane Center is tracking no active tropical systems in the Atlantic basin right now. This page rechecks about every hour.", "El Centro Nacional de Huracanes no está siguiendo ningún sistema tropical activo en la cuenca del Atlántico en este momento. Esta página se actualiza aproximadamente cada hora.")}</p></div></div>`;

  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} &mdash; Crosby, TX &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/tropics", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/tropics", lang)}">
${hreflangTags("/tropics")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .status { display:flex; align-items:center; gap:1rem; border-radius:16px; padding:1.2rem 1.4rem; margin-top:0.8rem; color:#fff; }
  .status-icon { font-size:2.4rem; line-height:1; flex:none; }
  .status-title { margin:0; font-size:1.5rem; font-weight:800; line-height:1.1; }
  .status-sub { margin:0.35rem 0 0; font-size:0.98rem; opacity:0.95; }
  .status-ok { background:linear-gradient(135deg,#1f8b4c,#2eb86a); }
  .status-storm { background:linear-gradient(135deg,#6f1fa0,#8e2ec2); }
  .storms { display:grid; gap:0.7rem; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); margin-top:1rem; }
  .storm { background:var(--card); border-radius:12px; padding:0.85rem 1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); border-left:5px solid #8e2ec2; }
  .storm-head h2 { margin:0 0 0.4rem; font-size:1.05rem; }
  .storm-meta { margin:0.5rem 0 0; font-size:0.82rem; color:var(--muted); }
  .peek { list-style:none; margin:0; padding:0; }
  .peek li { display:flex; justify-content:space-between; gap:0.6rem; padding:0.28rem 0; border-bottom:1px solid var(--line); font-size:0.9rem; }
  .peek li:last-child { border-bottom:none; }
  .pk-label { color:var(--muted); flex:none; }
  .pk-val { text-align:right; }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .guide { margin-top:1.6rem; }
  .guide h2 { font-size:1.15rem; }
  .guide p { font-size:0.95rem; line-height:1.55; }
  .guide .links { margin:0.5rem 0 0; padding-left:1.1rem; }
  .guide .links li { margin:0.3rem 0; font-size:0.92rem; }
</style>
</head>
<body>
${topbar("/tropics", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="intro">${T(lang, "Active Atlantic tropical systems from the National Hurricane Center, checked about every hour. Storm advisories and names stay in NHC's official English.", "Sistemas tropicales activos del Atlántico según el Centro Nacional de Huracanes, consultados aproximadamente cada hora. Los avisos y nombres de tormentas se muestran en el inglés oficial del NHC.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${esc(fullTime(data.updated, lang))} CT.` : ""}</p>
  ${status}
  ${storms.length ? `<div class="storms">\n${cards}\n  </div>` : ""}
  <section class="guide" data-nosnippet>
    <h2>${T(lang, "Hurricane season and Crosby", "La temporada de huracanes y Crosby")}</h2>
    <p>${T(
      lang,
      "Atlantic hurricane season runs June 1 through November 30, peaking mid-August to mid-October. Crosby sits about 35 miles inland — far enough that storm surge isn't the local threat, close enough that hurricanes still hit hard here. The dangers that reach Crosby are inland rain flooding (Harvey in 2017 flooded homes along the San Jacinto and Cedar Bayou), damaging wind, tornadoes spun off by landfalling storms, and days-long power outages.",
      "La temporada de huracanes del Atlántico va del 1 de junio al 30 de noviembre, con su pico de mediados de agosto a mediados de octubre. Crosby está a unas 35 millas tierra adentro — lo suficientemente lejos para que la marejada no sea la amenaza local, y lo suficientemente cerca para que los huracanes golpeen fuerte aquí. Los peligros que llegan a Crosby son la inundación por lluvia (Harvey en 2017 inundó casas a lo largo del San Jacinto y Cedar Bayou), el viento dañino, los tornados que generan las tormentas al tocar tierra y los apagones de varios días."
    )}</p>
    <p>${T(
      lang,
      "A watch means conditions are possible within 48 hours — finish preparations. A warning means they're expected within 36 hours — preparations should be done and it's time to follow official instructions. When a storm threatens the Texas coast, local watches and warnings for Crosby appear on the alerts page, and river levels are on the water page.",
      "Una vigilancia (watch) significa que las condiciones son posibles dentro de 48 horas — termina los preparativos. Un aviso (warning) significa que se esperan dentro de 36 horas — los preparativos deben estar listos y toca seguir las instrucciones oficiales. Cuando una tormenta amenaza la costa de Texas, las vigilancias y avisos locales para Crosby aparecen en la página de alertas, y los niveles de los ríos en la página de agua."
    )}</p>
    <ul class="links">
      <li><a href="https://www.nhc.noaa.gov/">${T(lang, "National Hurricane Center", "Centro Nacional de Huracanes")}</a> &mdash; ${T(lang, "the official source: outlooks, forecast cones, advisories", "la fuente oficial: pronósticos, conos y avisos")}</li>
      <li><a href="${lang === "es" ? "/es/alerts" : "/alerts"}">${T(lang, "Crosby alerts", "Alertas de Crosby")}</a> &mdash; ${T(lang, "local NWS watches and warnings when a storm approaches", "vigilancias y avisos locales del NWS cuando se acerca una tormenta")}</li>
      <li><a href="${lang === "es" ? "/es/water" : "/water"}">${T(lang, "Water levels", "Niveles de agua")}</a> &mdash; ${T(lang, "live river and bayou gauges during the rain", "medidores de ríos y arroyos en vivo durante la lluvia")}</li>
      <li><a href="${lang === "es" ? "/es/emergency" : "/emergency"}">${T(lang, "Emergency resources", "Recursos de emergencia")}</a> &mdash; ${T(lang, "numbers to save, outage reporting, shelters, evacuation-zone lookup", "números para guardar, reporte de apagones, refugios, zonas de evacuación")}</li>
    </ul>
  </section>
</main>
${footer({ page: "/tropics", lang, source: T(lang, `Tropical data from the NOAA <a href="https://www.nhc.noaa.gov/">National Hurricane Center</a>.`, `Datos tropicales del <a href="https://www.nhc.noaa.gov/">Centro Nacional de Huracanes</a> de NOAA.`) })}
</body>
</html>`;
}

function tropicsMarkdown(data, lang) {
  const storms = data.storms ?? [];
  const out = [
    `# ${T(lang, "Atlantic Tropical Weather", "Tiempo tropical del Atlántico")}`,
    "",
    `_${T(lang, "Active Atlantic systems from the NOAA National Hurricane Center.", "Sistemas activos del Atlántico según el Centro Nacional de Huracanes de NOAA.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${fullTime(data.updated, lang)} CT.` : ""}_`,
    "",
  ];
  if (storms.length) {
    for (const s of storms) {
      const mph = ktToMph(s.intensityKt);
      const compass = degToCompass(s.movementDeg);
      out.push(`## ${tropicsClassLabel(s.classification, lang)} ${s.name}`);
      if (mph != null) out.push(`- ${T(lang, "Max sustained winds", "Vientos máximos sostenidos")}: ${mph} mph`);
      if (s.pressureMb != null) out.push(`- ${T(lang, "Central pressure", "Presión central")}: ${s.pressureMb} mb`);
      if (s.lat != null && s.lon != null) out.push(`- ${T(lang, "Position", "Posición")}: ${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? "N" : "S"}, ${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? "E" : "W"}`);
      if (compass) out.push(`- ${T(lang, "Moving", "Movimiento")}: ${translateDir(compass, lang)}`);
      out.push(`- ${T(lang, "Official advisory", "Aviso oficial")}: ${s.advisoryUrl}`, "");
    }
  } else {
    out.push(T(lang, "Nothing active in the Atlantic basin right now. ✓", "Nada activo en la cuenca del Atlántico en este momento. ✓"), "");
  }
  out.push(
    `## ${T(lang, "Hurricane season and Crosby", "La temporada de huracanes y Crosby")}`,
    "",
    T(
      lang,
      "Season runs June 1 – November 30. Crosby's hurricane dangers are inland rain flooding, damaging wind, spin-off tornadoes, and extended power outages — not storm surge (we're ~35 miles inland). Watches mean possible within 48h; warnings mean expected within 36h.",
      "La temporada va del 1 de junio al 30 de noviembre. Los peligros para Crosby son la inundación por lluvia, el viento dañino, los tornados derivados y los apagones prolongados — no la marejada (estamos a ~35 millas tierra adentro). Una vigilancia significa posible en 48 h; un aviso, esperado en 36 h."
    ),
    "",
    "---",
    `${T(lang, "Source: NOAA National Hurricane Center (nhc.noaa.gov).", "Fuente: Centro Nacional de Huracanes de NOAA (nhc.noaa.gov).")} · [${T(lang, "Alerts", "Alertas")}](${canonicalFor("/alerts", lang)}) · [${T(lang, "Emergency resources", "Recursos de emergencia")}](${canonicalFor("/emergency", lang)}) · [crosbynews.com](${canonicalFor("/", lang)})`
  );
  return out.join("\n");
}
// --- end Tropical outlook ---------------------------------------------------

// Markdown rendering of the same data, served when an agent sends
// `Accept: text/markdown` (or ?format=md).
function renderMarkdown(data, lang) {
  const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\s*\n\s*/g, " ");
  const now = currentHourly(data);
  const lead = data.periods?.[0];
  const out = [];
  out.push(`# ${T(lang, `${data.place || "Crosby, TX"} Weather`, `Clima en ${data.place || "Crosby, TX"}`)}`, "");
  out.push(`_${T(lang, "Updated", "Actualizado")} ${fullTime(data.updated, lang)} CT — ${T(lang, "source: U.S. National Weather Service (weather.gov)", "fuente: Servicio Meteorológico Nacional de EE. UU. (weather.gov)")}_`, "");
  if (lang === "es") out.push("_Las condiciones se traducen al español; las descripciones detalladas y las alertas se muestran en inglés oficial del NWS._", "");

  if (now) {
    const feels = feelsLikeF(now);
    const sun = sunTimesForCtDate(Date.now());
    const uvNow = uvCurrent(data);
    const aqi = data.aqi;
    out.push(T(lang, "## Now", "## Ahora"));
    out.push(`**${now.temperature}°${now.temperatureUnit}** — ${translateConditions(now.shortForecast, lang)} (${T(lang, "as of", "a las")} ${clockTime(now.startTime, lang)} CT)${feels != null ? ` · ${T(lang, "feels like", "sensación térmica de")} ${feels}°` : ""}${pop(now) ? ` · ${pop(now)}% ${T(lang, "precip", "prob. lluvia")}` : ""}${uvNow ? ` · ${T(lang, "UV", "UV")} ${uvNow} (${uvCategory(uvNow, lang)})` : ""}${aqi?.usAqi != null ? ` · ${T(lang, "Air", "Aire")} ${aqi.usAqi} (${aqiCategory(aqi.usAqi, lang)}, ${T(lang, "modeled", "modelado")})` : ""}`, "");
    if (sun) out.push(`${T(lang, "Sunrise", "Amanecer")} ${clockTime(sun.sunrise, lang)} · ${T(lang, "Sunset", "Atardecer")} ${clockTime(sun.sunset, lang)} CT`, "");
  }
  if (lead) out.push(`**${translatePeriodName(lead.name, lang)}:** ${lead.detailedForecast}`, "");

  out.push(T(lang, "## Active alerts", "## Alertas activas"));
  const alerts = data.alerts ?? [];
  if (alerts.length) {
    for (const a of alerts) {
      out.push(`- **${a.event}**${a.headline ? ` — ${a.headline}` : ""}${a.expires ? ` (${T(lang, "until", "hasta")} ${fullTime(a.expires, lang)} CT)` : ""}`);
      if (a.instruction) out.push(`  - ${T(lang, "What to do:", "Qué hacer:")} ${cell(a.instruction)}`);
    }
  } else {
    out.push(T(lang, "None.", "Ninguna."));
  }
  out.push("");

  const hourly = (data.hourly ?? []).slice(0, 12);
  if (hourly.length) {
    out.push(T(lang, "## Next 12 hours", "## Próximas 12 horas"), T(lang, "| Time | Temp | Conditions | Precip |", "| Hora | Temp | Condiciones | Prob. |"), "| --- | --- | --- | --- |");
    for (const h of hourly) {
      out.push(`| ${cell(hourLabel(h.startTime, lang))} | ${h.temperature}°${h.temperatureUnit} | ${cell(translateConditions(h.shortForecast, lang))} | ${pop(h)}% |`);
    }
    out.push("");
  }

  out.push(T(lang, "## 7-day forecast", "## Pronóstico a 7 días"));
  for (const p of data.periods ?? []) {
    out.push(`### ${translatePeriodName(p.name, lang)}`);
    out.push(`${p.isDaytime ? T(lang, "High", "Máx.") : T(lang, "Low", "Mín.")} ${p.temperature}°${p.temperatureUnit} — ${translateConditions(p.shortForecast, lang)}. ${T(lang, "Wind", "Viento")} ${translateWind(p.windSpeed, lang)} ${translateDir(p.windDirection, lang)}.${pop(p) ? ` ${pop(p)}% ${T(lang, "precip.", "prob. lluvia.")}` : ""}`, "");
    out.push(p.detailedForecast, "");
  }

  out.push("---", `[crosbynews.com](${canonicalFor("/", lang)}) · ${T(lang, "data from the National Weather Service", "datos del Servicio Meteorológico Nacional")}`);
  return out.join("\n");
}

// Shared cache + discovery headers for the homepage in either representation.
// Homepage discovery headers: markdown alternate, sitemap, API catalog, and
// the OpenAPI service description (RFC 8288 Link relations).
function linkHeader(enPath, lang) {
  const alt = SITE + (lang === "es" ? esPath(enPath) : enPath);
  return (
    `<${alt}>; rel="alternate"; type="text/markdown", ` +
    `<${SITE}/sitemap.xml>; rel="sitemap", ` +
    `<${SITE}/.well-known/api-catalog>; rel="api-catalog", ` +
    `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`
  );
}

// Conditional GET for the machine-polled endpoints (API + feeds): a weak ETag
// derived from the cached data's freshness stamp, so a poller that already
// has the current snapshot gets a body-less 304. `seed` must change whenever
// the body would; `make` builds the body only on a miss. Last-Modified rides
// along when the stamp is a date (informational; only If-None-Match is
// evaluated, which is the header ETag-aware clients send).
function conditional(request, seed, make, headers) {
  const etag = `W/"${String(seed).replace(/"/g, "")}"`;
  const h = { ...headers, etag };
  const d = new Date(seed);
  if (!isNaN(d.getTime())) h["last-modified"] = d.toUTCString();
  const inm = request.headers.get("if-none-match");
  if (inm && (inm.trim() === "*" || inm.split(",").map((s) => s.trim()).includes(etag))) {
    return new Response(null, { status: 304, headers: h });
  }
  return new Response(make(), { headers: h });
}

// Shared loader: cached weather, refreshing on a missing or stale-shaped entry.
async function loadWeather(env) {
  let cache = "hit";
  let data = null;
  try {
    data = await env.WEATHER.get(KV_KEY, "json");
  } catch (e) {
    // Corrupt / non-JSON value in KV: treat as a miss and refetch below, the
    // same self-heal path as a stale-shaped entry. Writers always
    // JSON.stringify, so this is largely theoretical.
    console.error("KV weather parse failed:", e && e.stack);
  }
  if (!data || !Array.isArray(data.hourly)) {
    data = await fetchWeather();
    try {
      await env.WEATHER.put(KV_KEY, JSON.stringify(data));
      cache = "miss-warmed";
    } catch (e) {
      console.error("KV warm failed:", e && e.stack);
      cache = "miss-warmfail";
    }
  }
  return { data, cache };
}

// JSON shape served at /api/weather. `feelsLike` (heat index / wind chill)
// and `sun` (sunrise/sunset) are computed in-Worker, not NWS fields — added
// alongside the NWS data rather than replacing it, so they're additive and
// clearly derived.
function apiWeather(data) {
  const withFeels = (h) => ({ ...h, feelsLike: feelsLikeRawF(h) });
  const sun = sunTimesForCtDate(Date.now());
  return {
    location: data.place || "Crosby, TX",
    coordinates: { lat: LAT, lon: LON },
    source: "U.S. National Weather Service (api.weather.gov)",
    updated: data.updated ?? null,
    sun: sun ? { sunrise: new Date(sun.sunrise).toISOString(), sunset: new Date(sun.sunset).toISOString() } : null,
    // UV is EPA-sourced (not NWS), so it's a separate object — clearly labeled,
    // not folded into `current`. Null when the EPA fetch failed or the current
    // hour is outside the product's ~6am–8pm window.
    uv: (() => {
      const cur = uvCurrent(data), peak = uvPeakToday(data);
      return cur != null || peak != null
        ? { current: cur, currentCategory: uvCategory(cur), peakToday: peak, peakCategory: uvCategory(peak), source: "U.S. EPA (Envirofacts UV, ZIP 77532)" }
        : null;
    })(),
    // Air quality is MODELED (no monitor in Crosby), so it's a separate object
    // with an explicit `modeled: true` flag and a source note — never presented
    // as an official measurement. Null when the upstream fetch failed.
    airQuality: data.aqi?.usAqi != null
      ? {
          usAqi: data.aqi.usAqi,
          category: aqiCategory(data.aqi.usAqi),
          dominantPollutant: aqiDominantLabel(data.aqi.dominant),
          pm2_5: data.aqi.pm25,
          pm10: data.aqi.pm10,
          ozone: data.aqi.ozone,
          concentrationUnit: "µg/m³",
          modeled: true,
          source: "Open-Meteo (CAMS-based model); modeled forecast, not an official monitor reading",
        }
      : null,
    current: currentHourly(data) ? withFeels(currentHourly(data)) : null,
    hourly: (data.hourly ?? []).slice(0, 12).map(withFeels),
    forecast: data.periods ?? [],
    alerts: data.alerts ?? [],
  };
}

// /badge.svg — a small, hotlinkable live-weather badge other local sites can
// embed with a plain <img>. Hand-built SVG string in the brand style (the
// favicon's sun-and-cloud at left), system fonts only (an <img> context can't
// fetch webfonts anyway). Text rows use tspan flow so variable-width values
// (temp, condition) never need manual collision math; the condition is
// truncated to fit the card. Pass `data` = null to render the neutral
// "unavailable" badge (no alert flag — we don't know, so we don't claim).
// English-only like the other non-page endpoints.
function badgeSvg(data) {
  const cur = data ? currentHourly(data) : null;
  const temp = typeof cur?.temperature === "number" ? `${cur.temperature}°${cur.temperatureUnit || "F"}` : "–";
  const feels = feelsLikeF(cur);
  let cond = cur?.shortForecast || "Data unavailable";
  if (cond.length > 20) cond = cond.slice(0, 19).trimEnd() + "…";
  const alerts = (data?.alerts ?? []).length;
  // Top-right status flag: end-anchored text (no pill rect, so no width math).
  // "No alerts" is worth stating — same philosophy as the hub's status card.
  const flag = !data
    ? ""
    : alerts
      ? `<text x="288" y="24" text-anchor="end" font-size="12" font-weight="800" fill="#ffa294">&#9888; ${alerts} ALERT${alerts === 1 ? "" : "S"}</text>`
      : `<text x="288" y="24" text-anchor="end" font-size="11" font-weight="700" fill="#7fd39b">&#10004; NO ALERTS</text>`;
  const title = data
    ? `Crosby, TX weather: ${temp} ${cur?.shortForecast || "unavailable"}${feels != null ? `, feels like ${feels}°` : ""}${alerts ? ` — ${alerts} active alert${alerts === 1 ? "" : "s"}` : " — no active alerts"} — crosbynews.com`
    : "Crosby, TX weather — data temporarily unavailable — crosbynews.com";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80" viewBox="0 0 300 80" role="img" aria-labelledby="bt">
<title id="bt">${esc(title)}</title>
<rect width="300" height="80" rx="12" fill="#0b3d61"/>
<circle cx="30" cy="34" r="12" fill="#f5b301"/>
<ellipse cx="39" cy="43" rx="16" ry="9" fill="#dfe7ee"/>
<g font-family="system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<text x="64" y="24" font-size="11" font-weight="700" letter-spacing="1.5" fill="#9fc1d9">CROSBY, TX</text>
<text x="64" y="52"><tspan font-size="25" font-weight="800" fill="#ffffff">${esc(temp)}</tspan><tspan dx="8" font-size="13" fill="#dfe7ee">${esc(cond)}</tspan></text>
<text x="64" y="70" font-size="11" fill="#9fc1d9">${feels != null ? esc(`Feels like ${feels}° · `) : ""}crosbynews.com</text>
${flag}
</g>
</svg>
`;
}

// JSON shape served at /api/news — the routine-curated headlines the /news
// page renders (read-only; the KV key is written out-of-band, see the News
// pipeline). `category` folds the internal crime flag into the same
// community/incident split the page shows.
function apiNews(data) {
  return {
    location: "Crosby, TX",
    source: "Aggregated from public news sources, filtered for relevance to Crosby, TX",
    updated: data.updated ?? null,
    items: (data.items ?? []).map((n) => ({
      title: n.title,
      link: n.link,
      source: n.source || null,
      published: n.ts ? new Date(n.ts).toISOString() : null,
      category: n.crime ? "incident" : "community",
    })),
  };
}

// JSON shape served at /api/calendar — upcoming Crosby ISD events. The feed's
// datetimes are floating local (Central); like the Event JSON-LD, timed values
// are emitted as zone-less ISO 8601 local time and all-day events as plain
// dates, preserving the district's authored wall-clock.
function apiCalendar(data) {
  const iso = (ms, allDay) =>
    allDay ? new Date(ms).toISOString().slice(0, 10) : new Date(ms).toISOString().slice(0, 19);
  return {
    district: "Crosby Independent School District",
    source: "Crosby ISD public iCal feed (crosbyisd.org)",
    timezone: TZ,
    updated: data.updated ?? null,
    events: upcomingEvents(data.events ?? []).map((e) => ({
      summary: e.summary,
      location: e.location || null,
      start: iso(e.start, e.allDay),
      end: e.end ? iso(e.end, e.allDay) : null,
      allDay: !!e.allDay,
    })),
  };
}

// RFC 9727 / RFC 9264 API catalog (application/linkset+json).
function apiCatalog() {
  const entry = (anchor, doc) => ({
    anchor: `${SITE}${anchor}`,
    "service-desc": [{ href: `${SITE}/openapi.json`, type: "application/json" }],
    "service-doc": [{ href: `${SITE}${doc}`, type: "text/html" }],
    status: [{ href: `${SITE}/api/health`, type: "application/json" }],
  });
  return {
    linkset: [entry("/api/weather", "/"), entry("/api/news", "/news"), entry("/api/calendar", "/calendar"), entry("/api/water", "/water")],
  };
}

// OpenAPI 3.1 description of the weather API.
function openApiSpec() {
  const HourlyPeriod = {
    type: "object",
    // The NWS payload is passed through verbatim and carries more fields than
    // are called out here (number, name, dewpoint, relativeHumidity, ...).
    additionalProperties: true,
    properties: {
      number: { type: "integer" },
      name: { type: "string" },
      startTime: { type: "string", format: "date-time" },
      endTime: { type: "string", format: "date-time" },
      isDaytime: { type: "boolean" },
      temperature: { type: "number" },
      temperatureUnit: { type: "string" },
      temperatureTrend: { type: ["string", "null"] },
      shortForecast: { type: "string" },
      windSpeed: { type: "string" },
      windDirection: { type: "string" },
      windGust: { type: "string" },
      probabilityOfPrecipitation: { type: "object", properties: { value: { type: ["number", "null"] } } },
      icon: { type: "string", format: "uri" },
      feelsLike: {
        type: ["number", "null"],
        description: "Heat index or wind chill in °F, computed from temperature/humidity/wind using NWS's own formulas. Not an NWS field — null when neither applies.",
      },
    },
  };
  const Period = {
    type: "object",
    additionalProperties: true,
    properties: {
      number: { type: "integer" },
      startTime: { type: "string", format: "date-time" },
      endTime: { type: "string", format: "date-time" },
      name: { type: "string" },
      isDaytime: { type: "boolean" },
      temperature: { type: "number" },
      temperatureUnit: { type: "string" },
      shortForecast: { type: "string" },
      detailedForecast: { type: "string" },
      windSpeed: { type: "string" },
      windDirection: { type: "string" },
      probabilityOfPrecipitation: { type: "object", properties: { value: { type: ["number", "null"] } } },
      icon: { type: "string", format: "uri" },
    },
  };
  const Alert = {
    type: "object",
    properties: {
      event: { type: "string" },
      headline: { type: "string" },
      severity: { type: "string" },
      description: { type: "string" },
      instruction: { type: "string" },
      expires: { type: "string", format: "date-time" },
    },
  };
  const NewsItem = {
    type: "object",
    properties: {
      title: { type: "string" },
      link: { type: "string", format: "uri" },
      source: { type: ["string", "null"] },
      published: { type: ["string", "null"], format: "date-time" },
      category: { type: "string", enum: ["community", "incident"] },
    },
  };
  const SchoolEvent = {
    type: "object",
    properties: {
      summary: { type: "string" },
      location: { type: ["string", "null"] },
      start: {
        type: "string",
        description: "All-day events: a date (YYYY-MM-DD). Timed events: zone-less ISO 8601 local time (America/Chicago wall-clock, as authored by the district).",
      },
      end: { type: ["string", "null"] },
      allDay: { type: "boolean" },
    },
  };
  const Gauge = {
    type: "object",
    properties: {
      id: { type: "string", description: "NWPS location ID (e.g. HCDT2)." },
      name: { type: "string" },
      usgsId: { type: ["string", "null"] },
      stage: { type: ["number", "null"], description: "Observed gauge height, in stageUnit; null when the gauge is offline." },
      stageUnit: { type: "string" },
      flow: { type: ["number", "null"], description: "Observed discharge in cubic feet per second." },
      flowUnit: { type: "string" },
      category: { type: "string", description: "NWS flood category. no_flooding/action/minor/moderate/major where NWS defines flood stages; not_defined for gauges without them (e.g. reservoir levels).", enum: ["no_flooding", "action", "minor", "moderate", "major", "not_defined", "unknown"] },
      validTime: { type: ["string", "null"], format: "date-time" },
      thresholds: { type: "object", description: "NWS flood-stage thresholds in thresholdUnit; only the categories NWS defines for this gauge are present.", additionalProperties: { type: "number" } },
      thresholdUnit: { type: "string" },
      officialUrl: { type: "string", format: "uri" },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "crosbynews.com API",
      version: "1.3.0",
      description:
        "Crosby, Texas community data: current conditions, hourly and 7-day forecast, active alerts, the EPA UV index, and a modeled air-quality index from the U.S. National Weather Service, EPA, and Open-Meteo; recent local news headlines; and the Crosby ISD school calendar. Public, no authentication.",
      contact: { url: `${SITE}/` },
      license: { name: "Public domain (NWS source data)", url: "https://www.weather.gov/disclaimer" },
    },
    servers: [{ url: SITE }],
    paths: {
      "/api/weather": {
        get: {
          operationId: "getWeather",
          summary: "Current conditions, forecast, and alerts for Crosby, TX",
          responses: {
            "200": {
              description: "Weather snapshot",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Weather" } } },
            },
            "502": { description: "Upstream (NWS) unavailable" },
          },
        },
      },
      "/api/news": {
        get: {
          operationId: "getNews",
          summary: "Recent local news headlines for Crosby, TX",
          responses: {
            "200": {
              description: "Curated headline list (community items first on the site; incidents flagged by category)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/News" } } },
            },
            "502": { description: "News cache unavailable" },
          },
        },
      },
      "/api/calendar": {
        get: {
          operationId: "getCalendar",
          summary: "Upcoming Crosby ISD school calendar events",
          responses: {
            "200": {
              description: "Upcoming events (soonest first, capped at 60)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/SchoolCalendar" } } },
            },
            "502": { description: "Calendar unavailable" },
          },
        },
      },
      "/api/water": {
        get: {
          operationId: "getWater",
          summary: "River and bayou levels with NWS flood stages for the Crosby, TX area",
          responses: {
            "200": {
              description: "Current stage, flow, flood category, and thresholds per gauge",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Water" } } },
            },
            "502": { description: "Water data unavailable" },
          },
        },
      },
      "/api/health": {
        get: {
          operationId: "getHealth",
          summary: "Service health and cache freshness",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { status: { type: "string" }, updated: { type: ["string", "null"], format: "date-time" } },
                    required: ["status"],
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Weather: {
          type: "object",
          properties: {
            location: { type: "string" },
            coordinates: { type: "object", properties: { lat: { type: "number" }, lon: { type: "number" } } },
            source: { type: "string" },
            updated: { type: "string", format: "date-time" },
            sun: {
              type: ["object", "null"],
              description: "Today's sunrise/sunset for Crosby, computed astronomically in-Worker (standard sunrise equation) — not an NWS field.",
              properties: {
                sunrise: { type: "string", format: "date-time" },
                sunset: { type: "string", format: "date-time" },
              },
            },
            uv: {
              type: ["object", "null"],
              description: "UV index from the U.S. EPA's UV forecast for Crosby's ZIP (77532) — not an NWS field. null when the EPA fetch failed or the current hour is outside the product's daytime window.",
              properties: {
                current: { type: ["integer", "null"], description: "UV index for the current hour (Central time)." },
                currentCategory: { type: ["string", "null"], description: "Low / Moderate / High / Very High / Extreme." },
                peakToday: { type: ["integer", "null"], description: "Highest forecast UV index for today." },
                peakCategory: { type: ["string", "null"] },
                source: { type: "string" },
              },
            },
            airQuality: {
              type: ["object", "null"],
              description: "US Air Quality Index — MODELED (Open-Meteo, CAMS-based), not an official monitor reading, since no EPA monitor sits in Crosby. `modeled: true` is always set. null when the fetch failed.",
              properties: {
                usAqi: { type: "integer", description: "US AQI, 0–500 scale." },
                category: { type: "string", description: "Good / Moderate / Unhealthy for Sensitive Groups / Unhealthy / Very Unhealthy / Hazardous." },
                dominantPollutant: { type: ["string", "null"], description: "The pollutant driving the overall AQI." },
                pm2_5: { type: ["number", "null"], description: "PM2.5 concentration in concentrationUnit." },
                pm10: { type: ["number", "null"] },
                ozone: { type: ["number", "null"] },
                concentrationUnit: { type: "string" },
                modeled: { type: "boolean" },
                source: { type: "string" },
              },
            },
            current: { anyOf: [HourlyPeriod, { type: "null" }] },
            hourly: { type: "array", items: HourlyPeriod },
            forecast: { type: "array", items: Period },
            alerts: { type: "array", items: Alert },
          },
        },
        HourlyPeriod,
        Period,
        Alert,
        News: {
          type: "object",
          properties: {
            location: { type: "string" },
            source: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            items: { type: "array", items: NewsItem },
          },
        },
        NewsItem,
        SchoolCalendar: {
          type: "object",
          properties: {
            district: { type: "string" },
            source: { type: "string" },
            timezone: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            events: { type: "array", items: SchoolEvent },
          },
        },
        SchoolEvent,
        Water: {
          type: "object",
          properties: {
            location: { type: "string" },
            source: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            gauges: { type: "array", items: Gauge },
          },
        },
        Gauge,
      },
    },
  };
}

// --- MCP server (Streamable HTTP transport) -------------------------------
// A stateless Model Context Protocol server exposing the weather as callable
// tools. Single endpoint at /mcp: POST a JSON-RPC message, get one back.
const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_SERVER_INFO = { name: "crosbynews-weather", version: "1.0.0", title: "Crosby, TX Weather" };
const MCP_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id, authorization",
  "access-control-max-age": "86400",
};

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

function mcpJson(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "mcp-protocol-version": MCP_PROTOCOL_VERSION, ...MCP_CORS },
  });
}

function mcpTools() {
  return [
    {
      name: "get_current_conditions",
      title: "Current conditions",
      description: "Current weather for Crosby, TX: temperature, sky, and precip chance.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "get_forecast",
      title: "Forecast",
      description:
        "Forecast for Crosby, TX from the U.S. National Weather Service. Returns the 7-day day/night forecast, or upcoming hourly periods if `hours` is given.",
      inputSchema: {
        type: "object",
        properties: {
          hours: { type: "integer", minimum: 1, maximum: 12, description: "Return this many upcoming hourly periods instead of the daily forecast." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "get_alerts",
      title: "Active alerts",
      description: "Active NWS weather alerts for Crosby, TX. Returns an empty list when none are active.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "get_crosby_news",
      title: "Local news",
      description:
        "Recent local news headlines for Crosby, TX and nearby northeast Harris County communities, aggregated from public sources and filtered for relevance. Empty when nothing recent.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "get_school_events",
      title: "School calendar",
      description:
        "Upcoming Crosby ISD school-calendar events: first/last day of school, holidays, no-school and early-release days, testing windows, and campus activities.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 60, description: "Maximum events to return (default 15)." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "get_river_levels",
      title: "River & bayou levels",
      description:
        "Current water levels and NWS flood stages for the rivers and bayous that flood Crosby, TX and northeast Harris County (Cedar Bayou, San Jacinto River, Luce Bayou, and more). Each gauge reports its stage, flow, flood category, and thresholds.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ];
}

// MCP prompts — one genuinely useful one: a data-grounded daily briefing.
// prompts/get composes the live data server-side (no tool round-trips), so
// the client gets a self-contained prompt with everything already in it.
function mcpPrompts() {
  return [
    {
      name: "crosby_briefing",
      title: "Crosby daily briefing",
      description:
        "Compose a concise daily briefing for a Crosby, TX resident: current weather with feels-like, today's outlook, active alerts, sunrise/sunset, recent local headlines, and upcoming Crosby ISD events. The prompt arrives pre-filled with live data.",
      arguments: [],
    },
  ];
}

async function mcpGetPrompt(name, env) {
  if (name !== "crosby_briefing") {
    const e = new Error(`Unknown prompt: ${name}`);
    e.code = -32602;
    throw e;
  }
  const [{ data }, news, cal] = await Promise.all([loadWeather(env), loadNews(env), loadCalendar(env)]);
  const now = currentHourly(data);
  const lead = data.periods?.[0];
  const sun = sunTimesForCtDate(Date.now());
  const feels = feelsLikeF(now);
  const lines = ["# Live Crosby, TX data (as of " + fullTime(data.updated) + " CT)", ""];
  if (now) lines.push(`Now: ${now.temperature}°${now.temperatureUnit}, ${now.shortForecast}${feels != null ? `, feels like ${feels}°` : ""}${pop(now) ? `, ${pop(now)}% precip` : ""}.`);
  const uvNow = uvCurrent(data), uvPk = uvPeakToday(data);
  if (uvNow || uvPk) lines.push(`UV index: ${uvNow ? `${uvNow} (${uvCategory(uvNow)}) now` : ""}${uvNow && uvPk ? ", " : ""}${uvPk ? `${uvPk} peak today` : ""}.`);
  if (data.aqi?.usAqi != null) lines.push(`Air quality (modeled, not a monitor reading): US AQI ${data.aqi.usAqi} (${aqiCategory(data.aqi.usAqi)}).`);
  if (lead) lines.push(`${lead.name}: ${lead.detailedForecast}`);
  if (sun) lines.push(`Sunrise ${clockTime(sun.sunrise)}, sunset ${clockTime(sun.sunset)} CT.`);
  const alerts = data.alerts ?? [];
  lines.push(
    alerts.length
      ? `ACTIVE ALERTS: ${alerts.map((a) => `${a.event}${a.headline ? ` — ${a.headline}` : ""}`).join("; ")}`
      : "No active weather alerts."
  );
  const items = (news.items ?? []).slice(0, 5);
  if (items.length) {
    lines.push("", "Recent local headlines:");
    for (const n of items) lines.push(`- ${n.title}${n.source ? ` (${n.source})` : ""}`);
  }
  const events = upcomingEvents(cal.events ?? []).slice(0, 5);
  if (events.length) {
    lines.push("", "Upcoming Crosby ISD events:");
    for (const e of events) {
      const when = new Date(e.start).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
      lines.push(`- ${when}: ${e.summary}`);
    }
  }
  lines.push(
    "",
    "Using ONLY the data above, write a friendly, concise daily briefing for a Crosby, TX resident. Lead with anything safety-relevant (alerts, extreme heat index). Keep it under 150 words. Note that weather data is from the U.S. National Weather Service."
  );
  return {
    description: "Data-grounded prompt for a Crosby, TX daily briefing.",
    messages: [{ role: "user", content: { type: "text", text: lines.join("\n") } }],
  };
}

// MCP resources — the machine-readable site docs, readable in-protocol.
const MCP_RESOURCES = [
  {
    uri: `${SITE}/llms.txt`,
    name: "crosbynews-overview",
    title: "crosbynews.com site overview",
    description: "Plain-language summary of the site, its pages, API, and data policy (llms.txt).",
    mimeType: "text/markdown",
  },
  {
    uri: `${SITE}/openapi.json`,
    name: "crosbynews-openapi",
    title: "crosbynews.com API spec",
    description: "OpenAPI 3.1 description of the weather, news, school-calendar, and water-levels API.",
    mimeType: "application/json",
  },
];

function mcpReadResource(uri) {
  const r = MCP_RESOURCES.find((x) => x.uri === uri);
  if (!r) return null;
  const text = uri.endsWith("/llms.txt") ? llmsTxt() : JSON.stringify(openApiSpec(), null, 2);
  return { contents: [{ uri, mimeType: r.mimeType, text }] };
}

function mcpServerCard() {
  return {
    serverInfo: MCP_SERVER_INFO,
    protocolVersion: MCP_PROTOCOL_VERSION,
    description:
      "Live Crosby, Texas data: weather from the U.S. National Weather Service (current conditions, forecast, active alerts), river/bayou flood levels, recent local news headlines, and the Crosby ISD school calendar.",
    transport: { type: "streamable-http", endpoint: `${SITE}/mcp` },
    capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } },
    tools: mcpTools().map((t) => ({ name: t.name, title: t.title, description: t.description })),
    prompts: mcpPrompts().map((p) => ({ name: p.name, title: p.title, description: p.description })),
    resources: MCP_RESOURCES.map((r) => ({ uri: r.uri, name: r.name, title: r.title })),
    documentation: `${SITE}/`,
  };
}

// Human-facing explainer shown when a browser opens /mcp (which only speaks
// POST JSON-RPC). Lists the tools and how to connect.
function mcpInfoHtml() {
  const tools = mcpTools()
    .map((t) => `<li><code>${esc(t.name)}</code> &mdash; ${esc(t.description)}</li>`)
    .join("\n      ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MCP Server &mdash; crosbynews.com</title>
<meta name="description" content="Model Context Protocol (MCP) server for Crosby, TX weather: connect an AI agent to get live conditions, forecast, and alerts.">
<meta name="theme-color" content="#0b3d61">
<meta name="robots" content="noindex">
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .card { background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.5rem; }
  code { background:color-mix(in srgb,var(--ink) 10%, transparent); padding:0.05rem 0.3rem; border-radius:4px; font-size:0.9em; }
  pre { background:color-mix(in srgb,var(--ink) 8%, transparent); padding:0.8rem; border-radius:8px; overflow-x:auto; font-size:0.85rem; }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  ul { padding-left:1.1rem; } li { margin:0.3rem 0; }
</style>
</head>
<body>
${topbar("")}
<main id="main">
  <h1>MCP Server</h1>
  <p class="intro">This is the Model Context Protocol (MCP) endpoint for crosbynews.com. It is meant for AI agents, not browsers &mdash; it speaks JSON-RPC over HTTP POST. This page just explains what it is.</p>
  <section class="card">
    <h2>Endpoint</h2>
    <p><code>${SITE}/mcp</code> &middot; transport: Streamable HTTP (JSON-RPC 2.0). Discovery card: <a href="/.well-known/mcp/server-card.json">/.well-known/mcp/server-card.json</a>.</p>
  </section>
  <section class="card">
    <h2>Tools</h2>
    <ul>
      ${tools}
    </ul>
  </section>
  <section class="card">
    <h2>Prompts &amp; resources</h2>
    <p>The prompt <code>crosby_briefing</code> returns a data-grounded daily-briefing prompt with live weather, alerts, headlines, and school events already filled in. Resources expose <a href="/llms.txt"><code>llms.txt</code></a> and the <a href="/openapi.json">OpenAPI spec</a> in-protocol.</p>
  </section>
  <section class="card">
    <h2>Connect from Claude Code</h2>
    <pre>claude mcp add --transport http crosbynews ${SITE}/mcp</pre>
    <p class="intro">Then ask, e.g., "what's the forecast for Crosby, TX?" and the agent will call these tools. Prefer a webpage? See the <a href="/">live forecast</a>, <a href="/hourly">hourly</a>, and <a href="/radar">radar</a>.</p>
  </section>
</main>
${footer({ page: "/mcp", lang: "en", source: `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).` })}
</body>
</html>`;
}

// Markdown rendering of the same explainer, served when an agent asks for it
// (Accept: text/markdown / ?format=md) — so the footer's "View as Markdown"
// link works here like it does on every content page. English-only, like the
// HTML explainer.
function mcpInfoMarkdown() {
  const tools = mcpTools()
    .map((t) => `- \`${t.name}\` — ${t.description}`)
    .join("\n");
  return `# MCP Server — crosbynews.com

This is the Model Context Protocol (MCP) endpoint for crosbynews.com. It speaks
JSON-RPC 2.0 over HTTP POST (Streamable HTTP transport); this page just explains
what it is.

## Endpoint

- \`${SITE}/mcp\` — transport: Streamable HTTP (JSON-RPC 2.0 over POST)
- Discovery card: ${SITE}/.well-known/mcp/server-card.json

## Tools

${tools}

## Prompts & resources

- Prompt \`crosby_briefing\` — a data-grounded daily-briefing prompt (live weather, alerts, headlines, and school events pre-filled).
- Resources — \`${SITE}/llms.txt\` (site overview) and \`${SITE}/openapi.json\` (API spec), readable in-protocol.

## Connect from Claude Code

\`\`\`
claude mcp add --transport http crosbynews ${SITE}/mcp
\`\`\`

Then ask, e.g., "what's the forecast for Crosby, TX?" and the agent will call
these tools. Prefer a webpage? See the [live forecast](${SITE}/),
[hourly](${SITE}/hourly), and [radar](${SITE}/radar).

---
[crosbynews.com](${SITE}/) · data from the U.S. National Weather Service
`;
}

async function mcpCallTool(name, args, env) {
  // News and calendar tools read their own KV keys — handled first so they
  // don't pay for (or fail on) a weather load they never use.
  if (name === "get_crosby_news") {
    const news = await loadNews(env);
    const items = news.items ?? [];
    const text = items.length
      ? items
          .map((n) => `- ${n.title}${n.source ? ` (${n.source}${n.ts ? `, ${newsDate(n.ts)}` : ""})` : ""}`)
          .join("\n")
      : "No recent Crosby news right now.";
    return { content: [{ type: "text", text }], structuredContent: apiNews(news) };
  }
  if (name === "get_school_events") {
    const cal = await loadCalendar(env);
    const limit = Math.min(Math.max(Number(args?.limit) || 15, 1), 60);
    const payload = apiCalendar(cal);
    payload.events = payload.events.slice(0, limit);
    const shown = upcomingEvents(cal.events ?? []).slice(0, limit);
    const text = shown.length
      ? shown
          .map((e) => {
            const when = new Date(e.start).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
            return `- ${when}: ${e.summary}${e.allDay ? "" : ` (${calTime(e.start)})`}${e.location ? ` — ${e.location}` : ""}`;
          })
          .join("\n")
      : "No upcoming Crosby ISD events are posted right now.";
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_river_levels") {
    const water = await loadWater(env);
    const payload = apiWater(water);
    const text = payload.gauges.length
      ? payload.gauges
          .map((g) => {
            const th = ["action", "minor", "moderate", "major"]
              .filter((k) => typeof g.thresholds[k] === "number")
              .map((k) => `${k} ${g.thresholds[k]}ft`)
              .join(", ");
            return `- ${g.name}: ${g.stage != null ? `${g.stage} ft` : "n/a"} (${waterState(g, "en").label})${g.flow != null ? `, ${g.flow.toLocaleString("en-US")} cfs` : ""}${th ? ` [flood stages: ${th}]` : ""}`;
          })
          .join("\n")
      : "Water level data is temporarily unavailable.";
    return { content: [{ type: "text", text }], structuredContent: payload };
  }

  const { data } = await loadWeather(env);
  if (name === "get_current_conditions") {
    const now = currentHourly(data);
    const feels = feelsLikeF(now);
    const sun = sunTimesForCtDate(Date.now());
    const uvNow = uvCurrent(data);
    const aqi = data.aqi;
    const text = now
      ? `Crosby, TX: ${now.temperature}°${now.temperatureUnit}, ${now.shortForecast}` +
        `${feels != null ? `, feels like ${feels}°` : ""}${pop(now) ? `, ${pop(now)}% precip` : ""} (as of ${clockTime(now.startTime)} CT).` +
        `${uvNow ? ` UV index ${uvNow} (${uvCategory(uvNow)}).` : ""}` +
        `${aqi?.usAqi != null ? ` Air quality (modeled) US AQI ${aqi.usAqi} (${aqiCategory(aqi.usAqi)}).` : ""}` +
        `${sun ? ` Sunrise ${clockTime(sun.sunrise)}, sunset ${clockTime(sun.sunset)} CT.` : ""}`
      : "Current conditions are unavailable.";
    return {
      content: [{ type: "text", text }],
      structuredContent: {
        location: data.place,
        updated: data.updated,
        sun: sun ? { sunrise: new Date(sun.sunrise).toISOString(), sunset: new Date(sun.sunset).toISOString() } : null,
        uv: uvNow != null ? { current: uvNow, currentCategory: uvCategory(uvNow), peakToday: uvPeakToday(data) } : null,
        airQuality: aqi?.usAqi != null ? { usAqi: aqi.usAqi, category: aqiCategory(aqi.usAqi), dominantPollutant: aqiDominantLabel(aqi.dominant), modeled: true, source: "Open-Meteo (modeled, not a monitor reading)" } : null,
        current: now ? { ...now, feelsLike: feelsLikeRawF(now) } : null,
      },
    };
  }
  if (name === "get_forecast") {
    const hours = Number(args?.hours) || 0;
    if (hours > 0) {
      const slice = (data.hourly ?? []).slice(0, Math.min(hours, 12));
      const text =
        slice
          .map((h) => {
            const feels = feelsLikeRawF(h);
            return `${hourLabel(h.startTime)}: ${h.temperature}°${h.temperatureUnit}, ${h.shortForecast}${feels != null ? `, feels like ${feels}°` : ""}${pop(h) ? `, ${pop(h)}% precip` : ""}`;
          })
          .join("\n") || "No hourly data.";
      return { content: [{ type: "text", text }], structuredContent: { location: data.place, hourly: slice.map((h) => ({ ...h, feelsLike: feelsLikeRawF(h) })) } };
    }
    const text =
      (data.periods ?? [])
        .map((p) => `${p.name}: ${p.isDaytime ? "High" : "Low"} ${p.temperature}°${p.temperatureUnit}, ${p.shortForecast}. ${p.detailedForecast}`)
        .join("\n\n") || "No forecast data.";
    return { content: [{ type: "text", text }], structuredContent: { location: data.place, forecast: data.periods ?? [] } };
  }
  if (name === "get_alerts") {
    const alerts = data.alerts ?? [];
    const text = alerts.length
      ? alerts.map((a) => `${a.event}${a.headline ? ` — ${a.headline}` : ""}${a.expires ? ` (until ${fullTime(a.expires)} CT)` : ""}`).join("\n")
      : "No active weather alerts for Crosby, TX.";
    return { content: [{ type: "text", text }], structuredContent: { location: data.place, count: alerts.length, alerts } };
  }
  const err = new Error(`Unknown tool: ${name}`);
  err.code = -32602;
  throw err;
}

async function mcpHandle(msg, env) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return msg && msg.id != null ? rpcError(msg.id, -32600, "Invalid Request") : null;
  }
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions:
          "Live Crosby, Texas data: weather from the U.S. National Weather Service, river/bayou flood levels, local news headlines, and the Crosby ISD school calendar.",
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: mcpTools() });
    case "prompts/list":
      return rpcResult(id, { prompts: mcpPrompts() });
    case "prompts/get":
      try {
        return rpcResult(id, await mcpGetPrompt(params?.name, env));
      } catch (e) {
        return rpcError(id, typeof e?.code === "number" ? e.code : -32603, (e && e.message) || "prompt failed");
      }
    case "resources/list":
      return rpcResult(id, { resources: MCP_RESOURCES });
    case "resources/read": {
      const res = mcpReadResource(params?.uri);
      return res ? rpcResult(id, res) : rpcError(id, -32602, `Unknown resource: ${params?.uri}`);
    }
    case "tools/call":
      try {
        const res = await mcpCallTool(params?.name, params?.arguments ?? {}, env);
        return rpcResult(id, res);
      } catch (e) {
        if (e && typeof e.code === "number") return rpcError(id, e.code, e.message);
        return rpcResult(id, { content: [{ type: "text", text: `Error: ${(e && e.message) || e}` }], isError: true });
      }
    default:
      // Notifications (e.g. notifications/initialized) get no response.
      if (!isRequest) return null;
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
// --- end MCP server -------------------------------------------------------

// --- Agent Skills discovery (agentskills.io v0.2.0) -----------------------
const SKILLS_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

// A real skill: it documents this site's actual public API + MCP server.
const CROSBY_WEATHER_SKILL = `---
name: crosby-weather
description: Get current conditions, forecast, and active weather alerts for Crosby, Texas (USA).
license: Public domain (U.S. National Weather Service source data)
---

# Crosby, TX Weather

Live weather for Crosby, Texas (lat 29.9119, lon -95.0608), sourced from the
U.S. National Weather Service and refreshed every 15 minutes.

## When to use this skill

Use it when a user asks about current conditions, the forecast, or active
weather alerts for Crosby, TX (or the northeast Houston / Crosby area).

## How to get the data

REST API (public, no auth):

- GET https://crosbynews.com/api/weather - JSON with these fields:
  - current  - latest conditions (temperature, shortForecast, wind, ...)
  - hourly   - next 12 hourly periods
  - forecast - 7-day day/night forecast
  - alerts   - active NWS alerts (empty array when none)
- GET https://crosbynews.com/api/health - status and cache freshness
- OpenAPI spec: https://crosbynews.com/openapi.json

MCP server (Streamable HTTP, JSON-RPC):

- Endpoint: https://crosbynews.com/mcp
- Tools: get_current_conditions, get_forecast (optional hours 1-12), get_alerts

## Other Crosby data (same API and MCP server)

- GET https://crosbynews.com/api/news - recent local Crosby headlines (JSON);
  MCP tool: get_crosby_news
- GET https://crosbynews.com/api/calendar - upcoming Crosby ISD school
  calendar events (JSON); MCP tool: get_school_events (optional limit 1-60)
- GET https://crosbynews.com/api/water - river/bayou levels with NWS flood
  stages for the Crosby area (JSON); MCP tool: get_river_levels

## Notes

- Public and unauthenticated; no rate limits.
- Source data is public domain. Attribute "U.S. National Weather Service".
`;

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Base64 SHA-256 — the form a CSP `'sha256-...'` source expression expects.
async function sha256Base64(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Content-Security-Policy. Scripts are limited to same-origin, the one inline
// homepage block (allow-listed by its exact hash), and Cloudflare Web Analytics,
// whose beacon.min.js (static.cloudflareinsights.com) Cloudflare injects into
// browser responses and which reports to cloudflareinsights.com. 'unsafe-inline'
// is a backward-compat fallback only — browsers that honour the hash ignore it.
// Inline <style> blocks/attributes still need 'unsafe-inline' on style-src.
// Computed once per isolate and cached.
let CSP_CACHE = null;
async function contentSecurityPolicy() {
  if (!CSP_CACHE) {
    const scriptHash = await sha256Base64(HOME_SCRIPT);
    const pushHash = await sha256Base64(PUSH_CLIENT_SCRIPT);
    CSP_CACHE = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' 'unsafe-inline' 'sha256-${scriptHash}' 'sha256-${pushHash}' https://static.cloudflareinsights.com`,
      "connect-src 'self' https://cloudflareinsights.com",
      "form-action 'self'",
    ].join("; ");
  }
  return CSP_CACHE;
}

async function agentSkillsIndex() {
  const digest = "sha256:" + (await sha256Hex(CROSBY_WEATHER_SKILL));
  return {
    $schema: SKILLS_SCHEMA,
    skills: [
      {
        name: "crosby-weather",
        type: "skill-md",
        description: "Get current conditions, forecast, and active weather alerts for Crosby, Texas.",
        url: "/.well-known/agent-skills/crosby-weather/SKILL.md",
        digest,
      },
    ],
  };
}
// --- end Agent Skills -----------------------------------------------------

async function _fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/robots.txt") {
      return new Response(robotsTxt(), {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }
    if (path === "/llms.txt") {
      return new Response(llmsTxt(), {
        headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }
    if (path === "/sitemap.xml") {
      return new Response(sitemapXml(), {
        headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }
    // RSS feeds — rendered from the same KV data as the HTML pages.
    if (path === "/alerts.xml") {
      try {
        const { data } = await loadWeather(env);
        return conditional(request, data.updated ?? "none", () => alertsRss(data), {
          "content-type": "application/rss+xml; charset=utf-8",
          "cache-control": "public, max-age=300",
        });
      } catch (err) {
        return new Response("Feed temporarily unavailable", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    }
    if (path === "/news.xml") {
      try {
        const data = await loadNews(env);
        return conditional(request, data.updated ?? "none", () => newsRss(data), {
          "content-type": "application/rss+xml; charset=utf-8",
          "cache-control": "public, max-age=900",
        });
      } catch (err) {
        return new Response("Feed temporarily unavailable", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    }
    // RFC 9116 security contact. Expires is computed ~1 year out on each request,
    // so the file never goes stale on this self-maintaining site.
    if (path === "/.well-known/security.txt") {
      const body = [
        "# Security contact for crosbynews.com",
        "Contact: mailto:security@crosbynews.com",
        `Expires: ${new Date(Date.now() + 365 * 86400000).toISOString()}`,
        "Preferred-Languages: en",
        `Canonical: ${SITE}/.well-known/security.txt`,
        "",
      ].join("\n");
      return new Response(body, {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
      });
    }
    // Hotlinkable live-weather badge — see /developers ("Embeddable weather
    // badge"). Same KV cache as the pages; edge-cached near the cron cadence
    // so hotlinks are nearly free. On total data failure serves the neutral
    // "unavailable" badge with a short cache instead of a broken image.
    if (path === "/badge.svg") {
      try {
        const { data } = await loadWeather(env);
        return new Response(badgeSvg(data), {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "public, max-age=300, s-maxage=900",
            "access-control-allow-origin": "*",
          },
        });
      } catch (err) {
        console.error("badge render failed:", err && err.stack);
        return new Response(badgeSvg(null), {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "public, max-age=60",
            "access-control-allow-origin": "*",
          },
        });
      }
    }
    // Serve the favicon as a real file. Browsers and crawlers auto-request
    // /favicon.ico; serving it (as SVG) avoids needless 404s in crawl stats.
    if (path === "/favicon.ico" || path === "/favicon.svg") {
      return new Response(FAVICON_SVG, {
        headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=604800, immutable" },
      });
    }
    // PWA surface: manifest + app icon + service worker (see the constants up
    // top). The SW gets `no-cache` so a deploy's new worker is picked up on
    // the next visit rather than after a stale-cache window.
    if (path === "/manifest.json") {
      return new Response(JSON.stringify(MANIFEST, null, 2), {
        headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }
    if (path === "/icon.svg") {
      return new Response(ICON_SVG, {
        headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=604800, immutable" },
      });
    }
    if (path === "/sw.js") {
      return new Response(SW_SCRIPT, {
        headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" },
      });
    }
    // CORS preflight for the public API.
    if (request.method === "OPTIONS" && path.startsWith("/api/")) {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-max-age": "86400",
        },
      });
    }

    if (path === "/.well-known/api-catalog") {
      return new Response(JSON.stringify(apiCatalog(), null, 2), {
        headers: {
          "content-type": "application/linkset+json; charset=utf-8",
          "cache-control": "public, max-age=3600",
          "access-control-allow-origin": "*",
        },
      });
    }

    if (path === "/openapi.json") {
      return new Response(JSON.stringify(openApiSpec(), null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=3600",
          "access-control-allow-origin": "*",
        },
      });
    }

    if (path === "/.well-known/agent-skills/index.json") {
      return new Response(JSON.stringify(await agentSkillsIndex(), null, 2), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
      });
    }
    if (path === "/.well-known/agent-skills/crosby-weather/SKILL.md") {
      return new Response(CROSBY_WEATHER_SKILL, {
        headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
      });
    }

    if (path === "/.well-known/mcp/server-card.json") {
      return new Response(JSON.stringify(mcpServerCard(), null, 2), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
      });
    }

    if (path === "/mcp") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: MCP_CORS });
      // The MCP protocol itself uses POST. A strict MCP client opening the
      // optional SSE stream sends GET with `Accept: text/event-stream`; we
      // don't offer that stream, so 405 per the Streamable HTTP spec (checked
      // first, so it wins over markdown for a combined Accept; its Allow
      // deliberately omits GET — it's the spec's "no SSE here" signal). Every
      // other GET (browsers, plain curl) gets the human-friendly explainer,
      // markdown-negotiated like the content pages. HEAD is treated as GET —
      // the runtime strips the body — so `curl -I /mcp` mirrors GET instead
      // of 405ing.
      if (request.method === "GET" || request.method === "HEAD") {
        const accept = (request.headers.get("accept") || "").toLowerCase();
        if (accept.includes("text/event-stream")) {
          return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST, OPTIONS", ...MCP_CORS } });
        }
        const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
        return new Response(wantsMarkdown ? mcpInfoMarkdown() : mcpInfoHtml(), {
          status: 200,
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=3600",
            vary: "Accept",
            allow: "GET, HEAD, POST, OPTIONS",
            ...MCP_CORS,
          },
        });
      }
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD, POST, OPTIONS", ...MCP_CORS } });
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return mcpJson(rpcError(null, -32700, "Parse error"), 400);
      }
      const batch = Array.isArray(body);
      const out = [];
      for (const m of batch ? body : [body]) {
        const r = await mcpHandle(m, env);
        if (r) out.push(r);
      }
      if (out.length === 0) return new Response(null, { status: 202, headers: MCP_CORS });
      return mcpJson(batch ? out : out[0], 200);
    }

    if (path === "/api/health") {
      let updated = null;
      try {
        const cached = await env.WEATHER.get(KV_KEY, "json");
        updated = cached?.updated ?? null;
      } catch {}
      return new Response(JSON.stringify({ status: "ok", updated }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      });
    }

    // --- Severe-alert Web Push endpoints ---
    // Public VAPID key so the browser can subscribe. null when unconfigured, so
    // the client hides the opt-in UI.
    if (path === "/api/push/vapid-key") {
      return new Response(JSON.stringify({ key: env.VAPID_PUBLIC_KEY || null }), {
        headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" },
      });
    }
    // Store a subscription. Body: a PushSubscription JSON ({endpoint, keys}).
    // Endpoint is allowlisted to real push hosts (SSRF guard). Idempotent:
    // keyed by a hash of the endpoint.
    if (path === "/api/push/subscribe" && request.method === "POST") {
      if (!env.VAPID_PRIVATE_KEY) return new Response(JSON.stringify({ error: "push_unavailable" }), { status: 503, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
      let sub = null;
      try { sub = await request.json(); } catch {}
      if (!sub || typeof sub.endpoint !== "string" || !pushEndpointAllowed(sub.endpoint)) {
        return new Response(JSON.stringify({ error: "invalid_subscription" }), { status: 400, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
      }
      const record = { endpoint: sub.endpoint, keys: sub.keys || null, added: new Date().toISOString() };
      try {
        await env.WEATHER.put(await pushKeyFor(sub.endpoint), JSON.stringify(record));
      } catch (e) {
        return new Response(JSON.stringify({ error: "store_failed" }), { status: 500, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
    }
    // Remove a subscription. Body: {endpoint}.
    if (path === "/api/push/unsubscribe" && request.method === "POST") {
      let body = null;
      try { body = await request.json(); } catch {}
      if (!body || typeof body.endpoint !== "string") {
        return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
      }
      try { await env.WEATHER.delete(await pushKeyFor(body.endpoint)); } catch {}
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
    }

    if (path === "/api/weather") {
      try {
        const { data, cache } = await loadWeather(env);
        // Seed includes the CT calendar date because `sun` in the body
        // changes with it even when the cache stamp doesn't.
        const ctDate = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
        return conditional(request, `${data.updated ?? "none"}|${ctDate}`, () => JSON.stringify(apiWeather(data)), {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=300",
          link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
          "x-cache": cache,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "upstream_unavailable", message: err && err.message }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
        });
      }
    }

    // Local news as JSON — same read-only KV data the /news page renders.
    if (path === "/api/news") {
      try {
        const data = await loadNews(env);
        return conditional(request, data.updated ?? "none", () => JSON.stringify(apiNews(data)), {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=900",
          link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "unavailable", message: err && err.message }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
        });
      }
    }

    // Water levels as JSON — same cron-owned KV data as /water.
    if (path === "/api/water") {
      try {
        const data = await loadWater(env);
        return conditional(request, data.updated ?? "none", () => JSON.stringify(apiWater(data)), {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=300",
          link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "unavailable", message: err && err.message }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
        });
      }
    }

    // Crosby ISD school calendar as JSON — same cron-owned KV data as /calendar.
    // The `upcomingEvents` cutoff moves with time, so the seed carries the CT
    // date to stay honest across day boundaries.
    if (path === "/api/calendar") {
      try {
        const data = await loadCalendar(env);
        const ctDate = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
        return conditional(request, `${data.updated ?? "none"}|${ctDate}`, () => JSON.stringify(apiCalendar(data)), {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=1800",
          link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "unavailable", message: err && err.message }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
        });
      }
    }

    // Proxy NWS weather icons through our (crawlable) origin. NWS's robots.txt
    // disallows all crawling, so hotlinked icons can't be indexed; serving them
    // here makes them crawlable and edge-cacheable. Locked to /icons/ only, so
    // it can never become an open proxy.
    if (path.startsWith("/icons/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
      }
      const upstream = `https://api.weather.gov${path}${url.search}`;
      let res;
      try {
        res = await fetch(upstream, {
          headers: { "User-Agent": "crosbynews.com", Accept: "image/png,image/*" },
          cf: { cacheTtl: 604800, cacheEverything: true },
        });
      } catch {
        return new Response("Icon unavailable", { status: 502 });
      }
      if (!res.ok) {
        return new Response("Icon unavailable", { status: res.status === 404 ? 404 : 502 });
      }
      const headers = new Headers();
      headers.set("content-type", res.headers.get("content-type") || "image/png");
      // Cache hard at the edge and in the browser; icons are effectively static.
      headers.set("cache-control", "public, max-age=86400, s-maxage=604800, immutable");
      return new Response(res.body, { status: 200, headers });
    }

    // Content pages are served in English at the root and in Mexican Spanish
    // under /es. Map an /es request to its English path + a lang flag, then let
    // the shared handlers below render either language. Non-page routes above
    // (API, assets, well-known) never carry an /es prefix, so they're untouched.
    const isEs = path === "/es" || path.startsWith("/es/");
    const lang = isEs ? "es" : "en";
    const page = isEs ? (path === "/es" || path === "/es/" ? "/" : path.slice(3)) : path;

    // About page — content-negotiated like the homepage (HTML, or Markdown for
    // agents via Accept: text/markdown / ?format=md). Static, so cache longer.
    if (page === "/about") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      if (wantsMarkdown) {
        return new Response(aboutMarkdown(lang), {
          headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
        });
      }
      return new Response(aboutHtml(lang), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
      });
    }

    // Developers & agents page — the API/MCP/feeds detail that used to live on
    // /about. Same static content-negotiated treatment.
    if (page === "/developers") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      if (wantsMarkdown) {
        return new Response(developersMarkdown(lang), {
          headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
        });
      }
      return new Response(developersHtml(lang), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
      });
    }

    // Emergency resources page — a static directory of official emergency
    // contacts (911, outages, flooding, shelters, recovery). Same static
    // content-negotiated treatment as /about.
    if (page === "/emergency") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      if (wantsMarkdown) {
        return new Response(emergencyMarkdown(lang), {
          headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
        });
      }
      return new Response(emergencyHtml(lang), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
      });
    }

    // Radar page — the radar image is a separate proxy; loadWeather() is a
    // cheap KV read so the footer can show the same freshness line as the
    // other weather pages.
    if (page === "/radar") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const { data } = await loadWeather(env);
        const bodyText = wantsMarkdown ? radarMarkdown(lang) : radarHtml(lang, data);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=3600",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(wantsMarkdown ? radarMarkdown(lang) : radarHtml(lang), {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=3600",
            vary: "Accept",
          },
        });
      }
    }

    // Proxy the NWS KHGX radar loop through our origin so it's crawlable and
    // edge-cached. Locked to two fixed upstream images (not an open proxy):
    // the animated loop, or — with ?still=1 — the latest single frame, for
    // users who prefer a non-animated image (reduced motion).
    if (path === "/radar-image") {
      const still = url.searchParams.get("still") === "1";
      let res;
      try {
        res = await fetch(`https://radar.weather.gov/ridge/standard/${still ? "KHGX_0.gif" : "KHGX_loop.gif"}`, {
          headers: { "User-Agent": "crosbynews.com", Accept: "image/gif,image/*" },
          cf: { cacheTtl: 180, cacheEverything: true },
        });
      } catch {
        return new Response("Radar unavailable", { status: 502 });
      }
      if (!res.ok) return new Response("Radar unavailable", { status: 502 });
      const headers = new Headers();
      headers.set("content-type", res.headers.get("content-type") || "image/gif");
      // Radar updates every few minutes; cache briefly at the edge and browser.
      headers.set("cache-control", "public, max-age=120, s-maxage=180");
      return new Response(res.body, { status: 200, headers });
    }

    // Hourly forecast page — full multi-day table from the cached NWS data.
    if (page === "/hourly") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const { data } = await loadWeather(env);
        const bodyText = wantsMarkdown ? hourlyMarkdown(data, lang) : hourlyHtml(data, lang);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=300",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Alerts hub — active NWS alerts plus an evergreen severe-weather guide.
    if (page === "/alerts") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const { data } = await loadWeather(env);
        const bodyText = wantsMarkdown ? alertsMarkdown(data, lang) : alertsHtml(data, lang);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=300",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Local news — aggregated + relevance-filtered headlines about Crosby, TX.
    if (page === "/news") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const data = await loadNews(env);
        const bodyText = wantsMarkdown ? newsMarkdown(data, lang) : newsHtml(data, lang);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=900",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Crosby ISD school calendar — rendered from the cached iCal feed.
    if (page === "/water") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const data = await loadWater(env);
        const bodyText = wantsMarkdown ? waterMarkdown(data, lang) : waterHtml(data, lang);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=300",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Atlantic tropical outlook — cron + KV like /water; shows storm cards
    // only when something is active, an all-clear panel otherwise.
    if (page === "/tropics") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const data = await loadTropics(env);
        const bodyText = wantsMarkdown ? tropicsMarkdown(data, lang) : tropicsHtml(data, lang);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=900",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    if (page === "/calendar") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const data = await loadCalendar(env);
        const bodyText = wantsMarkdown ? calendarMarkdown(data, lang) : calendarHtml(data, lang);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=1800",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    if (page === "/privacy") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      if (wantsMarkdown) {
        return new Response(privacyMarkdown(lang), {
          headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
        });
      }
      return new Response(privacyHtml(lang), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
      });
    }

    if (page === "/contact") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      if (wantsMarkdown) {
        return new Response(contactMarkdown(lang), {
          headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
        });
      }
      return new Response(contactHtml(lang), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
      });
    }

    if (page === "/sitemap") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      if (wantsMarkdown) {
        return new Response(sitemapPageMarkdown(lang), {
          headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
        });
      }
      return new Response(sitemapPageHtml(lang), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
      });
    }

    // The full forecast — what the root used to serve, now at its own URL so
    // the root can be a hub. Content-negotiated like every content page.
    if (page === "/weather") {
      try {
        const { data, cache } = await loadWeather(env);
        const accept = (request.headers.get("accept") || "").toLowerCase();
        const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
        if (wantsMarkdown) {
          const md = renderMarkdown(data, lang);
          return new Response(md, {
            headers: {
              "content-type": "text/markdown; charset=utf-8",
              "cache-control": "public, max-age=300",
              vary: "Accept",
              link: linkHeader("/weather", lang),
              "x-markdown-tokens": String(Math.ceil(md.length / 4)),
              "x-cache": cache,
            },
          });
        }
        return new Response(renderHtml(data, lang), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", vary: "Accept", link: linkHeader("/weather", lang), "x-cache": cache },
        });
      } catch (err) {
        return new Response(renderError(err), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Otherwise only the root (and its /es counterpart) serves the hub.
    if (page !== "/") {
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    try {
      // The hub summarizes every section, so it loads all four datasets — in
      // parallel, so one slow source can't serially block the front page. Each
      // loader self-heals on a cold cache; a rejected one shouldn't blank the
      // whole page, so failures degrade to an empty shape.
      const [wRes, water, news, cal, tropics] = await Promise.all([
        loadWeather(env).catch(() => ({ data: { hourly: [], periods: [], alerts: [], updated: null }, cache: "miss-warmfail" })),
        loadWater(env).catch(() => ({ gauges: [] })),
        loadNews(env).catch(() => ({ items: [] })),
        loadCalendar(env).catch(() => ({ events: [] })),
        loadTropics(env).catch(() => ({ storms: [] })),
      ]);
      const weather = wRes.data;

      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";

      if (wantsMarkdown) {
        const md = homeMarkdown(weather, water, news, cal, tropics, lang);
        return new Response(md, {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "cache-control": "public, max-age=300",
            vary: "Accept",
            link: linkHeader("/", lang),
            "x-markdown-tokens": String(Math.ceil(md.length / 4)),
            "x-cache": wRes.cache,
          },
        });
      }

      return new Response(homeHtml(weather, water, news, cal, tropics, lang), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
          vary: "Accept",
          link: linkHeader("/", lang),
          "x-cache": wRes.cache,
        },
      });
    } catch (err) {
      return new Response(renderError(err), {
        status: 502,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
}

// --- Severe-alert Web Push ---------------------------------------------------
// Opt-in browser push for life-threatening warnings only. Design: the Worker
// sends an EMPTY VAPID-authenticated wake-up (no encrypted payload — sidesteps
// the ECDH/HKDF/AES-GCM payload encryption entirely); the service worker
// composes the notification locally from /api/weather. We store only an
// anonymous push endpoint + its keys (no personal data), one KV entry per
// subscription under the `push:` prefix, and prune dead ones on 404/410.
const PUSH_PREFIX = "push:";
const PUSH_NOTIFIED_KEY = "push_notified"; // alert IDs already pushed (dedupe)
// Warnings that earn a push — warnings only, never watches/advisories. Kept in
// sync with PUSH_EVENTS in SW_SCRIPT.
const SEVERE_PUSH_EVENTS = new Set([
  "Tornado Warning",
  "Flash Flood Warning",
  "Hurricane Warning",
  "Hurricane Force Wind Warning",
  "Extreme Wind Warning",
  "Tropical Storm Warning",
]);
// SSRF guard: the cron POSTs to whatever endpoint a subscription stored, so we
// only ever accept real browser push-service hosts. Without this, a crafted
// subscribe body could turn our cron into an SSRF vector.
const PUSH_HOST_ALLOW = [
  /\.googleapis\.com$/, // FCM (Chrome/Edge/Android)
  /\.push\.apple\.com$/, // Safari/iOS
  /\.notify\.windows\.com$/, // legacy Edge/Windows
  /\.push\.services\.mozilla\.com$/, // Firefox
];
function pushEndpointAllowed(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOST_ALLOW.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

const b64urlToBytes = (s) => {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const bytesToB64url = (bytes) => {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlJson = (obj) => bytesToB64url(new TextEncoder().encode(JSON.stringify(obj)));

// Build a VAPID Authorization header for a given push endpoint. Signs a short
// ES256 JWT (WebCrypto ECDSA P-256 already yields the raw r||s form JWS wants,
// so no DER unwrapping) with the private JWK secret. Returns null if the
// VAPID secrets aren't configured, so the whole feature no-ops safely.
async function vapidAuth(endpoint, env) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return null;
  const { origin } = new URL(endpoint);
  const jwk = JSON.parse(env.VAPID_PRIVATE_KEY);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64urlJson({ typ: "JWT", alg: "ES256" });
  const payload = b64urlJson({ aud: origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:security@crosbynews.com" });
  const unsigned = `${header}.${payload}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${bytesToB64url(sig)}`;
  return { Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}` };
}

// Send one empty wake-up. 201/202 = accepted; 404/410 = subscription gone
// (caller prunes). Returns the HTTP status (or 0 on network error).
async function sendPush(subscription, env) {
  const headers = await vapidAuth(subscription.endpoint, env);
  if (!headers) return 0;
  try {
    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: { ...headers, TTL: "3600", "Content-Length": "0", Urgency: "high" },
    });
    return res.status;
  } catch (e) {
    console.error("push send failed:", e && e.message);
    return 0;
  }
}

// A stable KV key for a subscription (hash of its endpoint), so re-subscribing
// the same browser overwrites rather than duplicates.
async function pushKeyFor(endpoint) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return PUSH_PREFIX + [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Cron hook: if any NEW severe warning is active (not already notified), wake
// every subscriber once, then remember the alert IDs so ongoing warnings don't
// re-notify every 15 minutes. Prunes dead subscriptions and stale notified IDs.
async function pushSevereAlerts(env, alerts) {
  if (!env.VAPID_PRIVATE_KEY) return; // feature not configured
  const severe = (alerts ?? []).filter((a) => SEVERE_PUSH_EVENTS.has(a.event));
  const activeIds = severe.map((a) => a.id).filter(Boolean);
  let notified = [];
  try {
    notified = (await env.WEATHER.get(PUSH_NOTIFIED_KEY, "json")) || [];
  } catch {}
  const fresh = activeIds.filter((id) => !notified.includes(id));
  // Always reconcile the notified set to only-currently-active IDs (so an alert
  // that clears and later reissues under a new ID can notify again).
  const nextNotified = activeIds.slice();
  if (JSON.stringify(nextNotified.sort()) !== JSON.stringify([...notified].sort())) {
    await env.WEATHER.put(PUSH_NOTIFIED_KEY, JSON.stringify(nextNotified));
  }
  if (!fresh.length) return; // nothing new to announce

  const list = await env.WEATHER.list({ prefix: PUSH_PREFIX });
  for (const k of list.keys) {
    let sub = null;
    try {
      sub = await env.WEATHER.get(k.name, "json");
    } catch {}
    if (!sub || !sub.endpoint) {
      await env.WEATHER.delete(k.name);
      continue;
    }
    const status = await sendPush(sub, env);
    if (status === 404 || status === 410) await env.WEATHER.delete(k.name); // gone — prune
  }
}
// --- end Severe-alert Web Push -----------------------------------------------

// The content pages, each its own canonical URL. Their responses get an HTTP
// `Link: rel="canonical"` header in the wrapper below, so the content-negotiated
// `?format=md` variants — and the http→https pair — consolidate onto one URL for
// crawlers that read the HTTP layer (reinforces the in-HTML <link rel="canonical">).
const PAGE_PATHS = new Set([
  "/", "/weather", "/hourly", "/radar", "/alerts", "/water", "/tropics", "/news", "/calendar", "/emergency", "/about", "/developers", "/privacy", "/contact", "/sitemap",
  "/es", "/es/weather", "/es/hourly", "/es/radar", "/es/alerts", "/es/water", "/es/tropics", "/es/news", "/es/calendar", "/es/emergency", "/es/about", "/es/developers", "/es/privacy", "/es/contact", "/es/sitemap",
]);

export default {
  async fetch(request, env, ctx) {
    const resp = await _fetch(request, env, ctx);
    const r = new Response(resp.body, resp);
    r.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains");
    r.headers.set("x-frame-options", "SAMEORIGIN");
    r.headers.set("content-security-policy", await contentSecurityPolicy());
    r.headers.set("cross-origin-opener-policy", "same-origin");
    // Every response declares its content-type accurately, so forbid sniffing.
    r.headers.set("x-content-type-options", "nosniff");
    r.headers.set("referrer-policy", "strict-origin-when-cross-origin");
    // No page uses these browser features; browsing-topics opts out of the
    // Topics API, matching the site's no-trackers stance.
    r.headers.set("permissions-policy", "geolocation=(), camera=(), microphone=(), browsing-topics=()");
    // Reinforce the https canonical at the HTTP layer for the content pages, so
    // ?format=md variants (and any http→https confusion) consolidate onto one URL.
    const { pathname } = new URL(request.url);
    if (PAGE_PATHS.has(pathname)) {
      const canonical = `<${SITE}${pathname}>; rel="canonical"`;
      const existing = r.headers.get("link");
      r.headers.set("link", existing ? `${existing}, ${canonical}` : canonical);
    }
    return r;
  },

  async scheduled(event, env, ctx) {
    // Refresh the weather cache. News is NOT fetched here — it's written to the
    // KV "news" key out-of-band by scripts/fetch-news.mjs (a Claude routine),
    // because Google News blocks Worker IPs. The Worker only renders that key.
    try {
      const data = await fetchWeather();
      await env.WEATHER.put(KV_KEY, JSON.stringify(data));
      // After a fresh forecast, wake push subscribers for any NEW severe
      // warning. Independent of the writes below; a push failure is logged and
      // never blocks the cache refresh (own try/catch inside).
      try {
        await pushSevereAlerts(env, data.alerts);
      } catch (e) {
        console.error("Cron push dispatch failed:", e && e.stack);
      }
    } catch (e) {
      console.error("Cron weather refresh failed:", e && e.stack);
    }
    // Refresh the Crosby ISD school calendar at most ~every 6h (it changes
    // rarely and the Worker CAN reach crosbyisd.org). Independent try/catch so a
    // calendar hiccup never affects the weather refresh above.
    try {
      const cur = await env.WEATHER.get(CALENDAR_KV_KEY, "json");
      const age = cur?.updated ? Date.now() - new Date(cur.updated).getTime() : Infinity;
      if (!cur || !Array.isArray(cur.events) || age > 6 * 3600 * 1000) {
        await env.WEATHER.put(CALENDAR_KV_KEY, JSON.stringify(await fetchCalendar()));
      }
    } catch (e) {
      console.error("Cron calendar refresh failed:", e && e.stack);
    }
    // Refresh river/bayou levels every tick (levels move fast in a flood).
    // fetchWater() throws on a total NWPS outage, so we skip the write and the
    // last good snapshot survives. Independent try/catch from the above.
    try {
      await env.WEATHER.put(WATER_KV_KEY, JSON.stringify(await fetchWater()));
    } catch (e) {
      console.error("Cron water refresh failed:", e && e.stack);
    }
    // Refresh the Atlantic tropical outlook at most ~hourly (NHC advisories
    // update every 2-6h). fetchTropics() throws on failure, so a transient
    // NHC outage skips the write and the last snapshot survives.
    try {
      const cur = await env.WEATHER.get(TROPICS_KV_KEY, "json");
      const age = cur?.updated ? Date.now() - new Date(cur.updated).getTime() : Infinity;
      if (!cur || !Array.isArray(cur.storms) || age > 3600 * 1000) {
        await env.WEATHER.put(TROPICS_KV_KEY, JSON.stringify(await fetchTropics()));
      }
    } catch (e) {
      console.error("Cron tropics refresh failed:", e && e.stack);
    }
  },
};
