// Shared page chrome: the header nav and the footer every page renders.
// One markup, two layouts — the desktop bar is a flat inline row, and the same
// links become a grouped hamburger menu at <=920px.

import { T, esPath } from "./i18n.js";
import { esc, fullTime } from "./lib/format.js";

// Site header with cross-page nav. `current` is the active EN path key for
// aria-current; `lang` selects English vs Spanish labels and the /es hrefs, and
// adds a language toggle linking to the same page in the other language.
export function topbar(current, lang = "en") {
  const es = lang === "es";
  // `cls` marks a link mobile-menu-only (m-only): shown in the grouped
  // hamburger, hidden from the flat desktop bar so the desktop nav stays lean.
  const link = (enHref, label, cls) =>
    `<a href="${es ? esPath(enHref) : enHref}"${cls ? ` class="${cls}"` : ""}${current === enHref ? ' aria-current="page"' : ""}>${label}</a>`;
  const t = (en, esLabel) => (es ? esLabel : en);
  // Section labels are hidden on desktop (flat inline bar) and shown as
  // group headers only when the mobile menu is open. One markup, two layouts.
  const group = (label) => `<span class="nav-group-label">${label}</span>`;
  const toggle = es
    ? `<a class="lang" hreflang="en-US" lang="en" href="${current}">English</a>`
    : `<a class="lang" hreflang="es-MX" lang="es" href="${esPath(current)}">Español</a>`;
  return `<header class="topbar">
  <a class="skip-link" href="#main">${t("Skip to content", "Saltar al contenido")}</a>
  <a class="brand" href="${es ? "/es" : "/"}">crosbynews.com</a>
  <nav>
    <details class="nav-menu">
      <summary aria-label="${t("Menu", "Menú")}">&#9776;</summary>
      <div class="nav-links">${link("/", t("Home", "Inicio"))} ${group(t("Weather", "Clima"))} ${link("/weather", t("Weather", "Clima"))} ${link("/hourly", t("Hourly", "Por hora"), "m-only")} ${link("/radar", t("Radar", "Radar"))} ${link("/alerts", t("Alerts", "Alertas"))} ${link("/water", t("Water Levels", "Niveles de agua"))} ${link("/fishing", t("Fishing", "Pesca"), "m-only")} ${link("/tropics", t("Tropics", "Trópicos"), "m-only")} ${link("/pollen", t("Pollen", "Polen"), "m-only")} ${link("/air", t("Air Quality", "Calidad del aire"), "m-only")} ${link("/burn-ban", t("Burn Ban", "Prohibición de quemas"), "m-only")} ${group(t("Community", "Comunidad"))} ${link("/news", t("News", "Noticias"))} ${link("/traffic", t("Traffic", "Tráfico"), "m-only")} ${link("/calendar", t("School Calendar", "Calendario escolar"))} ${group(t("More", "Más"))} ${link("/emergency", t("Emergency", "Emergencias"), "m-only")} ${link("/about", t("About", "Acerca de"))} ${link("/developers", t("Developers", "Desarrolladores"), "m-only")}</div>
    </details>
    ${toggle}
  </nav>
</header>`;
}

export const WEATHER_PAGES = new Set(["/", "/weather", "/hourly", "/radar", "/alerts"]);

export function footer({ page, lang = "en", source, data }) {
  const es = lang === "es";
  const lk = (enHref, label) => `<a href="${es ? esPath(enHref) : enHref}">${label}</a>`;
  const mdHref = (es ? esPath(page) : page) + "?format=md";

  const weatherLine = WEATHER_PAGES.has(page) && data
    ? `${!(data.alerts ?? []).length ? T(lang, "No active weather alerts. ", "Sin alertas meteorológicas activas. ") : ""}${source}<br>
  ${T(lang, "Updated", "Actualizado")} ${esc(fullTime(data.updated, lang))} CT &middot; ${T(lang, "refreshes every 15 minutes.", "se actualiza cada 15 minutos.")}`
    : source;

  const links = `<div class="footer-links">${lk("/", T(lang, "Home", "Inicio"))} &middot; ${lk("/emergency", T(lang, "Emergency", "Emergencias"))} &middot; ${lk("/about", T(lang, "About", "Acerca de"))} &middot; ${lk("/developers", T(lang, "Developers", "Desarrolladores"))} &middot; ${lk("/privacy", T(lang, "Privacy", "Privacidad"))} &middot; ${lk("/contact", T(lang, "Contact", "Contacto"))} &middot; ${lk("/sitemap", T(lang, "Sitemap", "Mapa del sitio"))} &middot; <a href="${mdHref}">${T(lang, "View as Markdown", "Ver en Markdown")}</a></div>`;

  const disclaimer = `<div class="footer-disclaimer">${T(lang, "crosbynews.com is an independent project and is not affiliated with the National Weather Service, NOAA, or any government agency.", "crosbynews.com es un proyecto independiente y no está afiliado al Servicio Meteorológico Nacional, la NOAA ni ninguna agencia gubernamental.")}</div>`;

  return `<footer>
  ${weatherLine}
  ${links}
  ${disclaimer}
</footer>`;
}
