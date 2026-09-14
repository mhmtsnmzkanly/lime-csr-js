/**
 * @module errors
 * Structured diagnostic dispatch and presentation layer.
 *
 * Rules:
 *   - Subscribers receive every diagnostic in both production and development.
 *   - Never throw — page must keep running.
 *   - Zero circular dependencies: imports NO other module.
 *   - Works 100% out of the box in unbuilt/raw ESM (defaults to dev mode).
 *   - Error message explanations live in external `errors-messages.js` and are
 *     loaded on-demand in development mode, keeping the production bundle minimal.
 *
 * Default: ON.
 *   - setDevMode(true | 'dev'): detailed console warnings + overlay (loads messages on-demand).
 *   - setDevMode('prod'): concise [lime-error] CODE console warnings without overlay.
 *   - setDevMode(false): completely silences console output and overlay (diagnostics still dispatch).
 */

/** @type {boolean|'prod'|'dev'} */
let devMode = true;

/** @type {Set<(diagnostic: {code: string, message: string, context: *}) => void>} */
const diagnosticListeners = new Set();
const DIAGNOSTIC_DEDUP_WINDOW_MS = 1000;
const diagnosticStates = new Map();
const contextIds = new WeakMap();
let nextContextId = 0;

const DIAGNOSTIC_CATEGORIES = Object.freeze({
  MOUNT: 'mount',
  MODULE: 'module',
  FOR: 'template',
  PARTIAL: 'template',
  SLOT: 'template',
  TEMPLATE: 'template',
  UNKNOWN_OPERATOR: 'template',
  MISSING_OPERATOR: 'template',
  ELSE_AFTER_CONTENT: 'template',
  BINDING: 'binding',
  SHOW: 'binding',
  MODEL: 'binding',
  HANDLER: 'event',
  UNKNOWN_EVENT: 'event',
  UNKNOWN_KEY_MODIFIER: 'event',
  UNSAFE: 'security',
  PATH: 'store',
  COMPUTED: 'store',
  IN_PLACE_MUTATION: 'store',
  BATCH: 'store',
});

/** @type {Object<string, function(Object): string>|null} */
let devMessages = null;
let devMessagesPromise = null;

/**
 * Loads detailed dev-mode error descriptions on-demand.
 * Runs once and caches the result.
 *
 * @returns {Promise<Object<string, function(Object): string>|null>}
 */
export function loadDevMessages() {
  if (devMessages) return Promise.resolve(devMessages);
  if (!devMessagesPromise) {
    devMessagesPromise = import('./errors-messages.js')
      .then((mod) => {
        devMessages = mod.default || mod;
        return devMessages;
      })
      .catch(() => {
        devMessages = null;
        return null;
      });
  }
  return devMessagesPromise;
}

// Automatically initiate loading in dev mode
if (devMode === true || devMode === 'dev') {
  loadDevMessages();
}

/**
 * Enables or disables Lime's console and visual overlay presentation.
 * In dev mode, ensures detailed error messages are loaded.
 *
 * @param {boolean|'prod'|'dev'} mode
 * @returns {Promise<Object<string, function(Object): string>|null>}
 */
export function setDevMode(mode) {
  if (mode === 'prod' || mode === 'production') {
    devMode = 'prod';
    return Promise.resolve(null);
  }
  if (mode === false) {
    devMode = false;
    return Promise.resolve(null);
  }
  devMode = true;
  return loadDevMessages();
}

/** @returns {boolean} */
export function isDevMode() {
  return devMode === true || devMode === 'dev';
}

/**
 * Subscribes to structured Lime diagnostics. Subscription is independent of
 * dev mode; consumers decide how (or whether) to present each code.
 *
 * @param {(diagnostic: {code: string, message: string, context: *}) => void} listener
 * @returns {() => void} idempotent unsubscribe function
 */
function getCategory(code) {
  const prefix = Object.keys(DIAGNOSTIC_CATEGORIES).find((key) => code.startsWith(key));
  return prefix ? DIAGNOSTIC_CATEGORIES[prefix] : 'runtime';
}

function getContextKey(context) {
  if (context && (typeof context === 'object' || typeof context === 'function')) {
    if (!contextIds.has(context)) contextIds.set(context, ++nextContextId);
    return `object:${contextIds.get(context)}`;
  }
  return `${typeof context}:${String(context)}`;
}

function getDetailsKey(details) {
  if (!details || typeof details !== 'object') return '';
  return Object.entries(details)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value instanceof Error ? value.message : String(value)}`)
    .join('|');
}

function createDiagnostic(code, message, context, severity, details) {
  const now = Date.now();
  const key = `${severity}:${code}:${message}:${getContextKey(context)}:${getDetailsKey(details)}`;
  const previous = diagnosticStates.get(key);
  if (previous && now - previous.lastTimestamp <= DIAGNOSTIC_DEDUP_WINDOW_MS) {
    previous.count++;
    previous.lastTimestamp = now;
    return { diagnostic: previous.diagnostic, isDuplicate: true };
  }

  if (diagnosticStates.size >= 500) {
    for (const [stateKey, state] of diagnosticStates) {
      if (now - state.lastTimestamp > DIAGNOSTIC_DEDUP_WINDOW_MS) diagnosticStates.delete(stateKey);
      if (diagnosticStates.size < 500) break;
    }
  }

  const state = { count: 1, lastTimestamp: now, diagnostic: null };
  const diagnostic = {
    code,
    severity,
    category: getCategory(code),
    message,
    context,
    details: Object.freeze({ ...(details || {}) }),
    timestamp: now,
    get count() {
      return state.count;
    },
  };
  state.diagnostic = Object.freeze(diagnostic);
  diagnosticStates.set(key, state);
  return { diagnostic: state.diagnostic, isDuplicate: false };
}

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
 * Shows a red error overlay in the bottom right corner of the page (dev mode only).
 * Includes deduplication badge and scroll protection.
 *
 * @param {string} code
 * @param {string} message
 */
function showOverlay(code, message) {
  if (!isDevMode() || typeof document === 'undefined') return;

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
  detail.className = 'lime-error-detail';
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
 * Updates an existing overlay card with newly resolved detailed message.
 *
 * @param {string} code
 * @param {string} message
 */
function updateOverlay(code, message) {
  if (!isDevMode() || typeof document === 'undefined') return;
  const container = document.getElementById('lime-csr-error-overlay-container');
  if (!container) return;
  const existing = container.querySelector(`[data-lime-error-code="${code}"]`);
  if (existing) {
    existing.dataset.limeErrorMessage = message;
    const detail = existing.querySelector('.lime-error-detail');
    if (detail) {
      detail.textContent = message;
    }
  }
}

/**
 * Primary warning function. Always dispatches a structured diagnostic, then
 * presents it through Lime's console/overlay according to dev mode.
 *
 * @param {string} code      - Error code (e.g. "PARTIAL_NOT_FOUND")
 * @param {string} [message] - Actionable description in dev; defaults to code in prod
 * @param {*}     [context]  - Additional context (element, path, name, etc.)
 */
export function warn(code, message, context, options = {}) {
  const resolvedMessage = message !== undefined ? message : code;
  const severity = options.severity || 'warning';
  const { diagnostic, isDuplicate } = createDiagnostic(
    code,
    resolvedMessage,
    context,
    severity,
    options.details,
  );

  if (!isDuplicate) {
    for (const listener of [...diagnosticListeners]) {
      try {
        listener(diagnostic);
      } catch (err) {
        if (isDevMode()) {
          try {
            console.error('[lime-csr] Diagnostic listener failed:', err);
          } catch {
            // Diagnostics remain non-throwing even if console.error is replaced.
          }
        }
      }
    }
  }

  if (!devMode) return;

  if (devMode === 'prod') {
    if (context !== undefined) {
      console.warn(`[lime-error] ${code}`, context);
    } else {
      console.warn(`[lime-error] ${code}`);
    }
    return;
  }

  if (context !== undefined) {
    console.warn(`[lime-csr] ${code}: ${resolvedMessage}`, context);
  } else {
    console.warn(`[lime-csr] ${code}: ${resolvedMessage}`);
  }
  showOverlay(code, resolvedMessage);
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

  const format = (msgs) => {
    if (msgs && Object.hasOwn(msgs, code)) {
      try {
        return msgs[code](details || {});
      } catch {
        return code;
      }
    }
    return code;
  };

  let message = isDevMode() && devMessages ? format(devMessages) : code;

  warn(code, message, ctx, { severity: 'error', details });

  if (isDevMode() && !devMessages && devMessagesPromise) {
    devMessagesPromise.then((msgs) => {
      if (msgs && Object.hasOwn(msgs, code)) {
        try {
          const resolved = format(msgs);
          if (resolved !== code) {
            updateOverlay(code, resolved);
          }
        } catch {
          // ignore
        }
      }
    });
  }
}

/** Alias for reportError */
export const error = reportError;
