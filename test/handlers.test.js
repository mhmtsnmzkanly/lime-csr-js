import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  createStore,
  createEngine,
  defineModule,
  attr,
  mount,
  unmount,
  setDevMode,
  subscribeDiagnostics,
} from '../src/index.js';

function installDom(markup = '') {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${markup}</body></html>`, {
    url: 'http://localhost/',
  });
  Object.assign(globalThis, {
    document: dom.window.document,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTemplateElement: dom.window.HTMLTemplateElement,
  });
  return dom;
}

test.beforeEach(() => setDevMode(false));
test.afterEach(() => setDevMode(true));

// ── 1. BASIC LOOKUP & INVOCATION ───────────────────────────────────────────────

test('handlers: single object payload { event, element, scope, store, data } passed to handler', () => {
  installDom(`
    <div id="target"></div>
    <template id="tpl-basic">
      <button id="btn" data-on-click="onClick">Click</button>
    </template>
  `);
  const target = document.getElementById('target');
  const store = createStore({ count: 10 });

  let received = null;
  const instance = mount({ target: target, template: 'basic', store: store, ...{
    handlers: {
      onClick(payload) {
        received = payload;
      },
    },
  } });

  const btn = target.querySelector('#btn');
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  assert.ok(received, 'Handler was called');
  assert.equal(received.element, btn);
  assert.equal(received.event.type, 'click');
  assert.equal(received.store, store);
  assert.equal(received.data, null);
  assert.ok(typeof received.scope === 'object');

  unmount(instance);
});

test('handlers: mounting event bindings does not rescan the completed target tree', () => {
  installDom('<div id="target"></div>');
  const target = document.getElementById('target');
  const querySelectorAll = target.querySelectorAll.bind(target);
  let targetScans = 0;
  target.querySelectorAll = (...args) => {
    targetScans++;
    return querySelectorAll(...args);
  };
  let calls = 0;

  const instance = mount({
    target,
    template: '<button id="btn" data-on-click="hit">Hit</button>',
    handlers: { hit() { calls++; } },
  });
  target.querySelectorAll = querySelectorAll;

  target.querySelector('#btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(calls, 1);
  assert.equal(targetScans, 0);

  unmount(instance);
});

// ── 2. MISSING HANDLER & PROTOTYPE-SAFE LOOKUP ────────────────────────────────

test('handlers: missing handler emits HANDLER_NOT_FOUND diagnostic', () => {
  installDom(`
    <div id="target"></div>
    <template id="tpl-missing">
      <button id="btn" data-on-click="nonExistent">Click</button>
    </template>
  `);
  const target = document.getElementById('target');
  const diagnostics = [];
  const unsub = subscribeDiagnostics((d) => diagnostics.push(d));

  const instance = mount({ target: target, template: 'missing', store: null, ...{
    handlers: {},
  } });

  target.querySelector('#btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));

  assert.ok(diagnostics.some((d) => d.code === 'HANDLER_NOT_FOUND'));

  unsub();
  unmount(instance);
});

test('handlers: prototype properties (toString, valueOf, constructor, __proto__) are blocked and emit HANDLER_NOT_FOUND', () => {
  installDom(`
    <div id="target"></div>
    <template id="tpl-proto">
      <button id="btn-toString" data-on-click="toString">toString</button>
      <button id="btn-valueOf" data-on-click="valueOf">valueOf</button>
      <button id="btn-constructor" data-on-click="constructor">constructor</button>
      <button id="btn-proto" data-on-click="__proto__">__proto__</button>
      <button id="btn-hasOwn" data-on-click="hasOwnProperty">hasOwnProperty</button>
    </template>
  `);
  const target = document.getElementById('target');
  const diagnostics = [];
  const unsub = subscribeDiagnostics((d) => diagnostics.push(d));

  const instance = mount({ target: target, template: 'proto', store: null, ...{
    handlers: {},
  } });

  const names = ['toString', 'valueOf', 'constructor', 'proto', 'hasOwn'];
  for (const name of names) {
    diagnostics.length = 0;
    target.querySelector(`#btn-${name}`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.ok(
      diagnostics.some((d) => d.code === 'HANDLER_NOT_FOUND'),
      `Expected HANDLER_NOT_FOUND for prohibited name "${name}"`,
    );
  }

  unsub();
  unmount(instance);
});

// ── 3. EXPLICIT DATA ATTRIBUTE RESOLUTION ─────────────────────────────────────

test('handlers: companion data attribute resolves scope paths, store paths, literals, and missing values', () => {
  installDom(`
    <div id="target"></div>
    <template id="tpl-data">
      <button id="btn-scope" data-on-click="onAction" data-on-click-data="user.id">Scope</button>
      <button id="btn-store" data-on-click="onAction" data-on-click-data="app.theme">Store</button>
      <button id="btn-str-sq" data-on-click="onAction" data-on-click-data="'single quoted'">Single</button>
      <button id="btn-str-dq" data-on-click="onAction" data-on-click-data='"double quoted"'>Double</button>
      <button id="btn-str-empty" data-on-click="onAction" data-on-click-data="''">Empty Str</button>
      <button id="btn-num-int" data-on-click="onAction" data-on-click-data="42">Int</button>
      <button id="btn-num-zero" data-on-click="onAction" data-on-click-data="0">Zero</button>
      <button id="btn-num-neg" data-on-click="onAction" data-on-click-data="-15">Neg</button>
      <button id="btn-num-float" data-on-click="onAction" data-on-click-data="3.14">Float</button>
      <button id="btn-bool-true" data-on-click="onAction" data-on-click-data="true">True</button>
      <button id="btn-bool-false" data-on-click="onAction" data-on-click-data="false">False</button>
      <button id="btn-null" data-on-click="onAction" data-on-click-data="null">Null</button>
      <button id="btn-missing" data-on-click="onAction" data-on-click-data="nonexistent.path">Missing</button>
      <button id="btn-empty-attr" data-on-click="onAction" data-on-click-data="">Empty Attr</button>
      <button id="btn-no-data" data-on-click="onAction">No Data</button>
    </template>
  `);
  const target = document.getElementById('target');
  const store = createStore({
    app: { theme: 'dark' },
  });

  const calls = [];
  const instance = mount({ target: target, template: 'data', store: store, ...{
    context: {
      user: { id: 101 },
    },
    handlers: {
      onAction({ data }) {
        calls.push(data);
      },
    },
  } });

  const click = (id) => target.querySelector(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));

  click('#btn-scope');
  assert.equal(calls[calls.length - 1], 101);

  click('#btn-store');
  assert.equal(calls[calls.length - 1], 'dark');

  click('#btn-str-sq');
  assert.equal(calls[calls.length - 1], 'single quoted');

  click('#btn-str-dq');
  assert.equal(calls[calls.length - 1], 'double quoted');

  click('#btn-str-empty');
  assert.equal(calls[calls.length - 1], '');

  click('#btn-num-int');
  assert.equal(calls[calls.length - 1], 42);

  click('#btn-num-zero');
  assert.equal(calls[calls.length - 1], 0);

  click('#btn-num-neg');
  assert.equal(calls[calls.length - 1], -15);

  click('#btn-num-float');
  assert.equal(calls[calls.length - 1], 3.14);

  click('#btn-bool-true');
  assert.equal(calls[calls.length - 1], true);

  click('#btn-bool-false');
  assert.equal(calls[calls.length - 1], false);

  click('#btn-null');
  assert.equal(calls[calls.length - 1], null);

  click('#btn-missing');
  assert.equal(calls[calls.length - 1], null);

  click('#btn-empty-attr');
  assert.equal(calls[calls.length - 1], null);

  click('#btn-no-data');
  assert.equal(calls[calls.length - 1], null);

  unmount(instance);
});

test('handlers: keyed events support corresponding companion data attribute', () => {
  installDom(`
    <div id="target"></div>
    <template id="tpl-keyed">
      <input id="input" data-on-keydown-enter="onEnter" data-on-keydown-enter-data="'saved'">
    </template>
  `);
  const target = document.getElementById('target');
  let receivedData = null;

  const instance = mount({ target: target, template: 'keyed', store: null, ...{
    handlers: {
      onEnter({ data }) {
        receivedData = data;
      },
    },
  } });

  const input = target.querySelector('#input');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  assert.equal(receivedData, 'saved');

  unmount(instance);
});

// ── 4. RETURN VALUES STRICTLY IGNORED ─────────────────────────────────────────

test('handlers: handler return values (false, true, object, promise) are strictly ignored', () => {
  installDom(`
    <div id="target"></div>
    <template id="tpl-returns">
      <a id="link-false" href="/test" data-on-click="retFalse">False</a>
      <a id="link-true" href="/test" data-on-click="retTrue">True</a>
      <a id="link-obj" href="/test" data-on-click="retObj">Obj</a>
      <a id="link-prom" href="/test" data-on-click="retProm">Promise</a>
      <form id="form-submit" data-on-submit="onSubmit"><button id="btn-submit" type="submit">Sub</button></form>
    </template>
  `);
  const target = document.getElementById('target');

  const instance = mount({ target: target, template: 'returns', store: null, ...{
    handlers: {
      retFalse() { return false; },
      retTrue() { return true; },
      retObj() { return { preventDefault: true }; },
      retProm() { return Promise.resolve(false); },
      onSubmit() { return true; },
    },
  } });

  const ev1 = new MouseEvent('click', { bubbles: true, cancelable: true });
  target.querySelector('#link-false').dispatchEvent(ev1);
  // In modern CSR runtime, return false does NOT call preventDefault()
  assert.equal(ev1.defaultPrevented, false);

  const ev2 = new MouseEvent('click', { bubbles: true, cancelable: true });
  target.querySelector('#link-true').dispatchEvent(ev2);
  assert.equal(ev2.defaultPrevented, false);

  const ev3 = new MouseEvent('click', { bubbles: true, cancelable: true });
  target.querySelector('#link-obj').dispatchEvent(ev3);
  assert.equal(ev3.defaultPrevented, false);

  const ev4 = new MouseEvent('click', { bubbles: true, cancelable: true });
  target.querySelector('#link-prom').dispatchEvent(ev4);
  assert.equal(ev4.defaultPrevented, false);

  // But submit event ALWAYS has default prevented
  const submitEv = new Event('submit', { bubbles: true, cancelable: true });
  target.querySelector('#form-submit').dispatchEvent(submitEv);
  assert.equal(submitEv.defaultPrevented, true);

  unmount(instance);
});

// ── 5. CUSTOM MODULE ACCESS VIA ctx.handlers ──────────────────────────────────

test('handlers: custom module accesses ctx.handlers from ModuleContext', () => {
  installDom(`
    <div id="target"></div>
    <template id="tpl-custom">
      <div id="box" data-custom-action="triggerCustom">Box</div>
    </template>
  `);
  const target = document.getElementById('target');
  let customReceived = null;

  const customModule = defineModule({
    name: 'custom-action-mod',
    triggers: [
      attr('data-custom-action', {
        phase: 'link',
        setup(el, _data, ctx) {
          const handlerName = el.getAttribute('data-custom-action');
          const handler = ctx.handlers?.[handlerName];
          if (typeof handler === 'function') {
            handler({ event: null, element: el, scope: ctx.scope, store: ctx.store, data: 'custom-val' });
          }
        },
      }),
    ],
  });

  const engine = createEngine({ modules: [customModule] });
  const instance = engine.mount({ target: target, template: 'custom', store: null, ...{
    handlers: {
      triggerCustom(payload) {
        customReceived = payload;
      },
    },
  } });

  assert.ok(customReceived, 'Custom module invoked handler');
  assert.equal(customReceived.data, 'custom-val');
  assert.equal(customReceived.element, target.querySelector('#box'));

  unmount(instance);
});

// ── 6. MOUNT & ENGINE ISOLATION ───────────────────────────────────────────────

test('handlers: separate mounts have isolated handlers and do not leak', () => {
  installDom(`
    <div id="target-a"></div>
    <div id="target-b"></div>
    <template id="tpl-iso">
      <button class="btn" data-on-click="act">Action</button>
    </template>
  `);
  const targetA = document.getElementById('target-a');
  const targetB = document.getElementById('target-b');

  const callsA = [];
  const callsB = [];

  const instA = mount({ target: targetA, template: 'iso', store: null, ...{
    handlers: { act() { callsA.push('A'); } },
  } });
  const instB = mount({ target: targetB, template: 'iso', store: null, ...{
    handlers: { act() { callsB.push('B'); } },
  } });

  targetA.querySelector('.btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.deepEqual(callsA, ['A']);
  assert.deepEqual(callsB, []);

  targetB.querySelector('.btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.deepEqual(callsA, ['A']);
  assert.deepEqual(callsB, ['B']);

  unmount(instA);
  unmount(instB);
});

// ── 7. RUNTIME HANDLERS MUTATION ──────────────────────────────────────────────

test('handlers: mutating handlers dictionary at runtime dynamically takes effect', () => {
  installDom(`
    <div id="target"></div>
    <template id="tpl-dyn">
      <button id="btn-one" data-on-click="handlerA">Btn 1</button>
      <button id="btn-two" data-on-click="handlerB">Btn 2</button>
    </template>
  `);
  const target = document.getElementById('target');
  const log = [];

  const handlersObj = {
    handlerA() { log.push('A-v1'); },
  };

  const instance = mount({ target: target, template: 'dyn', store: null, ...{
    handlers: handlersObj,
  } });

  target.querySelector('#btn-one').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.deepEqual(log, ['A-v1']);

  // Mutate existing handler
  handlersObj.handlerA = () => { log.push('A-v2'); };
  target.querySelector('#btn-one').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.deepEqual(log, ['A-v1', 'A-v2']);

  // Dynamically add previously undefined handler
  handlersObj.handlerB = () => { log.push('B-v1'); };
  target.querySelector('#btn-two').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.deepEqual(log, ['A-v1', 'A-v2', 'B-v1']);

  unmount(instance);
});

// ── 8. FAULT ISOLATION & MODULE_HANDLER_FAILED ─────────────────────────────────

test('handlers: synchronous throw inside handler reports MODULE_HANDLER_FAILED and isolates failure', () => {
  installDom(`
    <div id="target"></div>
    <template id="tpl-error">
      <button id="btn-throw" data-on-click="throwingHandler">Throw</button>
      <button id="btn-safe" data-on-click="safeHandler">Safe</button>
    </template>
  `);
  const target = document.getElementById('target');
  const diagnostics = [];
  const unsub = subscribeDiagnostics((d) => diagnostics.push(d));
  let safeCalled = false;

  const instance = mount({ target: target, template: 'error', store: null, ...{
    handlers: {
      throwingHandler() {
        throw new Error('Boom in sync handler');
      },
      safeHandler() {
        safeCalled = true;
      },
    },
  } });

  // Clicking throwing handler must not crash the application
  target.querySelector('#btn-throw').dispatchEvent(new MouseEvent('click', { bubbles: true }));

  assert.ok(
    diagnostics.some((d) => d.code === 'MODULE_HANDLER_FAILED' && (d.message.includes('throwingHandler') || d.context)),
    'Expected MODULE_HANDLER_FAILED diagnostic for synchronous throw',
  );

  // Subsequent events must continue to function normally
  target.querySelector('#btn-safe').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(safeCalled, true);

  unsub();
  unmount(instance);
});

test('handlers: async rejected promise inside handler reports MODULE_HANDLER_FAILED without unhandled rejection', async () => {
  installDom(`
    <div id="target"></div>
    <template id="tpl-async">
      <button id="btn-reject" data-on-click="asyncRejectHandler">Reject</button>
      <button id="btn-safe" data-on-click="safeHandler">Safe</button>
    </template>
  `);
  const target = document.getElementById('target');
  const diagnostics = [];
  const unsub = subscribeDiagnostics((d) => diagnostics.push(d));
  let safeCalled = false;

  const instance = mount({ target: target, template: 'async', store: null, ...{
    handlers: {
      async asyncRejectHandler() {
        throw new Error('Boom in async handler');
      },
      safeHandler() {
        safeCalled = true;
      },
    },
  } });

  target.querySelector('#btn-reject').dispatchEvent(new MouseEvent('click', { bubbles: true }));

  // Wait a microtask wave for promise rejection to settle
  await Promise.resolve();
  await new Promise((r) => globalThis.setTimeout(r, 10));

  assert.ok(
    diagnostics.some((d) => d.code === 'MODULE_HANDLER_FAILED' && (d.message.includes('asyncRejectHandler') || d.context)),
    'Expected MODULE_HANDLER_FAILED diagnostic for async rejection',
  );

  target.querySelector('#btn-safe').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(safeCalled, true);

  unsub();
  unmount(instance);
});

// ── 9. LIVE NODES IN DYNAMIC LOOPS WITH DATA ──────────────────────────────────

test('handlers: live nodes in dynamic loops receive item data and subsequent updates work seamlessly', () => {
  installDom(`
    <div id="target"></div>
    <template id="tpl-loop">
      <for each="items" as="item" key="item.id" data-live>
        <div class="row">
          <button class="del-btn" data-on-click="deleteItem" data-on-click-data="item.id">\${item.name}</button>
        </div>
      </for>
    </template>
  `);
  const target = document.getElementById('target');
  const store = createStore({
    items: [
      { id: 1, name: 'First' },
      { id: 2, name: 'Second' },
    ],
  });

  const deletedIds = [];
  const instance = mount({ target: target, template: 'loop', store: store, ...{
    handlers: {
      deleteItem({ data }) {
        deletedIds.push(data);
      },
    },
  } });

  const buttons = target.querySelectorAll('.del-btn');
  assert.equal(buttons.length, 2);

  buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(deletedIds[deletedIds.length - 1], 1);

  buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(deletedIds[deletedIds.length - 1], 2);

  // Add a new item dynamically to reactive store
  store.set('items', [
    { id: 1, name: 'First' },
    { id: 2, name: 'Second' },
    { id: 3, name: 'Third' },
  ]);

  const newButtons = target.querySelectorAll('.del-btn');
  assert.equal(newButtons.length, 3);

  // Click newly added button
  newButtons[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(deletedIds[deletedIds.length - 1], 3);

  unmount(instance);
});

// ── 10. COMPANION DATA PRECEDENCE & STORE FALLBACK ──────────────────────────

test('handlers: companion data attribute resolves from scope with precedence over store fallback', () => {
  installDom(`
    <div id="target"></div>
    <template id="tpl-precedence">
      <button id="btn" data-on-click="onAction" data-on-click-data="role">Click</button>
    </template>
  `);
  const target = document.getElementById('target');
  const store = createStore({ role: 'store-fallback-role' });
  const scope = { role: 'scope-priority-role' };

  let receivedData = null;
  const instance = mount({ target: target, template: 'precedence', store: store, ...{
    scope,
    handlers: {
      onAction({ data }) {
        receivedData = data;
      },
    },
  } });

  const btn = target.querySelector('#btn');
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  assert.equal(receivedData, 'scope-priority-role', 'Companion data must resolve from scope when key is present in both');

  unmount(instance);
});

test('handlers: companion data attribute falls back to store when absent in scope', () => {
  installDom(`
    <div id="target"></div>
    <template id="tpl-store-fallback">
      <button id="btn" data-on-click="onAction" data-on-click-data="storeOnlyKey">Click</button>
    </template>
  `);
  const target = document.getElementById('target');
  const store = createStore({ storeOnlyKey: 'from-store' });
  const scope = { otherKey: 'irrelevant' };

  let receivedData = null;
  const instance = mount({ target: target, template: 'store-fallback', store: store, ...{
    scope,
    handlers: {
      onAction({ data }) {
        receivedData = data;
      },
    },
  } });

  const btn = target.querySelector('#btn');
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  assert.equal(receivedData, 'from-store', 'Companion data must fall back to store when key absent in scope');

  unmount(instance);
});
