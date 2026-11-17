// A lift the Harris County Fire Marshal's Office announces before the Forest
// Service map shows it.
//
// On 2026-11-16 the office lifted the ban; the map still listed it the next
// morning. The fixture is the office's homepage as served on 2026-11-17. The
// cases below are the ways this could go wrong in the dangerous direction: an
// old "lifted" slide hiding a new ban.
//
// Run: node scripts/test-burnban-hcfmo.mjs

import { readFile } from "node:fs/promises";
import { createHarness } from "./lib/harness.mjs";
import { parseHcfmoLift, applyHcfmoLift, burnbanHistory, burnbanSince, HCFMO_HOME_URL } from "../src/features/burnban.js";
import { recordBurnBan } from "../src/record.js";

const failures = [];
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${what}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const has = (text, needle, what) => { if (!text.includes(needle)) failures.push(`${what}: missing ${JSON.stringify(needle)}`); };

const home = await readFile(new URL("./fixtures/hcfmo/home-2026-11-17.html", import.meta.url), "utf8");

// --- reading the homepage ---
eq(parseHcfmoLift(home), "2026-11-16", "the real homepage: lifted November 16, 2026");
eq(parseHcfmoLift('<img alt="Graphic announcing that the burn ban in unincorporated Harris County has been lifted, effective December 5, 2025.">'), "2025-12-05", "the alt text alone is enough");
eq(parseHcfmoLift("<p>The burn ban in unincorporated Harris County was lifted on 11/25/2024.</p>"), "2024-11-25", "a numeric date");
eq(parseHcfmoLift("<p>Harris County Commissioners Court Approves Burn Ban 12/20/2021</p>"), null, "no lift statement, no lift");
eq(parseHcfmoLift(home + "<p>Harris County Commissioners Court approved a burn ban effective March 2, 2027.</p>"), null, "a newer ban on the same page cancels an older lift");
eq(parseHcfmoLift(home + "<p>A burn ban is now in place for unincorporated areas of Harris County, effective today 3/2/2027.</p>"), null, "…in the office's other wording too");
eq(parseHcfmoLift(""), null, "an empty page");

// --- applying it to the map's reading ---
const map = { updated: "2026-11-17T08:00:00Z", status: "Yes", startDate: "2026-09-17T06:00:00.000Z", neighbors: [] };
eq(
  applyHcfmoLift(map, "2026-11-16"),
  { ...map, status: "No", startDate: null, mapStatus: "Yes", mapStartDate: "2026-09-17T06:00:00.000Z", liftedBy: { day: "2026-11-16", url: HCFMO_HOME_URL } },
  "a lift after the map's start date overrides the map, keeping its reading beside it"
);
eq(applyHcfmoLift({ ...map, startDate: "2027-03-02T06:00:00.000Z" }, "2026-11-16"), { ...map, startDate: "2027-03-02T06:00:00.000Z" }, "an old lift never hides a newer ban");
eq(applyHcfmoLift({ ...map, startDate: null }, "2026-11-16"), { ...map, startDate: null }, "no start date on the map, no override");
eq(applyHcfmoLift({ ...map, status: "No", startDate: null }, "2026-11-16"), { ...map, status: "No", startDate: null }, "it never starts a ban and never touches a No");
eq(applyHcfmoLift(map, null), map, "no lift found, the map stands");

// --- once the map catches up, the office's day stays ---
const lifted = burnbanHistory({ status: "Yes", statusSince: "2026-09-17T21:45:46Z", trackingSince: "2026-08-24T17:45:30Z" }, applyHcfmoLift(map, "2026-11-16"));
const caughtUp = burnbanHistory(lifted, { updated: "2026-11-18T15:00:00Z", status: "No", startDate: null, neighbors: [] });
eq([caughtUp.status, caughtUp.liftedBy, caughtUp.mapStatus, caughtUp.statusSince], ["No", { day: "2026-11-16", url: HCFMO_HOME_URL }, undefined, lifted.statusSince], "the map's later No keeps the office's lift day and drops the map's old Yes");
eq(burnbanSince(caughtUp, "en"), "Lifted by the Harris County Fire Marshal's Office on November 16, 2026.", "…and the page says only who lifted it and when");
const next = burnbanHistory(caughtUp, { updated: "2027-03-02T15:00:00Z", status: "Yes", startDate: "2027-03-02T06:00:00.000Z", neighbors: [] });
eq(next.liftedBy, undefined, "a new ban drops the old lift");

// --- the record closes on the Fire Marshal's day ---
const h = await createHarness();
await h.env.DB.prepare("INSERT INTO burnban_periods (started, ended, start_source) VALUES ('2026-09-17', NULL, 'tfs')").run();
await recordBurnBan(h.env, applyHcfmoLift(map, "2026-11-16"), "2026-11-17T09:00:00Z");
eq(await h.env.DB.prepare("SELECT ended, end_source, end_url FROM burnban_periods WHERE started = '2026-09-17'").first(), { ended: "2026-11-16", end_source: "fmo", end_url: HCFMO_HOME_URL }, "closed on Nov 16, credited to the Fire Marshal's Office");
await h.env.DB.prepare("INSERT INTO burnban_periods (started, ended, start_source) VALUES ('2027-03-02', NULL, 'tfs')").run();
await recordBurnBan(h.env, { status: "No", startDate: null }, "2027-04-01T15:00:00Z");
eq(await h.env.DB.prepare("SELECT ended, end_source, end_url FROM burnban_periods WHERE started = '2027-03-02'").first(), { ended: "2027-04-01", end_source: "observed", end_url: null }, "a lift seen only on the map is dated the day it was seen");

// --- what the pages say ---
const h2 = await createHarness({ mutate: (v) => { v.burnban = { ...applyHcfmoLift({ ...v.burnban, neighbors: v.burnban.neighbors ?? [] }, "2026-11-16") }; } });
const page = async (path, accept = "text/html") => (await h2.get(path, { headers: { accept } })).text();
const bb = await page("/burn-ban");
has(bb, "No burn ban in Harris County", "/burn-ban: the status panel");
has(bb, "Lifted by the Harris County Fire Marshal's Office on November 16, 2026. The Texas A&amp;M Forest Service map still lists a ban.", "/burn-ban: who lifted it, and that the map disagrees");
has(await page("/es/burn-ban"), "Levantada por la Oficina del Jefe de Bomberos del condado de Harris el 16 de noviembre de 2026.", "/es/burn-ban: the same in Spanish");
const api = JSON.parse(await page("/api/burn-ban", "application/json"));
eq([api.status, api.mapStatus, api.liftedBy], ["No", "Yes", { day: "2026-11-16", url: HCFMO_HOME_URL }], "/api/burn-ban: No, with the map's Yes and the announcement beside it");
if ((await page("/")).includes("Burn ban in effect")) failures.push("/: still shows the burn-ban banner");

if (failures.length) {
  console.error(`Fire Marshal lift checks failed (${failures.length}):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("Fire Marshal lift OK — read from the real homepage, applied only to a ban it can follow, recorded on its own day, and said on the page.");
