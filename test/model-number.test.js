import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  createStore,
  mount,
} from '../src/index.js';

test('number input maintains type consistency and returns null when cleared', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <template id="tpl-model-num">
          <input id="age" type="number" data-model="user.age">
        </template>
        <main id="app"></main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const target = document.getElementById('app');
  const store = createStore({ user: { age: 30 } });

  mount(target, 'model-num', store);

  const input = target.querySelector('#age');
  assert.equal(input.value, '30');

  // User clears input
  input.value = '';
  input.dispatchEvent(new dom.window.Event('input'));
  assert.strictEqual(store.get('user.age'), null);

  // User enters a valid number
  input.value = '42';
  input.dispatchEvent(new dom.window.Event('input'));
  assert.strictEqual(store.get('user.age'), 42);

  // Setting store value to null clears input
  store.set('user.age', null);
  assert.equal(input.value, '');

  // Setting store value to a new number updates input
  store.set('user.age', 99);
  assert.equal(input.value, '99');
});
