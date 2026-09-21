import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { createEngine, createStore, setDevMode, subscribeDiagnostics } from '../src/index.js';
import { text } from '../src/modules/index.js';

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

// ── FINDING C: UNSAFE ATTRIBUTE INTERPOLATION REJECTION ───────────────────────

test('security: static onclick="${payload}" is rejected, removed, and emits UNSAFE_EVENT_ATTR', () => {
  const diagnostics = [];
  const unsub = subscribeDiagnostics((diag) => diagnostics.push(diag));

  const dom = createDom(`
    <div id="root">
      <button id="btn" onclick="\${payload}">Click</button>
    </div>
  `);

  const store = createStore({ payload: "window.__PWNED__ = true" });
  const engine = createEngine({ modules: [text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({ target: root, store, document: dom.window.document });

  unsub();

  const btn = dom.window.document.getElementById('btn');
  assert.equal(btn.hasAttribute('onclick'), false, 'onclick attribute must be removed');
  assert.equal(dom.window.__PWNED__, undefined, 'payload must not execute');

  const unsafeDiags = diagnostics.filter((d) => d.code === 'UNSAFE_EVENT_ATTR');
  assert.equal(unsafeDiags.length, 1);
  assert.equal(unsafeDiags[0].details.attrName.toLowerCase(), 'onclick');
});

test('security: reactive onclick="{payload}" is rejected, removed, and emits UNSAFE_EVENT_ATTR', () => {
  const diagnostics = [];
  const unsub = subscribeDiagnostics((diag) => diagnostics.push(diag));

  const dom = createDom(`
    <div id="root">
      <button id="btn" onclick="{payload}" data-payload="storePayload">Click</button>
    </div>
  `);

  const store = createStore({ storePayload: "window.__PWNED__ = true" });
  const engine = createEngine({ modules: [text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({ target: root, store, document: dom.window.document });

  unsub();

  const btn = dom.window.document.getElementById('btn');
  assert.equal(btn.hasAttribute('onclick'), false, 'onclick attribute must be removed');
  assert.equal(dom.window.__PWNED__, undefined, 'payload must not execute');

  const unsafeDiags = diagnostics.filter((d) => d.code === 'UNSAFE_EVENT_ATTR');
  assert.equal(unsafeDiags.length, 1);
  assert.equal(unsafeDiags[0].details.attrName.toLowerCase(), 'onclick');
});

test('security: static srcdoc="${payload}" is rejected, removed, and emits UNSAFE_EVENT_ATTR', () => {
  const diagnostics = [];
  const unsub = subscribeDiagnostics((diag) => diagnostics.push(diag));

  const dom = createDom(`
    <div id="root">
      <iframe id="frame" srcdoc="\${html}"></iframe>
    </div>
  `);

  const store = createStore({ html: "<script>window.__PWNED__ = true</script>" });
  const engine = createEngine({ modules: [text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({ target: root, store, document: dom.window.document });

  unsub();

  const frame = dom.window.document.getElementById('frame');
  assert.equal(frame.hasAttribute('srcdoc'), false, 'srcdoc attribute must be removed');

  const unsafeDiags = diagnostics.filter((d) => d.code === 'UNSAFE_EVENT_ATTR');
  assert.equal(unsafeDiags.length, 1);
  assert.equal(unsafeDiags[0].details.attrName.toLowerCase(), 'srcdoc');
});

test('security: reactive srcdoc="{html}" is rejected, removed, and emits UNSAFE_EVENT_ATTR', () => {
  const diagnostics = [];
  const unsub = subscribeDiagnostics((diag) => diagnostics.push(diag));

  const dom = createDom(`
    <div id="root">
      <iframe id="frame" srcdoc="{html}" data-html="storeHtml"></iframe>
    </div>
  `);

  const store = createStore({ storeHtml: "<script>window.__PWNED__ = true</script>" });
  const engine = createEngine({ modules: [text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({ target: root, store, document: dom.window.document });

  unsub();

  const frame = dom.window.document.getElementById('frame');
  assert.equal(frame.hasAttribute('srcdoc'), false, 'srcdoc attribute must be removed');

  const unsafeDiags = diagnostics.filter((d) => d.code === 'UNSAFE_EVENT_ATTR');
  assert.equal(unsafeDiags.length, 1);
  assert.equal(unsafeDiags[0].details.attrName.toLowerCase(), 'srcdoc');
});

test('security: safe attributes with static and reactive bindings work normally', () => {
  const diagnostics = [];
  const unsub = subscribeDiagnostics((diag) => diagnostics.push(diag));

  const dom = createDom(`
    <div id="root">
      <span id="s1" title="\${info}">Static</span>
      <span id="s2" title="Hello {who}" data-who="targetName">Reactive</span>
    </div>
  `);

  const store = createStore({ info: "Safe Tooltip", targetName: "World" });
  const engine = createEngine({ modules: [text()] });
  const root = dom.window.document.getElementById('root');
  engine.mount({ target: root, store, document: dom.window.document });

  unsub();

  const s1 = dom.window.document.getElementById('s1');
  const s2 = dom.window.document.getElementById('s2');
  assert.equal(s1.getAttribute('title'), 'Safe Tooltip');
  assert.equal(s2.getAttribute('title'), 'Hello World');

  const unsafeDiags = diagnostics.filter((d) => d.code === 'UNSAFE_EVENT_ATTR');
  assert.equal(unsafeDiags.length, 0);
});
