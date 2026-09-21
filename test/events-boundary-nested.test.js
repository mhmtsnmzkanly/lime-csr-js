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

test('Finding I: nested mount boundary element preserves outer event handler and stops inner leaks', () => {
  const dom = createDom(`
    <div id="outer">
      <div id="nested-boundary" data-on-click="outerBoundaryClick">
        <button id="inner-btn" data-on-click="innerButtonClick">Inner Button</button>
        <button id="stopping-btn" data-on-click="stoppingClick">Stopping Button</button>
      </div>
    </div>
  `);

  const eventsLog = [];
  const engine = createEngine({ modules: [events()] });

  const outerEl = dom.window.document.getElementById('outer');
  const boundaryEl = dom.window.document.getElementById('nested-boundary');
  const innerBtn = dom.window.document.getElementById('inner-btn');
  const stoppingBtn = dom.window.document.getElementById('stopping-btn');

  // Mount outer
  const outerMount = engine.mount({
    target: outerEl,
    document: dom.window.document,
    handlers: {
      outerBoundaryClick({ element }) {
        eventsLog.push(`outerBoundary:${element.id}`);
      },
      innerButtonClick() {
        // If inner button leaked to outer, this would run
        eventsLog.push('LEAKED_TO_OUTER');
      },
    },
  });

  // Mount inner on the boundary element
  const innerMount = engine.mount({
    target: boundaryEl,
    document: dom.window.document,
    handlers: {
      innerButtonClick({ element }) {
        eventsLog.push(`innerButton:${element.id}`);
      },
      stoppingClick({ event, element }) {
        eventsLog.push(`stoppingButton:${element.id}`);
        event.stopPropagation();
      },
    },
  });

  // 1. Click directly on the boundary element: outer handler fires
  boundaryEl.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(eventsLog, ['outerBoundary:nested-boundary']);
  eventsLog.length = 0;

  // 2. Click on inner-btn: inner handler fires, bubbled event hits boundary and fires outer boundary handler,
  // but inner handler does NOT leak to outer mount's handlers.
  innerBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(eventsLog, [
    'innerButton:inner-btn',
    'outerBoundary:nested-boundary',
  ]);
  assert.ok(!eventsLog.includes('LEAKED_TO_OUTER'), 'Nested descendant does NOT invoke outer mount handler');
  eventsLog.length = 0;

  // 3. stopPropagation on inner descendant prevents outer boundary handler from firing
  stoppingBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(eventsLog, ['stoppingButton:stopping-btn']);

  innerMount.unmount();
  outerMount.unmount();
});
