/**
 * @module template
 * @description <template> reading, fragment cache, and static ${path} interpolation.
 *
 * Core rules:
 *   - Source: a standard <template id="tpl-{name}"> element (DOM, not a string).
 *   - Output: DocumentFragment — not a string innerHTML.
 *   - ${path}: path resolution only. NO expression evaluation (new Function).
 *   - Resolved values are written RAW to node.nodeValue / attr.value.
 *     NOT escaped: neither of these two DOM properties parses HTML (no entity
 *     decoding), so escapeHtml/safeAttr is unnecessary here — and if used,
 *     characters like "&" would show up literally as "&amp;" on screen
 *     (double-encoding). Security already comes from the DOM APIs themselves;
 *     the same raw-value rule applies as in attribute mutations.
 *   - The cache holds the original; every render takes its own cloneNode(true).
 *   - <if>, <for>, <partial>, and reactive data-* are NOT processed in this module.
 *   - resolveStatic does not touch content inside a not-yet-expanded <if
 *     data-live>/<for data-live> OR an ordinary (non-data-live) <for> —
 *     preventing early/wrong-context resolution in nested loops (see
 *     inLiveBlock, inUnexpandedFor).
 *   - getTemplate detects (dev-mode, one-time) special tags that were written
 *     inside a <table> but got moved out by the HTML parser's foster-parenting
 *     when the template was first read, and warns about it — it does NOT fix
 *     the behavior, only warns actionably (see detectTableFosterParenting).
 */

import { getByPath } from "./store.js";
import { error, isDevMode } from "./errors.js";
import { inLiveBlock, inUnexpandedFor, inIgnoredBlock } from "./shared.js";
import { isSafeUrlProtocol } from "./utils.js";
import { getElementScope } from "./core/scope.js";

// URL attributes that require protocol safety validation
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'data', 'cite', 'poster', 'ping']);

/** @type {Map<string, DocumentFragment>} Holds original fragments; used before cloning. */
const templateCache = new Map();

// Special tags written inside a <table> but moved out by the HTML parser's
// "foster parenting" algorithm (see detectTableFosterParenting).
// NOTE: <partial> expansion runs during the Transform phase and replaces itself before this check.
const SPECIAL_TAGS = new Set(['IF', 'FOR', 'ELSE']);
const TABLE_CHILD_SELECTOR = 'tr, td, th, tbody, thead, tfoot, caption, col, colgroup';

// Regex that matches ${...} placeholders — must contain only a path, not an expression
const PLACEHOLDER = /\$\{([^}]+)\}/g;

/**
 * Resolves a dotted path from the context object, falling back to the store
 * if provided and the path is undefined in context. Returns an empty string if not found.
 *
 * Returns a raw string (NO escaping): the result is only ever written to
 * node.nodeValue / attr.value, neither of which parses HTML, so escaping
 * would be both unnecessary and wrong (double-encoding). Security comes from
 * the DOM APIs themselves.
 *
 * @param {string} path    - Dotted path, e.g. "user.name"
 * @param {Object} context - Plain object to read values from
 * @param {import('./store.js').Store|null} [store=null] - Optional store for fallback resolution
 * @returns {string}
 */
function resolvePath(path, context, store = null) {
  const cleanPath = path.trim();
  let value = getByPath(context, cleanPath);
  if (value === undefined && store && typeof store.get === 'function') {
    value = store.get(cleanPath);
  }
  if (value == null) return "";
  return String(value);
}

/**
 * Resolves every ${path} placeholder in a string from the context or store fallback.
 * new Function is NEVER used; only path resolution via getByPath or store.get.
 *
 * @param {string} str     - Raw string that may contain ${...}
 * @param {Object} context - Object to read values from
 * @param {import('./store.js').Store|null} [store=null] - Optional store fallback
 * @returns {string}
 */
function resolveString(str, context, store = null) {
  return str.replace(PLACEHOLDER, (_match, path) => resolvePath(path, context, store));
}

/**
 * Are the <table>s in the fragment victims of a special tag that got moved
 * out by the HTML parser's "foster parenting" algorithm?
 *
 * WHY THIS SIGNAL — REAL PARSER BEHAVIOR (verified in headless Chromium):
 *   When you write `<table><if is-truthy="x"><tr><td>${row}</td></tr></if></table>`,
 *   the WHATWG HTML "in table" insertion mode's "anything else" rule moves
 *   <if> to right BEFORE the table DURING PARSING (foster parenting; see
 *   https://html.spec.whatwg.org/#parsing-main-intable). BUT the <tr>/<td>
 *   that arrive while <if> is still on the open-elements stack are
 *   TABLE-VALID tags themselves, so they are NOT foster-parented — they go
 *   straight into <table><tbody>, not INSIDE <if>. Result: <if> is left as a
 *   COMPLETELY EMPTY shell before the table; <tr>/<td> end up inside <table>
 *   but rendered UNCONDITIONALLY (as if <if> never wrapped them at all). So
 *   LOOKING FOR a table-child INSIDE a fostered special tag is wrong (it will
 *   never be found) — the actual signature is the tag being left EMPTY.
 *
 * REDUCING FALSE-POSITIVE RISK: checking only "is there an empty <if>/<for>
 * right before a table" alone isn't strong enough either (rarely, a
 * deliberately empty block could happen to sit right next to an unrelated
 * table). So TWO signals are required together: (1) the special tag is
 * COMPLETELY empty (no element or text children) AND (2) the adjacent
 * <table> ACTUALLY contains row content (tr/td/tbody/...). A block that is
 * NOT empty — e.g. plain <if>...</if><table>...</table> unrelated to the
 * table (satisfies condition 2 but not condition 1) — never produces a false positive.
 *
 * OUT OF SCOPE (deliberate limits):
 *   - <partial>: replaced during Transform phase prior to static interpolation.
 *   - Not detected if the special tag is NOT the <table>'s immediate previous
 *     sibling (e.g. nested inside a <div>) — a false negative, acceptable per
 *     KISS (this is only a dev-mode warning anyway, it doesn't fix the behavior).
 *
 * @param {DocumentFragment|Element} fragment
 * @param {string} templateName
 * @returns {void}
 */
function detectTableFosterParenting(fragment, templateName) {
  for (const table of fragment.querySelectorAll('table')) {
    const prev = table.previousElementSibling;
    if (!prev || !SPECIAL_TAGS.has(prev.tagName)) continue;
    const isEmptyShell = prev.childElementCount === 0 && prev.textContent.trim() === '';
    if (isEmptyShell && table.querySelector(TABLE_CHILD_SELECTOR)) {
      error('TABLE_FOSTER_PARENTING', { templateName });
      return; // one warning per template is enough
    }
  }
}

/**
 * Finds the <template id="tpl-{name}"> element and caches the original fragment.
 * Every call returns an independent copy via cloneNode(true) from the cache.
 *
 * The foster-parenting check (detectTableFosterParenting) runs only ONCE,
 * when the template is FIRST read (entering the cache) — NOT on every
 * render, for performance. Doesn't run at all if dev_mode is off.
 *
 * @param {string} name - Template name; looked up in the DOM as `id="tpl-{name}"`.
 * @returns {DocumentFragment|null} Cloned fragment; null if the template isn't found.
 */
export function getTemplate(name) {
  if (!templateCache.has(name)) {
    const el = document.getElementById(`tpl-${name}`);
    if (!el || el.tagName !== "TEMPLATE") {
      error('TEMPLATE_NOT_FOUND', { name });
      return null;
    }
    if (isDevMode()) detectTableFosterParenting(el.content, name);
    // Store the original content; cloning happens on every render
    templateCache.set(name, el.content);
  }
  return templateCache.get(name).cloneNode(true);
}

/**
 * Updates every text node and element attribute inside a DocumentFragment via
 * ${path} resolution. Static (one-time) interpolation only — reactive
 * updates are managed by reactive modules (text, model, show) in the Link phase.
 *
 * Does NOT touch nodes inside a not-yet-expanded <if data-live>/<for data-live> —
 * that content is resolved during dynamic item rendering with the correct item scope
 * (see inLiveBlock). For the same reason, also does NOT touch nodes INSIDE a not-yet-expanded
 * ordinary (non-data-live) <for> — in nested static <for>s, the inner loop's
 * own variable isn't bound yet, so early resolution would be wrong/empty
 * (see inUnexpandedFor). That content is resolved with the correct itemScope by
 * modules/loops.js's own resolveStatic call in the same pass.
 *
 * @param {DocumentFragment|Element} root - Root node to traverse
 * @param {Object} context                - Object used for path resolution
 * @param {import('./store.js').Store|null} [store=null] - Optional store fallback
 * @returns {void}
 */
function getNodeScope(node, fallbackContext) {
  let curr = node;
  while (curr) {
    const s = getElementScope(curr);
    if (s) return s;
    curr = curr.parentNode;
  }
  return fallbackContext;
}

export function resolveStatic(root, context, store = null) {
  if (!root) return;
  const doc = root.ownerDocument || globalThis.document;
  if (!doc || typeof doc.createTreeWalker !== 'function') return;
  const filter = doc.defaultView?.NodeFilter || globalThis.NodeFilter;
  const showFlags = (filter?.SHOW_TEXT ?? 4) | (filter?.SHOW_ELEMENT ?? 1);

  // TreeWalker: traverses both text nodes (SHOW_TEXT) and elements (SHOW_ELEMENT)
  const walker = doc.createTreeWalker(
    root,
    showFlags,
  );

  const resolveNode = (node) => {
    if (inLiveBlock(node) || inUnexpandedFor(node) || inIgnoredBlock(node)) {
      return;
    }
    const nodeScope = getNodeScope(node, context);
    if (node.nodeType === 3) {
      // ${} in the middle of a text node: "Hello ${user.name}, welcome" is a single node.
      // A one-time replacement is sufficient here; dynamic reactivity is handled during Link phase.
      if (PLACEHOLDER.test(node.nodeValue)) {
        PLACEHOLDER.lastIndex = 0; // reset the stateful regex
        node.nodeValue = resolveString(node.nodeValue, nodeScope, store);
      }
    } else if (node.nodeType === 1) {
      // ${} in element attributes
      for (const attr of Array.from(node.attributes)) {
        if (PLACEHOLDER.test(attr.value)) {
          PLACEHOLDER.lastIndex = 0;
          let resolved = resolveString(attr.value, nodeScope, store);
          if (URL_ATTRS.has(attr.name.toLowerCase())) {
            if (!isSafeUrlProtocol(resolved)) {
              if (isDevMode()) error('UNSAFE_URL_ATTR', { attrName: attr.name }, node);
              resolved = "";
            }
          }
          attr.value = resolved;
        }
      }
    }
  };

  // TreeWalker does not visit its root, but callers may render an Element
  // directly and expect placeholders in that element's attributes to resolve.
  if (root.nodeType === 1) {
    resolveNode(root);
  }

  let node = walker.nextNode();
  while (node) {
    resolveNode(node);
    node = walker.nextNode();
  }
}

/**
 * Reads the template, clones it, resolves ${path} placeholders with the
 * context (and optional store fallback), and returns a ready DocumentFragment.
 *
 * Why it returns a fragment (not a string): reactive handles
 * will later bind directly to DOM nodes during the Link phase; that binding
 * couldn't be established if a string were returned.
 *
 * @param {string} name    - Template name
 * @param {Object} [context={}] - Value object for ${path} resolution
 * @param {import('./store.js').Store|null} [store=null] - Optional store fallback
 * @returns {DocumentFragment|null} Ready fragment; null if the template isn't found.
 */
export function renderTemplate(name, context = {}, store = null) {
  const fragment = getTemplate(name);
  if (!fragment) return null;
  resolveStatic(fragment, context, store);
  return fragment;
}
