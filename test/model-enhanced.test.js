import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { createEngine } from '../src/core/index.js';
import { model } from '../src/modules/model.js';
import { createStore } from '../src/store.js';

function createDom(html = '') {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
    url: 'http://localhost/',
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;
  return dom;
}

function createModelEngine() {
  return createEngine({
    modules: [model()],
  });
}

// ── MILESTONE 1: INITIAL DOM VALUE FALLBACK ─────────────────────────────────

test('model: initial fallback for text input and textarea', () => {
  const dom = createDom(`
    <div id="root">
      <input id="user" type="text" data-model="user" value="JohnDoe">
      <textarea id="bio" data-model="bio">Default bio content</textarea>
      <input id="empty" type="text" data-model="emptyField">
    </div>
  `);
  const store = createStore({});
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  const userInput = root.querySelector('#user');
  const bioTextarea = root.querySelector('#bio');
  const emptyInput = root.querySelector('#empty');

  // Initial values populated to store
  assert.equal(store.get('user'), 'JohnDoe');
  assert.equal(userInput.value, 'JohnDoe');

  assert.equal(store.get('bio'), 'Default bio content');
  assert.equal(bioTextarea.value, 'Default bio content');

  // Input without value attribute does not populate store and stays empty
  assert.equal(store.get('emptyField'), undefined);
  assert.equal(emptyInput.value, '');
});

test('model: initial fallback for number input', () => {
  const dom = createDom(`
    <div id="root">
      <input id="age" type="number" data-model="profile.age" value="28">
    </div>
  `);
  const store = createStore({});
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  const ageInput = root.querySelector('#age');
  assert.equal(store.get('profile.age'), 28);
  assert.equal(ageInput.value, '28');
});

test('model: initial fallback for checkbox and radio', () => {
  const dom = createDom(`
    <div id="root">
      <input id="chk1" type="checkbox" data-model="newsletter" checked>
      <input id="chk2" type="checkbox" data-model="terms">
      <input type="radio" name="plan" value="free" data-model="plan">
      <input type="radio" name="plan" value="pro" checked data-model="plan">
    </div>
  `);
  const store = createStore({});
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  const chk1 = root.querySelector('#chk1');
  const chk2 = root.querySelector('#chk2');
  const radios = root.querySelectorAll('input[type="radio"]');

  assert.equal(chk1.checked, true);
  assert.equal(store.get('newsletter'), true);

  assert.equal(chk2.checked, false);
  assert.equal(store.get('terms'), undefined);

  assert.equal(radios[0].checked, false);
  assert.equal(radios[1].checked, true);
  assert.equal(store.get('plan'), 'pro');
});

test('model: initial fallback for single and multiple select', () => {
  const dom = createDom(`
    <div id="root">
      <select id="country" data-model="country">
        <option value="us">United States</option>
        <option value="de" selected>Germany</option>
      </select>
      <select id="tags" multiple data-model="tags">
        <option value="tech" selected>Tech</option>
        <option value="news">News</option>
        <option value="science" selected>Science</option>
      </select>
    </div>
  `);
  const store = createStore({});
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  assert.equal(store.get('country'), 'de');
  assert.deepEqual(store.get('tags'), ['tech', 'science']);
});

test('model: store value takes precedence over DOM initial attributes', () => {
  const dom = createDom(`
    <div id="root">
      <input id="user" type="text" data-model="user" value="FromDOM">
      <input id="chk" type="checkbox" data-model="active" checked>
    </div>
  `);
  const store = createStore({ user: 'FromStore', active: false });
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  const userInput = root.querySelector('#user');
  const chk = root.querySelector('#chk');

  assert.equal(userInput.value, 'FromStore');
  assert.equal(chk.checked, false);
  assert.equal(store.get('user'), 'FromStore');
  assert.equal(store.get('active'), false);
});
