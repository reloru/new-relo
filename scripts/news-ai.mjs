// Workers AI helpers for scripts/fetch-news.mjs (the out-of-band news routine).
//
// Two models, both called over the REST API with the routine's existing
// CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID (both are preview models):
//   - @cf/cloudflare/clef    — per-headline yes/no probabilities: is it about
//     Crosby, about a nearby town, and is it a single news story (vs. an index,
//     gallery, schedule, or obituary page)?
//   - @cf/cloudflare/clairic — reads the date an announced event takes place,
//     relative to the headline's publish date ("this Saturday", "5/12").
//
// INVARIANT: AI only ever ADDS caution or rescues with a high bar. Every
// failure (HTTP error, timeout, malformed answer) returns null, and callers
// treat null as "no opinion" — the regex pipeline's behavior is unchanged. The
// routine must never abort or write a partial snapshot because a preview model
// is down. Disable entirely with NEWS_AI=0 (used to diff before/after).
//
// Thresholds were set against 77 live Google News headlines + 18 synthetic
// ones (docs/ops/news-pipeline.md). They are deliberately asymmetric.

export const THRESH = {
  // Items the regex already accepted are dropped only if the model is clearly
  // saying "this is not a story" (index / gallery / schedule / obituary pages
  // scored <= 0.28 live; real stories scored mostly > 0.9).
  storyVeto: 0.5,
  // Items the regex dropped ONLY for lacking Texas/Harris County context are
  // rescued only on strong agreement. "Require more" for expansion.
  rescueStory: 0.8,
  rescueCore: 0.8, // headline names Crosby: P(about Crosby, TX)
  rescueNear: 0.9, // headline names Baytown/Atascocita/...: P(about that TX town)
  // Regex-accepted items must still look like the right place. Real Crosby
  // headlines scored >= 0.77 live; the St. Louis "Barrett Station Road"
  // headlines the regex used to admit scored 0.23-0.47.
  coreMin: 0.5,
  // A nearby-town INCIDENT (Baytown shooting, Atascocita crash...) needs the
  // model to be nearly certain of the town, plus a story score >= rescueStory.
  nearIncident: 0.95,
  // Event dates from clairic count only when it is sure there IS a date.
  eventConfidence: 0.9,
  eventMaxPNull: 0.1,
};

const CLEF = "clef";
const CLAIRIC = "clairic";

const QUESTIONS = {
  crosby_tx: {
    type: "noul",
    instructions:
      "Is this headline about Crosby, Texas (Harris County, 77532) or its immediate community: Crosby ISD, Barrett Station, Newport? Not Crosby in England, Minnesota, Connecticut, or Crosbyton TX, and not a person named Crosby.",
  },
  nearby_tx: {
    type: "noul",
    instructions: "Is this about Huffman, Highlands, Baytown, Atascocita, Channelview, Kingwood or Dayton, Texas?",
  },
  is_story: {
    type: "noul",
    instructions:
      "Is this a single news story about a specific event or issue, as opposed to an index, gallery, video list, schedule, standings page, listing, or obituary?",
  },
};

export const aiEnabled = () => process.env.NEWS_AI !== "0";

async function aiRun({ account, token, model, body, fetchImpl = fetch, timeoutMs = 20000 }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/${model}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ model, ...body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.success && j.result?.answers) return j.result.answers;
      if (r.status !== 429 && r.status < 500) return null; // 4xx other than rate-limit: retrying won't help
    } catch {
      /* timeout / network: retry once, then give up */
    }
  }
  return null;
}

// Run fn over items with bounded concurrency.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

const prob = (a) => (a && typeof a.noul === "number" && Number.isFinite(a.noul) ? a.noul : null);

// titles -> Map(title -> { crosby, near, story } | null). `title` is the full RSS
// title including " - Source", which is what the thresholds were tuned on.
export async function judgeHeadlines(titles, { account, token, fetchImpl, concurrency = 8 } = {}) {
  const uniq = [...new Set(titles)];
  const result = new Map(uniq.map((t) => [t, null]));
  if (!aiEnabled() || !account || !token || !uniq.length) return result;
  await mapLimit(uniq, concurrency, async (title) => {
    const a = await aiRun({ account, token, model: CLEF, body: { state: title, questions: QUESTIONS }, fetchImpl });
    const v = { crosby: prob(a?.crosby_tx), near: prob(a?.nearby_tx), story: prob(a?.is_story) };
    result.set(title, v.crosby == null || v.near == null || v.story == null ? null : v);
  });
  return result;
}

// kind: "core" | "near" (regex accepted) or "maybeCore" | "maybeNear" (regex
// dropped for missing context only). verdict: judgeHeadlines() value or null.
// crime: the headline is an incident (arrest, shooting, crash...).
//
// With no verdict (AI off / failing) the regex result stands, except that
// nothing is rescued and nearby-town INCIDENTS are dropped: they are only
// eligible on the model's say-so.
export function aiDecision(kind, verdict, { crime = false } = {}) {
  const rescue = kind === "maybeCore" || kind === "maybeNear";
  const nearby = kind === "near" || kind === "maybeNear";
  if (!verdict) return { keep: !rescue && !(nearby && crime), why: "no-ai" };
  if (rescue) {
    const placeOk = kind === "maybeCore" ? verdict.crosby >= THRESH.rescueCore : verdict.near >= THRESH.rescueNear;
    const barOk = placeOk && verdict.story >= THRESH.rescueStory && (!crime || kind === "maybeCore" || verdict.near >= THRESH.nearIncident);
    return barOk ? { keep: true, why: "rescued" } : { keep: false, why: "rescue-bar" };
  }
  if (verdict.story < THRESH.storyVeto) return { keep: false, why: "not-a-story" };
  if (kind === "core") {
    return verdict.crosby >= THRESH.coreMin ? { keep: true, why: "ok" } : { keep: false, why: "wrong-place" };
  }
  // near, regex-accepted
  if (Math.max(verdict.near, verdict.crosby) < THRESH.coreMin) return { keep: false, why: "wrong-place" };
  if (crime && !(verdict.near >= THRESH.nearIncident && verdict.story >= THRESH.rescueStory)) {
    return { keep: false, why: "incident-bar" };
  }
  return { keep: true, why: "ok" };
}

// Is a clairic event_date answer a confident, now-past date for an event that
// was announced before it happened? Same safeguard ordering as the regex path:
// pubTs < eventTs < now.
export function isStaleFromAnswer(answer, pubTs, now) {
  if (!answer || typeof answer.value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(answer.value);
  if (!m) return false;
  if (!(answer.confidence >= THRESH.eventConfidence) || !(answer.p_null <= THRESH.eventMaxPNull)) return false;
  const eventTs = Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59);
  return pubTs < eventTs && eventTs < now;
}

// items: [{ title, pubTs }]. Returns Set of indexes whose announced event has
// passed. `hasCue(title)` is the caller's event/scheduling-cue test, so a news
// story that merely mentions a date is never sent here (or dropped).
export async function staleEventIndexes(items, now, hasCue, { account, token, fetchImpl, concurrency = 8 } = {}) {
  const stale = new Set();
  if (!aiEnabled() || !account || !token) return stale;
  const idx = items.map((_, i) => i).filter((i) => hasCue(items[i].title));
  await mapLimit(idx, concurrency, async (i) => {
    const { title, pubTs } = items[i];
    const a = await aiRun({
      account,
      token,
      model: CLAIRIC,
      fetchImpl,
      body: {
        state: title,
        reference_date: new Date(pubTs).toISOString().slice(0, 10),
        fields: {
          event_date: {
            type: "date",
            instructions:
              "The date on which a future event announced in this headline takes place. Null if the headline announces no upcoming event.",
          },
        },
      },
    });
    if (isStaleFromAnswer(a?.event_date, pubTs, now)) stale.add(i);
  });
  return stale;
}
