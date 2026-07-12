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
  mount('counter', {}, document.getElementById('app'), store, {
    handlers: {
      increment() {
        store.update('count', (count) => count + 1);
      },
    },
  });
</script>
```

## Core Concepts

- `createStore(initialState)` exposes `get`, `set`, `update`, `subscribe`, and
  `computed` for path-based reactive state.
- `${path}` is static interpolation from the context passed to `mount`.
- `data-text`, `data-model`, `data-show`, and `{x}`/`data-x` read reactively
  from the store.
- `<if>`, `<for>`, and `<partial>` are structural template elements. Add
  `data-live` to `<if>` or keyed `<for>` blocks when the store should update
  them.
- `data-on-click`, `data-on-input`, `data-on-change`, `data-on-submit`, and
  `data-on-keydown` use event delegation and named handler functions.
- `data-lime-ignore` is an escape hatch: any element with this attribute and
  its entire subtree are invisible to the engine, useful for embedding
  third-party widgets (Turnstile, reCAPTCHA, etc.) that manage their own DOM.

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
const cleanup = mount(templateName, context, target, store, options);
unmount(target);
cleanup();
```

Calling `mount` again for the same target cleans up the previous mount first.
Both `cleanup()` and `unmount(target)` cancel store subscriptions, model
listeners, and delegated event listeners.

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
