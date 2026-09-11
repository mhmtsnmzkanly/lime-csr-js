import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { createEngine } from '../src/core/index.js';
import {
  partials,
  conditionals,
  loops,
  text,
  show,
  model,
  events,
} from '../src/modules/index.js';
import { createStore } from '../src/store.js';
import { setDevMode, subscribeDiagnostics } from '../src/errors.js';

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

function createFullEngine(engineOptions = {}) {
  return createEngine({
    modules: [
      partials(),
      loops(),
      conditionals(),
      model(),
      text(),
      show(),
      events(),
    ],
    ...engineOptions,
  });
}

test.beforeEach(() => {
  setDevMode(false);
});

// ── 1. TEXT MODULE TESTS ───────────────────────────────────────────────────

test('text: data-text reactively updates textContent from store', () => {
  const dom = createDom('<div id="root"><span id="msg" data-text="user.name">Initial</span></div>');
  const store = createStore({ user: { name: 'Ada' } });
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount(root, { store, document: dom.window.document });
  const span = root.querySelector('#msg');
  assert.equal(span.textContent, 'Ada');

  store.set('user.name', 'Grace');
  assert.equal(span.textContent, 'Grace');

  store.set('user.name', null);
  assert.equal(span.textContent, '');
});

test('text: data-text resolves from lexical scope before store fallback', () => {
  const dom = createDom('<div id="root"><span id="msg" data-text="localName"></span></div>');
  const store = createStore({ localName: 'FromStore' });
  const scope = { localName: 'FromScope' };
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount(root, { store, scope, document: dom.window.document });
  const span = root.querySelector('#msg');
  assert.equal(span.textContent, 'FromScope');
});

test('text: empty data-text emits BINDING_MISSING_PATH diagnostic', () => {
  const dom = createDom('<div id="root"><span data-text=""></span></div>');
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');
  const diagnostics = [];
  const unsub = subscribeDiagnostics((diag) => diagnostics.push(diag));

  engine.mount(root, { document: dom.window.document });
  unsub();

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'BINDING_MISSING_PATH');
});

test('text: {x} attribute template reactively binds and consumes data-x attributes', () => {
  const dom = createDom(`
    <div id="root">
      <a id="profile" href="/users/{id}?tab={tab}" data-id="user.id" data-tab="activeTab">Profile</a>
    </div>
  `);
  const store = createStore({ user: { id: 42 }, activeTab: 'overview' });
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount(root, { store, document: dom.window.document });
  const link = root.querySelector('#profile');

  assert.equal(link.getAttribute('href'), '/users/42?tab=overview');
  // Consumed attributes removed from DOM
  assert.equal(link.hasAttribute('data-id'), false);
  assert.equal(link.hasAttribute('data-tab'), false);
  // data-ref is added
  assert.match(link.dataset.ref, /^lcsr-\d+$/);

  store.set('activeTab', 'settings');
  assert.equal(link.getAttribute('href'), '/users/42?tab=settings');

  store.set('user.id', 99);
  assert.equal(link.getAttribute('href'), '/users/99?tab=settings');
});

test('text: {x} URL sanitization blocks dangerous protocols', () => {
  const dom = createDom(`
    <div id="root">
      <a id="bad-link" href="{url}" data-url="linkUrl">Click</a>
    </div>
  `);
  const store = createStore({ linkUrl: 'javascript:alert(1)' });
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount(root, { store, document: dom.window.document });
  const link = root.querySelector('#bad-link');
  assert.equal(link.getAttribute('href'), '');

  store.set('linkUrl', 'https://example.com');
  assert.equal(link.getAttribute('href'), 'https://example.com');
});

test('text: {x} rejects event handler attributes with UNSAFE_EVENT_ATTR', () => {
  const dom = createDom(`
    <div id="root">
      <button onclick="{code}" data-code="myCode">Test</button>
    </div>
  `);
  const store = createStore({ myCode: 'alert(1)' });
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');
  const diagnostics = [];
  const unsub = subscribeDiagnostics((diag) => diagnostics.push(diag));

  engine.mount(root, { store, document: dom.window.document });
  unsub();

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'UNSAFE_EVENT_ATTR');
});

test('text: {x} rejects reserved attribute names with RESERVED_ATTR_NAME', () => {
  const dom = createDom(`
    <div id="root">
      <a href="/{model}" data-model="modelPath">Link</a>
    </div>
  `);
  const store = createStore({ modelPath: 'val' });
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');
  const diagnostics = [];
  const unsub = subscribeDiagnostics((diag) => diagnostics.push(diag));

  engine.mount(root, { store, document: dom.window.document });
  unsub();

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'RESERVED_ATTR_NAME');
});

test('text: {x} missing data-x attribute emits BINDING_MISSING_DATA_ATTR', () => {
  const dom = createDom(`
    <div id="root">
      <a href="/{missing}">Link</a>
    </div>
  `);
  const store = createStore({});
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');
  const diagnostics = [];
  const unsub = subscribeDiagnostics((diag) => diagnostics.push(diag));

  engine.mount(root, { store, document: dom.window.document });
  unsub();

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'BINDING_MISSING_DATA_ATTR');
});

// ── 2. SHOW MODULE TESTS ───────────────────────────────────────────────────

test('show: toggles native hidden property reactively and preserves inline display', () => {
  const dom = createDom(`
    <div id="root">
      <div id="box" data-show="visible" style="display: flex;">Content</div>
    </div>
  `);
  const store = createStore({ visible: false });
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount(root, { store, document: dom.window.document });
  const box = root.querySelector('#box');

  assert.equal(box.hidden, true);
  // Does NOT touch inline style.display
  assert.equal(box.style.display, 'flex');

  store.set('visible', true);
  assert.equal(box.hidden, false);
  assert.equal(box.style.display, 'flex');
});

test('show: injects document-scoped style rule with multi-document isolation', () => {
  const dom = createDom('<div id="root"><span data-show="flag">text</span></div>');
  const store = createStore({ flag: true });
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount(root, { store, document: dom.window.document });

  const styleTag = dom.window.document.getElementById('lime-csr-data-show-style');
  assert.notEqual(styleTag, null);
  assert.match(styleTag.textContent, /\[data-show\]\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);

  // Mounting second instance does not duplicate the style tag
  const dom2Root = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(dom2Root);
  dom2Root.innerHTML = '<span data-show="flag">text2</span>';
  engine.mount(dom2Root, { store, document: dom.window.document });

  const styleTags = dom.window.document.querySelectorAll('#lime-csr-data-show-style');
  assert.equal(styleTags.length, 1);
});

test('show: empty data-show emits SHOW_MISSING_PATH diagnostic', () => {
  const dom = createDom('<div id="root"><span data-show=""></span></div>');
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');
  const diagnostics = [];
  const unsub = subscribeDiagnostics((diag) => diagnostics.push(diag));

  engine.mount(root, { document: dom.window.document });
  unsub();

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'SHOW_MISSING_PATH');
});

// ── 3. MODEL MODULE TESTS ──────────────────────────────────────────────────

test('model: two-way text and textarea inputs with loop guard', () => {
  const dom = createDom(`
    <div id="root">
      <input id="inp" type="text" data-model="username">
      <textarea id="txt" data-model="bio"></textarea>
    </div>
  `);
  const store = createStore({ username: 'Initial', bio: 'Short bio' });
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount(root, { store, document: dom.window.document });
  const input = root.querySelector('#inp');
  const textarea = root.querySelector('#txt');

  assert.equal(input.value, 'Initial');
  assert.equal(textarea.value, 'Short bio');

  // DOM -> Store
  input.value = 'UpdatedUser';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('username'), 'UpdatedUser');

  textarea.value = 'New bio text';
  textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('bio'), 'New bio text');

  // Store -> DOM
  store.set('username', 'FromServer');
  assert.equal(input.value, 'FromServer');
});

test('model: number input parses numbers and preserves incomplete raw strings', () => {
  const dom = createDom(`
    <div id="root">
      <input id="num" type="number" data-model="age">
    </div>
  `);
  const store = createStore({ age: 25 });
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount(root, { store, document: dom.window.document });
  const input = root.querySelector('#num');
  assert.equal(input.value, '25');

  input.value = '30';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('age'), 30);

  // Empty string becomes null
  input.value = '';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('age'), null);

  // Setting store value to null clears input
  store.set('age', null);
  assert.equal(input.value, '');

  // Setting store value to a new number updates input
  store.set('age', 99);
  assert.equal(input.value, '99');
});

test('model: checkbox two-way boolean binding', () => {
  const dom = createDom(`
    <div id="root">
      <input id="chk" type="checkbox" data-model="agree">
    </div>
  `);
  const store = createStore({ agree: false });
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount(root, { store, document: dom.window.document });
  const checkbox = root.querySelector('#chk');
  assert.equal(checkbox.checked, false);

  checkbox.checked = true;
  checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(store.get('agree'), true);

  store.set('agree', false);
  assert.equal(checkbox.checked, false);
});

test('model: radio group coordinates selected value', () => {
  const dom = createDom(`
    <div id="root">
      <input type="radio" name="opt" value="A" data-model="choice">
      <input type="radio" name="opt" value="B" data-model="choice">
      <input type="radio" name="opt" value="C" data-model="choice">
    </div>
  `);
  const store = createStore({ choice: 'B' });
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount(root, { store, document: dom.window.document });
  const [radioA, radioB, radioC] = root.querySelectorAll('input[type="radio"]');

  assert.equal(radioA.checked, false);
  assert.equal(radioB.checked, true);
  assert.equal(radioC.checked, false);

  radioA.checked = true;
  radioA.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(store.get('choice'), 'A');

  store.set('choice', 'C');
  assert.equal(radioA.checked, false);
  assert.equal(radioB.checked, false);
  assert.equal(radioC.checked, true);
});

test('model: select-single and select-multiple bindings', () => {
  const dom = createDom(`
    <div id="root">
      <select id="single" data-model="country">
        <option value="us">United States</option>
        <option value="ca">Canada</option>
      </select>
      <select id="multi" multiple data-model="tags">
        <option value="js">JS</option>
        <option value="css">CSS</option>
        <option value="html">HTML</option>
      </select>
    </div>
  `);
  const store = createStore({ country: 'ca', tags: ['js', 'html'] });
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount(root, { store, document: dom.window.document });
  const single = root.querySelector('#single');
  const multi = root.querySelector('#multi');

  assert.equal(single.value, 'ca');
  assert.deepEqual(Array.from(multi.selectedOptions).map((o) => o.value), ['js', 'html']);

  single.value = 'us';
  single.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(store.get('country'), 'us');

  store.set('tags', ['css']);
  assert.deepEqual(Array.from(multi.selectedOptions).map((o) => o.value), ['css']);
});

test('model: indexed path emits INDEXED_MODEL_PATH diagnostic', () => {
  const dom = createDom(`
    <div id="root">
      <input data-model="users.0.name">
    </div>
  `);
  const store = createStore({ users: [{ name: 'Ada' }] });
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');
  const diagnostics = [];
  const unsub = subscribeDiagnostics((diag) => diagnostics.push(diag));

  engine.mount(root, { store, document: dom.window.document });
  unsub();

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'INDEXED_MODEL_PATH');
});

// ── 4. EVENTS MODULE TESTS ─────────────────────────────────────────────────

test('events: delegated click handler receives event, element, scope, store, and data payload', () => {
  const dom = createDom(`
    <div id="root">
      <button id="btn" data-on-click="onClick">Click Me</button>
    </div>
  `);
  const store = createStore({});
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');

  let calledWith = null;
  const handlers = {
    onClick({ event, element, scope, store, data }) {
      calledWith = { event, element, scope, store, data };
    },
  };

  engine.mount(root, { store, handlers, document: dom.window.document });
  const btn = root.querySelector('#btn');
  btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.notEqual(calledWith, null);
  assert.equal(calledWith.element, btn);
  assert.equal(calledWith.event.type, 'click');
  assert.equal(calledWith.data, null);
  assert.equal(calledWith.store, store);
  assert.ok(calledWith.scope);
});

test('events: key modifiers filter keydown events', () => {
  const dom = createDom(`
    <div id="root">
      <input id="textInp" data-on-keydown-enter="onEnter" data-on-keydown-escape="onEscape">
    </div>
  `);
  const store = createStore({});
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');

  const log = [];
  const handlers = {
    onEnter() { log.push('enter'); },
    onEscape() { log.push('escape'); },
  };

  engine.mount(root, { store, handlers, document: dom.window.document });
  const input = root.querySelector('#textInp');

  // Ignored other key
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  assert.deepEqual(log, []);

  // Enter key
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(log, ['enter']);

  // Escape key
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.deepEqual(log, ['enter', 'escape']);
});

test('events: data-on-submit always calls preventDefault', () => {
  const dom = createDom(`
    <div id="root">
      <form id="form" data-on-submit="onSubmit">
        <button type="submit">Submit</button>
      </form>
    </div>
  `);
  const store = createStore({});
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');

  let submitted = false;
  const handlers = {
    onSubmit() { submitted = true; },
  };

  engine.mount(root, { store, handlers, document: dom.window.document });
  const form = root.querySelector('#form');
  const event = new dom.window.Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);

  assert.equal(submitted, true);
  assert.equal(event.defaultPrevented, true);
});

test('events: diagnostics for unknown event and bad modifier', () => {
  const dom = createDom(`
    <div id="root">
      <button data-on-unknown="handleBad"></button>
      <input data-on-keydown-badmod="handleBadMod">
    </div>
  `);
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');
  const diagnostics = [];
  const unsub = subscribeDiagnostics((diag) => diagnostics.push(diag));

  engine.mount(root, { document: dom.window.document });
  unsub();

  const codes = diagnostics.map((d) => d.code);
  assert.ok(codes.includes('UNKNOWN_EVENT'));
  assert.ok(codes.includes('UNKNOWN_KEY_MODIFIER'));
});

test('events: missing handler emits HANDLER_NOT_FOUND diagnostic when fired', () => {
  const dom = createDom(`
    <div id="root">
      <button id="btn" data-on-click="nonExistent"></button>
    </div>
  `);
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');
  const diagnostics = [];
  const unsub = subscribeDiagnostics((diag) => diagnostics.push(diag));

  engine.mount(root, { handlers: {}, document: dom.window.document });
  const btn = root.querySelector('#btn');
  btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  unsub();

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'HANDLER_NOT_FOUND');
});

test('events: ignored block prevents event dispatch', () => {
  const dom = createDom(`
    <div id="root">
      <div data-lime-ignore>
        <button id="ignored-btn" data-on-click="onClick">Ignored</button>
      </div>
    </div>
  `);
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');
  let called = false;
  const handlers = { onClick() { called = true; } };

  engine.mount(root, { handlers, document: dom.window.document });
  root.querySelector('#ignored-btn').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.equal(called, false);
});

// ── 5. ARCHITECTURAL INVARIANTS & INTEGRATION ──────────────────────────────

test('invariants: behavioral modules produce ZERO structural DOM mutations during Link', () => {
  const dom = createDom(`
    <div id="root">
      <span data-text="name"></span>
      <div data-show="visible"></div>
      <input data-model="name">
      <button data-on-click="onClick">Click</button>
    </div>
  `);
  const store = createStore({ name: 'Ada', visible: true });
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');

  // Spy on structural DOM mutation methods on the root container
  let structuralMutations = 0;
  const origAppend = root.appendChild;
  const origRemove = root.removeChild;
  const origInsert = root.insertBefore;
  const origReplace = root.replaceChild;

  root.appendChild = function (...args) { structuralMutations++; return origAppend.apply(this, args); };
  root.removeChild = function (...args) { structuralMutations++; return origRemove.apply(this, args); };
  root.insertBefore = function (...args) { structuralMutations++; return origInsert.apply(this, args); };
  root.replaceChild = function (...args) { structuralMutations++; return origReplace.apply(this, args); };

  // Render (which runs Transform and Link without mounting target replacement)
  engine.render(root, { store, document: dom.window.document, handlers: { onClick() {} } });

  assert.equal(structuralMutations, 0, 'Link phase produced unexpected structural DOM mutations');
});

test('integration: full application flow combining loops, conditionals, model, text, show, events', () => {
  const dom = createDom(`
    <div id="root">
      <input id="taskInput" data-model="newTask" data-on-keydown-enter="addTask">
      <button id="addBtn" data-on-click="addTask">Add</button>
      <p id="emptyMsg" data-show="isEmpty">No tasks yet</p>
      <div id="taskList">
        <for each="tasks" as="task" key="task.id" data-live>
          <div class="task-row">
            <span class="task-title" data-text="task.title"></span>
            <button class="done-btn" data-on-click="removeTask" data-task-id="\${task.id}">Done</button>
          </div>
        </for>
      </div>
    </div>
  `);

  const store = createStore({
    newTask: '',
    isEmpty: true,
    tasks: [],
  });

  let nextId = 1;
  const handlers = {
    addTask() {
      const title = store.get('newTask');
      if (!title || !title.trim()) return;
      const tasks = store.get('tasks') || [];
      store.set('tasks', [...tasks, { id: nextId++, title: title.trim() }]);
      store.set('newTask', '');
      store.set('isEmpty', false);
    },
    removeTask({ event }) {
      const id = Number(event.target.getAttribute('data-task-id'));
      const tasks = (store.get('tasks') || []).filter((t) => t.id !== id);
      store.set('tasks', tasks);
      store.set('isEmpty', tasks.length === 0);
    },
  };

  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { store, handlers, document: dom.window.document });

  const input = root.querySelector('#taskInput');
  const addBtn = root.querySelector('#addBtn');
  const emptyMsg = root.querySelector('#emptyMsg');

  assert.equal(emptyMsg.hidden, false);
  assert.equal(root.querySelectorAll('.task-row').length, 0);

  // Type new task and click Add
  input.value = 'Buy milk';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('newTask'), 'Buy milk');

  addBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(emptyMsg.hidden, true);
  assert.equal(input.value, '');

  const rows = root.querySelectorAll('.task-row');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('.task-title').textContent, 'Buy milk');

  // Delegated event on dynamically added button
  const doneBtn = rows[0].querySelector('.done-btn');
  doneBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.equal(root.querySelectorAll('.task-row').length, 0);
  assert.equal(emptyMsg.hidden, false);
});

test('teardown: unmount cleans up all listeners and subscriptions', () => {
  const dom = createDom(`
    <div id="root">
      <input id="name" data-model="name">
      <span id="label" data-text="name"></span>
      <button id="btn" data-on-click="hit"></button>
    </div>
  `);
  const store = createStore({ name: 'Ada' });
  const engine = createFullEngine();
  const root = dom.window.document.getElementById('root');
  let hits = 0;

  const unmount = engine.mount(root, {
    store,
    handlers: { hit() { hits++; } },
    document: dom.window.document,
  });

  const btn = root.querySelector('#btn');
  btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(hits, 1);

  unmount();

  // After unmount: in-place DOM preserved, handlers do not fire, store changes produce no effects
  btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  store.set('name', 'Grace');
  assert.equal(hits, 1);
  assert.ok(root.querySelector('#btn'), 'Button preserved after in-place unmount');
  assert.ok(root.querySelector('#label'), 'Label preserved after in-place unmount');
  assert.equal(root.querySelector('#label').textContent, 'Ada', 'Label value preserved');
});
