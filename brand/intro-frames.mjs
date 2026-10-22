// Renders frames of the 3D intro at chosen times with headless Chrome (WebGL through SwiftShader) and prints
// console errors. Needs the site on http://localhost:4350 (launch config "uncatchable").
// Usage: node brand/intro-frames.mjs <out-dir> <width>x<height> [t1,t2,...]
// Not part of the site: never deploy the brand/ folder.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [out, size = '1440x900', times = '0.4,1.4,2.4,3.4,4.4,5.2,5.8,6.3,7.0,7.9'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const ORIGIN = process.env.ORIGIN || 'http://localhost:4350';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9363;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(out, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmpdir(), 'unc-intro-chrome')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank'
], { stdio: 'ignore' });

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
  if (m.method === 'Runtime.exceptionThrown') console.log('EXCEPTION', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) console.log('CONSOLE', m.params.type, m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') console.log('LOG', m.params.entry.text, m.params.entry.url || '');
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 600 });
await send('Page.navigate', { url: `${ORIGIN}/?intro=debug` });
let ready = false;
for (let i = 0; i < 150 && !ready; i++) { await sleep(200); ready = await evaluate('!!window.__intro'); }
if (!ready) console.log('intro never became ready');
for (const t of times.split(',').map(Number)) {
  await evaluate(`window.__intro && window.__intro.seek(${t})`);
  await sleep(150);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const file = join(out, `t${t.toFixed(1)}-${W}.png`);
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
}
console.log('frames written to', out);
ws.close();
chrome.kill();
