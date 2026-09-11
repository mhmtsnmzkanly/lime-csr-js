/**
 * @module core/triggers
 * Trigger definitions and matching engine for the Module Kernel.
 *
 * Supported trigger primitives:
 *   - attr(name, defOrSetup): exact attribute trigger (e.g. "data-show", "x-tooltip")
 *   - attrs(options, defOrSetup): multi-attribute trigger group (e.g. required & optional)
 *   - tag(name, defOrSetup): exact tag trigger (e.g. "CUSTOM-CARD")
 *   - pattern(prefixOrRegex, defOrSetup): attribute prefix or RegExp trigger
 *
 * Invariant: The Kernel contains zero feature-specific attribute or tag names.
 */

export const TRIGGER_TYPES = Object.freeze({
  ATTR: 'attr',
  ATTRS: 'attrs',
  TAG: 'tag',
  PATTERN: 'pattern',
});

/**
 * @typedef {'transform'|'link'} TriggerPhase
 */

/**
 * @typedef {Object} TriggerHooks
 * @property {TriggerPhase} [phase='link'] - Execution phase: 'transform' (structural compilation) or 'link' (behavioral attachment)
 * @property {function(Element): boolean} [match] - Optional custom predicate returning whether the trigger matches the element
 * @property {function(Element, import('./context.js').ModuleContext): *} [read] - Pure input extractor, executed once during initial setup
 * @property {function(Element, *, import('./context.js').ModuleContext): (Function|void)} [setup] - Setup callback; may return a cleanup function
 * @property {function(Element, *, import('./context.js').ModuleContext): void} [update] - Explicit update callback for reactive changes
 * @property {function(Element, import('./context.js').ModuleContext): void} [cleanup] - Teardown callback called when element or engine unmounts
 */

/**
 * @typedef {Readonly<Object>} TriggerDefinition
 */

/**
 * Normalizes a trigger definition parameter.
 *
 * @param {Function|TriggerHooks} definitionOrSetup
 * @returns {Object}
 */
function normalizeDefinition(definitionOrSetup) {
  if (typeof definitionOrSetup === 'function') {
    return { setup: definitionOrSetup };
  }
  return definitionOrSetup || {};
}

/**
 * Creates an exact attribute trigger (e.g. `data-show`, `x-tooltip`).
 *
 * @param {string} name - Exact attribute name to match
 * @param {Function|TriggerHooks} definitionOrSetup - Setup function or full trigger hooks
 * @returns {TriggerDefinition} Immutable trigger definition
 * @throws {TypeError} If name is not a non-empty string
 */
export function attr(name, definitionOrSetup) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new TypeError('attr(name, def) requires a non-empty string attribute name.');
  }

  const def = normalizeDefinition(definitionOrSetup);
  const setupFn = typeof def.setup === 'function'
    ? def.setup
    : (typeof def.transform === 'function' ? def.transform : null);

  return Object.freeze({
    type: TRIGGER_TYPES.ATTR,
    name: name.trim(),
    phase: def.phase || 'link',
    match: typeof def.match === 'function' ? def.match : null,
    read: typeof def.read === 'function' ? def.read : null,
    setup: setupFn,
    update: typeof def.update === 'function' ? def.update : null,
    cleanup: typeof def.cleanup === 'function' ? def.cleanup : null,
  });
}

/**
 * Creates a multi-attribute group trigger requiring specific attributes to exist.
 *
 * @param {Object} options
 * @param {string[]} options.required - List of required attribute names (existence check)
 * @param {string[]} [options.optional] - Optional attribute names to inspect
 * @param {TriggerPhase} [options.phase='link'] - Execution phase
 * @param {Function|TriggerHooks} [definitionOrSetup] - Setup function or trigger hooks
 * @returns {TriggerDefinition} Immutable multi-attribute trigger definition
 * @throws {TypeError} If options.required is missing or invalid
 */
export function attrs(options, definitionOrSetup) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('attrs(options) requires an options object.');
  }

  const { required, optional = [] } = options;
  if (!Array.isArray(required) || required.length === 0 || !required.every((s) => typeof s === 'string' && s.trim())) {
    throw new TypeError('attrs(options): "required" must be a non-empty array of attribute name strings.');
  }
  if (!Array.isArray(optional) || !optional.every((s) => typeof s === 'string' && s.trim())) {
    throw new TypeError('attrs(options): "optional" must be an array of attribute name strings.');
  }

  const def = normalizeDefinition(definitionOrSetup || options);
  const setupFn = typeof def.setup === 'function'
    ? def.setup
    : (typeof def.transform === 'function' ? def.transform : null);

  return Object.freeze({
    type: TRIGGER_TYPES.ATTRS,
    required: Object.freeze(required.map((s) => s.trim())),
    optional: Object.freeze(optional.map((s) => s.trim())),
    phase: def.phase || options.phase || 'link',
    match: typeof def.match === 'function' ? def.match : (typeof options.match === 'function' ? options.match : null),
    read: typeof def.read === 'function' ? def.read : (typeof options.read === 'function' ? options.read : null),
    setup: setupFn,
    update: typeof def.update === 'function' ? def.update : (typeof options.update === 'function' ? options.update : null),
    cleanup: typeof def.cleanup === 'function' ? def.cleanup : (typeof options.cleanup === 'function' ? options.cleanup : null),
  });
}

/**
 * Creates an exact tag trigger. Tag names are normalized to uppercase.
 *
 * @param {string} tagName - Tag name (e.g. "IF", "FOR", "PARTIAL")
 * @param {Function|TriggerHooks} definitionOrSetup - Setup function or trigger hooks (defaults to phase: 'transform')
 * @returns {TriggerDefinition} Immutable tag trigger definition
 * @throws {TypeError} If tagName is not a non-empty string
 */
export function tag(tagName, definitionOrSetup) {
  if (typeof tagName !== 'string' || !tagName.trim()) {
    throw new TypeError('tag(name, def) requires a non-empty string tag name.');
  }

  const def = normalizeDefinition(definitionOrSetup);
  const setupFn = typeof def.setup === 'function'
    ? def.setup
    : (typeof def.transform === 'function' ? def.transform : null);

  return Object.freeze({
    type: TRIGGER_TYPES.TAG,
    name: tagName.trim().toUpperCase(),
    phase: def.phase || 'transform',
    match: typeof def.match === 'function' ? def.match : null,
    read: typeof def.read === 'function' ? def.read : null,
    setup: setupFn,
    update: typeof def.update === 'function' ? def.update : null,
    cleanup: typeof def.cleanup === 'function' ? def.cleanup : null,
  });
}

/**
 * Creates an attribute pattern trigger (prefix string or RegExp).
 *
 * @param {string|RegExp} patternOrPrefix - String prefix (e.g. "data-on-") or RegExp
 * @param {Function|TriggerHooks} definitionOrSetup - Setup function or trigger hooks
 * @returns {TriggerDefinition} Immutable pattern trigger definition
 * @throws {TypeError} If patternOrPrefix is not a non-empty string or RegExp
 */
export function pattern(patternOrPrefix, definitionOrSetup) {
  const isPrefix = typeof patternOrPrefix === 'string' && patternOrPrefix.trim().length > 0;
  const isRegex = patternOrPrefix instanceof RegExp;

  if (!isPrefix && !isRegex) {
    throw new TypeError('pattern(prefixOrRegex, def) requires a non-empty string prefix or RegExp.');
  }

  const def = normalizeDefinition(definitionOrSetup);
  const setupFn = typeof def.setup === 'function'
    ? def.setup
    : (typeof def.transform === 'function' ? def.transform : null);

  return Object.freeze({
    type: TRIGGER_TYPES.PATTERN,
    pattern: isPrefix ? patternOrPrefix.trim() : patternOrPrefix,
    phase: def.phase || 'link',
    match: typeof def.match === 'function' ? def.match : null,
    read: typeof def.read === 'function' ? def.read : null,
    setup: setupFn,
    update: typeof def.update === 'function' ? def.update : null,
    cleanup: typeof def.cleanup === 'function' ? def.cleanup : null,
  });
}
