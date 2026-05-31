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
    hourly: (hourly.properties.periods ?? []).slice(0, 12),
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

// NWS icon URLs carry a ?size= param; bump it for crisper rendering.
function iconUrl(url, size) {
  return url ? esc(url.replace(/size=\w+/, `size=${size}`)) : "";
}

function fmt(iso, opts) {
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: TZ, ...opts });
  } catch {
    return "";
  }
}
const fullTime = (iso) => fmt(iso, { dateStyle: "medium", timeStyle: "short" });
const clockTime = (iso) => fmt(iso, { hour: "numeric", minute: "2-digit" });
const hourLabel = (iso) => fmt(iso, { hour: "numeric" });

function renderAlerts(alerts) {
  if (!alerts.length) return "";
  const cards = alerts
    .map(
      (a) => `
      <article class="alert">
        <h3>&#9888; ${esc(a.event)}</h3>
        ${a.headline ? `<p class="headline">${esc(a.headline)}</p>` : ""}
        ${a.description ? `<p>${nl2br(a.description)}</p>` : ""}
        ${a.instruction ? `<p class="instruction"><strong>What to do:</strong> ${nl2br(a.instruction)}</p>` : ""}
        ${a.expires ? `<p class="meta">In effect until ${esc(fullTime(a.expires))}</p>` : ""}
      </article>`
    )
    .join("");
  return `<section class="alerts" aria-label="Active weather alerts">${cards}</section>`;
}

function renderHero(data) {
  const now = data.hourly?.[0];
  const lead = data.periods?.[0];
  if (!now) return "";
  return `
    <section class="hero">
      ${now.icon ? `<img class="hero-icon" src="${iconUrl(now.icon, "large")}" alt="${esc(now.shortForecast)}" width="128" height="128" fetchpriority="high">` : ""}
      <div class="hero-now">
        <p class="hero-temp">${esc(now.temperature)}&deg;<span>${esc(now.temperatureUnit)}</span></p>
        <p class="hero-cond">${esc(now.shortForecast)}</p>
        <p class="hero-meta">${esc(data.place)} &middot; as of ${esc(clockTime(now.startTime))} CT${pop(now) ? ` &middot; ${pop(now)}% precip` : ""}</p>
      </div>
    </section>
    ${lead ? `<p class="lead"><strong>${esc(lead.name)}:</strong> ${esc(lead.detailedForecast)}</p>` : ""}`;
}

function renderHourly(hourly) {
  if (!hourly?.length) return "";
  const cells = hourly
    .map(
      (h) => `
      <div class="hour">
        <span class="hour-time">${esc(hourLabel(h.startTime))}</span>
        ${h.icon ? `<img src="${iconUrl(h.icon, "small")}" alt="${esc(h.shortForecast)}" width="44" height="44" loading="lazy">` : ""}
        <span class="hour-temp">${esc(h.temperature)}&deg;</span>
        <span class="hour-pop${pop(h) >= 30 ? " wet" : ""}">${pop(h)}%</span>
      </div>`
    )
    .join("");
  return `<section class="card">
    <h2>Next 12 hours</h2>
    <div class="hourly">${cells}</div>
  </section>`;
}

function renderDaily(periods) {
  if (!periods.length) return `<p class="none">No forecast available.</p>`;
  const cards = periods
    .map(
      (p) => `
      <article class="period ${p.isDaytime ? "day" : "night"}">
        <div class="period-head">
          <h3>${esc(p.name)}</h3>
          ${p.icon ? `<img src="${iconUrl(p.icon, "medium")}" alt="${esc(p.shortForecast)}" width="52" height="52" loading="lazy">` : ""}
        </div>
        <p class="temp">${p.isDaytime ? "High" : "Low"} ${esc(p.temperature)}&deg;${esc(p.temperatureUnit)}</p>
        <p class="short">${esc(p.shortForecast)}</p>
        <p class="meta">${pop(p) ? `${pop(p)}% precip &middot; ` : ""}Wind ${esc(p.windSpeed)} ${esc(p.windDirection)}</p>
        <p class="detail">${esc(p.detailedForecast)}</p>
      </article>`
    )
    .join("");
  return `<section class="daily-sec">
    <h2>7-Day Forecast</h2>
    <div class="periods">${cards}</div>
  </section>`;
}

function renderHtml(data) {
  const hasAlerts = (data.alerts ?? []).length > 0;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crosby, TX Weather &mdash; crosbynews.com</title>
<meta name="description" content="Live weather forecast and active alerts for Crosby, Texas, refreshed every 15 minutes from the U.S. National Weather Service.">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="Crosby, TX Weather">
<meta property="og:description" content="Live forecast and active alerts for Crosby, Texas.">
<meta property="og:type" content="website">
<meta http-equiv="refresh" content="900">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='13' cy='15' r='8' fill='%23f5b301'/><ellipse cx='19' cy='20' rx='10' ry='6' fill='%23dfe7ee'/></svg>">
<style>
  :root { color-scheme: light dark; --blue:#0b3d61; --accent:#2c7fb8; --sun:#f5b301; --bg:#eef2f6; --card:#fff; --ink:#16222e; --muted:#5a6b7b; --line:#d8dee5; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1620; --card:#1a2430; --ink:#e6ebf1; --muted:#94a3b2; --line:#2a3744; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; line-height:1.5; background:var(--bg); color:var(--ink); }
  .topbar { display:flex; justify-content:space-between; align-items:center; gap:1rem; background:var(--blue); color:#fff; padding:0.7rem 1rem; }
  .topbar .brand { font-weight:700; letter-spacing:0.02em; }
  .topbar .loc { opacity:0.85; font-size:0.9rem; }
  main { max-width:920px; margin:0 auto; padding:1rem; }
  h2 { font-size:1.1rem; margin:1.4rem 0 0.6rem; }
  .none { color:var(--muted); font-style:italic; }

  .hero { display:flex; align-items:center; gap:1rem; background:linear-gradient(135deg,var(--blue),var(--accent)); color:#fff; border-radius:16px; padding:1.1rem 1.3rem; margin-top:0.5rem; }
  .hero-icon { border-radius:12px; background:rgba(255,255,255,0.12); flex:none; }
  .hero-temp { margin:0; font-size:3.4rem; font-weight:800; line-height:1; }
  .hero-temp span { font-size:1.2rem; font-weight:600; vertical-align:super; opacity:0.85; }
  .hero-cond { margin:0.2rem 0 0; font-size:1.2rem; font-weight:600; }
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

  footer { max-width:920px; margin:1rem auto; padding:0 1rem 2rem; font-size:0.8rem; color:var(--muted); text-align:center; }
  footer a { color:inherit; }
</style>
</head>
<body>
<header class="topbar">
  <span class="brand">crosbynews.com</span>
  <span class="loc">${esc(data.place)}</span>
</header>
<main>
  ${renderAlerts(data.alerts ?? [])}
  ${renderHero(data)}
  ${renderHourly(data.hourly ?? [])}
  ${renderDaily(data.periods ?? [])}
</main>
<footer>
  ${hasAlerts ? "" : "No active weather alerts. "}Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).<br>
  Updated ${esc(fullTime(data.updated))} CT &middot; refreshes every 15 minutes.
</footer>
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

export default {
  async fetch(request, env, ctx) {
    try {
      let cache = "hit";
      let data = await env.WEATHER.get(KV_KEY, "json");
      // Treat a missing OR stale-shaped cache (e.g. an older entry written
      // before the hourly forecast was added) as a miss, so a deploy that
      // changes the cached shape self-heals on the next request.
      if (!data || !Array.isArray(data.hourly)) {
        // Cold cache (before the first cron run): fetch live and warm KV.
        // Await the write so the cache is actually populated. A write failure
        // shouldn't break the page, so it's caught and surfaced separately
        // (an unawaited waitUntil rejection would be lost silently).
        data = await fetchWeather();
        try {
          await env.WEATHER.put(KV_KEY, JSON.stringify(data));
          cache = "miss-warmed";
        } catch (e) {
          console.error("KV warm failed:", e && e.stack);
          cache = "miss-warmfail";
        }
      }
      return new Response(renderHtml(data), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
          "x-cache": cache,
        },
      });
    } catch (err) {
      return new Response(renderError(err), {
        status: 502,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },

  async scheduled(event, env, ctx) {
    const data = await fetchWeather();
    await env.WEATHER.put(KV_KEY, JSON.stringify(data));
  },
};
