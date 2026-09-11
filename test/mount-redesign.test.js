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

// ── 1. TARGET RESOLUTION ──────────────────────────────────────────────────────

test('mount target resolution: CSS selector #app resolves and mounts into single matching element', () => {
  installDom('<main id="app"></main><template id="tpl-sel"><span data-text="msg"></span></template>');
  const store = createStore({ msg: 'resolved by selector' });

  const instance = mount('#app', 'sel', store);

  assert.equal(document.getElementById('app').querySelector('span').textContent, 'resolved by selector');
  assert.equal(instance.active, true);
  assert.equal(instance.target, document.getElementById('app'));

  unmount(instance);
  assert.equal(document.getElementById('app').textContent, '');
  assert.equal(instance.active, false);
});

test('mount target resolution: existing connected DOM element mounts successfully', () => {
  installDom('<div id="container"><section id="root"></section></div><template id="tpl-el"><p data-text="val"></p></template>');
  const target = document.getElementById('root');
  const store = createStore({ val: 'connected element' });

  const instance = mount(target, 'el', store);

  assert.equal(target.querySelector('p').textContent, 'connected element');
  assert.equal(instance.target, target);
  assert.equal(instance.active, true);

  unmount(instance);
  assert.equal(target.textContent, '');
});

test('mount target resolution: detached element created via document.createElement() mounts without connection requirement', () => {
  installDom('<template id="tpl-detached"><b>detached content</b></template>');
  const target = document.createElement('div');
  target.id = 'detached-node';

  assert.equal(target.isConnected, false);

  const instance = mount(target, 'tpl-detached');

  assert.equal(target.querySelector('b').textContent, 'detached content');
  assert.equal(instance.active, true);
  assert.equal(instance.target, target);

  // Still detached, Lime did not auto-append to document.body
  assert.equal(target.isConnected, false);
  assert.equal(document.body.contains(target), false);

  unmount(instance);
  assert.equal(target.textContent, '');
});

// ── 2. INVALID TARGET REJECTION ──────────────────────────────────────────────

test('mount invalid target rejection: null, undefined, 123, {}, and [] emit MOUNT_INVALID_TARGET and return inactive instance', () => {
  installDom('<template id="tpl-test">content</template>');
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((d) => diagnostics.push(d));

  for (const badTarget of [null, undefined, 123, {}, []]) {
    diagnostics.length = 0;
    const instance = mount(badTarget, 'test');

    assert.equal(typeof instance, 'function');
    assert.equal(typeof instance.unmount, 'function');
    assert.equal(instance.active, false);
    assert.equal(instance.target, null);
    assert.ok(diagnostics.some((d) => d.code === 'MOUNT_INVALID_TARGET'), `Should emit MOUNT_INVALID_TARGET for ${badTarget}`);

    // Calling unmount on inactive instance is a safe no-op
    instance.unmount();
    instance();
    unmount(instance);
  }

  unsubscribe();
});

test('mount invalid target rejection: missing selector emits MOUNT_TARGET_NOT_FOUND', () => {
  installDom('<template id="tpl-test">content</template>');
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((d) => diagnostics.push(d));

  const instance = mount('.missing-element-class', 'test');

  assert.equal(instance.active, false);
  assert.ok(diagnostics.some((d) => d.code === 'MOUNT_TARGET_NOT_FOUND'));

  unsubscribe();
});

test('mount invalid target rejection: malformed selector string emits MOUNT_INVALID_TARGET', () => {
  installDom('<template id="tpl-test">content</template>');
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((d) => diagnostics.push(d));

  const instance = mount(':::invalid-selector', 'test');

  assert.equal(instance.active, false);
  assert.ok(diagnostics.some((d) => d.code === 'MOUNT_INVALID_TARGET'));

  unsubscribe();
});

// ── 3. STORE BEHAVIOR & ISOLATION ─────────────────────────────────────────────

test('mount store behavior: omitting store creates isolated local Store for each mount', () => {
  installDom(`
    <div id="target-a"></div>
    <div id="target-b"></div>
    <template id="tpl-store"><span data-text="count"></span></template>
  `);

  const a = document.getElementById('target-a');
  const b = document.getElementById('target-b');

  const instanceA = mount(a, 'store');
  const instanceB = mount(b, 'store');

  assert.ok(instanceA.store, 'instanceA has a store');
  assert.ok(instanceB.store, 'instanceB has a store');
  assert.notEqual(instanceA.store, instanceB.store, 'Stores must NOT be shared between mounts');

  instanceA.store.set('count', 42);
  assert.equal(a.querySelector('span').textContent, '42');
  assert.equal(b.querySelector('span').textContent, '');

  instanceB.store.set('count', 99);
  assert.equal(a.querySelector('span').textContent, '42');
  assert.equal(b.querySelector('span').textContent, '99');

  unmount(instanceA);
  unmount(instanceB);
});

test('mount store behavior: options passed as 3rd arg creates local Store with options applied', () => {
  installDom('<div id="target"></div><template id="tpl-opts"><button data-on-click="hit"></button></template>');
  const target = document.getElementById('target');
  let hitCount = 0;

  // 3rd arg is options object without store
  const instance = mount(target, 'opts', {
    handlers: {
      hit() { hitCount++; },
    },
  });

  assert.ok(instance.store, 'Store created automatically');
  target.querySelector('button').click();
  assert.equal(hitCount, 1);

  unmount(instance);
});

test('mount store behavior: explicit Store remains shared between caller and mount', () => {
  installDom('<div id="target"></div><template id="tpl-explicit"><span data-text="val"></span></template>');
  const target = document.getElementById('target');
  const sharedStore = createStore({ val: 'initial' });

  const instance = mount(target, 'explicit', sharedStore);
  assert.equal(instance.store, sharedStore);
  assert.equal(target.querySelector('span').textContent, 'initial');

  sharedStore.set('val', 'updated by caller');
  assert.equal(target.querySelector('span').textContent, 'updated by caller');

  unmount(instance);
  // Shared store itself remains usable by caller after unmount
  sharedStore.set('val', 'post-unmount');
  assert.equal(sharedStore.get('val'), 'post-unmount');
});

// ── 4. HANDLER ISOLATION & PROTOTYPE SAFETY ───────────────────────────────────

test('mount handler isolation: separate mounts with same handler names do not cross-call', () => {
  installDom(`
    <div id="target-1"></div>
    <div id="target-2"></div>
    <template id="tpl-btn"><button data-on-click="fire">Action</button></template>
  `);

  const t1 = document.getElementById('target-1');
  const t2 = document.getElementById('target-2');

  const calls1 = [];
  const calls2 = [];

  const inst1 = mount(t1, 'btn', null, {
    handlers: {
      fire() { calls1.push('t1'); },
    },
  });

  const inst2 = mount(t2, 'btn', null, {
    handlers: {
      fire() { calls2.push('t2'); },
    },
  });

  t1.querySelector('button').click();
  assert.deepEqual(calls1, ['t1']);
  assert.deepEqual(calls2, []);

  t2.querySelector('button').click();
  assert.deepEqual(calls1, ['t1']);
  assert.deepEqual(calls2, ['t2']);

  unmount(inst1);
  unmount(inst2);
});

test('mount handler prototype safety: prototype properties on handlers object are not executed', () => {
  installDom('<div id="target"></div><template id="tpl-proto"><button data-on-click="toString">Test</button></template>');
  const target = document.getElementById('target');
  const warnings = [];
  const unsubscribe = subscribeDiagnostics((d) => warnings.push(d));

  const instance = mount(target, 'proto', null, {
    handlers: {}, // Object.prototype has toString
  });

  target.querySelector('button').click();
  assert.ok(warnings.some((w) => w.code === 'HANDLER_NOT_FOUND'));

  unsubscribe();
  unmount(instance);
});

// ── 5. CLEANUP & ABORTSIGNAL LIFECYCLE ─────────────────────────────────────────

test('mount cleanup: LIFO execution and idempotence on unmount', () => {
  installDom('<div id="target"></div><template id="tpl-clean"><span>content</span></template>');
  const target = document.getElementById('target');
  const executionOrder = [];

  const cleanupModule = defineModule({
    name: 'cleanup-test',
    triggers: [
      attr('data-clean-1', {
        phase: 'link',
        setup(el, data, ctx) {
          ctx.onCleanup(() => executionOrder.push('first-registered'));
          return () => executionOrder.push('returned-cleanup-1');
        },
      }),
      attr('data-clean-2', {
        phase: 'link',
        setup(el, data, ctx) {
          ctx.onCleanup(() => executionOrder.push('second-registered'));
          return () => executionOrder.push('returned-cleanup-2');
        },
      }),
    ],
  });

  const engine = createEngine({ modules: [cleanupModule] });
  target.innerHTML = '<div data-clean-1 data-clean-2></div>';

  const instance = engine.mount(target);

  assert.equal(executionOrder.length, 0);

  // Unmount runs LIFO cleanups
  unmount(instance);

  assert.deepEqual(executionOrder, [
    'returned-cleanup-2',
    'second-registered',
    'returned-cleanup-1',
    'first-registered',
  ]);

  // Idempotent: running unmount again produces zero additional executions
  unmount(instance);
  assert.equal(executionOrder.length, 4);
});

test('mount AbortSignal: aborting active signal triggers full teardown and deactivation', () => {
  installDom('<div id="target"></div><template id="tpl-sig"><span data-text="val"></span></template>');
  const target = document.getElementById('target');
  const store = createStore({ val: 'live' });
  const controller = new AbortController();

  const instance = mount(target, 'sig', store, {
    signal: controller.signal,
  });

  assert.equal(instance.active, true);
  assert.equal(target.querySelector('span').textContent, 'live');

  // Trigger abort
  controller.abort();

  assert.equal(instance.active, false);
  assert.equal(target.textContent, '');

  // Subsequent store mutations do not update target
  store.set('val', 'post-abort');
  assert.equal(target.textContent, '');
});

test('mount AbortSignal: pre-aborted signal avoids mounting entirely', () => {
  installDom('<div id="target"></div><template id="tpl-sig2"><span>never rendered</span></template>');
  const target = document.getElementById('target');
  const controller = new AbortController();
  controller.abort(); // already aborted

  const instance = mount(target, 'sig2', null, {
    signal: controller.signal,
  });

  assert.equal(instance.active, false);
  assert.equal(target.textContent, '');
  assert.equal(target.children.length, 0);

  // Safe to call unmount on returned instance
  instance.unmount();
});

// ── 6. DUPLICATE MOUNT PROTECTION ─────────────────────────────────────────────

test('duplicate mount protection: mounting an already mounted target unmounts and replaces the previous instance', () => {
  installDom(`
    <div id="target"></div>
    <template id="tpl-first"><span data-text="first"></span></template>
    <template id="tpl-second"><b data-text="second"></b></template>
  `);
  const target = document.getElementById('target');
  const store1 = createStore({ first: 'initial' });
  const store2 = createStore({ second: 'replacement' });

  const instance1 = mount(target, 'first', store1);
  assert.equal(instance1.active, true);
  assert.equal(target.querySelector('span').textContent, 'initial');

  // Second mount on the same target
  const instance2 = mount(target, 'second', store2);

  assert.equal(instance1.active, false, 'Previous instance must be deactivated');
  assert.equal(instance2.active, true, 'New instance must be active');
  assert.equal(target.querySelector('span'), null, 'Old span removed');
  assert.equal(target.querySelector('b').textContent, 'replacement');

  // Updating old store produces zero effects on target
  store1.set('first', 'ghost');
  assert.equal(target.querySelector('b').textContent, 'replacement');

  unmount(instance2);
  assert.equal(target.textContent, '');
});

// ── 7. TARGET OWNERSHIP (target.remove() is never called) ──────────────────────

test('target ownership: unmount clears content but never calls target.remove() or detaches target from its parent', () => {
  installDom('<main id="parent"><div id="app"></div></main><template id="tpl-own"><p>Owned content</p></template>');
  const parent = document.getElementById('parent');
  const target = document.getElementById('app');

  let targetRemoved = false;
  const originalRemove = target.remove;
  target.remove = function spyRemove() {
    targetRemoved = true;
    return originalRemove?.apply(this, arguments);
  };

  const instance = mount(target, 'own');
  assert.equal(target.querySelector('p').textContent, 'Owned content');

  unmount(instance);

  assert.equal(targetRemoved, false, 'Lime CSR must NEVER call target.remove()');
  assert.equal(target.parentNode, parent, 'Target element must remain attached to its parent');
  assert.equal(target.textContent, '', 'Target content must be cleared');
});

// ── 8. BEFORE/AFTER RENDER HOOKS & ERROR ISOLATION ────────────────────────────

test('mount hooks: beforeRender and afterRender execute in sequence with error isolation', () => {
  installDom('<div id="target"></div><template id="tpl-hook"><span data-text="msg"></span></template>');
  const target = document.getElementById('target');
  const order = [];
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((d) => diagnostics.push(d));

  const instance = mount(target, 'hook', null, {
    beforeRender(scope, store) {
      order.push('beforeRender');
      store.set('msg', 'hook-value');
      throw new Error('Explosion in beforeRender');
    },
    afterRender(renderedTarget, _store) {
      order.push('afterRender');
      assert.equal(renderedTarget, target);
      assert.equal(renderedTarget.querySelector('span').textContent, 'hook-value');
      throw new Error('Explosion in afterRender');
    },
  });

  unsubscribe();

  assert.deepEqual(order, ['beforeRender', 'afterRender']);
  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0].code, 'MOUNT_HOOK_FAILED');
  assert.equal(diagnostics[0].context, target);
  assert.equal(diagnostics[1].code, 'MOUNT_HOOK_FAILED');
  assert.equal(diagnostics[1].context, target);

  unmount(instance);
});

// ── 9. IN-PLACE MOUNTING & CALL STYLES ─────────────────────────────────────────

test('in-place mount: mount(target, options) mounts existing DOM content without template', () => {
  installDom('<div id="target"><span data-text="name"></span><button data-on-click="click">Hit</button></div>');
  const target = document.getElementById('target');
  const store = createStore({ name: 'In Place' });
  let clicked = false;

  const instance = mount(target, {
    store,
    handlers: {
      click() { clicked = true; },
    },
  });

  assert.equal(target.querySelector('span').textContent, 'In Place');
  target.querySelector('button').click();
  assert.equal(clicked, true);

  unmount(instance);

  // In-place mount: caller-provided DOM survives unmount
  assert.ok(target.querySelector('button'), 'Button survives in-place unmount');
  assert.ok(target.querySelector('span'), 'Span survives in-place unmount');
  assert.equal(target.querySelector('span').textContent, 'In Place');

  // Runtime is deactivated: click should not trigger handler
  clicked = false;
  target.querySelector('button').click();
  assert.equal(clicked, false, 'Handler deactivated after in-place unmount');

  // Store updates no longer update span
  store.set('name', 'Changed After Unmount');
  assert.equal(target.querySelector('span').textContent, 'In Place', 'Bindings deactivated after in-place unmount');
});
