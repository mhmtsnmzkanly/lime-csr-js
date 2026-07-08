/**
 * @module partials
 * @description Expands <partial name="..."> elements from templates.
 *
 * Data passing — isolation model:
 *   <partial name="avatar" data="user.profile"></partial>
 *   - data="user.profile" → resolved via getByPath in the parent context.
 *   - The resolved object becomes the partial's NEW context; the parent context is INVISIBLE.
 *   - If data is absent: renders with an empty object {}.
 *   - Inside the partial, ${name} → the "name" field of the new (resolved) context.
 *
 * Extra props — passing multiple fields:
 *   <partial name="like-button" data="post" action="likeAction" count="likeCount"></partial>
 *   - Every attribute OTHER THAN "name"/"data" is a PROP: its value (a raw path
 *     string, NOT WRAPPED in ${...} — same rule as data) is resolved via
 *     getByPath in the parent context and added ON TOP of data (if present)
 *     to the partial context (prop wins on collision).
 *   - The attribute name becomes the context key VERBATIM. Since HTML attribute
 *     names are normalized to lowercase, multi-word prop names must be written
 *     in kebab-case (e.g. state-class="x" → context["state-class"], read
 *     inside the partial as ${state-class} — a single-segment literal key, not a path).
 *   - If data is not given at all: the context consists only of props (instead of {}).
 *
 * Recursive expansion:
 *   - If a new <partial> appears inside the expanded fragment, it is processed
 *     recursively with the same context. If MAX_DEPTH (50) is exceeded, a
 *     warning is issued and expansion stops.
 *
 * THE pipeline() CALLBACK (same pattern as loops.js):
 *   - A partial's OWN template may contain <if>/<for> (e.g. a "verified"
 *     badge). These must be resolved with the partial's isolated context
 *     (partialContext) — not the caller's context. expandPartials alone only
 *     recurses into NESTED <partial>s; it does not process <if>/<for>.
 *     index.js passes its own pipeline() function (expandPartials→expandLoops→
 *     processAllIfs) as a callback; this way the partial content goes through
 *     the full pipeline with the correct (isolated) context. Without a
 *     pipeline (direct call), only nested <partial>s are recursed — legacy behavior.
 *
 * Important:
 *   - This module does NOT import conditionals.js; orchestration happens in index.js.
 *   - Reactivity (data-live) is NOT in this module — handled in
 *     bindings-blocks.js/bindings-loops.js. But if a <partial> is INSIDE a
 *     not-yet-expanded <if data-live>/<for data-live> block, it is SKIPPED
 *     here too: otherwise it would be rendered early with the wrong (outer)
 *     context — the correct (branch/item) context is only known by
 *     setupLiveIfs/setupLiveFors's renderFn call.
 *   - For the same reason, if a <partial> is INSIDE a not-yet-expanded
 *     ordinary (non-data-live) <for>, it is also SKIPPED: since expandPartials
 *     runs BEFORE expandLoops in the same pass, the "as" variable does not yet
 *     exist in context. The correct (item) context is supplied by
 *     expandLoops's pipeline() call later in the same pass (see inUnexpandedFor).
 *   - <partial> leaves no trace in the final DOM; only the expanded content remains.
 *   - HTML5: <partial/> is not treated as void; use <partial ...></partial>.
 */

import { getByPath } from './store.js';
import { renderTemplate } from './template.js';
import { errors } from './errors.js';
import { inLiveBlock, inUnexpandedFor } from './shared.js';

/** Maximum recursion depth against infinite loops. */
const MAX_DEPTH = 50;



/**
 * Expands every <partial> element under root.
 * Recurses up to MAX_DEPTH if a new <partial> appears inside the expanded fragment.
 *
 * @param {Element|DocumentFragment} root    - Root to traverse
 * @param {Object}                   context - Parent context (for resolving the data path)
 * @param {number}                   [depth=0] - Recursion depth (internal)
 * @param {function(DocumentFragment, Object, number): void} [pipeline=null]
 *   If given (comes from index.js): the partial content is processed with
 *   this callback (the full if/for/partial pipeline) in partialContext.
 *   If not: only nested <partial>s are recursed (legacy/standalone call behavior).
 * @returns {void}
 */
export function expandPartials(root, context, depth = 0, pipeline = null) {
  // Grab all <partial>s at once; don't traverse a live list
  const partials = Array.from(root.querySelectorAll('partial'));

  if (depth >= MAX_DEPTH) {
    // Warning and returning is NOT enough: if unprocessed <partial>s remain in
    // the DOM, the caller's (index.js) hasSpecialTags/while loop (which uses
    // the pipeline callback) would think "there's still work" and retry —
    // hitting the depth limit again on every attempt. This causes an
    // infinite/exponentially growing amount of work. So the remaining
    // <partial>s are removed (degrade gracefully).
    if (partials.length > 0) {
      errors.partialDepthLimit(MAX_DEPTH, root);
      for (const el of partials) el.remove();
    }
    return;
  }

  for (const partialEl of partials) {
    // May already have left the DOM via replaceWith if it was inside an already-processed partial
    if (!root.contains(partialEl)) continue;

    // Don't touch it if it's inside a live-if/live-for — the correct context
    // will already be supplied per branch/item by renderFn (render()).
    if (inLiveBlock(partialEl)) continue;

    // Also don't touch it if it's inside a not-yet-expanded ordinary <for> —
    // the "as" variable isn't in context yet; the correct context will be
    // supplied by expandLoops's pipeline() call in the same pass (see inUnexpandedFor).
    if (inUnexpandedFor(partialEl)) continue;

    const name = partialEl.getAttribute('name');
    if (!name) {
      errors.partialMissingName(partialEl);
      partialEl.remove();
      continue;
    }

    // data attribute -> resolve in parent context -> base of partial's isolated context
    const dataPath = partialEl.getAttribute('data');
    const baseContext = dataPath ? (getByPath(context, dataPath) ?? {}) : {};

    // Extra props: attributes OTHER THAN "name", "data", and any "data-*" are props.
    // 2f rule: data-* attributes are reserved for the lime-csr engine (data-model,
    // data-text, etc.) and CANNOT be prop names. Non-data-* attrs override the base
    // context key of the same name (prop wins over data default on collision).
    const partialContext = { ...baseContext };
    for (const attr of Array.from(partialEl.attributes)) {
      if (attr.name === 'name' || attr.name === 'data') continue;
      if (attr.name.startsWith('data-')) continue; // 2f: reserved for engine
      partialContext[attr.name] = getByPath(context, attr.value);
    }

    // renderTemplate: finds the template, clones it, resolves ${path}, returns a fragment
    const fragment = renderTemplate(name, partialContext);

    if (!fragment) {
      const available = Array.from(document.querySelectorAll('template[id^="tpl-"]'))
        .map((t) => t.id.slice(4));
      errors.partialNotFound(name, available, partialEl);
      partialEl.remove();
      continue;
    }

    // Process the expanded fragment with the partial's own (isolated) context.
    // If pipeline is given: the full if/for/partial pipeline (resolves
    // <if>/<for> too, with the correct context). Otherwise only nested
    // <partial>s are recursed.
    if (pipeline) {
      pipeline(fragment, partialContext, depth + 1);
    } else {
      expandPartials(fragment, partialContext, depth + 1);
    }

    // Replace the <partial> element with the processed fragment — leaves no trace
    partialEl.replaceWith(fragment);
  }
}
