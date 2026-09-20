/**
 * @module modules/model
 * Standard behavioral module for two-way form binding — `data-model="path"`.
 *
 * Contract & Invariants:
 *   - Phase: Link (zero structural DOM mutations).
 *   - Two-way synchronization:
 *     - DOM -> Store: on event ('input' or 'change'), store.set(path, read(el)).
 *     - Store -> DOM: on store change, write(el, store.get(path)).
 *   - Loop & Cursor Guard:
 *     - write() skips assignment if el value equals incoming state to prevent cursor jump and feedback loops.
 *   - Supported controls:
 *     - text, textarea, email, password, etc. (event: 'input')
 *     - number, range (event: 'input', converted via Number() unless NaN or empty)
 *     - checkbox (event: 'change', boolean checked)
 *     - radio (event: 'change', value matching)
 *     - select (single) (event: 'change', el.value)
 *     - select (multiple) (event: 'change', array of values)
 *   - Indexed path warning: Emits INDEXED_MODEL_PATH if path has numeric segment (e.g. items.0.name).
 *   - Cleanups: event listener and watch subscription auto-registered via ModuleContext.
 */

import { attr } from '../core/triggers.js';

const MODEL_ATTR = 'data-model';
const INDEXED_PATH_RE = /(?:^|\.)\d+(?:\.|$)/;

/**
 * Classifies an element into a supported form input kind.
 *
 * @param {Element} el
 * @returns {'checkbox'|'radio'|'select-multiple'|'select-single'|'number'|'text'|'file'}
 */
function classify(el) {
  if (el.tagName === 'SELECT') {
    return el.multiple ? 'select-multiple' : 'select-single';
  }
  if (el.tagName === 'TEXTAREA') {
    return 'text';
  }
  const type = (el.type || el.getAttribute('type') || 'text').toLowerCase();
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (type === 'number' || type === 'range') return 'number';
  if (type === 'file') return 'file';
  return 'text';
}

const KIND_HANDLERS = {
  file: {
    event: 'change',
    read: (el) => (el.multiple ? Array.from(el.files || []) : (el.files?.[0] || null)),
    write: (el, val) => {
      if (val == null || val === '') {
        el.value = '';
      }
    },
  },
  text: {
    event: 'input',
    read: (el) => el.value,
    write: (el, val) => {
      const next = val == null ? '' : String(val);
      if (el.value === next) return;
      el.value = next;
    },
  },
  number: {
    event: 'input',
    read: (el) => {
      const raw = el.value;
      if (raw === '') return null;
      const n = Number(raw);
      return Number.isNaN(n) ? raw : n;
    },
    write: (el, val) => {
      const next = val == null ? '' : String(val);
      if (el.value === next) return;
      el.value = next;
    },
  },
  checkbox: {
    event: 'change',
    read: (el) => el.checked,
    write: (el, val) => {
      const next = Boolean(val);
      if (el.checked === next) return;
      el.checked = next;
    },
  },
  'select-single': {
    event: 'change',
    read: (el) => el.value,
    write: (el, val) => {
      const next = val == null ? '' : String(val);
      if (el.value === next) return;
      el.value = next;
    },
  },
  'select-multiple': {
    event: 'change',
    read: (el) => Array.from(el.selectedOptions).map((opt) => opt.value),
    write: (el, val) => {
      const arr = Array.isArray(val) ? val.map(String) : [];
      for (const opt of el.options) {
        const shouldSelect = arr.includes(opt.value);
        if (opt.selected !== shouldSelect) opt.selected = shouldSelect;
      }
    },
  },
  radio: {
    event: 'change',
    read: (el) => el.value,
    write: (el, val) => {
      const next = el.value === (val == null ? '' : String(val));
      if (el.checked !== next) el.checked = next;
    },
  },
};

/**
 * Reads initial DOM value if an explicit HTML attribute is present.
 *
 * @param {Element} el
 * @param {string} kind
 * @returns {any} Initial DOM value or undefined if not present.
 */
function getInitialDomValue(el, kind) {
  switch (kind) {
    case 'checkbox':
      return (el.hasAttribute('checked') || el.defaultChecked) ? true : undefined;
    case 'radio':
      return (el.hasAttribute('checked') || el.defaultChecked || el.checked) ? el.value : undefined;
    case 'select-single': {
      const opt = Array.from(el.options).find((o) => o.hasAttribute('selected') || o.defaultSelected);
      return opt ? opt.value : undefined;
    }
    case 'select-multiple': {
      const opts = Array.from(el.options).filter((o) => o.hasAttribute('selected') || o.defaultSelected);
      return opts.length > 0 ? opts.map((o) => o.value) : undefined;
    }
    case 'number': {
      if (el.hasAttribute('value')) {
        const raw = el.value;
        if (raw === '') return null;
        const n = Number(raw);
        return Number.isNaN(n) ? raw : n;
      }
      return undefined;
    }
    case 'text': {
      if (el.tagName === 'TEXTAREA') {
        if (el.defaultValue && el.defaultValue !== '') return el.value;
        if (el.hasAttribute('value')) return el.value;
        return undefined;
      }
      return el.hasAttribute('value') ? el.value : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Creates the standard `model` module definition.
 *
 * @returns {Object} ModuleDefinition
 */
export function model() {
  return Object.freeze({
    name: 'model',
    triggers: [
      attr(MODEL_ATTR, {
        phase: 'link',

        read(el, ctx) {
          const path = el.getAttribute(MODEL_ATTR);
          if (!path || !path.trim()) {
            ctx.error('MODEL_MISSING_PATH', el);
            return null;
          }

          const trimmedPath = path.trim();
          if (INDEXED_PATH_RE.test(trimmedPath)) {
            ctx.error('INDEXED_MODEL_PATH', { path: trimmedPath }, el);
          }

          const kind = classify(el);
          return { path: trimmedPath, kind };
        },

        setup(el, data, ctx) {
          if (!data || !data.path) return;

          if (!ctx.store) {
            ctx.warn('MODULE_STORE_REQUIRED', `Module "model" requires a store to bind "${data.path}".`, el);
            return;
          }

          const handler = KIND_HANDLERS[data.kind];

          // Initial state -> DOM or DOM -> Store fallback
          const storeVal = ctx.store.get(data.path);
          if (storeVal !== undefined) {
            handler.write(el, storeVal);
          } else {
            const initialDom = getInitialDomValue(el, data.kind);
            if (initialDom !== undefined) {
              ctx.store.set(data.path, initialDom);
              handler.write(el, initialDom);
            } else {
              handler.write(el, undefined);
            }
          }

          // DOM -> State event listener
          const onEvent = () => {
            if (data.kind === 'radio' && !el.checked) return;
            ctx.store.set(data.path, handler.read(el));
          };

          el.addEventListener(handler.event, onEvent);
          ctx.onCleanup(() => {
            el.removeEventListener(handler.event, onEvent);
          });

          // State -> DOM subscription
          ctx.watch(data.path, (val) => {
            handler.write(el, val);
          });
        },
      }),
    ],
  });
}

export default model;
