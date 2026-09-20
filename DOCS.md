# lime-csr-js — Technical Reference Manual

Version: **0.6.0**
Architecture: **Unprivileged Micro-Kernel + Discrete Modules**  
Status: **Production Release**

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
   - [2.1 Micro-Kernel Philosophy](#21-micro-kernel-philosophy)
   - [2.2 Execution Pipeline: Transform vs Link](#22-execution-pipeline-transform-vs-link)
   - [2.3 Precedence vs Execution Order](#23-precedence-vs-execution-order)
3. [Installation & Subpath Exports](#3-installation--subpath-exports)
4. [Quick Start](#4-quick-start)
5. [Public API Reference](#5-public-api-reference)
   - [5.1 Facade API](#51-facade-api)
   - [5.2 Store & Utility API](#52-store--utility-api)
   - [5.3 Diagnostics API](#53-diagnostics-api)
   - [5.4 Kernel Primitives](#54-kernel-primitives)
   - [5.5 Standard Modules](#55-standard-modules)
6. [Engine Runtime (`createEngine`)](#6-engine-runtime-createengine)
   - [6.1 Engine Configuration & Immutability](#61-engine-configuration--immutability)
   - [6.2 Engine Instance Isolation](#62-engine-instance-isolation)
   - [6.3 Custom Engine Composition](#63-custom-engine-composition)
7. [Module Authoring Guide (`defineModule`)](#7-module-authoring-guide-definemodule)
   - [7.1 Module Contract](#71-module-contract)
   - [7.2 Step-by-Step Custom Module Example](#72-step-by-step-custom-module-example)
   - [7.3 Module Authoring Rules & Invariants](#73-module-authoring-rules--invariants)
8. [Trigger API](#8-trigger-api)
   - [8.1 `attr(name, hooks)`](#81-attrname-hooks)
   - [8.2 `attrs(options, hooks)`](#82-attrsoptions-hooks)
   - [8.3 `tag(tagName, hooks)`](#83-tagtagname-hooks)
   - [8.4 `pattern(prefixOrRegex, hooks)`](#84-patternprefixorregex-hooks)
   - [8.5 Matching Semantics](#85-matching-semantics)
9. [Module Lifecycle](#9-module-lifecycle)
   - [9.1 Lifecycle Sequence](#91-lifecycle-sequence)
   - [9.2 Hook Specifications (`match`, `read`, `setup`, `update`, `cleanup`)](#92-hook-specifications)
   - [9.3 Unified LIFO Cleanup Stack](#93-unified-lifo-cleanup-stack)
10. [ModuleContext (`ctx`)](#10-modulecontext-ctx)
11. [Scope System](#11-scope-system)
    - [11.1 Prototypal Inheritance & Shadowing](#111-prototypal-inheritance--shadowing)
    - [11.2 Scope vs Store](#112-scope-vs-store)
    - [11.3 Isolated Scope for Partials](#113-isolated-scope-for-partials)
12. [Reactive Store](#12-reactive-store)
    - [12.1 Path-Based Reactivity](#121-path-based-reactivity)
    - [12.2 Store API Reference](#122-store-api-reference)
    - [12.3 Computed Properties](#123-computed-properties)
    - [12.4 Batch Updates](#124-batch-updates)
    - [12.5 Prototype Pollution Prevention](#125-prototype-pollution-prevention)
13. [Standard Modules Reference](#13-standard-modules-reference)
    - [13.1 Partials Module (`partials`)](#131-partials-module-partials)
    - [13.2 Conditionals Module (`conditionals`)](#132-conditionals-module-conditionals)
    - [13.3 Loops Module (`loops`)](#133-loops-module-loops)
    - [13.4 Text & Attribute Bindings Module (`text`)](#134-text--attribute-bindings-module-text)
    - [13.5 Visibility Module (`show`)](#135-visibility-module-show)
    - [13.6 Two-Way Form Binding Module (`model`)](#136-two-way-form-binding-module-model)
    - [13.7 Event Delegation Module (`events`)](#137-event-delegation-module-events)
    - [13.8 DOM Element Reference Module (`ref`)](#138-dom-element-reference-module-ref)
14. [Security Model](#14-security-model)
15. [Diagnostics & Complete Error Catalog](#15-diagnostics--complete-error-catalog)
16. [Migration Guide (v0.2.x → v0.3.0)](#16-migration-guide-v02x--v030)
17. [Troubleshooting & FAQ](#17-troubleshooting--faq)

---

## 1. Overview

`lime-csr-js` is an eval-free, client-side rendering engine designed for browser-first web applications under strict Content Security Policies.

Unlike conventional JavaScript frameworks that rely on compilers, synthetic virtual DOM trees, or runtime expression parsers, `lime-csr-js` embraces standard browser APIs:
- Templates are native HTML `<template>` elements.
- State is managed through a lightweight, path-based reactive store.
- Bindings are identifier lookups, never arbitrary JavaScript expressions.
- The engine uses an **unprivileged Micro-Kernel** where all features (loops, conditionals, forms, events, text) exist as standard unprivileged modules.

---

## 2. Architecture

### 2.1 Micro-Kernel Philosophy

Lime adheres to a strict three-tier architectural separation:

$$\text{Kernel} = \text{Mechanism} \quad\Big|\quad \text{Built-in Composition} = \text{Partial + Slot} \quad\Big|\quad \text{Modules} = \text{Behavior} \quad\Big|\quad \text{Mount} = \text{Runtime Boundary}$$

```text
                 Mount
            runtime boundary
                   │
                   ▼
             Micro-Kernel
              mechanism
                   │
       ┌───────────┴───────────┐
       │                       │
 Built-in Composition     Extensible Modules
       │                       │
 ┌─────┴─────┐          ┌──────┴────────┐
 │           │          │               │
Partial     Slot     Standard         Custom
                      Modules         Modules
```

- **Micro-Kernel (Mechanism):**
  - Route compilation and trigger indexing (`createRouter`).
  - Precedence evaluation and conflict resolution.
  - Prototypal lexical scope hierarchy (`createScope`, `createIsolatedScope`).
  - Lifecycle dispatch (`match` $\to$ `read` $\to$ `setup` $\to$ `update` $\to$ `cleanup`).
  - Unified LIFO cleanup stacks and fault isolation (`createCleanupStack`).
  - Centralized diagnostic reporting (`reportError`, `warn`).
  - *The Kernel contains zero feature-specific directive logic.*

- **Built-in Composition (Partial + Slot):**
  - Core template composition capability built into the engine runtime (`src/core/composition.js`).
  - `<partial name="..." data="..." [props...]>` instantiates sub-templates with isolated lexical scopes while sharing the mount store.
  - Named and default `<slot>` projection maps caller children into templates while strictly preserving caller lexical scope.
  - Also exported via `partials()` for CDN modularity and custom engine pipelines.

- **Extensible Modules (Behavior):**
  - Behavioral features are implemented as discrete modules via `defineModule()`: `conditionals`, `loops`, `text`, `show`, `model`, and `events`.
  - Modules register declarative triggers using `attr`, `attrs`, `tag`, or `pattern`.
  - Standard modules have no special privileges or private APIs; third-party custom modules possess the exact same capabilities.

### 2.2 Execution Pipeline: Transform vs Link

Rendering executes in two deterministic, non-overlapping phases:

```text
                  Incoming Fragment / Element
                              │
                              ▼
        ┌───────────────────────────────────────────┐
        │        PHASE 1: TRANSFORM PHASE           │
        │        (Fixed-Point Macro Expansion)      │
        ├───────────────────────────────────────────┤
        │ • Structural DOM mutations allowed        │
        │ • Elements expanded, cloned, or replaced   │
        │ • Loop until DOM stabilizes (max 100 iter)│
        │ • Modules: partials, conditionals, loops  │
        │ • resolveStatic (${path} interpolation)   │
        └───────────────────────────────────────────┘
                              │
                              ▼
                  Stable DOM / Anchored Nodes
                              │
                              ▼
        ┌───────────────────────────────────────────┐
        │           PHASE 2: LINK PHASE             │
        │        (Single-Pass Traversal)            │
        ├───────────────────────────────────────────┤
        │ • Zero structural mutations allowed       │
        │ • Tree topology is strictly frozen        │
        │ • Reactive watchers and listeners bound   │
        │ • Modules: model, text, show, events,     │
        │   live conditionals, live loops           │
        └───────────────────────────────────────────┘
                              │
                              ▼
                  Fully Connected Component
```

1. **Transform Phase (Phase 1):**
   - Structural compilation.
   - Elements may be created, cloned, moved, or deleted.
   - Runs in a fixed-point loop (`MAX_PIPELINE_ITERATIONS = 100` guard against circular macros).
   - Generates comment anchors for dynamic reactive blocks (`<!-- lif1 -->`, `<!-- lf1 -->`).

2. **Link Phase (Phase 2):**
   - Behavioral attachment.
   - The DOM structure is immutable during this phase. Elements are visited once in a single tree walk.
   - Modules attach reactive store watches (`ctx.watch`), DOM event listeners, and two-way form bindings.

### 2.3 Precedence vs Execution Order

Lime strictly distinguishes between **Module Precedence** and **DOM Execution Order**:

- **Module Precedence:**
  - Determined at engine creation by module registration array order: `modules[0] > modules[1] > ... > modules[N]`.
  - When two modules claim conflicting routes on the same element, the earlier module wins. The losing route is shadowed, and `MODULE_TRIGGER_OVERRIDDEN` is emitted in development mode.
  - In Phase 1 (Transform), a structural module that replaces or expands an element performs a terminal stop for that element in the current pass.

- **DOM Execution Order:**
  - During the Link phase on a single element, triggers execute in strict document order:
    1. Tag trigger (if matched).
    2. Attribute triggers in the exact order attributes are declared on the HTML element.
  - Multi-attribute triggers (`attrs`) are anchored to the position of their first required attribute.

---

## 3. Installation & Subpath Exports

Install via npm:

```bash
npm install lime-csr-js
```

### Package Entry Points

```json
{
  "exports": {
    ".": "./src/index.js",
    "./core": "./src/core/index.js",
    "./modules": "./src/modules/index.js",
    "./modules/*": "./src/modules/*.js",
    "./dist": "./dist/index.min.js",
    "./dist/*": "./dist/*"
  }
}
```

- **`lime-csr-js`**: Default entry point providing the public Facade (`mount`, `unmount`, `render`), Store (`createStore`, `getByPath`, `setByPath`), Diagnostics, Kernel primitives, and the 7 standard modules.
- **`lime-csr-js/core`**: Unprivileged Micro-Kernel primitives (`createEngine`, `defineModule`, `attr`, `attrs`, `tag`, `pattern`, `createScope`).
- **`lime-csr-js/modules`**: The 7 standard unprivileged modules (`partials`, `conditionals`, `loops`, `text`, `show`, `model`, `events`).
- **`lime-csr-js/modules/<name>`**: Granular single-module import (e.g. `lime-csr-js/modules/text`).
- **`lime-csr-js/dist`**: Production pre-bundled, minified ESM bundle (`43.1 kB`).
- **`lime-csr-js/dist/*`**: Direct access to discrete sub-bundles (`core.min.js`, `store.min.js`, `router.min.js`, `modules/*.min.js`).

### Browser / CDN Usage

Lime works 100% out of the box in standard web browsers with zero installation and zero build steps via modern CDNs (jsDelivr or unpkg).

#### 1. Full Monolithic Bundle
Use `dist/index.min.js` to get the complete framework with all 7 standard modules pre-configured on the default engine:

```html
<script type="module">
  // Via jsDelivr:
  import { createStore, mount } from 'https://cdn.jsdelivr.net/gh/mhmtsnmzkanly/lime-csr-js@v0.6.0/dist/index.min.js';

  // Or via unpkg:
</script>
```

#### 2. Modular Micro-Kernel + Discrete Modules (Cherry-Pick via CDN)
If your application only needs a subset of features (e.g., only reactive text bindings and event delegation), you can avoid downloading unused directives by combining `dist/core.min.js` and individual discrete module bundles:

```html
<script type="module">
  import { createEngine } from 'https://cdn.jsdelivr.net/gh/mhmtsnmzkanly/lime-csr-js@v0.6.0/dist/core.min.js';
  import { createStore } from 'https://cdn.jsdelivr.net/gh/mhmtsnmzkanly/lime-csr-js@v0.6.0/dist/store.min.js';
  import text from 'https://cdn.jsdelivr.net/gh/mhmtsnmzkanly/lime-csr-js@v0.6.0/dist/modules/text.min.js';
  import events from 'https://cdn.jsdelivr.net/gh/mhmtsnmzkanly/lime-csr-js@v0.6.0/dist/modules/events.min.js';

  // Create an engine configured strictly with text and events
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

#### CDN Distribution Manifest

| CDN Path | Purpose | Size |
|---|---|---|
| `dist/index.min.js` | Complete bundle: default engine, store, router, diagnostics, all 7 modules | ~47.0 kB |
| `dist/core.min.js` | Micro-Kernel runtime: `createEngine`, `defineModule`, triggers, scope | ~28.7 kB |
| `dist/store.min.js` | Standalone reactive store: `createStore`, `getByPath`, `setByPath` | ~6.5 kB |
| `dist/router.min.js` | Standalone trigger router: `createRouter` | ~6.2 kB |
| `dist/modules/index.min.js` | All 8 standard modules bundled together | ~32.0 kB |
| `dist/modules/text.min.js` | `data-text` & `{attr}` template reactive bindings | ~3.8 kB |
| `dist/modules/show.min.js` | `data-show` reactive visibility toggle | ~2.1 kB |
| `dist/modules/events.min.js` | `data-on-{event}` delegated event dispatching | ~6.2 kB |
| `dist/modules/model.min.js` | `data-model` two-way form input binding | ~2.6 kB |
| `dist/modules/conditionals.min.js` | `<if>`, `<else>`, static/live condition evaluation | ~14.0 kB |
| `dist/modules/loops.min.js` | `<for>`, keyed list diffing, prototypal item scopes | ~17.0 kB |
| `dist/modules/partials.min.js` | Modular wrapper for built-in `<partial>` & `<slot>` composition | ~13.0 kB |
| `dist/modules/ref.min.js` | `data-ref` element and element collection references | ~1.5 kB |
| `dist/errors-messages.js` | Detailed development diagnostics (loaded on-demand) | ~7.2 kB |

---

## 4. Quick Start

Below is a complete, standalone example with zero build tools required:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Lime Quick Start</title>
</head>
<body>
  <!-- Declarative Template -->
  <template id="tpl-todo-app">
    <div class="todo-app">
      <h1>${appName}</h1>

      <form data-on-submit="addTodo">
        <input type="text" data-model="newTodoText" placeholder="What needs doing?">
        <button type="submit">Add</button>
      </form>

      <ul class="todo-list">
        <for each="todos" as="todo" key="todo.id" data-live>
          <li>
            <input type="checkbox" data-model="todo.done">
            <span data-text="todo.title"></span>
            <button data-on-click="deleteTodo">×</button>
          </li>
        </for>
      </ul>

      <p data-show="hasCompleted">
        Completed tasks exist!
      </p>
    </div>
  </template>

  <!-- Mount Target -->
  <main id="app"></main>

  <script type="module">
    import { createStore, mount } from 'lime-csr-js';

    const store = createStore({
      newTodoText: '',
      todos: [
        { id: 1, title: 'Explore Kernel Architecture', done: true },
        { id: 2, title: 'Build CSR App', done: false },
      ],
      hasCompleted: true,
    });

    // Recompute hasCompleted when todos change
    store.computed('hasCompleted', ['todos'], (todos) =>
      todos.some((t) => t.done)
    );

    mount({
      target: '#app',
      template: 'todo-app',
      store,
      context: { appName: 'My Reactive Tasks' },
      handlers: {
        addTodo(event, el, ctx) {
          const text = store.get('newTodoText')?.trim();
          if (!text) return;
          store.update('todos', (list) => [
            ...list,
            { id: Date.now(), title: text, done: false },
          ]);
          store.set('newTodoText', '');
        },
        deleteTodo(event, el, ctx) {
          const id = ctx.scope.todo.id;
          store.update('todos', (list) => list.filter((t) => t.id !== id));
        },
      },
    });
  </script>
</body>
</html>
```

---

## 5. Public API Reference

The root package exports **exactly 34 clean public symbols**:

### 5.1 Facade API

```js
import { mount, unmount, render } from 'lime-csr-js';
```

- **`mount({ target, template?, templateName?, store?, ...options })`**:
  Mounts a template or DOM element into a target container. Delegates to the private singleton `defaultEngine`.
  - Signature:
    ```js
    const instance = mount({ target, template, store, handlers, ...options });
    ```
  - **`target`**: CSS selector string (e.g. `'#app'`) matching exactly one element, or a DOM `Element` (connected or detached).
  - **`template`**: Template name string (resolving `<template id="tpl-{name}">`), HTML string, `HTMLTemplateElement`, or `DocumentFragment`. Can be omitted for in-place mounting.
  - **`store`**: Reactive `Store` instance. If omitted, `null`, or `undefined`, an isolated mount-local store is automatically created.
  - **`options`**:
    - `handlers`: Mount-scoped, prototype-safe event handler dictionary (`Object.hasOwn`).
    - `signal`: `AbortSignal` connecting lifecycle deactivation and cleanup to abort.
    - `context`: Lexical interpolation context for static template tokens (`${key}`).
    - `computed`: Object dictionary of computed paths `{ deps, fn }`.
    - `beforeRender(scope, store)`: Lifecycle hook before Transform/Link phases.
    - `afterRender(target, store)`: Lifecycle hook after template placement.
    - `onDiagnostic(diagnostic)`: Receives structured diagnostics belonging to this mount target or its descendants. Removed automatically on cleanup.
    - `onError(diagnostic)`: Like `onDiagnostic`, but receives only diagnostics whose `severity` is `'error'`.
    - `document`: DOM document context (defaults to target ownerDocument or global).
    - `templateName`: Alias for `template`.
  - **Returns a Mount Instance**:
    - `instance()`: Disposes subscriptions and cleans up runtime (clears Lime-created template content; leaves in-place caller DOM intact).
    - `instance.unmount()`: Cleans up runtime and subscriptions. For template mounts (Lime-created content), clears content (`target.textContent = ''`). For in-place mounts (caller-provided existing DOM), preserves caller DOM intact. Never calls `target.remove()`.
    - `instance.cleanup()`: Disposes reactive bindings and event listeners while keeping DOM content intact.
    - `instance.target`: Target DOM Element.
    - `instance.store`: Bound Store instance.
    - `instance.scope`: Root lexical scope.
    - `instance.refs`: Element references map collected via `data-ref`.
    - `instance.active`: Boolean indicating if mount runtime is currently active.
  - **Target ownership**: A target has one active mount owner across all `Engine` instances. Mounting to an occupied target automatically unmounts the prior owner before the new runtime takes control.

- **`unmount(targetOrInstance)`**:
  ```js
  unmount(instance); // Or unmount('#app') / unmount(targetElement);
  ```
  Cancels all reactive store subscriptions and disposes event delegation. Clears Lime-created content for template mounts; preserves caller-provided DOM for in-place mounts. Lime CSR never calls `target.remove()`.

- **`render(nodeOrFragment, options)`**:
  Compiles an arbitrary DOM fragment or element in-place without mounting into a container.
  ```js
  const result = render(fragment, { store, context, handlers, document });
  // result is a callable cleanup function with attached metadata:
  // result.refs, result.element, result.scope, result.store, result.cleanup()
  ```

### 5.2 Store & Utility API

```js
import { createStore, getByPath, setByPath, getTemplate, resolveStatic, renderTemplate, escapeHtml, safeAttr, safeUrl, safeStyleUrl } from 'lime-csr-js';
```

- **`createStore(initialState)`**: Returns a reactive `Store` instance.
- **`getByPath(source, path)`**: Safely reads nested object properties via dot-path (`"user.profile.name"`). Protects against prototype pollution.
- **`setByPath(source, path, value)`**: Writes nested object properties with prototype-pollution guards. Returns `{ changed: boolean, previousValue: * }`.
- **`getTemplate(name)`**: Retrieves and clones `<template id="tpl-{name}">` from the current document cache.
- **`resolveStatic(fragment, context, store?)`**: Resolves static `${path}` placeholders in text nodes and attributes.
- **`renderTemplate(name, context?, store?)`**: Clones and statically resolves a template into a DocumentFragment.
- **`escapeHtml(value)`**: Sanitizes strings against XSS by escaping `&`, `<`, `>`, `"`, and `'`.
- **`safeAttr(value)`**: Escapes HTML entities and backticks for safe attribute values.
- **`safeUrl(value)`**: Validates URL protocol (`http:`, `https:`, root-relative `/`, or `#`). Returns empty string for dangerous protocols (`javascript:`, `data:`).
- **`safeStyleUrl(value)`**: Returns sanitized `url('...')` or `'none'` for CSS inline values.

### 5.3 Diagnostics API

```js
import { setDevMode, isDevMode, subscribeDiagnostics, warn, reportError, error, loadDevMessages } from 'lime-csr-js';
```

- **`setDevMode(mode)`**: Controls diagnostic presentation:
  - `true` or `'dev'`: Console warnings with actionable explanations + visual error overlay.
  - `'prod'` or `'production'`: Terse `[lime-error] CODE` console warnings without overlay.
  - `false`: Silences console and overlay (listeners still receive events).
- **`isDevMode()`**: Returns `true` if development mode is active.
- **`subscribeDiagnostics(listener)`**: Subscribes to structured diagnostics. Returns an idempotent `unsubscribe()` function.
- **`reportError(code, detailsOrContext?, context?)`**: Dispatches structured diagnostic.
- **`warn(code, message?, context?)`**: Primary warning dispatch function.
- **`error`**: Alias for `reportError`.
- **`loadDevMessages()`**: Loads actionable error catalog on-demand in development mode.

Each diagnostic preserves the original `code`, `message`, and `context` fields and adds:

```js
{
  severity: 'warning' | 'error',
  category: 'mount' | 'module' | 'template' | 'binding' | 'event' | 'security' | 'store' | 'runtime',
  details: {},        // structured reportError details
  timestamp: 0,       // Date.now() at first dispatch
  count: 1,           // repeated equivalent diagnostics within one second are aggregated
}
```

The first diagnostic is dispatched synchronously. Repetitions with the same severity, code, message, context, and details within one second are not dispatched again; the original diagnostic object's `count` increases. Console and development-overlay presentation still records every occurrence.

### 5.4 Kernel Primitives

```js
import { createEngine, defineModule, attr, attrs, tag, pattern, createScope } from 'lime-csr-js';
// Or from 'lime-csr-js/core'
```

- **`createEngine(options)`**: Compiles an isolated Engine with a custom module array.
- **`defineModule(definition)`**: Validates and freezes a module definition.
- **`attr(name, hooks)`**: Exact attribute trigger.
- **`attrs(options, hooks)`**: Multi-attribute group trigger.
- **`tag(tagName, hooks)`**: Exact tag trigger.
- **`pattern(prefixOrRegex, hooks)`**: Attribute prefix or RegExp pattern trigger.
- **`createScope(parentScope?, localData?)`**: Creates a prototypally inherited lexical scope.

### 5.5 Standard Modules

```js
import { partials, conditionals, loops, text, show, model, events } from 'lime-csr-js';
// Or from 'lime-csr-js/modules'
```

Factory functions returning module definitions for the 7 standard unprivileged modules.

---

## 6. Engine Runtime (`createEngine`)

### 6.1 Engine Configuration & Immutability

`createEngine` compiles routes, resolves module precedence, and initializes partition tables once at creation time:

```js
import { createEngine } from 'lime-csr-js/core';
import { text, show, events } from 'lime-csr-js/modules';

const engine = createEngine({
  modules: [
    text(),
    show(),
    events(),
  ],
});
```

**Key Invariants:**
- **Precedence is immutable:** Modules registered earlier in the `modules` array take absolute precedence over later modules.
- **Zero dynamic mutation:** There is **no `engine.use()`**. Adding modules requires creating a new engine instance.
- **Compiled Partitioned Router:** Routes are partitioned by trigger type (`tag`, `attr`, `attrs`, `pattern`) and execution phase (`transform`, `link`) for $O(1)$ indexed lookup.

### 6.2 Engine Instance Isolation

Each `Engine` instance maintains its own isolated route table, partition indexes, and module configuration. Multiple engines can coexist within the same application or web page without cross-talk **when mounted to different target elements**.

DOM targets have exclusive runtime ownership across all engines. Mounting an engine to a target that is already mounted by another engine first unmounts the previous owner, including its reactive subscriptions and delegated event listeners, then activates the new owner. This prevents two runtimes from concurrently controlling the same DOM tree.

Use separate targets for independent widgets. To replace an application in the same target, mount the replacement engine normally; no manual cross-engine teardown is needed.

### 6.3 Custom Engine Composition

To exclude unused features or introduce custom directives:

```js
import { createEngine } from 'lime-csr-js/core';
import { conditionals, loops, text } from 'lime-csr-js/modules';
import { customValidationModule } from './custom-validation.js';

// Engine without partials, model, or show modules
const minimalEngine = createEngine({
  modules: [
    customValidationModule,
    conditionals(),
    loops(),
    text(),
  ],
});
```

---

## 7. Module Authoring Guide (`defineModule`)

### 7.1 Module Contract

A module definition is declared using `defineModule()`:

```js
import { defineModule, attr } from 'lime-csr-js';

const myModule = defineModule({
  name: 'my-feature', // Must match /^[a-z][a-z0-9-]*$/
  version: '1.0.0',   // Optional semantic version

  // Non-empty array of triggers
  triggers: [
    attr('data-my-feature', {
      phase: 'link', // 'transform' | 'link'
      read(el, ctx) { /* ... */ },
      setup(el, data, ctx) { /* ... */ },
    }),
  ],

  // Optional mount-level lifecycle hooks
  beforeMount(ctx) {
    // ctx: { target, options, scope, store }
  },
  afterMount(ctx) {
    // ctx: { target, options, scope, store, unmount }
  },
});
```

### 7.2 Step-by-Step Custom Module Example

Let's build a practical **Auto-Resize Textarea** module:

```js
import { defineModule, attr } from 'lime-csr-js';

export const autoResizeModule = defineModule({
  name: 'auto-resize',
  triggers: [
    attr('data-auto-resize', {
      phase: 'link', // Behavioral attachment: does not mutate DOM structure

      // 1. read(): Pure extraction. Runs once during initial setup.
      read(el, ctx) {
        if (el.tagName !== 'TEXTAREA') {
          ctx.warn('AUTO_RESIZE_INVALID_ELEMENT', 'data-auto-resize only supports <textarea>.');
          return null;
        }
        const minHeight = parseInt(el.getAttribute('data-min-height') || '60', 10);
        return { minHeight };
      },

      // 2. setup(): Attaches listeners and registers teardown.
      setup(el, data, ctx) {
        if (!data) return;

        const resize = () => {
          el.style.height = 'auto';
          el.style.height = `${Math.max(el.scrollHeight, data.minHeight)}px`;
        };

        el.addEventListener('input', resize);

        // Initial sizing after element is connected to the DOM
        ctx.afterConnect(resize);

        // Register teardown on the unified LIFO cleanup stack
        ctx.onCleanup(() => {
          el.removeEventListener('input', resize);
        });
      },
    }),
  ],
});
```

### 7.3 Module Authoring Rules & Invariants

1. **Phase Discipline:**
   - Use `phase: 'transform'` only if your module replaces, clones, or expands DOM elements.
   - Use `phase: 'link'` for event listeners, reactive bindings, visibility, or styling. Never perform structural DOM mutations (`appendChild`, `remove`, `replaceWith`) in the Link phase.
2. **Pure `read()`:**
   - `read(el, ctx)` must be pure. It extracts configuration from DOM attributes and does not mutate DOM or subscribe to the store.
   - `read()` runs once during initial setup; reactive updates do not re-run `read()`.
3. **Always Register Cleanups:**
   - Use `ctx.onCleanup(fn)` or return a cleanup function from `setup()`.
   - Store watches established via `ctx.watch()` automatically register unwatch callbacks on the cleanup stack.
4. **Isolate Failures:**
   - Do not catch errors with silent suppression. Use `ctx.error(code, details)` or `ctx.warn(code, message)` to integrate with Lime's diagnostic system.

---

## 8. Trigger API

Triggers specify how elements are matched and routed to module handlers. All triggers support declarative contracts for required/optional attributes, type coercion, exclusion rules, and zero-boilerplate attribute harvesting.

### 8.1 `attr(name, hooksOrOptions)`

Matches an exact attribute name. Can accept companion attribute options:

```js
import { attr } from 'lime-csr-js/core';

// Simple exact attribute trigger:
attr('data-highlight', {
  phase: 'link',
  setup(el, data, ctx) {
    el.style.backgroundColor = 'yellow';
  },
});

// Attribute trigger with companion requirements & harvesting:
attr('data-fetch', {
  phase: 'link',
  required: ['data-as'],
  optional: ['data-lazy'],
  types: { 'data-lazy': Boolean },
  setup(el, data, ctx) {
    // data automatically receives harvested attributes:
    // data['data-as'], data['data-lazy']
  },
});
```

### 8.2 `attrs(options, hooks)`

Matches a group of attributes. Requires all `required` attributes to be present on the element:

```js
import { attrs } from 'lime-csr-js/core';

attrs({
  required: ['data-dialog', 'data-modal'],
  optional: ['data-backdrop', 'data-timeout'],
  types: { 'data-timeout': Number },
  phase: 'link',
}, {
  setup(el, data, ctx) {
    // Guaranteed that both data-dialog and data-modal exist
    // data['data-timeout'] is coerced to Number
  },
});
```

- **Anchor Position:** A multi-attribute trigger produces **exactly one match** per element and is anchored to the DOM attribute index of its first required attribute.

### 8.3 `tag(tagName, hooksOrOptions)`

Matches an exact HTML tag name (automatically normalized to uppercase).

```js
import { tag } from 'lime-csr-js/core';

tag('CUSTOM-CARD', {
  phase: 'transform',
  required: ['title'],
  optional: ['elevation', 'interactive'],
  types: {
    elevation: Number,
    interactive: Boolean,
  },
  setup(el, data, ctx) {
    // data.elevation is a number, data.interactive is a boolean
  },
});
```

#### Template Directive Aliases (`templateDirective`)
When authoring structural custom tags (e.g. `<for>` or `<if>`), browsers may foster-parent custom tags placed directly inside table bodies or select elements. `templateDirective` allows a single `tag()` trigger to automatically match both `<custom-tag>` and `<template directive>` without duplicating route boilerplate:

```js
tag('FOR', {
  templateDirective: 'data-for',
  required: ['each', 'as'],
  optional: ['index', 'key'],
  setup(el, data, ctx) {
    // Routes both <for each="..." as="..."> and <template data-for each="..." as="...">
  },
});
```

#### Native Custom Element Bridge (`customElement`)
Tags containing a hyphen (`-`) are automatically registered with the browser's native Custom Elements registry (`customElements.define`) at mount/render time (or explicitly requested via `customElement: true`):

```js
tag('STATUS-BADGE', {
  phase: 'link',
  observedAttributes: ['status'],
  setup(el, data, ctx) {
    el.textContent = el.getAttribute('status');
  },
  update(el, change, ctx) {
    // change: { name: 'status', oldValue: 'pending', newValue: 'resolved' }
    el.textContent = change.newValue;
  },
});
```
- Direct DOM mutations (`el.setAttribute('status', 'resolved')`) invoke the trigger's `update()` hook via the native `attributeChangedCallback`.

### 8.4 `pattern(prefixOrRegex, hooksOrOptions)`

Matches attributes starting with a prefix string or satisfying a regular expression:

```js
import { pattern } from 'lime-csr-js/core';

// String prefix:
pattern('data-on-', {
  phase: 'link',
  setup(el, data, ctx) {
    const attrName = ctx.matchedAttribute; // e.g. "data-on-click"
  },
});

// Pattern with declarative exclusion list:
pattern(/^data-model(?:[.-].+)?$/, {
  phase: 'link',
  exclude: ['data-model-group', /^data-model-group-/],
  setup(el, data, ctx) {
    // Matches data-model, data-model.number, data-model-trim
    // But ignores data-model-group or data-model-group-*
  },
});
```

### 8.5 Declarative Type Coercion & Zero-Boilerplate Harvesting

When `required`, `optional`, or `types` are defined on a trigger:
1. **Attribute Harvesting (`ctx.attributes`):** The router extracts the declared attributes into a frozen dictionary and attaches it to `ctx.attributes`.
2. **Default `data` in `setup(el, data, ctx)`:** If a trigger does not provide a `read(el, ctx)` hook, the router automatically passes `ctx.attributes` as the second argument (`data`) to `setup()`.
3. **Supported Types:**
   - `Number`: Coerced via `Number(val)`. Returns `null` if empty or `NaN`.
   - `Boolean`: `true` if attribute is present and value is not `"false"`.
   - `Array`: Splits comma-separated values into trimmed strings (`"a, b, c"` -> `['a', 'b', 'c']`).
   - `Object`: Parses JSON string (`JSON.parse(val)`). Returns `null` on syntax error.
   - `Custom Function`: Invoked with string value: `(val) => transform(val)`.

### 8.6 Matching Semantics

- **Attribute Existence:** An attribute matches if `el.hasAttribute(name)` is true. Empty attributes (e.g. `<div data-active></div>`) match successfully.
- **Custom `match(el)`:** Optional filter predicate. If provided, the route matches only when `match(el)` returns truthy.

---

## 9. Module Lifecycle

### 9.1 Lifecycle Sequence

For each matched element, execution proceeds through the following deterministic pipeline:

```text
       ┌─────────┐
       │  match  │  (Predicate: does this element qualify?)
       └────┬────┘
            │ true
            ▼
       ┌─────────┐
       │  read   │  (Pure extraction: reads attributes once)
       └────┬────┘
            │ data
            ▼
       ┌─────────┐
       │  setup  │  (Initial setup: attaches listeners / watches)
       └────┬────┘
            │
            ├───────────────┐
            │               ▼
            │        ┌─────────────┐
            │        │   update*   │  (Reactive callback on store change)
            │        └─────────────┘
            ▼
       ┌─────────┐
       │ cleanup │  (Teardown: LIFO order upon element unmount)
       └─────────┘
```

### 9.2 Hook Specifications

- **`match(element)`**:
  - Optional. Fast boolean predicate.
- **`read(element, ctx)`**:
  - Optional. Pure extraction function.
  - Takes `(element, ctx)` and returns a structured data payload.
  - Runs **once** during initial setup; never re-runs during updates.
- **`setup(element, data, ctx)`**:
  - Primary initialization hook.
  - Receives the payload returned by `read()`.
  - Can register cleanups via `ctx.onCleanup(fn)` or return a cleanup function directly.
- **`update(element, arg, ctx)`**:
  - Optional reactive update hook.
  - Invoked explicitly via `ctx.update(arg)`.
- **`cleanup(element, ctx)`**:
  - Optional explicit cleanup callback.

### 9.3 Unified LIFO Cleanup Stack

Every element and subtree has a unified cleanup stack:
- **Strict LIFO Order:** Cleanups execute in reverse registration order (Last-In, First-Out).
- **Idempotent:** Running cleanup multiple times is safe; cleanups execute exactly once.
- **Fault-Isolated:** If one cleanup throws an exception, it is caught and reported as `MODULE_CLEANUP_FAILED`. Remaining cleanups run unconditionally without interruption.

---

## 10. ModuleContext (`ctx`)

`ModuleContext` is passed to trigger lifecycle hooks. It provides access to scope, store, lifecycle registration, and DOM inspection while strictly encapsulating engine internals:

| Property / Method | Type | Description |
|---|---|---|
| `ctx.scope` | `Object` | Current lexical scope with prototypal inheritance. |
| `ctx.store` | `Store \| null` | The reactive store instance (if one was passed to mount/render). |
| `ctx.element` | `Element` | The DOM element currently being processed. |
| `ctx.trigger` | `TriggerDefinition` | The trigger definition that matched this element. |
| `ctx.moduleName` | `string` | Name of the module owning this trigger. |
| `ctx.document` | `Document` | Owning DOM Document. |
| `ctx.window` | `Window \| null` | Owning DOM Window. |
| `ctx.matchedAttribute` | `string \| null` | Exact name of the matched attribute (for pattern/attr triggers). |
| `ctx.attributeName` | `string \| null` | Alias for `ctx.matchedAttribute`. |
| `ctx.attributes` | `Readonly<Object> \| null` | Harvested required & optional attributes with type coercion applied. |
| `ctx.handlers` | `Object \| null` | Handler dictionary passed to `mount()` or `render()`. |
| `ctx.options` | `Object \| null` | Full options object passed to `mount()` or `render()`. |
| `ctx.refs` | `Object` | Shared element references map for the active mount/render runtime. |
| `ctx.target` | `Element \| null` | Mount container target element. |
| `ctx.emit(name, detail?, init?)` | `Function` | Dispatches a bubbling CustomEvent from `ctx.element`. |
| `ctx.dispatch(name, detail?, init?)` | `Function` | Alias for `ctx.emit`. |
| `ctx.onCleanup(fn)` | `(fn) => fn` | Registers a teardown function on the unified LIFO cleanup stack. |
| `ctx.watch(path, cb, opts?)` | `(path, cb) => unwatch` | Subscribes to store path; auto-registers unwatch on cleanup stack. |
| `ctx.afterConnect(fn)` | `(fn) => void` | Schedules a microtask to run after the element is connected to the DOM document. |
| `ctx.update(fnOrArg?)` | `(fnOrArg) => void` | Executes an update safely with `MODULE_UPDATE_FAILED` isolation. |
| `ctx.transform(node, subScope?)` | `(node, scope) => number` | Runs the Transform phase on a subtree within an optional sub-scope. |
| `ctx.link(node, subScope?)` | `(node, scope) => void` | Runs the Link phase on a subtree within an optional sub-scope. |
| `ctx.error(code, details?, ctx?)` | `Function` | Reports an error through the centralized diagnostic system. |
| `ctx.warn(code, msg?, ctx?)` | `Function` | Reports a warning through the centralized diagnostic system. |

---

## 11. Scope System

### 11.1 Prototypal Inheritance & Shadowing

Lime represents lexical template context using JavaScript's native prototypal inheritance (`Object.create`):

```js
import { createScope } from 'lime-csr-js/core';

const parentScope = { user: 'Alice', theme: 'dark' };
const childScope = createScope(parentScope, { user: 'Bob' });

console.log(childScope.user);  // "Bob" (shadows parent)
console.log(childScope.theme); // "dark" (inherited from parent)
console.log(parentScope.user); // "Alice" (parent is untouched)
```

**Benefits:**
- $O(1)$ child scope creation with zero dictionary cloning.
- Natural variable shadowing (e.g. inner loops shadowing outer loop variable names).
- Prototypal shadowing protects parent scope from child modifications (child property writes do not mutate parent).

### 11.2 Scope vs Store

It is critical to distinguish between **Scope** and **Store**:

| Dimension | Scope | Store |
|---|---|---|
| **Purpose** | Lexical template variables (`as="item"`, `index="i"`). | Mount-level reactive application state. |
| **Mutation** | Lexically scoped, prototype-inherited object (shadowable; not reactively tracked). | Reactively mutable (`store.set`, `store.update`). |
| **Inheritance**| Prototypal hierarchy ($Child \to Parent$). | Flat dot-path namespace (`"user.name"`). |
| **Updates** | Re-created upon loop/conditional re-render. | Fine-grained notifications to existing subscribers. |

### 11.3 Isolated Scope for Partials & Slot Scope Preservation

`<partial>` templates run in an **isolated scope** created via `createIsolatedScope()` (null prototype). They do **not** inherit caller or parent loop variables, ensuring encapsulation while still sharing the mount-level reactive Store.

When caller children are projected into `<slot>` (either default or named):
- **Projected slot content retains caller lexical scope** (mapped to elements via `setElementScope`). Any `${...}` interpolation, directives (`data-text`, `data-if`, `data-for`), or event handlers (`data-on-*`) inside projected slot elements evaluate strictly against the caller scope.
- **Partial template's own nodes use the isolated partial scope.** Variables defined in the partial's `data` or attributes do not leak into the caller's projected slot content, and caller variables do not leak into the partial template.

---

## 12. Reactive Store

### 12.1 Path-Based Reactivity

The store is a path-based reactive state container. Paths are dot-separated strings (e.g. `"cart.items.0.price"`):

- **Upward Notifications:** Changing `"user.profile.name"` notifies subscribers for `"user.profile.name"`, `"user.profile"`, and `"user"`.
- **Downward Notifications:** Setting an object at `"user"` notifies subscribers for `"user.profile.name"`. Lookups are accelerated by an internal prefix index.
- **Reference Equality:** Uses `Object.is()`. Setting the same value produces no subscriber notifications.

### 12.2 Store API Reference

```js
const store = createStore({ count: 0, user: { name: 'Alice' } });
```

- **`store.get(path?)`**:
  Returns the value at path. If path is omitted or empty, returns the entire state tree.
- **`store.set(path, value)`**:
  Writes value to path. Returns `true` if a change occurred; `false` if rejected or equal.
- **`store.update(path, updaterFn)`**:
  Passes the current value at path to `updaterFn(currentValue)` and sets the returned value.
- **`store.subscribe(path, callback)`**:
  Subscribes to path changes: `callback(newValue, previousValue, changedPath)`. Returns an unsubscribe function.
- **`store.computed(path, deps, fn)`**:
  Registers a derived value that automatically recomputes whenever any dependency changes.
- **`store.batch(fn)`**:
  Coalesces all `store.set()` calls inside `fn()` into a single flush wave.

### 12.3 Computed Properties

```js
store.computed('totalPrice', ['items', 'taxRate'], (items, taxRate) => {
  const subtotal = (items || []).reduce((sum, item) => sum + item.price, 0);
  return subtotal * (1 + (taxRate || 0));
});
```

- Automatically executes initially to set the derived path.
- Returns a `dispose()` function.
- Setting a computed path manually emits `COMPUTED_MANUAL_SET`.

### 12.4 Batch Updates

```js
store.batch(() => {
  store.set('firstName', 'Bob');
  store.set('lastName', 'Smith');
  store.set('age', 42);
}); // Subscribers are notified once here in a deduplicated flush wave
```

- Nested batches are supported; notifications flush when the outermost batch exits.
- Even if `fn()` throws an error, pending updates flush safely before propagating the error.

### 12.5 Prototype Pollution Prevention

`store.set()`, `store.update()`, and `getByPath()` reject any path segment named `__proto__`, `constructor`, or `prototype`. Such mutations are silently blocked without corrupting `Object.prototype`.

---

## 13. Standard Modules Reference

Lime provides 7 standard unprivileged modules.

---

### 13.1 Built-in Partials & Slot Composition (`partials`)

- **Purpose:** Composes reusable sub-templates with isolated lexical scopes and projection into named and default slots. Template composition is a built-in core capability of Lime CSR v0.3.0.
- **Triggers:** Tag trigger `PARTIAL` (`<partial name="..." [data="..."] [props...]>`).
- **Phase:** `transform` (Fixed-point macro expansion).
- **Input:** `name` (template ID suffix or template name), `data` (optional base path), custom HTML attributes (passed as props to partial scope).
- **Slot Projection Capabilities:**
  - **Default Slot:** Template `<slot></slot>` receives caller children without a `slot` attribute in document order.
  - **Named Slots:** Template `<slot name="slotName"></slot>` receives caller elements with matching `slot="slotName"`.
  - **Projection Metadata Stripping:** The `slot="..."` attribute is automatically stripped from projected elements in the output DOM.
  - **Order Preservation:** Multiple elements targeting the same slot preserve caller DOM order.
  - **Fallback Content:** If the caller provides no children (or only whitespace text nodes) for a slot, the slot's fallback children are rendered. If no fallback content exists, `<slot>` is removed.
  - **Multiple Target Slots:** If a template contains multiple `<slot name="slotName">` elements, each receives a projected clone.
- **Scope Semantics:**
  - **Partial Template Nodes:** Run in an isolated scope (`createIsolatedScope`) with a null prototype, populated with `data` and explicit props.
  - **Projected Slot Nodes:** Retain caller lexical scope (mapped via `setElementScope`). Any `${...}` interpolation, directives, or event listeners on slot content evaluate against caller scope.
- **Store Behavior:** Shares the mount-level Store across both partial and slot nodes.
- **Diagnostics:**
  - `PARTIAL_MISSING_NAME`: If `<partial>` lacks the `name` attribute.
  - `PARTIAL_NOT_FOUND`: If template is not found in `options.templates` or `<template id="tpl-{name}">`.
  - `SLOT_NOT_FOUND`: Emitted when caller provides an element targeting a slot name that does not exist in the template; unknown slot content is discarded and not rendered.
- **Example:**
  ```html
  <template id="tpl-modal">
    <div class="modal-dialog">
      <header class="modal-header">
        <slot name="header"><h3>Default Header</h3></slot>
      </header>
      <main class="modal-body">
        <slot><p>Default modal body</p></slot>
      </main>
      <footer class="modal-footer">
        <slot name="footer"></slot>
      </footer>
    </div>
  </template>

  <!-- Caller composition -->
  <partial name="modal">
    <h3 slot="header">Confirm Deletion</h3>
    <p>Are you sure you want to delete <strong data-text="selectedItem.name"></strong>?</p>
    <button slot="footer" data-on-click="confirmDelete">Delete</button>
  </partial>
  ```

---

### 13.2 Conditionals Module (`conditionals`)

- **Purpose:** Conditional branch rendering and reactive condition toggling.
- **Triggers:**
  - Tag triggers: `<if>`, `<else>`.
  - Attribute triggers: `template[data-if]`, `template[data-else]`.
- **Phase:** `transform` (static branch pruning) + `link` (for `data-live` reactive updates).
- **Supported Operators:**
  | Operator | Evaluation Logic | Example |
  |---|---|---|
  | `is-gt` | `Number(left) > Number(right)` | `<if is-gt="count" than="0">` |
  | `is-lt` | `Number(left) < Number(right)` | `<if is-lt="count" than="10">` |
  | `is-gte` | `Number(left) >= Number(right)` | `<if is-gte="age" than="18">` |
  | `is-lte` | `Number(left) <= Number(right)` | `<if is-lte="price" than="100">` |
  | `is-eq` | `String(left) === String(right)` | `<if is-eq="status" to="active">` |
  | `is-neq` | `String(left) !== String(right)` | `<if is-neq="status" to="draft">` |
  | `is-truthy`| `Boolean(left)` | `<if is-truthy="user.isLoggedIn">` |
- **Reactive Behavior (`data-live`):**
  - Places comment anchors: `<!-- lif1 -->` and `<!-- /lif1 -->`.
  - When the evaluated path changes, cleans up the previous branch and renders the new branch using `ctx.link()`.
- **Errors:**
  - `MISSING_OPERATOR`: `<if>` has no condition operator attribute.
  - `UNKNOWN_OPERATOR`: Condition attribute starts with `is-` but is unrecognized.
  - `ELSE_AFTER_CONTENT`: Sibling elements found after `<else>`.
- **Example:**
  ```html
  <if is-truthy="user.authenticated" data-live>
    <p>Welcome, <span data-text="user.name"></span>!</p>
    <else>
      <a href="/login">Please sign in</a>
    </else>
  </if>
  ```

---

### 13.3 Loops Module (`loops`)

- **Purpose:** Renders lists of array items with prototypal child scopes and reactive reconciliation.
- **Triggers:**
  - Tag trigger: `<for each="..." as="..." [index="..."] [key="..."]>`.
  - Attribute trigger: `template[data-for]`.
- **Phase:** `transform` (static loop unrolling) + `link` (for `data-live` reconciliation).
- **Diff Strategies (`data-diff`):**
  1. `simple`: Key-based map lookup, reorders modified items.
  2. `lcs`: Longest Increasing Subsequence algorithm. Minimizes DOM node moves and preserves active focus.
  3. `replace`: Clears and re-renders entire list from scratch.
- **Reactive Behavior (`data-live`):**
  - Requires `key="item.id"` attribute.
  - Efficiently reuses existing DOM elements when items are reordered or updated in-place.
- **Errors:**
  - `FOR_MISSING_ATTR`: Missing `each` or `as` attribute.
  - `FOR_NOT_ARRAY`: Target path is not an array.
  - `FOR_MISSING_KEY`: `data-live` loop missing the `key` attribute.
  - `FOR_DUPLICATE_KEY`: Duplicate key detected in the array.
  - `UNKNOWN_DIFF_STRATEGY`: Unrecognized `data-diff` value.
- **Example:**
  ```html
  <for each="items" as="item" index="idx" key="item.id" data-live data-diff="lcs">
    <li class="item-row">
      <span data-text="idx"></span>: <span data-text="item.name"></span>
    </li>
  </for>
  ```

---

### 13.4 Text & Attribute Bindings Module (`text`)

- **Purpose:** Reactively binds store values to text content and HTML attributes.
- **Triggers:**
  - `attr('data-text')`
  - `pattern(/^(?!data-).+/)` for `{x}` attribute templates.
- **Phase:** `link`.
- **Text Binding:**
  - `data-text="path"` assigns `el.textContent = val ?? ''`.
  - Text assignment does not parse HTML entities, preventing HTML injection.
- **Attribute Templates:**
  - Attribute contains `{placeholder}` and element defines `data-{placeholder}="path"`.
  - Example: `<a href="/users/{id}" data-id="user.id"></a>`.
  - Sanitizes URL attributes (`href`, `src`, etc.) via `isSafeUrlProtocol()`.
- **Errors:**
  - `BINDING_MISSING_PATH`: Empty `data-text` attribute.
  - `BINDING_MISSING_DATA_ATTR`: Missing matching `data-{x}` for `{x}` placeholder.
  - `UNSAFE_EVENT_ATTR`: Attribute begins with `on` (e.g. `onclick`).
  - `UNSAFE_URL_ATTR`: URL contains dangerous protocol (`javascript:`, `data:`).
  - `RESERVED_ATTR_NAME`: Using a reserved name (`text`, `model`, `show`, `live`, `diff`, `on-*`) as a placeholder.

---

### 13.5 Visibility Module (`show`)

- **Purpose:** Toggles element visibility via the native `hidden` property.
- **Trigger:** `attr('data-show')`.
- **Phase:** `link`.
- **Behavior:**
  - Sets `el.hidden = !val`.
  - **Does not touch inline `style.display`.** This allows application CSS classes (e.g. `flex`, `grid`) to maintain their layout when visible.
  - Injects a single scoped style rule once into the document:
    ```css
    [data-show][hidden] { display: none !important; }
    ```
- **Errors:**
  - `SHOW_MISSING_PATH`: Empty `data-show` attribute.
- **Example:**
  ```html
  <div class="modal-dialog" data-show="isModalOpen">
    <h3>Modal Content</h3>
  </div>
  ```

---

### 13.6 Two-Way Form Binding Module (`model`)

- **Purpose:** Synchronizes form inputs bidirectionally with the reactive store.
- **Triggers:**
  - Input-level: `pattern(/^data-model(?:[.-].+)?$/)` (supports dot, dash, and companion modifiers).
  - Group-level: `attr('data-model-group')` (automatic form-level scoping).
- **Phase:** `link`.
- **Form Control Support Matrix:**

| Control / Type | Event | Store Value | DOM $\to$ Store | Store $\to$ DOM |
|---|---|---|---|---|
| `<input type="text">`, email, password | `input` (or `change` with `.lazy`) | `string` | `el.value` | `el.value = String(val)` (skips if equal) |
| `<textarea>` | `input` (or `change` with `.lazy`) | `string` | `el.value` | `el.value = String(val)` (skips if equal) |
| `<input type="number">`, `range` | `input` (or `change` with `.lazy`) | `number \| null` | `Number(el.value)` or `null` if empty | `el.value = String(val)` |
| `<input type="checkbox">` (boolean) | `change` | `boolean` | `el.checked` | `el.checked = Boolean(val)` |
| `<input type="checkbox">` (array: `name[]` or store array) | `change` | `string[]` | Checked adds `el.value`; unchecked removes it | `el.checked = val.includes(el.value)` |
| `<input type="radio">` | `change` | `string` | If checked, `el.value` | `el.checked = (String(val) === el.value)` |
| `<select>` (single) | `change` | `string` | `el.value` | `el.value = String(val)` |
| `<select multiple>` | `change` | `string[]` | Array of selected option values | `opt.selected = val.includes(opt.value)` |
| `<div contenteditable="true">` | `input` (or `blur` with `.lazy`) | `string` | `el.innerHTML` (or `el.textContent` with `.text`) | `el.innerHTML = String(val)` (skips if equal) |

- **Initial DOM Value Fallback:**
  When the store value at the bound path is `undefined`, the module preserves initial HTML values (`value`, `checked`, `selected`, textarea content, or contenteditable innerHTML) and initializes the store with those values instead of wiping the element. If the store already contains a defined value (including `""`, `0`, `false`, `null`), the store takes absolute precedence.

- **Checkbox Array Binding:**
  Binding checkboxes to an array path (`data-model="roles[]"` or when the store holds an Array) toggles array membership: checking an input appends `el.value`; unchecking removes it. Store updates update each checkbox's `checked` state based on `array.includes(el.value)`. Full backward compatibility with boolean checkboxes is preserved.

- **Modifiers:**
  Modifiers can be specified via dot syntax (`data-model.trim="path"`), dash syntax (`data-model-trim="path"`), or companion attributes (`<input data-model="path" data-model-trim>`):
  - `.lazy`: Listens on `change` (or `blur` for contenteditable) instead of `input`.
  - `.trim`: Automatically trims leading and trailing whitespace from string values before updating state.
  - `.number`: Casts the input value to a number using `Number()`, converting empty strings to `null`.
  - `.debounce` / `.debounce-<ms>` / `data-model-debounce="<ms>"`: Delays store update by the specified duration (defaults to 300ms if unspecified). The timer is disposed in LIFO order upon subsequent typing or element teardown to prevent leaks.
  - `.text`: In `contenteditable` elements, reads and writes plain text via `textContent` rather than `innerHTML`.

- **`contenteditable` Two-Way Binding:**
  Supports `<div contenteditable="true" data-model="path">` (or `<p>`, `<span>`, etc.). Features a cursor guard that prevents resetting inner content when the incoming store value matches existing DOM content, avoiding cursor jump during active typing.

- **Form-Level Group Binding (`data-model-group="prefix"`):**
  Containers (e.g. `<form data-model-group="user">` or `<fieldset data-model-group="profile">`) automatically bind all descendant controls with `name="prop"` to `${prefix}.${prop}`:
  ```html
  <form data-model-group="user">
    <input name="firstName" value="Alice">
    <input name="age" type="number" value="30">
    <input type="checkbox" name="roles[]" value="admin" checked>
    <input name="custom" data-model="settings.custom"> <!-- explicit override -->
  </form>
  ```
  - **Explicit Override:** Inputs with their own explicit `data-model` are skipped by the group and maintain their independent binding.
  - **Scoping & Nesting:** Inner `[data-model-group]` containers scope their own children, preventing conflicts with parent groups.
  - **Companion Modifiers:** Child inputs inside a group can use companion modifiers (e.g. `<input name="search" data-model-trim data-model-debounce="200">`).

- **Cursor Jump & Feedback Prevention:** `Store -> DOM` assignment is skipped if `el.value === String(val)` (or `innerHTML === String(val)` for contenteditable), preventing cursor jump and infinite feedback loops.
- **Diagnostics:**
  - `MODEL_MISSING_PATH`: Empty `data-model` attribute without a valid store path.
  - `MODEL_GROUP_MISSING_PREFIX`: Empty `data-model-group` attribute without a valid prefix.
  - `INDEXED_MODEL_PATH`: Path contains numeric indices (e.g. `items.0.name`). Recommends binding to keyed loop variables instead.

---

### 13.7 Event Delegation Module (`events`)

- **Purpose:** Dispatches user interactions to declared handlers via delegated event listeners.
- **Trigger:** `pattern('data-on-')` (ignoring companion `-data` attributes).
- **Phase:** `link`.
- **Supported Events:**
  `click`, `dblclick`, `input`, `change`, `submit`, `keydown`, `keyup`, `focus` (delegated via `focusin`), `blur` (delegated via `focusout`), `focusin`, `focusout`.
- **Key Modifiers:**
  Supports key filtering for `keydown` and `keyup`:
  `data-on-keydown-enter`, `data-on-keydown-escape`, `data-on-keydown-space`, `data-on-keydown-tab`, `data-on-keydown-up`, `data-on-keydown-down`, `data-on-keydown-left`, `data-on-keydown-right`, `data-on-keydown-delete`, `data-on-keydown-backspace`.
- **Submit Prevention:**
  `data-on-submit` calls `event.preventDefault()` automatically.
- **Handler Execution:**
  Invoked with a single structured object payload:
  ```js
  handler({ event, element, scope, store, data, refs });
  ```
  - `event`: The native DOM Event object (or `null` when triggered outside an event).
  - `element`: The target element possessing the `data-on-*` attribute.
  - `scope`: The lexical scope of the element (including loop item scope).
  - `store`: The mount reactive store instance.
  - `data`: Resolved data value from companion attribute (`data-on-*-data`), or `null` if omitted or unresolved.
  - `refs`: The active DOM element references map for the current mount or render instance.
  - **Return values are strictly ignored:** Return values such as `false` or objects do not trigger `preventDefault()`.
  - **Fault Isolation:** Sync throws and async Promise rejections are caught and reported via `MODULE_HANDLER_FAILED` without crashing other handlers or breaking runtime responsiveness.
- **Explicit Data Passing (`data-on-*-data`):**
  Companion data attribute matching the event attribute:
  - String literals: `'hello'` or `"world"` -> `"hello"` / `"world"`
  - Primitives: `true`, `false`, `null`, `undefined`
  - Numbers: `42`, `-10`, `3.14`, `0`
  - Paths: `user.id`, `item.name`, `app.theme` (resolved first against lexical scope, then reactive store).
- **Prototype Protection:**
  Prohibits dangerous prototype properties (`__proto__`, `constructor`, `prototype`, `toString`, `valueOf`, etc.), emitting `HANDLER_NOT_FOUND`.
- **Errors:**
  - `UNKNOWN_EVENT`: Unrecognized event name.
  - `UNKNOWN_KEY_MODIFIER`: Invalid key modifier suffix.
  - `HANDLER_NOT_FOUND`: Handler name is not defined in options or scope.
  - `MODULE_HANDLER_FAILED`: Handler threw an error or rejected a promise.
- **Example:**
  ```html
  <input type="text"
    data-on-keydown-enter="saveTodo"
    data-on-keydown-enter-data="todo.id"
    data-on-keydown-escape="cancelEdit">
  ```

### 13.8 DOM Element Reference Module (`ref`)

- **Purpose:** Registers direct references to DOM elements onto the mount/render instance and passes them into event handler payloads.
- **Trigger:** `attr('data-ref')`.
- **Phase:** `link`.
- **Reference Resolution:**
  - **Single Element:** `data-ref="searchInput"` binds the DOM element to `refs.searchInput`.
  - **Explicit Array Suffix (`[]`):** `data-ref="items[]"` binds an array `[element]` to `refs.items` and `refs['items[]']`. Additional matching elements are appended in DOM order.
  - **Multiple Elements without Suffix:** If multiple elements declare the same `data-ref="item"`, the first element sets `refs.item = element`. When a second element matches, `refs.item` automatically converts into an array `[firstElement, secondElement]`. Subsequent matches append to that array.
- **Accessing References:**
  - **Mount Return Value:** `const app = mount({ target: '#app', ... }); console.log(app.refs.searchInput);`
  - **Render Return Value:** `const res = render(fragment, { ... }); console.log(res.refs.searchInput);`
  - **Event Handler Payload:** `handler({ event, element, scope, store, data, refs }) { refs.searchInput.focus(); }`
- **Automatic Lifecycle Cleanup:**
  - When an element is unmounted or removed (e.g. inside `<if data-live>` or `<for data-live>`), `ctx.onCleanup` deregisters it from `refs`.
  - For array references, the unmounted element is removed from the array. If the array becomes empty, the reference key is deleted from `refs`.
  - For single references, `delete refs[name]` is performed upon unmount.
- **Errors:**
  - `REF_MISSING_NAME`: Emitted when `data-ref` attribute is empty or contains only whitespace.
- **Example:**
  ```html
  <div id="app">
    <input type="text" data-ref="searchBox" data-on-keydown-enter="handleSearch">
    <button data-on-click="clearInput">Clear</button>
    <ul>
      <li data-ref="listItems[]">Item A</li>
      <li data-ref="listItems[]">Item B</li>
    </ul>
  </div>
  ```
  ```js
  const app = mount({
    target: '#app',
    handlers: {
      clearInput({ refs }) {
        refs.searchBox.value = '';
        refs.searchBox.focus();
      },
      handleSearch({ refs }) {
        console.log('Items count:', refs.listItems.length);
      }
    }
  });
  ```

---

## 14. Security Model

Lime is engineered from the ground up for zero-trust environments:

1. **No Expression Evaluation:**
   Lime contains zero occurrences of `eval()`, `new Function()`, or dynamic code evaluation.
2. **CSP Compatibility:**
   Runs under the strictest Content Security Policy:
   ```http
   Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
   ```
3. **Prototype Pollution Protection:**
   The store rejects path segments matching `__proto__`, `constructor`, or `prototype`.
4. **XSS Protection:**
   Text bindings use `textContent`. URL attributes are protocol-checked via `isSafeUrlProtocol()`. Event attributes (`onclick`) cannot be bound reactively.

---

## 15. Diagnostics & Complete Error Catalog

Lime never throws runtime exceptions that crash user pages. All issues are dispatched as structured diagnostics.

### Diagnostic Codes Table

| Code | Level | Source | Meaning | Typical Cause |
|---|---|---|---|---|
| `MOUNT_TEMPLATE_NOT_FOUND` | Error | Facade | `<template id="tpl-{name}">` was not found in document. | Typo in template name passed to `mount()`. |
| `MOUNT_INVALID_TARGET` | Error | Facade | Target argument is not a valid DOM element or valid selector. | Passing `null`, `undefined`, number, or malformed selector to `mount()`. |
| `MOUNT_TARGET_NOT_FOUND` | Error | Facade | Selector matched zero elements in document. | Selector typo or mounting before DOM element is rendered. |
| `MOUNT_HOOK_FAILED` | Error | Facade | `beforeRender` or `afterRender` mount lifecycle hook threw. | Unhandled exception in user-provided lifecycle hook. |
| `PIPELINE_DEPTH_LIMIT` | Error | Transform | Transform reached iteration limit (100). | Circular `<partial>` or `<if>` macro expansion. |
| `TABLE_FOSTER_PARENTING` | Warn | Template | HTML parser moved special tags out of `<table>`. | Placing `<if>` or `<for>` directly inside `<table>`; use `<template data-if>`. |
| `TEMPLATE_NOT_FOUND` | Error | Template | `getTemplate()` could not locate target template. | Missing `<template>` element. |
| `PARTIAL_NOT_FOUND` | Error | Partials | `<partial name="...">` template not found. | Missing `<template id="tpl-{name}">`. |
| `SLOT_NOT_FOUND` | Error | Partials | Slot targeted by caller child not found in partial template. | `<div slot="header">` when partial has no `<slot name="header">`. |
| `PARTIAL_MISSING_NAME` | Error | Partials | `<partial>` tag missing `name` attribute. | `<partial data="foo"></partial>` without `name`. |
| `MISSING_OPERATOR` | Error | Conditionals | `<if>` tag missing condition operator attribute. | `<if is="true">` instead of `<if is-truthy="flag">`. |
| `UNKNOWN_OPERATOR` | Error | Conditionals | `<if>` operator starting with `is-` is unrecognized. | Typo like `is-equal` instead of `is-eq`. |
| `ELSE_AFTER_CONTENT` | Error | Conditionals | Sibling elements found after `<else>`. | Placing content after `<else>` inside `<if>`. |
| `FOR_MISSING_ATTR` | Error | Loops | `<for>` missing `each` or `as` attribute. | `<for each="list">` without `as="item"`. |
| `FOR_NOT_ARRAY` | Error | Loops | Loop target is not an array. | Path resolves to an object, string, or undefined. |
| `FOR_MISSING_KEY` | Warn | Loops | `<for data-live>` missing `key` attribute. | Omitting `key="item.id"` on reactive list. |
| `FOR_DUPLICATE_KEY` | Error | Loops | Duplicate key found in array. | Array contains two items with identical key values. |
| `UNKNOWN_DIFF_STRATEGY` | Warn | Loops | `data-diff` attribute value is invalid. | Typo like `data-diff="fast"`; fallback to `simple`. |
| `BINDING_MISSING_PATH` | Error | Text | `data-text` attribute is empty. | `<span data-text=""></span>`. |
| `BINDING_MISSING_DATA_ATTR` | Warn | Text | `{x}` placeholder has no matching `data-x`. | `<a href="/{id}">` without `data-id="user.id"`. |
| `UNSAFE_EVENT_ATTR` | Error | Text | Reactive binding attempted on `on*` attribute. | `<button onclick="{fn}">`. Use `data-on-click`. |
| `UNSAFE_URL_ATTR` | Warn | Text | Unsafe URL protocol sanitized. | URL resolved to `javascript:...` or `data:...`. |
| `RESERVED_ATTR_NAME` | Error | Text | Attribute placeholder uses reserved name. | Using `{model}` or `{show}` as placeholder. |
| `SHOW_MISSING_PATH` | Error | Show | `data-show` attribute is empty. | `<div data-show=""></div>`. |
| `MODEL_MISSING_PATH` | Error | Model | `data-model` attribute is empty. | `<input data-model="">`. |
| `MODEL_GROUP_MISSING_PREFIX` | Error | Model | `data-model-group` attribute is empty. | `<form data-model-group="">`. |
| `INDEXED_MODEL_PATH` | Warn | Model | `data-model` path contains numeric index. | `data-model="items.0.name"`. Bind to loop variable. |
| `UNKNOWN_EVENT` | Error | Events | `data-on-{event}` is not a supported event. | Typo like `data-on-hover`. Use `mouseenter`. |
| `UNKNOWN_KEY_MODIFIER` | Error | Events | Unsupported key modifier suffix. | Typo like `data-on-keydown-return`. Use `-enter`. |
| `HANDLER_NOT_FOUND` | Error | Events | Handler name not found in options or scope. | Handler not passed to `handlers: { ... }`. |
| `REF_MISSING_NAME` | Error | Ref | `data-ref` attribute is empty or whitespace. | `<button data-ref="">`. |
| `COMPUTED_MANUAL_SET` | Warn | Store | Manual `store.set()` to computed path. | Writing to a path managed by `store.computed()`. |
| `IN_PLACE_MUTATION` | Warn | Store | Setting identical reference to store. | Mutating array in-place and passing same reference. |
| `PATH_CLOBBER` | Warn | Store | Intermediate non-object segment overwritten. | Setting `user.name` when `user` was a string. |
| `BATCH_FLUSH_LIMIT` | Error | Store | Batch flush wave limit (100) exceeded. | Cyclic computed properties or mutual set loops. |
| `MODULE_READ_FAILED` | Error | Kernel | Module `read()` hook threw an exception. | Bug in custom module `read()` function. |
| `MODULE_SETUP_FAILED` | Error | Kernel | Module `setup()` hook threw an exception. | Bug in custom module `setup()` function. |
| `MODULE_UPDATE_FAILED` | Error | Kernel | Module `update()` hook threw an exception. | Bug in custom module `update()` function. |
| `MODULE_CLEANUP_FAILED` | Error | Kernel | Module cleanup hook threw an exception. | Bug in custom module cleanup function. |
| `MODULE_TRIGGER_OVERRIDDEN`| Warn | Kernel | Trigger overridden by higher-priority module. | Two modules registered for the same attribute/tag. |
| `MODULE_WATCH_FAILED` | Error | Kernel | Module `ctx.watch()` callback threw an error. | Exception in reactive watch callback. |
| `MODULE_STORE_REQUIRED` | Warn | Kernel | Module called `ctx.watch()` without a store. | Component mounted without a store. |
| `MODULE_AFTER_CONNECT_FAILED`| Error | Kernel | `ctx.afterConnect()` callback threw an error. | Exception in post-connection microtask. |
| `MODULE_HANDLER_FAILED`      | Error | Events | Event handler threw an error or rejected.      | Exception in user handler callback. |

---

## 16. Migration Guide (v0.2.x → v0.3.0)

Version `0.3.0` transitions Lime from an ad-hoc monolithic rendering engine to an unprivileged Micro-Kernel architecture.

### Removed Legacy APIs

- `definePlugin()` $\to$ Replaced by `defineModule()`.
- `PLUGIN_API_VERSION` $\to$ Removed. Modules are versioned independently.
- `plugins: [...]` in `mount()` $\to$ Replaced by composing custom engines via `createEngine({ modules })`.
- Legacy internal helpers removed from root exports: `evalCondition`, `processAllIfs`, `OPERATORS`, `expandLoops`, `expandPartials`, `setupBindings`, `setupModelBindings`, `setupShowBindings`, `setupEventBindings`, `setupLiveIfs`, `setupLiveFors`.

### Migration Examples

#### 1. Custom Directives (Legacy Plugin vs Modern Module)

**Old v0.2.x (Deprecated Plugin):**
```js
// OLD
const myPlugin = definePlugin({
  name: 'autofocus',
  setup(ctx) {
    // Ad-hoc querySelectorAll across document
  },
});
mount({ target, template: 'app', store, plugins: [myPlugin] });
```

**New v0.3.0 (Unprivileged Module):**
```js
// NEW
import { defineModule, attr, createEngine } from 'lime-csr-js';
import { text, show, events } from 'lime-csr-js/modules';

const autoFocusModule = defineModule({
  name: 'autofocus',
  triggers: [
    attr('data-autofocus', {
      phase: 'link',
      setup(el) {
        el.focus();
      },
    }),
  ],
});

const engine = createEngine({
  modules: [autoFocusModule, text(), show(), events()],
});

engine.mount({ target, template: 'app', store });
```

#### 2. Root Package Cleanliness

In `v0.2.x`, internal monolithic helpers were inadvertently exported. In `v0.3.0`, only clean, intended public utilities are exported:

```js
// Still available and recommended:
import {
  mount, unmount, render,
  createStore, getByPath, setByPath,
  createEngine, defineModule,
  attr, attrs, tag, pattern, createScope,
} from 'lime-csr-js';
```

---

## 17. Troubleshooting & FAQ

### Q: Why isn't my `<for>` loop updating when I push an item to an array?
**A:** JavaScript array methods like `push()` mutate arrays in-place. Because Lime uses `Object.is()` reference equality checking, setting the same array reference will not trigger reactivity. Always pass a new array reference:
```js
// Correct:
store.update('todos', (list) => [...list, newTodo]);
```

### Q: Why does my `<if>` tag disappear inside a `<table>`?
**A:** Standard browser HTML parsers apply "foster parenting" to custom tags inside `<table>` elements and move them outside the table before JavaScript runs. Use standard template syntax inside tables:
```html
<table>
  <tbody>
    <template data-if is-truthy="hasData">
      <tr><td>Data available</td></tr>
    </template>
  </tbody>
</table>
```

### Q: How do I access loop variables in an event handler?
**A:** Event handlers receive `(event, el, ctx)` as arguments. The item data is accessible on `ctx.scope`:
```js
handlers: {
  deleteItem(event, el, ctx) {
    const item = ctx.scope.todo;
    console.log('Deleting:', item.id);
  },
}
```
