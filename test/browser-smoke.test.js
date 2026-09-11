import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('built ESM bundle imports and performs a browser-style mount, module execution, visibility update, event, and cleanup', async () => {
  const dom = new JSDOM(`<!doctype html><style>.d-flex { display: flex !important; }</style><template id="tpl-smoke"><button data-on-click="increment" data-text="count"></button><section class="d-flex" data-show="visible" style="display:flex"><span data-text="label"></span></section></template><main id="app"></main>`, { url: 'http://localhost/' });
  Object.assign(globalThis, {
    document: dom.window.document,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element,
    Event: dom.window.Event,
  });

  const bundle = await import('../dist/index.min.js');
  const {
    createStore,
    mount,
    unmount,
    subscribeDiagnostics,
    createEngine,
    defineModule,
    definePlugin,
    PLUGIN_API_VERSION,
  } = bundle;

  // Verify modern API presence and legacy plugin removal
  assert.equal(typeof subscribeDiagnostics, 'function');
  assert.equal(typeof createEngine, 'function');
  assert.equal(typeof defineModule, 'function');
  assert.equal(typeof mount, 'function');
  assert.equal(typeof unmount, 'function');
  assert.equal(definePlugin, undefined, 'definePlugin must be removed from public exports');
  assert.equal(PLUGIN_API_VERSION, undefined, 'PLUGIN_API_VERSION must be removed from public exports');

  const store = createStore({ count: 0, visible: false, label: 'Hello Browser' });
  let calls = 0;

  const target = document.getElementById('app');
  const instance = mount(target, 'smoke', store, {
    handlers: { increment: () => { calls += 1; store.update('count', (n) => n + 1); } },
  });

  target.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(target.querySelector('button').textContent, '1');
  assert.equal(calls, 1);

  const shown = target.querySelector('[data-show]');
  assert.equal(shown.hidden, true);
  assert.equal(shown.style.display, 'flex');
  assert.equal(target.querySelector('span').textContent, 'Hello Browser');

  assert.equal(document.querySelectorAll('#lime-csr-data-show-style').length, 1);
  assert.equal(
    document.getElementById('lime-csr-data-show-style').textContent.trim(),
    '[data-show][hidden] { display: none !important; }',
  );

  store.set('visible', true);
  assert.equal(shown.hidden, false);
  assert.equal(shown.style.display, 'flex');

  instance.cleanup();
  store.set('count', 2);
  assert.equal(target.querySelector('button').textContent, '1');

  unmount(target);
  assert.equal(target.textContent, '');
});

test('modular CDN: dist/core.min.js + dist/store.min.js + discrete dist/modules/*.min.js assemble a lean custom engine', async () => {
  const dom = new JSDOM(`<!doctype html><template id="tpl-lean"><div id="counter"><button data-on-click="inc" data-text="count"></button><p data-show="visible"><span data-text="msg"></span></p></div></template><div id="app"></div>`, { url: 'http://localhost/' });
  Object.assign(globalThis, {
    document: dom.window.document,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element,
    Event: dom.window.Event,
  });

  // Import discrete files as if loaded from CDN / unpkg / jsdelivr
  const { createEngine } = await import('../dist/core.min.js');
  const { createStore } = await import('../dist/store.min.js');
  const textMod = await import('../dist/modules/text.min.js');
  const showMod = await import('../dist/modules/show.min.js');
  const eventsMod = await import('../dist/modules/events.min.js');

  const text = textMod.default || textMod.text;
  const show = showMod.default || showMod.show;
  const events = eventsMod.default || eventsMod.events;

  const engine = createEngine({
    modules: [text(), show(), events()],
  });

  const store = createStore({ count: 10, visible: false, msg: 'Lean Core CDN Success' });
  const target = document.getElementById('app');

  const unmount = engine.mount(target, {
    templateName: 'lean',
    store,
    handlers: {
      inc: () => store.update('count', (n) => n + 1),
    },
  });

  const btn = target.querySelector('button');
  const p = target.querySelector('p');
  const span = target.querySelector('span');

  assert.equal(btn.textContent, '10');
  assert.equal(p.hidden, true);
  assert.equal(span.textContent, 'Lean Core CDN Success');

  // Event interaction
  btn.dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(btn.textContent, '11');

  // Reactivity
  store.set('visible', true);
  assert.equal(p.hidden, false);

  unmount();
  assert.equal(target.textContent, '');
});

test('discrete structural CDN modules: conditionals, loops, partials with core.min.js', async () => {
  const dom = new JSDOM(`<!doctype html>
    <template id="tpl-user-card">
      <div class="user-card"><b data-text="name"></b></div>
    </template>
    <template id="tpl-main">
      <div id="root">
        <partial name="user-card"></partial>
        <if is-truthy="active"><span class="badge">Active</span></if>
        <ul><for each="items" as="item"><li>\${item}</li></for></ul>
      </div>
    </template>
    <div id="container"></div>`, { url: 'http://localhost/' });

  Object.assign(globalThis, {
    document: dom.window.document,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element,
    Event: dom.window.Event,
  });

  const { createEngine } = await import('../dist/core.min.js');
  const { createStore } = await import('../dist/store.min.js');
  const { partials } = await import('../dist/modules/partials.min.js');
  const { conditionals } = await import('../dist/modules/conditionals.min.js');
  const { loops } = await import('../dist/modules/loops.min.js');
  const { text } = await import('../dist/modules/text.min.js');

  const engine = createEngine({
    modules: [partials(), conditionals(), loops(), text()],
  });

  const store = createStore({
    name: 'Alice',
    active: true,
    items: ['Apple', 'Banana'],
  });

  const target = document.getElementById('container');
  const unmount = engine.mount(target, {
    templateName: 'main',
    store,
  });

  assert.equal(target.querySelector('.user-card b').textContent, 'Alice');
  assert.equal(target.querySelector('.badge').textContent, 'Active');
  const lis = target.querySelectorAll('li');
  assert.equal(lis.length, 2);
  assert.equal(lis[0].textContent, 'Apple');
  assert.equal(lis[1].textContent, 'Banana');

  unmount();
  assert.equal(target.textContent, '');
});

test('discrete model and all-in-one modules/index.min.js CDN bundles', async () => {
  const dom = new JSDOM(`<!doctype html>
    <template id="tpl-form">
      <input type="text" data-model="username" />
    </template>
    <div id="form-container"></div>`, { url: 'http://localhost/' });

  Object.assign(globalThis, {
    document: dom.window.document,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element,
    Event: dom.window.Event,
  });

  const { createEngine } = await import('../dist/core.min.js');
  const { createStore } = await import('../dist/store.min.js');
  const { model } = await import('../dist/modules/model.min.js');

  const engine = createEngine({
    modules: [model()],
  });

  const store = createStore({ username: 'InitialUser' });
  const target = document.getElementById('form-container');
  const unmount = engine.mount(target, {
    templateName: 'form',
    store,
  });

  const input = target.querySelector('input');
  assert.equal(input.value, 'InitialUser');

  input.value = 'UpdatedUser';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(store.get('username'), 'UpdatedUser');

  unmount();

  // Test dist/modules/index.min.js bundle exports
  const allModules = await import('../dist/modules/index.min.js');
  assert.equal(typeof allModules.partials, 'function');
  assert.equal(typeof allModules.conditionals, 'function');
  assert.equal(typeof allModules.loops, 'function');
  assert.equal(typeof allModules.text, 'function');
  assert.equal(typeof allModules.show, 'function');
  assert.equal(typeof allModules.model, 'function');
  assert.equal(typeof allModules.events, 'function');
});
