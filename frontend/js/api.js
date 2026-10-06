/* ==========================================================================
   Golden Bullet - api.js
   Single fetch wrapper + catalogue access + currency helpers.
   No imports: this module is the bottom of the dependency graph.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Configuration
   -------------------------------------------------------------------------- */
export const CONFIG = Object.freeze({
  apiBase: document.querySelector('meta[name="gb-api-base"]')?.content?.trim() || "api",
  requestTimeout: 12000,
  tokenKey: "gb.token",
  refreshKey: "gb.refresh",
  userKey: "gb.user",
  currencyKey: "gb.currency",
  countryKey: "gb.country",
  cartKey: "gb.cart",
  ageKey: "gb.ageOk",
  cookieKey: "gb.cookieOk",
  announcementKey: "gb.announceClosed",
  // Static demo data used when the API is unreachable (e.g. opened without the
  // local dev server). Never used for reviews: those must come from the API.
  staticFallback: "data/catalog.json",
  fallbackEnabled: true
});

/* --------------------------------------------------------------------------
   Errors
   -------------------------------------------------------------------------- */
export class ApiError extends Error {
  constructor(message, { status = 0, code = "error", details = null, cause = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
  get isOffline() { return this.status === 0; }
  get isAuth() { return this.status === 401 || this.status === 403; }
  get isNotFound() { return this.status === 404; }
}

/* --------------------------------------------------------------------------
   Token storage (safe against disabled localStorage)
   -------------------------------------------------------------------------- */
export const storage = {
  get(key, fallback = null) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : raw;
    } catch (error) {
      return fallback;
    }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, value); return true; }
    catch (error) { return false; }
  },
  remove(key) {
    try { window.localStorage.removeItem(key); return true; }
    catch (error) { return false; }
  },
  getJSON(key, fallback = null) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  },
  setJSON(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (error) { return false; }
  }
};

export function getToken() { return storage.get(CONFIG.tokenKey); }
export function setToken(token, refreshToken) {
  if (token) storage.set(CONFIG.tokenKey, token);
  if (refreshToken) storage.set(CONFIG.refreshKey, refreshToken);
  return true;
}
export function clearSession() {
  storage.remove(CONFIG.tokenKey);
  storage.remove(CONFIG.refreshKey);
  storage.remove(CONFIG.userKey);
}
export function getStoredUser() { return storage.getJSON(CONFIG.userKey); }
export function setStoredUser(user) { return storage.setJSON(CONFIG.userKey, user); }

/* --------------------------------------------------------------------------
   Core request wrapper
   -------------------------------------------------------------------------- */
const inflight = new Map();

function buildUrl(path, params) {
  const base = CONFIG.apiBase.replace(/\/+$/, "");
  const url = new URL(`${base}/${String(path).replace(/^\/+/, "")}`, document.baseURI);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "" || value === "all") continue;
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
      else url.searchParams.set(key, String(value));
    }
  }
  return url;
}

/**
 * Perform an HTTP request and return parsed JSON.
 * Attaches the request id so callers can show a deduplicated error.
 */
export async function request(path, { method = "GET", params, body, headers, auth = false, signal, timeout = CONFIG.requestTimeout, dedupe = false } = {}) {
  const url = buildUrl(path, params);
  const key = `${method} ${url.toString()}`;
  if (dedupe && method === "GET" && inflight.has(key)) return inflight.get(key);

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeout);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }

  const finalHeaders = { Accept: "application/json", ...headers };
  if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
  const token = getToken();
  if (auth && token) finalHeaders.Authorization = `Bearer ${token}`;

  const promise = (async () => {
    let response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers: finalHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        credentials: "same-origin"
      });
    } catch (error) {
      throw new ApiError(
        error?.name === "TimeoutError" ? "The request timed out. Please check your connection and try again." : "We could not reach the server. Please check your connection.",
        { status: 0, code: error?.name === "TimeoutError" ? "timeout" : "network", cause: error }
      );
    } finally {
      window.clearTimeout(timer);
      inflight.delete(key);
    }

    let payload = null;
    const text = await response.text();
    if (text) {
      try { payload = JSON.parse(text); }
      catch (error) { payload = null; }
    }

    if (!response.ok) {
      const detail = payload?.error;
      throw new ApiError(
        (typeof detail === "string" && detail) || payload?.message || defaultMessageForStatus(response.status),
        { status: response.status, code: payload?.code || "http_error", details: payload?.details || null }
      );
    }
    return payload;
  })();

  if (dedupe) inflight.set(key, promise);
  return promise;
}

function defaultMessageForStatus(status) {
  if (status === 400) return "Some of the details you entered were not valid.";
  if (status === 401) return "Please sign in to continue.";
  if (status === 403) return "You do not have access to this resource.";
  if (status === 404) return "We could not find what you were looking for.";
  if (status === 409) return "That conflicts with something that already exists.";
  if (status === 422) return "Please review the highlighted fields and try again.";
  if (status === 429) return "Too many attempts. Please wait a moment and try again.";
  if (status >= 500) return "Something went wrong on our side. Please try again shortly.";
  return "Something went wrong. Please try again.";
}

/* --------------------------------------------------------------------------
   Static fallback (catalogue only). Reviews are never faked.
   -------------------------------------------------------------------------- */
let fallbackCache = null;
async function staticCatalogue() {
  if (fallbackCache) return fallbackCache;
  const response = await fetch(new URL(CONFIG.staticFallback, document.baseURI).toString(), { cache: "no-store" });
  if (!response.ok) throw new ApiError("Demo catalogue unavailable", { status: response.status });
  fallbackCache = await response.json();
  return fallbackCache;
}

/**
 * Look up a single record in the bundled catalogue by id or slug.
 * Used when the API is unreachable or not mounted (e.g. a plain static host).
 */
async function staticLookup(collection, key) {
  const catalogue = await staticCatalogue();
  const items = catalogue?.[collection];
  if (!Array.isArray(items)) return null;
  const wanted = String(key);
  return items.find((item) => String(item.id) === wanted || String(item.slug) === wanted) || null;
}

/**
 * Resolve a single record, falling back to the bundled catalogue so the
 * storefront keeps working when the API is missing (static host) or offline.
 */
async function lookupWithFallback(path, collection, key, fallbackMessage) {
  try {
    const data = await request(path, { dedupe: true });
    const record = data?.product || data?.post || data;
    if (record && record.id) return record;
    throw new ApiError(fallbackMessage, { status: 404 });
  } catch (error) {
    if (error instanceof ApiError && error.status >= 500) throw error;
    const record = await staticLookup(collection, key).catch(() => null);
    if (record) return record;
    throw error;
  }
}

async function withFallback(loader, fallbackValue) {
  try {
    return await loader();
  } catch (error) {
    if (!CONFIG.fallbackEnabled || !(error instanceof ApiError) || !error.isOffline) throw error;
    if (fallbackValue !== undefined) return fallbackValue;
    const catalogue = await staticCatalogue();
    return catalogue;
  }
}

/* --------------------------------------------------------------------------
   Currency
   -------------------------------------------------------------------------- */
const DEFAULT_CURRENCIES = [
  { code: "USD", symbol: "$", name: "US Dollar", rate: 1, locale: "en-US", decimals: 2 },
  { code: "NGN", symbol: "\u20A6", name: "Nigerian Naira", rate: 1550, locale: "en-NG", decimals: 2 },
  { code: "GBP", symbol: "\u00A3", name: "Pound Sterling", rate: 0.79, locale: "en-GB", decimals: 2 },
  { code: "EUR", symbol: "\u20AC", name: "Euro", rate: 0.92, locale: "en-IE", decimals: 2 },
  { code: "ZAR", symbol: "R", name: "South African Rand", rate: 18.2, locale: "en-ZA", decimals: 2 },
  { code: "KES", symbol: "KSh", name: "Kenyan Shilling", rate: 129, locale: "en-KE", decimals: 2 },
  { code: "GHS", symbol: "GH\u20B5", name: "Ghanaian Cedi", rate: 15.6, locale: "en-GH", decimals: 2 }
];

export const DEFAULT_COUNTRIES = [
  { code: "NG", name: "Nigeria", currency: "NGN" },
  { code: "US", name: "United States", currency: "USD" },
  { code: "GB", name: "United Kingdom", currency: "GBP" },
  { code: "IE", name: "Ireland", currency: "EUR" },
  { code: "ZA", name: "South Africa", currency: "ZAR" },
  { code: "KE", name: "Kenya", currency: "KES" },
  { code: "GH", name: "Ghana", currency: "GHS" },
  { code: "OT", name: "Rest of world", currency: "USD" }
];

let runtimeConfig = null;
export function setRuntimeConfig(config) { runtimeConfig = config; }
export function getRuntimeConfig() { return runtimeConfig; }
export function getCurrencies() { return runtimeConfig?.currencies?.length ? runtimeConfig.currencies : DEFAULT_CURRENCIES; }
export function getCountries() { return runtimeConfig?.countries?.length ? runtimeConfig.countries : DEFAULT_COUNTRIES; }

export function getCurrencyCode() {
  const stored = storage.get(CONFIG.currencyKey);
  const codes = getCurrencies().map((c) => c.code);
  if (stored && codes.includes(stored)) return stored;
  const country = getCountryCode();
  const match = getCountries().find((c) => c.code === country);
  return match?.currency && codes.includes(match.currency) ? match.currency : (runtimeConfig?.defaultCurrency || "USD");
}
export function setCurrencyCode(code) { storage.set(CONFIG.currencyKey, code); }
export function getCurrency() {
  const code = getCurrencyCode();
  return getCurrencies().find((c) => c.code === code) || DEFAULT_CURRENCIES[0];
}
export function getCountryCode() {
  return storage.get(CONFIG.countryKey) || runtimeConfig?.defaultCountry || "US";
}
export function setCountryCode(code) { storage.set(CONFIG.countryKey, code); }

/**
 * Format an amount that is stored in the store base currency (USD).
 * Falls back to a manual format if Intl is unavailable.
 */
export function formatMoney(amountBase, { currency = getCurrencyCode(), decimals } = {}) {
  const info = getCurrencies().find((c) => c.code === currency) || DEFAULT_CURRENCIES[0];
  const value = Number(amountBase || 0) * Number(info.rate || 1);
  const places = decimals === undefined ? info.decimals : decimals;
  try {
    return new Intl.NumberFormat(info.locale || "en-NG", {
      style: "currency",
      currency: info.code,
      minimumFractionDigits: places,
      maximumFractionDigits: places
    }).format(value);
  } catch (error) {
    return `${info.symbol}${value.toFixed(places)}`;
  }
}

/* --------------------------------------------------------------------------
   Endpoints
   -------------------------------------------------------------------------- */
export const api = {
  config: () => withFallback(() => request("config", { dedupe: true }), null)
    .then(async (config) => {
      if (config) { setRuntimeConfig(config); return config; }
      const catalogue = await staticCatalogue();
      setRuntimeConfig(catalogue.config);
      return catalogue.config;
    }),

  products: {
    list: (params = {}) => withFallback(() => request("products", { params, dedupe: true }))
      .then((data) => normalizeCollection(data, "products")),
    get: (id) => lookupWithFallback(
      `products/${encodeURIComponent(id)}`,
      "products",
      id,
      "We could not find that product."
    ),
    reviews: (id) => withFallback(
      () => request(`products/${encodeURIComponent(id)}/reviews`, { dedupe: true })
        .then((data) => normalizeCollection(data, "reviews")),
      { items: [], total: 0, page: 1, perPage: 0, source: "offline" }
    ),
    filters: () => withFallback(
      () => request("products/filters", { dedupe: true }),
      { collections: [], priceMin: 0, priceMax: 0 }
    )
  },

  blog: {
    list: (params = {}) => withFallback(() => request("blog", { params, dedupe: true }))
      .then((data) => normalizeCollection(data, "posts")),
    get: (slug) => lookupWithFallback(
      `blog/${encodeURIComponent(slug)}`,
      "posts",
      slug,
      "We could not find that article."
    )
  },

  discounts: {
    validate: (code, subtotal) => request("discounts/validate", { method: "POST", body: { code, subtotal } })
  },

  newsletter: {
    subscribe: (email) => request("newsletter", { method: "POST", body: { email } })
  },

  contact: {
    send: (payload) => request("contact", { method: "POST", body: payload })
  },

  adverseReaction: {
    send: (payload) => request("adverse-reactions", { method: "POST", body: payload })
  },

  affiliate: {
    apply: (payload) => request("affiliates", { method: "POST", body: payload })
  },

  orders: {
    list: () => request("orders", { auth: true }),
    create: (payload) => request("orders", { method: "POST", body: payload, auth: true }),
    get: (id) => request(`orders/${encodeURIComponent(id)}`, { auth: true })
  },

  auth: {
    login: (email, password) => request("auth/login", { method: "POST", body: { email, password } }),
    register: (payload) => request("auth/register", { method: "POST", body: payload }),
    me: () => request("auth/me", { auth: true })
  },

  account: {
    update: (payload) => request("account", { method: "PATCH", body: payload, auth: true })
  }
};

function normalizeCollection(data, key) {
  if (Array.isArray(data)) return { items: data, total: data.length, page: 1, perPage: data.length, facets: null };
  if (data && typeof data === "object") {
    const items = data.items || data[key] || data.results || [];
    return {
      items: Array.isArray(items) ? items : [],
      total: Number(data.total ?? items.length ?? 0),
      page: Number(data.page ?? 1),
      perPage: Number(data.perPage ?? data.pageSize ?? items.length ?? 0),
      facets: data.facets || null,
      notice: data.notice || null
    };
  }
  return { items: [], total: 0, page: 1, perPage: 0, facets: null };
}

/* --------------------------------------------------------------------------
   Small helpers used across pages
   -------------------------------------------------------------------------- */
export function productImage(product, index = 0) {
  const images = product?.images || [];
  const image = images[index] || images[0];
  if (!image) return { src: "assets/img/product-single.jpg", alt: product?.name || "Product image" };
  return typeof image === "string" ? { src: image, alt: product?.name || "Product image" } : image;
}

export function discountPercent(product) {
  if (!product?.compareAt || product.compareAt <= product.price) return 0;
  return Math.round(((product.compareAt - product.price) / product.compareAt) * 100);
}

export function isInStock(product) {
  if (typeof product?.inStock === "boolean") return product.inStock;
  return Number(product?.stockQty ?? 1) > 0;
}
