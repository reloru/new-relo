// Past Harris County burn bans, entered by hand into D1 `burnban_periods`.
//
// The cron records bans from the day it started watching (2026-09-17 onward).
// Earlier bans are entered here, each one checked against a source before it
// was added — never from memory:
//
//   start  the Commissioners Court record that adopted the ban, on the
//          county's Legistar site (start_source 'order', its URL in `url`).
//   end    the court record that terminated it (end_source 'order', its URL
//          in `end_url`). The 2024 and 2025 bans have none: each order ran
//          "until the earlier of 90 days after the date of adoption or a
//          determination is made by the Texas Forest Service that drought
//          conditions no longer exist", so both ended on that determination
//          without a court vote. Their end dates are the ones news outlets
//          reported from the county's statements (end_source 'news', outlet
//          and URL in `note`).
//
// Before 2021, both ends come from news reports and a ban is entered only when
// reports date both: bans reported in 2003, 2005, 2009 (two), 2010 and 2011
// were not entered because the reports found (2026-11-15, and the owner's
// sources read 2026-11-17) do not date both ends. Issue #275 lists what each
// one is missing.
//
// Coverage: the court's Legistar records begin in February 2021. Every item
// whose title mentions "burn" was listed through the public API
// (webapi.legistar.com/v1/harriscountytx/matters) on 2026-11-15; the rows
// below are all the burn-ban adoptions and terminations it holds. The
// burn-ban page states both limits.
//
// Each URL is the record's canonical LegislationDetail page, resolved from
// the API's MatterId through Legistar's gateway (gateway.aspx?M=L&ID=<id>),
// and checked to show the file number given beside it.
//
//   node scripts/seed-burnban-periods.mjs           # print the SQL
//   node scripts/seed-burnban-periods.mjs --apply   # run it against production D1
//
// Safe to re-run: each row is keyed on its start date and overwritten.

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const LEGISTAR = "https://harriscountytx.legistar.com/LegislationDetail.aspx";

export const PAST_BANS = [
  // Before Legistar (2021), both ends come from news reports (start_source
  // and end_source 'news', each outlet and URL in `note`).
  {
    started: "2013-07-09",
    ended: "2013-07-23",
    start_source: "news",
    url: null,
    end_source: "news",
    end_url: null,
    note: "Start as reported by Houston Chronicle (https://www.chron.com/news/houston-texas/houston/article/harris-county-lifts-burn-ban-4681559.php): \"On July 9, when court approved the ban\". Lift date as reported by Houston Chronicle (https://www.chron.com/news/houston-texas/houston/article/harris-county-lifts-burn-ban-4681559.php): Commissioners Court voted Tuesday, July 23, 2013, to lift the ban, \"in place for just two weeks\". Both ends are from the one article, published July 23, 2013.",
  },
  {
    started: "2015-08-11",
    ended: "2015-08-25",
    start_source: "news",
    url: null,
    end_source: "news",
    end_url: null,
    note: "Start as reported by Houston Public Media (https://www.houstonpublicmedia.org/articles/news/2015/08/11/120945/harris-county-officials-issue-outdoor-burn-ban/): commissioners approved it Aug. 11, 2015, effective immediately. Lift date as reported by Houston Public Media (https://www.houstonpublicmedia.org/articles/news/2015/08/25/119495/thanks-to-the-rain-harris-county-lifts-burn-ban/), and by the Houston Chronicle (https://www.houstonchronicle.com/news/houston-texas/houston/article/County-pulls-back-on-burn-ban-6465432.php): commissioners rescinded it Tuesday, Aug. 25, 2015. Burning in covered containers stayed allowed.",
  },
  {
    started: "2022-06-28",
    ended: "2022-08-23",
    url: `${LEGISTAR}?ID=5708923&GUID=D83CF221-D2FE-49F7-9CA4-AA64B17C98D0`, // 22-4024
    end_source: "order",
    end_url: `${LEGISTAR}?ID=5768648&GUID=8B164731-7F45-4D5D-8D9E-E7EBF02881CB`, // 22-5227
    note: "Adopted by Commissioners Court item 22-4024; terminated effective Aug. 23, 2022 by item 22-5227.",
  },
  {
    started: "2022-10-25",
    ended: "2022-11-15",
    url: `${LEGISTAR}?ID=5894409&GUID=548AF9FB-5337-40FB-8921-8B9F2CB6BBFF`, // 22-6919
    end_source: "order",
    end_url: `${LEGISTAR}?ID=5936528&GUID=62D1DDC3-92B9-4EE7-90D4-77B32D4AACB2`, // 22-7239
    note: "Adopted by Commissioners Court item 22-6919; terminated effective Nov. 15, 2022 by item 22-7239.",
  },
  {
    started: "2023-08-08",
    ended: "2023-10-10",
    url: `${LEGISTAR}?ID=6307876&GUID=2DEB1269-DFF7-45C2-A5FA-F20F7A5526B4`, // 23-4616
    end_source: "order",
    end_url: `${LEGISTAR}?ID=6375318&GUID=4DA229BB-4A6A-49C8-A658-15063BD4BEE9`, // 23-5855
    note: "Adopted by Commissioners Court item 23-4616; terminated effective Oct. 10, 2023 by item 23-5855.",
  },
  {
    started: "2024-10-08",
    ended: "2024-11-25",
    url: `${LEGISTAR}?ID=6883826&GUID=D64FCC38-D51B-4E51-BA1D-0E1CFA9B97C1`, // 24-6503
    end_source: "news",
    end_url: null,
    note: "Adopted by Commissioners Court item 24-6503. Lift date as reported by Community Impact (https://communityimpact.com/houston/bay-area/government/2024/11/26/harris-county-commissioners-lift-burn-ban-for-unincorporated-harris-county), citing the Harris County Fire Marshal's Office.",
  },
  {
    started: "2025-10-16",
    ended: "2025-12-05",
    url: `${LEGISTAR}?ID=7696716&GUID=641BEAFE-4E84-46D3-AAFF-D7045D1E5C57`, // 25-6399
    end_source: "news",
    end_url: null,
    note: "Adopted by Commissioners Court item 25-6399. Lift date (effective Dec. 5) as reported by Community Impact (https://communityimpact.com/houston/spring-klein/environment/2025/12/05/commissioners-lift-burn-ban-in-unincorporated-harris-county/), citing the county's announcement.",
  },
];

const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
export const seedSql = () =>
  PAST_BANS.map(
    (b) =>
      `INSERT INTO burnban_periods (started, ended, start_source, end_source, note, url, end_url) VALUES (${[b.started, b.ended, b.start_source ?? "order", b.end_source, b.note, b.url, b.end_url].map(q).join(", ")}) ` +
      `ON CONFLICT (started) DO UPDATE SET ended = excluded.ended, start_source = excluded.start_source, end_source = excluded.end_source, note = excluded.note, url = excluded.url, end_url = excluded.end_url;`,
  ).join("\n") + "\n";

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.env.SEED_SQL || "/tmp/seed-burnban-periods.sql";
  writeFileSync(out, seedSql());
  console.log(`${PAST_BANS.length} past bans -> ${out}`);
  if (process.argv.includes("--apply")) {
    execFileSync("npx", ["wrangler", "d1", "execute", "crosby-record", "--remote", "--file", out], { stdio: "inherit" });
  } else {
    console.log(`Dry run. Apply with --apply.`);
  }
}
