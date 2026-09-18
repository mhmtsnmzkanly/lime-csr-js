import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mount, render, createStore, subscribeDiagnostics } from '../src/index.js';

function createDom(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'http://localhost/',
  });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.NodeFilter = dom.window.NodeFilter;
  return dom;
}

test('ref: single element registers into app.refs', () => {
  const dom = createDom(`
    <div id="app">
      <input type="text" id="username" data-ref="usernameInput">
    </div>
  `);
  const root = dom.window.document.getElementById('app');
  const app = mount({ target: root });

  const inputEl = dom.window.document.getElementById('username');
  assert.equal(app.refs.usernameInput, inputEl);

  app.unmount();
  assert.equal(app.refs.usernameInput, undefined);
});

test('ref: empty data-ref emits REF_MISSING_NAME diagnostic', () => {
  const dom = createDom(`
    <div id="app">
      <input type="text" data-ref="">
    </div>
  `);
  const root = dom.window.document.getElementById('app');
  const diagnostics = [];
  const unsub = subscribeDiagnostics((d) => diagnostics.push(d));

  const app = mount({ target: root });
  unsub();

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'REF_MISSING_NAME');
  app.unmount();
});

test('ref: multiple elements with same data-ref collect into an array', () => {
  const dom = createDom(`
    <div id="app">
      <button id="b1" data-ref="actionBtn">1</button>
      <button id="b2" data-ref="actionBtn">2</button>
      <button id="b3" data-ref="actionBtn">3</button>
    </div>
  `);
  const root = dom.window.document.getElementById('app');
  const app = mount({ target: root });

  const b1 = dom.window.document.getElementById('b1');
  const b2 = dom.window.document.getElementById('b2');
  const b3 = dom.window.document.getElementById('b3');

  assert.ok(Array.isArray(app.refs.actionBtn));
  assert.deepEqual(app.refs.actionBtn, [b1, b2, b3]);

  app.unmount();
  assert.equal(app.refs.actionBtn, undefined);
});

test('ref: explicit array suffix [] always initializes as array', () => {
  const dom = createDom(`
    <div id="app">
      <div id="card1" data-ref="cards[]">Card 1</div>
    </div>
  `);
  const root = dom.window.document.getElementById('app');
  const app = mount({ target: root });

  const card1 = dom.window.document.getElementById('card1');
  assert.ok(Array.isArray(app.refs.cards));
  assert.deepEqual(app.refs.cards, [card1]);
  assert.equal(app.refs['cards[]'], app.refs.cards);

  app.unmount();
  assert.equal(app.refs.cards, undefined);
});

test('ref: event handler receives refs in payload', () => {
  const dom = createDom(`
    <div id="app">
      <input type="text" id="target-input" data-ref="myInput" value="initial">
      <button id="trigger-btn" data-on-click="checkRef">Click</button>
    </div>
  `);
  const root = dom.window.document.getElementById('app');
  let capturedRefs = null;

  const app = mount({
    target: root,
    handlers: {
      checkRef({ refs }) {
        capturedRefs = refs;
      },
    },
  });

  const btn = dom.window.document.getElementById('trigger-btn');
  btn.click();

  assert.ok(capturedRefs);
  assert.equal(capturedRefs.myInput, dom.window.document.getElementById('target-input'));

  app.unmount();
});

test('ref: reactive <if data-live> deregisters ref on branch exit and reregisters on branch enter', () => {
  const dom = createDom(`
    <div id="app">
      <if is-truthy="showField" data-live>
        <input type="text" id="conditional-input" data-ref="secretInput">
        <else>
          <span id="fallback-span">Hidden</span>
        </else>
      </if>
    </div>
  `);
  const root = dom.window.document.getElementById('app');
  const store = createStore({ showField: true });
  const app = mount({ target: root, store });

  assert.ok(app.refs.secretInput);
  assert.equal(app.refs.secretInput.id, 'conditional-input');

  // Switch condition to false
  store.set('showField', false);
  assert.equal(app.refs.secretInput, undefined);

  // Switch condition back to true
  store.set('showField', true);
  assert.ok(app.refs.secretInput);
  assert.equal(app.refs.secretInput.id, 'conditional-input');

  app.unmount();
  assert.equal(app.refs.secretInput, undefined);
});

test('ref: reactive <for data-live> maintains array refs across additions and removals', () => {
  const dom = createDom(`
    <div id="app">
      <for each="items" as="item" data-live key="item.id">
        <div data-ref="itemCards[]">\${item.name}</div>
      </for>
    </div>
  `);
  const root = dom.window.document.getElementById('app');
  const store = createStore({
    items: [
      { id: '1', name: 'First' },
      { id: '2', name: 'Second' },
      { id: '3', name: 'Third' },
    ],
  });
  const app = mount({ target: root, store });

  assert.ok(Array.isArray(app.refs.itemCards));
  assert.equal(app.refs.itemCards.length, 3);
  assert.equal(app.refs.itemCards[0].textContent, 'First');
  assert.equal(app.refs.itemCards[1].textContent, 'Second');
  assert.equal(app.refs.itemCards[2].textContent, 'Third');

  // Remove middle item
  store.set('items', [
    { id: '1', name: 'First' },
    { id: '3', name: 'Third' },
  ]);

  assert.equal(app.refs.itemCards.length, 2);
  assert.equal(app.refs.itemCards[0].textContent, 'First');
  assert.equal(app.refs.itemCards[1].textContent, 'Third');

  // Clear all items
  store.set('items', []);
  assert.equal(app.refs.itemCards, undefined);

  app.unmount();
});

test('ref: render() returns refs map and exposes cleanup.refs', () => {
  const dom = createDom('<div id="root"><span data-ref="label">Hello</span></div>');
  const root = dom.window.document.getElementById('root');

  const instance = render(root);
  assert.ok(instance.refs);
  assert.equal(instance.refs.label, root.querySelector('span'));

  instance.cleanup();
  assert.equal(instance.refs.label, undefined);
});
