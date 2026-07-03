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

  // 2. Daily forecast, hourly forecast, and active alerts are independent.
  const [forecast, hourly, alertsData] = await Promise.all([
    getJson(forecastUrl),
    getJson(hourlyUrl),
    getJson(`https://api.weather.gov/alerts/active?point=${LAT},${LON}`),
  ]);

  return {
    updated: new Date().toISOString(),
    place: place ? `${place.city}, ${place.state}` : "Crosby, TX",
    periods: forecast.properties.periods ?? [],
    // Keep 48 hours: the homepage shows the first 12, /hourly shows them all.
    hourly: (hourly.properties.periods ?? []).slice(0, 48),
    alerts: (alertsData.features ?? []).map((f) => f.properties),
  };
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
// formulas (Rothfusz heat-index regression; NWS wind-chill equation), applied
// to the temperature/humidity/wind NWS already gives us. Not a separate NWS
// field, so it's derived, not fetched — kept honest by documenting the source
// (OpenAPI schema, /about) rather than presenting it as raw upstream data.
// Heat index: valid/meaningful at T >= 80°F (NWS's own applicability floor).
function heatIndexF(tempF, rhPercent) {
  if (typeof tempF !== "number" || typeof rhPercent !== "number" || tempF < 80) return null;
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
  const now = data.hourly?.[0];
  const lead = data.periods?.[0];
  // Degenerate NWS response (zero hourly periods): suppress the hero panel but
  // still emit the page's single <h1> so it never renders heading-less.
  if (!now) return `<h1>${T(lang, `${esc(data.place)} Weather`, `Clima en ${esc(data.place)}`)}</h1>`;
  const feels = feelsLikeF(now);
  const sun = sunTimesForCtDate(Date.now());
  return `
    <section class="hero">
      ${now.icon ? `<img class="hero-icon" src="${iconUrl(now.icon, "large")}" alt="${esc(translateConditions(now.shortForecast, lang))}" width="128" height="128" fetchpriority="high">` : ""}
      <div class="hero-now">
        <h1 class="hero-h1">${T(lang, `${esc(data.place)} Weather`, `Clima en ${esc(data.place)}`)}</h1>
        <p class="hero-temp">${esc(now.temperature)}&deg;<span>${esc(now.temperatureUnit)}</span></p>
        <p class="hero-cond">${esc(translateConditions(now.shortForecast, lang))}</p>
        ${feels != null ? `<p class="hero-feels">${T(lang, "Feels like", "Sensación térmica de")} ${esc(feels)}&deg;</p>` : ""}
        <p class="hero-meta">${esc(data.place)} &middot; ${T(lang, "as of", "a las")} ${esc(clockTime(now.startTime, lang))} CT${pop(now) ? ` &middot; ${pop(now)}% ${T(lang, "precip", "prob. lluvia")}` : ""}</p>
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
  /* Desktop: show the nav links inline. Modern Chromium hides closed-<details>
     content via ::details-content { content-visibility:hidden }, which
     display:contents does NOT override — without this the desktop nav vanishes. */
  .nav-menu::details-content { content-visibility: visible; }
  @media (max-width:600px) {
    .topbar { gap:0.35rem 0.6rem; padding:0.55rem 0.85rem; flex-wrap:nowrap; }
    .topbar .brand { font-size:0.88rem; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .topbar nav { gap:0.4rem 0.6rem; font-size:0.86rem; flex:0 0 auto; flex-wrap:nowrap; }
    .topbar nav .lang { order:1; }
    .topbar nav .nav-menu { order:2; }
    .nav-menu { display:block; position:relative; }
    .nav-menu summary { display:inline-block; cursor:pointer; list-style:none; font-size:1.3rem; line-height:1; opacity:0.9; color:#fff; padding:0; }
    .nav-menu summary::-webkit-details-marker { display:none; }
    .nav-links { display:none; }
    .nav-menu[open] .nav-links { display:flex; flex-direction:column; position:absolute; right:0; top:calc(100% + 0.4rem); background:var(--blue); padding:0.6rem 1rem; border-radius:0 0 8px 8px; z-index:10; gap:0.4rem; min-width:11rem; box-shadow:0 4px 12px rgba(0,0,0,0.3); }
    .nav-links a { opacity:0.9; white-space:nowrap; padding:0.25rem 0; }
    .nav-links a:hover, .nav-links a[aria-current="page"] { opacity:1; text-decoration:underline; }
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
  const link = (enHref, label) =>
    `<a href="${es ? esPath(enHref) : enHref}"${current === enHref ? ' aria-current="page"' : ""}>${label}</a>`;
  const t = (en, esLabel) => (es ? esLabel : en);
  const toggle = es
    ? `<a class="lang" hreflang="en-US" lang="en" href="${current}">English</a>`
    : `<a class="lang" hreflang="es-MX" lang="es" href="${esPath(current)}">Español</a>`;
  return `<header class="topbar">
  <a class="brand" href="${es ? "/es" : "/"}">crosbynews.com</a>
  <nav>
    <details class="nav-menu">
      <summary aria-label="${t("Menu", "Menú")}">&#9776;</summary>
      <div class="nav-links">${link("/", t("Weather", "Clima"))} ${link("/hourly", t("Hourly", "Por hora"))} ${link("/radar", t("Radar", "Radar"))} ${link("/alerts", t("Alerts", "Alertas"))} ${link("/news", t("News", "Noticias"))} ${link("/calendar", t("School Calendar", "Calendario escolar"))} ${link("/about", t("About", "Acerca de"))}</div>
    </details>
    ${toggle}
  </nav>
</header>`;
}

const WEATHER_PAGES = new Set(["/", "/hourly", "/radar", "/alerts"]);

function footer({ page, lang = "en", source, data }) {
  const es = lang === "es";
  const lk = (enHref, label) => `<a href="${es ? esPath(enHref) : enHref}">${label}</a>`;
  const mdHref = (es ? esPath(page) : page) + "?format=md";

  const weatherLine = WEATHER_PAGES.has(page) && data
    ? `${!(data.alerts ?? []).length ? T(lang, "No active weather alerts. ", "Sin alertas meteorológicas activas. ") : ""}${source}<br>
  ${T(lang, "Updated", "Actualizado")} ${esc(fullTime(data.updated, lang))} CT &middot; ${T(lang, "refreshes every 15 minutes.", "se actualiza cada 15 minutos.")}`
    : source;

  const links = `<div class="footer-links">${lk("/", T(lang, "Home", "Inicio"))} &middot; ${lk("/about", T(lang, "About", "Acerca de"))} &middot; ${lk("/privacy", T(lang, "Privacy", "Privacidad"))} &middot; ${lk("/contact", T(lang, "Contact", "Contacto"))} &middot; ${lk("/sitemap", T(lang, "Sitemap", "Mapa del sitio"))} &middot; <a href="${mdHref}">${T(lang, "View as Markdown", "Ver en Markdown")}</a></div>`;

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
<meta name="msvalidate.01" content="71B0F51AEDA395D9136070A67436D4F9">
<meta property="og:title" content="${T(lang, "Crosby, TX Weather", "Clima de Crosby, TX")}">
<meta property="og:description" content="${T(lang, "Live forecast and active alerts for Crosby, Texas.", "Pronóstico del tiempo y alertas activas para Crosby, Texas.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/", lang)}">
${hreflangTags("/")}
${JSONLD_SITE}
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
${topbar("/", lang)}
<main>
  ${renderAlerts(data.alerts ?? [], lang)}
  ${renderHero(data, lang)}
  ${lang === "es" ? `<p class="lead nws-note">${ES_NWS_NOTE}</p>` : ""}
  ${renderHourly((data.hourly ?? []).slice(0, 12), lang)}
  ${renderDaily(data.periods ?? [], lang)}
</main>
${footer({ page: "/", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`), data })}
<script>${HOME_SCRIPT}</script>
</body>
</html>`;
}

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

// /llms.txt — concise site summary for LLMs (llmstxt.org spec).
function llmsTxt() {
  return `# crosbynews.com

> Live weather and local news for Crosby, Texas — fast, no ads, no trackers.

crosbynews.com is an independent weather and news site for Crosby, TX (northeast Harris County). Weather data comes exclusively from the U.S. National Weather Service (api.weather.gov) and is refreshed every 15 minutes. Local news headlines are aggregated daily from Texas and Houston-area outlets and filtered for relevance to the Crosby community.

## Pages

- [Weather](${SITE}/): Current conditions, 12-hour hourly strip, and 7-day forecast for Crosby, TX.
- [Hourly](${SITE}/hourly): Full 48-hour hour-by-hour forecast table grouped by day.
- [Radar](${SITE}/radar): Live NWS KHGX (Houston-Galveston) radar loop covering Crosby and northeast Harris County.
- [Alerts](${SITE}/alerts): Active NWS weather alerts for Crosby, TX plus a plain-language severe-weather guide.
- [News](${SITE}/news): Recent local headlines about Crosby, TX and nearby communities, filtered for relevance.
- [School Calendar](${SITE}/calendar): Upcoming Crosby ISD school calendar events (first day, holidays, no-school/early-release days, testing, athletics) rendered from the district's public iCal feed, plus one-tap subscribe links.
- [About](${SITE}/about): What this site is, where data comes from, and how to access the API and MCP server.
- [Privacy](${SITE}/privacy): Privacy policy — no cookies, no trackers, no personal data.
- [Contact](${SITE}/contact): How to reach us — general inquiries and security reporting.
- [Sitemap](${SITE}/sitemap): Human-readable site map with every page and endpoint.

## Languages

Every page is also available in Mexican Spanish (es-MX) under the /es prefix — e.g. ${SITE}/es, ${SITE}/es/hourly, ${SITE}/es/alerts, ${SITE}/es/about. The English and Spanish URLs are linked with hreflang. Forecast conditions are translated with a hand-built dictionary; detailed NWS forecast descriptions and weather alerts remain in official English (NWS publishes no Spanish forecast/alert API). The JSON API and MCP server are English-only.

## API & agent access

Every page supports \`Accept: text/markdown\` (or \`?format=md\`) for a clean markdown rendering.

- REST API: \`GET ${SITE}/api/weather\` — JSON with current conditions, hourly, 7-day forecast, and alerts. No auth.
- OpenAPI spec: \`${SITE}/openapi.json\`
- MCP server (Streamable HTTP): \`${SITE}/mcp\` — tools: \`get_current_conditions\`, \`get_forecast\`, \`get_alerts\`
- MCP server card: \`${SITE}/.well-known/mcp/server-card.json\`

## Data policy

Source data is U.S. government public domain (NWS). No authentication required. No rate limits. Attribution: "U.S. National Weather Service".

## Optional

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
    { path: "/hourly", changefreq: "hourly", priority: "0.8", lastmod: true },
    { path: "/radar", changefreq: "daily", priority: "0.7" },
    { path: "/alerts", changefreq: "hourly", priority: "0.7" },
    { path: "/news", changefreq: "daily", priority: "0.6" },
    { path: "/calendar", changefreq: "daily", priority: "0.6" },
    { path: "/about", changefreq: "monthly", priority: "0.5" },
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
    "What crosbynews.com is, where its weather data comes from, how often it updates, and the public API and MCP server it offers.",
  intro:
    "crosbynews.com is a fast, no-frills weather page for Crosby, Texas. It shows current conditions, an hourly outlook, a 7-day forecast, and any active weather alerts — and nothing else. No ads, no trackers, no sign-up.",
  sections: [
    {
      h: "Where the data comes from",
      p: [
        "Every forecast, conditions reading, and alert on this site comes directly from the U.S. National Weather Service (api.weather.gov) for Crosby, TX (latitude 29.9119, longitude -95.0608). NWS data is in the public domain.",
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
      h: "A weather API for developers and agents",
      p: [
        "The same data powering this page is available as a free, public, no-authentication JSON API:",
      ],
      links: [
        { href: "/api/weather", label: "/api/weather", note: "current conditions, hourly, 7-day forecast, and alerts (JSON)" },
        { href: "/api/health", label: "/api/health", note: "service status and cache freshness" },
        { href: "/openapi.json", label: "/openapi.json", note: "OpenAPI 3.1 description of the API" },
        { href: "/.well-known/api-catalog", label: "/.well-known/api-catalog", note: "RFC 9727 API catalog" },
      ],
    },
    {
      h: "Built for AI agents",
      p: [
        "This site is designed to be readable by AI agents as well as people. Every page is available as Markdown (send an Accept: text/markdown header, or add ?format=md to the URL), and there is a Model Context Protocol (MCP) server that exposes the weather as callable tools.",
      ],
      links: [
        { href: "/mcp", label: "/mcp", note: "MCP server (Streamable HTTP): get_current_conditions, get_forecast, get_alerts" },
        { href: "/.well-known/mcp/server-card.json", label: "MCP server card", note: "discovery metadata" },
        { href: "/llms.txt", label: "/llms.txt", note: "plain-language site summary for LLMs (llmstxt.org)" },
        { href: "/?format=md", label: "This site as Markdown", note: "the weather page, rendered for agents" },
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
    "Qué es crosbynews.com, de dónde provienen sus datos del tiempo, con qué frecuencia se actualiza y la API pública y el servidor MCP que ofrece.",
  intro:
    "crosbynews.com es una página del tiempo rápida y sencilla para Crosby, Texas. Muestra las condiciones actuales, un pronóstico por hora, un pronóstico a 7 días y cualquier alerta meteorológica activa, y nada más. Sin anuncios, sin rastreadores, sin registro.",
  sections: [
    {
      h: "De dónde provienen los datos",
      p: [
        "Cada pronóstico, lectura de condiciones y alerta de este sitio proviene directamente del Servicio Meteorológico Nacional de EE. UU. (api.weather.gov) para Crosby, TX (latitud 29.9119, longitud -95.0608). Los datos del NWS son de dominio público.",
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
      h: "Una API del tiempo para desarrolladores y agentes",
      p: [
        "Los mismos datos que alimentan esta página están disponibles como una API JSON gratuita, pública y sin autenticación (la API se ofrece en inglés):",
      ],
      links: [
        { href: "/api/weather", label: "/api/weather", note: "condiciones actuales, por hora, pronóstico a 7 días y alertas (JSON)" },
        { href: "/api/health", label: "/api/health", note: "estado del servicio y antigüedad de la caché" },
        { href: "/openapi.json", label: "/openapi.json", note: "descripción OpenAPI 3.1 de la API" },
        { href: "/.well-known/api-catalog", label: "/.well-known/api-catalog", note: "catálogo de API (RFC 9727)" },
      ],
    },
    {
      h: "Hecho para agentes de IA",
      p: [
        "Este sitio está diseñado para que lo lean tanto las personas como los agentes de IA. Cada página está disponible en Markdown (envía un encabezado Accept: text/markdown, o agrega ?format=md a la URL) y hay un servidor del Protocolo de Contexto de Modelo (MCP) que expone el tiempo como herramientas invocables.",
      ],
      links: [
        { href: "/mcp", label: "/mcp", note: "servidor MCP (Streamable HTTP): get_current_conditions, get_forecast, get_alerts" },
        { href: "/.well-known/mcp/server-card.json", label: "Tarjeta del servidor MCP", note: "metadatos de descubrimiento" },
        { href: "/llms.txt", label: "/llms.txt", note: "resumen del sitio en lenguaje sencillo para LLM (llmstxt.org)" },
        { href: "/es?format=md", label: "Este sitio en Markdown", note: "la página del tiempo, en español para agentes" },
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
        "The site displays data from three external sources. None of these involve sharing any user data with those sources:",
        "U.S. National Weather Service (api.weather.gov) — public-domain weather forecasts, conditions, and alerts for Crosby, TX. The Worker fetches this data server-side; your browser never contacts the NWS directly.",
        "Google News — local news headlines are aggregated from public RSS feeds by an out-of-band process and cached. Your browser never contacts Google News directly.",
        "Crosby ISD (crosbyisd.org) — the school district's public iCal calendar feed is fetched server-side and cached. Your browser never contacts Crosby ISD directly.",
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
        "El sitio muestra datos de tres fuentes externas. Ninguna de ellas implica compartir datos de usuario con dichas fuentes:",
        "Servicio Meteorológico Nacional de EE. UU. (api.weather.gov) — pronósticos, condiciones y alertas de dominio público para Crosby, TX. El Worker obtiene estos datos del lado del servidor; tu navegador nunca contacta al NWS directamente.",
        "Google News — los titulares de noticias locales se recopilan de fuentes RSS públicas mediante un proceso externo y se almacenan en caché. Tu navegador nunca contacta a Google News directamente.",
        "Crosby ISD (crosbyisd.org) — el calendario público iCal del distrito escolar se obtiene del lado del servidor y se almacena en caché. Tu navegador nunca contacta a Crosby ISD directamente.",
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
<main>
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
<main>
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
<main>
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
<main>
  <h1>${esc(title)}</h1>
  <p class="lede">${esc(description)}</p>

  <section class="card">
    <h2>${t("Weather &amp; Forecast", "Clima y pronóstico")}</h2>
    <ul>
      ${lk("/", t("Weather", "Clima"), t("Current conditions, 12-hour hourly strip, and 7-day forecast.", "Condiciones actuales, franja horaria de 12 horas y pronóstico a 7 días."))}
      ${lk("/hourly", t("Hourly Forecast", "Pronóstico por hora"), t("Full 48-hour hour-by-hour forecast table.", "Tabla completa de pronóstico hora por hora de 48 horas."))}
      ${lk("/radar", t("Radar", "Radar"), t("Live NWS KHGX radar loop for the Crosby area.", "Radar en vivo del NWS KHGX para la zona de Crosby."))}
      ${lk("/alerts", t("Alerts", "Alertas"), t("Active NWS weather alerts plus a severe-weather guide.", "Alertas meteorológicas activas del NWS más una guía de clima severo."))}
    </ul>
  </section>

  <section class="card">
    <h2>${t("Community", "Comunidad")}</h2>
    <ul>
      ${lk("/news", t("News", "Noticias"), t("Local headlines about Crosby, TX and nearby communities.", "Titulares locales sobre Crosby, TX y comunidades cercanas."))}
      ${lk("/calendar", t("School Calendar", "Calendario escolar"), t("Upcoming Crosby ISD school calendar events.", "Próximos eventos del calendario escolar de Crosby ISD."))}
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
      ${extLk("/api/weather", t("Weather API", "API del clima"), t("JSON: current conditions, hourly, 7-day, and alerts.", "JSON: condiciones actuales, por hora, 7 días y alertas."))}
      ${extLk("/api/health", t("Health Check", "Estado del servicio"), t("Service status and cache freshness.", "Estado del servicio y antigüedad de la caché."))}
      ${extLk("/openapi.json", "OpenAPI 3.1", t("Machine-readable API description.", "Descripción de la API legible por máquinas."))}
      ${extLk("/mcp", t("MCP Server", "Servidor MCP"), t("Model Context Protocol server (Streamable HTTP).", "Servidor del Protocolo de Contexto de Modelo (Streamable HTTP)."))}
      ${extLk("/llms.txt", "llms.txt", t("Plain-language site summary for LLMs.", "Resumen del sitio en lenguaje sencillo para LLM."))}
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
    lk("/", t("Weather", "Clima"), t("Current conditions, hourly, and 7-day forecast.", "Condiciones actuales, por hora y pronóstico a 7 días.")),
    lk("/hourly", t("Hourly Forecast", "Pronóstico por hora"), t("Full 48-hour table.", "Tabla completa de 48 horas.")),
    lk("/radar", t("Radar", "Radar"), t("Live NWS KHGX radar loop.", "Radar en vivo del NWS KHGX.")),
    lk("/alerts", t("Alerts", "Alertas"), t("Active weather alerts plus severe-weather guide.", "Alertas activas más guía de clima severo.")),
    "",
    `## ${t("Community", "Comunidad")}`,
    "",
    lk("/news", t("News", "Noticias"), t("Local headlines.", "Titulares locales.")),
    lk("/calendar", t("School Calendar", "Calendario escolar"), t("Crosby ISD events.", "Eventos de Crosby ISD.")),
    "",
    `## ${t("About & Policies", "Acerca de y políticas")}`,
    "",
    lk("/about", t("About", "Acerca de"), t("Data sources, API, MCP server.", "Fuentes de datos, API, servidor MCP.")),
    lk("/privacy", t("Privacy", "Privacidad"), t("No cookies, no trackers.", "Sin cookies, sin rastreadores.")),
    lk("/contact", t("Contact", "Contacto"), t("Questions, tips, security.", "Preguntas, datos, seguridad.")),
    "",
    `## ${t("For Developers & Agents", "Para desarrolladores y agentes")}`,
    "",
    extLk("/api/weather", t("Weather API", "API del clima"), "JSON"),
    extLk("/api/health", t("Health", "Estado"), t("Status + cache.", "Estado + caché.")),
    extLk("/openapi.json", "OpenAPI 3.1", t("API spec.", "Especificación de la API.")),
    extLk("/mcp", t("MCP Server", "Servidor MCP"), "Streamable HTTP"),
    extLk("/llms.txt", "llms.txt", t("LLM summary.", "Resumen para LLM.")),
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
<main>
  <h1>${esc(title)}</h1>
  <p class="intro">${T(lang, "Live radar for the Crosby / northeast Houston area from the U.S. National Weather Service KHGX (Houston-Galveston) radar. The loop animates the most recent reflectivity scans, showing showers and thunderstorms moving across the region.", "Radar en vivo para Crosby y el noreste de Houston, del radar KHGX (Houston-Galveston) del Servicio Meteorológico Nacional de EE. UU. La animación reproduce los escaneos de reflectividad más recientes, mostrando chubascos y tormentas que se desplazan por la región.")}</p>
  <div class="radar-wrap">
    <img src="/radar-image" alt="${T(lang, "Animated NWS weather radar loop for Crosby, TX (KHGX)", "Animación del radar meteorológico del NWS para Crosby, TX (KHGX)")}" width="600" height="550" loading="eager">
    <p class="radar-meta">${T(lang, "Source: NOAA/NWS KHGX radar &middot; the loop refreshes as new scans publish (roughly every few minutes).", "Fuente: radar KHGX de NOAA/NWS &middot; la animación se actualiza conforme se publican nuevos escaneos (cada pocos minutos).")}</p>
  </div>
  <section class="card">
    <h2>${T(lang, "Reading this radar", "Cómo leer este radar")}</h2>
    <p>${T(lang, "Color indicates precipitation intensity. Blues and greens are light rain; yellows and oranges are moderate; reds and purples indicate heavy rainfall or large hail. The animation plays the most recent reflectivity scans in sequence so you can see storms moving across the region.", "El color indica la intensidad de la precipitación. Los azules y verdes son lluvia ligera; los amarillos y naranjas, moderada; los rojos y morados indican lluvia intensa o granizo grande. La animación reproduce los escaneos de reflectividad más recientes en secuencia para que veas las tormentas moverse por la región.")}</p>
    <p>${T(lang, `The KHGX radar is sited at Galveston Bay, roughly 40 miles south of Crosby, giving it a low-angle view of storms approaching from the Gulf. Crosby sits in northeast Harris County, a low-lying area that is especially prone to flash flooding during slow-moving Gulf Coast storms. A rotating hook echo or tight circulation on the southwest flank of a storm cell can indicate a tornado threat &mdash; check <a href="/alerts">active alerts</a> for any warnings already issued by the National Weather Service.`, `El radar KHGX está ubicado en la bahía de Galveston, a unos 65 km al sur de Crosby, lo que le da una vista de ángulo bajo de las tormentas que se acercan desde el Golfo. Crosby se encuentra en el noreste del condado de Harris, una zona baja especialmente propensa a inundaciones repentinas durante las tormentas lentas de la costa del Golfo. Un eco en forma de gancho o una circulación cerrada en el flanco suroeste de una celda de tormenta puede indicar amenaza de tornado &mdash; consulta las <a href="/es/alerts">alertas activas</a> para ver cualquier aviso ya emitido por el Servicio Meteorológico Nacional.`)}</p>
    <p>${T(lang, `During hurricane season (June&ndash;November) the radar helps track the outer rain bands of tropical systems well before they make landfall. The <a href="https://www.weather.gov/hgx/">NWS Houston/Galveston office</a> is the authoritative source for warnings and watches covering Crosby.`, `Durante la temporada de huracanes (junio&ndash;noviembre) el radar ayuda a rastrear las bandas de lluvia exteriores de los sistemas tropicales mucho antes de que toquen tierra. La <a href="https://www.weather.gov/hgx/">oficina del NWS en Houston/Galveston</a> es la fuente autorizada de avisos y vigilancias para Crosby.`)}</p>
  </section>
  <p class="intro"><a href="${lang === "es" ? "/es" : "/"}">&larr; ${T(lang, "Back to the Crosby forecast", "Volver al pronóstico de Crosby")}</a></p>
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
    `[crosbynews.com](${canonicalFor("/", lang)}) · [${T(lang, "forecast", "pronóstico")}](${canonicalFor("/", lang)}) · [${T(lang, "hourly", "por hora")}](${canonicalFor("/hourly", lang)})`,
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
        .map(
          (h) => `<tr>
        <td>${esc(hourLabel(h.startTime, lang))}</td>
        <td>${h.icon ? `<img src="${iconUrl(h.icon, "small")}" alt="${esc(translateConditions(h.shortForecast, lang))}" width="32" height="32" loading="lazy"> ` : ""}${esc(translateConditions(h.shortForecast, lang))}</td>
        <td class="num">${esc(h.temperature)}&deg;${esc(h.temperatureUnit)}</td>
        <td class="num">${feelsLikeRawF(h) != null ? esc(feelsLikeRawF(h)) + "°" : "–"}</td>
        <td class="num${pop(h) >= 30 ? " wet" : ""}">${pop(h)}%</td>
        <td class="wind">${esc(translateWind(h.windSpeed, lang))} ${esc(translateDir(h.windDirection, lang))}</td>
      </tr>`
        )
        .join("\n");
      const sun = sunTimesForCtDate(Date.parse(g.rows[0].startTime));
      const sunLine = sun
        ? ` <span class="day-sun">${T(lang, "Sunrise", "Amanecer")} ${esc(clockTime(sun.sunrise, lang))} &middot; ${T(lang, "Sunset", "Atardecer")} ${esc(clockTime(sun.sunset, lang))}</span>`
        : "";
      return `  <section class="day">
    <h2>${esc(g.day)}${sunLine}</h2>
    <table>
      <thead><tr><th>${T(lang, "Time", "Hora")}</th><th>${T(lang, "Conditions", "Condiciones")}</th><th class="num">${T(lang, "Temp", "Temp")}</th><th class="num">${T(lang, "Feels", "Sensación")}</th><th class="num">${T(lang, "Precip", "Prob.")}</th><th>${T(lang, "Wind", "Viento")}</th></tr></thead>
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
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .day { margin-top:1rem; background:var(--card); border-radius:12px; padding:0.5rem 0.9rem 0.9rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .day h2 { font-size:1.05rem; }
  .day-sun { font-weight:400; font-size:0.78rem; color:var(--muted); margin-left:0.5rem; white-space:nowrap; }
  table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  th, td { text-align:left; padding:0.4rem 0.5rem; border-bottom:1px solid var(--line); vertical-align:middle; }
  th { font-size:0.78rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); }
  td img { vertical-align:middle; border-radius:4px; }
  .num { text-align:right; white-space:nowrap; }
  .wet { color:var(--accent); font-weight:700; }
  .wind { color:var(--muted); white-space:nowrap; }
  tr:last-child td { border-bottom:none; }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
</style>
</head>
<body>
${topbar("/hourly", lang)}
<main>
  <h1>${T(lang, "Crosby, TX Hourly Forecast", "Pronóstico por hora de Crosby, TX")}</h1>
  <p class="intro">${T(lang, `Hour-by-hour forecast for Crosby, Texas from the U.S. National Weather Service, covering the next ${hours.length} hours. Updated ${esc(fullTime(data.updated))} CT.`, `Pronóstico hora por hora para Crosby, Texas del Servicio Meteorológico Nacional de EE. UU., para las próximas ${hours.length} horas. Actualizado ${esc(fullTime(data.updated, lang))} CT.`)}</p>
  ${lang === "es" ? `<p class="intro nws-note">${ES_NWS_NOTE}</p>` : ""}
${body || `<p class="none">${T(lang, "Hourly forecast is temporarily unavailable.", "El pronóstico por hora no está disponible temporalmente.")}</p>`}
  <p class="intro"><a href="${lang === "es" ? "/es" : "/"}">&larr; ${T(lang, "Back to the Crosby forecast", "Volver al pronóstico de Crosby")}</a> &middot; <a href="${lang === "es" ? "/es/radar" : "/radar"}">Radar</a></p>
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
      out.push(`## ${day}`, "");
      if (sun) out.push(`_${T(lang, "Sunrise", "Amanecer")} ${clockTime(sun.sunrise, lang)} · ${T(lang, "Sunset", "Atardecer")} ${clockTime(sun.sunset, lang)}_`, "");
      out.push(T(lang, "| Time | Conditions | Temp | Feels | Precip | Wind |", "| Hora | Condiciones | Temp | Sensación | Prob. | Viento |"), "| --- | --- | --- | --- | --- | --- |");
    }
    const cell = (s) => String(s ?? "").replace(/\|/g, "/");
    const feels = feelsLikeRawF(h);
    out.push(`| ${hourLabel(h.startTime, lang)} | ${cell(translateConditions(h.shortForecast, lang))} | ${h.temperature}°${h.temperatureUnit} | ${feels != null ? feels + "°" : "–"} | ${pop(h)}% | ${cell(translateWind(h.windSpeed, lang))} ${cell(translateDir(h.windDirection, lang))} |`);
  }
  out.push("", "---", `[crosbynews.com](${canonicalFor("/", lang)}) · [${T(lang, "forecast", "pronóstico")}](${canonicalFor("/", lang)}) · [radar](${canonicalFor("/radar", lang)})`);
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
${JSONLD_SITE}
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
</style>
</head>
<body>
${topbar("/alerts", lang)}
<main>
  <h1>${T(lang, "Crosby, TX Weather Alerts", "Alertas meteorológicas de Crosby, TX")}</h1>
  ${status}
  <p class="intro"><a href="${lang === "es" ? "/es" : "/"}">&larr; ${T(lang, "Back to the forecast", "Volver al pronóstico")}</a> &middot; <a href="${lang === "es" ? "/es/radar" : "/radar"}">Radar</a> &middot; ${T(lang, `Official source: <a href="https://www.weather.gov/hgx/">NWS Houston/Galveston</a>. In an emergency, call 911.`, `Fuente oficial: <a href="https://www.weather.gov/hgx/">NWS Houston/Galveston</a>. En una emergencia, llama al 911.`)}</p>

  <div data-nosnippet>
  <h2 class="ref-head">${T(lang, "Severe Weather Guide", "Guía de clima severo")}</h2>
  <p class="ref-note">${T(lang, `The guide below explains common NWS alert types in plain language &mdash; what each one means and what to do if one is issued. It&rsquo;s here for reference; no action is needed when the status above shows &ldquo;All clear.&rdquo; If an alert is active for Crosby, it will appear in the green panel at the top of this page. In any emergency, call&nbsp;911 and follow guidance from local officials and the <a href="https://www.weather.gov/hgx/">NWS Houston/Galveston</a> office.`, `La guía siguiente explica en lenguaje sencillo los tipos de alerta más comunes del NWS: qué significa cada una y qué hacer si se emite. Está aquí como referencia; no se requiere ninguna acción cuando el estado de arriba indica «Todo despejado». Si hay una alerta activa para Crosby, aparecerá en el panel de la parte superior de esta página. En cualquier emergencia, llama al&nbsp;911 y sigue las indicaciones de las autoridades locales y de la <a href="https://www.weather.gov/hgx/">oficina del NWS en Houston/Galveston</a>.`)}</p>
  <div class="ref-grid">${guide}</div>
  </div>
</main>
${footer({ page: "/alerts", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`), data })}
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
  out.push("---", `${T(lang, "Official source: NWS Houston/Galveston. In an emergency, call 911.", "Fuente oficial: NWS Houston/Galveston. En una emergencia, llama al 911.")} · [crosbynews.com](${canonicalFor("/", lang)})`);
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
${JSONLD_SITE}
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
<main>
  <h1>${T(lang, "Crosby, TX News", "Noticias de Crosby, TX")}</h1>
  <p class="intro">${T(lang, `Recent headlines about Crosby, Texas and the Crosby ISD community, gathered automatically from Texas and Houston-area news outlets and filtered for relevance to Crosby. Links open the original source.${data.updated ? ` Last updated ${esc(newsDate(data.updated))}.` : ""}`, `Titulares recientes sobre Crosby, Texas y la comunidad de Crosby ISD, recopilados automáticamente de medios de Texas y del área de Houston y filtrados por relevancia para Crosby. Los enlaces abren la fuente original; los titulares se muestran en su idioma original.${data.updated ? ` Última actualización: ${esc(newsDate(data.updated, lang))}.` : ""}`)}</p>
  ${list}
  <section class="card">
    <h2>${T(lang, "About Crosby, Texas", "Acerca de Crosby, Texas")}</h2>
    <p>${T(lang, "Crosby is a community in northeast Harris County, Texas, situated along the San Jacinto River corridor between Houston and Baytown. The area includes Barrett Station and surrounding neighborhoods in the 77532 zip code. Crosby ISD serves the local schools, including Crosby High School, home of the Cougars.", "Crosby es una comunidad en el noreste del condado de Harris, Texas, ubicada a lo largo del corredor del río San Jacinto, entre Houston y Baytown. La zona incluye Barrett Station y los vecindarios cercanos del código postal 77532. El distrito Crosby ISD atiende a las escuelas locales, entre ellas Crosby High School, hogar de los Cougars.")}</p>
    <p>${T(lang, "The community regularly experiences Gulf Coast weather events &mdash; tropical storms, flash flooding, and severe thunderstorms &mdash; making it a distinct news beat separate from the wider Houston metro. Stories here focus on Crosby and the nearby northeast Harris County communities of Huffman, Highlands, Channelview, and Atascocita.", "La comunidad vive con frecuencia fenómenos meteorológicos de la costa del Golfo &mdash; tormentas tropicales, inundaciones repentinas y tormentas severas &mdash; lo que la convierte en un tema de noticias propio, distinto del área metropolitana de Houston. Las notas aquí se centran en Crosby y en las comunidades cercanas del noreste del condado de Harris: Huffman, Highlands, Channelview y Atascocita.")}</p>
    <p class="disclaimer">${T(lang, "Headlines are aggregated from public news sources and filtered to stories about Crosby, TX and nearby communities. crosbynews.com isn&rsquo;t the publisher &mdash; each link goes to the original outlet. Spotted something off-topic? It&rsquo;s automated filtering and we tune it over time.", "Los titulares se recopilan de fuentes de noticias públicas y se filtran para notas sobre Crosby, TX y comunidades cercanas. crosbynews.com no es el editor &mdash; cada enlace lleva al medio original. ¿Viste algo fuera de tema? Es un filtrado automático y lo ajustamos con el tiempo.")}</p>
  </section>
  <p class="intro"><a href="${lang === "es" ? "/es" : "/"}">&larr; ${T(lang, "Back to the forecast", "Volver al pronóstico")}</a></p>
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
<main>
  <h1>${esc(title)}</h1>
  <p class="intro">${T(lang, "Upcoming events from the Crosby Independent School District calendar — first day of school, holidays, early-release and no-school days, testing, and campus activities.", "Próximos eventos del calendario del Distrito Escolar Independiente de Crosby: primer día de clases, días festivos, días de salida temprana y sin clases, exámenes y actividades de los planteles.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${esc(fullTime(data.updated, lang))} CT.` : ""}</p>
  ${body}
  ${calendarSubscribe(lang)}
  <p class="disclaimer">${T(lang, `crosbynews.com isn't affiliated with Crosby ISD. Events are pulled from the district's public calendar feed (<a href="${CISD_SITE}">crosbyisd.org</a>); event titles are shown in the district's original English. Always confirm dates with the district.`, `crosbynews.com no está afiliado a Crosby ISD. Los eventos provienen del calendario público del distrito (<a href="${CISD_SITE}">crosbyisd.org</a>); los títulos de los eventos se muestran en el inglés original del distrito. Confirma siempre las fechas con el distrito.`)}</p>
  <p class="intro"><a href="${lang === "es" ? "/es" : "/"}">&larr; ${T(lang, "Back to the forecast", "Volver al pronóstico")}</a></p>
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

// Markdown rendering of the same data, served when an agent sends
// `Accept: text/markdown` (or ?format=md).
function renderMarkdown(data, lang) {
  const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\s*\n\s*/g, " ");
  const now = data.hourly?.[0];
  const lead = data.periods?.[0];
  const out = [];
  out.push(`# ${T(lang, `${data.place || "Crosby, TX"} Weather`, `Clima en ${data.place || "Crosby, TX"}`)}`, "");
  out.push(`_${T(lang, "Updated", "Actualizado")} ${fullTime(data.updated, lang)} CT — ${T(lang, "source: U.S. National Weather Service (weather.gov)", "fuente: Servicio Meteorológico Nacional de EE. UU. (weather.gov)")}_`, "");
  if (lang === "es") out.push("_Las condiciones se traducen al español; las descripciones detalladas y las alertas se muestran en inglés oficial del NWS._", "");

  if (now) {
    const feels = feelsLikeF(now);
    const sun = sunTimesForCtDate(Date.now());
    out.push(T(lang, "## Now", "## Ahora"));
    out.push(`**${now.temperature}°${now.temperatureUnit}** — ${translateConditions(now.shortForecast, lang)} (${T(lang, "as of", "a las")} ${clockTime(now.startTime, lang)} CT)${feels != null ? ` · ${T(lang, "feels like", "sensación térmica de")} ${feels}°` : ""}${pop(now) ? ` · ${pop(now)}% ${T(lang, "precip", "prob. lluvia")}` : ""}`, "");
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
function linkHeader(lang) {
  const alt = lang === "es" ? `${SITE}/es` : `${SITE}/`;
  return (
    `<${alt}>; rel="alternate"; type="text/markdown", ` +
    `<${SITE}/sitemap.xml>; rel="sitemap", ` +
    `<${SITE}/.well-known/api-catalog>; rel="api-catalog", ` +
    `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`
  );
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
    current: data.hourly?.[0] ? withFeels(data.hourly[0]) : null,
    hourly: (data.hourly ?? []).slice(0, 12).map(withFeels),
    forecast: data.periods ?? [],
    alerts: data.alerts ?? [],
  };
}

// RFC 9727 / RFC 9264 API catalog (application/linkset+json).
function apiCatalog() {
  return {
    linkset: [
      {
        anchor: `${SITE}/api/weather`,
        "service-desc": [{ href: `${SITE}/openapi.json`, type: "application/json" }],
        "service-doc": [{ href: `${SITE}/`, type: "text/html" }],
        status: [{ href: `${SITE}/api/health`, type: "application/json" }],
      },
    ],
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
  return {
    openapi: "3.1.0",
    info: {
      title: "crosbynews.com Weather API",
      version: "1.0.0",
      description:
        "Current conditions, hourly and 7-day forecast, and active alerts for Crosby, Texas, sourced from the U.S. National Weather Service. Public, no authentication.",
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
            current: { anyOf: [HourlyPeriod, { type: "null" }] },
            hourly: { type: "array", items: HourlyPeriod },
            forecast: { type: "array", items: Period },
            alerts: { type: "array", items: Alert },
          },
        },
        HourlyPeriod,
        Period,
        Alert,
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
  ];
}

function mcpServerCard() {
  return {
    serverInfo: MCP_SERVER_INFO,
    protocolVersion: MCP_PROTOCOL_VERSION,
    description:
      "Live weather for Crosby, Texas (U.S. National Weather Service): current conditions, forecast, and active alerts.",
    transport: { type: "streamable-http", endpoint: `${SITE}/mcp` },
    capabilities: { tools: { listChanged: false } },
    tools: mcpTools().map((t) => ({ name: t.name, title: t.title, description: t.description })),
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
<main>
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
  const { data } = await loadWeather(env);
  if (name === "get_current_conditions") {
    const now = data.hourly?.[0] ?? null;
    const feels = feelsLikeF(now);
    const sun = sunTimesForCtDate(Date.now());
    const text = now
      ? `Crosby, TX: ${now.temperature}°${now.temperatureUnit}, ${now.shortForecast}` +
        `${feels != null ? `, feels like ${feels}°` : ""}${pop(now) ? `, ${pop(now)}% precip` : ""} (as of ${clockTime(now.startTime)} CT).` +
        `${sun ? ` Sunrise ${clockTime(sun.sunrise)}, sunset ${clockTime(sun.sunset)} CT.` : ""}`
      : "Current conditions are unavailable.";
    return {
      content: [{ type: "text", text }],
      structuredContent: {
        location: data.place,
        updated: data.updated,
        sun: sun ? { sunrise: new Date(sun.sunrise).toISOString(), sunset: new Date(sun.sunset).toISOString() } : null,
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
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions: "Live weather for Crosby, Texas from the U.S. National Weather Service.",
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: mcpTools() });
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
    CSP_CACHE = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' 'unsafe-inline' 'sha256-${scriptHash}' https://static.cloudflareinsights.com`,
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
    // Serve the favicon as a real file. Browsers and crawlers auto-request
    // /favicon.ico; serving it (as SVG) avoids needless 404s in crawl stats.
    if (path === "/favicon.ico" || path === "/favicon.svg") {
      return new Response(FAVICON_SVG, {
        headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=604800, immutable" },
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

    if (path === "/api/weather") {
      try {
        const { data, cache } = await loadWeather(env);
        return new Response(JSON.stringify(apiWeather(data)), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=300",
            link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
            "x-cache": cache,
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "upstream_unavailable", message: err && err.message }), {
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
    // edge-cached. Locked to that single upstream image (not an open proxy).
    if (path === "/radar-image") {
      let res;
      try {
        res = await fetch("https://radar.weather.gov/ridge/standard/KHGX_loop.gif", {
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

    // Otherwise only the root (and its /es counterpart) serves a page.
    if (page !== "/") {
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    try {
      // loadWeather() reads the cache, refreshing on a missing/stale-shaped
      // entry so a deploy that changes the cached shape self-heals.
      const { data, cache } = await loadWeather(env);

      // Content negotiation: agents asking for markdown get markdown; the
      // default stays HTML for browsers. Vary: Accept keeps caches honest.
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";

      if (wantsMarkdown) {
        const md = renderMarkdown(data, lang);
        return new Response(md, {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "cache-control": "public, max-age=300",
            vary: "Accept",
            link: linkHeader(lang),
            "x-markdown-tokens": String(Math.ceil(md.length / 4)),
            "x-cache": cache,
          },
        });
      }

      return new Response(renderHtml(data, lang), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
          vary: "Accept",
          link: linkHeader(lang),
          "x-cache": cache,
        },
      });
    } catch (err) {
      return new Response(renderError(err), {
        status: 502,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
}

// The content pages, each its own canonical URL. Their responses get an HTTP
// `Link: rel="canonical"` header in the wrapper below, so the content-negotiated
// `?format=md` variants — and the http→https pair — consolidate onto one URL for
// crawlers that read the HTTP layer (reinforces the in-HTML <link rel="canonical">).
const PAGE_PATHS = new Set([
  "/", "/hourly", "/radar", "/alerts", "/news", "/calendar", "/about", "/privacy", "/contact", "/sitemap",
  "/es", "/es/hourly", "/es/radar", "/es/alerts", "/es/news", "/es/calendar", "/es/about", "/es/privacy", "/es/contact", "/es/sitemap",
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
  },
};
