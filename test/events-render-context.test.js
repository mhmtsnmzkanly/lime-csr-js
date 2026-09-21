import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  createEngine,
  events,
} from '../src/index.js';

function createDom(html) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'http://localhost/' });
}

test('Finding J: engine.render() into mounted target resolves handlers from current owning context', () => {
  const dom = createDom(`
    <div id="target">
      <button id="h1-btn" data-on-click="onClick">H1 Button</button>
    </div>
  `);

  const engine = createEngine({ modules: [events()] });
  const target = dom.window.document.getElementById('target');
  const h1Btn = dom.window.document.getElementById('h1-btn');

  const invocations = [];

  // Mount with H1 handlers
  const mountInstance = engine.mount({
    target,
    document: dom.window.document,
    handlers: {
      onClick({ element }) {
        invocations.push(`H1:${element.id}`);
      },
    },
  });

  // Render additional content into target with H2 handlers
  const h2Btn = dom.window.document.createElement('button');
  h2Btn.id = 'h2-btn';
  h2Btn.setAttribute('data-on-click', 'onClick');
  target.appendChild(h2Btn);

  const renderResult = engine.render(h2Btn, {
    target,
    document: dom.window.document,
    handlers: {
      onClick({ element }) {
        invocations.push(`H2:${element.id}`);
      },
    },
  });

  // 1. H1 element calls H1
  h1Btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(invocations, ['H1:h1-btn']);
  invocations.length = 0;

  // 2. H2 element calls H2
  h2Btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(invocations, ['H2:h2-btn']);
  invocations.length = 0;

  // 3. No duplicate event firing
  h1Btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0], 'H1:h1-btn');
  invocations.length = 0;

  // 4. Cleanup of H2 does not break H1
  renderResult.cleanup();
  h1Btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(invocations, ['H1:h1-btn']);
  invocations.length = 0;

  // 5. Cleanup of H1 unmounts cleanly
  mountInstance.unmount();
});
