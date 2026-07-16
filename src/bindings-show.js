/**
 * @module bindings-show
 * Reactive visibility toggle — `data-show="path"` (the `x-show` counterpart).
 *
 * WHAT IT DOES
 *   <div data-show="isModalOpen">...</div>
 *   The element is visible if the store path is truthy; `hidden` if falsy.
 *   NO EVAL — path is a fixed string, the value is interpreted only via
 *   `Boolean()` (same logic as the is-truthy operator).
 *
 * DIFFERENCE FROM `<if data-live>` (CRITICAL):
 *   `<if data-live>` COMPLETELY REMOVES the branch from the DOM and rebuilds
 *   it when the condition changes — input value/scroll/animation state/DOM
 *   identity are LOST. `data-show`, on the other hand, NEVER REMOVES the
 *   element from the DOM; it only manages the native `hidden` state — the
 *   element keeps living (see the "Two-way binding" and "Condition" sections
 *   in README). This is the right tool for modals/accordions/tabs — anything
 *   needing CSS transitions or preserved form state.
 *
 * INLINE DISPLAY IS APPLICATION-OWNED (design decision #1):
 *   Lime never reads or writes `style.display`. Visibility is represented by
 *   the native `hidden` attribute, while one scoped framework rule ensures a
 *   display utility class cannot override that state. The browser and the
 *   application's styles remain responsible for the visible layout.
 *
 * NO FOUC (design decision #2):
 *   setupShowBindings runs in index.js's render() flow BEFORE the fragment is
 *   added to the DOM (before mount()'s `target.appendChild` call). So the
 *   initial state is applied correctly from the start, with no
 *   "flash of visible content, then disappear" (the fragment is already
 *   invisible/detached while being hidden).
 *
 * ALWAYS REACTIVE (design decision #3):
 *   `data-*` present = reactive (existing project convention). Anyone wanting
 *   static/one-time hiding already writes plain CSS ("display:none" or a
 *   class) — no separate "static data-show" variant is needed.
 *
 * OUT OF SCOPE (same pattern as bindings.js/bindings-model.js):
 *   data-show elements INSIDE a not-yet-expanded <if data-live>/<for
 *   data-live> block are NOT bound here — that content is bound only by
 *   renderFn's (render()) call, in its own (correct) branch/item context.
 */

import { errors } from './errors.js';
import { inLiveBlock, inIgnoredBlock } from './shared.js';

const SHOW_ATTR = 'data-show';
const SHOW_STYLE_ID = 'lime-csr-data-show-style';
const SHOW_STYLE_RULE = '[data-show][hidden] { display: none !important; }';

/**
 * Installs the scoped data-show compatibility rule once in the owning
 * document. Looking up the stable id in the document (rather than tracking a
 * module-global flag) keeps iframe/secondary documents independent.
 *
 * @param {Document} doc
 */
function ensureShowStyle(doc) {
  if (doc.getElementById(SHOW_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = SHOW_STYLE_ID;
  style.textContent = SHOW_STYLE_RULE;
  (doc.head ?? doc.documentElement).appendChild(style);
}

/**
 * Reactively binds every [data-show] element under root to the store.
 * Opens subscriptions; the returned cleanup() cancels all of them.
 *
 * @param {Element|DocumentFragment} root
 * @param {import('./store.js').Store} store
 * @param {Document} [ownerDocument] - Actual destination document. Needed
 *   when root is cloned template content whose inert owner document has no head.
 * @returns {function(): void} cleanup
 */
export function setupShowBindings(root, store, ownerDocument) {
  const cleanups = [];

  const elements = [
    ...(root.nodeType === Node.ELEMENT_NODE && root.hasAttribute?.(SHOW_ATTR) && !inLiveBlock(root) && !inIgnoredBlock(root)
      ? [root]
      : []),
    ...Array.from(root.querySelectorAll(`[${SHOW_ATTR}]`)).filter((el) => !inLiveBlock(el) && !inIgnoredBlock(el)),
  ];

  if (elements.length > 0) {
    const rootDocument = root.ownerDocument ?? root;
    const doc = ownerDocument ?? (rootDocument.head ? rootDocument : document);
    ensureShowStyle(doc);
  }

  for (const el of elements) {
    const path = el.getAttribute(SHOW_ATTR);
    if (!path) {
      errors.showMissingPath(el);
      continue;
    }

    const apply = (val) => {
      el.hidden = !val;
    };

    apply(store.get(path)); // initial state — before the fragment is added to the DOM (no FOUC)

    cleanups.push(store.subscribe(path, apply));
  }

  return function cleanup() {
    for (const unsub of cleanups) unsub();
    cleanups.length = 0; // guard against double cleanup calls
  };
}
