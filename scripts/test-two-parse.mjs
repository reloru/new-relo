// NHC Tropical Weather Outlook parsing — the disturbances /tropics missed.
//
// Why this file exists: on 2026-08-24 NHC was tracking two Atlantic areas —
// AL95 at 50% and AL96 at 60% over seven days — and /tropics rendered a green
// "Nothing active in the Atlantic". Nothing was broken. CurrentStorms.json
// lists named CYCLONES, it was correctly empty, and we had simply never read
// the outlook, where every pre-cyclone disturbance lives. A true sentence, on
// a hurricane page, in peak season, that reads as "nothing to watch".
//
// The TWO has no JSON form — it is forecaster prose — so the parse is the
// fragile part, and it fails the way scrapes fail: silently, by returning
// fewer things than the bulletin contains. An empty list is indistinguishable
// from a quiet basin unless something pins it. That is this file.
//
// Fixtures are REAL bulletins, kept verbatim including line wrapping.
//
// Run: node scripts/test-two-parse.mjs

import { parseTwoDisturbances, twoTextFromRss } from "../src/features/tropics.js";

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`}`);
};
const checkThat = (label, cond) => {
  if (!cond) failed++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`);
};

// The bulletin that exposed the gap, verbatim (ABNT20 KNHC 242308).
const LIVE = `000
ABNT20 KNHC 242308
TWOAT

Tropical Weather Outlook
NWS National Hurricane Center Miami FL
800 PM EDT Mon Aug 24 2026

For the North Atlantic...Caribbean Sea and the Gulf of America:

Central Subtropical Atlantic (AL95):
An area of low pressure located a couple of hundred miles east
of Bermuda is moving northward at 15 to 20 mph. Although the
shower activity is showing signs of organization, the circulation
remains broad and elongated. This system could become a
short-lived tropical depression or storm on Tuesday before it moves
over cool waters and into unfavorable environmental conditions
Tuesday night and Wednesday.
* Formation chance through 48 hours...medium...50 percent.
* Formation chance through 7 days...medium...50 percent.

Eastern Tropical Atlantic (AL96):
A tropical wave and associated area of low pressure over the far
eastern Atlantic a few hundred miles southeast of the Cabo Verde
islands is producing disorganized showers and thunderstorms. This
system could become a tropical depression during the next few days
while it moves westward to west-northwestward at 15 to 20 mph across
the eastern and central tropical Atlantic. Environmental conditions
could become less conducive for development by the weekend.
* Formation chance through 48 hours...medium...40 percent.
* Formation chance through 7 days...medium...60 percent.

$$
Forecaster Cangialosi`;

console.log("\nparseTwoDisturbances — the 2026-08-24 bulletin:\n");

const live = parseTwoDisturbances(LIVE);
check("finds both areas", live.length, 2);
check("first area name", live[0]?.area, "Central Subtropical Atlantic");
check("first area invest id", live[0]?.id, "AL95");
check("first 48-hour chance", live[0]?.chance48, 50);
check("first 7-day chance", live[0]?.chance7, 50);
check("second area invest id", live[1]?.id, "AL96");
check("second 48-hour chance", live[1]?.chance48, 40);
check("second 7-day chance", live[1]?.chance7, 60);
check("category is captured", live[1]?.category7, "medium");

// The whole point: the outlook is NOT empty when CurrentStorms.json is.
checkThat("a quiet CurrentStorms.json does not imply a quiet outlook", live.length > 0);

// A quiet basin — the genuinely-nothing case. This MUST come back empty, or
// the page would invent a disturbance out of the boilerplate.
const QUIET = `000
ABNT20 KNHC 031733
TWOAT

Tropical Weather Outlook
NWS National Hurricane Center Miami FL
200 PM EDT Sat May 3 2026

For the North Atlantic...Caribbean Sea and the Gulf of America:

Tropical cyclone formation is not expected during the next 7 days.

$$
Forecaster Blake`;

console.log("\nparseTwoDisturbances — a genuinely quiet basin:\n");
check("quiet outlook yields no disturbances", parseTwoDisturbances(QUIET), []);
check("the basin header is never a disturbance", parseTwoDisturbances(QUIET).length, 0);

// "near 0 percent" is how NHC writes a zero, and an unnamed area (no AL
// number) is normal early on. Both must parse.
const LOWCHANCE = `Tropical Weather Outlook
NWS National Hurricane Center Miami FL

For the North Atlantic...Caribbean Sea and the Gulf of America:

Near the Southeastern United States:
A trough of low pressure is producing disorganized shower activity.
* Formation chance through 48 hours...low...near 0 percent.
* Formation chance through 7 days...low...20 percent.

$$`;

console.log("\nparseTwoDisturbances — 'near 0 percent' and an area with no invest number:\n");
const low = parseTwoDisturbances(LOWCHANCE);
check("one area found", low.length, 1);
check("area with no AL number keeps a null id", low[0]?.id, null);
check("'near 0 percent' parses as 0, not null", low[0]?.chance48, 0);
check("...and is distinguishable from missing", low[0]?.chance7, 20);

// THE structural trap. A prose line ending in a colon sits between the heading
// and its percentages; without the blank-line requirement it becomes the
// "area" and the real heading's chances get attributed to a sentence
// fragment — a plausible-looking, wrong disturbance on a hurricane page.
const COLON_PROSE = `Tropical Weather Outlook
NWS National Hurricane Center Miami FL

For the North Atlantic...Caribbean Sea and the Gulf of America:

Central Subtropical Atlantic (AL95):
Environmental conditions are marginal for the following reasons:
dry air and moderate shear are both present near the center.
* Formation chance through 48 hours...low...20 percent.
* Formation chance through 7 days...low...30 percent.

$$`;

console.log("\nparseTwoDisturbances — a prose line ending in a colon must not steal the area:\n");
const trap = parseTwoDisturbances(COLON_PROSE);
check("still exactly one disturbance", trap.length, 1);
check("area is the real heading", trap[0]?.area, "Central Subtropical Atlantic");
check("...not the prose fragment", trap[0]?.area.includes("following reasons"), false);
check("the chances attach to it", trap[0]?.chance7, 30);

// A colon heading with NO formation chance under it. NHC writes these — a
// "Special Feature:" advisory note, a section pointing at another product.
// Kept, it becomes a disturbance with null percentages, and the page reports
// an area being watched that NHC never assigned a chance to: a fabricated
// entry, rendered with the same weight as a real one.
const HEADING_NO_CHANCE = `Tropical Weather Outlook
NWS National Hurricane Center Miami FL

For the North Atlantic...Caribbean Sea and the Gulf of America:

Special Feature:
Interests in Bermuda should monitor the progress of this system and
consult products from their national meteorological service.

Eastern Tropical Atlantic (AL96):
A tropical wave is producing disorganized showers.
* Formation chance through 48 hours...low...10 percent.
* Formation chance through 7 days...medium...40 percent.

$$`;

console.log("\nparseTwoDisturbances — a heading with no percentages is not a disturbance:\n");
const noChance = parseTwoDisturbances(HEADING_NO_CHANCE);
check("only the real area survives", noChance.length, 1);
check("...and it is the one with chances", noChance[0]?.id, "AL96");
checkThat("'Special Feature' is not reported as an area", !noChance.some((d) => /Special Feature/i.test(d.area)));

console.log("\ntwoTextFromRss — the bulletin is chosen by content, not position:\n");

// The channel description and the NOAA-logo item are decoys that appear BEFORE
// the real one, so a "take the first <description>" reading picks boilerplate
// and every disturbance disappears with nothing failing.
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Atlantic Tropical Weather Outlook</title>
    <description>National Hurricane Center - Atlantic Tropical Weather Outlook</description>
    <pubDate>Mon, 24 Aug 2026 23:14:40 +0000</pubDate>
    <item>
      <title>Atlantic Tropical Weather Outlook</title>
      <description>NOAA logo</description>
    </item>
    <item>
      <title>Atlantic Tropical Weather Outlook</title>
      <pubDate>Mon, 24 Aug 2026 23:08:20 +0000</pubDate>
      <description><![CDATA[000<br />ABNT20 KNHC 242308<br />TWOAT <br /><br />Tropical Weather Outlook<br />NWS National Hurricane Center Miami FL<br />800 PM EDT Mon Aug 24 2026<br /><br />For the North Atlantic...Caribbean Sea and the Gulf of America:<br /><br />Central Subtropical Atlantic (AL95):<br />An area of low pressure located a couple of hundred miles east <br />of Bermuda is moving northward at 15 to 20 mph.<br />* Formation chance through 48 hours...medium...50 percent.<br />* Formation chance through 7 days...medium...50 percent.<br /><br />$$<br />Forecaster Cangialosi]]></description>
    </item>
  </channel>
</rss>`;

const text = twoTextFromRss(RSS);
checkThat("skips the channel description boilerplate", !/^National Hurricane Center - Atlantic/.test(String(text).trim()));
checkThat("skips the NOAA logo item", String(text) !== "NOAA logo");
checkThat("returns the real bulletin", /Formation chance/.test(String(text)));
checkThat("<br /> became real line breaks", String(text).split("\n").length > 5);

const fromRss = parseTwoDisturbances(text);
check("end to end: RSS envelope in, disturbance out", fromRss.length, 1);
check("end to end: the right area", fromRss[0]?.area, "Central Subtropical Atlantic");
check("end to end: the right 7-day chance", fromRss[0]?.chance7, 50);

// An envelope with no bulletin returns null so fetchTwoDisturbances() throws
// rather than writing an empty list, which would read as "nothing brewing".
console.log("\ntwoTextFromRss — no bulletin returns null (so the fetch throws):\n");
check("empty document", twoTextFromRss(""), null);
check("envelope with only boilerplate", twoTextFromRss(`<rss><channel><description>NOAA logo</description></channel></rss>`), null);

console.log(
  failed === 0
    ? "\nTWO parsing OK — disturbances are found when NHC lists them, and never invented when it doesn't.\n"
    : `\n${failed} check(s) FAILED\n`
);
process.exit(failed === 0 ? 0 : 1);
