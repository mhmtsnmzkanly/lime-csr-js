import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  definePlugin,
  mount,
  PLUGIN_API_VERSION,
  setDevMode,
  subscribeDiagnostics,
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
  const name = `perf-safety-${++templateNumber}`;
  const dom = installDom(`<template id="tpl-${name}">${template}</template><main id="app"></main>`);
  return { dom, name, target: document.getElementById('app') };
}

test.beforeEach(() => setDevMode(false));
test.afterEach(() => setDevMode(true));

test('setupDirectives performs a single querySelectorAll pass across multiple directives', () => {
  installDom();
  const queries = [];
  const fragment = document.createDocumentFragment();
  const el = document.createElement('div');
  el.setAttribute('data-lime-alpha', '');
  el.setAttribute('data-lime-beta', '');
  fragment.appendChild(el);

  const origQSA = fragment.querySelectorAll.bind(fragment);
  fragment.querySelectorAll = (selector) => {
    queries.push(selector);
    return origQSA(selector);
  };

  const plugin = definePlugin({
    name: 'multi-directive-perf',
    apiVersion: PLUGIN_API_VERSION,
    directives: {
      'data-lime-alpha'() {},
      'data-lime-beta'() {},
      'data-lime-gamma'() {},
    },
  });

  const runtime = createPluginRuntime([plugin], {
    target: document.createElement('div'),
    isDev: false,
  });
  runtime.setupDirectives(fragment, {});

  assert.equal(queries.length, 1);
  assert.equal(queries[0], '[data-lime-alpha], [data-lime-beta], [data-lime-gamma]');
});

test('diagnoseStructuralTargets performs a single querySelectorAll pass across multiple directives', () => {
  installDom();
  const queries = [];
  const fragment = document.createDocumentFragment();
  const el = document.createElement('div');
  fragment.appendChild(el);

  const origQSA = fragment.querySelectorAll.bind(fragment);
  fragment.querySelectorAll = (selector) => {
    queries.push(selector);
    return origQSA(selector);
  };

  const plugin = definePlugin({
    name: 'multi-directive-diagnose-perf',
    apiVersion: PLUGIN_API_VERSION,
    directives: {
      'data-lime-alpha'() {},
      'data-lime-beta'() {},
      'data-lime-gamma'() {},
    },
  });

  const runtime = createPluginRuntime([plugin], {
    target: document.createElement('div'),
    isDev: false,
  });
  runtime.diagnoseStructuralTargets(fragment);

  assert.equal(queries.length, 1);
  assert.equal(queries[0], '[data-lime-alpha], [data-lime-beta], [data-lime-gamma]');
});

test('directive removing an element prevents subsequent directives on that element from executing', () => {
  const { name, target } = fixture('<div data-lime-remover data-lime-subsequent>content</div>');
  const order = [];

  const plugin = definePlugin({
    name: 'removal-guard',
    apiVersion: PLUGIN_API_VERSION,
    directives: {
      'data-lime-remover'({ element }) {
        order.push('remover');
        element.remove();
      },
      'data-lime-subsequent'() {
        order.push('subsequent');
      },
    },
  });

  mount(name, { target, plugins: [plugin] });

  assert.deepEqual(order, ['remover']);
});

test('directive removing an ancestor element prevents directives on detached descendants from executing', () => {
  const { name, target } = fixture(`
    <div id="parent" data-lime-parent-remover>
      <span id="child" data-lime-child>child text</span>
    </div>
  `);
  const order = [];

  const plugin = definePlugin({
    name: 'tree-removal-guard',
    apiVersion: PLUGIN_API_VERSION,
    directives: {
      'data-lime-parent-remover'({ element }) {
        order.push('parent-remover');
        element.remove();
      },
      'data-lime-child'() {
        order.push('child');
      },
    },
  });

  mount(name, { target, plugins: [plugin] });

  assert.deepEqual(order, ['parent-remover']);
});

test('multiple directives on the same element execute in registration order', () => {
  const { name, target } = fixture('<div data-lime-first data-lime-second data-lime-third></div>');
  const executionOrder = [];
  const cleanupOrder = [];

  const plugin = definePlugin({
    name: 'order-check',
    apiVersion: PLUGIN_API_VERSION,
    directives: {
      'data-lime-first'() {
        executionOrder.push('first');
        return () => cleanupOrder.push('cleanup-first');
      },
      'data-lime-second'() {
        executionOrder.push('second');
        return () => cleanupOrder.push('cleanup-second');
      },
      'data-lime-third'() {
        executionOrder.push('third');
        return () => cleanupOrder.push('cleanup-third');
      },
    },
  });

  const cleanup = mount(name, { target, plugins: [plugin] });

  assert.deepEqual(executionOrder, ['first', 'second', 'third']);
  cleanup();
  assert.deepEqual(cleanupOrder, ['cleanup-third', 'cleanup-second', 'cleanup-first']);
});

test('structural target with multiple directives emits diagnostics for each without redundant traversals', () => {
  const { name, target } = fixture(`
    <if is-truthy="flag" data-lime-struct-a data-lime-struct-b>
      <div>body</div>
    </if>
  `);
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((d) => diagnostics.push(d));

  const plugin = definePlugin({
    name: 'structural-multi',
    apiVersion: PLUGIN_API_VERSION,
    directives: {
      'data-lime-struct-a'() {},
      'data-lime-struct-b'() {},
    },
  });

  mount(name, { target, context: { flag: true }, plugins: [plugin] });
  unsubscribe();

  const structDiagnostics = diagnostics.filter(
    (d) => d.code === 'PLUGIN_DIRECTIVE_STRUCTURAL_TARGET',
  );
  assert.equal(structDiagnostics.length, 2);
  const directiveNames = structDiagnostics.map((d) => d.context.directive).sort();
  assert.deepEqual(directiveNames, ['data-lime-struct-a', 'data-lime-struct-b']);
});
