import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  createEngine,
  defineModule,
  attr,
  tag,
  createScope,
  setElementScope,
  getElementScope,
} from '../src/core/index.js';
import { createStore } from '../src/store.js';
import { events } from '../src/modules/events.js';
import { text } from '../src/modules/text.js';
import { setDevMode } from '../src/errors.js';

function createDom(html = '') {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
}

test.beforeEach(() => {
  setDevMode(false);
});

// ── 1. ENGINE MODULES SHARED & MOUNT-SCOPED CAPABILITIES ISOLATED ───────────

test('architecture: single engine with two mounts shares modules but strictly isolates stores, handlers, scopes, and cleanups', () => {
  const customEvents = [];
  const customMod = defineModule({
    name: 'custom-widget',
    triggers: [
      attr('data-widget', {
        phase: 'link',
        setup(el, data, ctx) {
          customEvents.push({
            id: el.id,
            val: el.getAttribute('data-widget'),
            storeVal: ctx.store?.get('key'),
          });
          ctx.onCleanup(() => {
            customEvents.push({ cleanup: el.id });
          });
        },
      }),
    ],
  });

  const engine = createEngine({
    modules: [customMod, text(), events()],
  });

  const dom = createDom(`
    <div id="target-a"></div>
    <div id="target-b"></div>
  `);
  const targetA = dom.window.document.getElementById('target-a');
  const targetB = dom.window.document.getElementById('target-b');

  const storeA = createStore({ key: 'Store-A', textVal: 'Text-A' });
  const storeB = createStore({ key: 'Store-B', textVal: 'Text-B' });

  let handlerACalls = 0;
  let handlerBCalls = 0;

  const mountA = engine.mount(
    targetA,
    '<div id="widget-a" data-widget="alpha"><span data-text="textVal"></span><button id="btn-a" data-on-click="action"></button></div>',
    storeA,
    {
      handlers: {
        action() { handlerACalls++; },
      },
    },
  );

  const mountB = engine.mount(
    targetB,
    '<div id="widget-b" data-widget="beta"><span data-text="textVal"></span><button id="btn-b" data-on-click="action"></button></div>',
    storeB,
    {
      handlers: {
        action() { handlerBCalls++; },
      },
    },
  );

  // Both mounts executed the shared custom module
  assert.equal(customEvents.length, 2);
  assert.deepEqual(customEvents[0], { id: 'widget-a', val: 'alpha', storeVal: 'Store-A' });
  assert.deepEqual(customEvents[1], { id: 'widget-b', val: 'beta', storeVal: 'Store-B' });

  // Text module rendered with isolated stores
  assert.equal(targetA.querySelector('span').textContent, 'Text-A');
  assert.equal(targetB.querySelector('span').textContent, 'Text-B');

  // Mutating store A only updates target A
  storeA.set('textVal', 'Updated-A');
  assert.equal(targetA.querySelector('span').textContent, 'Updated-A');
  assert.equal(targetB.querySelector('span').textContent, 'Text-B');

  // Mutating store B only updates target B
  storeB.set('textVal', 'Updated-B');
  assert.equal(targetA.querySelector('span').textContent, 'Updated-A');
  assert.equal(targetB.querySelector('span').textContent, 'Updated-B');

  // Mount-local scope and handlers isolation
  assert.notEqual(mountA.store, mountB.store);
  assert.notEqual(mountA.scope, mountB.scope);

  const btnA = targetA.querySelector('#btn-a');
  const btnB = targetB.querySelector('#btn-b');
  btnA.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(handlerACalls, 1);
  assert.equal(handlerBCalls, 0);

  btnB.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(handlerACalls, 1);
  assert.equal(handlerBCalls, 1);

  // Unmounting mount A runs only A's cleanup; B remains active
  mountA.unmount();
  assert.equal(mountA.active, false);
  assert.equal(mountB.active, true);
  assert.equal(targetA.textContent, '');
  assert.equal(targetB.querySelector('span').textContent, 'Updated-B');

  // Verify cleanup array captured widget-a cleanup but not widget-b
  const cleanups = customEvents.filter((e) => e.cleanup);
  assert.deepEqual(cleanups, [{ cleanup: 'widget-a' }]);

  // Teardown mount B
  mountB.unmount();
  assert.equal(mountB.active, false);
  assert.equal(targetB.textContent, '');
  const cleanupsAfter = customEvents.filter((e) => e.cleanup);
  assert.deepEqual(cleanupsAfter, [{ cleanup: 'widget-a' }, { cleanup: 'widget-b' }]);
});

// ── 2. ABORTSIGNAL ISOLATION BETWEEN MOUNTS ─────────────────────────────────

test('architecture: aborting signal on Mount A does not affect Mount B on same Engine', () => {
  const engine = createEngine({ modules: [text()] });
  const dom = createDom('<div id="a"></div><div id="b"></div>');
  const targetA = dom.window.document.getElementById('a');
  const targetB = dom.window.document.getElementById('b');

  const controllerA = new AbortController();
  const controllerB = new AbortController();

  const mountA = engine.mount(targetA, '<span data-text="msg"></span>', createStore({ msg: 'Hello A' }), {
    signal: controllerA.signal,
  });
  const mountB = engine.mount(targetB, '<span data-text="msg"></span>', createStore({ msg: 'Hello B' }), {
    signal: controllerB.signal,
  });

  assert.equal(mountA.active, true);
  assert.equal(mountB.active, true);
  assert.equal(targetA.textContent, 'Hello A');
  assert.equal(targetB.textContent, 'Hello B');

  // Abort only Mount A
  controllerA.abort();

  assert.equal(mountA.active, false);
  assert.equal(targetA.textContent, '');
  assert.equal(mountB.active, true);
  assert.equal(targetB.textContent, 'Hello B');

  // Mount B continues to be reactive
  mountB.store.set('msg', 'Hello B Updated');
  assert.equal(targetB.textContent, 'Hello B Updated');

  mountB.unmount();
  assert.equal(mountB.active, false);
});

// ── 3. ENGINE CONFIGURATION IMMUTABILITY & NO ENGINE-LEVEL LEAKS ───────────

test('architecture: mount options cannot mutate Engine configuration', () => {
  const initialMod = defineModule({
    name: 'initial-mod',
    triggers: [attr('data-init', () => {})],
  });

  const forbiddenMod = defineModule({
    name: 'forbidden-mod',
    triggers: [attr('data-forbidden', () => {})],
  });

  const engine = createEngine({ modules: [initialMod] });
  assert.equal(engine.modules.length, 1);

  const dom = createDom('<div id="app"></div>');
  const target = dom.window.document.getElementById('app');

  // Attempt to pass modules via mount options
  engine.mount(target, '<div></div>', null, {
    modules: [forbiddenMod],
    handlers: { test: () => {} },
  });

  // Engine modules remain untouched and immutable
  assert.equal(engine.modules.length, 1);
  assert.equal(engine.modules[0].name, 'initial-mod');

  // handlers passed in mount options must NOT be on engine
  assert.equal(engine.handlers, undefined);
});

// ── 4. CUSTOM MODULE VS STANDARD MODULE CAPABILITY PARITY ───────────────────

test('architecture: custom module using core primitives has full parity with standard modules for element scope and event delegation', () => {
  // A custom module that expands items and attaches scoped lexical state via setElementScope
  const customRepeater = defineModule({
    name: 'custom-repeater',
    triggers: [
      tag('CUSTOM-LIST', {
        phase: 'transform',
        setup(el, _data, ctx) {
          const items = ctx.scope?.items || [];
          const doc = el.ownerDocument;
          const frag = doc.createDocumentFragment();

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const itemScope = createScope(ctx.scope, {
              itemTitle: item.title,
              itemId: item.id,
            });

            const btn = doc.createElement('button');
            btn.id = `item-${item.id}`;
            btn.setAttribute('data-on-click', 'selectItem');
            btn.textContent = item.title;

            // Associate scope with button using public core setElementScope
            setElementScope(btn, itemScope);
            frag.appendChild(btn);
          }

          el.replaceWith(frag);
        },
      }),
    ],
  });

  const engine = createEngine({
    modules: [customRepeater, events()],
  });

  const dom = createDom('<div id="app"></div>');
  const target = dom.window.document.getElementById('app');

  const receivedPayloads = [];

  const scope = createScope(null, {
    items: [
      { id: 101, title: 'Item One' },
      { id: 102, title: 'Item Two' },
    ],
  });

  const mountInstance = engine.mount(
    target,
    '<custom-list></custom-list>',
    null,
    {
      scope,
      handlers: {
        selectItem(payload) {
          receivedPayloads.push({
            elementId: payload.element.id,
            itemId: payload.scope.itemId,
            itemTitle: payload.scope.itemTitle,
          });
        },
      },
    },
  );

  const btn1 = target.querySelector('#item-101');
  const btn2 = target.querySelector('#item-102');

  assert.ok(btn1, 'First button rendered by custom module');
  assert.ok(btn2, 'Second button rendered by custom module');

  // Verify getElementScope retrieves the scope attached by custom module
  const scope1 = getElementScope(btn1);
  assert.equal(scope1.itemId, 101);
  assert.equal(scope1.itemTitle, 'Item One');

  // Click button 1
  btn1.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(receivedPayloads.length, 1);
  assert.deepEqual(receivedPayloads[0], {
    elementId: 'item-101',
    itemId: 101,
    itemTitle: 'Item One',
  });

  // Click button 2
  btn2.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(receivedPayloads.length, 2);
  assert.deepEqual(receivedPayloads[1], {
    elementId: 'item-102',
    itemId: 102,
    itemTitle: 'Item Two',
  });

  mountInstance.unmount();
});

// ── 5. RUNTIME HANDLER MUTATION IS MOUNT-SCOPED ─────────────────────────────

test('architecture: runtime handler mutation behaves dynamically and remains strictly mount-scoped', () => {
  const engine = createEngine({ modules: [events()] });
  const dom = createDom('<div id="app-1"></div><div id="app-2"></div>');
  const target1 = dom.window.document.getElementById('app-1');
  const target2 = dom.window.document.getElementById('app-2');

  const history1 = [];
  const history2 = [];

  const handlers1 = {
    handleAction() { history1.push('initial-1'); },
  };
  const handlers2 = {
    handleAction() { history2.push('initial-2'); },
  };

  const mount1 = engine.mount(target1, '<button id="b1" data-on-click="handleAction"></button>', null, {
    handlers: handlers1,
  });
  const mount2 = engine.mount(target2, '<button id="b2" data-on-click="handleAction"></button>', null, {
    handlers: handlers2,
  });

  const b1 = target1.querySelector('#b1');
  const b2 = target2.querySelector('#b2');

  b1.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  b2.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.deepEqual(history1, ['initial-1']);
  assert.deepEqual(history2, ['initial-2']);

  // Mutate handler on Mount 1 only
  handlers1.handleAction = () => { history1.push('mutated-1'); };

  b1.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  b2.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.deepEqual(history1, ['initial-1', 'mutated-1']);
  assert.deepEqual(history2, ['initial-2', 'initial-2'], 'Mount 2 handlers must remain unaffected');

  mount1.unmount();
  mount2.unmount();
});

// ── 6. TARGET DOM OWNERSHIP AND TEARDOWN ORDER ──────────────────────────────

test('architecture: unmount clears content but does not remove caller target container', () => {
  const engine = createEngine({ modules: [text()] });
  const dom = createDom('<div id="container"><div id="target">Initial</div></div>');
  const container = dom.window.document.getElementById('container');
  const target = dom.window.document.getElementById('target');

  const mount = engine.mount(target, '<span data-text="msg"></span>', createStore({ msg: 'Mounted Content' }));
  assert.equal(target.textContent, 'Mounted Content');
  assert.equal(target.parentNode, container);

  mount.unmount();

  // Target container remains in parent DOM; only its inner content was cleared
  assert.equal(target.parentNode, container);
  assert.equal(target.textContent, '');
  assert.equal(container.firstElementChild, target);
});
