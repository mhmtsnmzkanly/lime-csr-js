# lime-csr.js

An HTML-first client-side rendering engine built with standard browser APIs.
Templates stay in HTML; the small ESM runtime provides reactive state,
bindings, structural blocks, and delegated events without expression eval.

## Why?

lime-csr.js is for browser-first pages that benefit from declarative HTML but
do not need a compiler, virtual DOM, router, or framework runtime. Source
modules run directly in modern browsers during development; a bundled ESM
file is included for production convenience.

## Installation

```bash
npm install lime-csr-js
```

Package consumers import the public entry point:

```js
import { createStore, mount } from 'lime-csr-js';
```

The repository-only source import below is useful when cloning this project;
it is not the recommended import path from an installed npm package.

```js
import { createStore, mount } from './src/index.js';
```

## Quick Start

```html
<template id="tpl-counter">
  <button data-on-click="increment">
    Count: <span data-text="count"></span>
  </button>
</template>
<main id="app"></main>

<script type="module">
  import { createStore, mount } from 'lime-csr-js';

  const store = createStore({ count: 0 });
  mount('counter', {
    target: document.getElementById('app'),
    store,
    handlers: {
      increment() {
        store.update('count', (count) => count + 1);
      },
    },
  });
</script>
```

## Core Concepts

- `createStore(initialState)` exposes `get`, `set`, `update`, `subscribe`,
  `computed`, and `batch` for path-based reactive state.
- `${path}` is static interpolation from the context passed to `mount`.
- `data-text`, `data-model`, `data-show`, and `{x}`/`data-x` read reactively
  from the store.
- `<if>`, `<for>`, and `<partial>` are structural template elements. Add
  `data-live` to `<if>` or keyed `<for>` blocks when the store should update
  them.
- `data-on-click`, `data-on-dblclick`, `data-on-input`, `data-on-change`,
  `data-on-submit`, `data-on-keydown`, and `data-on-keyup` use event
  delegation and named handler functions. `data-on-keydown-enter`-style key
  modifiers restrict keydown/keyup handlers to a single key.
- `data-lime-ignore` is an escape hatch: any element with this attribute and
  its entire subtree are invisible to the engine, useful for embedding
  third-party widgets (Turnstile, reCAPTCHA, etc.) that manage their own DOM.

`store.batch(fn)` coalesces notifications: every `store.set()` inside the
synchronous `fn` is queued, and when `fn` returns each changed path notifies
its subscribers exactly once — so expensive subscribers (live-list
reconciles, computed chains) run once per batch instead of once per set.

```js
store.batch(() => {
  store.set('todos', nextTodos);
  store.set('filter', 'active');
}); // subscribers (and computeds depending on both) fire once, here
```

## Comparison with Alpine.js

| Alpine directive | What it does in Alpine | lime-csr equivalent |
|---|---|---|
| `x-data` | Defines component state and scope | `createStore(initialState)` + `mount(name, { target, context, store })`; Lime uses a shared store with path-based access |
| `x-text` | Reactively updates text | `data-text` |
| `x-bind` | Reactively binds an attribute | `{x}`/`data-x` |
| `x-on` | Adds an event listener and evaluates an expression | `data-on-*` using handler-name matching, never expressions |
| `x-show` | Hides the DOM without removing it | `data-show`, using the native `hidden` attribute |
| `x-if` | Conditionally adds/removes template content | `<if>` / `<if data-live>` |
| `x-for` | Renders and reactively diffs a keyed list | `<for each as>` / `<for data-live key>` |
| `x-model` | Two-way form binding | `data-model` |
| `x-ignore` | Prevents Alpine from initializing an element subtree | `data-lime-ignore`, leaving the element and its subtree untouched by Lime |
| `x-transition` | Adds enter/leave transition helpers | None |
| `$store` | Provides global shared reactive state | A shared `createStore()` instance |
| `$dispatch` | Dispatches custom events | None |

### Visibility with `data-show`

`data-show="path"` keeps its element in the DOM and manages the native
`hidden` attribute: a falsy store value adds `hidden`, and a truthy value
removes it. Lime never changes inline `style.display`; application CSS remains
responsible for the visible layout. A single scoped runtime rule,
`[data-show][hidden] { display: none !important; }`, ensures display utility
classes cannot override the hidden state:

```html
<div class="d-flex" data-show="visible">
  <input value="DOM identity and form state are preserved">
</div>
```

Unlike `<if data-live>`, `data-show` never removes or rebuilds the node, so
DOM identity, input values, listeners, subscriptions, and scroll state survive
visibility changes.

See [DOCS.md](DOCS.md) for all syntax, lifecycle semantics, error codes, and
limitations.

## Browser / CDN Usage

Development can import repository source files with a relative module path.
For production, use the bundled ESM file from the published npm package:

```html
<script type="module">
  import { createStore, mount } from
    'https://cdn.jsdelivr.net/npm/lime-csr-js@<published-version>/dist/index.min.js';
</script>
```

Replace `<published-version>` with an exact published version (for example,
the version in the release tag). Do not use `@latest` in production. The
`dist/index.min.js` path is present in the npm tarball and is browser-native
ESM; jsDelivr will serve that same file after npm publication.

## API Overview

```js
const cleanup = mount(templateName, { target, context, store, handlers, computed });
unmount(target);
cleanup();
```

The legacy positional signature
`mount(templateName, context, target, store, options)` still works but is
deprecated (one-time dev-mode notice). Calling `mount` again for the same
target cleans up the previous mount first. Both `cleanup()` and
`unmount(target)` cancel store subscriptions, model listeners, delegated
event listeners, and dispose any `computed` entries registered by the mount.

### Structured diagnostics

`subscribeDiagnostics(listener)` observes structured, non-throwing Lime
diagnostics in both production and development. `setDevMode(false)` disables
only Lime's own `console.warn` and visual overlay; subscribers still receive
`{ code, message, context }`. Applications may map selected codes to their own
loading or error UI without treating every diagnostic as fatal. Unsubscribe
when the listener is no longer needed.

```js
import {
  mount,
  setDevMode,
  subscribeDiagnostics,
} from 'lime-csr-js';

setDevMode(false);

const unsubscribe = subscribeDiagnostics(({ code, message }) => {
  if (code === 'MOUNT_TEMPLATE_NOT_FOUND') {
    showApplicationStartupError(code, message);
  }
});

const cleanup = mount('app', {}, target, store);

// Later:
unsubscribe();
cleanup();
```

## Examples

Open the HTML files in [examples](examples/) through a local static server.
They import `../src/index.js` and are intended for repository development.

## Runtime Support

Modern browsers with native ES modules, `<template>`, `WeakMap`, `Map`, and
standard DOM APIs are required. The npm development toolchain requires Node
20.19 or newer.

## Security

Template paths and event attributes are identifiers, not JavaScript
expressions: the runtime does not use `eval` or `new Function`. Interpolated
text is assigned through DOM text APIs, reactive event-handler attributes are
rejected, and reactive URL attributes permit only `http`, `https`,
root-relative, or fragment URLs. Templates remain application-authored HTML;
do not insert untrusted HTML into template markup.

## Known Limitations

`<if>`, `<for>`, and `<partial>` should not be placed directly in tables due
to HTML parser foster parenting. Live condition branches are rebuilt when the
condition changes, and live lists require unique keys. See the detailed
limitations in [DOCS.md](DOCS.md#8-known-limitations).

## Technical Documentation

[DOCS.md](DOCS.md) is the complete public reference. Documentation and
implementation are expected to agree; report a mismatch as a bug.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

`npm run build` creates the production ESM bundle. `prepack` runs that build,
so `npm pack` and `npm publish` cannot package a stale bundle.

## License

MIT — see [LICENCE.md](LICENCE.md).
