import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { createEngine, createStore, setDevMode, subscribeDiagnostics, mount } from '../src/index.js';
import { text, show, model, events, conditionals, loops, partials } from '../src/modules/index.js';

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

// ── 1. DEFAULT SLOT PROJECTION ───────────────────────────────────────────────

test('slots: default slot projects caller children in order', () => {
  const dom = createDom(`
    <template id="tpl-card">
      <div class="card">
        <h2>Card Header</h2>
        <div class="card-body">
          <slot></slot>
        </div>
      </div>
    </template>
    <div id="root">
      <partial name="card">
        <p class="p1">First paragraph</p>
        <p class="p2">Second paragraph</p>
      </partial>
    </div>
  `);

  const engine = createEngine({ modules: [text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { document: dom.window.document });

  assert.equal(root.querySelector('partial'), null);
  assert.equal(root.querySelector('slot'), null);
  const paras = Array.from(root.querySelectorAll('.card-body p'));
  assert.equal(paras.length, 2);
  assert.equal(paras[0].className, 'p1');
  assert.equal(paras[0].textContent, 'First paragraph');
  assert.equal(paras[1].className, 'p2');
  assert.equal(paras[1].textContent, 'Second paragraph');
});

test('slots: default slot fallback renders when caller provides no children', () => {
  const dom = createDom(`
    <template id="tpl-alert">
      <div class="alert">
        <slot><span class="default-msg">Default Alert Text</span></slot>
      </div>
    </template>
    <div id="root">
      <partial name="alert"></partial>
    </div>
  `);

  const engine = createEngine();
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { document: dom.window.document });

  assert.equal(root.querySelector('slot'), null);
  const msg = root.querySelector('.default-msg');
  assert.ok(msg);
  assert.equal(msg.textContent, 'Default Alert Text');
});

test('slots: default slot fallback renders when caller provides only whitespace text nodes', () => {
  const dom = createDom(`
    <template id="tpl-banner">
      <aside class="banner">
        <slot><p class="fb">Fallback Banner</p></slot>
      </aside>
    </template>
    <div id="root">
      <partial name="banner">
        
      </partial>
    </div>
  `);

  const engine = createEngine();
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { document: dom.window.document });

  assert.equal(root.querySelector('slot'), null);
  assert.equal(root.querySelector('.fb').textContent, 'Fallback Banner');
});

test('slots: caller content overrides default slot fallback', () => {
  const dom = createDom(`
    <template id="tpl-banner">
      <aside class="banner">
        <slot><p class="fb">Fallback Banner</p></slot>
      </aside>
    </template>
    <div id="root">
      <partial name="banner">
        <span class="custom">Custom Banner</span>
      </partial>
    </div>
  `);

  const engine = createEngine();
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { document: dom.window.document });

  assert.equal(root.querySelector('.fb'), null);
  assert.equal(root.querySelector('.custom').textContent, 'Custom Banner');
});

// ── 2. NAMED SLOTS PROJECTION ────────────────────────────────────────────────

test('slots: named slots project to matching slot and strip slot attribute', () => {
  const dom = createDom(`
    <template id="tpl-layout">
      <div class="layout">
        <header><slot name="header"></slot></header>
        <main><slot></slot></main>
        <footer><slot name="footer"></slot></footer>
      </div>
    </template>
    <div id="root">
      <partial name="layout">
        <h1 slot="header">My Header Title</h1>
        <p>Main content paragraph</p>
        <div slot="footer"><small>Copyright 2026</small></div>
      </partial>
    </div>
  `);

  const engine = createEngine();
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { document: dom.window.document });

  assert.equal(root.querySelector('slot'), null);

  const headerH1 = root.querySelector('header h1');
  assert.ok(headerH1);
  assert.equal(headerH1.textContent, 'My Header Title');
  assert.equal(headerH1.getAttribute('slot'), null, 'slot attribute must be stripped');

  const mainP = root.querySelector('main p');
  assert.ok(mainP);
  assert.equal(mainP.textContent, 'Main content paragraph');

  const footerDiv = root.querySelector('footer div');
  assert.ok(footerDiv);
  assert.equal(footerDiv.querySelector('small').textContent, 'Copyright 2026');
  assert.equal(footerDiv.getAttribute('slot'), null, 'slot attribute must be stripped');
});

test('slots: multiple elements targeting the same named slot preserve caller DOM order', () => {
  const dom = createDom(`
    <template id="tpl-nav">
      <nav>
        <ul class="nav-links">
          <slot name="links"></slot>
        </ul>
      </nav>
    </template>
    <div id="root">
      <partial name="nav">
        <li slot="links" class="link-1">Home</li>
        <li slot="links" class="link-2">About</li>
        <li slot="links" class="link-3">Contact</li>
      </partial>
    </div>
  `);

  const engine = createEngine();
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { document: dom.window.document });

  const items = Array.from(root.querySelectorAll('.nav-links li'));
  assert.equal(items.length, 3);
  assert.equal(items[0].className, 'link-1');
  assert.equal(items[0].textContent, 'Home');
  assert.equal(items[0].getAttribute('slot'), null);
  assert.equal(items[1].className, 'link-2');
  assert.equal(items[1].textContent, 'About');
  assert.equal(items[2].className, 'link-3');
  assert.equal(items[2].textContent, 'Contact');
});

test('slots: named slot fallback content renders when caller provides nothing for that slot', () => {
  const dom = createDom(`
    <template id="tpl-dialog">
      <dialog>
        <div class="title"><slot name="title">Default Dialog Title</slot></div>
        <div class="actions"><slot name="actions"><button class="btn-cancel">Cancel</button></slot></div>
      </dialog>
    </template>
    <div id="root">
      <partial name="dialog">
        <span slot="title">Delete Confirmation</span>
      </partial>
    </div>
  `);

  const engine = createEngine();
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { document: dom.window.document });

  assert.equal(root.querySelector('.title span').textContent, 'Delete Confirmation');
  // actions slot was not provided -> fallback button rendered
  const cancelBtn = root.querySelector('.actions .btn-cancel');
  assert.ok(cancelBtn);
  assert.equal(cancelBtn.textContent, 'Cancel');
});

test('slots: multiple slots with same name in template both receive content', () => {
  const dom = createDom(`
    <template id="tpl-multi-slot">
      <div class="view">
        <div class="top"><slot name="badge"></slot></div>
        <div class="bottom"><slot name="badge"></slot></div>
      </div>
    </template>
    <div id="root">
      <partial name="multi-slot">
        <span slot="badge" class="badge">PRO</span>
      </partial>
    </div>
  `);

  const engine = createEngine();
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { document: dom.window.document });

  assert.equal(root.querySelector('.top .badge').textContent, 'PRO');
  assert.equal(root.querySelector('.bottom .badge').textContent, 'PRO');
});

// ── 3. UNKNOWN SLOTS DIAGNOSTIC ──────────────────────────────────────────────

test('slots: unknown slot emits SLOT_NOT_FOUND diagnostic and discards content', () => {
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((d) => diagnostics.push(d));

  const dom = createDom(`
    <template id="tpl-card">
      <div class="card">
        <slot name="header"></slot>
        <slot></slot>
      </div>
    </template>
    <div id="root">
      <partial name="card">
        <h3 slot="header">Valid Header</h3>
        <p>Valid Body</p>
        <div slot="mystery-slot" class="should-not-exist">Alien Content</div>
      </partial>
    </div>
  `);

  const engine = createEngine();
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { document: dom.window.document });

  // Discarded from DOM
  assert.equal(root.querySelector('.should-not-exist'), null);
  assert.equal(root.querySelector('h3').textContent, 'Valid Header');
  assert.equal(root.querySelector('p').textContent, 'Valid Body');

  // Diagnostic emitted
  const diag = diagnostics.find((d) => d.code === 'SLOT_NOT_FOUND');
  assert.ok(diag, 'SLOT_NOT_FOUND diagnostic should be emitted');
  assert.equal(diag.code, 'SLOT_NOT_FOUND');

  unsubscribe();
});

test('slots: unknown slot formats detailed dev-mode error message', async () => {
  await setDevMode(true);
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((d) => diagnostics.push(d));

  const dom = createDom(`
    <template id="tpl-card">
      <div class="card"><slot name="header"></slot></div>
    </template>
    <div id="root">
      <partial name="card">
        <div slot="mystery">Alien Content</div>
      </partial>
    </div>
  `);

  const engine = createEngine();
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { document: dom.window.document });

  const diag = diagnostics.find((d) => d.code === 'SLOT_NOT_FOUND');
  assert.ok(diag);
  assert.ok(diag.message.includes('Slot "mystery" not found in partial "card"'));
  assert.ok(diag.message.includes('header'));

  unsubscribe();
  setDevMode(false);
});

// ── 4. SCOPE ISOLATION AND PRESERVATION ──────────────────────────────────────

test('slots: partial template nodes use isolated scope; slot content keeps caller scope', () => {
  const dom = createDom(`
    <template id="tpl-profile">
      <section class="profile">
        <h2 class="partial-title">\${title}</h2>
        <span class="partial-secret">\${secret}</span>
        <div class="content">
          <slot></slot>
        </div>
      </section>
    </template>
    <div id="root">
      <partial name="profile" data="userData">
        <span class="caller-title">\${title}</span>
        <span class="caller-secret">\${secret}</span>
      </partial>
    </div>
  `);

  const scope = {
    title: 'Caller Dashboard',
    secret: 'caller-classified',
    userData: {
      title: 'User Profile',
      secret: 'profile-isolated',
    },
  };

  const engine = createEngine();
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { scope, document: dom.window.document });

  assert.equal(root.querySelector('.partial-title').textContent, 'User Profile');
  assert.equal(root.querySelector('.partial-secret').textContent, 'profile-isolated');
  assert.equal(root.querySelector('.caller-title').textContent, 'Caller Dashboard');
  assert.equal(root.querySelector('.caller-secret').textContent, 'caller-classified');
});

test('slots: delegated event inside slot resolves handler with caller scope', () => {
  const dom = createDom(`
    <template id="tpl-box">
      <div class="box">
        <slot name="action"></slot>
      </div>
    </template>
    <div id="root">
      <partial name="box">
        <button slot="action" class="btn" data-on-click="handleClick">Click Me</button>
      </partial>
    </div>
  `);

  let capturedPayload = null;
  const handlers = {
    handleClick(payload) {
      capturedPayload = payload;
    },
  };

  const scope = {
    myScopeVar: 'hello-from-caller',
  };

  const engine = createEngine({ modules: [events()] });
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { scope, handlers, document: dom.window.document });

  const btn = root.querySelector('.btn');
  assert.ok(btn);
  btn.click();

  assert.ok(capturedPayload);
  assert.equal(capturedPayload.scope.myScopeVar, 'hello-from-caller');
  assert.equal(capturedPayload.element, btn);
});

test('slots: <partial> inside a loop with slot referencing loop item', () => {
  const dom = createDom(`
    <template id="tpl-user-row">
      <div class="row">
        <span class="prefix">User:</span>
        <slot name="user-body"></slot>
      </div>
    </template>
    <div id="root">
      <for each="users" as="user">
        <partial name="user-row">
          <strong slot="user-body" class="uname">\${user.name} (\${user.role})</strong>
        </partial>
      </for>
    </div>
  `);

  const scope = {
    users: [
      { name: 'Ada', role: 'Dev' },
      { name: 'Alan', role: 'Analyst' },
    ],
  };

  const engine = createEngine({ modules: [loops()] });
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { scope, document: dom.window.document });

  const rows = Array.from(root.querySelectorAll('.uname'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].textContent, 'Ada (Dev)');
  assert.equal(rows[1].textContent, 'Alan (Analyst)');
});

// ── 5. MODULE INTEGRATION INSIDE SLOTS ────────────────────────────────────────

test('slots: data-text, data-show, data-if inside slot content execute seamlessly', () => {
  const dom = createDom(`
    <template id="tpl-panel">
      <div class="panel">
        <div class="panel-inner">
          <slot></slot>
        </div>
      </div>
    </template>
    <div id="root">
      <partial name="panel">
        <span class="bound-text" data-text="info.message"></span>
        <div class="bound-show" data-show="info.visible">Visible Panel</div>
        <if is-truthy="info.showCondition">
          <p class="cond-p">Condition Met</p>
        </if>
      </partial>
    </div>
  `);

  const store = createStore({
    info: {
      message: 'Hello Reactive Slot',
      visible: true,
      showCondition: true,
    },
  });

  const engine = createEngine({
    modules: [text(), show(), conditionals()],
  });
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { store, document: dom.window.document });

  assert.equal(root.querySelector('.bound-text').textContent, 'Hello Reactive Slot');
  assert.equal(root.querySelector('.bound-show').style.display, '');
  assert.equal(root.querySelector('.cond-p').textContent, 'Condition Met');

  // Reactivity test on slot element
  store.set('info.message', 'Updated Reactive Slot');
  assert.equal(root.querySelector('.bound-text').textContent, 'Updated Reactive Slot');
});

test('slots: nested partial inside another partial slot compiles cleanly', () => {
  const dom = createDom(`
    <template id="tpl-outer-card">
      <div class="outer-card">
        <h3>Outer</h3>
        <slot name="outer-body"></slot>
      </div>
    </template>
    <template id="tpl-inner-card">
      <div class="inner-card">
        <h4>Inner</h4>
        <slot name="inner-body"></slot>
      </div>
    </template>
    <div id="root">
      <partial name="outer-card">
        <div slot="outer-body" class="outer-content">
          <partial name="inner-card">
            <span slot="inner-body" class="leaf-content">\${leafVar}</span>
          </partial>
        </div>
      </partial>
    </div>
  `);

  const scope = {
    leafVar: 'Deeply Nested Success',
  };

  const engine = createEngine();
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { scope, document: dom.window.document });

  assert.equal(root.querySelector('.outer-card h3').textContent, 'Outer');
  assert.equal(root.querySelector('.inner-card h4').textContent, 'Inner');
  assert.equal(root.querySelector('.leaf-content').textContent, 'Deeply Nested Success');
});

// ── 6. BUILT-IN CAPABILITY & COMPATIBILITY ───────────────────────────────────

test('slots: partials are built-in and work with empty createEngine()', () => {
  const dom = createDom(`
    <template id="tpl-simple">
      <div class="simple"><slot>Simple Fallback</slot></div>
    </template>
    <div id="root">
      <partial name="simple"></partial>
    </div>
  `);

  // Zero modules configured
  const engine = createEngine();
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { document: dom.window.document });

  assert.equal(root.querySelector('.simple').textContent, 'Simple Fallback');
});

test('slots: public mount facade with custom templates option expands partial and slots', () => {
  const dom = createDom('<div id="app"><partial name="inline-card"><p slot="body">Slot Content</p></partial></div>');

  mount('#app', {
    templates: {
      'inline-card': '<div class="custom-card"><h1>Inline</h1><slot name="body"></slot></div>',
    },
    document: dom.window.document,
  });

  const app = dom.window.document.getElementById('app');
  assert.equal(app.querySelector('h1').textContent, 'Inline');
  assert.equal(app.querySelector('.custom-card p').textContent, 'Slot Content');
  assert.equal(app.querySelector('.custom-card p').getAttribute('slot'), null);
});

test('slots: unmount cleanly removes template DOM and teardowns bindings inside slots', () => {
  const dom = createDom(`
    <template id="tpl-wrapper">
      <div class="wrapper">
        <slot></slot>
      </div>
    </template>
    <div id="app"></div>
  `);

  const store = createStore({ msg: 'Init' });
  const app = dom.window.document.getElementById('app');

  const instance = mount(app, '<partial name="wrapper"><span data-text="msg"></span></partial>', store, {
    document: dom.window.document,
  });

  assert.equal(app.querySelector('span').textContent, 'Init');

  // Teardown
  instance.unmount();
  assert.equal(app.textContent, '', 'Target content cleared on unmount');

  // Store update after unmount does not throw
  store.set('msg', 'After Unmount');
});

test('slots: data-model two-way binding works inside slot content', () => {
  const dom = createDom(`
    <template id="tpl-field">
      <div class="field-wrapper">
        <label>Input:</label>
        <slot></slot>
      </div>
    </template>
    <div id="root">
      <partial name="field">
        <input data-model="user.nickname" />
      </partial>
    </div>
  `);

  const store = createStore({ user: { nickname: 'Initial' } });
  const engine = createEngine({ modules: [model()] });
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { store, document: dom.window.document });

  const input = root.querySelector('input');
  assert.equal(input.value, 'Initial');

  // Modify input and dispatch event
  input.value = 'Updated Nick';
  input.dispatchEvent(new dom.window.Event('input'));

  assert.equal(store.get('user.nickname'), 'Updated Nick');
});

test('slots: explicit partials() module in createEngine runs cleanly without duplicate warning', () => {
  const warnings = [];
  const unsubscribe = subscribeDiagnostics((d) => warnings.push(d));

  const dom = createDom(`
    <template id="tpl-explicit">
      <div class="explicit"><slot>Explicit Content</slot></div>
    </template>
    <div id="root">
      <partial name="explicit"></partial>
    </div>
  `);

  const engine = createEngine({
    modules: [partials(), text()],
  });
  const root = dom.window.document.getElementById('root');
  engine.mount(root, { document: dom.window.document });

  assert.equal(root.querySelector('.explicit').textContent, 'Explicit Content');
  assert.equal(warnings.some((w) => w.code === 'MODULE_TRIGGER_OVERRIDDEN'), false);
  unsubscribe();
});

test('slots: partial and slot composition inside reactive <for data-live key=...> list renders and updates', () => {
  const dom = createDom(`
    <template id="tpl-card">
      <div class="card">
        <h4 class="card-title">Card:</h4>
        <div class="card-body">
          <slot></slot>
        </div>
      </div>
    </template>
    <div id="root">
      <for each="items" as="item" key="id" data-live>
        <partial name="card">
          <span class="item-name">\${item.name}</span>
        </partial>
      </for>
    </div>
  `);

  const store = createStore({
    items: [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
    ],
  });

  const engine = createEngine({ modules: [loops(), partials(), text()] });
  const root = dom.window.document.getElementById('root');
  const instance = engine.mount(root, { store, document: dom.window.document });

  assert.equal(root.querySelectorAll('.card').length, 2);
  let names = Array.from(root.querySelectorAll('.item-name')).map((el) => el.textContent.trim());
  assert.deepEqual(names, ['Alpha', 'Beta']);

  // Dynamic store update: append Gamma, remove Alpha
  store.set('items', [
    { id: 'b', name: 'Beta' },
    { id: 'c', name: 'Gamma' },
  ]);

  assert.equal(root.querySelectorAll('.card').length, 2);
  names = Array.from(root.querySelectorAll('.item-name')).map((el) => el.textContent.trim());
  assert.deepEqual(names, ['Beta', 'Gamma']);

  instance.unmount?.();
});

