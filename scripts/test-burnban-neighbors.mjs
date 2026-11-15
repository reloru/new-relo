// /burn-ban's neighboring-counties strip: the one TFS query asks for Harris
// and its seven neighbors, a bad neighbor row is dropped without failing
// Harris, and the strip renders (or stays hidden) in HTML, Spanish and Markdown.
// Also: the FAQ tells Crosby County (West Texas) readers this page isn't theirs.
//
// Run: node scripts/test-burnban-neighbors.mjs

import { createHarness } from "./lib/harness.mjs";

const failures = [];
const ok = (cond, what) => { if (!cond) failures.push(what); };
const has = (body, text, what) => ok(body.includes(text), `${what}: expected ${JSON.stringify(text)}`);

const h = await createHarness({
  mutate(values) {
    values.burnban = { ...values.burnban, neighbors: [
      { county: "Brazoria", status: "Yes" },
      { county: "Chambers", status: "Yes" },
      { county: "Liberty", status: "No" },
      { county: "Montgomery", status: "No" },
    ] };
  },
});
const { fetchBurnBan } = await import("../src/features/burnban.js");

// --- the fetch -------------------------------------------------------------
const feature = (County, BurnBan, StartDate = null) => ({ attributes: { County, BurnBan, StartDate, FIPS: 0 } });
let asked = null;
const tfs = (features) => async (u) => { asked = String(u); return new Response(JSON.stringify({ features })); };

globalThis.fetch = tfs([
  feature("Harris", "Yes", 1789624800000),
  feature("Brazoria", "Yes"),
  feature("Chambers", "Yes"),
  feature("Fort Bend", "No"),
  feature("Galveston", "Unknown"),
  feature("Liberty", "No"),
  feature("Montgomery", "No"),
]);
const got = await fetchBurnBan();
ok(got.status === "Yes" && got.startDate === "2026-09-17T06:00:00.000Z", `Harris parsed (got ${got.status} ${got.startDate})`);
ok(
  JSON.stringify(got.neighbors) ===
    JSON.stringify([
      { county: "Brazoria", status: "Yes" },
      { county: "Chambers", status: "Yes" },
      { county: "Fort Bend", status: "No" },
      { county: "Liberty", status: "No" },
      { county: "Montgomery", status: "No" },
    ]),
  `neighbors in order, Galveston's bad value and Waller's missing row dropped (got ${JSON.stringify(got.neighbors)})`,
);
const where = new URL(asked).searchParams.get("where");
ok(where === "County IN ('Harris','Brazoria','Chambers','Fort Bend','Galveston','Liberty','Montgomery','Waller')", `one query for all eight counties (got ${where})`);

globalThis.fetch = tfs([feature("Brazoria", "Yes")]);
let threw = false;
try { await fetchBurnBan(); } catch { threw = true; }
ok(threw, "a response without Harris still throws, so the last good status survives");

globalThis.fetch = async (u) => { throw new Error(`network disabled in tests: ${u}`); };

// --- the page --------------------------------------------------------------
const page = async (path, accept = "text/html") => (await h.get(path, { headers: { accept } })).text();
{
  const html = await page("/burn-ban");
  has(html, '<section class="nb" data-nosnippet>', "the strip is marked live-status");
  has(html, "<h2>Neighboring counties</h2>", "English heading");
  has(html, "<p><strong>Burn ban:</strong> Brazoria, Chambers</p>", "banned neighbors");
  has(html, "<p><strong>No burn ban:</strong> Liberty, Montgomery</p>", "clear neighbors");
  const es = await page("/es/burn-ban");
  has(es, "<h2>Condados vecinos</h2>", "Spanish heading");
  has(es, "<p><strong>Con prohibición de quemas:</strong> Brazoria, Chambers</p>", "Spanish banned line");
  has(es, "<p><strong>Sin prohibición:</strong> Liberty, Montgomery</p>", "Spanish clear line");
  const md = await page("/burn-ban", "text/markdown");
  has(md, "## Neighboring counties\n\n- **Burn ban:** Brazoria, Chambers\n- **No burn ban:** Liberty, Montgomery\n", "Markdown section");
}
{
  const q = "Is this the burn ban for Crosby County?";
  const html = await page("/burn-ban");
  has(html, `<summary>${q}</summary><p>No. This page is for Crosby, the community in Harris County near Houston. Crosby County is a different county in West Texas, next to Lubbock County,`, "Crosby County FAQ");
  has(html, "use the statewide “Texas burn ban map” in the list of sources below.", "…pointing at a link that exists");
  has(html, ">Texas burn ban map</a>", "…which is on the page");
  has(await page("/es/burn-ban"), "<summary>¿Esta es la prohibición de quemas del condado de Crosby?</summary>", "Spanish Crosby County FAQ");
  has(await page("/burn-ban", "text/markdown"), `### ${q}\n\nNo. This page is for Crosby`, "Markdown Crosby County FAQ");
}
{
  const entry = await h.kv.get("burnban", "json");
  entry.neighbors = [{ county: "Brazoria", status: "Yes" }, { county: "Waller", status: "Yes" }];
  await h.kv.put("burnban", JSON.stringify(entry));
  const html = await page("/burn-ban");
  has(html, "<p><strong>Burn ban:</strong> Brazoria, Waller</p>", "every neighbor banned");
  ok(!html.includes("<strong>No burn ban:</strong>"), "…shows no empty \"No burn ban\" line");
}
{
  const entry = await h.kv.get("burnban", "json");
  delete entry.neighbors;
  await h.kv.put("burnban", JSON.stringify(entry));
  const html = await page("/burn-ban");
  ok(!html.includes('class="nb"'), "an entry without neighbors shows no strip");
  ok(html.includes("Burn ban in effect"), "…and the Harris status is unaffected");
}

if (failures.length) {
  console.error(`\nBurn-ban neighbor checks failed (${failures.length}):\n  ${failures.join("\n  ")}\n`);
  process.exit(1);
}
console.log("Burn-ban neighbors OK — one query for Harris and its seven neighbors, bad rows dropped without failing Harris, strip rendered in both languages and Markdown.");
process.exit(0);
