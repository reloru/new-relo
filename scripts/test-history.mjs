// /history: counts by type and year, computed from the record. Checked against
// values written out by hand for a small seeded set of real-shaped rows, never
// against the page's own helpers.
//
// Run: node scripts/test-history.mjs

import { createHarness, SITE } from "./lib/harness.mjs";

const failures = [];
const ok = (cond, what) => { if (!cond) failures.push(what); };
const has = (body, text, what) => ok(body.includes(text), `${what}: expected to find ${JSON.stringify(text)}`);
const lacks = (body, text, what) => ok(!body.includes(text), `${what}: must not contain ${JSON.stringify(text)}`);

const h = await createHarness();
const ev = (year, ph, sig, etn, scope, name, issued, extra = {}) =>
  `(${year}, 'HGX', '${ph}', '${sig}', ${etn}, '${scope}', '${name}', '${issued}', NULL, 'iem', ${extra.nwsli ? `'${extra.nwsli}'` : "NULL"}, ${extra.tags ? `'${extra.tags}'` : "NULL"})`;
h.env.DB.raw.exec(`INSERT INTO nws_events VALUES
  ${[
    ev(2009, "TO", "W", 1, "point", "Tornado Warning", "2009-04-12T16:51:00.000Z"),
    ev(2009, "TO", "W", 2, "point", "Tornado Warning", "2009-04-12T17:17:00.000Z"),
    // 03:31 UTC on May 19 is 10:31 PM on May 18 in Central time.
    ev(2021, "TO", "W", 3, "point", "Tornado Warning", "2021-05-19T03:31:00.000Z", { tags: '{"tornado":"RADAR INDICATED","hailInches":0}' }),
    // 03:00 UTC on Jan 1 2022 is still Dec 31 2021 in Central time.
    ev(2022, "SV", "W", 4, "point", "Severe Thunderstorm Warning", "2022-01-01T03:00:00.000Z"),
    ev(2024, "SV", "W", 5, "point", "Severe Thunderstorm Warning", "2024-05-16T23:16:00.000Z", { tags: '{"damage":"DESTRUCTIVE","hailInches":0.75,"windMph":80}' }),
    ev(2024, "FF", "W", 6, "point", "Flash Flood Warning", "2024-05-02T10:00:00.000Z"),
    ev(2008, "HU", "W", 7, "zone", "Hurricane Warning", "2008-09-11T15:00:00.000Z"),
    ev(2008, "HU", "W", 8, "zone", "Hurricane Warning", "2008-09-11T16:34:00.000Z"),
    ev(2005, "FG", "Y", 9, "zone", "Dense Fog Advisory", "2005-11-07T06:24:00.000Z"),
    ev(2021, "FZ", "W", 10, "zone", "Freeze Warning", "2021-02-14T09:00:00.000Z"),
    ev(2021, "FZ", "W", 11, "zone", "Freeze Warning", "2021-02-15T09:00:00.000Z"),
    ev(2021, "FZ", "W", 12, "zone", "Freeze Warning", "2021-02-16T09:00:00.000Z"),
    ev(2006, "TO", "A", 13, "county", "Tornado Watch", "2006-04-20T23:36:00.000Z"),
    ev(2024, "FL", "W", 14, "gauge", "Flood Warning", "2024-05-03T08:57:00.000Z", { nwsli: "SHLT2" }),
    ev(2024, "FL", "W", 15, "gauge", "Flood Warning", "2024-05-04T08:57:00.000Z", { nwsli: "HFFT2" }),
  ].join(",\n  ")}`);

const get = async (path, accept = "text/html") => {
  const r = await h.get(path, { headers: { accept } });
  const body = await r.text();
  return { r, main: accept === "text/html" ? body.slice(body.indexOf('<main id="main"'), body.lastIndexOf("</main>")) : body };
};

{
  const { r, main } = await get("/history");
  ok(r.status === 200, `status ${r.status}`);
  has(main, "has issued 3 tornado warnings whose warned area included Crosby: in 2009 (2) and 2021.", "tornado count and years");
  has(main, "2 severe thunderstorm warnings and 1 flash flood warning covered Crosby", "lede counts, with singular and plural right");
  // Year table: the Jan 1 03:00 UTC warning belongs to 2021 in Central time.
  const y2021 = main.slice(main.indexOf("<tr><td>2021</td>"), main.indexOf("</tr>", main.indexOf("<tr><td>2021</td>")));
  has(y2021, '<td class="num">1</td><td class="num">1</td>', "2021 row: 1 tornado, then 1 severe thunderstorm (the New Year's Eve warning)");
  const y2022 = main.slice(main.indexOf("<tr><td>2022</td>"), main.indexOf("</tr>", main.indexOf("<tr><td>2022</td>")));
  has(y2022, '<td class="num">0</td><td class="num">0</td><td class="num">0</td><td class="num">0</td><td class="num">0</td>', "2022 row is all zeros");
  has(main, "<tr><td>2007</td>", "the table runs back to 2007");
  has(main, "May 18, 2021, 10:31 PM CT", "tornado list in Central time");
  has(main, "tornado radar indicated", "tornado tag");
  has(main, "destructive damage threat, winds to 80 mph, hail to 0.75 in", "damage-threat list");
  const damage = main.slice(main.indexOf("with a damage threat"), main.indexOf("Zone products"));
  lacks(damage, "Dec 31, 2021", "a severe thunderstorm warning without a damage tag in the damage-threat list");
  has(main, "Hurricane Warning: 2 (Sep 11, 2008)", "rare zone warning carries its date once");
  has(main, "Freeze Warning: 3;", "common zone warning shows its count only");
  has(main, "since Nov 7, 2005", "zone record start, computed");
  lacks(main, "Dense Fog Advisory: ", "advisories are not in the lede");
  has(main, 'href="/water/san-jacinto-sheldon">San Jacinto River near Sheldon</a>', "gauge with a page is linked");
  has(main, "<td>Luce Bayou near Huffman</td>", "gauge without a page is named, not linked");
  has(main, "Oct 1, 2007", "polygon start date printed");
  has(main, "Inland Harris", "zone redraw printed");
  has(main, "Iowa Environmental Mesonet", "archive credited");
  ok(r.headers.get("last-modified") === "Thu, 16 May 2024 23:16:00 GMT", `Last-Modified is the newest event (got ${r.headers.get("last-modified")})`);
}
{
  const { main } = await get("/es/history");
  has(main, "Aviso de huracán: 2 (11 sep 2008)", "Spanish event names from the dictionary");
  has(main, 'href="/es/water/san-jacinto-sheldon"', "Spanish gauge link");
  has(main, "tornado indicado por radar", "Spanish tag");
}
{
  const { main } = await get("/history", "text/markdown");
  has(main, "| 2021 | 1 | 1 | 0 | 0 | 0 |", "markdown year row");
  has(main, `[San Jacinto River near Sheldon](${SITE}/water/san-jacinto-sheldon)`, "markdown gauge link");
}
{
  const xml = await (await h.get("/sitemap.xml")).text();
  has(xml, `<loc>${SITE}/history</loc>\n    <lastmod>2024-05-16T23:16:00.000Z</lastmod>`, "sitemap dates /history by its newest event");
  has((await get("/alerts")).main, 'href="/history"', "/alerts links /history");
  has((await get("/es/water/cedar-bayou-crosby")).main, 'href="/es/history"', "gauge pages link /history");
}
{
  // A received alert newer than every event moves the date: the page shows it.
  h.env.DB.raw.exec("INSERT INTO alerts (id, event, first_seen, last_seen) VALUES ('urn:a', 'Flood Advisory', '2026-11-11T05:00:00.000Z', '2026-11-11T05:00:00.000Z')");
  const r = await h.get("/history", { headers: { accept: "text/html" } });
  ok(r.headers.get("last-modified") === "Wed, 11 Nov 2026 05:00:00 GMT", `a received alert dates the page (got ${r.headers.get("last-modified")})`);
  has(await r.text(), "1 alert messages so far", "the received alert is counted");
}
{
  const real = h.env.DB;
  h.env.DB = { prepare: () => { throw new Error("D1 down"); } };
  const quiet = console.error;
  console.error = () => {};
  const r = await h.get("/history", { headers: { accept: "text/html" } });
  console.error = quiet;
  ok(r.status === 502, `a database failure answers 502, got ${r.status}`);
  h.env.DB = real;
}

{
  const r = await h.get("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_warning_history", arguments: {} } }) });
  const res = (await r.json()).result;
  ok(!res.isError, "get_warning_history answers");
  const sc = res.structuredContent;
  ok(sc.totals.tornado === 3 && sc.totals.severeThunderstorm === 2 && sc.totals.flashFlood === 1, `tool totals match the page (got ${JSON.stringify(sc.totals)})`);
  ok(JSON.stringify(sc.byYear.find((y) => y.year === 2021)) === JSON.stringify({ year: 2021, tornado: 1, severeThunderstorm: 1, flashFlood: 0, floodWarning: 0, floodAdvisory: 0 }), "the tool uses Central-time years");
  has(res.content[0].text, "2021-05-18", "tornado dates in the text are Central dates");
}

if (failures.length) {
  console.error(`\nHistory checks failed (${failures.length}):\n  ${failures.join("\n  ")}\n`);
  process.exit(1);
}
console.log("History OK — counts by type and Central-time year, rare events dated, limits and sources printed, both languages.");
process.exit(0);
