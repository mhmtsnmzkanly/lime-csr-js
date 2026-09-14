import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  mount,
  createStore,
  subscribeDiagnostics,
} from '../src/index.js';

test('live for updates item content in-place when item properties change', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <template id="tpl-todo-list">
          <ul id="list">
            <for data-live each="todos" as="todo" key="todo.id">
              <li id="todo-\${todo.id}">
                <span class="text">\${todo.text}</span>
                <span class="status">\${todo.status}</span>
              </li>
            </for>
          </ul>
        </template>
        <main id="app"></main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const store = createStore({
    todos: [
      { id: 1, text: 'Clean room', status: 'pending' },
      { id: 2, text: 'Write tests', status: 'pending' },
    ],
  });

  const target = document.getElementById('app');
  mount({ target: target, template: 'todo-list', store: store });

  const initialLi1 = target.querySelector('#todo-1');
  const initialLi2 = target.querySelector('#todo-2');
  assert.equal(initialLi1.querySelector('.text').textContent, 'Clean room');
  assert.equal(initialLi2.querySelector('.text').textContent, 'Write tests');

  // Update item 1 in-place, leave item 2 untouched
  store.set('todos', [
    { id: 1, text: 'Clean room completely', status: 'done' },
    { id: 2, text: 'Write tests', status: 'pending' },
  ]);

  const updatedLi1 = target.querySelector('#todo-1');
  const updatedLi2 = target.querySelector('#todo-2');

  // Item 1 was updated with new text and status
  assert.equal(updatedLi1.querySelector('.text').textContent, 'Clean room completely');
  assert.equal(updatedLi1.querySelector('.status').textContent, 'done');

  // Item 2 was NOT changed, so its DOM node identity was preserved
  assert.equal(updatedLi2, initialLi2);
  assert.equal(updatedLi2.querySelector('.text').textContent, 'Write tests');
});

test('live for preserves DOM identity and active focus during sort/reorder', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <template id="tpl-focus-list">
          <div id="container">
            <for data-live each="items" as="item" key="item.id">
              <div class="row" id="item-\${item.id}">
                <input id="input-\${item.id}" value="\${item.val}">
              </div>
            </for>
          </div>
        </template>
        <main id="app"></main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const store = createStore({
    items: [
      { id: 'a', val: 'Alpha' },
      { id: 'b', val: 'Beta' },
      { id: 'c', val: 'Gamma' },
    ],
  });

  const target = document.getElementById('app');
  mount({ target: target, template: 'focus-list', store: store });

  const inputB = target.querySelector('#input-b');
  const rowB = target.querySelector('#item-b');
  assert.ok(inputB);
  inputB.focus();
  inputB.value = 'User is typing...';

  // Reverse list: new object literals with same content (typical immutable state pattern)
  store.set('items', [
    { id: 'c', val: 'Gamma' },
    { id: 'b', val: 'Beta' },
    { id: 'a', val: 'Alpha' },
  ]);

  const rows = target.querySelectorAll('.row');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].id, 'item-c');
  assert.equal(rows[1].id, 'item-b');
  assert.equal(rows[2].id, 'item-a');

  // Row B and input B preserved exact DOM identity and user typing state!
  assert.equal(rows[1], rowB);
  assert.equal(target.querySelector('#input-b'), inputB);
  assert.equal(inputB.value, 'User is typing...');
});

test('live for with lcs preserves activeElement focus on stay-put items during reorder', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <template id="tpl-focus-stayput">
          <div id="container">
            <for data-live data-diff="lcs" each="items" as="item" key="item.id">
              <div class="row" id="item-\${item.id}">
                <input id="input-\${item.id}" value="\${item.val}">
              </div>
            </for>
          </div>
        </template>
        <main id="app"></main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const store = createStore({
    items: [
      { id: 'a', val: 'Alpha' },
      { id: 'b', val: 'Beta' },
      { id: 'c', val: 'Gamma' },
    ],
  });

  const target = document.getElementById('app');
  mount({ target: target, template: 'focus-stayput', store: store });

  const inputB = target.querySelector('#input-b');
  inputB.focus();
  assert.equal(dom.window.document.activeElement, inputB);

  // Move 'c' to front: [c, a, b]. 'a' and 'b' form the LIS and stay put in DOM
  store.set('items', [
    { id: 'c', val: 'Gamma' },
    { id: 'a', val: 'Alpha' },
    { id: 'b', val: 'Beta' },
  ]);

  // inputB stayed put, so focus is preserved
  assert.equal(dom.window.document.activeElement, inputB);
});

test('live for with lcs strategy updates item in-place and preserves unmutated items', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <template id="tpl-lcs-list">
          <div id="container">
            <for data-live data-diff="lcs" each="items" as="item" key="item.id">
              <div class="item" id="item-\${item.id}">
                <span class="label">\${item.label}</span>
              </div>
            </for>
          </div>
        </template>
        <main id="app"></main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const store = createStore({
    items: [
      { id: 1, label: 'One' },
      { id: 2, label: 'Two' },
      { id: 3, label: 'Three' },
    ],
  });

  const target = document.getElementById('app');
  mount({ target: target, template: 'lcs-list', store: store });

  const initialItem2 = target.querySelector('#item-2');
  const initialItem3 = target.querySelector('#item-3');

  // Reorder and update item 1 while keeping 2 and 3 unchanged
  store.set('items', [
    { id: 3, label: 'Three' },
    { id: 1, label: 'One Updated' },
    { id: 2, label: 'Two' },
  ]);

  const items = target.querySelectorAll('.item');
  assert.equal(items[0].id, 'item-3');
  assert.equal(items[1].id, 'item-1');
  assert.equal(items[2].id, 'item-2');

  assert.equal(items[1].querySelector('.label').textContent, 'One Updated');
  // Items 2 and 3 preserved DOM identity
  assert.equal(items[0], initialItem3);
  assert.equal(items[2], initialItem2);
});

test('template[data-for][data-live] works inside tables and updates in-place', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <template id="tpl-table-live">
          <table id="tbl">
            <tbody>
              <template data-for data-live each="rows" as="r" key="r.id">
                <tr id="row-\${r.id}"><td>\${r.name}</td></tr>
              </template>
            </tbody>
          </table>
        </template>
        <main id="app"></main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const store = createStore({
    rows: [
      { id: 10, name: 'Row 10' },
      { id: 20, name: 'Row 20' },
    ],
  });

  const target = document.getElementById('app');
  mount({ target: target, template: 'table-live', store: store });

  let trs = target.querySelectorAll('tr');
  assert.equal(trs.length, 2);
  assert.equal(trs[0].textContent, 'Row 10');
  assert.equal(trs[1].textContent, 'Row 20');

  // Update Row 10 name
  store.set('rows', [
    { id: 10, name: 'Row 10 Modified' },
    { id: 20, name: 'Row 20' },
  ]);

  trs = target.querySelectorAll('tr');
  assert.equal(trs[0].textContent, 'Row 10 Modified');
  assert.equal(trs[1].textContent, 'Row 20');
});

test('live for: unknown data-diff strategy reports a diagnostic and uses simple reconciliation', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <template id="tpl-invalid-diff">
          <for data-live data-diff="invalid" each="items" as="item" key="item.id">
            <span class="item">\${item.name}</span>
          </for>
        </template>
        <main id="app"></main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
  const store = createStore({ items: [{ id: 1, name: 'Initial' }] });
  const target = document.getElementById('app');

  try {
    mount({ target: target, template: 'invalid-diff', store: store });
    store.set('items', [{ id: 1, name: 'Updated' }]);

    assert.equal(target.querySelector('.item').textContent, 'Updated');
    assert.ok(diagnostics.some((diagnostic) => diagnostic.code === 'UNKNOWN_DIFF_STRATEGY'));
  } finally {
    unsubscribe();
  }
});
