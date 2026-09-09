/**
 * @module errors
 * Structured diagnostic dispatch and dev/prod presentation layer.
 *
 * Rules:
 *   - Subscribers receive every diagnostic in both production and development.
 *   - Never throw — page must keep running.
 *   - Zero circular dependencies: imports NO other module.
 *   - Works 100% out of the box in unbuilt/raw ESM (defaults to dev mode).
 *   - In production builds (__DEV__=false): all detailed error strings and overlay DOM code
 *     are completely stripped by dead-code elimination, logging only "[lime-error] CODE".
 *
 * Default: ON. Disable Lime console/overlay in development with setDevMode(false).
 */

/**
 * Compile-time flag with safe runtime fallback for unbundled/raw ESM.
 * In raw browser ESM (no-build), typeof __DEV__ is "undefined" -> defaults safely to true.
 * In esbuild prod build (--define:__DEV__=false), dead-code elimination removes dev strings.
 * @type {boolean}
 */
const IS_DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

/** @type {boolean} */
let devMode = true;

/** @type {Set<(diagnostic: {code: string, message: string, context: *}) => void>} */
const diagnosticListeners = new Set();

/**
 * Enables or disables Lime's console and visual overlay presentation.
 * @param {boolean} enabled
 */
export function setDevMode(enabled) {
  devMode = Boolean(enabled);
}

/** @returns {boolean} */
export function isDevMode() {
  return devMode;
}

/**
 * Subscribes to structured Lime diagnostics. Subscription is independent of
 * dev mode; consumers decide how (or whether) to present each code.
 *
 * @param {(diagnostic: {code: string, message: string, context: *}) => void} listener
 * @returns {() => void} idempotent unsubscribe function
 */
export function subscribeDiagnostics(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('subscribeDiagnostics(listener) requires a function listener.');
  }

  diagnosticListeners.add(listener);
  let subscribed = true;
  return function unsubscribe() {
    if (!subscribed) return;
    subscribed = false;
    diagnosticListeners.delete(listener);
  };
}

/**
 * Detailed error message generators for development mode.
 * Completely stripped from production bundles by dead-code elimination when __DEV__ is false.
 */
const DEV_MESSAGES = IS_DEV ? {
  UNKNOWN_OPERATOR: ({ op, validOps }) =>
    `Unknown condition operator: "${op}". Valid operators: ${validOps.join(', ')}. Use is-truthy, is-eq, is-gt, etc.`,
  MISSING_OPERATOR: () =>
    `No condition operator found on <if>. Add at least one operator attribute: is-gt, is-lt, is-eq, is-truthy...`,
  ELSE_AFTER_CONTENT: () =>
    `<else> must be the last direct child of <if>; nodes after it were counted as then. Move the <else>...</else> block to the end.`,
  PARTIAL_NOT_FOUND: ({ name, available }) => {
    const list = available && available.length ? available.join(', ') : '(no registered partials)';
    return `Partial not found: "${name}". Registered partials: ${list}. Is <template id="tpl-${name}"> defined?`;
  },
  PARTIAL_MISSING_NAME: () =>
    `<partial> element is missing the "name" attribute. Use <partial name="..."></partial>.`,
  PARTIAL_DEPTH_LIMIT: ({ depth }) =>
    `Partial depth limit (${depth}) reached (possible infinite loop). A partial may be calling itself directly or indirectly.`,
  TEMPLATE_NOT_FOUND: ({ name }) =>
    `Template not found: "tpl-${name}". Is <template id="tpl-${name}"> present on the page?`,
  FOR_MISSING_ATTR: () =>
    `<for> element is missing the "each" and/or "as" attribute. Use <for each="array.path" as="item"></for>.`,
  FOR_NOT_ARRAY: ({ path, type }) =>
    `<for each="${path}"> value must be an array; got: ${type}. Is "${path}" an array in context or store?`,
  BINDING_MISSING_PATH: () =>
    `data-text attribute is empty; a store path is required. Use data-text="path.to.value".`,
  BINDING_MISSING_DATA_ATTR: ({ attrName, key }) =>
    `No data-${key} attribute found for {${key}} in "${attrName}"; binding skipped. Add data-${key}="store.path" or remove the {${key}} placeholder.`,
  UNSAFE_EVENT_ATTR: ({ attrName }) =>
    `"${attrName}" is an event-handler attribute; reactive data cannot bind to it. Use data-on-{event} for events instead (see README).`,
  UNSAFE_URL_ATTR: ({ attrName }) =>
    `"${attrName}" contained an unsafe URL protocol and was sanitized to an empty string. Allowed protocols: http, https, root-relative (/), or #anchor.`,
  LIVE_IF_MISSING_OP: () =>
    `<if data-live>: no valid condition operator found. Add one: is-gt, is-lt, is-eq, is-truthy, etc.`,
  PIPELINE_DEPTH_LIMIT: ({ maxIter }) =>
    `Render pipeline reached the ${maxIter} iteration limit (possible infinite loop). Stopping. Is a partial calling itself?`,
  MOUNT_TEMPLATE_NOT_FOUND: ({ name, available }) => {
    const list = available && available.length ? available.join(', ') : '(no registered templates)';
    return `mount(): template "${name}" not found. Registered templates: ${list}. Is <template id="tpl-${name}"> defined?`;
  },
  FOR_MISSING_KEY: ({ templateName }) =>
    `Reactive <for data-live>: missing "key" attribute. Add a key for efficient DOM updates. (template: ${templateName ?? '?'})`,
  FOR_DUPLICATE_KEY: ({ keyVal, templateName }) =>
    `Reactive <for data-live>: key "${keyVal}" appears on more than one element; keys must be unique. (template: ${templateName ?? '?'})`,
  MODEL_MISSING_PATH: () =>
    `data-model attribute is empty; a store path is required. Use data-model="path.to.value".`,
  TABLE_FOSTER_PARENTING: ({ templateName }) =>
    `<if>/<for>/<partial> cannot be used inside <table> — the HTML parser moves them outside. Solution: move the condition/loop outside the <table>, or treat the tbody as a partial. (template: ${templateName ?? '?'})`,
  SHOW_MISSING_PATH: () =>
    `data-show attribute is empty; a store path is required. Use data-show="path.to.value".`,
  UNKNOWN_EVENT: ({ eventName, validEvents }) =>
    `Unsupported event type: "data-on-${eventName}". Valid types: ${validEvents.map((e) => `data-on-${e}`).join(', ')}.`,
  UNKNOWN_KEY_MODIFIER: ({ eventName, validKeys }) =>
    `Unknown key modifier: "data-on-${eventName}". Supported keys: ${validKeys.join(', ')}. E.g. data-on-keydown-enter, data-on-keyup-escape.`,
  HANDLER_NOT_FOUND: ({ name, available }) => {
    const list = available && available.length ? available.join(', ') : '(no registered handlers)';
    return `Handler not found: "${name}". Registered handlers: ${list}. Is "${name}" defined in the handlers object passed to mount()?`;
  },
  RESERVED_ATTR_NAME: ({ name }) =>
    `"${name}" is reserved by lime-csr and cannot be used as a {x}/data-x placeholder. Reserved names: text, model, show, live, ref, diff, and any name starting with "on-". Rename the placeholder.`,
  INDEXED_MODEL_PATH: ({ path }) =>
    `data-model="${path}" contains a numeric index (e.g. items.0.name). This is unsafe: if the array is mutated, the path drifts to the wrong item. Use a reactive <for data-live key=...> loop and bind to the loop variable instead.`,
  COMPUTED_MANUAL_SET: ({ path }) =>
    `Path "${path}" is managed by store.computed(). Manual store.set() will be overwritten on the next dep change. Use store.computed() or choose a different path.`,
  IN_PLACE_MUTATION: ({ path }) =>
    `store.set("${path}", value): value is the SAME reference as the stored object/array. In-place mutation detected — subscribers will NOT fire. Pass a new reference, e.g. store.set("${path}", [...arr]) or {...obj}.`,
  UNKNOWN_DIFF_STRATEGY: ({ value, templateName }) =>
    `<for data-live>: unknown data-diff value "${value}". Valid values: simple, lcs, replace (or omit the attribute). Falling back to "simple". (template: ${templateName ?? '?'})`,
  MOUNT_LEGACY_SIGNATURE: () =>
    `mount(templateName, context, target, store, options) positional signature is deprecated. Prefer mount(templateName, { context, target, store, handlers, computed, ... }). The legacy form keeps working; this notice is shown once.`,
  COMPUTED_WITHOUT_STORE: ({ paths }) =>
    `mount(): the "computed" option (${paths.join(', ')}) requires a store; registration skipped. Pass a store in the same mount() options object.`,
  BLOCK_AFTER_NOT_FOUND: ({ name, available }) => {
    const list = available && available.length ? available.join(', ') : '(no registered handlers)';
    return `data-after handler not found: "${name}". Registered handlers: ${list}. Is "${name}" defined in the handlers object passed to mount()?`;
  },
  BLOCK_BEFORE_NOT_FOUND: ({ name, available }) => {
    const list = available && available.length ? available.join(', ') : '(no registered handlers)';
    return `data-before handler not found: "${name}". Registered handlers: ${list}. Is "${name}" defined in the handlers object passed to mount()?`;
  },
} : null;

/**
 * Shows a red error overlay in the bottom right corner of the page (dev mode only).
 * Includes deduplication badge and scroll protection.
 *
 * @param {string} code
 * @param {string} message
 */
function showOverlay(code, message) {
  if (!IS_DEV || typeof document === 'undefined') return;

  let container = document.getElementById('lime-csr-error-overlay-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'lime-csr-error-overlay-container';
    container.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:999999;max-width:380px;max-height:85vh;overflow-y:auto;' +
      'display:flex;flex-direction:column;gap:8px;font-family:sans-serif;font-size:13px;pointer-events:none;';
    document.body.appendChild(container);
  }

  // Deduplication: if card with identical code and message exists, increment badge count
  const existing = container.querySelector(`[data-lime-error-code="${code}"]`);
  if (existing && existing.dataset.limeErrorMessage === message) {
    let countEl = existing.querySelector('.lime-error-count');
    if (!countEl) {
      countEl = document.createElement('span');
      countEl.className = 'lime-error-count';
      countEl.style.cssText =
        'background:#b91c1c;color:#fff;border-radius:10px;padding:2px 7px;font-size:11px;font-weight:bold;margin-left:8px;';
      existing.querySelector('strong')?.appendChild(countEl);
      existing.dataset.count = '1';
    }
    const newCount = Number(existing.dataset.count || '1') + 1;
    existing.dataset.count = String(newCount);
    countEl.textContent = `x${newCount}`;
    return;
  }

  const el = document.createElement('div');
  el.dataset.limeErrorCode = code;
  el.dataset.limeErrorMessage = message;
  el.style.cssText =
    'background:#f87171;color:#fff;padding:12px 16px;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);' +
    'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;animation:lime-fade-in 0.2s ease;' +
    'border-left:4px solid #b91c1c;pointer-events:auto;';

  const content = document.createElement('div');
  const title = document.createElement('strong');
  title.style.cssText = 'display:block;margin-bottom:4px;font-weight:bold;';
  title.textContent = `[lime-csr] ${code}`;
  const detail = document.createElement('span');
  detail.style.cssText = 'opacity:0.95;line-height:1.4;word-break:break-word;';
  detail.textContent = message;
  content.append(title, detail);
  el.appendChild(content);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u00d7';
  closeBtn.style.cssText =
    'background:none;border:none;color:#fff;font-size:18px;cursor:pointer;opacity:0.7;padding:0;line-height:1;font-weight:bold;';
  closeBtn.onmouseover = () => { closeBtn.style.opacity = '1'; };
  closeBtn.onmouseout = () => { closeBtn.style.opacity = '0.7'; };
  closeBtn.onclick = () => {
    el.remove();
    if (container.childNodes.length === 0) {
      container.remove();
    }
  };
  el.appendChild(closeBtn);
  container.appendChild(el);

  if (!document.getElementById('lime-csr-overlay-style')) {
    const style = document.createElement('style');
    style.id = 'lime-csr-overlay-style';
    style.textContent =
      '@keyframes lime-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }' +
      ' #lime-csr-error-overlay-container::-webkit-scrollbar { width: 6px; }' +
      ' #lime-csr-error-overlay-container::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2); border-radius: 3px; }';
    document.head.appendChild(style);
  }
}

/**
 * Primary warning function. Always dispatches a structured diagnostic, then
 * presents it through Lime's console/overlay according to dev mode and compile target.
 *
 * @param {string} code     - Error code (e.g. "PARTIAL_NOT_FOUND")
 * @param {string} [message] - Actionable description in dev; defaults to code in prod
 * @param {*}     [context] - Additional context (element, path, name, etc.)
 */
export function warn(code, message, context) {
  const resolvedMessage = message !== undefined ? message : code;
  const diagnostic = Object.freeze({ code, message: resolvedMessage, context });

  for (const listener of [...diagnosticListeners]) {
    try {
      listener(diagnostic);
    } catch (error) {
      if (devMode && IS_DEV) {
        try {
          console.error('[lime-csr] Diagnostic listener failed:', error);
        } catch {
          // Diagnostics remain non-throwing even if console.error is replaced.
        }
      }
    }
  }

  if (!devMode) return;

  if (IS_DEV) {
    if (context !== undefined) {
      console.warn(`[lime-csr] ${code}: ${resolvedMessage}`, context);
    } else {
      console.warn(`[lime-csr] ${code}: ${resolvedMessage}`);
    }
    showOverlay(code, resolvedMessage);
  } else {
    if (context !== undefined) {
      console.warn(`[lime-error] ${code}`, context);
    } else {
      console.warn(`[lime-error] ${code}`);
    }
  }
}

/**
 * Unified diagnostic reporter.
 * In dev: looks up detailed actionable description and presents overlay.
 * In prod: dispatches lightweight code-only diagnostic with zero string overhead.
 *
 * @param {string} code - Diagnostic error code (e.g. "BINDING_MISSING_PATH")
 * @param {Object|*} [detailsOrContext={}] - Structured details for dev message, or direct context
 * @param {*} [context] - Optional DOM element or context
 */
export function reportError(code, detailsOrContext = {}, context = undefined) {
  let details = detailsOrContext;
  let ctx = context;

  if (
    ctx === undefined &&
    detailsOrContext != null &&
    (detailsOrContext.nodeType != null ||
      typeof detailsOrContext !== 'object' ||
      Array.isArray(detailsOrContext))
  ) {
    ctx = detailsOrContext;
    details = {};
  }

  let message = code;
  if (IS_DEV && DEV_MESSAGES && Object.hasOwn(DEV_MESSAGES, code)) {
    try {
      message = DEV_MESSAGES[code](details || {});
    } catch {
      message = code;
    }
  }

  warn(code, message, ctx);
}

/** Alias for reportError */
export const error = reportError;

/**
 * Known error scenario wrappers for backwards compatibility.
 * Each wrapper formats details and calls reportError.
 *
 * @namespace
 */
export const errors = {
  /** Unknown is-* operator on an <if>. */
  unknownOperator(op, validOps, context) {
    reportError('UNKNOWN_OPERATOR', { op, validOps }, context);
  },

  /** No is-* operator found on an <if>. */
  missingOperator(context) {
    reportError('MISSING_OPERATOR', {}, context);
  },

  /** <else> must be the last direct child of <if>. */
  elseAfterContent(context) {
    reportError('ELSE_AFTER_CONTENT', {}, context);
  },

  /** Partial requested via <partial name="..."> was not found. */
  partialNotFound(name, available, context) {
    reportError('PARTIAL_NOT_FOUND', { name, available }, context);
  },

  /** <partial> element is missing the "name" attribute. */
  partialMissingName(context) {
    reportError('PARTIAL_MISSING_NAME', {}, context);
  },

  /** Recursive partial expansion reached maximum depth. */
  partialDepthLimit(depth, context) {
    reportError('PARTIAL_DEPTH_LIMIT', { depth }, context);
  },

  /** Template requested via getTemplate / mount was not found in DOM. */
  templateNotFound(name) {
    reportError('TEMPLATE_NOT_FOUND', { name });
  },

  /** <for> element is missing the "each" or "as" attribute. */
  forMissingAttr(context) {
    reportError('FOR_MISSING_ATTR', {}, context);
  },

  /** <for each="..."> value is not an array. */
  forNotArray(path, type, context) {
    reportError('FOR_NOT_ARRAY', { path, type }, context);
  },

  /** data-text attribute is present but its value is empty. */
  bindingMissingPath(context) {
    reportError('BINDING_MISSING_PATH', {}, context);
  },

  /** No matching data-x attribute found for the {x} placeholder. */
  bindingMissingDataAttr(attrName, key, context) {
    reportError('BINDING_MISSING_DATA_ATTR', { attrName, key }, context);
  },

  /** A reactive {x}/data-x binding targets an event-handler attribute like onclick/onerror. */
  unsafeEventAttr(attrName, context) {
    reportError('UNSAFE_EVENT_ATTR', { attrName }, context);
  },

  /** A URL attribute was resolved with an unsafe protocol (e.g. javascript:). */
  unsafeUrlAttr(attrName, context) {
    reportError('UNSAFE_URL_ATTR', { attrName }, context);
  },

  /** No valid condition operator found on <if data-live>. */
  liveIfMissingOperator(context) {
    reportError('LIVE_IF_MISSING_OP', {}, context);
  },

  /** Render pipeline reached its maximum iteration limit. */
  pipelineDepthLimit(maxIter, context) {
    reportError('PIPELINE_DEPTH_LIMIT', { maxIter }, context);
  },

  /** Template requested via mount() was not found. */
  mountTemplateNotFound(name, available, context) {
    reportError('MOUNT_TEMPLATE_NOT_FOUND', { name, available }, context);
  },

  /** Reactive <for data-live> is missing the "key" attribute. */
  missingKey(templateName) {
    reportError('FOR_MISSING_KEY', { templateName });
  },

  /** Same key used on more than one element in a reactive <for data-live>. */
  duplicateKey(keyVal, templateName) {
    reportError('FOR_DUPLICATE_KEY', { keyVal, templateName });
  },

  /** data-model attribute present but empty. */
  modelMissingPath(context) {
    reportError('MODEL_MISSING_PATH', {}, context);
  },

  /** Custom element written inside <table> — HTML parser will foster-parent it outside. */
  tableFosterParenting(templateName) {
    reportError('TABLE_FOSTER_PARENTING', { templateName });
  },

  /** data-show attribute present but empty. */
  showMissingPath(context) {
    reportError('SHOW_MISSING_PATH', {}, context);
  },

  /** An unsupported event type was used with data-on-{event}. */
  unknownEvent(eventName, validEvents, context) {
    reportError('UNKNOWN_EVENT', { eventName, validEvents }, context);
  },

  /** data-on-keydown-{key}/data-on-keyup-{key} used an unsupported key modifier. */
  unknownKeyModifier(eventName, validKeys, context) {
    reportError('UNKNOWN_KEY_MODIFIER', { eventName, validKeys }, context);
  },

  /** data-on-{event} points to a handler name not in the handlers dictionary. */
  handlerNotFound(name, available, context) {
    reportError('HANDLER_NOT_FOUND', { name, available }, context);
  },

  /** A reserved name was used as a placeholder name in {x}/data-x bindings. */
  reservedAttrName(name, context) {
    reportError('RESERVED_ATTR_NAME', { name }, context);
  },

  /** data-model path contains a numeric index segment (e.g. "items.0.name"). */
  indexedModelPath(path, context) {
    reportError('INDEXED_MODEL_PATH', { path }, context);
  },

  /** store.set() was called on a path managed by store.computed(). */
  computedManualSet(path) {
    reportError('COMPUTED_MANUAL_SET', { path });
  },

  /** store.set() received the same object/array reference already stored. */
  inPlaceMutation(path) {
    reportError('IN_PLACE_MUTATION', { path });
  },

  /** <for data-live data-diff="..."> used a value outside simple/lcs/replace. */
  unknownDiffStrategy(value, templateName) {
    reportError('UNKNOWN_DIFF_STRATEGY', { value, templateName });
  },

  /** mount() was called with the legacy positional signature. */
  mountLegacySignature() {
    reportError('MOUNT_LEGACY_SIGNATURE', {});
  },

  /** mount()'s "computed" option was given without a store. */
  computedWithoutStore(paths) {
    reportError('COMPUTED_WITHOUT_STORE', { paths });
  },

  /** data-after on <if>/<for> points to a handler name not in the handlers dictionary. */
  blockAfterNotFound(name, available, context) {
    reportError('BLOCK_AFTER_NOT_FOUND', { name, available }, context);
  },

  /** data-before on <if>/<for> points to a handler name not in the handlers dictionary. */
  blockBeforeNotFound(name, available, context) {
    reportError('BLOCK_BEFORE_NOT_FOUND', { name, available }, context);
  },
};
