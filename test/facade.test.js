import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  createEngine,
  defineModule,
  attr,
  createStore,
  mount,
  unmount,
  render,
  setDevMode,
  subscribeDiagnostics,
  partials,
  conditionals,
  loops,
  text,
  show,
  model,
  events,
} from '../src/index.js';
import * as PublicAPI from '../src/index.js';

let templateCount = 0;

function installDom(markup = '') {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${markup}</body></html>`, {
    url: 'http://localhost/',
  });
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.Element = dom.window.Element;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  return dom;
}

function fixture(markup, name = `facade-tpl-${++templateCount}`) {
  const dom = installDom(`<template id="tpl-${name}">${markup}</template><main id="app"></main>`);
  return { dom, name, target: dom.window.document.getElementById('app') };
}

test.beforeEach(() => setDevMode(false));

// ── 1. STANDARD MODULES & PRIVATE DEFAULT ENGINE ─────────────────────────────

test('facade: standard module factories are exported and defaultEngine is private', () => {
  assert.equal(PublicAPI.defaultEngine, undefined, 'defaultEngine must be private');

  // Verify all 7 standard module factory exports
  assert.equal(typeof partials, 'function');
  assert.equal(typeof conditionals, 'function');
  assert.equal(typeof loops, 'function');
  assert.equal(typeof model, 'function');
  assert.equal(typeof text, 'function');
  assert.equal(typeof show, 'function');
  assert.equal(typeof events, 'function');
});

// ── 2. ABSENCE OF LEGACY PLUGIN APIS ──────────────────────────────────────────

test('facade: legacy definePlugin and PLUGIN_API_VERSION are completely absent from public exports', () => {
  assert.equal(PublicAPI.definePlugin, undefined, 'definePlugin must NOT be exported');
  assert.equal(PublicAPI.PLUGIN_API_VERSION, undefined, 'PLUGIN_API_VERSION must NOT be exported');
});

// ── 3. STANDARD BEHAVIORAL MOUNT & UNMOUNT ────────────────────────────────────

test('facade: mount delegating to defaultEngine executes all standard modules end-to-end', () => {
  const { name, target } = fixture(`
    <p class="greeting">Hello \${user.name}</p>
    <span id="txt" data-text="count"></span>
    <input id="input" data-model="user.name">
    <div id="vis" data-show="visible">Visible content</div>
    <button id="btn" data-on-click="increment">Add</button>
  `);

  const store = createStore({
    user: { name: 'Ada' },
    count: 10,
    visible: true,
  });

  let clicked = false;
  const instance = mount(target, name, store, {
    context: { user: { name: 'Ada' } },
    handlers: {
      increment() {
        clicked = true;
        store.set('count', store.get('count') + 1);
      },
    },
  });

  assert.equal(target.querySelector('.greeting').textContent.trim(), 'Hello Ada');
  assert.equal(target.querySelector('#txt').textContent, '10');
  assert.equal(target.querySelector('#input').value, 'Ada');
  assert.equal(target.querySelector('#vis').hidden, false);

  // Click event triggers handler
  target.querySelector('#btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(clicked, true);
  assert.equal(target.querySelector('#txt').textContent, '11');

  // Reactivity toggles visibility
  store.set('visible', false);
  assert.equal(target.querySelector('#vis').hidden, true);

  // cleanup() stops subscriptions without wiping DOM
  instance.cleanup();
  store.set('count', 99);
  assert.equal(target.querySelector('#txt').textContent, '11');
  assert.ok(target.querySelector('#txt'), 'DOM remains intact after cleanup()');

  // unmount() clears target DOM completely
  unmount(target);
  assert.equal(target.textContent, '');
});

// ── 4. REDESIGNED PUBLIC MOUNT SIGNATURE & TARGET RESOLUTION ─────────────────

test('facade: redesigned public mount(target, template, store, options) resolves selectors and rejects invalid targets', () => {
  const { name, target } = fixture(`<span data-text="val"></span><p>Static \${msg}</p>`);
  const store = createStore({ val: 'reactive' });

  // 1. Selector resolution: mount('#app', template, store, options)
  const instance = mount('#app', name, store, { context: { msg: 'world' } });

  assert.equal(target.querySelector('span').textContent, 'reactive');
  assert.equal(target.querySelector('p').textContent, 'Static world');
  assert.equal(instance.active, true);
  assert.equal(instance.target, target);

  // Unmount via instance
  unmount(instance);
  assert.equal(target.textContent, '');
  assert.equal(instance.active, false);

  // 2. Rejection of invalid targets via diagnostics
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((d) => diagnostics.push(d));

  const nullInstance = mount(null, name);
  assert.equal(nullInstance.active, false);
  assert.ok(diagnostics.some((d) => d.code === 'MOUNT_INVALID_TARGET'));

  const notFoundInstance = mount('#missing-target-id', name);
  assert.equal(notFoundInstance.active, false);
  assert.ok(diagnostics.some((d) => d.code === 'MOUNT_TARGET_NOT_FOUND'));

  unsubscribe();
});

// ── 5. CUSTOM MODULE OVERRIDE & PRECEDENCE ────────────────────────────────────

test('facade: custom engine allows module override with precedence over standard modules', () => {
  const dom = installDom('<div id="app"><span data-text="item.name"></span></div>');
  const target = dom.window.document.getElementById('app');

  const uppercaseTextModule = defineModule({
    name: 'uppercase-text',
    triggers: [
      attr('data-text', {
        phase: 'link',
        read(el) {
          return { path: el.getAttribute('data-text') };
        },
        setup(el, data, ctx) {
          const raw = ctx.store ? ctx.store.get(data.path) : '';
          el.textContent = String(raw).toUpperCase();
        },
      }),
    ],
  });

  // Custom engine with custom module placed before text()
  const customEngine = createEngine({
    modules: [
      uppercaseTextModule,
      text(),
    ],
  });

  const store = createStore({ item: { name: 'custom item' } });
  customEngine.mount(target, { store });

  assert.equal(target.querySelector('span').textContent, 'CUSTOM ITEM');
  customEngine.unmount(target);
  assert.ok(target.querySelector('span'), 'In-place caller DOM preserved after unmount');
  assert.equal(target.querySelector('span').textContent, 'CUSTOM ITEM');
});

// ── 6. MODULE OMISSION (TREE UNTOUCHED) ────────────────────────────────────────

test('facade: omitting a module leaves its triggers completely untouched in the DOM', () => {
  const dom = installDom('<div id="app"><p data-show="visible">Content</p></div>');
  const target = dom.window.document.getElementById('app');

  // Engine configured without show() module
  const minimalEngine = createEngine({
    modules: [text()],
  });

  const store = createStore({ visible: false });
  minimalEngine.mount(target, { store });

  const p = target.querySelector('p');
  assert.equal(p.hasAttribute('data-show'), true);
  assert.equal(p.hidden, false, 'hidden state should not be touched since show() was omitted');

  minimalEngine.unmount(target);
});

// ── 7. ENGINE ISOLATION ───────────────────────────────────────────────────────

test('facade: multiple engine instances are completely isolated', () => {
  const dom = installDom('<div id="app1"><span data-text="v"></span></div><div id="app2"><span data-text="v"></span></div>');
  const app1 = dom.window.document.getElementById('app1');
  const app2 = dom.window.document.getElementById('app2');

  const engine1 = createEngine({ modules: [text()] });
  const engine2 = createEngine({ modules: [text()] });

  const store1 = createStore({ v: 'Engine 1' });
  const store2 = createStore({ v: 'Engine 2' });

  engine1.mount(app1, { store: store1 });
  engine2.mount(app2, { store: store2 });

  assert.equal(app1.querySelector('span').textContent, 'Engine 1');
  assert.equal(app2.querySelector('span').textContent, 'Engine 2');

  // Modifying store1 does not affect app2
  store1.set('v', 'Engine 1 Updated');
  assert.equal(app1.querySelector('span').textContent, 'Engine 1 Updated');
  assert.equal(app2.querySelector('span').textContent, 'Engine 2');

  // Unmounting engine1 leaves engine2 completely untouched
  engine1.unmount(app1);
  assert.ok(app1.querySelector('span'), 'In-place content preserved after unmount');
  assert.equal(app1.querySelector('span').textContent, 'Engine 1 Updated');
  assert.equal(app2.querySelector('span').textContent, 'Engine 2');

  engine2.unmount(app2);
  assert.ok(app2.querySelector('span'), 'In-place content preserved after unmount');
  assert.equal(app2.querySelector('span').textContent, 'Engine 2');
});

// ── 8. RENDER FACADE ──────────────────────────────────────────────────────────

test('facade: render() runs Transform and Link phases and returns callable cleanup with metadata', () => {
  const dom = installDom();
  const frag = dom.window.document.createDocumentFragment();
  const el = dom.window.document.createElement('div');
  el.setAttribute('data-text', 'title');
  frag.appendChild(el);

  const store = createStore({ title: 'Render Test' });
  const result = render(frag, { store });

  assert.equal(typeof result, 'function', 'render result is callable cleanup');
  assert.equal(result.element, frag);
  assert.equal(result.store, store);
  assert.ok(result.scope);
  assert.equal(el.textContent, 'Render Test');

  store.set('title', 'Render Updated');
  assert.equal(el.textContent, 'Render Updated');

  result(); // Call cleanup
  store.set('title', 'Render After Cleanup');
  assert.equal(el.textContent, 'Render Updated');
});
