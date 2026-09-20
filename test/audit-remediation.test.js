import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  createEngine, createStore, loops, conditionals, text, model, show, ref,
  subscribeDiagnostics,
} from '../src/index.js';

function mount(html, state, options = {}) {
  const dom = new JSDOM(`<div id="app">${html}</div>`);
  const app = dom.window.document.getElementById('app');
  const store = createStore(state);
  const engine = createEngine({ modules: [loops(), conditionals(), model(), text(), show(), ref()] });
  const instance = engine.mount({ target: app, store, document: dom.window.document, ...options });
  return { dom, app, store, instance };
}

for (const diff of ['simple', 'lcs']) {
  test(`keyed ${diff}: reorder and deletion preserve identity and retarget every binding`, () => {
    const { dom, app, store, instance } = mount(`
      <for each="items" as="item" key="id" data-live data-diff="${diff}">
        <input data-model="item.name" data-ref="fields[]">
        <b data-text="item.name" title="{name}" data-name="item.name" data-show="item.visible"></b>
      </for>`, { items: [{ id: 1, name: 'A', visible: true }, { id: 2, name: 'B', visible: true }] });
    const [a, b] = store.get('items');
    const [inputA, inputB] = app.querySelectorAll('input');
    const [textA, textB] = app.querySelectorAll('b');
    inputB.focus();
    inputB.setSelectionRange(1, 1);
    store.set('items', [b, a]);
    assert.deepEqual([...app.querySelectorAll('input')], [inputB, inputA]);
    assert.deepEqual(instance.refs.fields, [inputB, inputA]);
    assert.equal(inputB.value, 'B');
    assert.equal(inputB.selectionStart, 1);
    inputB.value = 'EDIT-B';
    inputB.dispatchEvent(new dom.window.Event('input'));
    assert.equal(store.get('items.0.name'), 'EDIT-B');
    assert.equal(store.get('items.1.name'), 'A');
    assert.equal(textB.textContent, 'EDIT-B');
    assert.equal(textB.title, 'EDIT-B');
    store.set('items.0.visible', false);
    assert.equal(textB.hidden, true);
    assert.equal(textA.hidden, false);
    store.set('items', [a]);
    assert.equal(app.querySelector('input'), inputA);
    inputA.value = 'EDIT-A';
    inputA.dispatchEvent(new dom.window.Event('input'));
    assert.equal(store.get('items.0.name'), 'EDIT-A');
    assert.equal(store.get('items.1'), undefined);
    instance.cleanup();
    inputA.value = 'ghost';
    inputA.dispatchEvent(new dom.window.Event('input'));
    store.set('items.0.name', 'AFTER-CLEANUP');
    assert.equal(textA.textContent, 'EDIT-A');
    dom.window.close();
  });
}

test('nested aliases follow both outer and inner keyed reorderings', () => {
  const { dom, app, store, instance } = mount(`
    <for each="groups" as="group" key="id" data-live>
      <section>
        <for each="group.items" as="item" key="id" data-live data-diff="lcs">
          <input data-model="item.name">
          <if is-truthy="item.visible" data-live><b data-text="item.name"></b></if>
        </for>
      </section>
    </for>`, { groups: [
    { id: 1, items: [{ id: 11, name: 'A', visible: true }, { id: 12, name: 'B', visible: true }] },
    { id: 2, items: [{ id: 21, name: 'C', visible: true }] },
  ] });
  const [a, b, c] = app.querySelectorAll('input');
  const [groupA, groupB] = store.get('groups');
  store.set('groups', [groupB, groupA]);
  store.set('groups.1.items', [...groupA.items].reverse());
  assert.deepEqual([...app.querySelectorAll('input')], [c, b, a]);
  a.value = 'EDIT-A';
  a.dispatchEvent(new dom.window.Event('input'));
  assert.equal(store.get('groups.1.items.1.name'), 'EDIT-A');
  assert.equal(store.get('groups.0.items.0.name'), 'C');
  store.set('groups.1.items.1.visible', false);
  assert.deepEqual([...app.querySelectorAll('b')].map(el => el.textContent), ['C', 'B']);
  instance.unmount();
  dom.window.close();
});

for (const withRef of [false, true]) {
  test(`group controls use item cleanup while detached; ref=${withRef}`, () => {
    const { dom, app, store, instance } = mount(`
      <form data-model-group="user">
        <for each="items" as="item" key="id" data-live>
          <input name="name" ${withRef ? 'data-ref="field"' : ''}>
        </for>
      </form>`, { items: [{ id: 1 }], user: { name: 'Alice' } });
    const old = app.querySelector('input');
    assert.equal(old.value, 'Alice');
    store.set('items', []);
    old.value = 'ghost';
    old.dispatchEvent(new dom.window.Event('input'));
    assert.equal(store.get('user.name'), 'Alice');
    assert.equal(instance.refs.field, undefined);
    store.set('user.name', 'Bob');
    store.set('items', [{ id: 2 }]);
    const next = app.querySelector('input');
    assert.equal(next.value, 'Bob');
    next.value = 'Carol';
    next.dispatchEvent(new dom.window.Event('input'));
    assert.equal(store.get('user.name'), 'Carol');
    instance.unmount();
    dom.window.close();
  });
}

test('nested dynamic groups use nearest logical parent without binding named buttons', () => {
  const { app, store, instance, dom } = mount(`
    <form data-model-group="outer">
      <button name="submit" value="send">Send</button>
      <for each="items" as="item" key="id" data-live>
        <fieldset data-model-group="item">
          <if is-truthy="visible" data-live><input name="name" data-ref="field"></if>
        </fieldset>
      </for>
    </form>`, { items: [], outer: { name: 'Wrong' }, visible: true });
  store.set('items', [{ id: 1, name: 'Right' }]);
  assert.equal(app.querySelector('input').value, 'Right');
  assert.equal(store.get('outer.submit'), undefined);
  store.set('visible', false);
  store.set('items.0.name', 'Updated');
  store.set('visible', true);
  assert.equal(app.querySelector('input').value, 'Updated');
  instance.unmount();
  dom.window.close();
});

for (const live of [false, true]) {
  test(`local list never aliases an unrelated store list; live=${live}`, () => {
    const errors = [];
    const context = { items: [{ id: 1, name: 'LOCAL', visible: true }] };
    const { dom, app, store, instance } = mount(`
      <for each="items" as="item" ${live ? 'key="id" data-live' : ''}>
        <input data-model="item.name">
        <b data-text="item.name" title="{name}" data-name="item.name" data-show="item.visible"></b>
      </for>`, { items: [{ id: 1, name: 'STORE', visible: false }] },
    { context, onError: d => errors.push(d.code) });
    const input = app.querySelector('input');
    const b = app.querySelector('b');
    assert.equal(input.value, 'LOCAL');
    assert.equal(b.textContent, 'LOCAL');
    assert.equal(b.title, 'LOCAL');
    assert.equal(b.hidden, false);
    assert.ok(errors.includes('MODEL_LOCAL_PATH'));
    input.value = 'EDIT-LOCAL';
    input.dispatchEvent(new dom.window.Event('input'));
    assert.equal(store.get('items.0.name'), 'STORE');
    assert.equal(context.items[0].name, 'LOCAL');
    store.set('items.0.name', 'UPDATED-STORE');
    store.set('items.0.visible', false);
    assert.equal(b.textContent, 'LOCAL');
    assert.equal(b.hidden, false);
    instance.unmount();
    dom.window.close();
  });
}

test('static nested alias attributes read replacements from canonical store paths', () => {
  const { app, store, instance, dom } = mount(`
    <for each="groups" as="group">
      <for each="group.items" as="item">
        <b data-text="item.name" title="{x}" data-x="item.name"></b>
      </for>
    </for>`, { groups: [{ items: [{ name: 'A' }] }] });
  const b = app.querySelector('b');
  store.set('groups.0', { items: [{ name: 'B' }] });
  assert.equal(b.textContent, 'B');
  assert.equal(b.title, 'B');
  instance.unmount();
  dom.window.close();
});

test('nested fragment diagnostics retain their owning mount before and after placement', () => {
  const dom = new JSDOM('<div id="a"></div><div id="b"></div>');
  const engine = createEngine({ modules: [loops(), text()] });
  const global = [];
  const localA = [];
  const localB = [];
  const unsubscribe = subscribeDiagnostics(d => global.push(d));
  try {
    const a = engine.mount({
      target: dom.window.document.getElementById('a'),
      template: '<for each="items" as="item" key="id" data-live><b data-text=""></b></for>',
      store: createStore({ items: [{ id: 1 }] }),
      onError: d => localA.push(d),
    });
    const storeB = createStore({ items: [] });
    const b = engine.mount({
      target: dom.window.document.getElementById('b'),
      template: '<for each="items" as="item" key="id" data-live><b data-text=""></b></for>',
      store: storeB,
      onError: d => localB.push(d),
    });
    storeB.set('items', [{ id: 2 }]);
    const diagnostics = global.filter(d => d.code === 'BINDING_MISSING_PATH');
    assert.equal(diagnostics.length, 2);
    assert.deepEqual(localA, [diagnostics[0]]);
    assert.deepEqual(localB, [diagnostics[1]]);
    assert.equal(localA[0].context.tagName, 'B');
    a.unmount();
    b.unmount();
  } finally {
    unsubscribe();
    dom.window.close();
  }
});

test('repeated alias moves replace subscriptions and cleanup releases all of them', () => {
  const dom = new JSDOM(`<div id="app">
    <for each="items" as="item" key="id" data-live>
      <input data-model="item.name"><b data-text="item.name"></b>
    </for>
  </div>`);
  const store = createStore({ items: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] });
  const subscribe = store.subscribe.bind(store);
  let active = 0;
  store.subscribe = (path, callback) => {
    active++;
    const unsubscribe = subscribe(path, callback);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      active--;
      unsubscribe();
    };
  };
  const instance = createEngine({ modules: [loops(), text(), model()] }).mount({
    target: dom.window.document.getElementById('app'), store,
  });
  assert.equal(active, 5);
  for (let i = 0; i < 10; i++) {
    store.set('items', [...store.get('items')].reverse());
    assert.equal(active, 5);
  }
  instance.cleanup();
  assert.equal(active, 0);
  dom.window.close();
});

test('separate bundles retain dynamic group ownership and retarget aliases', async () => {
  const core = await import('../dist/core.min.js');
  const { default: bundledLoops } = await import('../dist/modules/loops.min.js');
  const { default: bundledModel } = await import('../dist/modules/model.min.js');
  const { default: bundledText } = await import('../dist/modules/text.min.js');
  const { default: bundledRef } = await import('../dist/modules/ref.min.js');
  const dom = new JSDOM(`<div id="app"><form data-model-group="item">
    <for each="items" as="item" key="id" data-live>
      <input name="name" data-ref="fields[]"><b data-text="item.name"></b>
    </for>
  </form></div>`);
  const app = dom.window.document.getElementById('app');
  const store = createStore({ items: [] });
  const instance = core.createEngine({
    modules: [bundledLoops(), bundledModel(), bundledText(), bundledRef()],
  }).mount({ target: app, store });
  store.set('items', [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
  const [a, b] = app.querySelectorAll('input');
  assert.equal(a.value, 'A');
  store.set('items', [...store.get('items')].reverse());
  assert.deepEqual(instance.refs.fields, [b, a]);
  b.value = 'EDIT-B';
  b.dispatchEvent(new dom.window.Event('input'));
  assert.equal(store.get('items.0.name'), 'EDIT-B');
  assert.equal(store.get('items.1.name'), 'A');
  store.set('items', []);
  a.value = 'ghost';
  a.dispatchEvent(new dom.window.Event('input'));
  assert.deepEqual(store.get('items'), []);
  instance.unmount();
  dom.window.close();
});
