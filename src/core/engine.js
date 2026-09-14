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

import { reportError, subscribeDiagnostics, warn } from '../errors.js';
import { resolveStatic } from '../template.js';
import { createStore } from '../store.js';
import { createScope } from './scope.js';
import { createCleanupStack } from './context.js';
import { createRouter } from './router.js';
import { runTransform, runLink } from './lifecycle.js';
import { createCompositionModule, resolveTemplate } from './composition.js';

// A DOM target can host only one active runtime, even when it is mounted
// through different Engine instances.
const mountOwners = new WeakMap();
const UNSAFE_STORE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

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
 * @property {function(Object): EngineMountResult} mount - Mounts a template or element into a target
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

  function validateDiagnosticCallbacks(options) {
    for (const name of ['onDiagnostic', 'onError']) {
      if (options[name] !== undefined && typeof options[name] !== 'function') {
        throw new TypeError(`mount options.${name} must be a function when provided.`);
      }
    }
  }

  function validateComputedDefinitions(computed) {
    if (computed == null) return;
    if (typeof computed !== 'object' || Array.isArray(computed)) {
      throw new TypeError('mount options.computed must be an object mapping paths to { deps, fn } definitions.');
    }

    for (const [path, def] of Object.entries(computed)) {
      const isSafePath = (value) => typeof value === 'string'
        && value.trim()
        && !value.split('.').some((segment) => UNSAFE_STORE_PATH_SEGMENTS.has(segment));
      if (!def || typeof def !== 'object' || Array.isArray(def)) {
        throw new TypeError(`mount options.computed["${path}"] must be a { deps, fn } definition.`);
      }
      if (
        !Array.isArray(def.deps)
        || !isSafePath(path)
        || !def.deps.every(isSafePath)
        || typeof def.fn !== 'function'
      ) {
        throw new TypeError(`mount options.computed["${path}"] requires string[] deps and a function fn.`);
      }
    }

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

  function normalizeMountConfig(config, argumentCount) {
    if (
      argumentCount !== 1
      || !config
      || typeof config !== 'object'
      || Array.isArray(config)
      || config.nodeType === 1
      || config.nodeType === 11
    ) {
      throw new TypeError('mount: expected a single configuration object.');
    }

    return {
      target: config.target,
      template: config.template ?? config.templateName,
      store: config.store,
      options: config,
    };
  }

  function resolveMountTarget(target, options) {
    const doc = options.document
      || (target && target.nodeType === 1 ? target.ownerDocument : null)
      || globalThis.document;

    if (typeof target === 'string') {
      if (!doc || typeof doc.querySelector !== 'function') {
        reportError('MOUNT_INVALID_TARGET', { target });
        return null;
      }
      let resolvedTarget;
      try {
        resolvedTarget = doc.querySelector(target);
      } catch (error) {
        reportError('MOUNT_INVALID_TARGET', { target, error });
        return null;
      }
      if (!resolvedTarget || resolvedTarget.nodeType !== 1) {
        reportError('MOUNT_TARGET_NOT_FOUND', { selector: target });
        return null;
      }
      return { doc, target: resolvedTarget };
    }

    if (target && typeof target === 'object' && target.nodeType === 1) {
      return { doc, target };
    }

    reportError('MOUNT_INVALID_TARGET', { target });
    return null;
  }

  function resolveMountStore(store) {
    return isStore(store) ? store : createStore({});
  }

  function resolveMountTemplate(template, doc, options, target) {
    if (typeof template === 'string') {
      const trimmed = template.trim();
      if (trimmed.startsWith('<')) {
        const element = doc.createElement('template');
        element.innerHTML = template;
        return { found: true, fragment: element.content.cloneNode(true) };
      }

      const templateElement = resolveTemplate(template, {
        templates: options.templates,
        document: doc,
      });
      if (!templateElement) {
        const available = Array.from(doc.querySelectorAll('template[id^="tpl-"]'))
          .map((element) => element.id.slice(4));
        reportError('MOUNT_TEMPLATE_NOT_FOUND', { name: template, available }, target);
        return { found: false, fragment: null };
      }
      return {
        found: true,
        fragment: templateElement.content
          ? templateElement.content.cloneNode(true)
          : templateElement.cloneNode(true),
      };
    }

    if (template && template.nodeType === 11) {
      return { found: true, fragment: template.cloneNode(true) };
    }
    if (template && template.nodeType === 1) {
      return {
        found: true,
        fragment: template.tagName === 'TEMPLATE' && template.content
          ? template.content.cloneNode(true)
          : template.cloneNode(true),
      };
    }
    return { found: true, fragment: null };
  }

  function validateMountOptions(options) {
    validateComputedDefinitions(options.computed);
    validateDiagnosticCallbacks(options);
  }

  function installMountDiagnostics(options, target, cleanupStack) {
    if (!options.onDiagnostic && !options.onError) return;

    const unsubscribe = subscribeDiagnostics((diagnostic) => {
      const context = diagnostic.context;
      const belongsToMount = context === target
        || (context?.nodeType != null && target.contains(context));
      if (!belongsToMount) return;
      if (options.onDiagnostic) options.onDiagnostic(diagnostic);
      if (diagnostic.severity === 'error' && options.onError) {
        options.onError(diagnostic);
      }
    });
    cleanupStack.onCleanup(unsubscribe);
  }

  function runMountHooks(name, hookApi, cleanupStack, target) {
    for (let i = 0; i < engineModules.length; i++) {
      const module = engineModules[i];
      if (typeof module[name] !== 'function') continue;
      try {
        const cleanup = module[name](hookApi);
        if (typeof cleanup === 'function') cleanupStack.onCleanup(cleanup);
      } catch (error) {
        reportError('MODULE_SETUP_FAILED', { module: module.name, hook: name, error }, target);
      }
    }
  }

  function createMountInstance(target, store, scope, cleanupStack, ownsContent, options) {
    let active = true;
    let instance;

    function cleanupSelf() {
      if (active) cleanupStack.run();
    }

    function unmountSelf() {
      if (!active) return;
      cleanupSelf();
      active = false;
      mountedTargets.delete(target);
      if (mountOwners.get(target) === instance) mountOwners.delete(target);
      if (ownsContent) target.textContent = '';
    }

    instance = function unmountCallable() {
      unmountSelf();
    };
    instance.unmount = unmountSelf;
    instance.cleanup = cleanupSelf;
    Object.defineProperty(instance, 'active', {
      get() { return active; },
      enumerable: true,
    });
    for (const [name, value] of Object.entries({ target, store, scope })) {
      Object.defineProperty(instance, name, {
        value,
        writable: false,
        enumerable: true,
      });
    }

    mountedTargets.set(target, instance);
    mountOwners.set(target, instance);

    if (options.signal) {
      const onAbort = () => unmountSelf();
      options.signal.addEventListener('abort', onAbort, { once: true });
      cleanupStack.onCleanup(() => options.signal.removeEventListener('abort', onAbort));
    }

    return instance;
  }

  /**
   * Mounts a template and runtime configuration into a target element.
   *
   * @param {Object} config - Mount configuration
   * @param {Element|string} config.target - DOM Element or CSS selector string
   * @param {string|Element|DocumentFragment} [config.template] - Template name, HTML string, or template element
   * @param {string} [config.templateName] - Alias for template
   * @param {import('../store.js').Store|null} [config.store] - Reactive Store
   * @param {Object} [config.handlers] - Mount-scoped event handlers
   * @param {AbortSignal} [config.signal] - Signal which unmounts this instance when aborted
   * @param {Object} [config.context] - Root lexical context
   * @param {Object} [config.computed] - Mount-scoped computed definitions
   * @param {Function} [config.beforeRender] - Lifecycle hook before rendering
   * @param {Function} [config.afterRender] - Lifecycle hook after rendering
   * @param {Document} [config.document] - DOM document context
   * @returns {EngineMountResult} Mount runtime instance
    */
   function mount(config) {
     const mountConfig = normalizeMountConfig(config, arguments.length);
     const resolved = resolveMountTarget(mountConfig.target, mountConfig.options);
     if (!resolved) return createInactiveMount(null, mountConfig.store);

     const { doc, target: resolvedTarget } = resolved;
     const mountOptions = mountConfig.options;
     const mountStore = resolveMountStore(mountConfig.store);

     // 3. AbortSignal early exit
     if (mountOptions.signal?.aborted) {
       return createInactiveMount(resolvedTarget, mountStore);
     }

     // 4. Resolve the template before replacing an active mount. A failed
     // replacement must not tear down the currently rendered application.
     const template = resolveMountTemplate(
       mountConfig.template,
       doc,
       mountOptions,
       resolvedTarget,
     );
     if (!template.found) return createInactiveMount(resolvedTarget, mountStore);
     const { fragment } = template;

     // Validate mount configuration before replacing an active target owner.
     validateMountOptions(mountOptions);

    // 5. Duplicate Mount Protection: unmount / replace any active owner of target
    const previous = mountOwners.get(resolvedTarget);
    if (previous && previous.active) {
      previous.unmount();
    }

    const win = doc?.defaultView || globalThis.window || null;
    const scope = mountOptions.scope
      ? mountOptions.scope
      : (mountOptions.context ? createScope(null, mountOptions.context) : createScope(null, {}));
    const cleanupStack = createCleanupStack();

    installMountDiagnostics(mountOptions, resolvedTarget, cleanupStack);

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

    runMountHooks('beforeMount', hookApi, cleanupStack, resolvedTarget);

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

    runMountHooks('afterMount', hookApi, cleanupStack, resolvedTarget);

    // afterRender user lifecycle hook
    if (typeof mountOptions.afterRender === 'function') {
      try {
        mountOptions.afterRender(resolvedTarget, mountStore);
      } catch (err) {
        reportError('MOUNT_HOOK_FAILED', { hook: 'afterRender', error: err }, resolvedTarget);
      }
    }

    return createMountInstance(
      resolvedTarget,
      mountStore,
      scope,
      cleanupStack,
      ownsContent,
      mountOptions,
    );
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
    const entry = mountOwners.get(target) || mountedTargets.get(target);
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
