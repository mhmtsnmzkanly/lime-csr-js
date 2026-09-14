import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  attr,
  defineModule,
  createEngine,
} from '../src/core/index.js';
import { setDevMode } from '../src/errors.js';

function createDom(html = '') {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
}

test.beforeEach(() => {
  setDevMode(false);
});

// ── 1. ACCEPT MODULES & VALIDATION ──────────────────────────────────────────

test('engine: createEngine accepts modules and freezes definition list', () => {
  const mod = defineModule({
    name: 'test-mod',
    triggers: [attr('x-test', () => {})],
  });

  const engine = createEngine({ modules: [mod] });
  assert.equal(typeof engine.mount, 'function');
  assert.equal(typeof engine.unmount, 'function');
  assert.equal(typeof engine.render, 'function');
  assert.equal(engine.modules.length, 1);
  assert.equal(engine.modules[0].name, 'test-mod');
  assert.throws(() => {
    createEngine({ modules: 'invalid' });
  }, TypeError);
});

// ── 2. COMPILES ONCE & IMMUTABILITY ─────────────────────────────────────────

test('engine: routes compile once at creation and input array mutation has no effect', () => {
  const mod1 = defineModule({
    name: 'mod-one',
    triggers: [attr('x-one', (el) => { el.textContent = 'one'; })],
  });
  const mod2 = defineModule({
    name: 'mod-two',
    triggers: [attr('x-two', (el) => { el.textContent = 'two'; })],
  });

  const modulesArray = [mod1];
  const engine = createEngine({ modules: modulesArray });

  // Mutate external input array
  modulesArray.push(mod2);

  assert.equal(engine.modules.length, 1);
  assert.equal(engine.modules[0].name, 'mod-one');

  const dom = createDom('<div id="root" x-two></div>');
  const target = dom.window.document.getElementById('root');
  engine.mount(target);

  // mod2 was NOT compiled into engine
  assert.equal(target.textContent, '');
});

// ── 3. PRECEDENCE IMMUTABLE ──────────────────────────────────────────────────

test('engine: module order determines precedence at creation time', () => {
  const events = [];

  const modFirst = defineModule({
    name: 'mod-first',
    triggers: [attr('data-bind', () => { events.push('first'); })],
  });
  const modSecond = defineModule({
    name: 'mod-second',
    triggers: [attr('data-bind', () => { events.push('second'); })],
  });

  const engine = createEngine({ modules: [modFirst, modSecond] });
  const dom = createDom('<div id="target" data-bind="val"></div>');
  const target = dom.window.document.getElementById('target');

  engine.mount(target);

  // Higher priority modFirst won the trigger
  assert.deepEqual(events, ['first']);
});

// ── 4. ENGINE ISOLATION ──────────────────────────────────────────────────────

test('engine: separate engine instances maintain complete runtime isolation', () => {
  const engineAEvents = [];
  const engineBEvents = [];

  const modA = defineModule({
    name: 'mod-a',
    triggers: [attr('x-action', () => { engineAEvents.push('A'); })],
  });
  const modB = defineModule({
    name: 'mod-b',
    triggers: [attr('x-action', () => { engineBEvents.push('B'); })],
  });

  const engineA = createEngine({ modules: [modA] });
  const engineB = createEngine({ modules: [modB] });

  const dom = createDom('<div id="tA" x-action></div><div id="tB" x-action></div>');
  const targetA = dom.window.document.getElementById('tA');
  const targetB = dom.window.document.getElementById('tB');

  engineA.mount(targetA);
  engineB.mount(targetB);

  assert.deepEqual(engineAEvents, ['A']);
  assert.deepEqual(engineBEvents, ['B']);
});

// ── 5. MOUNT ISOLATION ───────────────────────────────────────────────────────

test('engine: mounts on the same engine are isolated in state and cleanup', () => {
  const cleanups = [];

  const mod = defineModule({
    name: 'count-mod',
    triggers: [attr('data-count', (el, data, ctx) => {
      ctx.onCleanup(() => cleanups.push(el.id));
    })],
  });

  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="m1" data-count></div><div id="m2" data-count></div>');
  const m1 = dom.window.document.getElementById('m1');
  const m2 = dom.window.document.getElementById('m2');

  const unmount1 = engine.mount(m1);
  engine.mount(m2);

  // Unmounting m1 should not affect m2
  unmount1();

  assert.deepEqual(cleanups, ['m1']);
  assert.equal(m1.textContent, '');

  // Unmounting m2 independently
  engine.unmount(m2);
  assert.deepEqual(cleanups, ['m1', 'm2']);
});

// ── 6. NO ENGINE.USE() ───────────────────────────────────────────────────────

test('engine: engine.use is not exposed and dynamic registration is disallowed', () => {
  const engine = createEngine({ modules: [] });
  assert.equal(engine.use, undefined);
  assert.ok(Object.isFrozen(engine));
});

// ── 7. RENDER RETURNS STATE & CLEANUP ────────────────────────────────────────

test('engine: render returns runtime state and cleanup without mounting', () => {
  let cleaned = false;

  const mod = defineModule({
    name: 'render-mod',
    triggers: [attr('x-render', (el, data, ctx) => {
      el.textContent = 'rendered';
      ctx.onCleanup(() => { cleaned = true; });
    })],
  });

  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="frag-root"><span x-render></span></div>');
  const fragRoot = dom.window.document.getElementById('frag-root');

  const result = engine.render(fragRoot);
  assert.equal(fragRoot.firstElementChild.textContent, 'rendered');
  assert.equal(typeof result.cleanup, 'function');
  assert.equal(cleaned, false);

  result.cleanup();
  assert.equal(cleaned, true);
});

// ── 8. UNMOUNT TEARDOWN & DETACH PRECEDENCE ─────────────────────────────────

test('engine: unmount runs cleanup before detaching DOM content', () => {
  const steps = [];

  const mod = defineModule({
    name: 'inspect-mod',
    triggers: [attr('x-inspect', (el, data, ctx) => {
      ctx.onCleanup(() => {
        // Must still be connected when cleanup runs
        steps.push(`cleanup:connected=${el.isConnected}`);
      });
    })],
  });

  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="mount-target"></div>');
  const target = dom.window.document.getElementById('mount-target');

  engine.mount(target, '<p x-inspect>Hello</p>');
  assert.equal(target.textContent, 'Hello');

  engine.unmount(target);
  assert.equal(target.textContent, '');
  assert.deepEqual(steps, ['cleanup:connected=true']);
});

// ── 9. BEFOREMOUNT & AFTERMOUNT HOOKS ────────────────────────────────────────

test('engine: executes beforeMount and afterMount module hooks with cleanups', () => {
  const hookLog = [];

  const lifecycleMod = defineModule({
    name: 'hook-mod',
    triggers: [attr('x-item', () => {})],
    beforeMount(api) {
      hookLog.push(`beforeMount:${api.target.id}`);
      return () => hookLog.push('beforeMount-cleanup');
    },
    afterMount(api) {
      hookLog.push(`afterMount:${api.target.id}`);
      return () => hookLog.push('afterMount-cleanup');
    },
  });

  const engine = createEngine({ modules: [lifecycleMod] });
  const dom = createDom('<div id="target-el"><span x-item></span></div>');
  const target = dom.window.document.getElementById('target-el');

  const unmount = engine.mount(target);
  assert.deepEqual(hookLog, ['beforeMount:target-el', 'afterMount:target-el']);

  unmount();
  // LIFO cleanup: afterMount-cleanup runs before beforeMount-cleanup
  assert.deepEqual(hookLog, [
    'beforeMount:target-el',
    'afterMount:target-el',
    'afterMount-cleanup',
    'beforeMount-cleanup',
  ]);
});

// ── 10. REPLACING EXISTING MOUNT ON SAME TARGET ──────────────────────────────

test('engine: mounting on an already mounted target unmounts previous instance cleanly', () => {
  let cleanedOld = false;

  const mod = defineModule({
    name: 'replace-mod',
    triggers: [attr('x-v', (el, data, ctx) => {
      ctx.onCleanup(() => { cleanedOld = true; });
    })],
  });

  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="target" x-v>Initial</div>');
  const target = dom.window.document.getElementById('target');

  engine.mount(target);
  assert.equal(cleanedOld, false);

  // Mount again on same target
  engine.mount(target);
  assert.equal(cleanedOld, true);
});

test('engine: a failed replacement mount preserves the active mount and its resources', () => {
  let cleaned = false;
  const mod = defineModule({
    name: 'preserve-on-failure',
    triggers: [attr('x-preserve', (el, data, ctx) => {
      ctx.onCleanup(() => { cleaned = true; });
    })],
  });
  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="target"><span x-preserve>Existing</span></div>');
  const target = dom.window.document.getElementById('target');

  const current = engine.mount(target);
  const failed = engine.mount(target, 'missing-template');

  assert.equal(failed.active, false);
  assert.equal(current.active, true);
  assert.equal(cleaned, false);
  assert.equal(target.textContent, 'Existing');

  current.unmount();
  assert.equal(cleaned, true);
});

test('engine: invalid store-shaped values fall back to a mount-local store', () => {
  let receivedStore;
  const mod = defineModule({
    name: 'store-contract',
    triggers: [attr('x-store', (el, data, ctx) => {
      receivedStore = ctx.store;
      el.textContent = ctx.store.get('value') ?? 'local';
    })],
  });
  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="target" x-store></div>');
  const target = dom.window.document.getElementById('target');

  const instance = engine.mount(target, null, { subscribe() {} });

  assert.equal(target.textContent, 'local');
  assert.equal(typeof receivedStore.get, 'function');
  assert.equal(typeof receivedStore.subscribe, 'function');
  instance.unmount();
});

// ── 11. ABORT SIGNAL INTEGRATION ─────────────────────────────────────────────

test('engine: abort signal automatically triggers unmount', () => {
  let cleaned = false;

  const mod = defineModule({
    name: 'signal-mod',
    triggers: [attr('x-sig', (el, data, ctx) => {
      ctx.onCleanup(() => { cleaned = true; });
    })],
  });

  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="target"></div>');
  const target = dom.window.document.getElementById('target');

  const controller = new AbortController();
  engine.mount(target, '<span x-sig>Content</span>', null, { signal: controller.signal });

  assert.equal(cleaned, false);
  controller.abort();
  assert.equal(cleaned, true);
  assert.equal(target.textContent, '');
});
