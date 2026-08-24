// Harris County outdoor-burning ban status from the Texas A&M Forest Service.
//
// Burn bans are COUNTYWIDE ONLY — TFS has no sub-county resolution, so this
// page never implies anything finer-grained than "Harris County." TFS's feed
// updates roughly daily (county judges declare/lift bans by order, not on a
// schedule), so the cron throttles this to ~12h rather than every tick.
// Worker reachability to gis.tfs.tamu.edu was canary-verified from the
// deployed runtime (200, real body) before this shipped.
//
// SAFETY FRAMING — the reason this page is more than a status flag. "No burn
// ban" is NOT "you may burn": Texas prohibits outdoor burning statewide (30
// TAC 111.201) and then carves out exceptions, so the county's status is one
// condition among several. Two specifics this page must never blur:
//
//   * Household trash. The domestic-waste exception applies only where the
//     local government does NOT provide garbage collection. Crosby has
//     collection, so burning household trash is effectively never allowed
//     here — an earlier draft of this page listed "trash burning" as an
//     example of what a BAN prohibits, which implied the opposite the rest
//     of the year. Don't reintroduce that framing.
//   * Scope. A Harris County ban is issued by the county judge /
//     Commissioners Court and covers the UNINCORPORATED county — which is
//     where Crosby is. Incorporated cities inside the county set their own
//     rules, so "anywhere in the county" is wrong.
//
// The concrete thresholds quoted on the page (wind 6–23 mph, one hour after
// sunrise to one hour before sunset, 300 ft from neighbouring structures,
// the never-burn material list) are the real requirements in 30 TAC 111.219,
// not general advice. Check the rule before editing any of those numbers.

import { T, canonicalFor, hreflangTags, esPath, translateDir } from "../i18n.js";
import { esc, fmt, fullTime } from "../lib/format.js";
import { pop, currentHourly } from "../lib/derived.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON } from "../seo.js";

export const BURNBAN_KV_KEY = "burnban";

// TFS's public ArcGIS FeatureServer, queried for Harris County only. The
// where clause is passed verbatim (unencoded) — canary-verified to work as-is
// from the deployed Worker; encoding it differently is untested.
export const BURNBAN_QUERY_URL =
  "https://gis.tfs.tamu.edu/arcgis/rest/services/EOC/BurnBan/FeatureServer/0/query?where=County='Harris'&outFields=County,BurnBan,StartDate,FIPS&returnGeometry=false&f=json";

export const BURNBAN_OFFICIAL_URL = "https://tfsweb.tamu.edu/wildfire-and-other-disasters/burn-bans-and-information/";
// The Harris County Fire Marshal's Office is the LOCAL authority — TFS only
// tracks and republishes what counties report, and says so in its own
// disclaimer. Anyone acting on this page should end up here.
export const BURNBAN_COUNTY_URL = "https://www.hcfmo.net/Resources/Wildfire-Burn-Bans";
// TCEQ's "Outdoor Burning in Texas" (RG-049) — the statewide rules that apply
// with or without a county ban.
export const BURNBAN_STATE_RULES_URL = "https://www.tceq.texas.gov/goto/rg-049";

// Shared content objects. The site-wide rule is that a page's HTML and
// Markdown render from ONE object so the two cannot drift; these are that
// object for the checklist and FAQ. `path` is an English internal path (each
// renderer localizes it its own way — relative for HTML, absolute for
// Markdown); `url` is an external absolute link.

// What actually has to line up before lighting an outdoor fire near Crosby.
// Ordered so the county status (this page's own subject) comes first and the
// things people forget come last.
//
// Headings are written as INSTRUCTIONS ("Make sure...", "Check..."), not as
// noun labels. "The material is allowed" reads like an assertion the site is
// making on the reader's behalf; "Know what you're allowed to burn" reads
// like the task it actually is. Keep everyday words — no "in force",
// "controls", "permitted under", or anything else nobody says out loud.
export function burnbanChecklist(lang) {
  return [
    {
      h: T(lang, "Make sure there's no county burn ban", "Asegúrate de que no haya prohibición del condado"),
      p: T(
        lang,
        "The status at the top of this page covers unincorporated Harris County, which is where Crosby is.",
        "El estado al inicio de esta página cubre el condado de Harris no incorporado, que es donde está Crosby."
      ),
    },
    {
      h: T(lang, "Check for a Red Flag Warning", "Revisa si hay una alerta de bandera roja"),
      p: T(
        lang,
        "A Red Flag Warning or Fire Weather Watch means fire spreads dangerously fast that day. Any active one shows in the conditions above, and on our alerts page with everything else the National Weather Service has out for Crosby.",
        "Una alerta de bandera roja (Red Flag Warning) o una vigilancia de clima de incendios (Fire Weather Watch) significa que ese día el fuego se propaga peligrosamente rápido. Si hay alguna activa aparece en las condiciones de arriba, y en nuestra página de alertas junto con todo lo demás que el Servicio Meteorológico Nacional tenga vigente para Crosby."
      ),
      path: "/alerts",
      label: T(lang, "See all active alerts", "Ver todas las alertas activas"),
    },
    {
      h: T(lang, "Check the wind and the time of day", "Revisa el viento y la hora del día"),
      p: T(
        lang,
        "Texas only allows burning when the wind is between 6 and 23 mph, and only from an hour after sunrise to an hour before sunset.",
        "Texas solo permite quemar cuando el viento está entre 6 y 23 mph, y únicamente desde una hora después del amanecer hasta una hora antes del atardecer."
      ),
      path: "/weather",
      label: T(lang, "Current conditions", "Condiciones actuales"),
    },
    {
      h: T(lang, "Know what you're allowed to burn", "Infórmate sobre qué puedes quemar"),
      p: T(
        lang,
        "Never burn plastics, tires or rubber, treated lumber, construction debris, chemicals, or heavy oils. Burning household trash is a separate question — see below.",
        "Nunca quemes plásticos, llantas o hule, madera tratada, escombros de construcción, químicos ni aceites pesados. Quemar basura doméstica es un tema aparte — míralo más abajo."
      ),
      url: BURNBAN_STATE_RULES_URL,
      label: T(lang, "Texas outdoor burning rules", "Reglas de quemas al aire libre de Texas"),
    },
    {
      h: T(lang, "Make sure you can control the fire", "Asegúrate de poder controlar el fuego"),
      p: T(
        lang,
        "Someone stays with the fire until it is completely out, water and hand tools are within reach, and the fire is at least 300 feet from your neighbors' homes.",
        "Alguien se queda con el fuego hasta que se apague por completo, hay agua y herramientas al alcance, y el fuego está al menos a 300 pies de las casas de tus vecinos."
      ),
    },
    {
      h: T(lang, "Check for local restrictions", "Revisa las restricciones locales"),
      p: T(
        lang,
        "An HOA, subdivision, or deed restriction can prohibit burning even when the county hasn't.",
        "Una asociación de vecinos (HOA), un fraccionamiento o una restricción de escritura puede prohibir las quemas aunque el condado no lo haya hecho."
      ),
    },
  ];
}

// The questions this page actually gets asked. Answers stay conservative:
// where the controlling detail lives in a county order we can't read from the
// feed, the answer says so and points at the order rather than guessing.
export function burnbanFaq(lang) {
  return [
    {
      q: T(lang, "Does “no burn ban” mean I can burn anything?", "¿«Sin prohibición» significa que puedo quemar lo que sea?"),
      a: T(
        lang,
        "No. Texas has its own rules about what you can burn and when, and they apply whether or not the county has a ban in place. Whether the county has banned burning is just one of the things that has to line up — the checklist above covers the rest.",
        "No. Texas tiene sus propias reglas sobre qué puedes quemar y cuándo, y aplican haya o no una prohibición del condado. Que el condado haya prohibido quemar es solo una de las cosas que deben cumplirse — la lista de arriba cubre las demás."
      ),
    },
    {
      q: T(lang, "Can you burn trash in Crosby?", "¿Se puede quemar basura en Crosby?"),
      a: T(
        lang,
        "Almost never. Texas lets people burn household trash only where the local government doesn't pick up garbage, and Crosby has collection — so that exception doesn't cover most homes here. Put it out for pickup instead. This is true whether or not there's a burn ban.",
        "Casi nunca. Texas permite quemar basura doméstica solo donde el gobierno local no recoge la basura, y en Crosby sí hay recolección — así que esa excepción no cubre a la mayoría de las casas de aquí. Mejor sácala para que la recojan. Esto aplica haya o no una prohibición de quemas."
      ),
    },
    {
      q: T(lang, "Is there a separate Crosby burn ban?", "¿Existe una prohibición de quemas propia de Crosby?"),
      a: T(
        lang,
        "No. Crosby is unincorporated, so Harris County's ban is the one that applies here — there is no separate Crosby ban and no separate Crosby status to look up. HOA and deed restrictions are a different matter and can still apply.",
        "No. Crosby no está incorporado, así que la prohibición del condado de Harris es la que aplica aquí — no hay una prohibición ni un estado separado para Crosby. Las restricciones de HOA y de escritura son otra cosa y sí pueden aplicar."
      ),
    },
    {
      q: T(lang, "What about grills, fire pits, and cooking fires?", "¿Y las parrillas, fogatas y fuegos para cocinar?"),
      a: T(
        lang,
        "Every county writes its ban a little differently, so the exceptions depend on the one currently in place. Harris County's recent bans have still allowed backyard cooking like barbecues, approved ceremonial fires, and fires kept fully inside something that holds in the flames and sparks.",
        "Cada condado redacta su prohibición un poco distinto, así que las excepciones dependen de la que esté vigente. Las prohibiciones recientes del condado de Harris han seguido permitiendo cocinar en el patio, como asados, fogatas ceremoniales aprobadas y fuegos dentro de algo que contenga por completo las llamas y las chispas."
      ),
    },
    {
      q: T(lang, "What if a fire gets away from me?", "¿Qué hago si un fuego se sale de control?"),
      a: T(
        lang,
        "Call 911 immediately — a grass fire moving with the wind outruns a person quickly, and it is not worth chasing. Before you light anything, have a charged garden hose or filled buckets within reach and a rake or shovel to pull fuel away from the edge.",
        "Llama al 911 de inmediato — un incendio de pasto que avanza con el viento le gana a una persona rápidamente y no vale la pena perseguirlo. Antes de encender algo, ten a la mano una manguera con agua o cubetas llenas y un rastrillo o pala para retirar el combustible del borde."
      ),
    },
  ];
}

// NWS event names that mean "conditions are dangerous for fire". Matched
// against the alert's `event` only — the free-form body stays untouched
// official English and is never parsed for meaning.
export const FIRE_WEATHER_RE = /red flag warning|fire weather watch|extreme fire danger/i;

// Live fire-weather context for the burn-ban page, from the same NWS cache
// every weather page uses.
//
// ASYMMETRIC BY DESIGN, and this is the whole point: this block may tell a
// reader that something is NOT permitted — wind outside the 6–23 mph window
// the state rule requires, or an active Red Flag Warning — but it must NEVER
// signal that burning IS permitted. "Wind is fine" would be read as
// permission, and legality here depends on the county order, the material,
// the time of day, and local restrictions that no weather feed can see.
// Only ever add negative signals to this function.
//
// Returns null when there is nothing to say, so the strip self-hides rather
// than rendering an empty shell — and a weather-cache failure degrades the
// burn-ban page to exactly what it was before this existed.
export function burnbanFireWeather(weather, lang) {
  const now = currentHourly(weather);
  const alerts = (weather?.alerts ?? [])
    .filter((a) => FIRE_WEATHER_RE.test(String(a?.event ?? "")))
    // Event names are official NWS text and stay in English in both languages,
    // the same policy the alerts page follows.
    .map((a) => String(a.event));
  if (!now && !alerts.length) return null;

  const rows = [];
  const nums = (s) => (String(s ?? "").match(/\d+/g) ?? []).map(Number);
  const windNums = nums(now?.windSpeed);
  const gustNums = nums(now?.windGust);

  if (now?.windSpeed) {
    const dir = now.windDirection ? ` ${translateDir(now.windDirection, lang)}` : "";
    rows.push([T(lang, "Wind", "Viento"), `${now.windSpeed}${dir}`]);
  }
  if (gustNums.length) rows.push([T(lang, "Gusts", "Rachas"), `${Math.max(...gustNums)} mph`]);
  const rh = now?.relativeHumidity?.value;
  if (typeof rh === "number") rows.push([T(lang, "Humidity", "Humedad"), `${Math.round(rh)}%`]);
  if (now) rows.push([T(lang, "Rain chance", "Prob. de lluvia"), `${pop(now)}%`]);

  // The only verdicts allowed, both negative. A range that straddles a
  // boundary ("5 to 10 mph") deliberately produces NO note — we flag it only
  // when the whole range is outside what the rule permits.
  let windNote = "";
  if (windNums.length && Math.max(...windNums) < 6) {
    windNote = T(
      lang,
      "Wind is below the 6 mph minimum Texas requires for outdoor burning.",
      "El viento está por debajo del mínimo de 6 mph que Texas exige para quemar al aire libre."
    );
  } else if (windNums.length && Math.min(...windNums) > 23) {
    windNote = T(
      lang,
      "Wind is above the 23 mph maximum Texas allows for outdoor burning.",
      "El viento supera el máximo de 23 mph que Texas permite para quemar al aire libre."
    );
  } else if (gustNums.length && Math.max(...gustNums) > 23) {
    windNote = T(
      lang,
      "Gusts are above the 23 mph maximum Texas allows for outdoor burning.",
      "Las rachas superan el máximo de 23 mph que Texas permite para quemar al aire libre."
    );
  }

  return { rows, alerts, windNote };
}

// The paragraph that opens the "Before you burn" section. It HEADS that
// section rather than floating under the status panel, where it read as a
// detached cut-out and left the checklist it refers to looking unrelated.
//
// Wording note: an earlier version said Texas "restricts outdoor burning
// statewide whether or not a ban is in effect", which people read as a
// standing never-burn-anything order. Texas has RULES that always apply —
// about what you may burn and when — which is a different claim. Keep it that
// way. `<strong>` is the only markup allowed here; the Markdown view swaps it
// for `**`, so anything richer would leak tags into the text rendering.
export function burnbanLead(data, lang) {
  return data?.status === "Yes"
    ? T(
        lang,
        "<strong>A burn ban is in effect, so outdoor burning is off the table right now.</strong> When it lifts, here's what to check before you light anything.",
        "<strong>Hay una prohibición de quemas vigente, así que por ahora no se puede quemar al aire libre.</strong> Cuando se levante, esto es lo que debes revisar antes de encender algo."
      )
    : T(
        lang,
        "<strong>No burn ban doesn't automatically mean you can burn.</strong> Texas has its own rules about what you're allowed to burn and when, and those apply even when the county hasn't issued a ban. The day's weather matters too. Here's what to check first.",
        "<strong>Que no haya prohibición no significa automáticamente que puedas quemar.</strong> Texas tiene sus propias reglas sobre qué puedes quemar y cuándo, y aplican aunque el condado no haya emitido una prohibición. El clima del día también importa. Esto es lo que debes revisar primero."
      );
}

// The statewide burn-ban map and the drought map are LINKED, never embedded.
// Embedding either would need an origin proxy (the CSP allows no external
// image host) and would also pull in the Drought Monitor's reproduction
// attribution requirement — neither of which is worth it for a graphic that
// is statewide on a Harris-County page.
export const BURNBAN_MAP_URL = "https://tfsfrp.tamu.edu/wildfires/DecBan.png";
export const BURNBAN_DROUGHT_URL = "https://droughtmonitor.unl.edu/CurrentMap/StateDroughtMonitor.aspx?fips_48201";

// A findable resources list rather than a run-on row of links: this is a page
// people arrive at mid-decision, and the official sources are the thing they
// most often need to leave for. Ours first (they're one click and already
// local), then the authorities, then the reference maps.
export function burnbanResources(lang) {
  return [
    {
      path: "/alerts",
      label: T(lang, "Crosby weather alerts", "Alertas meteorológicas de Crosby"),
      note: T(lang, "Red Flag Warnings and every other active NWS alert for Crosby.", "Alertas de bandera roja y todas las demás alertas activas del NWS para Crosby."),
    },
    {
      path: "/weather",
      label: T(lang, "Crosby conditions and forecast", "Condiciones y pronóstico de Crosby"),
      note: T(lang, "Wind, humidity, and the rest of today's weather.", "Viento, humedad y el resto del clima de hoy."),
    },
    {
      path: "/emergency",
      label: T(lang, "Emergency resources", "Recursos de emergencia"),
      note: T(lang, "Who to call, including for a fire that gets away from you.", "A quién llamar, incluso si un fuego se sale de control."),
    },
    {
      url: BURNBAN_COUNTY_URL,
      label: T(lang, "Harris County Fire Marshal — burn bans", "Jefe de Bomberos del Condado de Harris — prohibiciones"),
      note: T(lang, "The local authority: the ban itself and its exceptions.", "La autoridad local: la prohibición y sus excepciones."),
    },
    {
      url: BURNBAN_STATE_RULES_URL,
      label: T(lang, "TCEQ — Outdoor Burning in Texas", "TCEQ — Quemas al aire libre en Texas"),
      note: T(lang, "The statewide rules on what may be burned, and when.", "Las reglas estatales sobre qué se puede quemar y cuándo."),
    },
    {
      url: BURNBAN_OFFICIAL_URL,
      label: T(lang, "Texas A&M Forest Service — burn bans", "Servicio Forestal de Texas A&M — prohibiciones"),
      note: T(lang, "Where this page's status comes from.", "De donde proviene el estado de esta página."),
    },
    {
      url: BURNBAN_MAP_URL,
      label: T(lang, "Texas burn ban map", "Mapa de prohibiciones de Texas"),
      note: T(lang, "Every county's current status, statewide.", "El estado actual de cada condado, en todo el estado."),
    },
    {
      url: BURNBAN_DROUGHT_URL,
      label: T(lang, "Drought conditions for Harris County", "Condiciones de sequía del condado de Harris"),
      note: T(lang, "Drought is what drives counties to issue a ban in the first place.", "La sequía es lo que lleva a los condados a emitir una prohibición."),
    },
  ];
}

// Fetch Harris County's current ban status. Throws on a non-200, on the
// error-shaped body ArcGIS can return with a 200 status for a malformed
// query, on a response missing the Harris County row, or on a BurnBan value
// that isn't "Yes"/"No" — so the cron aborts-without-writing and the last
// good status survives (the tropics/water pattern).
export async function fetchBurnBan() {
  const res = await fetch(BURNBAN_QUERY_URL, { headers: { "User-Agent": "crosbynews.com", Accept: "application/json" } });
  if (!res.ok) throw new Error(`TFS burn ban request failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.error) throw new Error(`TFS burn ban query error: ${JSON.stringify(json.error)}`);
  const feature = (json.features ?? []).find((f) => String(f.attributes?.County ?? "").trim() === "Harris");
  if (!feature) throw new Error("TFS burn ban response had no Harris County feature");
  const attrs = feature.attributes;
  // BurnBan is a STRING ("Yes"/"No"), not a boolean.
  const status = String(attrs.BurnBan ?? "").trim();
  if (status !== "Yes" && status !== "No") throw new Error(`TFS burn ban returned an unrecognized status: ${JSON.stringify(attrs.BurnBan)}`);
  // StartDate is epoch MILLISECONDS (or null when there's no active ban), not ISO.
  const startDate = Number.isFinite(attrs.StartDate) ? new Date(attrs.StartDate).toISOString() : null;
  return { updated: new Date().toISOString(), status, startDate };
}

// Merge a fresh observation onto the previous cached entry, carrying the
// status-history stamps forward. Pure and separate from the fetch so the cron
// and the cold-warm path share one definition (and so it is testable without
// a network or a KV).
//
// Two DIFFERENT stamps, and conflating them would make the page lie:
//
//   trackingSince — the first observation we ever recorded. Never moves.
//   statusSince   — the first observation of the CURRENT status. Moves only
//                   when the status actually flips.
//
// When they are equal we have never witnessed a change, so all we can honestly
// say is "unchanged for as long as we have been looking" — NOT "no ban since
// <date>", which would imply a ban ended that day. `burnbanSince()` below is
// what encodes that distinction; don't render statusSince without it.
//
// Entries written before this shipped have neither stamp. Feeding such an
// entry through here yields statusSince === trackingSince === now, i.e. "no
// observed history yet", which is the correct and honest degradation.
export function burnbanHistory(prev, next) {
  const prevStatus = prev?.status === "Yes" || prev?.status === "No" ? prev.status : null;
  return {
    ...next,
    // Carried forward only when the status is genuinely unchanged.
    statusSince: prevStatus === next.status && prev?.statusSince ? prev.statusSince : next.updated,
    trackingSince: prev?.trackingSince ?? next.updated,
  };
}

// Read the cached status, self-healing on a cold/malformed entry and
// degrading to an unknown-status shape on total failure (mirrors loadTropics).
export async function loadBurnBan(env) {
  let data = null;
  try {
    data = await env.WEATHER.get(BURNBAN_KV_KEY, "json");
  } catch (e) {
    console.error("KV burnban parse failed:", e && e.stack);
  }
  if (!data || (data.status !== "Yes" && data.status !== "No")) {
    try {
      // The unusable entry is still passed as `prev`: a malformed value can
      // legitimately carry a trackingSince worth preserving, and
      // burnbanHistory ignores its status.
      const warmed = burnbanHistory(data, await fetchBurnBan());
      await env.WEATHER.put(BURNBAN_KV_KEY, JSON.stringify(warmed));
      data = warmed;
    } catch (e) {
      console.error("burnban cold fetch failed:", e && e.stack);
      data = { updated: null, status: null, startDate: null, statusSince: null, trackingSince: null };
    }
  }
  return data;
}

// The one-line status-history sentence, or "" when we can't say anything
// honest. This is the whole point of tracking two stamps:
//
//   * An active ban prefers TFS's own startDate — that is authoritative, not
//     an inference from our polling.
//   * "No ban" only claims a date when we ACTUALLY WITNESSED the change
//     (statusSince > trackingSince). Otherwise it says "since we began
//     tracking", because "no ban since <date>" would otherwise read as "a ban
//     ended that day" when really that is just when we started looking.
//
// Resolution is bounded by the refresh cadence, so the wording says "in our
// checks" rather than asserting the exact hour a county order changed.
export function burnbanSince(data, lang) {
  if (data?.status !== "Yes" && data?.status !== "No") return "";
  const d = (iso) => fmt(iso, { dateStyle: "long" }, lang);
  if (data.status === "Yes") {
    if (data.startDate) return T(lang, `In effect since ${d(data.startDate)}.`, `Vigente desde el ${d(data.startDate)}.`);
    if (data.statusSince && data.statusSince !== data.trackingSince) {
      return T(lang, `First seen in our checks on ${d(data.statusSince)}.`, `Visto por primera vez en nuestras verificaciones el ${d(data.statusSince)}.`);
    }
    return "";
  }
  if (!data.statusSince) return "";
  return data.statusSince === data.trackingSince
    ? T(
        lang,
        `No ban in any check since we began tracking on ${d(data.trackingSince)}.`,
        `Sin prohibición en ninguna verificación desde que empezamos a monitorear el ${d(data.trackingSince)}.`
      )
    : T(
        lang,
        `No ban reported in our checks since ${d(data.statusSince)}.`,
        `Sin prohibición reportada en nuestras verificaciones desde el ${d(data.statusSince)}.`
      );
}

// JSON shape served at /api/burn-ban. `lastChecked` names the same instant
// as the cached `updated` field — the timestamp is internal-convention-named
// (matching every other feature's cache stamp, which cron.js's throttle gate
// and /api/health's change-fingerprinting both key on) but reads clearer to
// an API/MCP consumer as "when did we last check this."
export function apiBurnBan(data) {
  return {
    county: "Harris",
    source: "Texas A&M Forest Service (tfsweb.tamu.edu)",
    status: data.status ?? null,
    startDate: data.startDate ?? null,
    // When we FIRST OBSERVED the current status. Read it against
    // trackingSince: equal values mean we have never witnessed a change, so
    // this is just when we started looking — not a transition date.
    statusSince: data.statusSince ?? null,
    trackingSince: data.trackingSince ?? null,
    lastChecked: data.updated ?? null,
    officialUrl: BURNBAN_OFFICIAL_URL,
  };
}

export function burnbanHtml(data, lang, weather) {
  const title = T(lang, "Harris County Burn Ban Status", "Estado de la prohibición de quemas del condado de Harris");
  const desc = T(
    lang,
    "Is there a burn ban in Harris County, TX right now? Live outdoor-burning ban status for unincorporated Harris County — which includes Crosby — from the Texas A&M Forest Service, plus what Texas law still restricts when there is no ban.",
    "¿Hay una prohibición de quemas en el condado de Harris, TX ahora mismo? Estado en vivo de la prohibición de quemas al aire libre para el condado de Harris no incorporado — que incluye a Crosby — según el Servicio Forestal de Texas A&M, y qué restringe la ley de Texas cuando no hay prohibición."
  );
  const lk = (p) => (lang === "es" ? esPath(p) : p);

  const known = data.status === "Yes" || data.status === "No";
  const status = !known
    ? `<div class="status status-unknown" role="status"><span class="status-icon">&#10067;</span><div><p class="status-title">${T(lang, "Status unavailable", "Estado no disponible")}</p><p class="status-sub">${T(lang, "The Texas A&M Forest Service feed didn't return a status on the last check. Check with the Harris County Fire Marshal's Office below.", "El feed del Servicio Forestal de Texas A&M no devolvió un estado en la última verificación. Consulta con la Oficina del Jefe de Bomberos del Condado de Harris abajo.")}</p></div></div>`
    : data.status === "Yes"
      ? `<div class="status status-ban" role="status"><span class="status-icon">&#128293;</span><div><p class="status-title">${T(lang, "Burn ban in effect", "Prohibición de quemas vigente")}</p><p class="status-sub">${T(lang, "Outdoor burning is prohibited in unincorporated Harris County, which includes Crosby.", "Está prohibido quemar al aire libre en el condado de Harris no incorporado, que incluye a Crosby.")}</p></div></div>`
      : `<div class="status status-ok" role="status"><span class="status-icon">&#10004;</span><div><p class="status-title">${T(lang, "No burn ban in Harris County", "Sin prohibición de quemas en el condado de Harris")}</p><p class="status-sub">${T(lang, "The Texas A&M Forest Service is not reporting an active outdoor-burning ban for Harris County right now.", "El Servicio Forestal de Texas A&M no reporta una prohibición de quemas activa para el condado de Harris en este momento.")}</p></div></div>`;

  // Sits directly under the status panel: "how long has this been true" is a
  // trust signal in a way "we checked at 12:25 AM" is not.
  const since = burnbanSince(data, lang);
  const sinceLine = since ? `<p class="since">${esc(since)}</p>` : "";

  const lead = burnbanLead(data, lang);

  // Sits between the county status and the checklist: it is the live input to
  // checklist items 2 and 3, and it keeps the page worth reloading on a day
  // when the county status hasn't moved.
  const fw = burnbanFireWeather(weather, lang);
  const fwBlock = fw
    ? `<section class="fw">
    <h2>${T(lang, "Right now in Crosby", "Ahora mismo en Crosby")}</h2>
    ${fw.alerts.length ? `<p class="fw-alert">&#9888;&#65039; ${esc(fw.alerts.join(" · "))} &mdash; <a href="${lk("/alerts")}">${T(lang, "see alerts", "ver alertas")}</a></p>` : ""}
    ${fw.rows.length ? `<ul class="peek">${fw.rows.map(([k, v]) => `<li><span class="pk-label">${esc(k)}</span><span class="pk-val">${esc(v)}</span></li>`).join("")}</ul>` : ""}
    ${fw.windNote ? `<p class="fw-note">${esc(fw.windNote)}</p>` : ""}
  </section>`
    : "";

  const checklist = burnbanChecklist(lang)
    .map((c) => {
      const href = c.path ? lk(c.path) : c.url;
      const link = href ? ` <a href="${esc(href)}">${esc(c.label)} &rarr;</a>` : "";
      return `      <li><h3>${esc(c.h)}</h3><p>${esc(c.p)}${link}</p></li>`;
    })
    .join("\n");

  const faq = burnbanFaq(lang)
    .map((f) => `      <details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`)
    .join("\n");

  const resources = burnbanResources(lang)
    .map((r) => `      <li><a href="${esc(r.path ? lk(r.path) : r.url)}">${esc(r.label)}</a><span class="link-note">${esc(r.note)}</span></li>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} &mdash; Crosby, TX &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/burn-ban", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/burn-ban", lang)}">
${hreflangTags("/burn-ban")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .status { display:flex; align-items:center; gap:1rem; border-radius:16px; padding:1.2rem 1.4rem; margin-top:0.8rem; color:#fff; }
  .status-icon { font-size:2.4rem; line-height:1; flex:none; }
  .status-title { margin:0; font-size:1.5rem; font-weight:800; line-height:1.1; }
  .status-sub { margin:0.35rem 0 0; font-size:0.98rem; opacity:0.95; }
  .status-ok { background:linear-gradient(135deg,#1f8b4c,#2eb86a); }
  .status-ban { background:linear-gradient(135deg,#b3400d,#e2621a); }
  .status-unknown { background:linear-gradient(135deg,#5b6470,#7a8494); }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .fw { margin-top:1.4rem; }
  .fw h2 { font-size:1.15rem; margin:0 0 0.3rem; }
  .fw-alert { margin:0.4rem 0; padding:0.6rem 0.8rem; background:#fff4f3; border-left:5px solid #c0392b; border-radius:8px; font-weight:700; font-size:0.95rem; }
  .fw-alert a { color:var(--link); }
  @media (prefers-color-scheme: dark) { .fw-alert { background:#2a1715; } }
  .fw-note { margin:0.5rem 0 0; font-size:0.9rem; font-weight:600; color:var(--ink); }
  .peek { list-style:none; margin:0.4rem 0 0; padding:0; }
  .peek li { display:flex; justify-content:space-between; gap:0.6rem; padding:0.28rem 0; border-bottom:1px solid var(--line); font-size:0.9rem; }
  .peek li:last-child { border-bottom:none; }
  .pk-label { color:var(--muted); flex:none; }
  .pk-val { text-align:right; }
  .since { margin:0.55rem 0 0; font-size:0.92rem; font-weight:600; color:var(--ink); }
  /* Deliberately NOT a boxed callout: as a bordered card under the status
     panel this read as a detached cut-out, and the checklist it introduces
     looked unrelated. It is the section's opening paragraph now. */
  .lead-note { margin:0.3rem 0 0.2rem; font-size:0.98rem; line-height:1.6; }
  .check { list-style:none; margin:0.7rem 0 0; padding:0; display:grid; gap:0.5rem; }
  .check li { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:0.65rem 0.85rem; }
  .check h3 { margin:0 0 0.2rem; font-size:0.98rem; }
  .check p { margin:0; font-size:0.9rem; color:var(--muted); line-height:1.5; }
  .check a { color:var(--link); white-space:nowrap; }
  /* Bordered so it reads as something you can open. Unstyled <details> gave
     no affordance beyond the marker and people missed that these expand. */
  .faq { margin-top:0.5rem; font-size:0.95rem; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:0.6rem 0.85rem; }
  .faq summary { cursor:pointer; font-weight:600; }
  .faq[open] summary { margin-bottom:0.2rem; }
  .faq p { margin:0.4rem 0 0.1rem; color:var(--muted); line-height:1.55; }
  .res { margin-top:1.6rem; }
  .res h2 { font-size:1.15rem; }
  /* Rows, not bullets. As "link &mdash; note" on one 0.92rem line this was eight
     same-coloured links stacked with nothing between them — no way to scan for
     the one you wanted. The label now carries the colour and the weight, the
     note drops to --muted underneath it, and a rule separates each row. */
  .links { list-style:none; margin:0.7rem 0 0; padding:0; }
  .links li { padding:0.7rem 0; border-top:1px solid var(--line); }
  .links li:first-child { border-top:none; padding-top:0.2rem; }
  .links a { font-weight:600; font-size:1rem; }
  .link-note { display:block; margin-top:0.2rem; font-size:0.88rem; line-height:1.45; color:var(--muted); }
  .guide { margin-top:1.6rem; }
  .guide h2 { font-size:1.15rem; }
  .guide p { font-size:0.95rem; line-height:1.55; }
</style>
</head>
<body>
${topbar("/burn-ban", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="intro">${T(lang, "Whether an outdoor-burning ban is in effect for unincorporated Harris County, TX — which includes Crosby — from the Texas A&M Forest Service, rechecked about every 12 hours.", "Si hay una prohibición de quemas al aire libre vigente para el condado de Harris, TX no incorporado — que incluye a Crosby — según el Servicio Forestal de Texas A&M, revisado aproximadamente cada 12 horas.")}${data.updated ? ` ${T(lang, "Checked", "Verificado")} ${esc(fullTime(data.updated, lang))} CT.` : ""}</p>
  ${status}
  ${sinceLine}
  ${fwBlock}
  <section>
    <h2>${T(lang, "Before you burn", "Antes de quemar")}</h2>
    <p class="lead-note">${lead}</p>
    <div data-nosnippet>
      <ul class="check">
${checklist}
      </ul>
    </div>
  </section>
  <section class="guide" data-nosnippet>
    <h2>${T(lang, "What a burn ban means", "Qué significa una prohibición de quemas")}</h2>
    <p>${T(
      lang,
      "A burn ban is an order from the county judge or Commissioners Court that suspends outdoor burning when drought and fuel conditions raise the wildfire risk. In Harris County it covers the unincorporated areas — which is where Crosby is — while cities inside the county set their own rules. Violating it is a Class C misdemeanor, punishable by a fine of up to $500.",
      "Una prohibición de quemas es una orden del juez del condado o de la Corte de Comisionados que suspende las quemas al aire libre cuando la sequía y las condiciones del combustible elevan el riesgo de incendios forestales. En el condado de Harris cubre las áreas no incorporadas — donde está Crosby — mientras que las ciudades dentro del condado fijan sus propias reglas. Violarla es un delito menor clase C, con una multa de hasta $500."
    )}</p>
    <p>${T(
      lang,
      "This page follows the Texas A&M Forest Service's statewide burn-ban map, which counties report to. TFS doesn't issue the ban and says so itself, so if you need the exact wording, the exceptions, or any local notice, go to the Harris County Fire Marshal's Office.",
      "Esta página sigue el mapa estatal de prohibiciones de quemas del Servicio Forestal de Texas A&M, al que reportan los condados. TFS no emite la prohibición y así lo aclara, así que si necesitas el texto exacto, las excepciones o algún aviso local, acude a la Oficina del Jefe de Bomberos del Condado de Harris."
    )}</p>
    <h2>${T(lang, "Frequently asked questions", "Preguntas frecuentes")}</h2>
${faq}
  </section>
  <section class="res">
    <h2>${T(lang, "Resources", "Recursos")}</h2>
    <ul class="links">
${resources}
    </ul>
  </section>
</main>
${footer({ page: "/burn-ban", lang, source: T(lang, `Burn ban data from the <a href="https://tfsweb.tamu.edu/">Texas A&amp;M Forest Service</a>.`, `Datos de prohibición de quemas del <a href="https://tfsweb.tamu.edu/">Servicio Forestal de Texas A&amp;M</a>.`) })}
</body>
</html>`;
}

export function burnbanMarkdown(data, lang, weather) {
  const known = data.status === "Yes" || data.status === "No";
  const out = [
    `# ${T(lang, "Harris County Burn Ban Status", "Estado de la prohibición de quemas del condado de Harris")}`,
    "",
    `_${T(lang, "Outdoor-burning ban status for unincorporated Harris County, TX — which includes Crosby — from the Texas A&M Forest Service, rechecked about every 12 hours.", "Estado de la prohibición de quemas al aire libre para el condado de Harris, TX no incorporado — que incluye a Crosby — según el Servicio Forestal de Texas A&M, revisado aproximadamente cada 12 horas.")}${data.updated ? ` ${T(lang, "Checked", "Verificado")} ${fullTime(data.updated, lang)} CT.` : ""}_`,
    "",
  ];
  // One shared renderer for the status-history sentence, so the HTML and
  // Markdown views cannot disagree about what we can honestly claim.
  const since = burnbanSince(data, lang);
  const lead = burnbanLead(data, lang);
  if (!known) {
    out.push(T(lang, "Status unavailable from the last check. Check with the Harris County Fire Marshal's Office (linked below).", "Estado no disponible en la última verificación. Consulta con la Oficina del Jefe de Bomberos del Condado de Harris (enlace abajo)."), "");
  } else if (data.status === "Yes") {
    out.push(
      `${T(lang, "**Burn ban in effect.** Outdoor burning is prohibited in unincorporated Harris County, which includes Crosby.", "**Prohibición de quemas vigente.** Está prohibido quemar al aire libre en el condado de Harris no incorporado, que incluye a Crosby.")}${since ? ` ${since}` : ""}`,
      ""
    );
  } else {
    out.push(
      `${T(lang, "**No burn ban in Harris County right now.** ✓", "**Sin prohibición de quemas en el condado de Harris en este momento.** ✓")}${since ? ` ${since}` : ""}`,
      ""
    );
  }
  const fw = burnbanFireWeather(weather, lang);
  if (fw) {
    out.push(`## ${T(lang, "Right now in Crosby", "Ahora mismo en Crosby")}`, "");
    if (fw.alerts.length) out.push(`**⚠️ ${fw.alerts.join(" · ")}** — [${T(lang, "see alerts", "ver alertas")}](${canonicalFor("/alerts", lang)})`, "");
    for (const [k, v] of fw.rows) out.push(`- ${k}: ${v}`);
    if (fw.windNote) out.push("", `**${fw.windNote}**`);
    out.push("");
  }
  // Same lead paragraph the HTML view opens this section with — one source,
  // so the two can't drift.
  out.push(`## ${T(lang, "Before you burn", "Antes de quemar")}`, "", lead.replace(/<\/?strong>/g, "**"), "");
  for (const c of burnbanChecklist(lang)) {
    const href = c.path ? canonicalFor(c.path, lang) : c.url;
    out.push(`- **${c.h}** — ${c.p}${href ? ` [${c.label}](${href})` : ""}`);
  }
  out.push(
    "",
    `## ${T(lang, "What a burn ban means", "Qué significa una prohibición de quemas")}`,
    "",
    T(
      lang,
      "A burn ban is an order from the county judge or Commissioners Court that suspends outdoor burning when drought and fuel conditions raise the wildfire risk. In Harris County it covers the unincorporated areas — which is where Crosby is — while cities inside the county set their own rules. Violating it is a Class C misdemeanor, punishable by a fine of up to $500.",
      "Una prohibición de quemas es una orden del juez del condado o de la Corte de Comisionados que suspende las quemas al aire libre cuando la sequía y las condiciones del combustible elevan el riesgo de incendios forestales. En el condado de Harris cubre las áreas no incorporadas — donde está Crosby — mientras que las ciudades dentro del condado fijan sus propias reglas. Violarla es un delito menor clase C, con una multa de hasta $500."
    ),
    "",
    `## ${T(lang, "Frequently asked questions", "Preguntas frecuentes")}`,
    ""
  );
  for (const f of burnbanFaq(lang)) out.push(`### ${f.q}`, "", f.a, "");
  out.push(`## ${T(lang, "Resources", "Recursos")}`, "");
  for (const r of burnbanResources(lang)) {
    out.push(`- [${r.label}](${r.path ? canonicalFor(r.path, lang) : r.url}) — ${r.note}`);
  }
  out.push(
    "",
    "---",
    `${T(lang, "Source: Texas A&M Forest Service (tfsweb.tamu.edu), which tracks what counties report — it is not the issuing authority.", "Fuente: Servicio Forestal de Texas A&M (tfsweb.tamu.edu), que sigue lo que reportan los condados — no es la autoridad que emite la orden.")} · [crosbynews.com](${canonicalFor("/", lang)})`
  );
  return out.join("\n");
}
