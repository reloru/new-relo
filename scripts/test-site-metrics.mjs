// The aggregate page-request counts (src/metrics.js) against a real SQL
// database with the repo's migrations applied.
//
// /privacy tells readers exactly what is and is not stored. This is what keeps
// that true: the test sends requests carrying an IP-like header, a full user
// agent, a referring URL with a search term, and a probe path, then reads back
// every byte in the table and fails if any of it is there.
//
// Run: node scripts/test-site-metrics.mjs

import { createHarness, SITE } from "./lib/harness.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url).pathname;
const M = await import(pathToFileURL(join(SRC, "metrics.js")).href);

const failures = [];
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (cond, what) => { if (!cond) failures.push(what); };

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const GOOGLEBOT = "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

// --- labels -----------------------------------------------------------------
eq(M.pathLabel("/water"), "/water", "registered page keeps its path");
eq(M.pathLabel("/es/water"), "/es/water", "Spanish page keeps its path");
eq(M.pathLabel("/api/weather"), "/api/weather", "listed endpoint keeps its path");
eq(M.pathLabel("/.env"), "(other)", "probe path is bucketed, never stored");
eq(M.pathLabel("/backend/.env.production"), "(other)", "nested probe path is bucketed");
eq(M.pathLabel("/api/orders/..%2fadmin/config.json"), "(api-other)", "unknown /api path is bucketed");
eq(M.pathLabel("/icons/land/day/few"), "(icons)", "icon proxy is bucketed");

eq(M.agentLabel(CHROME, { asn: 7922 }), { agent: "browser", verified: 0 }, "desktop Chrome");
eq(M.agentLabel(IPHONE, {}), { agent: "browser", verified: 0 }, "iPhone Safari");
eq(M.agentLabel(GOOGLEBOT, { asn: 15169 }), { agent: "googlebot", verified: 1 }, "Googlebot from Google's network");
eq(M.agentLabel(GOOGLEBOT, { asn: 14061 }), { agent: "googlebot", verified: 0 }, "Googlebot name from another network is unverified");
eq(M.agentLabel(GOOGLEBOT, { asn: 14061, verifiedBotCategory: "Search Engine Crawler" }), { agent: "googlebot", verified: 2 }, "Cloudflare-verified crawler");
eq(M.agentLabel("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", { asn: 8075 }), { agent: "bingbot", verified: 1 }, "bingbot from Microsoft's network");
eq(M.agentLabel("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot", {}).agent, "oai-searchbot", "OAI-SearchBot");
eq(M.agentLabel("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot", {}).agent, "chatgpt-user", "ChatGPT-User");
eq(M.agentLabel("Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", {}).agent, "claudebot", "ClaudeBot");
eq(M.agentLabel("Claude-User", {}).agent, "claude-user", "Claude-User");
eq(M.agentLabel("curl/8.7.1", {}).agent, "script", "curl");
eq(M.agentLabel("python-httpx/0.28.1", {}).agent, "script", "python client");
eq(M.agentLabel("Mozilla/5.0 (compatible; SomeNewBot/1.0)", {}).agent, "script", "unlisted bot");
eq(M.agentLabel("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/125.0 Safari/537.36", {}).agent, "script", "headless Chrome is not a reader");
eq(M.agentLabel("", {}).agent, "unknown", "empty user agent");
eq(M.agentLabel(null, undefined).agent, "unknown", "missing user agent and cf");

const U = (q = "") => new URL(SITE + "/water" + q);
eq(M.refLabel("https://www.google.com/", U()), "google", "Google search");
eq(M.refLabel("https://www.google.co.uk/search?q=crosby+flood", U()), "google", "Google country domain");
eq(M.refLabel("https://gemini.google.com/app", U()), "gemini", "Gemini is not Google search");
eq(M.refLabel("https://www.bing.com/search?q=x", U()), "bing", "Bing");
eq(M.refLabel("https://duckduckgo.com/", U()), "duckduckgo", "DuckDuckGo");
eq(M.refLabel("android-app://com.google.android.googlequicksearchbox/", U()), "google", "Google app on Android");
eq(M.refLabel("https://chatgpt.com/", U()), "chatgpt", "ChatGPT referrer");
eq(M.refLabel(null, U("?utm_source=chatgpt.com")), "chatgpt", "ChatGPT via utm_source");
eq(M.refLabel(null, U("?utm_source=perplexity")), "perplexity", "bare utm_source name");
eq(M.refLabel(null, U("?utm_source=my-secret-campaign-name")), "none", "an arbitrary utm_source cannot mint a category");
eq(M.refLabel("https://crosbynews.com/weather", U()), "internal", "internal navigation");
eq(M.refLabel("https://some-private-intranet.example.org/page?token=abc", U()), "other-site", "unlisted site collapses to one label");
eq(M.refLabel("not a url", U()), "none", "malformed Referer");
eq(M.refLabel(null, U()), "none", "no Referer");

// --- what reaches the database ----------------------------------------------
const h = await createHarness();
const send = (path, { ua = CHROME, referer, cf = { asn: 7922 }, method = "GET", extra = {} } = {}) => {
  const req = new Request(SITE + path, { method, headers: { "user-agent": ua, accept: "text/html", ...(referer ? { referer } : {}), ...extra } });
  Object.defineProperty(req, "cf", { value: cf });
  return h.worker.fetch(req, h.env, h.ctx).then((r) => r.text());
};

const SECRETS = ["203.0.113.77", "SecretSearchTerm", "private-intranet", "token=abc", "Chrome/131", "Nexus 5X", "/.env", "wp-login", "campaign-zzz"];
await send("/water", { referer: "https://www.google.com/search?q=SecretSearchTerm", extra: { "cf-connecting-ip": "203.0.113.77", "x-forwarded-for": "203.0.113.77" } });
await send("/water", { referer: "https://www.google.com/search?q=SecretSearchTerm", extra: { "cf-connecting-ip": "203.0.113.77" } });
await send("/es/pollen", { ua: IPHONE, referer: "https://some-private-intranet.example.org/page?token=abc" });
await send("/burn-ban?utm_source=chatgpt.com&utm_campaign=campaign-zzz");
await send("/water", { ua: GOOGLEBOT, cf: { asn: 15169 } });
await send("/.env", { ua: GOOGLEBOT, cf: { asn: 14061 } });
await send("/wp-login.php", { ua: "curl/8.7.1" });
await send("/weather", { method: "POST" });
await M.flushNow(h.env);

const rows = (await h.env.DB.prepare("SELECT * FROM hits ORDER BY path, agent, ref").all()).results;
const dump = JSON.stringify(rows);
for (const s of SECRETS) ok(!dump.includes(s), `the table contains "${s}", which /privacy says is never stored`);

const find = (path, agent, ref) => rows.find((r) => r.path === path && r.agent === agent && r.ref === ref);
eq(find("/water", "browser", "google")?.n, 2, "two identical requests are one row with n = 2");
eq(find("/es/pollen", "browser", "other-site")?.n, 1, "unlisted referrer counted as other-site");
eq(find("/burn-ban", "browser", "chatgpt")?.n, 1, "utm_source arrival counted under chatgpt, query string dropped");
eq(find("/water", "googlebot", "none")?.verified, 1, "real Googlebot stored as verified");
eq(rows.find((r) => r.path === "(other)" && r.agent === "googlebot")?.verified, 0, "spoofed Googlebot probing /.env stored as unverified, path bucketed");
eq(rows.find((r) => r.path === "(other)" && r.agent === "script")?.status, 404, "probe counted as a 404 under (other)");
ok(!rows.some((r) => r.path === "/weather" && r.status === 405), "a POST is not counted");

// The schema is the privacy promise. A new column means re-reading /privacy
// (src/pages/privacy.js, both languages) and docs/ops/analytics.md.
const cols = (await h.env.DB.prepare("PRAGMA table_info(hits)").all()).results.map((c) => c.name);
eq(cols, ["day", "path", "agent", "verified", "ref", "status", "n"], "hits columns");

// --- failure and switches ---------------------------------------------------
const before = (await h.env.DB.prepare("SELECT SUM(n) AS n FROM hits").first("n")) || 0;
const realBatch = h.env.DB.batch;
let failed = 0;
h.env.DB.batch = async () => { failed++; throw new Error("D1 down"); };
const quiet = console.error;
console.error = () => {};
await send("/air");
await M.flushNow(h.env);
console.error = quiet;
h.env.DB.batch = realBatch;
ok(failed === 1, "the failing flush was attempted");
await M.flushNow(h.env);
eq((await h.env.DB.prepare("SELECT SUM(n) AS n FROM hits").first("n")) - before, 1, "a count that failed to write is carried by the next flush, once");

h.env.SITE_METRICS = "off";
await send("/tropics");
await M.flushNow(h.env);
ok(!(await h.env.DB.prepare("SELECT 1 AS x FROM hits WHERE path = '/tropics'").first()), "SITE_METRICS off counts nothing");
h.env.SITE_METRICS = "on";

// --- retention --------------------------------------------------------------
await h.env.DB.prepare("INSERT INTO hits VALUES ('2020-01-01', '/water', 'browser', 0, 'none', 200, 5)").run();
const pruned = await M.pruneHits(h.env);
eq(pruned, 1, "prune removes totals past retention");
ok((await h.env.DB.prepare("SELECT COUNT(*) AS c FROM hits").first("c")) > 0, "prune keeps current totals");

// --- the owner's report -----------------------------------------------------
const noKey = await h.get("/api/site-usage");
eq(noKey.status, 401, "report without the key");
const wrong = await h.get("/api/site-usage?key=nope");
eq(wrong.status, 401, "report with a wrong key");
const rep = await h.get(`/api/site-usage?key=${h.env.ADMIN_KEY}`);
eq(rep.status, 200, "report with the key");
ok(/no-store/.test(rep.headers.get("cache-control") || ""), "report is not cacheable");
ok(!rep.headers.get("access-control-allow-origin"), "report is same-origin only");
const body = await rep.json();
ok(body.referrals.search.some((r) => r.ref === "google" && r.path === "/water" && r.n === 2), "report lists the Google arrivals by landing page");
ok(body.referrals.ai.some((r) => r.ref === "chatgpt" && r.path === "/burn-ban"), "report lists the ChatGPT arrival");
ok(body.crawlers.some((r) => r.agent === "googlebot" && r.verified === 1 && r.path === "/water" && r.lastDay), "report gives each crawler's last fetch per page");
ok(!body.crawlers.some((r) => r.path.startsWith("(")), "crawler table lists real pages only");
const txt = await (await h.get(`/api/site-usage?key=${h.env.ADMIN_KEY}&format=txt`)).text();
ok(txt.includes("FROM SEARCH ENGINES") && txt.includes("/water") && txt.includes("googlebot"), "text report renders");
for (const s of SECRETS) ok(!txt.includes(s) && !JSON.stringify(body).includes(s), `the report contains "${s}"`);

if (failures.length) {
  console.error(`\nSite metrics checks failed (${failures.length}):\n  ${failures.join("\n  ")}\n`);
  process.exit(1);
}
console.log("Site metrics OK — labels come from closed sets, nothing identifying reaches the table, failed writes are carried once, retention and the owner report work.");
// The module's flush timer is still pending; nothing more to wait for.
process.exit(0);
