// Exercise the aggregate MCP usage counters, with a stubbed KV.
//
// Three things here fail SILENTLY in production, which is why they are pinned:
//
//   1. Classification. mcpHandle returns null for a valid notification AND for
//      a malformed message with no id, and returns a NON-null object for a
//      tools/call with `id: null`. Anything that keys off `m.id` scores garbage
//      input as success and never says so. So the tests below push real
//      messages through the REAL mcpHandle and classify what actually comes back.
//   2. Idempotency of the rollup. KV deletes are eventually consistent, so a
//      folded shard can keep appearing in list() for up to a minute. If the
//      `rolledUpThrough` mark is not doing its job, the next tick folds it again
//      and every number quietly doubles.
//   3. Cardinality. `method` and `params.name` are attacker-controlled strings.
//      Unbounded, they grow the durable record forever, and nothing complains.
//
// Run: node scripts/test-mcp-metrics.mjs

import { mcpHandle } from "../src/mcp/server.js";
import { routeRequest } from "../src/router.js";
import {
  classify,
  mcpUsageHtml,
  mcpRecord,
  mcpBatchRecorded,
  MCP_UNIMPLEMENTED_METHODS,
  mcpRollUp,
  mcpUsageReport,
  mcpUsageText,
  mergeInto,
  bucketOf,
  dayOf,
  lastNDays,
  MCP_METRICS_KV_KEY,
  MCP_SHARD_PREFIX,
} from "../src/mcp/metrics.js";

const BUCKET_MS = 10 * 60 * 1000;

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

// A KV stub that stores strings like the real one, and counts operations so a
// test can assert that a quiet tick writes NOTHING.
function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  const ops = { put: 0, get: 0, del: 0, list: 0 };
  return {
    store,
    ops,
    MCP_METRICS: "on",
    ADMIN_KEY: "test",
    WEATHER: {
      get: async (key, type) => {
        ops.get++;
        const raw = store.get(key);
        if (raw === undefined) return null;
        return type === "json" ? JSON.parse(raw) : raw;
      },
      put: async (key, value) => {
        ops.put++;
        store.set(key, value);
      },
      delete: async (key) => {
        ops.del++;
        store.delete(key);
      },
      list: async ({ prefix } = {}) => {
        ops.list++;
        return {
          keys: [...store.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((name) => ({ name })),
          list_complete: true,
          cursor: null,
        };
      },
    },
  };
}

// Format an arbitrary UTC instant as a bucket token. Deliberately NOT bucketOf:
// these tests need buckets at a chosen age, not snapped to the live grid.
function bucketToken(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}
// A bucket whose window ENDED roughly `agoMs` ago.
const bucketEndingAgo = (agoMs) => bucketToken(Date.now() - agoMs - BUCKET_MS);

// Address day buckets through the REAL dayOf: a second implementation here was
// UTC while production moved to Central, so every lookup missed after 7pm
// local. Central-correctness is pinned separately, against fixed timestamps.
const day = (msAgo = 0) => dayOf(Date.now() - msAgo);

function shard(days, at = new Date().toISOString()) {
  return { v: 1, at, days };
}
function oneDay(fields) {
  return {
    total: 0,
    batches: 0,
    methods: {},
    tools: {},
    outcomes: {},
    codes: {},
    clients: {},
    toolMs: {},
    ...fields,
  };
}

// --- 1. classification, driven through the real dispatcher ------------------

console.log("\nclassification (real mcpHandle):\n");
{
  // Every case below is chosen to reach a verdict WITHOUT a KV read or a
  // network call, so this runs offline and deterministically in CI. The loaders
  // deliberately degrade to an empty shape rather than throwing (see
  // loadPollen), so no upstream failure reaches the isError branch — that shape
  // is asserted separately, just below.
  const env = { WEATHER: { get: async () => null, put: async () => {} } };

  const cases = [
    ["initialize", { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "Claude-AI" } } }, "initialize", null, "ok", null, "claude-ai"],
    ["ping", { jsonrpc: "2.0", id: 2, method: "ping" }, "ping", null, "ok", null, null],
    ["tools/list", { jsonrpc: "2.0", id: 3, method: "tools/list" }, "tools/list", null, "ok", null, null],
    ["prompts/list", { jsonrpc: "2.0", id: 4, method: "prompts/list" }, "prompts/list", null, "ok", null, null],
    ["resources/list", { jsonrpc: "2.0", id: 5, method: "resources/list" }, "resources/list", null, "ok", null, null],
    ["resources/read unknown uri", { jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri: "nope" } }, "resources/read", null, "rpc_error", "-32602", null],
    ["prompts/get unknown name", { jsonrpc: "2.0", id: 7, method: "prompts/get", params: { name: "nope" } }, "prompts/get", null, "rpc_error", "-32602", null],
    ["unknown method", { jsonrpc: "2.0", id: 8, method: "no/such/method" }, "(other)", null, "rpc_error", "-32601", null],
    ["notification", { jsonrpc: "2.0", method: "notifications/initialized" }, "notifications/initialized", null, "notification", null, null],
    ["unimplemented spec request", { jsonrpc: "2.0", id: 13, method: "completion/complete" }, "completion/complete", null, "rpc_error", "-32601", null],
    ["resources/templates/list", { jsonrpc: "2.0", id: 14, method: "resources/templates/list" }, "resources/templates/list", null, "ok", null, null],
    // 2026-07-28: the client name rides in _meta on server/discover.
    ["modern server/discover", { jsonrpc: "2.0", id: 15, method: "server/discover", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "Example-Client" }, "io.modelcontextprotocol/clientCapabilities": {} } } }, "server/discover", null, "ok", null, "example-client"],
    ["unknown tool", { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "no_such_tool" } }, "tools/call", "(unknown)", "rpc_error", "-32602", null],
    ["real tool, no KV needed", { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "get_emergency_contacts" } }, "tools/call", "get_emergency_contacts", "ok", null, null],
    // The trap: a non-null response that is NOT a request.
    ["tools/call with id:null", { jsonrpc: "2.0", id: null, method: "tools/call", params: { name: "get_emergency_contacts" } }, "tools/call", "get_emergency_contacts", "ok", null, null],
    // The other trap: no response, but not a notification either.
    ["malformed, no id", { method: "tools/call" }, "(invalid)", null, "rpc_error", "-32600", null],
    ["malformed, wrong version", { jsonrpc: "1.0", id: 12, method: "ping" }, "(invalid)", null, "rpc_error", "-32600", null],
    ["nested array in a batch", [], "(invalid)", null, "rpc_error", "-32600", null],
  ];

  for (const [label, msg, method, tool, outcome, code, client] of cases) {
    const r = await mcpHandle(msg, env);
    const c = classify(msg, r, 5);
    assert(label, { method: c.method, tool: c.tool, outcome: c.outcome, code: c.code, client: c.client }, { method, tool, outcome, code, client });
  }

  // The isError shape, verbatim from mcpCallTool's catch (src/mcp/server.js):
  // an unexpected throw becomes a SUCCESSFUL JSON-RPC result carrying
  // isError, not a JSON-RPC error. Counting only the error object would miss it.
  const isErr = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Error: boom" }], isError: true } };
  const ce = classify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_forecast" } }, isErr, 12);
  assert("isError result counts as a tool error", { outcome: ce.outcome, tool: ce.tool }, { outcome: "tool_error", tool: "get_forecast" });

  // The 2026-07-28 rejection codes are counted by name, not as "(other)".
  for (const code of [-32020, -32021, -32022]) {
    const cx = classify({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { jsonrpc: "2.0", id: 1, error: { code, message: "x" } }, 0);
    assert(`${code} is recorded by name`, cx.code, String(code));
  }
}

// --- 2. cardinality is bounded ----------------------------------------------

console.log("\ncardinality:\n");
{
  const methods = new Set();
  for (let i = 0; i < 1000; i++) {
    methods.add(classify({ jsonrpc: "2.0", id: i, method: `junk/${i}` }, { error: { code: -32601 } }, 1).method);
  }
  assert("1000 distinct junk methods collapse to one bucket", [...methods], ["(other)"]);

  // Every method the MCP spec defines, for BOTH protocol versions this server
  // advertises, must be recorded under its own name — a spec method collapsed
  // into "(other)" is indistinguishable from junk, which defeats the point of
  // recording it. Pinned verbatim against the schema at
  // github.com/modelcontextprotocol/modelcontextprotocol/schema/{2025-03-26,2025-06-18,2025-11-25,2026-07-28}.
  const SPEC_METHODS = [
    "initialize", "ping", "tools/list", "tools/call",
    "prompts/list", "prompts/get",
    "resources/list", "resources/read", "resources/templates/list",
    "resources/subscribe", "resources/unsubscribe",
    "completion/complete", "logging/setLevel",
    "elicitation/create", "roots/list", "sampling/createMessage",
    "notifications/initialized", "notifications/cancelled", "notifications/progress",
    "notifications/message", "notifications/roots/list_changed",
    "notifications/prompts/list_changed", "notifications/resources/list_changed",
    "notifications/resources/updated", "notifications/tools/list_changed",
    // 2025-11-25
    "tasks/get", "tasks/list", "tasks/result", "tasks/cancel",
    "notifications/elicitation/complete", "notifications/tasks/status",
    // 2026-07-28, and its tasks extension's tasks/update
    "server/discover", "subscriptions/listen", "notifications/subscriptions/acknowledged",
    "tasks/update",
  ];
  const collapsed = SPEC_METHODS.filter(
    (m) => classify({ jsonrpc: "2.0", id: 1, method: m }, { result: {} }, 1).method !== m,
  );
  assert("every spec method is recorded by name", collapsed, []);
  assert("the spec list is the full 35", SPEC_METHODS.length, 35);

  // ...and the unimplemented-request split is a subset of it, so the report
  // cannot name something the allow-list would have dropped.
  const strays = [...MCP_UNIMPLEMENTED_METHODS].filter((m) => !SPEC_METHODS.includes(m));
  assert("unimplemented set is all spec methods", strays, []);
  assert("notifications are not counted as gaps", MCP_UNIMPLEMENTED_METHODS.has("notifications/initialized"), false);

  const huge = classify(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x".repeat(1024 * 1024) } },
    { result: {} },
    1,
  );
  assert("a 1 MB tool name is not stored", huge.tool, "(unknown)");

  const weird = classify(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "Ac/me Corp<script>" } } },
    { result: {} },
    1,
  );
  assert("client name is sanitised, not stored raw", weird.client, "acmecorpscript");

  const codes = new Set();
  for (const c of [-1, 0, 42, 999]) codes.add(classify({ jsonrpc: "2.0", id: 1, method: "ping" }, { error: { code: c } }, 1).code);
  assert("unrecognised error codes collapse", [...codes], ["(other)"]);

  // Storage and display are separate concerns and must stay that way: the cap
  // exists so a caller-controlled name cannot grow the record without bound,
  // while the phone report stays readable. Raising one must not silently
  // change the other.
  {
    const many = {};
    for (let i = 0; i < 400; i++) many[`client-${i}`] = 400 - i;
    const report = {
      checkedAt: "now", since: null, rolledUpThrough: null, pending: { shards: 0, calls: 0 },
      today: { calls: 0, ok: 0, notifications: 0, rpcErrors: 0, toolErrors: 0 },
      last7Days: { calls: 0, ok: 0, notifications: 0, rpcErrors: 0, toolErrors: 0 },
      lifetime: { calls: 0, ok: 0, notifications: 0, rpcErrors: 0, toolErrors: 0 },
      tools: { last7Days: [], lifetime: [] },
      methods: { last7Days: {}, lifetime: {} },
      errorCodes: { last7Days: {}, lifetime: {} },
      clients: { last7Days: {}, lifetime: many },
      unimplementedRequested: { last7Days: {}, lifetime: {} },
      days: {}, months: {}, rollup: { at: null, ok: true, shards: 0, error: null },
    };
    const lines = mcpUsageText(report).split("\n");
    const shown = lines.filter((l) => /^ {2}client-\d+ /.test(l)).length;
    assert("the report prints every client", shown, 400);
    assert("...with the count in the heading", lines.includes("clients, lifetime (400)"), true);
    const widest = Math.max(...lines.map((l) => l.length));
    assert("...and still fits a phone terminal", widest <= 60, true);

    const week = {};
    for (let i = 0; i < 60; i++) week[`wk-${i}`] = 60 - i;
    week["one-call-today"] = 1;
    const wl = mcpUsageText({ ...report, clients: { last7Days: week, lifetime: many } }).split("\n");
    assert("a 7-day client block precedes the lifetime one", wl.findIndex((l) => l.startsWith("clients, 7 days")) < wl.findIndex((l) => l.startsWith("clients, lifetime")), true);
    assert("...and shows every client of the week", wl.filter((l) => /^ {2}wk-\d+ /.test(l)).length, 60);
    assert("...including one that called once", wl.some((l) => l.startsWith("  one-call-today ")), true);
    const tl = mcpUsageText({ ...report, tools: { last7Days: [{ name: "get_forecast", calls: 3, ms: 30 }], lifetime: [] } }).split("\n");
    assert("every tool is listed, called or not", tl.filter((l) => /^ get_[a-z_]+ /.test(l)).length >= 30, true);
    assert("the tried-names section is always present", tl.some((l) => l.startsWith("tool names tried, not found, 7 days")) && tl.some((l) => l.startsWith("  none since ")), true);
    const html = mcpUsageHtml("a <b>&\n" + "x".repeat(50));
    assert("the browser page escapes the text", html.includes("a &lt;b&gt;&amp;") && !html.includes("<b>"), true);
    assert("...sizes the font from the widest line (50 cols * 0.62)", html.includes("/ 31.0))"), true);
    assert("...and fits the phone width", html.includes("width=device-width"), true);
    assert("...a never-called tool shows 0", tl.some((l) => /^ get_pollen\s+0\s+0\s+-\s+-\s+-$/.test(l)), true);
    assert("...every method and code is listed, used or not", tl.some((l) => l.startsWith("  resources/subscribe ")) && tl.some((l) => l.startsWith("  -32021 missing client capability")), true);
    const big = mcpUsageText({ ...report, lifetime: { calls: 205539, ok: 145165, notifications: 55557, rpcErrors: 4813, toolErrors: 4 } }).split("\n").find((l) => l.startsWith("lifetime"));
    assert("big lifetime totals keep their columns apart", /205539\s+145165\s+55557/.test(big), true);
    assert("...within a phone terminal", Math.max(...mcpUsageText(report).split("\n").map((l) => l.length)) <= 60, true);
  }
}

// --- 3. the rollup ----------------------------------------------------------

console.log("\nrollup:\n");
{
  // A closed bucket folds; the still-open one does not.
  const closed = bucketEndingAgo(30 * 60000);
  const open = bucketOf(Date.now());
  const env = fakeKv({
    [`${MCP_SHARD_PREFIX}${closed}:aaaaaaaa`]: shard({ [day()]: oneDay({ total: 4, batches: 1, methods: { "tools/call": 4 }, tools: { get_forecast: 4 }, outcomes: { ok: 4 }, toolMs: { get_forecast: 400 } }) }),
    [`${MCP_SHARD_PREFIX}${open}:bbbbbbbb`]: shard({ [day()]: oneDay({ total: 7, batches: 2, methods: { ping: 7 }, outcomes: { ok: 7 } }) }),
  });

  await mcpRollUp(env);
  const rec = JSON.parse(env.store.get(MCP_METRICS_KV_KEY));
  assert("folds the closed bucket only", rec.days[day()].total, 4);
  assert("lifetime accumulates", rec.lifetime.total, 4);
  assert("mark advances to the folded bucket", rec.rolledUpThrough, closed);
  assert("folded shard is deleted", env.store.has(`${MCP_SHARD_PREFIX}${closed}:aaaaaaaa`), false);
  assert("open shard is left alone", env.store.has(`${MCP_SHARD_PREFIX}${open}:bbbbbbbb`), true);

  // ...and the open shard is still counted by the reader, so nothing is lost
  // in the window between being written and being folded.
  const report = await mcpUsageReport(env);
  assert("reader sees folded + pending", report.today.calls, 11);
  assert("reader reports the pending shard", report.pending.shards, 1);

  // A second tick with no new traffic must not write, and must not double-count.
  const before = JSON.stringify(rec);
  const puts = env.ops.put;
  await mcpRollUp(env);
  assert("a quiet tick writes nothing", env.ops.put - puts, 0);
  assert("a quiet tick changes nothing", env.store.get(MCP_METRICS_KV_KEY), before);
}

{
  // THE DOUBLE-COUNT CASE. A delete that did not stick: the shard is still
  // visible in list() after being folded. Only `rolledUpThrough` prevents it
  // being counted a second time.
  const closed = bucketEndingAgo(30 * 60000);
  const key = `${MCP_SHARD_PREFIX}${closed}:cccccccc`;
  const payload = shard({ [day()]: oneDay({ total: 5, outcomes: { ok: 5 } }) });
  const env = fakeKv({ [key]: payload });

  await mcpRollUp(env);
  const once = JSON.parse(env.store.get(MCP_METRICS_KV_KEY)).days[day()].total;

  env.store.set(key, JSON.stringify(payload)); // the stale copy reappears
  await mcpRollUp(env);
  const twice = JSON.parse(env.store.get(MCP_METRICS_KV_KEY)).days[day()].total;

  assert("a re-listed shard is not folded twice", [once, twice], [5, 5]);
  assert("the stale copy is deleted again", env.store.has(key), false);
}

{
  // A corrupt shard must be skipped, not abort the whole fold.
  const b = bucketEndingAgo(30 * 60000);
  const env = fakeKv({
    [`${MCP_SHARD_PREFIX}${b}:dddddddd`]: { v: 1, at: new Date().toISOString(), nonsense: true },
    [`${MCP_SHARD_PREFIX}${b}:eeeeeeee`]: shard({ [day()]: oneDay({ total: 3, outcomes: { ok: 3 } }) }),
  });
  await mcpRollUp(env);
  const rec = JSON.parse(env.store.get(MCP_METRICS_KV_KEY));
  assert("corrupt shard skipped, good one folded", rec.days[day()].total, 3);
  assert("corrupt shard still cleaned up", env.store.has(`${MCP_SHARD_PREFIX}${b}:dddddddd`), false);
}

{
  // Retention: 90 days of detail, older days folded into months, lifetime intact.
  const days = {};
  // Step back from midday, not from now. A Central day is 25 hours when
  // daylight time ends, so 24-hour steps taken from 11 PM land twice on one
  // date, two seeded days share a key, and a count goes missing from the seed.
  const midday = Date.parse(`${day()}T18:00:00Z`);
  for (let i = 1; i <= 95; i++) days[dayOf(midday - i * 86400000)] = oneDay({ total: 1, outcomes: { ok: 1 } });
  const seeded = { v: 1, rolledUpThrough: "", lifetime: oneDay({ total: 95, outcomes: { ok: 95 } }), months: {}, days, rollup: {} };
  const b = bucketEndingAgo(30 * 60000);
  const env = fakeKv({
    [MCP_METRICS_KV_KEY]: seeded,
    [`${MCP_SHARD_PREFIX}${b}:ffffffff`]: shard({ [day()]: oneDay({ total: 2, outcomes: { ok: 2 } }) }),
  });

  await mcpRollUp(env);
  const rec = JSON.parse(env.store.get(MCP_METRICS_KV_KEY));
  assert("daily detail is trimmed to 90 days", Object.keys(rec.days).length, 90);
  assert("trimmed days survive as months", Object.keys(rec.months).length > 0, true);
  assert("lifetime is not trimmed", rec.lifetime.total, 97);

  const monthTotal = Object.values(rec.months).reduce((n, m) => n + m.total, 0);
  const dayTotal = Object.values(rec.days).reduce((n, d) => n + d.total, 0);
  assert("no count is lost in the trim", monthTotal + dayTotal, 97);
}

// --- 3b. days are CENTRAL, not UTC ------------------------------------------

// The header renders Central via centralStamp, so a UTC day bucket makes
// "today" roll over at 7pm local and read as near-empty all evening. That is
// what shipped first, and it is invisible unless you look after 7pm.
console.log("\ncalendar days:\n");
{
  // 2026-09-21T02:00Z is 2026-09-20 21:00 CDT — the window where the two
  // disagree, which is exactly when the bug showed.
  assert("an evening instant keys to the Central day", dayOf(Date.parse("2026-09-21T02:00:00Z")), "2026-09-20");
  // ...and before 7pm local the two agree, so this is not an off-by-one.
  assert("an afternoon instant is unchanged", dayOf(Date.parse("2026-09-20T18:00:00Z")), "2026-09-20");
  // CST (winter, UTC-6): 2026-01-15T05:00Z is 2026-01-14 23:00 CST.
  assert("works in CST as well as CDT", dayOf(Date.parse("2026-01-15T05:00:00Z")), "2026-01-14");

  // A Central day is 23 or 25 hours on the DST shift dates, so stepping back
  // by a fixed 86400000 from the current instant repeats or skips a day there.
  const fallBack = lastNDays(4, Date.parse("2026-11-02T18:00:00Z")); // DST ended Nov 1
  assert("no repeated day across the fall-back shift", new Set(fallBack).size, 4);
  assert("...and the dates are consecutive", fallBack, ["2026-11-02", "2026-11-01", "2026-10-31", "2026-10-30"]);

  const springFwd = lastNDays(4, Date.parse("2026-03-09T18:00:00Z")); // DST began Mar 8
  assert("no skipped day across the spring-forward shift", springFwd, ["2026-03-09", "2026-03-08", "2026-03-07", "2026-03-06"]);
}

// --- 4. merge arithmetic ----------------------------------------------------

console.log("\nmerge:\n");
{
  const a = { "2026-09-20": oneDay({ total: 2, methods: { ping: 2 }, tools: { get_pollen: 1 }, toolMs: { get_pollen: 50 } }) };
  const b = { "2026-09-20": oneDay({ total: 3, methods: { ping: 1, "tools/call": 2 }, tools: { get_pollen: 2 }, toolMs: { get_pollen: 70 } }), "2026-09-21": oneDay({ total: 1 }) };
  const merged = mergeInto(mergeInto({}, a), b);
  assert("totals add", merged["2026-09-20"].total, 5);
  assert("nested counters add", merged["2026-09-20"].methods, { ping: 3, "tools/call": 2 });
  assert("durations add", merged["2026-09-20"].toolMs, { get_pollen: 120 });
  assert("new days appear", merged["2026-09-21"].total, 1);
  assert("merge does not mutate its source", a["2026-09-20"].total, 2);
}

// --- 5. the text renderer ---------------------------------------------------

console.log("\ntext rendering:\n");
{
  const env = fakeKv({
    [MCP_METRICS_KV_KEY]: {
      v: 1,
      rolledUpThrough: bucketEndingAgo(30 * 60000),
      firstSeen: new Date(Date.now() - 5 * 86400000).toISOString(),
      lifetime: oneDay({ total: 12, methods: { "tools/call": 9, "notifications/initialized": 3 }, tools: { get_forecast: 9 }, outcomes: { ok: 8, notification: 3, rpc_error: 1 }, codes: { "-32602": 1 }, clients: { "claude-ai": 3 }, toolMs: { get_forecast: 900 } }),
      months: {},
      days: { [day()]: oneDay({ total: 12, methods: { "tools/call": 9, "notifications/initialized": 3 }, tools: { get_forecast: 9 }, outcomes: { ok: 8, notification: 3, rpc_error: 1 }, codes: { "-32602": 1 }, clients: { "claude-ai": 3 }, toolMs: { get_forecast: 900 } }) },
      rollup: { at: new Date().toISOString(), ok: true, shards: 1, error: null },
    },
  });
  const text = mcpUsageText(await mcpUsageReport(env));
  const widest = Math.max(...text.split("\n").map((l) => l.length));
  assert("fits a phone terminal (<= 60 cols)", widest <= 60, true);
  assert("names the busiest tool", text.includes("get_forecast"), true);
  assert("reports the error code", text.includes("-32602"), true);
  assert("states the privacy position", text.includes("No caller identity"), true);

  // The owner added the columns by hand and they came up short: notifications
  // were a fourth outcome class with no column, so the row did not equal its
  // own total. Pin it — a table that fails the reader's arithmetic reads as a
  // counting bug.
  for (const row of ["today", "7 days", "lifetime"]) {
    const line = text.split("\n").find((l) => l.startsWith(row));
    const n = line.slice(10).trim().split(/\s+/).map(Number);
    assert(`"${row}" columns sum to its own total`, n.slice(1).reduce((a, b) => a + b, 0), n[0]);
  }
}

// --- 5b. an unimplemented spec request is surfaced as a gap -----------------

console.log("\nunimplemented requests:\n");
{
  const env = fakeKv({
    [MCP_METRICS_KV_KEY]: {
      v: 1,
      rolledUpThrough: bucketEndingAgo(30 * 60000),
      firstSeen: new Date(Date.now() - 86400000).toISOString(),
      lifetime: oneDay({
        total: 9,
        // a real client probing a capability we lack, a correct notification,
        // and ordinary traffic — only the first is a gap
        methods: { "completion/complete": 4, "notifications/initialized": 3, "tools/list": 2 },
        outcomes: { rpc_error: 4, notification: 3, ok: 2 },
        codes: { "-32601": 4 },
      }),
      months: {},
      days: {
        [day()]: oneDay({
          total: 9,
          methods: { "completion/complete": 4, "notifications/initialized": 3, "tools/list": 2 },
          outcomes: { rpc_error: 4, notification: 3, ok: 2 },
          codes: { "-32601": 4 },
        }),
      },
      rollup: { at: new Date().toISOString(), ok: true, shards: 1, error: null },
    },
  });
  const report = await mcpUsageReport(env);
  assert("the gap is named with its count", report.unimplementedRequested.lifetime, { "completion/complete": 4 });
  assert("a correct notification is not a gap", "notifications/initialized" in report.unimplementedRequested.lifetime, false);
  assert("an implemented method is not a gap", "tools/list" in report.unimplementedRequested.lifetime, false);

  const text = mcpUsageText(report);
  assert("the text report calls it out", text.includes("asked for, NOT implemented, lifetime"), true);
  assert("...and names it", text.includes("completion/complete"), true);
  const widest = Math.max(...text.split("\n").map((l) => l.length));
  assert("still fits a phone terminal", widest <= 60, true);
}

// --- 6. an empty install does not explode -----------------------------------

console.log("\ncold start:\n");
{
  const env = fakeKv();
  await mcpRollUp(env);
  assert("no shards, no durable write", env.ops.put, 0);
  const report = await mcpUsageReport(env);
  assert("reports zero rather than failing", report.lifetime.calls, 0);
  assert("renders with no data", mcpUsageText(report).includes("tools, 7 days ("), true);
}

// --- 7. the request path ----------------------------------------------------

// The behaviour the whole flush policy exists for: a burst of messages must
// collapse into ONE shard write, not one per message. Per-request flushing with
// a floor would write on the first message and strand the rest, because nothing
// arrives afterwards to trigger them and the isolate is then evicted.
//
// This is the only case that exercises the real debounce, so it pays its ~3s.
console.log("\nrequest path:\n");
{
  const env = fakeKv();
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };

  const session = [
    [{ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "claude-ai" } } }, { result: {} }],
    [{ jsonrpc: "2.0", method: "notifications/initialized" }, null],
    [{ jsonrpc: "2.0", id: 2, method: "tools/list" }, { result: {} }],
    [{ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_forecast" } }, { result: {} }],
    [{ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_pollen" } }, { result: {} }],
    [{ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_forecast" } }, { result: {} }],
    [{ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope" } }, { error: { code: -32602 } }],
    [{ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "Get_Forecast<x>" } }, { error: { code: -32602 } }],
    [{ jsonrpc: "2.0", id: 7, method: "no/such" }, { error: { code: -32601 } }],
  ];
  // The write lands a few seconds later, so a run that starts just before a
  // bucket boundary can land in the next bucket; either one is current.
  const bucketBefore = bucketOf(Date.now());
  for (const [m, r] of session) mcpRecord(env, ctx, m, r, 20);
  mcpBatchRecorded(env, ctx);

  await Promise.all(pending);
  const bucketAfter = bucketOf(Date.now());

  const shards = [...env.store.keys()].filter((k) => k.startsWith(MCP_SHARD_PREFIX));
  assert("a burst of 9 messages writes ONE shard", shards.length, 1);
  assert("shard key is mcpm:<bucket>:<shard>", /^mcpm:\d{8}-\d{4}:[0-9a-f]{8}$/.test(shards[0]), true);
  assert("the bucket is the current one", [bucketBefore, bucketAfter].includes(shards[0]?.split(":")[1]), true);

  const v = JSON.parse(env.store.get(shards[0]));
  const d = v.days[day()];
  assert("every message counted", d.total, 9);
  assert("the POST counted once", d.batches, 1);
  // notifications/initialized is a spec method, so it is named rather than
  // lumped in; only the genuinely unknown "no/such" lands in "(other)".
  assert("methods tallied", d.methods, {
    initialize: 1,
    "notifications/initialized": 1,
    "tools/list": 1,
    "tools/call": 5,
    "(other)": 1,
  });
  assert("tools tallied", d.tools, { get_forecast: 2, get_pollen: 1, "(unknown)": 2 });
  // initialize, tools/list and three tools/call succeed; one notification; two
  // rpc errors (unknown tool, unknown method).
  assert("outcomes tallied", d.outcomes, { ok: 5, notification: 1, rpc_error: 3 });
  assert("error codes tallied", d.codes, { "-32602": 2, "-32601": 1 });
  assert("client recorded", d.clients, { "claude-ai": 1 });
  assert("durations summed per tool", d.toolMs, { get_forecast: 40, get_pollen: 20, "(unknown)": 40 });

  assert("outcomes tallied per method", d.methodOutcomes, {
    "initialize|ok": 1,
    "notifications/initialized|notification": 1,
    "tools/list|ok": 1,
    "tools/call|ok": 3,
    "tools/call|rpc_error": 2,
    "(other)|rpc_error": 1,
  });
  assert("outcomes tallied per tool", d.toolOutcomes, { "get_forecast|ok": 2, "get_pollen|ok": 1, "(unknown)|rpc_error": 2 });
  assert("20ms lands in the first latency bucket", d.toolLat, { "get_forecast|0": 2, "get_pollen|0": 1, "(unknown)|0": 2 });
  assert("tried tool names are kept as sent, sanitised", d.unknownTools, { nope: 1, "Get_Forecastx": 1 });

  // And the reader sees it before any rollup has run.
  const report = await mcpUsageReport(env);
  assert("unfolded shard is visible to the reader", report.today.calls, 9);
  const rf = report.tools.last7Days.find((t) => t.name === "get_forecast");
  assert("a tool reports errors and latency bounds", [rf.errors, rf.p95, rf.slowest], [0, "\u226425ms", "\u226425ms"]);
  assert("an unknown tool's rpc error is counted", report.tools.last7Days.find((t) => t.name === "(unknown)").errors, 2);
  assert("methods carry their outcomes", report.methodOutcomes.last7Days["tools/call"], { ok: 3, rpc_error: 2 });
  const tx = mcpUsageText(report).split("\n");
  assert("the text shows the per-tool row", tx.some((l) => /^ get_forecast\s+2\s+0\s+20ms\s+\u226425ms\s+\u226425ms$/.test(l)), true);
  assert("...and the per-method row", tx.some((l) => /^ tools\/call\s+5\s+3\s+0\s+2$/.test(l)), true);
  assert("the text lists what was tried", tx.some((l) => /^ {2}Get_Forecastx\s+1$/.test(l)) && tx.some((l) => /^ {2}nope\s+1$/.test(l)), true);
  assert("...within a phone terminal", Math.max(...tx.map((l) => l.length)) <= 60, true);
}

// --- 8. latency percentiles and the client mix ------------------------------

console.log("\nlatency and client mix:\n");
{
  const env = fakeKv({
    [MCP_METRICS_KV_KEY]: {
      v: 1,
      rolledUpThrough: bucketEndingAgo(30 * 60000),
      firstSeen: new Date(Date.now() - 86400000).toISOString(),
      lifetime: oneDay({
        total: 100,
        tools: { get_radar: 100 },
        toolMs: { get_radar: 9000 },
        // 94 fast, 4 in <=500ms, 2 in the open-ended bucket: p95 is the 500ms
        // bucket (cumulative 98% there), the slowest is >2.5s
        toolLat: { "get_radar|1": 94, "get_radar|4": 4, "get_radar|7": 2 },
        toolOutcomes: { "get_radar|ok": 97, "get_radar|tool_error": 2, "get_radar|rpc_error": 1 },
        clients: { "glimind-probe": 5, "claude-code": 2, "agentic-registry": 4, "(other)": 3 },
      }),
      months: {},
      days: {},
      rollup: { at: new Date().toISOString(), ok: true, shards: 1, error: null },
    },
  });
  const report = await mcpUsageReport(env);
  const t = report.tools.lifetime[0];
  assert("p95 is the bucket where 95% is reached", t.p95, "\u2264500ms");
  assert("slowest is the highest populated bucket", t.slowest, ">2.5s");
  assert("errors are tool errors plus rpc errors", t.errors, 3);
  assert("client mix splits by kind", report.clientMix.lifetime.counts, { ours: 0, scanners: 0, "ai apps": 2, monitors: 5, registries: 4, other: 0, unnamed: 3 });
  assert("...names the busiest in each kind", report.clientMix.lifetime.examples.monitors, ["glimind-probe"]);
  const kinds = mcpUsageReport(fakeKv({
    [MCP_METRICS_KV_KEY]: {
      v: 1,
      rolledUpThrough: bucketEndingAgo(30 * 60000),
      firstSeen: new Date(Date.now() - 86400000).toISOString(),
      lifetime: oneDay({ clients: { "portscan": 1, "vulnhound": 1, "mcp-security-scanner": 1, "privi-scan": 1, "codex-mcp-client": 1, "mcpbeat": 5, "a-probe": 4, "b-probe": 3, "c-probe": 2, "talaria-catalog": 1, "crosbynews-verify": 4, "clono": 1 } }),
      months: {}, days: {}, rollup: { at: null, ok: null, shards: 0, error: null },
    },
  }));
  const kc = (await kinds).clientMix.lifetime.counts;
  assert("scanners, apps, monitors, registries, ours and the rest are told apart", kc, { ours: 4, scanners: 4, "ai apps": 1, monitors: 14, registries: 1, other: 1, unnamed: 0 });
  assert("only the three busiest names are listed per kind", (await kinds).clientMix.lifetime.examples.monitors, ["mcpbeat", "a-probe", "b-probe"]);
  assert("our own client is reported by name", (await kinds).ownClients, { "crosbynews-verify": { last7Days: 0, lifetime: 4 } });
}

// Tried tool names are caller-controlled and the set is open, so it must be
// capped like client names or a loop of random names grows the record.
{
  const env = fakeKv();
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  for (let i = 0; i < 120; i++) {
    mcpRecord(env, ctx, { jsonrpc: "2.0", id: i, method: "tools/call", params: { name: `junk_${i}` } }, { error: { code: -32602 } }, 5);
  }
  await Promise.all(pending);
  const shardKey = [...env.store.keys()].find((k) => k.startsWith(MCP_SHARD_PREFIX));
  const tried = JSON.parse(env.store.get(shardKey)).days[day()].unknownTools;
  assert("120 distinct tried names are capped at 50 plus (other)", Object.keys(tried).length, 51);
  assert("...and the overflow is counted in (other)", tried["(other)"] > 0, true);
  const probe = classify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x".repeat(200) } }, { error: { code: -32602 } }, 1);
  assert("a tried name is truncated to 40 characters", probe.attempted.length, 40);
  assert("a non-string name is not recorded as a name", classify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: 7 } }, { error: { code: -32602 } }, 1).attempted, null);
  assert("a name that sanitises to nothing is (other)", classify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "<>" } }, { error: { code: -32602 } }, 1).attempted, "(other)");
}

// The client cap keeps the busiest 500 names and folds the rest into "(other)".
{
  const env = fakeKv();
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  for (let i = 0; i < 700; i++) {
    mcpRecord(env, ctx, { jsonrpc: "2.0", id: i, method: "initialize", params: { clientInfo: { name: `cl${i}` } } }, { result: {} }, 1);
  }
  await Promise.all(pending);
  const key = [...env.store.keys()].find((k) => k.startsWith(MCP_SHARD_PREFIX));
  const clients = JSON.parse(env.store.get(key)).days[day()].clients;
  assert("700 distinct client names are capped at 500 plus (other)", Object.keys(clients).length, 501);
}

// The route serves the same report as plain text to a script and as a screen-
// fitted page to a browser.
console.log("\nroute content negotiation:\n");
{
  const env = { ADMIN_KEY: "k", WEATHER: { get: async () => null, list: async () => ({ keys: [], list_complete: true }) } };
  const get = (accept) =>
    routeRequest(new Request("https://crosbynews.com/api/mcp-usage?key=k&format=txt", { headers: { accept } }), env, { waitUntil() {} });
  const html = await get("text/html,application/xhtml+xml");
  assert("a browser gets HTML", html.headers.get("content-type"), "text/html; charset=utf-8");
  assert("...varying on Accept", html.headers.get("vary"), "Accept");
  assert("...and the page carries the report", (await html.text()).includes("crosbynews MCP usage"), true);
  const txt = await get("*/*");
  assert("a script still gets plain text", txt.headers.get("content-type"), "text/plain; charset=utf-8");
}

console.log(
  failures
    ? `\n${failures} MCP metrics check(s) FAILED\n`
    : `\nMCP metrics OK — classification, idempotent rollup, bounded cardinality, retention.\n`,
);
process.exit(failures ? 1 : 0);
