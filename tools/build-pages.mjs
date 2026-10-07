/* ==========================================================================
   Golden Bullet - static page generator
   --------------------------------------------------------------------------
   Builds every HTML page in /frontend from one shared shell so the header,
   footer, drawers and overlays stay identical across the storefront.

   Usage:  node tools/build-pages.mjs
   Output: plain, dependency-free HTML5 that can be opened from any static
           host. Re-run after editing this file.
   ========================================================================== */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "frontend");

/* --------------------------------------------------------------------------
   Catalogue snapshot
   --------------------------------------------------------------------------
   Product cards are baked into the HTML at build time, so the files read the
   same as the rendered page and the storefront works on any static host with
   no API behind it. Re-run this script after editing data/catalog.json.
   -------------------------------------------------------------------------- */
const CATALOGUE = JSON.parse(readFileSync(join(OUT, "data", "catalog.json"), "utf8"));
const ALL_PRODUCTS = CATALOGUE.products || [];
const SHOP_PER_PAGE = 6;

function esc(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(amount) {
  const code = CATALOGUE.config.baseCurrency || "USD";
  const info = (CATALOGUE.config.currencies || []).find((entry) => entry.code === code) ||
    { code: "USD", symbol: "$", rate: 1, locale: "en-US", decimals: 2 };
  const value = Number(amount || 0) * Number(info.rate || 1);
  const places = info.decimals === undefined ? 2 : info.decimals;
  try {
    return new Intl.NumberFormat(info.locale || "en-US", {
      style: "currency",
      currency: info.code,
      minimumFractionDigits: places,
      maximumFractionDigits: places
    }).format(value);
  } catch (error) {
    return (info.symbol || "$") + value.toFixed(places);
  }
}

/* Featured first, then cheapest first - the default storefront ordering. */
function inStoreOrder(products) {
  return products.slice().sort((a, b) =>
    Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || a.price - b.price);
}

/* Mirrors productCardTemplate() in frontend/js/ui.js. Keep both in step.
   Pass { decorative: true } for the repeated half of the marquee rail: those
   cards are hidden from assistive tech and skipped by the tab order. */
function productCard(product, indent, options) {
  const opts = options || {};
  const off = opts.decorative ? ' tabindex="-1"' : "";
  const pad = " ".repeat(indent);
  const image = (product.images || [])[0] || { src: "assets/img/product-single.jpg", alt: product.name };
  const inStock = typeof product.inStock === "boolean" ? product.inStock : Number(product.stockQty || 1) > 0;
  const percent = product.compareAt && product.compareAt > product.price
    ? Math.round(((product.compareAt - product.price) / product.compareAt) * 100)
    : 0;
  const href = "product.html?id=" + encodeURIComponent(product.slug || product.id);
  const lines = [
    pad + '<article class="gb-product-card' + (inStock ? "" : " gb-product-card--out") + '">',
    pad + '  <a class="gb-product-card__media" href="' + href + '" tabindex="-1">',
    pad + '    <img src="' + esc(image.src) + '" alt="' + esc(image.alt) + '" width="640" height="640" loading="lazy" decoding="async">',
    pad + "  </a>",
    pad + '  <div class="gb-product-card__badges">'
  ];
  if (percent) lines.push(pad + '    <span class="gb-badge gb-badge--sale">' + percent + "% off</span>");
  if (!inStock) lines.push(pad + '    <span class="gb-badge gb-badge--out">Out of stock</span>');
  lines.push(
    pad + "  </div>",
    pad + '  <div class="gb-product-card__body">',
    pad + '    <h3 class="gb-product-card__title"><a href="' + href + '"' + off + ">" + esc(product.name) + "</a></h3>",
    pad + '    <p class="gb-product-card__meta">' + esc(product.shortName || product.netContent || "") + "</p>",
    pad + '    <div class="gb-product-card__price">',
    pad + '      <span class="gb-price">' + money(product.price) + "</span>"
  );
  if (product.compareAt) lines.push(pad + '      <span class="gb-price--compare">' + money(product.compareAt) + "</span>");
  lines.push(
    pad + "    </div>",
    pad + '    <div class="gb-product-card__actions">',
    inStock
      ? pad + '      <button type="button" class="gb-btn gb-btn--outline gb-btn--sm gb-btn--block" data-add-to-cart="' + esc(product.id) + '"' + off + ">Add to bag</button>"
      : pad + '      <button type="button" class="gb-btn gb-btn--outline gb-btn--sm gb-btn--block" disabled aria-disabled="true"' + off + ">Out of stock</button>",
    pad + "    </div>",
    pad + "  </div>",
    pad + "</article>"
  );
  return lines.join("\n");
}

function productGrid(products, options) {
  const opts = options || {};
  const indent = opts.indent === undefined ? 8 : opts.indent;
  const pad = " ".repeat(indent);
  const list = inStoreOrder(products).slice(0, opts.limit || products.length);
  const cards = list.map((product) => productCard(product, indent + 2)).join("\n");
  return pad + '<div class="gb-grid ' + (opts.className || "gb-grid--3") + '" id="' + opts.id + '">' + "\n" + cards + "\n" + pad + "</div>";
}

/* The product rail behind the Best sellers section (initMarquee() in
   frontend/js/ui.js drives the speed and the pause control).
   The list is rendered twice inside one track: the CSS animation slides the
   track by exactly 50% of its own width, so the second half lands pixel for
   pixel where the first half started and the loop never jumps. */
function productMarquee(products, options) {
  const opts = options || {};
  const indent = opts.indent === undefined ? 8 : opts.indent;
  const pad = " ".repeat(indent);
  const list = inStoreOrder(products).slice(0, opts.limit || products.length);
  const rail = list.concat(list);
  const items = rail.map((product, index) => {
    const decorative = index >= list.length;
    const itemAttrs = decorative ? ' aria-hidden="true" inert' : "";
    return pad + "    <li class=\"gb-marquee__item\"" + itemAttrs + ">\n" +
      productCard(product, indent + 6, { decorative }) + "\n" +
      pad + "    </li>";
  }).join("\n");
  return [
    pad + '<div class="gb-marquee" id="' + opts.id + '" data-marquee data-marquee-speed="' + (opts.speed || 55) + '"' +
      (opts.label ? ' role="group" aria-label="' + esc(opts.label) + '"' : "") + ">",
    pad + '  <div class="gb-marquee__controls">',
    pad + '    <button type="button" class="gb-marquee__toggle" data-marquee-toggle aria-pressed="false">Pause scrolling</button>',
    pad + "  </div>",
    pad + '  <div class="gb-marquee__viewport">',
    pad + '    <ul class="gb-marquee__group" data-marquee-group>',
    items,
    pad + "    </ul>",
    pad + "  </div>",
    pad + "</div>"
  ].join("\n");
}

const SHOP_PAGE_ITEMS = inStoreOrder(ALL_PRODUCTS).slice(0, SHOP_PER_PAGE);
const FEATURED_PRODUCTS = inStoreOrder(ALL_PRODUCTS.filter((product) => product.featured));
const BEST_SELLER_PRODUCTS = inStoreOrder(ALL_PRODUCTS.filter((product) => product.bestSeller));
const SHOP_COUNT_TEXT = ALL_PRODUCTS.length
  ? "Showing 1\u2013" + SHOP_PAGE_ITEMS.length + " of " + ALL_PRODUCTS.length + " products"
  : "No products found";

const SITE = {
  name: "Golden Bullet",
  tagline: "Stay Golden",
  url: "https://mygoldenbullets.com",
  email: "hello@mygoldenbullets.com",
  phone: "+234 000 000 0000",
  regLine: "Golden Bullet 380 is registered with [REGULATOR NAME] under registration number [REGISTRATION NO. PLACEHOLDER].",
  notice: "This product is not intended to diagnose, treat, cure, or prevent any disease. Consult a healthcare professional before use."
};

/* --------------------------------------------------------------------------
   Inline icons (kept tiny and stroke-based so they inherit currentColor)
   -------------------------------------------------------------------------- */
const icon = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.4 3.1-5.6 7-5.6s7 2.2 7 5.6"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 8h12l1 12H5L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chevron: '<svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true"><path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 7h10v8H3zM13 10h4l3 3v2h-7z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="9" rx="2"/><path d="M8 10V8a4 4 0 0 1 8 0v2"/></svg>',
  support: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 12a7 7 0 0 1 14 0"/><rect x="3" y="12" width="4" height="6" rx="1.6"/><rect x="17" y="12" width="4" height="6" rx="1.6"/><path d="M19 18v1a3 3 0 0 1-3 3h-2"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M20 4c0 8-4.5 13-11 13H6c0-7 5-11 14-11Z"/><path d="M6 20c1.5-5 5-8 9-9.5"/></svg>',
  flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M10 3h4v5l4 9a2 2 0 0 1-1.8 3H7.8A2 2 0 0 1 6 17l4-9Z"/><path d="M9 13h6"/></svg>',
  seed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 21c-4-3-6-6-6-10a6 6 0 0 1 12 0c0 4-2 7-6 10Z"/><path d="M12 21V9"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6Z"/><path d="m9 12 2 2 4-4"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 4l9 16H3l9-16Z"/><path d="M12 10v4M12 17h.01"/></svg>',
  social: {
    facebook: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 21v-7h2.4l.4-3h-2.8V9.2c0-.9.3-1.5 1.6-1.5h1.4V5c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.5-4 4.1V11H7.7v3h2.4v7Z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4.4"/><circle cx="12" cy="12" r="3.6"/><path d="M16.8 7.2h.01"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 3h2.4c.3 1.9 1.5 3.2 3.6 3.5v2.4c-1.4 0-2.7-.4-3.8-1.2v5.6a5.5 5.5 0 1 1-5.6-5.5c.3 0 .6 0 .9.1v2.5a3 3 0 1 0 2.2 2.9Z"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.3 4h2.9l-6.3 7.2L21 20h-5.6l-4-5.2L6.7 20H3.8l6.6-7.6L3.3 4h5.7l3.7 4.9Zm-1 14h1.6L7.7 5.6H6Z"/></svg>'
  }
};

const NAV = [
  { label: "Home", href: "index.html", page: "home" },
  { label: "Buy now", href: "shop.html", page: "shop" },
  {
    label: "Blog", href: "blog.html", page: "blog",
    menu: [
      { label: "All articles", href: "blog.html" },
      { label: "Understanding ED: when to see a doctor", href: "blog-post.html?slug=understanding-erectile-dysfunction-when-to-see-a-doctor" },
      { label: "How to read a supplement label", href: "blog-post.html?slug=how-to-read-a-supplement-label" },
      { label: "Safety information", href: "safety-information.html" }
    ]
  },
  { label: "Affiliate", href: "affiliate.html", page: "affiliate" },
  { label: "Contact", href: "contact.html", page: "contact" }
];
/* --------------------------------------------------------------------------
   Document head
   -------------------------------------------------------------------------- */
function head({ title, description, jsonLd }) {
  const fullTitle = title === "Home" ? `${SITE.name} — ${SITE.tagline}` : `${title} — ${SITE.name}`;
  const ld = (jsonLd || []).map((block) => `  <script type="application/ld+json">${JSON.stringify(block)}</script>`).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${fullTitle}</title>
  <meta name="description" content="${description}">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#0B0A08">
  <link rel="canonical" href="${SITE.url}/">
  <link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="assets/img/favicon.svg">
  <link rel="stylesheet" href="css/base.css">
  <link rel="stylesheet" href="css/layout.css">
  <link rel="stylesheet" href="css/components.css">
  <link rel="stylesheet" href="css/pages.css">
  <meta name="gb-api-base" content="/api">
${ld}
</head>`;
}

const ORG_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE.name,
  url: SITE.url,
  email: SITE.email,
  slogan: SITE.tagline,
  description: "Men's sexual wellness products shipped worldwide in discreet packaging."
};

/* --------------------------------------------------------------------------
   Announcement bar + header
   -------------------------------------------------------------------------- */
function announcementMarkup() {
  return `  <div class="gb-announce" id="gb-announcement">
    <div class="gb-container gb-announce__inner">
      <p class="gb-announce__text">Fall sale on! Spice Up Your Nights with Golden Bullet! <a href="shop.html">Shop the packs</a></p>
      <button type="button" class="gb-announce__close" data-announce-close aria-label="Dismiss announcement">${icon.close}</button>
    </div>
  </div>`;
}

function localeMarkup(idSuffix) {
  return `        <div class="gb-locale gb-only-lg-flex">
          <label class="gb-visually-hidden" for="country-${idSuffix}">Country or region</label>
          <select class="gb-select gb-select--bare" id="country-${idSuffix}" data-country-select></select>
          <label class="gb-visually-hidden" for="currency-${idSuffix}">Currency</label>
          <select class="gb-select gb-select--bare" id="currency-${idSuffix}" data-currency-select></select>
        </div>`;
}

function headerMarkup(active) {
  const navItems = NAV.map((item) => {
    if (!item.menu) {
      return `          <li><a class="gb-nav__link" href="${item.href}"${active === item.page ? ' aria-current="page"' : ""}>${item.label}</a></li>`;
    }
    const menu = item.menu.map((entry) => `              <li><a href="${entry.href}">${entry.label}</a></li>`).join("\n");
    return `          <li class="gb-nav__item--has-menu">
            <a class="gb-nav__link" href="${item.href}"${active === item.page ? ' aria-current="page"' : ""}>${item.label} ${icon.chevron}</a>
            <ul class="gb-nav__menu">
${menu}
            </ul>
          </li>`;
  }).join("\n");

  return `  <header class="gb-header">
    <div class="gb-container gb-header__inner">
      <a class="gb-brand" href="index.html">
        <img class="gb-brand__mark" src="assets/img/mark.svg" alt="" width="38" height="51" decoding="async">
        <span class="gb-brand__text">
          <span class="gb-brand__name">Golden Bullet</span>
          <span class="gb-brand__tagline">Stay Golden</span>
        </span>
      </a>

      <nav class="gb-nav" aria-label="Main navigation">
        <ul class="gb-nav__list">
${navItems}
        </ul>
      </nav>

      <div class="gb-header__actions">
${localeMarkup("header")}
        <button type="button" class="gb-icon-btn" data-search-toggle aria-expanded="false" aria-controls="gb-search-panel" aria-label="Search products">${icon.search}</button>
        <a class="gb-icon-btn" href="login.html" data-account-link aria-label="Sign in">
          ${icon.user}
          <span class="gb-visually-hidden" data-account-label>Sign in</span>
        </a>
        <button type="button" class="gb-icon-btn" data-cart-open aria-label="Open your bag" aria-controls="gb-cart-drawer">
          ${icon.bag}
          <span class="gb-cart-count" data-cart-count hidden>0</span>
        </button>
        <button type="button" class="gb-icon-btn gb-hamburger" data-menu-open aria-label="Open menu" aria-controls="gb-mobile-menu">${icon.menu}</button>
      </div>
    </div>

    <div class="gb-search-panel" id="gb-search-panel" data-open="false">
      <div class="gb-container">
        <form class="gb-search-panel__form" data-search-form role="search">
          <label class="gb-field__label" for="site-search">Search products</label>
          <div class="gb-input-group">
            <input class="gb-input" id="site-search" type="search" name="q" placeholder="Search packs, ingredients or SKU" autocomplete="off">
            <button type="submit" class="gb-btn gb-btn--gold">Search</button>
          </div>
        </form>
      </div>
    </div>
  </header>`;
}

function mobileMenuMarkup() {
  const items = NAV.map((item) => {
    const sub = item.menu
      ? item.menu.map((entry) => `          <li><a href="${entry.href}">${entry.label}</a></li>`).join("\n")
      : "";
    return `        <li><a href="${item.href}">${item.label}</a></li>\n${sub}`;
  }).join("\n");

  return `  <div class="gb-mobile-menu" id="gb-mobile-menu" data-open="false" inert>
    <button type="button" class="gb-mobile-menu__scrim" data-menu-scrim tabindex="-1" aria-hidden="true"></button>
    <div class="gb-mobile-menu__panel" role="dialog" aria-modal="true" aria-label="Menu">
      <div class="gb-mobile-menu__head">
        <span class="gb-brand__name">Menu</span>
        <button type="button" class="gb-icon-btn" data-menu-close aria-label="Close menu">${icon.close}</button>
      </div>
      <nav aria-label="Mobile navigation">
        <ul class="gb-mobile-menu__list">
${items}
        </ul>
      </nav>
      <div class="gb-stack">
        <a class="gb-btn gb-btn--gold gb-btn--block" href="shop.html">Shop all packs</a>
        <a class="gb-btn gb-btn--outline gb-btn--block" href="account.html">Your account</a>
        <a class="gb-btn gb-btn--outline gb-btn--block" href="safety-information.html">Safety information</a>
      </div>
      <div class="gb-mt-6 gb-stack-sm">
        <div>
          <label class="gb-field__label" for="country-mobile">Country or region</label>
          <select class="gb-select" id="country-mobile" data-country-select></select>
        </div>
        <div>
          <label class="gb-field__label" for="currency-mobile">Currency</label>
          <select class="gb-select" id="currency-mobile" data-currency-select></select>
        </div>
      </div>
    </div>
  </div>`;
}
function paymentBadge(label) {
  return `        <svg viewBox="0 0 58 26" role="img" aria-label="${label}"><rect x="0.75" y="0.75" width="56.5" height="24.5" rx="4" fill="#FFFFFF" stroke="#C9A24B" stroke-width="1.2"/><text x="29" y="17.5" text-anchor="middle" font-family="system-ui, sans-serif" font-size="9" font-weight="700" fill="#16130D">${label}</text></svg>`;
}

function footerMarkup() {
  const quick = [
    { label: "Home", href: "index.html" },
    { label: "Buy now", href: "shop.html" },
    { label: "Blog", href: "blog.html" },
    { label: "Affiliate", href: "affiliate.html" },
    { label: "Contact", href: "contact.html" }
  ].map((link) => `          <li><a href="${link.href}">${link.label}</a></li>`).join("\n");

  const useful = [
    { label: "Understanding ED: when to see a doctor", href: "blog-post.html?slug=understanding-erectile-dysfunction-when-to-see-a-doctor" },
    { label: "How to read a supplement label", href: "blog-post.html?slug=how-to-read-a-supplement-label" },
    { label: "Discreet delivery and payment", href: "blog-post.html?slug=discreet-delivery-and-payment" },
    { label: "Safety information", href: "safety-information.html" },
    { label: "Frequently asked questions", href: "faq.html" }
  ].map((link) => `          <li><a href="${link.href}">${link.label}</a></li>`).join("\n");

  const policies = [
    { label: "Privacy policy", href: "privacy-policy.html" },
    { label: "Terms of service", href: "terms.html" },
    { label: "Refund policy", href: "refund-policy.html" },
    { label: "Shipping policy", href: "shipping-policy.html" },
    { label: "Safety information", href: "safety-information.html" }
  ].map((link) => `<a href="${link.href}">${link.label}</a>`).join(" · ");

  const socials = Object.entries(icon.social).map(([name, svg]) =>
    `          <a href="https://${name === "x" ? "x.com" : name + ".com"}/" aria-label="Golden Bullet on ${name}" rel="noopener noreferrer" target="_blank">${svg}</a>`).join("\n");

  const payments = ["Visa", "Mastercard", "Verve", "Paystack"].map(paymentBadge).join("\n");

  return `  <footer class="gb-footer">
    <div class="gb-container">
      <div class="gb-footer__grid">
        <div class="gb-footer__about">
          <div class="gb-footer__brand">
            <img src="assets/img/mark.svg" alt="" width="34" height="46" loading="lazy" decoding="async">
            <p class="gb-brand__name gb-mt-4">Golden Bullet</p>
            <p class="gb-brand__tagline">Stay Golden</p>
          </div>
          <p>Our products are carefully sourced and made from natural ingredients. Quality is verified through documented batch testing and registration. [APPROVED CLAIM FROM LABEL]</p>
          <div class="gb-footer__socials">
${socials}
          </div>
        </div>

        <nav aria-labelledby="footer-quick">
          <h2 id="footer-quick">Quick links</h2>
          <ul class="gb-footer__list">
${quick}
          </ul>
        </nav>

        <nav aria-labelledby="footer-useful">
          <h2 id="footer-useful">Useful links</h2>
          <ul class="gb-footer__list">
${useful}
          </ul>
        </nav>

        <div>
          <h2 id="footer-newsletter">Sale? Be the first to know.</h2>
          <form class="gb-newsletter" data-newsletter-form aria-labelledby="footer-newsletter" novalidate>
            <div class="gb-newsletter__row">
              <div class="gb-field">
                <label class="gb-visually-hidden" for="newsletter-email">Email address</label>
                <input class="gb-input" id="newsletter-email" type="email" name="email" placeholder="Email" autocomplete="email" required>
              </div>
              <button type="submit" class="gb-btn gb-btn--gold">Join</button>
            </div>
            <p class="gb-newsletter__note" data-newsletter-status role="status" aria-live="polite">Adults 18+. Unsubscribe at any time.</p>
          </form>
        </div>
      </div>

      <div class="gb-footer__meta">
        <div class="gb-locale-forms">
          <div>
            <label class="gb-visually-hidden" for="country-footer">Country or region</label>
            <select class="gb-select gb-select--bare" id="country-footer" data-country-select></select>
          </div>
          <div>
            <label class="gb-visually-hidden" for="currency-footer">Currency</label>
            <select class="gb-select gb-select--bare" id="currency-footer" data-currency-select></select>
          </div>
        </div>
        <div class="gb-payments" aria-label="Accepted payment methods">
${payments}
        </div>
      </div>

      <div class="gb-footer__legal">
        <p class="gb-footer__disclaimer"><strong>${SITE.notice}</strong></p>
        <p>${SITE.regLine}</p>
        <p>${policies}</p>
        <p>&copy; <span data-current-year>2026</span> ${SITE.name}. All rights reserved. Registered address: [COMPANY ADDRESS PLACEHOLDER].</p>
      </div>
    </div>
  </footer>`;
}

/* --------------------------------------------------------------------------
   Overlays: cart drawer, toasts, age gate, cookie banner
   -------------------------------------------------------------------------- */
function overlaysMarkup() {
  return `  <button type="button" class="gb-scrim" id="gb-cart-scrim" data-open="false" tabindex="-1" aria-hidden="true" aria-label="Close bag"></button>

  <aside class="gb-drawer" id="gb-cart-drawer" data-open="false" role="dialog" aria-modal="true" aria-labelledby="gb-cart-drawer-title" aria-hidden="true" inert>
    <div class="gb-drawer__head">
      <h2 id="gb-cart-drawer-title">Your bag</h2>
      <button type="button" class="gb-icon-btn" data-cart-close aria-label="Close bag">${icon.close}</button>
    </div>
    <div class="gb-drawer__body" data-cart-drawer-body></div>
    <div class="gb-drawer__foot" data-cart-drawer-foot></div>
  </aside>

  <div class="gb-toasts" id="gb-toasts" role="region" aria-label="Notifications"></div>

  <div class="gb-modal" id="gb-age-gate" role="dialog" aria-modal="true" aria-labelledby="gb-age-gate-title" hidden>
    <div class="gb-modal__dialog">
      <p class="gb-eyebrow">Age verification</p>
      <h2 class="gb-modal__title" id="gb-age-gate-title">You must be 18 or older</h2>
      <p>Golden Bullet sells men's sexual wellness products. This store is intended for adults aged 18 and over.</p>
      <p>By continuing you confirm that you are at least 18 years old and that it is legal for you to view and purchase these products where you live.</p>
      <label class="gb-check">
        <input type="checkbox" data-age-remember checked>
        <span class="gb-check__text">Remember this choice on this device</span>
      </label>
      <div class="gb-modal__actions">
        <button type="button" class="gb-btn gb-btn--gold" data-age-confirm>I am 18 or older &mdash; enter</button>
        <button type="button" class="gb-btn gb-btn--outline" data-age-exit>Exit</button>
      </div>
      <p class="gb-small gb-muted gb-mt-4">[ADD YOUR LEGAL AGE-RESTRICTION WORDING HERE]</p>
    </div>
  </div>

  <section class="gb-cookie" id="gb-cookie-banner" aria-labelledby="gb-cookie-title" hidden>
    <div>
      <p class="gb-cookie__title" id="gb-cookie-title">Cookies and privacy</p>
      <p class="gb-cookie__text">We use essential cookies to run your bag, your currency choice and the age check. Optional analytics cookies help us improve the store and are only set with your consent. Read our <a href="privacy-policy.html">privacy policy</a>.</p>
    </div>
    <div class="gb-cookie__actions">
      <button type="button" class="gb-btn gb-btn--gold gb-btn--sm" data-cookie-accept>Accept all</button>
      <button type="button" class="gb-btn gb-btn--outline gb-btn--sm" data-cookie-decline>Essential only</button>
      <button type="button" class="gb-btn gb-btn--outline gb-btn--sm" data-cookie-settings>Manage preferences</button>
    </div>
  </section>`;
}
/* --------------------------------------------------------------------------
   Page shell
   -------------------------------------------------------------------------- */
function layout({ page: pageId, title, description, active, body, jsonLd }) {
  return `${head({ title, description, jsonLd: [ORG_LD].concat(jsonLd || []) })}
<body data-page="${pageId}">
  <a class="gb-skip-link" href="#main">Skip to main content</a>

${overlaysMarkup()}

${announcementMarkup()}
${headerMarkup(active)}
${mobileMenuMarkup()}

  <main id="main" class="gb-main" tabindex="-1">
${body}
  </main>

${footerMarkup()}
  <script type="module" src="js/main.js"></script>
</body>
</html>
`;
}

function breadcrumbs(trail) {
  const items = trail.map((crumb, index) => {
    const last = index === trail.length - 1;
    return last
      ? `        <li><span aria-current="page">${crumb.label}</span></li>`
      : `        <li><a href="${crumb.href}">${crumb.label}</a></li>`;
  }).join("\n");
  return `  <nav class="gb-breadcrumbs gb-container" aria-label="Breadcrumb">
    <ol>
${items}
    </ol>
  </nav>`;
}

function pageHead({ eyebrow, title, lead, actions }) {
  return `  <div class="gb-page-head">
    <div class="gb-container">
      ${eyebrow ? `<p class="gb-eyebrow">${eyebrow}</p>` : ""}
      <h1>${title}</h1>
      ${lead ? `<p class="gb-lead">${lead}</p>` : ""}
      ${actions || ""}
    </div>
  </div>`;
}

function noticeBlock() {
  return `  <div class="gb-container gb-my-6">
    <div class="gb-notice">
      <strong>${SITE.notice}</strong>
      Do not use with nitrate medication. Consult a doctor if you have heart conditions, high or low blood pressure, or take other medication. Keep out of reach of children.
    </div>
  </div>`;
}

const pages = [];
function page(file, options) { pages.push(Object.assign({ file }, options)); }

/* --------------------------------------------------------------------------
   Home
   -------------------------------------------------------------------------- */
const faqItems = [
  {
    q: "How do I take Golden Bullet?",
    a: "<p>Follow the dosage and directions printed on the pack exactly. The label states the maximum amount that may be taken in 24 hours. Do not exceed it. [DOSAGE FROM LABEL]</p>"
  },
  {
    q: "Who should not take Golden Bullet?",
    a: "<p>Do not use it if you are under 18, pregnant or breastfeeding, or if you take nitrate medication such as nitroglycerin or any medicine used for chest pain. Speak to a doctor first if you have a heart condition, high or low blood pressure, diabetes, liver or kidney problems, or any other medical condition, or if you take any other medication including herbal products.</p>"
  },
  {
    q: "When should I see a doctor?",
    a: "<p>Speak to a doctor if you have ongoing erectile difficulties, if symptoms change or worsen, if you take medication for blood pressure or heart conditions, or before starting any supplement. Seek urgent care immediately if you experience chest pain, an irregular heartbeat, fainting or dizziness, or an erection lasting more than four hours.</p>"
  },
  {
    q: "Is Golden Bullet a medicine?",
    a: "<p>No. It is a food supplement. It is not intended to diagnose, treat, cure, or prevent any disease, and it is not a substitute for medical advice or treatment.</p>"
  },
  {
    q: "What are your returns and refunds?",
    a: "<p>Unopened packs can be returned within [NUMBER] days of delivery under our <a href=\"refund-policy.html\">refund policy</a>. For health and safety reasons, opened packs cannot be returned unless the product is faulty or was sent in error. Contact <a href=\"contact.html\">support</a> and we will help.</p>"
  },
  {
    q: "Will my order be discreet?",
    a: "<p>Yes. Orders are shipped in plain outer packaging with no product names or imagery. Card payments appear under the trading name shown at checkout. See the <a href=\"shipping-policy.html\">shipping policy</a> for details.</p>"
  }
];

function accordionMarkup(items, idPrefix) {
  return `    <div class="gb-accordion" data-accordion="single" id="${idPrefix}">
${items.map((item, index) => `      <div class="gb-accordion__item">
        <h3>
          <button type="button" class="gb-accordion__trigger" aria-expanded="${index === 0 ? "true" : "false"}">
            <span>${item.q}</span>
            <span class="gb-accordion__icon" aria-hidden="true"></span>
          </button>
        </h3>
        <div class="gb-accordion__panel">
          ${item.a}
        </div>
      </div>`).join("\n")}
    </div>`;
}
function homeBody() {
  return `    <section class="gb-hero">
      <div class="gb-hero__bg" aria-hidden="true"></div>
      <div class="gb-container gb-hero__inner">
        <div class="gb-hero__copy">
          <p class="gb-eyebrow">Golden Bullet 380 &middot; OTO380</p>
          <h1 class="gb-hero__title">Your <em>Golden</em> Power<br>To Redefine Your Limits</h1>
          <p class="gb-hero__claim">[APPROVED CLAIM FROM LABEL]</p>
          <p class="gb-hero__text">Golden Bullet 380 is a chewable tablet made with Cordyceps, Siberian Ginseng and Snow Lotus Flower. Every sealed pack carries the full ingredient list, dosage and directions, warnings, storage instructions, batch or lot number, expiry date and regulator registration number.</p>
          <div class="gb-hero__actions">
            <a class="gb-btn gb-btn--gold gb-btn--lg" href="shop.html">Shop the packs</a>
            <a class="gb-btn gb-btn--outline gb-btn--lg" href="#about-product">About the product</a>
          </div>
          <p class="gb-hero__caption gb-mt-6">Adults 18 and over only. This product is not intended to diagnose, treat, cure, or prevent any disease.</p>
        </div>
        <div class="gb-hero__media">
          <figure class="gb-hero__figure">
            <img src="assets/img/product-single.jpg" alt="Golden Bullet 380 chewable tablet capsule beside a white snow lotus flower with loose tablets scattered on a cream surface" width="800" height="610" fetchpriority="high" decoding="async">
          </figure>
          <div class="gb-hero__strip">
            <img src="assets/img/pack-1.jpg" alt="Single Golden Bullet 380 capsule" width="400" height="400" loading="lazy" decoding="async">
            <img src="assets/img/pack-3.jpg" alt="Three Golden Bullet 380 capsules" width="400" height="400" loading="lazy" decoding="async">
            <img src="assets/img/pack-6.jpg" alt="Six Golden Bullet 380 capsules" width="400" height="400" loading="lazy" decoding="async">
          </div>
        </div>
      </div>
    </section>

    <section class="gb-section gb-section--tight gb-section--white" aria-labelledby="promise-title">
      <div class="gb-container">
        <h2 id="promise-title" class="gb-visually-hidden">What you can expect from Golden Bullet</h2>
        <div class="gb-feature-row">
          <div class="gb-feature gb-reveal">
            <span class="gb-feature__icon">${icon.truck}</span>
            <h3 class="gb-feature__title">Discreet packaging</h3>
            <p class="gb-feature__text">Plain outer packaging with no product names or imagery on the outside.</p>
          </div>
          <div class="gb-feature gb-reveal" data-reveal-delay="1">
            <span class="gb-feature__icon">${icon.lock}</span>
            <h3 class="gb-feature__title">Secure payment</h3>
            <p class="gb-feature__text">Encrypted checkout with card, transfer and regional payment options.</p>
          </div>
          <div class="gb-feature gb-reveal" data-reveal-delay="2">
            <span class="gb-feature__icon">${icon.support}</span>
            <h3 class="gb-feature__title">Customer support</h3>
            <p class="gb-feature__text">Support by email ${SITE.email} and on WhatsApp during business hours.</p>
          </div>
          <div class="gb-feature gb-reveal" data-reveal-delay="3">
            <span class="gb-feature__icon">${icon.shield}</span>
            <h3 class="gb-feature__title">Delivery in <span data-delivery-country>Nigeria</span></h3>
            <p class="gb-feature__text">Worldwide shipping with tracking. Change your country in the header.</p>
          </div>
        </div>
      </div>
    </section>

    <section class="gb-section gb-section--cream" aria-labelledby="promo-title">
      <div class="gb-container">
        <div class="gb-promo gb-reveal">
          <div>
            <p class="gb-eyebrow">Fall sale</p>
            <h2 id="promo-title">Spice up your nights with Golden Bullet</h2>
            <p class="gb-muted-on-dark">Use code <code>GOLDEN15</code> for 15% off your first order. Offer ends when the timer runs out. At least one pack must be added to your bag before a code can be used.</p>
            <div class="gb-countdown" data-countdown role="timer" aria-label="Time remaining in this sale">
              <div class="gb-countdown__unit"><span class="gb-countdown__value" data-countdown-days>14</span><span class="gb-countdown__label">Days</span></div>
              <div class="gb-countdown__unit"><span class="gb-countdown__value" data-countdown-hours>00</span><span class="gb-countdown__label">Hours</span></div>
              <div class="gb-countdown__unit"><span class="gb-countdown__value" data-countdown-minutes>00</span><span class="gb-countdown__label">Minutes</span></div>
              <div class="gb-countdown__unit"><span class="gb-countdown__value" data-countdown-seconds>00</span><span class="gb-countdown__label">Seconds</span></div>
            </div>
          </div>
          <form class="gb-promo__code-form" data-promo-code-form novalidate>
            <div class="gb-field">
              <label class="gb-field__label" for="promo-code">Discount code</label>
              <input class="gb-input" id="promo-code" type="text" name="code" placeholder="Enter your code" autocomplete="off" autocapitalize="characters" spellcheck="false">
              <span class="gb-field__hint">Codes are applied to your bag and used at checkout.</span>
            </div>
            <div class="gb-promo__code-row">
              <button type="submit" class="gb-btn gb-btn--gold">Apply code</button>
              <a class="gb-btn gb-btn--outline" href="shop.html">Shop packs</a>
            </div>
            <p class="gb-small gb-mb-0" data-promo-status role="status" aria-live="polite"></p>
          </form>
        </div>
      </div>
    </section>

    <section class="gb-section gb-section--white" aria-labelledby="featured-title">
      <div class="gb-container">
        <div class="gb-section__head gb-section__head--center">
          <p class="gb-eyebrow">Take charge of your journey</p>
          <h2 id="featured-title">Vitality tailored for you</h2>
          <p class="gb-lead">From trying it out to stocking up, the packs are designed to fit how you buy. Pick yours and choose your currency at checkout.</p>
        </div>
${productGrid(FEATURED_PRODUCTS, { indent: 8, className: "gb-grid--3", id: "featured-products", limit: 6 })}
        <p class="gb-text-center gb-mt-6"><a class="gb-btn gb-btn--outline" href="shop.html">View all packs</a></p>
      </div>
    </section>

    <section class="gb-section gb-section--cream" aria-labelledby="best-sellers-title">
      <div class="gb-container">
        <div class="gb-section__head gb-section__head--center">
          <p class="gb-eyebrow">Customer favourites</p>
          <h2 id="best-sellers-title">Best sellers</h2>
          <p class="gb-lead">The packs our customers come back for, priced in US dollars. Add a pack to your bag and check out in the currency for your country.</p>
        </div>
${productMarquee(BEST_SELLER_PRODUCTS, { indent: 8, id: "best-sellers", label: "Best sellers", speed: 55, limit: 4 })}
        <p class="gb-text-center gb-mt-6"><a class="gb-btn gb-btn--outline" href="shop.html">Shop all packs</a></p>
      </div>
    </section>

    <section class="gb-section gb-formula" id="about-product" aria-labelledby="about-title">
      <div class="gb-container gb-split">
        <div class="gb-split__media gb-formula__media">
          <img src="assets/img/capsule-light.jpg" alt="Golden Bullet 380 capsule photographed against a light background with fine orbit lines" width="560" height="520" loading="lazy" decoding="async">
        </div>
        <div>
          <p class="gb-eyebrow">The Golden formula</p>
          <h2 id="about-title">About the product</h2>
          <p class="gb-lead">Golden Bullet 380 is a chewable tablet made with three plant ingredients, supplied in sealed single-tablet packs.</p>
          <p>[APPROVED CLAIM FROM LABEL]</p>
          <p>Ingredient information below is taken from the registered product label. Always read the pack you receive, because formulation details such as amounts per tablet are printed there.</p>

          <div class="gb-formula__ingredients">
            <div class="gb-ingredient">
              <span class="gb-ingredient__icon">${icon.leaf}</span>
              <p class="gb-ingredient__name">Snow Lotus Flower</p>
              <p class="gb-ingredient__note">[AMOUNT FROM LABEL]</p>
            </div>
            <div class="gb-ingredient">
              <span class="gb-ingredient__icon">${icon.seed}</span>
              <p class="gb-ingredient__name">Siberian Ginseng</p>
              <p class="gb-ingredient__note">[AMOUNT FROM LABEL]</p>
            </div>
            <div class="gb-ingredient">
              <span class="gb-ingredient__icon">${icon.flask}</span>
              <p class="gb-ingredient__name">Cordyceps</p>
              <p class="gb-ingredient__note">[AMOUNT FROM LABEL]</p>
            </div>
          </div>

          <div class="gb-card gb-card--pad gb-mt-6">
            <h3>Full ingredient list</h3>
            <ul class="gb-list-plain gb-small">
              <li>Cordyceps (Cordyceps sinensis) extract &mdash; [AMOUNT FROM LABEL]</li>
              <li>Siberian Ginseng (Eleutherococcus senticosus) root extract &mdash; [AMOUNT FROM LABEL]</li>
              <li>Snow Lotus Flower (Saussurea involucrata) extract &mdash; [AMOUNT FROM LABEL]</li>
              <li>[REMAINING INGREDIENTS AND EXCIPIENTS FROM LABEL]</li>
            </ul>
            <p class="gb-small gb-muted gb-mb-0">Net content, batch or lot number, expiry date and the regulator registration number are printed on each pack. See the <a href="product.html?id=golden-bullet-380-single-pack">product page</a> for the full label detail.</p>
          </div>

          <div class="gb-notice gb-mt-6">
            <strong>${SITE.notice}</strong>
            Do not use with nitrate medication. Consult a doctor if you have heart conditions, high or low blood pressure, or take other medication.
          </div>

          <p class="gb-mt-6"><a class="gb-btn gb-btn--outline" href="safety-information.html">Read the safety information</a></p>
        </div>
      </div>
    </section>

    <section class="gb-section gb-section--white" id="reviews-section" aria-labelledby="reviews-title" hidden aria-hidden="true">
      <div class="gb-container">
        <div class="gb-section__head gb-section__head--center">
          <p class="gb-eyebrow">Verified reviews</p>
          <h2 id="reviews-title">What our customers are saying</h2>
          <p class="gb-lead">Only reviews tied to a verified purchase are shown here, and nothing is displayed when there are none.</p>
        </div>
        <div class="gb-carousel" data-carousel tabindex="0" role="group" aria-label="Customer reviews">
          <div class="gb-carousel__viewport">
            <ul class="gb-carousel__track" data-reviews-track></ul>
          </div>
          <div class="gb-carousel__nav">
            <button type="button" class="gb-carousel__btn" data-carousel-prev aria-label="Previous reviews">&#8249;</button>
            <div class="gb-carousel__dots" data-carousel-dots></div>
            <button type="button" class="gb-carousel__btn" data-carousel-next aria-label="Next reviews">&#8250;</button>
          </div>
        </div>
      </div>
    </section>

    <section class="gb-section gb-section--cream" aria-labelledby="faq-title">
      <div class="gb-container gb-split">
        <div>
          <p class="gb-eyebrow">Questions</p>
          <h2 id="faq-title">Golden Bullet &mdash; frequently asked questions</h2>
          <p class="gb-muted">Answers here are written to be accurate rather than persuasive. If you are unsure whether this product is right for you, speak to a pharmacist or doctor first.</p>
          <p><a class="gb-btn gb-btn--outline" href="faq.html">See all questions</a></p>
        </div>
        <div>
${accordionMarkup(faqItems.slice(0, 5), "home-faq")}
        </div>
      </div>
    </section>

    <section class="gb-section gb-section--sand" aria-labelledby="newsletter-title">
      <div class="gb-container gb-container--narrow gb-text-center">
        <p class="gb-eyebrow">Newsletter</p>
        <h2 id="newsletter-title">Sale? Be the first to know.</h2>
        <p class="gb-lead gb-mb-6">Join the list for restock alerts and discount codes. We only email adults aged 18 and over, and you can unsubscribe at any time.</p>
        <form class="gb-form" data-newsletter-form novalidate>
          <div class="gb-input-group">
            <label class="gb-visually-hidden" for="home-newsletter-email">Email address</label>
            <input class="gb-input" id="home-newsletter-email" type="email" name="email" placeholder="you@example.com" autocomplete="email" required>
            <button type="submit" class="gb-btn gb-btn--gold">Join the list</button>
          </div>
          <p class="gb-small gb-mb-0" data-newsletter-status role="status" aria-live="polite">We never sell your details. Read the <a href="privacy-policy.html">privacy policy</a>.</p>
        </form>
      </div>
    </section>

    <section class="gb-section gb-section--white" aria-labelledby="latest-title">
      <div class="gb-container">
        <div class="gb-section__head gb-section__head--center">
          <p class="gb-eyebrow">Education</p>
          <h2 id="latest-title">Latest from the blog</h2>
          <p class="gb-lead">Plain-language articles about label literacy, treatment options and what to expect when you order.</p>
        </div>
        <div class="gb-grid gb-grid--3" id="latest-posts"></div>
      </div>
    </section>

${noticeBlock()}`;
}

page("index.html", {
  page: "home",
  title: "Home",
  active: "home",
  description: "Golden Bullet 380 chewable tablets for men, shipped worldwide in discreet packaging. Full label information, safety guidance and verified customer reviews.",
  body: homeBody()
});
/* --------------------------------------------------------------------------
   Shop
   -------------------------------------------------------------------------- */
page("shop.html", {
  page: "shop",
  title: "Shop all packs",
  active: "shop",
  description: "Buy Golden Bullet 380 chewable tablets in 1, 2, 3, 6 and 12 tablet packs. Compare pack prices in US dollars, check stock and pay in your own currency.",
  body: `${breadcrumbs([{ label: "Home", href: "index.html" }, { label: "Shop", href: "shop.html" }])}
${pageHead({
    eyebrow: "Buy now",
    title: "Shop Golden Bullet 380",
    lead: "Choose a pack size, filter by price or availability, and pay in the currency for your country. Prices are shown in US dollars and converted with a static demo rate table."
  })}

  <div class="gb-section gb-section--tight">
    <div class="gb-container gb-shop-layout">
      <aside class="gb-filter-panel" aria-labelledby="filters-title">
        <form class="gb-filters" data-filter-form>
          <h2 id="filters-title" class="gb-h3 gb-mb-0">Filters</h2>

          <fieldset>
            <legend>Pack size</legend>
            <div class="gb-stack-sm" data-facet-packs>
              <label class="gb-check"><input type="radio" name="pack" value="all" checked><span class="gb-check__text">All packs</span></label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Availability</legend>
            <div class="gb-stack-sm">
              <label class="gb-check"><input type="radio" name="availability" value="all" checked><span class="gb-check__text">Show everything</span></label>
              <label class="gb-check"><input type="radio" name="availability" value="in-stock"><span class="gb-check__text">In stock only</span></label>
              <label class="gb-check"><input type="radio" name="availability" value="out-of-stock"><span class="gb-check__text">Out of stock</span></label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Price</legend>
            <div data-facet-price></div>
          </fieldset>

          <div class="gb-cluster">
            <button type="reset" class="gb-btn gb-btn--outline gb-btn--sm">Reset filters</button>
          </div>
        </form>
      </aside>

      <div>
        <div class="gb-shop-toolbar">
          <div class="gb-field">
            <label class="gb-field__label" for="shop-search">Search</label>
            <input class="gb-input" id="shop-search" type="search" name="q" data-shop-search placeholder="Search packs or SKU" autocomplete="off">
          </div>
          <div class="gb-field">
            <label class="gb-field__label" for="shop-sort">Sort by</label>
            <select class="gb-select" id="shop-sort" data-sort>
              <option value="featured">Featured</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="name-asc">Name: A&ndash;Z</option>
            </select>
          </div>
          <div class="gb-field">
            <label class="gb-field__label" for="shop-per-page">Per page</label>
            <select class="gb-select" id="shop-per-page" data-per-page>
              <option value="6">6</option>
              <option value="9">9</option>
              <option value="12">12</option>
            </select>
          </div>
        </div>

        <p class="gb-results-count" data-results-count role="status" aria-live="polite">${SHOP_COUNT_TEXT}</p>
        <div class="gb-cluster gb-my-6" data-active-filters></div>

${productGrid(SHOP_PAGE_ITEMS, { indent: 8, className: "gb-grid--3", id: "product-grid" })}
        <nav class="gb-pagination" data-pagination aria-label="Product pages"></nav>
      </div>
    </div>
  </div>

${noticeBlock()}`
});

/* --------------------------------------------------------------------------
   Product detail
   -------------------------------------------------------------------------- */
page("product.html", {
  page: "product",
  title: "Product details",
  active: "shop",
  description: "Full label detail for Golden Bullet 380: ingredients, dosage and directions, warnings, storage, batch number, expiry date and regulator registration number.",
  body: `${breadcrumbs([{ label: "Home", href: "index.html" }, { label: "Shop", href: "shop.html" }, { label: "Product details", href: "product.html" }])}

  <div class="gb-section gb-section--tight">
    <div class="gb-container">
      <div id="product-detail"></div>
    </div>
  </div>

  <div class="gb-section gb-section--tight gb-section--cream" id="product-reviews" hidden aria-hidden="true">
    <div class="gb-container">
      <h2>Verified customer reviews</h2>
      <p class="gb-muted">Reviews appear here only when they come from a verified purchase. There is nothing to show yet.</p>
      <div data-reviews-summary class="gb-mb-6"></div>
      <ul class="gb-list-plain" data-reviews-list></ul>
    </div>
  </div>

  <div class="gb-section gb-section--tight" id="product-related" hidden>
    <div class="gb-container gb-related">
      <div class="gb-section__head">
        <p class="gb-eyebrow">You may also like</p>
        <h2>Related packs</h2>
      </div>
      <div class="gb-grid gb-grid--3" id="related-products"></div>
    </div>
  </div>

${noticeBlock()}`
});

/* --------------------------------------------------------------------------
   Cart
   -------------------------------------------------------------------------- */
page("cart.html", {
  page: "cart",
  title: "Your bag",
  active: "",
  description: "Review the packs in your bag, update quantities and apply a discount code before checkout.",
  body: `${breadcrumbs([{ label: "Home", href: "index.html" }, { label: "Shop", href: "shop.html" }, { label: "Your bag", href: "cart.html" }])}
${pageHead({
    eyebrow: "Step 1 of 2",
    title: "Your bag",
    lead: "Update quantities or remove items, then continue to checkout. Delivery is calculated from the country selected in the header."
  })}

  <div class="gb-section gb-section--tight">
    <div class="gb-container">
      <div class="gb-cart-layout" id="cart-page">
        <div>
          <div class="gb-alert gb-alert--success" data-discount-applied role="status" hidden></div>
          <div data-cart-items></div>

          <form class="gb-card gb-card--pad gb-mt-6" data-discount-form novalidate>
            <h2 class="gb-h3">Have a discount code?</h2>
            <div class="gb-input-group">
              <label class="gb-visually-hidden" for="cart-discount">Discount code</label>
              <input class="gb-input" id="cart-discount" type="text" name="code" placeholder="Enter code" autocomplete="off" autocapitalize="characters" spellcheck="false">
              <button type="submit" class="gb-btn gb-btn--outline">Apply</button>
            </div>
            <p class="gb-small gb-mb-0" data-discount-status role="status" aria-live="polite">One code per order. Codes are checked against the live API.</p>
          </form>

          <p class="gb-mt-6"><a class="gb-btn gb-btn--ghost" href="shop.html">&larr; Continue shopping</a></p>
        </div>

        <div class="gb-summary" data-cart-summary aria-live="polite"></div>
      </div>
    </div>
  </div>

${noticeBlock()}`
});
/* --------------------------------------------------------------------------
   Checkout
   -------------------------------------------------------------------------- */
const countryOptions = [
  ["NG", "Nigeria"], ["US", "United States"], ["GB", "United Kingdom"], ["IE", "Ireland"],
  ["ZA", "South Africa"], ["KE", "Kenya"], ["GH", "Ghana"], ["OT", "Rest of world"]
].map(([code, name]) => `              <option value="${code}">${name}</option>`).join("\n");

page("checkout.html", {
  page: "checkout",
  title: "Checkout",
  active: "",
  description: "Secure checkout with discreet delivery. Confirm you are 18 or older and have read the safety information before ordering.",
  body: `${breadcrumbs([{ label: "Home", href: "index.html" }, { label: "Your bag", href: "cart.html" }, { label: "Checkout", href: "checkout.html" }])}
${pageHead({
    eyebrow: "Step 2 of 2",
    title: "Checkout",
    lead: "Your order is shipped in plain outer packaging. We never put product names or imagery on the outside of a parcel."
  })}

  <div class="gb-section gb-section--tight">
    <div class="gb-container">
      <div class="gb-checkout-layout">
        <form class="gb-form" id="checkout-form" data-checkout-form novalidate>
          <p class="gb-alert gb-alert--danger" data-form-error role="alert" hidden tabindex="-1"></p>

          <section class="gb-checkout-section" aria-labelledby="checkout-contact">
            <h2 id="checkout-contact">Contact details</h2>
            <div class="gb-fieldset">
              <div class="gb-field">
                <label class="gb-field__label" for="co-email">Email address <span class="gb-req" aria-hidden="true">*</span></label>
                <input class="gb-input" id="co-email" type="email" name="email" autocomplete="email" required aria-describedby="co-email-hint">
                <span class="gb-field__hint" id="co-email-hint">Your receipt and tracking updates are sent here.</span>
                <span class="gb-field__error" id="co-email-error" hidden></span>
              </div>
              <div class="gb-field">
                <label class="gb-field__label" for="co-phone">Phone number <span class="gb-req" aria-hidden="true">*</span></label>
                <input class="gb-input" id="co-phone" type="tel" name="phone" autocomplete="tel" required>
                <span class="gb-field__error" hidden></span>
              </div>
            </div>
          </section>

          <section class="gb-checkout-section" aria-labelledby="checkout-shipping">
            <h2 id="checkout-shipping">Delivery address</h2>
            <div class="gb-fieldset">
              <div class="gb-field">
                <label class="gb-field__label" for="co-first">First name <span class="gb-req" aria-hidden="true">*</span></label>
                <input class="gb-input" id="co-first" type="text" name="firstName" autocomplete="given-name" required>
                <span class="gb-field__error" hidden></span>
              </div>
              <div class="gb-field">
                <label class="gb-field__label" for="co-last">Last name <span class="gb-req" aria-hidden="true">*</span></label>
                <input class="gb-input" id="co-last" type="text" name="lastName" autocomplete="family-name" required>
                <span class="gb-field__error" hidden></span>
              </div>
              <div class="gb-field">
                <label class="gb-field__label" for="co-address1">Street address <span class="gb-req" aria-hidden="true">*</span></label>
                <input class="gb-input" id="co-address1" type="text" name="address1" autocomplete="address-line1" required>
                <span class="gb-field__error" hidden></span>
              </div>
              <div class="gb-field">
                <label class="gb-field__label" for="co-address2">Apartment, suite or landmark</label>
                <input class="gb-input" id="co-address2" type="text" name="address2" autocomplete="address-line2">
              </div>
              <div class="gb-field">
                <label class="gb-field__label" for="co-city">City <span class="gb-req" aria-hidden="true">*</span></label>
                <input class="gb-input" id="co-city" type="text" name="city" autocomplete="address-level2" required>
                <span class="gb-field__error" hidden></span>
              </div>
              <div class="gb-field">
                <label class="gb-field__label" for="co-postal">Postal or ZIP code <span class="gb-req" aria-hidden="true">*</span></label>
                <input class="gb-input" id="co-postal" type="text" name="postalCode" autocomplete="postal-code" required>
                <span class="gb-field__error" hidden></span>
              </div>
              <div class="gb-field">
                <label class="gb-field__label" for="co-country">Country <span class="gb-req" aria-hidden="true">*</span></label>
                <select class="gb-select" id="co-country" name="country" autocomplete="country" required>
${countryOptions}
                </select>
                <span class="gb-field__error" hidden></span>
              </div>
            </div>
          </section>

          <section class="gb-checkout-section" aria-labelledby="checkout-delivery">
            <h2 id="checkout-delivery">Delivery method</h2>
            <div class="gb-stack-sm">
              <label class="gb-check">
                <input type="radio" name="shippingMethod" value="standard" checked>
                <span class="gb-check__text"><strong>Standard delivery</strong> &mdash; 3 to 7 working days. Free over the threshold shown in your summary.</span>
              </label>
              <label class="gb-check">
                <input type="radio" name="shippingMethod" value="express">
                <span class="gb-check__text"><strong>Express delivery</strong> &mdash; 1 to 3 working days where available.</span>
              </label>
              <label class="gb-check">
                <input type="radio" name="shippingMethod" value="pickup">
                <span class="gb-check__text"><strong>Collection point</strong> &mdash; collect from a partner location. We will email the address.</span>
              </label>
            </div>
          </section>

          <section class="gb-checkout-section" aria-labelledby="checkout-prescription" data-prescription-field hidden>
            <h2 id="checkout-prescription">Prescription</h2>
            <div class="gb-alert gb-alert--warning">
              <p class="gb-mb-0">One or more items in your bag can only be dispensed against a valid prescription. Upload a clear photo or scan before placing your order.</p>
            </div>
            <div class="gb-file gb-mt-4">
              <label class="gb-field__label" for="co-prescription">Upload prescription (PDF, JPG or PNG)</label>
              <input id="co-prescription" type="file" name="prescription" accept="application/pdf,image/png,image/jpeg">
              <span class="gb-field__hint">Files are stored securely and reviewed by a pharmacist before dispatch.</span>
              <span class="gb-field__error" hidden></span>
            </div>
          </section>

          <section class="gb-checkout-section" aria-labelledby="checkout-confirm">
            <h2 id="checkout-confirm">Before you order</h2>
            <div class="gb-stack-sm">
              <label class="gb-check">
                <input type="checkbox" name="ageConfirm" required>
                <span class="gb-check__text"><strong>I confirm that I am 18 years or older and that I have read the <a href="safety-information.html">safety information</a>.</strong> I understand this product is not intended to diagnose, treat, cure, or prevent any disease, and that I should consult a healthcare professional before use.</span>
              </label>
              <span class="gb-field__error" data-error-for="ageConfirm" hidden></span>

              <label class="gb-check">
                <input type="checkbox" name="termsConfirm" required>
                <span class="gb-check__text">I accept the <a href="terms.html">terms of service</a>, the <a href="refund-policy.html">refund policy</a> and the <a href="shipping-policy.html">shipping policy</a>.</span>
              </label>
              <span class="gb-field__error" data-error-for="termsConfirm" hidden></span>
            </div>
          </section>

          <div class="gb-alert gb-alert--info">
            <p class="gb-mb-0">Payments are processed by our payment provider. The descriptor on your statement is the trading name shown at checkout. We do not store card details on this site.</p>
          </div>

          <button type="submit" class="gb-btn gb-btn--gold gb-btn--lg gb-btn--block">Place order</button>
        </form>

        <aside aria-labelledby="summary-title">
          <div class="gb-summary">
            <h2 id="summary-title" class="gb-h3">Order summary</h2>
            <div class="gb-stack-sm" data-checkout-summary></div>
            <div class="gb-divider"></div>
            <div data-checkout-totals></div>
            <p class="gb-small gb-muted gb-mb-0">Prices include [TAX TREATMENT PLACEHOLDER]. Duties and import charges may apply outside Nigeria.</p>
          </div>
          <p class="gb-small gb-muted gb-mt-4"><a href="cart.html">Edit your bag</a></p>
        </aside>
      </div>
    </div>
  </div>

${noticeBlock()}`
});
/* --------------------------------------------------------------------------
   Login
   -------------------------------------------------------------------------- */
page("login.html", {
  page: "login",
  title: "Sign in",
  active: "",
  description: "Sign in to your Golden Bullet account to view order history, tracking and saved details.",
  body: `  <div class="gb-container gb-auth">
    <div class="gb-auth__card">
      <p class="gb-eyebrow">Account</p>
      <h1>Sign in</h1>
      <p class="gb-muted">Sign in to track orders and see your order history.</p>

      <form class="gb-form gb-mt-6" id="login-form" novalidate>
        <p class="gb-alert gb-alert--danger" data-form-error role="alert" hidden tabindex="-1"></p>

        <div class="gb-field">
          <label class="gb-field__label" for="login-email">Email address <span class="gb-req" aria-hidden="true">*</span></label>
          <input class="gb-input" id="login-email" type="email" name="email" autocomplete="email" required>
          <span class="gb-field__error" hidden></span>
        </div>

        <div class="gb-field">
          <label class="gb-field__label" for="login-password">Password <span class="gb-req" aria-hidden="true">*</span></label>
          <div class="gb-input-affix">
            <input class="gb-input" id="login-password" type="password" name="password" autocomplete="current-password" required>
            <button type="button" class="gb-input-affix__btn" data-password-toggle aria-pressed="false" aria-controls="login-password">Show</button>
          </div>
          <span class="gb-field__error" hidden></span>
        </div>

        <div class="gb-cluster">
          <label class="gb-check">
            <input type="checkbox" name="remember" value="true">
            <span class="gb-check__text">Keep me signed in on this device</span>
          </label>
        </div>

        <button type="submit" class="gb-btn gb-btn--gold gb-btn--block">Sign in</button>

        <p class="gb-small gb-mb-0"><a href="contact.html">Forgot your password?</a> Contact support and we will reset it for you.</p>
      </form>

      <p class="gb-auth__switch">New here? <a href="register.html">Create an account</a></p>
    </div>

    <aside class="gb-auth__aside">
      <p class="gb-eyebrow">Why create an account</p>
      <h2>Order history, tracking and faster checkout</h2>
      <ul class="gb-list-checked">
        <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg><span>See every order and its delivery status.</span></li>
        <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg><span>Save your delivery details for next time.</span></li>
        <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg><span>Get restock alerts before packs sell out.</span></li>
      </ul>
      <img src="assets/img/pack-3.jpg" alt="Three Golden Bullet 380 capsules" width="500" height="500" loading="lazy" decoding="async">
      <p class="gb-small gb-mb-0">This store is for adults aged 18 and over.</p>
    </aside>
  </div>`
});

/* --------------------------------------------------------------------------
   Register
   -------------------------------------------------------------------------- */
page("register.html", {
  page: "register",
  title: "Create your account",
  active: "",
  description: "Create a Golden Bullet account. You must be 18 or older to register.",
  body: `  <div class="gb-container gb-auth">
    <div class="gb-auth__card">
      <p class="gb-eyebrow">Account</p>
      <h1>Create your account</h1>
      <p class="gb-muted">You must be 18 or older to register. We ask for your date of birth once, so we never have to ask again.</p>

      <form class="gb-form gb-mt-6" id="register-form" novalidate>
        <p class="gb-alert gb-alert--danger" data-form-error role="alert" hidden tabindex="-1"></p>

        <div class="gb-field">
          <label class="gb-field__label" for="reg-first">First name <span class="gb-req" aria-hidden="true">*</span></label>
          <input class="gb-input" id="reg-first" type="text" name="firstName" autocomplete="given-name" required>
          <span class="gb-field__error" hidden></span>
        </div>

        <div class="gb-field">
          <label class="gb-field__label" for="reg-last">Last name <span class="gb-req" aria-hidden="true">*</span></label>
          <input class="gb-input" id="reg-last" type="text" name="lastName" autocomplete="family-name" required>
          <span class="gb-field__error" hidden></span>
        </div>

        <div class="gb-field">
          <label class="gb-field__label" for="reg-email">Email address <span class="gb-req" aria-hidden="true">*</span></label>
          <input class="gb-input" id="reg-email" type="email" name="email" autocomplete="email" required>
          <span class="gb-field__error" hidden></span>
        </div>

        <div class="gb-field">
          <label class="gb-field__label" for="reg-dob">Date of birth <span class="gb-req" aria-hidden="true">*</span></label>
          <input class="gb-input" id="reg-dob" type="date" name="dob" autocomplete="bday" required aria-describedby="reg-dob-hint">
          <span class="gb-field__hint" id="reg-dob-hint">You must be at least 18 years old. We use this only to confirm your age.</span>
          <span class="gb-field__error" hidden></span>
        </div>

        <div class="gb-field">
          <label class="gb-field__label" for="reg-password">Password <span class="gb-req" aria-hidden="true">*</span></label>
          <div class="gb-input-affix">
            <input class="gb-input" id="reg-password" type="password" name="password" autocomplete="new-password" required aria-describedby="reg-strength-label">
            <button type="button" class="gb-input-affix__btn" data-password-toggle aria-pressed="false" aria-controls="reg-password">Show</button>
          </div>
          <div class="gb-strength" data-score="0">
            <div class="gb-strength__track"><div class="gb-strength__bar" data-strength-bar></div></div>
            <p class="gb-strength__label" id="reg-strength-label" data-strength-label role="status" aria-live="polite">Use at least 8 characters with a mix of letters, numbers and symbols.</p>
          </div>
          <span class="gb-field__error" hidden></span>
        </div>

        <div class="gb-field">
          <label class="gb-field__label" for="reg-confirm">Confirm password <span class="gb-req" aria-hidden="true">*</span></label>
          <input class="gb-input" id="reg-confirm" type="password" name="confirmPassword" autocomplete="new-password" required>
          <span class="gb-field__error" hidden></span>
        </div>

        <div class="gb-field">
          <label class="gb-check">
            <input type="checkbox" name="terms" required>
            <span class="gb-check__text">I am 18 or older and I accept the <a href="terms.html">terms of service</a> and the <a href="privacy-policy.html">privacy policy</a>.</span>
          </label>
          <span class="gb-field__error" hidden></span>
        </div>

        <button type="submit" class="gb-btn gb-btn--gold gb-btn--block">Create account</button>
      </form>

      <p class="gb-auth__switch">Already have an account? <a href="login.html">Sign in</a></p>
    </div>

    <aside class="gb-auth__aside">
      <p class="gb-eyebrow">Before you start</p>
      <h2>Is this product right for you?</h2>
      <p>Golden Bullet is a food supplement for adults. It is not a medicine and it is not intended to diagnose, treat, cure, or prevent any disease.</p>
      <p>Do not use it with nitrate medication. Speak to a doctor first if you have a heart condition, high or low blood pressure, or if you take other medication.</p>
      <p><a class="gb-btn gb-btn--outline" href="safety-information.html">Read the safety information</a></p>
    </aside>
  </div>`
});
/* --------------------------------------------------------------------------
   Account
   -------------------------------------------------------------------------- */
page("account.html", {
  page: "account",
  title: "Your account",
  active: "",
  description: "Your Golden Bullet account: order history, tracking and profile details.",
  body: `${breadcrumbs([{ label: "Home", href: "index.html" }, { label: "Your account", href: "account.html" }])}

  <div class="gb-section gb-section--tight">
    <div class="gb-container gb-account-layout" id="account-page">
      <nav aria-labelledby="account-nav-title">
        <h2 id="account-nav-title" class="gb-visually-hidden">Account sections</h2>
        <ul class="gb-account-nav">
          <li><a href="account.html" aria-current="page">Orders <span aria-hidden="true">&rarr;</span></a></li>
          <li><a href="account.html#profile">Profile <span aria-hidden="true">&rarr;</span></a></li>
          <li><a href="cart.html">Your bag <span aria-hidden="true">&rarr;</span></a></li>
          <li><a href="#" data-logout>Log out <span aria-hidden="true">&rarr;</span></a></li>
        </ul>
      </nav>

      <div class="gb-stack-lg">
        <div class="gb-alert gb-alert--success" data-order-placed role="status" hidden></div>

        <div class="gb-account-panel">
          <p class="gb-eyebrow">Welcome back</p>
          <h1>Hello, <span data-account-name>there</span></h1>
          <p class="gb-muted">Your order history is loaded from the API and only shows orders placed on this account.</p>
        </div>

        <section class="gb-account-panel" aria-labelledby="orders-title">
          <h2 id="orders-title">Order history</h2>
          <div data-order-list></div>
        </section>

        <section class="gb-account-panel" id="profile" aria-labelledby="profile-title">
          <h2 id="profile-title">Profile</h2>
          <form class="gb-form" data-profile-form novalidate>
            <div class="gb-field">
              <label class="gb-field__label" for="acc-first">First name <span class="gb-req" aria-hidden="true">*</span></label>
              <input class="gb-input" id="acc-first" type="text" name="firstName" autocomplete="given-name" required>
              <span class="gb-field__error" hidden></span>
            </div>
            <div class="gb-field">
              <label class="gb-field__label" for="acc-last">Last name <span class="gb-req" aria-hidden="true">*</span></label>
              <input class="gb-input" id="acc-last" type="text" name="lastName" autocomplete="family-name" required>
              <span class="gb-field__error" hidden></span>
            </div>
            <div class="gb-field">
              <label class="gb-field__label" for="acc-email">Email address <span class="gb-req" aria-hidden="true">*</span></label>
              <input class="gb-input" id="acc-email" type="email" name="email" autocomplete="email" required>
              <span class="gb-field__error" hidden></span>
            </div>
            <div class="gb-field">
              <label class="gb-field__label" for="acc-phone">Phone number</label>
              <input class="gb-input" id="acc-phone" type="tel" name="phone" autocomplete="tel">
              <span class="gb-field__error" hidden></span>
            </div>
            <div class="gb-cluster">
              <button type="submit" class="gb-btn gb-btn--gold">Save changes</button>
              <button type="button" class="gb-btn gb-btn--outline" data-logout>Log out</button>
            </div>
          </form>
        </section>
      </div>
    </div>
  </div>`
});

/* --------------------------------------------------------------------------
   Blog
   -------------------------------------------------------------------------- */
page("blog.html", {
  page: "blog",
  title: "Blog",
  active: "blog",
  description: "Plain-language education about men's health, supplement labels and what to expect when ordering Golden Bullet.",
  body: `${breadcrumbs([{ label: "Home", href: "index.html" }, { label: "Blog", href: "blog.html" }])}
${pageHead({
    eyebrow: "Education",
    title: "The Golden Bullet blog",
    lead: "Articles are written to be accurate rather than persuasive, and they are reviewed before publication. Nothing here is medical advice."
  })}

  <div class="gb-section gb-section--tight">
    <div class="gb-container">
      <p class="gb-results-count gb-mb-6" data-blog-status role="status" aria-live="polite">Loading articles&hellip;</p>
      <div class="gb-grid gb-grid--3" id="blog-posts"></div>
    </div>
  </div>

${noticeBlock()}`
});

/* --------------------------------------------------------------------------
   Blog post
   -------------------------------------------------------------------------- */
page("blog-post.html", {
  page: "blog-post",
  title: "Article",
  active: "blog",
  description: "An educational article from Golden Bullet. Nothing on this page is medical advice.",
  body: `${breadcrumbs([{ label: "Home", href: "index.html" }, { label: "Blog", href: "blog.html" }, { label: "Article", href: "blog-post.html" }])}

  <div class="gb-section gb-section--tight">
    <div class="gb-container">
      <div id="post-root"></div>
    </div>
  </div>

${noticeBlock()}`
});

/* --------------------------------------------------------------------------
   Contact
   -------------------------------------------------------------------------- */
page("contact.html", {
  page: "contact",
  title: "Contact",
  active: "contact",
  description: "Contact Golden Bullet support about orders, delivery, returns, prescriptions or product label questions.",
  body: `${breadcrumbs([{ label: "Home", href: "index.html" }, { label: "Contact", href: "contact.html" }])}
${pageHead({
    eyebrow: "Support",
    title: "Contact us",
    lead: "Questions about an order, a delivery, a return, a prescription upload or a label detail? Send us a message and support will reply by email."
  })}

  <div class="gb-section gb-section--tight">
    <div class="gb-container gb-contact-layout">
      <div>
        <form class="gb-card gb-card--pad gb-form" id="contact-form" novalidate>
          <h2 class="gb-h3">Send a message</h2>
          <p class="gb-alert gb-alert--info" data-form-status role="status" hidden></p>

          <div class="gb-field">
            <label class="gb-field__label" for="contact-name">Your name <span class="gb-req" aria-hidden="true">*</span></label>
            <input class="gb-input" id="contact-name" type="text" name="name" autocomplete="name" required>
            <span class="gb-field__error" hidden></span>
          </div>

          <div class="gb-field">
            <label class="gb-field__label" for="contact-email">Email address <span class="gb-req" aria-hidden="true">*</span></label>
            <input class="gb-input" id="contact-email" type="email" name="email" autocomplete="email" required>
            <span class="gb-field__error" hidden></span>
          </div>

          <div class="gb-field">
            <label class="gb-field__label" for="contact-subject">Subject <span class="gb-req" aria-hidden="true">*</span></label>
            <select class="gb-select" id="contact-subject" name="subject" required>
              <option value="">Choose a subject</option>
              <option value="order">An order or delivery</option>
              <option value="returns">Returns and refunds</option>
              <option value="prescription">Prescription upload</option>
              <option value="label">Ingredients, dosage or label question</option>
              <option value="safety">A safety or side effect concern</option>
              <option value="affiliate">Affiliate programme</option>
              <option value="other">Something else</option>
            </select>
            <span class="gb-field__error" hidden></span>
          </div>

          <div class="gb-field">
            <label class="gb-field__label" for="contact-ref">Order reference (optional)</label>
            <input class="gb-input" id="contact-ref" type="text" name="orderRef" autocomplete="off" placeholder="e.g. GB-XXXXXXX">
            <span class="gb-field__hint">Adding a reference helps us find your order faster.</span>
            <span class="gb-field__error" hidden></span>
          </div>

          <div class="gb-field">
            <label class="gb-field__label" for="contact-message">How can we help? <span class="gb-req" aria-hidden="true">*</span></label>
            <textarea class="gb-textarea" id="contact-message" name="message" required aria-describedby="contact-message-hint"></textarea>
            <span class="gb-field__hint" id="contact-message-hint">Please do not include medical details you would rather not share by email.</span>
            <span class="gb-field__error" hidden></span>
          </div>

          <div class="gb-alert gb-alert--warning">
            <p class="gb-mb-0">If you are reporting a side effect, please use the <a href="safety-information.html#report">adverse reaction form</a> instead so it reaches the right team. If this is a medical emergency, contact your local emergency service immediately.</p>
          </div>

          <button type="submit" class="gb-btn gb-btn--gold">Send message</button>
        </form>
      </div>

      <div class="gb-contact-aside">
        <div class="gb-info-card">
          <h2>Email</h2>
          <p><a href="mailto:${SITE.email}">${SITE.email}</a></p>
          <p class="gb-small gb-muted gb-mb-0">Replies within one business day.</p>
        </div>
        <div class="gb-info-card">
          <h2>WhatsApp and phone</h2>
          <p>${SITE.phone}</p>
          <p class="gb-small gb-muted gb-mb-0">Monday to Friday, 09:00&ndash;17:00 WAT.</p>
        </div>
        <div class="gb-info-card">
          <h2>Order help</h2>
          <ul class="gb-icon-list">
            <li>${icon.truck}<span>Tracking is emailed when your parcel is dispatched.</span></li>
            <li>${icon.shield}<span>Returns follow the <a href="refund-policy.html">refund policy</a>.</span></li>
            <li>${icon.alert}<span>Report a side effect through the <a href="safety-information.html#report">adverse reaction form</a>.</span></li>
          </ul>
        </div>
        <div class="gb-notice">
          <strong>${SITE.notice}</strong>
          We cannot give medical advice by email. Speak to a pharmacist or doctor about your own situation.
        </div>
      </div>
    </div>
  </div>`
});
/* --------------------------------------------------------------------------
   Affiliate
   -------------------------------------------------------------------------- */
page("affiliate.html", {
  page: "affiliate",
  title: "Affiliate programme",
  active: "affiliate",
  description: "Apply to the Golden Bullet affiliate programme. Adults 18 and over only. Commission terms are placeholders for you to confirm.",
  body: `${breadcrumbs([{ label: "Home", href: "index.html" }, { label: "Affiliate", href: "affiliate.html" }])}
${pageHead({
    eyebrow: "Partner with us",
    title: "Golden Bullet affiliate programme",
    lead: "Promote Golden Bullet to an adult audience and earn commission on tracked orders. Applications are reviewed manually so we can keep promotion accurate and compliant."
  })}

  <div class="gb-section gb-section--tight">
    <div class="gb-container">
      <div class="gb-stats">
        <div class="gb-stat"><span class="gb-stat__value">[X]%</span><span class="gb-stat__label">Commission per order</span></div>
        <div class="gb-stat"><span class="gb-stat__value">[N]</span><span class="gb-stat__label">Days cookie window</span></div>
        <div class="gb-stat"><span class="gb-stat__value">[N]</span><span class="gb-stat__label">Day payout cycle</span></div>
        <div class="gb-stat"><span class="gb-stat__value">[CURRENCY]</span><span class="gb-stat__label">Payout currency</span></div>
      </div>
    </div>
  </div>

  <div class="gb-section gb-section--tight gb-section--cream">
    <div class="gb-container">
      <div class="gb-section__head">
        <h2>How it works</h2>
        <p class="gb-lead">Three steps, and a compliance check at every one of them.</p>
      </div>
      <div class="gb-steps-grid">
        <div class="gb-card gb-card--pad">
          <h3>1. Apply</h3>
          <p>Tell us about your audience and the channels you publish on. You must be 18 or older.</p>
        </div>
        <div class="gb-card gb-card--pad">
          <h3>2. Get approved</h3>
          <p>We review applications for compliance with advertising rules for supplements and age-restricted products.</p>
        </div>
        <div class="gb-card gb-card--pad">
          <h3>3. Share and earn</h3>
          <p>Use your tracked links and approved assets. Commission is calculated on delivered, non-refunded orders.</p>
        </div>
      </div>
    </div>
  </div>

  <div class="gb-section gb-section--tight">
    <div class="gb-container gb-split">
      <div>
        <h2>What you can and cannot say</h2>
        <p>Affiliates must follow the same rules we do. Promotions may not claim that the product is completely safe, has no side effects, is guaranteed to work, lasts a set number of days, or cures or treats any condition.</p>
        <ul class="gb-list-checked">
          <li>${icon.shield}<span>Use only the approved copy, images and claims supplied in your partner pack.</span></li>
          <li>${icon.shield}<span>Always show the 18+ notice and link to the safety information.</span></li>
          <li>${icon.shield}<span>Never target audiences under 18 and never advertise on youth-oriented channels.</span></li>
        </ul>
        <p class="gb-small gb-muted">[ADD YOUR FULL AFFILIATE PROGRAMME TERMS HERE]</p>
      </div>

      <form class="gb-card gb-card--pad gb-form" id="affiliate-form" novalidate>
        <h2 class="gb-h3">Apply to the programme</h2>
        <p class="gb-alert gb-alert--info" data-form-status role="status" hidden></p>

        <div class="gb-field">
          <label class="gb-field__label" for="aff-name">Full name <span class="gb-req" aria-hidden="true">*</span></label>
          <input class="gb-input" id="aff-name" type="text" name="name" autocomplete="name" required>
          <span class="gb-field__error" hidden></span>
        </div>

        <div class="gb-field">
          <label class="gb-field__label" for="aff-email">Email address <span class="gb-req" aria-hidden="true">*</span></label>
          <input class="gb-input" id="aff-email" type="email" name="email" autocomplete="email" required>
          <span class="gb-field__error" hidden></span>
        </div>

        <div class="gb-field">
          <label class="gb-field__label" for="aff-channel">Main channel <span class="gb-req" aria-hidden="true">*</span></label>
          <input class="gb-input" id="aff-channel" type="text" name="channel" placeholder="Website, newsletter, social handle" required>
          <span class="gb-field__error" hidden></span>
        </div>

        <div class="gb-field">
          <label class="gb-field__label" for="aff-audience">Tell us about your audience <span class="gb-req" aria-hidden="true">*</span></label>
          <textarea class="gb-textarea" id="aff-audience" name="audience" required aria-describedby="aff-audience-hint"></textarea>
          <span class="gb-field__hint" id="aff-audience-hint">Audience size, location, age range and content focus.</span>
          <span class="gb-field__error" hidden></span>
        </div>

        <div class="gb-field">
          <label class="gb-field__label" for="aff-country">Country <span class="gb-req" aria-hidden="true">*</span></label>
          <select class="gb-select" id="aff-country" name="country" required>
            <option value="">Choose a country</option>
${countryOptions.replace(/^ {14}/gm, "            ")}
          </select>
          <span class="gb-field__error" hidden></span>
        </div>

        <div class="gb-field">
          <label class="gb-check">
            <input type="checkbox" name="adult" required>
            <span class="gb-check__text">I confirm that I am 18 or older and that my audience is an adult audience.</span>
          </label>
          <span class="gb-field__error" hidden></span>
        </div>

        <button type="submit" class="gb-btn gb-btn--gold">Submit application</button>
      </form>
    </div>
  </div>

${noticeBlock()}`
});

/* --------------------------------------------------------------------------
   FAQ
   -------------------------------------------------------------------------- */
const detailedFaq = faqItems.concat([
  {
    q: "What is Golden Bullet 380?",
    a: "<p>It is a chewable food supplement supplied in sealed single-tablet packs. The pack lists all ingredients with amounts where required, the dosage and directions, warnings, storage instructions, the batch or lot number, the expiry date and the regulator registration number.</p>"
  },
  {
    q: "Does Golden Bullet interact with medication?",
    a: "<p>Do not use it with nitrate medication or any medicine used for chest pain. If you take medication for blood pressure, heart conditions, diabetes, depression or anything else, speak to your doctor or pharmacist before use and show them the label.</p>"
  },
  {
    q: "How should I store it?",
    a: "<p>Follow the storage instructions on the pack. In general, keep the pack closed, below 25&deg;C, away from direct sunlight, heat and moisture, and out of reach of children.</p>"
  },
  {
    q: "How can I track my order?",
    a: "<p>You will receive a tracking link by email when your parcel is dispatched. If you have an account you can also see order status under <a href=\"account.html\">your account</a>.</p>"
  },
  {
    q: "Do you ship worldwide?",
    a: "<p>We ship to the countries listed in the header country selector. Delivery times and any import duties depend on your destination. See the <a href=\"shipping-policy.html\">shipping policy</a> for details.</p>"
  },
  {
    q: "Can I return an opened pack?",
    a: "<p>For health and safety reasons, opened packs cannot be returned unless the product is faulty or was sent in error. Sealed, unopened packs can be returned within the window set out in the <a href=\"refund-policy.html\">refund policy</a>.</p>"
  }
]);

page("faq.html", {
  page: "faq",
  title: "Frequently asked questions",
  active: "",
  description: "Accurate answers about taking Golden Bullet, who should avoid it, when to see a doctor, shipping, returns and refunds.",
  body: `${breadcrumbs([{ label: "Home", href: "index.html" }, { label: "FAQ", href: "faq.html" }])}
${pageHead({
    eyebrow: "Answers",
    title: "Frequently asked questions",
    lead: "These answers are written to be accurate and cautious. If a question about your own health is not answered here, speak to a pharmacist or doctor."
  })}

  <div class="gb-section gb-section--tight">
    <div class="gb-container gb-split">
      <div>
${accordionMarkup(detailedFaq, "faq-page")}
      </div>
      <div class="gb-stack">
        <div class="gb-notice">
          <strong>${SITE.notice}</strong>
          Do not use with nitrate medication. Consult a doctor if you have heart conditions, high or low blood pressure, or take other medication.
        </div>
        <div class="gb-info-card">
          <h2>Still unsure?</h2>
          <p>Support can answer questions about orders, delivery and label details. We cannot give medical advice.</p>
          <p class="gb-mb-0"><a class="gb-btn gb-btn--outline" href="contact.html">Contact support</a></p>
        </div>
        <div class="gb-info-card">
          <h2>Read the safety information</h2>
          <p>Interactions, who should not use the product, and when to seek medical help.</p>
          <p class="gb-mb-0"><a class="gb-btn gb-btn--outline" href="safety-information.html">Safety information</a></p>
        </div>
      </div>
    </div>
  </div>`
});
/* --------------------------------------------------------------------------
   Safety information
   -------------------------------------------------------------------------- */
page("safety-information.html", {
  page: "safety",
  title: "Safety information",
  active: "contact",
  description: "Safety guidance for Golden Bullet: who should not use it, interactions to know about, when to seek medical help and how to report a side effect.",
  body: `${breadcrumbs([{ label: "Home", href: "index.html" }, { label: "Safety information", href: "safety-information.html" }])}
${pageHead({
    eyebrow: "Read before you buy",
    title: "Safety information",
    lead: "This page summarises the safety guidance that also appears on the product pack. It is general information, not medical advice."
  })}

  <div class="gb-section gb-section--tight">
    <div class="gb-container gb-contact-layout">
      <div class="gb-prose">
        <div class="gb-notice gb-mb-6">
          <strong>${SITE.notice}</strong>
          Do not use with nitrate medication. Consult a doctor if you have heart conditions, high or low blood pressure, or take other medication. Keep out of reach of children.
        </div>

        <nav class="gb-toc gb-mb-6" aria-labelledby="safety-toc-title">
          <h2 id="safety-toc-title" class="gb-h3">On this page</h2>
          <ol>
            <li><a href="#not-for">Who should not use this product</a></li>
            <li><a href="#interactions">Interactions to know about</a></li>
            <li><a href="#urgent">When to seek medical help urgently</a></li>
            <li><a href="#taking">Taking the product safely</a></li>
            <li><a href="#report">Report an adverse reaction</a></li>
          </ol>
        </nav>

        <h2 id="not-for">1. Who should not use this product</h2>
        <ul>
          <li>Anyone under 18 years of age.</li>
          <li>Anyone taking nitrate medication, including nitroglycerin, isosorbide mononitrate or isosorbide dinitrate, or any medicine used to treat chest pain.</li>
          <li>Anyone who has been told by a doctor not to take this type of product.</li>
          <li>Anyone who is pregnant or breastfeeding.</li>
          <li>Anyone who is allergic to any ingredient listed on the pack. Check the full ingredient list before use.</li>
        </ul>

        <h2 id="interactions">2. Interactions to know about</h2>
        <p>Speak to a doctor or pharmacist before use if you take any of the following, or any other prescription, over-the-counter or herbal product:</p>
        <ul>
          <li>Medicines for high or low blood pressure, including alpha-blockers and beta-blockers.</li>
          <li>Medicines for chest pain or heart conditions, including nitrates.</li>
          <li>Medicines for erectile dysfunction, whether prescribed or bought elsewhere.</li>
          <li>Medicines for diabetes, depression, HIV or fungal infections.</li>
          <li>Blood-thinning medicines such as warfarin or aspirin.</li>
          <li>Other supplements, particularly those marketed for stamina or energy.</li>
        </ul>
        <p><strong>Do not combine this product with nitrate medication under any circumstances.</strong></p>

        <h2 id="urgent">3. When to seek medical help urgently</h2>
        <p>Stop using the product and get medical help immediately if you experience any of the following:</p>
        <ul>
          <li>Chest pain, pressure or tightness, or pain spreading to the arm, jaw or back.</li>
          <li>An irregular, racing or pounding heartbeat.</li>
          <li>Fainting, collapse, severe dizziness or sudden confusion.</li>
          <li>Difficulty breathing, swelling of the face, lips or tongue, or a widespread rash.</li>
          <li>An erection that is painful or lasts longer than four hours. This is a medical emergency and can cause permanent damage if untreated.</li>
          <li>Sudden loss of vision or hearing.</li>
        </ul>
        <p>If you are in Nigeria, contact your nearest emergency department. If you are elsewhere, contact your local emergency number.</p>

        <h2 id="taking">4. Taking the product safely</h2>
        <ol>
          <li>Read the pack before your first dose and follow the dosage and directions printed on it exactly.</li>
          <li>Do not exceed the maximum amount stated on the label in any 24-hour period.</li>
          <li>Do not use the product continuously for longer than the label advises.</li>
          <li>Store it as directed on the pack, away from children.</li>
          <li>Stop use and seek advice if you feel unwell, and tell your clinician what you have been taking, including the batch number.</li>
        </ol>
        <p class="gb-small gb-muted">[ADD THE FULL SAFETY WORDING APPROVED ON YOUR REGISTERED LABEL HERE.]</p>

        <h2 id="report">5. Report an adverse reaction</h2>
        <p>If you think this product has caused an unwanted effect, stop using it and seek medical advice. Then tell us what happened using the form below, so we can record it and follow up. You can also report it to the regulator that registered the product.</p>

        <form class="gb-card gb-card--pad gb-form gb-mt-6" id="adverse-reaction-form" novalidate>
          <h3 class="gb-h3">Adverse reaction report</h3>
          <p class="gb-alert gb-alert--info" data-form-status role="status" hidden></p>

          <div class="gb-field">
            <label class="gb-field__label" for="ar-name">Your name <span class="gb-req" aria-hidden="true">*</span></label>
            <input class="gb-input" id="ar-name" type="text" name="reporterName" autocomplete="name" required>
            <span class="gb-field__error" hidden></span>
          </div>

          <div class="gb-field">
            <label class="gb-field__label" for="ar-email">Email address <span class="gb-req" aria-hidden="true">*</span></label>
            <input class="gb-input" id="ar-email" type="email" name="reporterEmail" autocomplete="email" required>
            <span class="gb-field__error" hidden></span>
          </div>

          <div class="gb-field">
            <label class="gb-field__label" for="ar-product">Product <span class="gb-req" aria-hidden="true">*</span></label>
            <input class="gb-input" id="ar-product" type="text" name="productName" placeholder="Golden Bullet 380 — pack size" required>
            <span class="gb-field__error" hidden></span>
          </div>

          <div class="gb-field">
            <label class="gb-field__label" for="ar-batch">Batch or lot number <span class="gb-req" aria-hidden="true">*</span></label>
            <input class="gb-input" id="ar-batch" type="text" name="batchNumber" placeholder="Printed on the pack" required aria-describedby="ar-batch-hint">
            <span class="gb-field__hint" id="ar-batch-hint">This is printed next to the expiry date on every pack.</span>
            <span class="gb-field__error" hidden></span>
          </div>

          <div class="gb-field">
            <label class="gb-field__label" for="ar-date">Date the reaction started <span class="gb-req" aria-hidden="true">*</span></label>
            <input class="gb-input" id="ar-date" type="date" name="reactionDate" required>
            <span class="gb-field__error" hidden></span>
          </div>

          <div class="gb-field">
            <label class="gb-field__label" for="ar-description">What happened? <span class="gb-req" aria-hidden="true">*</span></label>
            <textarea class="gb-textarea" id="ar-description" name="description" required aria-describedby="ar-description-hint"></textarea>
            <span class="gb-field__hint" id="ar-description-hint">Include what you took, when, how much, and any other medication or supplements you were using.</span>
            <span class="gb-field__error" hidden></span>
          </div>

          <div class="gb-field">
            <label class="gb-check">
              <input type="checkbox" name="consent" required>
              <span class="gb-check__text">I agree that Golden Bullet may contact me about this report and share it with the regulator where required.</span>
            </label>
            <span class="gb-field__error" hidden></span>
          </div>

          <button type="submit" class="gb-btn gb-btn--gold">Send report</button>
        </form>
      </div>

      <aside class="gb-contact-aside">
        <div class="gb-info-card">
          <h2>Regulator registration</h2>
          <p>${SITE.regLine}</p>
          <p class="gb-small gb-muted gb-mb-0">[ADD THE REGULATOR NAME, ADDRESS AND REPORTING CONTACT FOR YOUR MARKET]</p>
        </div>
        <div class="gb-info-card">
          <h2>Emergency</h2>
          <p>This form is not monitored around the clock. If you need urgent medical help, contact your local emergency service or go to your nearest emergency department.</p>
        </div>
        <div class="gb-info-card">
          <h2>Questions about an order?</h2>
          <p class="gb-mb-0"><a class="gb-btn gb-btn--outline" href="contact.html">Contact support</a></p>
        </div>
      </aside>
    </div>
  </div>

${noticeBlock()}`
});
/* --------------------------------------------------------------------------
   Policy pages (placeholder legal text)
   -------------------------------------------------------------------------- */
const policyLinks = [
  { label: "Privacy policy", href: "privacy-policy.html" },
  { label: "Terms of service", href: "terms.html" },
  { label: "Refund policy", href: "refund-policy.html" },
  { label: "Shipping policy", href: "shipping-policy.html" }
];

function legalPage({ pageId, title, lead, updated, description, sections }) {
  const toc = sections.map((section) => `            <li><a href="#${section.id}">${section.heading}</a></li>`).join("\n");
  const body = sections.map((section) => `        <h2 id="${section.id}">${section.heading}</h2>\n${section.html}`).join("\n\n");
  const related = policyLinks.map((link) => `          <li><a href="${link.href}">${link.label}</a></li>`).join("\n");
  return `${breadcrumbs([{ label: "Home", href: "index.html" }, { label: title, href: pageId + ".html" }])}
${pageHead({ eyebrow: "Legal", title, lead })}

  <div class="gb-section gb-section--tight">
    <div class="gb-container gb-contact-layout">
      <div class="gb-prose">
        <p class="gb-small gb-muted">Last updated: ${updated}. <strong>[PLACEHOLDER LEGAL TEXT]</strong> This page is a structured starting point. Replace every bracketed passage with wording reviewed by your own legal adviser before you launch.</p>

        <nav class="gb-toc gb-mb-6" aria-labelledby="policy-toc-title">
          <h2 id="policy-toc-title" class="gb-h3">On this page</h2>
          <ol>
${toc}
          </ol>
        </nav>

${body}
      </div>

      <aside class="gb-contact-aside">
        <div class="gb-info-card">
          <h2>Other policies</h2>
          <ul class="gb-footer__list">
${related}
          </ul>
        </div>
        <div class="gb-info-card">
          <h2>Questions?</h2>
          <p>Email <a href="mailto:${SITE.email}">${SITE.email}</a> and we will respond within one business day.</p>
        </div>
        <div class="gb-notice">
          <strong>${SITE.notice}</strong>
        </div>
      </aside>
    </div>
  </div>`;
}

page("privacy-policy.html", {
  page: "privacy",
  title: "Privacy policy",
  active: "",
  description: "How Golden Bullet collects, uses, stores and shares personal information, and the rights you have over your data.",
  body: legalPage({
    pageId: "privacy-policy",
    title: "Privacy policy",
    lead: "How we collect, use and protect personal information, including the extra care we take with health-related information.",
    updated: "[DATE]",
    sections: [
      { id: "who-we-are", heading: "1. Who we are", html: "<p>[COMPANY LEGAL NAME], trading as Golden Bullet, is the data controller for information collected on this website. Registered address: [COMPANY ADDRESS]. Contact: <a href=\"mailto:" + SITE.email + "\">" + SITE.email + "</a>.</p>" },
      { id: "what-we-collect", heading: "2. Information we collect", html: "<ul><li>Account details: name, email address, phone number, date of birth (used to confirm you are 18 or older) and password.</li><li>Order details: products, quantities, delivery address, order value and payment status.</li><li>Prescription uploads, where a product requires one.</li><li>Support messages, including any information you choose to send us and adverse reaction reports.</li><li>Technical data: IP address, device and browser type, pages viewed and cookie identifiers.</li></ul>" },
      { id: "health-data", heading: "3. Health-related information", html: "<p>Adverse reaction reports and prescription uploads may contain health information. We treat this as special category data, restrict access to trained staff, and only use it to process your order, meet pharmacovigilance obligations and comply with the law. [ADD YOUR LAWFUL BASIS AND RETENTION PERIOD]</p>" },
      { id: "why", heading: "4. Why we use your information", html: "<ul><li>To create and manage your account and verify your age.</li><li>To process, pack, deliver and track orders, and to handle returns.</li><li>To provide customer support.</li><li>To prevent fraud and misuse of the store.</li><li>To send marketing where you have opted in, which you can withdraw at any time.</li><li>To meet legal, tax and regulatory obligations.</li></ul>" },
      { id: "cookies", heading: "5. Cookies", html: "<p>Essential cookies are required for the age check, your bag and your currency choice. Optional analytics cookies are only set if you accept them in the cookie banner. You can change your choice at any time by clearing site data or using the banner. [LIST YOUR COOKIES AND PROVIDERS]</p>" },
      { id: "sharing", heading: "6. Who we share it with", html: "<p>Payment processors, delivery and courier companies, hosting and email providers, fraud prevention services, and regulators where the law requires it. [LIST YOUR PROCESSORS AND THEIR LOCATIONS]</p>" },
      { id: "retention", heading: "7. How long we keep it", html: "<p>[RETENTION PERIODS BY CATEGORY OF DATA]</p>" },
      { id: "rights", heading: "8. Your rights", html: "<p>Depending on where you live you may have the right to access, correct, delete, restrict or object to the processing of your information, to data portability, and to withdraw consent. Contact <a href=\"mailto:" + SITE.email + "\">" + SITE.email + "</a> to exercise these rights. You may also complain to your local data protection authority.</p>" },
      { id: "security", heading: "9. Security", html: "<p>[DESCRIBE ENCRYPTION, ACCESS CONTROLS, STAFF TRAINING AND BREACH PROCEDURES]</p>" },
      { id: "children", heading: "10. Children", html: "<p>This store is for adults aged 18 and over. We do not knowingly collect information from anyone under 18. If you believe a minor has provided information, contact us and we will delete it.</p>" },
      { id: "changes", heading: "11. Changes to this policy", html: "<p>We will post any changes on this page and update the date above. [ADD YOUR NOTIFICATION PROCESS]</p>" }
    ]
  })
});

page("terms.html", {
  page: "terms",
  title: "Terms of service",
  active: "",
  description: "The terms that govern purchases from Golden Bullet, including age restrictions, orders, pricing and liability.",
  body: legalPage({
    pageId: "terms",
    title: "Terms of service",
    lead: "The rules that apply when you browse this store or place an order.",
    updated: "[DATE]",
    sections: [
      { id: "agreement", heading: "1. Agreement", html: "<p>By using this website you agree to these terms. If you do not agree, please do not use the store. [COMPANY LEGAL NAME] provides this store. [COMPANY ADDRESS, REGISTRATION NUMBER]</p>" },
      { id: "eligibility", heading: "2. Age restriction", html: "<p>You must be at least 18 years old to buy from this store. By placing an order you confirm that you are 18 or older and that it is legal to purchase these products in your country. We may ask for proof of age and may cancel an order if it cannot be verified.</p>" },
      { id: "products", heading: "3. Products and information", html: "<p>Our products are food supplements, not medicines. They are not intended to diagnose, treat, cure, or prevent any disease. Product descriptions are limited to the information printed on the registered product label, and label details may change between batches. Nothing on this website is medical advice.</p>" },
      { id: "orders", heading: "4. Orders and acceptance", html: "<p>Your order is an offer to buy. A contract forms when we confirm dispatch. We may decline or cancel an order where a product is unavailable, where payment cannot be verified, where an age or prescription check fails, or where we are required to do so by law. [ADD YOUR ORDER ACCEPTANCE AND CANCELLATION RULES]</p>" },
      { id: "pricing", heading: "5. Pricing and currency", html: "<p>Prices are shown in the currency you select, converted from the store base currency using a rate table that is updated periodically. [DESCRIBE RATE SOURCE AND UPDATES] Import duties and taxes outside the shipping country are your responsibility unless stated otherwise at checkout.</p>" },
      { id: "prescriptions", heading: "6. Prescription products", html: "<p>Where a product requires a prescription, you must upload a valid prescription before dispatch. We may verify it with the prescriber and may cancel the order if it cannot be validated. [ADD YOUR PHARMACY AND VERIFICATION PROCESS]</p>" },
      { id: "payment", heading: "7. Payment", html: "<p>[LIST PAYMENT METHODS, AUTHORISATION TIMING, CURRENCY CONVERSION FEES AND CHARGEBACK RULES]</p>" },
      { id: "delivery", heading: "8. Delivery and risk", html: "<p>Delivery estimates are not guarantees. Risk passes to you on delivery to the address you supplied. See the <a href=\"shipping-policy.html\">shipping policy</a> for detail.</p>" },
      { id: "returns", heading: "9. Returns and refunds", html: "<p>Returns are governed by the <a href=\"refund-policy.html\">refund policy</a>, which forms part of these terms.</p>" },
      { id: "conduct", heading: "10. Acceptable use", html: "<p>Do not misuse the store, attempt to access accounts that are not yours, scrape the catalogue, upload malicious files, or place fraudulent orders.</p>" },
      { id: "liability", heading: "11. Liability", html: "<p>To the fullest extent permitted by law, our liability is limited to the value of the order concerned. Nothing in these terms excludes liability that cannot lawfully be excluded, including for death or personal injury caused by negligence. [HAVE YOUR LAWYER REVIEW THIS CLAUSE]</p>" },
      { id: "law", heading: "12. Governing law and disputes", html: "<p>[SPECIFY THE COURTS AND THE LAW THAT APPLY, AND ANY COMPLAINT OR DISPUTE PROCESS]</p>" },
      { id: "changes", heading: "13. Changes", html: "<p>We may update these terms. The version in force is the one published when you place your order.</p>" }
    ]
  })
});

page("refund-policy.html", {
  page: "refund",
  title: "Refund policy",
  active: "",
  description: "When Golden Bullet accepts returns, how refunds are processed, and what to do if a parcel arrives damaged or incorrect.",
  body: legalPage({
    pageId: "refund-policy",
    title: "Refund policy",
    lead: "When returns are accepted, how long refunds take, and how to start a return.",
    updated: "[DATE]",
    sections: [
      { id: "window", heading: "1. Return window", html: "<p>You may request a return within [NUMBER] days of delivery. Contact <a href=\"mailto:" + SITE.email + "\">" + SITE.email + "</a> or use the <a href=\"contact.html\">contact form</a> with your order reference before sending anything back.</p>" },
      { id: "condition", heading: "2. Condition of goods", html: "<p>For health and safety reasons, we can only accept sealed, unopened packs with their original labels intact. Opened packs cannot be returned unless the product is faulty or was sent in error. [CONFIRM THIS WITH YOUR LEGAL AND REGULATORY ADVISER]</p>" },
      { id: "faulty", heading: "3. Faulty, damaged or incorrect items", html: "<p>If your parcel arrives damaged, or contains the wrong item, tell us within [NUMBER] days with a photo of the pack and the outer packaging. We will replace it or refund it in full, including any delivery charge.</p>" },
      { id: "process", heading: "4. How to start a return", html: "<ol><li>Contact support with your order reference and the reason for the return.</li><li>We will confirm whether the return is accepted and send instructions.</li><li>Return the item in its original packaging, using a tracked service.</li><li>We inspect the item when it arrives and then process the refund or replacement.</li></ol>" },
      { id: "refunds", heading: "5. Refund timing and method", html: "<p>Approved refunds are issued to the original payment method within [NUMBER] working days of approval. Bank or provider timelines may add a few days depending on your country. [DETAIL ANY RESTOCKING OR RETURN SHIPPING FEES]</p>" },
      { id: "exceptions", heading: "6. What cannot be refunded", html: "<ul><li>Opened packs, except where faulty or sent in error.</li><li>Items returned without prior authorisation.</li><li>Items damaged after delivery.</li><li>Prescription items that have already been dispensed, where the law requires this exclusion.</li></ul>" },
      { id: "cancellation", heading: "7. Cancelling an order", html: "<p>You can cancel before dispatch by contacting support. Once an order is dispatched, the returns process above applies. [ADD ANY STATUTORY COOLING-OFF RIGHTS THAT APPLY IN YOUR MARKET]</p>" }
    ]
  })
});

page("shipping-policy.html", {
  page: "shipping",
  title: "Shipping policy",
  active: "",
  description: "Shipping destinations, delivery estimates, discreet packaging, tracking, duties and what happens if a parcel is delayed or lost.",
  body: legalPage({
    pageId: "shipping-policy",
    title: "Shipping policy",
    lead: "Where we ship, how parcels are packed, what delivery costs and what happens if something goes wrong.",
    updated: "[DATE]",
    sections: [
      { id: "destinations", heading: "1. Where we ship", html: "<p>We ship to the countries listed in the country selector in the header, and to [ADD OR REMOVE DESTINATIONS]. You are responsible for checking that the product may lawfully be imported into your country.</p>" },
      { id: "discreet", heading: "2. Discreet packaging", html: "<p>Orders are packed in plain outer packaging with no product names, imagery or branding on the outside. The courier label shows only the delivery address and the information the courier requires.</p>" },
      { id: "times", heading: "3. Processing and delivery estimates", html: "<ul><li>Processing: orders placed before [TIME] on a business day are usually packed the same day.</li><li>Standard delivery: 3 to 7 working days.</li><li>Express delivery: 1 to 3 working days where available.</li><li>Collection point: available in selected locations.</li></ul><p>These are estimates, not guarantees. Customs checks can add time.</p>" },
      { id: "costs", heading: "4. Delivery costs", html: "<p>Standard delivery is free on orders above [THRESHOLD]. Below that a flat charge applies, shown at checkout before you pay. Express delivery is charged separately. [ADD YOUR RATE TABLE AND ANY PEAK SURCHARGES]</p>" },
      { id: "tracking", heading: "5. Tracking", html: "<p>You will receive a tracking link by email when your parcel is dispatched. If tracking has not updated for [NUMBER] working days, contact support and we will investigate with the courier.</p>" },
      { id: "duties", heading: "6. Duties, taxes and customs", html: "<p>Orders shipped outside the country of dispatch may attract import duties, taxes or customs handling fees. These are payable by you and are not included in the order total unless we say otherwise at checkout. We cannot falsify customs declarations or mark parcels as gifts.</p>" },
      { id: "lost", heading: "7. Delays, losses and non-delivery", html: "<p>If a parcel is delayed, lost or shows as delivered but has not arrived, contact support within [NUMBER] days of the expected delivery date. We will open a claim with the courier, which can take up to [NUMBER] working days. We will replace or refund the order where the courier confirms the loss.</p>" },
      { id: "address", heading: "8. Address accuracy", html: "<p>Please check your address carefully. We are not responsible for orders delivered to an address you supplied incorrectly, and re-delivery charges may apply.</p>" },
      { id: "returns", heading: "9. Return shipping", html: "<p>Return shipping is covered by us where the item is faulty or sent in error, and by you for change-of-mind returns. See the <a href=\"refund-policy.html\">refund policy</a>.</p>" }
    ]
  })
});

/* --------------------------------------------------------------------------
   404
   -------------------------------------------------------------------------- */
page("404.html", {
  page: "notfound",
  title: "Page not found",
  active: "",
  description: "The page you were looking for could not be found. Browse the shop, the blog or contact support.",
  body: `  <div class="gb-container gb-404">
    <p class="gb-404__code" aria-hidden="true">404</p>
    <h1>We could not find that page</h1>
    <p class="gb-lead" style="margin-inline:auto">The link may be out of date, or the page may have moved. Nothing was added to your bag.</p>
    <div class="gb-404__actions">
      <a class="gb-btn gb-btn--gold" href="index.html">Back to home</a>
      <a class="gb-btn gb-btn--outline" href="shop.html">Shop the packs</a>
      <a class="gb-btn gb-btn--outline" href="contact.html">Contact support</a>
    </div>
    <div class="gb-container--narrow gb-mt-6" style="margin-inline:auto">
      <div class="gb-notice gb-text-center">
        <strong>${SITE.notice}</strong>
      </div>
    </div>
  </div>`
});

/* --------------------------------------------------------------------------
   Write every page
   -------------------------------------------------------------------------- */
let written = 0;
for (const entry of pages) {
  const target = join(OUT, entry.file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, layout(entry), "utf8");
  written += 1;
  console.log("  built  " + entry.file);
}
console.log("");
console.log("Golden Bullet: wrote " + written + " pages to /frontend");
