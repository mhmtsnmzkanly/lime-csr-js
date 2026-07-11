import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('built ESM bundle imports and performs a browser-style mount, update, event, and cleanup', async () => {
  const dom = new JSDOM(`<!doctype html><template id="tpl-smoke"><button data-on-click="increment" data-text="count"></button></template><main id="app"></main>`, { url: 'http://localhost/' });
  Object.assign(globalThis, {
    document: dom.window.document,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element,
    Event: dom.window.Event,
  });
  const { createStore, mount } = await import('../dist/index.min.js');
  const store = createStore({ count: 0 });
  let calls = 0;
  const target = document.getElementById('app');
  const cleanup = mount('smoke', {}, target, store, { handlers: { increment: () => { calls += 1; store.update('count', (n) => n + 1); } } });
  target.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(target.textContent, '1');
  assert.equal(calls, 1);
  cleanup();
  store.set('count', 2);
  assert.equal(target.textContent, '1');
});
