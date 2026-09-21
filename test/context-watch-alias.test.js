import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  createEngine,
  createStore,
  defineModule,
  attr,
  loops,
} from '../src/index.js';

function createDom(html) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'http://localhost/' });
}

test('Finding F: custom module ctx.watch() is scope- and alias-aware inside live loop', () => {
  const dom = createDom(`
    <div id="app">
      <for each="items" as="item" key="id" data-live>
        <span class="custom-span" x-watch-name="item.name"></span>
      </for>
    </div>
  `);

  const watchCalls = [];
  const customModule = defineModule({
    name: 'custom-watcher',
    triggers: [
      attr('x-watch-name', {
        phase: 'link',
        setup(el, data, ctx) {
          const path = el.getAttribute('x-watch-name');
          const unsub = ctx.watch(
            path,
            (val, prev, changedPath) => {
              el.textContent = String(val);
              watchCalls.push({ id: ctx.scope?.item?.id, val, prev, changedPath });
            },
            { immediate: true },
          );
          ctx.onCleanup(unsub);
        },
      }),
    ],
  });

  const store = createStore({
    items: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ],
  });

  const engine = createEngine({ modules: [loops(), customModule] });
  const app = dom.window.document.getElementById('app');
  const instance = engine.mount({ target: app, store, document: dom.window.document });

  // 1. Initial value resolves via immediate: true
  const spans = () => Array.from(app.querySelectorAll('.custom-span')).map((s) => s.textContent);
  assert.deepEqual(spans(), ['Alice', 'Bob']);
  assert.equal(watchCalls.length, 2);
  assert.equal(watchCalls[0].val, 'Alice');
  assert.equal(watchCalls[1].val, 'Bob');

  // 2. items.0.name mutation triggers callback on the first item
  store.set('items.0.name', 'Alice Updated');
  assert.deepEqual(spans(), ['Alice Updated', 'Bob']);
  const lastCall = watchCalls[watchCalls.length - 1];
  assert.equal(lastCall.id, 1);
  assert.equal(lastCall.val, 'Alice Updated');

  // 3. Keyed reorder retargets subscription correctly
  const [first, second] = store.get('items');
  store.set('items', [second, first]); // [Bob, Alice Updated]
  assert.deepEqual(spans(), ['Bob', 'Alice Updated']);

  // Mutating items.0 (now Bob) triggers Bob's watcher
  store.set('items.0.name', 'Bob Renamed');
  assert.deepEqual(spans(), ['Bob Renamed', 'Alice Updated']);

  // Mutating items.1 (now Alice) triggers Alice's watcher
  store.set('items.1.name', 'Alice Final');
  assert.deepEqual(spans(), ['Bob Renamed', 'Alice Final']);

  // 4. Immutable item replacement remains correct
  store.set('items', [
    { id: 2, name: 'Bob Replaced' },
    { id: 1, name: 'Alice Replaced' },
  ]);
  assert.deepEqual(spans(), ['Bob Replaced', 'Alice Replaced']);

  // 5. Cleanup unsubscribes correctly
  const callsBeforeCleanup = watchCalls.length;
  instance.unmount();
  store.set('items.0.name', 'After Unmount');
  assert.equal(watchCalls.length, callsBeforeCleanup);
});
