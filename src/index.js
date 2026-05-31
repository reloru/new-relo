// crosbynews.com — Crosby, TX weather, served from the edge.
//
// scheduled(): every 15 min, pull the NWS forecast + active alerts and cache
//   the result as JSON in KV under "weather".
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

async function getJson(url) {
  const res = await fetch(url, { headers: NWS_HEADERS });
  if (!res.ok) {
    throw new Error(`NWS request failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json();
}

// Pull the forecast (two-step) and active alerts for Crosby, TX.
async function fetchWeather() {
  // 1. Resolve the point to its forecast endpoint.
  const points = await getJson(`https://api.weather.gov/points/${LAT},${LON}`);
  const forecastUrl = points.properties.forecast;

  // 2. Forecast periods + active alerts are independent — fetch together.
  const [forecast, alertsData] = await Promise.all([
    getJson(forecastUrl),
    getJson(`https://api.weather.gov/alerts/active?point=${LAT},${LON}`),
  ]);

  return {
    updated: new Date().toISOString(),
    periods: forecast.properties.periods ?? [],
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

function renderAlerts(alerts) {
  if (!alerts.length) {
    return `<p class="none">No active alerts.</p>`;
  }
  return alerts
    .map(
      (a) => `
      <article class="alert">
        <h3>${esc(a.event)}</h3>
        ${a.headline ? `<p class="headline">${esc(a.headline)}</p>` : ""}
        ${a.description ? `<p>${nl2br(a.description)}</p>` : ""}
        ${a.instruction ? `<p class="instruction"><strong>What to do:</strong> ${nl2br(a.instruction)}</p>` : ""}
        ${a.expires ? `<p class="meta">Expires ${esc(formatTime(a.expires))}</p>` : ""}
      </article>`
    )
    .join("");
}

function renderPeriods(periods) {
  if (!periods.length) {
    return `<p class="none">No forecast available.</p>`;
  }
  return periods
    .map(
      (p) => `
      <article class="period${p.isDaytime ? " day" : " night"}">
        <h3>${esc(p.name)}</h3>
        <p class="temp">${esc(p.temperature)}&deg;${esc(p.temperatureUnit)}</p>
        <p class="short">${esc(p.shortForecast)}</p>
        <p class="wind">Wind ${esc(p.windSpeed)} ${esc(p.windDirection)}</p>
        <p class="detail">${esc(p.detailedForecast)}</p>
      </article>`
    )
    .join("");
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function renderHtml(data) {
  const updated = data.updated ? `${formatTime(data.updated)} CT` : "unknown";
  const alertCount = (data.alerts ?? []).length;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crosby, TX Weather &mdash; crosbynews.com</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    line-height: 1.5;
    background: #f4f6f8;
    color: #1a2733;
  }
  header {
    background: #0b3d61;
    color: #fff;
    padding: 1.5rem 1rem;
    text-align: center;
  }
  header h1 { margin: 0; font-size: 1.6rem; }
  header p { margin: 0.25rem 0 0; opacity: 0.8; font-size: 0.9rem; }
  main { max-width: 880px; margin: 0 auto; padding: 1rem; }
  h2 { font-size: 1.2rem; border-bottom: 2px solid #d0d7de; padding-bottom: 0.3rem; }
  .none { color: #5a6b7b; font-style: italic; }
  .alert {
    background: #fff4f4;
    border-left: 4px solid #c0392b;
    border-radius: 6px;
    padding: 0.75rem 1rem;
    margin: 0.75rem 0;
  }
  .alert h3 { margin: 0 0 0.25rem; color: #a3271b; }
  .alert .headline { font-weight: 600; }
  .alert .instruction { background: #fff; border-radius: 4px; padding: 0.5rem; }
  .meta { font-size: 0.8rem; color: #5a6b7b; }
  .periods { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .period {
    background: #fff;
    border-radius: 8px;
    padding: 0.85rem 1rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  .period.night { background: #eef1f6; }
  .period h3 { margin: 0 0 0.25rem; font-size: 1.05rem; }
  .period .temp { margin: 0; font-size: 1.8rem; font-weight: 700; color: #0b3d61; }
  .period .short { margin: 0.25rem 0; font-weight: 600; }
  .period .wind { margin: 0.25rem 0; font-size: 0.85rem; color: #5a6b7b; }
  .period .detail { margin: 0.5rem 0 0; font-size: 0.9rem; }
  footer { max-width: 880px; margin: 1rem auto; padding: 0 1rem 2rem; font-size: 0.8rem; color: #5a6b7b; text-align: center; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f1620; color: #e3e8ee; }
    main h2 { border-color: #2a3744; }
    .period { background: #1a2430; box-shadow: none; }
    .period.night { background: #141d27; }
    .period .temp { color: #5aa9e6; }
    .alert { background: #2a1715; }
  }
</style>
</head>
<body>
<header>
  <h1>Crosby, TX Weather</h1>
  <p>crosbynews.com</p>
</header>
<main>
  <section>
    <h2>Active Alerts${alertCount ? ` (${alertCount})` : ""}</h2>
    ${renderAlerts(data.alerts ?? [])}
  </section>
  <section>
    <h2>Forecast</h2>
    <div class="periods">${renderPeriods(data.periods ?? [])}</div>
  </section>
</main>
<footer>
  Data from the U.S. National Weather Service (weather.gov). Updated ${esc(updated)}.
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
      if (!data) {
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
        headers: { "content-type": "text/html; charset=utf-8", "x-cache": cache },
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
