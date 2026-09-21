import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserArgIndex = process.argv.indexOf('--browser');
const requestedBrowser = browserArgIndex >= 0 ? process.argv[browserArgIndex + 1] : null;
const candidates = requestedBrowser
  ? [requestedBrowser]
  : process.env.CHROMIUM_BIN
  ? [process.env.CHROMIUM_BIN]
  : ['chromium', 'chromium-browser', 'google-chrome'];
const browser = candidates.find((binary) => spawnSync(binary, ['--version']).status === 0);
assert.ok(browser, requestedBrowser
  ? `Requested browser is unavailable: ${requestedBrowser}`
  : 'Install Chromium/Chrome or set CHROMIUM_BIN to run example smoke checks.');

const checks = [
  ['counter', '/examples/01-counter/', (doc) => {
    doc.querySelector('[data-on-click="increment"]').click();
    return doc.querySelector('output').textContent === '1';
  }],
  ['keyed-list', '/examples/04-keyed-list/', (doc) => {
    const first = doc.querySelector('li');
    doc.querySelector('[data-on-click="reverse"]').click();
    return doc.querySelectorAll('li').length === 3 && doc.querySelectorAll('li')[2] === first;
  }],
  ['forms', '/examples/05-forms/', (doc) => {
    const input = doc.querySelector('input[type="number"]');
    input.value = '41';
    input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    doc.querySelector('form').dispatchEvent(new doc.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    return doc.querySelector('output').textContent.includes('41');
  }],
  ['partials-slots', '/examples/07-partials-slots/', (doc) =>
    doc.querySelectorAll('.card').length === 2 && doc.body.textContent.includes('a reader')],
  ['custom-module', '/examples/12-custom-module/', (doc) => {
    const button = doc.querySelector('[data-on-click="toggle"]');
    button.click();
    return doc.querySelector('li').classList.contains('status-done');
  }],
  ['modular-dist', '/examples/14-modular-dist/', (doc) => {
    doc.querySelector('[data-on-click="change"]').click();
    return doc.body.textContent.includes('modular distribution is running');
  }],
  ['full-dist', '/examples/19-full-dist/', (doc) => {
    doc.querySelector('[data-on-click="change"]').click();
    return doc.body.textContent.includes('full distribution bundle is running');
  }],
  ['blog', '/examples/blog/', (doc) =>
    Boolean(doc.querySelector('.post') && doc.querySelector('[data-on-click="toggle-post-like"]'))],
  ['googly-eyes', '/examples/googly-eyes.html', (doc) =>
    Boolean(doc.querySelector('.googly-demo') && doc.querySelector('[data-on-click="blink"]'))],
  ['operations-dashboard', '/examples/20-operations-dashboard/', (doc) =>
    Boolean(doc.querySelector('h1')?.textContent.includes('Operations dashboard')
      && doc.querySelector('[data-on-click="remount"]')
      && doc.querySelector('[data-show="loading"]'))],
];

const checksJson = JSON.stringify(checks.map(([name, url]) => [name, url]));
const checkDispatch = checks
  .map(([name, , fn]) => `name === ${JSON.stringify(name)} ? (${fn.toString()})(doc) :`)
  .join('');
const harness = `<!doctype html>
<meta charset="utf-8">
<iframe id="example"></iframe>
<pre id="result"></pre>
<script>
const checks = ${checksJson};
const results = [];
const frame = document.querySelector('#example');
let index = 0;
window.addEventListener('error', (event) => results.push({ name: 'parent', error: event.message }));
function run() {
  if (index >= checks.length) {
    document.querySelector('#result').textContent = JSON.stringify(results);
    return;
  }
  const [name, url] = checks[index++];
  frame.onload = () => {
    const errors = [];
    frame.contentWindow.addEventListener('error', (event) => errors.push(event.message));
    const doc = frame.contentDocument;
    let passed = false;
    try {
      passed = ${checkDispatch} false;
    } catch (error) {
      errors.push(String(error));
    }
    results.push({ name, passed, errors });
    setTimeout(run, 0);
  };
  frame.src = url;
}
run();
</script>`;

const mime = new Map([
  ['.html', 'text/html'], ['.js', 'text/javascript'], ['.css', 'text/css'],
  ['.json', 'application/json'], ['.svg', 'image/svg+xml'],
]);
const server = http.createServer(async (request, response) => {
  const requestPath = request.url === '/__harness.html' ? null : decodeURIComponent(request.url.split('?')[0]);
  if (requestPath === null) {
    response.writeHead(200, { 'content-type': 'text/html' }).end(harness);
    return;
  }
  let file = path.resolve(root, `.${requestPath}`);
  if (file.endsWith(path.sep) || await isDirectory(file)) file = path.join(file, 'index.html');
  if (!file.startsWith(root) || !(await exists(file))) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': mime.get(path.extname(file)) || 'application/octet-stream' });
  response.end(await readFile(file));
});

async function exists(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(file) {
  try {
    return (await stat(file)).isDirectory();
  } catch {
    return false;
  }
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const { stdout } = await promisify(execFile)(browser, [
    '--headless',
    ...(path.basename(browser).toLowerCase().includes('firefox')
      ? ['--dump-dom']
      : ['--no-sandbox', '--disable-gpu', '--dump-dom', '--virtual-time-budget=5000']),
    `http://127.0.0.1:${server.address().port}/__harness.html`,
  ], { timeout: 30000, maxBuffer: 1024 * 1024 });
  const result = stdout.match(/<pre id="result">(.*?)<\/pre>/s)?.[1];
  assert.ok(result, `Chromium did not produce an example result:\n${stdout}`);
  const parsed = JSON.parse(result.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  assert.equal(parsed.length, checks.length);
  for (const item of parsed) {
    assert.equal(item.passed, true, `${item.name} failed: ${item.errors.join('; ')}`);
    assert.deepEqual(item.errors, [], `${item.name} reported browser errors`);
  }
  console.log(`Chromium smoke passed for ${parsed.length} representative examples.`);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
