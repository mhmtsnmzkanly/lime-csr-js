/**
 * @module bindings-events
 * Event shortcut — `data-on-{event}="handlerName"` (the EVAL-FREE
 * counterpart of Alpine's `x-on`).
 *
 * WHAT IT DOES
 *   <button data-on-click="addComment">Add</button>
 *   A HANDLER DICTIONARY is passed to the mount() call:
 *     mount("page", ctx, target, store, { handlers: { addComment(e, el) {...} } })
 *   On click, the framework looks up "addComment" by name in the dictionary and calls it.
 *
 * NO EVAL — NAME MATCHING (a DELIBERATE DIFFERENCE from Alpine):
 *   In Alpine, `x-on:click="count++"` is a JS EXPRESSION in the attribute
 *   value, and it gets executed (via a `new Function`-like mechanism). Here
 *   the attribute value ("addComment") is NOT an expression — it's only a
 *   KEY (string) looked up in the `handlers` dictionary. No code is ever
 *   generated from a string and executed; this is fully consistent with the
 *   project-wide "no new Function/eval" principle (see the same principle in
 *   template.js/conditionals.js).
 *
 * SUPPORTED EVENTS (SUPPORTED_EVENTS):
 *   click, input, change, submit, keydown — derived from the attribute name
 *   (`data-on-{event}`). If a type outside this list of 5 is used (e.g.
 *   `data-on-foo`), a dev-mode warning is issued and that attribute is ignored.
 *
 * MECHANISM — DELEGATION (not one listener per element):
 *   setupEventBindings sets up ONE listener PER USED EVENT TYPE
 *   (`root.addEventListener(type, ...)`), not per element — and only for the
 *   types actually used, not blindly for all 5 (see collectUsedEventTypes).
 *   When an event arrives, the real target is found via
 *   `event.target.closest('[data-on-{type}]')`, the handler name is read
 *   from the attribute, and looked up in the dictionary.
 *
 *   ADVANTAGE OF DELEGATION: when reactive `<for data-live>`/`<if data-live>`
 *   adds new content and removes old content, there is NO NEED to set up a
 *   separate listener for those new elements — the single listener on `root`
 *   always catches them via event bubbling. Since `root` is a FIXED root for
 *   the duration of mount() that is UNAFFECTED by these reactive internal
 *   changes (only the nodes INSIDE it change, `root` itself never changes),
 *   this guarantee holds permanently — see the "delegation proof" test in
 *   examples/events-test.html.
 *
 *   WHY root, NOT document: if the listener were attached to `document`, then
 *   with multiple mount() calls on the page, every `document` listener would
 *   listen to the ENTIRE page — one mount's handlers dictionary could
 *   mistakenly catch a data-on-* element belonging to another mount (which
 *   could have the same name). Using `root` (mount()'s `target`) isolates
 *   each mount's own delegation; the `root.contains(el)` check is an extra
 *   layer of guarantee.
 *
 * NO inLiveBlock EXCEPTION NEEDED (DIFFERENCE from bindings.js/bindings-model.js/bindings-show.js):
 *   Those modules walk every element ONE BY ONE AT RENDER TIME (before the
 *   fragment is added to the DOM) and set up a subscription — if they bound
 *   an element inside a not-yet-expanded live block too early, that
 *   subscription would leak when the block later re-renders via its own
 *   renderFn (staying attached to the old DOM). Event delegation, on the
 *   other hand, never binds any element individually — a single root-level
 *   listener is set up, and when an event is ACTUALLY CLICKED, closest() is
 *   used to search the CURRENT (up-to-date) DOM at that moment. The risk of
 *   "binding too early to the wrong context" is structurally absent; hence
 *   no need for the inLiveBlock filter at all.
 *
 * MODIFIER — ONLY data-on-submit → preventDefault (DECISION):
 *   Not reloading the page on form submit is the OVERWHELMINGLY common
 *   desired behavior; so data-on-submit ALWAYS calls preventDefault (no
 *   opt-in data-prevent attribute was deemed NECESSARY — KISS). preventDefault
 *   is applied EVEN IF the handler is not found (a typo): otherwise the
 *   form's native submit would kick in and reload the page — exactly what we
 *   want to prevent. Other modifiers (stop propagation, once, debounce) were
 *   NOT ADDED — TODO: could be addressed later via a separate data-*
 *   attribute (e.g. `data-once`).
 *
 * SCOPE DECISION — no context is INJECTED into the handler:
 *   Handlers are written in APPLICATION code and already have access to
 *   their own store reference (via closure); the framework doesn't need to
 *   pass a context separately. Only `(event, element)` is passed to the
 *   handler — `element.dataset` is used to find out which item it relates to
 *   (e.g. `data-id="42"` → `el.dataset.id`; see the "Events" section in README).
 */

import { errors } from './errors.js';
import { inIgnoredBlock } from './shared.js';

/** @type {Set<string>} Event types supported as data-on-{event}. */
const SUPPORTED_EVENTS = new Set(['click', 'input', 'change', 'submit', 'keydown']);

const EVENT_ATTR_PATTERN = /^data-on-(.+)$/;

/**
 * Scans ALL <template> contents on the page and collects the data-on-{event}
 * types actually in use (intersected with SUPPORTED_EVENTS).
 *
 * WHY "ALL templates" (not just THIS mount's template):
 *   An <if data-live>'s else branch, a <for data-live>'s currently-empty loop
 *   body, or a <partial>'s OWN template may not YET be VISIBLE in the live
 *   DOM at mount TIME (they only appear once the relevant branch/item/partial
 *   is rendered). So scanning only the CURRENTLY rendered DOM would be
 *   insufficient — a data-on-* type that gets added LATER via reactivity
 *   would never have gotten a listener set up for it. The raw <template>
 *   sources (document.querySelectorAll('template')), however, are NEVER
 *   mutated (see template.js: the cache always returns cloneNode(true)) — so
 *   as written, regardless of which branch/loop/partial they belong to, they
 *   safely surface ALL data-on-* usages. If an unknown (outside
 *   SUPPORTED_EVENTS) type is found, it's warned about here (once, at scan time).
 *
 * @returns {Set<string>}
 */
function collectUsedEventTypes() {
  const types = new Set();

  for (const tpl of document.querySelectorAll('template')) {
    for (const el of tpl.content.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        const match = EVENT_ATTR_PATTERN.exec(attr.name);
        if (!match) continue;

        const eventName = match[1];
        if (SUPPORTED_EVENTS.has(eventName)) {
          types.add(eventName);
        } else {
          errors.unknownEvent(eventName, Array.from(SUPPORTED_EVENTS), el);
        }
      }
    }
  }

  return types;
}

/**
 * Sets up a SINGLE delegation listener on root for each data-on-{event} type
 * actually in use. A handler call whose name isn't found in the handlers
 * dictionary is warned about in dev-mode (no crash).
 *
 * @param {Element} root      - Delegation root (mount()'s target)
 * @param {import('./store.js').Store} store - Currently UNUSED (no context is
 *   injected into handlers, see the module JSDoc — kept for signature
 *   consistency with the other setup*Bindings functions).
 * @param {Object<string, function(Event, Element): void>} handlers
 * @returns {function(): void} cleanup — removes all listeners that were set up
 */
export function setupEventBindings(root, store, handlers) {
  const usedTypes = collectUsedEventTypes();
  const listeners = [];

  for (const type of usedTypes) {
    const attrName = `data-on-${type}`;

    const onEvent = (event) => {
      const el = event.target.closest?.(`[${attrName}]`);
      if (!el || !root.contains(el)) return;

      // Skip events from ignored blocks — third-party widget markup
      if (inIgnoredBlock(el)) return;

      // data-on-submit ALWAYS calls preventDefault (see the "MODIFIER"
      // section in the module JSDoc) — even if the handler isn't found, to
      // prevent the native submit from reloading the page.
      if (type === 'submit') event.preventDefault();

      const handlerName = el.getAttribute(attrName);
      const handler = Object.hasOwn(handlers, handlerName) ? handlers[handlerName] : undefined;

      if (!handler) {
        errors.handlerNotFound(handlerName, Object.keys(handlers), el);
        return;
      }

      handler(event, el);
    };

    root.addEventListener(type, onEvent);
    listeners.push({ type, onEvent });
  }

  return function cleanup() {
    for (const { type, onEvent } of listeners) root.removeEventListener(type, onEvent);
    listeners.length = 0; // guard against double cleanup calls
  };
}
