// What a page shows for a given reading.
//
// Each check here guards a place where the page once said something the data
// did not: an air reading labelled "modeled" when it was measured, one lane
// closure listed four times, a raw agency timestamp, a badge whose meaning was
// never given. Expected values are written out by hand from the fixtures.
//
// Run: node scripts/test-display.mjs

import { createHarness } from "./lib/harness.mjs";
import { parseTrafficClosure, uniqueClosures } from "../src/features/traffic.js";
import { aqiObservedIso } from "../src/features/air.js";
import { fishingNote } from "../src/features/fishing.js";

const failures = [];
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${what}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const has = (text, needle, what) => { if (!text.includes(needle)) failures.push(`${what}: missing ${JSON.stringify(needle)}`); };
const lacks = (text, needle, what) => { if (text.includes(needle)) failures.push(`${what}: still contains ${JSON.stringify(needle)}`); };

// --- Lane closures: TranStar repeats a closure; the page lists it once. ---

eq(
  parseTrafficClosure({ title: " US-90 Eastbound from Wallisville Rd to Uvalde ", description: "Closed daily  on Monday, November 16 from 9:00 AM to 4:00 PM - Lanes Affected: 1 Inside Lane(s) - Status: Active" }),
  { location: "US-90 Eastbound from Wallisville Rd to Uvalde", schedule: "Closed daily on Monday, November 16 from 9:00 AM to 4:00 PM", lanes: "1 Inside Lane(s)", status: "Active" },
  "a closure's schedule is read with single spaces",
);

const WB = "US-90 Westbound Frontage Road from Uvalde to S Lake Houston Pkwy";
const WEEK = "Closed daily from 9:00 AM to 3:30 PM, Monday, November 16 to Friday, November 20";
eq(
  uniqueClosures([
    { location: WB, schedule: WEEK, lanes: "1 Inside Lane(s)", status: "Inactive" },
    { location: WB, schedule: WEEK, lanes: "1 Inside Lane(s)", status: "Active" },
    { location: WB, schedule: WEEK, lanes: "1 Inside Lane(s)", status: "Inactive" },
    { location: WB, schedule: WEEK, lanes: "2 Outside Lane(s)", status: "Inactive" },
    { location: "FM-2100 Northbound at US-90", schedule: WEEK, lanes: "1 Inside Lane(s)", status: "Inactive" },
  ]),
  [
    { location: WB, schedule: WEEK, lanes: "1 Inside Lane(s)", status: "Active" },
    { location: WB, schedule: WEEK, lanes: "2 Outside Lane(s)", status: "Inactive" },
    { location: "FM-2100 Northbound at US-90", schedule: WEEK, lanes: "1 Inside Lane(s)", status: "Inactive" },
  ],
  "repeats collapse to one row, an active one wins, and different lanes or roads stay apart",
);
eq(uniqueClosures([]), [], "no closures stays an empty list");

// --- Air: AirNow's local stamp becomes an instant. ---

eq(aqiObservedIso("2026-11-10 22:00 CST"), "2026-11-10T22:00:00-06:00", "a winter stamp is Central Standard Time");
eq(aqiObservedIso("2026-07-04 9 CDT"), "2026-07-04T09:00:00-05:00", "a summer stamp with a bare hour is Central Daylight Time");
eq(aqiObservedIso("2026-11-10"), null, "a date with no hour is not turned into an instant");
eq(aqiObservedIso(null), null, "no stamp gives null");

// --- Fishing: the note never repeats the badge. ---

const station = (params) => ({ id: "x", params: Object.fromEntries(Object.entries(params).map(([k, value]) => [k, { value }])) });
eq(fishingNote(station({ do: 9, tempC: 21.6, turb: 18.4 }), "en"), "", "healthy oxygen and nothing else to remark on: no note");
eq(fishingNote(station({ do: 9, tempC: 21.6, turb: 60 }), "en"), "The water is stained, which suits baits with scent or vibration.", "a note is a full sentence");
eq(
  fishingNote(station({ do: 3.2, tempC: 30, turb: 4 }), "en"),
  "Oxygen is low and fish are likely sluggish, so try early morning or near inflows. The water is warm at 86°F, so try deeper, shaded water at midday. The water is clear, which suits lighter, natural-looking baits.",
  "low oxygen, warm and clear water give three sentences",
);

// --- The pages, rendered by the real Worker against the fixtures. ---

const h = await createHarness();
const page = async (path, accept = "text/html") => {
  const res = await h.get(path, { headers: { accept } });
  if (res.status !== 200) failures.push(`${path}: status ${res.status}`);
  return res.text();
};

// The fixture's air reading is measured: PM2.5 60 at Clinton, 2026-11-10 22:00 CST.
const air = await page("/air");
has(air, 'measured <time datetime="2026-11-11T04:00:00.000Z">Nov 10, 2026, 10:00 PM CT</time>', "/air: the reading's time in the site's format");
lacks(air, "2026-11-10 22:00 CST", "/air: AirNow's raw stamp");
lacks(air, " , ", "/air: a space before a comma");
has(await page("/air", "text/markdown"), "Measured Nov 10, 2026, 10:00 PM CT.", "/air as Markdown: the reading's time");

const weatherMd = await page("/weather", "text/markdown");
has(weatherMd, "Air 60 (Moderate, Clinton monitor)", "/weather as Markdown: a measured reading names its monitor");
lacks(weatherMd, "modeled", "/weather as Markdown: a measured reading called modeled");

// Lake Houston (HSJT2) has no flood categories in the fixture.
const water = await page("/water");
has(water, '<p class="gauge-th">The National Weather Service defines no flood stages for this gauge.</p>', "/water: the Monitored badge is explained on its card");
has(water, "cubic feet per second (cfs)", "/water: the flow unit is spelled out");
has(water, "Action stage is the level at which", "/water: action stage is defined");
has(await page("/es/water"), "pies cúbicos por segundo (pie³/s)", "/es/water: the flow unit is spelled out");

const fishing = await page("/fishing");
has(fishing, '<span class="fk">Turbidity</span>', "/fishing: the live sensor reading is called turbidity");
has(fishing, "formazin nephelometric units", "/fishing: FNU is spelled out");
has(fishing, "A higher number means cloudier water.", "/fishing: which way the number runs");
lacks(fishing, "oxygen is healthy", "/fishing: a note repeating the badge");
lacks(fishing, '<p class="fnote"></p>', "/fishing: an empty note");

const home = await page("/");
has(home, '<p class="hub-water-detail">No gauge near Crosby is at flood stage</p>', "/: the water card says what All normal means");
lacks(home, "Fast, ad-free", "/: a sales word in the description");

// A modeled reading is still labelled as one.
const weather = JSON.parse(h.kv.store.get("weather"));
weather.aqi = { ...weather.aqi, measured: false, source: "open-meteo", observed: null, dominantSite: null };
h.kv.store.set("weather", JSON.stringify(weather));
has(await page("/weather", "text/markdown"), "Air 60 (Moderate, modeled)", "/weather as Markdown: the fallback reading says modeled");

if (failures.length) {
  console.error(`Display checks failed (${failures.length}):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("Display OK: closures, air stamps, fishing notes and the water explanations read as the data says.");
