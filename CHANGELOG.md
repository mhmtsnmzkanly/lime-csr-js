# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
