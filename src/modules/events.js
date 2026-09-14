/**
 * @module modules/events
 * Standard behavioral module for event binding — `data-on-{event}="handlerName"`.
 *
 * Contract & Invariants:
 *   - Phase: Link (zero structural DOM mutations).
 *   - Eval-free handler lookup: looks up handler by name in mount `handlers`
 *     dictionary or lexical scope (with Object.hasOwn prototype protection).
 *   - Key modifiers: `data-on-keydown-{key}` and `data-on-keyup-{key}` filter
 *     on `event.key` (Enter, Escape, Space, Tab, ArrowUp, ArrowDown, ArrowLeft,
 *     ArrowRight, Delete, Backspace).
 *   - Submit prevention: `data-on-submit` always calls `event.preventDefault()`.
 *   - Delegated event dispatch: when running within a mount target, listens on
 *     target to handle existing and future live nodes via event bubbling.
 *   - Single object payload: handler({ event, element, scope, store, data }).
 *   - Companion data attribute: `data-on-*-data` resolved via scope/store or literals.
 *   - Return values strictly ignored (no return false -> preventDefault).
 *   - Async and synchronous throws isolated; reports MODULE_HANDLER_FAILED.
 *   - Diagnostics:
 *     - UNKNOWN_EVENT: for invalid event names.
 *     - UNKNOWN_KEY_MODIFIER: for unrecognized key modifier suffixes.
 *     - HANDLER_NOT_FOUND: when handler name is not defined in handlers dictionary.
 *     - MODULE_HANDLER_FAILED: when handler execution throws or rejects.
 */

import { pattern } from '../core/triggers.js';
import { inIgnoredBlock } from '../shared.js';
import { getByPath } from '../store.js';
import { getElementScope, setElementScope } from '../core/scope.js';

/** @type {Set<string>} Event types supported as data-on-{event}. */
const SUPPORTED_EVENTS = new Set([
  'click', 'dblclick', 'input', 'change', 'submit', 'keydown', 'keyup',
  'focus', 'blur', 'focusin', 'focusout',
]);

/** @type {Map<string, string>} Maps non-bubbling event names to bubbling DOM equivalents. */
const DOM_EVENT_MAP = new Map([
  ['focus', 'focusin'],
  ['blur', 'focusout'],
]);

/** @type {Set<string>} Event types that accept a -{key} modifier suffix. */
const KEYED_EVENTS = new Set(['keydown', 'keyup']);

/**
 * @type {Map<string, string>} Modifier suffix (lowercase) → `event.key` value.
 */
const KEY_MODIFIERS = new Map([
  ['enter', 'Enter'],
  ['escape', 'Escape'],
  ['space', ' '],
  ['tab', 'Tab'],
  ['up', 'ArrowUp'],
  ['down', 'ArrowDown'],
  ['left', 'ArrowLeft'],
  ['right', 'ArrowRight'],
  ['delete', 'Delete'],
  ['backspace', 'Backspace'],
]);

/**
 * Prohibited handler names to guarantee absolute prototype pollution protection.
 */
const PROHIBITED_HANDLER_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'valueOf',
  'toLocaleString',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'hasOwnProperty',
]);

/**
 * Resolves explicit handler data from a raw attribute string.
 *
 * Evaluation order:
 * 1. Missing or empty string -> null
 * 2. Quoted string literals ('hello', "world") -> unwrapped string
 * 3. Primitives ('true' -> true, 'false' -> false, 'null' -> null, 'undefined' -> null)
 * 4. Numeric literals ('42' -> 42, '-3.14' -> -3.14)
 * 5. Lexical scope path lookup, falling back to reactive store path lookup
 *
 * @param {string|null} raw
 * @param {Object|null} scope
 * @param {Object|null} store
 * @returns {*}
 */
export function resolveHandlerData(raw, scope, store) {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Quoted string literals
  const firstChar = trimmed[0];
  const lastChar = trimmed[trimmed.length - 1];
  if ((firstChar === "'" && lastChar === "'") || (firstChar === '"' && lastChar === '"')) {
    if (trimmed.length >= 2) {
      return trimmed.slice(1, -1);
    }
  }

  // 2. Primitive literals
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === 'undefined') return null;

  // 3. Numeric literals
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
  }

  // 4. Scope and Store path resolution
  let val = scope ? getByPath(scope, trimmed) : undefined;
  if (val === undefined && store && typeof store.get === 'function') {
    val = store.get(trimmed);
  }

  return val === undefined ? null : val;
}

/**
 * Looks up a handler by name from handlers dictionary or scope with prototype protection.
 *
 * @param {string} handlerName
 * @param {Object|null} handlers
 * @param {Object|null} scope
 * @returns {Function|undefined|null}
 */
function lookupHandler(handlerName, handlers, scope) {
  if (PROHIBITED_HANDLER_NAMES.has(handlerName)) {
    return null;
  }

  if (handlers && Object.hasOwn(handlers, handlerName)) {
    return handlers[handlerName];
  }

  if (scope) {
    if (Object.hasOwn(scope, handlerName)) {
      return scope[handlerName];
    }
    if (handlerName in scope && !Object.prototype.hasOwnProperty.call(Object.prototype, handlerName)) {
      return scope[handlerName];
    }
  }

  return undefined;
}

/**
 * Invokes a handler with fault-isolation and centralized error reporting.
 *
 * @param {Function} handler
 * @param {string} handlerName
 * @param {Object} payload
 * @param {Object} ctx
 * @param {Element} element
 */
function invokeHandler(handler, handlerName, payload, ctx, element) {
  try {
    const result = handler(payload);
    if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
      result.catch((err) => {
        ctx.error('MODULE_HANDLER_FAILED', { handler: handlerName, error: err }, element);
      });
    }
  } catch (err) {
    ctx.error('MODULE_HANDLER_FAILED', { handler: handlerName, error: err }, element);
  }
}

/**
 * Finds lexical scope for an element, checking element, ancestors, or fallback scope.
 *
 * @param {Element} element
 * @param {Element} target
 * @param {Object|null} fallbackScope
 * @returns {Object}
 */
function findElementScope(element, target, fallbackScope) {
  let curr = element;
  while (curr && curr.nodeType === 1) {
    const s = getElementScope(curr);
    if (s) {
      return s;
    }
    if (curr === target) break;
    curr = curr.parentNode;
  }
  return fallbackScope || Object.create(null);
}

/**
 * Parses the event name from attribute name (part after data-on-).
 *
 * @param {string} eventName
 * @returns {{ type: string, requiredKey: (string|null), badModifier?: string }|null}
 */
function parseEventName(eventName) {
  if (SUPPORTED_EVENTS.has(eventName)) {
    const domType = DOM_EVENT_MAP.get(eventName) ?? eventName;
    return { type: domType, requiredKey: null };
  }

  const dashIndex = eventName.indexOf('-');
  if (dashIndex > 0) {
    const base = eventName.slice(0, dashIndex);
    if (KEYED_EVENTS.has(base)) {
      const modifier = eventName.slice(dashIndex + 1).toLowerCase();
      if (KEY_MODIFIERS.has(modifier)) {
        return { type: base, requiredKey: KEY_MODIFIERS.get(modifier) };
      }
      return { type: base, requiredKey: null, badModifier: modifier };
    }
  }

  return null;
}

// Track active delegated event listeners per target to avoid duplicate bindings
const targetDelegatedMap = new WeakMap();

/**
 * Ensures a delegated listener is attached to the mount target for the specified DOM event type.
 *
 * @param {Element} target
 * @param {string} domType
 * @param {Object} ctx
 * @param {Object} moduleOptions
 */
function ensureDelegatedListener(target, domType, ctx, moduleOptions) {
  if (!target || target.nodeType !== 1) return;

  let delegations = targetDelegatedMap.get(target);
  if (!delegations) {
    delegations = new Map();
    targetDelegatedMap.set(target, delegations);
  }

  let delegation = delegations.get(domType);
  if (!delegation) {
    const onEvent = (event) => {
      let current = event.target;
      while (current && current.nodeType === 1) {
        if (inIgnoredBlock(current)) break;

        for (const attr of current.attributes) {
          if (!attr.name.startsWith('data-on-') || attr.name.endsWith('-data')) continue;
          const evName = attr.name.slice(8);
          const parsed = parseEventName(evName);
          if (!parsed || parsed.type !== domType) continue;

          if (parsed.requiredKey !== null && event.key !== parsed.requiredKey) {
            continue;
          }

          if (domType === 'submit') {
            event.preventDefault();
          }

          const handlerName = attr.value;
          const handlers = ctx.handlers || ctx.options?.handlers || moduleOptions.handlers || {};
          const elementScope = findElementScope(current, target, ctx.scope);
          const handler = lookupHandler(handlerName, handlers, elementScope);

          if (typeof handler !== 'function') {
            ctx.error('HANDLER_NOT_FOUND', { name: handlerName, available: Object.keys(handlers) }, current);
            continue;
          }

          const dataAttr = `${attr.name}-data`;
          const rawData = current.hasAttribute(dataAttr) ? current.getAttribute(dataAttr) : null;
          const resolvedData = rawData !== null
            ? resolveHandlerData(rawData, elementScope, ctx.store)
            : null;

          const payload = {
            event,
            element: current,
            scope: elementScope,
            store: ctx.store || null,
            data: resolvedData,
          };

          invokeHandler(handler, handlerName, payload, ctx, current);
        }

        if (current === target || event.cancelBubble) {
          break;
        }
        current = current.parentNode;
      }
    };

    delegation = { onEvent, owners: 0 };
    target.addEventListener(domType, onEvent);
    delegations.set(domType, delegation);
  }

  delegation.owners++;
  let released = false;

  ctx.onCleanup(() => {
    if (released) return;
    released = true;
    delegation.owners--;
    if (delegation.owners === 0) {
      target.removeEventListener(domType, delegation.onEvent);
      delegations.delete(domType);
      if (delegations.size === 0) {
        targetDelegatedMap.delete(target);
      }
    }
  });
}

/**
 * Creates the standard `events` module definition.
 *
 * @param {Object} [moduleOptions={}]
 * @param {Object} [moduleOptions.handlers]
 * @returns {Object} ModuleDefinition
 */
export function events(moduleOptions = {}) {
  return Object.freeze({
    name: 'events',
    triggers: [
      pattern('data-on-', {
        phase: 'link',

        read(el, ctx) {
          const attrName = ctx.matchedAttribute;
          if (!attrName || attrName.endsWith('-data')) return null;

          const eventName = attrName.slice(8);
          const parsed = parseEventName(eventName);

          if (!parsed) {
            ctx.error('UNKNOWN_EVENT', { eventName, validEvents: Array.from(SUPPORTED_EVENTS) }, el);
            return null;
          }

          if (parsed.badModifier !== undefined) {
            ctx.error('UNKNOWN_KEY_MODIFIER', { eventName, validKeys: Array.from(KEY_MODIFIERS.keys()) }, el);
            return null;
          }

          const handlerName = el.getAttribute(attrName);
          return {
            attrName,
            domType: parsed.type,
            requiredKey: parsed.requiredKey,
            handlerName,
          };
        },

        setup(el, data, ctx) {
          if (!data) return;

          if (ctx.scope) {
            setElementScope(el, ctx.scope);
          }

          const target = ctx.target;
          if (target && target.nodeType === 1) {
            // Delegated mode on mount target
            ensureDelegatedListener(target, data.domType, ctx, moduleOptions);
          } else {
            // Direct element-level binding fallback
            const onEvent = (event) => {
              if (inIgnoredBlock(el)) return;
              if (data.requiredKey !== null && event.key !== data.requiredKey) return;
              if (data.domType === 'submit') event.preventDefault();

              const handlers = ctx.handlers || ctx.options?.handlers || moduleOptions.handlers || {};
              const handler = lookupHandler(data.handlerName, handlers, ctx.scope);

              if (typeof handler !== 'function') {
                ctx.error('HANDLER_NOT_FOUND', { name: data.handlerName, available: Object.keys(handlers) }, el);
                return;
              }

              const dataAttr = `${data.attrName}-data`;
              const rawData = el.hasAttribute(dataAttr) ? el.getAttribute(dataAttr) : null;
              const resolvedData = rawData !== null
                ? resolveHandlerData(rawData, ctx.scope, ctx.store)
                : null;

              const payload = {
                event,
                element: el,
                scope: ctx.scope,
                store: ctx.store || null,
                data: resolvedData,
              };

              invokeHandler(handler, data.handlerName, payload, ctx, el);
            };

            el.addEventListener(data.domType, onEvent);
            ctx.onCleanup(() => {
              el.removeEventListener(data.domType, onEvent);
            });
          }
        },
      }),
    ],

    afterMount(hookApi) {
      const target = hookApi.target;
      if (!target || target.nodeType !== 1) return;

      const handlers = hookApi.options?.handlers || moduleOptions.handlers || {};

      // Ensure any event handler defined in options.handlers that matches a standard event is listening
      for (const handlerKey of Object.keys(handlers)) {
        if (SUPPORTED_EVENTS.has(handlerKey)) {
          const domType = DOM_EVENT_MAP.get(handlerKey) ?? handlerKey;
          ensureDelegatedListener(target, domType, hookApi, moduleOptions);
        }
      }

      // Also scan target for any used data-on-* attributes
      const allEls = [target, ...Array.from(target.querySelectorAll('*'))];
      for (let i = 0; i < allEls.length; i++) {
        for (const attr of allEls[i].attributes) {
          if (attr.name.startsWith('data-on-') && !attr.name.endsWith('-data')) {
            const evName = attr.name.slice(8);
            const parsed = parseEventName(evName);
            if (parsed && parsed.type) {
              ensureDelegatedListener(target, parsed.type, hookApi, moduleOptions);
            }
          }
        }
      }
    },
  });
}

export default events;
