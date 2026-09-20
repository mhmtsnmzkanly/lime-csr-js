/**
 * @module core/scope
 * Lexical Scope utilities for the Module Kernel.
 *
 * Scope represents the lexical template context at a specific DOM position
 * (e.g. loop variables, index, partial data).
 *
 * Architectural Invariants:
 *   1. Scope is NOT the Store. Store holds mount-level reactive state;
 *      Scope holds lexically scoped template variables (prototype-inherited, shadowable, isolated).
 *   2. Nested scope inheritance uses JavaScript prototypal inheritance:
 *      child scope inherits parent properties with O(1) lookup and native shadowing.
 *   3. Parent scope cannot see child local bindings.
 *   4. Partial scopes are completely isolated (null prototype).
 */

import { getByPath } from '../store.js';

/**
 * Creates a nested child scope inheriting from a parent scope.
 * Local bindings shadow parent bindings natively without dictionary cloning.
 *
 * @param {Object|null} [parentScope=null] - Parent scope object
 * @param {Object} [localData={}] - Local variables to bind directly on the child scope
 * @returns {Object} Prototypally inherited scope
 */
export function createScope(parentScope = null, localData = {}) {
  const target = parentScope !== null && typeof parentScope === 'object'
    ? Object.create(parentScope)
    : Object.create(null);

  if (localData && typeof localData === 'object') {
    Object.assign(target, localData);
  }

  return target;
}

/**
 * Creates an isolated scope with no parent inheritance (used for partials).
 *
 * @param {Object} [data={}] - Resolved data object
 * @param {Object} [props={}] - Additional explicit props
 * @returns {Object} Isolated scope with null prototype
 */
export function createIsolatedScope(data = {}, props = {}) {
  const target = Object.create(null);

  if (data && typeof data === 'object') {
    Object.assign(target, data);
  }

  if (props && typeof props === 'object') {
    Object.assign(target, props);
  }

  return target;
}

/**
 * Checks whether a key is locally bound directly on the given scope
 * (i.e. not inherited from an ancestor scope).
 *
 * @param {Object} scope - Scope to inspect
 * @param {string} key - Property key
 * @returns {boolean}
 */
export function isLocalScopeBinding(scope, key) {
  if (!scope || typeof scope !== 'object') return false;
  return Object.hasOwn(scope, key);
}

const ELEMENT_SCOPE_MAP_KEY = Symbol.for('lime.elementScopeMap');
const SCOPE_ALIASES_KEY = Symbol.for('lime.scopeAliases');

const elementScopeMap = (globalThis[ELEMENT_SCOPE_MAP_KEY] ??= new WeakMap());

function getScopeMap(node) {
  const win = node?.ownerDocument?.defaultView || globalThis;
  return (win[ELEMENT_SCOPE_MAP_KEY] ??= elementScopeMap);
}

/**
 * Associates an item alias with its source scope, collection path, and index.
 *
 * @param {Object} scope
 * @param {string} alias - The loop item variable name (e.g. 'item')
 * @param {Object} sourceScope
 * @param {string} sourcePath
 * @param {number} index
 * @returns {function(number): void} Retargets subscriptions when the item moves
 */
export function setScopeAlias(scope, alias, sourceScope, sourcePath, index) {
  if (!Object.hasOwn(scope, SCOPE_ALIASES_KEY)) {
    Object.defineProperty(scope, SCOPE_ALIASES_KEY, { value: Object.create(null) });
  }
  const binding = { sourceScope, sourcePath, index, listeners: new Set() };
  scope[SCOPE_ALIASES_KEY][alias] = binding;
  return (nextIndex) => {
    if (binding.index === nextIndex) return;
    binding.index = nextIndex;
    for (const listener of [...binding.listeners]) listener();
  };
}

function findScopeBinding(scope, head) {
  for (let current = scope; current; current = Object.getPrototypeOf(current)) {
    if (Object.hasOwn(current, head)) {
      return {
        alias: Object.hasOwn(current, SCOPE_ALIASES_KEY)
          ? current[SCOPE_ALIASES_KEY][head]
          : null,
      };
    }
  }
  return null;
}

/**
 * Resolves a path against aliases defined in a lexical scope.
 * E.g. If alias 'item' -> 'items.0', then 'item.name' -> 'items.0.name'.
 *
 * @param {Object|null} scope
 * @param {string} path
 * @returns {string|null} null when the path belongs to local scope, not the store
 */
export function resolveCanonicalPath(scope, path) {
  if (!path || typeof path !== 'string' || !scope) return path;
  const dotIndex = path.indexOf('.');
  const head = dotIndex === -1 ? path : path.slice(0, dotIndex);
  const tail = dotIndex === -1 ? '' : path.slice(dotIndex);
  const binding = findScopeBinding(scope, head);
  if (!binding) return path;
  if (!binding.alias) return null;
  const { sourceScope, sourcePath, index } = binding.alias;
  const source = resolveCanonicalPath(sourceScope, sourcePath);
  return source === null ? null : `${source}.${index}${tail}`;
}

export function readScopePath(scope, store, path) {
  const canonicalPath = resolveCanonicalPath(scope, path);
  return canonicalPath === null ? getByPath(scope, path) : store?.get(canonicalPath);
}

/**
 * Rebinds a store subscription when any enclosing keyed alias moves.
 * One cleanup owns all replacement subscriptions, including nested aliases.
 */
export function watchScopePath(ctx, path, callback) {
  if (!ctx.store || resolveCanonicalPath(ctx.scope, path) === null) return () => {};
  const aliases = new Set();
  let scope = ctx.scope;
  let sourcePath = path;
  while (scope) {
    const binding = findScopeBinding(scope, sourcePath.split('.')[0]);
    if (!binding?.alias) break;
    aliases.add(binding.alias);
    scope = binding.alias.sourceScope;
    sourcePath = binding.alias.sourcePath;
  }

  let unsubscribe;
  let active = true;
  let generation = 0;
  function bind(refresh = false) {
    unsubscribe?.();
    const currentGeneration = ++generation;
    const canonicalPath = resolveCanonicalPath(ctx.scope, path);
    unsubscribe = ctx.store.subscribe(canonicalPath, (value, previous, changedPath) => {
      if (active && generation === currentGeneration) {
        ctx.update(() => callback(value, previous, changedPath));
      }
    });
    if (refresh) {
      ctx.update(() => callback(ctx.store.get(canonicalPath), undefined, canonicalPath));
    }
  }
  const rebind = () => { if (active) bind(true); };
  for (const alias of aliases) alias.listeners.add(rebind);
  bind();
  const cleanup = () => {
    if (!active) return;
    active = false;
    unsubscribe();
    for (const alias of aliases) alias.listeners.delete(rebind);
  };
  ctx.onCleanup(cleanup);
  return cleanup;
}

/**
 * Associates a DOM element or fragment's subtree with a lexical scope.
 *
 * @param {Node|Element|DocumentFragment} node
 * @param {Object} scope
 */
export function setElementScope(node, scope) {
  if (!node || !scope) return;
  const map = getScopeMap(node);

  const isChildScope = (parent, child) => {
    let curr = child ? Object.getPrototypeOf(child) : null;
    while (curr) {
      if (curr === parent) return true;
      curr = Object.getPrototypeOf(curr);
    }
    return false;
  };

  const applyScope = (target) => {
    const existing = map.get(target);
    if (existing && existing !== scope && isChildScope(scope, existing)) {
      // Target already has a deeper child scope derived from this scope; do not overwrite!
      return;
    }
    map.set(target, scope);
    if (map !== elementScopeMap) {
      elementScopeMap.set(target, scope);
    }
  };

  if (node.nodeType === 1 || node.nodeType === 3) {
    applyScope(node);
  }
  if (typeof node.querySelectorAll === 'function') {
    const els = node.querySelectorAll('*');
    for (let i = 0; i < els.length; i++) {
      applyScope(els[i]);
    }
  }
}

/**
 * Retrieves the lexical scope associated with a DOM element or node.
 *
 * @param {Element|Node} element
 * @returns {Object|null}
 */
export function getElementScope(element) {
  if (!element || (element.nodeType !== 1 && element.nodeType !== 3)) return null;
  const map = getScopeMap(element);
  return map.get(element) || elementScopeMap.get(element) || null;
}
