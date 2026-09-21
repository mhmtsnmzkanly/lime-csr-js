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

test('Finding M: <select data-model> preserves default selection when store value is undefined', () => {
  const dom = createDom(`
    <div id="app">
      <select id="sel-default" data-model="fruit">
        <option value="apple">Apple</option>
        <option value="banana" selected>Banana</option>
        <option value="cherry">Cherry</option>
      </select>
      <select id="sel-first" data-model="vegetable">
        <option value="carrot">Carrot</option>
        <option value="potato">Potato</option>
      </select>
    </div>
  `);

  const engine = createEngine({ modules: [model()] });
  const app = dom.window.document.getElementById('app');
  const selDefault = dom.window.document.getElementById('sel-default');
  const selFirst = dom.window.document.getElementById('sel-first');

  // Store with undefined 'fruit' and 'vegetable'
  const store = createStore({});

  engine.mount({ target: app, store, document: dom.window.document });

  // 1. select with default selected option + undefined Store: preserved and initialized
  assert.equal(selDefault.value, 'banana');
  assert.equal(store.get('fruit'), 'banana');

  // First option default when none explicit
  assert.equal(selFirst.value, 'carrot');
  assert.equal(store.get('vegetable'), 'carrot');

  // 2. Later Store updates work
  store.set('fruit', 'cherry');
  assert.equal(selDefault.value, 'cherry');

  // 3. User change writes Store
  selDefault.value = 'apple';
  selDefault.dispatchEvent(new dom.window.Event('change'));
  assert.equal(store.get('fruit'), 'apple');
});

test('Finding M: defined Store value overrides DOM initial selection', () => {
  const dom = createDom(`
    <div id="app">
      <select id="sel" data-model="fruit">
        <option value="apple">Apple</option>
        <option value="banana" selected>Banana</option>
        <option value="cherry">Cherry</option>
      </select>
    </div>
  `);

  const engine = createEngine({ modules: [model()] });
  const app = dom.window.document.getElementById('app');
  const sel = dom.window.document.getElementById('sel');

  const store = createStore({ fruit: 'cherry' });
  engine.mount({ target: app, store, document: dom.window.document });

  // Defined Store value overrides DOM selected attribute
  assert.equal(sel.value, 'cherry');
});
