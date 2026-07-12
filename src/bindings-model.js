/**
 * @module bindings-model
 * Two-way form binding — `data-model="path"`.
 *
 * WHAT IT DOES
 *   <input data-model="user.name">
 *   - DOM to state: on element event (see "EVENT SELECTION"), store.set(path, ...).
 *   - State to DOM: store.subscribe on path change, updates element value.
 *   Both directions — the read-write counterpart of data-text's "read-only".
 *   NO EVAL: path is a fixed string, no expression is executed; only
 *   getByPath/store API is used (see store.js).
 *
 * SUPPORTED INPUT TYPES (see classify()):
 *   - text/textarea/email/password/... (default) → el.value, 'input' event.
 *   - number/range → el.value read as Number(), 'input' event.
 *   - checkbox → el.checked (boolean), 'change' event.
 *   - radio → group sharing the same data-model path; only the checked
 *     radio's value is written to state; state change makes the matching radio
 *     checked (see "RADIO GROUPS"), 'change' event.
 *   - select (single) → el.value, 'change' event.
 *   - select[multiple] → array of selected option values, 'change' event.
 *
 * NUMERIC INPUT DECISION (number/range):
 *   Read value is converted via Number() (stored as number in state — so
 *   comparisons with is-gt etc. work directly). Exception: if the field is
 *   empty or Number() returns NaN (user typing "-" or "1." etc.), the RAW
 *   STRING is stored — otherwise data would silently disappear (jump to NaN
 *   or 0).
 *
 * LOOP GUARD (write ↔ read):
 *   User types → store.set → subscribe fires → element updated.
 *   If the new value equals the element's current value, the write is skipped
 *   (see write() functions) — otherwise cursor position (input/textarea)
 *   could reset. Since store.set's own subscribe trigger always has
 *   "new value == element's current value", this in practice COMPLETELY prevents
 *   unnecessary writes (and therefore cursor jumps).
 *
 * RADIO GROUPS:
 *   input[type=radio][data-model="x"] may share the same path across multiple
 *   elements (a group). The group gets ONE subscribe (not one per element) —
 *   when state changes, every radio's checked is updated to match its value.
 *   Each radio still has its own 'change' listener (writes only when checked).
 *
 * OUT OF SCOPE (same pattern as bindings.js):
 *   data-model inside an unexpanded <if data-live>/<for data-live> block is
 *   NOT bound here — that content is bound only by renderFn (render()) with
 *   the correct dal/element context. Otherwise, on branch change, the old
 *   subscription/listener cannot be cancelled → leak.
 *
 * data-model + data-on-input ON SAME ELEMENT (2h):
 *   When both attributes are on the same element, data-model runs FIRST.
 *   This order is enforced in index.js (setupModelBindings before event bindings).
 *   Result: the model handler fires before any data-on-input handler, so the
 *   store is updated by the time the application handler runs.
 *
 * INDEXED PATH WARNING (2a — T1 fix):
 *   If data-model path contains a numeric index segment (e.g. "items.0.name"),
 *   a dev-mode warning is issued: after array mutation the path drifts and
 *   points to the wrong item. Use a reactive <for data-live key=...> loop instead.
 */

import { errors } from './errors.js';
import { inLiveBlock, inIgnoredBlock } from './shared.js';

const MODEL_ATTR = 'data-model';

// Detect paths like "items.0.name" or "list.2" (numeric segment anywhere)
const INDEXED_PATH_RE = /(?:^|\.)\d+(?:\.|$)/;



/**
 * Determines the element's data-model kind.
 *
 * @param {Element} el
 * @returns {'checkbox'|'radio'|'select-multiple'|'select-single'|'number'|'text'}
 */
function classify(el) {
  if (el.tagName === 'SELECT') return el.multiple ? 'select-multiple' : 'select-single';
  if (el.tagName === 'TEXTAREA') return 'text';
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (type === 'number' || type === 'range') return 'number';
  return 'text';
}

/**
 * For each input kind: which event to listen for, how to read from the DOM,
 * how to write to the DOM (skip if same value — loop/cursor protection).
 *
 * @type {Object<string, { event: string, read: function(Element): *, write: function(Element, *): void }>}
 */
const KIND_HANDLERS = {
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
      if (raw === '') return '';
      const n = Number(raw);
      return Number.isNaN(n) ? raw : n; // invalid/partial input → raw string (no data loss)
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
};

/**
 * Binds a single (non-radio) data-model element.
 *
 * @param {Element} el
 * @param {import('./store.js').Store} store
 * @returns {function(): void} cleanup
 */
function bindElement(el, store) {
  const path = el.getAttribute(MODEL_ATTR);
  const handler = KIND_HANDLERS[classify(el)];

  // 2a T1: warn if path contains numeric index (path drift risk)
  if (INDEXED_PATH_RE.test(path)) {
    errors.indexedModelPath(path, el);
  }

  handler.write(el, store.get(path)); // initial value: state → DOM

  // 2h: data-model handler runs FIRST (before data-on-input handlers)
  const onEvent = () => { store.set(path, handler.read(el)); }; // DOM → state
  el.addEventListener(handler.event, onEvent);

  const unsubscribe = store.subscribe(path, (val) => handler.write(el, val)); // state → DOM

  return function cleanup() {
    el.removeEventListener(handler.event, onEvent);
    unsubscribe();
  };
}

/**
 * Binds a radio group sharing the same path with a SINGLE subscription.
 *
 * @param {string}    path
 * @param {Element[]} radios
 * @param {import('./store.js').Store} store
 * @returns {function(): void} cleanup
 */
function bindRadioGroup(path, radios, store) {
  const applyStoreValue = (val) => {
    const str = val == null ? '' : String(val);
    for (const radio of radios) {
      const next = radio.value === str;
      if (radio.checked !== next) radio.checked = next;
    }
  };

  applyStoreValue(store.get(path)); // initial value: state → DOM

  const listeners = radios.map((radio) => {
    const onChange = () => { if (radio.checked) store.set(path, radio.value); };
    radio.addEventListener('change', onChange);
    return { radio, onChange };
  });

  const unsubscribe = store.subscribe(path, applyStoreValue); // state → DOM

  return function cleanup() {
    for (const { radio, onChange } of listeners) radio.removeEventListener('change', onChange);
    unsubscribe();
  };
}

/**
 * Two-way binds every [data-model] element under root to the store.
 * Opens subscriptions + event listeners; the returned cleanup() cancels all of them.
 *
 * @param {Element|DocumentFragment} root
 * @param {import('./store.js').Store} store
 * @returns {function(): void} cleanup
 */
export function setupModelBindings(root, store) {
  const cleanups = [];

  // Elements inside <if data-live>/<for data-live> are bound separately by
  // renderFn; if we processed them here, the old subscription/listener could
  // not be cancelled when the branch/block changes → leak.
  // Elements inside an ignored block are also skipped — third-party widget markup.
  const elements = [
    ...(root.nodeType === Node.ELEMENT_NODE && root.hasAttribute?.(MODEL_ATTR) && !inLiveBlock(root) && !inIgnoredBlock(root)
      ? [root]
      : []),
    ...Array.from(root.querySelectorAll(`[${MODEL_ATTR}]`)).filter((el) => !inLiveBlock(el) && !inIgnoredBlock(el)),
  ];

  const radioGroups = new Map(); // path → Element[]
  const others = [];

  for (const el of elements) {
    const path = el.getAttribute(MODEL_ATTR);
    if (!path) {
      errors.modelMissingPath(el);
      continue;
    }
    if (classify(el) === 'radio') {
      if (!radioGroups.has(path)) radioGroups.set(path, []);
      radioGroups.get(path).push(el);
    } else {
      others.push(el);
    }
  }

  for (const el of others) {
    cleanups.push(bindElement(el, store));
  }

  for (const [path, radios] of radioGroups) {
    cleanups.push(bindRadioGroup(path, radios, store));
  }

  return function cleanup() {
    for (const unsub of cleanups) unsub();
    cleanups.length = 0; // guard against double cleanup calls
  };
}
