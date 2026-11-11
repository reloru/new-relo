// Run the real Worker (src/index.js) in plain node against a snapshot of the
// production KV cache, with the clock frozen at the snapshot's time.
//
// scripts/fixtures/kv/*.json are the raw values of the content keys as
// production held them at one moment — the realistic "quiet day" case. A test
// that needs something happening (an alert, a flood, a storm) mutates a copy
// through `kv` after createHarness() rather than keeping a second fixture set.
//
// Refresh the snapshot with:
//   for k in weather calendar water fishing tropics pollen traffic burnban news cron_status; do
//     npx wrangler kv key get --remote --binding WEATHER $k > scripts/fixtures/kv/$k.json; done
// and trim calendar.json to the weeks around the snapshot if it has grown.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../../", import.meta.url).pathname;
export const SRC = join(ROOT, "src");
const FIXTURES = join(ROOT, "scripts/fixtures/kv");
export const SITE = "https://crosbynews.com";

const RealDate = Date;

// Freeze `new Date()` and `Date.now()`; explicit dates still work.
export function freezeClock(ms) {
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(ms); else super(...a); }
    static now() { return ms; }
  };
}

export async function loadFixtures() {
  const out = {};
  for (const f of await readdir(FIXTURES)) {
    if (f.endsWith(".json")) out[f.slice(0, -5)] = JSON.parse(await readFile(join(FIXTURES, f), "utf8"));
  }
  return out;
}

// A KV namespace stub with the subset of the API the Worker uses.
export function kvStub(values) {
  const store = new Map(Object.entries(values).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    store,
    async get(k, type) {
      const v = store.get(k);
      if (v == null) return null;
      return type === "json" || type?.type === "json" ? JSON.parse(v) : v;
    },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix = "" } = {}) {
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

// createHarness({ mutate(values) }) -> { worker, env, kv, get(path, init) }.
// Network is disabled: a page that reaches for an upstream fails loudly instead
// of quietly depending on the internet.
export async function createHarness({ mutate } = {}) {
  const values = await loadFixtures();
  freezeClock(RealDate.parse(values.weather.updated) + 5 * 60 * 1000);
  if (mutate) mutate(values);
  const kv = kvStub(values);
  globalThis.fetch = async (u) => { throw new Error(`network disabled in tests: ${typeof u === "string" ? u : u.url}`); };
  const env = {
    WEATHER: kv,
    ASSETS: { fetch: async () => new Response("asset", { headers: { "content-type": "image/png" } }) },
    MCP_METRICS: "off",
    ADMIN_KEY: "test-admin-key",
  };
  const ctx = { waitUntil() {} };
  const worker = (await import(pathToFileURL(join(SRC, "index.js")).href)).default;
  const get = (path, init) => worker.fetch(new Request(SITE + path, init), env, ctx);
  return { worker, env, kv, ctx, get };
}
