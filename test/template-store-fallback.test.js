import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  mount,
  createStore,
  renderTemplate,
  resolveStatic,
} from '../src/index.js';

test('static interpolation resolves from store fallback when absent in context', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <template id="tpl-fallback-test">
          <div id="text-node">\${title} - \${fromStore} - \${contextWin}</div>
          <span id="attr-node" title="\${storeAttr}" data-extra="\${contextAttr}"></span>
          <p id="null-override">\${nullProp}</p>
        </template>
        <main id="app"></main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const store = createStore({
    fromStore: 'StoreVal',
    contextWin: 'StoreShouldLose',
    storeAttr: 'StoreAttrVal',
    nullProp: 'StoreShouldNotShow',
  });

  const target = document.getElementById('app');
  mount({ target: target, template: 'fallback-test', store: store, ...{
    context: {
      title: 'Hello',
      contextWin: 'ContextWon',
      contextAttr: 'ContextAttrVal',
      nullProp: null,
    },
  } });

  const textNode = target.querySelector('#text-node');
  const attrNode = target.querySelector('#attr-node');
  const nullOverride = target.querySelector('#null-override');

  assert.equal(textNode.textContent, 'Hello - StoreVal - ContextWon');
  assert.equal(attrNode.getAttribute('title'), 'StoreAttrVal');
  assert.equal(attrNode.getAttribute('data-extra'), 'ContextAttrVal');
  assert.equal(nullOverride.textContent, '');
});

test('renderTemplate and resolveStatic accept store fallback directly', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <template id="tpl-render-tpl-test">
          <p class="\${storeClass}">\${storeMsg}</p>
        </template>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const store = createStore({
    storeClass: 'badge-primary',
    storeMsg: 'Welcome Store',
  });

  const frag = renderTemplate('render-tpl-test', {}, store);
  assert.ok(frag);
  const p = frag.querySelector('p');
  assert.equal(p.className, 'badge-primary');
  assert.equal(p.textContent, 'Welcome Store');

  // Test direct resolveStatic call
  const div = dom.window.document.createElement('div');
  div.innerHTML = '<span id="direct">${directStore}</span>';
  store.set('directStore', 'DirectValue');
  resolveStatic(div, {}, store);
  assert.equal(div.querySelector('#direct').textContent, 'DirectValue');
});

test('resolveStatic: resolves placeholders in root element attributes', () => {
  const dom = new JSDOM('<div title="Hello ${user.name}"></div>');
  const root = dom.window.document.body.firstElementChild;

  resolveStatic(root, { user: { name: 'Ada' } });

  assert.equal(root.getAttribute('title'), 'Hello Ada');
});
