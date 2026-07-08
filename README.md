# lime-csr.js

> A build-less, HTML-first client-side render engine.

**lime-csr.js** makes HTML reactive without a compiler or bundler. No
webpack, no Vite, no npm dependency tree — add a single `<script>` tag and
start writing. The philosophy is simple:

> **HTML comes alive only when you add `data-*`.**

If an element has no `data-*`, the engine never touches it: it stays plain,
static HTML. The moment you add `data-*`, that element binds to state and
updates itself as data changes. Reactivity isn't a default — it's something
you opt into — so the rest of the page stays light.

## Why?

Modern frameworks are powerful but heavy: a build step, a virtual DOM, their
own template languages. Most pages don't need that. lime-csr.js is designed
for people who want "HTML + a bit of logic" — in the spirit of Alpine.js, but
with its own composition and template system.

- **Zero build step for development.** The source modules work directly in the browser via `<script type="module">`. A pre-built `dist/index.min.js` is included for production/convenience. Run `npm run build` to regenerate it.
- **HTML-first.** Templates live inside standard `<template>` tags.
- **Opt-in reactivity.** Only what you want comes alive; the rest stays static.
- **Small.** A single file, a handful of concepts.

For the full, detailed technical reference covering every template feature, APIs, error codes, and architectural details, see [DOCS.md](DOCS.md).

## Core concepts

### Static value — `${...}`

Printed once, never watched again. For data that won't change during the
page's lifetime.

```html
<h1>${post.title}</h1>
<p>${comment.body}</p>
```

### Reactive text — `data-text`

Binds to state; the text updates automatically as the data changes.

```html
<span data-text="likeCount"></span>
```

### Reactive attribute — `{x}` ↔ `data-x`

A placeholder inside an attribute is fed by the same-named `data-*`.

```html
<a href="/user/{handle}" data-handle="user.handle">Profile</a>
```

### Two-way binding — `data-model`

Binds form elements to the store in both read and write directions: typing
or checking updates state; state changing from outside updates the element.
No eval — just a fixed store path.

```html
<input type="text" data-model="user.name">
<textarea data-model="post.body"></textarea>
<input type="number" data-model="age">
<input type="checkbox" data-model="agree">

<input type="radio" name="plan" value="free" data-model="plan">
<input type="radio" name="plan" value="pro"  data-model="plan">

<select data-model="city">
  <option value="ist">Istanbul</option>
  <option value="ank">Ankara</option>
</select>

<select multiple data-model="tags">
  <option value="a">A</option>
  <option value="b">B</option>
</select>
```

- **text/textarea**: writes `el.value` on the `input` event.
- **number/range**: the value read on the `input` event is converted to
  `Number()` (stored as a number in state); if the field is empty or
  temporarily/invalidly filled (e.g. "-" while typing), the raw string is
  kept so no data is lost.
- **checkbox**: `el.checked` (boolean), `change` event.
- **radio**: a group sharing the same `data-model` path — the checked
  radio's `value` is written to state; when state changes, the radio whose
  `value` matches gets checked.
- **select**: `el.value`, `change` event.
- **select multiple**: an ARRAY of selected option `value`s, `change` event.

> The write-read cycle doesn't feed itself: an update coming from state is
> NOT written back to the DOM if it already matches the element's current
> value — this keeps the cursor position from resetting while the user is typing.

### Condition — `<if>` / `<else>`

Works with operator attributes: `is-gt`, `is-lt`, `is-gte`, `is-lte`,
`is-eq`, `is-neq`, `is-truthy`. If `data-live` is added, the block is
re-evaluated whenever the state in the condition changes.

```html
<if is-gt="commentCount" than="0" data-live>
  <p>There are <span data-text="commentCount"></span> comments.</p>
  <else>
    <p>Be the first to comment!</p>
  </else>
</if>
```

> A self-closing form like `<else/>` is **not used** — since the HTML5 parser
> doesn't treat `<else>` as a void element, it swallows all following sibling
> nodes into itself. Always write `<else>...</else>`.

> `data-live` only tracks the path on the LEFT side of the operator (above,
> `commentCount`) — the `than`/`to` value is never reactive, even if it looks
> like a path; it's always treated as static/literal.

### Visibility — `data-show`

Unlike `<if data-live>`, it never REMOVES the element from the DOM; it only
hides/shows it via CSS `display`. The element keeps living — input value,
scroll position, and CSS transition state are all preserved. This is the
right tool for modals, accordions, tabs — anything that needs to be "hidden
but still exist."

```html
<div class="modal" data-show="isModalOpen">
  <input type="text" placeholder="name">
</div>
```

The element is visible if the store path is truthy, and `display:none` if
falsy. Always reactive (`data-*` = reactive, the existing rule); anyone
wanting static/one-time hiding already writes plain CSS.

> A fixed `"block"` is NOT assigned when hiding — the element's original
> inline `display` value at setup time (e.g. `flex`, `grid`) is captured
> once; the "show" state always returns to that, so CSS's own display rule
> is never broken. If state is falsy on the first render, the element is
> already hidden before it's ever added to the DOM (no FOUC).

### Loop — `<for>`

Iterates over an array, rendering the content for each item. Static: if the
array changes later, the DOM does not update (for that, see `data-live` below).

```html
<for each="comments" as="comment">
  <p>${comment.body}</p>
</for>
```

The optional `index` attribute adds the item's (0-based) position in the
array to the context:

```html
<for each="comments" as="comment" index="i">
  <p>${i}. ${comment.body}</p>
</for>
```

### Reactive loop — `<for data-live key="...">`

With `data-live` plus a required `key`, the list is updated via a
**key-based diff** when the array changes: removed items are removed,
survivors are left in place with their DOM identity preserved (no lost
focus/scroll/input state), and new items are rendered and inserted — the
list is never re-printed from scratch.

```html
<for each="comments" as="comment" key="comment.id" data-live>
  <partial name="comment" data="comment"></partial>
</for>
```

> `key` is required — if it's missing, a warning is issued and `<for>` is
> rendered without becoming reactive (as if static). Unlike `<if data-live>`
> (tear-down/rebuild), `<for data-live>` only processes the items that
> actually changed.

### Partial — `<partial>`

Small, single-purpose template fragments. KISS principle: write once, call
anywhere. Recursive use is supported (a reply is itself a comment).

```html
<partial name="avatar" data="author"></partial>
```

> `<partial>` is not void either — don't write `<partial ... />`, always
> close it with `<partial ...></partial>`. `data` is the SINGLE context path
> passed to the partial (a raw path string; not wrapped in `${...}`) and it
> isolates the parent context — inside the partial, only the object
> resolved by `data` is visible.

#### Passing multiple props

`data` carries a single object; to pass several separate fields, every
attribute OTHER THAN `name`/`data` becomes a **prop** — its value (also a
raw path string) is resolved in the parent context and added to the partial
context (on top of `data`, if given):

```html
<partial name="like-button" action="likeAction" count="post.likeCount"></partial>
```

Inside the partial these are accessed as `${action}`, `${count}`. If `data`
is not given at all, the context consists only of the props.

> HTML attribute names are normalized to lowercase — multi-word prop names
> must be written in kebab-case (e.g. `state-class="x"` → `${state-class}`
> inside the partial, as a single-segment literal key).

### Store — reactive state

`createStore(initialState)` returns a path-based reactive state object. Only
data read FROM the store (`data-text`, `{x}`/`data-x`, `data-live`) is
watched; `${...}` coming from context is static.

```js
import { createStore, mount } from './src/index.js';

const store = createStore({ count: 0 });

store.get('count');              // → 0
store.get();                     // with no path, returns the ENTIRE state object
store.set('count', 5);           // writes, notifies subscribers, returns whether it changed (boolean)
store.update('count', (v) => v + 1); // reads the current value and applies a function to it
const unsubscribe = store.subscribe('count', (val) => console.log(val));
unsubscribe(); // cancels the subscription
```

### Mount / Unmount

`mount(templateName, context, target, store, options?)` renders a
`<template>` and places it into `target`; the returned `cleanup()` function
(or `unmount(target)`) cancels all reactive subscriptions and clears the
content. The optional 5th argument (`options.handlers`) is for event
delegation — see the "Events" section; if omitted it's ignored (backward
compatible).

```js
const cleanup = mount('page', store.get(), document.getElementById('app'), store);
// ... when the page changes or the component unmounts:
cleanup(); // or: unmount(document.getElementById('app'));
```

### Development mode — `dev_mode`

ON by default: missing/incorrect usage (an unknown operator, a missing path,
a partial that can't be found, etc.) is warned about actionably via
`console.warn`, but the page never crashes. It can be fully silenced in
production with `setDevMode(false)` — no warnings are printed while it's off.

```js
import { setDevMode, isDevMode } from './src/index.js';

setDevMode(false); // production: silent
isDevMode();        // → false
```

### Events — `data-on-*`

The EVAL-FREE counterpart of Alpine's `x-on`: the attribute value is NOT a
JS expression — it's just a name looked up in a **handler dictionary**
passed to `mount()`. No code is ever generated from a string and executed.

```html
<button data-on-click="deleteItem" data-id="42">Delete</button>
```

```js
mount('page', store.get(), document.getElementById('app'), store, {
  handlers: {
    deleteItem(event, el) {
      const id = el.dataset.id; // "42" — which item it is, read from the dataset
      store.update('items', (items) => items.filter((i) => i.id !== id));
    },
  },
});
```

Supported types: `data-on-click`, `data-on-input`, `data-on-change`,
`data-on-submit`, `data-on-keydown`. A handler always receives
`(event, element)` — the framework doesn't inject context; a handler already
has access to `store` via closure, and `data-*` + `element.dataset` is used
for item identity.

**Delegation**: a SINGLE listener is set up per event type on `target`, not
per element. This means elements added LATER inside a reactive `<for
data-live>`/`<if data-live>` need NO extra setup.

> `data-on-submit` always calls `preventDefault()` (so the page doesn't
> reload — the most common need). If `handlers` isn't given at all, the
> event system is never set up (backward compatible, zero cost).

## Project structure

```
src/        Source code (store, template, conditionals, partials, loops,
            bindings, bindings-model, bindings-show, bindings-events,
            bindings-blocks, bindings-loops, errors, utils, shared, index)
examples/   Usage examples
```

## Comparison with Alpine.js

| Alpine directive | What it does in Alpine | lime-csr equivalent |
|---|---|---|
| `x-data` | Defines component state (JS object, scope) | `createStore(initialState)` + `mount(name, context, target, store)` — different scope model: Alpine opens a new scope per element, lime-csr uses a single store + path-based context inheritance |
| `x-text` | Reactively updates text | `data-text` |
| `x-bind` | Reactively binds an attribute | `{x}`/`data-x` |
| `x-on` | Adds an event listener (`@click="fn()"`) | `data-on-*` (name-matching, NO expressions — see the "Events" section) |
| `x-show` | HIDES the DOM with `display:none` (doesn't remove) | `data-show` |
| `x-if` | Conditionally adds/removes the template from the DOM | `<if>` / `<if data-live>` |
| `x-for` | Renders a list into the DOM, reactive diff via `:key` | `<for each as>` / `<for data-live key>` |
| `x-model` | Two-way form binding | `data-model` |
| `x-transition` | Enter/leave CSS transition hooks | NONE |
| `$store` | Global shared reactive state | `createStore()` (a single instance, shareable across the app) |
| `$dispatch` | Dispatching custom events (cross-component communication) | NONE |

### Why lime-csr?

Alpine's `x-on`/`x-show`/`x-model` generally execute an arbitrary JS
expression (`x-on:click="count++"`). In lime-csr, their counterparts work
under a **no eval, no `new Function`** principle — attribute values are
always a fixed path or name, never a string of code that gets executed. This
makes the engine usable even under a strict Content-Security-Policy (no
`unsafe-eval` in `script-src`). Reactivity is also opt-in, not the default:
if an element carries no `data-*`, the engine never touches it at all.

## Status

> Early development. The API is still being settled; breaking changes may happen.

## License

MIT — see [LICENCE.md](LICENCE.md).
