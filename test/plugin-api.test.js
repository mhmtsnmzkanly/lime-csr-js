import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  createStore,
  definePlugin,
  mount,
  PLUGIN_API_VERSION,
  render,
  setDevMode,
  subscribeDiagnostics,
  unmount,
} from '../src/index.js';
import { createPluginRuntime } from '../src/plugins.js';

let templateNumber = 0;

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
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  });
  return dom;
}

function fixture(template) {
  const name = `plugin-${++templateNumber}`;
  const dom = installDom(`<template id="tpl-${name}">${template}</template><main id="app"></main>`);
  return { dom, name, target: document.getElementById('app') };
}

function directivePlugin(setup, options = {}) {
  return definePlugin({
    name: options.name ?? `test-${++templateNumber}`,
    apiVersion: options.apiVersion ?? 1,
    beforeMount: options.beforeMount,
    afterMount: options.afterMount,
    directives: {
      [options.directive ?? 'data-lime-test']: { setup },
    },
  });
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test.beforeEach(() => setDevMode(false));
test.afterEach(() => setDevMode(true));

test('PLUGIN_API_VERSION is 1', () => {
  assert.equal(PLUGIN_API_VERSION, 1);
});

test('definePlugin freezes the plugin, directive map, and directive definitions', () => {
  const plugin = definePlugin({
    name: 'frozen',
    apiVersion: 1,
    version: '1.0.0',
    directives: { 'data-lime-frozen'() {} },
  });
  assert.equal(Object.isFrozen(plugin), true);
  assert.equal(Object.isFrozen(plugin.directives), true);
  assert.equal(Object.isFrozen(plugin.directives['data-lime-frozen']), true);
});

test('definePlugin rejects invalid plugin names', () => {
  for (const name of ['', 'Upper', 'two words', '-leading', 'with_underscore']) {
    assert.throws(() => definePlugin({ name, apiVersion: 1 }), TypeError);
  }
});

test('definePlugin rejects invalid directive names', () => {
  for (const directive of ['lime-test', 'data-test', 'data-lime-Upper', 'data-lime-two--parts']) {
    assert.throws(
      () => definePlugin({ name: 'invalid-directive', apiVersion: 1, directives: { [directive]() {} } }),
      TypeError,
    );
  }
});

test('data-lime-ignore remains reserved', () => {
  assert.throws(
    () => definePlugin({ name: 'ignore-owner', apiVersion: 1, directives: { 'data-lime-ignore'() {} } }),
    (error) => error instanceof TypeError && /reserved/.test(error.message),
  );
});

test('directive receives its element and raw attribute value', () => {
  const { name, target } = fixture('<div data-lime-test="scene.visible"></div>');
  let received;
  const plugin = directivePlugin((api) => { received = api; });
  mount(name, { target, plugins: [plugin] });
  assert.equal(received.element, target.firstElementChild);
  assert.equal(received.value, 'scene.visible');
  assert.equal(received.directive, 'data-lime-test');
});

test('directive get and set helpers use the mount store', () => {
  const { name, target } = fixture('<div data-lime-test="count"></div>');
  const store = createStore({ count: 1 });
  let initial;
  let changed;
  const plugin = directivePlugin(({ get, set }) => {
    initial = get('count');
    changed = set('count', 2);
  });
  mount(name, { target, store, plugins: [plugin] });
  assert.equal(initial, 1);
  assert.equal(changed, true);
  assert.equal(store.get('count'), 2);
});

test('watch immediate receives current value, previous value, and path', () => {
  const { name, target } = fixture('<div data-lime-test></div>');
  const store = createStore({ count: 4 });
  const calls = [];
  const plugin = directivePlugin(({ watch }) => {
    watch('count', (...args) => calls.push(args), { immediate: true });
  });
  mount(name, { target, store, plugins: [plugin] });
  store.set('count', 5);
  assert.deepEqual(calls, [[4, undefined, 'count'], [5, 4, 'count']]);
});

test('watch is automatically unsubscribed by directive cleanup', () => {
  const { name, target } = fixture('<div data-lime-test></div>');
  const store = createStore({ count: 0 });
  let calls = 0;
  const plugin = directivePlugin(({ watch }) => {
    watch('count', () => { calls += 1; });
  });
  const cleanup = mount(name, { target, store, plugins: [plugin] });
  store.set('count', 1);
  cleanup();
  store.set('count', 2);
  assert.equal(calls, 1);
});

test('watch callback failure is isolated and diagnosed', () => {
  const { name, target } = fixture('<div data-lime-test></div>');
  const store = createStore({ count: 0 });
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
  const plugin = directivePlugin(({ watch }) => {
    watch('count', () => { throw new Error('watch failed'); });
  });
  mount(name, { target, store, plugins: [plugin] });
  assert.doesNotThrow(() => store.set('count', 1));
  unsubscribe();
  assert.ok(diagnostics.some(({ code }) => code === 'PLUGIN_WATCH_FAILED'));
});

test('afterConnect runs only after the mounted element is connected', async () => {
  const { name, target } = fixture('<input data-lime-test>');
  let connectedDuringCallback = false;
  const plugin = directivePlugin(({ element, afterConnect }) => {
    assert.equal(element.isConnected, false);
    afterConnect(() => { connectedDuringCallback = element.isConnected; });
  });
  mount(name, { target, plugins: [plugin] });
  assert.equal(connectedDuringCallback, false);
  await flushMicrotasks();
  assert.equal(connectedDuringCallback, true);
});

test('cleanup before the microtask cancels afterConnect', async () => {
  const { name, target } = fixture('<div data-lime-test></div>');
  let calls = 0;
  const plugin = directivePlugin(({ afterConnect }) => {
    afterConnect(() => { calls += 1; });
  });
  const cleanup = mount(name, { target, plugins: [plugin] });
  cleanup();
  await flushMicrotasks();
  assert.equal(calls, 0);
});

test('afterConnect failure is isolated and diagnosed', async () => {
  const { name, target } = fixture('<div data-lime-test></div>');
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
  const plugin = directivePlugin(({ afterConnect }) => {
    afterConnect(() => { throw new Error('connect failed'); });
  });
  mount(name, { target, plugins: [plugin] });
  await flushMicrotasks();
  unsubscribe();
  assert.ok(diagnostics.some(({ code }) => code === 'PLUGIN_AFTER_CONNECT_FAILED'));
});

test('directive returned cleanup runs', () => {
  const { name, target } = fixture('<div data-lime-test></div>');
  let cleaned = 0;
  const plugin = directivePlugin(() => () => { cleaned += 1; });
  const cleanup = mount(name, { target, plugins: [plugin] });
  cleanup();
  assert.equal(cleaned, 1);
});

test('directive onCleanup callbacks run in reverse registration order with returned cleanup', () => {
  const { name, target } = fixture('<div data-lime-test></div>');
  const order = [];
  const plugin = directivePlugin(({ onCleanup }) => {
    onCleanup(() => order.push('first'));
    onCleanup(() => order.push('second'));
    return () => order.push('returned');
  });
  mount(name, { target, plugins: [plugin] })();
  assert.deepEqual(order, ['returned', 'second', 'first']);
});

test('mount cleanup is idempotent for directive and hook cleanups', () => {
  const { name, target } = fixture('<div data-lime-test></div>');
  let calls = 0;
  const plugin = directivePlugin(
    () => () => { calls += 1; },
    { beforeMount: () => () => { calls += 1; } },
  );
  const cleanup = mount(name, { target, plugins: [plugin] });
  cleanup();
  cleanup();
  assert.equal(calls, 2);
});

test('the same plugin definition has separate state in two mounts', () => {
  installDom(`
    <template id="tpl-state"><div data-lime-test></div></template>
    <main id="one"></main><main id="two"></main>
  `);
  const seen = [];
  const states = [];
  const plugin = directivePlugin(({ state }) => {
    states.push(state);
    state.count = (state.count ?? 0) + 1;
    seen.push(state.count);
  });
  mount('state', { target: document.getElementById('one'), plugins: [plugin] });
  mount('state', { target: document.getElementById('two'), plugins: [plugin] });
  assert.deepEqual(seen, [1, 1]);
  assert.notEqual(states[0], states[1]);
  assert.equal(Object.getPrototypeOf(states[0]), null);
  assert.equal(Object.getPrototypeOf(states[1]), null);
});

test('directives and hooks share one plugin state within a mount', () => {
  const { name, target } = fixture('<div data-lime-test></div><div data-lime-test></div>');
  const seen = [];
  const plugin = directivePlugin(
    ({ state }) => {
      state.count += 1;
      seen.push(state.count);
    },
    { beforeMount: ({ state }) => { state.count = 0; } },
  );
  mount(name, { target, plugins: [plugin] });
  assert.deepEqual(seen, [1, 2]);
});

test('live if installs a directive when its branch opens', () => {
  const { name, target } = fixture(`
    <if data-live is-truthy="open">
      <div data-lime-test>open</div>
    <else><span>closed</span></else></if>
  `);
  const store = createStore({ open: false });
  let setups = 0;
  const plugin = directivePlugin(() => { setups += 1; });
  mount(name, { target, store, plugins: [plugin] });
  assert.equal(setups, 0);
  store.set('open', true);
  assert.equal(setups, 1);
  assert.equal(target.querySelector('[data-lime-test]').textContent, 'open');
});

test('live if runs directive cleanup before removing its branch', () => {
  const { name, target } = fixture(`
    <if data-live is-truthy="open"><div data-lime-test>open</div></if>
  `);
  const store = createStore({ open: true });
  let connectedDuringCleanup = false;
  const plugin = directivePlugin(({ element }) => () => {
    connectedDuringCleanup = element.isConnected;
  });
  mount(name, { target, store, plugins: [plugin] });
  store.set('open', false);
  assert.equal(connectedDuringCleanup, true);
  assert.equal(target.querySelector('[data-lime-test]'), null);
});

test('live for installs new item directives with the item context', () => {
  const { name, target } = fixture(`
    <for each="items" as="item" key="item.id" data-live>
      <div data-lime-test></div>
    </for>
  `);
  const store = createStore({ items: [] });
  const seen = [];
  const plugin = directivePlugin(({ context }) => seen.push(context.item.id));
  mount(name, { target, store, plugins: [plugin] });
  store.set('items', [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(seen, ['a', 'b']);
});

test('live for runs item directive cleanup before DOM removal', () => {
  const { name, target } = fixture(`
    <for each="items" as="item" key="item.id" data-live>
      <div data-lime-test></div>
    </for>
  `);
  const store = createStore({ items: [{ id: 'a' }, { id: 'b' }] });
  const cleaned = [];
  const plugin = directivePlugin(({ context, element }) => () => {
    cleaned.push([context.item.id, element.isConnected]);
  });
  mount(name, { target, store, plugins: [plugin] });
  store.set('items', [{ id: 'b' }]);
  assert.deepEqual(cleaned, [['a', true]]);
});

test('nested live blocks carry the same runtime and correct context', () => {
  const { name, target } = fixture(`
    <if data-live is-truthy="open">
      <for each="items" as="item" key="item.id" data-live>
        <div data-lime-test></div>
      </for>
    </if>
  `);
  const store = createStore({ open: true, items: [{ id: 'nested' }] });
  const setups = [];
  const cleanups = [];
  const plugin = directivePlugin(({ context, element }) => {
    setups.push(context.item.id);
    return () => cleanups.push([context.item.id, element.isConnected]);
  });
  mount(name, { target, store, plugins: [plugin] });
  assert.deepEqual(setups, ['nested']);
  store.set('open', false);
  assert.deepEqual(cleanups, [['nested', true]]);
});

test('replace live-for strategy cleans and recreates directives', () => {
  const { name, target } = fixture(`
    <for each="items" as="item" key="item.id" data-live data-diff="replace">
      <div data-lime-test></div>
    </for>
  `);
  const store = createStore({ items: [{ id: 1 }] });
  let setups = 0;
  let cleanups = 0;
  const plugin = directivePlugin(() => {
    setups += 1;
    return () => { cleanups += 1; };
  });
  mount(name, { target, store, plugins: [plugin] });
  store.set('items', [{ id: 1 }, { id: 2 }]);
  assert.equal(setups, 3);
  assert.equal(cleanups, 1);
});

test('directives under data-lime-ignore are untouched', () => {
  const { name, target } = fixture('<section data-lime-ignore><div data-lime-test></div></section>');
  let setups = 0;
  const plugin = directivePlugin(() => { setups += 1; });
  mount(name, { target, plugins: [plugin] });
  assert.equal(setups, 0);
  assert.ok(target.querySelector('[data-lime-test]'));
});

test('duplicate plugin names diagnose and install only the first', () => {
  const { name, target } = fixture('<div data-lime-first data-lime-second></div>');
  const calls = [];
  const first = directivePlugin(() => calls.push('first'), { name: 'duplicate', directive: 'data-lime-first' });
  const second = directivePlugin(() => calls.push('second'), { name: 'duplicate', directive: 'data-lime-second' });
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
  mount(name, { target, plugins: [first, second] });
  unsubscribe();
  assert.deepEqual(calls, ['first']);
  assert.ok(diagnostics.some(({ code }) => code === 'PLUGIN_DUPLICATE_NAME'));
});

test('directive conflicts diagnose and the first plugin wins', () => {
  const { name, target } = fixture('<div data-lime-test></div>');
  const calls = [];
  const first = directivePlugin(() => calls.push('first'), { name: 'conflict-first' });
  const second = directivePlugin(() => calls.push('second'), { name: 'conflict-second' });
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
  mount(name, { target, plugins: [first, second] });
  unsubscribe();
  assert.deepEqual(calls, ['first']);
  assert.ok(diagnostics.some(({ code }) => code === 'PLUGIN_DIRECTIVE_CONFLICT'));
});

test('unsupported plugin API versions are diagnosed and skipped', () => {
  const { name, target } = fixture('<div data-lime-test></div>');
  let setups = 0;
  const plugin = directivePlugin(() => { setups += 1; }, { apiVersion: 2 });
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
  mount(name, { target, plugins: [plugin] });
  unsubscribe();
  assert.equal(setups, 0);
  assert.ok(diagnostics.some(({ code }) => code === 'PLUGIN_API_VERSION_UNSUPPORTED'));
});

test('invalid plugin list and entries are diagnosed without throwing', () => {
  const first = fixture('<div></div>');
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
  assert.doesNotThrow(() => mount(first.name, { target: first.target, plugins: {} }));
  const second = fixture('<div></div>');
  assert.doesNotThrow(() => mount(second.name, { target: second.target, plugins: [{}] }));
  unsubscribe();
  assert.ok(diagnostics.some(({ code }) => code === 'PLUGIN_LIST_INVALID'));
  assert.ok(diagnostics.some(({ code }) => code === 'PLUGIN_INVALID'));
});

test('set and watch without a store diagnose and remain non-throwing', () => {
  const { name, target } = fixture('<div data-lime-test></div>');
  const results = [];
  const plugin = directivePlugin(({ set, watch }) => {
    results.push(set('value', 1));
    results.push(watch('value', () => {}));
  });
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
  mount(name, { target, plugins: [plugin] });
  unsubscribe();
  assert.equal(results[0], false);
  assert.equal(typeof results[1], 'function');
  assert.deepEqual(
    diagnostics.filter(({ code }) => code === 'PLUGIN_STORE_REQUIRED').map(({ code }) => code),
    ['PLUGIN_STORE_REQUIRED', 'PLUGIN_STORE_REQUIRED'],
  );
});

test('a directive on a structural target is diagnosed and skipped', () => {
  const { name, target } = fixture(`
    <if data-live is-truthy="open" data-lime-test><div>content</div></if>
  `);
  let setups = 0;
  const plugin = directivePlugin(() => { setups += 1; });
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
  mount(name, { target, store: createStore({ open: true }), plugins: [plugin] });
  unsubscribe();
  assert.equal(setups, 0);
  assert.ok(diagnostics.some(({ code }) => code === 'PLUGIN_DIRECTIVE_STRUCTURAL_TARGET'));
});

test('a static structural target is diagnosed before expansion discards it', () => {
  const { name, target } = fixture(`
    <if is-truthy="open" data-lime-test><div>content</div></if>
  `);
  let setups = 0;
  const plugin = directivePlugin(() => { setups += 1; });
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
  mount(name, { target, context: { open: true }, plugins: [plugin] });
  unsubscribe();
  assert.equal(setups, 0);
  assert.equal(target.textContent.trim(), 'content');
  assert.equal(
    diagnostics.filter(({ code }) => code === 'PLUGIN_DIRECTIVE_STRUCTURAL_TARGET').length,
    1,
  );
});

test('afterMount receives connected target API and may register cleanup', () => {
  const { name, target } = fixture('<div>content</div>');
  const seen = {};
  const plugin = definePlugin({
    name: 'after-hook-api',
    apiVersion: 1,
    afterMount(api) {
      seen.connected = api.target.firstElementChild.isConnected;
      seen.document = api.document;
      seen.window = api.window;
      api.onCleanup(() => { seen.cleaned = true; });
    },
  });
  const cleanup = mount(name, { target, plugins: [plugin] });
  assert.equal(seen.connected, true);
  assert.equal(seen.document, document);
  assert.equal(seen.window, document.defaultView);
  cleanup();
  assert.equal(seen.cleaned, true);
});

test('plugin hooks keep the fixed mount lifecycle order and see computeds', () => {
  const { name, target } = fixture('<button data-lime-test data-on-click="hit"></button>');
  const store = createStore({ source: 2 });
  const order = [];
  let clicks = 0;
  const plugin = directivePlugin(
    () => order.push('directive'),
    {
      beforeMount({ store: pluginStore }) {
        order.push(`before:${pluginStore.get('derived')}`);
      },
      afterMount({ target: pluginTarget }) {
        order.push(`after:${pluginTarget.firstElementChild.isConnected}`);
        pluginTarget.firstElementChild.click();
      },
    },
  );
  mount(name, {
    target,
    store,
    plugins: [plugin],
    computed: { derived: { deps: ['source'], fn: () => store.get('source') * 2 } },
    beforeRender() { order.push('beforeRender'); },
    afterRender() { order.push('afterRender'); },
    handlers: { hit() { clicks += 1; } },
  });
  assert.deepEqual(order, ['beforeRender', 'before:4', 'directive', 'after:true', 'afterRender']);
  assert.equal(clicks, 0);
  target.firstElementChild.click();
  assert.equal(clicks, 1);
});

test('plugin diagnostic helper uses structured diagnostics with plugin context', () => {
  const { name, target } = fixture('<div data-lime-test></div>');
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
  const plugin = directivePlugin(({ diagnostic, element }) => {
    diagnostic('PLUGIN_CUSTOM_TEST', 'Custom plugin detail.', { element });
  });
  mount(name, { target, plugins: [plugin] });
  unsubscribe();
  const diagnostic = diagnostics.find(({ code }) => code === 'PLUGIN_CUSTOM_TEST');
  assert.equal(diagnostic.message, 'Custom plugin detail.');
  assert.match(diagnostic.context.plugin, /^test-/);
  assert.equal(diagnostic.context.directive, 'data-lime-test');
  assert.equal(diagnostic.context.element, target.firstElementChild);
});

test('hook failure does not prevent later plugins from mounting', () => {
  const { name, target } = fixture('<div data-lime-next></div>');
  let nextCalls = 0;
  const failing = definePlugin({
    name: 'failing-hook',
    apiVersion: 1,
    beforeMount() { throw new Error('hook failed'); },
  });
  const next = directivePlugin(() => { nextCalls += 1; }, {
    name: 'next-hook',
    directive: 'data-lime-next',
  });
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
  assert.doesNotThrow(() => mount(name, { target, plugins: [failing, next] }));
  unsubscribe();
  assert.equal(nextCalls, 1);
  assert.ok(diagnostics.some(({ code }) => code === 'PLUGIN_HOOK_FAILED'));
});

test('directive setup failure does not prevent later directives', () => {
  const { name, target } = fixture('<div data-lime-broken data-lime-working></div>');
  let working = 0;
  const broken = directivePlugin(() => { throw new Error('setup failed'); }, {
    name: 'broken', directive: 'data-lime-broken',
  });
  const next = directivePlugin(() => { working += 1; }, {
    name: 'working', directive: 'data-lime-working',
  });
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
  assert.doesNotThrow(() => mount(name, { target, plugins: [broken, next] }));
  unsubscribe();
  assert.equal(working, 1);
  assert.ok(diagnostics.some(({ code }) => code === 'PLUGIN_SETUP_FAILED'));
});

test('cleanup failure does not prevent remaining cleanups', () => {
  const { name, target } = fixture('<div data-lime-test></div>');
  const calls = [];
  const plugin = directivePlugin(({ onCleanup }) => {
    onCleanup(() => calls.push('survived'));
    return () => { calls.push('failed'); throw new Error('cleanup failed'); };
  });
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
  assert.doesNotThrow(() => mount(name, { target, plugins: [plugin] })());
  unsubscribe();
  assert.deepEqual(calls, ['failed', 'survived']);
  assert.ok(diagnostics.some(({ code }) => code === 'PLUGIN_CLEANUP_FAILED'));
});

test('plugin hook cleanup order is reverse plugin installation order', () => {
  const { name, target } = fixture('<div></div>');
  const order = [];
  const first = definePlugin({ name: 'order-first', apiVersion: 1, beforeMount: () => () => order.push('first') });
  const second = definePlugin({ name: 'order-second', apiVersion: 1, beforeMount: () => () => order.push('second') });
  mount(name, { target, plugins: [first, second] })();
  assert.deepEqual(order, ['second', 'first']);
});

test('unmount and replacement mount clean only their own plugin runtime', () => {
  installDom(`
    <template id="tpl-replace"><div data-lime-test></div></template>
    <main id="one"></main><main id="two"></main>
  `);
  const cleanups = [];
  const plugin = directivePlugin(({ element }) => () => cleanups.push(element.parentElement?.id));
  const one = document.getElementById('one');
  const two = document.getElementById('two');
  mount('replace', { target: one, plugins: [plugin] });
  mount('replace', { target: two, plugins: [plugin] });
  mount('replace', { target: one, plugins: [plugin] });
  assert.deepEqual(cleanups, ['one']);
  unmount(two);
  assert.deepEqual(cleanups, ['one', 'two']);
});

test('missing templates create no plugin state or hooks', () => {
  const dom = installDom('<main id="app"></main>');
  let hooks = 0;
  const plugin = definePlugin({
    name: 'missing-template',
    apiVersion: 1,
    beforeMount() { hooks += 1; },
    afterMount() { hooks += 1; },
  });
  mount('missing', { target: dom.window.document.getElementById('app'), plugins: [plugin] });
  assert.equal(hooks, 0);
});

test('render evaluates a directive on the root element itself', () => {
  const dom = installDom('<main id="root" data-lime-test></main>');
  const root = dom.window.document.getElementById('root');
  let seen = 0;
  const plugin = directivePlugin(() => { seen += 1; });
  const runtime = createPluginRuntime([plugin], { target: root, store: null, context: {} });
  render(root, {}, null, undefined, document, runtime);
  assert.equal(seen, 1);
});

test('mount without plugins preserves ordinary static and reactive behavior', () => {
  const { name, target } = fixture('<h1>${title}</h1><span data-text="count"></span>');
  const store = createStore({ count: 1 });
  const cleanup = mount(name, { target, context: { title: 'Hello' }, store });
  assert.equal(target.textContent, 'Hello1');
  store.set('count', 2);
  assert.equal(target.textContent, 'Hello2');
  cleanup();
});

test('legacy positional mount remains compatible when plugins are omitted', () => {
  const { name, target } = fixture('<span data-text="value"></span>');
  const store = createStore({ value: 'legacy' });
  mount(name, {}, target, store);
  assert.equal(target.textContent, 'legacy');
});

// Keep the named import exercised so type/lint checks cover the public lower-level API.
assert.equal(typeof render, 'function');
