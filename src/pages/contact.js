// Contact page. Same un-nesting as privacy.js: CONTACT/CONTACT_ES lived in
// the About-page region, far from the renderers that read them.
//
// security@crosbynews.com here must agree with /.well-known/security.txt and
// stay a real mailbox — it is also a DMARC rua recipient.

import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON, ORG_ID, WEBSITE_ID } from "../seo.js";

export const CONTACT = {
  title: "Contact Us",
  description: "How to reach crosbynews.com — general inquiries, news tips, and security reporting.",
  intro: "crosbynews.com is an independent community weather and news project for Crosby, Texas. We welcome questions, corrections, and local news tips.",
  sections: [
    {
      h: "General inquiries",
      p: ["For questions, corrections, or a local news tip:"],
      links: [{ href: "mailto:contact@crosbynews.com", label: "contact@crosbynews.com", note: "general questions, corrections, and news tips" }],
    },
    {
      h: "Security",
      p: ["To report a security issue or vulnerability:"],
      links: [
        { href: "mailto:security@crosbynews.com", label: "security@crosbynews.com", note: "security issues and vulnerability reports" },
        { href: "/.well-known/security.txt", label: "security.txt", note: "machine-readable security contact (RFC 9116)" },
      ],
    },
    {
      h: "About this project",
      p: [
        "crosbynews.com is an independent project and is not affiliated with the National Weather Service, NOAA, Crosby ISD, or any government agency. Weather data comes from the U.S. National Weather Service; local news headlines are aggregated from public sources; and the school calendar is rendered from Crosby ISD's public feed.",
      ],
    },
  ],
};

export const CONTACT_ES = {
  title: "Contacto",
  description: "Cómo comunicarte con crosbynews.com — consultas generales, datos de noticias y reportes de seguridad.",
  intro: "crosbynews.com es un proyecto comunitario independiente de clima y noticias para Crosby, Texas. Recibimos con gusto preguntas, correcciones y datos de noticias locales.",
  sections: [
    {
      h: "Consultas generales",
      p: ["Para preguntas, correcciones o un dato de noticias local:"],
      links: [{ href: "mailto:contact@crosbynews.com", label: "contact@crosbynews.com", note: "preguntas generales, correcciones y datos de noticias" }],
    },
    {
      h: "Seguridad",
      p: ["Para reportar un problema de seguridad o vulnerabilidad:"],
      links: [
        { href: "mailto:security@crosbynews.com", label: "security@crosbynews.com", note: "problemas de seguridad y reportes de vulnerabilidades" },
        { href: "/.well-known/security.txt", label: "security.txt", note: "contacto de seguridad legible por máquinas (RFC 9116)" },
      ],
    },
    {
      h: "Acerca de este proyecto",
      p: [
        "crosbynews.com es un proyecto independiente y no está afiliado al Servicio Meteorológico Nacional, la NOAA, Crosby ISD ni ninguna agencia gubernamental. Los datos del tiempo provienen del Servicio Meteorológico Nacional de EE. UU.; los titulares de noticias locales se recopilan de fuentes públicas; y el calendario escolar se genera a partir del feed público de Crosby ISD.",
      ],
    },
  ],
};

export function jsonldContact(lang) {
  const C = lang === "es" ? CONTACT_ES : CONTACT;
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ContactPage",
    "@id": canonicalFor("/contact", lang) + "#webpage",
    url: canonicalFor("/contact", lang),
    name: C.title,
    description: C.description,
    inLanguage: lang === "es" ? "es-MX" : "en-US",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORG_ID },
  })}</script>`;
}

export function contactHtml(lang) {
  const C = lang === "es" ? CONTACT_ES : CONTACT;
  const body = C.sections
    .map((s) => {
      const paras = (s.p || []).map((t) => `<p>${esc(t)}</p>`).join("\n      ");
      const links = s.links
        ? `<ul class="links">${s.links
            .map((l) => `<li><a href="${l.href}"><code>${esc(l.label)}</code></a> &mdash; ${esc(l.note)}</li>`)
            .join("")}</ul>`
        : "";
      return `      <section class="card">
        <h2>${esc(s.h)}</h2>
        ${paras}
        ${links}
      </section>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(C.title)} &mdash; ${T(lang, "Crosby, TX Weather", "Clima de Crosby, TX")}</title>
<meta name="description" content="${esc(C.description)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(C.title)}">
<meta property="og:description" content="${esc(C.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/contact", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/contact", lang)}">
${hreflangTags("/contact")}
${JSONLD_SITE}
${jsonldContact(lang)}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .card { background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.5rem; }
  .card p { margin:0.5rem 0; }
  .lede { font-size:1.05rem; color:var(--ink); }
  .links { margin:0.5rem 0 0; padding-left:1.1rem; }
  .links li { margin:0.3rem 0; }
</style>
</head>
<body>
${topbar("/contact", lang)}
<main id="main">
  <h1>${esc(C.title)}</h1>
  <p class="lede">${esc(C.intro)}</p>
${body}
</main>
${footer({ page: "/contact", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`) })}
</body>
</html>`;
}

export function contactMarkdown(lang) {
  const C = lang === "es" ? CONTACT_ES : CONTACT;
  const out = [`# ${C.title}`, "", C.intro, ""];
  for (const s of C.sections) {
    out.push(`## ${s.h}`, "");
    for (const t of s.p || []) out.push(t, "");
    for (const l of s.links || []) out.push(`- [${l.label}](${l.href}) — ${l.note}`);
    if (s.links) out.push("");
  }
  out.push("---", `[crosbynews.com](${canonicalFor("/", lang)}) · ${T(lang, "weather for Crosby, Texas", "clima para Crosby, Texas")}`);
  return out.join("\n");
}
