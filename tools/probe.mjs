/* Golden Bullet - probe: evaluate a JS expression (from a file) on a page */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const BASE = process.env.GB_BASE || "http://127.0.0.1:4174";
const PAGE = process.env.GB_PAGE || "/index.html";
const EXPR = readFileSync(process.env.GB_EXPR || "_probe.js", "utf8");
const PORT = 9342;
const CHROME = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";
const dir = mkdtempSync(join(tmpdir(), "gb-probe-"));
const chrome = spawn(CHROME, ["--headless=new","--no-sandbox","--in-process-gpu","--disable-dev-shm-usage","--remote-allow-origins=*","--disable-gpu","--disable-extensions",`--remote-debugging-port=${PORT}`,`--user-data-dir=${dir}`,"--no-first-run","--no-default-browser-check","--hide-scrollbars","about:blank"], { stdio: "ignore" });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(){ for(let i=0;i<80;i++){ try{ const r=await fetch(`http://127.0.0.1:${PORT}/json/version`); if(r.ok) return; }catch(e){} await delay(250);} throw new Error("no chrome"); }
class Cdp { constructor(ws){ this.ws=ws; this.id=0; this.p=new Map();
  ws.addEventListener("message",(ev)=>{ const m=JSON.parse(ev.data); if(m.id&&this.p.has(m.id)){ const q=this.p.get(m.id); this.p.delete(m.id); m.error?q.reject(new Error(m.error.message)):q.resolve(m.result);} }); }
  send(method,params){ this.id+=1; const id=this.id; return new Promise((res,rej)=>{ this.p.set(id,{resolve:res,reject:rej}); this.ws.send(JSON.stringify({id,method,params:params||{}})); setTimeout(()=>{ if(this.p.has(id)){this.p.delete(id); rej(new Error("timeout "+method));} },30000); }); } }
async function main(){
  await up();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const t = list.find((x)=>x.type==="page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ ws.addEventListener("open",res); ws.addEventListener("error",rej); });
  const cdp = new Cdp(ws);
  await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: 'try{localStorage.setItem("gb.ageOk","true");localStorage.setItem("gb.cookieOk",JSON.stringify({choice:"accepted"}));localStorage.setItem("gb.announceClosed","1");}catch(e){}' });
  await cdp.send("Page.navigate", { url: BASE + PAGE });
  await delay(2200);
  const r = await cdp.send("Runtime.evaluate", { expression: `(function(){ try { return JSON.stringify((` + EXPR + `)); } catch(e){ return JSON.stringify({__error:String(e)}); } })()`, returnByValue: true, awaitPromise: true });
  console.log(r.result.value);
  ws.close(); chrome.kill(); try{ rmSync(dir,{recursive:true,force:true}); }catch(e){}
  process.exit(0);
}
main().catch((e)=>{ console.error("probe failed:", e.message); chrome.kill(); process.exit(1); });
