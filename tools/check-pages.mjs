/* ==========================================================================
   Golden Bullet - headless page checker
   --------------------------------------------------------------------------
   Drives headless Chrome over CDP (no npm dependencies) and reports, for each
   page: uncaught exceptions, console errors, failed network requests and a few
   structural assertions.

   Usage:  node tools/check-pages.mjs [baseUrl]
   ========================================================================== */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:4173";
const PORT = 9333;
const CHROME = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";

const userDataDir = mkdtempSync(join(tmpdir(), "gb-check-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--no-sandbox",
  "--in-process-gpu",
  "--disable-dev-shm-usage",
  "--remote-allow-origins=*",
  "--disable-gpu",
  "--disable-extensions",
  "--window-size=1440,1000",
  "about:blank"
], { stdio: "ignore" });

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForBrowser() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch (error) { /* not up yet */ }
    await delay(250);
  }
  throw new Error("Chrome did not expose a debugging endpoint in time");
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      const list = this.handlers.get(msg.method) || [];
      list.forEach((fn) => fn(msg.params, msg.sessionId));
    });
  }
  on(method, fn) {
    const list = this.handlers.get(method) || [];
    list.push(fn);
    this.handlers.set(method, list);
  }
  send(method, params, sessionId) {
    this.id += 1;
    const payload = { id: this.id, method, params: params || {} };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(this.id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(payload.id)) {
          this.pending.delete(payload.id);
          reject(new Error("CDP timeout for " + method));
        }
      }, 20000);
    });
  }
  close() { try { this.ws.close(); } catch (error) { /* ignore */ } }
}

const RESULTS = [];
function record(page, problems, checks) {
  RESULTS.push({ page, problems, checks });
}

async function main() {
  await waitForBrowser();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pageTarget = targets.find((target) => target.type === "page");
  if (!pageTarget) throw new Error("No page target is available to drive");
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  const cdp = new Cdp(ws);
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");

  const state = { consoleErrors: [], exceptions: [], failedRequests: [] };
  cdp.on("Runtime.consoleAPICalled", (params) => {
    if (params.type !== "error" && params.type !== "warning") return;
    const text = (params.args || []).map((arg) => arg.value !== undefined ? String(arg.value) : (arg.description || arg.type)).join(" ");
    if (params.type === "error") state.consoleErrors.push(text);
  });
  cdp.on("Runtime.exceptionThrown", (params) => {
    const details = params.exceptionDetails || {};
    state.exceptions.push(details.exception?.description || details.text || "unknown exception");
  });
  cdp.on("Log.entryAdded", (params) => {
    const entry = params.entry || {};
    if (entry.level === "error") state.consoleErrors.push(entry.text + (entry.url ? " (" + entry.url + ")" : ""));
  });
  cdp.on("Network.loadingFailed", (params) => {
    if (params.blockedReason || params.canceled) return;
    state.failedRequests.push((params.errorText || "failed") + " " + (params.type || ""));
  });

  async function evaluate(expression) {
    const result = await cdp.send("Runtime.evaluate", {
      expression: "(async function(){ try { return JSON.stringify(await (" + expression + ")); } catch (e) { return JSON.stringify({ __error: String(e) }); } })()",
      returnByValue: true,
      awaitPromise: true
    });
    const value = result?.result?.value;
    return value ? JSON.parse(value) : null;
  }

  async function goto(url, { wait = 1400, reset = true } = {}) {
    if (reset) { state.consoleErrors = []; state.exceptions = []; state.failedRequests = []; }
    await cdp.send("Page.navigate", { url });
    await delay(wait);
  }
  /* ---- 1. Age gate blocks a brand new visitor ---------------------------- */
  await goto(BASE + "/index.html", { wait: 1200 });
  const gateOnFirstVisit = await evaluate(`({
    gateVisible: !document.getElementById("gb-age-gate").hasAttribute("hidden"),
    locked: document.documentElement.getAttribute("data-gb-age-locked") === "true",
    mainInert: document.querySelector("main").hasAttribute("inert"),
    focusInsideGate: Boolean(document.activeElement && document.activeElement.closest("#gb-age-gate"))
  })`);
  record("index.html (first visit: age gate)", state.exceptions.concat(state.consoleErrors), [gateOnFirstVisit]);

  /* ---- 2. Confirm age, then check every page ----------------------------- */
  await evaluate(`localStorage.setItem("gb.ageOk", "true")`);

  const expectations = [
    ["index.html", `({ page: document.body.dataset.page, cards: document.querySelectorAll("#featured-products .gb-product-card").length, reviewsHidden: document.getElementById("reviews-section").hidden, posts: document.querySelectorAll("#latest-posts .gb-post-card").length, hasH1: !!document.querySelector("h1"), footerNotice: !!document.querySelector(".gb-footer__disclaimer") })`],
    ["shop.html", `({ cards: document.querySelectorAll("#product-grid .gb-product-card").length, count: document.querySelector("[data-results-count]").textContent.trim(), facetPacks: document.querySelectorAll("[data-facet-packs] input").length, h1: document.querySelector("h1").textContent.trim() })`],
    ["product.html?id=golden-bullet-380-single-pack", `({ title: document.querySelector("#product-detail h1")?.textContent.trim(), buy: !!document.querySelector("#product-detail [data-add-to-cart]"), tabs: document.querySelectorAll("#product-tabs [role=tab]").length, ingredientItems: document.querySelectorAll("#panel-ingredients li").length, warningItems: document.querySelectorAll("#panel-warnings li").length, facts: document.querySelectorAll(".gb-product-facts .gb-fact").length, registration: document.body.innerHTML.includes("[REGISTRATION NO. PLACEHOLDER]"), reviewsHidden: document.getElementById("product-reviews").hidden, related: document.querySelectorAll("#related-products .gb-product-card").length })`],
    ["cart.html", `({ empty: document.querySelector("[data-cart-items] .gb-state")?.textContent.includes("empty") })`],
    ["checkout.html", `({ emptyState: document.querySelector(".gb-checkout-layout .gb-state")?.textContent.includes("empty") })`],
    ["login.html", `({ form: !!document.getElementById("login-form"), h1: document.querySelector("h1").textContent.trim() })`],
    ["register.html", `({ dob: !!document.querySelector('input[name="dob"]'), strength: !!document.querySelector("[data-strength-bar]"), h1: document.querySelector("h1").textContent.trim() })`],
    ["blog.html", `({ posts: document.querySelectorAll("#blog-posts .gb-post-card").length, status: document.querySelector("[data-blog-status]").textContent.trim() })`],
    ["blog-post.html?slug=how-to-read-a-supplement-label", `({ title: document.querySelector("#post-root h1")?.textContent.trim(), blocks: document.querySelectorAll(".gb-article__body p").length, notice: document.querySelector("#post-root .gb-notice") !== null })`],
    ["contact.html", `({ form: !!document.getElementById("contact-form"), h1: document.querySelector("h1").textContent.trim() })`],
    ["affiliate.html", `({ form: !!document.getElementById("affiliate-form"), h1: document.querySelector("h1").textContent.trim() })`],
    ["faq.html", `({ items: document.querySelectorAll("#faq-page .gb-accordion__item").length })`],
    ["safety-information.html", `({ form: !!document.getElementById("adverse-reaction-form"), sections: document.querySelectorAll(".gb-prose h2").length, notice: document.body.innerHTML.includes("nitrate medication") })`],
    ["privacy-policy.html", `({ sections: document.querySelectorAll(".gb-prose h2").length, toc: document.querySelectorAll(".gb-toc li").length })`],
    ["terms.html", `({ sections: document.querySelectorAll(".gb-prose h2").length })`],
    ["refund-policy.html", `({ sections: document.querySelectorAll(".gb-prose h2").length })`],
    ["shipping-policy.html", `({ sections: document.querySelectorAll(".gb-prose h2").length })`],
    ["404.html", `({ code: document.querySelector(".gb-404__code")?.textContent.trim() })`],
    ["account.html", `({ redirectedToLogin: location.pathname.endsWith("login.html"), search: location.search })`]
  ];

  for (const [target, expression] of expectations) {
    await goto(BASE + "/" + target);
    const result = await evaluate(expression);
    const problems = state.exceptions.slice();
    state.consoleErrors.forEach((message) => {
      // Ignore 404 network noise from the deliberately-missing endpoint test.
      problems.push("console.error: " + message);
    });
    state.failedRequests.forEach((message) => problems.push("request failed: " + message));
    record(target, problems, [result]);
  }

  /* ---- 3. Cart flow: add to bag from a product page ---------------------- */
  await evaluate(`localStorage.removeItem("gb.cart")`);
  await goto(BASE + "/product.html?id=golden-bullet-380-3-pack", { wait: 1600 });
  await evaluate(`document.querySelector("#product-detail [data-add-to-cart]").click()`);
  await delay(1500);
  const cartFlow = await evaluate(`({
    badge: document.querySelector("[data-cart-count]").textContent.trim(),
    badgeHidden: document.querySelector("[data-cart-count]").hidden,
    drawerOpen: document.getElementById("gb-cart-drawer").dataset.open,
    drawerItems: document.querySelectorAll("#gb-cart-drawer [data-id]").length,
    drawerTotal: document.querySelector("#gb-cart-drawer [data-cart-drawer-foot]").textContent.replace(/\\s+/g, " ").trim().slice(0, 120),
    stored: JSON.parse(localStorage.getItem("gb.cart") || "{}").items?.length || 0
  })`);
  record("cart flow (add to bag)", state.exceptions.concat(state.consoleErrors), [cartFlow]);

  /* ---- 4. Cart page renders the stored line ----------------------------- */
  await goto(BASE + "/cart.html", { wait: 1200 });
  const cartPage = await evaluate(`({
    rows: document.querySelectorAll("[data-cart-items] [data-id]").length,
    summary: document.querySelector("[data-cart-summary]").textContent.replace(/\\s+/g, " ").trim().slice(0, 160)
  })`);
  record("cart.html (with item)", state.exceptions.concat(state.consoleErrors), [cartPage]);

  /* ---- 5. Checkout with an item in the bag ----------------------------- */
  await goto(BASE + "/checkout.html", { wait: 1200 });
  const checkout = await evaluate(`({
    form: !!document.getElementById("checkout-form"),
    summaryRows: document.querySelectorAll("[data-checkout-summary] .gb-order-line").length,
    totals: document.querySelector("[data-checkout-totals]").textContent.replace(/\\s+/g, " ").trim().slice(0, 140),
    prescriptionHidden: document.querySelector("[data-prescription-field]").hidden,
    ageConfirm: !!document.querySelector('[name="ageConfirm"]'),
    heading: document.querySelector('[name="prescription"]')?.disabled === true
  })`);
  record("checkout.html (with item)", state.exceptions.concat(state.consoleErrors), [checkout]);

  /* ---- 6. Shop filtering and search ------------------------------------- */
  await goto(BASE + "/shop.html", { wait: 1400 });
  const shopInteraction = await evaluate(`(async () => {
    const input = document.querySelector("[data-shop-search]");
    input.value = "6 tablet";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const afterSearch = document.querySelectorAll("#product-grid .gb-product-card").length;
    const reset = document.querySelector("[data-filter-form] button[type=reset]");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    reset.click();
    await new Promise((r) => setTimeout(r, 700));
    return { afterSearch, afterReset: document.querySelectorAll("#product-grid .gb-product-card").length, url: location.search };
  })()`);
  record("shop.html (search + reset)", state.exceptions.concat(state.consoleErrors), [shopInteraction]);

  /* ---- 7. Discount code on the cart ------------------------------------- */
  await goto(BASE + "/cart.html", { wait: 1200 });
  const discount = await evaluate(`(async () => {
    const form = document.querySelector("[data-discount-form]");
    form.querySelector('input[name="code"]').value = "GOLDEN15";
    form.requestSubmit();
    await new Promise((r) => setTimeout(r, 1200));
    return {
      status: form.querySelector("[data-discount-status]").textContent.trim(),
      banner: document.querySelector("[data-discount-applied]").textContent.replace(/\\s+/g, " ").trim().slice(0, 80),
      summary: document.querySelector("[data-cart-summary]").textContent.replace(/\\s+/g, " ").trim().slice(0, 200)
    };
  })()`);
  record("cart.html (discount code)", state.exceptions.concat(state.consoleErrors), [discount]);

  /* ---- Report ---------------------------------------------------------- */
  let failures = 0;
  console.log("");
  for (const result of RESULTS) {
    const bad = result.problems.length > 0;
    if (bad) failures += 1;
    console.log((bad ? "FAIL  " : "ok    ") + result.page);
    console.log("        " + JSON.stringify(result.checks[0]));
    result.problems.forEach((problem) => console.log("        ! " + problem));
  }
  console.log("");
  console.log(failures === 0 ? "All pages loaded cleanly." : failures + " page(s) reported problems.");

  cdp.close();
  chrome.kill();
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch (error) { /* ignore */ }
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch(async (error) => {
  console.error("Checker failed:", error.message);
  chrome.kill();
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  process.exitCode = 1;
});