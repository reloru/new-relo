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

import { parseTwoDisturbances, twoTextFromRss, safeAreaName, tropicsMarkdown, tropicsHtml, tropicsBasinNote } from "../src/features/tropics.js";

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

// The basin note. /tropics is Atlantic-only by design, but a reader who checks
// nhc.noaa.gov sees "...ISELLE NEAR HURRICANE STRENGTH..." and then a Crosby
// page that mentions nothing, and concludes the site is broken. It happened.
// Naming the other-basin storms is what closes that loop — a generic
// "Atlantic only" disclaimer still leaves the reader to work out which basin
// the name they just read belongs to.
console.log("\ntropicsBasinNote — explains the storm the reader just saw elsewhere:\n");
for (const lang of ["en", "es"]) {
  const named = tropicsBasinNote({ otherBasins: ["Iselle", "Ten-E"] }, lang);
  checkThat(`${lang}: names the Pacific storms`, named.includes("Iselle") && named.includes("Ten-E"));
  checkThat(`${lang}: says they do not reach Crosby`, /Crosby/.test(named));

  // Absent field = a KV entry written before this shipped. It must still say
  // something sensible rather than "undefined" or an empty sentence.
  const legacy = tropicsBasinNote({}, lang);
  checkThat(`${lang}: a legacy entry still reads as a sentence`, legacy.length > 40 && !/undefined|null/.test(legacy));
  checkThat(`${lang}: ...and names nobody it cannot name`, !/tracking\s+in/.test(legacy));

  // Proper nouns. An earlier version lower-cased the first letter of a spliced
  // clause and shipped "pacific storms form on the other side of Mexico".
  for (const data of [{ otherBasins: [] }, {}, { otherBasins: ["Iselle"] }]) {
    const t = tropicsBasinNote(data, lang);
    checkThat(`${lang}: no lower-cased proper noun (${(data.otherBasins ?? ["absent"]).length})`, !/\b(pacific|atlantic|mexico|crosby|pac\u00edfico|atl\u00e1ntico|m\u00e9xico)\b/.test(t));
  }
}

// Storm names reach markdown unescaped via tropicsStormLine, the same hole the
// area names had, so they are sanitised at the same boundary.
console.log("\nsafeAreaName — also guards storm names (they reach markdown too):\n");
check("a hostile storm name is stripped", safeAreaName("<script>alert(1)</script>"), "scriptalert(1)/script");
check("a real storm name is untouched", safeAreaName("Ten-E"), "Ten-E");

// Injection. CodeQL flagged the original tag-strip as "incomplete
// multi-character sanitization" and it was right, though not for the reason
// first assumed: the chain decoded entities in STAGES after stripping tags
// (`&lt;` then `&gt;` then `&amp;`), so `&lt;script&gt;` sailed through the
// strip as inert text and was then decoded into live markup. Verified before
// the fix: `/tropics?format=md` emitted `- **Bermuda <script>alert(1)</script>
// Area**`. HTML was safe because esc() covers it; markdown has no escaper at
// all, which is the same asymmetry that bit the news pipeline.
//
// Two layers now: a single-pass decode between two strip-to-fixpoint passes,
// and safeAreaName() at the PARSE boundary — because `area` reaches four
// consumers (HTML, markdown, the MCP text block, the JSON API) and only one of
// them escapes anything.
console.log("\nparseTwoDisturbances — no bulletin can inject markup into any renderer:\n");

const bulletin = (payload) =>
  `<rss><channel><item><description><![CDATA[Tropical Weather Outlook<br />NWS National Hurricane Center Miami FL<br /><br />For the North Atlantic...Caribbean Sea:<br /><br />${payload} Area:<br />prose<br />* Formation chance through 7 days...high...90 percent.<br /><br />$$]]></description></item></channel></rss>`;

// Every page carries a legitimate `<script type="application/ld+json">` for
// its structured data, so the HTML assertion counts against a CLEAN render
// rather than looking for the substring — an assertion that trips on the
// page's own JSON-LD proves nothing and would pass even with a real hole
// somewhere else.
const CLEAN = { updated: null, storms: [], disturbances: [] };
const baselineScripts = (tropicsHtml(CLEAN, "en").match(/<script/gi) ?? []).length;

for (const [label, payload] of [
  ["entity-encoded script", "Bermuda &lt;script&gt;alert(1)&lt;/script&gt;"],
  ["double-encoded script", "Bermuda &amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;"],
  ["nested tags that re-form on one strip pass", "Bermuda <scr<x>ipt>alert(1)"],
  ["dangling tag with no closing bracket", "Bermuda <script"],
  ["numeric character references", "Bermuda &#60;script&#62;"],
  ["markdown link-break injection", "Bermuda ](javascript:alert(1))[x"],
]) {
  const dz = parseTwoDisturbances(twoTextFromRss(bulletin(payload)));
  const data = { updated: null, storms: [], disturbances: dz };
  const md = tropicsMarkdown(data, "en");
  const html = tropicsHtml(data, "en");
  const area = dz[0]?.area ?? "";

  const areaClean = !/[<>]/.test(area) && !/javascript:/i.test(area);
  const mdClean = !/<script|javascript:/i.test(md);
  const htmlClean = (html.match(/<script/gi) ?? []).length === baselineScripts && !/javascript:/i.test(html);

  checkThat(`${label} — area carries no markup`, areaClean);
  checkThat(`${label} — markdown ships none (it has no escaper)`, mdClean);
  checkThat(`${label} — HTML adds no script tag beyond its own JSON-LD`, htmlClean);
}

// The allowlist itself: real NHC names must survive it untouched, or the
// sanitiser would be quietly corrupting the data it protects.
console.log("\nsafeAreaName — real NHC place names pass through unchanged:\n");
for (const name of [
  "Central Subtropical Atlantic",
  "Eastern Tropical Atlantic",
  "Near the Southeastern United States",
  "Offshore of the Carolinas",
  "Gulf of America",
  "Near the Cabo Verde Islands",
]) {
  check(`"${name}"`, safeAreaName(name), name);
}

// Both patterns here originally paired a whitespace-matching capture with an
// adjacent `\s*` — `([a-z ]+?)\s*` and `([^:]{2,89}?)\s*` — so on a line that
// ultimately fails to match, the engine could split a run of spaces between
// the two in quadratically many ways. CodeQL flagged it (high severity) and
// was right: the old chance pattern took 17ms at 200 spaces and 1424ms at
// 1600. This Worker has a CPU limit and the input is upstream text we do not
// control, so the fix was to make every adjacency pair disjoint character
// sets. A "readability" rewrite back toward `[a-z ]+?` reintroduces it, and
// nothing else in CI would notice.
console.log("\nparseTwoDisturbances — pathological input stays linear (ReDoS guard):\n");
// Sizes are capped at 1600 deliberately. The regression takes ~1.4s there and
// grows ~8x per doubling, so a bigger input would make a reintroduced ReDoS
// HANG this job instead of failing it — a red build that never finishes is
// worse than a red build. 1600 is comfortably past the 500ms budget while
// still returning promptly.
const budgetMs = 500;
let worst = 0;
for (const n of [400, 800, 1600]) {
  const evil = [
    "x",
    "",
    `Formation chance through 48 hours...${" ".repeat(n)}!`,
    "",
    `${"a".repeat(n)}${" ".repeat(n)}:`,
    "",
  ].join("\n");
  const t0 = Date.now();
  parseTwoDisturbances(evil);
  worst = Math.max(worst, Date.now() - t0);
}
checkThat(`${worst}ms worst case across 400/800/1600-space inputs (budget ${budgetMs}ms)`, worst < budgetMs);

console.log(
  failed === 0
    ? "\nTWO parsing OK — disturbances are found when NHC lists them, and never invented when it doesn't.\n"
    : `\n${failed} check(s) FAILED\n`
);
process.exit(failed === 0 ? 0 : 1);
