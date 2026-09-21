import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  createEngine,
  createStore,
  defineModule,
  attr,
  text,
  subscribeDiagnostics,
  warn,
} from '../src/index.js';

function createDom(html) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'http://localhost/' });
}

test('Finding G: diagnostics attribution handles pre-ownership, cleanups, nested mounts, and globals', () => {
  const dom = createDom(`
    <div id="outer-app">
      <div id="inner-app"></div>
    </div>
  `);

  const outerEl = dom.window.document.getElementById('outer-app');
  const innerEl = dom.window.document.getElementById('inner-app');

  const outerDiagnostics = [];
  const innerDiagnostics = [];
  const globalDiagnostics = [];

  const unsubGlobal = subscribeDiagnostics((d) => globalDiagnostics.push(d));

  // Module that throws in cleanup to verify cleanup attribution
  const faultyCleanupModule = defineModule({
    name: 'faulty-cleaner',
    triggers: [
      attr('x-throw-cleanup', {
        phase: 'link',
        setup(el, data, ctx) {
          ctx.onCleanup(() => {
            throw new Error('Boom from cleanup!');
          });
        },
      }),
    ],
  });

  const engine = createEngine({ modules: [text(), faultyCleanupModule] });

  // 1. Mount outer
  const outerMount = engine.mount({
    target: outerEl,
    document: dom.window.document,
    onDiagnostic(d) {
      outerDiagnostics.push(d);
    },
  });

  // 2. Mount inner inside outer
  innerEl.setAttribute('x-throw-cleanup', '');
  const innerMount = engine.mount({
    target: innerEl,
    document: dom.window.document,
    onDiagnostic(d) {
      innerDiagnostics.push(d);
    },
  });

  // Unmount inner — cleanup error should reach inner mount ONLY, not outer
  innerMount.unmount();
  assert.ok(innerDiagnostics.some((d) => d.code === 'MODULE_CLEANUP_FAILED'), 'Inner mount receives MODULE_CLEANUP_FAILED');
  assert.ok(!outerDiagnostics.some((d) => d.code === 'MODULE_CLEANUP_FAILED'), 'Outer mount does NOT receive inner cleanup error');

  // 3. Outer mount context restored after inner execution
  // Trigger unsafe attribute on outer
  const store = createStore({ payload: 'alert(1)' });
  const nodeWithUnsafeAttr = dom.window.document.createElement('div');
  nodeWithUnsafeAttr.setAttribute('onclick', '{payload}');
  outerEl.appendChild(nodeWithUnsafeAttr);

  engine.render(nodeWithUnsafeAttr, { target: outerEl, store, document: dom.window.document });
  assert.ok(outerDiagnostics.some((d) => d.code === 'UNSAFE_EVENT_ATTR'), 'Outer mount receives UNSAFE_EVENT_ATTR');

  // 4. Global diagnostic outside any mount remains global and does not reach mounts
  outerDiagnostics.length = 0;
  innerDiagnostics.length = 0;
  warn('CUSTOM_GLOBAL_WARN', 'Stand-alone warning outside mounts', null);
  assert.ok(globalDiagnostics.some((d) => d.code === 'CUSTOM_GLOBAL_WARN'));
  assert.equal(outerDiagnostics.length, 0);
  assert.equal(innerDiagnostics.length, 0);

  outerMount.unmount();
  unsubGlobal();
});
