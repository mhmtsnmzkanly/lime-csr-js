import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  createStore,
  getByPath,
  mount,
  setDevMode,
  setByPath,
  unmount,
} from '../src/index.js';

let templateNumber = 0;

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
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  return dom;
}

function fixture(template, name = `case-${++templateNumber}`) {
  installDom(`<template id="tpl-${name}">${template}</template><main id="app"></main>`);
  return { name, target: document.getElementById('app') };
}

test.beforeEach(() => setDevMode(false));

test('store supports reads, nested writes, updates, subscriptions, and unsubscribe', () => {
  const initial = { count: 1, user: { name: 'Ada' } };
  const store = createStore(initial);
  const calls = [];
  const unsubscribe = store.subscribe('user.name', (value, previous, path) => calls.push([value, previous, path]));

  assert.equal(store.get(), initial);
  assert.equal(store.get('user.name'), 'Ada');
  assert.equal(store.get('missing.path'), undefined);
  assert.equal(store.set('user.name', 'Grace'), true);
  assert.deepEqual(calls, [['Grace', 'Ada', 'user.name']]);
  assert.equal(store.set('user.name', 'Grace'), false);
  assert.equal(store.update('count', (value) => value + 1), true);
  assert.equal(store.get('count'), 2);
  unsubscribe();
  store.set('user.name', 'Lin');
  assert.equal(calls.length, 1);
});

test('store path writes reject prototype-pollution segments', () => {
  const state = {};
  assert.equal(setByPath(state, '__proto__.polluted', true).changed, false);
  assert.equal(setByPath(state, 'safe.constructor.value', true).changed, false);
  assert.equal({}.polluted, undefined);
  assert.equal(getByPath({ user: { name: 'Ada' } }, 'user.name'), 'Ada');
  assert.equal(getByPath({}, 'constructor.name'), undefined);
});

test('mount renders static interpolation, static blocks, loops, and partials', () => {
  const { name, target } = fixture(`
    <p class="title">Hello \${user.name}</p>
    <if is-truthy="show"><b>visible</b><else><i>hidden</i></else></if>
    <for each="items" as="item"><span class="item">\${item}</span></for>
    <partial name="card" data="user"></partial>
  `);
  document.body.insertAdjacentHTML('afterbegin', '<template id="tpl-card"><em>${name}</em></template>');
  mount(name, { user: { name: 'Ada' }, show: false, items: ['a', 'b'] }, target, null);
  assert.equal(target.querySelector('.title').textContent.trim(), 'Hello Ada');
  assert.equal(target.querySelector('i').textContent, 'hidden');
  assert.deepEqual([...target.querySelectorAll('.item')].map((el) => el.textContent), ['a', 'b']);
  assert.equal(target.querySelector('em').textContent, 'Ada');
});

test('reactive text, attributes, model, show, live if, and live for update', () => {
  const { name, target } = fixture(`
    <span id="text" data-text="name"></span>
    <a id="link" href="/u/{name}" data-name="name">profile</a>
    <input id="model" data-model="name">
    <p id="shown" data-show="visible">shown</p>
    <if is-truthy="visible" data-live><strong>yes</strong><else><strong>no</strong></else></if>
    <for each="items" as="item" key="item.id" data-live><span class="live-item">\${item.label}</span></for>
  `);
  const store = createStore({ name: 'Ada', visible: false, items: [{ id: 1, label: 'one' }] });
  mount(name, {}, target, store);
  assert.equal(target.querySelector('#text').textContent, 'Ada');
  assert.equal(target.querySelector('#link').getAttribute('href'), '/u/Ada');
  assert.equal(target.querySelector('#model').value, 'Ada');
  assert.equal(target.querySelector('#shown').style.display, 'none');
  assert.equal(target.querySelector('strong').textContent, 'no');

  store.set('name', 'Grace');
  store.set('visible', true);
  store.set('items', [{ id: 2, label: 'two' }, { id: 1, label: 'one' }]);
  assert.equal(target.querySelector('#text').textContent, 'Grace');
  assert.equal(target.querySelector('#link').getAttribute('href'), '/u/Grace');
  assert.equal(target.querySelector('#shown').style.display, '');
  assert.equal(target.querySelector('strong').textContent, 'yes');
  assert.deepEqual([...target.querySelectorAll('.live-item')].map((el) => el.textContent), ['two', 'one']);

  const input = target.querySelector('#model');
  input.value = 'Lin';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(store.get('name'), 'Lin');
});

test('delegated handlers work for click, input, change, submit, keydown, and later live nodes', () => {
  const { name, target } = fixture(`
    <button id="click" data-on-click="click">click</button>
    <input id="input" data-on-input="input" data-on-change="change" data-on-keydown="keydown">
    <form id="form" data-on-submit="submit"></form>
    <for each="items" as="item" key="item.id" data-live><button class="later" data-on-click="click">\${item.id}</button></for>
  `);
  const store = createStore({ items: [] });
  const calls = [];
  mount(name, {}, target, store, { handlers: {
    click: (_event, element) => calls.push(`click:${element.id || element.className}`),
    input: () => calls.push('input'),
    change: () => calls.push('change'),
    keydown: () => calls.push('keydown'),
    submit: () => calls.push('submit'),
  } });
  target.querySelector('#click').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  target.querySelector('#input').dispatchEvent(new Event('input', { bubbles: true }));
  target.querySelector('#input').dispatchEvent(new Event('change', { bubbles: true }));
  target.querySelector('#input').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
  const submit = new Event('submit', { bubbles: true, cancelable: true });
  target.querySelector('#form').dispatchEvent(submit);
  store.set('items', [{ id: 1 }]);
  target.querySelector('.later').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.deepEqual(calls, ['click:click', 'input', 'change', 'keydown', 'submit', 'click:later']);
  assert.equal(submit.defaultPrevented, true);
});

test('mount replacement, returned cleanup, and unmount remove subscriptions and event listeners', () => {
  const { name, target } = fixture('<button data-on-click="hit"></button><span data-text="value"></span>');
  const store = createStore({ value: 'a' });
  let hits = 0;
  const cleanup = mount(name, {}, target, store, { handlers: { hit: () => { hits += 1; } } });
  target.querySelector('button').click();
  cleanup();
  target.querySelector('button').click();
  store.set('value', 'b');
  assert.equal(hits, 1);
  assert.equal(target.querySelector('span').textContent, 'a');
  mount(name, {}, target, store, { handlers: { hit: () => { hits += 1; } } });
  unmount(target);
  assert.equal(target.textContent, '');
  store.set('value', 'c');
});

test('warnings are emitted in development mode for missing templates, invalid operators, missing partials, and handlers', () => {
  const warnings = [];
  const oldWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  setDevMode(true);
  const { target } = fixture('<if is-not-real="x">bad</if><partial name="missing"></partial><button data-on-click="missing"></button>');
  mount('does-not-exist', {}, target, null);
  const name = `warning-${++templateNumber}`;
  document.body.insertAdjacentHTML('afterbegin', `<template id="tpl-${name}"><if is-not-real="x">bad</if><partial name="missing"></partial><button data-on-click="missing"></button></template>`);
  mount(name, { x: true }, target, createStore({}), { handlers: {} });
  target.querySelector('button')?.click();
  console.warn = oldWarn;
  assert.ok(warnings.some((message) => message.includes('MOUNT_TEMPLATE_NOT_FOUND')));
  assert.ok(warnings.some((message) => message.includes('UNKNOWN_OPERATOR')));
  assert.ok(warnings.some((message) => message.includes('PARTIAL_NOT_FOUND')));
  assert.ok(warnings.some((message) => message.includes('HANDLER_NOT_FOUND')));
});

test('development error overlay treats warning text as text, not markup', () => {
  installDom();
  setDevMode(true);
  const oldWarn = console.warn;
  console.warn = () => {};
  const name = '<img src=x onerror=globalThis.__limeXss=true>';
  document.body.insertAdjacentHTML('beforeend', '<main id="app"></main>');
  mount(name, {}, document.getElementById('app'), null);
  console.warn = oldWarn;
  assert.equal(document.querySelector('#lime-csr-error-overlay-container img'), null);
  assert.equal(globalThis.__limeXss, undefined);
});

test('event handler lookup does not call inherited object methods', () => {
  const { name, target } = fixture('<button data-on-click="toString">safe</button>');
  const warnings = [];
  const oldWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  setDevMode(true);
  mount(name, {}, target, createStore({}), { handlers: {} });
  target.querySelector('button').click();
  console.warn = oldWarn;
  assert.ok(warnings.some((message) => message.includes('HANDLER_NOT_FOUND')));
});
