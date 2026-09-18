/**
 * @module modules/text
 * Standard behavioral module for reactive text and attribute template bindings:
 *   - data-text="path"             → watch store/scope, update el.textContent.
 *   - href="/u/{x}" data-x="p"    → template + watch store/scope, update attribute.
 *
 * Contract & Invariants:
 *   - Phase: Link (zero structural DOM mutations).
 *   - Cleanups auto-registered via ModuleContext (`ctx.watch`).
 *   - Security:
 *     - textContent does not parse HTML → escapeHtml not needed.
 *     - setAttribute encodes itself; URL attributes sanitized via isSafeUrlProtocol.
 *     - Event handler attributes (onclick, onerror, ...) strictly rejected.
 *     - Reserved placeholder names (text, model, show, live, ref, diff, on-*) emit RESERVED_ATTR_NAME.
 *   - Subscriptions set up once in setup(); updates occur in-place via callbacks without re-running read().
 */

import { attr, pattern } from '../core/triggers.js';
import { getByPath } from '../store.js';
import { isSafeUrlProtocol } from '../utils.js';

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'data', 'cite', 'poster', 'ping']);
const EVENT_ATTR_PATTERN = /^on/i;
const RESERVED_NAMES = new Set(['text', 'model', 'show', 'live', 'ref', 'diff', 'lime-ignore']);

function isReservedName(name) {
  return RESERVED_NAMES.has(name) || name.startsWith('on-');
}

let refCounter = 0;
function nextRef() {
  return `lcsr-${++refCounter}`;
}

/**
 * Creates the standard `text` module definition.
 *
 * @returns {Object} ModuleDefinition
 */
export function text() {
  return Object.freeze({
    name: 'text',
    triggers: [
      // 1. Exact attribute trigger for data-text
      attr('data-text', {
        phase: 'link',

        read(el, ctx) {
          const path = el.getAttribute('data-text');
          if (!path || !path.trim()) {
            ctx.error('BINDING_MISSING_PATH', el);
            return null;
          }
          return { path: path.trim() };
        },

        setup(el, data, ctx) {
          if (!data || !data.path) return;

          let val = ctx.scope ? getByPath(ctx.scope, data.path) : undefined;
          if (val === undefined && ctx.store && typeof ctx.store.get === 'function') {
            val = ctx.store.get(data.path);
          }

          el.textContent = val ?? '';

          if (ctx.store) {
            ctx.watch(data.path, (nextVal) => {
              el.textContent = nextVal ?? '';
            });
          }
        },
      }),

      // 2. Pattern trigger for attribute template placeholders: {x}
      pattern(/^(?!data-).+/, {
        phase: 'link',

        match(el, attrName, attrNode) {
          if (!attrName || attrName.startsWith('data-')) return false;
          const val = attrNode ? attrNode.value : el.getAttribute(attrName);
          return typeof val === 'string' && val.indexOf('{') !== -1 && /\{[^}]+\}/.test(val);
        },

        read(el, ctx) {
          const attrName = ctx.matchedAttribute;
          if (!attrName) return null;

          if (EVENT_ATTR_PATTERN.test(attrName)) {
            ctx.error('UNSAFE_EVENT_ATTR', { attrName }, el);
            return null;
          }

          const template = el.getAttribute(attrName);
          if (typeof template !== 'string') return null;

          const bindings = {};
          for (const [, key] of template.matchAll(/\{([^}]+)\}/g)) {
            if (key in bindings) continue;

            if (isReservedName(key)) {
              ctx.error('RESERVED_ATTR_NAME', { name: key }, el);
              return null;
            }

            const storePath = el.getAttribute(`data-${key}`);
            if (!storePath) {
              ctx.error('BINDING_MISSING_DATA_ATTR', { attrName, key }, el);
              return null;
            }
            bindings[key] = storePath.trim();
          }

          if (Object.keys(bindings).length === 0) return null;

          return { attrName, template, bindings };
        },

        setup(el, data, ctx) {
          if (!data) return;
          const { attrName, template, bindings } = data;

          if (!el.dataset.ref) {
            el.dataset.ref = nextRef();
          }

          // Consume the matched data-x attributes
          for (const key of Object.keys(bindings)) {
            el.removeAttribute(`data-${key}`);
          }

          const resolve = () => {
            let resolved = template.replace(/\{([^}]+)\}/g, (_, key) => {
              const path = bindings[key];
              let val = ctx.scope ? getByPath(ctx.scope, path) : undefined;
              if (val === undefined && ctx.store && typeof ctx.store.get === 'function') {
                val = ctx.store.get(path);
              }
              return String(val ?? '');
            });

            if (URL_ATTRS.has(attrName)) {
              resolved = isSafeUrlProtocol(resolved) ? resolved : '';
            }

            el.setAttribute(attrName, resolved);
          };

          resolve();

          const uniquePaths = [...new Set(Object.values(bindings))];
          if (ctx.store) {
            for (const path of uniquePaths) {
              ctx.watch(path, resolve);
            }
          }
        },
      }),
    ],
  });
}

export default text;
