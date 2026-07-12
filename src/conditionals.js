/**
 * @module conditionals
 * @description Statically resolves <if>/<else> condition blocks in the DOM.
 *
 * <else> MODEL — a wrapper:
 *   - <else></else> is a WRAPPER. <else/> or an empty self-close is FORBIDDEN;
 *     the HTML5 parser doesn't treat it as a void element and swallows the
 *     following content.
 *   - Everything among <if>'s DIRECT children EXCEPT the <else> ELEMENT is the "then" group.
 *   - <else>'s INSIDE (childNodes) is the "else" group.
 *
 *     <if is-gt="x" than="0">
 *       <span>then content</span>    ← direct child other than <else> = then
 *       <else>
 *         <span>else content</span>  ← inside of <else> = else
 *       </else>
 *     </if>
 *
 * Other rules:
 *   - <if>/<else> do NOT remain in the final DOM; only the winning content is placed.
 *   - Processing is outer-to-inner; inner <if>s wait their turn until the outer one resolves.
 *   - Reactivity (data-live) is NOT in this module — handled in bindings.js.
 *   - Special parsing contexts like <table> TODO: may need a separate mechanism.
 */

import { getByPath } from './store.js';
import { errors } from './errors.js';
import { inLiveBlock, inIgnoredBlock } from './shared.js';

/**
 * Supported condition operators.
 * A new operator = one line in this table; no other change needed.
 *
 * Left side: the operator attribute's value is a path — resolved via getByPath.
 * Right side: raw string from the "than" or "to" attribute (except is-truthy).
 *
 * @type {Record<string, function(*, *=): boolean>}
 */
export const OPERATORS = {
  'is-gt':     (left, right) => Number(left)  >   Number(right),
  'is-lt':     (left, right) => Number(left)  <   Number(right),
  'is-gte':    (left, right) => Number(left)  >=  Number(right),
  'is-lte':    (left, right) => Number(left)  <=  Number(right),
  'is-eq':     (left, right) => String(left)  === String(right),
  'is-neq':    (left, right) => String(left)  !== String(right),
  'is-truthy': (left)        => Boolean(left),
};

const OPERATOR_NAMES = Object.keys(OPERATORS);

/**
 * Evaluates an <if> element's condition against the context.
 *
 * @param {Element} ifEl    - The <if> element
 * @param {Object}  context - Plain object for path resolution
 * @returns {boolean}
 */
export function evalCondition(ifEl, context) {
  const opName = OPERATOR_NAMES.find((op) => ifEl.hasAttribute(op));

  if (!opName) {
    const unknownOp = Array.from(ifEl.attributes).find((a) => a.name.startsWith('is-'));
    if (unknownOp) {
      errors.unknownOperator(unknownOp.name, OPERATOR_NAMES, ifEl);
    } else {
      errors.missingOperator(ifEl);
    }
    return false;
  }

  const path      = ifEl.getAttribute(opName);
  const leftValue = getByPath(context, path);
  const rightRaw  = ifEl.getAttribute('than') ?? ifEl.getAttribute('to') ?? '';

  return Boolean(OPERATORS[opName](leftValue, rightRaw));
}

/**
 * Evaluates a single <if> element; leaves the winning content in its place in the DOM.
 *
 * Then group : <if>'s DIRECT children — EXCEPT the <else> element.
 * Else group : <else>'s childNodes.
 *
 * Tolerance: warns the user if another element follows <else>, but still
 * works (anything after it is counted as then, regardless of position).
 *
 * @param {Element} ifEl    - The <if> element
 * @param {Object}  context
 * @returns {void}
 */
export function processIf(ifEl, context) {
  const condition     = evalCondition(ifEl, context);
  // replaceWith on a live NodeList is unsafe; copy first
  const directChildren = Array.from(ifEl.childNodes);

  // Find only the DIRECT child <else>; don't descend into grandchildren — parentage guarantee
  const elseEl = directChildren.find(
    (ch) => ch.nodeType === Node.ELEMENT_NODE && ch.tagName === 'ELSE',
  ) ?? null;

  // Tolerance: warn if an element node follows <else>, but still proceed
  if (elseEl) {
    const idxElse    = directChildren.indexOf(elseEl);
    const afterElse  = directChildren
      .slice(idxElse + 1)
      .filter((ch) => ch.nodeType === Node.ELEMENT_NODE);
    if (afterElse.length > 0) {
      errors.elseAfterContent(ifEl);
    }
  }

  // Then: all direct children other than the <else> element (position-independent)
  const thenNodes = directChildren.filter((ch) => ch !== elseEl);
  // Else: <else>'s inside; empty if there's no <else>
  const elseNodes = elseEl ? Array.from(elseEl.childNodes) : [];

  // Remove <if>, put the winner in its place (empty spread → element is deleted)
  ifEl.replaceWith(...(condition ? thenNodes : elseNodes));
}

/**
 * Processes every <if> element under root, outer-to-inner.
 *
 * Outer-to-inner: elements whose parentElement is not inside an <if> count as
 * "outermost." The DOM changes after each pass; the loop continues until no
 * <if> remains.
 *
 * @param {Element|DocumentFragment} root
 * @param {Object}                   context
 * @returns {void}
 */
export function processAllIfs(root, context) {
  let candidates;

  while ((candidates = Array.from(root.querySelectorAll('if'))).length > 0) {
    // Outermost <if>s: no ancestor is an <if>, does not carry data-live, AND
    // is not inside a not-yet-expanded <if data-live>/<for data-live> block,
    // AND is not inside an ignored block.
    // Ones carrying data-live are left to bindings-blocks.js (reactive tear-down/rebuild);
    // ordinary <if>s INSIDE a live block are not processed early here, since
    // they'll only get the correct (branch/item) context via renderFn's (render()) call.
    const outermost = candidates.filter(
      (el) =>
        !el.parentElement?.closest('if') &&
        !el.hasAttribute('data-live') &&
        !inLiveBlock(el) &&
        !inIgnoredBlock(el),
    );
    if (outermost.length === 0) break; // deadlock guard (also exits if only live-ifs remain)

    for (const ifEl of outermost) {
      processIf(ifEl, context);
    }
  }
}
