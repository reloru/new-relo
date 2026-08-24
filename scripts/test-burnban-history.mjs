// burnbanHistory / burnbanSince — the burn-ban status-history invariant.
//
// Why this file exists: the failure mode here is a SENTENCE THAT READS FINE
// AND IS FALSE. If statusSince is rendered without checking it against
// trackingSince, a freshly deployed feed says "No ban reported in our checks
// since August 24, 2026" — which a reader takes as "a ban ended that day".
// Nothing throws, nothing 500s, the page looks healthy, and the claim is
// invented. `node --check` cannot see it and a render test cannot see it,
// because the output is well-formed either way.
//
// So the assertions below are mostly about what the page must NOT say.

import { burnbanHistory, burnbanSince } from "../src/features/burnban.js";

let failed = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`}`);
};
const checkThat = (label, cond) => {
  if (!cond) failed++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`);
};

const T0 = "2026-08-01T12:00:00.000Z"; // first ever observation
const T1 = "2026-08-10T12:00:00.000Z"; // a witnessed change
const T2 = "2026-08-24T12:00:00.000Z"; // now

console.log("\nburnbanHistory — which stamp moves, and when:\n");

// A cold start has no history to carry, so both stamps are this instant. That
// is the state that must NOT later render as a transition.
const first = burnbanHistory(null, { updated: T2, status: "No", startDate: null });
check("first observation ever seeds both stamps to now", first.statusSince, T2);
check("...and trackingSince equals statusSince", first.trackingSince, T2);

// The common case: same status, later check. Neither stamp may move, or
// "unchanged since" would silently reset on every refresh.
const same = burnbanHistory({ updated: T1, status: "No", statusSince: T1, trackingSince: T0 }, { updated: T2, status: "No", startDate: null });
check("unchanged status keeps statusSince", same.statusSince, T1);
check("unchanged status keeps trackingSince", same.trackingSince, T0);

// A real flip: statusSince moves, trackingSince never does.
const flip = burnbanHistory({ updated: T1, status: "No", statusSince: T1, trackingSince: T0 }, { updated: T2, status: "Yes", startDate: null });
check("a status flip moves statusSince to now", flip.statusSince, T2);
check("a status flip leaves trackingSince alone", flip.trackingSince, T0);

// Entries written before this shipped carry neither stamp. Collapsing to
// "no observed history yet" is the honest degradation — NOT inheriting the
// old `updated` as if it were a transition we witnessed.
const legacy = burnbanHistory({ updated: T1, status: "No" }, { updated: T2, status: "No", startDate: null });
check("a pre-history entry collapses to no-history-yet", legacy.statusSince, T2);
check("...and does not back-date trackingSince from `updated`", legacy.trackingSince, T2);

// A corrupt entry can still legitimately carry trackingSince.
const salvage = burnbanHistory({ status: null, trackingSince: T0 }, { updated: T2, status: "No", startDate: null });
check("an unusable prev still preserves trackingSince", salvage.trackingSince, T0);
check("...while statusSince starts fresh", salvage.statusSince, T2);

console.log("\nburnbanSince — the sentence, and the one it must never write:\n");

const NEVER = /reported in our checks since|reportada en nuestras verificaciones desde/;

// THE case this file exists for.
const fresh = burnbanSince({ status: "No", statusSince: T2, trackingSince: T2 }, "en");
checkThat("no witnessed change says 'began tracking'", /began tracking/.test(fresh));
checkThat("no witnessed change NEVER implies a transition", !NEVER.test(fresh));
const freshEs = burnbanSince({ status: "No", statusSince: T2, trackingSince: T2 }, "es");
checkThat("...same in Spanish", /empezamos a monitorear/.test(freshEs) && !NEVER.test(freshEs));

// Once a change is actually witnessed, claiming the date is honest.
const witnessed = burnbanSince({ status: "No", statusSince: T1, trackingSince: T0 }, "en");
checkThat("a witnessed change may claim the date", NEVER.test(witnessed));

// An active ban prefers TFS's authoritative startDate over our polling.
const banned = burnbanSince({ status: "Yes", startDate: T1, statusSince: T2, trackingSince: T0 }, "en");
checkThat("an active ban quotes TFS's startDate", /In effect since/.test(banned));
checkThat("...and does not substitute our own observation", !/our checks/.test(banned));

// No authoritative date and nothing witnessed: say nothing at all.
check("a ban with no date and no history stays silent", burnbanSince({ status: "Yes", startDate: null, statusSince: T2, trackingSince: T2 }, "en"), "");

// Unknown / missing status can never produce a history claim.
check("unknown status says nothing", burnbanSince({ status: null, statusSince: T2, trackingSince: T0 }, "en"), "");
check("absent data says nothing", burnbanSince(undefined, "en"), "");
check("a status with no stamps says nothing", burnbanSince({ status: "No" }, "en"), "");

// End-to-end: a cold start fed straight through must be silent about
// transitions, in BOTH languages.
for (const lang of ["en", "es"]) {
  const line = burnbanSince(burnbanHistory(null, { updated: T2, status: "No", startDate: null }), lang);
  checkThat(`cold start -> history -> sentence invents no transition (${lang})`, line !== "" && !NEVER.test(line));
}

console.log(
  failed === 0
    ? "\nBurn-ban history OK — statusSince is only claimed as a transition once one was actually observed.\n"
    : `\n${failed} check(s) FAILED\n`
);
process.exit(failed === 0 ? 0 : 1);
