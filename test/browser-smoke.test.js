import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('built ESM bundle imports and performs a browser-style mount, plugin directive, visibility update, event, and cleanup', async () => {
  const dom = new JSDOM(`<!doctype html><style>.d-flex { display: flex !important; }</style><template id="tpl-smoke"><button data-on-click="increment" data-text="count"></button><section class="d-flex" data-show="visible" style="display:flex" data-lime-smoke="raw-value"></section></template><main id="app"></main>`, { url: 'http://localhost/' });
  Object.assign(globalThis, {
    document: dom.window.document,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element,
    Event: dom.window.Event,
  });
  const {
    createStore,
    definePlugin,
    mount,
    PLUGIN_API_VERSION,
    subscribeDiagnostics,
  } = await import('../dist/index.min.js');
  assert.equal(typeof subscribeDiagnostics, 'function');
  assert.equal(PLUGIN_API_VERSION, 1);
  const store = createStore({ count: 0, visible: false });
  let calls = 0;
  let pluginValue;
  let pluginCleanups = 0;
  const plugin = definePlugin({
    name: 'smoke',
    apiVersion: PLUGIN_API_VERSION,
    directives: {
      'data-lime-smoke'({ value }) {
        pluginValue = value;
        return () => { pluginCleanups += 1; };
      },
    },
  });
  const target = document.getElementById('app');
  const cleanup = mount('smoke', {
    target,
    store,
    plugins: [plugin],
    handlers: { increment: () => { calls += 1; store.update('count', (n) => n + 1); } },
  });
  target.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(target.textContent, '1');
  assert.equal(calls, 1);
  const shown = target.querySelector('[data-show]');
  assert.equal(shown.hidden, true);
  assert.equal(shown.style.display, 'flex');
  assert.equal(pluginValue, 'raw-value');
  assert.equal(document.querySelectorAll('#lime-csr-data-show-style').length, 1);
  assert.equal(
    document.getElementById('lime-csr-data-show-style').textContent.trim(),
    '[data-show][hidden] { display: none !important; }',
  );
  store.set('visible', true);
  assert.equal(shown.hidden, false);
  assert.equal(shown.style.display, 'flex');
  cleanup();
  assert.equal(pluginCleanups, 1);
  store.set('count', 2);
  assert.equal(target.textContent, '1');
});
