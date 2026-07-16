import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  createStore,
  mount,
  setDevMode,
  setupShowBindings,
  subscribeDiagnostics,
} from '../src/index.js';

const SHOW_STYLE_ID = 'lime-csr-data-show-style';
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
  const name = `show-${++templateNumber}`;
  const dom = installDom(`<template id="tpl-${name}">${template}</template><main id="app"></main>`);
  return { dom, name, target: document.getElementById('app') };
}

test.beforeEach(() => setDevMode(false));
test.afterEach(() => setDevMode(true));

test('initial falsy data-show state adds hidden before mount content is visible', () => {
  const { name, target } = fixture('<div data-show="visible"></div>');
  mount(name, { target, store: createStore({ visible: false }) });
  assert.equal(target.firstElementChild.hidden, true);
  assert.equal(target.firstElementChild.hasAttribute('hidden'), true);
});

test('initial truthy data-show state removes a pre-existing hidden attribute', () => {
  const { name, target } = fixture('<div data-show="visible" hidden></div>');
  mount(name, { target, store: createStore({ visible: true }) });
  assert.equal(target.firstElementChild.hidden, false);
  assert.equal(target.firstElementChild.hasAttribute('hidden'), false);
});

test('data-show updates hidden across false to true to false transitions', () => {
  const { name, target } = fixture('<div data-show="visible"></div>');
  const store = createStore({ visible: false });
  mount(name, { target, store });
  const element = target.firstElementChild;
  assert.equal(element.hidden, true);
  store.set('visible', true);
  assert.equal(element.hidden, false);
  store.set('visible', false);
  assert.equal(element.hidden, true);
});

test('data-show never changes an initially empty inline display value', () => {
  const { name, target } = fixture('<div data-show="visible"></div>');
  const store = createStore({ visible: false });
  mount(name, { target, store });
  const element = target.firstElementChild;
  assert.equal(element.style.display, '');
  store.set('visible', true);
  store.set('visible', false);
  assert.equal(element.style.display, '');
});

for (const display of ['grid', 'flex']) {
  test(`data-show preserves inline display:${display} across every transition`, () => {
    const { name, target } = fixture(`<div data-show="visible" style="display: ${display}"></div>`);
    const store = createStore({ visible: false });
    mount(name, { target, store });
    const element = target.firstElementChild;
    assert.equal(element.style.display, display);
    store.set('visible', true);
    assert.equal(element.style.display, display);
    store.set('visible', false);
    assert.equal(element.style.display, display);
  });
}

test('scoped compatibility rule hides a display-important utility element', () => {
  const { dom, name, target } = fixture(`
    <style>.d-flex { display: flex !important; }</style>
    <div class="d-flex" data-show="visible"></div>
  `);
  mount(name, { target, store: createStore({ visible: false }) });
  const element = target.querySelector('[data-show]');
  assert.equal(element.hidden, true);
  // jsdom does not reliably apply !important cascade precedence here; assert
  // the browser-facing state and installed compatibility rule instead.
  assert.ok(dom.window.document.getElementById(SHOW_STYLE_ID));
  assert.equal(document.getElementById(SHOW_STYLE_ID).textContent.trim(), '[data-show][hidden] { display: none !important; }');
});

test('multiple mounts install one shared visibility style in a document', () => {
  installDom(`
    <template id="tpl-one"><div data-show="visible"></div></template>
    <template id="tpl-two"><div data-show="visible"></div></template>
    <main id="one"></main><main id="two"></main>
  `);
  const store = createStore({ visible: false });
  mount('one', { target: document.getElementById('one'), store });
  mount('two', { target: document.getElementById('two'), store });
  assert.equal(document.querySelectorAll(`#${SHOW_STYLE_ID}`).length, 1);
});

test('separate documents each receive their own visibility style', () => {
  const first = installDom();
  const second = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const firstFragment = first.window.document.createRange().createContextualFragment('<div data-show="visible"></div>');
  const secondFragment = second.window.document.createRange().createContextualFragment('<div data-show="visible"></div>');
  const firstCleanup = setupShowBindings(firstFragment, createStore({ visible: false }));
  const secondCleanup = setupShowBindings(secondFragment, createStore({ visible: false }));
  assert.equal(first.window.document.querySelectorAll(`#${SHOW_STYLE_ID}`).length, 1);
  assert.equal(second.window.document.querySelectorAll(`#${SHOW_STYLE_ID}`).length, 1);
  assert.notEqual(first.window.document.getElementById(SHOW_STYLE_ID), second.window.document.getElementById(SHOW_STYLE_ID));
  firstCleanup();
  secondCleanup();
});

test('rendered content without data-show does not install a visibility style', () => {
  const { name, target } = fixture('<div>always visible</div>');
  mount(name, { target, store: createStore({}) });
  assert.equal(document.getElementById(SHOW_STYLE_ID), null);
});

test('data-show preserves DOM identity and input value while toggling', () => {
  const { name, target } = fixture('<section data-show="visible"><input value="initial"></section>');
  const store = createStore({ visible: true });
  mount(name, { target, store });
  const element = target.firstElementChild;
  const input = element.querySelector('input');
  input.value = 'user state';
  store.set('visible', false);
  store.set('visible', true);
  assert.equal(target.firstElementChild, element);
  assert.equal(element.querySelector('input'), input);
  assert.equal(input.value, 'user state');
});

test('data-show cleanup unsubscribes from future store updates', () => {
  const { name, target } = fixture('<div data-show="visible"></div>');
  const store = createStore({ visible: false });
  const cleanup = mount(name, { target, store });
  const element = target.firstElementChild;
  cleanup();
  store.set('visible', true);
  assert.equal(element.hidden, true);
});

test('empty data-show emits SHOW_MISSING_PATH and leaves the element untouched', () => {
  const { name, target } = fixture('<div data-show></div>');
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
  mount(name, { target, store: createStore({}) });
  unsubscribe();
  assert.equal(target.firstElementChild.hasAttribute('hidden'), false);
  assert.deepEqual(diagnostics.map(({ code }) => code), ['SHOW_MISSING_PATH']);
});

test('data-show elements under data-lime-ignore remain untouched', () => {
  const { name, target } = fixture('<div data-lime-ignore><div data-show="visible" hidden></div></div>');
  const store = createStore({ visible: true });
  mount(name, { target, store });
  const element = target.querySelector('[data-show]');
  assert.equal(element.hidden, true);
  store.set('visible', false);
  store.set('visible', true);
  assert.equal(element.hidden, true);
  assert.equal(document.getElementById(SHOW_STYLE_ID), null);
});

test('data-show inside deferred live content binds during the later render pass', () => {
  const { name, target } = fixture(`
    <if is-truthy="expanded" data-live>
      <div data-show="visible">deferred</div>
    <else><span>closed</span></else></if>
  `);
  const store = createStore({ expanded: false, visible: false });
  mount(name, { target, store });
  assert.equal(target.querySelector('[data-show]'), null);
  assert.equal(document.getElementById(SHOW_STYLE_ID), null);
  store.set('expanded', true);
  const element = target.querySelector('[data-show]');
  assert.equal(element.hidden, true);
  assert.ok(document.getElementById(SHOW_STYLE_ID));
  store.set('visible', true);
  assert.equal(element.hidden, false);
});
