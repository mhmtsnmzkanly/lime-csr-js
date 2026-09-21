import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { createEngine, createStore, setDevMode } from '../src/index.js';
import { text, show, model, events, conditionals, loops } from '../src/modules/index.js';

function createDom(html = '') {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.Element = dom.window.Element;
  return dom;
}

test.beforeEach(() => {
  setDevMode(false);
});

// ── FINDING A REGRESSION SUITE ───────────────────────────────────────────────

test('slots-clone: 1. direct slot caller scope works', () => {
  const dom = createDom(`
    <template id="tpl-card">
      <div class="card">
        <slot></slot>
      </div>
    </template>
    <div id="root">
      <for each="outer" as="o">
        <partial name="card">
          <b class="item-label" data-text="o.label"></b>
        </partial>
      </for>
    </div>
  `);

  const store = createStore({
    outer: [{ label: 'DIRECT-1' }, { label: 'DIRECT-2' }],
  });

  const engine = createEngine({ modules: [loops(), text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({ target: root, store, document: dom.window.document });

  const labels = Array.from(root.querySelectorAll('.item-label')).map((el) => el.textContent);
  assert.deepEqual(labels, ['DIRECT-1', 'DIRECT-2']);
});

test('slots-clone: 2. slot inside static <if> retains caller scope', () => {
  const dom = createDom(`
    <template id="tpl-card">
      <div class="card">
        <if is-truthy="open">
          <section class="body">
            <slot></slot>
          </section>
        </if>
      </div>
    </template>
    <div id="root">
      <for each="outer" as="o">
        <partial name="card">
          <b class="item-label" data-text="o.label"></b>
        </partial>
      </for>
    </div>
  `);

  const store = createStore({
    open: true,
    outer: [{ label: 'STATIC-IF-A' }, { label: 'STATIC-IF-B' }],
  });

  const engine = createEngine({ modules: [loops(), conditionals(), text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({ target: root, store, document: dom.window.document });

  const labels = Array.from(root.querySelectorAll('.item-label')).map((el) => el.textContent);
  assert.deepEqual(labels, ['STATIC-IF-A', 'STATIC-IF-B']);
});

test('slots-clone: 3. slot inside live <if> retains caller scope across branch toggles', () => {
  const dom = createDom(`
    <template id="tpl-accordion">
      <div class="accordion">
        <if is-truthy="expanded" data-live>
          <div class="content">
            <slot></slot>
          </div>
          <else>
            <div class="collapsed">Collapsed</div>
          </else>
        </if>
      </div>
    </template>
    <div id="root">
      <for each="outer" as="o">
        <partial name="accordion">
          <span class="acc-text" data-text="o.title"></span>
        </partial>
      </for>
    </div>
  `);

  const store = createStore({
    expanded: false,
    outer: [{ title: 'CARD-ONE' }, { title: 'CARD-TWO' }],
  });

  const engine = createEngine({ modules: [loops(), conditionals(), text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({ target: root, store, document: dom.window.document });

  assert.equal(root.querySelectorAll('.acc-text').length, 0);
  assert.equal(root.querySelectorAll('.collapsed').length, 2);

  // Toggle live-if to true -> renders winning branch with cloned slot
  store.set('expanded', true);

  const texts = Array.from(root.querySelectorAll('.acc-text')).map((el) => el.textContent);
  assert.deepEqual(texts, ['CARD-ONE', 'CARD-TWO']);

  // Toggle back and forth
  store.set('expanded', false);
  assert.equal(root.querySelectorAll('.acc-text').length, 0);

  store.set('expanded', true);
  const textsAfter = Array.from(root.querySelectorAll('.acc-text')).map((el) => el.textContent);
  assert.deepEqual(textsAfter, ['CARD-ONE', 'CARD-TWO']);
});

test('slots-clone: 4. slot inside static <for> retains caller scope', () => {
  const dom = createDom(`
    <template id="tpl-repeater">
      <div class="repeater">
        <for each="items" as="it">
          <div class="row">
            <slot></slot>
          </div>
        </for>
      </div>
    </template>
    <div id="root">
      <for each="outer" as="o">
        <partial name="repeater">
          <span class="caller-val" data-text="o.name"></span>
        </partial>
      </for>
    </div>
  `);

  const store = createStore({
    items: [1, 2],
    outer: [{ name: 'ALPHA' }, { name: 'BETA' }],
  });

  const engine = createEngine({ modules: [loops(), text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({ target: root, store, document: dom.window.document });

  const vals = Array.from(root.querySelectorAll('.caller-val')).map((el) => el.textContent);
  // Outer has 2 items, repeater has 2 items -> 4 total projected spans
  assert.deepEqual(vals, ['ALPHA', 'ALPHA', 'BETA', 'BETA']);
});

test('slots-clone: 5. slot inside live <for> retains caller scope', () => {
  const dom = createDom(`
    <template id="tpl-live-list">
      <div class="live-list">
        <for each="items" as="it" key="id" data-live>
          <div class="entry">
            <slot></slot>
          </div>
        </for>
      </div>
    </template>
    <div id="root">
      <for each="outer" as="o">
        <partial name="live-list">
          <span class="val" data-text="o.val"></span>
        </partial>
      </for>
    </div>
  `);

  const store = createStore({
    items: [{ id: 1 }, { id: 2 }],
    outer: [{ val: 'V1' }, { val: 'V2' }],
  });

  const engine = createEngine({ modules: [loops(), text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({ target: root, store, document: dom.window.document });

  const vals = Array.from(root.querySelectorAll('.val')).map((el) => el.textContent);
  assert.deepEqual(vals, ['V1', 'V1', 'V2', 'V2']);

  // Reconcile live list: add item
  store.set('items', [{ id: 1 }, { id: 2 }, { id: 3 }]);
  const valsUpdated = Array.from(root.querySelectorAll('.val')).map((el) => el.textContent);
  assert.deepEqual(valsUpdated, ['V1', 'V1', 'V1', 'V2', 'V2', 'V2']);
});

test('slots-clone: 6. nested projected content preserves lexical shadowing', () => {
  const dom = createDom(`
    <template id="tpl-wrapper">
      <div class="wrapper">
        <slot></slot>
      </div>
    </template>
    <div id="root">
      <for each="outer" as="item">
        <div class="outer-box">
          <partial name="wrapper">
            <span class="outer-label" data-text="item.label"></span>
            <for each="item.inner" as="item">
              <span class="inner-label" data-text="item.label"></span>
            </for>
          </partial>
        </div>
      </for>
    </div>
  `);

  const store = createStore({
    outer: [
      { label: 'OUT-A', inner: [{ label: 'IN-A1' }, { label: 'IN-A2' }] },
      { label: 'OUT-B', inner: [{ label: 'IN-B1' }] },
    ],
  });

  const engine = createEngine({ modules: [loops(), text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({ target: root, store, document: dom.window.document });

  const outers = Array.from(root.querySelectorAll('.outer-label')).map((el) => el.textContent);
  const inners = Array.from(root.querySelectorAll('.inner-label')).map((el) => el.textContent);

  assert.deepEqual(outers, ['OUT-A', 'OUT-B']);
  assert.deepEqual(inners, ['IN-A1', 'IN-A2', 'IN-B1']);
});

test('slots-clone: 7. cloned nodes do not inherit stale cleanup ownership', () => {
  let cleanedUpCount = 0;
  const dom = createDom(`
    <template id="tpl-toggle">
      <div class="toggle">
        <if is-truthy="show" data-live>
          <div class="branch">
            <slot></slot>
          </div>
        </if>
      </div>
    </template>
    <div id="root">
      <partial name="toggle">
        <span class="target">Content</span>
      </partial>
    </div>
  `);

  const store = createStore({ show: true });
  const engine = createEngine({
    modules: [
      conditionals(),
      {
        name: 'test-cleanup',
        triggers: [{
          type: 'tag',
          name: 'SPAN',
          phase: 'link',
          setup(el, data, ctx) {
            ctx.onCleanup(() => {
              cleanedUpCount++;
            });
          },
        }],
      },
    ],
  });

  const root = dom.window.document.getElementById('root');
  const mountInstance = engine.mount({ target: root, store, document: dom.window.document });

  assert.equal(cleanedUpCount, 0);

  // Toggle off: branch is cleared and its cleanups run
  store.set('show', false);
  assert.equal(cleanedUpCount, 1);

  // Toggle on: new branch is cloned and linked
  store.set('show', true);
  assert.equal(cleanedUpCount, 1);

  // Unmount entire instance: only the current active branch cleanups run
  mountInstance.unmount();
  assert.equal(cleanedUpCount, 2);
});
