import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  attr,
  attrs,
  tag,
  pattern,
  defineModule,
} from '../src/core/index.js';
import { createRouter } from '../src/core/router.js';
import { setDevMode, subscribeDiagnostics } from '../src/errors.js';

function createElement(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  return dom.window.document.body.firstElementChild;
}

test.beforeEach(() => {
  setDevMode(false);
});

// ── 1. EXACT ATTRIBUTE ROUTE ─────────────────────────────────────────────────

test('router: exact attr indexed lookup matches target and ignores unrelated attributes', () => {
  const tooltipMod = defineModule({
    name: 'tooltip-mod',
    triggers: [attr('data-tooltip', () => {})],
  });

  const router = createRouter([tooltipMod]);
  const elMatch = createElement('<div id="t1" data-tooltip="help"></div>');
  const elNoMatch = createElement('<div id="t2" class="container" role="main"></div>');

  const matches1 = router.matchElement(elMatch, 'link');
  assert.equal(matches1.length, 1);
  assert.equal(matches1[0].record.moduleName, 'tooltip-mod');
  assert.equal(matches1[0].matchedAttribute, 'data-tooltip');

  const matches2 = router.matchElement(elNoMatch, 'link');
  assert.equal(matches2.length, 0);
});

// ── 2. EXACT TAG ROUTE ───────────────────────────────────────────────────────

test('router: exact tag route normalizes case and indexes lookup', () => {
  const panelMod = defineModule({
    name: 'panel-mod',
    triggers: [tag('custom-panel', () => {})],
  });

  const router = createRouter([panelMod]);
  const elTag = createElement('<custom-panel class="card"></custom-panel>');
  const elOther = createElement('<div class="card"></div>');

  // Tag triggers default to transform phase
  const matches1 = router.matchElement(elTag, 'transform');
  assert.equal(matches1.length, 1);
  assert.equal(matches1[0].record.moduleName, 'panel-mod');
  assert.equal(matches1[0].record.trigger.name, 'CUSTOM-PANEL');
  assert.equal(matches1[0].anchorIndex, -1);

  const matches2 = router.matchElement(elOther, 'transform');
  assert.equal(matches2.length, 0);
});

// ── 3. PATTERN ATTRIBUTE ROUTE ───────────────────────────────────────────────

test('router: pattern routes support prefix and regex matching, ignoring non-matches', () => {
  const eventMod = defineModule({
    name: 'event-mod',
    triggers: [
      pattern('data-on-', () => {}),
      pattern(/^aria-/, () => {}),
    ],
  });

  const router = createRouter([eventMod]);
  const el = createElement('<button data-on-click="save" aria-label="Save Button" id="btn"></button>');
  const matches = router.matchElement(el, 'link');

  assert.equal(matches.length, 2);
  assert.equal(matches[0].matchedAttribute, 'data-on-click');
  assert.equal(matches[1].matchedAttribute, 'aria-label');

  const elNoMatch = createElement('<button class="btn" title="test"></button>');
  assert.equal(router.matchElement(elNoMatch, 'link').length, 0);
});

// ── 4. MULTI-ATTRIBUTE ROUTE ────────────────────────────────────────────────

test('router: multi-attribute routes index by anchor and require all required attributes', () => {
  const condMod = defineModule({
    name: 'cond-mod',
    triggers: [
      attrs({
        required: ['cond-l', 'cond-op'],
        optional: ['cond-r'],
      }, () => {}),
    ],
  });

  const router = createRouter([condMod]);

  // Complete match with optional attribute
  const elFull = createElement('<div cond-l="x" cond-op="gt" cond-r="0"></div>');
  const matchesFull = router.matchElement(elFull, 'link');
  assert.equal(matchesFull.length, 1);
  assert.equal(matchesFull[0].record.moduleName, 'cond-mod');
  assert.equal(matchesFull[0].matchedAttribute, 'cond-l');

  // Match without optional attribute
  const elNoOpt = createElement('<div cond-l="x" cond-op="gt"></div>');
  const matchesNoOpt = router.matchElement(elNoOpt, 'link');
  assert.equal(matchesNoOpt.length, 1);

  // Missing required attribute
  const elMissing = createElement('<div cond-l="x" cond-r="0"></div>');
  const matchesMissing = router.matchElement(elMissing, 'link');
  assert.equal(matchesMissing.length, 0);

  // Empty string required attribute is considered present (existence check)
  const elEmpty = createElement('<div cond-l="" cond-op=""></div>');
  const matchesEmpty = router.matchElement(elEmpty, 'link');
  assert.equal(matchesEmpty.length, 1);
});

test('router: multi-attribute trigger produces exactly ONE match per element', () => {
  const condMod = defineModule({
    name: 'cond-mod',
    triggers: [
      attrs({
        required: ['cond-l', 'cond-op'],
        optional: ['cond-r'],
      }, () => {}),
    ],
  });

  const router = createRouter([condMod]);
  const el = createElement('<div cond-l="a" cond-op="eq" cond-r="b"></div>');
  const matches = router.matchElement(el, 'link');

  assert.equal(matches.length, 1, 'Multi-attribute trigger must only match once on the same element');
});

// ── 5. PRECEDENCE (CONFLICT RESOLUTION) ──────────────────────────────────────

test('router precedence: earlier module wins and shadows later module with dev diagnostic', () => {
  const diagnostics = [];
  setDevMode('dev');
  const unsub = subscribeDiagnostics((d) => diagnostics.push(d));

  const modFirst = defineModule({
    name: 'mod-first',
    triggers: [attr('data-highlight', () => {})],
  });

  const modSecond = defineModule({
    name: 'mod-second',
    triggers: [attr('data-highlight', () => {})],
  });

  const router = createRouter([modFirst, modSecond], { devMode: true });
  unsub();

  const el = createElement('<div data-highlight="yellow"></div>');
  const matches = router.matchElement(el, 'link');

  assert.equal(matches.length, 1);
  assert.equal(matches[0].record.moduleName, 'mod-first', 'Higher priority module must win');

  // Verify compile-time diagnostic was emitted
  const overrideDiag = diagnostics.find((d) => d.code === 'MODULE_TRIGGER_OVERRIDDEN');
  assert.ok(overrideDiag);
  assert.equal(overrideDiag.context.overriddenBy, 'mod-first');
  assert.equal(overrideDiag.context.module, 'mod-second');

  // Calling matchElement again produces zero additional compile diagnostics
  diagnostics.length = 0;
  const unsub2 = subscribeDiagnostics((d) => diagnostics.push(d));
  router.matchElement(el, 'link');
  unsub2();
  assert.equal(diagnostics.length, 0, 'No runtime precedence recalculation or diagnostics');
});

// ── 6. EXECUTION ORDERING METADATA ───────────────────────────────────────────

test('router execution order: DOM attribute order determines candidate dispatch plan', () => {
  const modA = defineModule({
    name: 'mod-a',
    triggers: [attr('a', () => {})],
  });
  const modB = defineModule({
    name: 'mod-b',
    triggers: [attr('b', () => {})],
  });
  const modC = defineModule({
    name: 'mod-c',
    triggers: [attr('c', () => {})],
  });

  // Modules registered in order C, A, B
  const router = createRouter([modC, modA, modB]);

  // DOM attribute order is b="1" a="1" c="1"
  const el = createElement('<div b="1" a="1" c="1"></div>');
  const matches = router.matchElement(el, 'link');

  assert.equal(matches.length, 3);
  assert.equal(matches[0].matchedAttribute, 'b');
  assert.equal(matches[0].record.moduleName, 'mod-b');
  assert.equal(matches[0].anchorIndex, 0);

  assert.equal(matches[1].matchedAttribute, 'a');
  assert.equal(matches[1].record.moduleName, 'mod-a');
  assert.equal(matches[1].anchorIndex, 1);

  assert.equal(matches[2].matchedAttribute, 'c');
  assert.equal(matches[2].record.moduleName, 'mod-c');
  assert.equal(matches[2].anchorIndex, 2);
});

// ── 7. MIXED TRIGGER TYPES ───────────────────────────────────────────────────

test('router: mixed trigger types on same element produce deterministic dispatch plan', () => {
  const mixedMod = defineModule({
    name: 'mixed-mod',
    triggers: [
      tag('CUSTOM-WIDGET', { phase: 'link', setup: () => {} }),
      attr('data-model', { phase: 'link', setup: () => {} }),
      pattern('data-on-', { phase: 'link', setup: () => {} }),
      attrs({ required: ['cond-l', 'cond-op'] }, { phase: 'link', setup: () => {} }),
    ],
  });

  const router = createRouter([mixedMod]);
  const el = createElement(`
    <custom-widget
      data-on-click="save"
      cond-l="status"
      data-model="name"
      cond-op="eq">
    </custom-widget>
  `);

  const matches = router.matchElement(el, 'link');

  // Total matches: tag (anchorIndex -1) + 3 attributes (data-on-click, cond-l multi-attr, data-model)
  assert.equal(matches.length, 4);

  // 1. Tag trigger always anchored at index -1
  assert.equal(matches[0].record.trigger.type, 'tag');
  assert.equal(matches[0].anchorIndex, -1);

  // 2. data-on-click
  assert.equal(matches[1].record.trigger.type, 'pattern');
  assert.equal(matches[1].matchedAttribute, 'data-on-click');

  // 3. cond-l (anchor of multi-attribute group)
  assert.equal(matches[2].record.trigger.type, 'attrs');
  assert.equal(matches[2].matchedAttribute, 'cond-l');

  // 4. data-model
  assert.equal(matches[3].record.trigger.type, 'attr');
  assert.equal(matches[3].matchedAttribute, 'data-model');
});

// ── 8. INDEPENDENCE & IMMUTABILITY ───────────────────────────────────────────

test('router independence: multiple router instances maintain complete state isolation', () => {
  const mod1 = defineModule({
    name: 'mod-1',
    triggers: [attr('data-test', () => {})],
  });

  const mod2 = defineModule({
    name: 'mod-2',
    triggers: [attr('data-other', () => {})],
  });

  const router1 = createRouter([mod1]);
  const router2 = createRouter([mod2]);

  const el = createElement('<div data-test data-other></div>');

  const matches1 = router1.matchElement(el, 'link');
  assert.equal(matches1.length, 1);
  assert.equal(matches1[0].record.moduleName, 'mod-1');

  const matches2 = router2.matchElement(el, 'link');
  assert.equal(matches2.length, 1);
  assert.equal(matches2[0].record.moduleName, 'mod-2');
});

// ── 9. NO DOM MUTATION GUARANTEE ─────────────────────────────────────────────

test('router: matching produces zero DOM mutations on inspected elements', () => {
  const mod = defineModule({
    name: 'test-mod',
    triggers: [
      tag('SECTION', { phase: 'link', setup: () => {} }),
      attr('data-attr', () => {}),
      pattern('on-', () => {}),
      attrs({ required: ['m1', 'm2'] }, () => {}),
    ],
  });

  const router = createRouter([mod]);
  const html = '<section data-attr="val" on-click="run" m1="1" m2="2"><span>content</span></section>';
  const el = createElement(html);

  const initialHtml = el.outerHTML;
  const initialChildCount = el.childNodes.length;
  const initialAttrCount = el.attributes.length;

  router.matchElement(el, 'link');
  router.matchElement(el, 'transform');

  assert.equal(el.outerHTML, initialHtml, 'outerHTML must not change during router inspection');
  assert.equal(el.childNodes.length, initialChildCount, 'Child nodes must not be mutated');
  assert.equal(el.attributes.length, initialAttrCount, 'Attributes must not be mutated');
});
