/* ==========================================================================
   Golden Bullet - local development server
   --------------------------------------------------------------------------
   Zero dependencies. Serves /frontend as static files and exposes a small
   mock API under /api so the storefront can be developed and reviewed without
   a backend.

   IMPORTANT
   - This is a development mock, not production code.
   - Signing secrets, user records and orders live in memory and are reset on
     every restart.
   - GET /api/products/:id/reviews returns an empty list on purpose. Reviews
     must come from the real, verified-purchase source; the storefront hides
     the testimonials section when the list is empty.
   ========================================================================== */

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "frontend");
const DATA_FILE = path.join(PUBLIC_DIR, "data", "catalog.json");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const JWT_SECRET = process.env.GB_DEV_JWT_SECRET || "golden-bullet-dev-secret";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

/* --------------------------------------------------------------------------
   Data
   -------------------------------------------------------------------------- */
let catalogue = null;

async function loadCatalogue() {
  const raw = await fsp.readFile(DATA_FILE, "utf8");
  catalogue = JSON.parse(raw);
  return catalogue;
}

function getCatalogue() {
  if (!catalogue) throw new Error("Catalogue has not been loaded yet");
  return catalogue;
}

/* In-memory development state */
const users = new Map();
const orders = new Map();
const newsletter = new Set();
const submissions = { contact: [], adverse: [], affiliates: [] };
/* --------------------------------------------------------------------------
   Small helpers
   -------------------------------------------------------------------------- */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendError(res, status, message, code, details) {
  sendJson(res, status, { error: message, code: code || "error", details: details || null });
}

async function readJsonBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (error) { reject(Object.assign(new Error("Request body must be valid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

/* --------------------------------------------------------------------------
   Development JWT (HS256). Replaced by the real auth service in production.
   -------------------------------------------------------------------------- */
function base64Url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signToken(payload, ttlSeconds = 60 * 60 * 24) {
  const header = { alg: "HS256", typ: "JWT" };
  const body = Object.assign({}, payload, {
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    iss: "golden-bullet-dev"
  });
  const unsigned = base64Url(JSON.stringify(header)) + "." + base64Url(JSON.stringify(body));
  const signature = base64Url(crypto.createHmac("sha256", JWT_SECRET).update(unsigned).digest());
  return unsigned + "." + signature;
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const unsigned = parts[0] + "." + parts[1];
  const expected = base64Url(crypto.createHmac("sha256", JWT_SECRET).update(unsigned).digest());
  if (expected !== parts[2]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (payload.exp && payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

function bearer(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

function requireUser(req, res) {
  const payload = verifyToken(bearer(req));
  if (!payload || !payload.sub) {
    sendError(res, 401, "Please sign in to continue.", "unauthorised");
    return null;
  }
  return payload;
}

/* --------------------------------------------------------------------------
   Validation helpers shared by the form endpoints
   -------------------------------------------------------------------------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function isEmail(value) { return EMAIL_RE.test(String(value || "").trim()); }

function isAdult(dob) {
  const raw = String(dob || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const date = new Date(raw + "T00:00:00Z");
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const month = now.getUTCMonth() - date.getUTCMonth();
  if (month < 0 || (month === 0 && now.getUTCDate() < date.getUTCDate())) age -= 1;
  return age >= 18;
}

function reference(prefix) {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(2).toString("hex").toUpperCase();
  return prefix + "-" + stamp + random;
}
/* --------------------------------------------------------------------------
   Catalogue queries
   -------------------------------------------------------------------------- */
function publicProduct(product) {
  return product;
}

function listProducts(searchParams) {
  const data = getCatalogue();
  const term = String(searchParams.get("q") || "").trim().toLowerCase();
  const featured = searchParams.get("featured");
  const perPage = Math.max(1, Math.min(100, Number(searchParams.get("perPage") || 100)));
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const sort = searchParams.get("sort") || "featured";

  let items = data.products.map(publicProduct);

  if (term) {
    items = items.filter((product) => {
      const haystack = [product.name, product.shortName, product.summary, product.sku]
        .concat(product.tags || []).filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }
  if (featured === "true") items = items.filter((product) => product.featured);

  switch (sort) {
    case "price-asc": items.sort((a, b) => a.price - b.price); break;
    case "price-desc": items.sort((a, b) => b.price - a.price); break;
    case "name-asc": items.sort((a, b) => a.name.localeCompare(b.name)); break;
    default: items.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || a.price - b.price);
  }

  const total = items.length;
  const start = (page - 1) * perPage;
  return {
    items: items.slice(start, start + perPage),
    total,
    page,
    perPage,
    facets: buildFacets(data.products)
  };
}

function buildFacets(products) {
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

function findProduct(id) {
  const data = getCatalogue();
  const needle = String(id || "").toLowerCase();
  return data.products.find((product) => String(product.id).toLowerCase() === needle || String(product.slug).toLowerCase() === needle) || null;
}

/* --------------------------------------------------------------------------
   API routing
   -------------------------------------------------------------------------- */
async function handleApi(req, res, url) {
  const segments = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [first, second, third] = segments;
  const method = req.method || "GET";
  const data = getCatalogue();

  if (first === "health") return sendJson(res, 200, { status: "ok", mode: "development-mock" });

  if (first === "config" && method === "GET") {
    return sendJson(res, 200, data.config);
  }

  if (first === "products" && method === "GET") {
    if (!second) return sendJson(res, 200, listProducts(url.searchParams));
    if (second === "filters") {
      return sendJson(res, 200, Object.assign(buildFacets(data.products), { collections: [] }));
    }
    const product = findProduct(second);
    if (!product) return sendError(res, 404, "We could not find that product.", "not_found");
    if (third === "reviews") {
      // Verified purchase reviews only. The mock has none, so the storefront
      // hides its testimonials section rather than inventing content.
      return sendJson(res, 200, {
        items: [],
        total: 0,
        page: 1,
        perPage: 0,
        note: "No verified reviews have been published for this product yet."
      });
    }
    return sendJson(res, 200, { product });
  }

  if (first === "blog" && method === "GET") {
    if (!second) {
      const posts = data.posts
        .slice()
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
        .map((post) => ({
          id: post.id, slug: post.slug, title: post.title, category: post.category,
          publishedAt: post.publishedAt, readingMinutes: post.readingMinutes,
          image: post.image, excerpt: post.excerpt
        }));
      return sendJson(res, 200, { items: posts, total: posts.length, page: 1, perPage: posts.length });
    }
    const post = data.posts.find((entry) => entry.slug === second || entry.id === second);
    if (!post) return sendError(res, 404, "We could not find that article.", "not_found");
    return sendJson(res, 200, { post });
  }

  if (first === "discounts" && second === "validate" && method === "POST") {
    const body = await readJsonBody(req);
    const code = String(body.code || "").trim().toUpperCase();
    const subtotal = Number(body.subtotal || 0);
    const match = data.config.discountCodes[code];
    if (!match) return sendError(res, 404, "That discount code was not recognised.", "invalid_code");
    if (code === "FREESHIP" && subtotal < 100000) {
      return sendError(res, 422, "This code needs a subtotal of at least " + String(100000) + " to apply.", "min_subtotal");
    }
    return sendJson(res, 200, Object.assign({ code }, match));
  }

  if (first === "newsletter" && method === "POST") {
    const body = await readJsonBody(req);
    if (!isEmail(body.email)) return sendError(res, 422, "Enter a valid email address.", "invalid_email");
    const first_time = !newsletter.has(body.email.toLowerCase());
    newsletter.add(body.email.toLowerCase());
    return sendJson(res, 200, { ok: true, alreadySubscribed: !first_time });
  }

  if (first === "contact" && method === "POST") {
    const body = await readJsonBody(req);
    if (!String(body.name || "").trim()) return sendError(res, 422, "Enter your name.", "invalid_name");
    if (!isEmail(body.email)) return sendError(res, 422, "Enter a valid email address.", "invalid_email");
    if (!String(body.message || "").trim()) return sendError(res, 422, "Tell us how we can help.", "invalid_message");
    submissions.contact.push(Object.assign({ reference: reference("MSG"), at: new Date().toISOString() }, body));
    return sendJson(res, 201, { ok: true, reference: reference("MSG"), message: "Message received. Support replies within one business day." });
  }

  if (first === "adverse-reactions" && method === "POST") {
    const body = await readJsonBody(req);
    if (!isEmail(body.reporterEmail)) return sendError(res, 422, "Enter a valid email address.", "invalid_email");
    const ref = reference("SAE");
    submissions.adverse.push(Object.assign({ reference: ref, at: new Date().toISOString() }, body));
    return sendJson(res, 201, { ok: true, reference: ref });
  }

  if (first === "affiliates" && method === "POST") {
    const body = await readJsonBody(req);
    if (!isEmail(body.email)) return sendError(res, 422, "Enter a valid email address.", "invalid_email");
    const ref = reference("AFF");
    submissions.affiliates.push(Object.assign({ reference: ref, at: new Date().toISOString() }, body));
    return sendJson(res, 201, { ok: true, reference: ref, message: "Application received. Our affiliate team reviews applications within three business days." });
  }
  if (first === "auth") {
    if (second === "register" && method === "POST") {
      const body = await readJsonBody(req);
      if (!String(body.firstName || "").trim()) return sendError(res, 422, "Enter your first name.", "invalid_first_name");
      if (!isEmail(body.email)) return sendError(res, 422, "Enter a valid email address.", "invalid_email");
      if (!isAdult(body.dob)) return sendError(res, 422, "You must be 18 or older to create an account.", "age_restricted");
      if (String(body.password || "").length < 8) return sendError(res, 422, "Choose a password with at least 8 characters.", "weak_password");
      const key = String(body.email).toLowerCase();
      if (users.has(key)) return sendError(res, 409, "An account already exists for that email address.", "email_taken");
      const user = {
        id: reference("USR"),
        firstName: body.firstName || "",
        lastName: body.lastName || "",
        email: key,
        phone: body.phone || "",
        dob: body.dob,
        createdAt: new Date().toISOString(),
        passwordHash: crypto.createHash("sha256").update(String(body.password) + JWT_SECRET).digest("hex")
      };
      users.set(key, user);
      const token = signToken({ sub: user.id, email: user.email });
      return sendJson(res, 201, { token, user: safeUser(user) });
    }

    if (second === "login" && method === "POST") {
      const body = await readJsonBody(req);
      const key = String(body.email || "").toLowerCase();
      const user = users.get(key);
      const hash = crypto.createHash("sha256").update(String(body.password || "") + JWT_SECRET).digest("hex");
      if (!user || user.passwordHash !== hash) {
        return sendError(res, 401, "Those details did not match an account.", "invalid_credentials");
      }
      const token = signToken({ sub: user.id, email: user.email });
      return sendJson(res, 200, { token, user: safeUser(user) });
    }

    if (second === "me" && method === "GET") {
      const payload = requireUser(req, res);
      if (!payload) return;
      const user = Array.from(users.values()).find((entry) => entry.id === payload.sub);
      if (!user) return sendError(res, 404, "Account not found.", "not_found");
      return sendJson(res, 200, { user: safeUser(user) });
    }
  }

  if (first === "account" && method === "PATCH") {
    const payload = requireUser(req, res);
    if (!payload) return;
    const user = Array.from(users.values()).find((entry) => entry.id === payload.sub);
    if (!user) return sendError(res, 404, "Account not found.", "not_found");
    const body = await readJsonBody(req);
    ["firstName", "lastName", "phone"].forEach((field) => {
      if (body[field] !== undefined) user[field] = String(body[field]);
    });
    if (body.email !== undefined) {
      if (!isEmail(body.email)) return sendError(res, 422, "Enter a valid email address.", "invalid_email");
      users.delete(user.email);
      user.email = String(body.email).toLowerCase();
      users.set(user.email, user);
    }
    return sendJson(res, 200, { user: safeUser(user) });
  }

  if (first === "orders") {
    const payload = requireUser(req, res);
    if (!payload) return;

    if (!second && method === "GET") {
      const list = Array.from(orders.values())
        .filter((order) => order.userId === payload.sub)
        .map((order) => ({
          id: order.id,
          reference: order.reference,
          createdAt: order.createdAt,
          status: order.status,
          itemCount: order.items.reduce((sum, item) => sum + Number(item.qty || 0), 0),
          total: order.total,
          currency: order.currency
        }));
      return sendJson(res, 200, { items: list, total: list.length, page: 1, perPage: list.length });
    }

    if (!second && method === "POST") {
      const body = await readJsonBody(req);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return sendError(res, 422, "Your bag is empty.", "empty_cart");
      if (body.ageConfirm !== undefined && body.ageConfirm !== true) {
        return sendError(res, 422, "Confirm that you are 18 or older before ordering.", "age_confirmation_required");
      }
      const products = getCatalogue().products;
      const lines = items.map((item) => {
        const product = products.find((entry) => String(entry.id) === String(item.id));
        if (!product) return null;
        const qty = Math.max(1, Math.min(20, Math.round(Number(item.qty) || 1)));
        return { id: product.id, name: product.name, qty, unitPrice: product.price, lineTotal: product.price * qty };
      }).filter(Boolean);
      if (!lines.length) return sendError(res, 422, "None of the items in your bag are available.", "invalid_items");

      const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      const codes = getCatalogue().config.discountCodes;
      let discountAmount = 0;
      const code = body.discountCode ? String(body.discountCode).toUpperCase() : "";
      if (code && codes[code]) {
        discountAmount = codes[code].type === "percent"
          ? Math.round(subtotal * codes[code].value / 100)
          : Math.min(subtotal, codes[code].value);
      }
      const threshold = Number(getCatalogue().config.freeShippingThreshold || 0);
      const shippingMethod = body.shippingMethod || "standard";
      let shipping = 0;
      if (shippingMethod === "express") shipping = 12;
      else if (subtotal - discountAmount < threshold) shipping = 6;

      const order = {
        id: reference("ORD"),
        reference: reference("GB"),
        userId: payload.sub,
        createdAt: new Date().toISOString(),
        status: "Processing",
        items: lines,
        subtotal,
        discountCode: code || null,
        discountAmount,
        shipping,
        total: Math.max(0, subtotal - discountAmount + shipping),
        currency: body.currency || "USD",
        shippingAddress: {
          firstName: body.firstName || "", lastName: body.lastName || "", email: body.email || "",
          phone: body.phone || "", address1: body.address1 || "", address2: body.address2 || "",
          city: body.city || "", postalCode: body.postalCode || "", country: body.country || ""
        },
        prescriptionAttached: Boolean(body.prescription)
      };
      orders.set(order.id, order);
      return sendJson(res, 201, { order, reference: order.reference });
    }

    if (second && method === "GET") {
      const order = orders.get(second);
      if (!order || order.userId !== payload.sub) return sendError(res, 404, "Order not found.", "not_found");
      return sendJson(res, 200, { order });
    }
  }

  return sendError(res, 404, "Unknown API endpoint: /api/" + segments.join("/"), "unknown_endpoint");
}

function safeUser(user) {
  return {
    id: user.id, firstName: user.firstName, lastName: user.lastName,
    email: user.email, phone: user.phone, createdAt: user.createdAt
  };
}
/* --------------------------------------------------------------------------
   Static file serving
   -------------------------------------------------------------------------- */
function resolveStaticPath(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch (error) { return null; }

  const relative = decoded.replace(/^\/+/, "");
  let target = path.resolve(PUBLIC_DIR, relative);
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) return null;
  return target;
}

async function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }

  let pathname = url.pathname;
  if (pathname.endsWith("/")) pathname += "index.html";

  let target = resolveStaticPath(pathname);
  if (!target) { res.writeHead(400); res.end("Bad request"); return; }

  let stat = await fsp.stat(target).catch(() => null);
  if (stat && stat.isDirectory()) {
    target = path.join(target, "index.html");
    stat = await fsp.stat(target).catch(() => null);
  }
  if (!stat && !path.extname(target)) {
    const withHtml = target + ".html";
    const htmlStat = await fsp.stat(withHtml).catch(() => null);
    if (htmlStat) { target = withHtml; stat = htmlStat; }
  }

  if (!stat || !stat.isFile()) {
    const notFound = path.join(PUBLIC_DIR, "404.html");
    const body = await fsp.readFile(notFound).catch(() => Buffer.from("404 Not Found"));
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : body);
    return;
  }

  const ext = path.extname(target).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const isHtml = ext === ".html";
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Cache-Control": isHtml ? "no-store" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff"
  });
  if (req.method === "HEAD") { res.end(); return; }
  fs.createReadStream(target).pipe(res);
}

/* --------------------------------------------------------------------------
   Server
   -------------------------------------------------------------------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://" + (req.headers.host || HOST));

  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");

  try {
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    const status = error && error.status ? error.status : 500;
    if (res.headersSent) { res.destroy(); return; }
    sendError(res, status, status === 500 ? "Something went wrong on our side." : String(error.message), "server_error");
    if (status === 500) console.error("[golden-bullet] request failed", error);
  }
});

loadCatalogue()
  .then(() => {
    server.listen(PORT, HOST, () => {
      const config = getCatalogue().config;
      console.log("");
      console.log("  Golden Bullet development server");
      console.log("  ---------------------------------");
      console.log("  Storefront : http://" + HOST + ":" + PORT + "/");
      console.log("  Mock API   : http://" + HOST + ":" + PORT + "/api/config");
      console.log("  Catalogue  : " + getCatalogue().products.length + " products, " + getCatalogue().posts.length + " articles");
      console.log("  Currency   : " + config.defaultCurrency + " (static demo rate table)");
      console.log("  Reviews    : served empty on purpose - testimonials stay hidden");
      console.log("");
      console.log("  Press Ctrl+C to stop.");
      console.log("");
    });
  })
  .catch((error) => {
    console.error("Could not load the demo catalogue from " + DATA_FILE);
    console.error(error);
    process.exitCode = 1;
  });
