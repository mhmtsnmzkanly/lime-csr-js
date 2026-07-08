/**
 * @module loops
 * @description Statically expands <for each="..." as="..."> lists in the DOM.
 *
 * Usage:
 *   <for each="comments" as="comment">
 *     <p>${comment.body}</p>
 *   </for>
 *
 * SCOPE DIFFERENCE — contrast with partial isolation:
 *   - partial: isolated context — only the "data" object is visible, parent is hidden.
 *   - for:     INHERITED context — parent context is preserved, "as" (and index) are added on top.
 *   Accessing outer variables (e.g. ${post.title}) inside <for> is natural.
 *   In a nested <for>, the inner "as" naturally shadows the outer "as" via spread.
 *
 * Other rules:
 *   - Empty array → <for> is removed, nothing is printed (not an error).
 *   - "each" is not an array → warning + <for> is removed.
 *   - <for> leaves no trace in the final DOM; only the expanded content remains.
 *   - Nested <for> is processed recursively; inner <partial>/<if> are ordered by index.js.
 *   - Reactive <for> (updates on list change) is NOT in this module — it's in bindings.js.
 *   - Does NOT import conditionals.js or partials.js; orchestration lives in index.js.
 *   - HTML5: <for/> is not treated as void; use <for ...></for>.
 */

import { getByPath } from './store.js';
import { resolveStatic } from './template.js';
import { errors } from './errors.js';

/**
 * Is the element inside a not-yet-expanded <if data-live> or <for data-live>
 * block? (Consistent with the same pattern in bindings.js.)
 *
 * @param {Element} el
 * @returns {boolean}
 */
function inLiveBlock(el) {
  return !!(el.closest?.('if[data-live]') || el.closest?.('for[data-live]'));
}

/**
 * Expands every <for> element under root.
 * For each array item, <for>'s content is cloned and resolved with the inherited context.
 *
 * @param {Element|DocumentFragment} root    - Root to traverse
 * @param {Object}                   context - Context for path resolution
 * @returns {void}
 */
export function expandLoops(root, context, pipeline = null) {
  // Copy up front to avoid the live-NodeList problem
  const fors = Array.from(root.querySelectorAll('for'));

  for (const forEl of fors) {
    // May already have left the DOM via replaceWith if it was inside an already-processed <for>
    if (!root.contains(forEl)) continue;

    // data-live → reactive list; left to bindings-loops.js, don't touch here.
    if (forEl.hasAttribute('data-live')) continue;

    // Also don't touch it if it's inside a not-yet-expanded live-if/live-for block —
    // the correct (branch/item) context only arrives via renderFn's (render()) call.
    if (inLiveBlock(forEl)) continue;

    const each      = forEl.getAttribute('each');
    const as        = forEl.getAttribute('as');
    const indexAttr = forEl.getAttribute('index'); // optional: 0, 1, 2...

    if (!each || !as) {
      errors.forMissingAttr(forEl);
      forEl.remove();
      continue;
    }

    const list = getByPath(context, each);

    if (!Array.isArray(list)) {
      errors.forNotArray(each, list === null ? 'null' : typeof list, forEl);
      forEl.remove();
      continue;
    }

    // Empty array: remove <for>, nothing is printed — this is not an error
    if (list.length === 0) {
      forEl.remove();
      continue;
    }

    // Store <for>'s content as template nodes; don't mutate the original
    const templateNodes = Array.from(forEl.childNodes).map((n) => n.cloneNode(true));

    const allNodes = [];

    for (let i = 0; i < list.length; i++) {
      const item = list[i];

      // Inherited context: UNLIKE partial, the parent context is preserved.
      // "as" (and "index" if present) is added on top; in a nested for, the
      // inner "as" naturally shadows the outer "as" via spread.
      const itemContext = { ...context, [as]: item };
      if (indexAttr) itemContext[indexAttr] = i;

      // Clone the content nodes independently for each item
      const frag = document.createDocumentFragment();
      for (const node of templateNodes) frag.appendChild(node.cloneNode(true));

      // Static ${path} resolution: text nodes + attributes
      resolveStatic(frag, itemContext);

      // Process inner structural tags.
      // If pipeline is given (comes from index.js): resolve partial+for+if all in the CORRECT context.
      // If not (direct call / legacy behavior): only recurse into inner <for>s.
      if (pipeline) {
        pipeline(frag, itemContext);
      } else {
        expandLoops(frag, itemContext);
      }

      // Move nodes into allNodes (removed from frag, order preserved)
      allNodes.push(...Array.from(frag.childNodes));
    }

    // Replace <for> with all the rendered content; leaves no trace
    forEl.replaceWith(...allNodes);
  }
}
