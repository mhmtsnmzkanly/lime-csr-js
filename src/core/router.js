/**
 * @module core/router
 * Partitioned Route Tables and Compiled Trigger Router for the Module Kernel.
 *
 * Architectural Invariants:
 *   1. Feature-Agnostic: The router contains zero hardcoded feature names.
 *   2. Phase-Partitioned: Routes are segregated by phase (transform vs. link).
 *   3. Complexity:
 *      - Exact Attribute: Map lookup -> expected O(1)
 *      - Exact Tag: Map lookup -> expected O(1)
 *      - Pattern: Candidate scan -> O(P) (P = registered pattern count)
 *      - Multi-Attribute: Anchor-indexed lookup -> O(C * R) (C = candidates, R = required count)
 *   4. Precedence vs. Execution Order:
 *      - Precedence (which module claims a route) is resolved at compile time (modules[0] > modules[1]).
 *      - Execution Order (which matched trigger runs first) is determined by DOM attribute order.
 *   5. Deduplication: A multi-attribute trigger produces exactly one match per element.
 *   6. Non-Mutating: The router inspects elements and attributes; it never mutates the DOM.
 */

import { warn, isDevMode } from '../errors.js';
import { TRIGGER_TYPES } from './triggers.js';

const EMPTY_MATCHES = Object.freeze([]);

/**
 * Coerces an attribute string value using a given type or custom function.
 *
 * @param {string|null} val
 * @param {Function} typeFn
 * @returns {*}
 */
function coerceValue(val, typeFn) {
  if (typeof typeFn !== 'function') return val;
  if (typeFn === Boolean) {
    return val !== null && val !== 'false';
  }
  if (val == null) return null;
  if (typeFn === Number) {
    if (val === '') return null;
    const num = Number(val);
    return Number.isNaN(num) ? null : num;
  }
  if (typeFn === Array) {
    if (typeof val !== 'string') return [];
    return val.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (typeFn === Object) {
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
  }
  return typeFn(val);
}

/**
 * Checks whether an attribute name matches any item in the exclude list.
 *
 * @param {string} name
 * @param {ReadonlyArray<string|RegExp>} [excludeList]
 * @returns {boolean}
 */
function isExcluded(name, excludeList) {
  if (!excludeList || excludeList.length === 0) return false;
  for (let i = 0; i < excludeList.length; i++) {
    const item = excludeList[i];
    if (typeof item === 'string') {
      if (name === item) return true;
    } else if (item instanceof RegExp) {
      item.lastIndex = 0;
      const matched = item.test(name);
      item.lastIndex = 0;
      if (matched) return true;
    }
  }
  return false;
}

/**
 * Harvests all declared required and optional attributes from an element,
 * applying type coercion schemas if present.
 *
 * @param {Element} element
 * @param {Object} trigger
 * @param {string|null} [matchedAttr=null]
 * @returns {Readonly<Object>|null}
 */
function harvestAttributes(element, trigger, matchedAttr = null) {
  const { required = [], optional = [], types = {} } = trigger;
  const hasReq = required.length > 0;
  const hasOpt = optional.length > 0;
  const hasTypes = Object.keys(types).length > 0;

  if (!hasReq && !hasOpt && !hasTypes && !matchedAttr) {
    return null;
  }

  const attrs = {};

  if (matchedAttr) {
    const raw = element.getAttribute(matchedAttr);
    attrs[matchedAttr] = types[matchedAttr] ? coerceValue(raw, types[matchedAttr]) : raw;
  }

  for (let i = 0; i < required.length; i++) {
    const name = required[i];
    if (name === matchedAttr) continue;
    const raw = element.getAttribute(name);
    attrs[name] = types[name] ? coerceValue(raw, types[name]) : raw;
  }

  for (let i = 0; i < optional.length; i++) {
    const name = optional[i];
    if (name === matchedAttr) continue;
    if (element.hasAttribute(name)) {
      const raw = element.getAttribute(name);
      attrs[name] = types[name] ? coerceValue(raw, types[name]) : raw;
    } else if (types[name] === Boolean) {
      attrs[name] = false;
    }
  }

  return Object.freeze(attrs);
}

/**
 * @typedef {Object} RouteRecord
 * @property {string} moduleName - Name of the owning module
 * @property {Object} trigger - TriggerDefinition
 * @property {'transform'|'link'} phase - Execution phase
 * @property {number} priority - Module registration order index
 * @property {string} routeKey - Unique conflict-detection key
 */

/**
 * Creates empty partitioned route tables for one phase.
 *
 * @returns {Object}
 */
function createPhaseRouteTables() {
  return {
    exactTagRoutes: new Map(),     // tagName (uppercase) -> RouteRecord
    exactAttrRoutes: new Map(),    // attrName -> RouteRecord
    patternRoutes: [],             // RouteRecord[]
    multiAttrRoutes: new Map(),    // anchorAttrName (first required) -> RouteRecord[]
    triggerList: [],               // RouteRecord[] (all triggers in this phase)
    candidateSelectorParts: [],    // Safe exact-route selectors used for transform fast-paths
    hasUnselectableCandidates: false,
  };
}

/**
 * Computes a unique conflict key for a trigger within its phase.
 *
 * @param {Object} trigger
 * @param {string} phase
 * @returns {string}
 */
function getTriggerConflictKey(trigger, phase) {
  switch (trigger.type) {
    case TRIGGER_TYPES.TAG:
      return `${phase}:TAG:${trigger.name}`;
    case TRIGGER_TYPES.ATTR:
      return `${phase}:ATTR:${trigger.name}`;
    case TRIGGER_TYPES.ATTRS:
      return `${phase}:ATTRS:${[...trigger.required].sort().join(',')}`;
    case TRIGGER_TYPES.PATTERN:
      return `${phase}:PATTERN:${String(trigger.pattern)}`;
    default:
      return `${phase}:${trigger.type}:${trigger.name || 'unknown'}`;
  }
}

/**
 * Compiles module definitions into an isolated, partitioned Router.
 *
 * @param {Array<Object>} [modules=[]] - List of module definitions
 * @param {Object} [options={}] - Router configuration options
 * @param {boolean} [options.devMode] - Dev mode override for diagnostics
 * @param {Document} [options.document] - Document context
 * @returns {Object} Compiled Router instance
 */
export function createRouter(modules = [], options = {}) {
  const emitDiagnostics = options.devMode !== undefined ? options.devMode : isDevMode();
  const claimedRoutes = new Map(); // conflictKey -> owning moduleName

  const phaseTables = {
    transform: createPhaseRouteTables(),
    link: createPhaseRouteTables(),
  };

  const registeredModules = Array.isArray(modules) ? [...modules] : [];
  const customElementsRegistry = options.document?.defaultView?.customElements
    || globalThis.customElements
    || null;
  const customElementTriggers = [];

  // 1. Compile routes and resolve precedence
  for (let m = 0; m < registeredModules.length; m++) {
    const mod = registeredModules[m];
    if (!mod || !Array.isArray(mod.triggers)) continue;

    for (let t = 0; t < mod.triggers.length; t++) {
      const trigger = mod.triggers[t];
      const phase = trigger.phase || (trigger.type === TRIGGER_TYPES.TAG ? 'transform' : 'link');

      if (!phaseTables[phase]) {
        phaseTables[phase] = createPhaseRouteTables();
      }

      const conflictKey = getTriggerConflictKey(trigger, phase);

      if (claimedRoutes.has(conflictKey)) {
        const ownerName = claimedRoutes.get(conflictKey);
        if (emitDiagnostics) {
          warn(
            'MODULE_TRIGGER_OVERRIDDEN',
            `Module "${mod.name}" trigger "${conflictKey}" was overridden by higher-priority module "${ownerName}".`,
            { overriddenBy: ownerName, module: mod.name, trigger: conflictKey },
          );
        }
        continue;
      }

      claimedRoutes.set(conflictKey, mod.name);

      const record = Object.freeze({
        moduleName: mod.name,
        trigger,
        phase,
        priority: m,
        routeKey: conflictKey,
      });

      const tables = phaseTables[phase];
      tables.triggerList.push(record);

      switch (trigger.type) {
        case TRIGGER_TYPES.TAG: {
          tables.exactTagRoutes.set(trigger.name, record);
          if (/^[A-Z][A-Z0-9-]*$/.test(trigger.name)) {
            const part = trigger.name.toLowerCase();
            if (!tables.candidateSelectorParts.includes(part)) {
              tables.candidateSelectorParts.push(part);
            }
          } else {
            tables.hasUnselectableCandidates = true;
          }

          // Native Custom Element bridge: collect triggers for registration
          if (trigger.customElement) {
            customElementTriggers.push(trigger);
          }

          // Template directive alias: automatically route companion <template [directive]>
          if (trigger.templateDirective) {
            const tplAttr = trigger.templateDirective;
            const tplConflictKey = `${phase}:ATTR:${tplAttr}`;
            if (!claimedRoutes.has(tplConflictKey)) {
              claimedRoutes.set(tplConflictKey, mod.name);
              const tplRecord = Object.freeze({
                moduleName: mod.name,
                trigger: Object.freeze({
                  ...trigger,
                  type: TRIGGER_TYPES.ATTR,
                  name: tplAttr,
                  match: (el, attrName, attrNode) => {
                    if (el.tagName !== 'TEMPLATE') return false;
                    if (typeof trigger.match === 'function') {
                      return trigger.match(el, attrName, attrNode);
                    }
                    return true;
                  },
                }),
                phase,
                priority: m,
                routeKey: tplConflictKey,
              });
              tables.exactAttrRoutes.set(tplAttr, tplRecord);
              tables.triggerList.push(tplRecord);
              if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(tplAttr)) {
                const part = `template[${tplAttr}]`;
                if (!tables.candidateSelectorParts.includes(part)) {
                  tables.candidateSelectorParts.push(part);
                }
              }
            }
          }
          break;
        }

        case TRIGGER_TYPES.ATTR:
          tables.exactAttrRoutes.set(trigger.name, record);
          if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(trigger.name)) {
            const part = `[${trigger.name}]`;
            if (!tables.candidateSelectorParts.includes(part)) {
              tables.candidateSelectorParts.push(part);
            }
          } else {
            tables.hasUnselectableCandidates = true;
          }
          break;

        case TRIGGER_TYPES.PATTERN:
          tables.patternRoutes.push(record);
          tables.hasUnselectableCandidates = true;
          break;

        case TRIGGER_TYPES.ATTRS: {
          const anchorAttr = trigger.required[0];
          let bucket = tables.multiAttrRoutes.get(anchorAttr);
          if (!bucket) {
            bucket = [];
            tables.multiAttrRoutes.set(anchorAttr, bucket);
          }
          bucket.push(record);
          if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(anchorAttr)) {
            const part = `[${anchorAttr}]`;
            if (!tables.candidateSelectorParts.includes(part)) {
              tables.candidateSelectorParts.push(part);
            }
          } else {
            tables.hasUnselectableCandidates = true;
          }
          break;
        }

        default:
          break;
      }
    }
  }

  const transformTables = phaseTables.transform;
  const transformCandidateSelector = transformTables.hasUnselectableCandidates
    ? null
    : transformTables.candidateSelectorParts.join(',');

  /**
   * Registers custom element triggers on a given CustomElementRegistry.
   *
   * @param {CustomElementRegistry|null} [registry=null]
   * @param {Document|null} [doc=null]
   */
  function registerCustomElements(registry = null, doc = null) {
    const reg = registry
      || doc?.defaultView?.customElements
      || options.document?.defaultView?.customElements
      || globalThis.customElements
      || null;

    if (!reg || typeof reg.define !== 'function') return;

    const BaseHTMLElement = doc?.defaultView?.HTMLElement
      || options.document?.defaultView?.HTMLElement
      || globalThis.HTMLElement;

    if (!BaseHTMLElement) return;

    for (let i = 0; i < customElementTriggers.length; i++) {
      const trigger = customElementTriggers[i];
      const customTagName = trigger.name.toLowerCase();
      if (!reg.get(customTagName)) {
        try {
          const observed = trigger.observedAttributes || [];
          class LimeCustomElement extends BaseHTMLElement {
            static get observedAttributes() {
              return observed;
            }
            attributeChangedCallback(name, oldValue, newValue) {
              const bridge = this._limeCustomElementCtx;
              if (!bridge || !bridge.active) return;
              const activeTrigger = bridge.trigger;
              if (typeof activeTrigger?.update === 'function' && oldValue !== newValue) {
                try {
                  activeTrigger.update(this, { name, oldValue, newValue }, bridge.ctx);
                } catch {
                  // Fault isolation
                }
              }
            }
          }
          reg.define(customTagName, LimeCustomElement);
        } catch {
          // Ignore duplicate definition races
        }
      }
    }
  }

  // Initial registration if registry or document was provided in options or available globally
  registerCustomElements(customElementsRegistry, options.document);

  /**
   * Matches an element against the compiled routes for a given phase,
   * returning an execution plan ordered strictly by DOM attribute order.
   *
   * @param {Element} element - DOM Element
   * @param {'transform'|'link'} [phase='link'] - Target execution phase
   * @returns {Array<{ record: RouteRecord, matchedAttribute?: string, anchorIndex: number, attributes?: Object }>}
   */
  function matchElement(element, phase = 'link') {
    if (!element || element.nodeType !== 1) return EMPTY_MATCHES;

    const tables = phaseTables[phase];
    if (!tables) return EMPTY_MATCHES;

    let matches = null;

    // 1. Exact Tag Route (expected O(1) hash lookup, anchored at index -1)
    const tagRecord = tables.exactTagRoutes.get(element.tagName);
    if (tagRecord) {
      const trig = tagRecord.trigger;
      const reqOk = !trig.required || trig.required.length === 0
        || trig.required.every((r) => element.hasAttribute(r));

      if (reqOk && (typeof trig.match !== 'function' || trig.match(element))) {
        matches = [{
          record: tagRecord,
          matchedAttribute: undefined,
          anchorIndex: -1,
          attributes: harvestAttributes(element, trig),
        }];
      }
    }

    // 2. Direct DOM attribute iteration for deterministic non-mutating traversal (zero allocations)
    const attributes = element.attributes;
    const attrCount = attributes ? attributes.length : 0;
    if (attrCount === 0) return matches || EMPTY_MATCHES;

    let matchedMultiAttrs = null; // Lazy allocated only when multi-attr route matches

    for (let attrIndex = 0; attrIndex < attrCount; attrIndex++) {
      const attr = attributes[attrIndex];
      const attrName = attr.name;

      // a. Exact Attribute Route (expected O(1) hash lookup)
      const exactRecord = tables.exactAttrRoutes.get(attrName);
      if (exactRecord) {
        const trig = exactRecord.trigger;
        const excluded = isExcluded(attrName, trig.exclude);
        const reqOk = !trig.required || trig.required.length === 0
          || trig.required.every((r) => element.hasAttribute(r));

        if (!excluded && reqOk && (typeof trig.match !== 'function' || trig.match(element, attrName, attr))) {
          if (!matches) matches = [];
          matches.push({
            record: exactRecord,
            matchedAttribute: attrName,
            anchorIndex: attrIndex,
            attributes: harvestAttributes(element, trig, attrName),
          });
        }
      }

      // b. Multi-Attribute Candidate Route via Anchor Attribute (O(C * R))
      const multiCandidates = tables.multiAttrRoutes.get(attrName);
      if (multiCandidates) {
        for (let c = 0; c < multiCandidates.length; c++) {
          const multiRecord = multiCandidates[c];
          if (matchedMultiAttrs && matchedMultiAttrs.has(multiRecord)) continue;

          const trig = multiRecord.trigger;
          if (isExcluded(attrName, trig.exclude)) continue;

          // Verify all required attributes exist (existence check)
          const allRequiredPresent = trig.required.every(
            (reqAttr) => element.hasAttribute(reqAttr),
          );

          if (allRequiredPresent) {
            if (typeof trig.match !== 'function' || trig.match(element, attrName, attr)) {
              if (!matchedMultiAttrs) matchedMultiAttrs = new Set();
              matchedMultiAttrs.add(multiRecord);
              if (!matches) matches = [];
              matches.push({
                record: multiRecord,
                matchedAttribute: attrName,
                anchorIndex: attrIndex,
                attributes: harvestAttributes(element, trig),
              });
            }
          }
        }
      }

      // c. Pattern Attribute Candidate Route (O(P))
      for (let p = 0; p < tables.patternRoutes.length; p++) {
        const patternRecord = tables.patternRoutes[p];
        const trig = patternRecord.trigger;

        if (isExcluded(attrName, trig.exclude)) continue;

        const { pattern } = trig;
        let isPatternMatch;
        if (typeof pattern === 'string') {
          isPatternMatch = attrName.startsWith(pattern);
        } else {
          // RegExp#test is stateful for global and sticky expressions. Routes
          // must match consistently across transform and link passes.
          pattern.lastIndex = 0;
          isPatternMatch = pattern.test(attrName);
          pattern.lastIndex = 0;
        }

        if (isPatternMatch) {
          const reqOk = !trig.required || trig.required.length === 0
            || trig.required.every((r) => element.hasAttribute(r));

          if (reqOk && (typeof trig.match !== 'function' || trig.match(element, attrName, attr))) {
            if (!matches) matches = [];
            matches.push({
              record: patternRecord,
              matchedAttribute: attrName,
              anchorIndex: attrIndex,
              attributes: harvestAttributes(element, trig, attrName),
            });
          }
        }
      }
    }

    return matches || EMPTY_MATCHES;
  }

  return Object.freeze({
    matchElement,
    registerCustomElements,
    hasTransformRoutes() {
      return phaseTables.transform.triggerList.length > 0;
    },
    hasLinkRoutes() {
      return phaseTables.link.triggerList.length > 0;
    },
    getTransformCandidateSelector() {
      return transformCandidateSelector;
    },
    /**
     * Returns false only when an exact-route selector proves no transform route
     * can match. Pattern and multi-attribute routes retain the normal scan.
     *
     * @param {Element|DocumentFragment} root
     * @returns {boolean}
     */
    hasTransformCandidates(root) {
      if (!transformCandidateSelector || !root) return true;
      try {
        return (root.nodeType === 1 && root.matches(transformCandidateSelector))
          || Boolean(root.querySelector?.(transformCandidateSelector));
      } catch {
        // Custom trigger names are allowed; retain the general matcher if a
        // host DOM rejects an otherwise safe selector.
        return true;
      }
    },
    getTransformTag(tagName) {
      if (typeof tagName !== 'string') return undefined;
      return phaseTables.transform.exactTagRoutes.get(tagName.toUpperCase());
    },
    getLinkTag(tagName) {
      if (typeof tagName !== 'string') return undefined;
      return phaseTables.link.exactTagRoutes.get(tagName.toUpperCase());
    },
    getRoutesForPhase(phase) {
      const tables = phaseTables[phase];
      return tables ? Object.freeze([...tables.triggerList]) : Object.freeze([]);
    },
    get modules() {
      return Object.freeze([...registeredModules]);
    },
  });
}

export default createRouter;
