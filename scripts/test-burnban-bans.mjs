// /burn-ban's "Past burn bans" table: what it says for each kind of row, and
// that a database failure costs only the table, never the live status.
//
// Run: node scripts/test-burnban-bans.mjs

import { createHarness } from "./lib/harness.mjs";
import { seedSql, PAST_BANS } from "./seed-burnban-periods.mjs";

const failures = [];
const ok = (cond, what) => { if (!cond) failures.push(what); };
const has = (body, text, what) => ok(body.includes(text), `${what}: expected ${JSON.stringify(text)}`);

// Every hand-entered ban starts with a Commissioners Court record, and ends
// with either the court record that terminated it or a named news source.
const LEGISTAR_RE = /^https:\/\/harriscountytx\.legistar\.com\/LegislationDetail\.aspx\?ID=\d+&GUID=[0-9A-F-]{36}$/;
for (const b of PAST_BANS) {
  ok(LEGISTAR_RE.test(b.url), `${b.started}: start source is a court record`);
  if (b.end_source === "order") ok(LEGISTAR_RE.test(b.end_url), `${b.started}: end source is a court record`);
  else ok(b.end_source === "news" && b.end_url === null && /reported by [^(]+ \(https:\/\/[^)]+\)/.test(b.note), `${b.started}: end source names an outlet and a link`);
  ok(b.ended > b.started, `${b.started}: ends after it starts`);
}
ok(PAST_BANS.length === 5 && PAST_BANS[0].started === "2022-06-28" && PAST_BANS[1].started === "2022-10-25", "both 2022 bans are entered");

const h = await createHarness();
h.env.DB.raw.exec(seedSql());
h.env.DB.raw.exec("INSERT INTO burnban_periods (started, ended, start_source) VALUES ('2026-09-17', NULL, 'tfs')");
const page = async (path, accept = "text/html") => (await h.get(path, { headers: { accept } })).text();
{
  const html = await page("/burn-ban");
  const bans = html.slice(html.indexOf('<section class="bans">'), html.indexOf("</section>", html.indexOf('<section class="bans">')));
  has(bans, "<tr><td>Sep 17, 2026</td><td>in effect</td><td>—</td><td>Texas A&amp;M Forest Service start date</td></tr>", "the open ban, dated by TFS");
  has(bans, "<td>Aug 8, 2023</td><td>Oct 10, 2023</td><td>63 days</td>", "a past ban with its length");
  has(bans, '<td>Jun 28, 2022</td><td>Aug 23, 2022</td><td>56 days</td><td><a href="https://harriscountytx.legistar.com/LegislationDetail.aspx?ID=5708923&amp;GUID=D83CF221-D2FE-49F7-9CA4-AA64B17C98D0">Commissioners Court record</a>; <a href="https://harriscountytx.legistar.com/LegislationDetail.aspx?ID=5768648&amp;GUID=8B164731-7F45-4D5D-8D9E-E7EBF02881CB">Commissioners Court record</a></td>', "a ban sourced by court records at both ends");
  has(bans, "<td>Oct 25, 2022</td><td>Nov 15, 2022</td><td>21 days</td>", "the second 2022 ban");
  has(bans, '<a href="https://communityimpact.com/houston/bay-area/government/2024/11/26/harris-county-commissioners-lift-burn-ban-for-unincorporated-harris-county">as reported by Community Impact</a>', "a news-sourced end names who reported it");
  ok(bans.indexOf("Sep 17, 2026") < bans.indexOf("Oct 16, 2025") && bans.indexOf("Oct 16, 2025") < bans.indexOf("Aug 8, 2023"), "newest first");
  has(bans, "Bans before 2021 (one is reported for 2015) are not listed.", "the gap is stated");
  const es = await page("/es/burn-ban");
  has(es, "<td>vigente</td>", "Spanish open ban");
  has(es, "según Community Impact", "Spanish source wording");
  has(es, "registro de la Corte de Comisionados", "Spanish court-record wording");
  has(await page("/burn-ban", "text/markdown"), "| Oct 8, 2024 | Nov 25, 2024 | 48 days |", "Markdown row");
}
{
  const real = h.env.DB;
  h.env.DB = { prepare: () => { throw new Error("D1 down"); } };
  const quiet = console.error;
  console.error = () => {};
  const r = await h.get("/burn-ban", { headers: { accept: "text/html" } });
  const body = await r.text();
  console.error = quiet;
  ok(r.status === 200, `a database failure keeps the live page up (got ${r.status})`);
  ok(!body.includes('<section class="bans">'), "…and drops only the history table");
  h.env.DB = real;
}

if (failures.length) {
  console.error(`\nBurn-ban history checks failed (${failures.length}):\n  ${failures.join("\n  ")}\n`);
  process.exit(1);
}
console.log("Burn-ban history OK — each past ban sourced, the open ban dated by TFS, gaps stated, and a D1 failure costs only the table.");
process.exit(0);
