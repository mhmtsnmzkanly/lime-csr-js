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

          const isArrayRef = name.endsWith('[]');
          const key = isArrayRef ? name.slice(0, -2) : name;

          if (isArrayRef) {
            if (!Array.isArray(refs[key])) {
              refs[key] = [];
            }
            refs[key].push(el);
            refs[name] = refs[key];

            ctx.onCleanup(() => {
              const arr = refs[key];
              if (Array.isArray(arr)) {
                const idx = arr.indexOf(el);
                if (idx !== -1) arr.splice(idx, 1);
                if (arr.length === 0) {
                  delete refs[key];
                  delete refs[name];
                }
              }
            });
          } else {
            const previous = refs[key];
            if (previous === undefined) {
              refs[key] = el;
            } else if (Array.isArray(previous)) {
              if (!previous.includes(el)) previous.push(el);
            } else if (previous !== el) {
              refs[key] = [previous, el];
            }

            ctx.onCleanup(() => {
              const current = refs[key];
              if (Array.isArray(current)) {
                const idx = current.indexOf(el);
                if (idx !== -1) current.splice(idx, 1);
                if (current.length === 1) {
                  refs[key] = current[0];
                } else if (current.length === 0) {
                  delete refs[key];
                }
              } else if (current === el) {
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
