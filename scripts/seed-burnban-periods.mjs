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
// Coverage: the court's Legistar records begin in February 2021. Every item
// whose title mentions "burn" was listed through the public API
// (webapi.legistar.com/v1/harriscountytx/matters) on 2026-11-15; the rows
// below are all the burn-ban adoptions and terminations it holds. Bans before
// 2021 (one is reported for 2015) are not entered. The burn-ban page says so.
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
      `INSERT INTO burnban_periods (started, ended, start_source, end_source, note, url, end_url) VALUES (${[b.started, b.ended, "order", b.end_source, b.note, b.url, b.end_url].map(q).join(", ")}) ` +
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
