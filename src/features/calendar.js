// Crosby ISD school calendar, from the district's combined iCal feed.
//
// Times are floating Central wall-clock: the cal* helpers format with
// timeZone: "UTC" deliberately, so a floating time renders exactly as the
// district published it rather than being shifted.

import { TZ } from "../config.js";
import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc, fullTime } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON } from "../seo.js";

// Crosby ISD publishes public iCal feeds. We render the combined "All
// Calendars" feed (the union of every campus) so the page always has content
// and automatically picks up the District academic dates — first day, holidays,
// breaks — once they're posted. The feed is a small static .ics (no RRULE), so
// a tiny hand-rolled parser suffices; no dependency, in keeping with the repo.
// The Worker CAN reach crosbyisd.org (unlike Google News), so this uses the
// cron + KV pattern (key "calendar", cron-owned), not the out-of-band routine.
export const CALENDAR_KV_KEY = "calendar";
export const CISD_SITE = "https://www.crosbyisd.org/";
export const CISD_FEED_ALL_ICS =
  "https://www.crosbyisd.org/cf_calendar/feed.cfm?type=ical&feedID=BB92BE3D0A3744EA9AF7870F2D07E0A2";
export const CISD_FEED_ALL_WEBCAL =
  "webcal://www.crosbyisd.org/cf_calendar/feed.cfm?type=ical&feedID=BB92BE3D0A3744EA9AF7870F2D07E0A2";
export const CISD_FEED_ALL_GOOGLE =
  "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(CISD_FEED_ALL_ICS);
// Per-campus feeds (calendar_<id>.ics). 350 is the District academic calendar.
export const CISD_CAMPUSES = [
  { id: 350, en: "District", es: "Distrito" },
  { id: 354, en: "Crosby High School", es: "Crosby High School" },
  { id: 359, en: "Crosby Middle School", es: "Crosby Middle School" },
  { id: 351, en: "Barrett Elementary", es: "Barrett Elementary" },
  { id: 357, en: "Crosby Elementary", es: "Crosby Elementary" },
  { id: 353, en: "Drew Elementary", es: "Drew Elementary" },
  { id: 356, en: "Newport Elementary", es: "Newport Elementary" },
  { id: 355, en: "Kindergarten Center", es: "Centro de Kínder" },
];
export const campusWebcal = (id) => `webcal://www.crosbyisd.org/calendar/calendar_${id}.ics`;

// A handful of evergreen event names; everything else keeps the district's
// official English (honest fallback), with Spanish hints appended for the few
// high-utility patterns parents scan for. Same policy as the NWS/news text.
export const ES_EVENT = {
  "FIRST DAY OF SCHOOL!": "¡PRIMER DÍA DE CLASES!",
  "FIRST DAY OF SCHOOL": "Primer día de clases",
  "LAST DAY OF SCHOOL": "Último día de clases",
  "LABOR DAY- NO SCHOOL!": "Día del Trabajo — ¡no hay clases!",
  TUTORIALS: "Tutorías",
  "STAAR/EOC TESTING": "Exámenes STAAR/EOC",
  "SUMMER BAND CAMP": "Campamento de banda de verano",
};
export function translateEvent(summary, lang) {
  if (lang !== "es" || !summary) return summary;
  const key = summary.trim().toUpperCase();
  if (ES_EVENT[key]) return ES_EVENT[key];
  if (/no school/i.test(summary)) return `${summary} (no hay clases)`;
  if (/early release|early dismissal/i.test(summary)) return `${summary} (salida temprana)`;
  return summary;
}

// Minimal RFC 5545 reader: unfold continuation lines, then pull VEVENT fields.
// The CISD feed has no RRULE, so no recurrence expansion is needed.
export function parseIcs(text) {
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
export function parseIcsDate(v) {
  const m = String(v).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const hasTime = h !== undefined;
  return { ms: Date.UTC(+y, +mo - 1, +d, hasTime ? +h : 0, hasTime ? +mi : 0, hasTime ? +(se || 0) : 0), hasTime };
}

export function unescapeIcs(v) {
  return String(v).replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

export async function fetchCalendar() {
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
export async function loadCalendar(env) {
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
export function upcomingEvents(events) {
  const cutoff = Date.now() - 18 * 3600 * 1000;
  return (events ?? [])
    .filter((e) => typeof e.start === "number" && (e.end ?? e.start) >= cutoff)
    .sort((a, b) => a.start - b.start)
    .slice(0, 60);
}

export const calDow = (ms, lang) => new Date(ms).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { timeZone: "UTC", weekday: "short" });
export const calDayNum = (ms) => new Date(ms).toLocaleDateString("en-US", { timeZone: "UTC", day: "numeric" });
export const calTime = (ms, lang) => new Date(ms).toLocaleTimeString(lang === "es" ? "es-MX" : "en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
export const calMonth = (ms, lang) => new Date(ms).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { timeZone: "UTC", month: "long", year: "numeric" });

// schema.org Event JSON-LD for the shown events — honest structured data (Event
// is a real type, unlike the forecast). Floating local datetimes are emitted
// without an offset (valid ISO 8601); all-day events as plain dates.
export function jsonldEvents(events, lang) {
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

export function calendarSubscribe(lang) {
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

export function calendarHtml(data, lang) {
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

export function calendarMarkdown(data, lang) {
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

// JSON shape served at /api/calendar — upcoming Crosby ISD events. The feed's
// datetimes are floating local (Central); like the Event JSON-LD, timed values
// are emitted as zone-less ISO 8601 local time and all-day events as plain
// dates, preserving the district's authored wall-clock.
export function apiCalendar(data) {
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
