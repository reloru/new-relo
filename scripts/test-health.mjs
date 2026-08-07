// Exercise /api/health and the cron record it reads, with a stubbed KV.
//
// The endpoint reports three things: the site is live, when each feed last
// tried to fetch and whether it worked, and when the data on the page actually
// changed. The first is trivially true. The other two are a contract between
// two files that never call each other — src/cron.js writes `cron_status`,
// src/api/health.js reads it — so the tests below drive the REAL recorder and
// the REAL writer, then read the result back through the REAL reporter.
//
// The case that matters most is "refresh succeeded, content identical": that is
// the failure that put a three-day-old pollen count on the live site while every
// other signal said healthy, and `dataChangedAt` exists to make it visible.
//
// Run: node scripts/test-health.mjs

import { healthReport, cronRunRecorder, recordCronRun, FEEDS, CRON_STATUS_KV_KEY } from "../src/api/health.js";
import { openApiSpec } from "../src/api/openapi.js";

const ISO = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

// A KV stub that stores strings, like the real one, so put/get round-trips
// through JSON exactly as production does.
function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    store,
    WEATHER: {
      get: async (key, type) => {
        const raw = store.get(key);
        if (raw === undefined) return null;
        return type === "json" ? JSON.parse(raw) : raw;
      },
      put: async (key, value) => { store.set(key, value); },
    },
  };
}

let failures = 0;
function assert(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`          got  ${JSON.stringify(got)}`);
    console.log(`          want ${JSON.stringify(want)}`);
  }
}

console.log("\n/api/health:\n");

// --- 1. is the site live ----------------------------------------------------

{
  const env = fakeKv();
  const r = await healthReport(env);
  assert("empty KV -> still 200 and live; every feed reports nulls, not errors", {
    httpStatus: r.httpStatus,
    site: r.body.site,
    feeds: Object.keys(r.body.feeds).length,
    weather: r.body.feeds.weather,
  }, {
    httpStatus: 200,
    site: "live",
    feeds: FEEDS.length,
    weather: { lastAttempt: null, ok: null, dataChangedAt: null },
  });
}

{
  // No KV binding at all: the site is still answering, which is this endpoint's
  // first question. It must not turn a reporting gap into a claimed outage.
  const r = await healthReport({});
  assert("KV binding missing -> 200, live, with the reason stated", {
    httpStatus: r.httpStatus, site: r.body.site, hasError: typeof r.body.error === "string",
  }, { httpStatus: 200, site: "live", hasError: true });
}

// --- 2. last attempt, and whether it worked ---------------------------------

{
  const env = fakeKv({ weather: { updated: ISO(0), periods: [1] }, water: { updated: ISO(0), gauges: [1] } });
  const run = cronRunRecorder();
  run.ok("weather");
  run.failed("water", new Error("NWPS 503"));
  await recordCronRun(env, run);

  const { body } = await healthReport(env);
  assert("a successful attempt reports ok:true and no error", {
    ok: body.feeds.weather.ok, hasError: "error" in body.feeds.weather, hasAttempt: !!body.feeds.weather.lastAttempt,
  }, { ok: true, hasError: false, hasAttempt: true });

  assert("a failed attempt reports ok:false and the upstream error", {
    ok: body.feeds.water.ok, error: body.feeds.water.error,
  }, { ok: false, error: "NWPS 503" });

  assert("cronLastRun records the tick itself", typeof body.cronLastRun, "string");
}

{
  // Throttled feeds (calendar/tropics/pollen ~hourly to ~6h) fetch on only some
  // ticks. "Last time it tried" must survive the ticks where it did not try —
  // neither blanked nor silently bumped to now.
  const env = fakeKv({ calendar: { updated: ISO(0), events: [1] } });
  const first = cronRunRecorder();
  first.ok("calendar");
  await recordCronRun(env, first);
  const attempted = (await healthReport(env)).body.feeds.calendar.lastAttempt;

  await new Promise((r) => setTimeout(r, 5));
  await recordCronRun(env, cronRunRecorder()); // a tick where calendar was throttled

  const after = (await healthReport(env)).body.feeds.calendar;
  assert("a throttled tick carries the previous attempt forward, unchanged", {
    lastAttempt: after.lastAttempt, ok: after.ok, movedToTick: after.lastAttempt === (await healthReport(env)).body.cronLastRun,
  }, { lastAttempt: attempted, ok: true, movedToTick: false });
}

// --- 3. when the data actually changed --------------------------------------
//
// The reason this endpoint exists in its current form. /pollen served the same
// count for three business days: every fetch succeeded, every write succeeded,
// and the KV entry's `updated` stamp advanced every two hours the whole time.

{
  const env = fakeKv();
  const count = { countDate: "2026-08-03", groups: { tree: { category: "Low" } } };

  // Tick 1 — first sighting. Seeds from the entry's own write stamp.
  env.store.set("pollen", JSON.stringify({ updated: ISO(4 * 3600_000), ...count }));
  const t1 = cronRunRecorder(); t1.ok("pollen");
  await recordCronRun(env, t1);
  const first = (await healthReport(env)).body.feeds.pollen;

  // Tick 2 — the failure mode. A successful refresh re-stores the IDENTICAL
  // count under a brand-new `updated` stamp.
  await new Promise((r) => setTimeout(r, 5));
  env.store.set("pollen", JSON.stringify({ updated: ISO(0), ...count }));
  const t2 = cronRunRecorder(); t2.ok("pollen");
  await recordCronRun(env, t2);
  const frozen = (await healthReport(env)).body.feeds.pollen;

  assert("a refresh that re-stores identical content does NOT move dataChangedAt", {
    changed: frozen.dataChangedAt === first.dataChangedAt,
    attemptMoved: frozen.lastAttempt !== first.lastAttempt,
    ok: frozen.ok,
  }, { changed: true, attemptMoved: true, ok: true });

  // Tick 3 — a genuinely new count.
  const landed = ISO(0);
  env.store.set("pollen", JSON.stringify({ updated: landed, countDate: "2026-08-06", groups: { tree: { category: "High" } } }));
  const t3 = cronRunRecorder(); t3.ok("pollen");
  await recordCronRun(env, t3);
  const moved = (await healthReport(env)).body.feeds.pollen;

  assert("new content moves dataChangedAt to when that content landed", {
    dataChangedAt: moved.dataChangedAt, differsFromFrozen: moved.dataChangedAt !== frozen.dataChangedAt,
  }, { dataChangedAt: landed, differsFromFrozen: true });
}

{
  // `news` is written out-of-band by a Claude routine, so nothing ever records a
  // fetch attempt for it — but its content is fingerprinted like any other feed,
  // which is the only reason a stalled routine is visible at all.
  const env = fakeKv({ news: { updated: ISO(6 * 3600_000), items: [{ title: "A" }] } });
  await recordCronRun(env, cronRunRecorder());
  const seeded = (await healthReport(env)).body.feeds.news;

  env.store.set("news", JSON.stringify({ updated: ISO(0), items: [{ title: "A" }, { title: "B" }] }));
  await recordCronRun(env, cronRunRecorder());
  const after = (await healthReport(env)).body.feeds.news;

  assert("news: no attempt is ever recorded, but its content changes are", {
    lastAttempt: after.lastAttempt, ok: after.ok, tracksChange: after.dataChangedAt !== seeded.dataChangedAt,
  }, { lastAttempt: null, ok: null, tracksChange: true });
}

{
  // An unreadable entry must not be mistaken for a change. Corrupt JSON makes
  // .get(k,"json") throw; the last known change stamp has to survive that.
  const env = fakeKv({ traffic: { updated: ISO(0), incidents: [], closures: [] } });
  await recordCronRun(env, cronRunRecorder());
  const before = (await healthReport(env)).body.feeds.traffic.dataChangedAt;

  env.store.set("traffic", "{not json");
  await recordCronRun(env, cronRunRecorder());
  const after = (await healthReport(env)).body.feeds.traffic.dataChangedAt;

  assert("a corrupt entry leaves the last change stamp alone", { before: !!before, after }, { before: true, after: before });
}

// --- the published contract must match what is actually emitted --------------
//
// /openapi.json is the machine-readable description of this endpoint. Nothing
// forces the two to agree, and a spec that quietly drifts is worse than no spec:
// a client generator will build against the lie.
{
  const spec = openApiSpec();
  const sc = spec.components.schemas;
  const deref = (x) => (x && x.$ref ? sc[x.$ref.split("/").pop()] : x);
  const problems = [];

  function walk(path, schema, value) {
    schema = deref(schema);
    if (!schema || value == null || typeof value !== "object" || Array.isArray(value)) return;
    const props = schema.properties || {};
    const open = schema.additionalProperties;
    for (const k of Object.keys(value)) {
      const sub = props[k] ?? (open && typeof open === "object" ? open : null);
      if (!sub) {
        if (open !== true) problems.push(`${path}.${k} is emitted but not documented`);
        continue;
      }
      const d = deref(sub);
      if (d?.enum && value[k] != null && !d.enum.includes(value[k])) {
        problems.push(`${path}.${k} = ${JSON.stringify(value[k])} is outside the documented enum ${JSON.stringify(d.enum)}`);
      }
      walk(`${path}.${k}`, sub, value[k]);
    }
  }

  // A populated report and a bare one, so fields that appear on only one path
  // (a feed `error`, the top-level `error`) are both covered.
  const populated = fakeKv({ water: { updated: ISO(0), gauges: [1] } });
  const run = cronRunRecorder();
  run.failed("water", new Error("NWPS 503"));
  await recordCronRun(populated, run);

  for (const [label, env] of [["populated", populated], ["no binding", {}]]) {
    const { body } = await healthReport(env);
    walk(`Health(${label})`, sc.Health, body);
  }

  if (problems.length) { failures++; problems.forEach((p) => console.log(`  FAIL  schema: ${p}`)); }
  else console.log("  PASS  every emitted field is documented in /openapi.json");
}

console.log(
  failures
    ? `\n${failures} health check(s) FAILED\n`
    : `\nHealth endpoint OK — live, per-feed attempts, and real content-change stamps.\n`,
);
process.exit(failures ? 1 : 0);
