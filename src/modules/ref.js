/**
 * @module modules/ref
 * Standard behavioral module for DOM element references — `data-ref="name"`.
 *
 * Contract & Invariants:
 *   - Phase: Link (strictly non-structural, zero DOM mutations).
 *   - Registers DOM elements into mount/render `refs` dictionary:
 *     - Single element: `refs.myInput = element`.
 *     - Multiple elements with same name: `refs.item = [el1, el2]`.
 *     - Explicit array suffix `data-ref="items[]"`: always an array `refs.items = [el]` (and `refs['items[]'] = refs.items`).
 *   - Accessible in event handler payloads: `handler({ event, element, scope, store, data, refs })`.
 *   - Accessible on mount instances: `app.refs.myInput`.
 *   - Automatic cleanup: when an element unmounts (e.g. branch toggle in <if data-live> or item removal in <for data-live>),
 *     its reference is cleanly deregistered via `ctx.onCleanup`.
 *   - Diagnostics:
 *     - REF_MISSING_NAME: when `data-ref` attribute is empty or whitespace only.
 */

import { attr } from '../core/triggers.js';

const REF_ATTR = 'data-ref';
const EXPLICIT_ARRAY_REF_COUNTS = Symbol.for('lime.explicitArrayRefCounts');
const REFS_STORAGE = Symbol.for('lime.refsStorage');

function sortInDomOrder(arr) {
  if (!Array.isArray(arr) || arr.length <= 1) return arr;
  return arr.sort((a, b) => {
    if (a === b) return 0;
    if (a?.isConnected && b?.isConnected && typeof a.compareDocumentPosition === 'function') {
      const pos = a.compareDocumentPosition(b);
      // Node.DOCUMENT_POSITION_FOLLOWING = 4 (b is after a -> a is first)
      if (pos & 4) return -1;
      // Node.DOCUMENT_POSITION_PRECEDING = 2 (b is before a -> b is first)
      if (pos & 2) return 1;
    }
    return 0;
  });
}

function bindRefProperty(refs, prop, storageKey) {
  const desc = Object.getOwnPropertyDescriptor(refs, prop);
  if (desc && desc.get) return;
  Object.defineProperty(refs, prop, {
    get() {
      const storage = refs[REFS_STORAGE];
      const val = storage?.get(storageKey);
      if (Array.isArray(val)) {
        return sortInDomOrder(val);
      }
      return val;
    },
    set(val) {
      const storage = (refs[REFS_STORAGE] ??= new Map());
      storage.set(storageKey, val);
    },
    enumerable: true,
    configurable: true,
  });
}

/**
 * Creates the standard `ref` module definition.
 *
 * @returns {Object} ModuleDefinition
 */
export function ref() {
  return Object.freeze({
    name: 'ref',
    triggers: [
      attr(REF_ATTR, {
        phase: 'link',

        read(el, ctx) {
          const name = el.getAttribute(REF_ATTR);
          if (!name || !name.trim()) {
            ctx.error('REF_MISSING_NAME', el);
            return null;
          }
          return { name: name.trim() };
        },

        setup(el, data, ctx) {
          if (!data || !data.name) return;
          const { name } = data;
          const refs = ctx.refs;
          if (!refs) return;

          const storage = (refs[REFS_STORAGE] ??= new Map());
          const explicitKeyCount = (refs[EXPLICIT_ARRAY_REF_COUNTS] ??= new Map());
          const isArrayRef = name.endsWith('[]');
          const key = isArrayRef ? name.slice(0, -2) : name;

          bindRefProperty(refs, key, key);
          if (isArrayRef) {
            bindRefProperty(refs, name, key);
            explicitKeyCount.set(key, (explicitKeyCount.get(key) || 0) + 1);

            let arr = storage.get(key);
            if (!Array.isArray(arr)) {
              arr = arr !== undefined ? [arr] : [];
              storage.set(key, arr);
            }
            if (!arr.includes(el)) {
              arr.push(el);
            }

            ctx.onCleanup(() => {
              const count = (explicitKeyCount.get(key) || 1) - 1;
              if (count <= 0) explicitKeyCount.delete(key);
              else explicitKeyCount.set(key, count);

              const currentArr = storage.get(key);
              if (Array.isArray(currentArr)) {
                const idx = currentArr.indexOf(el);
                if (idx !== -1) currentArr.splice(idx, 1);
                if (currentArr.length === 0) {
                  storage.delete(key);
                  delete refs[key];
                  delete refs[name];
                } else if (currentArr.length === 1 && !explicitKeyCount.has(key)) {
                  storage.set(key, currentArr[0]);
                  delete refs[name];
                }
              }
            });
          } else {
            let previous = storage.get(key);
            if (previous === undefined) {
              storage.set(key, el);
            } else if (Array.isArray(previous)) {
              if (!previous.includes(el)) previous.push(el);
            } else if (previous !== el) {
              storage.set(key, [previous, el]);
            }

            ctx.onCleanup(() => {
              const current = storage.get(key);
              if (Array.isArray(current)) {
                const idx = current.indexOf(el);
                if (idx !== -1) current.splice(idx, 1);
                if (current.length === 1 && !explicitKeyCount.has(key)) {
                  storage.set(key, current[0]);
                } else if (current.length === 0) {
                  storage.delete(key);
                  delete refs[key];
                  delete refs[`${key}[]`];
                }
              } else if (current === el) {
                storage.delete(key);
                delete refs[key];
              }
            });
          }
        },
      }),
    ],
  });
}

export default ref;
