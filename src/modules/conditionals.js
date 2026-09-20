/**
 * @module modules/conditionals
 * Standard unprivileged Conditionals module for Lime-CSR.
 *
 * Implements <if> and <template data-if> with <else> branches.
 *   - Evaluates condition against lexical scope (falling back to store).
 *   - Supported operators: is-gt, is-lt, is-gte, is-lte, is-eq, is-neq, is-truthy.
 *   - Error isolation: UNKNOWN_OPERATOR, MISSING_OPERATOR, ELSE_AFTER_CONTENT.
 *   - Reactive support: data-live re-evaluates and updates between comment anchors.
 *   - Phase: Transform (structural compilation).
 */

import { tag } from '../core/triggers.js';
import { defineModule } from '../core/registry.js';
import { createCleanupStack } from '../core/context.js';
import { getByPath } from '../store.js';
import { resolveStatic } from '../template.js';

export const OPERATORS = {
  'is-gt':     (left, right) => Number(left)  >   Number(right),
  'is-lt':     (left, right) => Number(left)  <   Number(right),
  'is-gte':    (left, right) => Number(left)  >=  Number(right),
  'is-lte':    (left, right) => Number(left)  <=  Number(right),
  'is-eq':     (left, right) => String(left)  === String(right),
  'is-neq':    (left, right) => String(left)  !== String(right),
  'is-truthy': (left)        => Boolean(left),
};

const OPERATOR_NAMES = Object.keys(OPERATORS);
const RESERVED_IF_ATTRS = new Set([
  ...OPERATOR_NAMES,
  'than', 'to', 'data-live', 'data-after', 'data-before', 'el', 'data-if',
]);

let liveIfCounter = 0;
function nextLiveIfRef() {
  return `lif${++liveIfCounter}`;
}

/**
 * Evaluates an element's condition against scope or store.
 *
 * @param {Element} el
 * @param {Object} scope
 * @param {*} store
 * @param {Object} ctx
 * @returns {boolean}
 */
export function evaluateCondition(el, scope, store, ctx) {
  const opName = OPERATOR_NAMES.find((op) => el.hasAttribute(op));

  if (!opName) {
    const unknownOp = Array.from(el.attributes).find((a) => a.name.startsWith('is-'));
    if (unknownOp) {
      ctx.error('UNKNOWN_OPERATOR', { op: unknownOp.name, validOps: OPERATOR_NAMES }, el);
    } else {
      ctx.error('MISSING_OPERATOR', el);
    }
    return false;
  }

  const path = el.getAttribute(opName);
  let leftValue = getByPath(scope, path);
  if (leftValue === undefined && store && typeof store.get === 'function') {
    leftValue = store.get(path);
  }

  if (opName === 'is-truthy') {
    return Boolean(leftValue);
  }

  const rightRaw = el.getAttribute('than') ?? el.getAttribute('to') ?? '';
  return Boolean(OPERATORS[opName](leftValue, rightRaw));
}

/**
 * Extracts the then and else branch nodes from an <if> or <template data-if>.
 *
 * @param {Element} ifEl
 * @param {Object} ctx
 * @returns {{ thenNodes: Node[], elseNodes: Node[] }}
 */
export function extractBranches(ifEl, ctx) {
  const childSource = ifEl.tagName === 'TEMPLATE' ? ifEl.content : ifEl;
  const directChildren = Array.from(childSource.childNodes);

  const elseEl = directChildren.find(
    (ch) =>
      ch.nodeType === 1 &&
      (ch.tagName === 'ELSE' || (ch.tagName === 'TEMPLATE' && ch.hasAttribute('data-else'))),
  ) ?? null;

  if (elseEl) {
    const idxElse = directChildren.indexOf(elseEl);
    const afterElse = directChildren
      .slice(idxElse + 1)
      .filter((ch) => ch.nodeType === 1);
    if (afterElse.length > 0) {
      ctx.error('ELSE_AFTER_CONTENT', ifEl);
    }
  }

  const thenNodes = directChildren.filter((ch) => ch !== elseEl);
  const elseContent = elseEl ? (elseEl.tagName === 'TEMPLATE' ? elseEl.content : elseEl) : null;
  const elseNodes = elseContent ? Array.from(elseContent.childNodes) : [];

  return { thenNodes, elseNodes };
}

/**
 * Removes all sibling nodes between startAnchor and endAnchor.
 *
 * @param {Comment} startAnchor
 * @param {Comment} endAnchor
 */
function clearBetweenAnchors(startAnchor, endAnchor) {
  while (startAnchor.nextSibling && startAnchor.nextSibling !== endAnchor) {
    startAnchor.nextSibling.remove();
  }
}

/**
 * Implementation of the conditional structural transformation.
 *
 * @param {Element} el
 * @param {*} data
 * @param {Object} ctx
 */
function transformConditional(el, data, ctx) {
  const isLive = el.hasAttribute('data-live');
  const { thenNodes, elseNodes } = extractBranches(el, ctx);

  if (!isLive) {
    // ── STATIC CONDITIONAL ──────────────────────────────────────────────────
    const condition = evaluateCondition(el, ctx.scope, ctx.store, ctx);
    const winningNodes = condition ? thenNodes : elseNodes;

    const frag = el.ownerDocument.createDocumentFragment();
    for (const node of winningNodes) {
      frag.appendChild(node.cloneNode(true));
    }

    // Resolve static expressions and run transform on inner structural nodes
    resolveStatic(frag, ctx.scope, ctx.store);
    ctx.deferTransform(frag, ctx.scope);

    el.replaceWith(frag);
    return;
  }

  // ── REACTIVE (DATA-LIVE) CONDITIONAL ──────────────────────────────────────
  const ref = nextLiveIfRef();
  const doc = el.ownerDocument;
  const startAnchor = doc.createComment(`live-if:${ref}`);
  const endAnchor = doc.createComment(`/live-if:${ref}`);

  const elTag = el.getAttribute('el') || null;
  const container = elTag ? doc.createElement(elTag) : null;

  if (container) {
    for (const attr of Array.from(el.attributes)) {
      if (!RESERVED_IF_ATTRS.has(attr.name)) {
        container.setAttribute(attr.name, attr.value);
      }
    }
  }

  // Find store path to track: explicit data-live value or the condition operator attribute
  const explicitLive = el.getAttribute('data-live');
  const opName = OPERATOR_NAMES.find((op) => el.hasAttribute(op));
  const trackPath = (explicitLive && explicitLive.trim()) || (opName ? el.getAttribute(opName) : null);

  let currentCondition = null;
  let currentBranchCleanup = () => {};

  function renderBranch(condition) {
    currentBranchCleanup();

    const branchStack = createCleanupStack();
    currentBranchCleanup = () => branchStack.run();

    const winningTemplateNodes = condition ? thenNodes : elseNodes;
    const branchFrag = doc.createDocumentFragment();
    for (const node of winningTemplateNodes) {
      branchFrag.appendChild(node.cloneNode(true));
    }

    resolveStatic(branchFrag, ctx.scope, ctx.store);
    ctx.transform(branchFrag, ctx.scope);
    ctx.link(branchFrag, ctx.scope, branchStack);

    if (container) {
      container.textContent = '';
      container.appendChild(branchFrag);
    } else {
      clearBetweenAnchors(startAnchor, endAnchor);
      endAnchor.parentNode?.insertBefore(branchFrag, endAnchor);
    }
  }

  // Initial render during Transform
  const initialCondition = evaluateCondition(el, ctx.scope, ctx.store, ctx);
  currentCondition = initialCondition;

  if (container) {
    el.replaceWith(container);
    renderBranch(initialCondition);
  } else {
    const initFrag = doc.createDocumentFragment();
    initFrag.appendChild(startAnchor);
    initFrag.appendChild(endAnchor);
    el.replaceWith(initFrag);
    renderBranch(initialCondition);
  }

  // Reactive subscription
  if (trackPath && ctx.store && typeof ctx.store.subscribe === 'function') {
    const unsubscribe = ctx.store.subscribe(trackPath, () => {
      const nextCondition = evaluateCondition(el, ctx.scope, ctx.store, ctx);
      if (nextCondition === currentCondition) return;
      currentCondition = nextCondition;
      renderBranch(nextCondition);
    });

    ctx.onCleanup(() => {
      unsubscribe();
      currentBranchCleanup();
    });
  } else {
    ctx.onCleanup(() => {
      currentBranchCleanup();
    });
  }
}

/**
 * Creates the standard Conditionals module definition.
 *
 * @param {Object} [options={}]
 * @returns {Readonly<Object>} ModuleDefinition
 */
export function conditionals(_options = {}) {
  return defineModule({
    name: 'conditionals',
    triggers: [
      tag('IF', {
        phase: 'transform',
        templateDirective: 'data-if',
        optional: [
          ...OPERATOR_NAMES,
          'than', 'to', 'data-live', 'data-after', 'data-before', 'el',
        ],
        setup: transformConditional,
      }),
    ],
  });
}

export default conditionals;
