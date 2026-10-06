import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import crypto from "node:crypto";
const PORT = 9337;
const dir = mkdtempSync(join(tmpdir(), "gbdbg3-"));
const chrome = spawn("C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions", "about:blank"
], { stdio: "ignore" });
const delay = (ms) => new Promise(r => setTimeout(r, ms));
let list=null; for (let i=0;i<60;i++){ try { const r=await fetch(`http://127.0.0.1:${PORT}/json/list`); if(r.ok){list=await r.json();break;} }catch(e){} await delay(250); }
const t = list.find(x=>x.type==="page");
const u = new URL(t.webSocketDebuggerUrl);
const sock = net.connect(Number(u.port), u.hostname);
const key = crypto.randomBytes(16).toString("base64");
await new Promise(res=>sock.on("connect",res));
sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
let buffered = Buffer.alloc(0); let handshook=false; let acc="";
const frames=[];
sock.on("data",(d)=>{ buffered = Buffer.concat([buffered,d]);
  if(!handshook){ const i = buffered.indexOf("\r\n\r\n"); if(i>=0){ handshook=true; buffered=buffered.subarray(i+4); } else return; }
  let b = buffered;
  while(b.length>=2){ const fin=b[0]&0x80, op=b[0]&0x0f; let len=b[1]&0x7f; let off=2;
    if(len===126){ len=b.readUInt16BE(2); off=4; } else if(len===127){ len=Number(b.readBigUInt64BE(2)); off=10; }
    if(b.length<off+len) break;
    const payload=b.subarray(off,off+len); b=b.subarray(off+len);
    if(op===1||op===2) frames.push(payload.toString("utf8"));
    if(op===8){ console.log("CLOSE FRAME"); }
  }
  buffered=b;
  while(frames.length){ console.log("FRAME:", frames.shift().slice(0,400)); }
});
function send(str){ const data=Buffer.from(str,"utf8"); const mask=crypto.randomBytes(4); let header;
  if(data.length<126){ header=Buffer.from([0x81, 0x80|data.length]); }
  else { header=Buffer.alloc(4); header[0]=0x81; header[1]=0x80|126; header.writeUInt16BE(data.length,2); }
  const masked=Buffer.alloc(data.length); for(let i=0;i<data.length;i++) masked[i]=data[i]^mask[i%4];
  sock.write(Buffer.concat([header,mask,masked])); }
await delay(500);
send(JSON.stringify({id:1,method:"Runtime.enable",params:{}}));
await delay(1500);
send(JSON.stringify({id:2,method:"Browser.getVersion",params:{}}));
await delay(1500);
sock.destroy(); chrome.kill(); process.exit(0);
