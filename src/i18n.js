import { SITE } from "./config.js";

// --- i18n: English + Mexican Spanish (es-MX) ------------------------------
// The site renders in English at the root paths and in Spanish under /es.
// Approach: keep English literals inline (so the English output is unchanged
// and easy to review) and supply the Spanish alongside via T(). Live NWS text
// is handled deterministically — short conditions go through a hand-written
// dictionary (NO machine translation), while free-form detailed-forecast
// paragraphs and safety-critical alert wording stay in NWS's official English.
// (NWS has no Spanish forecast/alert API, and its experimental auto-translation
// was paused in 2025 — so English is the only authoritative source.)
export const T = (lang, en, es) => (lang === "es" ? es : en);

// Map an English content path to its Spanish counterpart, and build canonical /
// hreflang URLs from a page's English path. "/" pairs with "/es".
export const esPath = (enPath) => (enPath === "/" ? "/es" : "/es" + enPath);
export const canonicalFor = (enPath, lang) => SITE + (lang === "es" ? esPath(enPath) : enPath);

// Reciprocal hreflang alternates linking the en/es versions of a page (plus an
// x-default pointing at English). Emitted in both languages' <head>.
export function hreflangTags(enPath) {
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
export const ES_SHORT = {
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

export function translateConditions(text, lang) {
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
export const ES_WEEKDAY = {
  Sunday: "Domingo", Monday: "Lunes", Tuesday: "Martes", Wednesday: "Miércoles",
  Thursday: "Jueves", Friday: "Viernes", Saturday: "Sábado",
};
export const ES_PERIOD = {
  Today: "Hoy",
  Tonight: "Esta noche",
  "This Morning": "Esta mañana",
  "This Afternoon": "Esta tarde",
  "This Evening": "Esta tarde-noche",
  Overnight: "Durante la madrugada",
  "Late Tonight": "Tarde por la noche",
};
export function translatePeriodName(name, lang) {
  if (lang !== "es" || !name) return name;
  if (ES_PERIOD[name]) return ES_PERIOD[name];
  if (ES_WEEKDAY[name]) return ES_WEEKDAY[name];
  const m = name.match(/^(\w+) Night$/);
  if (m && ES_WEEKDAY[m[1]]) return `${ES_WEEKDAY[m[1]]} por la noche`;
  return name; // holidays / unusual labels stay English (honest fallback)
}

// Wind speed ("5 to 10 mph" -> "5 a 10 mph") and direction (W -> O, SW -> SO).
export function translateWind(speed, lang) {
  if (lang !== "es" || !speed) return speed;
  return String(speed).replace(/\bto\b/g, "a");
}
export const ES_DIR = {
  N: "N", NNE: "NNE", NE: "NE", ENE: "ENE", E: "E", ESE: "ESE", SE: "SE", SSE: "SSE",
  S: "S", SSW: "SSO", SW: "SO", WSW: "OSO", W: "O", WNW: "ONO", NW: "NO", NNW: "NNO",
};
export const translateDir = (dir, lang) => (lang === "es" && dir ? ES_DIR[dir] || dir : dir);

// One honest line shown on the Spanish weather pages so the English NWS text
// isn't a surprise. Kept in the i18n block so it can't drift between pages.
export const ES_NWS_NOTE =
  "Las condiciones se traducen al español. Las descripciones detalladas del pronóstico y las alertas provienen del Servicio Meteorológico Nacional de EE.&nbsp;UU. y se muestran en su idioma oficial (inglés).";
// --- end i18n -------------------------------------------------------------
