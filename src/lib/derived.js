// The weather values computed in-Worker rather than taken verbatim from NWS:
// "feels like" (heat index / wind chill, from NWS's own published formulas)
// and sunrise/sunset (the standard sunrise equation, SunCalc formulation —
// the NWS forecast API publishes no sun times). Both are disclosed on /about
// as the two exceptions to "we don't adjust the numbers".
//
// currentHourly() also lives here: it is the invariant that the hourly period
// covering now is chosen by timestamp, never hourly[0], which is the NWS
// product's generation hour and can lag the wall clock by an hour or more.

import { LAT, LON, TZ } from "../config.js";

// Probability of precipitation as a whole number (NWS gives {value:null|number}).
export function pop(period) {
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
export function heatIndexF(tempF, rhPercent) {
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
export function windChillF(tempF, windMph) {
  if (typeof tempF !== "number" || typeof windMph !== "number" || tempF > 50 || windMph < 3) return null;
  const v16 = Math.pow(windMph, 0.16);
  return Math.round(35.74 + 0.6215 * tempF - 35.75 * v16 + 0.4275 * tempF * v16);
}
// Combine both into one "feels like" value for a period, or null if neither
// heat index nor wind chill applies.
export function feelsLikeRawF(period) {
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
export function currentHourly(data) {
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
export function feelsLikeF(period) {
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
export function sunTimes(ms) {
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
export function sunTimesForCtDate(ms) {
  const [y, m, d] = new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ }).split("-").map(Number);
  return sunTimes(Date.UTC(y, m - 1, d, 18));
}

// NWS icon URLs carry a ?size= param; bump it for crisper rendering, and
