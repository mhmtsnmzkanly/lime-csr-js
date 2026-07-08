/**
 * @module bindings-show
 * Reactive visibility toggle — `data-show="path"` (the `x-show` counterpart).
 *
 * WHAT IT DOES
 *   <div data-show="isModalOpen">...</div>
 *   The element is visible if the store path is truthy; `display:none` if falsy.
 *   NO EVAL — path is a fixed string, the value is interpreted only via
 *   `Boolean()` (same logic as the is-truthy operator).
 *
 * DIFFERENCE FROM `<if data-live>` (CRITICAL):
 *   `<if data-live>` COMPLETELY REMOVES the branch from the DOM and rebuilds
 *   it when the condition changes — input value/scroll/animation state/DOM
 *   identity are LOST. `data-show`, on the other hand, NEVER REMOVES the
 *   element from the DOM; it only hides/shows it via CSS `display` — the
 *   element keeps living (see the "Two-way binding" and "Condition" sections
 *   in README). This is the right tool for modals/accordions/tabs — anything
 *   needing CSS transitions or preserved form state.
 *
 * PRESERVING THE ORIGINAL display VALUE (design decision #1):
 *   A fixed `"block"` is NOT assigned when hiding — this would break elements
 *   with a `display:flex`/`grid`/`inline-block` CSS rule (dropping a flex
 *   container down to `block`). Instead: the element's inline `style.display`
 *   value AT SETUP TIME (`originalDisplay`) is captured ONCE; the value
 *   written to the DOM in the "show" state is ALWAYS this original value —
 *   so CSS's own (stylesheet-derived) display rule is restored as-is. In the
 *   "hide" state, `display:none` is assigned as an inline style (overriding
 *   everything in CSS — required for hiding to be guaranteed).
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
import { inLiveBlock } from './shared.js';

const SHOW_ATTR = 'data-show';



/**
 * Reactively binds every [data-show] element under root to the store.
 * Opens subscriptions; the returned cleanup() cancels all of them.
 *
 * @param {Element|DocumentFragment} root
 * @param {import('./store.js').Store} store
 * @returns {function(): void} cleanup
 */
export function setupShowBindings(root, store) {
  const cleanups = [];

  const elements = [
    ...(root.nodeType === Node.ELEMENT_NODE && root.hasAttribute?.(SHOW_ATTR) && !inLiveBlock(root)
      ? [root]
      : []),
    ...Array.from(root.querySelectorAll(`[${SHOW_ATTR}]`)).filter((el) => !inLiveBlock(el)),
  ];

  for (const el of elements) {
    const path = el.getAttribute(SHOW_ATTR);
    if (!path) {
      errors.showMissingPath(el);
      continue;
    }

    // Capture ONCE: the "original" inline display, unaffected by any toggle.
    // The "show" state always returns to THIS — CSS's own display rule isn't broken.
    const originalDisplay = el.style.display;

    const apply = (val) => {
      el.style.display = Boolean(val) ? originalDisplay : 'none';
    };

    apply(store.get(path)); // initial state — before the fragment is added to the DOM (no FOUC)

    cleanups.push(store.subscribe(path, apply));
  }

  return function cleanup() {
    for (const unsub of cleanups) unsub();
    cleanups.length = 0; // guard against double cleanup calls
  };
}
