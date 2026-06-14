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
  "jeff crosby", "crosby, england", "crosby county", "crosbyton",
];
// Obituaries / funeral-home noise — dropped entirely.
const SOFT_DROP = ["obituary", "obituaries", "funeral home", "legacy.com", "in memoriam"];
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
  if (SOFT_DROP.some((d) => blob.includes(d))) return null;
  if (RE_ADDRESS.test(title) || REALTOR.some((r) => blob.includes(r))) return null;
  const crosby = t.includes("crosby") && (REQUIRE.some((r) => t.includes(r)) || CONTEXT.some((c) => t.includes(c)));
  if (crosby || t.includes("barrett station")) return "core";
  if (NEAR.some((n) => t.includes(n)) && NEAR_CONTEXT.some((c) => t.includes(c))) return "near";
  return null;
}
const isCrime = (title) => CRIME_RE.test(title);

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

  const minTs = Date.now() - MAX_AGE_DAYS * 86400000;
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
      const title = it.title.replace(/\s+-\s+[^-]+$/, "").trim();
      const key = title.toLowerCase().slice(0, 70);
      if (seen.has(key)) continue;
      const sig = sigOf(title);
      if (sigs.some((s) => jaccard(s, sig) > 0.4)) continue; // near-duplicate story (aggressive)
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
  const incidents = out.filter((i) => i.crime).slice(0, 3);
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

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${NS_ID}/values/${KV_KEY}`,
    { method: "PUT", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "text/plain" }, body: JSON.stringify(payload) }
  );
  const j = await res.json().catch(() => ({}));
  if (!j.success) {
    console.error("KV write failed:", res.status, JSON.stringify(j.errors || j));
    process.exit(1);
  }
  const civicCount = payload.items.filter((i) => !i.crime).length;
  console.log(`Wrote ${payload.items.length} items to KV "${KV_KEY}" (${civicCount} community, ${payload.items.length - civicCount} incidents).`);
  payload.items.slice(0, 10).forEach((i) => console.log(`  ${i.crime ? "[crime]" : "[civic]"}${i.near ? "(near)" : "(core)"} ${i.title.slice(0, 64)}`));
}

main();
