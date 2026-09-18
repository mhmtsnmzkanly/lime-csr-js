# lime-csr-js

An HTML-first, eval-free client-side rendering (CSR) engine built with standard browser APIs. Templates stay in declarative HTML `<template>` elements; an unprivileged Micro-Kernel orchestrates built-in template composition and discrete extensible modules for conditionals, loops, text, visibility, two-way form bindings, and delegated events.

Zero compilation. Zero virtual DOM. Zero `eval` or `new Function`. Strict Content Security Policy (CSP) compatible out of the box.

---

## Features

- **HTML-First Templates**: Author templates in native `<template>` tags. No JSX, no compiler, no build step required during development.
- **Unprivileged Micro-Kernel**: The kernel provides generic triggers, routing, prototypal scope, and lifecycle management without any hardcoded feature semantics.
- **Built-in Composition**: Core `<partial>` and `<slot>` composition with isolated template scope, caller lexical scope projection, and fallback resolution.
- **Extensible Standard Modules**: Conditionals, loops, text, show, model, and events are discrete unprivileged modules that can be overridden or omitted, with `partials()` provided as a modular wrapper for the built-in composition capability.
- **Extensible Module API**: Create custom domain directives using `defineModule()` and compose custom runtimes using `createEngine()`.
- **Path-Based Reactive Store**: Fine-grained reactive state with prefix-tree indexing, batch updates, computed properties, and prototype-pollution guards.
- **Keyed DOM Reconciliation**: Reactive `<for data-live>` loops support Longest Increasing Subsequence (LCS) diffing, preserving DOM identity and focus state.
- **Strict CSP / Eval-Free**: Operates with `Content-Security-Policy: script-src 'self'`. All paths and handler names are identifier lookups, never evaluated JavaScript expressions.
- **Lightweight Production Bundle**: 47.0 kB minified ESM bundle (`dist/index.min.js`) with on-demand development diagnostics.

---

## Installation

```bash
npm install lime-csr-js
```

### Subpath Exports

`lime-csr-js@0.4.3` provides clean, dedicated subpaths:

```js
// 1. Root package (Facade, Store, Diagnostics, Standard Modules)
import { mount, unmount, render, createStore, defineModule, createEngine } from 'lime-csr-js';

// 2. Kernel primitives only (alternative direct subpath import)
// import { createEngine, defineModule, attr, attrs, tag, pattern, createScope } from 'lime-csr-js/core';

// 3. All standard modules
import { partials, conditionals, loops, text, show, model, events } from 'lime-csr-js/modules';

// 4. Granular single-module imports (for custom tree-shaken engines)
// import show from 'lime-csr-js/modules/show';
// import text from 'lime-csr-js/modules/text';

// 5. Minified browser bundle
import 'lime-csr-js/dist/index.min.js';
```

### Browser / CDN Usage

Zero build tools or installation required. Lime can be loaded directly from jsDelivr's GitHub CDN in any modern browser via native `<script type="module">`.

#### Option A: Full Bundle (Default Engine + All 7 Modules)
If you want the complete framework with all directives pre-registered:

```html
<script type="module">
  import { createStore, mount } from 'https://cdn.jsdelivr.net/gh/mhmtsnmzkanly/lime-csr-js@v0.4.3/dist/index.min.js';
</script>
```

#### Option B: Modular Core + Discrete Modules (Cherry-Pick via CDN)
If you only need specific directives (e.g. only text and events for a tiny widget), you can load the lightweight Micro-Kernel and only the individual module files you need:

```html
<script type="module">
  import { createEngine } from 'https://cdn.jsdelivr.net/gh/mhmtsnmzkanly/lime-csr-js@v0.4.3/dist/core.min.js';
  import { createStore } from 'https://cdn.jsdelivr.net/gh/mhmtsnmzkanly/lime-csr-js@v0.4.3/dist/store.min.js';
  import text from 'https://cdn.jsdelivr.net/gh/mhmtsnmzkanly/lime-csr-js@v0.4.3/dist/modules/text.min.js';
  import events from 'https://cdn.jsdelivr.net/gh/mhmtsnmzkanly/lime-csr-js@v0.4.3/dist/modules/events.min.js';

  // Assemble a bespoke engine with only the modules you need
  const engine = createEngine({
    modules: [text(), events()]
  });

  const store = createStore({ count: 0 });
  engine.mount({
    target: document.getElementById('app'),
    template: 'counter',
    store,
    handlers: {
      increment: () => store.update('count', (n) => n + 1),
    }
  });
</script>
```

#### Available CDN Distribution Files

| Distribution File | Description | Typical Size |
|---|---|---|
| `dist/index.min.js` | **Full bundle**: Micro-Kernel, Store, Router, and all 7 standard modules | ~47.0 kB |
| `dist/core.min.js` | **Micro-Kernel runtime**: `createEngine`, `defineModule`, triggers, scope | ~28.7 kB |
| `dist/store.min.js` | **Reactive Store**: `createStore`, `getByPath`, `setByPath` | ~6.5 kB |
| `dist/router.min.js` | **Compiled Trigger Router**: `createRouter` | ~6.2 kB |
| `dist/modules/index.min.js` | **All Standard Modules** in one package | ~28.0 kB |
| `dist/modules/text.min.js` | `data-text` & `{attr}` template reactive bindings | ~3.5 kB |
| `dist/modules/show.min.js` | `data-show` reactive visibility toggle | ~1.6 kB |
| `dist/modules/events.min.js` | `data-on-{event}` delegated event dispatching | ~5.8 kB |
| `dist/modules/model.min.js` | `data-model` two-way form input binding | ~2.5 kB |
| `dist/modules/conditionals.min.js` | `<if>`, `<else>`, static/live condition evaluation | ~10.8 kB |
| `dist/modules/loops.min.js` | `<for>`, keyed list diffing, prototypal item scopes | ~13.1 kB |
| `dist/modules/partials.min.js` | Modular wrapper for built-in `<partial>` & `<slot>` composition | ~10.5 kB |

---

## Quick Start (5 Minutes)

Create an HTML file with a `<template>` and mount it using native ES modules:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Lime Counter</title>
</head>
<body>
  <!-- 1. Declarative HTML Template -->
  <template id="tpl-counter">
    <div class="counter-card">
      <h2>Counter: <span data-text="count"></span></h2>
      <button data-on-click="increment">+1</button>
      <button data-on-click="decrement">-1</button>
      <p data-show="isPositive">Great! The count is positive.</p>
    </div>
  </template>

  <!-- 2. Mount Target Container -->
  <main id="app"></main>

  <!-- 3. Reactive Logic -->
  <script type="module">
    import { createStore, mount } from 'lime-csr-js';

    // Initialize reactive store
    const store = createStore({ count: 0, isPositive: false });

    // Computed property: updates automatically when count changes
    store.computed('isPositive', ['count'], (count) => count > 0);

    // Mount template into target (CSS selector or DOM Element)
    const instance = mount({
      target: '#app',
      template: 'counter',
      store,
      handlers: {
        increment() {
          store.update('count', (c) => c + 1);
        },
        decrement() {
          store.update('count', (c) => c - 1);
        },
      },
    });

    // To unmount and clear content later:
    // unmount(instance); // or unmount('#app');
  </script>
</body>
</html>
```

---

## Reactive Store

The store provides path-based reactive state with upward and downward change notification:

```js
import { createStore } from 'lime-csr-js';

const store = createStore({
  user: {
    profile: { name: 'Alice', age: 30 },
  },
  todos: [
    { id: 1, title: 'Learn Kernel Architecture', done: true },
    { id: 2, title: 'Write Custom Module', done: false },
  ],
});

// Read state via dotted path
console.log(store.get('user.profile.name')); // "Alice"

// Subscribe to path changes
const unsubscribe = store.subscribe('user.profile.name', (newVal, oldVal) => {
  console.log(`Name changed from ${oldVal} to ${newVal}`);
});

// Write state (triggers subscribers)
store.set('user.profile.name', 'Bob');

// Batch updates: coalesces notifications into a single flush wave
store.batch(() => {
  store.set('user.profile.name', 'Charlie');
  store.set('user.profile.age', 31);
}); // Subscribers fire once here

// Unsubscribe
unsubscribe();
```

## Diagnostics

Diagnostics can be observed globally or per mount:

```js
const instance = mount({
  target: '#app',
  template: 'dashboard',
  store,
  onError(diagnostic) {
    monitoring.captureException(diagnostic.details.error, {
      tags: { code: diagnostic.code, category: diagnostic.category },
    });
  },
});
```

Every diagnostic includes `code`, `message`, `context`, `severity`, `category`, `details`, `timestamp`, and `count`. `onDiagnostic` receives warnings and errors for its mount target; `onError` receives only errors. Equivalent repeated diagnostics within one second are aggregated into the first event by incrementing `count`.

---

## Custom Modules

Lime's single extension mechanism is the **Module**. A module specifies trigger hooks that run in either the **Transform phase** (structural compilation) or the **Link phase** (behavioral attachment):

```js
import { defineModule, attr } from 'lime-csr-js';

// Define a custom tooltip module
export const tooltipModule = defineModule({
  name: 'tooltip',
  triggers: [
    attr('data-tooltip', {
      phase: 'link',

      // 1. Pure read step: extracts configuration once during link setup
      read(el, ctx) {
        return { text: el.getAttribute('data-tooltip') };
      },

      // 2. Setup step: binds listeners or watches store
      setup(el, data, ctx) {
        if (!data || !data.text) return;

        const showTooltip = () => {
          el.setAttribute('title', data.text);
        };
        el.addEventListener('mouseenter', showTooltip);

        // Register teardown on the unified LIFO cleanup stack
        ctx.onCleanup(() => {
          el.removeEventListener('mouseenter', showTooltip);
        });
      },
    }),
  ],
});
```

---

## Custom Engines

The default `mount()` and `render()` functions use a built-in engine with all 7 standard modules. You can build a customized, isolated runtime using `createEngine()`:

```js
import { createEngine, createStore } from 'lime-csr-js';
import { text, show, events } from 'lime-csr-js/modules';
import { tooltipModule } from './tooltip-module.js';

// Compose an engine with explicit module precedence:
// Earlier modules take precedence over later modules for conflicting triggers.
const engine = createEngine({
  modules: [
    tooltipModule, // Custom module runs first
    text(),
    show(),
    events(),
  ],
});

// Mount with custom engine
const store = createStore({ message: 'Hello World' });
const instance = engine.mount({
  target: document.getElementById('app'),
  template: 'my-template',
  store,
});
```

### Multiple Engines and Target Ownership

Engines are isolated and may run independently on separate target elements. A target element has one active mount owner across all engines: mounting another engine to the same target automatically unmounts the previous runtime before the replacement starts. This keeps DOM updates, reactive subscriptions, and delegated event listeners owned by one runtime at a time.

---

## The 7 Standard Modules
 
| Module | Phase | Triggers | Description |
|---|---|---|---|
| [partials](DOCS.md#131-partials-module-partials) | Transform | `<partial name="..." data="...">` | Modular wrapper for built-in template composition with isolated scopes, named/default `<slot>` projection, fallback content, and caller scope preservation. |
| [conditionals](DOCS.md#132-conditionals-module-conditionals) | Transform + Link | `<if>`, `<template data-if>`, `<else>` | Evaluates comparison operators (`is-gt`, `is-lt`, `is-gte`, `is-lte`, `is-eq`, `is-neq`, `is-truthy`). `data-live` provides reactive updates. |
| [loops](DOCS.md#133-loops-module-loops) | Transform + Link | `<for each as>`, `<template data-for>` | Renders array items with prototypal child scopes. `data-live key="..."` provides keyed LCS reconciliation. |
| [text](DOCS.md#134-text--attribute-bindings-module-text) | Link | `data-text="path"`, `{x}` attribute templates | Reactively binds store values to `textContent` and attribute values with URL sanitization. |
| [show](DOCS.md#135-visibility-module-show) | Link | `data-show="path"` | Toggles element visibility via the native `hidden` attribute without altering inline styles. |
| [model](DOCS.md#136-two-way-form-binding-module-model) | Link | `data-model="path"` | Two-way binding for inputs (text, number, checkbox, radio, select) with cursor preservation. |
| [events](DOCS.md#137-event-delegation-module-events) | Link | `data-on-{event}="handler"`, `data-on-*-data` | Delegated event dispatch with single object payload `{ event, element, scope, store, data }`, companion data attributes, and prototype protection. |

---

## Architecture: Micro-Kernel & Lifecycle

Lime enforces a strict separation of concerns:
- **Kernel = Mechanism**: Implements generic trigger matching, route compilation, deterministic precedence, prototypal scope inheritance, unified LIFO cleanup stack, and diagnostic dispatch. The kernel has zero knowledge of `if`, `for`, or any specific attribute names.
- **Module = Behavior**: All syntax and rendering semantics are encapsulated in discrete module definitions.

```text
HTML Template
      ↓
Phase 1: Transform (Fixed-Point Loop)
  - Partials expansion (<partial>)
  - Loop unrolling (<for>)
  - Conditional branching (<if>/<else>)
  - Static ${path} interpolation
      ↓
Phase 2: Link (Single-Pass Traversal)
  - Two-way form binding (data-model)
  - Reactive text & attributes (data-text, {x})
  - Visibility toggling (data-show)
  - Live conditionals & live loops reactive setup
  - Delegated event listeners (data-on-*)
      ↓
Connected DOM with LIFO Cleanup Stack
```

---

## Security Guarantees

1. **No Expression Evaluation**: Lime never uses `eval()`, `new Function()`, or dynamic code generation.
2. **CSP Compatibility**: Fully compliant with strict `script-src 'self'` policies.
3. **Prototype Pollution Guard**: `store.set()` and `getByPath()` reject `__proto__`, `constructor`, and `prototype` path segments.
4. **URL Protocol Sanitizer**: `href`, `src`, `action`, and other URL attributes only accept `http:`, `https:`, root-relative (`/`), or anchor (`#`) values. Dangerous schemes (`javascript:`, `data:`, `vbscript:`) are neutralized.
5. **DOM API Safety**: Text is assigned via `textContent`, avoiding raw HTML interpretation.

---

## Migration from v0.2.x to v0.3.0

- **Plugin API Removed**: The legacy `definePlugin()` and `PLUGIN_API_VERSION` are removed. Use `defineModule()` and `createEngine()`.
- **Monolithic Helpers Removed**: Internal renderer functions (`setupBindings`, `expandLoops`, `processAllIfs`, etc.) are no longer exposed on the root package. Use the standard modules or facade `render()`/`mount()`.
- **Root Public Exports Cleaned**: Root package exports exactly 34 clean symbols (Facade, Store, Diagnostics, Kernel Primitives, and Standard Modules).

For full migration instructions and before/after code examples, see [DOCS.md: Migration Guide](DOCS.md#21-migration-guide).

---

## Documentation Links

- **[DOCS.md](DOCS.md)**: Comprehensive technical reference manual covering architecture, triggers, lifecycle, store, scope, standard modules, error codes, and troubleshooting.
- **[llms.txt](llms.txt)**: Compact, high-density reference optimized for LLM prompting and context windows.
- **[llms-full.txt](llms-full.txt)**: Exhaustive machine-readable reference containing the complete public API and implementation semantics.
- **[CHANGELOG.md](CHANGELOG.md)**: Version release notes and breaking changes log.

---

## License

MIT License — see [LICENCE.md](LICENCE.md).
