// Aggregate request counts for the site's own pages.
//
// The questions this answers: which pages are read, whether search engines and
// AI crawlers fetch them (and how recently), and whether anyone arrives from a
// search result or an AI answer. Nothing else.
//
// WHAT IS STORED: a count per (Central day, path, agent label, referrer label,
// status). WHAT IS NEVER STORED: IP addresses, user-agent strings, referring
// URLs or hosts, search terms, query strings, cookies, any identifier, or any
// row describing a single request. The user agent, the network number and the
// Referer header are read once to choose a label and are then gone.
//
// /privacy describes exactly this, in both languages. Changing what is
// counted means changing src/pages/privacy.js and docs/ops/analytics.md in the
// same commit.
//
// Counts are added to D1 with `n = n + ?` upserts, which are atomic, so there
// is no read on the request path and no shard-and-rollup step. Each isolate
// batches a few seconds of counts into one write.

import { TZ } from "./config.js";
import { PAGE_PATHS, ENDPOINTS } from "./registry.js";

const FLUSH_DELAY_MS = 4000;
// A ceiling on distinct keys held between flushes. Every label below comes
// from a closed set, so this is unreachable in normal use; it exists so that
// nothing a caller sends can grow the map without bound.
const MAX_PENDING_KEYS = 2000;
// Daily totals older than this are deleted by the cron.
export const RETAIN_DAYS = 400;

const enabled = (env) => !!env && env.SITE_METRICS === "on" && !!env.DB;

// --- labels -----------------------------------------------------------------

const OTHER_KNOWN_PATHS = new Set(["/robots.txt", "/manifest.json", "/sw.js", "/favicon.ico", "/radar-image"]);
const ENDPOINT_PATHS = new Set(ENDPOINTS.map((e) => e.path));

// The path label is a registered page or endpoint, or one of four buckets.
// Arbitrary request paths (probes for /.env and the like, which are most of
// the site's 404s) are never stored as written.
export function pathLabel(pathname) {
  if (PAGE_PATHS.has(pathname) || ENDPOINT_PATHS.has(pathname) || OTHER_KNOWN_PATHS.has(pathname)) return pathname;
  if (pathname.startsWith("/icons/")) return "(icons)";
  if (pathname.startsWith("/api/")) return "(api-other)";
  if (pathname.startsWith("/.well-known/")) return "(well-known)";
  return "(other)";
}

// Named crawlers, matched on a user-agent token. Order matters where one
// token contains another. `asn` lists the networks the operator crawls from,
// only where that is well established; it lets a claim be checked without
// Cloudflare's verified-bot signal.
const CRAWLERS = [
  { label: "googlebot", re: /googlebot/i, asn: [15169] },
  { label: "google-other", re: /googleother|google-inspectiontool|storebot-google|adsbot-google|google-extended|google-cloudvertexbot/i, asn: [15169] },
  { label: "bingbot", re: /bingbot|bingpreview|msnbot/i, asn: [8075] },
  { label: "duckduckbot", re: /duckduckbot|duckassistbot/i },
  { label: "applebot", re: /applebot/i, asn: [714, 6185] },
  { label: "yandexbot", re: /yandex/i },
  { label: "bravebot", re: /bravebot|brave-search/i },
  { label: "oai-searchbot", re: /oai-searchbot/i },
  { label: "chatgpt-user", re: /chatgpt-user/i },
  { label: "gptbot", re: /gptbot/i },
  { label: "claude-searchbot", re: /claude-searchbot/i },
  { label: "claude-user", re: /claude-user/i },
  { label: "claudebot", re: /claudebot|claude-web|anthropic-ai/i },
  { label: "perplexity-user", re: /perplexity-user/i },
  { label: "perplexitybot", re: /perplexitybot/i },
  { label: "amazonbot", re: /amazonbot/i },
  { label: "meta-agent", re: /meta-externalagent|meta-externalfetcher|facebookexternalhit|facebookbot/i },
  { label: "ccbot", re: /ccbot/i },
  { label: "bytespider", re: /bytespider/i },
  { label: "petalbot", re: /petalbot/i },
  { label: "exabot", re: /exasearchbot|exabot/i },
];
export const CRAWLER_LABELS = CRAWLERS.map((c) => c.label);
const SEARCH_CRAWLERS = new Set(["googlebot", "bingbot", "duckduckbot", "applebot", "yandexbot", "bravebot", "oai-searchbot", "claude-searchbot", "perplexitybot"]);

const SCRIPT_RE = /bot\b|crawl|spider|probe|monitor|scan|fetch|http-?client|curl|wget|python|node|undici|axios|go-http|java\/|okhttp|httpx|scrapy|headless|lighthouse|uptime|feed|rss|preview|early hints/i;
const BROWSER_RE = /^Mozilla\/5\.0 .*(Chrome|Safari|Firefox|Edg)\//;

// -> { agent, verified }. `verified` only means something for a named crawler:
// 2 when Cloudflare's own verified-bot signal is present on the request, 1 when
// the request came from a network that operator is known to crawl from, 0 when
// the name is only what the user agent claims. Scanners borrow crawler names
// constantly, so an unverified "googlebot" is not Google.
export function agentLabel(userAgent, cf) {
  const ua = typeof userAgent === "string" ? userAgent : "";
  for (const c of CRAWLERS) {
    if (!c.re.test(ua)) continue;
    const verified = cf && cf.verifiedBotCategory ? 2 : cf && c.asn && c.asn.includes(cf.asn) ? 1 : 0;
    return { agent: c.label, verified };
  }
  if (!ua) return { agent: "unknown", verified: 0 };
  if (SCRIPT_RE.test(ua)) return { agent: "script", verified: 0 };
  if (BROWSER_RE.test(ua)) return { agent: "browser", verified: 0 };
  return { agent: "unknown", verified: 0 };
}

// Referrer categories. The host is matched and discarded; only the category
// name is kept. Several AI products send no Referer and tag the link with
// utm_source instead, so that is read too — against the same closed list.
const REFERRERS = [
  ["gemini", /(^|\.)gemini\.google\.com$/],
  ["google", /(^|\.)google\.[a-z.]{2,6}$/],
  ["bing", /(^|\.)bing\.com$/],
  ["copilot", /(^|\.)copilot\.microsoft\.com$/],
  ["duckduckgo", /(^|\.)duckduckgo\.com$/],
  ["yahoo", /(^|\.)yahoo\.com$/],
  ["brave", /(^|\.)search\.brave\.com$/],
  ["ecosia", /(^|\.)ecosia\.org$/],
  ["chatgpt", /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com)$/],
  ["perplexity", /(^|\.)perplexity\.ai$/],
  ["claude", /(^|\.)claude\.ai$/],
  ["facebook", /(^|\.)(facebook\.com|fb\.com|instagram\.com|threads\.net)$/],
  ["x", /(^|\.)(t\.co|x\.com|twitter\.com)$/],
  ["nextdoor", /(^|\.)nextdoor\.com$/],
  ["reddit", /(^|\.)reddit\.com$/],
];
export const SEARCH_REFS = new Set(["google", "bing", "duckduckgo", "yahoo", "brave", "ecosia"]);
export const AI_REFS = new Set(["chatgpt", "perplexity", "claude", "gemini", "copilot"]);

function hostCategory(host) {
  const h = String(host || "").toLowerCase();
  if (!h) return null;
  if (h === "crosbynews.com" || h === "www.crosbynews.com") return "internal";
  for (const [label, re] of REFERRERS) if (re.test(h)) return label;
  return "other-site";
}

export function refLabel(referer, url) {
  let host = "";
  try {
    // The Google app on Android sends an app referrer rather than a web one.
    if (referer && referer.startsWith("android-app://com.google.")) host = "google.com";
    else if (referer) host = new URL(referer).hostname;
  } catch {
    host = "";
  }
  const fromHeader = hostCategory(host);
  if (fromHeader && fromHeader !== "other-site") return fromHeader;
  // utm_source is caller-controlled, so it can only select an existing
  // category, never mint one.
  const utm = url && url.searchParams.get("utm_source");
  if (utm && utm.length <= 40) {
    for (const candidate of utm.includes(".") ? [utm] : [`${utm}.com`, `${utm}.ai`]) {
      const fromUtm = hostCategory(candidate);
      if (fromUtm && fromUtm !== "other-site" && fromUtm !== "internal") return fromUtm;
    }
  }
  return fromHeader || "none";
}

const STATUSES = new Set([200, 204, 301, 304, 400, 401, 403, 404, 405, 500, 502, 503]);
const statusLabel = (s) => (STATUSES.has(s) ? s : Math.floor(s / 100) * 100);

export function dayOf(ms) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ });
}

// --- request path -----------------------------------------------------------

// Module state: per isolate, which is why writes are increments, never totals.
let pending = new Map();
let flushScheduled = false;

const SEP = "\u0001";

export function classify(request, status) {
  const url = new URL(request.url);
  const { agent, verified } = agentLabel(request.headers.get("user-agent"), request.cf);
  return {
    day: dayOf(Date.now()),
    path: pathLabel(url.pathname),
    agent,
    verified,
    ref: refLabel(request.headers.get("referer"), url),
    status: statusLabel(status),
  };
}

async function flush(env) {
  flushScheduled = false;
  if (!pending.size) return;
  const batch = pending;
  pending = new Map();
  try {
    const stmt = env.DB.prepare(
      "INSERT INTO hits (day, path, agent, verified, ref, status, n) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (day, path, agent, verified, ref, status) DO UPDATE SET n = n + excluded.n",
    );
    const rows = [];
    for (const [key, n] of batch) {
      const [day, path, agent, verified, ref, status] = key.split(SEP);
      rows.push(stmt.bind(day, path, agent, Number(verified), ref, Number(status), n));
    }
    // D1 caps a batch well above this, but small batches keep one bad
    // statement from costing more than its own slice.
    for (let i = 0; i < rows.length; i += 50) await env.DB.batch(rows.slice(i, i + 50));
  } catch (e) {
    // Put the counts back so the next flush carries them. Bounded by
    // MAX_PENDING_KEYS, so a database that stays down cannot grow memory.
    for (const [key, n] of batch) {
      if (pending.size < MAX_PENDING_KEYS || pending.has(key)) pending.set(key, (pending.get(key) || 0) + n);
    }
    console.error("site metrics flush failed:", e && e.message);
  }
}

// Count one response. Never throws and never delays the response: the write
// happens in waitUntil, after a short wait that lets a burst share one batch.
export function recordHit(request, status, env, ctx) {
  try {
    if (!enabled(env)) return;
    if (request.method !== "GET" && request.method !== "HEAD") return;
    const c = classify(request, status);
    const key = [c.day, c.path, c.agent, c.verified, c.ref, c.status].join(SEP);
    if (pending.size >= MAX_PENDING_KEYS && !pending.has(key)) return;
    pending.set(key, (pending.get(key) || 0) + 1);
    if (flushScheduled || !ctx || typeof ctx.waitUntil !== "function") return;
    flushScheduled = true;
    ctx.waitUntil(new Promise((resolve) => setTimeout(resolve, FLUSH_DELAY_MS)).then(() => flush(env)));
  } catch (e) {
    console.error("site metrics record failed:", e && e.message);
  }
}

// Test hook: write whatever is pending now.
export const flushNow = (env) => flush(env);

// Delete daily totals past retention. Called by the cron.
export async function pruneHits(env, nowMs = Date.now()) {
  if (!env || !env.DB) return 0;
  const cutoff = dayOf(nowMs - RETAIN_DAYS * 86400000);
  const r = await env.DB.prepare("DELETE FROM hits WHERE day < ?").bind(cutoff).run();
  return r?.meta?.changes ?? 0;
}

// --- report -----------------------------------------------------------------

const family = (agent) =>
  agent === "browser" ? "browser"
    : SEARCH_CRAWLERS.has(agent) ? "search-crawler"
    : CRAWLER_LABELS.includes(agent) ? "ai-or-other-crawler"
    : agent;

export async function siteUsageReport(env, days = 14, nowMs = Date.now()) {
  const n = Math.min(Math.max(Number(days) || 14, 1), RETAIN_DAYS);
  const since = dayOf(nowMs - (n - 1) * 86400000);
  const all = (sql, ...args) => env.DB.prepare(sql).bind(...args).all().then((r) => r.results || []);

  const [byDay, pages, referrals, crawlers, statuses] = await Promise.all([
    all("SELECT day, agent, SUM(n) AS n FROM hits WHERE day >= ? GROUP BY day, agent ORDER BY day", since),
    all("SELECT path, SUM(n) AS n FROM hits WHERE day >= ? AND agent = 'browser' AND status IN (200, 304) AND path NOT LIKE '(%' GROUP BY path ORDER BY n DESC", since),
    all("SELECT ref, path, SUM(n) AS n FROM hits WHERE day >= ? AND agent = 'browser' AND ref NOT IN ('none', 'internal') GROUP BY ref, path ORDER BY n DESC", since),
    // No day filter: "when did this crawler last fetch this page" is the
    // question, and the answer may be older than the window.
    all("SELECT agent, verified, path, SUM(CASE WHEN day >= ? THEN n ELSE 0 END) AS n, MAX(day) AS lastDay, MIN(day) AS firstDay FROM hits WHERE agent NOT IN ('browser', 'script', 'unknown') AND status IN (200, 304) AND path NOT LIKE '(%' GROUP BY agent, verified, path ORDER BY agent, verified DESC, lastDay DESC", since),
    all("SELECT status, SUM(n) AS n FROM hits WHERE day >= ? GROUP BY status ORDER BY n DESC", since),
  ]);

  const daily = {};
  for (const r of byDay) {
    const d = (daily[r.day] ||= { browser: 0, "search-crawler": 0, "ai-or-other-crawler": 0, script: 0, unknown: 0 });
    d[family(r.agent)] = (d[family(r.agent)] || 0) + r.n;
  }
  const refTotals = {};
  for (const r of referrals) refTotals[r.ref] = (refTotals[r.ref] || 0) + r.n;

  return {
    windowDays: n,
    since,
    through: dayOf(nowMs),
    note: "Counts, not visitors: one person loading three pages is three. 'browser' means a browser-shaped user agent, which some bots also send. A crawler is only trustworthy where verified is 1 (its network matches) or 2 (Cloudflare verified it).",
    daily,
    browserPages: pages,
    referrals: { byCategory: refTotals, search: referrals.filter((r) => SEARCH_REFS.has(r.ref)), ai: referrals.filter((r) => AI_REFS.has(r.ref)), other: referrals.filter((r) => !SEARCH_REFS.has(r.ref) && !AI_REFS.has(r.ref)) },
    crawlers,
    statuses,
  };
}

const pad = (s, w) => String(s).padEnd(w);
const num = (v, w = 6) => String(v).padStart(w);

// Fixed-width text for reading on a phone.
export function siteUsageText(rep) {
  const out = [`crosbynews.com page requests — ${rep.since} to ${rep.through} (${rep.windowDays} days, Central time)`, rep.note, ""];
  out.push("BY DAY          browser  search  ai/other  script  unknown");
  for (const [day, d] of Object.entries(rep.daily)) {
    out.push(`${pad(day, 12)} ${num(d.browser, 9)} ${num(d["search-crawler"], 7)} ${num(d["ai-or-other-crawler"], 9)} ${num(d.script, 7)} ${num(d.unknown, 8)}`);
  }
  out.push("", "ARRIVALS BY REFERRER CATEGORY (browser requests)");
  const cats = Object.entries(rep.referrals.byCategory).sort((a, b) => b[1] - a[1]);
  if (!cats.length) out.push("  none recorded");
  for (const [ref, n] of cats) out.push(`  ${pad(ref, 14)} ${num(n)}`);
  for (const [title, rows] of [["FROM SEARCH ENGINES, BY LANDING PAGE", rep.referrals.search], ["FROM AI ASSISTANTS, BY LANDING PAGE", rep.referrals.ai]]) {
    out.push("", title);
    if (!rows.length) out.push("  none recorded");
    for (const r of rows) out.push(`  ${pad(r.ref, 12)} ${pad(r.path, 22)} ${num(r.n)}`);
  }
  out.push("", "PAGES READ IN A BROWSER");
  for (const r of rep.browserPages.slice(0, 50)) out.push(`  ${pad(r.path, 24)} ${num(r.n)}`);
  out.push("", "CRAWLER FETCHES (v: 2 Cloudflare-verified, 1 network matches, 0 name only)", "  crawler            v  page                     in-window  last fetched");
  for (const r of rep.crawlers) out.push(`  ${pad(r.agent, 18)} ${r.verified}  ${pad(r.path, 24)} ${num(r.n, 9)}  ${r.lastDay}`);
  out.push("", "RESPONSE STATUS");
  for (const r of rep.statuses) out.push(`  ${pad(r.status, 6)} ${num(r.n)}`);
  return out.join("\n") + "\n";
}
