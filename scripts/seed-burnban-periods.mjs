// Past Harris County burn bans, entered by hand into D1 `burnban_periods`.
//
// The cron records bans from the day it started watching (2026-09-17 onward).
// Earlier bans are entered here, each one checked against a source before it
// was added — never from memory:
//
//   start  the Commissioners Court record that adopted the ban, on the
//          county's Legistar site (start_source 'order', its URL in `url`),
//          or before 2021 the Harris County Fire Marshal's Office's own
//          release announcing it (start_source 'fmo', its URL in `url`).
//   end    the court record that terminated it (end_source 'order', its URL
//          in `end_url`). The court's online records hold none for the 2024,
//          2025 and 2026 bans (searched 2026-11-17); each order ran "until
//          the earlier of 90 days after the date of adoption or a
//          determination is made by the Texas Forest Service that drought
//          conditions no longer exist". The Fire Marshal's Office announced
//          each lift. The 2024 and 2025 ends cite the news outlet that
//          reported it (end_source 'news', outlet and URL in `note`); the
//          2026 end cites the Fire Marshal's announcement (end_source 'fmo',
//          its URL in `end_url`).
//
//          The 2026 ban began while the cron was watching, so the cron opened
//          its row. It is closed here because the Forest Service map, which
//          the cron reads, still listed a ban on 2026-11-17, a day after the
//          Fire Marshal's Office lifted it; left alone, the cron would date
//          the end by the day the map caught up. A row closed here stays
//          closed: the cron's insert for an open ban does nothing on a start
//          date that already exists, and its close touches only open rows.
//
// Before 2021, each date comes from a Fire Marshal's Office release (the
// county's archive at harriscountycitizencorps.com, read 2026-11-17) or a news
// report. A ban with a dated start and no dated end is entered with
// end_unknown, so the page says the end was not found: 2005 (lifted by
// July 27), June 2009 and October 2010. A 2003 ban is reported with no dates
// found, so it has no row; the page's note says so.
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
  // Bans with a dated start and no dated end (end_unknown). `ended` stays null,
  // and the cron leaves such a row alone: it closes and opens only rows with
  // end_unknown = 0. `ended_by` is the latest day a source allows.
  {
    started: "2005-06-21",
    ended: null,
    end_unknown: 1,
    ended_by: "2005-07-27",
    start_source: "fmo",
    url: "https://www.harriscountycitizencorps.com/Portals/34/Documents/NewsArchives/2005NewsArchive/burnban06-21-05.pdf",
    end_source: "news",
    end_url: null,
    note: "Start: Fire Marshal's Office release, \"Harris County Commissioners Court has ordered a burn ban effective June 21, until September 19, 2005\". Lift date not given; lifted by July 27, 2005 as reported by Houston Chronicle (https://www.chron.com/neighborhood/article/Harris-County-fire-marshal-lifts-burn-ban-9803725.php): the story, dated July 27, 2005, says the fire marshal lifted it, \"The fire marshal made the call and acted alone on this\", without saying on what day.",
  },
  {
    started: "2009-06-23",
    ended: null,
    end_unknown: 1,
    ended_by: null,
    start_source: "fmo",
    url: "https://www.harriscountycitizencorps.com/Portals/34/Documents/NewsArchives/2009NewsArchive/burnban.pdf",
    end_source: null,
    end_url: null,
    note: "Start: Fire Marshal's Office release of June 23, 2009: \"Today, Commissioners approved a 90-day burn ban for unincorporated Harris County.\" No source found dates the end. The Baytown Sun reported it still in effect on July 31, 2009.",
  },
  {
    started: "2010-10-26",
    ended: null,
    end_unknown: 1,
    ended_by: null,
    start_source: "fmo",
    url: "https://www.harriscountycitizencorps.com/Portals/34/Documents/NewsArchives/2010NewsArchive/Burn_Ban_Oct2010.pdf",
    end_source: null,
    end_url: null,
    note: "Start: Fire Marshal's Office release of Oct. 26, 2010: \"Today, Harris County Commissioners Court approved a burn ban\" (90 days). No source found dates the end. The Houston Chronicle (Chris Moran, Nov. 22, 2010, \"Harris County expected to lift burn ban\") reported the ban \"will be lifted today if Commissioners Court accepts the recommendation of the county fire marshal\"; that it did is not confirmed.",
  },
  // Before Legistar (2021): a Fire Marshal's Office release ('fmo', URL in
  // `url`) or a news report ('news', outlet and URL in `note`).
  {
    started: "2009-02-10",
    ended: "2009-05-06",
    start_source: "fmo",
    url: "https://www.harriscountycitizencorps.com/Portals/34/Documents/NewsArchives/2009NewsArchive/2009burnban.pdf",
    end_source: "news",
    end_url: null,
    note: "Start: Harris County Fire Marshal's Office release dated Feb. 10, 2009, \"Harris County Burn Ban Issued in Face of Continued Wildfire Threat\". Lift date as reported by Houston Chronicle (https://www.chron.com/neighborhood/tomball/news/article/Harris-County-burn-ban-lifted-9299533.php): \"The burn ban in unincorporated Harris County was lifted May 6\", according to the Fire Marshal's Office, which lifted it.",
  },
  {
    started: "2011-04-19",
    ended: "2011-12-21",
    start_source: "fmo",
    url: "https://www.harriscountycitizencorps.com/Portals/34/Documents/NewsArchives/2011NewsArchive/90DayBurnBanApril2011.pdf",
    end_source: "news",
    end_url: null,
    note: "Start: Fire Marshal's Office release of Apr. 19, 2011, \"Harris County Commissioners Court Approves 90-day Burn Ban\": \"Today, Harris County Commissioners Court enacted a burn ban\". Extended through October on June 21, 2011. Lift date as reported by ABC13 (https://abc13.com/archive/8474452/): \"Harris County eases burn ban restrictions\", Tuesday, Dec. 20, 2011, effective Wednesday, Dec. 21.",
  },
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
    start_source: "fmo",
    url: "https://www.harriscountycitizencorps.com/Portals/34/Documents/NewsArchives/2015NewsArchive/outdoor-burn-ban.pdf",
    end_source: "news",
    end_url: null,
    note: "Start: Fire Marshal's Office release of Aug. 11, 2015, \"Increased Fire Risk Triggers Outdoor Burn Restrictions in Harris County\"; also reported by Houston Public Media (https://www.houstonpublicmedia.org/articles/news/2015/08/11/120945/harris-county-officials-issue-outdoor-burn-ban/). Lift date as reported by Houston Public Media (https://www.houstonpublicmedia.org/articles/news/2015/08/25/119495/thanks-to-the-rain-harris-county-lifts-burn-ban/), and by the Houston Chronicle (https://www.houstonchronicle.com/news/houston-texas/houston/article/County-pulls-back-on-burn-ban-6465432.php): commissioners rescinded it Tuesday, Aug. 25, 2015. Burning in covered containers stayed allowed.",
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
  {
    started: "2026-09-17",
    ended: "2026-11-16",
    start_source: "tfs",
    url: null,
    end_source: "fmo",
    end_url: "https://www.hcfmo.net/Portals/15/Images/burnbanlifted11.26.png",
    note: "Started Sept. 17, 2026: the Texas A&M Forest Service map's start date, which the cron recorded; adopted by Commissioners Court item 26-5864. Lifted effective Nov. 16, 2026 by the Harris County Fire Marshal's Office, which announced it on hcfmo.net (\"the burn ban in unincorporated Harris County was lifted November 16, 2026\") and on its social media. The Forest Service map still listed a Harris County ban on Nov. 17, 2026.",
  },
];

const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
export const seedSql = () =>
  PAST_BANS.map(
    (b) =>
      `INSERT INTO burnban_periods (started, ended, start_source, end_source, note, url, end_url, end_unknown, ended_by) VALUES (${[b.started, b.ended, b.start_source ?? "order", b.end_source, b.note, b.url, b.end_url].map(q).join(", ")}, ${b.end_unknown ? 1 : 0}, ${q(b.ended_by)}) ` +
      `ON CONFLICT (started) DO UPDATE SET ended = excluded.ended, start_source = excluded.start_source, end_source = excluded.end_source, note = excluded.note, url = excluded.url, end_url = excluded.end_url, end_unknown = excluded.end_unknown, ended_by = excluded.ended_by;`,
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
