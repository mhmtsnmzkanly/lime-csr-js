import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  createStore,
  mount,
} from '../src/index.js';

test('delegated data-on-focus and data-on-blur fire through bubbling focusin/focusout', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <template id="tpl-focus-blur-test">
          <input id="test-input" data-on-focus="handleFocus" data-on-blur="handleBlur">
        </template>
        <main id="app"></main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const target = document.getElementById('app');
  const store = createStore({});

  let focusCount = 0;
  let blurCount = 0;

  mount({ target: target, template: 'focus-blur-test', store: store, ...{
    handlers: {
      handleFocus() {
        focusCount++;
      },
      handleBlur() {
        blurCount++;
      },
    },
  } });

  const input = target.querySelector('#test-input');

  // Dispatch focusin (standard bubbling focus)
  input.dispatchEvent(new dom.window.Event('focusin', { bubbles: true }));
  assert.equal(focusCount, 1);
  assert.equal(blurCount, 0);

  // Dispatch focusout (standard bubbling blur)
  input.dispatchEvent(new dom.window.Event('focusout', { bubbles: true }));
  assert.equal(focusCount, 1);
  assert.equal(blurCount, 1);
});
