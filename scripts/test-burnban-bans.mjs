// The past-bans record on /burn-ban/history: what it says for each kind of
// row, that /burn-ban links to it, and that a database failure takes down
// only the record page (502), never the live status page.
//
// Run: node scripts/test-burnban-bans.mjs

import { createHarness } from "./lib/harness.mjs";
import { seedSql, PAST_BANS } from "./seed-burnban-periods.mjs";

const failures = [];
const ok = (cond, what) => { if (!cond) failures.push(what); };
const has = (body, text, what) => ok(body.includes(text), `${what}: expected ${JSON.stringify(text)}`);

// Every hand-entered ban starts with a Commissioners Court record, a Fire
// Marshal's Office release, or a named news source, and ends with the court
// record that terminated it or a named news source.
const LEGISTAR_RE = /^https:\/\/harriscountytx\.legistar\.com\/LegislationDetail\.aspx\?ID=\d+&GUID=[0-9A-F-]{36}$/;
const NEWS_RE = (lead) => new RegExp(`${lead}.*?reported by [^(]+ \\(https://[^)]+\\)`);
for (const b of PAST_BANS) {
  if (b.start_source === "news") ok(b.url === null && NEWS_RE("Start").test(b.note), `${b.started}: news start names an outlet and a link`);
  else if (b.start_source === "tfs") ok(b.started >= "2026-09-17" && b.url === null, `${b.started}: a Forest Service start is one the cron recorded`);
  else if (b.start_source === "fmo") ok(b.started < "2021-02-01" && /^https:\/\/www\.harriscountycitizencorps\.com\/.+\.pdf$/.test(b.url), `${b.started}: a Fire Marshal's release start links the release`);
  else ok(LEGISTAR_RE.test(b.url), `${b.started}: start source is a court record`);
  if (b.end_source === "order") ok(LEGISTAR_RE.test(b.end_url), `${b.started}: end source is a court record`);
  else if (b.end_source === "fmo") ok(/^https:\/\/www\.hcfmo\.net\//.test(b.end_url), `${b.started}: a Fire Marshal's end links the announcement`);
  else ok(b.end_source === "news" && b.end_url === null && NEWS_RE("Lift date").test(b.note), `${b.started}: end source names an outlet and a link`);
  ok(b.ended > b.started, `${b.started}: ends after it starts`);
}
ok(JSON.stringify(PAST_BANS.map((b) => b.started)) === JSON.stringify(["2009-02-10", "2011-04-19", "2013-07-09", "2015-08-11", "2022-06-28", "2022-10-25", "2023-08-08", "2024-10-08", "2025-10-16", "2026-09-17"]), "the ten past bans, oldest first");

const h = await createHarness();
h.env.DB.raw.exec(seedSql());
h.env.DB.raw.exec("INSERT INTO burnban_periods (started, ended, start_source) VALUES ('2026-11-10', NULL, 'tfs')");
const page = async (path, accept = "text/html") => (await h.get(path, { headers: { accept } })).text();
{
  const html = await page("/burn-ban/history");
  const bans = html.slice(html.indexOf('<section class="card bans">'), html.indexOf("</section>", html.indexOf('<section class="card bans">')));
  ok(bans.length > 1000, "the history page carries the table");
  has(html, "The court does not vote again to end it.", "how a ban ends");
  has(html, "In 2005 it said a ban ends once the index stays below 480 for 72 hours.", "the drought-index figures, dated");
  has(html, '<p class="crumbs"><a href="/burn-ban">Burn Ban Status</a>', "the way back up");
  const main = await page("/burn-ban");
  ok(!main.includes("<table"), "/burn-ban no longer carries the table");
  has(main, '<a href="/burn-ban/history">Every Harris County burn ban with known dates, and how a ban starts and ends</a>', "/burn-ban links down to the record");
  ok(!main.includes("What a burn ban means"), "the general explainer is gone from /burn-ban");
  has(main, "It is a Class C misdemeanor, with a fine of up to $500.", "the penalty is a question now");
  has(main, "The Harris County Fire Marshal's Office announces a ban and its end, and the map can lag behind it.", "the intro names the authority");
  has(bans, "<tr><td>Nov 10, 2026</td><td>in effect</td><td>—</td><td>Texas A&amp;M Forest Service start date</td></tr>", "an open ban, dated by TFS");
  has(bans, '<tr><td>Sep 17, 2026</td><td>Nov 16, 2026</td><td>60 days</td><td>Texas A&amp;M Forest Service start date; <a href="https://www.hcfmo.net/Portals/15/Images/burnbanlifted11.26.png">Fire Marshal\'s Office announcement</a></td></tr>', "the 2026 ban, closed by the Fire Marshal\'s announcement");
  has(bans, "The court's online records hold no vote ending the 2024, 2025 and 2026 bans.", "the court-record sentence");
  has(bans, "<td>Aug 8, 2023</td><td>Oct 10, 2023</td><td>63 days</td>", "a past ban with its length");
  has(bans, '<td>Jun 28, 2022</td><td>Aug 23, 2022</td><td>56 days</td><td><a href="https://harriscountytx.legistar.com/LegislationDetail.aspx?ID=5708923&amp;GUID=D83CF221-D2FE-49F7-9CA4-AA64B17C98D0">Commissioners Court record</a>; <a href="https://harriscountytx.legistar.com/LegislationDetail.aspx?ID=5768648&amp;GUID=8B164731-7F45-4D5D-8D9E-E7EBF02881CB">Commissioners Court record</a></td>', "a ban sourced by court records at both ends");
  has(bans, "<td>Oct 25, 2022</td><td>Nov 15, 2022</td><td>21 days</td>", "the second 2022 ban");
  has(bans, '<td>Aug 11, 2015</td><td>Aug 25, 2015</td><td>14 days</td><td><a href="https://www.houstonpublicmedia.org/articles/news/2015/08/11/120945/harris-county-officials-issue-outdoor-burn-ban/">as reported by Houston Public Media</a>; <a href="https://www.houstonpublicmedia.org/articles/news/2015/08/25/119495/thanks-to-the-rain-harris-county-lifts-burn-ban/">as reported by Houston Public Media</a></td>', "a pre-2021 ban sourced by news at both ends");
  has(bans, '<a href="https://communityimpact.com/houston/bay-area/government/2024/11/26/harris-county-commissioners-lift-burn-ban-for-unincorporated-harris-county">as reported by Community Impact</a>', "a news-sourced end names who reported it");
  ok(bans.indexOf("Nov 10, 2026") < bans.indexOf("Sep 17, 2026") && bans.indexOf("Sep 17, 2026") < bans.indexOf("Oct 16, 2025") && bans.indexOf("Oct 16, 2025") < bans.indexOf("Aug 8, 2023"), "newest first");
  has(bans, '<td>Jul 9, 2013</td><td>Jul 23, 2013</td><td>14 days</td><td><a href="https://www.chron.com/news/houston-texas/houston/article/harris-county-lifts-burn-ban-4681559.php">as reported by Houston Chronicle</a>; <a href="https://www.chron.com/news/houston-texas/houston/article/harris-county-lifts-burn-ban-4681559.php">as reported by Houston Chronicle</a></td>', "the 2013 ban, both ends from one Chronicle article");
  has(bans, `<td>Feb 10, 2009</td><td>May 6, 2009</td><td>85 days</td><td><a href="https://www.harriscountycitizencorps.com/Portals/34/Documents/NewsArchives/2009NewsArchive/2009burnban.pdf">Fire Marshal's Office announcement</a>; <a href="https://www.chron.com/neighborhood/tomball/news/article/Harris-County-burn-ban-lifted-9299533.php">as reported by Houston Chronicle</a></td>`, "the February 2009 ban, started by the Fire Marshal's release");
  has(bans, '<td>Apr 19, 2011</td><td>Dec 21, 2011</td><td>246 days</td><td><a href="https://www.chron.com/news/houston-texas/article/harris-co-orders-three-month-burn-ban-during-1684831.php">as reported by Houston Chronicle</a>; <a href="https://abc13.com/archive/8474452/">as reported by ABC13</a></td>', "the 2011 ban, ended by ABC13's Dec 20 story");
  has(bans, "Bans reported in 2003, 2005, June 2009 and 2010 are missing because the sources found do not date both ends.", "the gap is stated");
  has(bans, "The 2005 and February 2009 bans were lifted by the Fire Marshal's Office itself, without a court vote.", "who lifted the early bans");
  const es = await page("/es/burn-ban/history");
  has(await page("/es/burn-ban"), '<a href="/es/burn-ban/history">', "Spanish link down");
  has(es, "<td>vigente</td>", "Spanish open ban");
  has(es, "según Community Impact", "Spanish source wording");
  has(es, "registro de la Corte de Comisionados", "Spanish court-record wording");
  has(await page("/burn-ban/history", "text/markdown"), "| Oct 8, 2024 | Nov 25, 2024 | 48 days |", "Markdown row");
  has(await page("/burn-ban", "text/markdown"), "(https://crosbynews.com/burn-ban/history)", "Markdown link down");
}
{
  const real = h.env.DB;
  h.env.DB = { prepare: () => { throw new Error("D1 down"); } };
  const quiet = console.error;
  console.error = () => {};
  const r = await h.get("/burn-ban", { headers: { accept: "text/html" } });
  const rh = await h.get("/burn-ban/history", { headers: { accept: "text/html" } });
  console.error = quiet;
  ok(r.status === 200, `a database failure keeps the live page up (got ${r.status})`);
  ok(rh.status === 502, `…and the record page answers 502 rather than a table with rows missing (got ${rh.status})`);
  h.env.DB = real;
}

if (failures.length) {
  console.error(`\nBurn-ban history checks failed (${failures.length}):\n  ${failures.join("\n  ")}\n`);
  process.exit(1);
}
console.log("Burn-ban history OK — each past ban sourced, the open ban dated by TFS, gaps stated, and a D1 failure costs only the record page.");
process.exit(0);
