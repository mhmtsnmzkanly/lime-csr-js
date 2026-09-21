import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  createEngine,
  createStore,
  model,
} from '../src/index.js';

function createDom(html) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'http://localhost/' });
}

test('Finding N: .number modifier does not mutate field mid-edit (typing 1.0) and normalizes on blur', () => {
  const dom = createDom(`
    <div id="app">
      <input id="num-input" data-model.number="count" value="0">
    </div>
  `);

  const engine = createEngine({ modules: [model()] });
  const app = dom.window.document.getElementById('app');
  const input = dom.window.document.getElementById('num-input');

  const notifications = [];
  const store = createStore({ count: 0 });
  store.subscribe('count', (val) => notifications.push(val));

  engine.mount({ target: app, store, document: dom.window.document });

  // Simulate user focusing input
  input.focus();
  assert.equal(dom.window.document.activeElement, input);

  // 1. User types "1.0"
  input.value = '1.0';
  input.dispatchEvent(new dom.window.Event('input'));

  // Store is normalized to numeric 1
  assert.equal(store.get('count'), 1);
  // Input textual representation during edit is NOT overwritten back to "1"
  assert.equal(input.value, '1.0');

  // User types "1.05"
  input.value = '1.05';
  input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(store.get('count'), 1.05);
  assert.equal(input.value, '1.05');

  // 2. On blur, representation is normalized
  input.dispatchEvent(new dom.window.Event('blur'));
  assert.equal(input.value, '1.05');

  // Test typing "2.0" and blurring
  input.focus();
  input.value = '2.0';
  input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(input.value, '2.0');
  input.dispatchEvent(new dom.window.Event('blur'));
  assert.equal(input.value, '2');

  // 3. External Store -> DOM update while not focused updates DOM
  dom.window.document.body.focus(); // blur input
  store.set('count', 42);
  assert.equal(input.value, '42');

  // 4. No duplicate notification loops
  const notifyCountBefore = notifications.length;
  input.focus();
  input.value = '42';
  input.dispatchEvent(new dom.window.Event('input'));
  // Setting same value does not emit notification
  assert.equal(notifications.length, notifyCountBefore);
});

test('Finding N: .trim modifier preserves spaces while editing and normalizes on blur', () => {
  const dom = createDom(`
    <div id="app">
      <input id="text-input" data-model.trim="username">
    </div>
  `);

  const engine = createEngine({ modules: [model()] });
  const app = dom.window.document.getElementById('app');
  const input = dom.window.document.getElementById('text-input');

  const store = createStore({ username: '' });
  engine.mount({ target: app, store, document: dom.window.document });

  input.focus();
  assert.equal(dom.window.document.activeElement, input);

  // 1. User types "hello " with trailing space
  input.value = 'hello ';
  input.dispatchEvent(new dom.window.Event('input'));

  // Store is trimmed
  assert.equal(store.get('username'), 'hello');
  // Input preserves trailing space while focused
  assert.equal(input.value, 'hello ');

  // 2. User blurs
  input.dispatchEvent(new dom.window.Event('blur'));
  assert.equal(input.value, 'hello');

  // 3. External store update updates input
  dom.window.document.body.focus();
  store.set('username', 'world');
  assert.equal(input.value, 'world');
});
