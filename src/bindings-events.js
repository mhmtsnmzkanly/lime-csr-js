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
 *   template.js/conditionals.js). Likewise `data-on-keydown-enter="save"` is
 *   the eval-free counterpart of Alpine's `x-on:keydown.enter`/`@keydown.enter`
 *   — the modifier filters on `event.key`, the value stays a dictionary key.
 *
 * SUPPORTED EVENTS (SUPPORTED_EVENTS):
 *   click, dblclick, input, change, submit, keydown, keyup — derived from the
 *   attribute name (`data-on-{event}`). If a type outside this list of 7 is
 *   used (e.g. `data-on-foo`), a dev-mode warning is issued and that attribute
 *   is ignored. focus/blur/mouseenter/mouseleave are DELIBERATELY absent —
 *   they don't bubble, so root-level delegation can't catch them (they'd need
 *   capture-phase or per-element listeners; out of scope).
 *
 * KEY MODIFIERS (KEY_MODIFIERS) — keydown/keyup ONLY:
 *   `data-on-keydown-{key}` / `data-on-keyup-{key}` call the handler ONLY
 *   when `event.key` matches the modifier; any other key silently returns.
 *   Supported: enter, escape, space, tab, up, down, left, right, delete,
 *   backspace (case-insensitive; mapped to the corresponding event.key
 *   values — see the KEY_MODIFIERS map). Unmodified `data-on-keydown` keeps
 *   firing for EVERY key (backward compatible), and modified + unmodified
 *   attributes may coexist on one element — each is evaluated independently.
 *   DELEGATION DETAIL: the modifier is part of the ATTRIBUTE name only; the
 *   underlying DOM listener is always the base 'keydown'/'keyup' type (no
 *   bogus 'keydown-enter' event type is ever registered). An unsupported
 *   modifier (data-on-keydown-foo) → UNKNOWN_KEY_MODIFIER warning, inert.
 *
 * MECHANISM — DELEGATION (not one listener per element):
 *   setupEventBindings sets up ONE listener PER USED EVENT TYPE
 *   (`root.addEventListener(type, ...)`), not per element — and only for the
 *   types actually used, not blindly for all 7 (see collectUsedEventTypes).
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
const SUPPORTED_EVENTS = new Set(['click', 'dblclick', 'input', 'change', 'submit', 'keydown', 'keyup']);

/** @type {Set<string>} Event types that accept a -{key} modifier suffix. */
const KEYED_EVENTS = new Set(['keydown', 'keyup']);

/**
 * @type {Map<string, string>} Modifier suffix (attribute side, lowercase) →
 * the `event.key` value it must match.
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

const EVENT_ATTR_PATTERN = /^data-on-(.+)$/;

/**
 * Parses the `{event}` part of a `data-on-{event}` attribute name.
 *
 * Outcomes:
 *   - "keydown"        → { type: 'keydown', requiredKey: null }
 *   - "keydown-enter"  → { type: 'keydown', requiredKey: 'Enter' }
 *   - "keydown-foo"    → { type: 'keydown', badModifier: 'foo' } (keyed base,
 *     unknown modifier — caller warns UNKNOWN_KEY_MODIFIER, attribute is inert)
 *   - "foo" / "click-x" → null (unknown event type — caller warns UNKNOWN_EVENT)
 *
 * The modifier is matched case-insensitively (the HTML parser lowercases
 * attribute names anyway; toLowerCase covers XML/exotic sources too).
 *
 * @param {string} eventName - The part after "data-on-"
 * @returns {{ type: string, requiredKey?: (string|null), badModifier?: string }|null}
 */
function parseEventName(eventName) {
  if (SUPPORTED_EVENTS.has(eventName)) return { type: eventName, requiredKey: null };

  const dashIndex = eventName.indexOf('-');
  if (dashIndex > 0) {
    const base = eventName.slice(0, dashIndex);
    if (KEYED_EVENTS.has(base)) {
      const modifier = eventName.slice(dashIndex + 1).toLowerCase();
      if (KEY_MODIFIERS.has(modifier)) {
        return { type: base, requiredKey: KEY_MODIFIERS.get(modifier) };
      }
      return { type: base, badModifier: modifier };
    }
  }

  return null;
}

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
 *   SUPPORTED_EVENTS) type is found, it's warned about here (once, at scan
 *   time) — same for an unknown key modifier (data-on-keydown-foo).
 *
 * Key modifiers share their base type's entry: data-on-keydown-enter is
 * registered under 'keydown' as one more ATTRIBUTE variant — never as a
 * separate DOM event type.
 *
 * @returns {Map<string, Map<string, string|null>>}
 *   base event type → (attribute name in use → required event.key, or null
 *   for the unmodified fire-on-every-key form)
 */
function collectUsedEventTypes() {
  const types = new Map();

  for (const tpl of document.querySelectorAll('template')) {
    for (const el of tpl.content.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        const match = EVENT_ATTR_PATTERN.exec(attr.name);
        if (!match) continue;

        const eventName = match[1];
        const parsed = parseEventName(eventName);
        if (!parsed) {
          errors.unknownEvent(eventName, Array.from(SUPPORTED_EVENTS), el);
          continue;
        }
        if (parsed.badModifier !== undefined) {
          errors.unknownKeyModifier(eventName, Array.from(KEY_MODIFIERS.keys()), el);
          continue;
        }

        if (!types.has(parsed.type)) types.set(parsed.type, new Map());
        types.get(parsed.type).set(`data-on-${eventName}`, parsed.requiredKey);
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

  for (const [type, attrs] of usedTypes) {
    // ONE DOM listener per base type; every attribute variant in use
    // (data-on-keydown, data-on-keydown-enter, ...) shares it and is
    // evaluated independently — its own closest() lookup, its own key filter.
    const onEvent = (event) => {
      for (const [attrName, requiredKey] of attrs) {
        const el = event.target.closest?.(`[${attrName}]`);
        if (!el || !root.contains(el)) continue;

        // Skip events from ignored blocks — third-party widget markup
        if (inIgnoredBlock(el)) continue;

        // Key modifier: the handler fires ONLY when event.key matches;
        // any other key silently returns (null = unmodified, every key fires)
        if (requiredKey !== null && event.key !== requiredKey) continue;

        // data-on-submit ALWAYS calls preventDefault (see the "MODIFIER"
        // section in the module JSDoc) — even if the handler isn't found, to
        // prevent the native submit from reloading the page.
        if (type === 'submit') event.preventDefault();

        const handlerName = el.getAttribute(attrName);
        const handler = Object.hasOwn(handlers, handlerName) ? handlers[handlerName] : undefined;

        if (!handler) {
          errors.handlerNotFound(handlerName, Object.keys(handlers), el);
          continue;
        }

        handler(event, el);
      }
    };

    root.addEventListener(type, onEvent);
    listeners.push({ type, onEvent });
  }

  return function cleanup() {
    for (const { type, onEvent } of listeners) root.removeEventListener(type, onEvent);
    listeners.length = 0; // guard against double cleanup calls
  };
}
