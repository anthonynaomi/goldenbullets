/* ==========================================================================
   Golden Bullet - cart.js
   localStorage cart with cross-tab sync, discount codes and drawer rendering.
   ========================================================================== */

import { CONFIG, storage, formatMoney, productImage, api, ApiError, getCountryCode } from "./api.js";

const MAX_QTY = 20;
const FREE_SHIPPING_KEY = "freeShippingThreshold";

/* --------------------------------------------------------------------------
   Cross-tab channel (BroadcastChannel where available, storage events always)
   -------------------------------------------------------------------------- */
let channel = null;
try {
  if ("BroadcastChannel" in window) channel = new BroadcastChannel("gb-cart");
} catch (error) {
  channel = null;
}

const listeners = new Set();

function emit({ broadcast = true } = {}) {
  if (broadcast && channel) {
    try { channel.postMessage({ type: "cart", at: Date.now() }); } catch (error) { /* ignore */ }
  }
  listeners.forEach((fn) => {
    try { fn(getCart()); } catch (error) { /* isolate listener errors */ }
  });
  document.dispatchEvent(new CustomEvent("gb:cart-changed", { detail: { cart: getCart() } }));
}

if (channel) {
  channel.addEventListener("message", (event) => {
    if (event?.data?.type === "cart") emit({ broadcast: false });
  });
}
window.addEventListener("storage", (event) => {
  if (event.key === CONFIG.cartKey) emit({ broadcast: false });
});

/* --------------------------------------------------------------------------
   State
   -------------------------------------------------------------------------- */
function sanitizeItem(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id ?? "").trim();
  if (!id) return null;
  const price = Number(item.price);
  const qty = Math.min(MAX_QTY, Math.max(1, Math.round(Number(item.qty) || 1)));
  return {
    id,
    slug: String(item.slug ?? id),
    name: String(item.name ?? "Product"),
    price: Number.isFinite(price) ? price : 0,
    compareAt: Number.isFinite(Number(item.compareAt)) ? Number(item.compareAt) : null,
    image: typeof item.image === "string" ? item.image : "",
    variant: item.variant ? String(item.variant) : "",
    requiresPrescription: Boolean(item.requiresPrescription),
    qty
  };
}

export function getCart() {
  const raw = storage.getJSON(CONFIG.cartKey, { items: [], discount: null });
  const items = Array.isArray(raw?.items) ? raw.items.map(sanitizeItem).filter(Boolean) : [];
  return { items, discount: raw?.discount || null };
}

function write(state, options = {}) {
  const ok = storage.setJSON(CONFIG.cartKey, state);
  if (!ok) {
    document.dispatchEvent(new CustomEvent("gb:toast", { detail: { message: "Your browser is blocking storage, so the cart could not be saved.", variant: "error" } }));
  }
  emit(options);
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* --------------------------------------------------------------------------
   Mutations
   -------------------------------------------------------------------------- */
export function addItem(product, qty = 1, { variant = "", openDrawer = true } = {}) {
  const state = getCart();
  const id = String(product.id);
  const existing = state.items.find((item) => item.id === id && item.variant === variant);
  const image = productImage(product, 0).src;

  if (existing) {
    existing.qty = Math.min(MAX_QTY, existing.qty + Math.max(1, Math.round(qty)));
  } else {
    state.items.push(sanitizeItem({
      id,
      slug: product.slug || id,
      name: product.name,
      price: product.price,
      compareAt: product.compareAt ?? null,
      image,
      variant,
      requiresPrescription: Boolean(product.requiresPrescription),
      qty: Math.max(1, Math.round(qty))
    }));
  }
  write(state);
  if (openDrawer) {
    document.dispatchEvent(new CustomEvent("gb:cart-open", { detail: { id } }));
  }
  return state;
}

export function updateQty(id, qty, variant = "") {
  const state = getCart();
  const item = state.items.find((entry) => entry.id === String(id) && entry.variant === variant);
  if (!item) return state;
  const next = Math.round(Number(qty));
  if (!Number.isFinite(next) || next <= 0) return removeItem(id, variant);
  item.qty = Math.min(MAX_QTY, Math.max(1, next));
  return write(state);
}

export function removeItem(id, variant = "") {
  const state = getCart();
  state.items = state.items.filter((entry) => !(entry.id === String(id) && entry.variant === variant));
  if (!state.items.length) state.discount = null;
  return write(state);
}

export function clearCart() {
  return write({ items: [], discount: null });
}

export function setDiscount(discount) {
  const state = getCart();
  state.discount = discount || null;
  return write(state);
}

export function getCount() {
  return getCart().items.reduce((sum, item) => sum + item.qty, 0);
}

/* --------------------------------------------------------------------------
   Totals
   -------------------------------------------------------------------------- */
export function getTotals({ shippingMethod = "standard", country = getCountryCode() } = {}) {
  const { items, discount } = getCart();
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  let discountAmount = 0;
  if (discount && subtotal > 0) {
    discountAmount = discount.type === "percent"
      ? Math.round((subtotal * Number(discount.value || 0)) / 100)
      : Math.min(subtotal, Number(discount.value || 0));
  }
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const threshold = Number(storage.get(FREE_SHIPPING_KEY, "100")) || 0;

  let shipping = 0;
  if (afterDiscount > 0 && shippingMethod !== "pickup") {
    shipping = shippingMethod === "express" ? 12 : (afterDiscount >= threshold ? 0 : 6);
  }
  if (country !== "US" && afterDiscount > 0 && shippingMethod !== "pickup") {
    shipping += shippingMethod === "express" ? 25 : 15;
  }
  return {
    items,
    discount,
    subtotal,
    discountAmount,
    shipping,
    shippingMethod,
    freeShippingThreshold: threshold,
    total: Math.max(0, afterDiscount + shipping),
    count: items.reduce((sum, item) => sum + item.qty, 0)
  };
}

/* --------------------------------------------------------------------------
   Discount validation
   -------------------------------------------------------------------------- */
export async function applyDiscountCode(code) {
  const trimmed = String(code || "").trim().toUpperCase();
  if (!trimmed) throw new ApiError("Enter a discount code.", { status: 422, code: "empty_code" });
  const { subtotal } = getTotals();
  const result = await api.discounts.validate(trimmed, subtotal);
  const discount = {
    code: result?.code || trimmed,
    type: result?.type || "percent",
    value: Number(result?.value || 0),
    label: result?.label || `${result?.value || 0}% off`
  };
  setDiscount(discount);
  return discount;
}

/* --------------------------------------------------------------------------
   Rendering helpers (shared by the drawer, the cart page and the header badge)
   -------------------------------------------------------------------------- */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

export function renderCartItem(item) {
  const lineTotal = formatMoney(item.price * item.qty);
  return `
    <li class="gb-cart-item gb-cart-item--drawer" data-id="${escapeHtml(item.id)}" data-variant="${escapeHtml(item.variant)}">
      <div class="gb-cart-item__media">
        <img src="${escapeHtml(item.image || "assets/img/product-single.jpg")}" alt="" width="72" height="72" loading="lazy" decoding="async">
      </div>
      <div>
        <h3 class="gb-cart-item__title"><a href="product.html?id=${encodeURIComponent(item.slug)}">${escapeHtml(item.name)}</a></h3>
        ${item.variant ? `<p class="gb-small gb-muted gb-mb-0">${escapeHtml(item.variant)}</p>` : ""}
        ${item.requiresPrescription ? `<p class="gb-small gb-danger-text gb-mb-0">Prescription required</p>` : ""}
        <div class="gb-cart-item__controls">
          <div class="gb-qty" role="group" aria-label="Quantity for ${escapeHtml(item.name)}">
            <button type="button" class="gb-qty__btn" data-cart-dec aria-label="Decrease quantity">&minus;</button>
            <input class="gb-qty__input" type="number" inputmode="numeric" min="1" max="${MAX_QTY}" value="${item.qty}" data-cart-qty aria-label="Quantity">
            <button type="button" class="gb-qty__btn" data-cart-inc aria-label="Increase quantity">+</button>
          </div>
          <button type="button" class="gb-cart-item__remove" data-cart-remove>Remove</button>
        </div>
      </div>
      <p class="gb-cart-item__line-price gb-mb-0">${lineTotal}</p>
    </li>`;
}

/* --------------------------------------------------------------------------
   Drawer controller
   -------------------------------------------------------------------------- */
export function initCartDrawer() {
  const drawer = document.getElementById("gb-cart-drawer");
  const scrim = document.getElementById("gb-cart-scrim");
  if (!drawer || !scrim) return null;

  const body = drawer.querySelector("[data-cart-drawer-body]");
  const foot = drawer.querySelector("[data-cart-drawer-foot]");
  const closeBtn = drawer.querySelector("[data-cart-close]");
  let lastFocused = null;

  function focusables() {
    return Array.from(drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  function open() {
    lastFocused = document.activeElement;
    drawer.dataset.open = "true";
    scrim.dataset.open = "true";
    drawer.removeAttribute("inert");
    drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("gb-no-scroll");
    const first = drawer.querySelector("[data-cart-close]");
    window.setTimeout(() => first?.focus(), 40);
  }

  function close() {
    drawer.dataset.open = "false";
    scrim.dataset.open = "false";
    drawer.setAttribute("aria-hidden", "true");
    drawer.setAttribute("inert", "");
    document.body.classList.remove("gb-no-scroll");
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  closeBtn?.addEventListener("click", close);
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (drawer.dataset.open !== "true") return;
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Tab") {
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  document.addEventListener("gb:cart-open", open);
  document.addEventListener("gb:cart-close", close);
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-cart-open]")) { event.preventDefault(); open(); }
  });

  body?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-id]");
    if (!row) return;
    const { id, variant } = row.dataset;
    if (event.target.closest("[data-cart-inc]")) {
      const input = row.querySelector("[data-cart-qty]");
      updateQty(id, Number(input?.value || 1) + 1, variant);
    } else if (event.target.closest("[data-cart-dec]")) {
      const input = row.querySelector("[data-cart-qty]");
      updateQty(id, Number(input?.value || 1) - 1, variant);
    } else if (event.target.closest("[data-cart-remove]")) {
      removeItem(id, variant);
      document.dispatchEvent(new CustomEvent("gb:toast", { detail: { message: "Item removed from your bag.", variant: "info" } }));
    }
  });

  body?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-cart-qty]");
    if (!input) return;
    const row = input.closest("[data-id]");
    updateQty(row.dataset.id, input.value, row.dataset.variant);
  });

  function render() {
    const totals = getTotals();
    if (!body || !foot) return;
    if (!totals.items.length) {
      body.innerHTML = `
        <div class="gb-state">
          <p class="gb-state__title">Your bag is empty</p>
          <p>Add a pack to get started.</p>
          <div class="gb-state__actions"><a class="gb-btn gb-btn--gold" href="shop.html">Shop products</a></div>
        </div>`;
      foot.innerHTML = "";
      return;
    }
    body.innerHTML = `<ul class="gb-list-plain gb-mb-0">${totals.items.map(renderCartItem).join("")}</ul>`;
    foot.innerHTML = `
      <div class="gb-summary__row"><span>Subtotal</span><span>${formatMoney(totals.subtotal)}</span></div>
      ${totals.discountAmount ? `<div class="gb-summary__row gb-summary__row--discount"><span>Discount (${escapeHtml(totals.discount.code)})</span><span>-${formatMoney(totals.discountAmount)}</span></div>` : ""}
      <div class="gb-summary__row"><span>Shipping</span><span>${totals.shipping === 0 ? "Calculated at checkout" : formatMoney(totals.shipping)}</span></div>
      <div class="gb-summary__row gb-summary__row--total"><span>Total</span><span>${formatMoney(totals.total)}</span></div>
      <div class="gb-stack gb-mt-4">
        <a class="gb-btn gb-btn--gold gb-btn--block" href="checkout.html">Checkout</a>
        <a class="gb-btn gb-btn--outline gb-btn--block" href="cart.html">View bag</a>
      </div>`;
  }

  subscribe(render);
  render();
  return { open, close, render };
}

/* --------------------------------------------------------------------------
   Header badge + "add to cart" delegates
   -------------------------------------------------------------------------- */
export function initCartBadge() {
  const badges = document.querySelectorAll("[data-cart-count]");
  const totalsForBadge = () => getCount();
  function render() {
    const count = totalsForBadge();
    badges.forEach((badge) => {
      const previous = Number(badge.textContent || 0);
      badge.textContent = String(count);
      badge.hidden = count === 0;
      if (count > previous) {
        badge.classList.remove("gb-is-bumped");
        void badge.offsetWidth;
        badge.classList.add("gb-is-bumped");
      }
    });
  }
  subscribe(render);
  render();
}

export function initAddToCartButtons() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-add-to-cart]");
    if (!button) return;
    event.preventDefault();
    const { addToCart: id, addToCartQty, addToCartVariant = "" } = button.dataset;
    if (!id || button.disabled) return;

    const original = button.innerHTML;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<span class="gb-btn__spinner" aria-hidden="true"></span><span>Adding…</span>`;
    try {
      const product = await api.products.get(id);
      const qtyInput = button.closest("[data-product-root]")?.querySelector("[data-qty-input]");
      const qty = addToCartQty ? Number(addToCartQty) : Number(qtyInput?.value || 1);
      addItem(product, qty, { variant: addToCartVariant });
      document.dispatchEvent(new CustomEvent("gb:toast", { detail: { message: `${product.name} added to your bag.`, variant: "success" } }));
    } catch (error) {
      document.dispatchEvent(new CustomEvent("gb:toast", { detail: { message: error.message || "We could not add that item.", variant: "error" } }));
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.innerHTML = original;
    }
  });
}

export { MAX_QTY };
