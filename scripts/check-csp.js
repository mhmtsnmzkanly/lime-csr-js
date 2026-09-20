import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { promisify } from 'node:util';
import { URL } from 'node:url';

const candidates = process.env.CHROMIUM_BIN
  ? [process.env.CHROMIUM_BIN]
  : ['chromium', 'chromium-browser', 'google-chrome'];
const browser = candidates.find(binary => spawnSync(binary, ['--version']).status === 0);
assert.ok(browser, 'Install Chromium/Chrome or set CHROMIUM_BIN to run the real-browser CSP check.');

const html = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'">
<link rel="stylesheet" href="/test.css">
<div id="app"><div class="utility-flex" data-show="visible">Content</div></div>
<script type="module" src="/test.js"></script>`;
const script = `
import { createEngine, createStore, show } from '/dist/index.min.js';
const violations = [];
document.addEventListener('securitypolicyviolation', e => violations.push(e.violatedDirective));
const store = createStore({ visible: false });
const instance = createEngine({ modules: [show()] }).mount({
  target: document.getElementById('app'), store,
});
const el = document.querySelector('[data-show]');
const hidden = { hidden: el.hidden, display: getComputedStyle(el).display };
store.set('visible', true);
const shown = { hidden: el.hidden, display: getComputedStyle(el).display };
instance.cleanup();
setTimeout(() => {
  const result = document.createElement('pre');
  result.id = 'result';
  result.textContent = JSON.stringify({ hidden, shown, violations });
  document.body.appendChild(result);
}, 0);`;

const routes = new Map([
  ['/', ['text/html', html]],
  ['/test.css', ['text/css', '.utility-flex { display: flex !important; }']],
  ['/test.js', ['text/javascript', script]],
  ['/dist/index.min.js', ['text/javascript', await readFile(new URL('../dist/index.min.js', import.meta.url))]],
]);
const server = http.createServer((request, response) => {
  const route = routes.get(request.url);
  if (!route) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': route[0] }).end(route[1]);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const { stdout } = await promisify(execFile)(browser, [
    '--headless', '--no-sandbox', '--disable-gpu', '--dump-dom',
    '--virtual-time-budget=1500',
    `http://127.0.0.1:${server.address().port}/`,
  ], { timeout: 30000, maxBuffer: 1024 * 1024 });
  const result = stdout.match(/<pre id="result">(.*?)<\/pre>/)?.[1];
  assert.ok(result, `Browser did not produce a CSP result:\n${stdout}`);
  assert.deepEqual(JSON.parse(result), {
    hidden: { hidden: true, display: 'none' },
    shown: { hidden: false, display: 'flex' },
    violations: [],
  });
  console.log('Strict CSP visibility check passed in real Chromium.');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
