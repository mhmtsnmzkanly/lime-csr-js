/**
 * @module core/context
 * ModuleContext and Unified LIFO Cleanup Stack for the Module Kernel.
 *
 * Invariants:
 *   1. Single unified LIFO cleanup stack: `ctx.onCleanup(fn)` and returned
 *      cleanups from `setup()` attach to the exact same stack.
 *   2. Cleanup is idempotent (runs exactly once).
 *   3. Cleanup failure isolation: If one cleanup throws, it reports
 *      `MODULE_CLEANUP_FAILED` and remaining cleanups execute unconditionally.
 *   4. Asynchronous deactivation: Once cleanup runs, `activity.active` is set
 *      to false; pending microtasks/watches silently abort.
 *   5. Context strictly encapsulates Kernel internals; registry and router
 *      are never exposed on ModuleContext.
 */

import { reportError, warn } from '../errors.js';
import { setNodeOwner } from './ownership.js';
import { watchScopePath } from './scope.js';

/**
 * Creates a single, unified LIFO cleanup stack.
 *
 * @returns {Object} CleanupStack manager
 */
export function createCleanupStack() {
  const stack = [];
  const activity = { active: true };

  /**
   * Registers a cleanup callback to the stack.
   *
   * @param {Function} callback
   * @returns {Function} the registered callback
   */
  function onCleanup(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('onCleanup(callback) requires a function.');
    }
    stack.push(callback);
    return callback;
  }

  /**
   * Attaches a cleanup function returned from a trigger setup() or lifecycle hook.
   * Pushed to the exact same LIFO stack.
   *
   * @param {*} returnedCleanup
   */
  function attachSetupCleanup(returnedCleanup) {
    if (typeof returnedCleanup === 'function') {
      stack.push(returnedCleanup);
    }
  }

  /**
   * Executes all registered cleanups in strict LIFO (reverse registration) order.
   * Guaranteed to be idempotent and fault-isolated.
   */
  function run(info) {
    if (!activity.active) return;
    activity.active = false;

    while (stack.length > 0) {
      const cleanup = stack.pop();
      try {
        cleanup(info);
      } catch (err) {
        reportError('MODULE_CLEANUP_FAILED', { error: err }, { error: err });
      }
    }
  }

  return {
    onCleanup,
    attachSetupCleanup,
    run,
    get active() {
      return activity.active;
    },
    get size() {
      return stack.length;
    },
    activity,
  };
}

/**
 * @typedef {Object} ModuleContext
 * @property {Object} scope - Current lexical scope (with prototypal inheritance)
 * @property {import('../store.js').Store|null} store - Reactive store instance (or null)
 * @property {Element|Node} element - Current DOM element being processed
 * @property {import('./triggers.js').TriggerDefinition} trigger - Trigger definition
 * @property {string} moduleName - Name of the owning module
 * @property {Document} document - Owner Document instance
 * @property {Window|null} window - Owner Window instance
 * @property {string|null} matchedAttribute - Name of the matched attribute (if attribute trigger)
 * @property {string|null} attributeName - Alias for matchedAttribute
 * @property {Object|null} handlers - Handlers dictionary passed to mount/render
 * @property {Object|null} options - Mount configuration options
 * @property {Element|null} target - Mount target container element
 * @property {Object} refs - Shared DOM element references map for the active mount/render runtime
 * @property {function(Element|DocumentFragment, Object=): number} transform - Executes Transform phase on subtree
 * @property {function(Element|DocumentFragment, Object=): *} link - Executes Link phase on subtree
 * @property {function(Function): Function} onCleanup - Registers a cleanup callback on the unified LIFO stack
 * @property {function(string, function(*, *, string): void, Object=): () => void} watch - Subscribes to store path with auto-cleanup
 * @property {function(Function): void} afterConnect - Schedules a callback after the element is connected to the DOM
 * @property {function((Function|*)=): void} update - Executes an update safely with error isolation
 * @property {function(string, *=, *=): void} error - Reports an error through the central diagnostic system
 * @property {function(string, (string|*)=, *=): void} warn - Reports a warning through the central diagnostic system
 */

/**
 * Creates a ModuleContext instance for a specific trigger execution.
 *
 * @param {Object} options
 * @param {*} [options.store=null] - Reactive Store instance
 * @param {Object} [options.scope={}] - Current lexical Scope
 * @param {Element|Node} [options.element] - Current DOM element
 * @param {Object} [options.trigger] - Trigger definition
 * @param {string} [options.moduleName='anonymous'] - Owning module name
 * @param {Object} [options.cleanupStack] - Unified CleanupStack instance
 * @param {Document} [options.document] - Target document
 * @param {function(Element|DocumentFragment, Object=): number} [options.transform] - Subtree transform runner
 * @param {function(Element|DocumentFragment, Object=): void} [options.deferTransform] - Queues built-in structural subtree work
 * @param {function(Element|DocumentFragment, Object=): *} [options.link] - Subtree link runner
 * @param {string} [options.matchedAttribute] - Matched attribute name
 * @param {Object} [options.handlers] - Handlers dictionary
 * @param {Object} [options.options] - Mount options
 * @param {Element} [options.target] - Mount target element
 * @param {Object} [options.refs] - Element references map
 * @returns {{ ctx: ModuleContext, cleanupStack: Object }} ModuleContext and its cleanup stack
 */
export function createModuleContext(options = {}) {
  const {
    store = null,
    scope = Object.create(null),
    element = null,
    trigger = null,
    moduleName = 'anonymous',
    cleanupStack = createCleanupStack(),
    document = element?.ownerDocument || globalThis.document,
    transform = null,
    deferTransform = null,
    link = null,
    matchedAttribute = null,
    handlers = null,
    options: mountOptions = null,
    target = null,
    refs = Object.create(null),
    attributes = null,
  } = options;

  const window = document?.defaultView || globalThis.window || null;
  const enqueueMicrotask = window?.queueMicrotask?.bind(window)
    ?? ((cb) => Promise.resolve().then(cb));

  const ctx = {
    get scope() {
      return scope;
    },
    get store() {
      return store;
    },
    get element() {
      return element;
    },
    get trigger() {
      return trigger;
    },
    get moduleName() {
      return moduleName;
    },
    get document() {
      return document;
    },
    get window() {
      return window;
    },
    get matchedAttribute() {
      return matchedAttribute;
    },
    get attributeName() {
      return matchedAttribute;
    },
    get attributes() {
      return attributes || {};
    },
    get handlers() {
      return mountOptions?.handlers ?? handlers;
    },
    get options() {
      return mountOptions;
    },
    get target() {
      return target;
    },
    get refs() {
      return refs;
    },

    /**
     * Dispatches a bubbling, cancelable, composed custom event from the element.
     *
     * @param {string} eventName - Custom event name
     * @param {*} [detail] - Event detail payload
     * @param {CustomEventInit} [eventInit={}] - Optional event init overrides
     * @returns {boolean} Whether the event was not cancelled
     */
    emit(eventName, detail, eventInit = {}) {
      if (typeof eventName !== 'string' || !eventName.trim()) {
        throw new TypeError('ctx.emit(eventName) requires a non-empty string event name.');
      }
      const targetEl = element || target || document;
      if (!targetEl || typeof targetEl.dispatchEvent !== 'function') {
        return false;
      }
      const CustomEventCtor = window?.CustomEvent || globalThis.CustomEvent;
      const evt = new CustomEventCtor(eventName.trim(), {
        bubbles: true,
        cancelable: true,
        composed: true,
        detail,
        ...eventInit,
      });
      return targetEl.dispatchEvent(evt);
    },

    /**
     * Alias for ctx.emit.
     *
     * @param {string} eventName
     * @param {*} [detail]
     * @param {CustomEventInit} [eventInit]
     * @returns {boolean}
     */
    dispatch(eventName, detail, eventInit) {
      return this.emit(eventName, detail, eventInit);
    },

    /**
     * Runs the Transform phase on a subtree with an optional sub-scope.
     *
     * @param {Element|DocumentFragment} node
     * @param {Object} [subScope]
     * @returns {number}
     */
    transform(node, subScope, customCleanupStack) {
      if (typeof transform === 'function') {
        setNodeOwner(node, target, element);
        return transform(node, subScope, customCleanupStack);
      }
      return 0;
    },

    deferTransform(node, subScope) {
      if (typeof deferTransform === 'function') {
        setNodeOwner(node, target, element);
        deferTransform(node, subScope);
      }
    },

    /**
     * Runs the Link phase on a subtree with an optional sub-scope.
     *
     * @param {Element|DocumentFragment} node
     * @param {Object} [subScope]
     * @returns {*}
     */
    link(node, subScope, customCleanupStack) {
      if (typeof link === 'function') {
        setNodeOwner(node, target, element);
        return link(node, subScope, customCleanupStack);
      }
      return null;
    },

    /**
     * Registers a cleanup callback on the unified LIFO stack.
     *
     * @param {Function} callback
     */
    onCleanup(callback) {
      return cleanupStack.onCleanup(callback);
    },

    /**
     * Watches a store path and calls callback on change.
     * Automatically registers unsubscribe on the module's cleanup stack.
     *
     * @param {string} path - Dotted store path
     * @param {function(*, *, string): void} callback - (newValue, oldValue, path)
     * @param {Object} [opts={}]
     * @param {boolean} [opts.immediate=false] - If true, fires callback immediately with current value
     * @returns {() => void} unsubscribe function
     */
    watch(path, callback, opts = {}) {
      if (typeof path !== 'string' || !path.trim()) {
        throw new TypeError('watch(path, callback) requires a non-empty string path.');
      }
      if (typeof callback !== 'function') {
        throw new TypeError('watch(path, callback) requires a function callback.');
      }

      if (!store) {
        ctx.warn(
          'MODULE_STORE_REQUIRED',
          `Module "${moduleName}" watch("${path}") called without a store.`,
          { element, path },
        );
        return () => {};
      }

      const invoke = (val, prev, changedPath) => {
        if (!cleanupStack.active) return;
        try {
          callback(val, prev, changedPath);
        } catch (err) {
          reportError('MODULE_WATCH_FAILED', { module: moduleName, path, error: err }, element);
        }
      };

      return watchScopePath(ctx, path, invoke, opts);
    },

    /**
     * Executes a callback after the element is connected to the DOM document.
     * Deactivated automatically if cleanup runs first.
     *
     * @param {Function} callback
     */
    afterConnect(callback) {
      if (typeof callback !== 'function') {
        throw new TypeError('afterConnect(callback) requires a function callback.');
      }

      enqueueMicrotask(() => {
        if (!cleanupStack.active || !element?.isConnected) return;
        try {
          callback();
        } catch (err) {
          reportError('MODULE_AFTER_CONNECT_FAILED', { module: moduleName, error: err }, element);
        }
      });
    },

    /**
     * Executes an update safely with MODULE_UPDATE_FAILED error isolation.
     *
     * @param {Function|*} [fnOrArg]
     */
    update(fnOrArg) {
      if (!cleanupStack.active) return;
      try {
        if (typeof fnOrArg === 'function') {
          fnOrArg();
        } else if (typeof trigger?.update === 'function') {
          trigger.update(element, fnOrArg, ctx);
        }
      } catch (err) {
        reportError('MODULE_UPDATE_FAILED', { module: moduleName, error: err }, element);
      }
    },

    /**
     * Reports an error through the central diagnostic system.
     *
     * @param {string} code
     * @param {*} [details]
     * @param {*} [context]
     */
    error(code, details = {}, context = element) {
      reportError(code, details, context);
    },

    /**
     * Reports a warning through the central diagnostic system.
     *
     * @param {string} code
     * @param {string|*} [messageOrDetails]
     * @param {*} [context]
     */
    warn(code, messageOrDetails = code, context = element) {
      const message = typeof messageOrDetails === 'string' ? messageOrDetails : code;
      warn(code, message, context);
    },
  };

  if (element && typeof element === 'object') {
    setNodeOwner(element, target);
    element._limeCtx = ctx;
    if (trigger?.type === 'tag' || trigger?.customElement) {
      const bridge = { trigger, ctx, active: true };
      element._limeCustomElementCtx = bridge;
      cleanupStack.onCleanup(() => {
        if (element._limeCustomElementCtx === bridge) {
          bridge.active = false;
        }
      });
    }
    cleanupStack.onCleanup(() => {
      if (element && element._limeCtx === ctx) {
        delete element._limeCtx;
      }
    });
  }

  return { ctx, cleanupStack };
}
