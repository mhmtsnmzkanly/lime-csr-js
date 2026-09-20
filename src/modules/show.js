/**
 * @module modules/show
 * Standard behavioral module for reactive visibility toggle — `data-show="path"`.
 *
 * Contract & Invariants:
 *   - Phase: Link (strictly non-structural, zero DOM tree mutations).
 *   - Element visibility is controlled via native `hidden` property/attribute.
 *   - Does not modify inline `style.display`.
 *   - Scoped compatibility style rule `[data-show][hidden] { display: none !important; }`
 *     is injected into the owning document once.
 *   - Subscriptions and cleanups are managed via ModuleContext (`ctx.watch`).
 *   - Pure `read()` runs once during initial Link setup.
 */

import { attr } from '../core/triggers.js';
import { resolveCanonicalPath } from '../core/scope.js';
import { getByPath } from '../store.js';

const SHOW_ATTR = 'data-show';
const SHOW_STYLE_ID = 'lime-csr-data-show-style';
const SHOW_STYLE_RULE = '[data-show][hidden] { display: none !important; }';
const installedDocuments = new WeakSet();

/**
 * Installs the scoped data-show compatibility style rule in the owning document.
 *
 * @param {Document} doc
 */
function ensureShowStyle(doc) {
  if (!doc || installedDocuments.has(doc)) return;
  const win = doc.defaultView || globalThis;
  if (typeof win.CSSStyleSheet === 'function' && Array.isArray(doc.adoptedStyleSheets)) {
    try {
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(SHOW_STYLE_RULE);
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
      installedDocuments.add(doc);
      return;
    } catch {
      // Fallback
    }
  }
  if (doc.getElementById(SHOW_STYLE_ID)) {
    installedDocuments.add(doc);
    return;
  }
  const style = doc.createElement('style');
  style.id = SHOW_STYLE_ID;
  const nonce = doc.querySelector?.('script[nonce], style[nonce]')?.getAttribute('nonce');
  if (nonce) {
    style.setAttribute('nonce', nonce);
  }
  style.textContent = SHOW_STYLE_RULE;
  const parent = doc.head || doc.documentElement;
  if (parent && typeof parent.appendChild === 'function') {
    parent.appendChild(style);
  }
  installedDocuments.add(doc);
}

/**
 * Creates the standard `show` module definition.
 *
 * @returns {Object} ModuleDefinition
 */
export function show() {
  return Object.freeze({
    name: 'show',
    triggers: [
      attr(SHOW_ATTR, {
        phase: 'link',

        read(el, ctx) {
          const path = el.getAttribute(SHOW_ATTR);
          if (!path || !path.trim()) {
            ctx.error('SHOW_MISSING_PATH', el);
            return null;
          }
          return { path: path.trim() };
        },

        setup(el, data, ctx) {
          if (!data || !data.path) return;

          // Multi-document style isolation: inject style rule into owning document
          ensureShowStyle(ctx.document);

          const canonicalPath = resolveCanonicalPath(ctx.scope, data.path);
          const isAliased = canonicalPath !== data.path;
          const hasLocalScope = !isAliased && ctx.scope != null && (
            data.path.split('.')[0] in ctx.scope || getByPath(ctx.scope, data.path) !== undefined
          );

          // Initial value from scope or store
          let val = ctx.scope ? getByPath(ctx.scope, data.path) : undefined;
          if (val === undefined && !hasLocalScope && ctx.store && typeof ctx.store.get === 'function') {
            val = ctx.store.get(canonicalPath);
          }

          el.hidden = !val;

          // Reactive subscription via ModuleContext
          if (ctx.store && !hasLocalScope) {
            ctx.watch(canonicalPath, (nextVal) => {
              el.hidden = !nextVal;
            });
          }
        },
      }),
    ],
  });
}

export default show;
