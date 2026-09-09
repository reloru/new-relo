// Does HHD advertise a pollen count newer than the one crosbynews.com serves?
//
// Deliberately does NOT import from src/. The Worker selects a count page by
// parsing hrefs; if this reused that code it would inherit the exact bug it
// exists to catch — CLAUDE.md's rule that a check reusing the code under test
// cannot falsify it, which a 2026-08-05 audit learned the hard way by probing
// for "missing" days with the parser's own date pattern.
//
// So the two sides are independent by construction:
//   - the Worker reads the date out of the URL SLUG
//   - this reads the date out of the human-readable LINK TEXT
// Both mutated on 2026-09-03 (the slug lost "count", the text lost "Count"),
// but the date inside the text survived that and all three earlier renames.
//
// Usage: node pollen-watch.mjs <hhd-index.html> <api-pollen.json> [body-out.md]
// Writes GitHub Actions outputs on stdout; exits non-zero only on bad input,
// never on a finding — the workflow decides what a finding means.
//
// The issue body is composed here and written to `body-out.md` rather than
// heredoc'd in the workflow: markdown full of backticks inside a YAML block
// scalar inside a shell heredoc is three layers of escaping, and the first
// version of this was silently unparseable YAML.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// Reduce third-party anchor markup to a plain human label.
//
// A single-pass `replace(/<[^>]+>/g, "")` is NOT enough, which CodeQL caught on
// #218 (js/incomplete-multi-character-sanitization, high). The pattern needs a
// closing `>` to match, so an UNTERMINATED `<script` is never matched and
// passes through untouched. This value reaches a GitHub issue body; GitHub's
// own markdown sanitizer would neuter it there, but "the sink happens to be
// safe" is not a reason to emit the string.
//
// So: strip tags to a fixpoint (a single pass can also let a removal join two
// fragments back into a tag), separate with a SPACE rather than "" so nothing
// re-forms across the seam — which is what `pollenStrip` in
// src/features/pollen.js has always done, and this diverged from — then drop
// any surviving angle brackets outright. That last step is what makes it
// complete by construction rather than by pattern: no `<script` can survive a
// string with no `<` in it. Costs nothing, since this is a display label.
export function stripToText(markup) {
  let text = String(markup);
  let prev;
  do {
    prev = text;
    text = text.replace(/<[^>]+>/g, " ");
  } while (text !== prev);
  return text
    .replace(/[<>]/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Anchors whose href is under HHD's pollen section, dated from their TEXT.
// Scoping to the section href is what keeps an unrelated dated link elsewhere
// on the page (a news item, an event) from being read as a pollen count —
// verified against the live page on 2026-09-06, where nothing else matched.
export function advertisedDates(html) {
  const out = [];
  const anchors = html.matchAll(
    /<a\s[^>]*href="(\/services\/pollen-mold\/[^"#?]*)"[^>]*>([\s\S]*?)<\/a>/gi,
  );
  for (const m of anchors) {
    const text = stripToText(m[2]);
    const d = text.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
    if (!d) continue;
    const mo = MONTHS[d[1].toLowerCase()];
    if (!mo) continue;
    out.push({
      iso: `${d[3]}-${String(mo).padStart(2, "0")}-${String(Number(d[2])).padStart(2, "0")}`,
      href: m[1],
      text,
    });
  }
  return out;
}

// Central-time "today", so a UTC-evening run can't read tomorrow's date and
// treat a legitimately-absent future count as missing.
function centralToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

// Everything below is the CLI. It runs only when this file is executed
// directly: scripts/test-pollen-parse.mjs imports stripToText/advertisedDates
// to pin them in the required CI job, and a top-level process.exit() here
// would kill that test run before it printed anything.
function main(indexPath, servedPath, bodyOut) {
  const indexHtml = readFileSync(indexPath, "utf8");
  const served = JSON.parse(readFileSync(servedPath, "utf8"));

  const today = centralToday();
  // Future-dated entries are ignored rather than trusted: HHD has posted a page
  // ahead of its date before, and "we don't have tomorrow's count yet" is not a
  // bug. Comparing only against dates that have actually arrived keeps every
  // finding a real one.
  const dated = advertisedDates(indexHtml).filter((d) => d.iso <= today);

  if (!dated.length) {
    // Nothing dated parsed at all. That is a change in the index itself, not a
    // missed count, and this check can't speak to what we're serving — say so
    // plainly rather than reporting a false "in step".
    console.log("behind=false");
    console.log("advertised=none");
    console.log(`served=${served.countDate ?? "none"}`);
    console.log("newest_href=");
    console.error("No dated pollen links parsed from HHD's index — its layout may have changed.");
    process.exit(0);
  }

  const newest = dated.reduce((a, b) => (b.iso > a.iso ? b : a));
  const servedDate = served.countDate ?? null;
  const behind = servedDate === null || newest.iso > servedDate;

  console.log(`behind=${behind}`);
  console.log(`advertised=${newest.iso}`);
  console.log(`served=${servedDate ?? "none"}`);
  console.log(`newest_href=${newest.href}`);
  console.error(
    behind
      ? `BEHIND: HHD advertises ${newest.iso} ("${newest.text}"), we serve ${servedDate ?? "nothing"}.`
      : `In step: newest advertised ${newest.iso}, serving ${servedDate}.`,
  );

  if (behind && bodyOut) {
    writeFileSync(
      bodyOut,
      // Continuation lines sit at column 0 on purpose: this template IS the
      // issue body, so indenting it here indents the rendered markdown.
      `HHD's index advertises a count dated **${newest.iso}**, but \`/api/pollen\` is
serving **${servedDate ?? "nothing"}**. A published count is not being picked up.

Newest entry HHD links:

- text: ${newest.text.slice(0, 200)}
- href: \`${newest.href}\`

This compares the date in HHD's human-readable link text against the date in the
slug \`pollenNewestFromIndex()\` selects by, so it is **not** a staleness warning —
weekends and City of Houston holidays cannot trigger it. It fires only when a
count exists that we failed to take.

Most likely cause, in order:

1. HHD changed the **date format** in the slug, so \`pollenSlugDate()\` returns
   null for the new entries and selection falls back to an older page. This is
   the known remaining hole — selection ignores slug *wording*, but not a
   changed date format.
2. HHD moved count pages off \`/services/pollen-mold/\`.
3. The count page layout changed enough that \`parsePollenCount()\` throws, so the
   last good entry is retained — check \`/api/health\` for \`pollen.ok: false\`.

\`docs/pages/pollen.md\` has the full history of this failure mode (four
occurrences, Aug–Sep 2026, every one of them silent) and the shape of the
previous fixes.

@claude please investigate and fix this.

Start by confirming the divergence is real rather than trusting this issue:
fetch HHD's index and \`https://crosbynews.com/api/pollen\` yourself and compare.
Then find why \`pollenNewestFromIndex()\` did not select the newer entry.

Two rules specific to this bug, both learned the hard way:

- **Do not re-derive the expected URL from our own parser.** Extract what HHD
  actually serves with a deliberately looser pattern and diff against our parse.
  A 2026-08-05 audit concluded HHD had stopped publishing because it generated
  candidate URLs from the same date pattern the parser uses.
- **Do not just add the new shape as another known variant.** HHD alternates
  rather than migrates — it dropped \`-count-\` from the slug on Sep 3, then put
  it back on Sep 8. Selection deliberately depends on no slug wording at all;
  keep it that way and fix the assumption that actually broke.

Open a PR; do not push to \`main\`. Add a regression fixture to
\`scripts/test-pollen-parse.mjs\` built from the real HTML, and confirm it FAILS
against the current code before you fix it — otherwise it pins nothing.

---
_Filed automatically by \`.github/workflows/pollen-watch.yml\`._
`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [indexPath, servedPath, bodyOut] = process.argv.slice(2);
  if (!indexPath || !servedPath) {
    console.error("usage: pollen-watch.mjs <hhd-index.html> <api-pollen.json> [body-out.md]");
    process.exit(2);
  }
  main(indexPath, servedPath, bodyOut);
}
