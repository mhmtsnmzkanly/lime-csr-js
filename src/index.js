/**
 * @module index
 * lime-csr.js -- main entry point and orchestration layer.
 *
 * Feature modules may import leaf helpers, but only this module controls the
 * render pipeline and mount orchestration order.
 *
 * RENDER PIPELINE ORDER (critical):
 *   1. expandPartials -- replace <partial>s with their contents (recursive).
 *   2. expandLoops    -- expand <for>s based on array elements.
 *   3. processAllIfs  -- select <if>/<else> branches.
 *   (1-3 may be nested, so loop until no special tags remain)
 *   4. resolveStatic  -- resolve remaining ${path} placeholders (top-level static).
 *   5. setupModelBindings -- data-model two-way form binding. RUNS FIRST (2h).
 *   6. setupBindings  -- data-text + {x}/data-x reactive bindings.
 *   7. setupShowBindings  -- data-show reactive native hidden-state binding.
 *   8. pluginRuntime.setupDirectives -- mount-scoped data-lime-* directives.
 *   9. setupLiveFors / setupLiveIfs -- recursive live blocks.
 *   (5-8 order matters: data-model precedes delegated data-on-* handlers.)
 *
 * WHY resolveStatic LAST:
 *   If called first, ${item.x} inside a <for> would be resolved in the wrong
 *   (top-level) context -> "". expandLoops already calls resolveStatic itself;
 *   only the top-level ${path}s (e.g. ${pageTitle}) need resolution after
 *   structural expansion.
 *
 * WHY setupBindings LAST:
 *   Binding before structure is fixed (partial/for/if resolved) would open
 *   subscriptions on nodes that will be deleted -> memory leak.
 *
 * pipeline() CALLBACK:
 *   expandLoops can receive pipeline() per item; this lets <if> and <partial>
 *   inside the loop resolve correctly in the item context (itemContext).
 *
 * data-live BOUNDARY (hasSpecialTags + inLiveBlock):
 *   A not-yet-expanded <if data-live>/<for data-live> block's INNER
 *   ordinary <partial>/<for>/<if> are not touched in this pass -- they would
 *   be rendered with the wrong (outer) context. That content is only processed
 *   by setupLiveIfs/setupLiveFors's renderFn (render()) with the correct
 *   branch/element context.
 *
 * STATIC <for> + <partial> BOUNDARY (RESOLVED):
 *   Previously: a <partial> inside a static (non-data-live) <for> that
 *   referenced a loop variable (data="item.x") would resolve with the wrong
 *   (outer) context. Now partials.js's inUnexpandedFor() defers such <partial>s;
 *   expandLoops's SAME-PASS pipeline() call handles them with the correct context.
 *   Pipeline ORDER DID NOT CHANGE -- only which <partial>s expandPartials touches.
 *
 * EVENT DELEGATION (mount() options.handlers -- NOT in render() PIPELINE):
 *   data-on-{event} (bindings-events.js) is NOT part of the render() pipeline;
 *   it sets up a single delegation listener on mount()'s `target` only.
 *   `options.handlers` not provided -> event delegation NOT set up (zero cost,
 *   backward compatible).
 *
 * LIFECYCLE HOOKS (2e):
 *   mount() options.beforeRender(context, store): called BEFORE pipeline.
 *   mount() options.afterRender(rootEl, store): called AFTER content appended to target.
 *   Both are optional and backward-compatible (omitting them changes nothing).
 *
 * BLOCK-LEVEL HOOKS (data-after/data-before) NEED `handlers` INSIDE render():
 *   Unlike data-on-* (bindings-events.js), which is delegation-based and lives
 *   entirely outside the render() pipeline, data-after/data-before on
 *   <if data-live>/<for data-live> (bindings-blocks.js/bindings-loops.js) are
 *   evaluated DURING setupLiveIfs/setupLiveFors -- when a branch/item is
 *   actually placed in or removed from the DOM. That happens on every
 *   reconcile, not just at mount() time, so `handlers` cannot be threaded in
 *   as a one-time delegation listener the way data-on-* is; it must be
 *   available to render() itself. render() therefore takes `handlers` as an
 *   explicit 4th parameter and passes it straight through to setupLiveFors/
 *   setupLiveIfs as a 5th argument, which those modules also forward on their
 *   own recursive renderFn(...) calls -- so nested live-blocks inside a
 *   branch/item see the same handlers dictionary. mount() passes
 *   options.handlers into the initial render() call. Omitting handlers is
 *   backward-compatible: data-after/data-before are simply skipped with a
 *   dev-mode warning if referenced without a handlers dictionary.
 */

import { getTemplate, resolveStatic } from './template.js';
import { expandPartials } from './partials.js';
import { expandLoops }    from './loops.js';
import { processAllIfs }  from './conditionals.js';
import { setupBindings }  from './bindings.js';
import { setupModelBindings } from './bindings-model.js';
import { setupShowBindings } from './bindings-show.js';
import { setupEventBindings } from './bindings-events.js';
import { setupLiveIfs }   from './bindings-blocks.js';
import { setupLiveFors }  from './bindings-loops.js';
import { errors }         from './errors.js';
import { inLiveBlock, inIgnoredBlock } from './shared.js';
import { createPluginRuntime } from './plugins.js';

// ── Re-exports for external consumers ────────────────────────────────────────
export { createStore, getByPath, setByPath } from './store.js';
export { getTemplate, resolveStatic, renderTemplate } from './template.js';
export { escapeHtml, safeAttr, safeUrl, safeStyleUrl } from './utils.js';
export { evalCondition, processAllIfs, OPERATORS } from './conditionals.js';
export { expandLoops } from './loops.js';
export { expandPartials } from './partials.js';
export { setupBindings } from './bindings.js';
export { setupModelBindings } from './bindings-model.js';
export { setupShowBindings } from './bindings-show.js';
export { setupEventBindings } from './bindings-events.js';
export { setDevMode, isDevMode, subscribeDiagnostics, warn } from './errors.js';
export { setupLiveIfs } from './bindings-blocks.js';
export { setupLiveFors } from './bindings-loops.js';
export { definePlugin, PLUGIN_API_VERSION } from './plugins.js';

// ── Infinite loop protection ─────────────────────────────────────────────────
const MAX_PIPELINE_ITERATIONS = 100;

// ── Last cleanup record per target ───────────────────────────────────────────
// WeakMap: automatically cleaned up when the target element is GC'd.
const mountedTargets = new WeakMap();

// ── Legacy mount() signature notice — fired at most once per page load ──────
let legacySignatureWarned = false;

/**
 * Distinguishes mount()'s options-object call style from the legacy
 * positional one, by the SECOND argument.
 *
 * Rule: a plain object carrying a `target` property is the options object —
 * `target` is the one option every new-style call must provide, and a legacy
 * `context` object has no reason to carry that key. Presence of the key is
 * the discriminator (not its validity): an invalid `target` in the options
 * object then fails on the exact same code path as an invalid positional
 * `target` — the two styles share all downstream behavior.
 *
 * @param {*} value - mount()'s second argument
 * @returns {boolean}
 */
function isMountOptions(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && 'target' in value;
}



/**
 * Is there a structural tag under root that the pipeline can STILL process?
 *
 * <if>/<for> with data-live are left to setupLiveIfs/setupLiveFors; the
 * pipeline does NOT touch them. Likewise, ordinary <partial>/<for>/<if>
 * INSIDE a not-yet-expanded live block also don't count this pass — they too
 * are only processed once the correct branch/item context is supplied by
 * renderFn (render()). Without this check, runPipeline would spin uselessly
 * up to the MAX_PIPELINE_ITERATIONS limit because of live-block content that
 * never advances.
 *
 * @param {Element|DocumentFragment} root
 * @returns {boolean}
 */
function hasSpecialTags(root) {
  // Ignored tags are never expanded, so they must not keep the pipeline pending.
  const pending = (selector) =>
    Array.from(root.querySelectorAll(selector)).some(
      (el) => !inLiveBlock(el) && !inIgnoredBlock(el),
    );

  return (
    pending('partial') ||
    pending('for:not([data-live])') ||
    pending('if:not([data-live])')
  );
}

/**
 * Runs the partial → for → if loop on the given fragment.
 * Also passed as a callback to expandLoops AND expandPartials; this way
 * inner partial/for/if resolve correctly with the loop item's / partial's
 * (isolated/inherited) context.
 *
 * @param {DocumentFragment|Element} frag
 * @param {Object}                   ctx
 * @param {number}                   [depth=0] - Partial recursion depth (internal; passed to expandPartials)
 */
function runPipeline(frag, ctx, depth = 0) {
  let iterations = 0;
  while (hasSpecialTags(frag)) {
    if (++iterations > MAX_PIPELINE_ITERATIONS) {
      errors.pipelineDepthLimit(MAX_PIPELINE_ITERATIONS, frag);
      break;
    }
    // Passing the pipeline callback: so inner if/for/partial also resolve
    // correctly within the partial's own isolated context (see partials.js).
    expandPartials(frag, ctx, depth, runPipeline);
    // Passing the pipeline callback: so inner if/partial also resolve within the loop item's context
    expandLoops(frag, ctx, runPipeline);
    processAllIfs(frag, ctx);
  }
}

/**
 * Applies the full render pipeline to a fragment and returns a cleanup function.
 *
 * Pure function: not tied to global state, takes store and context as parameters.
 * A reactive block (<if data-live>, reactive <for>) will call this function
 * again for a subtree in the future: when the condition/list changes, the old
 * subtree is cleaned up, the new fragment is processed with render() and placed.
 *
 * @param {DocumentFragment|Element} fragment - Cloned fragment or render root.
 * @param {Object}           context  - For static ${path} resolution (stateless)
 * @param {import('./store.js').Store|null} store - For reactive bindings
 * @param {Object<string, function(Event, Element): void>} [handlers] - For
 *   data-on-*'s handler lookup (bindings-events.js, via mount() only) AND
 *   for block-level data-after/data-before hooks (bindings-blocks.js/
 *   bindings-loops.js, evaluated here). Optional; omitting it just means
 *   data-after/data-before are skipped with a dev-mode warning if referenced.
 * @param {Document} [ownerDocument] - Destination document for shared runtime
 *   resources. mount() supplies target.ownerDocument; recursive live renders
 *   retain the same document.
 * @param {Object|null} [pluginRuntime] - Internal mount-scoped plugin runtime.
 * @returns {function(): void} cleanup — cancels the subscriptions from setupBindings
 */
export function render(fragment, context, store, handlers, ownerDocument, pluginRuntime) {
  // Structural elements are expanded before the fixed directive setup stage.
  // Diagnose reserved targets now so a static <if>/<for>/<partial> cannot
  // silently discard an invalid plugin directive during expansion.
  pluginRuntime?.diagnoseStructuralTargets(fragment);

  // 1-3. Structural expansion: loop until no partial/for/non-live-if remains.
  //      <if>s with data-live are PRESERVED at this stage — left to setupLiveIfs.
  runPipeline(fragment, context);

  // 4. Resolve the remaining static ${path} placeholders.
  resolveStatic(fragment, context);

  // 5b. Two-way form binding (data-model). RUNS FIRST (2h): when data-model
  //     and data-on-input are on the same element, model's listener is
  //     registered before data-on-* handlers, so the store is up to date
  //     by the time the application handler runs.
  //     Same live-block skipping rule (bindings-model.js filter).
  const modelCleanup = store ? setupModelBindings(fragment, store) : () => {};

  // 5c. Reactive text/attr bindings (data-text + {x}/data-x). Runs after
  //     model bindings per 2h ordering. Live-block content bound by
  //     setupLiveFors/setupLiveIfs below -- no double-subscribe.
  const bindingsCleanup = store ? setupBindings(fragment, store) : () => {};

  // 5d. Reactive visibility (data-show). RUNS BEFORE DOM APPEND so the
  //     initial state has no FOUC (see bindings-show.js).
  //     Same live-block skipping rule; order vs. 5b/5c does not matter.
  const rootDocument = fragment.ownerDocument;
  const visibilityDocument = ownerDocument ?? (rootDocument?.head ? rootDocument : document);
  const showCleanup = store ? setupShowBindings(fragment, store, visibilityDocument) : () => {};

  // 5e. Mount-scoped plugin directives. This is a fixed stage: plugins cannot
  //      reorder or replace Lime's pipeline. With no plugins, no runtime is
  //      created and no plugin-specific DOM scan occurs.
  const pluginCleanup = pluginRuntime
    ? pluginRuntime.setupDirectives(fragment, context)
    : () => {};

  // Recursive live-block fragments must install shared resources in the same
  // destination document as the initial mount, even when cloned template
  // content reports an inert owner document.
  const recursiveRender = (liveFragment, liveContext, liveStore, liveHandlers) =>
    render(
      liveFragment,
      liveContext,
      liveStore,
      liveHandlers,
      visibilityDocument,
      pluginRuntime,
    );

  // 6. Reactive <for data-live>: key-based diff + identity preservation.
  //    ORDER CRITICAL: setupLiveFors runs first. <if data-live> inside a
  //    <for data-live> is handled by the recursive render() call inside
  //    renderFn; by the time setupLiveIfs runs, those are already anchors.
  //    `handlers` is passed through for data-after/data-before lookups; the
  //    module's own recursive renderFn(...) calls also forward it, since
  //    render() itself accepts (and needs) a 4th `handlers` argument.
  const liveForCleanup = store
    ? setupLiveFors(fragment, context, store, recursiveRender, handlers)
    : () => {};

  // 7. Reactive <if data-live>: tear-down/rebuild + branch cleanup.
  //    render() itself is passed as renderFn; re-called on branch change.
  //    `handlers` is threaded through the same way as setupLiveFors above.
  const liveCleanup = store
    ? setupLiveIfs(fragment, context, store, recursiveRender, handlers)
    : () => {};

  return function cleanup() {
    modelCleanup();
    bindingsCleanup();
    showCleanup();
    pluginCleanup();
    liveForCleanup();
    liveCleanup();
  };
}

/**
 * Fetches a template, renders it, and mounts it to a DOM target.
 * If called again on the same target: old cleanup runs, content cleared,
 * new content mounted (page/component transition).
 *
 * PREFERRED SIGNATURE — a single options object as the 2nd argument:
 *   mount('page', {
 *     target,    // required Element — also the call-style discriminator
 *     context,   // optional, default {} — static ${path} data
 *     store,     // optional — omit and all reactive features are skipped
 *     handlers,  // optional — event delegation + data-after/data-before
 *     computed,  // optional — mount-scoped computeds, see below
 *     plugins,   // optional — mount-scoped Plugin API v1 definitions
 *     beforeRender, afterRender, // optional lifecycle hooks
 *   });
 *
 * LEGACY SIGNATURE (deprecated, still fully supported):
 *   mount(templateName, context, target, store, options)
 *   Detected by the 2nd argument NOT carrying a `target` key (see
 *   isMountOptions). Emits a one-time MOUNT_LEGACY_SIGNATURE dev-mode notice.
 *
 * MOUNT-SCOPED COMPUTEDS (options.computed):
 *   `{ path: { deps: string[], fn: () => * }, ... }` — each entry is
 *   registered via store.computed() and its dispose is pushed into THIS
 *   mount's cleanup chain: cleanup()/unmount() automatically stops the
 *   recomputes AND removes the computed values from state (see
 *   store.computed's dispose semantics). Requires `store`; `computed`
 *   without a store → COMPUTED_WITHOUT_STORE warning, registration skipped.
 *
 * @param {string}                         templateName
 * @param {Object}                         context - Legacy: static context.
 *   New style: the options object (carries `target`).
 * @param {Element}                        [target] - Legacy style only.
 * @param {import('./store.js').Store|null} [store] - Legacy style only.
 * @param {{
 *   handlers?: Object<string, function(Event, Element): void>,
 *   computed?: Object<string, { deps: string[], fn: function(): * }>,
 *   plugins?: ReadonlyArray<Object>,
 *   beforeRender?: function(Object, import('./store.js').Store): void,
 *   afterRender?:  function(Element, import('./store.js').Store): void
 * }} [options={}]
 *   handlers: event delegation (bindings-events.js). Omit for zero cost.
 *   computed: mount-scoped computeds (disposed by cleanup/unmount).
 *   beforeRender(context, store): called BEFORE the render pipeline.
 *   afterRender(rootEl, store):   called AFTER content is appended to target.
 *   All optional and backward-compatible.
 * @returns {function(): void} cleanup
 */
export function mount(templateName, context, target, store, options = {}) {
  if (isMountOptions(context)) {
    // New style: the 2nd argument IS the options object. It doubles as
    // `options` below (handlers/computed/lifecycle hooks are read off it).
    options = context;
    ({ context = {}, target, store = null } = options);
  } else if (!legacySignatureWarned) {
    legacySignatureWarned = true;
    errors.mountLegacySignature();
  }

  // If already mounted on this target: cancel old subscriptions and clear content
  const previous = mountedTargets.get(target);
  if (previous) {
    previous.cleanup();
    // textContent = '' removes all child nodes (faster than innerHTML, no XSS risk)
    target.textContent = '';
  }

  // Existing lifecycle order is preserved for plugin-free mounts: this hook
  // historically runs before template lookup and before computed registration.
  if (typeof options.beforeRender === 'function') {
    options.beforeRender(context, store);
  }

  const fragment = getTemplate(templateName);
  if (!fragment) {
    const available = Array.from(document.querySelectorAll('template[id^="tpl-"]'))
      .map((t) => t.id.slice(4));
    errors.mountTemplateNotFound(templateName, available, target);
    return () => {};
  }

  // Mount-scoped computeds: registered AFTER the template check (a failed
  // mount must not leak registrations) and BEFORE render(), so bindings see
  // the initial computed values. Disposed in cleanup() below.
  const computedDisposes = [];
  if (options.computed) {
    if (!store) {
      errors.computedWithoutStore(Object.keys(options.computed));
    } else {
      for (const [path, def] of Object.entries(options.computed)) {
        computedDisposes.push(store.computed(path, def.deps, def.fn));
      }
    }
  }

  // Plugin runtime exists only for this successful mount. Reusing a frozen
  // definition in another mount creates fresh state and cleanup stacks there.
  const pluginRuntime = options.plugins === undefined
    ? null
    : createPluginRuntime(options.plugins, { target, store, context });
  pluginRuntime?.beforeMount();

  const renderCleanup = render(
    fragment,
    context,
    store,
    options.handlers,
    target.ownerDocument,
    pluginRuntime,
  );
  target.appendChild(fragment);

  pluginRuntime?.afterMount();

  // 2e: afterRender lifecycle hook (called after content is in the DOM)
  if (typeof options.afterRender === 'function') {
    options.afterRender(target, store);
  }

  // Event delegation: root is target (stable mount-lifetime root -- reactive
  // inner changes don't affect it, see bindings-events.js).
  const eventsCleanup = options.handlers
    ? setupEventBindings(target, store, options.handlers)
    : () => {};

  let active = true;
  const cleanup = function cleanup() {
    if (!active) return;
    active = false;
    renderCleanup();
    eventsCleanup();
    pluginRuntime?.cleanup();
    for (const dispose of computedDisposes) dispose();
    computedDisposes.length = 0; // guard against double cleanup calls
  };

  mountedTargets.set(target, { cleanup });
  return cleanup;
}

/**
 * Cancels the reactive bindings on target and clears its content.
 *
 * @param {Element} target
 */
export function unmount(target) {
  const entry = mountedTargets.get(target);
  if (entry) {
    entry.cleanup();
    mountedTargets.delete(target);
  }
  target.textContent = '';
}
