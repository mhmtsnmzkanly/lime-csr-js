import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  isDevMode,
  setDevMode,
  subscribeDiagnostics,
  warn,
} from '../src/index.js';
import { errors } from '../src/errors.js';

let previousDevMode;

function installDom() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://localhost/',
  });
  globalThis.document = dom.window.document;
  return dom;
}

test.beforeEach(() => {
  previousDevMode = isDevMode();
  setDevMode(false);
});

test.afterEach(() => {
  setDevMode(previousDevMode);
});

test('subscriber receives the exact code, message, and context identity', () => {
  const received = [];
  const context = { source: 'test' };
  const unsubscribe = subscribeDiagnostics((diagnostic) => received.push(diagnostic));
  warn('EXACT_CODE', 'Exact actionable message.', context);
  unsubscribe();
  assert.equal(received.length, 1);
  assert.equal(received[0].code, 'EXACT_CODE');
  assert.equal(received[0].message, 'Exact actionable message.');
  assert.equal(received[0].context, context);
  assert.equal(Object.isFrozen(received[0]), true);
});

test('production diagnostics reach subscribers without console warning or overlay', () => {
  installDom();
  setDevMode(false);
  const received = [];
  const warnings = [];
  const oldWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  const unsubscribe = subscribeDiagnostics((diagnostic) => received.push(diagnostic));
  try {
    warn('PRODUCTION_CODE', 'production detail');
  } finally {
    unsubscribe();
    console.warn = oldWarn;
  }
  assert.equal(received[0].code, 'PRODUCTION_CODE');
  assert.deepEqual(warnings, []);
  assert.equal(document.getElementById('lime-csr-error-overlay-container'), null);
});

test('development mode preserves console warning and visual overlay behavior', () => {
  installDom();
  setDevMode(true);
  const warnings = [];
  const oldWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    warn('DEVELOPMENT_CODE', 'development detail');
  } finally {
    console.warn = oldWarn;
  }
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], '[lime-csr] DEVELOPMENT_CODE: development detail');
  assert.match(document.getElementById('lime-csr-error-overlay-container').textContent, /DEVELOPMENT_CODE/);
});

test('multiple subscribers each receive the same stable diagnostic object', () => {
  const first = [];
  const second = [];
  const unsubscribeFirst = subscribeDiagnostics((diagnostic) => first.push(diagnostic));
  const unsubscribeSecond = subscribeDiagnostics((diagnostic) => second.push(diagnostic));
  warn('MULTI', 'sent to everyone');
  unsubscribeFirst();
  unsubscribeSecond();
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0], second[0]);
});

test('unsubscribe is idempotent and prevents future delivery', () => {
  let calls = 0;
  const unsubscribe = subscribeDiagnostics(() => { calls += 1; });
  unsubscribe();
  unsubscribe();
  warn('AFTER_UNSUBSCRIBE', 'not delivered');
  assert.equal(calls, 0);
});

test('listener may unsubscribe itself during snapshot notification', () => {
  let calls = 0;
  let unsubscribe;
  unsubscribe = subscribeDiagnostics(() => {
    calls += 1;
    unsubscribe();
  });
  warn('FIRST', 'delivered');
  warn('SECOND', 'not delivered');
  assert.equal(calls, 1);
});

test('throwing listener neither escapes warn nor prevents later listeners', () => {
  const later = [];
  const unsubscribeThrowing = subscribeDiagnostics(() => { throw new Error('listener failure'); });
  const unsubscribeLater = subscribeDiagnostics((diagnostic) => later.push(diagnostic));
  assert.doesNotThrow(() => warn('ISOLATED', 'runtime continues'));
  unsubscribeThrowing();
  unsubscribeLater();
  assert.deepEqual(later.map(({ code }) => code), ['ISOLATED']);
});

test('invalid diagnostic listener values throw clear TypeError errors', () => {
  for (const value of [undefined, null, {}, 'listener', 42]) {
    assert.throws(
      () => subscribeDiagnostics(value),
      (error) => error instanceof TypeError && /requires a function listener/.test(error.message),
    );
  }
});

test('existing direct warn signature remains compatible', () => {
  const received = [];
  const context = document;
  const unsubscribe = subscribeDiagnostics((diagnostic) => received.push(diagnostic));
  const result = warn('DIRECT_WARN', 'direct message', context);
  unsubscribe();
  assert.equal(result, undefined);
  assert.deepEqual(received[0], { code: 'DIRECT_WARN', message: 'direct message', context });
});

test('mountTemplateNotFound wrapper reaches subscribers with its existing diagnostic', () => {
  const context = { target: 'app' };
  const received = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => received.push(diagnostic));
  errors.mountTemplateNotFound('missing', ['available'], context);
  unsubscribe();
  assert.equal(received.length, 1);
  assert.equal(received[0].code, 'MOUNT_TEMPLATE_NOT_FOUND');
  assert.equal(
    received[0].message,
    'mount(): template "missing" not found. Registered templates: available. Is <template id="tpl-missing"> defined?',
  );
  assert.equal(received[0].context, context);
});
