// Presentation helpers: HTML escaping, Central-time date formatting, and the
// NWS icon-proxy URL rewrite. Pure functions — no data loading, no rendering.

import { TZ } from "../config.js";
import { T } from "../i18n.js";

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function nl2br(value) {
  return esc(value).replace(/\n/g, "<br>");
}

// rewrite api.weather.gov hotlinks to our own /icons proxy. NWS's robots.txt
// disallows all crawling, so hotlinked images are uncrawlable (and slower) —
// serving them from our origin makes them indexable and edge-cacheable.
export function iconUrl(url, size) {
  if (!url) return "";
  const sized = url.replace(/size=\w+/, `size=${size}`);
  return esc(sized.replace("https://api.weather.gov/icons/", "/icons/"));
}


// Date/time formatting. `lang` is optional and defaults to English, so every
// existing English call site is unchanged; the Spanish (/es) render paths pass
// "es" to get es-MX month/weekday/AM-PM rendering. Times stay in Central (CT).
export function fmt(iso, opts, lang) {
  try {
    return new Date(iso).toLocaleString(lang === "es" ? "es-MX" : "en-US", { timeZone: TZ, ...opts });
  } catch {
    return "";
  }
}
export const fullTime = (iso, lang) => fmt(iso, { dateStyle: "medium", timeStyle: "short" }, lang);
export const clockTime = (iso, lang) => fmt(iso, { hour: "numeric", minute: "2-digit" }, lang);
export const hourLabel = (iso, lang) => fmt(iso, { hour: "numeric" }, lang);
export const dayLabel = (iso, lang) => fmt(iso, { weekday: "long", month: "short", day: "numeric" }, lang);
// Spanish correctly lowercases weekday/month names in running text, but our
// UI uses them as HEADINGS ("Sábado 4 de jul"), where a leading capital is
// the site-wide convention (the calendar page already does this).
export const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// Compact relative freshness ("6 min ago") for the glance data-source
// footnote, computed at render time from the cache's `updated` stamp. Paired
// with the absolute clock time so it stays unambiguous even if a tab lingers.
export function relTime(iso, lang) {
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

// RFC 822 date for the RSS feeds. Falls back to now on an unparseable stamp,
// so a feed never emits an invalid <pubDate>.
export const rssDate = (x) => {
  const d = new Date(x ?? Date.now());
  return (isNaN(d.getTime()) ? new Date() : d).toUTCString();
};
