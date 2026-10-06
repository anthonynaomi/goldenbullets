/* ==========================================================================
   Golden Bullet - main.js
   Page bootstrapping and page-level controllers.
   ========================================================================== */

import {
  CONFIG, api, storage, ApiError, formatMoney, isInStock,
  discountPercent, getCountryCode, getCurrencyCode
} from "./api.js";
import {
  qs, qsa, escapeHtml, debounce, formatDate, toast, initSharedChrome, stateTemplate,
  renderProductGrid, productGridSkeleton, starsTemplate, initCarousel, initTabs,
  initReveal, initQtySteppers, setBusy, pageName
} from "./ui.js";
import {
  updateQty, removeItem, getTotals, applyDiscountCode, clearCart, setDiscount,
  initCartDrawer, initCartBadge, initAddToCartButtons, renderCartItem
} from "./cart.js";
import {
  login, register, logout, requireAuth, redirectIfAuthenticated, safeNextUrl,
  initAuthUI
} from "./auth.js";
import { wireForm, rules, formToObject, initStrengthMeter } from "./validation.js";
import { initAgeGate } from "./agegate.js";

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */
function params() { return new URLSearchParams(window.location.search); }

function setQuery(updates, { replace = true } = {}) {
  const url = new URL(window.location.href);
  Object.entries(updates).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "" || value === "all") url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  });
  const next = url.pathname.split("/").pop() + url.search + url.hash;
  if (replace) window.history.replaceState({}, "", next);
  else window.history.pushState({}, "", next);
}

function reportError(container, error, retry) {
  if (!container) return;
  const offline = error instanceof ApiError && error.isOffline;
  container.innerHTML = stateTemplate({
    title: offline ? "We could not load this content" : "Something went wrong",
    message: (error && error.message) || "Please try again in a moment.",
    icon: "error"
  });
  if (typeof retry === "function") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gb-btn gb-btn--gold gb-mt-4";
    button.textContent = "Try again";
    button.addEventListener("click", retry);
    const state = container.querySelector(".gb-state");
    if (state) state.appendChild(button);
  }
}
/* --------------------------------------------------------------------------
   HOME
   -------------------------------------------------------------------------- */
function initHome() {
  // Rolling demo deadline. Replace with the campaign ISO date from the API.
  const countdown = qs("[data-countdown]");
  if (countdown && !countdown.dataset.countdown) {
    const stored = Number(storage.get("gb.promoEnd", "0"));
    const end = stored && stored > Date.now() ? stored : Date.now() + 14 * 86400000;
    storage.set("gb.promoEnd", String(end));
    countdown.dataset.countdown = new Date(end).toISOString();
  }

  const grid = qs("#featured-products");
  if (grid && !grid.children.length) {
    grid.innerHTML = productGridSkeleton(3);
    api.products.list({ featured: true, perPage: 6 })
      .then((data) => {
        const featured = data.items.filter((product) => product.featured);
        renderProductGrid(grid, featured.length ? featured.slice(0, 6) : data.items.slice(0, 6));
      })
      .catch((error) => reportError(grid, error, () => window.location.reload()));
  }


  const bestSellers = qs("#best-sellers");
  if (bestSellers && !bestSellers.children.length) {
    bestSellers.innerHTML = productGridSkeleton(4);
    api.products.list({ perPage: 100 })
      .then((data) => {
        const picks = data.items.filter((product) => product.bestSeller);
        const featured = data.items.filter((product) => product.featured);
        const list = (picks.length ? picks : featured).slice(0, 4);
        renderProductGrid(bestSellers, list.length ? list : data.items.slice(0, 4));
      })
      .catch((error) => reportError(bestSellers, error, () => window.location.reload()));
  }
  const posts = qs("#latest-posts");
  if (posts) {
    posts.innerHTML = productGridSkeleton(3);
    api.blog.list({ perPage: 3 })
      .then((data) => {
        if (!data.items.length) {
          posts.innerHTML = stateTemplate({ title: "No articles published yet", message: "Check back soon." });
          return;
        }
        posts.innerHTML = data.items.slice(0, 3).map(postCardTemplate).join("");
        initReveal(posts);
      })
      .catch((error) => reportError(posts, error, () => window.location.reload()));
  }

  // Reviews render only from real, API-returned reviews.
  initReviewsCarousel(qs("#reviews-section"));

  const promoForm = qs("[data-promo-code-form]");
  if (promoForm) {
    promoForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = promoForm.querySelector('input[name="code"]');
      const status = promoForm.querySelector("[data-promo-status]");
      const button = promoForm.querySelector('button[type="submit"]');
      setBusy(button, true, "Checking\u2026");
      try {
        const discount = await applyDiscountCode(input.value);
        if (status) { status.textContent = discount.label + " applied. It will be used at checkout."; status.dataset.state = "success"; }
        toast(discount.code + " applied \u2014 " + discount.label + ".", { variant: "success" });
        input.value = "";
      } catch (error) {
        if (status) { status.textContent = error.message || "That code is not valid."; status.dataset.state = "error"; }
      } finally {
        setBusy(button, false);
      }
    });
  }
}

function postCardTemplate(post) {
  const href = "blog-post.html?slug=" + encodeURIComponent(post.slug || post.id);
  const image = post.image || "assets/img/capsule-light.jpg";
  return `
    <article class="gb-post-card gb-reveal">
      <a class="gb-post-card__media" href="${href}" tabindex="-1" aria-hidden="true">
        <img src="${escapeHtml(image)}" alt="" width="640" height="400" loading="lazy" decoding="async">
      </a>
      <div class="gb-post-card__body">
        <p class="gb-post-card__meta">${escapeHtml(post.category || "Education")} \u00b7 ${escapeHtml(formatDate(post.publishedAt))} \u00b7 ${Number(post.readingMinutes || 4)} min read</p>
        <h3 class="gb-post-card__title"><a href="${href}">${escapeHtml(post.title)}</a></h3>
        <p class="gb-post-card__excerpt">${escapeHtml(post.excerpt || "")}</p>
        <p class="gb-post-card__more"><a class="gb-btn gb-btn--outline gb-btn--sm" href="${href}">Read article</a></p>
      </div>
    </article>`;
}

/* --------------------------------------------------------------------------
   Reviews carousel - hidden whenever there are no verified reviews
   -------------------------------------------------------------------------- */
function initReviewsCarousel(section) {
  if (!section) return;
  const productId = section.dataset.reviewsFor || "";
  const track = qs(".gb-carousel__track", section);

  const pending = productId
    ? api.products.reviews(productId)
    : api.products.list({ perPage: 1 }).then((data) => {
        const first = data.items[0];
        return first ? api.products.reviews(first.id) : { items: [] };
      });

  pending
    .then((data) => {
      const reviews = (data.items || []).filter((review) => review && review.body);
      if (!reviews.length) {
        // Content rule: never render unverified or invented testimonials.
        section.hidden = true;
        section.setAttribute("aria-hidden", "true");
        return;
      }
      if (track) track.innerHTML = reviews.map(reviewTemplate).join("");
      section.hidden = false;
      section.removeAttribute("aria-hidden");
      initCarousel(section);
      initReveal(section);
    })
    .catch(() => {
      section.hidden = true;
      section.setAttribute("aria-hidden", "true");
    });
}

function reviewTemplate(review) {
  return `
    <li class="gb-carousel__slide">
      <article class="gb-review-card">
        ${starsTemplate(review.rating || 5)}
        <h3 class="gb-review-card__title">${escapeHtml(review.title || "Verified purchase")}</h3>
        <p class="gb-review-card__body">&ldquo;${escapeHtml(review.body)}&rdquo;</p>
        <p class="gb-review-card__verified">Verified purchase</p>
        <p class="gb-review-card__author">\u2014 ${escapeHtml(review.author || review.name || "Verified customer")}</p>
      </article>
    </li>`;
}
/* --------------------------------------------------------------------------
   SHOP
   -------------------------------------------------------------------------- */
function deriveFacets(products) {
  const packs = new Map();
  products.forEach((product) => {
    const key = product.packSize ? String(product.packSize) : "other";
    const label = product.packLabel || (product.packSize ? product.packSize + " tablet pack" : "Other");
    const entry = packs.get(key) || { value: key, label, count: 0 };
    entry.count += 1;
    packs.set(key, entry);
  });
  const prices = products.map((product) => product.price).filter((value) => Number.isFinite(value));
  return {
    packSizes: Array.from(packs.values()).sort((a, b) => Number(a.value) - Number(b.value)),
    priceMin: prices.length ? Math.min.apply(null, prices) : 0,
    priceMax: prices.length ? Math.max.apply(null, prices) : 0
  };
}

function initShop() {
  const grid = qs("#product-grid");
  const resultsCount = qs("[data-results-count]");
  const pagination = qs("[data-pagination]");
  const sortSelect = qs("[data-sort]");
  const searchInput = qs("[data-shop-search]");
  const perPageSelect = qs("[data-per-page]");
  const filterForm = qs("[data-filter-form]");
  const activeFilters = qs("[data-active-filters]");
  if (!grid) return;

  const state = {
    q: params().get("q") || "",
    sort: params().get("sort") || "featured",
    page: Number(params().get("page") || 1),
    perPage: Number(params().get("perPage") || 6),
    pack: params().get("pack") || "all",
    availability: params().get("availability") || "all",
    maxPrice: params().get("maxPrice") || "",
    // Cards baked in by tools/build-pages.mjs are kept as the default view.
    prerendered: grid.children.length > 0,
    all: [],
    loading: true,
    error: null,
    facets: null
  };

  if (searchInput) searchInput.value = state.q;
  if (sortSelect) sortSelect.value = state.sort;
  if (perPageSelect) perPageSelect.value = String(state.perPage);

  function applyFilters(items) {
    let list = items.slice();
    const term = state.q.trim().toLowerCase();
    if (term) {
      list = list.filter((product) => {
        const haystack = [product.name, product.shortName, product.summary, product.sku]
          .concat(product.tags || []).filter(Boolean).join(" ").toLowerCase();
        return haystack.indexOf(term) !== -1;
      });
    }
    if (state.pack !== "all") list = list.filter((product) => String(product.packSize) === state.pack);
    if (state.availability === "in-stock") list = list.filter((product) => isInStock(product));
    if (state.availability === "out-of-stock") list = list.filter((product) => !isInStock(product));
    if (state.maxPrice) list = list.filter((product) => Number(product.price) <= Number(state.maxPrice));

    switch (state.sort) {
      case "price-asc": list.sort((a, b) => a.price - b.price); break;
      case "price-desc": list.sort((a, b) => b.price - a.price); break;
      case "name-asc": list.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "newest": list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)); break;
      default:
        list.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || a.price - b.price);
    }
    return list;
  }

  function renderFilters(facets) {
    if (!filterForm) return;
    const packHost = qs("[data-facet-packs]", filterForm);
    if (packHost) {
      const rows = ['<label class="gb-check"><input type="radio" name="pack" value="all"' + (state.pack === "all" ? " checked" : "") + '><span class="gb-check__text">All packs</span></label>'];
      facets.packSizes.forEach((facet) => {
        rows.push('<label class="gb-check"><input type="radio" name="pack" value="' + escapeHtml(facet.value) + '"' +
          (state.pack === facet.value ? " checked" : "") + '><span class="gb-check__text">' + escapeHtml(facet.label) +
          ' <span class="gb-muted">(' + facet.count + ')</span></span></label>');
      });
      packHost.innerHTML = rows.join("");
    }
    const priceHost = qs("[data-facet-price]", filterForm);
    if (priceHost && facets.priceMax) {
      const current = state.maxPrice || facets.priceMax;
      priceHost.innerHTML =
        '<label class="gb-field"><span class="gb-field__label">Maximum price</span>' +
        '<input class="gb-input" type="range" name="maxPrice" min="' + facets.priceMin + '" max="' + facets.priceMax +
        '" step="1" value="' + current + '">' +
        '<span class="gb-field__hint" data-price-hint>Up to ' + escapeHtml(formatMoney(current)) + "</span></label>";
      const range = qs('input[name="maxPrice"]', priceHost);
      const hint = qs("[data-price-hint]", priceHost);
      if (range) {
        range.addEventListener("input", () => { if (hint) hint.textContent = "Up to " + formatMoney(range.value); });
        range.addEventListener("change", () => {
          state.maxPrice = range.value === String(facets.priceMax) ? "" : range.value;
          state.page = 1;
          update({ push: true });
        });
      }
    }
  }
  function renderActiveFilters() {
    if (!activeFilters) return;
    const chips = [];
    if (state.q) chips.push({ label: "Search: \u201c" + state.q + "\u201d", key: "q" });
    if (state.pack !== "all") chips.push({ label: "Pack: " + state.pack, key: "pack" });
    if (state.availability !== "all") chips.push({ label: state.availability === "in-stock" ? "In stock" : "Out of stock", key: "availability" });
    if (state.maxPrice) chips.push({ label: "Under " + formatMoney(state.maxPrice), key: "maxPrice" });
    if (!chips.length) { activeFilters.innerHTML = ""; return; }
    activeFilters.innerHTML = '<p class="gb-small gb-muted gb-mb-0">Active filters:</p>' +
      chips.map((chip) => '<button type="button" class="gb-badge gb-badge--muted" data-clear-filter="' + chip.key + '">' +
        escapeHtml(chip.label) + " &times;</button>").join("") +
      '<button type="button" class="gb-btn gb-btn--link" data-clear-all>Clear all</button>';
  }

  function renderPagination(total, pages) {
    if (!pagination) return;
    if (pages <= 1) { pagination.innerHTML = ""; return; }
    const buttons = [];
    buttons.push('<button type="button" class="gb-pagination__btn" data-page="' + (state.page - 1) + '"' +
      (state.page === 1 ? " disabled" : "") + ' aria-label="Previous page">Previous</button>');
    for (let i = 1; i <= pages; i += 1) {
      buttons.push('<button type="button" class="gb-pagination__btn" data-page="' + i + '"' +
        (i === state.page ? ' aria-current="page"' : "") + ' aria-label="Page ' + i + '">' + i + "</button>");
    }
    buttons.push('<button type="button" class="gb-pagination__btn" data-page="' + (state.page + 1) + '"' +
      (state.page === pages ? " disabled" : "") + ' aria-label="Next page">Next</button>');
    pagination.innerHTML = '<span class="gb-visually-hidden">' + total + " products, page " + state.page +
      " of " + pages + "</span>" + buttons.join("");
  }

  function render() {
    // Leave the prerendered markup alone until the visitor changes a filter,
    // the sort order, the search term or the page number.
    if (state.prerendered) return;
    if (state.loading) {
      grid.innerHTML = productGridSkeleton(6);
      if (resultsCount) resultsCount.textContent = "Loading products\u2026";
      return;
    }
    if (state.error) { reportError(grid, state.error, () => { state.error = null; load(); }); return; }

    const filtered = applyFilters(state.all);
    const pages = Math.max(1, Math.ceil(filtered.length / state.perPage));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * state.perPage;
    const pageItems = filtered.slice(start, start + state.perPage);

    renderProductGrid(grid, pageItems);
    if (resultsCount) {
      resultsCount.textContent = filtered.length
        ? "Showing " + (start + 1) + "\u2013" + Math.min(start + state.perPage, filtered.length) + " of " + filtered.length + " products"
        : "No products found";
    }
    renderPagination(filtered.length, pages);
    renderActiveFilters();
  }

  function update(options) {
    const push = options && options.push;
    if (state.all.length) state.prerendered = false;
    setQuery({
      q: state.q,
      sort: state.sort === "featured" ? "" : state.sort,
      page: state.page > 1 ? state.page : "",
      perPage: state.perPage !== 6 ? state.perPage : "",
      pack: state.pack,
      availability: state.availability,
      maxPrice: state.maxPrice
    }, { replace: !push });
    render();
  }

  async function load() {
    state.loading = true;
    render();
    try {
      const data = await api.products.list({ perPage: 100 });
      state.all = data.items;
      state.loading = false;
      const facets = data.facets || deriveFacets(state.all);
      state.facets = facets;
      renderFilters(facets);
      render();
    } catch (error) {
      state.loading = false;
      state.error = error;
      render();
    }
  }

  if (sortSelect) sortSelect.addEventListener("change", () => { state.sort = sortSelect.value; state.page = 1; update({ push: true }); });
  if (perPageSelect) perPageSelect.addEventListener("change", () => { state.perPage = Number(perPageSelect.value) || 6; state.page = 1; update({ push: true }); });
  if (searchInput) searchInput.addEventListener("input", debounce(() => { state.q = searchInput.value; state.page = 1; update(); }, 300));

  if (filterForm) {
    filterForm.addEventListener("change", (event) => {
      const target = event.target;
      if (target.name === "pack") state.pack = target.value;
      if (target.name === "availability") state.availability = target.value;
      state.page = 1;
      update({ push: true });
    });
    filterForm.addEventListener("reset", () => {
      window.setTimeout(() => {
        state.pack = "all";
        state.availability = "all";
        state.maxPrice = "";
        state.page = 1;
        update({ push: true });
      }, 0);
    });
  }

  document.addEventListener("click", (event) => {
    const clearOne = event.target.closest("[data-clear-filter]");
    if (clearOne) {
      const key = clearOne.dataset.clearFilter;
      if (key === "q") { state.q = ""; if (searchInput) searchInput.value = ""; }
      if (key === "pack") state.pack = "all";
      if (key === "availability") state.availability = "all";
      if (key === "maxPrice") state.maxPrice = "";
      state.page = 1;
      update({ push: true });
      return;
    }
    if (event.target.closest("[data-clear-all]")) {
      state.q = ""; state.pack = "all"; state.availability = "all"; state.maxPrice = "";
      state.page = 1;
      if (searchInput) searchInput.value = "";
      if (filterForm) filterForm.reset();
      update({ push: true });
      return;
    }
    const pageBtn = event.target.closest("button[data-page]");
    if (pageBtn && !pageBtn.disabled) {
      state.page = Number(pageBtn.dataset.page);
      update({ push: true });
      const target = qs("#product-grid");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  load();
}
/* --------------------------------------------------------------------------
   PRODUCT
   -------------------------------------------------------------------------- */
function initProduct() {
  const root = qs("#product-detail");
  if (!root) return;
  const id = params().get("id");

  root.innerHTML =
    '<div class="gb-product">' +
      '<div class="gb-skeleton" style="aspect-ratio:1/1;border-radius:14px"></div>' +
      '<div class="gb-stack">' +
        '<div class="gb-skeleton" style="height:2rem;width:70%"></div>' +
        '<div class="gb-skeleton" style="height:1.2rem;width:40%"></div>' +
        '<div class="gb-skeleton" style="height:3rem;width:100%"></div>' +
        '<div class="gb-skeleton" style="height:3rem;width:100%"></div>' +
      "</div>" +
    "</div>";

  if (!id) {
    reportError(root, new ApiError("We could not find that product.", { status: 404 }), () => window.location.assign("shop.html"));
    return;
  }

  api.products.get(id)
    .then((product) => {
      if (!product || !product.id) throw new ApiError("We could not find that product.", { status: 404 });
      renderProduct(root, product);
      document.title = product.name + " \u2014 Golden Bullet";
      initProductReviews(product);
      initRelated(product);
    })
    .catch((error) => {
      reportError(root, error, () => window.location.reload());
      const related = qs("#product-related");
      const reviews = qs("#product-reviews");
      if (related) related.hidden = true;
      if (reviews) reviews.hidden = true;
    });
}

function renderProduct(root, product) {
  const images = (product.images || []).map((image) => (typeof image === "string" ? { src: image, alt: product.name } : image));
  const gallery = images.length ? images : [{ src: "assets/img/product-single.jpg", alt: product.name }];
  const inStock = isInStock(product);
  const percent = discountPercent(product);
  const label = product.label || {};

  const tabs = [
    { id: "description", label: "Description", html: descriptionHtml(product) },
    { id: "ingredients", label: "Ingredients", html: listHtml("Full ingredient list", label.ingredients) },
    { id: "directions", label: "Directions", html: directionsHtml(label) },
    { id: "warnings", label: "Warnings", html: warningsHtml(label) }
  ];

  const thumbs = gallery.map((image, index) =>
    '<button type="button" class="gb-gallery__thumb" data-gallery-thumb="' + index + '" aria-current="' +
    (index === 0 ? "true" : "false") + '" aria-label="Show image ' + (index + 1) + " of " + gallery.length + '">' +
    '<img src="' + escapeHtml(image.src) + '" alt="" width="120" height="120" loading="lazy" decoding="async"></button>').join("");

  const availability = inStock
    ? (product.stockQty ? "In stock \u2014 " + Number(product.stockQty) + " available" : "In stock")
    : "Out of stock";

  const buyAction = inStock
    ? '<button type="button" class="gb-btn gb-btn--gold" data-add-to-cart="' + escapeHtml(product.id) + '">Add to bag</button>'
    : '<button type="button" class="gb-btn" disabled aria-disabled="true">Out of stock</button>';

  const prescriptionNotice = product.requiresPrescription
    ? '<div class="gb-alert gb-alert--warning"><div><strong class="gb-alert__title">Prescription required</strong>' +
      "<p>You will be asked to upload a valid prescription at checkout before this order can be dispensed.</p></div></div>"
    : "";

  const tick = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>';

  const facts =
    '<div class="gb-product-facts">' +
      fact("Batch / lot number", escapeHtml(label.batchNumber || "[BATCH NO. PLACEHOLDER]"), true) +
      fact("Expiry date", escapeHtml(label.expiryDate || "[EXPIRY DATE PLACEHOLDER]"), true) +
      fact("Regulator registration no.", escapeHtml(label.registrationNo || "[REGISTRATION NO. PLACEHOLDER]"), true) +
      fact("Net content", escapeHtml(label.netContent || product.netContent || "[NET CONTENT PLACEHOLDER]"), false) +
    "</div>";

  root.innerHTML =
    '<div class="gb-product" data-product-root>' +
      '<div class="gb-gallery" data-gallery>' +
        '<figure class="gb-gallery__main"><img src="' + escapeHtml(gallery[0].src) + '" alt="' +
          escapeHtml(gallery[0].alt || product.name) + '" width="900" height="900" data-gallery-main></figure>' +
        '<div class="gb-gallery__thumbs" role="group" aria-label="Product images">' + thumbs + "</div>" +
      "</div>" +
      '<div class="gb-buybox">' +
        "<div>" +
          '<p class="gb-eyebrow">' + escapeHtml(product.collection || "Golden Bullet 380") + "</p>" +
          "<h1>" + escapeHtml(product.name) + "</h1>" +
        "</div>" +
        (percent ? '<p class="gb-mb-0"><span class="gb-badge gb-badge--sale">Save ' + percent + "%</span></p>" : "") +
        '<div class="gb-buybox__price">' +
          '<span class="gb-price">' + formatMoney(product.price) + "</span>" +
          (product.compareAt ? '<span class="gb-price--compare">' + formatMoney(product.compareAt) + "</span>" : "") +
          '<span class="gb-small gb-muted">' + escapeHtml(getCurrencyCode()) + " \u00b7 taxes calculated at checkout</span>" +
        "</div>" +
        '<p class="gb-buybox__stock" data-in-stock="' + inStock + '">' + availability + "</p>" +
        '<p class="gb-muted">' + escapeHtml(product.summary || "[APPROVED CLAIM FROM LABEL]") + "</p>" +
        '<div class="gb-buybox__row">' +
          '<div class="gb-qty" data-qty role="group" aria-label="Quantity">' +
            '<button type="button" class="gb-qty__btn" data-qty-dec aria-label="Decrease quantity">&minus;</button>' +
            '<input class="gb-qty__input" data-qty-input type="number" inputmode="numeric" min="1" max="20" value="1" aria-label="Quantity">' +
            '<button type="button" class="gb-qty__btn" data-qty-inc aria-label="Increase quantity">+</button>' +
          "</div>" + buyAction +
        "</div>" +
        prescriptionNotice +
        '<ul class="gb-list-checked gb-mb-0">' +
          "<li>" + tick + "<span>Discreet, unbranded outer packaging</span></li>" +
          "<li>" + tick + "<span>Secure checkout with encrypted payment</span></li>" +
          "<li>" + tick + "<span>Full label information printed on every pack</span></li>" +
        "</ul>" +
        facts +
        '<div class="gb-notice">' +
          "<strong>This product is not intended to diagnose, treat, cure, or prevent any disease.</strong>" +
          "Consult a healthcare professional before use. Do not use with nitrate medication. Consult a doctor if you have heart conditions, high or low blood pressure, or take other medication." +
        "</div>" +
      "</div>" +
    "</div>" +
    '<section class="gb-section gb-section--tight" aria-labelledby="product-tabs-title">' +
      '<h2 id="product-tabs-title" class="gb-visually-hidden">Product information</h2>' +
      '<div class="gb-tabs" data-tabs id="product-tabs">' +
        '<div class="gb-tabs__list" role="tablist" aria-label="Product information">' +
          tabs.map((tab, index) => '<button type="button" class="gb-tabs__tab" role="tab" id="tab-' + tab.id +
            '" aria-controls="panel-' + tab.id + '" aria-selected="' + (index === 0) + '">' + escapeHtml(tab.label) + "</button>").join("") +
        "</div>" +
        tabs.map((tab, index) => '<div class="gb-tabs__panel" role="tabpanel" id="panel-' + tab.id + '" aria-labelledby="tab-' +
          tab.id + '" tabindex="0"' + (index === 0 ? "" : " hidden") + ">" + tab.html + "</div>").join("") +
      "</div>" +
    "</section>";

  initTabs(root);
  initQtySteppers(root);
  initReveal(root);

  const main = qs("[data-gallery-main]", root);
  qsa("[data-gallery-thumb]", root).forEach((thumb) => {
    thumb.addEventListener("click", () => {
      const image = gallery[Number(thumb.dataset.galleryThumb)];
      if (!image || !main) return;
      main.src = image.src;
      main.alt = image.alt || product.name;
      qsa("[data-gallery-thumb]", root).forEach((other) => other.setAttribute("aria-current", String(other === thumb)));
    });
  });
}

function fact(label, value, mono) {
  return '<div class="gb-fact"><span class="gb-fact__label">' + escapeHtml(label) + '</span><span class="gb-fact__value' +
    (mono ? " gb-mono" : "") + '">' + value + "</span></div>";
}

function descriptionHtml(product) {
  const paragraphs = Array.isArray(product.description)
    ? product.description
    : String(product.description || "").split(/\n{2,}/).filter(Boolean);
  return '<div class="gb-prose">' +
    (paragraphs.length ? paragraphs.map((text) => "<p>" + escapeHtml(text) + "</p>").join("")
      : "<p>" + escapeHtml(product.summary || "[APPROVED CLAIM FROM LABEL]") + "</p>") +
    '<p><strong>[APPROVED CLAIM FROM LABEL]</strong></p>' +
    '<p class="gb-small gb-muted">Product descriptions are limited to the information printed on the registered product label. Replace the bracketed placeholders with the exact wording approved on your label.</p>' +
    "</div>";
}

function listHtml(title, items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return '<div class="gb-prose"><h3>' + escapeHtml(title) + "</h3>" +
    (list.length
      ? "<ul>" + list.map((item) => "<li>" + escapeHtml(typeof item === "string" ? item : (item.name + (item.amount ? " \u2014 " + item.amount : ""))) + "</li>").join("") + "</ul>"
      : "<p>[FULL INGREDIENT LIST FROM LABEL]</p>") +
    '<p class="gb-small gb-muted">Always read the label on your pack. If you are unsure about an ingredient, speak to your pharmacist or doctor.</p></div>';
}
function directionsHtml(label) {
  const steps = Array.isArray(label.directions) ? label.directions : [];
  return '<div class="gb-prose">' +
    "<h3>Dosage and directions</h3>" +
    (steps.length
      ? '<ol class="gb-steps">' + steps.map((step) => "<li><span>" + escapeHtml(step) + "</span></li>").join("") + "</ol>"
      : "<p>" + escapeHtml(label.dosage || "[DOSAGE FROM LABEL \u2014 e.g. take one tablet with water, no more than once in 24 hours.]") + "</p>") +
    "<h3>Storage</h3>" +
    "<p>" + escapeHtml(label.storage || "[STORAGE INSTRUCTIONS FROM LABEL \u2014 e.g. store below 25\u00b0C, away from direct sunlight and out of reach of children.]") + "</p>" +
    '<p class="gb-small gb-muted">Do not exceed the dose printed on the label. If you miss a dose, follow the label guidance rather than taking a double dose.</p>' +
    "</div>";
}

function warningsHtml(label) {
  const warnings = Array.isArray(label.warnings) && label.warnings.length ? label.warnings : [
    "Do not use with nitrate medication (for example nitroglycerin) or with medicines used to treat chest pain.",
    "Consult a doctor before use if you have a heart condition, high or low blood pressure, diabetes, or any long-term medical condition.",
    "Consult a doctor if you take other medication, including prescription, over-the-counter or herbal products.",
    "Do not use if you are under 18, pregnant, or breastfeeding.",
    "Stop use and seek medical advice if you experience chest pain, an irregular heartbeat, dizziness, fainting, or a persistent erection lasting more than four hours.",
    "Keep out of reach of children. Do not use after the expiry date printed on the pack."
  ];
  return '<div class="gb-prose">' +
    "<h3>Warnings and contraindications</h3>" +
    "<ul>" + warnings.map((warning) => "<li>" + escapeHtml(warning) + "</li>").join("") + "</ul>" +
    "<h3>Reporting side effects</h3>" +
    '<p>If you experience an unwanted effect, stop using the product and seek medical advice. You can also report it to us through the <a href="safety-information.html#report">adverse reaction form</a>.</p>' +
    '<p class="gb-small gb-muted">Regulator registration number: ' + escapeHtml(label.registrationNo || "[REGISTRATION NO. PLACEHOLDER]") + ".</p>" +
    "</div>";
}

/* --------------------------------------------------------------------------
   PRODUCT - reviews and related items
   -------------------------------------------------------------------------- */
function initProductReviews(product) {
  const section = qs("#product-reviews");
  if (!section) return;
  const list = qs("[data-reviews-list]", section);
  const summary = qs("[data-reviews-summary]", section);
  api.products.reviews(product.id)
    .then((data) => {
      const reviews = (data.items || []).filter((review) => review && review.body);
      if (!reviews.length) {
        section.hidden = true;
        section.setAttribute("aria-hidden", "true");
        return;
      }
      section.hidden = false;
      section.removeAttribute("aria-hidden");
      if (summary) {
        const total = reviews.reduce((sum, review) => sum + (Number(review.rating) || 0), 0);
        const average = total / reviews.length;
        summary.innerHTML = starsTemplate(average) + ' <span class="gb-small gb-muted">' + average.toFixed(1) +
          " out of 5 \u00b7 " + reviews.length + " verified " + (reviews.length === 1 ? "review" : "reviews") + "</span>";
      }
      if (list) list.innerHTML = reviews.map((review) => '<li class="gb-carousel__slide" style="flex-basis:100%">' + reviewCard(review) + "</li>").join("");
    })
    .catch(() => { section.hidden = true; });
}

function reviewCard(review) {
  return '<article class="gb-review-card">' + starsTemplate(review.rating || 5) +
    '<h3 class="gb-review-card__title">' + escapeHtml(review.title || "Verified purchase") + "</h3>" +
    '<p class="gb-review-card__body">&ldquo;' + escapeHtml(review.body) + "&rdquo;</p>" +
    '<p class="gb-review-card__verified">Verified purchase' + (review.purchasedAt ? " \u00b7 " + escapeHtml(formatDate(review.purchasedAt)) : "") + "</p>" +
    '<p class="gb-review-card__author">\u2014 ' + escapeHtml(review.author || "Verified customer") + "</p>" +
    "</article>";
}

function initRelated(product) {
  const related = qs("#product-related");
  const grid = qs("#related-products");
  if (!related || !grid) return;
  api.products.list({ perPage: 12 })
    .then((data) => {
      const items = data.items.filter((item) => String(item.id) !== String(product.id)).slice(0, 3);
      if (!items.length) { related.hidden = true; return; }
      renderProductGrid(grid, items);
      related.hidden = false;
    })
    .catch(() => { related.hidden = true; });
}
/* --------------------------------------------------------------------------
   CART PAGE
   -------------------------------------------------------------------------- */
function initCartPage() {
  const root = qs("#cart-page");
  if (!root) return;
  const itemsHost = qs("[data-cart-items]", root);
  const summaryHost = qs("[data-cart-summary]", root);
  const discountForm = qs("[data-discount-form]", root);
  const appliedBanner = qs("[data-discount-applied]", root);

  function renderSummary(totals) {
    if (!summaryHost) return;
    summaryHost.innerHTML =
      '<h2 class="gb-mb-4">Order summary</h2>' +
      '<div class="gb-summary__row"><span>Subtotal (' + totals.count + " " + (totals.count === 1 ? "item" : "items") + ")</span><span>" + formatMoney(totals.subtotal) + "</span></div>" +
      (totals.discountAmount ? '<div class="gb-summary__row gb-summary__row--discount"><span>' + escapeHtml(totals.discount.code) +
        " \u2014 " + escapeHtml(totals.discount.label) + "</span><span>-" + formatMoney(totals.discountAmount) + "</span></div>" : "") +
      '<div class="gb-summary__row"><span>Delivery</span><span>' + (totals.shipping ? formatMoney(totals.shipping) : "Free") + "</span></div>" +
      '<div class="gb-summary__row gb-summary__row--total"><span>Total</span><span>' + formatMoney(totals.total) + "</span></div>" +
      '<p class="gb-small gb-muted gb-mb-0">' + (totals.subtotal && totals.subtotal < totals.freeShippingThreshold
        ? "Spend " + formatMoney(totals.freeShippingThreshold - totals.subtotal) + " more for free standard delivery."
        : "Delivery is calculated for the country selected in the header.") + "</p>" +
      '<a class="gb-btn gb-btn--gold gb-btn--block" href="checkout.html">Proceed to checkout</a>' +
      '<a class="gb-btn gb-btn--outline gb-btn--block" href="shop.html">Continue shopping</a>';
  }

  function render() {
    if (!itemsHost) return;
    const totals = getTotals({ country: getCountryCode() });
    if (!totals.items.length) {
      itemsHost.innerHTML = stateTemplate({
        title: "Your bag is empty",
        message: "Browse the packs and add one to your bag.",
        actionLabel: "Shop products",
        actionHref: "shop.html"
      });
      if (summaryHost) summaryHost.innerHTML = "";
      if (appliedBanner) appliedBanner.hidden = true;
      return;
    }
    itemsHost.innerHTML = '<ul class="gb-list-plain gb-mb-0">' +
      totals.items.map((item) => renderCartItem(item).replace("gb-cart-item--drawer", "")).join("") + "</ul>";
    renderSummary(totals);
    if (appliedBanner) {
      if (totals.discount) {
        appliedBanner.hidden = false;
        appliedBanner.innerHTML = "<strong>" + escapeHtml(totals.discount.code) + "</strong> applied \u2014 " +
          escapeHtml(totals.discount.label) + '. <button type="button" class="gb-btn gb-btn--link" data-discount-remove>Remove</button>';
      } else {
        appliedBanner.hidden = true;
        appliedBanner.innerHTML = "";
      }
    }
  }

  if (itemsHost) {
    itemsHost.addEventListener("click", (event) => {
      const row = event.target.closest("[data-id]");
      if (!row) return;
      const id = row.dataset.id;
      const variant = row.dataset.variant;
      const input = row.querySelector("[data-cart-qty]");
      if (event.target.closest("[data-cart-inc]")) updateQty(id, Number(input.value) + 1, variant);
      else if (event.target.closest("[data-cart-dec]")) updateQty(id, Number(input.value) - 1, variant);
      else if (event.target.closest("[data-cart-remove]")) removeItem(id, variant);
    });
    itemsHost.addEventListener("change", (event) => {
      const input = event.target.closest("[data-cart-qty]");
      if (!input) return;
      const row = input.closest("[data-id]");
      updateQty(row.dataset.id, input.value, row.dataset.variant);
    });
  }

  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-discount-remove]")) {
      setDiscount(null);
      toast("Discount code removed.", { variant: "info" });
      render();
    }
  });

  if (discountForm) {
    discountForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = discountForm.querySelector('input[name="code"]');
      const status = discountForm.querySelector("[data-discount-status]");
      const button = discountForm.querySelector('button[type="submit"]');
      setBusy(button, true, "Checking\u2026");
      try {
        const discount = await applyDiscountCode(input.value);
        if (status) { status.textContent = discount.label + " applied."; status.dataset.state = "success"; }
        toast(discount.code + " applied.", { variant: "success" });
      } catch (error) {
        if (status) { status.textContent = error.message || "That code is not valid."; status.dataset.state = "error"; }
      } finally {
        setBusy(button, false);
        render();
      }
    });
  }

  document.addEventListener("gb:cart-changed", render);
  document.addEventListener("gb:locale-changed", render);
  render();
}

/* --------------------------------------------------------------------------
   CHECKOUT
   -------------------------------------------------------------------------- */
function initCheckout() {
  const form = qs("[data-checkout-form]");
  if (!form) return;
  const summaryHost = qs("[data-checkout-summary]");
  const totalsHost = qs("[data-checkout-totals]");
  const prescriptionField = qs("[data-prescription-field]");
  const countrySelect = qs('[name="country"]', form);
  const methodInputs = () => qs('[name="shippingMethod"]:checked', form);

  if (countrySelect) {
    countrySelect.value = getCountryCode() || "NG";
    const options = countrySelect.options;
    if (options.length && !countrySelect.value) countrySelect.selectedIndex = 0;
  }

  const initialTotals = getTotals({ country: countrySelect ? countrySelect.value : getCountryCode() });
  if (!initialTotals.items.length) {
    const layout = qs(".gb-checkout-layout");
    if (layout) {
      layout.innerHTML = stateTemplate({
        title: "Your bag is empty",
        message: "Add a product before checking out.",
        actionLabel: "Shop products",
        actionHref: "shop.html"
      });
    }
    return;
  }

  if (summaryHost) {
    summaryHost.innerHTML = initialTotals.items.map((item) =>
      '<div class="gb-order-line">' +
        '<span class="gb-order-line__name">' +
          '<span class="gb-order-line__thumb"><img src="' + escapeHtml(item.image || "assets/img/product-single.jpg") +
            '" alt="" width="48" height="48" loading="lazy"></span>' +
          "<span>" + escapeHtml(item.name) +
            (item.variant ? '<br><span class="gb-muted gb-small">' + escapeHtml(item.variant) + "</span>" : "") +
            '<br><span class="gb-muted gb-small">Qty ' + item.qty + "</span></span>" +
        "</span>" +
        "<span>" + formatMoney(item.price * item.qty) + "</span>" +
      "</div>").join("");
  }

  function renderTotals() {
    if (!totalsHost) return;
    const totals = getTotals({ shippingMethod: methodInputs() ? methodInputs().value : "standard", country: countrySelect ? countrySelect.value : getCountryCode() });
    totalsHost.innerHTML =
      '<div class="gb-summary__row"><span>Subtotal</span><span>' + formatMoney(totals.subtotal) + "</span></div>" +
      (totals.discountAmount ? '<div class="gb-summary__row gb-summary__row--discount"><span>' + escapeHtml(totals.discount.code) +
        "</span><span>-" + formatMoney(totals.discountAmount) + "</span></div>" : "") +
      '<div class="gb-summary__row"><span>Delivery</span><span>' + (totals.shipping ? formatMoney(totals.shipping) : "Free") + "</span></div>" +
      '<div class="gb-summary__row gb-summary__row--total"><span>Total</span><span>' + formatMoney(totals.total) + "</span></div>";
  }
  renderTotals();

  // Prescription upload is only offered when the API marks a line item as
  // requiring one. The field stays disabled otherwise so it is never submitted.
  const requiresPrescription = initialTotals.items.some((item) => item.requiresPrescription);
  if (prescriptionField) {
    prescriptionField.hidden = !requiresPrescription;
    qsa("input, select, textarea", prescriptionField).forEach((input) => {
      input.required = false;
      input.disabled = !requiresPrescription;
    });
  }
  const schema = {
    email: [rules.required("Enter your email address."), rules.email()],
    firstName: [rules.required("Enter your first name.")],
    lastName: [rules.required("Enter your last name.")],
    phone: [rules.required("Enter a contact phone number."), rules.phone()],
    address1: [rules.required("Enter your street address.")],
    city: [rules.required("Enter your city.")],
    postalCode: [rules.required("Enter your postal code."), rules.pattern(/^[A-Za-z0-9 -]{3,12}$/, "Enter a valid postal code.")],
    country: [rules.required("Select your country.")],
    ageConfirm: [rules.accepted("Confirm that you are 18 or older and have read the safety information.")],
    termsConfirm: [rules.accepted("Please accept the terms and refund policy.")]
  };
  if (requiresPrescription) schema.prescription = [rules.required("Attach your prescription before placing the order.")];

  const validator = wireForm(form, schema, {
    onSubmit: async (formData) => {
      const submit = form.querySelector('button[type="submit"]');
      const payload = formToObject(formData);
      delete payload.ageConfirm;
      delete payload.termsConfirm;
      payload.items = initialTotals.items.map((item) => ({ id: item.id, qty: item.qty, variant: item.variant }));
      payload.discountCode = initialTotals.discount ? initialTotals.discount.code : null;
      payload.shippingMethod = methodInputs() ? methodInputs().value : "standard";
      payload.currency = getCurrencyCode();
      setBusy(submit, true, "Placing order\u2026");
      try {
        const result = await api.orders.create(payload);
        const reference = (result && result.order && result.order.reference) || (result && result.reference) || "pending";
        clearCart();
        window.location.assign("account.html?placed=" + encodeURIComponent(reference));
      } catch (error) {
        const summary = form.querySelector("[data-form-error]");
        if (summary) { summary.hidden = false; summary.textContent = error.message || "We could not place your order. Please try again."; }
      } finally {
        setBusy(submit, false);
      }
    }
  });

  form.addEventListener("change", (event) => {
    if (event.target.name === "shippingMethod" || event.target.name === "country") renderTotals();
  });

  return validator;
}

/* --------------------------------------------------------------------------
   LOGIN / REGISTER
   -------------------------------------------------------------------------- */
function initLogin() {
  const form = qs("#login-form");
  if (!form) return;
  redirectIfAuthenticated();

  const toggle = qs("[data-password-toggle]", form);
  if (toggle) {
    toggle.addEventListener("click", () => {
      const input = qs('input[name="password"]', form);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      toggle.textContent = show ? "Hide" : "Show";
      toggle.setAttribute("aria-pressed", String(show));
    });
  }

  wireForm(form, {
    email: [rules.required("Enter your email address."), rules.email()],
    password: [rules.required("Enter your password.")]
  }, {
    onSubmit: async (formData) => {
      const submit = form.querySelector('button[type="submit"]');
      const values = formToObject(formData);
      setBusy(submit, true, "Signing in\u2026");
      try {
        await login(values.email, values.password);
        toast("Welcome back.", { variant: "success" });
        window.location.assign(safeNextUrl());
      } catch (error) {
        const summary = form.querySelector("[data-form-error]");
        if (summary) { summary.hidden = false; summary.textContent = error.message || "We could not sign you in."; }
      } finally {
        setBusy(submit, false);
      }
    }
  });
}

function initRegister() {
  const form = qs("#register-form");
  if (!form) return;
  redirectIfAuthenticated();

  const passwordInput = qs('input[name="password"]', form);
  initStrengthMeter(passwordInput, {
    meter: qs("[data-strength-bar]", form),
    label: qs("[data-strength-label]", form)
  });

  const toggle = qs("[data-password-toggle]", form);
  if (toggle && passwordInput) {
    toggle.addEventListener("click", () => {
      const show = passwordInput.type === "password";
      passwordInput.type = show ? "text" : "password";
      toggle.textContent = show ? "Hide" : "Show";
      toggle.setAttribute("aria-pressed", String(show));
    });
  }

  wireForm(form, {
    firstName: [rules.required("Enter your first name.")],
    lastName: [rules.required("Enter your last name.")],
    email: [rules.required("Enter your email address."), rules.email()],
    dob: [rules.required("Enter your date of birth."), rules.adult()],
    password: [rules.required("Choose a password."), rules.password()],
    confirmPassword: [rules.required("Re-enter your password."), rules.matches(passwordInput)],
    terms: [rules.accepted("Please accept the terms to create an account.")]
  }, {
    onSubmit: async (formData) => {
      const submit = form.querySelector('button[type="submit"]');
      const payload = formToObject(formData);
      delete payload.confirmPassword;
      delete payload.terms;
      setBusy(submit, true, "Creating account\u2026");
      try {
        await register(payload);
        toast("Your account is ready.", { variant: "success" });
        window.location.assign(safeNextUrl());
      } catch (error) {
        const summary = form.querySelector("[data-form-error]");
        if (summary) { summary.hidden = false; summary.textContent = error.message || "We could not create your account."; }
      } finally {
        setBusy(submit, false);
      }
    }
  });
}
/* --------------------------------------------------------------------------
   ACCOUNT
   -------------------------------------------------------------------------- */
function initAccount() {
  const root = qs("#account-page");
  if (!root) return;
  const user = requireAuth();
  if (!user) return;

  const placed = params().get("placed");
  const banner = qs("[data-order-placed]");
  if (placed && banner) {
    banner.hidden = false;
    banner.innerHTML = "<strong>Order received.</strong> Your reference is <span class=\"gb-mono\">" +
      escapeHtml(placed) + "</span>. A confirmation has been emailed to you.";
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.name || user.email || "there";
  qsa("[data-account-name]").forEach((el) => { el.textContent = fullName; });

  const profileForm = qs("[data-profile-form]");
  if (profileForm) {
    ["firstName", "lastName", "email", "phone"].forEach((field) => {
      const input = profileForm.querySelector('[name="' + field + '"]');
      if (input && user[field]) input.value = user[field];
    });
    wireForm(profileForm, {
      firstName: [rules.required("Enter your first name.")],
      lastName: [rules.required("Enter your last name.")],
      email: [rules.required("Enter your email address."), rules.email()],
      phone: [rules.phone()]
    }, {
      onSubmit: async (formData) => {
        const submit = profileForm.querySelector('button[type="submit"]');
        setBusy(submit, true, "Saving\u2026");
        try {
          await api.account.update(formToObject(formData));
          toast("Profile updated.", { variant: "success" });
        } catch (error) {
          toast(error.message || "We could not save your profile.", { variant: "error" });
        } finally {
          setBusy(submit, false);
        }
      }
    });
  }

  qsa("[data-logout]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      logout({ redirect: "index.html" });
    });
  });

  const orderList = qs("[data-order-list]");
  if (orderList) {
    orderList.innerHTML = '<div class="gb-stack-sm" aria-hidden="true"><div class="gb-skeleton" style="height:3rem"></div>' +
      '<div class="gb-skeleton" style="height:3rem"></div></div>';
    api.orders.list()
      .then((data) => {
        const orders = Array.isArray(data) ? data : ((data && data.items) || []);
        if (!orders.length) {
          orderList.innerHTML = stateTemplate({
            title: "No orders yet",
            message: "When you place an order it will appear here with its status and reference.",
            actionLabel: "Shop products",
            actionHref: "shop.html"
          });
          return;
        }
        orderList.innerHTML =
          '<div class="gb-table-wrap"><table class="gb-table">' +
            '<caption class="gb-visually-hidden">Your order history</caption>' +
            '<thead><tr><th scope="col">Reference</th><th scope="col">Date</th><th scope="col">Items</th>' +
            '<th scope="col">Status</th><th scope="col">Total</th></tr></thead><tbody>' +
            orders.map((order) => "<tr>" +
              '<td class="gb-mono">' + escapeHtml(order.reference || order.id || "") + "</td>" +
              "<td>" + escapeHtml(formatDate(order.createdAt)) + "</td>" +
              "<td>" + Number(order.itemCount || (order.items ? order.items.length : 0)) + "</td>" +
              '<td><span class="gb-badge gb-badge--muted">' + escapeHtml(order.status || "Processing") + "</span></td>" +
              "<td>" + escapeHtml(formatMoney(order.total || 0)) + "</td>" +
            "</tr>").join("") +
          "</tbody></table></div>";
      })
      .catch((error) => reportError(orderList, error, () => window.location.reload()));
  }
}

/* --------------------------------------------------------------------------
   BLOG
   -------------------------------------------------------------------------- */
function initBlog() {
  const host = qs("#blog-posts");
  if (!host) return;
  const status = qs("[data-blog-status]");
  host.innerHTML = productGridSkeleton(3);
  api.blog.list({ perPage: 12 })
    .then((data) => {
      if (!data.items.length) {
        host.className = "";
        host.innerHTML = stateTemplate({ title: "No articles yet", message: "Our education library is being prepared. Please check back soon." });
        return;
      }
      host.className = "gb-grid gb-grid--3";
      host.innerHTML = data.items.map(postCardTemplate).join("");
      if (status) status.textContent = data.items.length + " articles";
      initReveal(host);
    })
    .catch((error) => reportError(host, error, () => window.location.reload()));
}

function initBlogPost() {
  const host = qs("#post-root");
  if (!host) return;
  const slug = params().get("slug");
  if (!slug) {
    reportError(host, new ApiError("No article was specified.", { status: 404 }), () => window.location.assign("blog.html"));
    return;
  }
  api.blog.get(slug)
    .then((post) => {
      if (!post || !post.title) throw new ApiError("We could not find that article.", { status: 404 });
      document.title = post.title + " \u2014 Golden Bullet";
      host.innerHTML =
        '<article class="gb-article">' +
          '<p class="gb-eyebrow">' + escapeHtml(post.category || "Education") + "</p>" +
          "<h1>" + escapeHtml(post.title) + "</h1>" +
          '<div class="gb-article__meta">' +
            "<span>" + escapeHtml(formatDate(post.publishedAt)) + "</span>" +
            "<span>" + Number(post.readingMinutes || 4) + " min read</span>" +
            "<span>Reviewed before publication</span>" +
          "</div>" +
          (post.image ? '<div class="gb-article__hero"><img src="' + escapeHtml(post.image) + '" alt="" width="1200" height="675"></div>' : "") +
          '<div class="gb-article__body gb-prose">' + renderBlocks(post.body) + "</div>" +
          '<div class="gb-notice gb-mt-6">' +
            "<strong>This product is not intended to diagnose, treat, cure, or prevent any disease.</strong>" +
            "Consult a healthcare professional before use." +
          "</div>" +
          '<p class="gb-mt-6"><a class="gb-btn gb-btn--outline" href="blog.html">Back to all articles</a></p>' +
        "</article>";
    })
    .catch((error) => reportError(host, error, () => window.location.reload()));
}

function renderBlocks(blocks) {
  if (!Array.isArray(blocks)) return "<p>" + escapeHtml(String(blocks || "")) + "</p>";
  return blocks.map((block) => {
    if (typeof block === "string") return "<p>" + escapeHtml(block) + "</p>";
    if (block.type === "h2") return "<h2>" + escapeHtml(block.text) + "</h2>";
    if (block.type === "h3") return "<h3>" + escapeHtml(block.text) + "</h3>";
    if (block.type === "quote") return "<blockquote>" + escapeHtml(block.text) + "</blockquote>";
    if (block.type === "list") return "<ul>" + (block.items || []).map((item) => "<li>" + escapeHtml(item) + "</li>").join("") + "</ul>";
    if (block.type === "ordered") return "<ol>" + (block.items || []).map((item) => "<li>" + escapeHtml(item) + "</li>").join("") + "</ol>";
    return "<p>" + escapeHtml(block.text || "") + "</p>";
  }).join("");
}
/* --------------------------------------------------------------------------
   CONTACT / AFFILIATE / SAFETY REPORT
   -------------------------------------------------------------------------- */
function initContact() {
  const form = qs("#contact-form");
  if (!form) return;
  wireForm(form, {
    name: [rules.required("Enter your name.")],
    email: [rules.required("Enter your email address."), rules.email()],
    subject: [rules.required("Choose a subject.")],
    orderRef: [rules.maxLength(40)],
    message: [rules.required("Tell us how we can help."), rules.minLength(20)]
  }, {
    onSubmit: async (formData) => {
      const submit = form.querySelector('button[type="submit"]');
      const status = form.querySelector("[data-form-status]");
      setBusy(submit, true, "Sending\u2026");
      try {
        await api.contact.send(formToObject(formData));
        form.reset();
        if (status) {
          status.hidden = false;
          status.className = "gb-alert gb-alert--success";
          status.textContent = "Thank you. Our support team replies to messages within one business day.";
        }
      } catch (error) {
        if (status) {
          status.hidden = false;
          status.className = "gb-alert gb-alert--danger";
          status.textContent = error.message || "We could not send your message.";
        }
      } finally {
        setBusy(submit, false);
      }
    }
  });
}

function initAffiliate() {
  const form = qs("#affiliate-form");
  if (!form) return;
  wireForm(form, {
    name: [rules.required("Enter your name.")],
    email: [rules.required("Enter your email address."), rules.email()],
    audience: [rules.required("Tell us about your audience.")],
    channel: [rules.required("Add the main channel you will promote on.")],
    country: [rules.required("Select your country.")],
    adult: [rules.accepted("Confirm that you are 18 or older.")]
  }, {
    onSubmit: async (formData) => {
      const submit = form.querySelector('button[type="submit"]');
      const status = form.querySelector("[data-form-status]");
      setBusy(submit, true, "Submitting\u2026");
      try {
        const payload = formToObject(formData);
        delete payload.adult;
        const result = await api.affiliate.apply(payload);
        form.reset();
        if (status) {
          status.hidden = false;
          status.className = "gb-alert gb-alert--success";
          status.textContent = (result && result.message) || "Application received. Our affiliate team will review it and reply by email.";
        }
      } catch (error) {
        if (status) {
          status.hidden = false;
          status.className = "gb-alert gb-alert--danger";
          status.textContent = error.message || "We could not submit your application.";
        }
      } finally {
        setBusy(submit, false);
      }
    }
  });
}

function initSafetyReport() {
  const form = qs("#adverse-reaction-form");
  if (!form) return;
  wireForm(form, {
    reporterName: [rules.required("Enter your name.")],
    reporterEmail: [rules.required("Enter your email address."), rules.email()],
    productName: [rules.required("Select or enter the product.")],
    batchNumber: [rules.required("Enter the batch or lot number printed on the pack.")],
    reactionDate: [rules.required("Enter the date the reaction started.")],
    description: [rules.required("Describe what happened."), rules.minLength(20)],
    consent: [rules.accepted("Confirm that we may contact you about this report.")]
  }, {
    onSubmit: async (formData) => {
      const submit = form.querySelector('button[type="submit"]');
      const status = form.querySelector("[data-form-status]");
      setBusy(submit, true, "Sending\u2026");
      try {
        const payload = formToObject(formData);
        delete payload.consent;
        await api.adverseReaction.send(payload);
        form.reset();
        if (status) {
          status.hidden = false;
          status.className = "gb-alert gb-alert--success";
          status.textContent = "Report received. If this is a medical emergency, contact your local emergency service immediately.";
        }
      } catch (error) {
        if (status) {
          status.hidden = false;
          status.className = "gb-alert gb-alert--danger";
          status.textContent = error.message || "We could not send your report.";
        }
      } finally {
        setBusy(submit, false);
      }
    }
  });
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */
function boot() {
  initAgeGate();
  initSharedChrome();
  initCartDrawer();
  initCartBadge();
  initAddToCartButtons();
  initAuthUI();

  api.config().catch(() => { /* fall back to the built-in static rate table */ });
  document.addEventListener("gb:locale-changed", () => {
    // Checkout keeps its form state; every other page simply re-renders prices.
    if (document.body.dataset.page === "checkout") return;
    window.location.reload();
  });

  const controllers = {
    home: initHome,
    shop: initShop,
    product: initProduct,
    cart: initCartPage,
    checkout: initCheckout,
    login: initLogin,
    register: initRegister,
    account: initAccount,
    blog: initBlog,
    "blog-post": initBlogPost,
    contact: initContact,
    affiliate: initAffiliate,
    safety: initSafetyReport
  };

  const page = document.body.dataset.page || pageName().replace(".html", "");
  const controller = controllers[page];
  if (controller) {
    try { controller(); }
    catch (error) {
      // A page controller failing must never take the whole shell down.
      if (window.console && window.console.error) window.console.error("[Golden Bullet] " + page + " failed to initialise", error);
    }
  }

  document.documentElement.classList.add("gb-ready");
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
