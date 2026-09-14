/**
 * @module modules/loops
 * Standard unprivileged Loops module for Lime-CSR.
 *
 * Implements <for each="..." as="..." [index="..."] [key="..."]> and <template data-for>:
 *   - Prototypal Item Scope: Each iteration receives a scope inheriting from parent scope.
 *   - Static Expansion: In Transform phase, clones template nodes for each array element.
 *   - Reactive Support: data-live re-evaluates on store changes and performs keyed diffing.
 *   - Diff strategies: simple, lcs, replace.
 *   - Diagnostics: FOR_MISSING_ATTR, FOR_NOT_ARRAY, FOR_MISSING_KEY, FOR_DUPLICATE_KEY.
 */

import { tag, attr } from '../core/triggers.js';
import { defineModule } from '../core/registry.js';
import { createCleanupStack } from '../core/context.js';
import { createScope, setElementScope } from '../core/scope.js';
import { getByPath } from '../store.js';
import { resolveStatic } from '../template.js';
import { longestIncreasingSubsequenceIndices, shallowEqual } from '../shared.js';

let liveForCounter = 0;
function nextLiveForRef() {
  return `lf${++liveForCounter}`;
}

const RESERVED_FOR_ATTRS = new Set([
  'each', 'as', 'index', 'key', 'data-live', 'data-diff', 'data-after', 'data-before', 'el', 'data-for',
]);

/**
 * Transforms a loop element statically or prepares reactive anchors.
 *
 * @param {Element} el
 * @param {*} data
 * @param {Object} ctx
 */
function transformLoop(el, data, ctx) {
  const each = el.getAttribute('each');
  const as = el.getAttribute('as');
  const indexAttr = el.getAttribute('index');
  const isLive = el.hasAttribute('data-live');

  if (!each || !as) {
    ctx.error('FOR_MISSING_ATTR', el);
    el.remove();
    return;
  }

  if (indexAttr && indexAttr === as) {
    ctx.warn('FOR_INDEX_COLLISION', { as, index: indexAttr }, el);
  }

  const childSource = el.tagName === 'TEMPLATE' ? el.content : el;
  const templateNodes = Array.from(childSource.childNodes).map((n) => n.cloneNode(true));
  const doc = el.ownerDocument;

  if (!isLive) {
    // ── STATIC LOOP ─────────────────────────────────────────────────────────
    const list = getByPath(ctx.scope, each)
      ?? (ctx.store ? ctx.store.get(each) : undefined);

    if (!Array.isArray(list)) {
      ctx.error('FOR_NOT_ARRAY', { path: each, type: list === null ? 'null' : typeof list }, el);
      el.remove();
      return;
    }

    if (list.length === 0) {
      el.remove();
      return;
    }

    const allNodes = [];

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const itemScope = createScope(ctx.scope, {
        [as]: item,
        ...(indexAttr && indexAttr !== as ? { [indexAttr]: i } : {}),
      });

      const frag = doc.createDocumentFragment();
      for (const node of templateNodes) {
        frag.appendChild(node.cloneNode(true));
      }

      setElementScope(frag, itemScope);
      resolveStatic(frag, itemScope, ctx.store);
      ctx.deferTransform(frag, itemScope);

      allNodes.push(...Array.from(frag.childNodes));
    }

    el.replaceWith(...allNodes);
    return;
  }

  // ── REACTIVE (DATA-LIVE) LOOP ─────────────────────────────────────────────
  const keyAttr = el.getAttribute('key');
  if (!keyAttr) {
    ctx.error('FOR_MISSING_KEY', { templateName: el.id || '?' }, el);
    el.remove();
    return;
  }

  const ref = nextLiveForRef();
  const startAnchor = doc.createComment(`live-for:${ref}`);
  const endAnchor = doc.createComment(`/live-for:${ref}`);

  const elTag = el.getAttribute('el') || null;
  const container = elTag ? doc.createElement(elTag) : null;

  if (container) {
    for (const attr of Array.from(el.attributes)) {
      if (!RESERVED_FOR_ATTRS.has(attr.name)) {
        container.setAttribute(attr.name, attr.value);
      }
    }
  }

  const requestedDiffStrategy = el.getAttribute('data-diff') || 'simple';
  const diffStrategy = ['simple', 'lcs', 'replace'].includes(requestedDiffStrategy)
    ? requestedDiffStrategy
    : 'simple';
  if (diffStrategy !== requestedDiffStrategy) {
    ctx.error('UNKNOWN_DIFF_STRATEGY', {
      value: requestedDiffStrategy,
      templateName: el.id || '?',
    }, el);
  }

  // State for keyed blocks: key -> { nodes, cleanup, item, idx }
  const keyedBlocks = new Map();
  let orderedKeys = [];

  function appendNode(node) {
    if (container) {
      container.appendChild(node);
    } else {
      endAnchor.parentNode?.insertBefore(node, endAnchor);
    }
  }

  function renderItemNodes(item, idx) {
    const itemScope = createScope(ctx.scope, {
      [as]: item,
      ...(indexAttr && indexAttr !== as ? { [indexAttr]: idx } : {}),
    });

    const frag = doc.createDocumentFragment();
    for (const node of templateNodes) {
      frag.appendChild(node.cloneNode(true));
    }

    resolveStatic(frag, itemScope, ctx.store);
    setElementScope(frag, itemScope);
    ctx.transform(frag, itemScope);

    const itemCleanupStack = createCleanupStack();
    ctx.link(frag, itemScope, itemCleanupStack);

    const nodes = Array.from(frag.childNodes);
    for (let i = 0; i < nodes.length; i++) {
      setElementScope(nodes[i], itemScope);
    }
    return { frag, nodes, cleanupStack: itemCleanupStack };
  }

  function reconcile(newList) {
    if (!Array.isArray(newList)) {
      newList = [];
    }

    // Validate keys and check duplicates
    const seenKeys = new Set();
    const newKeyOrder = [];
    const newItemMap = new Map();

    for (let i = 0; i < newList.length; i++) {
      const item = newList[i];
      let keyVal;
      if (item && typeof item === 'object') {
        if (as && keyAttr.startsWith(`${as}.`)) {
          keyVal = getByPath(item, keyAttr.slice(as.length + 1));
        } else {
          keyVal = getByPath(item, keyAttr);
        }
        if (keyVal === undefined) {
          keyVal = item[keyAttr];
        }
      }

      if (keyVal !== undefined) {
        if (seenKeys.has(keyVal)) {
          ctx.error('FOR_DUPLICATE_KEY', { keyVal, templateName: el.id || '?' }, el);
        } else {
          seenKeys.add(keyVal);
          newKeyOrder.push(keyVal);
          newItemMap.set(keyVal, { item, idx: i });
        }
      }
    }

    // 1. Delete removed keys
    for (const [oldKey, block] of keyedBlocks.entries()) {
      if (!seenKeys.has(oldKey)) {
        block.cleanupStack?.run();
        for (const node of block.nodes) {
          node.remove();
        }
        keyedBlocks.delete(oldKey);
      }
    }

    if (diffStrategy === 'replace') {
      // Replace strategy: re-render all from scratch
      for (const block of keyedBlocks.values()) {
        block.cleanupStack?.run();
        for (const node of block.nodes) node.remove();
      }
      keyedBlocks.clear();

      for (const keyVal of newKeyOrder) {
        const { item, idx } = newItemMap.get(keyVal);
        const { frag, nodes, cleanupStack } = renderItemNodes(item, idx);
        appendNode(frag);
        keyedBlocks.set(keyVal, { nodes, item, idx, cleanupStack });
      }
      orderedKeys = newKeyOrder;
      return;
    }

    // 2. Reconcile simple / lcs
    if (diffStrategy === 'lcs') {
      // LCS Diff Strategy
      const oldIndices = [];
      const survivingNewKeys = [];
      const oldKeyIndices = new Map();

      for (let i = 0; i < orderedKeys.length; i++) {
        oldKeyIndices.set(orderedKeys[i], i);
      }

      for (const key of newKeyOrder) {
        if (keyedBlocks.has(key)) {
          oldIndices.push(oldKeyIndices.get(key));
          survivingNewKeys.push(key);
        }
      }

      const lisIndices = longestIncreasingSubsequenceIndices(oldIndices);
      const stayPutKeys = new Set();
      let sIdx = 0;
      for (let i = 0; i < oldIndices.length; i++) {
        if (lisIndices.has(i)) {
          stayPutKeys.add(survivingNewKeys[sIdx]);
        }
        sIdx++;
      }

      // Backward pass to place nodes accurately relative to next placed node
      let nextPlacedNode = container ? null : endAnchor;

      for (let i = newKeyOrder.length - 1; i >= 0; i--) {
        const keyVal = newKeyOrder[i];
        const { item, idx } = newItemMap.get(keyVal);

        if (keyedBlocks.has(keyVal)) {
          const block = keyedBlocks.get(keyVal);
          const itemChanged = !shallowEqual(block.item, item);
          const indexChanged = Boolean(indexAttr && block.idx !== idx);

          if (itemChanged || indexChanged) {
            block.cleanupStack?.run();
            const { frag, nodes, cleanupStack } = renderItemNodes(item, idx);
            const firstOld = block.nodes[0];
            firstOld?.parentNode?.insertBefore(frag, firstOld);
            for (const oldNode of block.nodes) oldNode.remove();
            block.nodes = nodes;
            block.item = item;
            block.idx = idx;
            block.cleanupStack = cleanupStack;
          }

          if (!stayPutKeys.has(keyVal)) {
            // Move node before nextPlacedNode
            for (const node of block.nodes) {
              if (container) {
                if (nextPlacedNode) container.insertBefore(node, nextPlacedNode);
                else container.appendChild(node);
              } else {
                endAnchor.parentNode?.insertBefore(node, nextPlacedNode || endAnchor);
              }
            }
          }
          nextPlacedNode = block.nodes[0];
        } else {
          // Mount new item
          const { frag, nodes, cleanupStack } = renderItemNodes(item, idx);
          if (container) {
            if (nextPlacedNode) container.insertBefore(frag, nextPlacedNode);
            else container.appendChild(frag);
          } else {
            endAnchor.parentNode?.insertBefore(frag, nextPlacedNode || endAnchor);
          }
          keyedBlocks.set(keyVal, { nodes, item, idx, cleanupStack });
          nextPlacedNode = nodes[0];
        }
      }
    } else {
      // Simple Diff Strategy
      let expectedPrev = container ? null : startAnchor;

      for (const keyVal of newKeyOrder) {
        const { item, idx } = newItemMap.get(keyVal);

        if (keyedBlocks.has(keyVal)) {
          const block = keyedBlocks.get(keyVal);
          const itemChanged = !shallowEqual(block.item, item);
          const indexChanged = Boolean(indexAttr && block.idx !== idx);

          if (itemChanged || indexChanged) {
            block.cleanupStack?.run();
            const { frag, nodes, cleanupStack } = renderItemNodes(item, idx);
            const firstOld = block.nodes[0];
            firstOld?.parentNode?.insertBefore(frag, firstOld);
            for (const oldNode of block.nodes) oldNode.remove();
            block.nodes = nodes;
            block.item = item;
            block.idx = idx;
            block.cleanupStack = cleanupStack;
          }

          const firstNode = block.nodes[0];
          if (firstNode && firstNode.previousSibling === expectedPrev) {
            expectedPrev = block.nodes[block.nodes.length - 1];
          } else {
            for (const node of block.nodes) appendNode(node);
            expectedPrev = block.nodes[block.nodes.length - 1];
          }
        } else {
          const { frag, nodes, cleanupStack } = renderItemNodes(item, idx);
          appendNode(frag);
          keyedBlocks.set(keyVal, { nodes, item, idx, cleanupStack });
          expectedPrev = nodes[nodes.length - 1];
        }
      }
    }

    orderedKeys = newKeyOrder;
  }

  // Initial render during Transform
  const initialList = getByPath(ctx.scope, each)
    ?? (ctx.store ? ctx.store.get(each) : undefined);

  if (container) {
    el.replaceWith(container);
    reconcile(initialList);
  } else {
    const initFrag = doc.createDocumentFragment();
    initFrag.appendChild(startAnchor);
    initFrag.appendChild(endAnchor);
    el.replaceWith(initFrag);
    reconcile(initialList);
  }

  // Reactive subscription
  if (ctx.store && typeof ctx.store.subscribe === 'function') {
    const unsubscribe = ctx.store.subscribe(each, (newList) => {
      reconcile(newList);
    });

    ctx.onCleanup(() => {
      unsubscribe();
      for (const block of keyedBlocks.values()) {
        block.cleanupStack?.run();
        for (const node of block.nodes) node.remove();
      }
      keyedBlocks.clear();
    });
  } else {
    ctx.onCleanup(() => {
      for (const block of keyedBlocks.values()) {
        block.cleanupStack?.run();
        for (const node of block.nodes) node.remove();
      }
      keyedBlocks.clear();
    });
  }
}

/**
 * Creates the standard Loops module definition.
 *
 * @param {Object} [options={}]
 * @returns {Readonly<Object>} ModuleDefinition
 */
export function loops(_options = {}) {
  return defineModule({
    name: 'loops',
    triggers: [
      tag('FOR', {
        phase: 'transform',
        setup: transformLoop,
      }),
      attr('data-for', {
        phase: 'transform',
        match: (el) => el.tagName === 'TEMPLATE',
        setup: transformLoop,
      }),
    ],
  });
}

export default loops;
