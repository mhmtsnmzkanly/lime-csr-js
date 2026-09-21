import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  createEngine,
} from '../src/index.js';

function createDom(html) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'http://localhost/' });
}

test('Finding K: inactive mount handles expose stable shape with refs and active=false', () => {
  const dom = createDom('<div id="app"></div>');
  const engine = createEngine();

  // Invalid template creates inactive handle
  const inactiveInstance = engine.mount({
    target: '#non-existent-target',
    template: 'missing-template',
    document: dom.window.document,
  });

  assert.equal(inactiveInstance.active, false);
  assert.equal(typeof inactiveInstance.unmount, 'function');
  assert.equal(typeof inactiveInstance.cleanup, 'function');
  assert.ok(inactiveInstance.refs, 'inactive mount exposes refs object');
  assert.equal(Object.keys(inactiveInstance.refs).length, 0);
  assert.doesNotThrow(() => inactiveInstance.unmount());
  assert.doesNotThrow(() => inactiveInstance.cleanup());
});

test('Finding K: cleanup() transitions active to false and removes data-lime-mount', () => {
  const dom = createDom('<div id="app"><p>Content</p></div>');
  const target = dom.window.document.getElementById('app');
  const engine = createEngine();

  const instance = engine.mount({
    target,
    document: dom.window.document,
  });

  assert.equal(instance.active, true);
  assert.equal(target.hasAttribute('data-lime-mount'), true);

  // Calling cleanup()
  instance.cleanup();
  assert.equal(instance.active, false);
  assert.equal(target.hasAttribute('data-lime-mount'), false);

  // Subsequent unmount(target) can still run and clear DOM if owned
  instance.unmount();
  assert.equal(instance.active, false);
});
