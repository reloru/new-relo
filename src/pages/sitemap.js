// The human-readable sitemap, generated from registry.js: every page by
// section, then the public endpoints. Distinct from /sitemap.xml.

import { SITE } from "../config.js";
import { T, canonicalFor, hreflangTags, esPath } from "../i18n.js";
import { esc } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, sharedHead } from "../seo.js";
import { PAGES, ENDPOINTS, SECTIONS } from "../registry.js";

export function sitemapPageHtml(lang) {
  const t = (en, es) => T(lang, en, es);
  // Pages localize (each has an /es form); endpoints are English-only paths.
  const item = (href, label, desc) => `<li><a href="${href}">${esc(label)}</a> &mdash; ${esc(desc)}</li>`;
  const pageItem = (p) => item(lang === "es" ? esPath(p.path) : p.path, t(p.name.en, p.name.es), t(p.desc.en, p.desc.es));
  const endpointItem = (e) => item(e.path, t(e.name.en, e.name.es), t(e.desc.en, e.desc.es));
  const sections = SECTIONS.map((sec) => {
    const items = PAGES.filter((p) => p.section === sec.id).map(pageItem);
    if (sec.id === "developers") items.push(...ENDPOINTS.map(endpointItem));
    return `  <section class="card">
    <h2>${esc(t(sec.name.en, sec.name.es))}</h2>
    <ul>
      ${items.join("\n      ")}
    </ul>
  </section>`;
  }).join("\n\n");

  const title = t("Sitemap", "Mapa del sitio");
  const description = t(
    "Every page and endpoint on crosbynews.com, organized by category.",
    "Todas las páginas y endpoints de crosbynews.com, organizados por categoría.",
  );

  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<title>${esc(title)} &mdash; ${t("Crosby, TX Weather", "Clima de Crosby, TX")}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/sitemap", lang)}">
${sharedHead(lang)}
<link rel="canonical" href="${canonicalFor("/sitemap", lang)}">
${hreflangTags("/sitemap")}
${JSONLD_SITE}
<style>${BASE_CSS}
</style>
</head>
<body>
${topbar("/sitemap", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="lede">${esc(description)}</p>

${sections}
</main>
${footer({ page: "/sitemap", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`) })}
</body>
</html>`;
}

export function sitemapPageMarkdown(lang) {
  const t = (en, es) => T(lang, en, es);
  const item = (href, label, desc) => `- [${label}](${SITE}${href}) — ${desc}`;
  const out = [
    `# ${t("Sitemap", "Mapa del sitio")}`,
    "",
    t("Every page and endpoint on crosbynews.com.", "Todas las páginas y endpoints de crosbynews.com."),
  ];
  for (const sec of SECTIONS) {
    out.push("", `## ${t(sec.name.en, sec.name.es)}`, "");
    for (const p of PAGES.filter((x) => x.section === sec.id)) {
      out.push(item(lang === "es" ? esPath(p.path) : p.path, t(p.name.en, p.name.es), t(p.desc.en, p.desc.es)));
    }
    if (sec.id === "developers") for (const e of ENDPOINTS) out.push(item(e.path, t(e.name.en, e.name.es), t(e.desc.en, e.desc.es)));
  }
  out.push("", "---", `[crosbynews.com](${canonicalFor("/", lang)}) · ${t("weather for Crosby, Texas", "clima para Crosby, Texas")}`);
  return out.join("\n");
}
