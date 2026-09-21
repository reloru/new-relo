// Aggregate usage counters for the MCP server at POST /mcp.
//
// The question this answers: is the MCP server used at all, which tools do
// callers actually reach for, and how often does a call fail. Nothing else.
//
// WHAT IS NEVER RECORDED: IP addresses, User-Agent, tool arguments, request or
// response bodies, any cross-request identifier, and any timestamp finer than
// the Central calendar day in the durable record. A shard entry holds COUNTS,
// not events, so no per-call row exists even transiently. The one thing
// recorded about a caller is `clientInfo.name` from `initialize` — a product
// name ("claude-ai", "cursor"), allow-list-shaped and capped, never a person.
//
// WHY THIS IS SHAPED THE WAY IT IS. Workers KV permits a maximum of one write
// per second to the same key, and concurrent writes to one key clobber each
// other last-write-wins. So the obvious implementation — one counter key, read,
// increment, write — is wrong twice over: it loses counts AND throws 429s.
// Instead every isolate owns its own key for a ten-minute bucket, and the cron
// folds closed buckets into one durable record. No two writers ever share a key.
//
// The shard value is CUMULATIVE for its bucket and is never cleared on flush.
// That is what makes the write idempotent: a failed put loses nothing, because
// the next put is a superset of it. There is consequently no read anywhere on
// the request path, and therefore nothing for a mutex to protect.

import { mcpTools } from "./server.js";
import { centralStamp } from "../lib/format.js";
import { ctDateStr } from "../features/air.js";

// The one durable key, flat alongside `cron_status`.
export const MCP_METRICS_KV_KEY = "mcp_metrics";
// Transient per-isolate shards: `mcpm:<bucket>:<shard>`. BUCKET FIRST, so a
// list() comes back in bucket order and the rollup can stop at the first key
// it must not touch yet. Shard-first would force a full scan and string-parse.
export const MCP_SHARD_PREFIX = "mcpm:";

const BUCKET_MIN = 10;
const BUCKET_MS = BUCKET_MIN * 60 * 1000;
// Collapse a burst into one write. A real MCP session is `initialize`, a
// notification, `tools/list` and a handful of `tools/call` inside two seconds,
// then silence — flushing per request would write once and strand the rest with
// no later request to carry them. waitUntil holds the invocation alive across
// the wait, so the isolate cannot be evicted mid-debounce.
const DEBOUNCE_MS = 3000;
// Never two puts to one key inside KV's one-per-second ceiling.
const FLOOR_MS = 1200;
const MAX_WRITES_PER_BUCKET = 4;
const DAILY_WRITE_BUDGET = 60;
// 6h leak backstop: a shard the cron never folds cannot outlive this.
const SHARD_TTL_S = 21600;
// KV writes and deletes are visible immediately in the writing colo but take up
// to 60s elsewhere, list() included. Fold only buckets closed longer than 2x
// that, or a shard written in another colo is missed.
const GRACE_MS = 120000;
const RETAIN_DAYS = 90;
const MAX_CLIENTS = 20;

const OTHER = "(other)";
const UNKNOWN = "(unknown)";
const INVALID = "(invalid)";

// `method` is an attacker-controlled string, so it is matched against a fixed
// allow-list and never stored raw: without that, a loop of
// {"method":"<random>"} mints a new counter key per message and the cron folds
// every one of them into the durable record, forever.
//
// The allow-list is deliberately WIDER than what this server dispatches. A
// method the MCP spec defines but this server does not implement is the most
// interesting thing in the whole record — it is a real client asking for a
// capability we lack — and collapsing it into "(other)" alongside junk hides
// exactly that. Recording it by name costs nothing, because the set below is
// closed: it is the full method list from the spec schema for both protocol
// versions in MCP_SUPPORTED_VERSIONS (2025-03-26 and 2025-06-18), so the
// ceiling is 25 names plus "(other)" and "(invalid)", forever.

// Dispatched by mcpHandle. Everything else here answers -32601 or is ignored.
const METHODS_IMPLEMENTED = new Set([
  "initialize",
  "ping",
  "tools/list",
  "prompts/list",
  "prompts/get",
  "resources/list",
  "resources/read",
  "tools/call",
]);

// Spec REQUESTS this server does not implement, so each one answers -32601.
// These are the names worth acting on: a nonzero count is a client asking for
// a capability that is not here. The last three are server-to-client requests
// a well-behaved client never sends us, kept because receiving one is itself
// worth seeing rather than burying in "(other)".
const METHODS_UNIMPLEMENTED = new Set([
  "completion/complete",
  "logging/setLevel",
  "resources/subscribe",
  "resources/unsubscribe",
  "resources/templates/list",
  "elicitation/create",
  "roots/list",
  "sampling/createMessage",
]);

// Spec NOTIFICATIONS. Ignoring a notification is correct protocol behaviour,
// not a gap — the spec forbids responding to one — so these are recorded by
// name but never reported as something missing.
const METHODS_NOTIFICATIONS = new Set([
  "notifications/initialized",
  "notifications/cancelled",
  "notifications/progress",
  "notifications/message",
  "notifications/roots/list_changed",
  "notifications/prompts/list_changed",
  "notifications/resources/list_changed",
  "notifications/resources/updated",
  "notifications/tools/list_changed",
]);

const METHODS = new Set([...METHODS_IMPLEMENTED, ...METHODS_UNIMPLEMENTED, ...METHODS_NOTIFICATIONS]);

// Exported so the reader can separate "a client asked for this and we said
// -32601" from ordinary traffic, without re-deriving the split.
export const MCP_UNIMPLEMENTED_METHODS = METHODS_UNIMPLEMENTED;
const CODES = new Set(["-32700", "-32600", "-32601", "-32602", "-32603"]);

// --- per-isolate state -------------------------------------------------------
// All of it lazily initialised. Generating random values in global scope is a
// disallowed operation in Workers and throws at script startup, so the shard id
// CANNOT be minted at module top level.
let shard = null;
let bucket = null;
let counts = {};
let lastWriteMs = 0;
let writesThisBucket = 0;
let writesToday = 0;
let writeDay = null;
let flushScheduled = false;
let toolNames = null;

function shardId() {
  if (!shard) shard = crypto.randomUUID().slice(0, 8);
  return shard;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- shapes ------------------------------------------------------------------

const COUNT_FIELDS = ["methods", "tools", "outcomes", "codes", "clients", "toolMs"];

function emptyDay() {
  return { total: 0, batches: 0, methods: {}, tools: {}, outcomes: {}, codes: {}, clients: {}, toolMs: {} };
}

function bump(obj, key) {
  obj[key] = (obj[key] || 0) + 1;
}

function addCounts(dst, src) {
  for (const k of Object.keys(src || {})) dst[k] = (dst[k] || 0) + (src[k] || 0);
}

function mergeDay(dst, src) {
  if (!src) return dst;
  dst.total = (dst.total || 0) + (src.total || 0);
  dst.batches = (dst.batches || 0) + (src.batches || 0);
  for (const f of COUNT_FIELDS) {
    if (!dst[f]) dst[f] = {};
    addCounts(dst[f], src[f]);
  }
  return dst;
}

// Merge one `{day: dayObject}` map into another. Exported for the test script.
export function mergeInto(dstDays, srcDays) {
  for (const day of Object.keys(srcDays || {})) {
    if (!dstDays[day]) dstDays[day] = emptyDay();
    mergeDay(dstDays[day], srcDays[day]);
  }
  return dstDays;
}

// Keep the `limit` largest keys, fold the rest into "(other)". This is the cap
// that stops a hostile caller growing the durable value without bound.
function capMap(obj, limit) {
  const keys = Object.keys(obj).filter((k) => k !== OTHER);
  if (keys.length <= limit) return obj;
  keys.sort((a, b) => obj[b] - obj[a]);
  const out = {};
  let other = obj[OTHER] || 0;
  for (const k of keys.slice(0, limit)) out[k] = obj[k];
  for (const k of keys.slice(limit)) other += obj[k];
  out[OTHER] = other;
  return out;
}

// `YYYYMMDD-HHMM`, UTC, floored to the bucket width: fixed-width, so plain
// string comparison orders buckets correctly and `<=` is a valid high-water
// test. The separator is "-" rather than an ISO "T" on purpose —
// scripts/check-module-refs.mjs does not model regex literals, so a bare `T`
// inside the validating pattern below reads to it as a reference to i18n.js's
// exported `T`. Keep it a dash.
export function bucketOf(ms) {
  const d = new Date(Math.floor(ms / BUCKET_MS) * BUCKET_MS);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

function bucketStartMs(b) {
  return Date.UTC(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6, 8), +b.slice(9, 11), +b.slice(11, 13));
}

// Central, not UTC. This site is Central-facing — every timestamp it renders
// goes through centralStamp, and the pollen/air features key their days with
// ctDateStr — so "today" in a report a human reads has to mean the day that
// human is living in. Keyed by UTC, the day rolled over at 7pm local and
// "today" read as a near-empty bucket all evening. The 10-minute shard buckets
// stay UTC on purpose: those are time windows, not calendar days.
export function dayOf(ms) {
  return ctDateStr(ms);
}

function freshRecord() {
  return {
    v: 1,
    updated: null,
    rolledUpThrough: "",
    firstSeen: null,
    lifetime: emptyDay(),
    months: {},
    days: {},
    rollup: { at: null, ok: null, shards: 0, error: null },
  };
}

// --- classification ----------------------------------------------------------

function knownTool(name) {
  if (!toolNames) {
    // Built from the server itself so the allow-list cannot drift from the
    // tools actually dispatched.
    try {
      toolNames = new Set(mcpTools().map((t) => t.name));
    } catch {
      toolNames = new Set();
    }
  }
  return toolNames.has(name);
}

function sanitizeClient(name) {
  if (typeof name !== "string") return null;
  const s = name.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32);
  return s || OTHER;
}

// Derive what to count from the request message and whatever mcpHandle returned.
// Pure, so the test script can drive it without KV.
//
// Two traps, both of which silently miscount if classification keys off `m.id`:
//
//   1. A malformed message with NO id returns null from mcpHandle, exactly like
//      a valid notification. "No response means ok" would score garbage input
//      as success, so the envelope is tested first and short-circuits.
//   2. `tools/call` with `id: null` returns a NON-null result object, which the
//      router pushes into `out`. So a non-null response does not imply the
//      message was a request either.
export function classify(m, r, ms) {
  if (!m || typeof m !== "object" || Array.isArray(m) || m.jsonrpc !== "2.0" || typeof m.method !== "string") {
    return { method: INVALID, tool: null, client: null, outcome: "rpc_error", code: "-32600", ms: 0 };
  }

  const method = METHODS.has(m.method) ? m.method : OTHER;

  let tool = null;
  if (m.method === "tools/call") {
    const n = m.params && m.params.name;
    tool = typeof n === "string" && knownTool(n) ? n : UNKNOWN;
  }

  let client = null;
  if (m.method === "initialize") {
    client = sanitizeClient(m.params && m.params.clientInfo && m.params.clientInfo.name);
  }

  let outcome;
  let code = null;
  if (r === null || r === undefined) {
    outcome = "notification";
  } else if (r.error) {
    outcome = "rpc_error";
    const c = String(r.error.code);
    code = CODES.has(c) ? c : OTHER;
  } else if (r.result && r.result.isError === true) {
    outcome = "tool_error";
  } else {
    outcome = "ok";
  }

  return { method, tool, client, outcome, code, ms: Number.isFinite(ms) && ms > 0 ? ms : 0 };
}

// --- request path ------------------------------------------------------------

function enabled(env) {
  return !!env && env.MCP_METRICS === "on" && !!env.WEATHER;
}

function hasCounts(days) {
  for (const d of Object.values(days || {})) if (d.total > 0 || d.batches > 0) return true;
  return false;
}

async function writeShard(env, b, days) {
  try {
    const payload = { v: 1, at: new Date().toISOString(), days };
    await env.WEATHER.put(`${MCP_SHARD_PREFIX}${b}:${shardId()}`, JSON.stringify(payload), {
      expirationTtl: SHARD_TTL_S,
    });
    lastWriteMs = Date.now();
    writesToday += 1;
    return true;
  } catch (e) {
    // Never retried: the counters are cumulative, so the next flush carries
    // everything this one would have. Retrying here would only burn the budget.
    console.error("MCP metrics shard write failed:", e && e.stack);
    if (/429|limit|Too Many/i.test((e && e.message) || "")) writesToday = DAILY_WRITE_BUDGET;
    return false;
  }
}

// A bucket boundary closes the outgoing bucket for good, so its counters are
// flushed to their own key immediately rather than waiting on the debounce.
function rollBucket(env, ctx, now) {
  const b = bucketOf(now);
  if (bucket === null) {
    bucket = b;
    return;
  }
  if (b === bucket) return;

  const outgoingBucket = bucket;
  const outgoingDays = counts;
  bucket = b;
  counts = {};
  writesThisBucket = 0;

  if (hasCounts(outgoingDays) && ctx && typeof ctx.waitUntil === "function") {
    try {
      ctx.waitUntil(writeShard(env, outgoingBucket, outgoingDays));
    } catch (e) {
      console.error("MCP metrics bucket-roll flush failed:", e && e.stack);
    }
  }
}

async function debouncedFlush(env) {
  try {
    await sleep(DEBOUNCE_MS);
    const wait = lastWriteMs + FLOOR_MS - Date.now();
    if (wait > 0) await sleep(wait);
    // Cleared BEFORE the write so a message arriving during the put schedules
    // the next flush instead of being stranded.
    flushScheduled = false;

    if (!hasCounts(counts)) return;
    const today = dayOf(Date.now());
    if (writeDay !== today) {
      writeDay = today;
      writesToday = 0;
    }
    if (writesToday >= DAILY_WRITE_BUDGET) return;
    if (writesThisBucket >= MAX_WRITES_PER_BUCKET) return;

    if (await writeShard(env, bucket, counts)) writesThisBucket += 1;
  } catch (e) {
    flushScheduled = false;
    console.error("MCP metrics flush failed:", e && e.stack);
  }
}

function schedule(env, ctx) {
  if (flushScheduled) return;
  // Without waitUntil there is nothing to keep the isolate alive across the
  // debounce, so the counters simply ride along to the next request.
  if (!ctx || typeof ctx.waitUntil !== "function") return;
  flushScheduled = true;
  try {
    // Never destructure ctx: waitUntil loses its `this` binding and throws
    // "Illegal invocation".
    ctx.waitUntil(debouncedFlush(env));
  } catch (e) {
    // If the handoff itself fails, the flag must not stay latched — a stuck
    // `true` would silently disable every later flush in this isolate.
    flushScheduled = false;
    console.error("MCP metrics flush scheduling failed:", e && e.stack);
  }
}

// Record one JSON-RPC message. Called from the router's /mcp POST loop, not
// awaited, and wrapped so it can never throw into the protocol path.
export function mcpRecord(env, ctx, m, r, ms) {
  try {
    if (!enabled(env)) return;
    const c = classify(m, r, ms);
    const now = Date.now();
    rollBucket(env, ctx, now);

    const day = dayOf(now);
    if (!counts[day]) counts[day] = emptyDay();
    const d = counts[day];

    d.total += 1;
    bump(d.methods, c.method);
    bump(d.outcomes, c.outcome);
    if (c.code) bump(d.codes, c.code);
    if (c.tool) {
      bump(d.tools, c.tool);
      if (c.ms) d.toolMs[c.tool] = (d.toolMs[c.tool] || 0) + c.ms;
    }
    if (c.client) {
      bump(d.clients, c.client);
      d.clients = capMap(d.clients, MAX_CLIENTS);
    }

    schedule(env, ctx);
  } catch (e) {
    console.error("MCP metrics record failed:", e && e.stack);
  }
}

// One POST to /mcp, whatever it carried. Counted separately from messages
// because a batch is one request carrying many, and both readings are useful.
export function mcpBatchRecorded(env, ctx) {
  try {
    if (!enabled(env)) return;
    const now = Date.now();
    rollBucket(env, ctx, now);
    const day = dayOf(now);
    if (!counts[day]) counts[day] = emptyDay();
    counts[day].batches += 1;
    schedule(env, ctx);
  } catch (e) {
    console.error("MCP metrics batch record failed:", e && e.stack);
  }
}

// --- rollup (cron) -----------------------------------------------------------

async function listShards(env) {
  const names = [];
  let cursor;
  for (;;) {
    const page = await env.WEATHER.list({ prefix: MCP_SHARD_PREFIX, cursor });
    for (const k of page.keys || []) names.push(k.name);
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  return names;
}

function shardBucket(name) {
  const b = name.slice(MCP_SHARD_PREFIX.length).split(":")[0];
  return /^\d{8}-\d{4}$/.test(b) ? b : null;
}

function trimDays(rec) {
  const days = Object.keys(rec.days).sort();
  while (days.length > RETAIN_DAYS) {
    const d = days.shift();
    const month = d.slice(0, 7);
    if (!rec.months[month]) rec.months[month] = emptyDay();
    mergeDay(rec.months[month], rec.days[d]);
    rec.months[month].clients = capMap(rec.months[month].clients, MAX_CLIENTS);
    delete rec.days[d];
  }
}

// Fold every closed shard into the durable record. Called once per cron tick.
//
// Correctness rests on `rolledUpThrough`, not on the delete. A KV delete is
// itself eventually consistent, so a deleted shard can keep appearing in list()
// for up to a minute; without a high-water mark the next tick re-folds it and
// double-counts. Deleting is an optimisation, expirationTtl is the backstop,
// and the mark is the thing that makes this idempotent — if the put below
// fails, the mark does not advance and the next tick folds the same shards again.
export async function mcpRollUp(env) {
  if (!env || !env.WEATHER) return;

  const rec = (await env.WEATHER.get(MCP_METRICS_KV_KEY, "json")) || freshRecord();
  if (!rec.days) rec.days = {};
  if (!rec.months) rec.months = {};
  if (!rec.lifetime) rec.lifetime = emptyDay();
  const mark = typeof rec.rolledUpThrough === "string" ? rec.rolledUpThrough : "";
  const cutoff = Date.now() - GRACE_MS;

  const foldable = [];
  const deletable = [];
  for (const name of await listShards(env)) {
    const b = shardBucket(name);
    if (!b) continue;
    if (b <= mark) {
      deletable.push(name); // already folded; a delete that did not stick
      continue;
    }
    if (bucketStartMs(b) + BUCKET_MS > cutoff) continue; // still open, or inside the grace window
    foldable.push({ name, b });
  }

  let folded = 0;
  let newest = mark;
  for (const { name, b } of foldable) {
    let v = null;
    try {
      v = await env.WEATHER.get(name, "json");
    } catch {
      v = null;
    }
    deletable.push(name);
    if (!v || typeof v !== "object" || !v.days) continue; // corrupt: skip it, do not abort the fold
    mergeInto(rec.days, v.days);
    for (const d of Object.values(v.days)) mergeDay(rec.lifetime, d);
    if (!rec.firstSeen && v.at) rec.firstSeen = v.at;
    if (b > newest) newest = b;
    folded += 1;
  }

  if (folded > 0) {
    for (const d of Object.values(rec.days)) d.clients = capMap(d.clients, MAX_CLIENTS);
    rec.lifetime.clients = capMap(rec.lifetime.clients, MAX_CLIENTS);
    trimDays(rec);
    rec.rolledUpThrough = newest;
    rec.updated = new Date().toISOString();
    rec.rollup = { at: rec.updated, ok: true, shards: folded, error: null };
    await env.WEATHER.put(MCP_METRICS_KV_KEY, JSON.stringify(rec));
  }

  // Only after the record is safely written. Best-effort: the TTL is what
  // guarantees a shard eventually disappears.
  for (const name of deletable) {
    try {
      await env.WEATHER.delete(name);
    } catch {
      /* TTL will collect it */
    }
  }
}

// --- read path ---------------------------------------------------------------

export function lastNDays(n, nowMs) {
  // Step calendar days from a NOON anchor rather than subtracting 24h from the
  // current instant: a Central day is 23 or 25 hours long on the two DST shift
  // dates, so fixed 24h steps repeat or skip a day there. Noon is far enough
  // from both boundaries that the date never slips.
  const [y, m, d] = dayOf(nowMs).split("-").map(Number);
  const anchor = Date.UTC(y, m - 1, d, 12);
  const out = [];
  for (let i = 0; i < n; i++) out.push(new Date(anchor - i * 86400000).toISOString().slice(0, 10));
  return out;
}

function summarise(day) {
  const o = day.outcomes || {};
  return {
    calls: day.total || 0,
    requests: day.batches || 0,
    ok: o.ok || 0,
    notifications: o.notification || 0,
    rpcErrors: o.rpc_error || 0,
    toolErrors: o.tool_error || 0,
  };
}

function pickUnimplemented(methods) {
  const out = {};
  for (const k of Object.keys(methods || {})) {
    if (METHODS_UNIMPLEMENTED.has(k) && methods[k] > 0) out[k] = methods[k];
  }
  return out;
}

function rank(obj, day) {
  return Object.keys(obj || {})
    .map((k) => ({ name: k, calls: obj[k], ms: day && day.toolMs ? day.toolMs[k] || 0 : 0 }))
    .sort((a, b) => b.calls - a.calls);
}

// Read the durable record and merge in the shards the cron has not folded yet,
// so a fresh call is not up to a quarter-hour stale.
//
// THE ORDER HERE IS LOAD-BEARING: read `mcp_metrics` FIRST, then list shards,
// then keep only buckets past its mark. Listing first and reading second lets a
// cron fold land between the two steps, and those counts are then added twice.
// This reads like an arbitrary ordering. It is not.
export async function mcpUsageReport(env) {
  const rec = (await env.WEATHER.get(MCP_METRICS_KV_KEY, "json")) || freshRecord();
  if (!rec.days) rec.days = {};
  if (!rec.months) rec.months = {};
  if (!rec.lifetime) rec.lifetime = emptyDay();
  const mark = typeof rec.rolledUpThrough === "string" ? rec.rolledUpThrough : "";

  const days = mergeInto({}, rec.days);
  const lifetime = mergeDay(emptyDay(), rec.lifetime);

  let pendingShards = 0;
  let pendingCalls = 0;
  try {
    for (const name of await listShards(env)) {
      const b = shardBucket(name);
      if (!b || b <= mark) continue;
      const v = await env.WEATHER.get(name, "json");
      if (!v || !v.days) continue;
      mergeInto(days, v.days);
      for (const d of Object.values(v.days)) {
        mergeDay(lifetime, d);
        pendingCalls += d.total || 0;
      }
      pendingShards += 1;
    }
  } catch (e) {
    console.error("MCP usage live-shard merge failed:", e && e.stack);
  }

  const now = Date.now();
  const today = days[dayOf(now)] || emptyDay();
  const week = emptyDay();
  for (const d of lastNDays(7, now)) if (days[d]) mergeDay(week, days[d]);

  return {
    site: "live",
    checkedAt: centralStamp(new Date().toISOString()),
    since: rec.firstSeen ? centralStamp(rec.firstSeen) : null,
    rolledUpThrough: mark || null,
    pending: { shards: pendingShards, calls: pendingCalls },
    note:
      "Aggregate counts for POST /mcp only. No addresses, user agents, tool " +
      "arguments or request contents are stored, and nothing identifies a caller. " +
      "Counts can lag by a few seconds while a shard is in flight.",
    today: summarise(today),
    last7Days: summarise(week),
    lifetime: summarise(lifetime),
    tools: { last7Days: rank(week.tools, week), lifetime: rank(lifetime.tools, lifetime) },
    methods: { last7Days: week.methods, lifetime: lifetime.methods },
    // Spec requests this server answers -32601 to. Derived rather than stored,
    // so widening METHODS_UNIMPLEMENTED reclassifies history already recorded.
    unimplementedRequested: {
      last7Days: pickUnimplemented(week.methods),
      lifetime: pickUnimplemented(lifetime.methods),
    },
    errorCodes: { last7Days: week.codes, lifetime: lifetime.codes },
    clients: { last7Days: week.clients, lifetime: lifetime.clients },
    days: Object.fromEntries(
      Object.keys(days)
        .sort()
        .reverse()
        .map((d) => [d, summarise(days[d])]),
    ),
    months: Object.fromEntries(
      Object.keys(rec.months)
        .sort()
        .reverse()
        .map((m) => [m, summarise(rec.months[m])]),
    ),
    rollup: rec.rollup || { at: null, ok: null, shards: 0, error: null },
  };
}

// Fixed-width rendering for `?format=txt`. Held under 60 columns because the
// only person who reads this is reading it in a phone terminal.
export function mcpUsageText(report) {
  const L = [];
  const pad = (s, w) => String(s).padEnd(w);
  const num = (n, w) => String(n).padStart(w);

  L.push("crosbynews MCP usage");
  L.push(report.checkedAt);
  L.push("");

  // EVERY outcome class gets a column. Notifications were missing, so the row
  // did not add up to its own `calls` total — and a table that fails the
  // reader's arithmetic reads as a counting bug rather than a missing column.
  // A notification (notifications/initialized and friends) draws no response
  // by protocol, so it is neither a success nor an error and needs its own.
  L.push(`${pad("", 10)}${num("calls", 7)}${num("ok", 6)}${num("notif", 7)}${num("rpcerr", 7)}${num("toolerr", 8)}`);
  for (const [label, s] of [["today", report.today], ["7 days", report.last7Days], ["lifetime", report.lifetime]]) {
    L.push(
      `${pad(label, 10)}${num(s.calls, 7)}${num(s.ok, 6)}${num(s.notifications, 7)}${num(s.rpcErrors, 7)}${num(s.toolErrors, 8)}`,
    );
  }
  if (report.since) L.push(`since ${report.since}`);
  L.push("");

  const tools = report.tools.last7Days.length ? report.tools.last7Days : report.tools.lifetime;
  L.push(tools === report.tools.last7Days ? "top tools, 7 days" : "top tools, lifetime");
  if (!tools.length) L.push("  (none yet)");
  for (const t of tools.slice(0, 15)) {
    const per = t.calls ? Math.round(t.ms / t.calls) : 0;
    L.push(`  ${pad(t.name, 26)}${num(t.calls, 7)}${num(per ? `${per}ms` : "-", 9)}`);
  }
  L.push("");

  const methods = Object.keys(report.methods.last7Days).length ? report.methods.last7Days : report.methods.lifetime;
  L.push("methods");
  if (!Object.keys(methods).length) L.push("  (none yet)");
  for (const k of Object.keys(methods).sort((a, b) => methods[b] - methods[a])) {
    L.push(`  ${pad(k, 26)}${num(methods[k], 7)}`);
  }

  // Called out separately, not left as a row in the table above: a client
  // asking for a capability this server lacks is the one thing in here that
  // suggests an action, and it reads as ordinary traffic otherwise.
  const missing = Object.keys(report.unimplementedRequested.lifetime).length
    ? report.unimplementedRequested.lifetime
    : null;
  if (missing) {
    L.push("");
    L.push("asked for, NOT implemented here");
    for (const k of Object.keys(missing).sort((a, b) => missing[b] - missing[a])) {
      L.push(`  ${pad(k, 26)}${num(missing[k], 7)}`);
    }
  }

  const codes = Object.keys(report.errorCodes.last7Days).length
    ? report.errorCodes.last7Days
    : report.errorCodes.lifetime;
  if (Object.keys(codes).length) {
    L.push("");
    L.push("error codes");
    for (const k of Object.keys(codes).sort((a, b) => codes[b] - codes[a])) {
      L.push(`  ${pad(k, 26)}${num(codes[k], 7)}`);
    }
  }

  const clients = Object.keys(report.clients.lifetime).length ? report.clients.lifetime : null;
  if (clients) {
    L.push("");
    L.push("clients, lifetime");
    for (const k of Object.keys(clients).sort((a, b) => clients[b] - clients[a])) {
      L.push(`  ${pad(k, 26)}${num(clients[k], 7)}`);
    }
  }

  L.push("");
  const r = report.rollup;
  L.push(`rollup  ${r.ok === null ? "never run" : r.ok ? "ok" : "FAILED"}${r.at ? `  ${centralStamp(r.at)}` : ""}`);
  if (report.pending.shards) L.push(`        + ${report.pending.calls} call(s) in ${report.pending.shards} live shard(s)`);
  L.push("");
  L.push("No caller identity or request contents are stored.");
  return L.join("\n") + "\n";
}
