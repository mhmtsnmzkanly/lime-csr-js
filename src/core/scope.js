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
 * Associates an alias with a canonical store path on a scope.
 *
 * @param {Object} scope
 * @param {string} alias - The loop item variable name (e.g. 'item')
 * @param {string} canonicalPath - The canonical store path (e.g. 'items.0')
 */
export function setScopeAlias(scope, alias, canonicalPath) {
  if (!scope || typeof scope !== 'object' || !alias || !canonicalPath) return;
  const parentAliases = scope[SCOPE_ALIASES_KEY] || null;
  const aliases = Object.create(parentAliases);
  aliases[alias] = canonicalPath;
  Object.defineProperty(scope, SCOPE_ALIASES_KEY, {
    value: aliases,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

/**
 * Resolves a path against aliases defined in a lexical scope.
 * E.g. If alias 'item' -> 'items.0', then 'item.name' -> 'items.0.name'.
 *
 * @param {Object|null} scope
 * @param {string} path
 * @returns {string}
 */
export function resolveCanonicalPath(scope, path) {
  if (!path || typeof path !== 'string' || !scope) return path;
  const aliases = scope[SCOPE_ALIASES_KEY];
  if (!aliases) return path;

  const dotIndex = path.indexOf('.');
  const head = dotIndex === -1 ? path : path.slice(0, dotIndex);
  const tail = dotIndex === -1 ? '' : path.slice(dotIndex);

  if (aliases[head] !== undefined) {
    return `${aliases[head]}${tail}`;
  }
  return path;
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

