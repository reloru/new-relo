#!/usr/bin/env node
// Fetch local news for Crosby, TX (+ nearby towns), filter for relevance,
// down-rank crime, and write the result to the WEATHER KV "news" key.
//
// WHY THIS RUNS OUTSIDE THE WORKER: Google News RSS is the only source with real
// Crosby coverage, but it hard-blocks Cloudflare Worker datacenter IPs (503).
// A Claude routine / session environment is NOT blocked, so this script runs
// there on a daily schedule, and the Worker just serves /news from the KV key
// it writes. No API key needed.
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/fetch-news.mjs
//
// (CLOUDFLARE_API_TOKEN needs Workers KV Storage:Edit — the deploy token has it.)

import { pathToFileURL } from "node:url";

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const NS_ID = process.env.WEATHER_KV_ID || "da96de7daed84b69b32778058b374d5f"; // WEATHER namespace
const KV_KEY = "news";
const MAX_AGE_DAYS = 45;

// Google News RSS search queries (Crosby core + nearby towns). Each is gated
// for relevance after fetching, so broad queries are fine.
const QUERIES = [
  '"Crosby, Texas"',
  '"Crosby ISD" OR "Crosby High School" OR "Crosby Cougars"',
  'Crosby Texas (Harris County OR community OR fire OR flood OR road OR school OR business OR storm OR festival)',
  '"Barrett Station" OR "Crosby-area"',
  '(Huffman OR Atascocita OR Channelview OR Highlands OR Baytown) Texas "Harris County"',
];

// A headline counts as core-Crosby if it has one of these strong tokens...
const REQUIRE = [
  "crosby, texas", "crosby, tx", "crosby isd", "crosby-area", "crosby area",
  "crosby high", "crosby cougars", "crosby, harris county", "near crosby", "in crosby", "77532",
];
// ...or a bare "crosby" plus Texas/Houston-area context.
const CONTEXT = ["texas", " tx", "harris county", "houston", "77532", "newport", "barrett station"];
// Nearby towns (ranked below core); each needs Texas-area context.
const NEAR = ["huffman", "highlands", "baytown", "atascocita", "channelview", "kingwood", "dayton"];
const NEAR_CONTEXT = ["texas", " tx ", "harris county", "chambers county", "liberty county", "houston", "77532", "crosby"];
// Hard rejects: famous "Crosby" people / other-state Crosbys.
const REJECT = [
  "crosby, minnesota", "crosby, mn", "crosby, north dakota", "crosby, liverpool", "crosby, merseyside",
  "david crosby", "sidney crosby", "bing crosby", "norm crosby", "maxx crosby", "crosby stills",
  "jeff crosby", "crosby county",
];
// Other-place "Crosby" disambiguation, matched on WORD boundaries (not substrings)
// so a short token like "uk" can't fire on "truck"/"Duke"/"Luke". Three distinct
// places bleed into the feed and must be excluded:
//   - Crosby, MERSEYSIDE (England) — a town near Liverpool/Waterloo/Sefton;
//   - Crosby HIGH SCHOOL in WATERBURY, Connecticut (matches REQUIRE "crosby high");
//   - CROSBYTON, Texas — a different TX town that contains the substring "crosby".
// Caveat: "england" will also reject a TX story that mentions "New England"; rare
// enough to accept given these places otherwise rank straight into the feed.
const GEO_REJECT = [
  "waterbury", "crosbyton", "uk", "england", "britain", "british", "liverpool",
  "waterloo", "sefton", "merseyside", "cumbria", "lancashire",
];
const GEO_RE = new RegExp("\\b(?:" + GEO_REJECT.join("|") + ")\\b", "i");
// Obituaries / funeral-home noise — dropped entirely.
const SOFT_DROP = ["obituary", "obituaries", "funeral home", "legacy.com", "in memoriam"];
// Police-blotter / report-index boilerplate — a date-range digest title like
// "For Reports Between June 2, 2026 (0600) & June 3, 2026 (0600)" (City of
// Baytown posts these) is an index page, not a story. High-precision phrases
// only: "for reports between" anchored at the start, "police blotter"
// anywhere. /news leans community, and a blotter index is exactly what it
// shouldn't carry.
const BLOTTER_RE = /^\s*for reports between\b|\bpolice blotter\b/i;
// Grief / aftermath follow-ups to a tragedy — emotional reactions, not new
// incidents. Dropped entirely so one death doesn't spawn a string of vigil /
// "family mourns" rewrites that crowd out community news. High-precision phrases
// only (bare "memorial" / "tribute" are too broad and would catch real features).
const AFTERMATH = [
  "family mourns", "mourning", "vigil", "candlelight", "gofundme", "go fund me",
  "celebration of life", "laid to rest", "rest in peace", "darker place",
  "memorial service", "loved ones", "grieving",
];
// Real-estate listings (addresses + realtor sites) — not news, dropped.
const RE_ADDRESS = /^\s*\d{2,6}\s+\w+.*\b(trl|trail|dr|drive|st|street|ln|lane|ct|court|rd|road|blvd|ave|avenue|way|cir|circle|pl|place|pkwy|hwy|loop|cv|cove|ridge|run|bend|xing|crossing|point|pointe)\b/i;
const REALTOR = ["zillow", "realtor.com", "redfin", "trulia", "homes.com", "har.com", "movoto", "sq ft", "sqft", "for sale - "];
// Crime/accident terms — down-ranked below community news (not hidden, just
// sorted lower and capped). Matched on WORD boundaries, not as substrings, so
// benign headlines don't get mis-tagged: "dead" won't fire on "deadline",
// "spill" on "spillway", "raid" on "braid". CRIME_WORDS match as whole words;
// CRIME_STEMS match as a prefix to catch inflections (stabbing, burglary,
// evacuated). True homonyms ("shot" the photo vs. the gun, "body" of work) can
// still slip through — acceptable, since incidents are only down-ranked.
const CRIME_WORDS = [
  "shooting", "shootout", "shot", "murder", "homicide", "killed", "kills", "dead",
  "death", "deadly", "dies", "died", "crash", "wreck", "collision", "fatal",
  "rollover", "trapped", "hurt", "arrest", "charged", "charges", "suspect", "accused",
  "alleged", "improper", "guilty", "sentenced", "convicted", "bomb", "assault",
  "robbery", "dwi", "dui", "cruelty", "abuse", "horrific", "starving", "raid",
  "missing", "leak", "spill", "standoff", "armed", "gunman", "indicted", "hazmat",
  "manhunt", "fighting ring",
];
const CRIME_STEMS = ["stabb", "burglar", "drown", "overturn", "injur", "seiz", "evacuat", "cockfight"];
const reEsc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CRIME_RE = new RegExp(
  "\\b(?:" + CRIME_WORDS.map(reEsc).join("|") + ")\\b|\\b(?:" + CRIME_STEMS.map(reEsc).join("|") + ")",
  "i"
);

function decodeEntities(s) {
  return String(s ?? "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();
}

function parseRssItems(xml) {
  const items = [];
  for (const b of xml.split(/<item>/i).slice(1)) {
    const seg = b.split(/<\/item>/i)[0];
    const pick = (tag) => {
      const m = seg.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return m ? decodeEntities(m[1]) : "";
    };
    const title = pick("title");
    const link = pick("link");
    if (title && link) items.push({ title, link, pubDate: pick("pubDate"), source: pick("source") });
  }
  return items;
}

// "core" (Crosby), "near" (bordering town w/ TX context), or null (exclude).
function areaTier(title, source) {
  const t = ` ${title.toLowerCase()} `;
  const blob = `${t} ${(source || "").toLowerCase()}`;
  if (REJECT.some((r) => t.includes(r))) return null;
  if (GEO_RE.test(title)) return null; // other-place Crosbys (UK / Waterbury CT / Crosbyton)
  if (SOFT_DROP.some((d) => blob.includes(d))) return null;
  if (BLOTTER_RE.test(title)) return null; // blotter / report-index boilerplate
  if (AFTERMATH.some((d) => t.includes(d))) return null;
  if (RE_ADDRESS.test(title) || REALTOR.some((r) => blob.includes(r))) return null;
  const crosby = t.includes("crosby") && (REQUIRE.some((r) => t.includes(r)) || CONTEXT.some((c) => t.includes(c)));
  if (crosby || t.includes("barrett station")) return "core";
  if (NEAR.some((n) => t.includes(n)) && NEAR_CONTEXT.some((c) => t.includes(c))) return "near";
  return null;
}
const isCrime = (title) => CRIME_RE.test(title);

// Group an incident into a coarse "family" so the (capped) incident slots show
// DIFFERENT kinds of events — and reworded headlines about the same case (which
// share a family but few story-specific words, so fuzzy de-dup misses them)
// collapse to one slot. Highest-severity family present wins, so "charged in
// Crosby home murder" and "murder suspect identified" both read as `violence`
// and dedupe together. Coarse substring match is fine here: this only ever runs
// on items already crime-tagged by CRIME_RE, purely to bucket them.
const CRIME_FAMILIES = [
  ["violence", ["shooting", "shootout", "shot", "murder", "homicide", "killed", "kills", "death", "deadly", "dies", "died", "fatal", "assault", "robbery", "armed", "gunman", "manhunt", "bomb", "standoff", "stabb", "burglar", "cruelty", "abuse", "starving", "fighting ring", "cockfight"]],
  ["vehicle", ["crash", "wreck", "collision", "rollover", "overturn", "trapped", "dwi", "dui"]],
  ["hazard", ["fire", "leak", "spill", "hazmat", "evacuat", "drown", "seiz"]],
];
function crimeFamily(title) {
  const t = title.toLowerCase();
  for (const [fam, words] of CRIME_FAMILIES) {
    if (words.some((w) => t.includes(w))) return fam;
  }
  return "other";
}

// Drop stale event announcements: a headline that announced a then-FUTURE event
// ("Crosby HS Graduation — 7PM — Friday, May 29th, 2026") is noise once the day
// has passed. Deliberately conservative — drops only when ALL THREE hold:
//   1. an explicit month-name date parses out of the title;
//   2. pubTs < eventTs < now — published BEFORE the event, and the event is now
//      past. This ordering is the key safeguard: a crime report citing a past
//      date is spared (it was published AFTER), a next-year announcement is
//      spared (eventTs > now), and a retrospective is spared (eventTs < pubTs);
//   3. the title carries an event / scheduling cue — so a policy or news story
//      that merely mentions a future date is spared.
// Numeric dates (5/29), times (7PM) and money ($1M) are intentionally not parsed
// as dates, to avoid false positives.
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const EVENT_DATE_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/gi;
const TIME_RE = /\b\d{1,2}(?::\d{2})?\s?[ap]\.?m\.?\b/i;
const EVENT_CUE = [
  "graduation", "festival", "parade", "fundraiser", "concert", "ceremony",
  "banquet", "gala", "homecoming", "reunion", "open house", "blood drive",
  "car show", "tryouts", "registration", "5k", "will be held", "to be held",
  "set for", "save the date", "join us", "rsvp", "tickets", "kicks off",
  "to take place", "this saturday", "this sunday", "this friday",
];
function parseEventDate(title, pubTs) {
  const pub = new Date(pubTs);
  let best = null;
  for (const m of title.matchAll(EVENT_DATE_RE)) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
    const day = +m[2];
    if (mon == null || day < 1 || day > 31) continue;
    const year = m[3] ? +m[3] : pub.getUTCFullYear();
    let ts = Date.UTC(year, mon, day, 23, 59, 59); // end of the event day
    // No explicit year and the date lands before publish? It's announcing the
    // NEXT occurrence (e.g. a December item for a January event) — roll forward.
    if (!m[3] && ts < pubTs) ts = Date.UTC(year + 1, mon, day, 23, 59, 59);
    if (best == null || ts > best) best = ts; // prefer the latest date in the title
  }
  return best;
}
function stalePastEvent(title, pubTs, now) {
  const eventTs = parseEventDate(title, pubTs);
  if (eventTs == null) return false;
  if (!(pubTs < eventTs && eventTs < now)) return false; // not an announced-future, now-past event
  const t = title.toLowerCase();
  return EVENT_CUE.some((c) => t.includes(c)) || TIME_RE.test(title);
}

// Fuzzy de-dupe: collapse near-identical headlines (same story, reworded). Topic
// words are dropped so similarity is driven by story-specific terms.
const STOP = new Set(["after", "says", "said", "with", "from", "that", "this", "over", "into", "near", "texas", "county", "harris", "crosby", "houston", "area", "home", "year", "old", "woman", "found", "your", "have", "will", "than", "what", "when"]);
const sigOf = (title) => new Set(title.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

async function main() {
  if (!TOKEN || !ACCOUNT) {
    console.error("Missing CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID");
    process.exit(1);
  }
  const xmls = await Promise.all(
    QUERIES.map(async (q) => {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
      try {
        const r = await fetch(url, { headers: { "User-Agent": "crosbynews.com news routine" } });
        return r.ok ? await r.text() : "";
      } catch {
        return "";
      }
    })
  );
  // If every source came back empty, this is an upstream/network failure (e.g.
  // Google rate-limiting the routine's IP) — NOT a genuinely quiet news day.
  // Bail without writing so a transient blip can't overwrite the last good
  // snapshot with an empty list. (A real quiet day still returns feeds with zero
  // matching items, which is allowed through below to prune to an honest empty.)
  if (xmls.every((x) => !x)) {
    console.error("All news queries returned empty (upstream failure) — leaving existing KV untouched.");
    process.exit(1);
  }

  const now = Date.now();
  const minTs = now - MAX_AGE_DAYS * 86400000;
  const seen = new Set();
  const sigs = [];
  const out = [];
  for (const xml of xmls) {
    for (const it of parseRssItems(xml)) {
      const tier = areaTier(it.title, it.source);
      if (!tier) continue;
      if (!/^https?:\/\//i.test(it.link)) continue; // only real http(s) links reach KV
      const ts = Date.parse(it.pubDate) || 0;
      // Require a parseable, in-window date. Undated items (ts===0) fail the
      // freshness gate too, so a headline we can't date can't linger forever.
      if (!ts || ts < minTs) continue;
      if (stalePastEvent(it.title, ts, now)) continue; // announced event whose date has passed
      const title = it.title.replace(/\s+-\s+[^-]+$/, "").trim();
      const key = title.toLowerCase().slice(0, 70);
      if (seen.has(key)) continue;
      const sig = sigOf(title);
      if (sigs.some((s) => jaccard(s, sig) > 0.35)) continue; // near-duplicate story (aggressive)
      seen.add(key);
      sigs.push(sig);
      const sourceFromTitle = (it.title.match(/\s+-\s+([^-]+)$/) || [])[1];
      out.push({
        title,
        source: it.source || (sourceFromTitle ? sourceFromTitle.trim() : ""),
        link: it.link,
        ts,
        crime: isCrime(title),
        near: tier === "near",
      });
    }
  }
  // Community before crime, then core-Crosby before nearby, then newest first.
  out.sort((a, b) => Number(a.crime) - Number(b.crime) || Number(a.near) - Number(b.near) || b.ts - a.ts);
  // Keep all community items, but cap incidents low so crime can't dominate the
  // page (this isn't a crime feed) or fill it with one event's many rewrites.
  const community = out.filter((i) => !i.crime).slice(0, 20);
  // Incidents: at most one per crime "family" and capped at 2, so the page shows
  // a couple of DISTINCT events rather than one case's many reworded headlines.
  // `out` is already priority-sorted, so the first item per family wins.
  // (Tradeoff: two genuinely distinct incidents of the same family collapse to
  // one — intended, given the "lean community" goal.)
  const incidents = [];
  const seenFam = new Set();
  for (const i of out) {
    if (!i.crime) continue;
    const fam = crimeFamily(i.title);
    if (seenFam.has(fam)) continue;
    seenFam.add(fam);
    incidents.push(i);
    if (incidents.length >= 2) break;
  }
  const payload = { updated: new Date().toISOString(), items: [...community, ...incidents], source: "google-news-routine" };

  // Shrink-guard: a partial upstream failure (some Google queries rate-limited,
  // the rest 503) can yield a near-empty result that would silently overwrite a
  // healthy snapshot. If the fresh result collapses to very few community items
  // while the stored snapshot is healthy (>=10), treat it as a blip and leave KV
  // untouched. A genuinely quiet week still updates freely; this only trips on a
  // clear collapse. Exit 0 (not a failure) so the routine doesn't flap.
  if (community.length < 5) {
    try {
      const existing = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${NS_ID}/values/${KV_KEY}`,
        { headers: { authorization: `Bearer ${TOKEN}` } }
      );
      if (existing.ok) {
        const prev = await existing.json().catch(() => null);
        const prevCommunity = Array.isArray(prev?.items) ? prev.items.filter((i) => !i.crime).length : 0;
        if (prevCommunity >= 10) {
          console.error(`Fresh result has only ${community.length} community items but stored snapshot has ${prevCommunity} — likely partial upstream failure; leaving KV untouched.`);
          process.exit(0);
        }
      }
    } catch (e) {
      console.error("Shrink-guard read failed (writing anyway):", e?.message);
    }
  }

  // DRY_RUN: inspect what the run would write without touching production KV
  // (handy for testing the filters against live Google News).
  if (process.env.DRY_RUN) {
    console.log(`[DRY_RUN] not writing to KV — payload that WOULD be written:`);
    console.log(JSON.stringify(payload, null, 2));
  } else {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${NS_ID}/values/${KV_KEY}`,
      { method: "PUT", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "text/plain" }, body: JSON.stringify(payload) }
    );
    const j = await res.json().catch(() => ({}));
    if (!j.success) {
      console.error("KV write failed:", res.status, JSON.stringify(j.errors || j));
      process.exit(1);
    }
  }
  const civicCount = payload.items.filter((i) => !i.crime).length;
  console.log(`${process.env.DRY_RUN ? "[DRY_RUN] " : "Wrote "}${payload.items.length} items to KV "${KV_KEY}" (${civicCount} community, ${payload.items.length - civicCount} incidents).`);
  payload.items.slice(0, 10).forEach((i) => console.log(`  ${i.crime ? "[crime]" : "[civic]"}${i.near ? "(near)" : "(core)"} ${i.title.slice(0, 64)}`));
}

// Run as a script (the routine invokes `node scripts/fetch-news.mjs`); skip when
// imported, so the pure helpers above can be unit-tested.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();

export { areaTier, isCrime, crimeFamily, parseEventDate, stalePastEvent };
