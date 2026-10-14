// Stub page data shared by the scripts that render every page without a
// Worker runtime: scripts/check-renders.mjs and scripts/test-icons.mjs.

export const ISO = new Date().toISOString();

// Shaped like the KV payloads, so renderers get far enough in to touch their
// language branches rather than bailing at the first guard.
const period = {
  number: 1, name: "Today", startTime: ISO, endTime: ISO, isDaytime: true,
  temperature: 78, temperatureUnit: "F", temperatureTrend: null,
  shortForecast: "Sunny", detailedForecast: "Sunny skies.",
  windSpeed: "5 mph", windDirection: "SW", windGust: "10 mph",
  probabilityOfPrecipitation: { value: 10 }, relativeHumidity: { value: 60 },
  dewpoint: { value: 20 }, icon: "https://api.weather.gov/icons/land/day/few?size=small",
};
export const DATA = {
  updated: ISO, place: "Crosby, TX",
  hourly: [period, { ...period, isDaytime: false }], periods: [period],
  alerts: [{ id: "urn:x", event: "Flash Flood Warning", severity: "Severe",
             headline: "H", description: "D", instruction: "I",
             effective: ISO, expires: ISO, onset: ISO, ends: ISO }],
  uv: { hourly: [] },
  aqi: { usAqi: 38, category: "Good", dominant: "pm25",
         subIndices: { pm25: 38, ozone: 11, pm10: 23 },
         sites: { pm25: "Baytown C148" }, dominantSite: "Baytown C148",
         agency: "TCEQ", measured: true, observed: ISO,
         nearby: { site: "Channelview C15", distanceMi: 8.5, aqi: 20,
                   agency: "TCEQ", observedIso: ISO } },
  gauges: [{ id: "x", name: "Cedar Bayou", category: "no_flooding",
             observed: { stage: 1, flow: 1 }, thresholds: {} }],
  items: [{ title: "T", link: "https://e.com/a", source: "S", published: ISO, category: "community" }],
  events: [{ summary: "E", start: Date.now(), allDay: true, location: "Crosby ISD" }],
  storms: [], stations: [], incidents: [], closures: [],
  countDate: ISO.slice(0, 10), url: "https://e.com",
  groups: { tree: { category: "Low", count: 1 } }, species: {},
};
