import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { createEngine, createStore, setDevMode, subscribeDiagnostics } from '../src/index.js';
import { text, show, model, events, loops } from '../src/modules/index.js';

function createDom(html = '') {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.Element = dom.window.Element;
  return dom;
}

test.beforeEach(() => {
  setDevMode(false);
});

// ── FINDING D REGRESSION SUITE ───────────────────────────────────────────────

test('loops-audit: missing key object and primitive items emit FOR_MISSING_KEY diagnostic while rendering valid items', () => {
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diag) => {
    diagnostics.push(diag);
  });

  const dom = createDom(`
    <div id="root">
      <for each="items" as="item" key="id" data-live>
        <div class="row" data-text="item.name"></div>
      </for>
    </div>
  `);

  const store = createStore({
    items: [
      { id: 1, name: 'Item 1' },
      { name: 'Missing Key' },
      'primitive item',
      { id: 2, name: 'Item 2' },
    ],
  });

  const engine = createEngine({ modules: [loops(), text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({ target: root, store, document: dom.window.document });

  unsubscribe();

  // Valid items render correctly
  const rows = Array.from(root.querySelectorAll('.row')).map((el) => el.textContent);
  assert.deepEqual(rows, ['Item 1', 'Item 2']);

  // Diagnostics emitted for missing key object and primitive item
  const missingKeyDiags = diagnostics.filter((d) => d.code === 'FOR_MISSING_KEY');
  assert.equal(missingKeyDiags.length, 2);
  assert.equal(missingKeyDiags[0].details.index, 1);
  assert.equal(missingKeyDiags[1].details.index, 2);
});

test('loops-audit: duplicate key emits FOR_DUPLICATE_KEY and only first instance renders', () => {
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diag) => {
    diagnostics.push(diag);
  });

  const dom = createDom(`
    <div id="root">
      <for each="items" as="item" key="id" data-live>
        <div class="row" data-text="item.name"></div>
      </for>
    </div>
  `);

  const store = createStore({
    items: [
      { id: 'dup', name: 'First Dup' },
      { id: 'dup', name: 'Second Dup' },
      { id: 'unique', name: 'Unique' },
    ],
  });

  const engine = createEngine({ modules: [loops(), text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({ target: root, store, document: dom.window.document });

  unsubscribe();

  const rows = Array.from(root.querySelectorAll('.row')).map((el) => el.textContent);
  assert.deepEqual(rows, ['First Dup', 'Unique']);

  const dupDiags = diagnostics.filter((d) => d.code === 'FOR_DUPLICATE_KEY');
  assert.equal(dupDiags.length, 1);
  assert.equal(dupDiags[0].details.keyVal, 'dup');
});

// ── FINDING E REGRESSION SUITE ───────────────────────────────────────────────

test('loops-audit: shallow-equal immutable item replacement preserves DOM identity but refreshes scope and handler payload', () => {
  const dom = createDom(`
    <div id="root">
      <for each="items" as="item" key="id" data-live>
        <div class="item-block">
          <span class="name" data-text="item.name"></span>
          <button class="action-btn" data-on-click="handleClick" data-on-click-data="item">Click</button>
        </div>
      </for>
    </div>
  `);

  let receivedPayload = null;
  const originalObj = { id: 1, name: 'Alice' };

  const store = createStore({
    items: [originalObj],
  });

  const engine = createEngine({ modules: [loops(), text(), events()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({
    target: root,
    store,
    document: dom.window.document,
    handlers: {
      handleClick({ data }) {
        receivedPayload = data;
      },
    },
  });

  const initialBlock = root.querySelector('.item-block');
  const initialButton = root.querySelector('.action-btn');

  // Trigger initial click
  initialButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(receivedPayload, originalObj);

  // Replace with a shallow-equal new object reference
  const newObj = { ...originalObj };
  assert.notEqual(newObj, originalObj);
  store.set('items', [newObj]);

  // 1. DOM identity is preserved (no unnecessary DOM replacement)
  const afterBlock = root.querySelector('.item-block');
  assert.equal(afterBlock, initialBlock);

  // 2. Click handler payload reflects the new object reference!
  initialButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(receivedPayload, newObj);
  assert.notEqual(receivedPayload, originalObj);
});

test('loops-audit: reorder + immutable replacement combination preserves DOM and updates scope', () => {
  const dom = createDom(`
    <div id="root">
      <for each="items" as="item" key="id" data-live>
        <div class="item-block">
          <span class="title" data-text="item.title"></span>
          <button class="btn" data-on-click="record" data-on-click-data="item"></button>
        </div>
      </for>
    </div>
  `);

  let clickedItem = null;
  const a1 = { id: 'A', title: 'Item A' };
  const b1 = { id: 'B', title: 'Item B' };

  const store = createStore({ items: [a1, b1] });
  const engine = createEngine({ modules: [loops(), text(), events()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({
    target: root,
    store,
    document: dom.window.document,
    handlers: {
      record({ data }) {
        clickedItem = data;
      },
    },
  });

  const [domA, domB] = Array.from(root.querySelectorAll('.item-block'));

  // Reorder and replace with shallow copies
  const a2 = { ...a1 };
  const b2 = { ...b1 };
  store.set('items', [b2, a2]);

  const [currentFirst, currentSecond] = Array.from(root.querySelectorAll('.item-block'));
  // DOM nodes were moved, not recreated
  assert.equal(currentFirst, domB);
  assert.equal(currentSecond, domA);

  // Clicking current first (B) gives b2
  currentFirst.querySelector('.btn').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(clickedItem, b2);

  // Clicking current second (A) gives a2
  currentSecond.querySelector('.btn').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(clickedItem, a2);
});

// ── FINDING H REGRESSION SUITE ───────────────────────────────────────────────

test('loops-audit: index attribute re-renders moved items with updated index', () => {
  const dom = createDom(`
    <div id="root">
      <for each="items" as="item" index="i" key="id" data-live>
        <div class="indexed-row">
          <span class="idx" data-text="i"></span>
          <span class="name" data-text="item.name"></span>
        </div>
      </for>
    </div>
  `);

  const store = createStore({
    items: [
      { id: 'x', name: 'Item X' },
      { id: 'y', name: 'Item Y' },
    ],
  });

  const engine = createEngine({ modules: [loops(), text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({ target: root, store, document: dom.window.document });

  const initialRows = Array.from(root.querySelectorAll('.indexed-row'));
  const getRowTexts = () => Array.from(root.querySelectorAll('.indexed-row')).map((r) => [
    r.querySelector('.idx').textContent,
    r.querySelector('.name').textContent,
  ]);

  assert.deepEqual(getRowTexts(), [
    ['0', 'Item X'],
    ['1', 'Item Y'],
  ]);

  // Reorder items: X moved from 0 to 1, Y moved from 1 to 0
  store.set('items', [
    { id: 'y', name: 'Item Y' },
    { id: 'x', name: 'Item X' },
  ]);

  // Rerendered with updated indices!
  assert.deepEqual(getRowTexts(), [
    ['0', 'Item Y'],
    ['1', 'Item X'],
  ]);

  const afterRows = Array.from(root.querySelectorAll('.indexed-row'));
  // Because index changed, blocks re-rendered
  assert.notEqual(afterRows[0], initialRows[1]);
  assert.notEqual(afterRows[1], initialRows[0]);
});

test('loops-audit: loop without index attribute preserves DOM node identity during reorder', () => {
  const dom = createDom(`
    <div id="root">
      <for each="items" as="item" key="id" data-live>
        <div class="row">
          <span class="name" data-text="item.name"></span>
        </div>
      </for>
    </div>
  `);

  const store = createStore({
    items: [
      { id: 'x', name: 'Item X' },
      { id: 'y', name: 'Item Y' },
    ],
  });

  const engine = createEngine({ modules: [loops(), text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({ target: root, store, document: dom.window.document });

  const [initialX, initialY] = Array.from(root.querySelectorAll('.row'));

  // Reorder
  store.set('items', [
    { id: 'y', name: 'Item Y' },
    { id: 'x', name: 'Item X' },
  ]);

  const [afterFirst, afterSecond] = Array.from(root.querySelectorAll('.row'));
  assert.equal(afterFirst, initialY);
  assert.equal(afterSecond, initialX);
});
