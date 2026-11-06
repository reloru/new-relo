// Pin the contract for the Workers AI layer of the news routine (scripts/news-ai.mjs
// + the candidate/cue helpers in scripts/fetch-news.mjs).
//
// The risk this guards: the routine runs against PREVIEW models with no
// availability guarantee, and a bug here either (a) lets a model outage abort the
// run or wipe/degrade the `news` snapshot, or (b) lets the model rescue/admit
// items on thresholds nobody meant to loosen. So:
//   - every failure mode returns "no verdict" and the regex result stands;
//   - rescues and nearby-town incidents are NEVER admitted without a verdict;
//   - the thresholds' direction is pinned (veto is lenient, rescue is strict).
// No network: the AI endpoint is a fake fetch. Run: node scripts/test-news-ai.mjs

import { areaTier, areaCandidate, hasEventCue } from "./fetch-news.mjs";
import { aiDecision, judgeHeadlines, isStaleFromAnswer, staleEventIndexes, THRESH } from "./news-ai.mjs";

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` → got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!ok) failures++;
};

// --- candidate classification ---------------------------------------------
console.log("areaCandidate");
check("context-less nearby town is a candidate, not accepted", [areaTier("Atascocita crash: scooter rider hurt", ""), areaCandidate("Atascocita crash: scooter rider hurt", "")], [null, "maybeNear"]);
check("context-less Crosby is a candidate", areaCandidate("Crosby Football Videos - MaxPreps", ""), "maybeCore");
check("regex-accepted stays accepted", areaCandidate("Crosby ISD board meets, Texas", ""), "core");
check("hard reject beats candidacy (Merseyside)", areaCandidate("Crosby man jailed after Liverpool Road stabbing", ""), null);
check("hard reject beats candidacy (Maxx Crosby)", areaCandidate("Maxx Crosby ruled out Sunday", ""), null);
check("St. Louis Barrett Station Road is a hard reject (KSDK/KMOV)", [areaCandidate("Rollover crash closes lanes of Manchester at Barrett Station Road - KSDK", ""), areaCandidate("Crash closes Manchester Road at Barrett Station Road for several hours - KMOV", "")], [null, null]);
check("a real Barrett Station headline still passes", areaTier("Barrett Station residents hold town hall on drainage - Houston Chronicle", ""), "core");
check("obituary is never a candidate", areaCandidate("Debra Smith Obituary - Crosby", "Legacy"), null);
check("unrelated headline is not a candidate", areaCandidate("City council votes on budget", ""), null);

// --- decisions --------------------------------------------------------------
console.log("aiDecision");
const V = (crosby, near, story) => ({ crosby, near, story });
check("no verdict: regex-accepted core stays", aiDecision("core", null).keep, true);
check("no verdict: regex-accepted near story stays", aiDecision("near", null).keep, true);
check("no verdict: nearby incident dropped", aiDecision("near", null, { crime: true }).keep, false);
check("no verdict: rescue never happens", aiDecision("maybeCore", null).keep, false);
check("core, real story kept", aiDecision("core", V(0.96, 0.3, 0.95)).keep, true);
check("core, index page vetoed", aiDecision("core", V(0.9, 0.2, 0.1)), { keep: false, why: "not-a-story" });
check("core, wrong place vetoed (Barrett Station Rd, MO scored 0.23-0.47)", aiDecision("core", V(0.47, 0.24, 0.92)), { keep: false, why: "wrong-place" });
check("near story kept on place + story", aiDecision("near", V(0.1, 0.9, 0.9)).keep, true);
check("near incident needs near >= nearIncident", aiDecision("near", V(0.1, 0.9, 0.95), { crime: true }), { keep: false, why: "incident-bar" });
check("near incident cleared", aiDecision("near", V(0.1, 0.97, 0.95), { crime: true }).keep, true);
check("maybeCore rescued on strong agreement", aiDecision("maybeCore", V(0.85, 0.2, 0.9)).keep, true);
check("maybeCore story score just under the rescue bar", aiDecision("maybeCore", V(0.85, 0.2, 0.79)).keep, false);
check("maybeNear needs near >= rescueNear", aiDecision("maybeNear", V(0.1, 0.85, 0.95)).keep, false);
check("maybeNear rescued", aiDecision("maybeNear", V(0.1, 0.95, 0.95)).keep, true);
check("maybeNear incident needs the incident bar too", aiDecision("maybeNear", V(0.1, 0.93, 0.95), { crime: true }).keep, false);
check("threshold direction: veto is more lenient than rescue", THRESH.storyVeto < THRESH.rescueStory && THRESH.coreMin < THRESH.rescueCore && THRESH.rescueNear < THRESH.nearIncident, true);

// --- judgeHeadlines failure modes ------------------------------------------
console.log("judgeHeadlines");
const okBody = (c, n, s) => ({ success: true, result: { answers: { crosby_tx: { noul: c }, nearby_tx: { noul: n }, is_story: { noul: s } } } });
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const opts = (fetchImpl) => ({ account: "a", token: "t", fetchImpl });
const T = ["Crosby ISD news - Baytown Sun"];
let m = await judgeHeadlines(T, opts(async () => resp(200, okBody(0.9, 0.2, 0.95))));
check("success parses the three probabilities", m.get(T[0]), { crosby: 0.9, near: 0.2, story: 0.95 });
m = await judgeHeadlines(T, opts(async () => { throw new Error("network down"); }));
check("network error => null verdict, no throw", m.get(T[0]), null);
let calls = 0;
m = await judgeHeadlines(T, opts(async () => (calls++ ? resp(200, okBody(0.9, 0.2, 0.95)) : resp(503, {}))));
check("5xx is retried once", [calls, m.get(T[0])?.story], [2, 0.95]);
calls = 0;
m = await judgeHeadlines(T, opts(async () => (calls++, resp(401, { success: false }))));
check("401 is not retried, null verdict", [calls, m.get(T[0])], [1, null]);
m = await judgeHeadlines(T, opts(async () => resp(200, { success: true, result: { answers: { crosby_tx: { noul: 0.9 } } } })));
check("partial answers => null verdict", m.get(T[0]), null);
m = await judgeHeadlines(T, { account: "a", token: "", fetchImpl: async () => { throw new Error("must not be called"); } });
check("no token => null verdict, no call", m.get(T[0]), null);
process.env.NEWS_AI = "0";
m = await judgeHeadlines(T, opts(async () => { throw new Error("must not be called"); }));
check("NEWS_AI=0 => null verdict, no call", m.get(T[0]), null);
delete process.env.NEWS_AI;

// --- event dates -------------------------------------------------------------
console.log("event dates");
const pub = Date.UTC(2026, 4, 8, 12); // 2026-05-08
const now = Date.UTC(2026, 4, 20, 12);
check("confident past event date is stale", isStaleFromAnswer({ value: "2026-05-12", confidence: 0.999, p_null: 0.003 }, pub, now), true);
check("future event date is not stale", isStaleFromAnswer({ value: "2026-05-29", confidence: 0.999, p_null: 0.003 }, pub, now), false);
check("event day before publish is not stale (retrospective)", isStaleFromAnswer({ value: "2026-05-02", confidence: 0.999, p_null: 0.003 }, pub, now), false);
check("low confidence ignored", isStaleFromAnswer({ value: "2026-05-12", confidence: 0.45, p_null: 0.03 }, pub, now), false);
check("likely-null ignored", isStaleFromAnswer({ value: "2026-05-12", confidence: 0.95, p_null: 0.5 }, pub, now), false);
check("null answer ignored", isStaleFromAnswer({ value: null, confidence: 0.99, p_null: 1 }, pub, now), false);
check("garbage value ignored", isStaleFromAnswer({ value: "next Tuesday", confidence: 0.99, p_null: 0 }, pub, now), false);
check("cue: scheduling words / times", [hasEventCue("Board meeting set for 5/12 at 6 p.m."), hasEventCue("Man charged in Crosby shooting")], [true, false]);
let asked = [];
const clairic = async (url, init) => {
  const body = JSON.parse(init.body);
  asked.push(body.state);
  return resp(200, { success: true, result: { answers: { event_date: { value: "2026-05-12", confidence: 0.999, p_null: 0.003 } } } });
};
let stale = await staleEventIndexes(
  [{ title: "Board meeting set for 5/12 at 6 p.m.", pubTs: pub }, { title: "Man charged in Crosby shooting", pubTs: pub }],
  now, hasEventCue, opts(clairic));
check("only cue-bearing headlines are sent to the model", [asked.length, [...stale]], [1, [0]]);
stale = await staleEventIndexes([{ title: "Board meeting set for 5/12 at 6 p.m.", pubTs: pub }], now, hasEventCue, opts(async () => { throw new Error("down"); }));
check("model failure => nothing stale", [...stale], []);

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
