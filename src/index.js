/**
 * @module index
 * Lime CSR JS -- thin facade and public API entry point.
 *
 * Architecture:
 *   - Orchestration delegates entirely to an isolated defaultEngine instance
 *     configured with the 7 standard unprivileged modules:
 *     partials, conditionals, loops, model, text, show, events.
 *   - Zero monolithic pipelines or ad-hoc directive scans.
 *   - Extension mechanism is strictly Module-based via createEngine and defineModule.
 *   - Legacy Plugin API (definePlugin) has been removed in v0.3.0.
 */

import { createEngine } from './core/engine.js';
import {
  partials,
  conditionals,
  loops,
  text,
  show,
  model,
  events,
} from './modules/index.js';

// ── Default Engine Singleton (Private) ───────────────────────────────────────
const defaultEngine = createEngine({
  modules: [
    partials(),
    conditionals(),
    loops(),
    model(),
    text(),
    show(),
    events(),
  ],
});

/**
 * Public mount facade delegating to defaultEngine.
 *
 * Target API:
 *   mount(target, template, store, options)
 *
 * @param {Element|string} target - DOM Element or CSS selector string
 * @param {string|Element|DocumentFragment} [template] - Template name, HTML string, or template element
 * @param {import('./store.js').Store|Object|null} [store=null] - Reactive Store, or options if store omitted
 * @param {Object} [options={}] - Mount configuration options (handlers, signal, beforeRender, afterRender)
 * @returns {Function} Mount instance (callable cleanup with .unmount, .target, .store, .scope, .active properties)
 */
export function mount(target, template, store, options = {}) {
  return defaultEngine.mount(target, template, store, options);
}

/**
 * Public unmount facade delegating to defaultEngine.
 * Cancels reactive bindings on target/instance and clears its DOM contents.
 *
 * @param {Element|string|Object} targetOrInstance
 */
export function unmount(targetOrInstance) {
  defaultEngine.unmount(targetOrInstance);
}

/**
 * Public render facade delegating to defaultEngine.
 * Applies Transform and Link phases to an arbitrary node or fragment.
 *
 * @param {DocumentFragment|Element} nodeOrFragment
 * @param {Object} [contextOrOptions={}]
 * @param {Object} [store=null]
 * @param {Object} [handlers=null]
 * @param {Document} [ownerDocument=null]
 * @returns {Function} Callable cleanup with { element, scope, store, cleanup, cleanupStack }
 */
export function render(nodeOrFragment, contextOrOptions = {}, store = null, handlers = null, ownerDocument = null) {
  let options;
  if (
    contextOrOptions &&
    typeof contextOrOptions === 'object' &&
    ('scope' in contextOrOptions ||
      'store' in contextOrOptions ||
      'context' in contextOrOptions ||
      'handlers' in contextOrOptions ||
      'document' in contextOrOptions)
  ) {
    options = contextOrOptions;
  } else {
    options = {
      context: contextOrOptions || {},
      store: store || null,
      handlers: handlers || null,
      document: ownerDocument || null,
    };
  }

  const result = defaultEngine.render(nodeOrFragment, options);

  const cleanup = function cleanup() {
    result.cleanup();
  };
  cleanup.element = result.element;
  cleanup.scope = result.scope;
  cleanup.store = result.store;
  cleanup.cleanup = result.cleanup;
  cleanup.cleanupStack = result.cleanupStack;

  return cleanup;
}

// ── Re-exports for external consumers ────────────────────────────────────────
export { createStore, getByPath, setByPath } from './store.js';
export { getTemplate, resolveStatic, renderTemplate } from './template.js';
export { escapeHtml, safeAttr, safeUrl, safeStyleUrl } from './utils.js';
export { setDevMode, isDevMode, subscribeDiagnostics, warn, reportError, error, loadDevMessages } from './errors.js';

// ── Module Kernel Public Exports ─────────────────────────────────────────────
export { createEngine } from './core/engine.js';
export { defineModule } from './core/registry.js';
export { attr, attrs, tag, pattern } from './core/triggers.js';
export { createScope } from './core/scope.js';
export {
  partials,
  conditionals,
  loops,
  text,
  show,
  model,
  events,
} from './modules/index.js';
