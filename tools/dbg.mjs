import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const PORT = 9335;
const dir = mkdtempSync(join(tmpdir(), "gbdbg-"));
const chrome = spawn("C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions",
  "--remote-allow-origins=*", "about:blank"
], { stdio: "ignore" });
const delay = (ms) => new Promise(r => setTimeout(r, ms));
let ver = null;
for (let i=0;i<60;i++){ try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok){ ver = await r.json(); break; } } catch(e){} await delay(250); }
console.log("VERSION:", ver && ver.Browser);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
console.log("TARGETS:", list.map(t=>`${t.type}:${t.url}`).join(" | "));
const t = list.find(x=>x.type==="page");
console.log("WSURL:", t && t.webSocketDebuggerUrl);
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej)=>{ ws.addEventListener("open",()=>{console.log("WS OPEN");res();}); ws.addEventListener("error",(e)=>rej(new Error("WS ERROR "+ (e.message||e.type)))); });
ws.addEventListener("message",(e)=>console.log("MSG:", String(e.data).slice(0,300)));
ws.addEventListener("close",(e)=>console.log("WS CLOSE", e.code, e.reason));
ws.send(JSON.stringify({id:1, method:"Runtime.enable", params:{}}));
await delay(4000);
try { ws.send(JSON.stringify({id:2, method:"Browser.getVersion", params:{}})); } catch(e){ console.log("send2 err", e.message); }
await delay(2000);
chrome.kill();
process.exit(0);
