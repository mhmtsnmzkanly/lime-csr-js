/**
 * @module errors
 * Dev-mode warning layer.
 *
 * Rules:
 *   - When enabled: console.warn('[lime-csr] CODE: message', context?). Never throw — page must keep running.
 *   - When disabled: complete silence. End users must not see console noise.
 *   - This module imports NO other module — no circular dependency risk.
 *
 * Default: ON. Enabled by default for developer convenience; disable in production with setDevMode(false).
 */

/** @type {boolean} */
let devMode = true;

/**
 * Enables or disables dev mode.
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
 * Primary warning function. Does nothing if dev mode is off.
 *
 * @param {string} code     - Error code (e.g. "PARTIAL_NOT_FOUND")
 * @param {string} message  - Actionable description — "what's wrong, how to fix it"
 * @param {*}     [context] - Additional context (element, path, name, etc.) — appended to console output
 */
export function warn(code, message, context) {
  if (!devMode) return;
  if (context !== undefined) {
    console.warn(`[lime-csr] ${code}: ${message}`, context);
  } else {
    console.warn(`[lime-csr] ${code}: ${message}`);
  }
}

/**
 * Known error scenario wrappers.
 * Each one only calls warn() — no logic here, logic is in warn.
 *
 * @namespace
 */
export const errors = {
  /** Unknown is-* operator on an <if>. */
  unknownOperator(op, validOps, context) {
    warn(
      'UNKNOWN_OPERATOR',
      `Unknown condition operator: "${op}". Valid operators: ${validOps.join(', ')}. ` +
        `Use is-truthy, is-eq, is-gt, etc.`,
      context,
    );
  },

  /** No is-* operator found on an <if>. */
  missingOperator(context) {
    warn(
      'MISSING_OPERATOR',
      `No condition operator found on <if>. ` +
        `Add at least one operator attribute: is-gt, is-lt, is-eq, is-truthy...`,
      context,
    );
  },

  /** <else> must be the last direct child of <if>. */
  elseAfterContent(context) {
    warn(
      'ELSE_AFTER_CONTENT',
      `<else> must be the last direct child of <if>; nodes after it were counted as then. ` +
        `Move the <else>...</else> block to the end.`,
      context,
    );
  },

  /** Partial requested via <partial name="..."> was not found. */
  partialNotFound(name, available, context) {
    const list = available.length ? available.join(', ') : '(no registered partials)';
    warn(
      'PARTIAL_NOT_FOUND',
      `Partial not found: "${name}". Registered partials: ${list}. ` +
        `Is <template id="tpl-${name}"> defined?`,
      context,
    );
  },

  /** <partial> element is missing the "name" attribute. */
  partialMissingName(context) {
    warn(
      'PARTIAL_MISSING_NAME',
      `<partial> element is missing the "name" attribute. Use <partial name="..."></partial>.`,
      context,
    );
  },

  /** Recursive partial expansion reached maximum depth. */
  partialDepthLimit(depth, context) {
    warn(
      'PARTIAL_DEPTH_LIMIT',
      `Partial depth limit (${depth}) reached (possible infinite loop). ` +
        `A partial may be calling itself directly or indirectly.`,
      context,
    );
  },

  /** Template requested via getTemplate / mount was not found in DOM. */
  templateNotFound(name) {
    warn(
      'TEMPLATE_NOT_FOUND',
      `Template not found: "tpl-${name}". ` +
        `Is <template id="tpl-${name}"> present on the page?`,
    );
  },

  /** <for> element is missing the "each" or "as" attribute. */
  forMissingAttr(context) {
    warn(
      'FOR_MISSING_ATTR',
      `<for> element is missing the "each" and/or "as" attribute. ` +
        `Use <for each="array.path" as="item"></for>.`,
      context,
    );
  },

  /** <for each="..."> value is not an array. */
  forNotArray(path, type, context) {
    warn(
      'FOR_NOT_ARRAY',
      `<for each="${path}"> value must be an array; got: ${type}. ` +
        `Is "${path}" an array in context or store?`,
      context,
    );
  },

  /** data-text attribute is present but its value is empty. */
  bindingMissingPath(context) {
    warn(
      'BINDING_MISSING_PATH',
      `data-text attribute is empty; a store path is required. ` +
        `Use data-text="path.to.value".`,
      context,
    );
  },

  /** No matching data-x attribute found for the {x} placeholder. */
  bindingMissingDataAttr(attrName, key, context) {
    warn(
      'BINDING_MISSING_DATA_ATTR',
      `No data-${key} attribute found for {${key}} in "${attrName}"; binding skipped. ` +
        `Add data-${key}="store.path" or remove the {${key}} placeholder.`,
      context,
    );
  },

  /** A reactive {x}/data-x binding targets an event-handler attribute like onclick/onerror. */
  unsafeEventAttr(attrName, context) {
    warn(
      'UNSAFE_EVENT_ATTR',
      `"${attrName}" is an event-handler attribute; reactive data cannot bind to it. ` +
        `Use data-on-{event} for events instead (see README).`,
      context,
    );
  },

  /** No valid condition operator found on <if data-live>. */
  liveIfMissingOperator(context) {
    warn(
      'LIVE_IF_MISSING_OP',
      `<if data-live>: no valid condition operator found. ` +
        `Add one: is-gt, is-lt, is-eq, is-truthy, etc.`,
      context,
    );
  },

  /** Render pipeline reached its maximum iteration limit. */
  pipelineDepthLimit(maxIter, context) {
    warn(
      'PIPELINE_DEPTH_LIMIT',
      `Render pipeline reached the ${maxIter} iteration limit (possible infinite loop). Stopping. ` +
        `Is a partial calling itself?`,
      context,
    );
  },

  /** Template requested via mount() was not found. */
  mountTemplateNotFound(name, available, context) {
    const list = available.length ? available.join(', ') : '(no registered templates)';
    warn(
      'MOUNT_TEMPLATE_NOT_FOUND',
      `mount(): template "${name}" not found. Registered templates: ${list}. ` +
        `Is <template id="tpl-${name}"> defined?`,
      context,
    );
  },

  // ── Reactive <for data-live> ────────────────────────────────────────────────

  /** Reactive <for data-live> is missing the "key" attribute. */
  missingKey(templateName) {
    warn(
      'FOR_MISSING_KEY',
      `Reactive <for data-live>: missing "key" attribute. ` +
        `Add a key for efficient DOM updates. (template: ${templateName ?? '?'})`,
    );
  },

  /** Same key used on more than one element in a reactive <for data-live>. */
  duplicateKey(keyVal, templateName) {
    warn(
      'FOR_DUPLICATE_KEY',
      `Reactive <for data-live>: key "${keyVal}" appears on more than one element; ` +
        `keys must be unique. (template: ${templateName ?? '?'})`,
    );
  },

  /** data-model attribute present but empty. */
  modelMissingPath(context) {
    warn(
      'MODEL_MISSING_PATH',
      `data-model attribute is empty; a store path is required. ` +
        `Use data-model="path.to.value".`,
      context,
    );
  },

  /** Custom element written inside <table> — HTML parser will foster-parent it outside. */
  tableFosterParenting(templateName) {
    warn(
      'TABLE_FOSTER_PARENTING',
      `<if>/<for>/<partial> cannot be used inside <table> — the HTML parser moves them outside. ` +
        `Solution: move the condition/loop outside the <table>, or treat the tbody as a partial. ` +
        `(template: ${templateName ?? '?'})`,
    );
  },

  /** data-show attribute present but empty. */
  showMissingPath(context) {
    warn(
      'SHOW_MISSING_PATH',
      `data-show attribute is empty; a store path is required. ` +
        `Use data-show="path.to.value".`,
      context,
    );
  },

  /** An unsupported event type was used with data-on-{event}. */
  unknownEvent(eventName, validEvents, context) {
    warn(
      'UNKNOWN_EVENT',
      `Unsupported event type: "data-on-${eventName}". Valid types: ` +
        `${validEvents.map((e) => `data-on-${e}`).join(', ')}.`,
      context,
    );
  },

  /** data-on-{event} points to a handler name not in the handlers dictionary. */
  handlerNotFound(name, available, context) {
    const list = available.length ? available.join(', ') : '(no registered handlers)';
    warn(
      'HANDLER_NOT_FOUND',
      `Handler not found: "${name}". Registered handlers: ${list}. ` +
        `Is "${name}" defined in the handlers object passed to mount()?`,
      context,
    );
  },

  // ── Phase 2 additions ───────────────────────────────────────────────────────

  /**
   * A reserved name (text, model, show, live, ref, diff, or on-* prefix) was used
   * as a placeholder name in {x}/data-x bindings.
   */
  reservedAttrName(name, context) {
    warn(
      'RESERVED_ATTR_NAME',
      `"${name}" is reserved by lime-csr and cannot be used as a {x}/data-x placeholder. ` +
        `Reserved names: text, model, show, live, ref, diff, and any name starting with "on-". ` +
        `Rename the placeholder.`,
      context,
    );
  },

  /**
   * data-model path contains a numeric index segment (e.g. "items.0.name").
   * Path drift: after array mutation the index points to the wrong item.
   */
  indexedModelPath(path, context) {
    warn(
      'INDEXED_MODEL_PATH',
      `data-model="${path}" contains a numeric index (e.g. items.0.name). ` +
        `This is unsafe: if the array is mutated, the path drifts to the wrong item. ` +
        `Use a reactive <for data-live key=...> loop and bind to the loop variable instead.`,
      context,
    );
  },

  /**
   * store.set() was called on a path managed by store.computed().
   * The manual value will be overwritten on the next dep change.
   */
  computedManualSet(path) {
    warn(
      'COMPUTED_MANUAL_SET',
      `Path "${path}" is managed by store.computed(). ` +
        `Manual store.set() will be overwritten on the next dep change. ` +
        `Use store.computed() or choose a different path.`,
    );
  },

  /**
   * store.set() received the same object/array reference already stored.
   * In-place mutation: Object.is() returns true, so no subscriber fires.
   */
  inPlaceMutation(path) {
    warn(
      'IN_PLACE_MUTATION',
      `store.set("${path}", value): value is the SAME reference as the stored object/array. ` +
        `In-place mutation detected — subscribers will NOT fire. ` +
        `Pass a new reference, e.g. store.set("${path}", [...arr]) or {...obj}.`,
    );
  },

  // ── Phase 3 additions ───────────────────────────────────────────────────────

  /** <for data-live data-diff="..."> used a value outside simple/lcs/replace. */
  unknownDiffStrategy(value, templateName) {
    warn(
      'UNKNOWN_DIFF_STRATEGY',
      `<for data-live>: unknown data-diff value "${value}". Valid values: ` +
        `simple, lcs, replace (or omit the attribute). Falling back to "simple". ` +
        `(template: ${templateName ?? '?'})`,
    );
  },

  /** data-after on <if>/<for> points to a handler name not in the handlers dictionary. */
  blockAfterNotFound(name, available, context) {
    const list = available.length ? available.join(', ') : '(no registered handlers)';
    warn(
      'BLOCK_AFTER_NOT_FOUND',
      `data-after handler not found: "${name}". Registered handlers: ${list}. ` +
        `Is "${name}" defined in the handlers object passed to mount()?`,
      context,
    );
  },

  /** data-before on <if>/<for> points to a handler name not in the handlers dictionary. */
  blockBeforeNotFound(name, available, context) {
    const list = available.length ? available.join(', ') : '(no registered handlers)';
    warn(
      'BLOCK_BEFORE_NOT_FOUND',
      `data-before handler not found: "${name}". Registered handlers: ${list}. ` +
        `Is "${name}" defined in the handlers object passed to mount()?`,
      context,
    );
  },
};
