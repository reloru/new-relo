// Pin the news routine's Google News fetch contract (scripts/fetch-news.mjs).
//
// The risk this guards: Google answers some requests with 429 "automated
// queries". Before this check existed a refused query read as "no news", so a
// run that lost two of five queries overwrote the snapshot with the other three
// queries' stories (2026-11-16: 10 items -> 5). So:
//   - 429, 5xx, network errors and non-RSS 200s are retried, with backoff;
//   - other 4xx are not retried;
//   - the run writes only when EVERY query answered.
// No network: fetch and sleep are fakes. Run: node scripts/test-fetch-news.mjs

import { fetchFeed, feedGate } from "./fetch-news.mjs";

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` → got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!ok) failures++;
};

const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><item><title>x</title></item></channel></rss>';
const SORRY = "<html><title>Sorry...</title>We're sorry... automated queries</html>";
// A scripted fetch: each entry is [status, body] or "throw".
function fake(script) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (step === "throw") throw new TypeError("fetch failed");
    const [status, body] = step;
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return { fetchImpl, calls };
}
const run = async (script, extra = {}) => {
  const f = fake(script);
  const sleeps = [];
  const r = await fetchFeed("https://news.google.com/rss/search?q=x", {
    fetchImpl: f.fetchImpl,
    sleepImpl: async (ms) => { sleeps.push(ms); },
    random: () => 0,
    ...extra,
  });
  return { ok: r.ok, status: r.status, tries: r.tries, calls: f.calls.length, sleeps, hasText: r.text.length > 0 };
};

console.log("fetchFeed");
check("200 RSS first try: no retry", await run([[200, RSS]]), { ok: true, status: 200, tries: 1, calls: 1, sleeps: [], hasText: true });
check("429 then 200: retried once after 5 s", await run([[429, SORRY], [200, RSS]]), { ok: true, status: 200, tries: 2, calls: 2, sleeps: [5000], hasText: true });
check("429 three times then 200: backoff 5, 10, 20 s", await run([[429, ""], [429, ""], [429, ""], [200, RSS]]), { ok: true, status: 200, tries: 4, calls: 4, sleeps: [5000, 10000, 20000], hasText: true });
check("429 every time: fails after 4 tries, no text", await run([[429, SORRY]]), { ok: false, status: 429, tries: 4, calls: 4, sleeps: [5000, 10000, 20000], hasText: false });
check("503 then 200: 5xx retried", await run([[503, ""], [200, RSS]]), { ok: true, status: 200, tries: 2, calls: 2, sleeps: [5000], hasText: true });
check("network error then 200: retried", await run(["throw", [200, RSS]]), { ok: true, status: 200, tries: 2, calls: 2, sleeps: [5000], hasText: true });
check("network error every time: status 'network'", await run(["throw"]), { ok: false, status: "network", tries: 4, calls: 4, sleeps: [5000, 10000, 20000], hasText: false });
check("200 'sorry' page is not RSS: retried", await run([[200, SORRY], [200, RSS]]), { ok: true, status: 200, tries: 2, calls: 2, sleeps: [5000], hasText: true });
check("200 non-RSS every time: status 'not-rss'", await run([[200, SORRY]]), { ok: false, status: "not-rss", tries: 4, calls: 4, sleeps: [5000, 10000, 20000], hasText: false });
check("404 is not retried", await run([[404, ""]]), { ok: false, status: 404, tries: 1, calls: 1, sleeps: [], hasText: false });
check("jitter adds up to one base step", await run([[429, ""], [200, RSS]], { random: () => 0.5 }), { ok: true, status: 200, tries: 2, calls: 2, sleeps: [7500], hasText: true });

console.log("feedGate");
const ok = { ok: true, status: 200 };
check("all five answered: write", feedGate([ok, ok, ok, ok, ok]), { write: true, message: "" });
check(
  "two of five refused (the 2026-11-16 case): no write, names them",
  feedGate([ok, { ok: false, status: 429 }, ok, { ok: false, status: "network" }, ok]),
  { write: false, message: "2 of 5 news queries failed after retries: query 2 (429), query 4 (network) — leaving existing KV untouched so their stories aren't dropped." }
);
check("one of five refused: no write", feedGate([ok, ok, ok, ok, { ok: false, status: 503 }]).write, false);
check("all refused: no write, upstream message", feedGate([{ ok: false, status: 429 }, { ok: false, status: 429 }]), { write: false, message: "All news queries failed (upstream failure) — leaving existing KV untouched." });

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed.");
