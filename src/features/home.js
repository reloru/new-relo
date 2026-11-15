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
import { esc, iconUrl, clockTime, fullTime, dayLabel, capFirst, dateStamp, clockStamp } from "../lib/format.js";
import { pop, feelsLikeF, feelsLikeRawF, currentHourly } from "../lib/derived.js";
import { BASE_CSS } from "../assets/base-css.js";
import { HOME_SCRIPT } from "../assets/client-scripts.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, sharedHead } from "../seo.js";
import { uvPeakOn, uvCategory, aqiCategory, aqiSourceNote } from "./air.js";
import { waterCatLabel, waterCatClass, WATER_FLOOD_CATS, WATER_CAT_ORDER } from "./water.js";
import { tropicsStormLine, tropicsDisturbanceLine, tropicsWatchPeak, tropicsWatchAreas } from "./tropics.js";
import { alertsBanner, ALERT_BANNER_CSS, alertRank, alertSummaryLine } from "./alerts.js";
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

// Same hub-water badge language as hubWaterSummary — w-moderate (the same
// red-orange the Alerts card already uses for "active") when a ban is in
// effect, w-normal (green) when not, and the shared unstyled/muted fallback
// when the last check didn't come back with a recognized status.
export function hubBurnBanSummary(burnban, lang) {
  if (burnban?.status === "Yes") return { cls: "w-moderate", label: T(lang, "In effect", "Vigente"), detail: T(lang, "Applies to all of Harris County", "Aplica a todo el condado de Harris") };
  if (burnban?.status === "No") return { cls: "w-normal", label: T(lang, "None", "Ninguna"), detail: "" };
  return { cls: "w-unknown", label: T(lang, "Unavailable", "No disponible"), detail: T(lang, "Burn ban data temporarily unavailable", "Datos de prohibición de quemas no disponibles temporalmente") };
}

// Compass abbreviations spelled out for the hero's plain-language wind line
// ("8 mph from the southeast"). Same 16-point set NWS uses.
export const DIR_WORDS_EN = { N: "north", NNE: "north-northeast", NE: "northeast", ENE: "east-northeast", E: "east", ESE: "east-southeast", SE: "southeast", SSE: "south-southeast", S: "south", SSW: "south-southwest", SW: "southwest", WSW: "west-southwest", W: "west", WNW: "west-northwest", NW: "northwest", NNW: "north-northwest" };
export const DIR_WORDS_ES = { N: "norte", NNE: "nornoreste", NE: "noreste", ENE: "estenoreste", E: "este", ESE: "estesureste", SE: "sureste", SSE: "sursureste", S: "sur", SSW: "sursuroeste", SW: "suroeste", WSW: "oestesuroeste", W: "oeste", WNW: "oestenoroeste", NW: "noroeste", NNW: "nornoroeste" };
export const dirWord = (dir, lang) => (lang === "es" ? DIR_WORDS_ES : DIR_WORDS_EN)[dir] || dir || "";

// Compact tropical-activity strip for the hub — self-hides when the Atlantic
// is quiet (most of the year), so the front page carries zero hurricane noise
// off-season. Deliberately calmer than the red alerts banner: activity in the
// basin is watch-this news, not act-now news (act-now arrives as NWS alerts).
export function hubTropicsBanner(tropics, lang) {
  const storms = tropics?.storms ?? [];
  const tUrl = lang === "es" ? "/es/tropics" : "/tropics";
  if (storms.length) {
    const list = storms.map((s) => tropicsStormLine(s, lang)).join(" · ");
    return `<a class="notice storm" href="${tUrl}">
    <p class="n-title">${storms.length === 1 ? T(lang, "Tropical system in the Atlantic", "Sistema tropical en el Atlántico") : T(lang, `${storms.length} tropical systems in the Atlantic`, `${storms.length} sistemas tropicales en el Atlántico`)}</p>
    <p>${esc(list)}</p>
    <p class="n-more">${T(lang, "Where they are headed", "Hacia dónde van")}</p>
  </a>`;
  }
  // No named storm, but NHC may still be watching areas for development. The
  // front page surfaces those only at MEDIUM or better (>=40% over 7 days):
  // every wave off Africa spends a few days at 10-20%, and a homepage banner
  // for each one is noise that teaches people to ignore the banner. The
  // /tropics page lists them all regardless.
  const watching = tropicsWatchAreas(tropics);
  if (!watching.length) return "";
  const peak = tropicsWatchPeak(watching);
  return `<a class="notice watch" href="${tUrl}">
    <p class="n-title">${watching.length === 1 ? T(lang, "Forecasters are watching one area of the Atlantic", "Los meteorólogos vigilan una zona del Atlántico") : T(lang, `Forecasters are watching ${watching.length} areas of the Atlantic`, `Los meteorólogos vigilan ${watching.length} zonas del Atlántico`)}</p>
    <p>${esc(watching.map((d) => tropicsDisturbanceLine(d, lang)).join(" · "))}</p>
    <p>${T(lang, `No named storm yet${peak != null ? `. Up to ${peak}% chance one forms.` : "."}`, `Aún sin tormenta con nombre${peak != null ? `. Hasta ${peak}% de probabilidad de que se forme una.` : "."}`)} <span class="n-more">${T(lang, "Tropics page", "Página de trópicos")}</span></p>
  </a>`;
}

// Homepage teaser for an active Harris County burn ban — same treatment as
// hubTropicsBanner (self-hides when there's nothing to say), in the burn-ban
// orange already established on the /burn-ban page's status panel rather than
// a new color.
export function hubBurnBanBanner(burnban, lang) {
  if (burnban?.status !== "Yes") return "";
  const bUrl = lang === "es" ? "/es/burn-ban" : "/burn-ban";
  return `<a class="notice fire" href="${bUrl}">
    <p class="n-title">${T(lang, "Burn ban in effect for Harris County", "Prohibición de quemas vigente en el condado de Harris")}</p>
    <p>${T(lang, "No outdoor burning anywhere in the county.", "No se permite quemar al aire libre en ningún lugar del condado.")} <span class="n-more">${T(lang, "What the ban covers", "Qué abarca la prohibición")}</span></p>
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
  // UV follows the High row: once today's daytime period is gone, today's UV
  // peak is behind us and tomorrow's is the useful number, so it relabels.
  const uvDate = dayP && !dayIsToday ? ctDay(dayP.startTime) : today;
  const uvPeak = uvPeakOn(weather, uvDate);
  if (uvPeak != null) addDay(uvDate === today ? T(lang, "UV index", "Índice UV") : T(lang, "UV tomorrow", "UV mañana"), `${uvPeak} (${uvCategory(uvPeak, lang)})`);
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
// upstreams the card's numbers come from and when our cache was refreshed.
// Returns "" when we have no timestamp.
// `html` wraps the stamp in <time>; the Markdown renderer takes it plain. The
// stamp is a full date and time, never "N minutes ago": a relative time is
// only true at the instant it is rendered, and a crawler keeps the page for
// weeks.
export function glanceSourceLine(weather, lang, html = false) {
  if (!weather.updated) return "";
  // ES: "Datos" + "del Servicio…" so it reads "Datos del…" (not "de el").
  // The AQI source depends on which one answered this refresh (AirNow measured
  // vs Open-Meteo modeled), so name it accordingly.
  const aqiSrc = weather.aqi?.measured ? T(lang, "AirNow", "AirNow") : T(lang, "Open-Meteo", "Open-Meteo");
  const src = T(lang, `the National Weather Service, EPA, and ${aqiSrc}`, `del Servicio Meteorológico Nacional, la EPA y ${aqiSrc}`);
  const when = html ? dateStamp(weather.updated, lang) : `${fullTime(weather.updated, lang)} CT`;
  return `${T(lang, "Data from", "Datos")} ${src} · ${T(lang, "updated", "actualizado")} ${when}`;
}

// Short, honest explainers for the glance numbers people ask about most.
// Native <details> — progressive disclosure with zero JS.
export function glanceExplainers(lang, aqi) {
  const airUrl = lang === "es" ? "/es/air" : "/air";
  const items = [
    T(
      lang,
      "<strong>Feels like</strong> is the heat index or wind chill, worked out with the National Weather Service's formulas. In the table it is the highest value forecast for the rest of today. Beside the temperature at the top of the page it is the current hour. Phone apps use their own formulas and often read a few degrees cooler on humid days.",
      "<strong>Sensación térmica</strong>: el índice de calor o la sensación por viento, calculados con las fórmulas del Servicio Meteorológico Nacional. En la tabla es el valor más alto previsto para lo que resta del día. Junto a la temperatura de arriba es el de la hora actual. Las apps del teléfono usan sus propias fórmulas y suelen marcar unos grados menos en días húmedos."
    ),
    T(
      lang,
      "<strong>Humidity</strong> is how much moisture the air holds right now, as a share of the most it could hold. When it is high, sweat dries slowly and a hot day feels hotter.",
      "<strong>Humedad</strong>: cuánta humedad tiene el aire en este momento, como porcentaje del máximo que podría tener. Cuando es alta, el sudor tarda en evaporarse y el calor se siente más."
    ),
    T(
      lang,
      "<strong>Dew point</strong> is the temperature the air would have to cool to before dew forms. Above about 70° the air feels muggy. Below about 55° it feels dry.",
      "<strong>Punto de rocío</strong>: la temperatura a la que tendría que enfriarse el aire para que se forme rocío. Arriba de unos 70° el aire se siente bochornoso. Abajo de unos 55° se siente seco."
    ),
    T(
      lang,
      "<strong>UV index</strong> is the EPA's forecast of the day's strongest sunburn-causing radiation (tomorrow's, once it is evening). 3 to 5 is moderate, 6 to 7 high, 8 to 10 very high, 11 and up extreme. At 6 or higher, wear sunscreen and stay in the shade around midday.",
      "<strong>Índice UV</strong>: el pronóstico de la EPA de la radiación más fuerte del día que causa quemaduras (el de mañana, cuando ya es de noche). De 3 a 5 es moderado, de 6 a 7 alto, de 8 a 10 muy alto y de 11 en adelante extremo. Con 6 o más, usa protector solar y busca sombra al mediodía."
    ),
    `${T(
      lang,
      "<strong>Air quality</strong> is the U.S. Air Quality Index right now, on a scale of 0 to 500. 0 to 50 is good, 51 to 100 moderate, 101 to 150 unhealthy for sensitive groups, and anything above 150 unhealthy for everyone.",
      "<strong>Calidad del aire</strong>: el Índice de Calidad del Aire de EE. UU. en este momento, en una escala de 0 a 500. De 0 a 50 es buena, de 51 a 100 moderada, de 101 a 150 insalubre para grupos sensibles y arriba de 150 insalubre para todos."
    )} ${aqiSourceNote(aqi, lang)} <a href="${airUrl}">${T(lang, "More on the air quality page", "Más en la página de calidad del aire")}</a>.`,
  ];
  return `<details class="about"><summary>${T(lang, "What these numbers mean", "Qué significan estos números")}</summary>${items.map((a) => `<p>${a}</p>`).join("")}</details>`;
}

export function homeHtml(weather, water, news, cal, tropics, burnban, lang) {
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
  const updatedLine = weather.updated ? `${T(lang, "Updated", "Actualizado")} ${dateStamp(weather.updated, lang)}` : "";
  const cond = now ? esc(translateConditions(now.shortForecast, lang)) : "";
  const hero = now
    ? `<section class="cur">
      ${now.icon ? `<img src="${iconUrl(now.icon, "large")}" alt="" width="86" height="86" fetchpriority="high">` : ""}
      <div>
        <p class="cur-temp">${esc(now.temperature)}&deg;</p>
        <p class="cur-cond">${cond}</p>
        ${feels != null ? `<p class="cur-line">${T(lang, "Feels like", "Sensación térmica de")} ${esc(feels)}&deg;</p>` : ""}
        ${windLine ? `<p class="cur-line">${T(lang, "Wind", "Viento de")} ${windLine}</p>` : ""}
        ${popNow ? `<p class="cur-line">${popNow}% ${T(lang, "chance of rain", "de probabilidad de lluvia")}</p>` : ""}
        <p class="cur-stamp">${updatedLine}</p>
      </div>
    </section>
    ${lead?.detailedForecast ? `<p class="outlook"><strong>${esc(translatePeriodName(lead.name, lang))}.</strong> ${esc(lead.detailedForecast)} <a href="${wUrl}">${T(lang, "Seven-day forecast", "Pronóstico de siete días")}</a></p>` : `<p class="outlook"><a href="${wUrl}">${T(lang, "Seven-day forecast", "Pronóstico de siete días")}</a></p>`}`
    : `<p class="outlook">${T(lang, "Current conditions are not available right now.", "Las condiciones actuales no están disponibles en este momento.")} <a href="${wUrl}">${T(lang, "Seven-day forecast", "Pronóstico de siete días")}</a></p>`;

  const dayPeek = (weather.periods ?? [])
    .slice(0, 2)
    .map((p) => `<li><span class="pk-label">${esc(translatePeriodName(p.name, lang))}</span><span class="pk-val">${esc(p.temperature)}&deg; &middot; ${esc(translateConditions(p.shortForecast, lang))}</span></li>`)
    .join("");
  const ws = hubWaterSummary(water, lang);
  const newsItems = (news.items ?? []).filter((n) => !n.crime).slice(0, 3);
  const newsList = newsItems.length
    ? newsItems.map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener nofollow">${esc(n.title)}</a></li>`).join("")
    : `<li class="muted">${T(lang, "No headlines in the last few days.", "Sin titulares en los últimos días.")}</li>`;
  const events = upcomingEvents(cal.events ?? []).slice(0, 3);
  const calList = events.length
    ? events
        .map((e) => {
          const when = new Date(e.start).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { timeZone: "UTC", month: "short", day: "numeric" });
          return `<li><span class="pk-label">${esc(when)}</span><span class="pk-val">${esc(translateEvent(e.summary, lang))}</span></li>`;
        })
        .join("")
    : `<li class="muted">${T(lang, "The district has no upcoming events posted.", "El distrito no tiene eventos próximos publicados.")}</li>`;

  const lk = (en, es) => (lang === "es" ? esPath(en) : en);
  const glance = todayGlance(weather, lang);
  const glanceList = (rows) => rows.map(([k, v]) => `<li><span class="pk-label">${k}</span><span class="pk-val">${v}</span></li>`).join("");
  const glanceTodayRows = glanceList(glance.today);
  const glanceNowRows = glanceList(glance.now);
  const glanceSrc = glanceSourceLine(weather, lang, true);
  const alertsUpdated = weather.updated ? `${T(lang, "Updated", "Actualizado")} ${clockStamp(weather.updated, lang)}` : "";
  const waterUpdated = water.updated ? `${T(lang, "Updated", "Actualizado")} ${clockStamp(water.updated, lang)}` : "";
  const bb = hubBurnBanSummary(burnban, lang);
  const bbUpdated = burnban?.updated ? `${T(lang, "Checked", "Verificado")} ${clockStamp(burnban.updated, lang)}` : "";
  const alertTypes = [...new Set(alerts.map((a) => a.event))];
  const waterOff = WATER_FLOOD_CATS.some((c) => ws.cls === waterCatClass(c)) || ws.cls === "w-unknown";
  const row = (href, label, cls, value, detail) =>
    `<li><span class="pk-label"><a href="${lk(href)}">${label}</a></span><span class="pk-val"><span class="mark ${cls}">${value}</span>${detail ? `<br><small>${detail}</small>` : ""}</span></li>`;
  const stamps = [
    alertsUpdated ? `${T(lang, "Alerts and water updated", "Alertas y agua actualizadas a las")} ${clockStamp(weather.updated, lang)}.` : "",
    bbUpdated ? `${T(lang, "Burn ban checked", "Prohibición de quemas verificada a las")} ${clockStamp(burnban.updated, lang)}.` : "",
  ].filter(Boolean).join(" ");
  const cards = `<div class="cols">
      <section class="conds" data-nosnippet>
        <h2>${T(lang, "Alerts and conditions", "Alertas y condiciones")}</h2>
        <ul class="peek">
          ${row("/alerts", T(lang, "Weather alerts", "Alertas del clima"), alerts.length ? "w-moderate" : "w-normal", alerts.length ? `${alerts.length} ${T(lang, "active", alerts.length === 1 ? "activa" : "activas")}` : T(lang, "None", "Ninguna"), alerts.length ? esc(alertTypes.slice(0, 3).join(", ")) + (alertTypes.length > 3 ? " …" : "") : "")}
          ${row("/water", T(lang, "Rivers and bayous", "Ríos y bayous"), ws.cls, esc(ws.label), waterOff ? esc(ws.detail) : "")}
          ${row("/burn-ban", T(lang, "Burn ban", "Prohibición de quemas"), bb.cls, esc(bb.label), bb.cls === "w-unknown" ? esc(bb.detail) : "")}
        </ul>
        ${stamps ? `<p class="sub">${stamps}</p>` : ""}
      </section>
      ${glanceTodayRows || glanceNowRows ? `<section data-nosnippet>
        <h2>${T(lang, "Today", "Hoy")}</h2>
        ${glanceTodayRows ? `<ul class="peek">${glanceTodayRows}</ul>` : ""}
        ${glanceNowRows ? `<p class="sub">${T(lang, "Right now", "Ahora mismo")}</p><ul class="peek">${glanceNowRows}</ul>` : ""}
        ${glanceExplainers(lang, weather.aqi)}
        ${glanceSrc ? `<p class="sub">${glanceSrc}</p>` : ""}
      </section>` : ""}
      <section data-nosnippet>
        <h2><a href="${lk("/weather")}">${T(lang, "Forecast", "Pronóstico")}</a></h2>
        <ul class="peek">${dayPeek || `<li class="muted">${T(lang, "The forecast is not available right now.", "El pronóstico no está disponible en este momento.")}</li>`}</ul>
        <p class="more"><a href="${lk("/hourly")}">${T(lang, "Hour by hour", "Hora por hora")}</a>, <a href="${lk("/radar")}">${T(lang, "radar", "radar")}</a>, <a href="${lk("/rain")}">${T(lang, "measured rain", "lluvia medida")}</a></p>
      </section>
      <section>
        <h2><a href="${lk("/news")}">${T(lang, "Local news", "Noticias locales")}</a></h2>
        <ul class="heads">${newsList}</ul>
        <p class="more"><a href="${lk("/news")}">${T(lang, "More headlines", "Más titulares")}</a></p>
      </section>
      <section>
        <h2><a href="${lk("/calendar")}">${T(lang, "Crosby ISD calendar", "Calendario de Crosby ISD")}</a></h2>
        <ul class="peek">${calList}</ul>
        <p class="more"><a href="${lk("/calendar")}">${T(lang, "Full school calendar", "Calendario escolar completo")}</a></p>
      </section>
    </div>`;

  const title = T(lang, "Crosby, TX — Weather, Water, News & Schools", "Crosby, TX — Clima, agua, noticias y escuelas");
  const desc = T(
    lang,
    "Crosby, Texas front page: live NWS weather, river and bayou flood levels, local headlines, and the Crosby ISD calendar. Fast, ad-free, no trackers.",
    "Portada de Crosby, Texas: clima del NWS en vivo, niveles de inundación, titulares locales y calendario de Crosby ISD. Rápida, sin anuncios ni rastreadores."
  );
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="msvalidate.01" content="71B0F51AEDA395D9136070A67436D4F9">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${T(lang, "Live weather, flood levels, local news, and school calendar for Crosby, Texas.", "Clima en vivo, niveles de inundación, noticias locales y calendario escolar para Crosby, Texas.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/", lang)}">
${sharedHead(lang)}
<link rel="canonical" href="${canonicalFor("/", lang)}">
${hreflangTags("/")}
${JSONLD_SITE}
<style>${BASE_CSS}
  .place { margin:0.5rem 0 0; }
  .dateline { margin:0.1rem 0 0; color:var(--muted); font-size:0.95rem; }
  .cols { columns:2 20rem; column-gap:2.5rem; margin-top:0.4rem; }
  .cols section { break-inside:avoid; overflow:hidden; }
  .cols h2 a { color:inherit; text-decoration:none; }
  .cols h2 a:hover { text-decoration:underline; }
  .pk-label a { color:var(--ink); }
  .conds .pk-val { font-weight:600; }
  .w-normal { --mark:var(--ok); } .w-action { --mark:var(--warn); } .w-minor { --mark:var(--hot); } .w-moderate { --mark:var(--bad); } .w-major { --mark:var(--severe); }
  .sub { margin:0.6rem 0 0; font-size:0.85rem; color:var(--muted); }
  .sub + .peek { margin-top:0.2rem; }
  .more { margin:0.6rem 0 0; font-size:0.95rem; }
  .heads { list-style:none; margin:0; padding:0; }
  .heads li { padding:0.4rem 0; border-bottom:1px solid var(--line); }
  .heads li:last-child { border-bottom:none; }
  .heads a { color:var(--ink); text-decoration:none; }
  .heads a:hover { text-decoration:underline; }
  .muted { color:var(--muted); }
  ${ALERT_BANNER_CSS}
  .notice { display:block; color:var(--ink); text-decoration:none; border-left:4px solid var(--mark); padding:0.15rem 0 0.15rem 0.9rem; margin-top:1rem; }
  .notice p { margin:0; }
  .notice .n-title { font-weight:700; }
  .notice .n-more { color:var(--link); text-decoration:underline; }
  .notice.fire { --mark:var(--hot); } .notice.storm { --mark:var(--severe); } .notice.watch { --mark:var(--warn); }
  .about { margin-top:0.6rem; font-size:0.92rem; }
  .about summary { cursor:pointer; color:var(--link); }
  .about p { margin:0.5rem 0 0; color:var(--muted); }
</style>
</head>
<body>
${topbar("/", lang)}
<main id="main">
  <h1 class="place">Crosby, Texas</h1>
  ${weather.updated ? `<p class="dateline">${glanceStamp(weather, lang)}</p>` : ""}
  <div data-nosnippet>
  ${alertsBanner(alerts, lang)}
  ${hubTropicsBanner(tropics, lang)}
  </div>
  ${hubBurnBanBanner(burnban, lang)}
  <div data-nosnippet>
  ${hero}
  </div>
  ${cards}
</main>
${footer({ page: "/", lang, source: T(lang, `Weather from the U.S. National Weather Service; water levels from NOAA/NWS; news aggregated from public sources.`, `Clima del Servicio Meteorológico Nacional de EE. UU.; niveles de agua de NOAA/NWS; noticias recopiladas de fuentes públicas.`), data: weather })}
<script>${HOME_SCRIPT}</script>
</body>
</html>`;
}

export function homeMarkdown(weather, water, news, cal, tropics, burnban, lang) {
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
    out.push(`**${alerts.length} ${T(lang, alerts.length === 1 ? "active alert" : "active alerts", alerts.length === 1 ? "alerta activa" : "alertas activas")}:** ${[...new Set(alerts.map((a) => a.event))].join("; ")}${summary ? ` — ${summary}` : ""}. [${T(lang, "View all alerts", "Ver todas las alertas")}](${canonicalFor("/alerts", lang)})`, "");
  }
  const storms = tropics?.storms ?? [];
  if (storms.length) {
    out.push(`**${T(lang, "Tropical activity in the Atlantic", "Actividad tropical en el Atlántico")}:** ${storms.map((s) => tropicsStormLine(s, lang)).join("; ")}. [${T(lang, "Track them", "Seguirlos")}](${canonicalFor("/tropics", lang)})`, "");
  } else {
    // Same >=40% gate as the HTML banner, from the same helper, so the two
    // representations of the front page cannot disagree about what is worth
    // mentioning.
    const watching = tropicsWatchAreas(tropics);
    if (watching.length)
      out.push(`**${T(lang, "Being watched in the Atlantic", "Bajo vigilancia en el Atlántico")}:** ${watching.map((d) => tropicsDisturbanceLine(d, lang)).join("; ")}. ${T(lang, "No named storm yet.", "Aún sin tormenta con nombre.")} [${T(lang, "Details", "Detalles")}](${canonicalFor("/tropics", lang)})`, "");
  }
  if (burnban?.status === "Yes") {
    out.push(`**${T(lang, "Harris County burn ban in effect", "Prohibición de quemas vigente en el condado de Harris")}:** ${T(lang, "No outdoor burning allowed countywide.", "No se permite quemar al aire libre en todo el condado.")} [${T(lang, "Details", "Detalles")}](${canonicalFor("/burn-ban", lang)})`, "");
  }
  const glance = todayGlance(weather, lang);
  if (glance.today.length || glance.now.length) {
    // glanceStamp's esc() is a no-op on locale date strings, so the same date
    // serves the markdown view. "Right now" mirrors the HTML card's grouping.
    out.push(`## ${T(lang, "Today", "Hoy")}`, "", `_${glanceStamp(weather, lang)}_`, "");
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
  const bb = hubBurnBanSummary(burnban, lang);
  out.push(`**${T(lang, "Burn ban", "Prohibición de quemas")}:** ${bb.label}${bb.cls === "w-normal" ? "" : ` — ${bb.detail}`}. [${T(lang, "Details", "Detalles")}](${canonicalFor("/burn-ban", lang)})`, "");
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
<title>crosbynews.com &mdash; temporarily unavailable</title>
${sharedHead("en")}</head>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem">
<h1>Temporarily unavailable</h1>
<p>We couldn't reach ${esc(source)} just now. Please try again shortly.</p>
<p><a href="/">Back to the front page</a></p>
</body></html>`;
}
