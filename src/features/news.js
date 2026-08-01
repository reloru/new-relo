// Local news. The Worker is a pure renderer here: the `news` KV key is written
// out-of-band by scripts/fetch-news.mjs (a Claude routine), because Google News
// hard-blocks Cloudflare Worker datacenter IPs. All relevance and de-duplication
// logic lives in that script, not here.
//
// Also carries the admin nuke: an ADMIN_KEY-gated view that hides articles
// site-wide via the worker-owned `news_blocklist` key.

import { SITE, TZ } from "../config.js";
import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc, fullTime } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON } from "../seo.js";
import { rssDate } from "../lib/format.js";
import { NEWS_ADMIN_SCRIPT } from "../assets/client-scripts.js";

// The Worker is a pure renderer: /news serves the WEATHER KV "news" key,
// which is written by scripts/fetch-news.mjs run on a Claude routine. Google
// News (the only source with real Crosby coverage) blocks Cloudflare Worker
// IPs, but a routine environment can reach it — so the Worker never fetches
// news itself; it just renders what the routine wrote.
export const NEWS_KV_KEY = "news";
// Editorial blocklist (worker-owned, distinct from the routine-owned `news`
// key): a map of { articleLink: blockedAtMs } written by the admin nuke
// endpoints. `loadNews` filters against it so a nuked article vanishes on the
// next render, and the news routine reads it too so the item stays gone even
// though Google's RSS still returns it.
export const NEWS_BLOCKLIST_KV_KEY = "news_blocklist";

// Read the routine-written news from KV (read-only; no live fetch) and apply
// the editorial blocklist. With { includeBlocked: true } the items are NOT
// filtered but each is annotated `.blocked` — the admin /news view uses that to
// show everything (with Hide/Restore buttons); every public consumer omits the
// option and so gets the filtered list.
// Both reads are guarded. `.get(key, "json")` throws on a value that isn't valid
// JSON, and an unguarded throw here 502s /news, /news.xml AND /api/news at once.
// That matters more for this key than for the cron-owned ones: `news` is written
// out-of-band by the routine, so the Worker has no fetch path to self-heal with —
// degrading to an empty list (which renders an honest "no recent news") is the
// only sane failure mode. loadWeather() guards its read the same way.
export async function loadNews(env, opts) {
  const [data, block] = await Promise.all([
    env.WEATHER.get(NEWS_KV_KEY, "json").catch((e) => {
      console.error("KV news parse failed:", e && e.stack);
      return null;
    }),
    env.WEATHER.get(NEWS_BLOCKLIST_KV_KEY, "json").catch(() => null),
  ]);
  const base = data && Array.isArray(data.items) ? data : { updated: null, items: [] };
  const blocked = block && typeof block === "object" ? block : {};
  if (opts && opts.includeBlocked) {
    return { ...base, items: base.items.map((n) => ({ ...n, blocked: !!(n && n.link && blocked[n.link]) })) };
  }
  return { ...base, items: base.items.filter((n) => !(n && n.link && blocked[n.link])) };
}

// Constant-time string compare for the admin key (avoids leaking length-prefix
// timing). Length mismatch short-circuits — it only reveals key length, which
// is not sensitive here.
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
// The admin nuke is gated on a Worker secret (ADMIN_KEY). No secret set → the
// feature is inert (endpoints 503, button never shows).
export function isAdmin(env, key) {
  return !!env.ADMIN_KEY && timingSafeEqual(String(key || ""), env.ADMIN_KEY);
}

export function newsDate(ts, lang) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

export function newsAdminBtn(n, lang) {
  const hide = esc(T(lang, "Hide", "Ocultar"));
  const restore = esc(T(lang, "Restore", "Restaurar"));
  return `<button class="news-admin-btn" type="button" data-link="${esc(n.link)}" data-action="${n.blocked ? "restore" : "delete"}" data-hide="${hide}" data-restore="${restore}">${n.blocked ? "&#8617; " + restore : "&#128465; " + hide}</button>`;
}

export function newsList(items, lang, admin) {
  return `<ul class="news-list">${items
    .map(
      (n) => `
      <li class="news-item${admin && n.blocked ? " news-blocked" : ""}">
        <a class="news-title" href="${esc(n.link)}" target="_blank" rel="noopener nofollow">${esc(n.title)}</a>
        <p class="news-meta">${esc(n.source)}${n.source && n.ts ? " &middot; " : ""}${esc(newsDate(n.ts, lang))}</p>
        ${admin ? newsAdminBtn(n, lang) : ""}
      </li>`
    )
    .join("")}</ul>`;
}

export function newsHtml(data, lang, admin) {
  const items = data.items ?? [];
  const community = items.filter((n) => !n.crime);
  const incidents = items.filter((n) => n.crime);
  const list = items.length
    ? `${community.length ? newsList(community, lang, admin) : ""}${
        incidents.length
          ? `<h2 class="incidents-head">${T(lang, "Public safety &amp; incidents", "Seguridad pública e incidentes")}</h2>${newsList(incidents, lang, admin)}`
          : ""
      }`
    : `<p class="none">${T(lang, "No recent Crosby news right now. This page refreshes automatically.", "No hay noticias recientes de Crosby por ahora. Esta página se actualiza automáticamente.")}</p>`;
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T(lang, "Crosby, TX News", "Noticias de Crosby, TX")} &mdash; crosbynews.com</title>
<meta name="description" content="${T(lang, "Recent local news headlines for Crosby, Texas, gathered from Texas and Houston-area news sources and filtered for relevance to the Crosby community.", "Titulares recientes de noticias locales de Crosby, Texas, recopilados de fuentes de noticias de Texas y del área de Houston y filtrados por relevancia para la comunidad de Crosby.")}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${T(lang, "Crosby, TX News", "Noticias de Crosby, TX")}">
<meta property="og:description" content="${T(lang, "Recent local news headlines for Crosby, Texas.", "Titulares recientes de noticias locales de Crosby, Texas.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/news", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/news", lang)}">
${hreflangTags("/news")}
<link rel="alternate" type="application/rss+xml" title="Crosby, TX News (RSS)" href="/news.xml">
${JSONLD_SITE}
${admin ? `<link rel="apple-touch-icon" href="/apple-touch-icon.png">` : `<link rel="manifest" href="/manifest.json">`}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .news-list { list-style:none; padding:0; margin:1rem 0 0; }
  .news-item { background:var(--card); border-radius:10px; padding:0.7rem 0.95rem; margin-bottom:0.6rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .news-title { font-weight:600; color:var(--ink); text-decoration:none; display:block; }
  .news-title:hover { text-decoration:underline; color:var(--accent); }
  .news-meta { margin:0.3rem 0 0; font-size:0.8rem; color:var(--muted); }
  .incidents-head { font-size:0.95rem; color:var(--muted); margin-top:1.6rem; border-top:1px solid var(--line); padding-top:0.9rem; }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .disclaimer { margin-top:1.4rem; font-size:0.8rem; color:var(--muted); border-top:1px solid var(--line); padding-top:0.7rem; }
  .admin-bar { background:#4a2fb5; color:#fff; border-radius:10px; padding:0.55rem 0.9rem; margin:0.8rem 0 0; font-size:0.85rem; font-weight:600; }
  .news-admin-btn { margin-top:0.5rem; font-size:0.8rem; font-weight:600; padding:0.28rem 0.7rem; border:1px solid var(--line); border-radius:8px; background:var(--card); color:var(--accent); cursor:pointer; }
  .news-admin-btn:hover { border-color:var(--accent); }
  .news-blocked { opacity:0.5; }
  .news-blocked .news-title { text-decoration:line-through; }
</style>
</head>
<body>
${topbar("/news", lang)}
<main id="main">
  <h1>${T(lang, "Crosby, TX News", "Noticias de Crosby, TX")}</h1>
  ${admin ? `<p class="admin-bar">${T(lang, "Admin mode — hidden items are dimmed; Hide removes an article site-wide, Restore brings it back.", "Modo administrador — los elementos ocultos aparecen atenuados; Ocultar elimina un artículo en todo el sitio, Restaurar lo devuelve.")}</p>` : ""}
  <p class="intro">${T(lang, `Recent headlines about Crosby, Texas and the Crosby ISD community, gathered automatically from Texas and Houston-area news outlets and filtered for relevance to Crosby. Links open the original source.${data.updated ? ` Last updated ${esc(newsDate(data.updated))}.` : ""}`, `Titulares recientes sobre Crosby, Texas y la comunidad de Crosby ISD, recopilados automáticamente de medios de Texas y del área de Houston y filtrados por relevancia para Crosby. Los enlaces abren la fuente original; los titulares se muestran en su idioma original.${data.updated ? ` Última actualización: ${esc(newsDate(data.updated, lang))}.` : ""}`)}</p>
  ${list}
  <section class="card">
    <h2>${T(lang, "About Crosby, Texas", "Acerca de Crosby, Texas")}</h2>
    <p>${T(lang, "Crosby is a community in northeast Harris County, Texas, situated along the San Jacinto River corridor between Houston and Baytown. The area includes Barrett Station and surrounding neighborhoods in the 77532 zip code. Crosby ISD serves the local schools, including Crosby High School, home of the Cougars.", "Crosby es una comunidad en el noreste del condado de Harris, Texas, ubicada a lo largo del corredor del río San Jacinto, entre Houston y Baytown. La zona incluye Barrett Station y los vecindarios cercanos del código postal 77532. El distrito Crosby ISD atiende a las escuelas locales, entre ellas Crosby High School, hogar de los Cougars.")}</p>
    <p>${T(lang, "The community regularly experiences Gulf Coast weather events &mdash; tropical storms, flash flooding, and severe thunderstorms &mdash; making it a distinct news beat separate from the wider Houston metro. Stories here focus on Crosby and the nearby northeast Harris County communities of Huffman, Highlands, Channelview, and Atascocita.", "La comunidad vive con frecuencia fenómenos meteorológicos de la costa del Golfo &mdash; tormentas tropicales, inundaciones repentinas y tormentas severas &mdash; lo que la convierte en un tema de noticias propio, distinto del área metropolitana de Houston. Las notas aquí se centran en Crosby y en las comunidades cercanas del noreste del condado de Harris: Huffman, Highlands, Channelview y Atascocita.")}</p>
    <p class="disclaimer">${T(lang, "Headlines are aggregated from public news sources and filtered to stories about Crosby, TX and nearby communities. crosbynews.com isn&rsquo;t the publisher &mdash; each link goes to the original outlet. Spotted something off-topic? It&rsquo;s automated filtering and we tune it over time.", "Los titulares se recopilan de fuentes de noticias públicas y se filtran para notas sobre Crosby, TX y comunidades cercanas. crosbynews.com no es el editor &mdash; cada enlace lleva al medio original. ¿Viste algo fuera de tema? Es un filtrado automático y lo ajustamos con el tiempo.")}</p>
  </section>
  <p class="intro"><a href="${lang === "es" ? "/es/weather" : "/weather"}">&larr; ${T(lang, "Back to the forecast", "Volver al pronóstico")}</a></p>
</main>
${footer({ page: "/news", lang, source: T(lang, "Weather data from the U.S. National Weather Service. News headlines aggregated from public sources.", "Datos del tiempo del Servicio Meteorológico Nacional de EE. UU. Titulares de noticias recopilados de fuentes públicas.") })}
${admin ? `<script>${NEWS_ADMIN_SCRIPT}</script>` : ""}
</body>
</html>`;
}

export function newsMarkdown(data, lang) {
  const items = data.items ?? [];
  const updatedNote = data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${fullTime(data.updated, lang)} CT.` : "";
  const out = [`# ${T(lang, "Crosby, TX News", "Noticias de Crosby, TX")}`, "", `_${T(lang, `Recent headlines about Crosby, Texas, filtered for local relevance.${updatedNote}`, `Titulares recientes sobre Crosby, Texas, filtrados por relevancia local.${updatedNote}`)}_`, ""];
  const row = (n) => `- [${n.title}](${n.link})${n.source ? ` — ${n.source}` : ""}${n.ts ? ` (${newsDate(n.ts, lang)})` : ""}`;
  if (items.length) {
    const community = items.filter((n) => !n.crime);
    const incidents = items.filter((n) => n.crime);
    for (const n of community) out.push(row(n));
    if (incidents.length) {
      out.push("", T(lang, "## Public safety & incidents", "## Seguridad pública e incidentes"), "");
      for (const n of incidents) out.push(row(n));
    }
  } else {
    out.push(T(lang, "No recent Crosby news right now.", "No hay noticias recientes de Crosby por ahora."));
  }
  out.push("", "---", `${T(lang, "Headlines aggregated from public sources, filtered for Crosby, TX.", "Titulares recopilados de fuentes públicas, filtrados para Crosby, TX.")} · [crosbynews.com](${canonicalFor("/", lang)})`);
  return out.join("\n");
}


export function newsRss(data) {
  const items = (data.items ?? [])
    .map(
      (n) => `
  <item>
    <title>${esc(n.title)}</title>
    <link>${esc(n.link)}</link>
    <guid isPermaLink="true">${esc(n.link)}</guid>${n.ts ? `
    <pubDate>${rssDate(n.ts)}</pubDate>` : ""}
    <category>${n.crime ? "incident" : "community"}</category>
    <description>${esc(n.source ? `Via ${n.source}. ` : "")}Curated for relevance to Crosby, TX by crosbynews.com.</description>
  </item>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Crosby, TX News — crosbynews.com</title>
  <link>${SITE}/news</link>
  <description>Recent local news headlines for Crosby, Texas and nearby northeast Harris County communities, aggregated from public sources and filtered for relevance. Links go to the original outlets.</description>
  <language>en-us</language>
  <ttl>60</ttl>
  <lastBuildDate>${rssDate(data.updated)}</lastBuildDate>${items}
</channel>
</rss>
`;
}

// JSON shape served at /api/news — the routine-curated headlines the /news
// page renders (read-only; the KV key is written out-of-band, see the News
// pipeline). `category` folds the internal crime flag into the same
// community/incident split the page shows.
export function apiNews(data) {
  return {
    location: "Crosby, TX",
    source: "Aggregated from public news sources, filtered for relevance to Crosby, TX",
    updated: data.updated ?? null,
    items: (data.items ?? []).map((n) => ({
      title: n.title,
      link: n.link,
      source: n.source || null,
      published: n.ts ? new Date(n.ts).toISOString() : null,
      category: n.crime ? "incident" : "community",
    })),
  };
}
