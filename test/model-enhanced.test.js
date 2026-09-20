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

// ── MILESTONE 2: CHECKBOX ARRAYS ────────────────────────────────────────────

test('model: checkbox array with data-model="roles[]" initial DOM fallback', () => {
  const dom = createDom(`
    <div id="root">
      <input type="checkbox" data-model="roles[]" value="admin" checked>
      <input type="checkbox" data-model="roles[]" value="editor" checked>
      <input type="checkbox" data-model="roles[]" value="viewer">
    </div>
  `);
  const store = createStore({});
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  const checkboxes = root.querySelectorAll('input[type="checkbox"]');
  assert.equal(checkboxes[0].checked, true);
  assert.equal(checkboxes[1].checked, true);
  assert.equal(checkboxes[2].checked, false);

  assert.deepEqual(store.get('roles'), ['admin', 'editor']);
});

test('model: checkbox array two-way toggle (DOM -> Store and Store -> DOM)', () => {
  const dom = createDom(`
    <div id="root">
      <input id="chk-admin" type="checkbox" data-model="roles[]" value="admin">
      <input id="chk-editor" type="checkbox" data-model="roles[]" value="editor">
      <input id="chk-viewer" type="checkbox" data-model="roles[]" value="viewer">
    </div>
  `);
  const store = createStore({ roles: ['admin'] });
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  const admin = root.querySelector('#chk-admin');
  const editor = root.querySelector('#chk-editor');
  const viewer = root.querySelector('#chk-viewer');

  assert.equal(admin.checked, true);
  assert.equal(editor.checked, false);
  assert.equal(viewer.checked, false);

  // Check 'viewer' -> added to store
  viewer.checked = true;
  viewer.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(store.get('roles'), ['admin', 'viewer']);
  assert.equal(viewer.checked, true);

  // Uncheck 'admin' -> removed from store
  admin.checked = false;
  admin.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(store.get('roles'), ['viewer']);
  assert.equal(admin.checked, false);

  // Store update -> DOM reflects array state
  store.set('roles', ['editor', 'viewer']);
  assert.equal(admin.checked, false);
  assert.equal(editor.checked, true);
  assert.equal(viewer.checked, true);
});

test('model: checkbox array implicit mode when store holds array without [] in attribute', () => {
  const dom = createDom(`
    <div id="root">
      <input id="chk-read" type="checkbox" data-model="perms" value="read">
      <input id="chk-write" type="checkbox" data-model="perms" value="write">
    </div>
  `);
  const store = createStore({ perms: ['read'] });
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  const read = root.querySelector('#chk-read');
  const write = root.querySelector('#chk-write');

  assert.equal(read.checked, true);
  assert.equal(write.checked, false);

  // Check write
  write.checked = true;
  write.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(store.get('perms'), ['read', 'write']);
});

// ── MILESTONE 3: MODIFIERS (.lazy, .trim, .number, .debounce-<ms>) ──────────

test('model modifiers: .trim strips whitespace on dot, dash, and companion syntax', () => {
  const dom = createDom(`
    <div id="root">
      <input id="dot" type="text" data-model.trim="user.name">
      <input id="dash" type="text" data-model-trim="user.title">
      <input id="companion" type="text" data-model="user.bio" data-model-trim>
    </div>
  `);
  const store = createStore({ user: {} });
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  const dot = root.querySelector('#dot');
  const dash = root.querySelector('#dash');
  const companion = root.querySelector('#companion');

  dot.value = '   Alice Wonderland   ';
  dot.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('user.name'), 'Alice Wonderland');

  dash.value = '   Developer   ';
  dash.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('user.title'), 'Developer');

  companion.value = '   Bio text   ';
  companion.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('user.bio'), 'Bio text');
});

test('model modifiers: .number casts values and handles nulls', () => {
  const dom = createDom(`
    <div id="root">
      <input id="price" type="text" data-model.number="price">
      <input id="qty" type="text" data-model="qty" data-model-number>
    </div>
  `);
  const store = createStore({ price: null, qty: 1 });
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  const price = root.querySelector('#price');
  const qty = root.querySelector('#qty');

  price.value = '49.99';
  price.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('price'), 49.99);

  price.value = '';
  price.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('price'), null);

  qty.value = '100';
  qty.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('qty'), 100);
});

test('model modifiers: .lazy listens on change event instead of input', () => {
  const dom = createDom(`
    <div id="root">
      <input id="search-dot" type="text" data-model.lazy="query">
      <input id="search-comp" type="text" data-model="term" data-model-lazy>
    </div>
  `);
  const store = createStore({ query: 'initial', term: 'initial' });
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  const dot = root.querySelector('#search-dot');
  const comp = root.querySelector('#search-comp');

  // Input event should NOT update store
  dot.value = 'typing...';
  dot.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('query'), 'initial');

  // Change event DOES update store
  dot.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(store.get('query'), 'typing...');

  // Companion lazy
  comp.value = 'companion typing...';
  comp.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('term'), 'initial');

  comp.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(store.get('term'), 'companion typing...');
});

test('model modifiers: .debounce delays store update and cleans up on unmount', async () => {
  const dom = createDom(`
    <div id="root">
      <input id="dot-deb" type="text" data-model.debounce-50="keyword">
      <input id="comp-deb" type="text" data-model="search" data-model-debounce="50">
    </div>
  `);
  const store = createStore({ keyword: '', search: '' });
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  const unmount = engine.mount({ target: root, store, document: dom.window.document });

  const dot = root.querySelector('#dot-deb');
  const comp = root.querySelector('#comp-deb');

  dot.value = 'quick';
  dot.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('keyword'), ''); // not updated yet

  comp.value = 'search-term';
  comp.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('search'), ''); // not updated yet

  // Wait for debounce timer (70ms > 50ms)
  await new Promise((resolve) => globalThis.setTimeout(resolve, 70));

  assert.equal(store.get('keyword'), 'quick');
  assert.equal(store.get('search'), 'search-term');

  // Test debounce cleanup on unmount
  dot.value = 'cancelled';
  dot.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  unmount();

  await new Promise((resolve) => globalThis.setTimeout(resolve, 70));
  // Store should NOT have been updated to 'cancelled' because timer was cleaned up
  assert.equal(store.get('keyword'), 'quick');
});

test('model modifiers: combined modifiers (lazy + trim)', () => {
  const dom = createDom(`
    <div id="root">
      <input id="combo" type="text" data-model.lazy.trim="profile.title">
    </div>
  `);
  const store = createStore({ profile: { title: 'old' } });
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  const combo = root.querySelector('#combo');

  combo.value = '   Senior Architect   ';
  combo.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('profile.title'), 'old'); // lazy ignores input

  combo.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(store.get('profile.title'), 'Senior Architect'); // trimmed on change
});

// ── MILESTONE 4: CONTENTEDITABLE SUPPORT ────────────────────────────────────

test('model: contenteditable two-way binding with HTML content and loop guard', () => {
  const dom = createDom(`
    <div id="root">
      <div id="editor" contenteditable="true" data-model="doc.body"></div>
    </div>
  `);
  const store = createStore({ doc: { body: '<p>Initial text</p>' } });
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  const editor = root.querySelector('#editor');
  assert.equal(editor.innerHTML, '<p>Initial text</p>');

  // DOM -> Store
  editor.innerHTML = '<p>Updated text</p>';
  editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('doc.body'), '<p>Updated text</p>');

  // Store -> DOM
  store.set('doc.body', '<h2>Header</h2>');
  assert.equal(editor.innerHTML, '<h2>Header</h2>');
});

test('model: contenteditable initial DOM fallback', () => {
  const dom = createDom(`
    <div id="root">
      <div id="editor" contenteditable="true" data-model="content"><b>Default bold</b></div>
    </div>
  `);
  const store = createStore({});
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  const editor = root.querySelector('#editor');
  assert.equal(store.get('content'), '<b>Default bold</b>');
  assert.equal(editor.innerHTML, '<b>Default bold</b>');
});

test('model: contenteditable with .text modifier binds textContent', () => {
  const dom = createDom(`
    <div id="root">
      <div id="editor" contenteditable="true" data-model.text="plainText">Hello world</div>
    </div>
  `);
  const store = createStore({});
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  const editor = root.querySelector('#editor');
  assert.equal(store.get('plainText'), 'Hello world');

  editor.textContent = 'Changed text';
  editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('plainText'), 'Changed text');
});

test('model: contenteditable with .lazy modifier updates on blur', () => {
  const dom = createDom(`
    <div id="root">
      <div id="editor" contenteditable="true" data-model.lazy="doc">Original</div>
    </div>
  `);
  const store = createStore({ doc: 'Original' });
  const engine = createModelEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, store, document: dom.window.document });

  const editor = root.querySelector('#editor');

  editor.innerHTML = 'Drafting...';
  editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('doc'), 'Original'); // not updated on input

  editor.dispatchEvent(new dom.window.Event('blur', { bubbles: true }));
  assert.equal(store.get('doc'), 'Drafting...'); // updated on blur
});



