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

const elementScopeMap = new WeakMap();

/**
 * Associates a DOM element or fragment's subtree with a lexical scope.
 *
 * @param {Node|Element|DocumentFragment} node
 * @param {Object} scope
 */
export function setElementScope(node, scope) {
  if (!node || !scope) return;
  if (node.nodeType === 1 || node.nodeType === 3) {
    elementScopeMap.set(node, scope);
  }
  if (typeof node.querySelectorAll === 'function') {
    const els = node.querySelectorAll('*');
    for (let i = 0; i < els.length; i++) {
      elementScopeMap.set(els[i], scope);
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
  return elementScopeMap.get(element) || null;
}
