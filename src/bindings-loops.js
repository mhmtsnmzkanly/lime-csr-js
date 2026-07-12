/**
 * @module bindings-loops
 * Reactive <for data-live> — key-based diff with intelligent list updates.
 *
 * DIFFERENT MECHANISM from bindings-blocks.js's <if data-live>:
 *   - <if data-live>: when condition changes, the entire branch is TORN DOWN and rebuilt.
 *   - <for data-live>: elements with matching keys are PRESERVED (DOM identity —
 *     focus, input value, scroll, animation survive); only added/removed/moved
 *     elements are processed.
 *
 * NEW FILE (NOT added to bindings-blocks.js). Rationale:
 *   Different mechanism (tear-down/rebuild vs diff), different complexity,
 *   regression risk, and separation of concerns. loops.js — bindings-loops.js symmetry.
 *
 * KEY REQUIRED:
 *   data-live <for> MUST carry a key. If missing: errors.missingKey + not made
 *   reactive (stays empty — <for> removed). Avoid silent wrong behaviour.
 *
 * PLACEHOLDER PATTERN (same as bindings-blocks.js):
 *   <for data-live> → <!-- live-for:lf1 --> [element blocks] <!-- /live-for:lf1 -->
 *   Comment pair = fixed anchors. Content is kept in DOM order between them.
 *
 * DIFF STRATEGIES — data-diff="simple"|"lcs"|"replace" (default: simple):
 *   All three share the same delete step (cleanup FIRST, then DOM removal)
 *   and the same append fast-path (see below); they differ only in how
 *   SURVIVING (same-key) items are repositioned.
 *
 *   - simple (default): forward pass, local in-place guard. For each item in
 *     new order, if it's already immediately after the last-placed item,
 *     leave it; otherwise move it to the end. Cheap to compute, correct, but
 *     only catches LOCALLY-adjacent no-op cases — a single item moved from
 *     the front to the back can cascade into moving everything after it.
 *   - lcs: computes the Longest Increasing Subsequence of survivors' old
 *     positions (in new order) — the maximal set of items whose RELATIVE
 *     order didn't change, which can all stay physically untouched. Only
 *     items outside that subsequence are moved. Same identity/preservation
 *     guarantees as simple, fewer DOM operations on non-trivial reorders.
 *   - replace: no diffing at all. Every existing block is torn down
 *     (cleanup + removal) and the list is rendered from scratch every time.
 *     Identity is NEVER preserved. Use for huge lists where per-item state
 *     doesn't matter and diff bookkeeping isn't worth it.
 *
 *   Unknown data-diff value → errors.unknownDiffStrategy, falls back to simple.
 *
 * RECONCILE IMPROVEMENTS (simple + lcs; replace skips both by design):
 *   1. In-place preservation: simple's local guard / lcs's LIS both avoid
 *      unnecessary insertBefore calls for items that don't need to move.
 *   2. Append fast-path: if old keys are a prefix of new keys, skip the full
 *      diff and only append the new tail items (covers ~95% of chat/log
 *      scenarios, zero extra DOM work, shared by simple AND lcs).
 *
 * WHY AN EXPLICIT `orderedKeys` ARRAY (not `Array.from(keyedBlocks.keys())`):
 *   Map.set() on an ALREADY-PRESENT key does not change its iteration-order
 *   position — only a fresh key changes it. Since surviving items are never
 *   re-inserted into `keyedBlocks` on a plain reorder, the Map's own
 *   iteration order silently goes stale after any reorder-only reconcile
 *   (it keeps reflecting the OLD physical order, not the new one). This is
 *   harmless for the fast-path itself in isolation, but on a LATER reconcile
 *   it can make the append-prefix check compare against a stale order and
 *   wrongly conclude "this is just an append" when survivors also need
 *   repositioning — silently leaving them in the wrong place. `orderedKeys`
 *   is explicitly set to the just-established `newKeyOrder` at the end of
 *   every reconcile (all three strategies), so it always reflects reality.
 *   lcs also depends on this being accurate: it computes each survivor's
 *   OLD position from `orderedKeys` to find the longest increasing run.
 *
 * NOTE — considered and rejected: re-rendering a surviving key when its item
 * object reference changes (Object.is(oldItem, newItem) === false). Rejected
 * because most immutable-update patterns (sort/reverse/filter) build fresh
 * object literals every time even when content is unchanged, which made this
 * heuristic tear down and rebuild blocks on pure reordering — destroying DOM
 * identity, focus, and in-progress input values. Reference identity is not a
 * reliable proxy for "content changed."
 *
 * DOUBLE-BIND PREVENTION:
 *   setupBindings (bindings.js) skips the inside of live-for via
 *   closest('for[data-live]'). Content is bound only by renderFn's setupBindings.
 *
 * CLEANUP ORDER:
 *   Deleted element: block.cleanup() FIRST (cancel subscriptions) — THEN remove from DOM.
 *   Same rule as bindings-blocks.js: cleanup must not run on a detached node.
 *
 * EL="TAG" CONTAINER (2g, same pattern as bindings-blocks.js):
 *   <for data-live el="ul"> wraps the item blocks in a persistent <ul> element
 *   instead of bare comment anchors. The container itself is never recreated
 *   across reconciles — only its children are added/removed/moved — so any
 *   identity/state on the container itself (not just its items) survives.
 *   Non-reserved attributes (class, id, ...) on <for> are copied onto the
 *   container. Without el, the original comment-anchor behavior is unchanged.
 *
 * BLOCK-LEVEL HOOKS — data-after / data-before (per-ITEM, not per-list):
 *   <for data-live each="items" as="item" key="item.id" data-after="initRow" data-before="destroyRow">
 *   Same attribute-based, eval-free, name-lookup pattern as bindings-blocks.js.
 *     data-after  -- called once a NEW item's nodes are placed in the DOM.
 *                    Fires for every item on the INITIAL render too, and for
 *                    every item added later (append fast-path, full diff, or
 *                    every item under data-diff="replace").
 *     data-before -- called BEFORE a REMOVED item is torn down (synchronously,
 *                    right before its cleanup() + DOM removal) -- its nodes
 *                    are still attached to the DOM at call time.
 *   Handler signature: (itemRootNode, store). itemRootNode is the item's own
 *   first top-level ELEMENT node (template whitespace around it is skipped;
 *   el="tag" wraps the WHOLE LIST, not each item individually, so it has no
 *   bearing on the per-item hook root). null if the item has no element
 *   nodes at all.
 *   MOVED/reordered/stay-put survivors (simple's in-place guard, lcs's LIS,
 *   or a no-op position) never trigger either hook -- the item's node was
 *   never destroyed, so there's nothing to (re)initialize or tear down.
 *   Missing handler name -> errors.blockAfterNotFound/blockBeforeNotFound,
 *   warn and continue (no crash).
 */

import { getByPath } from './store.js';
import { errors } from './errors.js';
import { inLiveBlock, inIgnoredBlock, longestIncreasingSubsequenceIndices } from './shared.js';

let forCounter = 0;
function nextForRef() { return `lf${++forCounter}`; }

/**
 * Finds the first actual Element among a block's top-level nodes, for hook
 * rootEl purposes. A block's nodes[0] is not reliably an Element: template
 * whitespace (a newline/indentation before the item's own root tag) shows up
 * as a leading Text node. `rootEl.getAttribute`/`querySelector`-style usage
 * in a data-after/data-before handler requires a real Element.
 *
 * @param {Node[]} nodes
 * @returns {Element|null}
 */
function firstElementNode(nodes) {
  return nodes.find((n) => n.nodeType === Node.ELEMENT_NODE) ?? null;
}

// 2g/data-diff/hooks: attributes that belong to the <for> element's own
// control surface — never copied onto the el="tag" container (everything
// else, e.g. class/id, is copied so the container can be styled/targeted like a normal element).
const RESERVED_FOR_ATTRS = new Set([
  'each', 'as', 'key', 'index', 'data-live', 'el', 'data-diff', 'data-after', 'data-before',
]);

const VALID_DIFF_STRATEGIES = new Set(['simple', 'lcs', 'replace']);

/**
 * Looks up `handlerName` in `handlers` and calls it with (rootEl, store).
 * Missing name (or no handlers dictionary at all) -> dev-mode warning, no crash.
 *
 * @param {string|null} handlerName
 * @param {Node|null}    rootEl
 * @param {import('./store.js').Store} store
 * @param {Object<string, function(Node, import('./store.js').Store): void>|undefined} handlers
 * @param {'after'|'before'} kind
 */
function callBlockHook(handlerName, rootEl, store, handlers, kind) {
  if (!handlerName) return;
  const handler = handlers ? handlers[handlerName] : undefined;
  if (typeof handler !== 'function') {
    const available = handlers ? Object.keys(handlers) : [];
    if (kind === 'after') errors.blockAfterNotFound(handlerName, available, rootEl);
    else errors.blockBeforeNotFound(handlerName, available, rootEl);
    return;
  }
  handler(rootEl, store);
}

/**
 * Deep-clones a node list into a fresh DocumentFragment.
 * @param {Node[]} nodes
 * @returns {DocumentFragment}
 */
function cloneToFragment(nodes) {
  const frag = document.createDocumentFragment();
  for (const node of nodes) frag.appendChild(node.cloneNode(true));
  return frag;
}



/**
 * Sets up every <for data-live> element inside root.
 * Each one gets a key-based diff mechanism + a store subscription.
 *
 * Only the outermost live-fors are processed here; nested ones are handled
 * by renderFn's own recursive call (render → setupLiveFors) per item.
 *
 * @param {Element|DocumentFragment}   root
 * @param {Object}                     context
 * @param {import('./store.js').Store} store
 * @param {function(DocumentFragment, Object, import('./store.js').Store, Object=): function(): void} renderFn
 * @param {Object<string, function>=} handlers - For data-after/data-before lookups (see module JSDoc).
 * @returns {function(): void} cleanup — cancels all subscriptions + block cleanups
 */
export function setupLiveFors(root, context, store, renderFn, handlers) {
  const allCleanups = [];

  // Only the outermost live-fors: not nested inside another live-for or live-if,
  // and not inside an ignored block.
  // Nested ones are handled inside renderFn's recursive call (once per item).
  const liveFors = Array.from(root.querySelectorAll('for[data-live]')).filter(
    (el) =>
      !inLiveBlock(el) && !inIgnoredBlock(el),
  );

  for (const forEl of liveFors) {
    if (!root.contains(forEl)) continue;

    const each      = forEl.getAttribute('each');
    const as        = forEl.getAttribute('as');
    const keyPath   = forEl.getAttribute('key');
    const indexAttr = forEl.getAttribute('index');

    // Missing key — do NOT make reactive. loops.js already skipped this <for>
    // (data-live filter); skip here too, but at least warn and remove it.
    if (!keyPath) {
      errors.missingKey(each ?? '?');
      forEl.remove();
      continue;
    }

    if (!each || !as) {
      // Missing base attribute — loops.js already skipped this too; remove it.
      forEl.remove();
      continue;
    }

    // data-diff: which reconcile strategy to use. Unknown value -> warn + simple.
    const diffAttr = forEl.getAttribute('data-diff');
    let diffStrategy = 'simple';
    if (diffAttr != null && diffAttr !== '') {
      if (VALID_DIFF_STRATEGIES.has(diffAttr)) {
        diffStrategy = diffAttr;
      } else {
        errors.unknownDiffStrategy(diffAttr, each);
      }
    }

    // Hooks: attribute names (null if not set).
    const afterHandlerName  = forEl.getAttribute('data-after')  || null;
    const beforeHandlerName = forEl.getAttribute('data-before') || null;

    const ref         = nextForRef();
    const startAnchor = document.createComment(`live-for:${ref}`);
    const endAnchor   = document.createComment(`/live-for:${ref}`);

    // 2g: el="tag" -- optional container element wrapping all item blocks.
    // If <for data-live el="ul"> is used, item blocks are placed inside a
    // <ul> wrapper instead of being anchored directly between the comment
    // pair. The container persists across reconciles (only its children
    // change), so identity/state on the container itself is preserved.
    const elTag     = forEl.getAttribute('el') || null;
    const container = elTag ? document.createElement(elTag) : null;

    // 2g: copy any non-reserved attribute (class, id, data-testid, ...) from
    // <for> onto the container, so it can be styled/targeted like a normal element.
    if (container) {
      for (const attr of Array.from(forEl.attributes)) {
        if (!RESERVED_FOR_ATTRS.has(attr.name)) container.setAttribute(attr.name, attr.value);
      }
    }

    // 2g: appends a node at the current end of the item sequence -- inside
    // the container if el="tag" is used, otherwise right before endAnchor
    // (the anchor plays the role container's "end" would otherwise play).
    function appendNode(node) {
      if (container) container.appendChild(node);
      else endAnchor.parentNode.insertBefore(node, endAnchor);
    }

    // lcs: inserts a node right before a specific reference node (or at the
    // end, if ref is null/endAnchor) -- used for the backward anchor-chained
    // pass, where "where to insert" varies per item instead of always being
    // "the current end."
    function insertBeforeRef(node, ref) {
      if (container) container.insertBefore(node, ref);
      else endAnchor.parentNode.insertBefore(node, ref ?? endAnchor);
    }

    // Extract the template nodes while forEl is still in the DOM (before replaceWith).
    const templateNodes = Array.from(forEl.childNodes).map((n) => n.cloneNode(true));

    /**
     * @typedef {{ nodes: Node[], cleanup: function(): void }} Block
     * keyedBlocks: Map preserves insertion order; O(1) key lookup.
     * Order information is rebuilt in newKeyOrder on each reconcile.
     * @type {Map<*, Block>}
     */
    const keyedBlocks = new Map();

    // The TRUE current key order, kept in sync after every reconcile — see
    // the module JSDoc ("WHY AN EXPLICIT orderedKeys ARRAY") for why this
    // can't just be `Array.from(keyedBlocks.keys())`.
    let orderedKeys = [];

    /**
     * Renders a brand-new item and inserts its nodes via `insert`.
     * @param {*} keyVal
     * @param {*} item
     * @param {number} idx
     * @param {function(Node): void} insert
     */
    function mountNewItem(keyVal, item, idx, insert) {
      const itemCtx = { ...context, [as]: item };
      if (indexAttr) itemCtx[indexAttr] = idx;
      const frag    = cloneToFragment(templateNodes);
      const cleanup = renderFn(frag, itemCtx, store, handlers);
      const nodes   = Array.from(frag.childNodes);
      keyedBlocks.set(keyVal, { nodes, cleanup });
      for (const node of nodes) insert(node);
      // data-after: node(s) are now actually in the DOM (insert() above did a real DOM op).
      callBlockHook(afterHandlerName, firstElementNode(nodes), store, handlers, 'after');
    }

    /**
     * simple strategy: forward pass, local in-place guard (see module JSDoc).
     * @param {Array<*>} newKeyOrder
     * @param {Map<*, {item: *, idx: number}>} newItemMap
     */
    function reconcileSimple(newKeyOrder, newItemMap) {
      let expectedPrev = container ? null : startAnchor; // expected preceding node for the in-place check

      for (const keyVal of newKeyOrder) {
        if (keyedBlocks.has(keyVal)) {
          const block = keyedBlocks.get(keyVal);
          const firstNode = block.nodes[0];
          if (firstNode && firstNode.previousSibling === expectedPrev) {
            // Already correct: just advance expectedPrev
            expectedPrev = block.nodes[block.nodes.length - 1];
          } else {
            for (const node of block.nodes) appendNode(node);
            expectedPrev = block.nodes[block.nodes.length - 1];
          }
        } else {
          const { item, idx } = newItemMap.get(keyVal);
          mountNewItem(keyVal, item, idx, appendNode);
          const block = keyedBlocks.get(keyVal);
          expectedPrev = block.nodes[block.nodes.length - 1];
        }
      }
    }

    /**
     * lcs strategy: LIS-based minimal reorder (see module JSDoc).
     * Must run BACKWARD (last item to first), anchoring each move on the
     * node placed in the previous iteration -- a forward "always append to
     * the end" pass (like simple's) is NOT correct here, because skipped
     * (stay-put) items are deliberately left at their OLD physical position,
     * which is not necessarily "the end" relative to items processed so far.
     *
     * @param {Array<*>} newKeyOrder
     * @param {Map<*, {item: *, idx: number}>} newItemMap
     */
    function reconcileLcs(newKeyOrder, newItemMap) {
      const oldIndexOf = new Map(orderedKeys.map((k, i) => [k, i]));

      // Old-position sequence of survivors, in NEW order.
      const survivorOldIdx = [];
      const survivorNewPos = [];
      newKeyOrder.forEach((keyVal, newPos) => {
        if (keyedBlocks.has(keyVal)) {
          survivorOldIdx.push(oldIndexOf.get(keyVal));
          survivorNewPos.push(newPos);
        }
      });

      const lisIndices = longestIncreasingSubsequenceIndices(survivorOldIdx);
      const stayPutNewPositions = new Set();
      for (const i of lisIndices) stayPutNewPositions.add(survivorNewPos[i]);

      let anchor = null; // null means "insert at the end" (endAnchor / container append)

      for (let newPos = newKeyOrder.length - 1; newPos >= 0; newPos--) {
        const keyVal = newKeyOrder[newPos];

        if (keyedBlocks.has(keyVal)) {
          const block = keyedBlocks.get(keyVal);
          if (!stayPutNewPositions.has(newPos)) {
            // Inner loop goes FORWARD even though the outer loop is backward:
            // each call inserts right before the SAME fixed `anchor`, so a
            // forward pass naturally reproduces the nodes' original relative
            // order (node 0, then node 1 lands between node 0 and anchor,
            // etc.) -- a backward inner pass would reverse a multi-node
            // block's internal order (e.g. surrounding whitespace text nodes
            // ending up swapped with the element between them).
            for (const node of block.nodes) insertBeforeRef(node, anchor);
          }
          anchor = block.nodes[0];
        } else {
          const { item, idx } = newItemMap.get(keyVal);
          const itemCtx = { ...context, [as]: item };
          if (indexAttr) itemCtx[indexAttr] = idx;
          const frag    = cloneToFragment(templateNodes);
          const cleanup = renderFn(frag, itemCtx, store, handlers);
          const nodes   = Array.from(frag.childNodes);
          keyedBlocks.set(keyVal, { nodes, cleanup });
          for (const node of nodes) insertBeforeRef(node, anchor); // forward -- see note above
          callBlockHook(afterHandlerName, firstElementNode(nodes), store, handlers, 'after');
          anchor = nodes[0];
        }
      }
    }

    /**
     * replace strategy: no diffing -- tear down every existing block and
     * render the whole list from scratch, every reconcile. Identity is
     * NEVER preserved; existing blocks' cleanup() always runs first.
     *
     * @param {Array} newList
     */
    function reconcileReplace(newList) {
      for (const block of keyedBlocks.values()) {
        // data-before: nodes are still attached at this point.
        callBlockHook(beforeHandlerName, firstElementNode(block.nodes), store, handlers, 'before');
        block.cleanup(); // subscriptions first (detached-node cleanup guard)
        for (const node of block.nodes) node.parentNode?.removeChild(node);
      }
      keyedBlocks.clear();

      const seenKeys = new Set();
      for (let i = 0; i < newList.length; i++) {
        const item    = newList[i];
        const itemCtx = { ...context, [as]: item };
        if (indexAttr) itemCtx[indexAttr] = i;
        const keyVal  = getByPath(itemCtx, keyPath);

        if (seenKeys.has(keyVal)) {
          errors.duplicateKey(String(keyVal ?? ''), each);
          continue;
        }
        seenKeys.add(keyVal);
        mountNewItem(keyVal, item, i, appendNode);
      }

      orderedKeys = Array.from(keyedBlocks.keys());
    }

    /**
     * Diffs the current blocks against a new list, dispatching to the
     * configured diffStrategy (simple/lcs/replace).
     *
     * @param {Array} newList - New array from store.get(each)
     */
    function reconcile(newList) {
      if (!Array.isArray(newList)) newList = [];

      if (diffStrategy === 'replace') {
        reconcileReplace(newList);
        return;
      }

      // Build new key map (shared by simple + lcs)
      const newKeyOrder = [];
      const newKeySet   = new Set();
      const newItemMap  = new Map();

      for (let i = 0; i < newList.length; i++) {
        const item    = newList[i];
        const itemCtx = { ...context, [as]: item };
        if (indexAttr) itemCtx[indexAttr] = i;
        const keyVal  = getByPath(itemCtx, keyPath);

        if (newKeySet.has(keyVal)) {
          errors.duplicateKey(String(keyVal ?? ''), each);
          continue;
        }
        newKeySet.add(keyVal);
        newKeyOrder.push(keyVal);
        newItemMap.set(keyVal, { item, idx: i });
      }

      // Append fast-path -- if old keys are a prefix of new keys, skip the
      // full diff and only append the new tail items. Valid for simple AND
      // lcs alike (a pure append never needs to move an existing survivor).
      // Covers ~95% of chat/log append scenarios with zero extra DOM work.
      if (orderedKeys.length <= newKeyOrder.length &&
          orderedKeys.every((k, i) => newKeyOrder[i] === k)) {
        const tailKeys = newKeyOrder.slice(orderedKeys.length);
        for (const keyVal of tailKeys) {
          const { item, idx } = newItemMap.get(keyVal);
          mountNewItem(keyVal, item, idx, appendNode);
        }
        orderedKeys = newKeyOrder.slice();
        return;
      }

      // Full diff path

      // a. Delete removed blocks (shared by simple + lcs)
      const toDelete = [];
      for (const keyVal of keyedBlocks.keys()) {
        if (!newKeySet.has(keyVal)) toDelete.push(keyVal);
      }
      for (const keyVal of toDelete) {
        const block = keyedBlocks.get(keyVal);
        // data-before: nodes are still attached at this point.
        callBlockHook(beforeHandlerName, firstElementNode(block.nodes), store, handlers, 'before');
        block.cleanup(); // subscriptions first (detached-node cleanup guard)
        for (const node of block.nodes) node.parentNode?.removeChild(node);
        keyedBlocks.delete(keyVal);
      }

      // b+c. Insert new, reorder all in new order (identity always preserved for survivors).
      if (diffStrategy === 'lcs') {
        reconcileLcs(newKeyOrder, newItemMap);
      } else {
        reconcileSimple(newKeyOrder, newItemMap);
      }

      orderedKeys = newKeyOrder.slice();
    }

    // Initial render
    const initialList = Array.isArray(store.get(each)) ? store.get(each) : [];
    const seenKeys    = new Set();

    for (let i = 0; i < initialList.length; i++) {
      const item    = initialList[i];
      const itemCtx = { ...context, [as]: item };
      if (indexAttr) itemCtx[indexAttr] = i;
      const keyVal  = getByPath(itemCtx, keyPath);

      if (seenKeys.has(keyVal)) {
        errors.duplicateKey(String(keyVal ?? ''), each);
        continue;
      }
      seenKeys.add(keyVal);

      const frag    = cloneToFragment(templateNodes);
      const cleanup = renderFn(frag, itemCtx, store, handlers);
      const nodes   = Array.from(frag.childNodes);
      keyedBlocks.set(keyVal, { nodes, cleanup });
    }

    orderedKeys = Array.from(keyedBlocks.keys());

    // Replace <for> with the anchor pair (+ container, if el="tag") + initial blocks.
    const allInitialNodes = Array.from(keyedBlocks.values()).flatMap((b) => b.nodes);
    if (container) {
      // 2g: container mode -- initial blocks go inside the container; the
      // anchor pair still brackets the container itself (consistency with
      // bindings-blocks.js, and a stable insertion point if ever needed).
      for (const node of allInitialNodes) container.appendChild(node);
      forEl.replaceWith(startAnchor, container, endAnchor);
    } else {
      forEl.replaceWith(startAnchor, ...allInitialNodes, endAnchor);
    }

    // data-after also fires for each item on the initial render, now that
    // every item is actually placed in the DOM -- matches bindings-blocks.js's
    // initial-render behavior and covers "initialize a widget for the first
    // items rendered on mount" use cases.
    for (const block of keyedBlocks.values()) {
      callBlockHook(afterHandlerName, firstElementNode(block.nodes), store, handlers, 'after');
    }

    // ── Subscription + cleanup registration ─────────────────────────────
    allCleanups.push(store.subscribe(each, reconcile));

    // This live-for's combined cleanup: cancels all block subscriptions.
    // DOM removal is not done here — unmount or re-mount handles that.
    allCleanups.push(() => {
      for (const block of keyedBlocks.values()) block.cleanup();
      keyedBlocks.clear();
    });
  }

  return function cleanup() {
    for (const unsub of allCleanups) unsub();
    allCleanups.length = 0; // guard against double invocation
  };
}
