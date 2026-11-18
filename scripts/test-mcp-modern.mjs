// Pin the dual-era /mcp contract through the real Worker: legacy (initialize
// handshake, 2025-03-26 through 2025-11-25) traffic is answered exactly as
// before, and a single message carrying a 2026-07-28 _meta version is served
// statelessly with the status codes, error codes and result fields that
// revision requires. Expected values are written out by hand from the spec
// (modelcontextprotocol.io/specification/2026-07-28), not read from the code
// under test.
//
// Run: node scripts/test-mcp-modern.mjs

import { createHarness } from "./lib/harness.mjs";

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`ok   ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const h = await createHarness();
const quiet = console.error;
console.error = () => {};

const ALL = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"];
const META = (v = "2026-07-28", extra = {}) => ({
  "io.modelcontextprotocol/protocolVersion": v,
  "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
  ...extra,
});

async function post(body, headers = {}) {
  const r = await h.get("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, headers: r.headers, json, text };
}
// A well-formed modern request: headers mirror the body.
function modern(method, params = {}, { version = "2026-07-28", id = 1, headers = {}, name } = {}) {
  const h2 = { "MCP-Protocol-Version": version, "Mcp-Method": method, ...headers };
  if (name !== undefined) h2["Mcp-Name"] = name;
  return post({ jsonrpc: "2.0", id, method, params: { ...params, _meta: META(version) } }, h2);
}

try {
  // ---------------- legacy: unchanged ----------------
  {
    const r = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "0" } } });
    check("legacy initialize 2025-06-18 → 200", r.status === 200, String(r.status));
    check("legacy initialize echoes 2025-06-18", r.json?.result?.protocolVersion === "2025-06-18", JSON.stringify(r.json?.result?.protocolVersion));
    check("legacy initialize carries no resultType", r.json?.result && !("resultType" in r.json.result));
  }
  for (const [asked, want] of [["2025-03-26", "2025-03-26"], ["2025-11-25", "2025-11-25"], ["2026-07-28", "2025-11-25"], ["2024-11-05", "2025-11-25"]]) {
    const r = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: asked, capabilities: {}, clientInfo: { name: "c", version: "0" } } });
    check(`legacy initialize asked ${asked} → ${want}`, r.json?.result?.protocolVersion === want, JSON.stringify(r.json?.result?.protocolVersion));
  }
  {
    // A legacy client sends MCP-Protocol-Version after initialize; that header
    // alone must never select the modern path.
    const r = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "MCP-Protocol-Version": "2025-06-18" });
    check("legacy tools/list with a version header → 200", r.status === 200, String(r.status));
    check("legacy tools/list lists 16 tools", r.json?.result?.tools?.length === 16, String(r.json?.result?.tools?.length));
    check("legacy tools/list has no resultType/ttlMs", r.json?.result && !("resultType" in r.json.result) && !("ttlMs" in r.json.result));
    const p = await post({ jsonrpc: "2.0", id: 3, method: "ping" }, { "MCP-Protocol-Version": "2025-06-18" });
    check("legacy ping → {}", JSON.stringify(p.json) === '{"jsonrpc":"2.0","id":3,"result":{}}', p.text);
    const n = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    check("legacy notification → 202", n.status === 202 && n.text === "", `${n.status} ${n.text}`);
    const u = await post({ jsonrpc: "2.0", id: 4, method: "no/such" });
    check("legacy unknown method → 200 with -32601", u.status === 200 && u.json?.error?.code === -32601, `${u.status} ${u.text}`);
  }
  {
    // Batches are legacy-only, even when a member looks modern.
    const r = await post([{ jsonrpc: "2.0", id: 1, method: "ping", params: { _meta: META() } }, { jsonrpc: "2.0", id: 2, method: "tools/list" }]);
    check("a batch is served on the legacy path", r.status === 200 && Array.isArray(r.json) && r.json.length === 2 && JSON.stringify(r.json[0]) === '{"jsonrpc":"2.0","id":1,"result":{}}', r.text.slice(0, 200));
  }
  {
    const r = await post({ jsonrpc: "2.0", id: 9, method: "server/discover" });
    check("bare server/discover → 200", r.status === 200, String(r.status));
    check("bare server/discover lists every version", JSON.stringify(r.json?.result?.supportedVersions) === JSON.stringify(ALL), JSON.stringify(r.json?.result?.supportedVersions));
  }

  // ---------------- modern: results ----------------
  {
    const r = await modern("server/discover");
    const res = r.json?.result;
    check("modern server/discover → 200", r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
    check("discover response header echoes 2026-07-28", r.headers.get("mcp-protocol-version") === "2026-07-28", String(r.headers.get("mcp-protocol-version")));
    check("discover supportedVersions", JSON.stringify(res?.supportedVersions) === JSON.stringify(ALL), JSON.stringify(res?.supportedVersions));
    check("discover resultType complete", res?.resultType === "complete");
    check("discover ttlMs 3600000, cacheScope public", res?.ttlMs === 3600000 && res?.cacheScope === "public", `${res?.ttlMs} ${res?.cacheScope}`);
    check("discover capabilities", JSON.stringify(res?.capabilities) === '{"tools":{"listChanged":false},"prompts":{"listChanged":false},"resources":{"listChanged":false}}', JSON.stringify(res?.capabilities));
    check("discover serverInfo in _meta", res?._meta?.["io.modelcontextprotocol/serverInfo"]?.name === "crosbynews-weather");
    check("discover has no top-level serverInfo", res && !("serverInfo" in res));
    check("discover has instructions", typeof res?.instructions === "string" && res.instructions.length > 20);
  }
  {
    const r = await modern("tools/list");
    check("modern tools/list → 200 with 16 tools", r.status === 200 && r.json?.result?.tools?.length === 16, `${r.status} ${r.json?.result?.tools?.length}`);
    check("modern tools/list is a CacheableResult", r.json?.result?.resultType === "complete" && r.json?.result?.ttlMs === 3600000 && r.json?.result?.cacheScope === "public");
    for (const m of ["prompts/list", "resources/list", "resources/templates/list"]) {
      const x = await modern(m);
      check(`modern ${m} → 200, cacheable`, x.status === 200 && x.json?.result?.resultType === "complete" && x.json?.result?.ttlMs === 3600000, `${x.status} ${x.text.slice(0, 150)}`);
    }
  }
  {
    const r = await modern("tools/call", { name: "get_emergency_contacts", arguments: {} }, { name: "get_emergency_contacts" });
    check("modern tools/call → 200", r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
    check("modern tools/call result is complete, not cacheable", r.json?.result?.resultType === "complete" && !("ttlMs" in (r.json?.result || {})) && Array.isArray(r.json?.result?.content));
    const b64 = await modern("tools/call", { name: "get_emergency_contacts", arguments: {} }, { name: "=?base64?Z2V0X2VtZXJnZW5jeV9jb250YWN0cw==?=" });
    check("Mcp-Name in =?base64?…?= form is decoded", b64.status === 200 && b64.json?.result?.resultType === "complete", `${b64.status} ${b64.text.slice(0, 150)}`);
    const u = await modern("tools/call", { name: "nope", arguments: {} }, { name: "nope" });
    check("modern unknown tool → 200 with -32602", u.status === 200 && u.json?.error?.code === -32602, `${u.status} ${u.text}`);
  }
  {
    const r = await modern("resources/read", { uri: "https://crosbynews.com/llms.txt" }, { name: "https://crosbynews.com/llms.txt" });
    check("modern resources/read → 200, cacheable", r.status === 200 && r.json?.result?.ttlMs === 3600000 && r.json?.result?.contents?.length === 1, `${r.status} ${r.text.slice(0, 150)}`);
  }
  {
    const r = await modern("prompts/list");
    const p = r.json?.result?.prompts?.[0]?.name;
    if (p) {
      const g = await modern("prompts/get", { name: p }, { name: p });
      check("modern prompts/get → 200, complete", g.status === 200 && g.json?.result?.resultType === "complete" && !("ttlMs" in (g.json?.result || {})), `${g.status} ${g.text.slice(0, 150)}`);
    } else check("a prompt exists to test prompts/get", false);
  }

  // ---------------- modern: errors ----------------
  const isErr = (r, status, code) => r.status === status && r.json?.error?.code === code;
  {
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: META() } };
    const wrong = await post(body, { "MCP-Protocol-Version": "2025-06-18", "Mcp-Method": "tools/list" });
    check("header version ≠ _meta → 400 -32020", isErr(wrong, 400, -32020), `${wrong.status} ${wrong.text}`);
    const noMethod = await post(body, { "MCP-Protocol-Version": "2026-07-28" });
    check("missing Mcp-Method → 400 -32020", isErr(noMethod, 400, -32020), `${noMethod.status} ${noMethod.text}`);
    const badMethod = await post(body, { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "prompts/list" });
    check("Mcp-Method ≠ body → 400 -32020", isErr(badMethod, 400, -32020), `${badMethod.status} ${badMethod.text}`);
    const call = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_emergency_contacts", arguments: {}, _meta: META() } };
    const noName = await post(call, { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call" });
    check("tools/call without Mcp-Name → 400 -32020", isErr(noName, 400, -32020), `${noName.status} ${noName.text}`);
    const badName = await post(call, { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": "get_alerts" });
    check("Mcp-Name ≠ body → 400 -32020", isErr(badName, 400, -32020), `${badName.status} ${badName.text}`);
  }
  {
    const r = await modern("tools/list", {}, { version: "1900-01-01" });
    check("unsupported version → 400 -32022", isErr(r, 400, -32022), `${r.status} ${r.text}`);
    check("-32022 data names supported and requested", JSON.stringify(r.json?.error?.data) === JSON.stringify({ supported: ALL, requested: "1900-01-01" }), JSON.stringify(r.json?.error?.data));
  }

  // ---------------- served as legacy, by the spec's allowances ----------------
  // Each shape was seen in live traffic on 2026-11-17 and was rejected by the
  // first 1.9.0 deploy, though it worked before it.
  {
    // A 2025-06-18 client that stamps _meta and the 2026 headers on every
    // request, its handshake included.
    const init = await post(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "0" }, _meta: META("2025-06-18") } },
      { "MCP-Protocol-Version": "2025-06-18", "Mcp-Method": "initialize" },
    );
    check("initialize with a legacy _meta version → 200, negotiates 2025-06-18", init.status === 200 && init.json?.result?.protocolVersion === "2025-06-18", `${init.status} ${init.text.slice(0, 150)}`);
    const list = await modern("tools/list", {}, { version: "2025-06-18" });
    check("tools/list with a legacy _meta version → 200, legacy result", list.status === 200 && list.json?.result?.tools?.length === 16 && !("resultType" in list.json.result), `${list.status} ${list.text.slice(0, 150)}`);
    const note = await post({ jsonrpc: "2.0", method: "notifications/initialized", params: { _meta: META("2025-06-18") } }, { "MCP-Protocol-Version": "2025-06-18", "Mcp-Method": "notifications/initialized" });
    check("notifications/initialized with a legacy _meta version → 202", note.status === 202, `${note.status} ${note.text}`);
  }
  {
    // A 2026 _meta but no MCP-Protocol-Version header: the MCP Playground
    // scanner sends every 2026 request this way, with Mcp-Method and Mcp-Name.
    // Served with 2026 semantics; any routing header that is sent must match.
    const d = await post({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: META() } }, { "Mcp-Method": "server/discover" });
    check("no version header: server/discover → 200 with the discover result", d.status === 200 && JSON.stringify(d.json?.result?.supportedVersions) === JSON.stringify(ALL) && d.json?.result?.resultType === "complete", `${d.status} ${d.text.slice(0, 150)}`);
    const t = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: META() } }, { "Mcp-Method": "tools/list" });
    check("no version header: tools/list → 200 with resultType, ttlMs, cacheScope", t.status === 200 && t.json?.result?.tools?.length === 16 && t.json.result.resultType === "complete" && t.json.result.ttlMs === 3600000 && t.json.result.cacheScope === "public", `${t.status} ${t.text.slice(0, 150)}`);
    const bare = await post({ jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: META() } });
    check("no version header, no Mcp-Method: tools/list → 200, 2026 result", bare.status === 200 && bare.json?.result?.resultType === "complete", `${bare.status} ${bare.text.slice(0, 150)}`);
    const mis = await post({ jsonrpc: "2.0", id: 4, method: "tools/list", params: { _meta: META() } }, { "Mcp-Method": "resources/list" });
    check("no version header: Mcp-Method ≠ body → 400 -32020", isErr(mis, 400, -32020), `${mis.status} ${mis.text}`);
    const call = { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_emergency_contacts", arguments: {}, _meta: META() } };
    const okCall = await post(call, { "Mcp-Method": "tools/call", "Mcp-Name": "get_emergency_contacts" });
    check("no version header: tools/call with matching Mcp-Name → 200", okCall.status === 200 && okCall.json?.result?.resultType === "complete", `${okCall.status} ${okCall.text.slice(0, 150)}`);
    const badCall = await post(call, { "Mcp-Method": "tools/call", "Mcp-Name": "get_alerts" });
    check("no version header: Mcp-Name ≠ body → 400 -32020", isErr(badCall, 400, -32020), `${badCall.status} ${badCall.text}`);
    const unk = await post({ jsonrpc: "2.0", id: 6, method: "tools/list", params: { _meta: META("1900-01-01") } });
    check("no version header, unknown _meta version → legacy 200", unk.status === 200 && unk.json?.result?.tools?.length === 16 && !("resultType" in unk.json.result), `${unk.status} ${unk.text.slice(0, 150)}`);
  }
  {
    // initialize always selects legacy semantics on a dual-era server, even
    // carrying a 2026 _meta and headers.
    const r = await post(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "c", version: "0" }, _meta: META() } },
      { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "initialize" },
    );
    check("initialize with a 2026 _meta → 200, legacy handshake", r.status === 200 && r.json?.result?.protocolVersion === "2025-11-25", `${r.status} ${r.text.slice(0, 150)}`);
  }
  {
    const meta = META();
    delete meta["io.modelcontextprotocol/clientCapabilities"];
    const r = await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: meta } }, { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list" });
    check("missing clientCapabilities → 400 -32602", isErr(r, 400, -32602), `${r.status} ${r.text}`);
    const meta2 = META();
    delete meta2["io.modelcontextprotocol/clientInfo"];
    const ok = await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: meta2 } }, { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list" });
    check("clientInfo is optional", ok.status === 200 && ok.json?.result?.resultType === "complete", `${ok.status} ${ok.text.slice(0, 120)}`);
  }
  for (const m of ["ping", "logging/setLevel", "no/such"]) {
    const r = await modern(m);
    check(`modern ${m} → 404 -32601`, isErr(r, 404, -32601), `${r.status} ${r.text}`);
  }
  {
    const r = await post({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1, _meta: META() } }, { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "notifications/cancelled" });
    check("modern notification → 202, no body", r.status === 202 && r.text === "", `${r.status} ${r.text}`);
  }
  {
    const r = await h.get("/mcp", { method: "OPTIONS" });
    const allow = r.headers.get("access-control-allow-headers") || "";
    check("CORS preflight allows Mcp-Method and Mcp-Name", allow.includes("mcp-method") && allow.includes("mcp-name"), allow);
  }
} finally {
  console.error = quiet;
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall dual-era MCP checks passed");
