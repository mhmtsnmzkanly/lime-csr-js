import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createEngine, subscribeDiagnostics, setDevMode } from '../dist/core.min.js';
import { loops } from '../dist/modules/loops.min.js';

function createDom(html) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'http://localhost/' });
}

test('Finding B: modular dist bundles share diagnostics state via global symbol', async () => {
  const diagnostics = [];
  const unsub = subscribeDiagnostics((d) => diagnostics.push(d));

  const dom = createDom('<div id="app"><for each="nonArray" as="item"><span>Item</span></for></div>');
  const engine = createEngine({ modules: [loops()] });

  // 1. Diagnostics emitted by modular loops bundle reach subscribeDiagnostics in core bundle
  engine.mount({
    target: dom.window.document.getElementById('app'),
    document: dom.window.document,
  });

  assert.ok(
    diagnostics.some((d) => d.code === 'FOR_NOT_ARRAY'),
    'Diagnostic emitted by loops module in dist bundle reached core subscribeDiagnostics',
  );

  // 2. setDevMode in core bundle sets shared state
  await setDevMode(false);
  const shared = globalThis[Symbol.for('lime.diagnostics')];
  assert.equal(shared.devMode, false);

  await setDevMode(true);
  assert.equal(shared.devMode, true);

  unsub();
});
