/* ==========================================================================
   Golden Bullet - ui.js
   Shared UI primitives: toasts, menus, accordion, tabs, carousel, reveal,
   countdown, lazyloading, country/currency selectors and card templates.
   ========================================================================== */

import {
  CONFIG, storage, api, formatMoney, getCurrencies, getCountries,
  getCurrencyCode, setCurrencyCode, getCountryCode, setCountryCode,
  productImage, discountPercent, isInStock
} from "./api.js";

/* --------------------------------------------------------------------------
   1. Tiny helpers
   -------------------------------------------------------------------------- */
export const qs = (selector, scope = document) => scope.querySelector(selector);
export const qsa = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

export function debounce(fn, wait = 250) {
  let timer = 0;
  return function debounced(...args) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn.apply(this, args), wait);
  };
}

export function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" }).format(date);
  } catch (error) {
    return date.toISOString().slice(0, 10);
  }
}

export function prefersReducedMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch (error) { return false; }
}

export function pageName() {
  return window.location.pathname.split("/").pop() || "index.html";
}

export function setBusy(button, busy, busyLabel = "Working…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<span class="gb-btn__spinner" aria-hidden="true"></span><span>${escapeHtml(busyLabel)}</span>`;
  } else {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
  }
}

/* --------------------------------------------------------------------------
   2. Toasts
   -------------------------------------------------------------------------- */
export function toast(message, { variant = "info", timeout = 6000, title = "" } = {}) {
  const region = qs("#gb-toasts");
  if (!region) return null;
  const el = document.createElement("div");
  el.className = "gb-toast";
  el.dataset.variant = variant;
  el.setAttribute("role", variant === "error" ? "alert" : "status");
  el.innerHTML = `
    <span aria-hidden="true">${variant === "error" ? "!" : variant === "success" ? "\u2713" : "\u2022"}</span>
    <div>${title ? `<strong>${escapeHtml(title)}</strong><br>` : ""}${escapeHtml(message)}</div>
    <button type="button" class="gb-toast__close" aria-label="Dismiss notification">&times;</button>`;
  region.appendChild(el);

  let removed = false;
  function dismiss() {
    if (removed) return;
    removed = true;
    el.classList.add("gb-toast--leaving");
    window.setTimeout(() => el.remove(), prefersReducedMotion() ? 0 : 240);
  }
  el.querySelector(".gb-toast__close")?.addEventListener("click", dismiss);
  if (timeout) window.setTimeout(dismiss, timeout);
  return dismiss;
}

export function initToasts() {
  document.addEventListener("gb:toast", (event) => {
    const { message, variant = "info", title = "" } = event.detail || {};
    if (message) toast(message, { variant, title });
  });
}

/* --------------------------------------------------------------------------
   3. Announcement bar
   -------------------------------------------------------------------------- */
export function initAnnouncement() {
  const bar = qs("#gb-announcement");
  if (!bar) return;
  if (storage.get(CONFIG.announcementKey) === "closed") { bar.hidden = true; return; }
  qs("[data-announce-close]", bar)?.addEventListener("click", () => {
    bar.hidden = true;
    storage.set(CONFIG.announcementKey, "closed");
  });
}

/* --------------------------------------------------------------------------
   4. Mobile navigation drawer
   -------------------------------------------------------------------------- */
export function initMobileMenu() {
  const menu = qs("#gb-mobile-menu");
  if (!menu) return;
  const openers = qsa("[data-menu-open]");
  const closers = qsa("[data-menu-close]", menu);
  const scrim = qs("[data-menu-scrim]", menu);
  let lastFocused = null;

  function open() {
    lastFocused = document.activeElement;
    menu.dataset.open = "true";
    menu.removeAttribute("inert");
    document.body.classList.add("gb-no-scroll");
    window.setTimeout(() => qs("[data-menu-close]", menu)?.focus(), 40);
  }
  function close() {
    menu.dataset.open = "false";
    menu.setAttribute("inert", "");
    document.body.classList.remove("gb-no-scroll");
    lastFocused?.focus?.();
  }
  openers.forEach((btn) => btn.addEventListener("click", open));
  closers.forEach((btn) => btn.addEventListener("click", close));
  scrim?.addEventListener("click", close);
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const items = qsa('a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])', menu)
      .filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  qsa("a", menu).forEach((link) => link.addEventListener("click", close));
}

/* --------------------------------------------------------------------------
   5. Header search
   -------------------------------------------------------------------------- */
export function initHeaderSearch() {
  qsa("[data-search-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = form.querySelector('input[type="search"], input[name="q"]');
      const term = String(input?.value || "").trim();
      const target = new URL("shop.html", document.baseURI);
      if (term) target.searchParams.set("q", term);
      window.location.href = target.pathname.split("/").pop() + target.search;
    });
  });
  const toggle = qs("[data-search-toggle]");
  const panel = qs("#gb-search-panel");
  if (toggle && panel) {
    toggle.addEventListener("click", () => {
      const isOpen = panel.dataset.open === "true";
      panel.dataset.open = isOpen ? "false" : "true";
      toggle.setAttribute("aria-expanded", String(!isOpen));
      if (!isOpen) window.setTimeout(() => qs("input", panel)?.focus(), 40);
    });
  }
}

/* --------------------------------------------------------------------------
   6. Country / currency selectors
   -------------------------------------------------------------------------- */
export function initLocaleSelectors() {
  const countrySelects = qsa("[data-country-select]");
  const currencySelects = qsa("[data-currency-select]");

  function renderDeliveryCountry() {
    const match = getCountries().find((country) => country.code === getCountryCode());
    qsa("[data-delivery-country]").forEach((el) => {
      el.textContent = match && match.code !== "OT" ? match.name : "your country";
    });
  }

  function renderCountries() {
    const countries = getCountries();
    const current = getCountryCode();
    countrySelects.forEach((select) => {
      select.innerHTML = countries.map((country) =>
        `<option value="${escapeHtml(country.code)}"${country.code === current ? " selected" : ""}>${escapeHtml(country.name)}</option>`
      ).join("");
    });
  }
  function renderCurrencies() {
    const currencies = getCurrencies();
    const current = getCurrencyCode();
    currencySelects.forEach((select) => {
      select.innerHTML = currencies.map((currency) =>
        `<option value="${escapeHtml(currency.code)}"${currency.code === current ? " selected" : ""}>${escapeHtml(currency.code)} — ${escapeHtml(currency.name)}</option>`
      ).join("");
    });
  }

  countrySelects.forEach((select) => {
    select.addEventListener("change", () => {
      setCountryCode(select.value);
      const match = getCountries().find((country) => country.code === select.value);
      if (match?.currency) setCurrencyCode(match.currency);
      renderCurrencies();
      document.dispatchEvent(new CustomEvent("gb:locale-changed", { detail: { country: select.value, currency: getCurrencyCode() } }));
    });
  });
  currencySelects.forEach((select) => {
    select.addEventListener("change", () => {
      setCurrencyCode(select.value);
      document.dispatchEvent(new CustomEvent("gb:locale-changed", { detail: { country: getCountryCode(), currency: select.value } }));
    });
  });

  renderCountries();
  renderCurrencies();
  renderDeliveryCountry();

  countrySelects.forEach((select) => select.addEventListener("change", renderDeliveryCountry));
}

/* --------------------------------------------------------------------------
   7. Accordion
   -------------------------------------------------------------------------- */
export function initAccordions(scope = document) {
  qsa("[data-accordion]", scope).forEach((accordion) => {
    const single = accordion.dataset.accordion === "single";
    const triggers = qsa(".gb-accordion__trigger", accordion);
    // Ensure every panel has a stable id so aria-controls works.
    qsa(".gb-accordion__item", accordion).forEach((item, index) => {
      const trigger = qs(".gb-accordion__trigger", item);
      const panel = qs(".gb-accordion__panel", item);
      if (!trigger || !panel) return;
      if (!panel.id) panel.id = `${accordion.id || "gb-accordion"}-panel-${index + 1}`;
      trigger.setAttribute("aria-controls", panel.id);
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-labelledby", trigger.id || (trigger.id = `${accordion.id || "gb-accordion"}-trigger-${index + 1}`));

      // Honour the markup's initial state.
      const expanded = trigger.getAttribute("aria-expanded") === "true";
      panel.hidden = !expanded;
    });

    triggers.forEach((trigger) => {
      trigger.addEventListener("click", () => {
        const panel = qs(`#${CSS.escape(trigger.getAttribute("aria-controls"))}`, accordion) || trigger.closest(".gb-accordion__item")?.querySelector(".gb-accordion__panel");
        const expanded = trigger.getAttribute("aria-expanded") === "true";
        if (single) {
          triggers.forEach((other) => {
            if (other === trigger) return;
            other.setAttribute("aria-expanded", "false");
            const otherPanel = other.closest(".gb-accordion__item")?.querySelector(".gb-accordion__panel");
            if (otherPanel) otherPanel.hidden = true;
          });
        }
        trigger.setAttribute("aria-expanded", String(!expanded));
        if (panel) panel.hidden = expanded;
      });
    });
  });
}

/* --------------------------------------------------------------------------
   8. Tabs
   -------------------------------------------------------------------------- */
export function initTabs(scope = document) {
  qsa("[data-tabs]", scope).forEach((tabs) => {
    const tabList = qs('[role="tablist"]', tabs);
    const buttons = qsa('[role="tab"]', tabs);
    const panels = qsa('[role="tabpanel"]', tabs);
    if (!buttons.length) return;

    buttons.forEach((button, index) => {
      if (!button.id) button.id = `${tabs.id || "gb-tabs"}-tab-${index + 1}`;
      const panel = qs(`#${CSS.escape(button.getAttribute("aria-controls"))}`, tabs) || panels[index];
      if (panel && !panel.id) panel.id = `${tabs.id || "gb-tabs"}-panel-${index + 1}`;
      if (panel) {
        button.setAttribute("aria-controls", panel.id);
        panel.setAttribute("aria-labelledby", button.id);
        panel.hidden = index !== 0;
      }
      button.tabIndex = index === 0 ? 0 : -1;
      button.setAttribute("aria-selected", index === 0 ? "true" : "false");
    });

    function select(index, { focus = true } = {}) {
      buttons.forEach((button, i) => {
        const selected = i === index;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
        const panel = qs(`#${CSS.escape(button.getAttribute("aria-controls"))}`, tabs);
        if (panel) panel.hidden = !selected;
      });
      if (focus) buttons[index]?.focus();
    }

    buttons.forEach((button, index) => {
      button.addEventListener("click", () => select(index, { focus: false }));
      button.addEventListener("keydown", (event) => {
        let next = null;
        if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
        if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = buttons.length - 1;
        if (next === null) return;
        event.preventDefault();
        select(next);
      });
    });

    tabList?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); buttons[0].focus(); }
    });
  });
}

/* --------------------------------------------------------------------------
   9. Reveal on scroll + lazy images
   -------------------------------------------------------------------------- */
let revealObserver = null;
export function initReveal(scope = document) {
  const targets = qsa(".gb-reveal:not(.gb-is-visible)", scope);
  if (!targets.length) return;
  if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("gb-is-visible"));
    return;
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("gb-is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  }
  targets.forEach((el) => revealObserver.observe(el));
}

export function initLazyImages(scope = document) {
  const images = qsa("img[data-src]", scope);
  if (!images.length) return;
  if (!("IntersectionObserver" in window)) {
    images.forEach((img) => { img.src = img.dataset.src; img.removeAttribute("data-src"); });
    return;
  }
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      if (img.dataset.srcset) img.srcset = img.dataset.srcset;
      img.src = img.dataset.src;
      img.removeAttribute("data-src");
      obs.unobserve(img);
    });
  }, { rootMargin: "200px" });
  images.forEach((img) => observer.observe(img));
}

/* --------------------------------------------------------------------------
   10. Countdown
   -------------------------------------------------------------------------- */
export function initCountdowns(scope = document) {
  qsa("[data-countdown]", scope).forEach((el) => {
    const deadline = new Date(el.dataset.countdown).getTime();
    if (Number.isNaN(deadline)) return;
    const fields = {
      days: qs("[data-countdown-days]", el),
      hours: qs("[data-countdown-hours]", el),
      minutes: qs("[data-countdown-minutes]", el),
      seconds: qs("[data-countdown-seconds]", el)
    };
    let timer = 0;
    function tick() {
      const diff = deadline - Date.now();
      if (diff <= 0) {
        window.clearInterval(timer);
        Object.values(fields).forEach((field) => { if (field) field.textContent = "00"; });
        el.dataset.finished = "true";
        return;
      }
      const seconds = Math.floor(diff / 1000);
      const values = {
        days: Math.floor(seconds / 86400),
        hours: Math.floor((seconds % 86400) / 3600),
        minutes: Math.floor((seconds % 3600) / 60),
        seconds: seconds % 60
      }; 
      Object.entries(fields).forEach(([key, field]) => {
        if (field) field.textContent = String(values[key]).padStart(2, "0");
      });
    }
    tick();
    timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) window.clearInterval(timer);
      else { tick(); timer = window.setInterval(tick, 1000); }
    }, { once: false });
  });
}

/* --------------------------------------------------------------------------
   11. Quantity steppers
   -------------------------------------------------------------------------- */
export function initQtySteppers(scope = document) {
  qsa("[data-qty]", scope).forEach((group) => {
    const input = qs("[data-qty-input]", group);
    if (!input) return;
    const min = Number(input.min || 1);
    const max = Number(input.max || 20);
    function set(value) {
      const next = Math.min(max, Math.max(min, Math.round(Number(value) || min)));
      input.value = String(next);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    qs("[data-qty-inc]", group)?.addEventListener("click", () => set(Number(input.value) + 1));
    qs("[data-qty-dec]", group)?.addEventListener("click", () => set(Number(input.value) - 1));
    input.addEventListener("change", () => set(input.value));
  });
}

/* --------------------------------------------------------------------------
   12. Cookie consent
   -------------------------------------------------------------------------- */
export function initCookieBanner() {
  const banner = qs("#gb-cookie-banner");
  if (!banner) return;
  const accept = qs("[data-cookie-accept]", banner);
  const decline = qs("[data-cookie-decline]", banner);
  const settings = qs("[data-cookie-settings]", banner);

  function show() { banner.hidden = false; }
  function hide(choice) {
    banner.hidden = true;
    storage.setJSON(CONFIG.cookieKey, { choice, at: new Date().toISOString() });
  }

  const stored = storage.getJSON(CONFIG.cookieKey);
  if (stored?.choice) banner.hidden = true;
  else {
    banner.hidden = true;
    banner.addEventListener("gb:cookie-show", show);
    window.setTimeout(() => {
      // Wait for the age gate to be cleared before asking about cookies.
      if (document.documentElement.getAttribute("data-gb-age-locked") !== "true") show();
    }, 800);
  }

  accept?.addEventListener("click", () => hide("accepted"));
  decline?.addEventListener("click", () => hide("essential-only"));
  settings?.addEventListener("click", () => {
    hide("customised");
    toast("Only essential cookies are used on this store.", { variant: "info" });
  });
}

/* --------------------------------------------------------------------------
   13. Product cards + list states
   -------------------------------------------------------------------------- */
export function starsTemplate(rating = 0, count = 5) {
  const rounded = Math.round(Number(rating) || 0);
  let html = '<span class="gb-stars" aria-hidden="true">';
  for (let i = 1; i <= count; i += 1) {
    html += `<svg viewBox="0 0 24 24" fill="${i <= rounded ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m12 3.6 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8Z"/></svg>`;
  }
  return `${html}</span><span class="gb-visually-hidden">${rounded} out of ${count} stars</span>`;
}

export function productCardTemplate(product) {
  const image = productImage(product, 0);
  const inStock = isInStock(product);
  const percent = discountPercent(product);
  const href = `product.html?id=${encodeURIComponent(product.slug || product.id)}`;
  const price = formatMoney(product.price);
  const compare = product.compareAt ? `<span class="gb-price--compare">${formatMoney(product.compareAt)}</span>` : "";
  return `
    <article class="gb-product-card${inStock ? "" : " gb-product-card--out"}">
      <a class="gb-product-card__media" href="${href}" aria-hidden="${inStock ? "false" : "false"}" tabindex="-1">
        <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" width="640" height="640" loading="lazy" decoding="async">
      </a>
      <div class="gb-product-card__badges">
        ${percent ? `<span class="gb-badge gb-badge--sale">${percent}% off</span>` : ""}
        ${inStock ? "" : '<span class="gb-badge gb-badge--out">Out of stock</span>'}
      </div>
      <div class="gb-product-card__body">
        <h3 class="gb-product-card__title"><a href="${href}">${escapeHtml(product.name)}</a></h3>
        <p class="gb-product-card__meta">${escapeHtml(product.shortName || product.netContent || "")}</p>
        <div class="gb-product-card__price">
          <span class="gb-price">${price}</span>
          ${compare}
        </div>
        <div class="gb-product-card__actions">
          ${inStock
            ? `<button type="button" class="gb-btn gb-btn--outline gb-btn--sm gb-btn--block" data-add-to-cart="${escapeHtml(product.id)}">Add to bag</button>`
            : `<button type="button" class="gb-btn gb-btn--outline gb-btn--sm gb-btn--block" disabled aria-disabled="true">Out of stock</button>`}
        </div>
      </div>
    </article>`;
}

export function productGridSkeleton(count = 3) {
  return Array.from({ length: count }, () => `
    <div class="gb-card" aria-hidden="true">
      <div class="gb-skeleton" style="aspect-ratio:1/1"></div>
      <div class="gb-card__body gb-stack-sm">
        <div class="gb-skeleton" style="height:1.1rem;width:80%"></div>
        <div class="gb-skeleton" style="height:0.9rem;width:40%"></div>
        <div class="gb-skeleton" style="height:2.4rem;width:100%;border-radius:999px"></div>
      </div>
    </div>`).join("");
}

export function stateTemplate({ title, message, actionLabel = "", actionHref = "", icon = "info" } = {}) {
  const icons = {
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16h.01"/>'
  };
  return `
    <div class="gb-state" role="status">
      <svg class="gb-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${icons[icon] || icons.info}</svg>
      <p class="gb-state__title">${escapeHtml(title || "Nothing here yet")}</p>
      ${message ? `<p class="gb-mb-0">${escapeHtml(message)}</p>` : ""}
      ${actionLabel && actionHref ? `<div class="gb-state__actions"><a class="gb-btn gb-btn--gold" href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a></div>` : ""}
    </div>`;
}

export function renderProductGrid(container, products) {
  if (!container) return;
  if (!products.length) {
    container.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.innerHTML = stateTemplate({
      title: "No products match your filters",
      message: "Try removing a filter or searching for something else.",
      actionLabel: "Reset filters",
      actionHref: "shop.html",
      icon: "search"
    });
    container.appendChild(wrapper.firstElementChild);
    return;
  }
  container.innerHTML = products.map(productCardTemplate).join("");
  initReveal(container);
}

/* --------------------------------------------------------------------------
   14. Review carousel (renders nothing unless the API returns reviews)
   -------------------------------------------------------------------------- */
export function initCarousel(root) {
  if (!root) return;
  const track = qs(".gb-carousel__track", root);
  const slides = qsa(".gb-carousel__slide", root);
  const prev = qs("[data-carousel-prev]", root);
  const next = qs("[data-carousel-next]", root);
  const dots = qs("[data-carousel-dots]", root);
  if (!track || !slides.length) return;

  let index = 0;

  function perView() {
    if (window.matchMedia("(min-width: 1100px)").matches) return 3;
    if (window.matchMedia("(min-width: 768px)").matches) return 2;
    return 1;
  }
  function maxIndex() { return Math.max(0, slides.length - perView()); }

  function renderDots() {
    if (!dots) return;
    const pages = maxIndex() + 1;
    if (dots.children.length !== pages) {
      dots.innerHTML = Array.from({ length: pages }, (_, i) =>
        `<button type="button" class="gb-carousel__dot" data-carousel-dot="${i}" aria-label="Go to review group ${i + 1}"></button>`).join("");
    }
    qsa("[data-carousel-dot]", dots).forEach((dot) => {
      dot.setAttribute("aria-current", String(Number(dot.dataset.carouselDot) === index));
    });
  }

  function update() {
    index = Math.min(index, maxIndex());
    const step = slides[0].getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || "0");
    track.style.transform = `translate3d(${-index * step}px, 0, 0)`;
    slides.forEach((slide, i) => {
      const visible = i >= index && i < index + perView();
      slide.setAttribute("aria-hidden", String(!visible));
      qsa("a, button", slide).forEach((el) => { el.tabIndex = visible ? 0 : -1; });
    });
    if (prev) prev.disabled = index === 0;
    if (next) next.disabled = index >= maxIndex();
    renderDots();
  }

  prev?.addEventListener("click", () => { index = Math.max(0, index - 1); update(); });
  next?.addEventListener("click", () => { index = Math.min(maxIndex(), index + 1); update(); });
  dots?.addEventListener("click", (event) => {
    const dot = event.target.closest("[data-carousel-dot]");
    if (!dot) return;
    index = Number(dot.dataset.carouselDot);
    update();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { index = Math.max(0, index - 1); update(); }
    if (event.key === "ArrowRight") { index = Math.min(maxIndex(), index + 1); update(); }
  });
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(update, 150);
  });
  update();
}

/* --------------------------------------------------------------------------
   15. Generic modal helper (used for policy previews and form confirmations)
   -------------------------------------------------------------------------- */
export function openModal(modal) {
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("gb-no-scroll");
  window.setTimeout(() => qs("button, [href], input", modal)?.focus(), 40);
  const onKey = (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
  };
  function close() {
    modal.hidden = true;
    document.body.classList.remove("gb-no-scroll");
    document.removeEventListener("keydown", onKey);
  }
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-modal-close]")) close();
  });
  document.addEventListener("keydown", onKey);
  return { close };
}

/* --------------------------------------------------------------------------
   16. Newsletter / generic async forms
   -------------------------------------------------------------------------- */
export function initNewsletterForms() {
  qsa("[data-newsletter-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = form.querySelector('input[type="email"]');
      const status = form.querySelector("[data-newsletter-status]");
      const button = form.querySelector('button[type="submit"]');
      const email = String(input?.value || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
        if (status) { status.textContent = "Enter a valid email address."; status.dataset.state = "error"; }
        input?.focus();
        return;
      }
      setBusy(button, true, "Joining…");
      try {
        await api.newsletter.subscribe(email);
        if (status) { status.textContent = "Thank you. Check your inbox to confirm your subscription."; status.dataset.state = "success"; }
        form.reset();
        toast("You are on the list. Welcome to Golden Bullet.", { variant: "success" });
      } catch (error) {
        if (status) { status.textContent = error.message || "We could not add you to the list. Please try again."; status.dataset.state = "error"; }
      } finally {
        setBusy(button, false);
      }
    });
  });
}

/* --------------------------------------------------------------------------
   17. Boot shared chrome
   -------------------------------------------------------------------------- */
export function initSharedChrome() {
  initToasts();
  initAnnouncement();
  initMobileMenu();
  initHeaderSearch();
  initLocaleSelectors();
  initAccordions();
  initQtySteppers();
  initCookieBanner();
  initNewsletterForms();
  initReveal();
  initLazyImages();
  initCountdowns();
  const year = qs("[data-current-year]");
  if (year) year.textContent = String(new Date().getFullYear());
}
