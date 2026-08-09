// Pin the contract for how we decode HTML entities out of Google News titles.
//
// This exists because of a real vulnerability, found by CodeQL as alert #4
// (js/double-escaping). decodeEntities() used to decode in STAGES:
//
//     .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&")
//     .replace(/&lt;/g,"<").replace(/&gt;/g,">")
//
// `&amp;` became `&` on the third call, and then the fourth and fifth calls
// re-scanned that output — so `&amp;lt;script&amp;gt;` decoded to `&lt;script&gt;`
// and then to a live `<script>`. One level of encoding was silently stripped
// twice. The numeric decoders had the same shape (`&#38;lt;` took the same
// route).
//
// The reason this is worth a test and not just a fix is where the output goes.
// A decoded title is written to the `news` KV key and rendered on both paths,
// and only ONE of them escapes: src/features/home.js emits markdown as
// `- [${n.title}](${n.link})` — verbatim, no esc(). So the Worker's HTML
// escaping is not a backstop, and any markdown consumer that renders HTML would
// have executed the payload. A future refactor that "simplifies" the single
// regex back into a readable chain of .replace()s would reintroduce it, with
// nothing failing.
//
// So: pin single-level decoding, and pin it against the double-encoded shapes
// that were exploitable. Pure string work, no network.
//
// Run: node scripts/test-decode-entities.mjs

import { decodeEntities } from "./fetch-news.mjs";

let failures = 0;
const check = (label, got, want) => {
  if (got === want) {
    console.log(`  PASS  ${label} → ${JSON.stringify(got)}`);
  } else {
    console.log(`  FAIL  ${label} → got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failures++;
  }
};

// The regression itself. Each of these decoded to live markup before the fix;
// each must now decode exactly one level and stay inert text.
console.log("decodeEntities — double-encoded input decodes ONE level only:");
check("&amp;lt; stays text", decodeEntities("&amp;lt;script&amp;gt;"), "&lt;script&gt;");
check("numeric &#38;lt; stays text", decodeEntities("&#38;lt;script&#38;gt;"), "&lt;script&gt;");
check("hex &#x26;lt; stays text", decodeEntities("&#x26;lt;img&#x26;gt;"), "&lt;img&gt;");
check("no live tag emitted", /<script>/.test(decodeEntities("&amp;lt;script&amp;gt;")), false);
check("triple-encoded peels one", decodeEntities("&amp;amp;lt;"), "&amp;lt;");

// Ordinary single-encoded entities must still decode — the fix must not turn
// into "stop decoding", which would leave &amp; visible in every headline.
console.log("\ndecodeEntities — normal single-encoded entities still decode:");
check("named amp", decodeEntities("Crosby &amp; Barrett Station"), "Crosby & Barrett Station");
check("named lt/gt", decodeEntities("&lt;b&gt;"), "<b>");
check("named quot", decodeEntities("&quot;quoted&quot;"), '"quoted"');
check("named apos", decodeEntities("it&apos;s"), "it's");
check("numeric apostrophe", decodeEntities("it&#39;s"), "it's");
check("numeric curly quote", decodeEntities("it&#8217;s"), "it’s");
check("hex apostrophe", decodeEntities("it&#x27;s"), "it's");
check("hex uppercase X and digits", decodeEntities("&#X2019;"), "’");

// Behavior that predates the fix and must be preserved.
console.log("\ndecodeEntities — preserved behavior:");
check("CDATA unwrapped", decodeEntities("<![CDATA[Hello]]>"), "Hello");
check("unknown entity left verbatim", decodeEntities("a&nbsp;b"), "a&nbsp;b");
check("bare ampersand untouched", decodeEntities("R&D"), "R&D");
check("trims", decodeEntities("  padded  "), "padded");
check("null-ish is empty", decodeEntities(null), "");
check("plain text unchanged", decodeEntities("Crosby ISD board meeting"), "Crosby ISD board meeting");

console.log(
  failures
    ? `\n${failures} entity-decoding check(s) FAILED\n`
    : `\nEntity decoding OK — one level only, normal entities still decode.\n`,
);
process.exit(failures ? 1 : 0);
