import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  error,
  reportError,
  setDevMode,
  subscribeDiagnostics,
  warn,
} from '../src/index.js';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://localhost/',
  });
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.Element = dom.window.Element;
  return dom;
}

test('reportError and error alias dispatch structured diagnostics with dev message formatting', () => {
  const received = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => received.push(diagnostic));

  reportError('BINDING_MISSING_PATH');
  error('UNKNOWN_OPERATOR', { op: 'is-custom', validOps: ['is-eq'] });

  unsubscribe();

  assert.equal(received.length, 2);
  assert.equal(received[0].code, 'BINDING_MISSING_PATH');
  assert.match(received[0].message, /data-text attribute is empty/);

  assert.equal(received[1].code, 'UNKNOWN_OPERATOR');
  assert.match(received[1].message, /is-custom/);
});

test('overlay deduplicates repeated identical errors and shows count badge', () => {
  installDom();
  setDevMode(true);

  warn('DUPLICATE_TEST', 'same message detail');
  warn('DUPLICATE_TEST', 'same message detail');
  warn('DUPLICATE_TEST', 'same message detail');

  const container = document.getElementById('lime-csr-error-overlay-container');
  assert.ok(container, 'Container should exist');

  // Should only have 1 card div despite 3 calls
  const cards = container.querySelectorAll('[data-lime-error-code="DUPLICATE_TEST"]');
  assert.equal(cards.length, 1);

  // Badge should show x3
  const badge = cards[0].querySelector('.lime-error-count');
  assert.ok(badge, 'Badge should exist');
  assert.equal(badge.textContent, 'x3');
});

test('overlay container has scroll and height boundaries to prevent viewport overflow', () => {
  installDom();
  setDevMode(true);

  warn('OVERFLOW_TEST_1', 'Message 1');
  const container = document.getElementById('lime-csr-error-overlay-container');
  assert.ok(container);
  assert.match(container.style.cssText, /max-height:\s*85vh/);
  assert.match(container.style.cssText, /overflow-y:\s*auto/);
});

test('dist production bundle logs concise [lime-error] CODE without dev strings or overlay', async () => {
  installDom();
  const distProd = await import('../dist/index.min.js');
  distProd.setDevMode(true);

  const warnings = [];
  const oldWarn = console.warn;
  console.warn = (...args) => warnings.push(args);

  const diagnostics = [];
  const unsubscribe = distProd.subscribeDiagnostics((d) => diagnostics.push(d));

  try {
    distProd.reportError('TEST_PROD_ERROR', { extra: 123 });
  } finally {
    unsubscribe();
    console.warn = oldWarn;
    distProd.setDevMode(false);
  }

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'TEST_PROD_ERROR');

  // Prod console format: [lime-error] CODE
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], '[lime-error] TEST_PROD_ERROR');

  // Prod has 0 overlay in DOM
  assert.equal(document.getElementById('lime-csr-error-overlay-container'), null);
});

test('dist development bundle includes full dev description and overlay', async () => {
  installDom();
  const distDev = await import('../dist/index.dev.min.js');
  distDev.setDevMode(true);

  const warnings = [];
  const oldWarn = console.warn;
  console.warn = (...args) => warnings.push(args);

  const diagnostics = [];
  const unsubscribe = distDev.subscribeDiagnostics((d) => diagnostics.push(d));

  try {
    distDev.reportError('BINDING_MISSING_PATH');
  } finally {
    unsubscribe();
    console.warn = oldWarn;
    distDev.setDevMode(false);
  }

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'BINDING_MISSING_PATH');
  assert.match(diagnostics[0].message, /data-text attribute is empty/);

  // Dev console format: [lime-csr] CODE: message
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /^\[lime-csr\] BINDING_MISSING_PATH: data-text attribute is empty/);

  // Dev creates overlay in DOM
  assert.ok(document.getElementById('lime-csr-error-overlay-container'));
});
