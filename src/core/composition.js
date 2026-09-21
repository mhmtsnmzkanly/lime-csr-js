/**
 * @module core/composition
 * Built-in Partial + Slot Composition mechanism for the Module Kernel.
 *
 * Implements <partial name="..." data="..." [props...]> with Named & Default Slots:
 *   - Built-in Composition: Partials and Slots are core template-composition primitives.
 *   - Default Slot: <slot></slot>, caller children without slot attribute project in order.
 *   - Named Slots: <slot name="...">, matched by caller children with slot="...".
 *   - Projection Metadata Stripping: "slot" attribute is removed from projected elements.
 *   - Fallback Content: Unmatched slots render their own children; if empty, <slot> is removed.
 *   - Unknown Slots: Caller children targeting non-existent slots trigger SLOT_NOT_FOUND diagnostic
 *     and are discarded.
 *   - Order Preservation: Multiple caller children targeting the same slot preserve caller DOM order.
 *   - Scope Isolation & Preservation:
 *       - Partial template's own nodes run with isolated scope (null prototype).
 *       - Projected slot children retain caller lexical scope (mapped via setElementScope).
 *   - Phase: Transform (structural expansion).
 */

import { tag } from './triggers.js';
import { defineModule } from './registry.js';
import { createIsolatedScope, setElementScope, getElementScope, cloneWithScope } from './scope.js';
import { getByPath } from '../store.js';
import { resolveStatic } from '../template.js';

const UNSAFE_PROP_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Checks whether a collection of nodes contains meaningful content
 * (elements or non-whitespace text nodes).
 *
 * @param {Array<Node>} nodes
 * @returns {boolean}
 */
function hasContent(nodes) {
  if (!nodes || nodes.length === 0) return false;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.nodeType === 1) return true;
    if (n.nodeType === 3 && n.nodeValue.trim().length > 0) return true;
  }
  return false;
}

/**
 * Collects caller children from <partial> and groups them by slot name.
 *
 * @param {Element} partialEl
 * @returns {Map<string, Array<Node>>}
 */
function collectCallerSlots(partialEl) {
  const slots = new Map();
  const childNodes = Array.from(partialEl.childNodes);

  for (let i = 0; i < childNodes.length; i++) {
    const node = childNodes[i];
    if (node.nodeType === 1) {
      const slotName = node.getAttribute('slot') || '';
      if (!slots.has(slotName)) {
        slots.set(slotName, []);
      }
      slots.get(slotName).push(node);
    } else if (node.nodeType === 3 || node.nodeType === 8) {
      if (!slots.has('')) {
        slots.set('', []);
      }
      slots.get('').push(node);
    }
  }

  return slots;
}

/**
 * Resolves a template by name from options.templates or document.
 *
 * @param {string} name
 * @param {Object} ctx
 * @returns {Element|null}
 */
export function resolveTemplate(name, ctx) {
  const doc = ctx.document;
  if (!doc) return null;

  // 1. Check options.templates
  const templates = ctx.options?.templates || ctx.templates;
  if (templates && templates[name]) {
    const customTpl = templates[name];
    if (typeof customTpl === 'string') {
      const tpl = doc.createElement('template');
      tpl.innerHTML = customTpl;
      return tpl;
    }
    if (customTpl.nodeType === 1) {
      return customTpl;
    }
  }

  // 2. Query document templates
  return doc.querySelector(`template[id="tpl-${name}"]`)
    || doc.getElementById(`tpl-${name}`)
    || doc.getElementById(name);
}

/**
 * Reads attributes and props from <partial> element.
 *
 * @param {Element} el
 * @returns {{ name: (string|null), dataPath: (string|null), props: Object }}
 */
export function readPartial(el) {
  const name = el.getAttribute('name');
  const dataPath = el.getAttribute('data');
  const props = {};

  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'name' || attr.name === 'data') continue;
    if (attr.name.startsWith('data-')) continue;
    if (UNSAFE_PROP_NAMES.has(attr.name)) continue;
    props[attr.name] = attr.value;
  }

  return { name, dataPath, props };
}

/**
 * Expands a <partial> element, instantiating the template, projecting slots,
 * establishing isolated and caller scopes, and replacing the element in DOM.
 *
 * @param {Element} el
 * @param {Object} data
 * @param {Object} ctx
 */
export function expandPartial(el, data, ctx) {
  if (!data || !data.name) {
    ctx.error('PARTIAL_MISSING_NAME', el);
    el.remove();
    return;
  }

  const callerScope = getElementScope(el) || ctx.scope;

  // 1. Resolve base context from data="..." path
  let baseData = {};
  if (data.dataPath) {
    const resolved = getByPath(callerScope, data.dataPath)
      ?? (ctx.store ? ctx.store.get(data.dataPath) : undefined);
    if (resolved && typeof resolved === 'object') {
      baseData = resolved;
    }
  }

  // 2. Resolve additional props from caller context
  const resolvedProps = {};
  for (const [propName, pathStr] of Object.entries(data.props)) {
    const val = getByPath(callerScope, pathStr)
      ?? (ctx.store ? ctx.store.get(pathStr) : undefined);
    resolvedProps[propName] = val;
  }

  // 3. Create isolated scope (parent lexical scope is NOT inherited)
  const partialScope = createIsolatedScope(baseData, resolvedProps);

  // 4. Resolve template
  const doc = ctx.document;
  const templateEl = resolveTemplate(data.name, ctx);

  if (!templateEl) {
    const available = doc?.querySelectorAll
      ? Array.from(doc.querySelectorAll('template[id^="tpl-"]')).map((t) => t.id.slice(4))
      : [];
    ctx.error('PARTIAL_NOT_FOUND', { name: data.name, available }, el);
    el.remove();
    return;
  }

  // 5. Snapshot caller slot children before removing or mutating partial element
  const callerSlots = collectCallerSlots(el);

  // 6. Clone template content
  const fragment = templateEl.content
    ? templateEl.content.cloneNode(true)
    : templateEl.cloneNode(true);

  // 7. Associate template's own nodes with isolated partialScope
  setElementScope(fragment, partialScope);

  // 8. Find all <slot> elements in the fragment
  const slotElements = fragment.querySelectorAll
    ? Array.from(fragment.querySelectorAll('slot'))
    : [];
  if (fragment.nodeType === 1 && fragment.tagName === 'SLOT') {
    slotElements.unshift(fragment);
  }

  // 9. Discover defined template slot names and detect unknown caller slots
  const templateSlotNames = new Set();
  for (let i = 0; i < slotElements.length; i++) {
    const sName = slotElements[i].getAttribute('name') || '';
    templateSlotNames.add(sName);
  }

  for (const [callerSlotName] of callerSlots.entries()) {
    if (callerSlotName !== '') {
      if (!templateSlotNames.has(callerSlotName)) {
        const available = Array.from(templateSlotNames).filter(Boolean);
        ctx.error('SLOT_NOT_FOUND', {
          slot: callerSlotName,
          partial: data.name,
          available,
        }, el);
      }
    }
  }

  // 10. Project caller slots into template
  const projectedSlotsCount = new Map();

  for (let i = 0; i < slotElements.length; i++) {
    const slotEl = slotElements[i];
    const slotName = slotEl.getAttribute('name') || '';
    const callerNodes = callerSlots.get(slotName);
    const isProvided = slotName === ''
      ? hasContent(callerNodes)
      : Boolean(callerNodes && callerNodes.length > 0);

    if (isProvided && callerNodes) {
      const times = projectedSlotsCount.get(slotName) || 0;
      projectedSlotsCount.set(slotName, times + 1);

      const nodesToInsert = times === 0
        ? callerNodes
        : callerNodes.map((n) => cloneWithScope(n));

      for (let n = 0; n < nodesToInsert.length; n++) {
        const node = nodesToInsert[n];
        if (node.nodeType === 1) {
          node.removeAttribute('slot');
          setElementScope(node, callerScope);
        } else if (node.nodeType === 3) {
          setElementScope(node, callerScope);
        }
      }

      slotEl.replaceWith(...nodesToInsert);
    } else {
      // Fallback content: if <slot> has children, replace <slot> with them; otherwise remove
      const fallbackChildren = Array.from(slotEl.childNodes);
      if (fallbackChildren.length > 0) {
        slotEl.replaceWith(...fallbackChildren);
      } else {
        slotEl.remove();
      }
    }
  }

  // 11. Resolve static interpolation in the composite fragment
  resolveStatic(fragment, partialScope, ctx.store);

  // 12. Transform nested structural blocks within the fragment
  ctx.deferTransform(fragment, partialScope);

  // 13. Replace <partial> element with the expanded fragment
  el.replaceWith(fragment);
}

/**
 * Creates the built-in composition module definition.
 *
 * @param {Object} [_options={}]
 * @returns {Readonly<Object>} ModuleDefinition
 */
export function createCompositionModule(_options = {}) {
  return defineModule({
    name: 'partials',
    triggers: [
      tag('PARTIAL', {
        phase: 'transform',
        read: readPartial,
        setup: expandPartial,
      }),
    ],
  });
}

export default createCompositionModule;
