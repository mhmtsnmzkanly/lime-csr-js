/**
 * @module bindings
 * Reactive data-text (text) + {x}/data-x (attribute) bindings.
 *
 * SCOPE — THIS MODULE:
 *   - data-text="path"            → watch store, update el.textContent.
 *   - href="/u/{x}" data-x="p"   → template + watch store, update attribute.
 *
 * OUT OF SCOPE — next step (bindings-blocks.js / mount.js):
 *   Reactive block reactivity (<if data-live>, reactive <for>). These
 *   require tear-down/rebuild + inner binding cleanup, so handled separately.
 *
 * CORE RULE:
 *   - No data-*: static — template.js already resolved it, this module skips it.
 *   - Has data-*: reactive — updates when state changes.
 *   - Reactive data comes ONLY from the store; context is not carried here.
 *
 * SECURITY NOTE:
 *   - el.textContent: does not parse HTML → escapeHtml NOT needed (written as text).
 *   - el.setAttribute: DOM API HTML-encodes itself → safeAttr is WRONG
 *     (safeAttr() + setAttribute() = double-encoding: "&amp;" → "&amp;amp;").
 *     Therefore setAttribute receives the RAW value.
 *   - URL attributes: checked with utils.isSafeUrlProtocol() before setAttribute
 *     (shared whitelist with utils.js).
 *   - on* (onclick, onerror, ...) attributes never receive reactive data:
 *     browsers actually execute event-handler attributes set via setAttribute;
 *     this would violate the "no JS execution from templates" principle.
 *
 * RESERVED PLACEHOLDER NAMES (2b):
 *   The following names CANNOT be used as {x} placeholders in attribute templates
 *   because lime-csr uses data-{name} for its own engine attributes:
 *   text, model, show, live, ref, diff — and any name starting with "on-".
 *   Detected in setupAttrBindings; errors.reservedAttrName is issued.
 */


import { errors } from './errors.js';
import { isSafeUrlProtocol } from './utils.js';
import { inLiveBlock } from './shared.js';

// URL attributes: protocol check required before assignment.
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'data', 'cite', 'poster', 'ping']);

// Event-handler attributes: reactive binding completely refused.
const EVENT_ATTR_PATTERN = /^on/i;

// Reactive attribute placeholder: {key}  (different syntax from template.js's ${path})
const ATTR_PLACEHOLDER = /\{([^}]+)\}/g;

// Reserved placeholder names: engine uses data-{name} for its own attributes.
// Also blocks any name starting with "on-" (would conflict with data-on-{event}).
const RESERVED_NAMES = new Set(['text', 'model', 'show', 'live', 'ref', 'diff']);
function isReservedName(name) {
  return RESERVED_NAMES.has(name) || name.startsWith('on-');
}

let refCounter = 0;
function nextRef() { return `lcsr-${++refCounter}`; }

/**
 * Binds every [data-text] element under root to the store.
 * textContent tracks state, not a static value.
 *
 * @param {Element|DocumentFragment} root
 * @param {import('./store.js').Store} store
 * @returns {Array<function(): void>} list of unsubscribe functions
 */
function setupTextBindings(root, store) {
  const cleanups = [];

  for (const el of root.querySelectorAll('[data-text]')) {
    // data-text inside <if data-live> and <for data-live> is bound by renderFn.
    // If we bound it here, the old subscription couldn't be cancelled when the
    // branch/block changes → leak.
    if (inLiveBlock(el)) continue;

    const path = el.getAttribute('data-text');

    if (!path) {
      errors.bindingMissingPath(el);
      continue;
    }

    // Write the initial value immediately.
    // textContent does not parse HTML → escapeHtml is not needed.
    el.textContent = store.get(path) ?? '';

    cleanups.push(
      store.subscribe(path, (val) => {
        el.textContent = val ?? '';
      }),
    );
  }

  return cleanups;
}

/**
 * Finds attributes under root that contain an {x} placeholder; reads the
 * store path from the matching data-x attribute and binds it reactively.
 *
 * Template storage: the original attribute value ("/u/{handle}") is kept in
 * JS. On every store change, the template is re-filled from scratch — not
 * find-and-replace.
 *
 * The consumed data-x attributes are removed from the DOM once binding is set
 * up (clean output). The data-ref handle stays in the DOM for debugging + cleanup.
 *
 * @param {Element|DocumentFragment} root
 * @param {import('./store.js').Store} store
 * @returns {Array<function(): void>} list of unsubscribe functions
 */
function setupAttrBindings(root, store) {
  const cleanups = [];

  // Include root itself in the scan if it's an Element; a DocumentFragment has no attributes.
  // Elements inside <if data-live> and <for data-live> are bound separately by
  // renderFn; if we processed them here, the old subscriptions couldn't be
  // cancelled when the branch/block changes → leak.

  const elements = [
    ...(root.nodeType === Node.ELEMENT_NODE && !inLiveBlock(root) ? [root] : []),
    ...Array.from(root.querySelectorAll('*')).filter((el) => !inLiveBlock(el)),
  ];

  for (const el of elements) {
    const attrs = Array.from(el.attributes);

    // Collect the reactive attribute bindings for this element
    const boundAttrs = []; // { attrName, template, bindings: {key → storePath} }

    for (const attr of attrs) {
      // data-* attributes are a source, not a target; skip
      if (attr.name.startsWith('data-')) continue;

      ATTR_PLACEHOLDER.lastIndex = 0;
      if (!ATTR_PLACEHOLDER.test(attr.value)) continue;

      // onclick/onerror/... : reactive data is never bound to an event handler.
      if (EVENT_ATTR_PATTERN.test(attr.name)) {
        errors.unsafeEventAttr(attr.name, el);
        continue;
      }

      const template = attr.value;
      const bindings = {}; // {key} → store path
      let allResolved = true;

      for (const [, key] of template.matchAll(/\{([^}]+)\}/g)) {
        if (key in bindings) continue; // same key may appear more than once

        // 2b: reserved name check
        if (isReservedName(key)) {
          errors.reservedAttrName(key, el);
          allResolved = false;
          break;
        }

        const storePath = el.getAttribute(`data-${key}`);
        if (!storePath) {
          errors.bindingMissingDataAttr(attr.name, key, el);
          allResolved = false;
          break;
        }
        bindings[key] = storePath;
      }

      if (allResolved && Object.keys(bindings).length > 0) {
        boundAttrs.push({ attrName: attr.name, template, bindings });
      }
    }

    if (boundAttrs.length === 0) continue;

    // Identification / debug handle — stays in the DOM so updates from the
    // store can find the correct element.
    if (!el.dataset.ref) el.dataset.ref = nextRef();

    // Remove the consumed data-x attributes from the DOM (data-ref stays).
    const usedKeys = new Set(
      boundAttrs.flatMap(({ bindings: b }) => Object.keys(b)),
    );
    for (const key of usedKeys) el.removeAttribute(`data-${key}`);

    // Update function + subscription for each attribute
    for (const { attrName, template, bindings } of boundAttrs) {
      // Re-fills the template from scratch with current store values — not find-and-replace.
      const resolve = () => {
        let resolved = template.replace(/\{([^}]+)\}/g, (_, key) =>
          String(store.get(bindings[key]) ?? ''),
        );

        // URL attribute: block dangerous protocols like javascript:, data:.
        // NOTE: setAttribute does its own HTML-encoding → the RAW value is given.
        if (URL_ATTRS.has(attrName)) {
          resolved = isSafeUrlProtocol(resolved) ? resolved : '';
        }

        el.setAttribute(attrName, resolved);
      };

      resolve(); // initial value

      // Subscribe to every unique store path in the template.
      // The template is re-resolved FROM SCRATCH when any of them changes.
      const uniquePaths = [...new Set(Object.values(bindings))];
      for (const path of uniquePaths) {
        cleanups.push(store.subscribe(path, resolve));
      }
    }
  }

  return cleanups;
}

/**
 * Sets up every reactive binding (data-text + {x}/data-x) under root.
 * Subscriptions are opened; calling the returned cleanup() cancels all of them.
 *
 * Usage:
 *   const cleanup = setupBindings(document.body, store);
 *   // ... when the component unmounts:
 *   cleanup(); // prevents a memory leak
 *
 * @param {Element|DocumentFragment} root
 * @param {import('./store.js').Store} store
 * @returns {function(): void} cleanup — cancels all subscriptions
 */
export function setupBindings(root, store) {
  const cleanups = [
    ...setupTextBindings(root, store),
    ...setupAttrBindings(root, store),
  ];

  return function cleanup() {
    for (const unsub of cleanups) unsub();
    // Empty the list: guard against double cleanup calls
    cleanups.length = 0;
  };
}
