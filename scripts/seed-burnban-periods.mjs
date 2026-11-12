// Past Harris County burn bans, entered by hand into D1 `burnban_periods`.
//
// The cron records bans from the day it started watching (2026-09-17 onward).
// Earlier bans are entered here, each one checked against a source before it
// was added — never from memory:
//
//   start  the county's own release on readyharris.org announcing the court's
//          order (start_source 'order', its URL in `url`);
//   end    the county published no lift notice on readyharris.org for any of
//          these (every release on the site was read on 2026-11-12), so the
//          end date is the one news outlets reported from the county's own
//          statements (end_source 'news', outlet and URL in `note`).
//
// Not entered, because a date could not be confirmed: the 2022 ban that began
// June 28 (outlets disagree on Aug 22 or Aug 23 for its end), a second 2022 ban
// reported for the fall, and any ban before 2022 (one is reported for 2015).
// The burn-ban page says so.
//
//   node scripts/seed-burnban-periods.mjs           # print the SQL
//   node scripts/seed-burnban-periods.mjs --apply   # run it against production D1
//
// Safe to re-run: each row is keyed on its start date and overwritten.

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

export const PAST_BANS = [
  {
    started: "2023-08-08",
    ended: "2023-10-10",
    url: "https://www.readyharris.org/Newsroom/News-Releases/Ready-Harris-All-News-Releases/hcfmo-harris-county-commissioners-court-approves-burn-ban",
    note: "Lift date as reported by KPRC Click2Houston (https://click2houston.com/news/local/2023/10/10/burn-ban-lifted-for-unincorporated-harris-county), citing Commissioner Lesley Briones, and by Community Impact (https://communityimpact.com/houston/bellaire-meyerland-west-university/government/2023/10/12/harris-countys-burn-ban-lifted).",
  },
  {
    started: "2024-10-08",
    ended: "2024-11-25",
    url: "https://www.readyharris.org/Newsroom/News-Releases/Ready-Harris-All-News-Releases/hcfmo-the-harris-county-commissioners-court-approves-burn-ban",
    note: "Lift date as reported by Community Impact (https://communityimpact.com/houston/bay-area/government/2024/11/26/harris-county-commissioners-lift-burn-ban-for-unincorporated-harris-county), citing the Harris County Fire Marshal's Office.",
  },
  {
    started: "2025-10-16",
    ended: "2025-12-05",
    url: "https://www.readyharris.org/Newsroom/News-Releases/Ready-Harris-All-News-Releases/hcfmo-harris-county-commissioners-court-approves-burn-ban-due-to-elevated-fire-risk-from-dry-conditions",
    note: "Lift date (effective Dec. 5) as reported by Community Impact (https://communityimpact.com/houston/spring-klein/environment/2025/12/05/commissioners-lift-burn-ban-in-unincorporated-harris-county/), citing the county's announcement.",
  },
];

const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
export const seedSql = () =>
  PAST_BANS.map(
    (b) =>
      `INSERT INTO burnban_periods (started, ended, start_source, end_source, note, url) VALUES (${[b.started, b.ended, "order", "news", b.note, b.url].map(q).join(", ")}) ` +
      `ON CONFLICT (started) DO UPDATE SET ended = excluded.ended, start_source = excluded.start_source, end_source = excluded.end_source, note = excluded.note, url = excluded.url;`,
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
