# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.0] - 2026-09-11

### Major Architecture Milestone: Unprivileged Micro-Kernel

Version `0.3.0` is a landmark release that refactors `lime-csr-js` from an ad-hoc monolithic rendering engine into a modular, unprivileged Micro-Kernel architecture. The Kernel contains zero feature-specific rendering knowledge; all built-in directives (conditionals, loops, partials, text, visibility, two-way form binding, and event delegation) are discrete unprivileged modules.

### Added
- **Unprivileged Micro-Kernel (`src/core/`)**:
  - Generic trigger primitives: `attr()`, `attrs()`, `tag()`, and `pattern()`.
  - Compiled Partitioned Router with $O(1)$ indexed lookup by trigger type and execution phase.
  - Deterministic module precedence: `modules[0] > modules[1] > ... > modules[N]` resolved at compile time with development shadowing diagnostics (`MODULE_TRIGGER_OVERRIDDEN`).
  - Prototypal lexical scope system (`createScope`) with native property shadowing and $O(1)$ instantiation.
  - Isolated scopes for partials (`createIsolatedScope`) ensuring component encapsulation.
  - Unified LIFO cleanup stack per element and subtree, guaranteeing fault-isolated, idempotent teardown.
  - Asynchronous deactivation: Pending microtasks abort automatically if cleanup executes first.
- **Engine Runtime (`createEngine`)**:
  - Compile custom, isolated runtimes with user-selected modules.
  - Complete instance isolation: engines share zero mutable state.
- **Module Authoring API (`defineModule`)**:
  - Declarative module definition with `name`, `version`, `triggers`, `beforeMount`, and `afterMount`.
  - Module lifecycle hooks: `match`, `read` (pure extraction), `setup`, `update`, and `cleanup`.
  - Rich `ModuleContext` (`ctx`) providing encapsulated access to scope, store, DOM element, watch subscriptions, microtasks, and diagnostics.
- **7 Standard Unprivileged Modules (`src/modules/`)**:
  - `partials`: Sub-template expansion with isolated scopes and shared store.
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
  - `dist/index.min.js` decreased from **59.0 kB to 42.0 kB** (**-28.8% reduction**, 17.0 kB saved) by eliminating duplicate monolithic rendering code.
  - Tarball package size decreased from **134.0 kB to 96.5 kB** (**-28.0% reduction**).
  - Packaged files reduced from 39 to 29.
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
