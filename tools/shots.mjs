/* Golden Bullet - scrolling viewport screenshot capture (CDP, no deps) */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:4173";
const OUT = process.argv[3] || "_shots";
const PORT = 9341;
const MOBILE = process.argv.includes("--mobile");
const CHROME = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";
const userDataDir = mkdtempSync(join(tmpdir(), "gb-shot-"));
mkdirSync(OUT, { recursive: true });

const W = MOBILE ? 390 : 1440;
const H = MOBILE ? 844 : 1000;

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--in-process-gpu", "--disable-dev-shm-usage",
  "--remote-allow-origins=*", "--disable-gpu", "--disable-extensions",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank"
], { stdio: "ignore" });

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForBrowser() {
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return r.json(); } catch (e) {}
    await delay(250);
  }
  throw new Error("chrome not up");
}
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); return; }
      (this.handlers.get(m.method) || []).forEach((fn) => fn(m.params)); }); }
  on(m, fn) { const l = this.handlers.get(m) || []; l.push(fn); this.handlers.set(m, l); }
  send(method, params) { this.id += 1; const id = this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error("timeout " + method)); } }, 30000); }); }
}
async function main() {
  await waitForBrowser();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((t) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new Cdp(ws);
  await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: MOBILE });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: 'try{localStorage.setItem("gb.ageOk","true");localStorage.setItem("gb.cookieOk","{\"choice\":\"accepted\"}");localStorage.setItem("gb.announceClosed","1");}catch(e){}' });

  const shots = [
    ["home", "/index.html"],
    ["shop", "/shop.html"],
    ["product", "/product.html?id=golden-bullet-380-single-pack"],
    ["cart", "/cart.html"],
    ["checkout", "/checkout.html"],
    ["blog", "/blog.html"],
    ["blog-post", "/blog-post.html?slug=how-to-read-a-supplement-label"],
    ["faq", "/faq.html"],
    ["safety", "/safety-information.html"],
    ["login", "/login.html"],
    ["register", "/register.html"],
    ["contact", "/contact.html"],
    ["affiliate", "/affiliate.html"],
    ["404", "/404.html"],
    ["shipping-policy", "/shipping-policy.html"],
    ["refund-policy", "/refund-policy.html"],
    ["privacy-policy", "/privacy-policy.html"],
    ["terms", "/terms.html"],
    ["account", "/account.html"]
  ];
  const only = process.env.GB_SHOT_ONLY;
  const maxSlices = Number(process.env.GB_SHOT_SLICES || 12);
  const suffix = MOBILE ? "-m" : "";
  for (const [name, path] of shots) {
    if (only && only !== name) continue;
    await cdp.send("Page.navigate", { url: BASE + path });
    await delay(1600);
    const metrics = (await cdp.send("Runtime.evaluate", { expression: "JSON.stringify({h: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)})" })).result.value;
    const total = Math.min(JSON.parse(metrics).h, maxSlices * H);
    let i = 0;
    for (let y = 0; y < total; y += H) {
      await cdp.send("Runtime.evaluate", { expression: `window.scrollTo(0, ${y})` });
      await delay(700);
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(OUT, `${name}${suffix}-${i}.png`), Buffer.from(shot.data, "base64"));
      i += 1;
    }
    console.log(`saved ${name}${suffix}: ${i} slice(s)`);
  }
  ws.close(); chrome.kill();
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
}
main().catch((e) => { console.error("shots failed:", e.message); chrome.kill(); process.exit(1); });
