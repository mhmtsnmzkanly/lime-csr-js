# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.5.0] - 2026-09-19

### Added
- **DOM Element Reference Module (`ref`) (`src/modules/ref.js`)**: Added standard behavioral module supporting `data-ref="name"`. Elements are registered directly onto `app.refs` on mount instances and `res.refs` on render results.
- **Array References & Automatic Grouping**: Supports explicit `data-ref="items[]"` array suffix (always an array) and duplicate `data-ref="item"` attributes (automatically converted into an array in DOM order).
- **Event Handler Payload Integration (`src/modules/events.js`)**: `refs` is now passed into event handlers (`handler({ event, element, scope, store, data, refs })`).
- **Reactive Lifecycle Pruning**: References are cleanly unregistered via `ctx.onCleanup` when elements are removed (e.g. inside reactive `<if data-live>` or `<for data-live>`).
- **New Diagnostic Code `REF_MISSING_NAME`**: Diagnostic error emitted when `data-ref` is empty or contains only whitespace.

### Changed
- **Removed Obsolete Internal Ref (`src/modules/text.js`)**: Removed deprecated `dataset.ref` stamp and unreserved `ref` from reserved names catalog.

## [0.4.4] - 2026-09-18

### Performance & Memory Optimizations
- **Bypass Than/To Lookups for `is-truthy` (`src/modules/conditionals.js`)**: Condition evaluation directly evaluates boolean truthiness for `is-truthy` without issuing redundant DOM `getAttribute('than')` and `getAttribute('to')` calls.
- **Event Parsing Memoization & Zero-Allocation Bubble Traversal (`src/modules/events.js`)**: Memoized event name modifier parsing with `PARSED_EVENT_CACHE` and replaced `for..of` attribute iterator with direct indexed loop; eliminated redundant `hasAttribute` check before `getAttribute`.
- **In-Memory Style Installation Guard (`src/modules/show.js`)**: Replaced repeated `doc.getElementById` lookups on every `data-show` element with a document-scoped `WeakSet` check.
- **Direct IDL Property Classification (`src/modules/model.js`)**: Form control classification prioritizes `el.type` IDL property before querying DOM attribute.

## [0.4.3] - 2026-09-18

### Performance & Memory Optimizations
- **Deferred Static Interpolation Guard (`src/template.js`)**: `resolveStatic` defers `inLiveBlock`, `inUnexpandedFor`, and `inIgnoredBlock` DOM parent climbing checks until a placeholder is confirmed (`indexOf('${') !== -1`), accelerating static tree resolution by up to 10x on large DOM structures.
- **Store Notification Fast-Path & Segment Traversal (`src/store.js`)**: Single-segment notification dispatching directly queries subscriber sets without string splitting or array slicing. Dotted paths construct ancestor chains iteratively from cached segments without `.slice().join()`.
- **Array Shallow Equality Fast-Path (`src/shared.js`)**: `shallowEqual` compares array elements via direct length check and index loop, bypassing `Object.keys` string allocations during list reconciliation.
- **Zero-Allocation Router Non-Matches (`src/core/router.js`)**: `matchElement` returns a shared frozen `EMPTY_MATCHES` singleton when no routes match, eliminating transient empty array allocations across the DOM scan.
- **Fast String Guard for Attribute Templates (`src/modules/text.js`)**: Pattern attribute trigger checks `val.indexOf('{') !== -1` before executing regex, bypassing regex tests on normal HTML attributes.

## [0.4.2] - 2026-09-18

### Performance & Memory Optimizations
- **Fast-Path & Bounded Segment Cache (`src/store.js`)**: Single-segment paths in `getByPath` and `setByPath` bypass string splitting, closure loops, and array allocations completely. Dotted paths leverage a bounded 1000-entry segment cache with plain iteration instead of `.reduce()`.
- **Zero-Allocation Attribute Traversal (`src/core/router.js`, `src/template.js`)**: Replaced `Array.from(element.attributes)` with direct `NamedNodeMap` index iteration and removed transient `Object.freeze` on internal match collections, eliminating tens of thousands of temporary object allocations during large table renders.
- **Fast String Guard for Static Interpolation (`src/template.js`)**: `resolveStatic` checks `indexOf('${') !== -1` before executing regex replacements and defers `getNodeScope` until an interpolation placeholder is actually confirmed.
- **Multi-Attribute Candidate Selector Integration (`src/core/router.js`)**: Multi-attribute triggers (`TRIGGER_TYPES.ATTRS`, e.g. `loops`) register their anchor attribute into `candidateSelectorParts` without disabling fast-path transform candidate detection.
- **DocumentFragment Static Loop Expansion (`src/modules/loops.js`)**: Static loop iterations append to a single `DocumentFragment` before `replaceWith`, avoiding array allocations and arguments spread.
- **Fast-Path Ignore Block Guard (`src/shared.js`)**: `inIgnoredBlock` checks `el.hasAttribute('data-lime-ignore')` directly before performing DOM parent traversal.

## [0.4.1] - 2026-09-14

### Performance
- **Adaptive Static Transform Scheduling**: Built-in static loops, partials, and conditionals defer generated fragments into a shared lifecycle queue, avoiding recursive transform runs per generated fragment while retaining conservative root scans for custom structural modules.

## [0.4.0] - 2026-09-14

### Added
- **Structured Diagnostics**: Diagnostics now include severity, category, details, timestamp, and short-window occurrence aggregation. Mounts can observe scoped diagnostics with `onDiagnostic` and `onError`.
- **Reproducible Performance Benchmarks**: The benchmark utility uses warm-up runs and median samples, with live-loop, structural, event-heavy, and admin-table scenarios.

### Changed
- **Object-Only Mount API (Breaking)**: `mount()` and `Engine.mount()` now accept one configuration object. Positional forms such as `mount(target, template, store, options)` are removed.
- **Single Target Owner**: Mounting a different engine on an already-owned target safely unmounts the prior owner.

### Fixed
- Hardened computed-store validation, replacement disposal, primitive path lookup, static root interpolation, router matching, and delegated event cleanup in reactive loops.
- Optimized LCS live-loop reconciliation by indexing previous keys instead of repeatedly scanning them.

## [0.3.1] - 2026-09-14

### Fixed & Hardened
- **Conditionals & Loops Memory Lifecycle**: Fixed branch and loop keyed block subscriptions leaking detached DOM nodes on reactive updates; isolated cleanup stacks per dynamic branch and keyed item.
- **Backslash Open Redirect / Protocol-Relative Bypass**: Fixed `isSafeUrlProtocol` to reject `/\` URLs (which modern browsers normalize to `//` protocol-relative paths).
- **CSS Injection Breakout**: Hardened `safeStyleUrl` to escape backslashes and parentheses (`%5C`, `%29`, `%28`).
- **AbortSignal Listener Leak**: Fixed `mount()` to remove signal abort event listener upon manual unmount.
- **File Input DOMException**: Fixed `data-model` on `<input type="file">` to prevent `InvalidStateError` DOMException on programmatic writes.
- **Loop Index Scope Collision**: Prevented `<for as="item" index="item">` from clobbering loop item in scope and added `FOR_INDEX_COLLISION` warning.

## [0.3.0] - 2026-09-11

### Major Architecture Milestone: Unprivileged Micro-Kernel & Built-in Composition

Version `0.3.0` is a landmark release that refactors `lime-csr-js` from an ad-hoc monolithic rendering engine into a modular, unprivileged Micro-Kernel architecture with built-in template composition. The Kernel contains zero feature-specific rendering knowledge; all built-in directives (conditionals, loops, text, visibility, two-way form binding, and event delegation) are discrete unprivileged modules, while template composition (`<partial>` and `<slot>`) is built directly into the core runtime.

### Added
- **Unprivileged Micro-Kernel (`src/core/`)**:
  - Generic trigger primitives: `attr()`, `attrs()`, `tag()`, and `pattern()`.
  - Compiled Partitioned Router with $O(1)$ indexed lookup by trigger type and execution phase.
  - Deterministic module precedence: `modules[0] > modules[1] > ... > modules[N]` resolved at compile time with development shadowing diagnostics (`MODULE_TRIGGER_OVERRIDDEN`).
  - Prototypal lexical scope system (`createScope`) with native property shadowing and $O(1)$ instantiation.
  - Unified LIFO cleanup stack per element and subtree, guaranteeing fault-isolated, idempotent teardown.
  - Asynchronous deactivation: Pending microtasks abort automatically if cleanup executes first.
- **Built-in Composition (`<partial>` + `<slot>`) (`src/core/composition.js`)**:
  - Native sub-template instantiation via `<partial name="..." data="..." [props...]>`.
  - Default (`<slot>`) and Named (`<slot name="...">`) slot projection mapping caller children into template slots.
  - Fallback slot content rendered when no matching caller children are provided.
  - Scope isolation: Partial templates execute with isolated scopes (`createIsolatedScope`), while projected slot children preserve caller lexical scope.
  - Projection metadata cleanup: `slot` attribute stripped from rendered DOM elements.
  - Standard module wrapper: `partials()` exported for modular distribution and custom engine pipelines.
- **Mount Runtime Boundary Redesign (`mount(target, template, store, options)`)**:
  - Target-first signature: `mount(target, template, store, options)` with options-object fallback `mount(target, options)`.
  - In-place mount ownership: Mounts linking existing DOM in place preserve caller markup on unmount; only Lime-created template content is cleared.
  - Mount-local state isolation: Engine instances and mount targets share zero mutable state.
  - Duplicate mount protection: Guard against mounting on already mounted targets (`MOUNT_ALREADY_MOUNTED`).
  - Lifecycle integration: First-class `AbortSignal` support via `options.signal`.
- **Modern Handlers API (`options.handlers`)**:
  - Mount-scoped application callback mechanism `{ handlers: { fn({ event, element, scope, store, data }) } }`.
  - Delegated event dispatch with single payload object passing DOM event, matched element, active lexical scope, store instance, and resolved companion data.
  - Prototype-pollution protection (`Object.hasOwn`).
  - Fault-isolated asynchronous error handling (`MODULE_HANDLER_FAILED`).
- **Engine Runtime (`createEngine`)**:
  - Compile custom, isolated runtimes with user-selected modules.
  - Complete instance isolation: engines share zero mutable state.
- **Module Authoring API (`defineModule`)**:
  - Declarative module definition with `name`, `version`, `triggers`, `beforeMount`, and `afterMount`.
  - Module lifecycle hooks: `match`, `read` (pure extraction), `setup`, `update`, and `cleanup`.
  - Rich `ModuleContext` (`ctx`) providing encapsulated access to scope, store, DOM element, watch subscriptions, microtasks, handlers, and diagnostics.
- **7 Standard Unprivileged Modules (`src/modules/`)**:
  - `partials`: Modular wrapper for built-in sub-template expansion and slot projection.
  - `conditionals`: Static and reactive (`data-live`) branching supporting `is-gt`, `is-lt`, `is-gte`, `is-lte`, `is-eq`, `is-neq`, and `is-truthy`.
  - `loops`: Static and reactive (`data-live`) list rendering with prototypal item scopes and diff strategies (`simple`, `lcs`, `replace`).
  - `text`: Reactive text (`data-text`) and attribute templates (`{x}` / `data-x`) with URL protocol sanitization.
  - `show`: Reactive visibility toggle (`data-show`) via native `hidden` property without modifying inline styles.
  - `model`: Two-way form binding (`data-model`) with cursor preservation and input classification (text, number, checkbox, radio, select).
  - `events`: Delegated event dispatch (`data-on-*`) with key modifiers and prototype-pollution guards.
- **Dedicated Subpath Package Exports**:
  - `lime-csr-js`: Public facade, store, diagnostics, and standard modules.
  - `lime-csr-js/core`: Kernel primitives (`createEngine`, `defineModule`, triggers, scope).
  - `lime-csr-js/modules`: Standard module factories.
  - `lime-csr-js/modules/*`: Granular single-module imports.
  - `lime-csr-js/dist`: Minified ESM production bundle.
- **Documentation System Overhaul**:
  - Complete technical reference in `DOCS.md`.
  - LLM orientation in `llms.txt` and comprehensive technical manual in `llms-full.txt`.

### Changed
- **Production Bundle Size**:
  - `dist/index.min.js` decreased from **59.0 kB to 47.0 kB** (**-20.3% reduction**, 12.0 kB saved) by eliminating duplicate monolithic rendering code.
  - Standalone Micro-Kernel `dist/core.min.js` is **28.7 kB**.
  - Tarball package size is **124.0 kB** (unpacked: **429.9 kB**).
  - Packaged files: **42 files** across `src/`, `dist/`, and documentation.
- **Root Public Surface Cleanliness**:
  - Root package now exports **exactly 34 clean symbols** strictly classified into Facade (3), Store & Utilities (3), Template & Security (7), Diagnostics (7), Kernel Primitives (7), and Standard Modules (7).
- **`defaultEngine` Visibility**:
  - Made a private internal runtime singleton; no longer leaked as a public export.

### Removed (Breaking Changes)
- **Legacy Plugin System Removed**:
  - `definePlugin()`, `PLUGIN_API_VERSION`, and the `plugins` option in `mount()` are completely removed.
  - Unprivileged Modules (`defineModule` + `createEngine`) are the sole extension mechanism.
- **Monolithic Pipeline Helpers Removed from Public Exports**:
  - Removed internal renderer functions: `evalCondition`, `processAllIfs`, `OPERATORS`, `expandLoops`, `expandPartials`, `setupBindings`, `setupModelBindings`, `setupShowBindings`, `setupEventBindings`, `setupLiveIfs`, `setupLiveFors`.
  - Removed deleted monolithic source files: `src/conditionals.js`, `src/loops.js`, `src/partials.js`, `src/bindings*.js`, `src/plugins.js`.

---

## [0.2.10] - 2026-07-16
- Previous stable monolithic release before the Micro-Kernel refactor.
