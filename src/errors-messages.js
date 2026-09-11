/**
 * @module errors-messages
 * Detailed actionable error message catalog for Lime-CSR development mode.
 * Extracted into a standalone module to keep the runtime core bundle lightweight.
 */

export default {
  UNKNOWN_OPERATOR: ({ op, validOps }) =>
    `Unknown condition operator: "${op}". Valid operators: ${validOps?.join(', ')}. Use is-truthy, is-eq, is-gt, etc.`,
  MISSING_OPERATOR: () =>
    `No condition operator found on <if>. Add at least one operator attribute: is-gt, is-lt, is-eq, is-truthy...`,
  ELSE_AFTER_CONTENT: () =>
    `<else> must be the last direct child of <if>; nodes after it were counted as then. Move the <else>...</else> block to the end.`,
  PARTIAL_NOT_FOUND: ({ name, available }) => {
    const list = available && available.length ? available.join(', ') : '(no registered partials)';
    return `Partial not found: "${name}". Registered partials: ${list}. Is <template id="tpl-${name}"> defined?`;
  },
  SLOT_NOT_FOUND: ({ slot, partial, available }) => {
    const list = available && available.length ? available.join(', ') : '(no named slots defined)';
    return `Slot "${slot}" not found in partial "${partial}". Available slots: ${list}. Content for this slot was ignored.`;
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
  MOUNT_INVALID_TARGET: ({ target }) =>
    `mount(): invalid target "${String(target)}". Target must be a valid DOM Element or CSS selector string.`,
  MOUNT_TARGET_NOT_FOUND: ({ selector }) =>
    `mount(): target element matching selector "${selector}" was not found.`,
  MOUNT_HOOK_FAILED: ({ hook, error }) =>
    `mount(): "${hook}" lifecycle hook failed: ${error?.message || error || 'unknown error'}.`,
  MOUNT_ALREADY_MOUNTED: () =>
    `mount(): target element is already mounted. Duplicate mounts on the same target are rejected. Unmount first.`,
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
    `Unsupported event type: "data-on-${eventName}". Valid types: ${validEvents?.map((e) => `data-on-${e}`).join(', ')}.`,
  UNKNOWN_KEY_MODIFIER: ({ eventName, validKeys }) =>
    `Unknown key modifier: "data-on-${eventName}". Supported keys: ${validKeys?.join(', ')}. E.g. data-on-keydown-enter, data-on-keyup-escape.`,
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
  COMPUTED_WITHOUT_STORE: ({ paths }) =>
    `mount(): the "computed" option (${paths?.join(', ')}) requires a store; registration skipped. Pass a store in the same mount() options object.`,
  BATCH_FLUSH_LIMIT: ({ maxWaves }) =>
    `store.batch(): flush reached the ${maxWaves || 100} wave limit (possible infinite loop). Dropping remaining notifications. Break the cycle (e.g. use store.computed instead of mutual sets).`,
  PATH_CLOBBER: ({ key, path, type }) =>
    `store.set("${path}", ...): segment "${key}" was a ${type}, not an object. Replacing with {}.`,
  MODULE_READ_FAILED: ({ module, error }) =>
    `Module "${module ?? 'unknown'}" read failed: ${error?.message || error || 'unknown error'}.`,
  MODULE_SETUP_FAILED: ({ module, error }) =>
    `Module "${module ?? 'unknown'}" setup failed: ${error?.message || error || 'unknown error'}.`,
  MODULE_UPDATE_FAILED: ({ module, error }) =>
    `Module "${module ?? 'unknown'}" update failed: ${error?.message || error || 'unknown error'}.`,
  MODULE_CLEANUP_FAILED: ({ module, error }) =>
    `Module "${module ?? 'unknown'}" cleanup failed: ${error?.message || error || 'unknown error'}.`,
  MODULE_TRIGGER_OVERRIDDEN: ({ module, overriddenBy, trigger }) =>
    `Module "${module}" trigger "${trigger}" was overridden by higher-priority module "${overriddenBy}".`,
  MODULE_WATCH_FAILED: ({ module, path, error }) =>
    `Module "${module ?? 'unknown'}" watch callback for "${path}" failed: ${error?.message || error || 'unknown error'}.`,
  MODULE_STORE_REQUIRED: ({ module, path }) =>
    `Module "${module ?? 'unknown'}" watch("${path}") called without a store.`,
  MODULE_AFTER_CONNECT_FAILED: ({ module, error }) =>
    `Module "${module ?? 'unknown'}" afterConnect callback failed: ${error?.message || error || 'unknown error'}.`,
  MODULE_HANDLER_FAILED: ({ handler, error }) =>
    `Handler "${handler ?? 'unknown'}" execution failed: ${error?.message || error || 'unknown error'}.`,
};
