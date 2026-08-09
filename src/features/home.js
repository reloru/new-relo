// The homepage hub — the front page of Crosby. Weather-forward, with an
// at-a-glance card into every section.
//
// It renders cards from five datasets, so it necessarily depends on the water,
// news and calendar slices. That is why it lands after them rather than early:
// hubWaterSummary reads waterCatClass/waterCatLabel, the news card reads
// newsList, and the calendar card reads upcomingEvents/translateEvent.
//
// Never render whole alert products here. One Special Weather Statement once
// ate 80% of the mobile page; full products belong on /alerts and /weather.

import { TZ } from "../config.js";
import { T, esPath, canonicalFor, hreflangTags,
         translateConditions, translatePeriodName, translateWind, translateDir } from "../i18n.js";
import { esc, iconUrl, clockTime, dayLabel, capFirst, relTime } from "../lib/format.js";
import { pop, feelsLikeF, feelsLikeRawF, currentHourly } from "../lib/derived.js";
import { BASE_CSS } from "../assets/base-css.js";
import { HOME_SCRIPT } from "../assets/client-scripts.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON } from "../seo.js";
import { uvPeakToday, uvCategory, aqiCategory, aqiSourceNote } from "./air.js";
import { waterCatLabel, waterCatClass, WATER_FLOOD_CATS, WATER_CAT_ORDER } from "./water.js";
import { tropicsStormLine } from "./tropics.js";
import { newsList } from "./news.js";
import { upcomingEvents, translateEvent } from "./calendar.js";

// The root (/ and /es) is the "front page of Crosby": current conditions up
// top (kept prominent so the root retains its weather relevance) plus at-a-
// glance cards linking into Weather, Water, News, and the School Calendar. The
// full forecast lives at /weather. The hub loads all five datasets in parallel
// (cheap KV reads) so one slow source can't serially block the page.
export function hubWaterSummary(water, lang) {
  const gauges = water.gauges ?? [];
  const flooding = gauges.filter((g) => WATER_FLOOD_CATS.includes(g.category));
  if (flooding.length) {
    const rank = (c) => WATER_CAT_ORDER.indexOf(c);
    const worst = flooding.reduce((a, b) => (rank(b.category) > rank(a.category) ? b : a));
    // Raw, NOT esc()'d — this struct feeds an HTML renderer and a markdown one,
    // so escaping here would be wrong for one of them. Both fields are escaped
    // at the point of HTML use instead (see hubHtml), which is what `label` has
    // always done. Escaping at construction meant markdown received `&amp;` for
    // a gauge name containing "&", and forced a tag-stripping regex downstream
    // that CodeQL flagged (js/incomplete-multi-character-sanitization, #5).
    return { cls: waterCatClass(worst.category), label: waterCatLabel(worst.category, lang), detail: String(worst.name ?? "") };
  }
  if (!gauges.length) return { cls: "w-unknown", label: T(lang, "Unavailable", "No disponible"), detail: T(lang, "Water data temporarily unavailable", "Datos de agua no disponibles temporalmente") };
  return { cls: "w-normal", label: T(lang, "All normal", "Todo normal"), detail: T(lang, "No area gauges at flood stage", "Ningún medidor del área en etapa de inundación") };
}

// Compass abbreviations spelled out for the hero's plain-language wind line
// ("8 mph from the southeast"). Same 16-point set NWS uses.
export const DIR_WORDS_EN = { N: "north", NNE: "north-northeast", NE: "northeast", ENE: "east-northeast", E: "east", ESE: "east-southeast", SE: "southeast", SSE: "south-southeast", S: "south", SSW: "south-southwest", SW: "southwest", WSW: "west-southwest", W: "west", WNW: "west-northwest", NW: "northwest", NNW: "north-northwest" };
export const DIR_WORDS_ES = { N: "norte", NNE: "nornoreste", NE: "noreste", ENE: "estenoreste", E: "este", ESE: "estesureste", SE: "sureste", SSE: "sursureste", S: "sur", SSW: "sursuroeste", SW: "suroeste", WSW: "oestesuroeste", W: "oeste", WNW: "oestenoroeste", NW: "noroeste", NNW: "nornoroeste" };
export const dirWord = (dir, lang) => (lang === "es" ? DIR_WORDS_ES : DIR_WORDS_EN)[dir] || dir || "";

// NWS alert severity, worst-first, for picking the banner's primary alert.
export const ALERT_SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 };
export const alertRank = (a) => ALERT_SEVERITY_RANK[a?.severity] ?? 0;

// One short verbatim-NWS line summarizing an alert: the first line of the
// description when it reads like a title (SWS products lead with one, e.g.
// "Dangerous Heat Likely Through Holiday Weekend"), else the NWS headline,
// truncated. Display-only; the full official text lives on /alerts.
export function alertSummaryLine(a) {
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
export function hubAlertsBanner(alerts, lang) {
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
export function hubTropicsBanner(tropics, lang) {
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
export function todayGlance(weather, lang) {
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
export function glanceStamp(weather, lang) {
  return esc(capFirst(dayLabel(new Date().toISOString(), lang)));
}

// Tiny provenance + freshness footnote under the glance explainers: which
// upstreams the card's numbers come from and how fresh our cache is (absolute
// CT time plus a relative "N min ago"). Returns "" when we have no timestamp.
// Plain text (locale date/time strings need no escaping) so it serves both the
// HTML card and the ?format=md view.
export function glanceSourceLine(weather, lang) {
  if (!weather.updated) return "";
  // ES: "Datos" + "del Servicio…" so it reads "Datos del…" (not "de el").
  // The AQI source depends on which one answered this refresh (AirNow measured
  // vs Open-Meteo modeled), so name it accordingly.
  const aqiSrc = weather.aqi?.measured ? T(lang, "AirNow", "AirNow") : T(lang, "Open-Meteo", "Open-Meteo");
  const src = T(lang, `the National Weather Service, EPA, and ${aqiSrc}`, `del Servicio Meteorológico Nacional, la EPA y ${aqiSrc}`);
  return `${T(lang, "Data from", "Datos")} ${src} · ${T(lang, "updated", "actualizado")} ${clockTime(weather.updated, lang)} CT (${relTime(weather.updated, lang)})`;
}

// Short, honest explainers for the glance numbers people ask about most.
// Native <details> — progressive disclosure with zero JS.
export function glanceExplainers(lang, aqi) {
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
      `${T(
        lang,
        "This is the air quality right now, on the U.S. AQI's standard 0–500 scale: 0–50 good, 51–100 moderate, 101–150 unhealthy for sensitive groups, 151+ unhealthy for everyone.",
        "Es la calidad del aire en este momento, en la escala estándar de 0 a 500 del Índice de Calidad del Aire de EE. UU.: 0–50 buena, 51–100 moderada, 101–150 insalubre para grupos sensibles, 151+ insalubre para todos."
      )} ${aqiSourceNote(aqi, lang)} ${T(lang, `<a href="${lang === "es" ? "/es/air" : "/air"}">Full air quality page →</a>`, `<a href="${lang === "es" ? "/es/air" : "/air"}">Página completa de calidad del aire →</a>`)}`,
    ],
  ];
  return items.map(([q, a]) => `<details class="about"><summary>&#9432; ${q}</summary><p>${a}</p></details>`).join("");
}

export function homeHtml(weather, water, news, cal, tropics, lang) {
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
        ${glanceExplainers(lang, weather.aqi)}
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
        ${WATER_FLOOD_CATS.some((c) => ws.cls === waterCatClass(c)) || ws.cls === "w-unknown" ? `<p class="hub-water-detail">${esc(ws.detail)}</p>` : ""}
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

export function homeMarkdown(weather, water, news, cal, tropics, lang) {
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
  // Both fields arrive raw from hubWaterSummary, so markdown uses them as-is.
  // The entity-strip and tag-strip that used to sit here were no-ops undoing an
  // esc() applied at construction — waterCatLabel returns plain text, and the
  // pre-escaped detail had no literal "<" left to strip.
  out.push(`**${T(lang, "Water levels", "Niveles de agua")}:** ${ws.label}${wsNormal ? "" : ` — ${ws.detail}`}${wsStamp}. [${T(lang, "All gauges", "Todos los medidores")}](${canonicalFor("/water", lang)})`, "");
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

// Shared 502 body for the content pages.
//
// `source` names the upstream that actually failed. It used to be hardcoded to
// "the National Weather Service" for all thirteen call sites, so a Crosby ISD
// or TranStar outage told the visitor NWS was down — the wrong claim to make by
// default on a site whose whole premise is honest sourcing.
//
// The error message is logged, not rendered. It used to go into a <pre> on the
// public page; it was escaped, so not an injection vector, but it exposed
// upstream URLs and status codes to anyone who caught a bad minute.
export function renderError(err, source = "a data source") {
  console.error("Page render failed:", source, "-", err && err.stack);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>crosbynews.com &mdash; temporarily unavailable</title></head>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem">
<h1>Temporarily unavailable</h1>
<p>We couldn't reach ${esc(source)} just now. Please try again shortly.</p>
<p><a href="/">Back to the front page</a></p>
</body></html>`;
}
