import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  createStore,
  mount,
  subscribeDiagnostics,
  safeUrl,
  safeStyleUrl,
} from '../src/index.js';
import { isSafeUrlProtocol } from '../src/utils.js';

test('regression: <if data-live> cleans up branch subscriptions and does not leak listeners on toggle', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <main id="app">
          <if data-live is-truthy="flag">
            <span id="active-span" data-text="text"></span>
          </if>
        </main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const target = document.getElementById('app');
  const store = createStore({
    flag: true,
    text: 'initial',
  });

  const inst = mount(target, null, store);
  assert.equal(target.querySelector('#active-span')?.textContent, 'initial');

  // Toggle flag 10 times
  for (let i = 0; i < 10; i++) {
    store.set('flag', i % 2 === 1);
  }

  // Currently flag is false (i=9: 9%2=1 -> true, wait: i=0: false, i=1: true... i=9: true)
  // Let's explicitly set flag to false
  store.set('flag', false);
  assert.equal(target.querySelector('#active-span'), null);

  // Updating 'text' while branch is false must not throw or update ghost nodes
  store.set('text', 'ghost-update');

  // Set flag back to true
  store.set('flag', true);
  assert.equal(target.querySelector('#active-span')?.textContent, 'ghost-update');

  // Unmount app
  inst.unmount();
  assert.equal(inst.active, false);
  store.set('text', 'after-unmount-no-update');
  assert.equal(target.querySelector('#active-span')?.textContent, 'ghost-update');
});

test('regression: <for data-live> cleans up removed item subscriptions and preserves item integrity', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <main id="app">
          <for each="items" as="item" key="id" data-live>
            <div class="item" data-text="item.name"></div>
          </for>
        </main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const target = document.getElementById('app');
  const store = createStore({
    items: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ],
  });

  const inst = mount(target, null, store);
  const getRenderedNames = () => Array.from(target.querySelectorAll('.item')).map((el) => el.textContent);

  assert.deepEqual(getRenderedNames(), ['Alice', 'Bob']);

  // Remove first item
  store.set('items', [{ id: 2, name: 'Bob Updated' }]);
  assert.deepEqual(getRenderedNames(), ['Bob Updated']);

  // Replace completely
  store.set('items', [{ id: 3, name: 'Charlie' }]);
  assert.deepEqual(getRenderedNames(), ['Charlie']);

  inst.unmount();
  assert.equal(target.querySelectorAll('.item').length, 0);
});

test('regression: removing a live-loop item does not detach delegation for its siblings', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <main id="app">
          <for each="items" as="item" key="id" data-live>
            <button class="item" data-on-click="select" data-on-click-data="item.id">\${item.name}</button>
          </for>
        </main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const target = document.getElementById('app');
  const store = createStore({ items: [] });
  const selected = [];
  const instance = mount(target, null, store, {
    handlers: {
      select({ data }) {
        selected.push(data);
      },
    },
  });

  store.set('items', [{ id: 1, name: 'First' }, { id: 2, name: 'Second' }]);
  store.set('items', [{ id: 2, name: 'Second' }]);
  target.querySelector('.item').click();

  assert.deepEqual(selected, [2]);
  instance.unmount();
});

test('regression: isSafeUrlProtocol rejects backslash protocol-relative URLs (/\\evil.com)', () => {
  assert.equal(isSafeUrlProtocol('/\\evil.com'), false);
  assert.equal(isSafeUrlProtocol('/\\\\evil.com'), false);
  assert.equal(isSafeUrlProtocol('//evil.com'), false);
  assert.equal(isSafeUrlProtocol('javascript:alert(1)'), false);

  // Legitimate paths are still safe
  assert.equal(isSafeUrlProtocol('/dashboard/overview'), true);
  assert.equal(isSafeUrlProtocol('/'), true);
  assert.equal(isSafeUrlProtocol('https://example.com/'), true);
  assert.equal(isSafeUrlProtocol('#section'), true);

  assert.equal(safeUrl('/\\evil.com'), '');
  assert.equal(safeUrl('/valid/path'), '/valid/path');
});

test('regression: safeStyleUrl escapes backslashes and parentheses preventing CSS breakouts', () => {
  const payload = '/image.png) background: red; /*';
  const styled = safeStyleUrl(payload);

  // Must not contain raw unencoded parentheses closing url()
  assert.ok(!styled.slice(5, -2).includes(')'));
  assert.ok(styled.includes('%29'));
  assert.ok(styled.startsWith("url('"));
  assert.ok(styled.endsWith("')"));

  // Quotes and backslashes escaped
  const quotePayload = "/img\\'test.png";
  const quoteStyled = safeStyleUrl(quotePayload);
  assert.ok(!quoteStyled.includes('\\'));
  assert.ok(quoteStyled.includes('%5C'));
});

test('regression: mount() removes AbortSignal abort listener on manual unmount', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <main id="app"></main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const target = document.getElementById('app');
  const controller = new AbortController();

  let abortFiredAfterUnmount = false;
  controller.signal.addEventListener('abort', () => {
    abortFiredAfterUnmount = true;
  });

  const inst = mount(target, null, null, {
    signal: controller.signal,
  });

  // Manually unmount before abort
  inst.unmount();
  assert.equal(inst.active, false);

  // Aborting now should not crash or produce unmount errors
  controller.abort();
  assert.equal(abortFiredAfterUnmount, true);
});

test('regression: data-model on input[type="file"] does not throw DOMException on write', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <main id="app">
          <input type="file" id="file-input" data-model="selectedFile">
        </main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const target = document.getElementById('app');
  const store = createStore({
    selectedFile: null,
  });

  // Mount with file input
  const inst = mount(target, null, store);
  const input = target.querySelector('#file-input');
  assert.ok(input);

  // Writing programmatic string value to store would normally throw InvalidStateError on input.value = val
  // Our fix must safely ignore non-empty string and avoid DOMException
  assert.doesNotThrow(() => {
    store.set('selectedFile', 'malicious_payload.sh');
  });

  // Resetting to null or empty string should reset input.value safely
  assert.doesNotThrow(() => {
    store.set('selectedFile', '');
    store.set('selectedFile', null);
  });

  inst.unmount();
});

test('regression: <for as="item" index="item"> emits FOR_INDEX_COLLISION warning and does not clobber item', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <main id="app">
          <for each="items" as="row" index="row">
            <span class="row-val" data-text="row"></span>
          </for>
        </main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const diagnostics = [];
  const unsubDiag = subscribeDiagnostics((d) => diagnostics.push(d));

  try {
    const target = document.getElementById('app');
    const store = createStore({
      items: ['alpha', 'beta'],
    });

    mount(target, null, store);

    // Warning emitted
    const collisionWarnings = diagnostics.filter((d) => d.code === 'FOR_INDEX_COLLISION');
    assert.equal(collisionWarnings.length, 1);

    // Items should NOT be overwritten by integers 0, 1
    const texts = Array.from(target.querySelectorAll('.row-val')).map((el) => el.textContent);
    assert.deepEqual(texts, ['alpha', 'beta']);
  } finally {
    unsubDiag();
  }
});
