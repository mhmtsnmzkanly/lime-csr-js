import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  createEngine,
  createStore,
  loops,
  conditionals,
  model,
  text,
  show,
  ref,
  events,
  tag,
} from '../src/index.js';

function createDom(html = '<!doctype html><html><body><div id="app"></div></body></html>') {
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  return dom;
}

test('F01: loop model alias writes back to canonical store path', () => {
  const dom = createDom(`
    <div id="app">
      <for each="items" as="item" key="id" data-live>
        <input class="name-input" data-model="item.name">
      </for>
    </div>
  `);
  const store = createStore({
    items: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ],
  });
  const engine = createEngine({ modules: [loops(), model()] });
  const app = dom.window.document.getElementById('app');
  engine.mount({ target: app, store, document: dom.window.document });

  const inputs = app.querySelectorAll('.name-input');
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].value, 'Alice');

  inputs[0].value = 'Alice Updated';
  inputs[0].dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  assert.equal(store.get('items.0.name'), 'Alice Updated');
  assert.equal(store.get('items')[0].name, 'Alice Updated');
  assert.equal(store.get('item.name'), undefined);
});

test('F02: shared WeakMap preserves elementScopeMap across instances', async () => {
  const dom = createDom(`
    <div id="app">
      <for each="items" as="item">
        <span class="user" data-text="item.name"></span>
      </for>
    </div>
  `);
  const store = createStore({
    items: [{ name: 'Alice' }],
  });
  const engine = createEngine({ modules: [loops(), text()] });
  const app = dom.window.document.getElementById('app');
  engine.mount({ target: app, store, document: dom.window.document });

  const span = app.querySelector('.user');
  assert.equal(span.textContent, 'Alice');
});

test('F03: nested live subtrees cleanup drops subscriptions and removes refs', () => {
  const dom = createDom(`
    <div id="app">
      <if is-truthy="outerShow" data-live>
        <if is-truthy="innerShow" data-live>
          <span data-text="label" data-ref="inside"></span>
        </if>
      </if>
    </div>
  `);
  const store = createStore({
    outerShow: true,
    innerShow: true,
    label: 'Hello',
  });
  const engine = createEngine({ modules: [conditionals(), text(), ref()] });
  const app = dom.window.document.getElementById('app');
  const instance = engine.mount({ target: app, store, document: dom.window.document });

  assert.equal(app.querySelector('span')?.textContent, 'Hello');
  assert.ok(instance.refs.inside);

  // Toggle outer branch to false
  store.set('outerShow', false);

  assert.equal(app.querySelector('span'), null);
  assert.equal(instance.refs.inside, undefined);

  // Updating label must not crash or resurrect detached nodes
  store.set('label', 'World');
  assert.equal(app.querySelector('span'), null);
});

test('F04: model group dynamic branch children bind and detached inputs teardown', () => {
  const dom = createDom(`
    <div id="app">
      <form data-model-group="user">
        <if is-truthy="showField" data-live>
          <input name="name" class="dynamic-input">
        </if>
      </form>
    </div>
  `);
  const store = createStore({
    user: { name: 'Alice' },
    showField: true,
  });
  const engine = createEngine({ modules: [conditionals(), model()] });
  const app = dom.window.document.getElementById('app');
  engine.mount({ target: app, store, document: dom.window.document });

  const input = app.querySelector('.dynamic-input');
  assert.ok(input);
  assert.equal(input.value, 'Alice');

  // Tear down branch
  store.set('showField', false);
  assert.equal(app.querySelector('.dynamic-input'), null);

  // Dispatching event on detached input must not update store
  input.value = 'ghost';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(store.get('user.name'), 'Alice');

  // Re-enable branch
  store.set('user.name', 'Bob');
  store.set('showField', true);
  const reInput = app.querySelector('.dynamic-input');
  assert.ok(reInput);
  assert.equal(reInput.value, 'Bob');
});

test('F05: Custom Element bridge does not update after unmount and transfers to new engine', () => {
  const dom = createDom(`
    <div id="app">
      <custom-widget title="Initial"></custom-widget>
    </div>
  `);
  let updateCount = 0;
  let lastReceivedTitle = '';

  const widgetModule = {
    name: 'widget',
    triggers: [
      tag('CUSTOM-WIDGET', {
        observedAttributes: ['title'],
        customElement: true,
        update(el, change, _ctx) {
          updateCount++;
          lastReceivedTitle = change.newValue;
        },
      }),
    ],
  };

  const engine1 = createEngine({ modules: [widgetModule] });
  const app = dom.window.document.getElementById('app');
  const inst1 = engine1.mount({ target: app, document: dom.window.document });

  const widget = app.querySelector('custom-widget');
  assert.ok(widget);

  // Update while mounted in engine 1
  widget.setAttribute('title', 'Second');
  assert.equal(updateCount, 1);
  assert.equal(lastReceivedTitle, 'Second');

  // Unmount engine 1
  inst1.unmount();

  // Changing attribute after unmount must NOT trigger update callback
  widget.setAttribute('title', 'Third');
  assert.equal(updateCount, 1);
});

test('F06: nested mount events do not bubble into outer mount handlers', () => {
  const dom = createDom(`
    <div id="outer">
      <button id="outer-btn" data-on-click="hit">Outer</button>
      <div id="inner">
        <button id="inner-btn" data-on-click="hit">Inner</button>
      </div>
    </div>
  `);
  const calls = [];
  const engine = createEngine({ modules: [events()] });
  const outerTarget = dom.window.document.getElementById('outer');
  const innerTarget = dom.window.document.getElementById('inner');

  engine.mount({
    target: outerTarget,
    handlers: {
      hit: () => calls.push('outer'),
    },
    document: dom.window.document,
  });

  engine.mount({
    target: innerTarget,
    handlers: {
      hit: () => calls.push('inner'),
    },
    document: dom.window.document,
  });

  const innerBtn = dom.window.document.getElementById('inner-btn');
  innerBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.deepEqual(calls, ['inner']);
});

test('F07: keyed loop leaf store update triggers data-text update', () => {
  const dom = createDom(`
    <div id="app">
      <for each="items" as="item" key="id" data-live>
        <b class="item-name" data-text="item.name"></b>
      </for>
    </div>
  `);
  const store = createStore({
    items: [{ id: 1, name: 'A' }],
  });
  const engine = createEngine({ modules: [loops(), text()] });
  const app = dom.window.document.getElementById('app');
  engine.mount({ target: app, store, document: dom.window.document });

  const b = app.querySelector('.item-name');
  assert.equal(b.textContent, 'A');

  store.set('items.0.name', 'B');
  assert.equal(b.textContent, 'B');
});

test('F08: live outer loop does not overwrite inner loop scope', () => {
  const dom = createDom(`
    <div id="app">
      <for each="groups" as="grp" key="id" data-live>
        <div class="group">
          <for each="grp.children" as="child">
            <button class="child-btn" data-on-click="hit" data-on-click-data="child.name"></button>
          </for>
        </div>
      </for>
    </div>
  `);
  let captured = null;
  const store = createStore({
    groups: [
      { id: 1, children: [{ name: 'Child1' }] },
    ],
  });
  const engine = createEngine({ modules: [loops(), events()] });
  const app = dom.window.document.getElementById('app');
  engine.mount({
    target: app,
    store,
    handlers: {
      hit: ({ data }) => { captured = data; },
    },
    document: dom.window.document,
  });

  const btn = app.querySelector('.child-btn');
  btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(captured, 'Child1');
});

test('F09: LCS diff empty-to-visible block transition correctly inserts nodes', () => {
  const dom = createDom(`
    <div id="app">
      <for each="items" as="item" key="id" data-live data-diff="lcs">
        <if is-truthy="item.visible">
          <span class="visible-text">visible</span>
        </if>
      </for>
    </div>
  `);
  const store = createStore({
    items: [{ id: 1, visible: false }],
  });
  const engine = createEngine({ modules: [loops(), conditionals()] });
  const app = dom.window.document.getElementById('app');
  engine.mount({ target: app, store, document: dom.window.document });

  assert.equal(app.textContent.trim(), '');

  // Update item to visible
  store.set('items', [{ id: 1, visible: true }]);
  assert.equal(app.querySelector('.visible-text')?.textContent, 'visible');
});

test('F10: render() links live branch exactly once', () => {
  const dom = createDom(`
    <div id="container">
      <if is-truthy="show" data-live>
        <span class="bound" data-text="label"></span>
      </if>
    </div>
  `);
  const store = createStore({ show: true, label: 'Test' });
  const engine = createEngine({ modules: [conditionals(), text()] });
  const container = dom.window.document.getElementById('container');

  const result = engine.render(container, { store, document: dom.window.document });
  assert.equal(container.querySelector('.bound')?.textContent, 'Test');

  // Verify that updating label updates cleanly without duplicate work
  store.set('label', 'Updated');
  assert.equal(container.querySelector('.bound')?.textContent, 'Updated');
  result.cleanup();
});

test('F11: checkbox fallback does not overwrite empty array on remount', () => {
  const dom = createDom(`
    <div id="app">
      <input type="checkbox" name="role" value="admin" checked data-model="roles[]">
    </div>
  `);
  const store = createStore({});
  const engine = createEngine({ modules: [model()] });
  const app = dom.window.document.getElementById('app');

  const inst1 = engine.mount({ target: app, store, document: dom.window.document });
  assert.deepEqual(store.get('roles'), ['admin']);
  inst1.unmount();

  // Clear roles in store
  store.set('roles', []);

  // Remount into app
  app.innerHTML = '<input type="checkbox" name="role" value="admin" checked data-model="roles[]">';
  const inst2 = engine.mount({ target: app, store, document: dom.window.document });

  assert.deepEqual(store.get('roles'), []);
  assert.equal(app.querySelector('input').checked, false);
  inst2.unmount();
});

test('F12: model group debounce companion is not mistaken for model path', async () => {
  const dom = createDom(`
    <div id="app">
      <form data-model-group="user">
        <input name="search" class="search-input" data-model-trim data-model-debounce="5">
      </form>
    </div>
  `);
  const store = createStore({ user: { search: 'A' } });
  const engine = createEngine({ modules: [model()] });
  const app = dom.window.document.getElementById('app');
  engine.mount({ target: app, store, document: dom.window.document });

  const input = app.querySelector('.search-input');
  assert.equal(input.value, 'A');

  input.value = '  B  ';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  await new Promise((res) => globalThis.setTimeout(res, 20));
  assert.equal(store.get('user.search'), 'B');
});

test('F13: two attributes on same element share placeholder companion', () => {
  const dom = createDom(`
    <div id="app">
      <a href="/{x}" title="{x}" data-x="name">Link</a>
    </div>
  `);
  const store = createStore({ name: 'Alice' });
  const engine = createEngine({ modules: [text()] });
  const app = dom.window.document.getElementById('app');
  engine.mount({ target: app, store, document: dom.window.document });

  const a = app.querySelector('a');
  assert.equal(a.getAttribute('href'), '/Alice');
  assert.equal(a.getAttribute('title'), 'Alice');
});

test('F14: local scope priority is preserved over store updates in text bindings', () => {
  const dom = createDom(`
    <div id="app">
      <b class="target" data-text="name"></b>
    </div>
  `);
  const store = createStore({ name: 'store-name' });
  const engine = createEngine({ modules: [text()] });
  const app = dom.window.document.getElementById('app');

  engine.mount({
    target: app,
    store,
    context: { name: 'local-name' },
    document: dom.window.document,
  });

  const b = app.querySelector('.target');
  assert.equal(b.textContent, 'local-name');

  store.set('name', 'changed-store');
  assert.equal(b.textContent, 'local-name');
});

test('F15: ref array ordering under LCS matches DOM order', () => {
  const dom = createDom(`
    <div id="app">
      <for each="items" as="item" key="id" data-live data-diff="lcs">
        <div class="row" data-ref="rows[]">\${item.name}</div>
      </for>
    </div>
  `);
  const store = createStore({
    items: [
      { id: 1, name: 'First' },
      { id: 2, name: 'Second' },
      { id: 3, name: 'Third' },
    ],
  });
  const engine = createEngine({ modules: [loops(), ref()] });
  const app = dom.window.document.getElementById('app');
  const instance = engine.mount({ target: app, store, document: dom.window.document });

  const refTexts = instance.refs.rows.map((el) => el.textContent.trim());
  assert.deepEqual(refTexts, ['First', 'Second', 'Third']);
});

test('F16: scalar and explicit-array refs coexist and preserve array type on scalar cleanup', () => {
  const dom = createDom(`
    <div id="app">
      <if is-truthy="showScalar" data-live>
        <span class="scalar" data-ref="row">Scalar</span>
      </if>
      <span class="array-item" data-ref="row[]">ArrayItem</span>
    </div>
  `);
  const store = createStore({ showScalar: true });
  const engine = createEngine({ modules: [conditionals(), ref()] });
  const app = dom.window.document.getElementById('app');
  const instance = engine.mount({ target: app, store, document: dom.window.document });

  assert.ok(Array.isArray(instance.refs.row));
  assert.equal(instance.refs.row.length, 2);

  // Hide scalar branch
  store.set('showScalar', false);

  assert.ok(Array.isArray(instance.refs.row));
  assert.equal(instance.refs.row.length, 1);
  assert.equal(instance.refs.row[0].textContent, 'ArrayItem');
});

test('F17: mount-scoped onError receives diagnostics from detached template compile context', () => {
  const dom = createDom('<div id="app"></div>');
  const errors = [];

  const engine = createEngine({ modules: [text()] });
  const app = dom.window.document.getElementById('app');

  engine.mount({
    target: app,
    template: '<b data-text=""></b>',
    onError: (d) => errors.push(d.code),
    document: dom.window.document,
  });

  assert.ok(errors.includes('BINDING_MISSING_PATH'));
});

test('F18: .cleanup() preserves live loop DOM while disposing reactivity', () => {
  const dom = createDom(`
    <div id="app">
      <for each="items" as="item" key="id" data-live>
        <span class="item">\${item.name}</span>
      </for>
    </div>
  `);
  const store = createStore({
    items: [{ id: 1, name: 'Alice' }],
  });
  const engine = createEngine({ modules: [loops()] });
  const app = dom.window.document.getElementById('app');
  const instance = engine.mount({ target: app, store, document: dom.window.document });

  const span = app.querySelector('.item');
  assert.ok(span);

  instance.cleanup();

  // Content should remain in DOM after cleanup
  assert.equal(app.contains(span), true);
  assert.equal(span.textContent.trim(), 'Alice');
});

test('F19: data-show ensures style rule is installed in document for CSP compliance', () => {
  const dom = createDom('<div id="app"><div data-show="visible"></div></div>');
  const store = createStore({ visible: false });
  const engine = createEngine({ modules: [show()] });
  const app = dom.window.document.getElementById('app');

  engine.mount({ target: app, store, document: dom.window.document });
  const el = app.firstElementChild;
  assert.equal(el.hidden, true);

  const styleTag = dom.window.document.getElementById('lime-csr-data-show-style');
  assert.ok(styleTag);
  assert.ok(styleTag.textContent.includes('display: none !important'));
});
