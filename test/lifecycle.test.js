import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  attr,
  tag,
  defineModule,
  createEngine,
  createScope,
} from '../src/core/index.js';
import { createRouter } from '../src/core/router.js';
import { runTransform, runLink } from '../src/core/lifecycle.js';
import { createStore } from '../src/store.js';
import { setDevMode, subscribeDiagnostics } from '../src/errors.js';

function createDom(html = '') {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
}

test.beforeEach(() => {
  setDevMode(false);
});

// ── 1. MATCH -> READ -> SETUP SEQUENCE ──────────────────────────────────────

test('lifecycle: match -> read -> setup executes in deterministic sequence', () => {
  const sequence = [];

  const mod = defineModule({
    name: 'order-mod',
    triggers: [attr('x-seq', {
      phase: 'link',
      match(el) {
        sequence.push(`match:${el.id}`);
        return true;
      },
      read(el) {
        sequence.push(`read:${el.id}`);
        return el.getAttribute('x-seq');
      },
      setup(el, data) {
        sequence.push(`setup:${el.id}:${data}`);
      },
    })],
  });

  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="el1" x-seq="alpha"></div>');
  const target = dom.window.document.getElementById('el1');

  engine.mount({ target: target });

  assert.deepEqual(sequence, [
    'match:el1',
    'read:el1',
    'setup:el1:alpha',
  ]);
});

// ── 2. SETUP CLEANUP REGISTRATION ───────────────────────────────────────────

test('lifecycle: setup registers cleanups via ctx.onCleanup and returned function', () => {
  const cleanups = [];

  const mod = defineModule({
    name: 'cleanup-mod',
    triggers: [attr('x-clean', (el, data, ctx) => {
      ctx.onCleanup(() => cleanups.push('onCleanup'));
      return () => cleanups.push('returnedCleanup');
    })],
  });

  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="c-target" x-clean></div>');
  const target = dom.window.document.getElementById('c-target');

  const unmount = engine.mount({ target: target });
  assert.deepEqual(cleanups, []);

  unmount();
  assert.deepEqual(cleanups, ['returnedCleanup', 'onCleanup']);
});

// ── 3. STRICT LIFO CLEANUP ──────────────────────────────────────────────────

test('lifecycle: cleanups execute in strict LIFO (reverse registration) order', () => {
  const order = [];

  const mod = defineModule({
    name: 'lifo-mod',
    triggers: [attr('x-lifo', (el, data, ctx) => {
      ctx.onCleanup(() => order.push('step-1'));
      ctx.onCleanup(() => order.push('step-2'));
      return () => order.push('step-3');
    })],
  });

  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="lifo-el" x-lifo></div>');
  const target = dom.window.document.getElementById('lifo-el');

  const unmount = engine.mount({ target: target });
  unmount();

  assert.deepEqual(order, ['step-3', 'step-2', 'step-1']);
});

// ── 4. CLEANUP IDEMPOTENCE ──────────────────────────────────────────────────

test('lifecycle: cleanup execution is idempotent', () => {
  let count = 0;

  const mod = defineModule({
    name: 'idem-mod',
    triggers: [attr('x-idem', (el, data, ctx) => {
      ctx.onCleanup(() => { count++; });
    })],
  });

  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="idem-el" x-idem></div>');
  const target = dom.window.document.getElementById('idem-el');

  const unmount = engine.mount({ target: target });
  assert.equal(count, 0);

  unmount();
  assert.equal(count, 1);

  // Subsequent calls should do nothing
  unmount();
  unmount();
  assert.equal(count, 1);
});

// ── 5. UPDATE VIA EXPLICIT WATCH & READ NEVER RE-RUNS ────────────────────────

test('lifecycle: update via explicit watch runs without re-running read()', () => {
  let readCount = 0;
  const updates = [];

  const mod = defineModule({
    name: 'reactive-mod',
    triggers: [attr('x-live', {
      phase: 'link',
      read(el) {
        readCount++;
        return el.getAttribute('x-live');
      },
      setup(el, path, ctx) {
        el.textContent = ctx.store?.get(path) ?? 'initial';
        ctx.watch(path, (newVal) => {
          updates.push(newVal);
          el.textContent = newVal;
        });
      },
    })],
  });

  const store = createStore({ greeting: 'Hello' });
  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="target" x-live="greeting"></div>');
  const target = dom.window.document.getElementById('target');

  engine.mount({ target: target, ...{ store } });

  assert.equal(readCount, 1);
  assert.equal(target.textContent, 'Hello');
  assert.deepEqual(updates, []);

  // Update store reactively
  store.set('greeting', 'World');
  assert.equal(target.textContent, 'World');
  assert.deepEqual(updates, ['World']);
  assert.equal(readCount, 1); // read() was NOT re-run!

  store.set('greeting', 'Goodbye');
  assert.equal(target.textContent, 'Goodbye');
  assert.deepEqual(updates, ['World', 'Goodbye']);
  assert.equal(readCount, 1); // read() was STILL not re-run!
});

// ── 6. UPDATE FAILURE ISOLATION ─────────────────────────────────────────────

test('lifecycle: update failure is isolated and reported via diagnostics', () => {
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diag) => diagnostics.push(diag));

  const mod = defineModule({
    name: 'faulty-update',
    triggers: [attr('x-throw', (el, data, ctx) => {
      ctx.watch('trigger', () => {
        throw new Error('boom');
      });
    })],
  });

  const store = createStore({ trigger: 0 });
  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="target" x-throw></div>');
  const target = dom.window.document.getElementById('target');

  engine.mount({ target: target, ...{ store } });

  // Cause watch callback to throw
  assert.doesNotThrow(() => {
    store.set('trigger', 1);
  });

  assert.ok(diagnostics.some((d) => d.code === 'MODULE_WATCH_FAILED'));
  unsubscribe();
});

// ── 7. CLEANUP FAILURE ISOLATION ────────────────────────────────────────────

test('lifecycle: cleanup failure does not prevent remaining cleanups from running', () => {
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diag) => diagnostics.push(diag));
  const executed = [];

  const mod = defineModule({
    name: 'faulty-clean',
    triggers: [attr('x-fail-clean', (el, data, ctx) => {
      ctx.onCleanup(() => executed.push('first'));
      ctx.onCleanup(() => {
        executed.push('second');
        throw new Error('cleanup crash');
      });
      ctx.onCleanup(() => executed.push('third'));
    })],
  });

  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="target" x-fail-clean></div>');
  const target = dom.window.document.getElementById('target');

  const unmount = engine.mount({ target: target });
  assert.doesNotThrow(() => {
    unmount();
  });

  // LIFO: third -> second (throws) -> first
  assert.deepEqual(executed, ['third', 'second', 'first']);
  assert.ok(diagnostics.some((d) => d.code === 'MODULE_CLEANUP_FAILED'));
  unsubscribe();
});

// ── 8. SETUP FAILURE ISOLATION ──────────────────────────────────────────────

test('lifecycle: setup failure is isolated and allows other modules to run', () => {
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diag) => diagnostics.push(diag));
  const successful = [];

  const brokenMod = defineModule({
    name: 'broken-mod',
    triggers: [attr('x-broken', () => {
      throw new Error('setup failure');
    })],
  });
  const healthyMod = defineModule({
    name: 'healthy-mod',
    triggers: [attr('x-healthy', () => {
      successful.push('healthy');
    })],
  });

  const engine = createEngine({ modules: [brokenMod, healthyMod] });
  const dom = createDom('<div id="t1" x-broken></div><div id="t2" x-healthy></div>');
  const container = dom.window.document.body;
  engine.render(container);

  assert.deepEqual(successful, ['healthy']);
  assert.ok(diagnostics.some((d) => d.code === 'MODULE_SETUP_FAILED'));
  unsubscribe();
});

// ── 9. CONTEXT HELPERS & INTERNAL ENCAPSULATION ──────────────────────────────

test('context: provides scope, store, onCleanup, watch, error, warn and hides internals', () => {
  let capturedCtx = null;

  const mod = defineModule({
    name: 'ctx-mod',
    triggers: [attr('x-inspect', (el, data, ctx) => {
      capturedCtx = ctx;
    })],
  });

  const store = createStore({ app: 'lime' });
  const scope = createScope(null, { item: 'sample' });
  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="target" x-inspect></div>');
  const target = dom.window.document.getElementById('target');

  engine.mount({ target: target, ...{ store, scope } });

  assert.ok(capturedCtx);
  assert.equal(capturedCtx.store, store);
  assert.equal(capturedCtx.scope.item, 'sample');
  assert.equal(typeof capturedCtx.onCleanup, 'function');
  assert.equal(typeof capturedCtx.watch, 'function');
  assert.equal(typeof capturedCtx.afterConnect, 'function');
  assert.equal(typeof capturedCtx.error, 'function');
  assert.equal(typeof capturedCtx.warn, 'function');

  // Internal structures must NEVER be accessible on ctx
  assert.equal(capturedCtx.router, undefined);
  assert.equal(capturedCtx.registry, undefined);
  assert.equal(capturedCtx.mountedTargets, undefined);
});

// ── 10. LINK SINGLE-PASS TRAVERSAL ──────────────────────────────────────────

test('link: single-pass traversal visits matched elements once without repeats', () => {
  const visited = [];

  const mod = defineModule({
    name: 'walk-mod',
    triggers: [attr('x-node', (el) => {
      visited.push(el.id);
    })],
  });

  const engine = createEngine({ modules: [mod] });
  const dom = createDom(`
    <div id="parent" x-node>
      <span id="c1" x-node></span>
      <span id="c2" x-node></span>
    </div>
  `);
  const parent = dom.window.document.getElementById('parent');

  engine.render(parent);
  assert.deepEqual(visited, ['parent', 'c1', 'c2']);
});

// ── 11. LINK DOES NOT MUTATE DOM STRUCTURE ──────────────────────────────────

test('link: Link phase performs zero structural mutations on the DOM', () => {
  const mod = defineModule({
    name: 'passive-mod',
    triggers: [attr('x-passive', () => {})],
  });

  const engine = createEngine({ modules: [mod] });
  const dom = createDom(`
    <div id="root">
      <p id="p1" x-passive>Text 1</p>
      <p id="p2" x-passive>Text 2</p>
    </div>
  `);
  const root = dom.window.document.getElementById('root');
  const p1 = dom.window.document.getElementById('p1');
  const p2 = dom.window.document.getElementById('p2');

  const childCountBefore = root.children.length;
  engine.render(root);

  assert.equal(root.children.length, childCountBefore);
  assert.equal(root.firstElementChild, p1);
  assert.equal(root.lastElementChild, p2);
});

// ── 12. TRANSFORM CAN REPLACE/EXPAND CONTENT ─────────────────────────────────

test('transform: structural Module can replace or expand DOM content', () => {
  const expandMod = defineModule({
    name: 'expand-mod',
    triggers: [tag('MACRO-CARD', {
      phase: 'transform',
      setup(el) {
        const title = el.getAttribute('title') || 'Default';
        const replacement = el.ownerDocument.createElement('div');
        replacement.className = 'card';
        replacement.innerHTML = `<h3>${title}</h3>`;
        el.replaceWith(replacement);
      },
    })],
  });

  const engine = createEngine({ modules: [expandMod] });
  const dom = createDom('<div id="root"><macro-card title="Hero"></macro-card></div>');
  const root = dom.window.document.getElementById('root');

  engine.render(root);

  assert.equal(root.querySelector('macro-card'), null);
  const card = root.querySelector('.card');
  assert.ok(card);
  assert.equal(card.querySelector('h3').textContent, 'Hero');
});

// ── 13. TRANSFORM FIXED-POINT MULTI-PASS EXPANSION ──────────────────────────

test('transform: multi-pass fixed-point expansion compiles nested generated macros', () => {
  const macroAMod = defineModule({
    name: 'macro-a',
    triggers: [tag('MACRO-A', {
      phase: 'transform',
      setup(el) {
        const b = el.ownerDocument.createElement('macro-b');
        el.replaceWith(b);
      },
    })],
  });

  const macroBMod = defineModule({
    name: 'macro-b',
    triggers: [tag('MACRO-B', {
      phase: 'transform',
      setup(el) {
        const p = el.ownerDocument.createElement('p');
        p.className = 'finished';
        p.textContent = 'All expanded';
        el.replaceWith(p);
      },
    })],
  });

  const engine = createEngine({ modules: [macroAMod, macroBMod] });
  const dom = createDom('<div id="root"><macro-a></macro-a></div>');
  const root = dom.window.document.getElementById('root');

  engine.render(root);

  assert.equal(root.querySelector('macro-a'), null);
  assert.equal(root.querySelector('macro-b'), null);
  const finalEl = root.querySelector('.finished');
  assert.ok(finalEl);
  assert.equal(finalEl.textContent, 'All expanded');
});

test('transform: exact routes skip the final full-tree scan once the tree is stable', () => {
  const macroAMod = defineModule({
    name: 'scan-macro-a',
    triggers: [tag('SCAN-MACRO-A', {
      setup(el) {
        el.replaceWith(el.ownerDocument.createElement('scan-macro-b'));
      },
    })],
  });
  const macroBMod = defineModule({
    name: 'scan-macro-b',
    triggers: [tag('SCAN-MACRO-B', {
      setup(el) {
        el.replaceWith(el.ownerDocument.createElement('p'));
      },
    })],
  });
  const router = createRouter([macroAMod, macroBMod]);
  const dom = createDom('<div id="root"><scan-macro-a></scan-macro-a></div>');
  const root = dom.window.document.getElementById('root');
  const querySelectorAll = root.querySelectorAll.bind(root);
  let fullTreeScans = 0;
  root.querySelectorAll = (selector) => {
    if (selector === '*') fullTreeScans++;
    return querySelectorAll(selector);
  };

  runTransform(root, router);

  assert.equal(root.querySelector('p')?.tagName, 'P');
  assert.equal(fullTreeScans, 2);
});

// ── 14. TRANSFORM TERMINATION GUARD ─────────────────────────────────────────

test('transform: infinite macro expansion triggers PIPELINE_DEPTH_LIMIT guard', () => {
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diag) => diagnostics.push(diag));

  const infiniteMod = defineModule({
    name: 'infinite-loop',
    triggers: [tag('LOOP-MACRO', {
      phase: 'transform',
      setup(el) {
        const next = el.ownerDocument.createElement('loop-macro');
        el.replaceWith(next);
      },
    })],
  });

  const engine = createEngine({ modules: [infiniteMod] });
  const dom = createDom('<div id="root"><loop-macro></loop-macro></div>');
  const root = dom.window.document.getElementById('root');

  assert.doesNotThrow(() => {
    engine.render(root);
  });

  assert.ok(diagnostics.some((d) => d.code === 'PIPELINE_DEPTH_LIMIT'));
  unsubscribe();
});

// ── 15. TRANSFORM RUNS BEFORE LINK ──────────────────────────────────────────

test('mount: Transform phase completes entirely before Link phase starts', () => {
  const phaseLog = [];

  const transformMod = defineModule({
    name: 'phase-transform',
    triggers: [tag('BOX-TRANSFORM', {
      phase: 'transform',
      setup(el) {
        phaseLog.push('transform');
        const span = el.ownerDocument.createElement('span');
        span.setAttribute('x-link-target', 'true');
        el.replaceWith(span);
      },
    })],
  });

  const linkMod = defineModule({
    name: 'phase-link',
    triggers: [attr('x-link-target', {
      phase: 'link',
      setup() {
        phaseLog.push('link');
      },
    })],
  });

  const engine = createEngine({ modules: [transformMod, linkMod] });
  const dom = createDom('<div id="root"><box-transform></box-transform></div>');
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root });

  assert.deepEqual(phaseLog, ['transform', 'link']);
});

// ── 16. AFTERCONNECT RUNS WHEN CONNECTED ────────────────────────────────────

test('mount: afterConnect executes after element is connected and avoids unmounted runs', async () => {
  let connectedRun = false;

  const mod = defineModule({
    name: 'conn-mod',
    triggers: [attr('x-connect', (el, data, ctx) => {
      ctx.afterConnect(() => {
        connectedRun = true;
      });
    })],
  });

  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="target" x-connect></div>');
  const target = dom.window.document.getElementById('target');

  engine.mount({ target: target });

  // Allow microtask to execute
  await Promise.resolve();

  assert.equal(connectedRun, true);
});

// ── 17. ASYNC ACTIVITY GUARD ────────────────────────────────────────────────

test('async: unmount deactivates pending afterConnect microtask', async () => {
  let ranAfterUnmount = false;

  const mod = defineModule({
    name: 'async-guard',
    triggers: [attr('x-guard', (el, data, ctx) => {
      ctx.afterConnect(() => {
        ranAfterUnmount = true;
      });
    })],
  });

  const engine = createEngine({ modules: [mod] });
  const dom = createDom('<div id="target" x-guard></div>');
  const target = dom.window.document.getElementById('target');

  const unmount = engine.mount({ target: target });
  // Unmount synchronously before microtasks flush
  unmount();

  await Promise.resolve();

  assert.equal(ranAfterUnmount, false);
});

// ── 18. STANDALONE RUNNERS ──────────────────────────────────────────────────

test('lifecycle: runTransform and runLink standalone execution', () => {
  const mod = defineModule({
    name: 'direct-mod',
    triggers: [
      tag('DIRECT-TPL', {
        phase: 'transform',
        setup(el) {
          const span = el.ownerDocument.createElement('span');
          span.setAttribute('data-direct', 'hello');
          el.replaceWith(span);
        },
      }),
      attr('data-direct', {
        phase: 'link',
        setup(el) {
          el.textContent = 'linked';
        },
      }),
    ],
  });

  const router = createRouter([mod]);
  const dom = createDom('<direct-tpl></direct-tpl>');
  const body = dom.window.document.body;

  runTransform(body, router);
  assert.equal(body.querySelector('direct-tpl'), null);
  assert.ok(body.querySelector('span[data-direct]'));

  runLink(body, router);
  assert.equal(body.querySelector('span').textContent, 'linked');
});
