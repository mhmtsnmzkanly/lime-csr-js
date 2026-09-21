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
assert.ok(browser, 'Install Chromium/Chrome or set CHROMIUM_BIN to run the real-browser check.');

const html = `<!doctype html>
<html>
<head><title>Security Test</title></head>
<body>
<div id="app">
  <button id="btn-static" onclick="\${payload}">Static</button>
  <button id="btn-reactive" onclick="{payload}" data-payload="reactivePayload">Reactive</button>
  <img id="img-onerror" OnErRoR="\${payload}" alt="">
  <img id="img-onload" onload="{reactivepayload}" data-reactivepayload="reactivepayload" alt="">
  <iframe id="frame-static" srcdoc="\${srcdocPayload}"></iframe>
  <iframe id="frame-reactive" srcdoc="{srcdocPayload}" data-srcdoc-payload="reactiveSrcdoc"></iframe>
  <a id="link-static" href="\${javascriptUrl}">Static URL</a>
  <a id="link-reactive" href="{reactiveurl}" data-reactiveurl="reactiveurl">Reactive URL</a>
</div>
<script type="module" src="/test.js"></script>
</body>
</html>`;

const script = `
import { createEngine, createStore, text } from '/dist/index.min.js';

window.__PWNED__ = false;

const store = createStore({
  payload: "window.__PWNED__ = true",
  reactivepayload: "window.__PWNED__ = true",
  srcdocPayload: "<script>window.top.__PWNED__ = true</script>",
  reactiveSrcdoc: "<script>window.top.__PWNED__ = true</script>",
  javascriptUrl: "javascript:window.__PWNED__ = true",
  reactiveurl: "javascript:window.__PWNED__ = true",
});

const engine = createEngine({ modules: [text()] });
const instance = engine.mount({
  target: document.getElementById('app'),
  store,
});

const btnStatic = document.getElementById('btn-static');
const btnReactive = document.getElementById('btn-reactive');
const frameStatic = document.getElementById('frame-static');
const frameReactive = document.getElementById('frame-reactive');
const imgOnerror = document.getElementById('img-onerror');
const imgOnload = document.getElementById('img-onload');
const linkStatic = document.getElementById('link-static');
const linkReactive = document.getElementById('link-reactive');

// Attempt clicks
btnStatic.click();
btnReactive.click();

setTimeout(() => {
  const result = {
    pwned: window.__PWNED__,
    btnStaticHasOnclick: btnStatic.hasAttribute('onclick'),
    btnReactiveHasOnclick: btnReactive.hasAttribute('onclick'),
    imgOnerrorHasHandler: imgOnerror.hasAttribute('onerror'),
    imgOnloadHasHandler: imgOnload.hasAttribute('onload'),
    frameStaticHasSrcdoc: frameStatic.hasAttribute('srcdoc'),
    frameReactiveHasSrcdoc: frameReactive.hasAttribute('srcdoc'),
    staticUrl: linkStatic.getAttribute('href'),
    reactiveUrl: linkReactive.getAttribute('href'),
  };
  const pre = document.createElement('pre');
  pre.id = 'result';
  pre.textContent = JSON.stringify(result);
  document.body.appendChild(pre);
}, 200);
`;

const routes = new Map([
  ['/', ['text/html', html]],
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
    '--virtual-time-budget=2000',
    `http://127.0.0.1:${server.address().port}/`,
  ], { timeout: 30000, maxBuffer: 1024 * 1024 });

  const resultMatch = stdout.match(/<pre id="result">(.*?)<\/pre>/)?.[1];
  assert.ok(resultMatch, `Browser did not produce a security result:\n${stdout}`);
  const result = JSON.parse(resultMatch);

  assert.equal(result.pwned, false, 'Payload must not execute');
  assert.equal(result.btnStaticHasOnclick, false, 'Static onclick must be removed');
  assert.equal(result.btnReactiveHasOnclick, false, 'Reactive onclick must be removed');
  assert.equal(result.imgOnerrorHasHandler, false, 'Mixed-case onerror must be removed');
  assert.equal(result.imgOnloadHasHandler, false, 'onload must be removed');
  assert.equal(result.frameStaticHasSrcdoc, false, 'Static srcdoc must be removed');
  assert.equal(result.frameReactiveHasSrcdoc, false, 'Reactive srcdoc must be removed');
  assert.equal(result.staticUrl, '', 'Static javascript: URL must be neutralized');
  assert.equal(result.reactiveUrl, '', 'Reactive javascript: URL must be neutralized');

  console.log('Real Chromium security check passed: unsafe attribute bindings rejected without execution.');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
