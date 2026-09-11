/**
 * @module core/registry
 * Module definition and precedence resolution for the Module Kernel.
 *
 * Precedence Rule:
 *   modules[0] > modules[1] > ... > modules[N]
 *   Evaluated at compile/registration time.
 *   The first module to claim a trigger route wins. Conflicting routes
 *   in lower-priority modules are shadowed, emitting MODULE_TRIGGER_OVERRIDDEN
 *   in development mode.
 */

import { TRIGGER_TYPES } from './triggers.js';

const MODULE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * @typedef {Object} ModuleBeforeMountContext
 * @property {Element} target - Mount target container element
 * @property {Object} options - Mount configuration options
 * @property {Object} [scope] - Root lexical scope
 * @property {import('../store.js').Store|null} [store] - Reactive Store
 */

/**
 * @typedef {Object} ModuleAfterMountContext
 * @property {Element} target - Mount target container element
 * @property {Object} options - Mount configuration options
 * @property {Object} [scope] - Root lexical scope
 * @property {import('../store.js').Store|null} [store] - Reactive Store
 * @property {Function} unmount - Mount unmount function
 */

/**
 * @typedef {Object} ModuleDefinitionOptions
 * @property {string} name - Module name matching /^[a-z][a-z0-9-]*$/
 * @property {string} [version] - Optional semantic version string
 * @property {Array<Object>} triggers - Non-empty array of trigger definitions (from attr, attrs, tag, pattern)
 * @property {function(ModuleBeforeMountContext): void} [beforeMount] - Lifecycle hook run before mount pipeline
 * @property {function(ModuleAfterMountContext): void} [afterMount] - Lifecycle hook run after mount completes
 */

/**
 * @typedef {Readonly<ModuleDefinitionOptions>} ModuleDefinition
 */

/**
 * Validates and freezes a module definition.
 *
 * @param {ModuleDefinitionOptions} definition - Module configuration object
 * @returns {ModuleDefinition} Immutable module definition
 * @throws {TypeError} If definition, name, triggers, or hooks are invalid
 */
export function defineModule(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('defineModule(definition) requires a module definition object.');
  }

  const { name, version, triggers, beforeMount, afterMount } = definition;

  if (typeof name !== 'string' || !MODULE_NAME_PATTERN.test(name)) {
    throw new TypeError('Module name must match /^[a-z][a-z0-9-]*$/.');
  }

  if (version !== undefined && typeof version !== 'string') {
    throw new TypeError('Module version must be a string when provided.');
  }

  if (!Array.isArray(triggers) || triggers.length === 0) {
    throw new TypeError('Module triggers must be a non-empty array of trigger definitions.');
  }

  for (let i = 0; i < triggers.length; i++) {
    const t = triggers[i];
    if (!t || typeof t !== 'object' || !Object.values(TRIGGER_TYPES).includes(t.type)) {
      throw new TypeError(`Module trigger at index ${i} is not a valid trigger definition.`);
    }
  }

  if (beforeMount !== undefined && typeof beforeMount !== 'function') {
    throw new TypeError('Module beforeMount must be a function when provided.');
  }

  if (afterMount !== undefined && typeof afterMount !== 'function') {
    throw new TypeError('Module afterMount must be a function when provided.');
  }

  return Object.freeze({
    name,
    ...(version !== undefined ? { version } : {}),
    triggers: Object.freeze([...triggers]),
    ...(beforeMount !== undefined ? { beforeMount } : {}),
    ...(afterMount !== undefined ? { afterMount } : {}),
  });
}
