/**
 * @module core/engine
 * Isolated Engine runtime and orchestrator for the Module Kernel.
 *
 * Architectural Invariants:
 *   1. Immutable Engine Configuration:
 *      - Modules validated and frozen once at creation.
 *      - Routes compiled once via createRouter.
 *      - Precedence resolved at compile time.
 *      - No engine.use() or dynamic registration.
 *   2. Strict Instance Isolation:
 *      - Engine instances share zero mutable state.
 *      - Mount targets and state are isolated per engine and per mount.
 *   3. Two-Phase Execution Pipeline:
 *      - Phase 1: Transform (structural compilation / fixed-point).
 *      - Phase 2: Link (behavioral attachment / single-pass non-mutating).
 *   4. Deterministic Teardown:
 *      - Unified LIFO cleanup stack.
 *      - Cleanup runs before DOM detachment.
 */

import { reportError, warn } from '../errors.js';
import { resolveStatic } from '../template.js';
import { createStore } from '../store.js';
import { createScope } from './scope.js';
import { createCleanupStack } from './context.js';
import { createRouter } from './router.js';
import { runTransform, runLink } from './lifecycle.js';
import { createCompositionModule, resolveTemplate } from './composition.js';

/**
 * @typedef {Object} EngineMountResult
 * @property {() => void} unmount - Unmounts the target, disposes all subscriptions, and clears DOM contents
 * @property {() => void} cleanup - Alias for unmount
 * @property {Element} target - Mount target element
 * @property {Object} scope - Root lexical scope
 * @property {import('../store.js').Store|null} store - Store instance
 */

/**
 * @typedef {Object} EngineRenderResult
 * @property {Element|DocumentFragment} element - Rendered node
 * @property {Object} scope - Resolved lexical scope
 * @property {import('../store.js').Store|null} store - Store instance
 * @property {() => void} cleanup - Idempotent cleanup function
 * @property {Object} cleanupStack - Underlying cleanup stack
 */

/**
 * @typedef {Object} Engine
 * @property {function((string|Element), Object=, Object=): EngineMountResult} mount - Mounts a template or element into a target
 * @property {function(Element): void} unmount - Unmounts target, clears DOM, and disposes subscriptions
 * @property {function((DocumentFragment|Element), Object=): EngineRenderResult} render - Compiles an arbitrary fragment or element
 * @property {ReadonlyArray<import('./registry.js').ModuleDefinition>} modules - Registered module definitions
 */

/**
 * Creates an isolated Engine instance with compiled router and immutable precedence.
 *
 * @param {Object} [options={}]
 * @param {Array<import('./registry.js').ModuleDefinition>} [options.modules=[]] - List of module definitions
 * @returns {Engine} Immutable Engine instance with { mount, unmount, render, modules }
 * @throws {TypeError} If modules is not an array
 */
export function createEngine(options = {}) {
  const { modules = [], ...routerOptions } = options;

  if (!Array.isArray(modules)) {
    throw new TypeError('createEngine: modules must be an array of module definitions.');
  }

  // Built-in composition: partial and slot composition is always active
  const hasComposition = modules.some((m) => m && (m.name === 'partials' || m.name === 'composition'));
  const routerModules = hasComposition ? modules : [createCompositionModule(), ...modules];

  // Compile router once at engine creation (immutable routes and precedence)
  const router = createRouter(routerModules, routerOptions);
  const engineModules = Object.freeze([...modules]);

  // Private per-engine mount target tracking
  const mountedTargets = new WeakMap();

  function isStore(value) {
    return value != null
      && typeof value.get === 'function'
      && typeof value.subscribe === 'function';
  }

  /**
   * Helper to create a no-op inactive mount result for invalid or aborted mounts.
   *
   * @param {Element|null} [target=null]
   * @param {import('../store.js').Store|null} [store=null]
   * @returns {EngineMountResult}
   */
  function createInactiveMount(target = null, store = null) {
    const noop = function unmount() {};
    noop.unmount = noop;
    noop.cleanup = noop;
    noop.target = target;
    noop.scope = null;
    noop.store = store;
    noop.active = false;
    return Object.freeze(noop);
  }

  /**
   * Mounts a template and runtime configuration into a target element.
   *
   * @param {Element|string} target - DOM Element or CSS selector string
   * @param {string|Element|DocumentFragment} [template] - Template name, HTML string, or template element
   * @param {import('../store.js').Store|Object|null} [store=null] - Reactive Store, or options if store omitted
   * @param {Object} [options={}] - Mount configuration options (handlers, signal, beforeRender, afterRender)
   * @returns {EngineMountResult} Mount runtime instance
   */
  function mount(target, template, store, options = {}) {
    let templateArg = template;
    let mountStore = store;
    let mountOptions = options || {};

    // If 2nd arg is an options object (in-place mount on target):
    if (template && typeof template === 'object' && template.nodeType !== 1 && template.nodeType !== 11) {
      mountOptions = template;
      templateArg = mountOptions.templateName || mountOptions.template || null;
      mountStore = isStore(store) ? store : (mountOptions.store || null);
    } else if (store && typeof store === 'object' && !isStore(store)) {
      // 3rd arg was options, store was omitted: mount(target, template, options)
      mountOptions = store;
      mountStore = null;
    }

    const doc = mountOptions?.document || (target && target.nodeType === 1 ? target.ownerDocument : null) || globalThis.document;

    // 1. Target Resolution
    let resolvedTarget = null;
    if (typeof target === 'string') {
      if (!doc || typeof doc.querySelector !== 'function') {
        reportError('MOUNT_INVALID_TARGET', { target });
        return createInactiveMount(null, mountStore);
      }
      try {
        resolvedTarget = doc.querySelector(target);
      } catch (err) {
        reportError('MOUNT_INVALID_TARGET', { target, error: err });
        return createInactiveMount(null, mountStore);
      }
      if (!resolvedTarget || resolvedTarget.nodeType !== 1) {
        reportError('MOUNT_TARGET_NOT_FOUND', { selector: target });
        return createInactiveMount(null, mountStore);
      }
    } else if (target && typeof target === 'object' && target.nodeType === 1) {
      resolvedTarget = target;
    } else {
      reportError('MOUNT_INVALID_TARGET', { target });
      return createInactiveMount(null, mountStore);
    }

    // 2. Store: If omitted or null, create a mount-local Store instance
    if (!isStore(mountStore)) {
      mountStore = createStore({});
    }

    // 3. AbortSignal early exit
    if (mountOptions.signal?.aborted) {
      return createInactiveMount(resolvedTarget, mountStore);
    }

    // 4. Resolve the template before replacing an active mount. A failed
    // replacement must not tear down the currently rendered application.
    let fragment = null;
    if (typeof templateArg === 'string') {
      const trimmed = templateArg.trim();
      if (trimmed.startsWith('<')) {
        const tpl = doc.createElement('template');
        tpl.innerHTML = templateArg;
        fragment = tpl.content.cloneNode(true);
      } else {
        const tplEl = resolveTemplate(templateArg, { templates: mountOptions.templates, document: doc });

        if (!tplEl) {
          const available = Array.from(doc.querySelectorAll('template[id^="tpl-"]'))
            .map((t) => t.id.slice(4));
          reportError('MOUNT_TEMPLATE_NOT_FOUND', { name: templateArg, available }, resolvedTarget);
          return createInactiveMount(resolvedTarget, mountStore);
        }

        fragment = tplEl.content ? tplEl.content.cloneNode(true) : tplEl.cloneNode(true);
      }
    } else if (templateArg && templateArg.nodeType === 11) {
      fragment = templateArg.cloneNode(true);
    } else if (templateArg && templateArg.nodeType === 1) {
      if (templateArg.tagName === 'TEMPLATE' && templateArg.content) {
        fragment = templateArg.content.cloneNode(true);
      } else {
        fragment = templateArg.cloneNode(true);
      }
    }

    // 5. Duplicate Mount Protection: unmount / replace existing active instance on target
    const previous = mountedTargets.get(resolvedTarget);
    if (previous && previous.active) {
      previous.unmount();
    }

    const win = doc?.defaultView || globalThis.window || null;
    const scope = mountOptions.scope
      ? mountOptions.scope
      : (mountOptions.context ? createScope(null, mountOptions.context) : createScope(null, {}));
    const cleanupStack = createCleanupStack();

    // Mount Hook API provided to module lifecycle hooks
    const hookApi = Object.freeze({
      target: resolvedTarget,
      store: mountStore,
      scope,
      document: doc,
      window: win,
      get handlers() {
        return mountOptions.handlers || null;
      },
      get options() {
        return mountOptions;
      },
      onCleanup: (cb) => cleanupStack.onCleanup(cb),
      error: (code, details) => reportError(code, details, resolvedTarget),
      warn: (code, details) => warn(code, details, resolvedTarget),
    });

    // Run beforeMount module hooks in registration order
    for (let i = 0; i < engineModules.length; i++) {
      const mod = engineModules[i];
      if (typeof mod.beforeMount === 'function') {
        try {
          const cleanup = mod.beforeMount(hookApi);
          if (typeof cleanup === 'function') {
            cleanupStack.onCleanup(cleanup);
          }
        } catch (err) {
          reportError('MODULE_SETUP_FAILED', { module: mod.name, hook: 'beforeMount', error: err }, resolvedTarget);
        }
      }
    }

    // Mount-scoped computeds if provided
    if (mountOptions.computed) {
      for (const [path, def] of Object.entries(mountOptions.computed)) {
        const dispose = mountStore.computed(path, def.deps, def.fn);
        cleanupStack.onCleanup(dispose);
      }
    }

    // beforeRender user lifecycle hook
    if (typeof mountOptions.beforeRender === 'function') {
      try {
        mountOptions.beforeRender(scope, mountStore);
      } catch (err) {
        reportError('MOUNT_HOOK_FAILED', { hook: 'beforeRender', error: err }, resolvedTarget);
      }
    }

    const ownsContent = Boolean(fragment);

    const contextOptions = {
      store: mountStore,
      scope,
      cleanupStack,
      document: doc,
      handlers: mountOptions.handlers || null,
      options: mountOptions,
      target: resolvedTarget,
      linkedElements: new WeakSet(),
    };

    // 6. Execution Pipeline (Transform -> resolveStatic -> Link -> Placement)
    if (fragment) {
      runTransform(fragment, router, contextOptions);
      resolveStatic(fragment, scope, mountStore);
      runLink(fragment, router, contextOptions);
      resolvedTarget.textContent = '';
      resolvedTarget.appendChild(fragment);
    } else {
      // In-place mounting on existing target children
      runTransform(resolvedTarget, router, contextOptions);
      resolveStatic(resolvedTarget, scope, mountStore);
      runLink(resolvedTarget, router, contextOptions);
    }

    // Run afterMount module hooks in registration order
    for (let i = 0; i < engineModules.length; i++) {
      const mod = engineModules[i];
      if (typeof mod.afterMount === 'function') {
        try {
          const cleanup = mod.afterMount(hookApi);
          if (typeof cleanup === 'function') {
            cleanupStack.onCleanup(cleanup);
          }
        } catch (err) {
          reportError('MODULE_SETUP_FAILED', { module: mod.name, hook: 'afterMount', error: err }, resolvedTarget);
        }
      }
    }

    // afterRender user lifecycle hook
    if (typeof mountOptions.afterRender === 'function') {
      try {
        mountOptions.afterRender(resolvedTarget, mountStore);
      } catch (err) {
        reportError('MOUNT_HOOK_FAILED', { hook: 'afterRender', error: err }, resolvedTarget);
      }
    }

    // 7. Mount Instance & Teardown
    let active = true;

    function cleanupSelf() {
      if (!active) return;
      cleanupStack.run();
    }

    function unmountSelf() {
      if (!active) return;
      cleanupSelf();
      active = false;
      mountedTargets.delete(resolvedTarget);
      if (ownsContent) {
        resolvedTarget.textContent = '';
      }
    }

    const instance = function unmountCallable() {
      unmountSelf();
    };

    instance.unmount = unmountSelf;
    instance.cleanup = cleanupSelf;
    Object.defineProperty(instance, 'active', {
      get() { return active; },
      enumerable: true,
    });
    Object.defineProperty(instance, 'target', {
      value: resolvedTarget,
      writable: false,
      enumerable: true,
    });
    Object.defineProperty(instance, 'store', {
      value: mountStore,
      writable: false,
      enumerable: true,
    });
    Object.defineProperty(instance, 'scope', {
      value: scope,
      writable: false,
      enumerable: true,
    });

    mountedTargets.set(resolvedTarget, instance);

    if (mountOptions.signal) {
      const onAbort = () => unmountSelf();
      mountOptions.signal.addEventListener('abort', onAbort, { once: true });
      cleanupStack.onCleanup(() => {
        mountOptions.signal.removeEventListener('abort', onAbort);
      });
    }

    return instance;
  }

  /**
   * Unmounts a mounted target or instance, running cleanups and clearing DOM content.
   *
   * @param {Element|string|Object} targetOrInstance
   */
  function unmount(targetOrInstance) {
    if (!targetOrInstance) return;
    if (typeof targetOrInstance.unmount === 'function') {
      targetOrInstance.unmount();
      return;
    }
    let target = targetOrInstance;
    if (typeof target === 'string') {
      const doc = globalThis.document;
      try {
        target = doc?.querySelector(target);
      } catch {
        return;
      }
    }
    if (!target || target.nodeType !== 1) return;
    const entry = mountedTargets.get(target);
    if (entry) {
      entry.unmount();
    }
  }

  /**
   * Applies Transform and Link phases to an arbitrary node or fragment.
   *
   * @param {Element|DocumentFragment} nodeOrFragment
   * @param {Object} [options={}]
   * @returns {Object} { element, scope, store, cleanup, cleanupStack }
   */
  function render(nodeOrFragment, options = {}) {
    if (!nodeOrFragment || (nodeOrFragment.nodeType !== 1 && nodeOrFragment.nodeType !== 11)) {
      throw new TypeError('render: nodeOrFragment must be an Element or DocumentFragment.');
    }

    const doc = options.document || nodeOrFragment.ownerDocument || globalThis.document;
    const store = options.store || null;
    const scope = options.scope
      ? options.scope
      : (options.context ? createScope(null, options.context) : createScope(null, {}));
    const cleanupStack = options.cleanupStack || createCleanupStack();

    const contextOptions = {
      store,
      scope,
      cleanupStack,
      document: doc,
      handlers: options.handlers || null,
      options,
      target: options.target || (nodeOrFragment.nodeType === 1 ? nodeOrFragment : null),
    };

    runTransform(nodeOrFragment, router, contextOptions);
    resolveStatic(nodeOrFragment, scope, store);
    runLink(nodeOrFragment, router, contextOptions);

    const cleanup = () => cleanupStack.run();

    return {
      element: nodeOrFragment,
      scope,
      store,
      cleanup,
      cleanupStack,
    };
  }

  return Object.freeze({
    mount,
    unmount,
    render,
    get modules() {
      return engineModules;
    },
  });
}
