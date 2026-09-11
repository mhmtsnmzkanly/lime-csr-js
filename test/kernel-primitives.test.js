import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  attr,
  attrs,
  tag,
  pattern,
  createScope,
  createIsolatedScope,
  isLocalScopeBinding,
  defineModule,
} from '../src/core/index.js';
import { createCleanupStack, createModuleContext } from '../src/core/context.js';
import { createStore } from '../src/store.js';
import { setDevMode, subscribeDiagnostics } from '../src/errors.js';

function createElement(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  return dom.window.document.body.firstElementChild;
}

test.beforeEach(() => {
  setDevMode(false);
});

// ── 1. TRIGGER FACTORIES ──────────────────────────────────────────────────────

test('triggers: attr() creates frozen exact attribute trigger definition', () => {
  const t = attr('x-tooltip');
  assert.equal(t.type, 'attr');
  assert.equal(t.name, 'x-tooltip');
  assert.equal(t.phase, 'link');
  assert.equal(Object.isFrozen(t), true);
});

test('triggers: tag() normalizes tag name to uppercase and defaults to transform phase', () => {
  const t = tag('custom-card');
  assert.equal(t.type, 'tag');
  assert.equal(t.name, 'CUSTOM-CARD');
  assert.equal(t.phase, 'transform');
  assert.equal(Object.isFrozen(t), true);
});

test('triggers: pattern() creates prefix and RegExp trigger definitions', () => {
  const tPrefix = pattern('data-on-');
  assert.equal(tPrefix.type, 'pattern');
  assert.equal(tPrefix.pattern, 'data-on-');
  assert.equal(tPrefix.phase, 'link');

  const re = /^aria-/;
  const tRegex = pattern(re);
  assert.equal(tRegex.type, 'pattern');
  assert.equal(tRegex.pattern, re);
});

test('triggers: attrs() creates multi-attribute group definition with frozen required/optional arrays', () => {
  const t = attrs({
    required: ['cond-l', 'cond-op'],
    optional: ['cond-r'],
  });
  assert.equal(t.type, 'attrs');
  assert.deepEqual(t.required, ['cond-l', 'cond-op']);
  assert.deepEqual(t.optional, ['cond-r']);
  assert.equal(Object.isFrozen(t.required), true);
  assert.equal(Object.isFrozen(t.optional), true);
});

test('triggers: invalid trigger definitions throw TypeError', () => {
  assert.throws(() => attr(''), TypeError);
  assert.throws(() => tag(''), TypeError);
  assert.throws(() => pattern(123), TypeError);
  assert.throws(() => attrs({ required: [] }), TypeError);
});

// ── 2. MODULE DEFINITION ──────────────────────────────────────────────────────

test('defineModule: validates module name pattern and freezes definition', () => {
  const mod = defineModule({
    name: 'custom-widget',
    triggers: [attr('data-widget', () => {})],
  });
  assert.equal(mod.name, 'custom-widget');
  assert.equal(Object.isFrozen(mod), true);
  assert.equal(Object.isFrozen(mod.triggers), true);

  assert.throws(() => defineModule({ name: 'INVALID_NAME', triggers: [attr('x')] }), TypeError);
  assert.throws(() => defineModule({ name: 'widget', triggers: [] }), TypeError);
});

// ── 4. CLEANUP (SINGLE LIFO STACK) ──────────────────────────────────────────

test('cleanup: runs in LIFO order, combines onCleanup and returned cleanup into single stack', () => {
  const calls = [];
  const stack = createCleanupStack();

  stack.onCleanup(() => calls.push('first-onCleanup'));
  stack.onCleanup(() => calls.push('second-onCleanup'));
  stack.attachSetupCleanup(() => calls.push('returned-cleanup'));

  stack.run();

  // LIFO: returned-cleanup was attached last, so it runs first, then second, then first
  assert.deepEqual(calls, ['returned-cleanup', 'second-onCleanup', 'first-onCleanup']);
});

test('cleanup: idempotent (running multiple times produces zero additional calls)', () => {
  const calls = [];
  const stack = createCleanupStack();
  stack.onCleanup(() => calls.push('cleanup'));

  stack.run();
  assert.deepEqual(calls, ['cleanup']);

  stack.run();
  assert.deepEqual(calls, ['cleanup'], 'Second run must be a no-op');
});

test('cleanup: failure in one cleanup does not prevent remaining cleanups from executing', () => {
  const calls = [];
  const diagnostics = [];
  const unsub = subscribeDiagnostics((d) => diagnostics.push(d));

  const stack = createCleanupStack();
  stack.onCleanup(() => calls.push('c1'));
  stack.onCleanup(() => {
    throw new Error('Boom in cleanup');
  });
  stack.onCleanup(() => calls.push('c3'));

  stack.run();
  unsub();

  // c3 ran, error occurred, but c1 still ran!
  assert.deepEqual(calls, ['c3', 'c1']);

  const failureDiag = diagnostics.find((d) => d.code === 'MODULE_CLEANUP_FAILED');
  assert.ok(failureDiag, 'Should report MODULE_CLEANUP_FAILED diagnostic');
  assert.match(failureDiag.context.error.message, /Boom in cleanup/);
});

// ── 5. SCOPE ─────────────────────────────────────────────────────────────────

test('scope: child reads parent value, child shadows parent value, parent cannot see child value', () => {
  const parent = createScope(null, { title: 'Parent Title', count: 1 });
  const child = createScope(parent, { count: 2, childOnly: 'Local' });

  // Child reads parent title
  assert.equal(child.title, 'Parent Title');

  // Child shadows count
  assert.equal(child.count, 2);
  assert.equal(parent.count, 1);

  // Local binding check
  assert.equal(isLocalScopeBinding(child, 'count'), true);
  assert.equal(isLocalScopeBinding(child, 'title'), false);

  // Parent cannot see child-only variable
  assert.equal(parent.childOnly, undefined);
  assert.equal(child.childOnly, 'Local');
});

test('scope: createIsolatedScope creates prototype-free isolated scope for partials', () => {
  const isoScope = createIsolatedScope({ user: 'Alice' }, { theme: 'dark' });
  assert.equal(isoScope.user, 'Alice');
  assert.equal(isoScope.theme, 'dark');
  assert.equal(Object.getPrototypeOf(isoScope), null);
});

// ── 6. STORE ACCESS & WATCH HELPER ──────────────────────────────────────────

test('context: store access and watch helper automatically registers cleanup and isolates errors', () => {
  const store = createStore({ count: 5 });
  const observed = [];
  const { ctx, cleanupStack } = createModuleContext({
    store,
    moduleName: 'counter-mod',
  });

  assert.equal(ctx.store.get('count'), 5);

  ctx.watch('count', (val) => observed.push(val), { immediate: true });
  assert.deepEqual(observed, [5]);

  store.set('count', 10);
  assert.deepEqual(observed, [5, 10]);

  // Running cleanup unsubscribes watch
  cleanupStack.run();

  store.set('count', 20);
  assert.deepEqual(observed, [5, 10], 'Unsubscribed watch should not fire after cleanup');
});

// ── 7. CENTRAL DIAGNOSTICS & ERROR REPORTING ────────────────────────────────

test('context: error and warn delegate to central diagnostic system', () => {
  const diagnostics = [];
  const unsub = subscribeDiagnostics((d) => diagnostics.push(d));

  const el = createElement('<div id="err-el"></div>');
  const { ctx } = createModuleContext({
    moduleName: 'test-mod',
    element: el,
  });

  ctx.error('TEST_MODULE_ERROR', { detail: 'something failed' });
  ctx.warn('TEST_MODULE_WARN', 'warning message');

  unsub();

  const errDiag = diagnostics.find((d) => d.code === 'TEST_MODULE_ERROR');
  const warnDiag = diagnostics.find((d) => d.code === 'TEST_MODULE_WARN');

  assert.ok(errDiag, 'Should receive TEST_MODULE_ERROR in diagnostics');
  assert.ok(warnDiag, 'Should receive TEST_MODULE_WARN in diagnostics');
  assert.equal(errDiag.context, el);
});
