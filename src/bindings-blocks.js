/**
 * @module bindings-blocks
 * Reactive block layer — currently only <if data-live>.
 *
 * SCOPE — THIS MODULE:
 *   <if is-gt="count" than="0" data-live>...</if>
 *   When the condition's store path changes, the block is RE-EVALUATED;
 *   the winning branch (then/else) is torn down and rebuilt.
 *
 * OUT OF SCOPE (next step — bindings-for.js or live-blocks.js):
 *   Reactive <for data-live>: same tear-down/rebuild mechanism + key/diff.
 *   Without a key the whole list is re-rendered on every change (focus/scroll is lost).
 *   Handled separately for this reason.
 *
 * PLACEHOLDER PATTERN — bounded by comment nodes:
 *   <if data-live> is removed from the DOM; two comment nodes are put in its place:
 *     <!-- live-if:ref -->  ← start anchor
 *     [active branch content]
 *     <!-- /live-if:ref --> ← end anchor
 *   When the branch changes, the "between" region is cleared and new content is placed.
 *   The comment nodes stay fixed → not dependent on sibling ordering, safe.
 *
 * CLEANUP ORDER (critical):
 *   On branch change, FIRST the old branch's cleanup (cancel subscriptions),
 *   THEN DOM removal. Reversing this can break cleanup that relies on removed
 *   nodes (WeakMap lookups, node-anchored state).
 *
 * IDENTITY WARNING:
 *   When the branch changes, that branch is completely torn down and rebuilt —
 *   input focus, scroll position, animation state are lost. Acceptable for
 *   <if>; <for> hits the same problem per element and needs a key mechanism.
 *
 * NESTED SUPPORT:
 *   Since the render(branchFrag, context, store) call also includes
 *   setupLiveIfs, inner <if data-live> elements inside a branch get bound
 *   with their own cleanups. When the outer branch changes, the outer
 *   branch's cleanup also cancels the inner live-if subscriptions.
 *
 * data-live VALUE FOR PATH TRACKING:
 *   data-live=""   (empty) → the condition operator's path is tracked (is-gt="count" → "count")
 *   data-live="x"  (set)   → the explicit path "x" is tracked (preferred for multiple paths)
 *
 * BLOCK-LEVEL HOOKS — data-after / data-before:
 *   <if data-live is-truthy="showChart" el="div" data-after="initChart" data-before="destroyChart">
 *   Attribute-based, eval-free, same name-lookup pattern as data-on-* — the
 *   attribute value is a KEY looked up in the `handlers` dictionary passed to
 *   mount(), never an expression.
 *     data-after  -- called AFTER a branch's nodes are placed in the DOM
 *                    (both on the INITIAL render and on every later switch).
 *     data-before -- called BEFORE a branch is torn down (synchronously,
 *                    right before branchCleanup() + DOM removal) -- the
 *                    element is still attached to the DOM at call time, so
 *                    e.g. widget.destroy()/observer.disconnect() can still
 *                    reach real layout/measurements if needed.
 *   Handler signature: (rootElement, store). rootElement is the el="tag"
 *   container if one is configured, otherwise the branch's first top-level
 *   ELEMENT node (template whitespace around it is skipped; use el="..." for
 *   a guaranteed stable single root element instead of relying on this).
 *   null if the branch has no element nodes at all (e.g. pure text).
 *   Same-condition re-evaluation (currentCondition unchanged) never fires
 *   either hook, since no branch switch happens at all in that case.
 *   Missing handler name -> errors.blockAfterNotFound/blockBeforeNotFound,
 *   warn and continue (no crash). data-after/data-before are only evaluated
 *   if `handlers` was supplied to render() (see index.js); without it, they
 *   silently do nothing beyond the same missing-handler warning.
 *   Cleanup is always SYNCHRONOUS -- data-before does not await a Promise;
 *   TODO: async before-hooks (e.g. await an exit animation) are a possible
 *   future extension, not supported here.
 */

import { OPERATORS } from './conditionals.js';
import { errors } from './errors.js';

const OPERATOR_NAMES = /** @type {string[]} */ (Object.keys(OPERATORS));

// 2g/hooks: attributes that belong to the <if> element's own control
// surface — never copied onto the el="tag" container (everything else, e.g.
// class/id, is copied so the container can be styled/targeted like a normal element).
const RESERVED_IF_ATTRS = new Set([
  ...OPERATOR_NAMES, 'than', 'to', 'data-live', 'el', 'data-after', 'data-before',
]);

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
 * Finds the first actual Element among a branch's top-level nodes, for hook
 * rootEl purposes. A branch's nodes[0] is not reliably an Element: template
 * whitespace (a newline/indentation before the branch's own root tag) shows
 * up as a leading Text node. `rootEl.getAttribute`/`querySelector`-style
 * usage in a data-after/data-before handler requires a real Element.
 *
 * @param {Node[]} nodes
 * @returns {Element|null}
 */
function firstElementNode(nodes) {
  return nodes.find((n) => n.nodeType === Node.ELEMENT_NODE) ?? null;
}

let blockCounter = 0;
function nextBlockRef() { return `lb${++blockCounter}`; }

/**
 * Evaluates the condition for <if data-live> from the store.
 * Difference from evalCondition: uses store.get(path), not context.
 *
 * @param {Element}                        ifEl
 * @param {import('./store.js').Store}     store
 * @returns {boolean}
 */
function evalLiveCondition(ifEl, store) {
  const opName = OPERATOR_NAMES.find((op) => ifEl.hasAttribute(op));
  if (!opName) {
    errors.liveIfMissingOperator(ifEl);
    return false;
  }
  const path      = ifEl.getAttribute(opName);
  const leftValue = store.get(path);
  const rightRaw  = ifEl.getAttribute('than') ?? ifEl.getAttribute('to') ?? '';
  return Boolean(OPERATORS[opName](leftValue, rightRaw));
}

/**
 * Returns the store paths to track for an <if>.
 * data-live="path" → explicit path; data-live="" → derived from the operator attribute.
 *
 * LIMIT: only the operator's LEFT side (e.g. is-gt="count" → "count") or an
 * explicit data-live="path" is tracked. The "than"/"to" attribute is NEVER
 * tracked even if it looks like a path — it's always treated as static/literal.
 * If the right side also needs to be reactive, precompute the comparison on
 * the left side and reduce it to a single trackable path.
 *
 * @param {Element} ifEl
 * @returns {string[]}
 */
function getLivePaths(ifEl) {
  const liveVal = ifEl.getAttribute('data-live');
  if (liveVal) return [liveVal]; // explicit path given
  // empty/unset → derive from the condition operator's value
  const opName = OPERATOR_NAMES.find((op) => ifEl.hasAttribute(op));
  if (!opName) return [];
  const path = ifEl.getAttribute(opName);
  return path ? [path] : [];
}

/**
 * Splits an <if>'s then and else nodes.
 * Nodes are not cloned — references are returned.
 *
 * @param {Element} ifEl
 * @returns {{ thenNodes: Node[], elseNodes: Node[] }}
 */
function extractBranches(ifEl) {
  const directChildren = Array.from(ifEl.childNodes);
  const elseEl = directChildren.find(
    (ch) => ch.nodeType === Node.ELEMENT_NODE && ch.tagName === 'ELSE',
  ) ?? null;
  const thenNodes = directChildren.filter((ch) => ch !== elseEl);
  const elseNodes = elseEl ? Array.from(elseEl.childNodes) : [];
  return { thenNodes, elseNodes };
}

/**
 * Deep-clones the given nodes into a fresh DocumentFragment.
 *
 * @param {Node[]} nodes
 * @returns {DocumentFragment}
 */
function cloneToFragment(nodes) {
  const frag = document.createDocumentFragment();
  for (const node of nodes) frag.appendChild(node.cloneNode(true));
  return frag;
}

/**
 * Removes all siblings between the start and end comment anchors.
 *
 * @param {Comment} startAnchor
 * @param {Comment} endAnchor
 */
function clearBetween(startAnchor, endAnchor) {
  while (startAnchor.nextSibling && startAnchor.nextSibling !== endAnchor) {
    startAnchor.nextSibling.remove();
  }
}

/**
 * Inserts a DocumentFragment BEFORE endAnchor (i.e. after startAnchor).
 *
 * @param {Comment}          endAnchor
 * @param {DocumentFragment} frag
 */
function insertBeforeAnchor(endAnchor, frag) {
  endAnchor.parentNode.insertBefore(frag, endAnchor);
}

/**
 * Sets up every <if data-live> element inside root.
 * For each one: a placeholder comment pair + initial branch render + store subscription are opened.
 * On branch change: old cleanup → new render → DOM update, in that order.
 *
 * renderFn is expected to point to render(); this way:
 *  - Structural tags inside the branch (partial/for/if) go through the pipeline.
 *  - data-text/attr bindings inside the branch (setupBindings) are set up.
 *  - Inner <if data-live> elements inside the branch (setupLiveIfs) also kick in.
 *
 * @param {Element|DocumentFragment} root
 * @param {Object}                   context
 * @param {import('./store.js').Store} store
 * @param {function(DocumentFragment, Object, import('./store.js').Store, Object=): function(): void} renderFn
 * @param {Object<string, function>=} handlers - For data-after/data-before lookups (see module JSDoc).
 * @returns {function(): void} cleanup — cancels all subscriptions and branch cleanups
 */
export function setupLiveIfs(root, context, store, renderFn, handlers) {
  const allCleanups = [];

  const liveIfs = Array.from(root.querySelectorAll('if[data-live]')).filter(
    (el) =>
      !el.parentElement?.closest('if[data-live]') &&
      !el.parentElement?.closest('for[data-live]'),
  );

  for (const ifEl of liveIfs) {
    if (!root.contains(ifEl)) continue;

    const ref          = nextBlockRef();
    const startAnchor  = document.createComment(`live-if:${ref}`);
    const endAnchor    = document.createComment(`/live-if:${ref}`);
    const paths        = getLivePaths(ifEl);

    // 2g: el="tag" -- optional container element wrapping the branch content.
    // If <if data-live el="div"> is used, branch content is placed inside a
    // <div> wrapper instead of bare comment anchors. The container persists
    // across branch changes (only its content is replaced), so focus/scroll
    // on the container itself is preserved.
    const elTag        = ifEl.getAttribute('el') || null;
    const container    = elTag ? document.createElement(elTag) : null;

    // 2g: copy any non-reserved attribute (class, id, data-testid, ...) from
    // <if> onto the container, so it can be styled/targeted like a normal element.
    if (container) {
      for (const attr of Array.from(ifEl.attributes)) {
        if (!RESERVED_IF_ATTRS.has(attr.name)) container.setAttribute(attr.name, attr.value);
      }
    }

    // Extract branch templates
    const { thenNodes, elseNodes } = extractBranches(ifEl);

    // Hooks: attribute names (null if not set).
    const afterHandlerName  = ifEl.getAttribute('data-after')  || null;
    const beforeHandlerName = ifEl.getAttribute('data-before') || null;

    // Active branch cleanup; updated on each branch switch
    let branchCleanup = /** @type {function(): void} */ (() => {});
    let currentCondition = false;
    // The currently active branch's root node, for the NEXT before-hook call
    // (container mode: always `container`; otherwise the branch's own first node).
    let currentBranchRoot = null;

    /**
     * Evaluates the condition and rebuilds the active branch in the DOM.
     * Order: before-hook (old branch) -> cleanup -> new render -> DOM update -> after-hook (new branch).
     */
    function reEvaluate() {
      const condition = evalLiveCondition(ifEl, store);
      if (condition === currentCondition) return;

      // 0. data-before hook: fires on the OLD (still in the DOM) branch, before it's torn down.
      callBlockHook(beforeHandlerName, currentBranchRoot, store, handlers, 'before');

      // 1. Cancel old branch subscriptions FIRST
      branchCleanup();

      // 2. Clone the new branch and run the full render pipeline
      const nodes      = condition ? thenNodes : elseNodes;
      const frag       = cloneToFragment(nodes);
      const newCleanup = renderFn(frag, context, store, handlers);
      branchCleanup    = newCleanup;

      // 3. Replace old DOM content with new branch
      let newRootEl;
      if (container) {
        // 2g: container mode -- clear container, insert new content inside it
        container.textContent = '';
        container.appendChild(frag);
        newRootEl = container;
      } else {
        const newNodes = Array.from(frag.childNodes);
        clearBetween(startAnchor, endAnchor);
        insertBeforeAnchor(endAnchor, frag);
        newRootEl = firstElementNode(newNodes);
      }
      currentCondition  = condition;
      currentBranchRoot = newRootEl;

      // 4. data-after hook: fires on the NEW branch, now that it's in the DOM.
      callBlockHook(afterHandlerName, newRootEl, store, handlers, 'after');
    }

    // Initial render
    const initialCondition = evalLiveCondition(ifEl, store);
    currentCondition       = initialCondition;
    const initialNodes     = initialCondition ? thenNodes : elseNodes;
    const initialFrag      = cloneToFragment(initialNodes);
    const initialCleanup   = renderFn(initialFrag, context, store, handlers);
    branchCleanup = initialCleanup;

    let initialRootEl;
    if (container) {
      // 2g: container mode -- replace <if> with [startAnchor, container, endAnchor]
      // Future branch changes only touch container's children, not the container itself.
      container.appendChild(initialFrag);
      ifEl.replaceWith(startAnchor, container, endAnchor);
      initialRootEl = container;
    } else {
      // Default: replace <if> with comment pair + initial branch content
      const initialNodesArr = Array.from(initialFrag.childNodes);
      ifEl.replaceWith(startAnchor, ...initialNodesArr, endAnchor);
      initialRootEl = firstElementNode(initialNodesArr);
    }
    currentBranchRoot = initialRootEl;

    // data-after also fires on the initial render -- the branch is placed in
    // the DOM here for the first time too, which is exactly when a
    // third-party widget would need to be initialized.
    callBlockHook(afterHandlerName, initialRootEl, store, handlers, 'after');

    // Subscribe to condition paths
    for (const path of paths) {
      allCleanups.push(store.subscribe(path, reEvaluate));
    }

    // Aggregate cleanup for this live-if: subscriptions + current active branch
    allCleanups.push(() => { branchCleanup(); });
  }

  return function cleanup() {
    for (const unsub of allCleanups) unsub();
    allCleanups.length = 0; // guard against double invocation
  };
}
