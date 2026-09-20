import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createEngine } from '../src/core/engine.js';
import { createRouter } from '../src/core/router.js';
import { defineModule } from '../src/core/registry.js';
import { tag, attr, attrs, pattern } from '../src/core/triggers.js';

function createDom(html = '<!DOCTYPE html><html><body></body></html>') {
  return new JSDOM(html, { url: 'http://localhost/' });
}

// ── 1. TAG REQUIRED & OPTIONAL ATTRIBUTES ────────────────────────────────────

test('triggers: tag requires all required attributes to match', () => {
  let matchedData = null;
  const mod = defineModule({
    name: 'user-mod',
    triggers: [
      tag('USER-TAG', {
        phase: 'transform',
        required: ['user-id', 'role'],
        optional: ['badge'],
        setup(el, data) {
          matchedData = data;
        },
      }),
    ],
  });

  const dom = createDom(`
    <div id="target">
      <user-tag id="valid" user-id="42" role="admin" badge="gold"></user-tag>
      <user-tag id="missing" user-id="99"></user-tag>
    </div>
  `);
  const engine = createEngine({ modules: [mod] });
  engine.mount({ target: dom.window.document.getElementById('target') });

  assert.ok(matchedData);
  assert.equal(matchedData['user-id'], '42');
  assert.equal(matchedData.role, 'admin');
  assert.equal(matchedData.badge, 'gold');

  // Element missing 'role' should NOT have been matched / transformed
  const missingEl = dom.window.document.getElementById('missing');
  assert.ok(missingEl, 'Unmatched element without required attributes remains in DOM');
});

test('triggers: tag harvests optional attributes when present and omits when absent', () => {
  let matchedAttributes = null;
  const mod = defineModule({
    name: 'card-mod',
    triggers: [
      tag('APP-CARD', {
        phase: 'link',
        optional: ['theme', 'elevation'],
        setup(el, data, ctx) {
          matchedAttributes = ctx.attributes;
        },
      }),
    ],
  });

  const dom = createDom('<div id="target"><app-card theme="dark"></app-card></div>');
  const engine = createEngine({ modules: [mod] });
  engine.mount({ target: dom.window.document.getElementById('target') });

  assert.deepEqual(matchedAttributes, { theme: 'dark' });
});

// ── 2. TYPE COERCION (TYPES SCHEMA) ──────────────────────────────────────────

test('triggers: types schema coerces Number, Boolean, Array, and custom types', () => {
  let receivedData = null;
  const mod = defineModule({
    name: 'typed-mod',
    triggers: [
      tag('ITEM-BADGE', {
        phase: 'link',
        required: ['count'],
        optional: ['is-active', 'is-hidden', 'tags', 'custom-val'],
        types: {
          count: Number,
          'is-active': Boolean,
          'is-hidden': Boolean,
          tags: Array,
          'custom-val': (val) => `prefix-${val}`,
        },
        setup(el, data) {
          receivedData = data;
        },
      }),
    ],
  });

  const dom = createDom(`
    <div id="target">
      <item-badge count="108" is-active tags="red, green, blue" custom-val="sample"></item-badge>
    </div>
  `);
  const engine = createEngine({ modules: [mod] });
  engine.mount({ target: dom.window.document.getElementById('target') });

  assert.deepEqual(receivedData, {
    count: 108,
    'is-active': true,
    'is-hidden': false, // optional boolean absent -> false
    tags: ['red', 'green', 'blue'],
    'custom-val': 'prefix-sample',
  });
});

// ── 3. TEMPLATE DIRECTIVE ALIAS ──────────────────────────────────────────────

test('triggers: templateDirective matches both custom tag and template[directive]', () => {
  const matchedElements = [];
  const mod = defineModule({
    name: 'dual-syntax-mod',
    triggers: [
      tag('MY-LOOP', {
        phase: 'transform',
        templateDirective: 'data-my-loop',
        required: ['each'],
        setup(el, data) {
          matchedElements.push({ tag: el.tagName, each: data.each });
          el.remove();
        },
      }),
    ],
  });

  const dom = createDom(`
    <div id="target">
      <my-loop each="users"></my-loop>
      <table>
        <tbody>
          <template data-my-loop each="rows"></template>
        </tbody>
      </table>
    </div>
  `);
  const engine = createEngine({ modules: [mod] });
  engine.mount({ target: dom.window.document.getElementById('target') });

  assert.equal(matchedElements.length, 2);
  assert.deepEqual(matchedElements, [
    { tag: 'MY-LOOP', each: 'users' },
    { tag: 'TEMPLATE', each: 'rows' },
  ]);
});

// ── 4. EXCLUDE RULES (NEGATIVE MATCHING) ─────────────────────────────────────

test('triggers: pattern exclude rules reject matched attribute names', () => {
  const matches = [];
  const mod = defineModule({
    name: 'exclude-mod',
    triggers: [
      pattern('data-prop-', {
        phase: 'link',
        exclude: ['data-prop-ignore', /^data-prop-skip-/],
        setup(el, data, ctx) {
          matches.push(ctx.matchedAttribute);
        },
      }),
    ],
  });

  const dom = createDom(`
    <div id="target"
      data-prop-title="Hello"
      data-prop-ignore="SkipMe"
      data-prop-skip-this="AlsoSkip"
      data-prop-desc="World">
    </div>
  `);
  const engine = createEngine({ modules: [mod] });
  engine.mount({ target: dom.window.document.getElementById('target') });

  assert.deepEqual(matches, ['data-prop-title', 'data-prop-desc']);
});

// ── 5. ATTR COMPANION REQUIRED & OPTIONAL ───────────────────────────────────

test('triggers: attr trigger checks companion required attributes and harvests them', () => {
  let receivedData = null;
  const mod = defineModule({
    name: 'modal-mod',
    triggers: [
      attr('data-modal', {
        phase: 'link',
        required: ['data-target-id'],
        optional: ['data-backdrop'],
        types: {
          'data-backdrop': Boolean,
        },
        setup(el, data) {
          receivedData = data;
        },
      }),
    ],
  });

  const dom = createDom(`
    <div id="target">
      <button id="btn1" data-modal="open" data-target-id="modal-1" data-backdrop></button>
      <button id="btn2" data-modal="open"></button>
    </div>
  `);
  const engine = createEngine({ modules: [mod] });
  engine.mount({ target: dom.window.document.getElementById('target') });

  assert.deepEqual(receivedData, {
    'data-modal': 'open',
    'data-target-id': 'modal-1',
    'data-backdrop': true,
  });
});

// ── 6. ATTRS ACTIVATED OPTIONAL ATTRIBUTES ──────────────────────────────────

test('triggers: attrs activates optional attributes into data payload', () => {
  let receivedData = null;
  const mod = defineModule({
    name: 'cond-attrs-mod',
    triggers: [
      attrs({
        required: ['x-left', 'x-op'],
        optional: ['x-right'],
        phase: 'link',
      }, (el, data) => {
        receivedData = data;
      }),
    ],
  });

  const dom = createDom('<div id="target" x-left="price" x-op="gt" x-right="100"></div>');
  const engine = createEngine({ modules: [mod] });
  engine.mount({ target: dom.window.document.getElementById('target') });

  assert.deepEqual(receivedData, {
    'x-left': 'price',
    'x-op': 'gt',
    'x-right': '100',
  });
});

// ── 7. ZERO-BOILERPLATE DATA FALLBACK & CTX.EMIT ─────────────────────────────

test('context: ctx.emit dispatches custom events captured by listeners', () => {
  const eventsCaptured = [];
  const mod = defineModule({
    name: 'emitter-mod',
    triggers: [
      tag('NOTIFY-BUTTON', {
        phase: 'link',
        setup(el, data, ctx) {
          ctx.emit('user-action', { action: 'clicked', id: 99 });
        },
      }),
    ],
  });

  const dom = createDom('<div id="target"><notify-button></notify-button></div>');
  const target = dom.window.document.getElementById('target');
  target.addEventListener('user-action', (evt) => {
    eventsCaptured.push(evt.detail);
  });

  const engine = createEngine({ modules: [mod] });
  engine.mount({ target });

  assert.equal(eventsCaptured.length, 1);
  assert.deepEqual(eventsCaptured[0], { action: 'clicked', id: 99 });
});

// ── 8. CUSTOM ELEMENT BRIDGE ────────────────────────────────────────────────

test('triggers: hyphenated tag triggers register in customElements registry when available', () => {
  const dom = createDom('<div id="target"><custom-panel></custom-panel></div>');
  const win = dom.window;

  const mod = defineModule({
    name: 'ce-mod',
    triggers: [
      tag('CUSTOM-PANEL', {
        phase: 'link',
        observedAttributes: ['status'],
        update(_el, _change) {
        },
      }),
    ],
  });

  // Create router with dom document context
  createRouter([mod], { document: win.document });

  assert.ok(win.customElements.get('custom-panel'), 'customElements registry should have custom-panel');
});

test('triggers: customElement observedAttributes triggers update hook on setAttribute', () => {
  const dom = createDom('<div id="target"><status-badge status="pending"></status-badge></div>');

  let updatePayload = null;
  const mod = defineModule({
    name: 'badge-ce-mod',
    triggers: [
      tag('STATUS-BADGE', {
        phase: 'link',
        observedAttributes: ['status'],
        update(el, change) {
          updatePayload = change;
        },
      }),
    ],
  });

  const engine = createEngine({ modules: [mod] });
  engine.mount({ target: dom.window.document.getElementById('target') });

  const badge = dom.window.document.querySelector('status-badge');
  assert.ok(badge);

  // Mutate attribute directly on the DOM element
  badge.setAttribute('status', 'resolved');

  assert.deepEqual(updatePayload, {
    name: 'status',
    oldValue: 'pending',
    newValue: 'resolved',
  });
});

test('triggers: types schema parses JSON Object attributes', () => {
  let receivedData = null;
  const mod = defineModule({
    name: 'json-typed-mod',
    triggers: [
      tag('JSON-BOX', {
        phase: 'link',
        required: ['data-config'],
        types: {
          'data-config': Object,
        },
        setup(el, data) {
          receivedData = data;
        },
      }),
    ],
  });

  const dom = createDom('<div id="target"><json-box data-config=\'{"theme":"dark","v":2}\'></json-box></div>');
  const engine = createEngine({ modules: [mod] });
  engine.mount({ target: dom.window.document.getElementById('target') });

  assert.deepEqual(receivedData, {
    'data-config': { theme: 'dark', v: 2 },
  });
});

