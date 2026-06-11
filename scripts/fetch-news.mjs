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
// Crime/accident words — down-ranked below community news (not hidden).
const CRIME = [
  "shooting", "shot", "murder", "homicide", "killed", "kills", "dead", "death", "deadly", "dies", "died", "body",
  "drown", "crash", "wreck", "collision", "fatal", "overturn", "rollover", "trapped", "injured", "injures", "hurt",
  "arrest", "charged", "charges", "suspect", "accused", "alleged", "improper", "guilty", "sentenced", "convicted",
  "bomb", "stabb", "assault", "robbery", "burglar", "dwi", "dui", "cockfight", "fighting ring", "cruelty", "abuse",
  "horrific", "starving", "seized", "raid", "missing", "evacuat", "hazmat", "leak", "spill", "standoff", "shootout",
  "armed", "gunman", "manhunt", "indicted",
];

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
const isCrime = (title) => CRIME.some((w) => title.toLowerCase().includes(w));

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
  const minTs = Date.now() - MAX_AGE_DAYS * 86400000;
  const seen = new Set();
  const sigs = [];
  const out = [];
  for (const xml of xmls) {
    for (const it of parseRssItems(xml)) {
      const tier = areaTier(it.title, it.source);
      if (!tier) continue;
      const ts = Date.parse(it.pubDate) || 0;
      if (ts && ts < minTs) continue;
      const title = it.title.replace(/\s+-\s+[^-]+$/, "").trim();
      const key = title.toLowerCase().slice(0, 70);
      if (seen.has(key)) continue;
      const sig = sigOf(title);
      if (sigs.some((s) => jaccard(s, sig) > 0.6)) continue; // near-duplicate story
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
  // Keep all community items, but cap incidents so crime can't dominate the page.
  const community = out.filter((i) => !i.crime).slice(0, 20);
  const incidents = out.filter((i) => i.crime).slice(0, 6);
  const payload = { updated: new Date().toISOString(), items: [...community, ...incidents], source: "google-news-routine" };

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
