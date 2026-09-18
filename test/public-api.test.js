import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// ── 1. PACKAGE ROOT EXPORTS VERIFICATION ──────────────────────────────────────

test('public api: root package imports expected facade, store, diagnostics, and kernel symbols', async () => {
  const root = await import('lime-csr-js');

  // Facade entrypoints
  assert.equal(typeof root.mount, 'function');
  assert.equal(typeof root.unmount, 'function');
  assert.equal(typeof root.render, 'function');

  // Store
  assert.equal(typeof root.createStore, 'function');
  assert.equal(typeof root.getByPath, 'function');
  assert.equal(typeof root.setByPath, 'function');

  // Diagnostics & Dev Mode
  assert.equal(typeof root.error, 'function');
  assert.equal(typeof root.warn, 'function');
  assert.equal(typeof root.reportError, 'function');
  assert.equal(typeof root.subscribeDiagnostics, 'function');
  assert.equal(typeof root.setDevMode, 'function');
  assert.equal(typeof root.isDevMode, 'function');
  assert.equal(typeof root.loadDevMessages, 'function');

  // Kernel Primitives
  assert.equal(typeof root.createEngine, 'function');
  assert.equal(typeof root.defineModule, 'function');
  assert.equal(typeof root.attr, 'function');
  assert.equal(typeof root.attrs, 'function');
  assert.equal(typeof root.tag, 'function');
  assert.equal(typeof root.pattern, 'function');
  assert.equal(typeof root.createScope, 'function');

  // Standard Modules
  assert.equal(typeof root.partials, 'function');
  assert.equal(typeof root.conditionals, 'function');
  assert.equal(typeof root.loops, 'function');
  assert.equal(typeof root.text, 'function');
  assert.equal(typeof root.show, 'function');
  assert.equal(typeof root.model, 'function');
  assert.equal(typeof root.events, 'function');
  assert.equal(typeof root.ref, 'function');

  // Exact 35 public root export keys
  const exportedKeys = Object.keys(root).sort();
  assert.deepEqual(exportedKeys, [
    'attr',
    'attrs',
    'conditionals',
    'createEngine',
    'createScope',
    'createStore',
    'defineModule',
    'error',
    'escapeHtml',
    'events',
    'getByPath',
    'getTemplate',
    'isDevMode',
    'loadDevMessages',
    'loops',
    'model',
    'mount',
    'partials',
    'pattern',
    'ref',
    'render',
    'renderTemplate',
    'reportError',
    'resolveStatic',
    'safeAttr',
    'safeStyleUrl',
    'safeUrl',
    'setByPath',
    'setDevMode',
    'show',
    'subscribeDiagnostics',
    'tag',
    'text',
    'unmount',
    'warn',
  ]);
});

// ── 2. PLUGIN API REMOVAL FROM ROOT ──────────────────────────────────────────

test('public api: legacy plugin symbols are strictly absent from root package', async () => {
  const root = await import('lime-csr-js');

  assert.equal(root.definePlugin, undefined, 'definePlugin must NOT exist in root export');
  assert.equal(root.PLUGIN_API_VERSION, undefined, 'PLUGIN_API_VERSION must NOT exist in root export');
  assert.equal(root.createPluginRuntime, undefined, 'createPluginRuntime must NOT exist in root export');
  assert.equal(root.adaptPluginToModule, undefined, 'adaptPluginToModule must NOT exist in root export');
});

// ── 2b. LEGACY PIPELINE HELPERS REMOVAL FROM ROOT ────────────────────────────

test('public api: legacy pipeline helpers and defaultEngine are strictly absent from root package', async () => {
  const root = await import('lime-csr-js');

  assert.equal(root.defaultEngine, undefined, 'defaultEngine must NOT be exported');
  assert.equal(root.evalCondition, undefined, 'evalCondition must NOT be exported');
  assert.equal(root.processAllIfs, undefined, 'processAllIfs must NOT be exported');
  assert.equal(root.OPERATORS, undefined, 'OPERATORS must NOT be exported');
  assert.equal(root.expandLoops, undefined, 'expandLoops must NOT be exported');
  assert.equal(root.expandPartials, undefined, 'expandPartials must NOT be exported');
  assert.equal(root.setupBindings, undefined, 'setupBindings must NOT be exported');
  assert.equal(root.setupModelBindings, undefined, 'setupModelBindings must NOT be exported');
  assert.equal(root.setupShowBindings, undefined, 'setupShowBindings must NOT be exported');
  assert.equal(root.setupEventBindings, undefined, 'setupEventBindings must NOT be exported');
  assert.equal(root.setupLiveIfs, undefined, 'setupLiveIfs must NOT be exported');
  assert.equal(root.setupLiveFors, undefined, 'setupLiveFors must NOT be exported');
});

// ── 3. CORE SUBPATH EXPORTS ──────────────────────────────────────────────────

test('public api: "lime-csr-js/core" exports strictly intended public kernel primitives without internal leaks', async () => {
  const core = await import('lime-csr-js/core');

  const exportedKeys = Object.keys(core).sort();
  assert.deepEqual(exportedKeys, [
    'attr',
    'attrs',
    'createEngine',
    'createIsolatedScope',
    'createScope',
    'defineModule',
    'getElementScope',
    'isLocalScopeBinding',
    'pattern',
    'setElementScope',
    'tag',
  ]);

  // Verify internal mechanisms are NOT exposed
  assert.equal(core.createRouter, undefined, 'createRouter is internal');
  assert.equal(core.runTransform, undefined, 'runTransform is internal');
  assert.equal(core.runLink, undefined, 'runLink is internal');
  assert.equal(core.createCleanupStack, undefined, 'createCleanupStack is internal');
  assert.equal(core.createModuleContext, undefined, 'createModuleContext is internal');
  assert.equal(core.matchTrigger, undefined, 'matchTrigger is internal');
  assert.equal(core.matchElementTriggers, undefined, 'matchElementTriggers is internal');
  assert.equal(core.resolveTriggerPrecedence, undefined, 'resolveTriggerPrecedence is internal');
  assert.equal(core.definePlugin, undefined, 'definePlugin is absent');
});

// ── 4. MODULES SUBPATH EXPORTS ────────────────────────────────────────────────

test('public api: "lime-csr-js/modules" exports all 8 standard unprivileged modules', async () => {
  const modules = await import('lime-csr-js/modules');

  const moduleKeys = Object.keys(modules).sort();
  assert.deepEqual(moduleKeys, [
    'conditionals',
    'events',
    'loops',
    'model',
    'partials',
    'ref',
    'show',
    'text',
  ]);

  for (const key of moduleKeys) {
    assert.equal(typeof modules[key], 'function', `${key} must be a module factory function`);
  }
});

// ── 5. GRANULAR MODULES SUBPATH EXPORTS ────────────────────────────────────────

test('public api: granular "lime-csr-js/modules/*" subpaths import each standard module individually', async () => {
  const textMod = await import('lime-csr-js/modules/text');
  const showMod = await import('lime-csr-js/modules/show');
  const modelMod = await import('lime-csr-js/modules/model');
  const eventsMod = await import('lime-csr-js/modules/events');
  const condMod = await import('lime-csr-js/modules/conditionals');
  const loopsMod = await import('lime-csr-js/modules/loops');
  const partialsMod = await import('lime-csr-js/modules/partials');
  const refMod = await import('lime-csr-js/modules/ref');

  assert.equal(typeof textMod.text, 'function');
  assert.equal(typeof showMod.show, 'function');
  assert.equal(typeof modelMod.model, 'function');
  assert.equal(typeof eventsMod.events, 'function');
  assert.equal(typeof condMod.conditionals, 'function');
  assert.equal(typeof loopsMod.loops, 'function');
  assert.equal(typeof partialsMod.partials, 'function');
  assert.equal(typeof refMod.ref, 'function');
});

// ── 6. END-TO-END EXECUTION VIA SUBPATHS ──────────────────────────────────────

test('public api: build custom engine using only core and modules subpaths', () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"><span data-text="greeting"></span></div></body></html>', {
    url: 'http://localhost/',
  });
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.Element = dom.window.Element;

  return Promise.all([
    import('lime-csr-js/core'),
    import('lime-csr-js/modules/text'),
    import('lime-csr-js'),
  ]).then(([{ createEngine }, { text }, { createStore }]) => {
    const engine = createEngine({
      modules: [text()],
    });

    const target = dom.window.document.getElementById('app');
    const store = createStore({ greeting: 'Subpath Modular Success' });

    engine.mount({ target: target, ...{ store } });
    assert.equal(target.querySelector('span').textContent, 'Subpath Modular Success');

    engine.unmount(target);
    assert.ok(target.querySelector('span'), 'Caller DOM preserved after in-place unmount');
    assert.equal(target.querySelector('span').textContent, 'Subpath Modular Success');
  });
});

// ── 7. IMPORT-TIME SIDE EFFECT AUDIT ──────────────────────────────────────────

test('public api: importing modules causes zero global DOM or document mutations', async () => {
  const dom = new JSDOM('<!doctype html><html><head id="head"></head><body></body></html>');
  globalThis.document = dom.window.document;

  const headChildrenBefore = dom.window.document.head.children.length;

  // Import modules
  await import('lime-csr-js/modules/show');
  await import('lime-csr-js/modules/events');
  await import('lime-csr-js/modules/model');

  const headChildrenAfter = dom.window.document.head.children.length;
  assert.equal(headChildrenAfter, headChildrenBefore, 'Importing modules must not inject styles or mutate head');
  assert.equal(dom.window.document.getElementById('lime-csr-data-show-style'), null, 'data-show style must not be injected at import time');
});
