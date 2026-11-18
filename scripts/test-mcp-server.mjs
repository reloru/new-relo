// Pin the tools/call contract that Anthropic's connector-directory review
// checks directly: invalid arguments come back as an actionable isError result
// (not silently clamped or ignored), a data-load failure names the feed and the
// page to check instead of a bare upstream string, and an unknown tool is a
// JSON-RPC -32602. Drives the REAL mcpCallTool / mcpHandle against a stubbed KV
// and a stubbed fetch. Pure node, no install, no network.
//
// Run: node scripts/test-mcp-server.mjs

import { mcpCallTool, mcpHandle, mcpTools, validateToolArgs, MCP_TOOL_SOURCES, MCP_EXAMPLE_PROMPTS, MCP_SERVER_INFO, mcpServerCard, mcpServerCardV1 } from "../src/mcp/server.js";

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`ok   ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// KV that records every read, so "validation runs before any KV read" is
// observable rather than assumed.
function stubEnv() {
  const reads = [];
  return {
    reads,
    WEATHER: {
      get: async (key) => {
        reads.push(key);
        return null;
      },
      put: async () => {},
      list: async () => ({ keys: [], list_complete: true }),
      delete: async () => {},
    },
  };
}

// Every upstream answers 503, so a cold cache cannot be warmed.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response("", { status: 503, statusText: "Service Unavailable" });
const realError = console.error;
console.error = () => {};

const tools = mcpTools();
const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
const text = (r) => r?.content?.[0]?.text ?? "";

try {
  // 1. Every declared parameter uses a type validateToolArgs implements.
  for (const t of tools) {
    for (const [key, spec] of Object.entries(t.inputSchema?.properties ?? {})) {
      check(
        `${t.name}.${key} has a validated type (integer with minimum/maximum)`,
        spec.type === "integer" && typeof spec.minimum === "number" && typeof spec.maximum === "number",
        JSON.stringify(spec)
      );
    }
  }

  // 2. Bad arguments → isError with an actionable message, and no KV read.
  const bad = [
    ["get_forecast", { hours: 500 }, /from 1 to 48.*got 500.*7-day/],
    ["get_forecast", { hours: 0 }, /from 1 to 48.*got 0/],
    ["get_forecast", { hours: "abc" }, /whole number.*got "abc"/],
    ["get_forecast", { hours: 2.5 }, /whole number.*got 2\.5/],
    ["get_forecast", { days: 3 }, /Unknown argument "days".*accepts only: hours/],
    ["get_school_events", { limit: 61 }, /from 1 to 60.*default of 15/],
    ["get_alerts", { county: "Harris" }, /Unknown argument "county".*takes no arguments/],
    ["get_pollen", [1, 2], /must be a JSON object/],
  ];
  for (const [name, args, re] of bad) {
    const env = stubEnv();
    const r = await mcpCallTool(name, args, env);
    check(`${name} ${JSON.stringify(args)} → isError`, r?.isError === true, JSON.stringify(r));
    check(`${name} ${JSON.stringify(args)} → actionable message`, re.test(text(r)), text(r));
    check(`${name} ${JSON.stringify(args)} → no KV read`, env.reads.length === 0, env.reads.join(","));
  }

  // 3. Good and omitted arguments pass; null counts as omitted.
  const pass = [
    ["get_forecast", { hours: 12 }, { hours: 12 }],
    ["get_forecast", { hours: null }, {}],
    ["get_forecast", undefined, {}],
    ["get_school_events", { limit: 60 }, { limit: 60 }],
    ["get_alerts", {}, {}],
  ];
  for (const [name, args, want] of pass) {
    const got = validateToolArgs(byName[name], args);
    check(`${name} ${JSON.stringify(args)} validates to ${JSON.stringify(want)}`, !got.error && JSON.stringify(got.args) === JSON.stringify(want), JSON.stringify(got));
  }

  // 4. A data-load failure names the feed and the page, keeps the upstream
  //    detail, and is a tool result (isError), not a JSON-RPC error.
  {
    // get_alerts, because loadWeather throws on a cold cache with the NWS
    // down. (loadPollen degrades to its own "unavailable" text instead.)
    const r = await mcpCallTool("get_alerts", {}, stubEnv());
    const t = text(r);
    check("get_alerts upstream 503 → isError", r?.isError === true, JSON.stringify(r).slice(0, 300));
    check("…names the feed", t.includes("National Weather Service alerts"), t);
    check("…keeps the upstream detail", t.includes("503"), t);
    check("…points at the live page", /The same data is on https:\/\/crosbynews\.com\/alerts\.$/.test(t), t);
    check("…is not a bare 'Error:' string", !/^Error:/.test(t), t);
  }

  // 5. Every tool that can throw has a source entry, so no failure falls back
  //    to the generic wording. get_radar and get_emergency_contacts cannot.
  for (const t of tools) {
    if (t.name === "get_radar" || t.name === "get_emergency_contacts") continue;
    check(`${t.name} has an MCP_TOOL_SOURCES entry`, Array.isArray(MCP_TOOL_SOURCES[t.name]));
  }

  // 6. Unknown tool → JSON-RPC -32602, before any KV read.
  {
    const env = stubEnv();
    const r = await mcpHandle({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_nothing", arguments: {} } }, env);
    check("unknown tool → JSON-RPC -32602", r?.error?.code === -32602, JSON.stringify(r));
    check("unknown tool → no KV read", env.reads.length === 0, env.reads.join(","));
  }

  // 7. Every tool carries a title and readOnlyHint (directory requirement),
  //    and names fit the 64-character limit.
  for (const t of tools) {
    check(`${t.name} has title + annotations.title + readOnlyHint, name ≤ 64 chars`, !!t.title && t.annotations?.title === t.title && t.annotations?.readOnlyHint === true && t.name.length <= 64);
  }

  // 8. The example prompts (public docs + directory use cases) name real tools,
  //    in both languages, and there are at least the three the policy requires.
  check("at least 3 example prompts", MCP_EXAMPLE_PROMPTS.length >= 3);
  for (const p of MCP_EXAMPLE_PROMPTS) {
    check(`example "${p.en}" names real tools and has Spanish`, !!p.es && p.tools.length > 0 && p.tools.every((n) => byName[n]));
  }
  // 9. No outputSchema carries an array `type` (e.g. ["string","null"]): some
  //    non-Claude dialects cannot express it, and the MCP Inspector --strict
  //    flags each one. Nullable fields are anyOf branches instead.
  const arrayTypes = (node, path = "") => {
    if (Array.isArray(node)) return node.flatMap((v, i) => arrayTypes(v, `${path}[${i}]`));
    if (!node || typeof node !== "object") return [];
    const here = Array.isArray(node.type) ? [path || "."] : [];
    return here.concat(Object.entries(node).flatMap(([k, v]) => arrayTypes(v, `${path}.${k}`)));
  };
  let nullBranches = 0;
  for (const t of tools) {
    for (const key of ["inputSchema", "outputSchema"]) {
      if (!t[key]) continue;
      const bad = arrayTypes(t[key]);
      check(`${t.name}.${key} has no array type`, bad.length === 0, bad.slice(0, 3).join(", "));
    }
    nullBranches += JSON.stringify(t.outputSchema ?? {}).split('{"type":"null"}').length - 1;
  }
  check("nullable fields survive as anyOf null branches", nullBranches >= 50, String(nullBranches));

  // 10. The version a server.json bump must match.
  {
    const { readFileSync } = await import("node:fs");
    const sj = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
    check("server.json version matches MCP_SERVER_INFO", sj.version === MCP_SERVER_INFO.version, `${sj.version} vs ${MCP_SERVER_INFO.version}`);

    // 11. The discovery card names the registry listing, not just serverInfo,
    // and claims only the protocol versions initialize really echoes.
    const card = mcpServerCard();
    check("card.name is the registry name", card.name === "com.crosbynews/weather", String(card.name));
    check("card.name matches server.json", card.name === sj.name, `${card.name} vs ${sj.name}`);
    check("card.version matches server.json", card.version === sj.version, `${card.version} vs ${sj.version}`);
    check("card.websiteUrl matches server.json", card.websiteUrl === sj.websiteUrl, `${card.websiteUrl} vs ${sj.websiteUrl}`);
    check("card.repository matches server.json", JSON.stringify(card.repository) === JSON.stringify(sj.repository));
    check(
      "card remotes match server.json (type, url)",
      JSON.stringify(card.remotes.map((r) => ({ type: r.type, url: r.url }))) === JSON.stringify(sj.remotes),
      JSON.stringify(card.remotes)
    );
    check("serverInfo.name is unchanged from initialize", card.serverInfo?.name === "crosbynews-weather", String(card.serverInfo?.name));
    const claimed = card.remotes[0].supportedProtocolVersions;
    check("card claims 2026-07-28 and the three legacy versions", JSON.stringify(claimed) === JSON.stringify(["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"]), JSON.stringify(claimed));
    // initialize negotiates only the legacy versions; 2026-07-28 is served per
    // request (scripts/test-mcp-modern.mjs), never through a handshake.
    for (const v of ["2025-11-25", "2025-06-18", "2025-03-26"]) {
      const r = await mcpHandle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v, capabilities: {}, clientInfo: { name: "t", version: "0" } } }, stubEnv());
      check(`initialize echoes legacy version ${v}`, r?.result?.protocolVersion === v, String(r?.result?.protocolVersion));
    }
    for (const v of ["2026-07-28", "2024-11-05"]) {
      const r = await mcpHandle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v, capabilities: {}, clientInfo: { name: "t", version: "0" } } }, stubEnv());
      check(`initialize asked ${v} answers 2025-11-25`, r?.result?.protocolVersion === "2025-11-25", String(r?.result?.protocolVersion));
    }

    // 11b. The SEP-2127 Server Card agrees with server.json and the registry.
    const v1 = mcpServerCardV1();
    check("Server Card $schema is the v1 URL", v1.$schema === "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json", String(v1.$schema));
    check("Server Card name matches server.json", v1.name === sj.name, `${v1.name} vs ${sj.name}`);
    check("Server Card version matches server.json", v1.version === sj.version, `${v1.version} vs ${sj.version}`);
    check("Server Card description matches server.json", v1.description === sj.description, `${v1.description} vs ${sj.description}`);
    check("description is 1-100 characters", sj.description.length >= 1 && sj.description.length <= 100, String(sj.description.length));
    check("Server Card title matches server.json", v1.title === sj.title, `${v1.title} vs ${sj.title}`);
    check("Server Card remotes match the older card", JSON.stringify(v1.remotes) === JSON.stringify(card.remotes), JSON.stringify(v1.remotes));
    check("Server Card lists no primitives or capabilities", !["tools", "prompts", "resources", "capabilities"].some((k) => k in v1));

    // 12. resources/templates/list is answered (empty), not -32601.
    const tl = await mcpHandle({ jsonrpc: "2.0", id: 5, method: "resources/templates/list" }, stubEnv());
    check("resources/templates/list → {resourceTemplates: []}", JSON.stringify(tl) === '{"jsonrpc":"2.0","id":5,"result":{"resourceTemplates":[]}}', JSON.stringify(tl));
  }

  // Wording a third-party eval caught: the AQI tool must say it is a regional
  // reading, and no description may name the internal NHC feed.
  const aqiDesc = byName.get_air_quality.description;
  check("get_air_quality says the measured reading is not Crosby-specific", aqiDesc.includes("not Crosby-specific"), aqiDesc);
  check("get_air_quality says the modeled path is a Crosby point estimate", aqiDesc.includes("modeled estimate at Crosby's coordinates"), aqiDesc);
  check("no tool description names the internal CurrentStorms feed", tools.every((t) => !t.description.includes("CurrentStorms")));
  check("get_tropical_outlook says it is not Crosby-specific", byName.get_tropical_outlook.description.includes("Not specific to Crosby, TX"));

  // The prose lists of tools are written by hand (deriving them would import
  // the MCP server into modules it imports). They went stale every time a tool
  // shipped, so every tool name must appear in each one.
  {
    const { llmsTxt, CROSBY_WEATHER_SKILL } = await import("../src/discovery.js");
    const { developersHtml } = await import("../src/pages/developers.js");
    const readme = (await import("node:fs")).readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const lists = { "llms.txt": llmsTxt(), "agent skill": CROSBY_WEATHER_SKILL, "/developers": developersHtml("en"), "/es/developers": developersHtml("es"), "README.md": readme };
    for (const t of mcpTools()) {
      for (const [where, text] of Object.entries(lists)) check(`${t.name} is named in ${where}`, text.includes(t.name));
    }
  }
} finally {
  globalThis.fetch = realFetch;
  console.error = realError;
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall MCP server checks passed");
