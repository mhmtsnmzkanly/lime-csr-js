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

import { attr, pattern } from '../core/triggers.js';

const MODEL_ATTR = 'data-model';
const GROUP_ATTR = 'data-model-group';
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
  if (el.tagName === 'INPUT') {
    const type = (el.type || el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'number' || type === 'range') return 'number';
    if (type === 'file') return 'file';
    return 'text';
  }
  const isEditable = el.isContentEditable ||
    el.getAttribute('contenteditable') === 'true' ||
    el.getAttribute('contenteditable') === '' ||
    el.contentEditable === 'true';
  if (isEditable) {
    return 'contenteditable';
  }
  const type = (el.type || el.getAttribute('type') || 'text').toLowerCase();
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (type === 'number' || type === 'range') return 'number';
  if (type === 'file') return 'file';
  return 'text';
}

const KIND_HANDLERS = {
  contenteditable: {
    event: 'input',
    read: (el, modifiers) => (modifiers?.text ? (el.textContent || '') : el.innerHTML),
    write: (el, val, isArray, modifiers) => {
      const next = val == null ? '' : String(val);
      if (modifiers?.text) {
        if (el.textContent === next) return;
        el.textContent = next;
      } else {
        if (el.innerHTML === next) return;
        el.innerHTML = next;
      }
    },
  },
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
    write: (el, val, isArray) => {
      if (isArray || Array.isArray(val)) {
        const arr = Array.isArray(val) ? val.map(String) : [];
        const next = arr.includes(el.value);
        if (el.checked !== next) el.checked = next;
      } else {
        const next = Boolean(val);
        if (el.checked !== next) el.checked = next;
      }
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
    case 'contenteditable': {
      const html = el.innerHTML;
      return html && html.trim() !== '' ? html : undefined;
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

const domFallbackStores = new WeakMap();

function markDomFallback(store, path) {
  let set = domFallbackStores.get(store);
  if (!set) {
    set = new Set();
    domFallbackStores.set(store, set);
  }
  set.add(path);
}

function isDomFallback(store, path) {
  return domFallbackStores.get(store)?.has(path) ?? false;
}

function getPrimaryModelAttribute(el) {
  if (!el || !el.attributes) return null;
  if (el.hasAttribute(MODEL_ATTR)) return MODEL_ATTR;
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const name = attrs[i].name;
    if (/^data-model[.-]/.test(name) && !name.startsWith('data-model-group') && attrs[i].value.trim()) {
      return name;
    }
  }
  for (let i = 0; i < attrs.length; i++) {
    const name = attrs[i].name;
    if (/^data-model[.-]/.test(name) && !name.startsWith('data-model-group')) {
      return name;
    }
  }
  return null;
}

function parseModifiers(el, primaryAttrName) {
  const modifiers = {
    lazy: false,
    trim: false,
    number: false,
    text: false,
    debounce: null,
  };

  function applyToken(token, val) {
    if (!token) return;
    const t = token.toLowerCase();
    if (t === 'lazy') {
      modifiers.lazy = true;
    } else if (t === 'trim') {
      modifiers.trim = true;
    } else if (t === 'number') {
      modifiers.number = true;
    } else if (t === 'text') {
      modifiers.text = true;
    } else if (t === 'debounce') {
      const ms = val ? parseInt(val, 10) : NaN;
      modifiers.debounce = Number.isFinite(ms) && ms >= 0 ? ms : 300;
    } else if (t.startsWith('debounce-')) {
      const ms = parseInt(t.slice(9), 10);
      modifiers.debounce = Number.isFinite(ms) && ms >= 0 ? ms : 300;
    }
  }

  // 1. Primary attribute name tokens
  if (primaryAttrName) {
    if (primaryAttrName.includes('.')) {
      const dotTokens = primaryAttrName.split('.').slice(1);
      for (const tok of dotTokens) {
        applyToken(tok);
      }
    } else if (primaryAttrName.startsWith('data-model-')) {
      const suffix = primaryAttrName.slice(11);
      if (suffix && !suffix.startsWith('group')) {
        const parts = suffix.split('-');
        if (parts[0] === 'debounce') {
          applyToken(suffix);
        } else {
          for (const tok of parts) {
            applyToken(tok);
          }
        }
      }
    }
  }

  // 2. Companion attributes
  if (el.attributes) {
    for (let i = 0; i < el.attributes.length; i++) {
      const attrNode = el.attributes[i];
      const name = attrNode.name;
      if (name === primaryAttrName || name === 'data-model-group' || name.startsWith('data-model-group')) {
        continue;
      }
      if (name.startsWith('data-model.') || name.startsWith('data-model-')) {
        if (name.includes('.')) {
          const dotTokens = name.split('.').slice(1);
          for (const tok of dotTokens) {
            applyToken(tok, attrNode.value);
          }
        } else {
          const suffix = name.slice(11);
          const parts = suffix.split('-');
          if (parts[0] === 'debounce') {
            applyToken(suffix, attrNode.value);
          } else {
            for (const tok of parts) {
              applyToken(tok, attrNode.value);
            }
          }
        }
      }
    }
  }

  return modifiers;
}

function hasExplicitModel(el) {
  if (el.hasAttribute(MODEL_ATTR)) {
    const val = el.getAttribute(MODEL_ATTR);
    return val && val.trim().length > 0;
  }
  const attrs = el.attributes;
  if (!attrs) return false;
  for (let i = 0; i < attrs.length; i++) {
    const name = attrs[i].name;
    if (/^data-model[.-]/.test(name) && !name.startsWith(GROUP_ATTR) && attrs[i].value.trim()) {
      return true;
    }
  }
  return false;
}

/**
 * Binds a single control element to a store path.
 *
 * @param {Element} el
 * @param {{ path: string, kind: string, isArray?: boolean, modifiers?: Object }} data
 * @param {import('../core/context.js').ModuleContext} ctx
 */
function bindModelControl(el, data, ctx) {
  const handler = KIND_HANDLERS[data.kind];
  const modifiers = data.modifiers || { lazy: false, trim: false, number: false, text: false, debounce: null };

  // Checkbox array handling vs standard handling
  const isCheckboxArray = data.kind === 'checkbox' && (data.isArray || Array.isArray(ctx.store.get(data.path)));

  if (isCheckboxArray) {
    const storeVal = ctx.store.get(data.path);
    const isChecked = el.hasAttribute('checked') || el.defaultChecked || el.checked;

    if (storeVal === undefined) {
      markDomFallback(ctx.store, data.path);
      if (isChecked) {
        ctx.store.set(data.path, [el.value]);
        el.checked = true;
      } else {
        ctx.store.set(data.path, []);
        el.checked = false;
      }
    } else if (isDomFallback(ctx.store, data.path)) {
      if (isChecked) {
        const arr = Array.isArray(storeVal) ? [...storeVal] : [];
        if (!arr.map(String).includes(el.value)) {
          arr.push(el.value);
          ctx.store.set(data.path, arr);
        }
        el.checked = true;
      } else {
        el.checked = false;
      }
    } else {
      handler.write(el, storeVal, true);
    }
  } else {
    // Initial state -> DOM or DOM -> Store fallback
    const storeVal = ctx.store.get(data.path);
    if (storeVal !== undefined) {
      handler.write(el, storeVal, false, modifiers);
    } else {
      let initialDom = getInitialDomValue(el, data.kind);
      if (initialDom !== undefined) {
        if (data.kind === 'contenteditable' && modifiers.text) {
          initialDom = el.textContent || '';
        }
        if (modifiers.trim && typeof initialDom === 'string') {
          initialDom = initialDom.trim();
        }
        if (modifiers.number && typeof initialDom === 'string') {
          if (initialDom === '') {
            initialDom = null;
          } else {
            const n = Number(initialDom);
            initialDom = Number.isNaN(n) ? initialDom : n;
          }
        }
        ctx.store.set(data.path, initialDom);
        handler.write(el, initialDom, false, modifiers);
      } else {
        handler.write(el, undefined, false, modifiers);
      }
    }
  }

  let debounceTimer = null;

  // DOM -> State event listener
  const commit = () => {
    if (data.kind === 'radio' && !el.checked) return;

    if (data.kind === 'checkbox') {
      const currentVal = ctx.store.get(data.path);
      const inArrayMode = data.isArray || Array.isArray(currentVal);
      if (inArrayMode) {
        const arr = Array.isArray(currentVal) ? [...currentVal] : [];
        const val = el.value;
        const idx = arr.map(String).indexOf(val);
        if (el.checked) {
          if (idx === -1) arr.push(val);
        } else {
          if (idx !== -1) arr.splice(idx, 1);
        }
        ctx.store.set(data.path, arr);
        return;
      }
    }

    let val = data.kind === 'contenteditable'
      ? handler.read(el, modifiers)
      : handler.read(el);
    if (modifiers.trim && typeof val === 'string') {
      val = val.trim();
    }
    if (modifiers.number) {
      if (typeof val === 'string') {
        if (val === '') {
          val = null;
        } else {
          const n = Number(val);
          val = Number.isNaN(n) ? val : n;
        }
      }
    }

    ctx.store.set(data.path, val);
  };

  const onEvent = () => {
    if (modifiers.debounce !== null && modifiers.debounce >= 0) {
      if (debounceTimer) {
        globalThis.clearTimeout(debounceTimer);
      }
      debounceTimer = globalThis.setTimeout(() => {
        debounceTimer = null;
        commit();
      }, modifiers.debounce);
    } else {
      commit();
    }
  };

  const eventName = modifiers.lazy
    ? (data.kind === 'contenteditable' ? 'blur' : 'change')
    : handler.event;

  el.addEventListener(eventName, onEvent);
  ctx.onCleanup(() => {
    el.removeEventListener(eventName, onEvent);
    if (debounceTimer) {
      globalThis.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  });

  // State -> DOM subscription
  ctx.watch(data.path, (val) => {
    if (debounceTimer) {
      globalThis.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    handler.write(el, val, data.isArray || Array.isArray(val), modifiers);
  });
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
      pattern(/^data-model(?:[.-].+)?$/, {
        phase: 'link',
        exclude: [GROUP_ATTR, /^data-model-group-/],

        match(element, attrName) {
          return attrName === getPrimaryModelAttribute(element);
        },

        read(el, ctx) {
          const primaryAttr = ctx.matchedAttribute || getPrimaryModelAttribute(el) || MODEL_ATTR;
          const path = el.getAttribute(primaryAttr);
          if (!path || !path.trim()) {
            ctx.error('MODEL_MISSING_PATH', el);
            return null;
          }

          let trimmedPath = path.trim();
          const isArray = trimmedPath.endsWith('[]');
          if (isArray) {
            trimmedPath = trimmedPath.slice(0, -2).trim();
            if (!trimmedPath) {
              ctx.error('MODEL_MISSING_PATH', el);
              return null;
            }
          }

          if (INDEXED_PATH_RE.test(trimmedPath)) {
            ctx.error('INDEXED_MODEL_PATH', { path: trimmedPath }, el);
          }

          const kind = classify(el);
          const modifiers = parseModifiers(el, primaryAttr);

          return { path: trimmedPath, kind, isArray, modifiers };
        },

        setup(el, data, ctx) {
          if (!data || !data.path) return;

          if (!ctx.store) {
            ctx.warn('MODULE_STORE_REQUIRED', `Module "model" requires a store to bind "${data.path}".`, el);
            return;
          }

          bindModelControl(el, data, ctx);
        },
      }),

      attr(GROUP_ATTR, {
        phase: 'link',

        read(el, ctx) {
          const prefix = el.getAttribute(GROUP_ATTR);
          if (!prefix || !prefix.trim()) {
            ctx.error('MODEL_GROUP_MISSING_PREFIX', el);
            return null;
          }
          const trimmedPrefix = prefix.trim();
          if (INDEXED_PATH_RE.test(trimmedPrefix)) {
            ctx.error('INDEXED_MODEL_PATH', { path: trimmedPrefix }, el);
          }
          return { prefix: trimmedPrefix };
        },

        setup(el, data, ctx) {
          if (!data || !data.prefix) return;

          if (!ctx.store) {
            ctx.warn('MODULE_STORE_REQUIRED', `Module "model" requires a store to bind group "${data.prefix}".`, el);
            return;
          }

          const candidates = el.querySelectorAll('input[name], select[name], textarea[name], [contenteditable][name]');

          for (let i = 0; i < candidates.length; i++) {
            const child = candidates[i];
            if (child.closest?.(`[${GROUP_ATTR}]`) !== el) continue;
            if (hasExplicitModel(child)) continue;

            const rawName = child.getAttribute('name');
            if (!rawName || !rawName.trim()) continue;

            let trimmedName = rawName.trim();
            const isArray = trimmedName.endsWith('[]');
            if (isArray) {
              trimmedName = trimmedName.slice(0, -2).trim();
              if (!trimmedName) continue;
            }

            const path = `${data.prefix}.${trimmedName}`;
            if (INDEXED_PATH_RE.test(path)) {
              ctx.error('INDEXED_MODEL_PATH', { path }, child);
            }

            const kind = classify(child);
            const modifiers = parseModifiers(child, null);

            bindModelControl(child, { path, kind, isArray, modifiers }, ctx);
          }
        },
      }),
    ],
  });
}

export default model;
