import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  mount,
  unmount,
  createStore,
} from '../src/index.js';
import {
  createScope,
  createIsolatedScope,
  isLocalScopeBinding,
  setElementScope,
  getElementScope,
} from '../src/core/index.js';
import { setDevMode } from '../src/errors.js';

function createDom(html = '') {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
}

test.beforeEach(() => {
  setDevMode(false);
});

// ── 1. IN-PLACE MOUNT CONTENT OWNERSHIP & TEARDOWN ──────────────────────────

test('in-place mount: caller-provided DOM survives unmount while runtime is cleaned', () => {
  const dom = createDom('<div id="parent"><div id="app"><button id="btn" data-on-click="save">Save</button><span id="txt" data-text="count">0</span></div></div>');
  const parent = dom.window.document.getElementById('parent');
  const target = dom.window.document.getElementById('app');

  let saved = 0;
  const store = createStore({ count: 10 });

  const instance = mount(target, {
    store,
    handlers: {
      save() {
        saved++;
      },
    },
    document: dom.window.document,
  });

  // Verify initial link
  assert.equal(target.querySelector('#txt').textContent, '10');

  // Verify event delegation
  const button = target.querySelector('#btn');
  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(saved, 1);

  // Store reactivity works
  store.set('count', 20);
  assert.equal(target.querySelector('#txt').textContent, '20');

  // Unmount in-place instance
  instance.unmount();

  // 1. Caller-provided DOM survives intact
  assert.ok(target.querySelector('#btn'), 'Button must survive in-place unmount');
  assert.ok(target.querySelector('#txt'), 'Span must survive in-place unmount');
  assert.equal(target.querySelector('#txt').textContent, '20');

  // 2. Target element is never removed or detached from its parent
  assert.equal(target.parentNode, parent);
  assert.equal(parent.firstElementChild, target);

  // 3. Runtime is cleaned up and deactivated:
  // - Clicking button does not trigger handlers
  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(saved, 1, 'Handler must not be called after unmount');

  // - Store updates no longer update DOM
  store.set('count', 30);
  assert.equal(target.querySelector('#txt').textContent, '20', 'Store update must not affect unmounted DOM');

  // 4. Instance state is deactivated
  assert.equal(instance.active, false);
});

test('in-place mount: unmount(target) on in-place mount leaves caller DOM intact', () => {
  const dom = createDom('<div id="root"><p data-text="msg">Initial</p></div>');
  const target = dom.window.document.getElementById('root');
  const store = createStore({ msg: 'Bound' });

  mount(target, { store, document: dom.window.document });
  assert.equal(target.querySelector('p').textContent, 'Bound');

  unmount(target);

  // Caller DOM preserved
  assert.ok(target.querySelector('p'), 'Paragraph survives unmount');
  assert.equal(target.querySelector('p').textContent, 'Bound');

  // Calling unmount again on untracked target is safe and does not clear DOM
  unmount(target);
  assert.ok(target.querySelector('p'), 'Paragraph remains intact after redundant unmount');
});

// ── 2. TEMPLATE MOUNT VS IN-PLACE MOUNT OWNERSHIP DISTINCTION ───────────────

test('mount ownership distinction: template mount clears Lime-created content; in-place mount preserves caller content', () => {
  const dom = createDom(`
    <div id="container">
      <div id="template-target"></div>
      <div id="in-place-target"><span data-text="val">Initial</span></div>
    </div>
  `);
  const container = dom.window.document.getElementById('container');
  const templateTarget = dom.window.document.getElementById('template-target');
  const inPlaceTarget = dom.window.document.getElementById('in-place-target');

  const store1 = createStore({ val: 'From Template' });
  const store2 = createStore({ val: 'From In-Place' });

  // 1. Template mount: Lime owns created content
  const templateMount = mount(templateTarget, '<span data-text="val"></span>', store1, { document: dom.window.document });
  assert.equal(templateTarget.querySelector('span').textContent, 'From Template');

  // 2. In-place mount: Caller owns pre-existing content
  const inPlaceMount = mount(inPlaceTarget, { store: store2, document: dom.window.document });
  assert.equal(inPlaceTarget.querySelector('span').textContent, 'From In-Place');

  // Unmount template mount: clears Lime-created content
  templateMount.unmount();
  assert.equal(templateTarget.textContent, '', 'Template mount content is cleared');
  assert.equal(templateTarget.parentNode, container, 'Template target container survives');

  // Unmount in-place mount: preserves caller content
  inPlaceMount.unmount();
  assert.ok(inPlaceTarget.querySelector('span'), 'In-place content survives');
  assert.equal(inPlaceTarget.querySelector('span').textContent, 'From In-Place');
  assert.equal(inPlaceTarget.parentNode, container, 'In-place target container survives');
});

// ── 3. ABORTSIGNAL AND IN-PLACE MOUNT ───────────────────────────────────────

test('in-place mount: AbortSignal abort performs cleanup, deactivates runtime, and preserves caller DOM', () => {
  const dom = createDom('<div id="parent"><div id="app"><button data-on-click="act">Run</button><span data-text="status">idle</span></div></div>');
  const parent = dom.window.document.getElementById('parent');
  const target = dom.window.document.getElementById('app');

  const controller = new AbortController();
  const store = createStore({ status: 'running' });
  let acts = 0;

  const instance = mount(target, {
    store,
    signal: controller.signal,
    handlers: {
      act() { acts++; },
    },
    document: dom.window.document,
  });

  assert.equal(target.querySelector('span').textContent, 'running');
  target.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(acts, 1);

  // Abort the signal
  controller.abort();

  // 1. Instance deactivated
  assert.equal(instance.active, false);

  // 2. Caller DOM remains intact
  assert.ok(target.querySelector('button'));
  assert.ok(target.querySelector('span'));
  assert.equal(target.querySelector('span').textContent, 'running');
  assert.equal(target.parentNode, parent);

  // 3. Handlers and store updates deactivated
  target.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(acts, 1, 'No handler execution after abort');

  store.set('status', 'stopped');
  assert.equal(target.querySelector('span').textContent, 'running', 'No store sync after abort');
});

// ── 4. DUPLICATE MOUNT ON IN-PLACE TARGET ───────────────────────────────────

test('duplicate mount on in-place target: unmounting previous instance preserves caller DOM for new mount', () => {
  const dom = createDom('<div id="app"><button id="btn" data-on-click="action">Click</button><span id="txt" data-text="val"></span></div>');
  const target = dom.window.document.getElementById('app');

  let firstCalls = 0;
  let secondCalls = 0;

  const store1 = createStore({ val: 'First' });
  const store2 = createStore({ val: 'Second' });

  // First in-place mount
  const first = mount(target, {
    store: store1,
    handlers: {
      action() { firstCalls++; },
    },
    document: dom.window.document,
  });

  assert.equal(first.active, true);
  assert.equal(target.querySelector('#txt').textContent, 'First');

  const btn = target.querySelector('#btn');
  btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(firstCalls, 1);

  // Second in-place mount on same target (duplicate mount policy kicks in)
  const second = mount(target, {
    store: store2,
    handlers: {
      action() { secondCalls++; },
    },
    document: dom.window.document,
  });

  // Previous instance deactivated without destroying DOM
  assert.equal(first.active, false);
  assert.equal(second.active, true);

  // DOM content is intact and re-linked to second store/handlers
  assert.ok(target.querySelector('#btn'), 'Button must exist');
  assert.equal(target.querySelector('#txt').textContent, 'Second');

  // Triggering action calls second handler, not first
  btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(firstCalls, 1, 'First handler must not be called');
  assert.equal(secondCalls, 1, 'Second handler must be called');

  // Updating first store has zero effect
  store1.set('val', 'First Ghost');
  assert.equal(target.querySelector('#txt').textContent, 'Second');

  // Updating second store updates DOM
  store2.set('val', 'Second Active');
  assert.equal(target.querySelector('#txt').textContent, 'Second Active');

  // Unmount second instance: caller DOM still remains intact
  second.unmount();
  assert.equal(second.active, false);
  assert.ok(target.querySelector('#btn'));
  assert.equal(target.querySelector('#txt').textContent, 'Second Active');
});

test('duplicate mount transition: in-place mount followed by template mount replaces content', () => {
  const dom = createDom('<div id="app"><p>Existing In-Place</p></div>');
  const target = dom.window.document.getElementById('app');

  const first = mount(target, { document: dom.window.document });
  assert.equal(target.querySelector('p').textContent, 'Existing In-Place');

  // Second mount is a template mount
  const second = mount(target, '<b>New Template Content</b>', null, { document: dom.window.document });

  assert.equal(first.active, false);
  assert.equal(second.active, true);
  assert.equal(target.querySelector('p'), null, 'Old in-place paragraph replaced by template');
  assert.equal(target.querySelector('b').textContent, 'New Template Content');

  // Second mount is template-owned, so unmount clears its content
  second.unmount();
  assert.equal(target.textContent, '');
});

// ── 5. SCOPE SEMANTICS AUDIT: PROTOTYPAL INHERITANCE & MUTABILITY ───────────

test('scope: parent lookup resolves ancestor properties through prototype chain', () => {
  const root = createScope(null, { appName: 'LimeApp', version: '0.3.0' });
  const child = createScope(root, { localUser: 'Alice' });
  const grandChild = createScope(child, { item: 'Widget' });

  assert.equal(grandChild.item, 'Widget');
  assert.equal(grandChild.localUser, 'Alice');
  assert.equal(grandChild.appName, 'LimeApp');
  assert.equal(grandChild.version, '0.3.0');
});

test('scope: child property shadowing does not mutate parent scope', () => {
  const parent = createScope(null, { title: 'Parent Title', count: 1 });
  const child = createScope(parent, { title: 'Child Title' });

  assert.equal(child.title, 'Child Title');
  assert.equal(parent.title, 'Parent Title');

  // Direct write to child shadows parent without mutating parent
  child.count = 2;
  assert.equal(child.count, 2);
  assert.equal(parent.count, 1);
});

test('scope: child isolation prevents parent from accessing child-only properties', () => {
  const parent = createScope(null, { shared: 'yes' });
  const child = createScope(parent, { childOnly: 'secret' });

  assert.equal(child.childOnly, 'secret');
  assert.equal(parent.childOnly, undefined);
  assert.equal('childOnly' in parent, false);
  assert.equal(isLocalScopeBinding(parent, 'childOnly'), false);
  assert.equal(isLocalScopeBinding(child, 'childOnly'), true);
  assert.equal(isLocalScopeBinding(child, 'shared'), false);
});

test('scope: partial scope is completely isolated with null prototype', () => {
  const partialScope = createIsolatedScope({ user: 'Bob' }, { theme: 'light' });

  assert.equal(partialScope.user, 'Bob');
  assert.equal(partialScope.theme, 'light');
  assert.equal(Object.getPrototypeOf(partialScope), null);
  assert.equal(partialScope.toString, undefined);
});

test('scope: scope objects are lexically isolated and mutable (not frozen)', () => {
  const parent = createScope(null, { val: 10 });
  const child = createScope(parent, { val: 20 });

  // Verify scope is NOT frozen
  assert.equal(Object.isFrozen(parent), false, 'Parent scope is mutable');
  assert.equal(Object.isFrozen(child), false, 'Child scope is mutable');

  // Verify mutating child property modifies child and leaves parent untouched
  child.val = 30;
  assert.equal(child.val, 30);
  assert.equal(parent.val, 10);

  // Verify adding new property to child does not leak to parent
  child.newProp = 'added';
  assert.equal(child.newProp, 'added');
  assert.equal(parent.newProp, undefined);
});

test('scope: setElementScope and getElementScope maintain lexical scope association on element subtrees', () => {
  const dom = createDom('<div id="container"><span id="child">Text</span></div>');
  const container = dom.window.document.getElementById('container');
  const child = dom.window.document.getElementById('child');

  const scope = createScope(null, { itemIndex: 5 });
  setElementScope(container, scope);

  assert.equal(getElementScope(container), scope);
  assert.equal(getElementScope(child), scope);

  // Unassociated element returns null
  const other = dom.window.document.createElement('div');
  assert.equal(getElementScope(other), null);
});
