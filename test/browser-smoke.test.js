import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('built ESM bundle imports and performs a browser-style mount, visibility update, event, and cleanup', async () => {
  const dom = new JSDOM(`<!doctype html><style>.d-flex { display: flex !important; }</style><template id="tpl-smoke"><button data-on-click="increment" data-text="count"></button><section class="d-flex" data-show="visible" style="display:flex"></section></template><main id="app"></main>`, { url: 'http://localhost/' });
  Object.assign(globalThis, {
    document: dom.window.document,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element,
    Event: dom.window.Event,
  });
  const { createStore, mount, subscribeDiagnostics } = await import('../dist/index.min.js');
  assert.equal(typeof subscribeDiagnostics, 'function');
  const store = createStore({ count: 0, visible: false });
  let calls = 0;
  const target = document.getElementById('app');
  const cleanup = mount('smoke', {}, target, store, { handlers: { increment: () => { calls += 1; store.update('count', (n) => n + 1); } } });
  target.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(target.textContent, '1');
  assert.equal(calls, 1);
  const shown = target.querySelector('[data-show]');
  assert.equal(shown.hidden, true);
  assert.equal(shown.style.display, 'flex');
  assert.equal(document.querySelectorAll('#lime-csr-data-show-style').length, 1);
  assert.equal(
    document.getElementById('lime-csr-data-show-style').textContent.trim(),
    '[data-show][hidden] { display: none !important; }',
  );
  store.set('visible', true);
  assert.equal(shown.hidden, false);
  assert.equal(shown.style.display, 'flex');
  cleanup();
  store.set('count', 2);
  assert.equal(target.textContent, '1');
});
