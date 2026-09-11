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
      return `${phase}:ATTRS:${trigger.required.join(',')}`;
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

  // 1. Compile routes and resolve precedence
  for (let m = 0; m < registeredModules.length; m++) {
    const mod = registeredModules[m];
    if (!mod || !Array.isArray(mod.triggers)) continue;

    for (let t = 0; t < mod.triggers.length; t++) {
      const trigger = mod.triggers[t];
      const phase = trigger.phase || (trigger.type === TRIGGER_TYPES.TAG ? 'transform' : 'link');

      if (!phaseTables[phase]) {
        // Safe fallback for custom phases: map to link
        phaseTables[phase] = createPhaseRouteTables();
      }

      const conflictKey = getTriggerConflictKey(trigger, phase);

      // Precedence check: first module claiming conflictKey wins
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
        case TRIGGER_TYPES.TAG:
          tables.exactTagRoutes.set(trigger.name, record);
          break;

        case TRIGGER_TYPES.ATTR:
          tables.exactAttrRoutes.set(trigger.name, record);
          break;

        case TRIGGER_TYPES.PATTERN:
          tables.patternRoutes.push(record);
          break;

        case TRIGGER_TYPES.ATTRS: {
          const anchorAttr = trigger.required[0];
          let bucket = tables.multiAttrRoutes.get(anchorAttr);
          if (!bucket) {
            bucket = [];
            tables.multiAttrRoutes.set(anchorAttr, bucket);
          }
          bucket.push(record);
          break;
        }

        default:
          break;
      }
    }
  }

  /**
   * Matches an element against the compiled routes for a given phase,
   * returning an execution plan ordered strictly by DOM attribute order.
   *
   * @param {Element} element - DOM Element
   * @param {'transform'|'link'} [phase='link'] - Target execution phase
   * @returns {Array<{ record: RouteRecord, matchedAttribute?: string, anchorIndex: number }>}
   */
  function matchElement(element, phase = 'link') {
    if (!element || element.nodeType !== 1) return [];

    const tables = phaseTables[phase];
    if (!tables) return [];

    const matches = [];

    // 1. Exact Tag Route (expected O(1) hash lookup, anchored at index -1)
    const tagRecord = tables.exactTagRoutes.get(element.tagName);
    if (tagRecord) {
      if (typeof tagRecord.trigger.match !== 'function' || tagRecord.trigger.match(element)) {
        matches.push({
          record: tagRecord,
          matchedAttribute: undefined,
          anchorIndex: -1,
        });
      }
    }

    // 2. Snapshot DOM attributes for deterministic non-mutating traversal
    const attributes = Array.from(element.attributes);
    if (attributes.length === 0) return Object.freeze(matches);

    const matchedMultiAttrs = new Set(); // Prevent re-triggering multi-attr on subsequent required attrs

    for (let attrIndex = 0; attrIndex < attributes.length; attrIndex++) {
      const attr = attributes[attrIndex];
      const attrName = attr.name;

      // a. Exact Attribute Route (expected O(1) hash lookup)
      const exactRecord = tables.exactAttrRoutes.get(attrName);
      if (exactRecord) {
        if (typeof exactRecord.trigger.match !== 'function' || exactRecord.trigger.match(element, attrName, attr)) {
          matches.push({
            record: exactRecord,
            matchedAttribute: attrName,
            anchorIndex: attrIndex,
          });
        }
      }

      // b. Multi-Attribute Candidate Route via Anchor Attribute (O(C * R))
      const multiCandidates = tables.multiAttrRoutes.get(attrName);
      if (multiCandidates) {
        for (let c = 0; c < multiCandidates.length; c++) {
          const multiRecord = multiCandidates[c];
          if (matchedMultiAttrs.has(multiRecord)) continue;

          // Verify all required attributes exist (existence check)
          const allRequiredPresent = multiRecord.trigger.required.every(
            (reqAttr) => element.hasAttribute(reqAttr),
          );

          if (allRequiredPresent) {
            if (typeof multiRecord.trigger.match !== 'function' || multiRecord.trigger.match(element, attrName, attr)) {
              matchedMultiAttrs.add(multiRecord);
              matches.push({
                record: multiRecord,
                matchedAttribute: attrName,
                anchorIndex: attrIndex,
              });
            }
          }
        }
      }

      // c. Pattern Attribute Candidate Route (O(P))
      for (let p = 0; p < tables.patternRoutes.length; p++) {
        const patternRecord = tables.patternRoutes[p];
        const isPatternMatch = typeof patternRecord.trigger.pattern === 'string'
          ? attrName.startsWith(patternRecord.trigger.pattern)
          : patternRecord.trigger.pattern.test(attrName);

        if (isPatternMatch) {
          if (typeof patternRecord.trigger.match !== 'function' || patternRecord.trigger.match(element, attrName, attr)) {
            matches.push({
              record: patternRecord,
              matchedAttribute: attrName,
              anchorIndex: attrIndex,
            });
          }
        }
      }
    }

    return Object.freeze(matches);
  }

  return Object.freeze({
    matchElement,
    hasTransformRoutes() {
      return phaseTables.transform.triggerList.length > 0;
    },
    hasLinkRoutes() {
      return phaseTables.link.triggerList.length > 0;
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
