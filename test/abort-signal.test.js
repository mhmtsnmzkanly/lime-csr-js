import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  createStore,
  mount,
} from '../src/index.js';

test('AbortSignal abort cancels store subscriptions, event listeners, and clears target', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <template id="tpl-abort-test">
          <button data-on-click="inc">Clicks: <span data-text="count"></span></button>
        </template>
        <main id="app"></main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const target = document.getElementById('app');
  const store = createStore({ count: 0 });
  const controller = new AbortController();

  let clicked = 0;
  mount('abort-test', {
    target,
    store,
    signal: controller.signal,
    handlers: {
      inc() {
        clicked++;
      },
    },
  });

  // Verify mounted content
  assert.equal(target.querySelector('span').textContent, '0');
  store.set('count', 5);
  assert.equal(target.querySelector('span').textContent, '5');

  // Trigger click
  const button = target.querySelector('button');
  button.click();
  assert.equal(clicked, 1);

  // Now abort
  controller.abort();

  // Target should be cleared
  assert.equal(target.textContent, '');
  assert.equal(target.children.length, 0);

  // Store changes should no longer affect anything and not error
  store.set('count', 10);
});

test('pre-aborted AbortSignal prevents mount from executing', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <template id="tpl-abort-test-2">
          <p>Should not mount</p>
        </template>
        <main id="app"></main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const target = document.getElementById('app');
  const controller = new AbortController();
  controller.abort(); // already aborted

  const cleanup = mount('abort-test-2', {
    target,
    signal: controller.signal,
  });

  assert.equal(target.textContent, '');
  assert.equal(typeof cleanup, 'function');
  cleanup(); // should be safe to call
});
