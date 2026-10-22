// Not part of the site: never deploy the brand/ folder. Needs the site on http://localhost:4350 (launch config "uncatchable").
// Example: EVAL="document.getElementById('pack').click()" SEL="#packs" node brand/shot.mjs http://localhost:4350/ out/pack 1440x900 375x812
// Full-page screenshots of a URL with headless Chrome over CDP.
// Usage: node shot.mjs <url> <out-prefix> <width>x<height> [<width>x<height> ...]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, prefix, ...sizes] = process.argv.slice(2);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9361;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmpdir(), 'unc-shot')}`,
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

let ws;
for (let i = 0; i < 100 && !ws; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch { await sleep(100); }
}
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
for (const size of sizes) {
  const [w, h] = size.split('x').map(Number);
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await send('Page.navigate', { url });
  await sleep(2500);
  await send('Runtime.evaluate', { expression: "document.querySelectorAll('.reveal').forEach(e=>e.classList.add('in')); document.querySelectorAll('img[loading=lazy]').forEach(i=>i.loading='eager'); 1" });
  await sleep(1500);
  // EVAL: script to run before the capture; SEL: capture only this element
  if (process.env.EVAL) { await send('Runtime.evaluate', { expression: process.env.EVAL }); await sleep(4000); }
  const { result } = await send('Runtime.evaluate', { expression: 'JSON.stringify([document.documentElement.scrollWidth, document.documentElement.scrollHeight])', returnByValue: true });
  const [sw, sh] = JSON.parse(result.result.value);
  let clip = { x: 0, y: 0, width: w, height: sh, scale: 1 };
  if (process.env.SEL) {
    const r = await send('Runtime.evaluate', { expression: `JSON.stringify((()=>{const b=document.querySelector(${JSON.stringify(process.env.SEL)}).getBoundingClientRect();return [b.left+scrollX,b.top+scrollY,b.width,b.height]})())`, returnByValue: true });
    const [x, y, cw, ch] = JSON.parse(r.result.result.value);
    clip = { x, y, width: cw, height: ch, scale: 1 };
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
  const file = `${prefix}-${w}.png`;
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  console.log(file, `scroll ${sw}x${sh}`);
}
ws.close();
chrome.kill();
