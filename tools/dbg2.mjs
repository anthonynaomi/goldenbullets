import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import crypto from "node:crypto";
const PORT = 9336;
const dir = mkdtempSync(join(tmpdir(), "gbdbg2-"));
const args = [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions",
  "about:blank"
];
if (process.argv[2]) args.unshift(process.argv[2]);
const chrome = spawn("C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", args, { stdio: "ignore" });
const delay = (ms) => new Promise(r => setTimeout(r, ms));
let ver=null; for (let i=0;i<60;i++){ try { const r=await fetch(`http://127.0.0.1:${PORT}/json/list`); if(r.ok){ver=await r.json();break;} }catch(e){} await delay(250); }
const t = ver.find(x=>x.type==="page");
const u = new URL(t.webSocketDebuggerUrl);
function rawHandshake(path, headers) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString("base64");
    const s = net.connect(Number(u.port), u.hostname, () => {
      let req = `GET ${path} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n`;
      for (const [k,v] of Object.entries(headers||{})) req += `${k}: ${v}\r\n`;
      req += "\r\n";
      s.write(req);
    });
    let buf = "";
    s.on("data", (d)=>{ buf += d.toString("latin1"); if (buf.includes("\r\n\r\n")) { resolve(buf.split("\r\n\r\n")[0]); s.destroy(); } });
    s.on("error", (e)=>resolve("ERR "+e.message));
    setTimeout(()=>{ resolve("TIMEOUT\n"+buf.slice(0,300)); s.destroy(); }, 4000);
  });
}
console.log("=== no Origin ===");
console.log(await rawHandshake(u.pathname, {}));
console.log("=== Origin http://localhost ===");
console.log(await rawHandshake(u.pathname, { Origin: "http://localhost" }));
chrome.kill(); process.exit(0);
