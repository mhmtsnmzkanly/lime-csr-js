# Lime CSR examples

These examples use the public Lime CSR v0.6.4 API: a small HTML-first
runtime built around a reactive Store, declarative modules, and standard DOM
APIs. They are intentionally small and runnable without a build tool.

## Run locally

From the repository root, start any static server:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080/examples/>. A browser with ES modules is
required. The repository's example checks use Node and headless Chromium.

## Learning path

| Example | Concepts | Difficulty |
|---|---|---|
| [Counter](01-counter/) | Store, mount, text, events | Beginner |
| [Reactive profile](02-profile/) | Reactive attributes, show, leaf updates | Beginner |
| [Conditionals](03-conditionals/) | Static versus live `<if>` | Beginner |
| [Keyed list](04-keyed-list/) | Live `for`, keys, LCS, identity | Intermediate |
| [Forms](05-forms/) | Text, number, trim, checkbox, radio, select | Intermediate |
| [Events](06-events/) | Named handlers, payload data, key modifiers | Intermediate |
| [Partials and slots](07-partials-slots/) | Isolated data, default/named slots | Intermediate |
| [Nested composition](08-nested-composition/) | Partial A → partial B → projected content | Intermediate |
| [Refs](09-refs/) | Scalar/array refs and DOM order | Intermediate |
| [Computed cart](10-computed-cart/) | Computed values and dependencies | Intermediate |
| [Batch updates](11-batch/) | Coordinated Store changes | Intermediate |
| [Custom module](12-custom-module/) | `defineModule`, `attr`, alias-aware `ctx.watch` | Advanced |
| [Minimal engine](13-minimal-engine/) | Deliberately small custom runtime | Advanced |
| [Modular distribution](14-modular-dist/) | Core, Store, and individual dist modules | Advanced |
| [Diagnostics](15-diagnostics/) | `onDiagnostic`, `onError`, global diagnostics | Advanced |
| [Nested mounts](16-nested-mounts/) | Independent mounts and event boundaries | Advanced |
| [Todo app](17-todo-app/) | A complete small application | Intermediate |
| [Dashboard](18-dashboard/) | Composition of Store, computed data, lists, and cards | Advanced |
| [Full distribution](19-full-dist/) | The complete `dist/index.min.js` bundle | Advanced |
| [Operations dashboard](20-operations-dashboard/) | Async states, filtered records, editing, modal detail, and remounting | Advanced |
| [Googly eyes](googly-eyes.html) | Playful DOM integration and cleanup | Advanced |
| [Coffee journal](blog/) | A realistic multi-section application | Advanced |

The first eleven examples use the source entry point so the mechanics are
easy to inspect. The minimal-engine example constructs its own module set,
the modular example loads the published-style `dist/` files, and the larger
apps use the full public facade. See the repository [README](../README.md)
and [DOCS.md](../DOCS.md) for complete API documentation.
