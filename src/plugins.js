/**
 * @module plugins
 * Mount-scoped Plugin API v1.
 *
 * Plugin definitions are immutable descriptions. All mutable state and
 * cleanup bookkeeping live in a runtime created separately for each mount.
 */

import { warn } from './errors.js';
import { inIgnoredBlock, inLiveBlock } from './shared.js';

export const PLUGIN_API_VERSION = 1;

const PLUGIN_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const DIRECTIVE_NAME_PATTERN = /^data-lime-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const RESERVED_DIRECTIVES = new Set(['data-lime-ignore']);
const STRUCTURAL_TAGS = new Set(['IF', 'ELSE', 'FOR', 'PARTIAL', 'TEMPLATE']);
const PLUGIN_DEFINITION = Symbol('lime-csr-plugin-definition');

/**
 * Validates and freezes a reusable plugin definition.
 * Mutable per-mount data must be stored in the runtime `state` object.
 *
 * @param {*} definition
 * @returns {Readonly<Object>}
 */
export function definePlugin(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('definePlugin(definition) requires a plugin definition object.');
  }

  const { name, apiVersion, version, beforeMount, afterMount } = definition;
  if (typeof name !== 'string' || !PLUGIN_NAME_PATTERN.test(name)) {
    throw new TypeError('Plugin name must match /^[a-z][a-z0-9-]*$/.');
  }
  if (!Number.isInteger(apiVersion) || apiVersion < 1) {
    throw new TypeError('Plugin apiVersion must be a positive integer.');
  }
  if (version !== undefined && typeof version !== 'string') {
    throw new TypeError('Plugin version must be a string when provided.');
  }
  if (beforeMount !== undefined && typeof beforeMount !== 'function') {
    throw new TypeError('Plugin beforeMount must be a function when provided.');
  }
  if (afterMount !== undefined && typeof afterMount !== 'function') {
    throw new TypeError('Plugin afterMount must be a function when provided.');
  }

  const sourceDirectives = definition.directives ?? {};
  if (!sourceDirectives || typeof sourceDirectives !== 'object' || Array.isArray(sourceDirectives)) {
    throw new TypeError('Plugin directives must be an object.');
  }

  const directives = Object.create(null);
  for (const [directiveName, directiveDefinition] of Object.entries(sourceDirectives)) {
    if (!DIRECTIVE_NAME_PATTERN.test(directiveName)) {
      throw new TypeError(
        `Plugin directive "${directiveName}" must match ` +
        '/^data-lime-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.',
      );
    }
    if (RESERVED_DIRECTIVES.has(directiveName)) {
      throw new TypeError(`Plugin directive "${directiveName}" is reserved by Lime CSR.`);
    }

    let setup;
    if (typeof directiveDefinition === 'function') {
      setup = directiveDefinition;
    } else if (
      directiveDefinition &&
      typeof directiveDefinition === 'object' &&
      !Array.isArray(directiveDefinition)
    ) {
      ({ setup } = directiveDefinition);
      if (setup !== undefined && typeof setup !== 'function') {
        throw new TypeError(`Plugin directive "${directiveName}" setup must be a function.`);
      }
    } else {
      throw new TypeError(
        `Plugin directive "${directiveName}" must be a setup function or definition object.`,
      );
    }

    directives[directiveName] = Object.freeze({ setup });
  }

  const plugin = {
    name,
    apiVersion,
    ...(version === undefined ? {} : { version }),
    ...(beforeMount === undefined ? {} : { beforeMount }),
    ...(afterMount === undefined ? {} : { afterMount }),
    directives: Object.freeze(directives),
  };
  Object.defineProperty(plugin, PLUGIN_DEFINITION, { value: true });
  Object.freeze(plugin);
  return plugin;
}

function pluginContext(record, directive, details) {
  const context = { plugin: record.plugin.name };
  if (directive) context.directive = directive;
  if (details === undefined) return context;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    return Object.assign(context, details);
  }
  context.detail = details;
  return context;
}

function report(record, directive, code, message, details) {
  warn(code, message, pluginContext(record, directive, details));
}

function runCleanups(cleanups, record, directive) {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    try {
      cleanup();
    } catch (error) {
      report(
        record,
        directive,
        'PLUGIN_CLEANUP_FAILED',
        `Plugin "${record.plugin.name}" cleanup failed; remaining cleanups will continue.`,
        { error },
      );
    }
  }
}

function registerCleanup(cleanups, callback, label) {
  if (typeof callback !== 'function') {
    throw new TypeError(`${label} requires a function callback.`);
  }
  cleanups.push(callback);
  return callback;
}

/**
 * Creates one private runtime for one mount. This is intentionally not
 * re-exported from the package entry point.
 *
 * @param {*} plugins
 * @param {{target: Element, store: *, context: Object}} environment
 * @returns {Object|null}
 */
export function createPluginRuntime(plugins, environment) {
  if (!Array.isArray(plugins)) {
    warn(
      'PLUGIN_LIST_INVALID',
      'mount(): plugins must be an array of values returned by definePlugin(); plugins were skipped.',
      { plugins },
    );
    return null;
  }

  const document = environment.target.ownerDocument;
  const window = document.defaultView;
  const enqueueMicrotask = window?.queueMicrotask?.bind(window) ??
    ((callback) => Promise.resolve().then(callback));
  const records = [];
  const names = new Set();
  const directives = new Map();
  const diagnosedStructuralTargets = new WeakMap();

  for (const plugin of plugins) {
    if (plugin?.[PLUGIN_DEFINITION] !== true) {
      warn(
        'PLUGIN_INVALID',
        'mount(): every plugin must be created with definePlugin(); invalid entry was skipped.',
        { plugin },
      );
      continue;
    }
    if (plugin.apiVersion !== PLUGIN_API_VERSION) {
      warn(
        'PLUGIN_API_VERSION_UNSUPPORTED',
        `Plugin "${plugin.name}" requires API version ${plugin.apiVersion}; ` +
          `this runtime supports version ${PLUGIN_API_VERSION}.`,
        { plugin: plugin.name, apiVersion: plugin.apiVersion },
      );
      continue;
    }
    if (names.has(plugin.name)) {
      warn(
        'PLUGIN_DUPLICATE_NAME',
        `Plugin name "${plugin.name}" appears more than once; only the first plugin was installed.`,
        { plugin: plugin.name },
      );
      continue;
    }

    names.add(plugin.name);
    const record = {
      plugin,
      state: Object.create(null),
      mountCleanups: [],
    };
    records.push(record);

    for (const [directive, definition] of Object.entries(plugin.directives)) {
      if (directives.has(directive)) {
        warn(
          'PLUGIN_DIRECTIVE_CONFLICT',
          `Directive "${directive}" is already owned by plugin ` +
            `"${directives.get(directive).record.plugin.name}"; plugin "${plugin.name}" was skipped for it.`,
          { plugin: plugin.name, directive },
        );
        continue;
      }
      directives.set(directive, { record, definition });
    }
  }

  if (records.length === 0) return null;

  function mountApi(record) {
    return {
      plugin: record.plugin,
      state: record.state,
      target: environment.target,
      store: environment.store,
      context: environment.context,
      document,
      window,
      onCleanup(callback) {
        return registerCleanup(record.mountCleanups, callback, 'onCleanup(callback)');
      },
      diagnostic(code, message, context) {
        report(record, null, code, message, context);
      },
    };
  }

  function runHook(record, hookName) {
    const hook = record.plugin[hookName];
    if (typeof hook !== 'function') return;
    try {
      const cleanup = hook(mountApi(record));
      if (cleanup !== undefined) {
        registerCleanup(record.mountCleanups, cleanup, `${hookName} cleanup`);
      }
    } catch (error) {
      report(
        record,
        null,
        'PLUGIN_HOOK_FAILED',
        `Plugin "${record.plugin.name}" ${hookName} hook failed; mounting will continue.`,
        { hook: hookName, error },
      );
    }
  }

  function diagnoseStructuralTarget(element, directive, record) {
    let diagnosedDirectives = diagnosedStructuralTargets.get(element);
    if (!diagnosedDirectives) {
      diagnosedDirectives = new Set();
      diagnosedStructuralTargets.set(element, diagnosedDirectives);
    }
    if (diagnosedDirectives.has(directive)) return;
    diagnosedDirectives.add(directive);
    report(
      record,
      directive,
      'PLUGIN_DIRECTIVE_STRUCTURAL_TARGET',
      `Directive "${directive}" cannot target structural <${element.tagName.toLowerCase()}> elements; ` +
        'place it on a normal element inside the block.',
      { element },
    );
  }

  return {
    beforeMount() {
      for (const record of records) runHook(record, 'beforeMount');
    },

    afterMount() {
      for (const record of records) runHook(record, 'afterMount');
    },

    diagnoseStructuralTargets(root) {
      if (directives.size === 0) return;
      for (const [directive, { record }] of directives) {
        const elements = [];
        if (root.nodeType === 1 && root.hasAttribute(directive)) elements.push(root);
        elements.push(...root.querySelectorAll(`[${directive}]`));
        for (const element of elements) {
          if (
            !inIgnoredBlock(element) &&
            STRUCTURAL_TAGS.has(element.tagName)
          ) {
            diagnoseStructuralTarget(element, directive, record);
          }
        }
      }
    },

    setupDirectives(root, context) {
      if (directives.size === 0) return () => {};
      const instanceCleanups = [];

      for (const [directive, entry] of directives) {
        const { record, definition } = entry;
        const elements = [];
        if (root.nodeType === 1 && root.hasAttribute(directive)) elements.push(root);
        elements.push(...root.querySelectorAll(`[${directive}]`));

        for (const element of elements) {
          if (inIgnoredBlock(element)) continue;
          if (STRUCTURAL_TAGS.has(element.tagName)) {
            diagnoseStructuralTarget(element, directive, record);
            continue;
          }
          if (inLiveBlock(element)) continue;
          if (typeof definition.setup !== 'function') continue;

          const cleanups = [];
          const activity = { active: true };
          instanceCleanups.push(() => {
            activity.active = false;
            runCleanups(cleanups, record, directive);
          });

          const diagnostic = (code, message, details) => {
            report(record, directive, code, message, details);
          };
          const storeRequired = (operation) => {
            diagnostic(
              'PLUGIN_STORE_REQUIRED',
              `Plugin "${record.plugin.name}" directive "${directive}" cannot call ${operation} without a store.`,
              { element, operation },
            );
          };

          const api = {
            plugin: record.plugin,
            directive,
            element,
            value: element.getAttribute(directive),
            state: record.state,
            store: environment.store,
            context,
            document,
            window,
            get(path) {
              if (!environment.store) {
                storeRequired('get()');
                return undefined;
              }
              return environment.store.get(path);
            },
            set(path, value) {
              if (!environment.store) {
                storeRequired('set()');
                return false;
              }
              return environment.store.set(path, value);
            },
            watch(path, callback, options = {}) {
              if (typeof path !== 'string' || path.trim() === '') {
                throw new TypeError('watch(path, callback) requires a non-empty path.');
              }
              if (typeof callback !== 'function') {
                throw new TypeError('watch(path, callback) requires a function callback.');
              }
              if (!environment.store) {
                storeRequired('watch()');
                return () => {};
              }

              const invoke = (value, previous, changedPath) => {
                if (!activity.active) return;
                try {
                  callback(value, previous, changedPath);
                } catch (error) {
                  diagnostic(
                    'PLUGIN_WATCH_FAILED',
                    `Plugin "${record.plugin.name}" watch callback for "${path}" failed; runtime will continue.`,
                    { element, path, error },
                  );
                }
              };
              const unwatch = environment.store.subscribe(path, invoke);
              registerCleanup(cleanups, unwatch, 'watch cleanup');
              if (options?.immediate === true) invoke(environment.store.get(path), undefined, path);
              return unwatch;
            },
            afterConnect(callback) {
              if (typeof callback !== 'function') {
                throw new TypeError('afterConnect(callback) requires a function callback.');
              }
              enqueueMicrotask(() => {
                if (!activity.active || !element.isConnected) return;
                try {
                  callback();
                } catch (error) {
                  diagnostic(
                    'PLUGIN_AFTER_CONNECT_FAILED',
                    `Plugin "${record.plugin.name}" afterConnect callback failed; runtime will continue.`,
                    { element, error },
                  );
                }
              });
            },
            onCleanup(callback) {
              return registerCleanup(cleanups, callback, 'onCleanup(callback)');
            },
            diagnostic,
          };

          try {
            const cleanup = definition.setup(api);
            if (cleanup !== undefined) {
              registerCleanup(cleanups, cleanup, 'directive setup cleanup');
            }
          } catch (error) {
            diagnostic(
              'PLUGIN_SETUP_FAILED',
              `Plugin "${record.plugin.name}" directive "${directive}" setup failed; rendering will continue.`,
              { element, error },
            );
          }
        }
      }

      let active = true;
      return function cleanupDirectives() {
        if (!active) return;
        active = false;
        for (let i = instanceCleanups.length - 1; i >= 0; i--) instanceCleanups[i]();
        instanceCleanups.length = 0;
      };
    },

    cleanup() {
      for (let i = records.length - 1; i >= 0; i--) {
        runCleanups(records[i].mountCleanups, records[i], null);
      }
    },
  };
}
