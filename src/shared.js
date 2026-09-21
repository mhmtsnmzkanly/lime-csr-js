/**
 * @module shared
 * @description Pure utility helper functions for lime-csr.js.
 * This module is a leaf dependency and must not import any other modules in the codebase.
 */

/**
 * Checks if a given node is inside an ignored block (has data-lime-ignore).
 * If the node itself carries data-lime-ignore, it returns true (the node is
 * part of the ignored region).
 *
 * Used by: template.js, modules/loops.js, modules/conditionals.js.
 *
 * @param {Node} node
 * @returns {boolean}
 */
export function inIgnoredBlock(node) {
  if (!node) return false;
  const el = node.nodeType === 1 ? node : node.parentElement;
  if (!el) return false;
  if (typeof el.hasAttribute === 'function' && el.hasAttribute('data-lime-ignore')) {
    return true;
  }
  return !!el.closest?.('[data-lime-ignore]');
}

/**
 * Checks if a given node is inside a not-yet-expanded reactive block
 * (<if data-live> or <for data-live>).
 * A top-level live root returns false so it can be expanded in this pass; a
 * live root nested inside another live block returns true and is deferred to
 * that ancestor's recursive render with the correct context.
 *
 * Used by: template.js, modules/conditionals.js, modules/loops.js.
 *
 * @param {Node} node
 * @returns {boolean}
 */
export function inLiveBlock(node) {
  if (!node) return false;
  const parent = node.parentElement;
  return !!(
    parent?.closest?.('if[data-live], for[data-live], template[data-if][data-live], template[data-for][data-live]')
  );
}

/**
 * Checks if a given node is inside the content of a not-yet-expanded ordinary
 * (non-data-live) <for> block.
 * If the node itself is the root <for> element, it returns false (so its own
 * attributes can still be resolved).
 *
 * Used by: template.js, modules/loops.js.
 *
 * @param {Node} node
 * @returns {boolean}
 */
export function inUnexpandedFor(node) {
  if (!node) return false;
  const selector = 'for:not([data-live]), template[data-for]:not([data-live])';
  if (node.nodeType !== 1) {
    const parent = node.parentElement;
    return !!parent?.closest?.(selector);
  }
  const isForRoot = node.matches?.(selector);
  if (isForRoot) return false;
  return !!node.closest?.(selector);
}

/**
 * Longest Increasing Subsequence, via patience sorting — O(n log n).
 *
 * Given a sequence of numbers, returns the SET of indices (into `seq`) that
 * form one valid longest increasing subsequence. Used by the "lcs" diff
 * strategy: `seq` is the OLD position of each surviving item, listed in NEW
 * order — the LIS is the maximal set of survivors whose relative order is
 * unchanged, and can therefore stay physically untouched in the DOM.
 *
 * Used by: modules/loops.js.
 *
 * @param {number[]} seq
 * @returns {Set<number>} indices into `seq`
 */
export function longestIncreasingSubsequenceIndices(seq) {
  const n = seq.length;
  if (n === 0) return new Set();

  // tails[k] = index (into seq) of the smallest possible tail value for an
  // increasing subsequence of length k+1 found so far.
  const tails = [];
  // predecessors[i] = index (into seq) of the previous element in the
  // increasing subsequence that ends at i, or -1 if i starts one.
  const predecessors = new Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const val = seq[i];

    // Binary search: first position in `tails` whose seq-value is >= val.
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < val) lo = mid + 1;
      else hi = mid;
    }

    if (lo > 0) predecessors[i] = tails[lo - 1];
    if (lo === tails.length) tails.push(i);
    else tails[lo] = i;
  }

  // Reconstruct the subsequence by walking predecessors backward from the
  // last element of the longest tail found.
  const result = new Set();
  let k = tails[tails.length - 1];
  while (k !== -1) {
    result.add(k);
    k = predecessors[k];
  }
  return result;
}

/**
 * Performs a shallow equality check between two values.
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
export function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;

  if (aIsArray) {
    const len = a.length;
    if (len !== b.length) return false;
    for (let i = 0; i < len; i++) {
      if (!Object.is(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    if (!Object.hasOwn(b, key) || !Object.is(a[key], b[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Determines whether an attribute name is unsafe for dynamic binding or interpolation
 * (e.g. event handlers like onclick, or script-injecting attributes like srcdoc).
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isUnsafeAttribute(name) {
  if (typeof name !== 'string') return false;
  const normalized = name.trim().toLowerCase();
  return normalized.startsWith('on') || normalized === 'srcdoc';
}
