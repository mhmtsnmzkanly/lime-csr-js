# lime-csr.js — Technical Reference

This is the full technical reference for lime-csr.js: every template feature,
the Store API, the Mount API, lifecycle hooks, every dev-mode error code, and
the known limitations of the engine. It assumes you've read the philosophy
and quick-feature-tour in [README.md](README.md) — content that already
lives there (why lime-csr exists, the Alpine.js comparison) is **not
repeated here**.

Every code example on this page is written against the real, current API in
`src/`. Documentation and implementation are expected to agree. A mismatch is
a bug; please report it with a minimal reproduction.

## Table of contents

1. [Quick start](#1-quick-start)
2. [Core concept](#2-core-concept)
3. [Template syntax](#3-template-syntax)
   - [3.1 `${path}` — static interpolation](#31-path--static-interpolation)
   - [3.2 `data-text` — reactive text](#32-data-text--reactive-text)
   - [3.3 `{x}` / `data-x` — reactive attribute binding](#33-x--data-x--reactive-attribute-binding)
   - [3.4 `data-model` — two-way form binding](#34-data-model--two-way-form-binding)
   - [3.5 `data-show` — visibility toggle](#35-data-show--visibility-toggle)
   - [3.6 `<if>` / `<else>` — conditional rendering](#36-if--else--conditional-rendering)
   - [3.7 `<if data-live>` — reactive conditional](#37-if-data-live--reactive-conditional)
   - [3.8 `<for each as>` — static list rendering](#38-for-each-as--static-list-rendering)
   - [3.9 `<for data-live>` — reactive list rendering](#39-for-data-live--reactive-list-rendering)
   - [3.10 `<partial>` — template composition](#310-partial--template-composition)
   - [3.11 `data-on-*` — event handling](#311-data-on---event-handling)
   - [3.12 `data-lime-ignore` — escape hatch for third-party markup](#312-data-lime-ignore--escape-hatch-for-third-party-markup)
4. [Store API](#4-store-api)
5. [Mount API](#5-mount-api)
6. [Lifecycle hooks](#6-lifecycle-hooks)
7. [Error codes](#7-error-codes)
8. [Known limitations](#8-known-limitations)
9. [Architecture (reference)](#9-architecture-reference)

---

## 1. Quick start

One HTML file. No build, no npm install, no config file. Save this, open it
in a browser (or serve it — `file://` works fine for `<script type="module">`
as long as your browser allows local module imports), and it runs.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>lime-csr quick start</title>
</head>
<body>
  <div id="app"></div>

  <template id="tpl-hello">
    <h1>Hello, ${name}!</h1>
  </template>

  <script type="module">
    import { createStore, mount } from './src/index.js';

    const store = createStore({});
    mount('hello', { target: document.getElementById('app'), context: { name: 'World' }, store });
  </script>
</body>
</html>
```

That's it. No webpack, no Vite, no `package.json`, no `node_modules`. The
`<template id="tpl-hello">` is standard HTML; `${name}` is resolved once from
the context object (`{ name: 'World' }`) you pass to `mount()`; the result is
appended into `#app`.

For anything reactive — text/attributes/lists that update when data
changes — see [§3 Template syntax](#3-template-syntax); everything reactive
lives in the `store` (the 4th argument), not in the context object.

---

## 2. Core concept

The entire engine rests on one rule:

> **No `data-*` (or special tag) → the engine never touches the element. It
> stays plain, static HTML.**

|                     | No `data-*`                          | Has `data-*`                            |
|---------------------|---------------------------------------|------------------------------------------|
| Source              | **context** (a plain JS object)       | **store** (`createStore(...)`)          |
| Resolved            | Once, at render time                  | Continuously — re-applied on every change |
| Syntax              | `${path}`                             | `data-text`, `{x}`/`data-x`, `data-model`, `data-show`, `data-live`, `data-on-*` |
| Watched afterward?  | Never                                 | Yes, via `store.subscribe`               |

Special tags (`<if>`, `<for>`, `<partial>`) follow the same split: without
`data-live`, they resolve once from context and leave no trace in the final
DOM; with `data-live`, they subscribe to the store and re-run on change.

### Engine flow

```
mount(name, { target, context, store, ... })
        │
        ▼
┌────────────────────────────┐
│ 1. STRUCTURAL PIPELINE      │  <partial> → <for> → <if>/<else>
│    (reads context only)     │  looped until no special tag remains
└──────────────┬───────────────┘
               │
               ▼
┌────────────────────────────┐
│ 2. STATIC INTERPOLATION     │  remaining top-level ${path} resolved
│    (reads context only)     │  once, from context
└──────────────┬───────────────┘
               │
               ▼
┌────────────────────────────┐
│ 3. REACTIVE BINDINGS        │  data-model → data-text/{x} → data-show
│    (reads + subscribes to   │  <for data-live>  → <if data-live>
│     the store)              │  (nested live-blocks recurse through
│                              │   this same pipeline per branch/item)
└──────────────┬───────────────┘
               │
               ▼
      target.appendChild(fragment)   ← nothing is visible before this point
               │
               ▼
┌────────────────────────────┐
│ 4. EVENT DELEGATION         │  data-on-* — only if options.handlers
│    (outside the pipeline)   │  was given to mount()
└──────────────┬───────────────┘
               │
               ▼
      ╔════════════════════════╗
      ║ store.set(path, value) ║ ──▶ notify subscribers ──▶ only the
      ╚════════════════════════╝     bound DOM nodes update — nothing
                                      else re-renders
```

The exact rationale for each step's position in this order is in
[§9 Architecture](#9-architecture-reference).

---

## 3. Template syntax

The template syntax is split into two categories to help you learn and prioritize:
- **Essentials (start here)**: `${path}` (§3.1), `data-text` (§3.2), `data-model` (§3.4), `<if>`/`<else>` (§3.6), `<for>` (§3.8), and `<partial>` (§3.10). These six cover most typical use cases.
- **Advanced (reach for when needed)**: `{x}`/`data-x` (§3.3), `data-show` (§3.5), `<if data-live>` (§3.7), `<for data-live>` (§3.9), `data-on-*` (§3.11), lifecycle hooks (§6), container mode (`el=`), and `store.computed` (§4.6).

### 3.1 `${path}` — static interpolation

Prints a value from **context** once; never watched again.

**Syntax**
```html
<h1>${path}</h1>
<a href="/posts/${post.slug}">${post.title}</a>
```

**Parameters**
- `path` (string): a dotted path, e.g. `post.title`. Resolved via
  `getByPath` against the **context** object passed to `render`/`mount` —
  never the store. Missing/`null`/`undefined` resolves to an empty string
  (no crash, no warning).

**Behavior**
`${...}` is only ever a path — never an expression. It's resolved by
`resolveStatic` after all structural tags (`<partial>`/`<for>`/`<if>`) are
expanded, so `${item.x}` inside a `<for>` correctly sees the loop's item
context. Resolved values are written raw into `textContent`/attribute
values — since neither of those parses HTML, this is XSS-safe without any
extra escaping.

**Example**
```html
<template id="tpl-card">
  <div class="card">
    <strong>${user.name}</strong>
    <span>${user.role}</span>
  </div>
</template>
```
```js
mount('card', { target, store, context: { user: { name: 'Ada', role: 'Engineer' } } });
```

**⚠ Common mistakes**
```
WRONG:  <p>${count + 1}</p>
        -- Not an expression. "count + 1" is treated as a literal path
           segment, which won't exist in context → renders as empty.

RIGHT:  <p>${incrementedCount}</p>
        -- Compute it in JS first and put the result in context:
           mount('page', { target, store, context: { incrementedCount: count + 1 } })
```
```
WRONG:  <span>${user.name}</span>
        store.set('user.name', 'New Name');  // <-- nothing happens on screen

RIGHT:  <span data-text="user.name"></span>
        store.set('user.name', 'New Name');  // <-- updates automatically
        -- ${...} is resolved ONCE from context and never re-evaluated.
           Use data-text (§3.2) for anything that needs to react to state.
```

---

### 3.2 `data-text` — reactive text

Binds an element's text content to a **store** path.

**Syntax**
```html
<span data-text="path"></span>
```

**Parameters**
- `data-text` (string, required): a **store** path (not context). Empty →
  `BINDING_MISSING_PATH` warning, no binding is set up.

**Behavior**
Sets `el.textContent = store.get(path)` immediately, then subscribes to
`path` — every subsequent `store.set(path, ...)` updates the text. Uses
`el.textContent`, never `innerHTML`: the value is never parsed as HTML, so
it can't inject markup or scripts — no manual escaping is needed or wanted.
The same store path can be bound on multiple elements; all of them update
together. `null`/`undefined` render as an empty string.

**Example**
```html
<span data-text="likeCount"></span> likes
```
```js
const store = createStore({ likeCount: 12 });
mount('page', { target, store });
store.set('likeCount', 13); // the span updates automatically
```

**⚠ Common mistakes**
```
WRONG:  <span data-text="post.title"></span>
        mount('page', { target, store, context: { post: { title: 'Hello' } } });
        -- Renders empty. data-text ALWAYS reads from the STORE, never
           context — "post" only exists in context here, not in the store.

RIGHT:  const store = createStore({ post: { title: 'Hello' } });
        mount('page', { target, store });
        <span data-text="post.title"></span>
        -- Put reactive data in the store. If it's genuinely static and
           never needs to change, use ${post.title} (§3.1) instead.
```

---

### 3.3 `{x}` / `data-x` — reactive attribute binding

Binds a placeholder inside an attribute value to a **store** path via a
matching `data-{name}` attribute.

**Syntax**
```html
<a href="/user/{handle}" data-handle="user.handle">Profile</a>
```

**Parameters**
- `{name}` — a placeholder inside any attribute value (except `data-*`
  attributes themselves, which are the binding's *source*, not target).
- `data-{name}` (string, required) — the matching store path. Missing →
  `BINDING_MISSING_DATA_ATTR` warning, that binding is skipped.
- `name` must NOT be a reserved word: `text`, `model`, `show`, `live`,
  `ref`, `diff`, or anything starting with `on-` → `RESERVED_ATTR_NAME`
  warning, binding rejected.

**Behavior**
Name-matching, not position-matching: `{handle}` is fed by `data-handle`.
An attribute can hold multiple placeholders (`href="/u/{a}/post/{b}"`) —
each needs its own `data-a`/`data-b`. The **whole attribute template is
kept in memory** and **re-filled from scratch** (not find-and-replace)
whenever ANY of its referenced store paths changes — this is what makes
combining static text and multiple reactive placeholders in one attribute
value correct after a partial update. Once binding is set up, the consumed
`data-{name}` attributes are removed from the DOM (clean output); a
`data-ref="lcsr-N"` handle is added in their place for internal bookkeeping
— you don't write `data-ref` yourself. If the target attribute is one of
`href`, `src`, `action`, `formaction`, `data`, `cite`, `poster`, `ping`, the
resolved value is checked against a URL protocol whitelist
(`http(s)://`, root-relative `/...`, `#...`) before being written —
`javascript:`/`data:`/other dangerous schemes resolve to an empty string
instead of being set.

**Example**
```html
<a href="/user/{a}/post/{b}" data-a="user.handle" data-b="post.id">View post</a>
```

**⚠ Common mistakes**
```
WRONG:  <a href="{link}" data-link="dangerousUrl"></a>
        store.set('dangerousUrl', 'javascript:alert(1)');
        -- href silently becomes "" (protocol rejected). Not an error, not
           a warning — just blocked. Don't rely on this attribute "working"
           for arbitrary store-controlled URLs; treat it as protocol-filtered.

RIGHT:  Only feed URL attributes with values you've validated are meant to
        be links (root-relative paths, http(s) URLs, #anchors).
```
```
WRONG:  <span title="{text}" data-text="msg"></span>
        -- "text" is a RESERVED placeholder name → RESERVED_ATTR_NAME
           warning, this binding never gets set up.

RIGHT:  <span title="{msg}" data-msg="msg"></span>
        -- Reserved names: text, model, show, live, ref, diff, and anything
           starting with "on-". Pick a different placeholder name.
```

---

### 3.4 `data-model` — two-way form binding

Binds a form element to a store path in **both** directions: typing/checking
writes to the store, and the store changing updates the element.

**Syntax**
```html
<input type="text" data-model="path">
```

**Parameters**
- `data-model` (string, required): a store path. Empty → `MODEL_MISSING_PATH`
  warning.

**Behavior** is per input kind — each binds a different DOM event and reads/writes a different shape:

#### text / textarea (default)
```html
<input type="text" data-model="user.name">
<textarea data-model="post.body"></textarea>
```
Event: `input`. Writes `el.value` (string) to the store on every keystroke;
writes back to `el.value` on external store changes (subject to the cursor
protection below).

#### number / range
```html
<input type="number" data-model="age">
<input type="range" min="0" max="100" data-model="volume">
```
Event: `input`. Writes `Number(el.value)` to the store — so a numeric
comparison like `is-gt="age" than="18"` works directly on it. Exception: if
the field is empty or not yet a valid number (e.g. `"-"` or `"1."` mid-typing),
the **raw string** is stored instead, so a half-typed value is never
silently lost or coerced to `0`/`NaN`.

#### checkbox
```html
<input type="checkbox" data-model="agree">
```
Event: `change`. Writes `el.checked` (boolean) to the store; the box is
checked/unchecked to match the store's truthiness.

#### radio
```html
<input type="radio" name="plan" value="free" data-model="plan">
<input type="radio" name="plan" value="pro"  data-model="plan">
```
Event: `change`. All radios sharing the same `data-model` path form a
group bound with **one shared subscription** (not one per radio) — the
checked radio's `value` is written to the store; setting the store path
checks whichever radio's `value` matches and unchecks the rest.

#### select (single)
```html
<select data-model="city">
  <option value="ist">Istanbul</option>
  <option value="ank">Ankara</option>
</select>
```
Event: `change`. Writes `el.value` (string) to the store, same as text inputs.

#### select (multiple)
```html
<select multiple data-model="tags">
  <option value="a">A</option>
  <option value="b">B</option>
</select>
```
Event: `change`. Writes an ARRAY of the selected options' `value`s to the
store; setting the store path to an array selects the matching options and
deselects the rest.

**Cursor protection** (applies to all kinds above): writing from the store
back to the DOM is skipped if the element's current value already matches
(`el.value === next`) — this is what keeps the text cursor from jumping to
the end while the user is typing (the store-set that a keystroke itself
triggers would otherwise immediately write the "same" value back).

**Example**
```html
<input type="text" data-model="user.name">
<input type="number" data-model="age">
<input type="checkbox" data-model="agree">
<input type="radio" name="plan" value="free" data-model="plan">
<input type="radio" name="plan" value="pro"  data-model="plan">
<select data-model="city"><option value="ist">Istanbul</option></select>
<select multiple data-model="tags"><option value="a">A</option></select>
```

**⚠ Common mistakes**
```
WRONG:  <input data-model="items.2.name">
        -- INDEXED_MODEL_PATH warning. If "items" is ever reordered or an
           earlier item removed, index 2 silently starts pointing at the
           WRONG item (the path doesn't move with the data).

RIGHT:  Use a reactive <for data-live key="item.id"> loop and bind
        data-model to the LOOP VARIABLE's own field instead of a
        store-array-index path:
        <for each="items" as="item" key="item.id" data-live>
          <input data-model="???">  <!-- see note below -->
        </for>
        -- data-model still needs a STORE path, so in practice this means
           giving each item its own addressable store location (e.g. a
           store keyed by id: store.set(`items.byId.${item.id}.name`, …))
           rather than a positional array index.
```
```
WRONG:  const list = store.get('todos');
        list.push(newTodo);
        store.set('todos', list);  // <-- SAME array reference as before
        -- IN_PLACE_MUTATION warning; store.set() returns false and NO
           subscriber fires (Object.is(existing, value) is true — the
           store can't tell anything changed). Any data-model/data-text/
           <for data-live> bound to "todos" silently does not update.

RIGHT:  store.set('todos', [...store.get('todos'), newTodo]);
        -- Always pass a NEW array/object reference on mutation.
```

---

### 3.5 `data-show` — visibility toggle

Shows/hides an element with the native `hidden` attribute, without ever
removing it from the DOM.

**Syntax**
```html
<div data-show="path">...</div>
```

**Parameters**
- `data-show` (string, required): a store path. Empty → `SHOW_MISSING_PATH`
  warning.

**Behavior**
When `store.get(path)` is falsy Lime adds `hidden`; when it is truthy Lime
removes `hidden`. `data-show` becomes authoritative after binding, including
when the template initially contains `hidden`. It is always reactive (there's
no static/one-time variant; for that, use ordinary HTML/CSS).

Lime never reads, clears, overwrites, remembers, or restores inline
`style.display`. Application styles and the browser remain responsible for the
visible layout, so `display:grid`, `display:flex`, and stylesheet-derived
layouts survive every visibility transition unchanged. Lime installs at most
one scoped rule per document when a managed `data-show` binding is present:

```css
[data-show][hidden] { display: none !important; }
```

The scope prevents a utility such as `.d-flex { display:flex !important; }`
from keeping a hidden Lime-managed element visible without changing global
`[hidden]` behavior or arbitrary application styles. The rule is installed
before mounted content is appended, and the initial `hidden` state is also
applied while the fragment is detached, preventing an initial visibility
flash (FOUC).

Unlike `<if data-live>` (§3.7), the element is **never removed** — its DOM
identity, any input values inside it, scroll position, and CSS transition
state all survive a toggle. This is the right tool for modals, accordions,
and tabs.

**Example**
```html
<div class="d-flex" data-show="visible">
  <input type="text" placeholder="stays intact across toggles">
</div>
```

**⚠ Common mistakes**
```
WRONG:  <div data-show="count > 0"></div>
        -- Not an expression. "count > 0" is treated as a literal store path,
           which won't exist -> resolves to falsy (hidden).

RIGHT:  store.computed('hasCount', ['count'], () => store.get('count') > 0);
        <div data-show="hasCount"></div>
        -- Precompute the condition with a computed path in the store.
```
```
WRONG:  <div data-show="user.name"></div>
        mount('page', { target, store, context: { user: { name: 'Ada' } } });
        -- Renders hidden. data-show reads from the STORE, never context.

RIGHT:  const store = createStore({ user: { name: 'Ada' } });
        <div data-show="user.name"></div>
        -- Put reactive data in the store.
```

---

### 3.6 `<if>` / `<else>` — conditional rendering

Statically selects one of two content branches based on a condition
evaluated against **context**.

**Syntax**
```html
<if is-gt="path" than="value">
  ...then content...
  <else>
    ...else content...
  </else>
</if>
```

**Parameters** — exactly one operator attribute, plus `than`/`to` for the
right-hand side (`is-truthy` ignores it):

| Operator | Meaning |
|---|---|
| `is-gt` | left `>` right (numeric) |
| `is-lt` | left `<` right (numeric) |
| `is-gte` | left `>=` right (numeric) |
| `is-lte` | left `<=` right (numeric) |
| `is-eq` | left `===` right (string comparison) |
| `is-neq` | left `!==` right (string comparison) |
| `is-truthy` | `Boolean(left)` — no right-hand side |

The operator's attribute VALUE is a **context** path (`is-gt="score"` reads
`context.score`); `than`/`to` is a raw **literal** string, never a path.

**Behavior**
`<else>` is a **wrapper**, not a self-closing marker — `<else></else>`.
Among `<if>`'s DIRECT children, everything EXCEPT the `<else>` element is
the "then" group; `<else>`'s own children are the "else" group. Neither
`<if>` nor `<else>` remain in the final DOM — only the winning content is
left in place. Processing is outer-to-inner (an inner `<if>` waits until
its ancestor `<if>` resolves). If content follows `<else>` at the same
level, a tolerant warning (`ELSE_AFTER_CONTENT`) is issued but it still
works (that content is simply counted as "then").

**Example**
```html
<if is-gt="commentCount" than="0">
  <p>${commentCount} comments</p>
  <else>
    <p>No comments yet.</p>
  </else>
</if>
```

**⚠ Common mistakes**
```
WRONG:  <if is-truthy="loggedIn">
          <p>Welcome</p>
          <else/>
          <p>Please log in</p>
        </if>
        -- HTML5 does not treat <else/> as a void element. The parser
           swallows everything after it (including the real content and
           the closing </if>) INTO the self-closed <else>, corrupting the
           structure in ways that are hard to predict.

RIGHT:  <if is-truthy="loggedIn">
          <p>Welcome</p>
          <else>
            <p>Please log in</p>
          </else>
        </if>
        -- Always write <else>...</else> as a full wrapper.
```
```
WRONG:  <div>
          <if is-truthy="x">
        </div>
          <p>content</p>
        </if>
        -- <else>/<if> must nest cleanly within normal HTML structure; an
           <if> spanning across an unrelated element's boundary produces
           unpredictable DOM (the parser will auto-close/reparent things).

RIGHT:  Keep <if>...</if> (and any <else> inside it) fully nested within a
        single parent element, like any other HTML tag pair.
```

Also see [§9](#9-architecture-reference) for the `<table>` **foster-parenting**
trap: an `<if>`/`<for>`/`<else>` written directly inside `<table>` (not
inside a `<tr>`/`<td>`) gets silently relocated by the HTML parser itself,
before lime-csr ever sees it. Detected in dev-mode (`TABLE_FOSTER_PARENTING`),
not fixable at the engine level — move the tag outside `<table>` instead.

---

### 3.7 `<if data-live>` — reactive conditional

The reactive counterpart of `<if>`: re-evaluates and swaps branches
whenever the condition's **store** path changes.

**Syntax**
```html
<if is-gt="path" than="value" data-live>
  ...
  <else>...</else>
</if>
```

**Parameters** — same operator/`than`/`to` rules as `<if>` (§3.6), except
the operator's LEFT side is now a **store** path (not context), plus:

- `data-live` (empty or a path): empty → tracks the operator's own path
  (`is-gt="count"` → watches `"count"`). Set to an explicit path
  (`data-live="x"`) to watch something other than/in addition to the
  operator's own path — needed if the condition depends on more than one
  store value.
- `el` (optional, tag name): wraps branch content in a persistent
  container element instead of bare comment anchors — see "Container mode" below.
- `data-after` / `data-before` (optional, handler names): see [§6](#6-lifecycle-hooks).

**Behavior**
`than`/`to` is **always** static/literal, even if it looks like a path —
it is never tracked from the store. When the condition changes, the ACTIVE
BRANCH IS COMPLETELY TORN DOWN and rebuilt: input focus, scroll position,
and any DOM identity inside it are lost. If the condition re-evaluates to
the SAME truthiness as before, nothing happens (no teardown, no hooks fire).

**Container mode (`el="tag"`)**: without `el`, the branch is placed between
two fixed HTML comment anchors (`<!-- live-if:ref --> ... <!-- /live-if:ref -->`).
With `el="div"` (or any tag), branch content instead goes inside a real
`<div>` element that is **created once and never recreated** across
switches — useful when you need one stable DOM node to attach a
CSS transition class to, or to pass to a third-party widget. Any
non-reserved attribute on `<if>` (e.g. `class`, `id`) is copied onto that
container.

**Example**
```html
<if is-gt="commentCount" than="0" data-live>
  <p><span data-text="commentCount"></span> comments so far.</p>
  <else>
    <p>Be the first to comment!</p>
  </else>
</if>
```
```html
<!-- container mode, for a chart that needs a stable mount point -->
<if is-truthy="showChart" data-live el="div" class="chart-box"
    data-after="initChart" data-before="destroyChart">
  <canvas></canvas>
</if>
```

**⚠ Common mistakes**
```
WRONG:  <if is-gt="user.score" than="user.limit" data-live>
        -- "user.limit" is NOT tracked — than/to is always a literal. If
           user.limit changes in the store, this <if> does NOT re-evaluate,
           even though it looks like a reactive comparison of two paths.

RIGHT:  store.computed('scoreOverLimit', ['user.score', 'user.limit'],
          () => store.get('user.score') > store.get('user.limit'));
        <if is-truthy="scoreOverLimit" data-live>
        -- Precompute the comparison into a single derived path (§4.6) and
           track THAT with data-live.
```

---

### 3.8 `<for each as>` — static list rendering

Renders a list once, from a **context** array; never updates afterward.

**Syntax**
```html
<for each="path" as="item">
  ...
</for>
```

**Parameters**
- `each` (string, required): a context path resolving to an array.
- `as` (string, required): the variable name each item is bound to inside the loop.
- `index` (string, optional): if given, also binds the item's 0-based
  position under this name.

**Behavior**
**Inherited context** — the defining difference from `<partial>` (§3.10):
the parent context is preserved, `as` (and `index`) is merely added on top
(`{ ...context, [as]: item }`). Accessing outer variables
(`${post.title}` inside a `<for>` over `post.comments`) works naturally. In
a nested `<for>`, the inner loop's `as` shadows the outer one for its own
scope. An empty array removes `<for>` silently (not an error); if `each`
doesn't resolve to an array at all, a warning (`FOR_NOT_ARRAY`) is issued
and `<for>` is removed.

**Example**
```html
<for each="comments" as="comment" index="i">
  <p>${i}. ${comment.body} — by ${author.name}</p>
  <!-- "author" here comes from the OUTER context, not from "comment" -->
</for>
```

**⚠ Common mistakes**
```
WRONG:  <for each="items" as="item">
          <li><span data-text="item.name"></span></li>
        </for>
        mount('page', { target, store });
        -- data-text attempts to read from the store, but static <for> only
           binds "item" in the static context. Inside the store, there is
           no path named "item.name" -> renders empty.

RIGHT:  <for each="items" as="item">
          <li><span>${item.name}</span></li>
        </for>
        -- Use static interpolation ${item.name} for static loops. If the list
           needs to be reactive, use `<for data-live>` instead.
```
```
WRONG:  <for each="todos" as="todo">
          <li>${todo.text}</li>
        </for>
        store.set('todos', [...]); // expecting DOM to update
        -- Since the loop lacks the `data-live` attribute, it is parsed once
           from context and never updates on store changes.

RIGHT:  <for each="todos" as="todo" key="todo.id" data-live>
          <li>${todo.text}</li>
        </for>
        -- Use data-live and key to make a loop reactive.
```

---

### 3.9 `<for data-live>` — reactive list rendering

The reactive counterpart of `<for>`: updates the DOM via a key-based diff
whenever the **store** array changes.

**Syntax**
```html
<for each="path" as="item" key="item.idPath" data-live>
  ...
</for>
```

**Parameters** — same `each`/`as`/`index` as §3.8 (now `each` is a **store**
path), plus:

- `key` (string, **required**): a path, evaluated per item, that uniquely
  identifies it (e.g. `item.id`). Missing → `FOR_MISSING_KEY` warning,
  `<for>` is removed WITHOUT becoming reactive (fails safe, doesn't guess).
  A key value that collides with another item's → `FOR_DUPLICATE_KEY`
  warning, the duplicate is skipped.
- `data-diff` (optional: `simple` | `lcs` | `replace`; default `simple`):
  which reconcile strategy to use (see table below). An unrecognized value
  → `UNKNOWN_DIFF_STRATEGY` warning, falls back to `simple`.
- `el` (optional, tag name): wraps ALL item blocks in one persistent
  container — same mechanism as `<if data-live el=...>` (§3.7), but here it
  wraps the whole list, not each item.
- `data-after` / `data-before` (optional, handler names): fire **per item**
  added/removed — see [§6](#6-lifecycle-hooks).

**Identity is always preserved for surviving keys**: the same `key` always
maps to the same DOM node, moved via `insertBefore` when its position
changes — never destroyed and recreated. If a field inside an item
genuinely changes, reflect that through a reactive binding
(`data-text`/`{x}`) inside the item template — the loop itself never
re-renders a surviving key just because the underlying object reference
changed (most immutable-update patterns build fresh objects on every
change even when content is identical, so reference-equality is not a
reliable signal of "this item's content changed").

**Diff strategies:**

| `data-diff` | What it does | When to use |
|---|---|---|
| *(omitted)* / `simple` | Forward pass; each item is left alone if already immediately after the previous one, otherwise moved to the end. Cheap, correct, but only catches LOCALLY-adjacent no-ops — one item moved far can cascade into moving everything after it. | Default. Fine for most lists, especially ones that mostly append/remove rather than reorder. |
| `lcs` | Computes the Longest Increasing Subsequence of survivors' old positions; only items OUTSIDE that subsequence are moved — a globally minimal set of DOM operations for the given reorder. | Lists with frequent, non-trivial reordering (drag-to-reorder, sortable columns) where minimizing DOM churn/focus loss matters. |
| `replace` | No diffing at all — every existing item is torn down (`cleanup()` + DOM removal) and the whole list is rendered from scratch, every single reconcile. Identity is NEVER preserved, even for a key that "didn't change." | Very large lists where per-item DOM identity doesn't matter (e.g. a read-only log viewer) and the bookkeeping cost of diffing isn't worth it. |

Regardless of strategy, an **append fast-path** applies automatically
whenever the old key list is an exact prefix of the new one (the common
"new item(s) added to the end" case): only the new tail items are rendered
and inserted — zero cost for the untouched prefix, and neither `simple` nor
`lcs`'s full algorithm even runs. `replace` does not use this fast-path (by
design — it always rebuilds everything). None of this needs to be turned on
explicitly; it's automatic.

**Example**
```html
<for each="comments" as="comment" key="comment.id" data-live data-diff="lcs">
  <partial name="comment" data="comment"></partial>
</for>
```

**⚠ Common mistakes**
```
WRONG:  const items = store.get('items');
        items.push(newItem);
        store.set('items', items);  // <-- SAME array reference
        -- IN_PLACE_MUTATION warning; store.set() returns false, no
           subscriber fires — the list silently does not update.

RIGHT:  store.set('items', [...store.get('items'), newItem]);
```
```
WRONG:  <for each="items" as="item" data-live>
          <li>${item.name}</li>
        </for>
        -- FOR_MISSING_KEY warning; <for> is removed WITHOUT becoming
           reactive (renders once, like a static <for>, then never updates).

RIGHT:  <for each="items" as="item" key="item.id" data-live>
          <li>${item.name}</li>
        </for>
```
```
WRONG:  <for each="items" as="item" key="item.category" data-live>
        -- if two items share the same category, FOR_DUPLICATE_KEY warns
           and only the FIRST one with that key is kept.

RIGHT:  Use a genuinely unique field (usually an id) as the key.
```

---

### 3.10 `<partial>` — template composition

Expands a named template into the current one, with an **isolated**
context of its own.

**Syntax**
```html
<partial name="templateName" data="path"></partial>
```

**Parameters**
- `name` (string, required): the target template's name (looked up as
  `<template id="tpl-{name}">`). Missing → `PARTIAL_MISSING_NAME` warning.
  Not found → `PARTIAL_NOT_FOUND` warning, `<partial>` is removed.
- `data` (string, optional): a **parent-context** path resolving to an
  object — becomes the ENTIRE base context inside the partial. Parent
  context is otherwise completely invisible inside the partial. Omitted →
  base context is `{}`.
- any OTHER attribute (except ones starting with `data-`, reserved for the
  engine) is a **prop**: its value is a parent-context path, resolved and
  added to the partial's context under the attribute's own name, on top of
  `data` (props win on a name collision).

**Behavior**
`<partial>` is fully isolated — unlike `<for>` (§3.8), it does NOT inherit
the parent context. Recursive partials are supported (a comment reply is
itself a comment) up to `MAX_DEPTH = 50`; beyond that, remaining
`<partial>`s are removed and a `PARTIAL_DEPTH_LIMIT` warning is issued
(protects against an accidental self-referencing partial). `<partial>`
leaves no trace in the final DOM — only its expanded content remains.

**Example**
```html
<template id="tpl-avatar">
  <span class="avatar" title="${name}">${name}</span>
</template>

<template id="tpl-comment">
  <partial name="avatar" data="author"></partial>
  <p>${body}</p>
</template>
```
```html
<!-- multi-prop: data (base) + two extra props -->
<partial name="like-button" data="post" action="likeAction" count="post.likeCount"></partial>
```

**Override example** — a prop with the SAME name as a field already present
in `data` wins (note: the prop's OWN attribute name can be anything except
`name`/`data` themselves, which are always reserved for the partial
selector and the base object):
```js
// context: { post: { label: 'from-data' }, altLabel: 'from-prop' }
```
```html
<template id="tpl-badge"><span>${label}</span></template>
<!-- data="post" resolves to {label:'from-data'}; the "label" prop below is
     added ON TOP of that base object, so it overrides the "label" data
     already carried — the badge renders "from-prop", not "from-data" -->
<partial name="badge" data="post" label="altLabel"></partial>
```

**⚠ Common mistakes**
```
WRONG:  <template id="tpl-loop">
          <partial name="loop"></partial>
        </template>
        -- No base case: recurses until MAX_DEPTH (50), then
           PARTIAL_DEPTH_LIMIT warns and the remaining <partial>s are
           removed. Page doesn't crash, but partially-expanded output
           is probably not what you want.

RIGHT:  Make sure every recursive partial (e.g. a comment → its replies)
        has a real base case: an array that eventually becomes empty
        (an empty replies list simply renders nothing further).
```
```
WRONG:  <partial name="card" data-source="post"></partial>
        -- "data-source" starts with "data-", so it's reserved for the
           ENGINE (data-model, data-text, etc.) and is silently NOT
           treated as a prop — ${source} inside the partial is undefined.

RIGHT:  <partial name="card" source="post"></partial>
        -- Prop attribute names must not start with "data-".
```

---

### 3.11 `data-on-*` — event handling

Attribute-based, eval-free event binding, resolved by NAME against a
handler dictionary — never an expression.

**Syntax**
```html
<button data-on-click="handlerName">...</button>
<input data-on-keydown-enter="save">  <!-- key-modified form -->
```

**Parameters**
- `data-on-{event}`: `{event}` must be one of the supported events below.
  Anything else → `UNKNOWN_EVENT` warning, ignored.
- The attribute VALUE is a **key** looked up in the `handlers` dictionary
  passed in `mount()`'s options (`{ handlers: { handlerName(event, el) {...} } }`).
  Not found at click-time → `HANDLER_NOT_FOUND` warning, no crash.

**Supported events**

| Attribute | DOM event | Notes |
|---|---|---|
| `data-on-click` | `click` | |
| `data-on-dblclick` | `dblclick` | |
| `data-on-input` | `input` | |
| `data-on-change` | `change` | |
| `data-on-submit` | `submit` | ALWAYS calls `preventDefault()` |
| `data-on-keydown` | `keydown` | fires for EVERY key; accepts a `-{key}` modifier |
| `data-on-keyup` | `keyup` | fires for EVERY key; accepts a `-{key}` modifier |

`focus`/`blur`/`mouseenter`/`mouseleave` are deliberately unsupported — they
don't bubble, so the single-delegated-listener design can't catch them.

**Key modifiers** — `keydown`/`keyup` only

`data-on-keydown-{key}` / `data-on-keyup-{key}` call the handler ONLY when
`event.key` matches the modifier; any other key silently does nothing. This
is the eval-free counterpart of Alpine's `x-on:keydown.enter` /
`@keydown.enter` — the modifier filters the key, the attribute value stays a
handler NAME. The modifier is matched case-insensitively and maps to
`event.key` as follows:

| Modifier | `event.key` | Modifier | `event.key` |
|---|---|---|---|
| `enter` | `Enter` | `up` | `ArrowUp` |
| `escape` | `Escape` | `down` | `ArrowDown` |
| `space` | `' '` (a space) | `left` | `ArrowLeft` |
| `tab` | `Tab` | `right` | `ArrowRight` |
| `delete` | `Delete` | `backspace` | `Backspace` |

Any other modifier (`data-on-keydown-foo`) → `UNKNOWN_KEY_MODIFIER` warning,
and the attribute is inert. Unmodified `data-on-keydown`/`data-on-keyup`
keeps firing for every key, and modified + unmodified attributes may coexist
on the same element — each is evaluated independently:

```html
<input data-on-keydown="draft" data-on-keydown-enter="save" data-on-keydown-escape="cancel">
<!-- every key → draft; Enter additionally → save; Escape additionally → cancel -->
```

Under the hood the modifier is parsed from the ATTRIBUTE name only — the
delegated DOM listener is always the base `keydown`/`keyup` type, shared by
all modified and unmodified variants.

**Behavior**
**Delegation, not per-element listeners**: ONE listener is set up per event
TYPE actually used across the whole page's templates (not one per
`data-on-*` element), attached to `mount()`'s `target`. This means elements
added later by a reactive `<for data-live>`/`<if data-live>` need **no
additional setup** — the single listener catches them via event bubbling
the moment they're clicked. A handler always receives `(event, element)` —
no context is injected; use `element.dataset` (paired with a
`data-id="${id}"`-style attribute on the same element) to identify which
item was interacted with, and reach the `store` via closure from wherever
`handlers` was defined. `data-on-submit` ALWAYS calls `preventDefault()`
(even if the handler isn't found) — this is a deliberate, non-configurable
default (no page reload on submit is the overwhelmingly common need). If
`options.handlers` isn't passed to `mount()` at all, the event system is
never set up (zero cost).

**Example**
```html
<button data-on-click="deleteItem" data-id="42">Delete</button>
```
```js
mount('page', {
  target, store, context: ctx,
  handlers: {
    deleteItem(event, el) {
      const id = el.dataset.id; // "42"
      store.update('items', (items) => items.filter((i) => i.id !== id));
    },
  },
});
```

**⚠ Common mistakes**
```
WRONG:  <button data-on-click="count++">Increment</button>
        -- Not an expression. "count++" is treated as a literal HANDLER
           NAME, looked up verbatim in the handlers dictionary — it will
           never be found (HANDLER_NOT_FOUND).

RIGHT:  <button data-on-click="increment">Increment</button>
        mount('page', {
          target, store, context: ctx,
          handlers: { increment(e, el) { store.update('count', (v) => v + 1); } },
        });
```
```
WRONG:  <input data-on-enter="save">
        -- A modifier without a base event. "enter" is not an event type
           (UNKNOWN_EVENT); the key modifier always rides on keydown or
           keyup.

RIGHT:  <input data-on-keydown-enter="save">
        -- base event (keydown) + key modifier (enter): the "save" handler
           fires only when event.key === 'Enter'.
```

---

### 3.12 `data-lime-ignore` — escape hatch for third-party markup

Marks an element and its entire subtree as invisible to the lime-csr engine.
The engine will not process any `${...}`, `data-*` attributes, or special
tags (`<if>`, `<for>`, `<partial>`) inside an ignored block — useful for
embedding third-party widgets that manage their own DOM and data-* attributes.

**Syntax**
```html
<div data-lime-ignore>
  <!-- third-party widget markup, untouched by lime-csr -->
</div>
```

**Parameters**
- `data-lime-ignore` (attribute, presence-based): the value is irrelevant;
  presence alone marks the region as ignored. Any non-empty value is fine.
  A common convention: `data-lime-ignore` (the value is often omitted entirely
  in HTML).

**Behavior**
- The element carrying `data-lime-ignore` is itself part of the ignored
  region (its attributes and children are skipped).
- All descendants are completely ignored — `${...}` placeholders are left as-is,
  `data-*` attributes are never processed, and special tags are never
  expanded.
- Nesting: if an ancestor already has `data-lime-ignore`, inner `data-lime-ignore`
  attributes are redundant (all descendants are already ignored).
- Events: if a `data-on-*` event bubbles FROM an ignored subtree TO a listener
  on a non-ignored ancestor, the event is silently discarded and no handler is
  invoked — the ignored region is event-isolated.
- The attribute name `lime-ignore` cannot be used as a `{x}` placeholder in
  reactive attributes (e.g. `href="/u/{lime-ignore}"`) — reserved to prevent
  confusion with the actual `data-lime-ignore` attribute.

**Example — Turnstile CAPTCHA**
```html
<template id="tpl-contact-form">
  <form data-on-submit="submitForm">
    <input type="email" data-model="email" placeholder="Email">
    <input type="text" data-model="name" placeholder="Name">
    
    <!-- Turnstile manages its own data-* attributes; leave it untouched -->
    <div data-lime-ignore>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
      <div class="cf-turnstile" data-sitekey="..."></div>
    </div>
    
    <button>Send</button>
  </form>
</template>
```
```js
const store = createStore({ email: '', name: '' });
mount('contact-form', { target, store, handlers: { submitForm() { /* ... */ } } });
```

**⚠ Common mistakes**
```
WRONG:  <div data-lime-ignore="${shouldIgnore}">
        -- Conditional ignore via ${...} — not supported. The attribute
           either exists (always ignored) or doesn't (always processed).
           Use static `data-lime-ignore` or put the widget conditionally
           with <if> (still static) instead.

RIGHT:  <!-- Conditional widget rendering -->
        <if is-truthy="showWidget">
          <div data-lime-ignore>
            <!-- widget HTML here -->
          </div>
        </if>
        -- The <if> is lime-csr's responsibility; the <div> inside it is
           ignored. When the condition changes, the entire block is rebuilt.
```
```
WRONG:  <span title="{lime-ignore}" data-lime-ignore="msg"></span>
        -- "lime-ignore" is RESERVED → RESERVED_ATTR_NAME warning, this
           placeholder binding is rejected.

RIGHT:  <span title="{msg}" data-msg="msg"></span>
        -- Don't use "lime-ignore" as a placeholder name. Use a different
           name or omit the reactive binding if the attribute is outside the
           ignored block.
```

---

## 4. Store API

`import { createStore } from './src/index.js';` (or directly from `./src/store.js`).

### 4.1 `createStore(initialState)` → `Store`

```js
const store = createStore({ count: 0, user: { name: 'Ada' } });
```
`initialState` (object, optional, default `{}`) is held **by reference**,
not copied. Returns a `Store` object with
`get`/`set`/`update`/`subscribe`/`computed`/`batch`.

### 4.2 `store.get(path)` → value

```js
store.get('user.name'); // → 'Ada'
store.get();             // no path → the ENTIRE state object
```
Reads via a dotted path (`getByPath` under the hood); any missing segment
resolves to `undefined`, never throws.

### 4.3 `store.set(path, value)` → boolean

```js
store.set('count', 5); // → true (changed)
store.set('count', 5); // → false (same value — Object.is comparison, no notify)
```
Writes `value` at `path`, creating intermediate objects as needed. Compares
via `Object.is`: setting the exact same value again is a no-op — no
subscriber fires, and `false` is returned. Notification is both **upward**
(changing `"a.b.c"` also notifies subscribers of `"a"` and `"a.b"`) and
**downward** (changing `"user"` also notifies subscribers of
`"user.name"`) — so `store.set('user', {...})` correctly updates a
`data-text="user.name"` binding elsewhere on the page.

**Prototype pollution guard**: if any path segment is `__proto__`,
`constructor`, or `prototype`, the write is silently rejected (`{ changed: false }`)
— relevant if a path is ever built from user input (e.g. a dynamic
`data-model` target).

**⚠ Common mistakes**
```
WRONG:  const arr = store.get('items');
        arr.push(newItem);
        store.set('items', arr);  // SAME reference as before
        -- IN_PLACE_MUTATION warning. Object.is(existing, value) is true
           (it's literally the same array object) → store.set() returns
           false immediately, WITHOUT writing or notifying anything. Every
           data-text/data-model/<for data-live> bound to "items" is now
           silently out of sync with what you think you just did.

RIGHT:  store.set('items', [...store.get('items'), newItem]);
        -- Always construct a NEW object/array reference when "mutating."
           This is the single most common lime-csr footgun — Object.is is
           reference equality, not deep equality, by design (deep-diffing
           would be slow and un-KISS).
```

### 4.4 `store.update(path, fn)` → boolean

```js
store.update('count', (v) => v + 1);
```
Shorthand for `store.set(path, fn(store.get(path)))`. Same `Object.is`
semantics as `set` — `fn` must return a NEW reference if `path` holds an
object/array you're "modifying."

### 4.5 `store.subscribe(path, callback)` → unsubscribe function

```js
const unsubscribe = store.subscribe('count', (newVal, oldVal, changedPath) => {
  console.log(newVal, oldVal, changedPath);
});
unsubscribe(); // cancels; once the last subscriber on a path is gone, that
                // path's internal bookkeeping is deleted too — no leak.
```
`callback(currentValue, previousValue, changedPath)`. Fires on both upward
and downward notification (see §4.3) — `changedPath` tells you exactly
which `store.set()` call triggered this particular invocation, which may
differ from the `path` you subscribed to. `previousValue` is only passed
when `changedPath` equals the path you subscribed to (an exact-path
notification); on ancestor/descendant notifications it is `undefined` —
the changed path's old value would be misleading as "your" previous value,
and the store doesn't snapshot every subscriber's path before a write.

### 4.6 `store.computed(path, deps, fn)` → dispose function

```js
const dispose = store.computed('fullName', ['firstName', 'lastName'],
  () => store.get('firstName') + ' ' + store.get('lastName'));
// later:
dispose();
```
Registers a derived value that lives at an ordinary store `path` — read it
with `store.get('fullName')` or bind `data-text="fullName"` exactly like
any other value. Computed immediately on registration, then automatically
recomputed whenever any path in `deps` changes. **Chainable**: a computed
path can itself be a dep of another computed. **Loop-guarded**: if `fn`'s
own execution ends up (directly or indirectly) triggering a recompute of
the SAME path while it's already running, the reentrant call is swallowed
— no stack overflow. Calling `store.set()` directly on a computed path
still works (isn't blocked) but issues a `COMPUTED_MANUAL_SET` warning —
the manually-set value is silently overwritten the next time any dep changes.

**`dispose()`** cancels every dep subscription AND deletes the computed
value from state — `store.get(path)` returns `undefined` afterwards, no
ghost value remains. The deletion emits no notification (disposal is
teardown, not a state change). Tip: computeds that should live exactly as
long as a mounted component are better declared via `mount()`'s `computed`
option ([§5.1](#51-mounttemplatename-options--cleanup-function)), which
calls `dispose()` for you on `cleanup()`/`unmount()`.

**⚠ Common mistakes**
```
WRONG:  // Recomputing "remaining" by hand, in every place "todos" changes
        function addTodo(t) {
          store.set('todos', [...store.get('todos'), t]);
          store.set('remaining', store.get('todos').filter(x => !x.done).length);
        }
        function toggleTodo(id) {
          store.set('todos', /* ... */);
          store.set('remaining', store.get('todos').filter(x => !x.done).length);
        }
        -- Duplicated, easy to forget in a THIRD place that touches todos
           later, and now "remaining" is quietly stale.

RIGHT:  store.computed('remaining', ['todos'],
          () => store.get('todos').filter(x => !x.done).length);
        // every future store.set('todos', ...) anywhere keeps "remaining"
        // correct automatically — one definition, no duplication.
```

### 4.7 `store.batch(fn)` → void

```js
store.batch(() => {
  store.set('firstName', 'Ada');
  store.set('lastName', 'Lovelace');
  store.set('firstName', 'Grace'); // same path again — still ONE notify
});
// ← the coalesced flush happens HERE, when fn returns
```
Runs `fn` synchronously; every `store.set()` inside it queues its
notification instead of firing immediately, and when `fn` returns the queue
is flushed as **one wave, deduplicated by path** — each changed path
notifies its subscribers exactly once, no matter how many times it was set.
Within a wave each subscriber callback also runs at most once, even if it
listens to several of the changed paths — a `computed` whose deps ALL
changed in the batch recomputes a single time.
Repeated sets to the same path keep the FIRST `previousValue`, so from a
subscriber's point of view the whole batch is a single before→after
transition. The state itself is written immediately as usual — `store.get()`
inside the batch always sees the latest value; only *notification* is
deferred. **Nested** `batch()` calls are safe: only the outermost exit
flushes. `fn` **throwing** still flushes (the error propagates afterwards).
Notifications triggered *during* the flush (e.g. a `computed` recomputing
because its dep was in the batch) are collected into a next wave; after 100
waves a `BATCH_FLUSH_LIMIT` warning fires and the queue is dropped —
usually two subscribers setting each other's paths.

The payoff is with expensive subscribers — a keyed `<for data-live>`
reconcile, an `<if data-live>` teardown/rebuild, a chain of computeds:

```js
store.computed('summary', ['todos', 'filter'],
  () => summarize(store.get('todos'), store.get('filter')));

store.batch(() => {
  store.set('todos', nextTodos);
  store.set('filter', 'active');
});
// "summary" recomputes ONCE (and any <for data-live each="todos">
// reconciles once) — without batch() it would run once per set.
```

**⚠ Common mistakes**
```
WRONG:  store.batch(async () => {
          store.set('status', 'loading');
          const data = await fetch('/api').then(r => r.json());
          store.set('items', data);      // NOT batched!
        });
        -- batch() is SYNCHRONOUS. It flushes when fn returns, and an async
           fn "returns" (its promise) at the first await — everything after
           the await runs later, outside the batch, notifying per-set as
           usual. batch() doesn't await anything (it returns void).

RIGHT:  store.set('status', 'loading');
        const data = await fetch('/api').then(r => r.json());
        store.batch(() => {              // batch only the sync burst of sets
          store.set('items', data);
          store.set('status', 'ready');
        });
```

---

## 5. Mount API

`import { mount, unmount, render } from './src/index.js';`

### 5.1 `mount(templateName, options)` → cleanup function

```js
const cleanup = mount('page', {
  target: document.getElementById('app'),  // required — also selects this signature
  context: { pageTitle: 'Hi' },            // optional, default {}
  store,                                    // optional
  handlers: { deleteItem(e, el) { /* ... */ } },
  computed: {                               // optional — mount-scoped computeds
    remaining: { deps: ['todos'], fn: () => store.get('todos').filter(t => !t.done).length },
  },
  beforeRender(context, store) { /* ... */ },
  afterRender(rootEl, store) { /* ... */ },
});
```

| Option | Type | Notes |
|---|---|---|
| `templateName` (1st arg) | string | Looked up as `<template id="tpl-{templateName}">`. Not found → `MOUNT_TEMPLATE_NOT_FOUND` warning, mount is a no-op (returns a no-op cleanup). |
| `target` | Element, **required** | Where the rendered content is appended. The presence of this key on the 2nd argument is what selects the options-object signature. |
| `context` | object, optional (`{}`) | Static data for `${path}`. |
| `store` | `Store`, optional | `createStore(...)`. Omitted → all reactive features (`data-text`, `data-model`, `<if data-live>`, ...) are simply skipped — only static content renders. |
| `handlers` | object, optional | See [§3.11](#311-data-on---event-handling) and [§6](#6-lifecycle-hooks) — also used for block-level `data-after`/`data-before`. |
| `computed` | object, optional | Mount-scoped computeds — see below. Requires `store`; given without one → `COMPUTED_WITHOUT_STORE` warning, skipped. |
| `beforeRender` | `(context, store) => void`, optional | See [§6](#6-lifecycle-hooks). |
| `afterRender` | `(rootEl, store) => void`, optional | See [§6](#6-lifecycle-hooks). |

Calling `mount()` again on a `target` that's already mounted automatically
runs the previous mount's cleanup and clears `target` first — this is how
you switch pages/components on the same root element.

**Mount-scoped computeds** — the `computed` option maps
`path → { deps, fn }`; each entry is registered via
[`store.computed()`](#46-storecomputedpath-deps-fn--dispose-function) when the
mount happens, and — the point of the option — its dispose is tied to the
mount's lifecycle: `cleanup()`/`unmount()` automatically stops the recomputes
AND removes the computed values from state (see §4.6 dispose semantics). No
manual dispose bookkeeping, no leaked subscriptions, no ghost values:

```js
const cleanup = mount('todo-page', {
  target, store,
  computed: {
    remaining: { deps: ['todos'], fn: () => store.get('todos').filter(t => !t.done).length },
  },
});
// <span data-text="remaining"> updates on every todos change...
cleanup(); // ...and "remaining" stops recomputing AND is deleted from state
```

**⚠ Common mistakes**
```
WRONG:  mount('page', { target, context: ctx, store }, undefined, undefined, {
          handlers: { save() { /* ... */ } },
        });
        -- Mixing the styles. With the options-object signature EVERYTHING
           lives in the 2nd argument; the positional 5th argument is part of
           the legacy signature and is ignored here — these handlers are
           never registered.

RIGHT:  mount('page', { target, context: ctx, store, handlers: { save() { /* ... */ } } });
```

#### Legacy signature (deprecated)

```js
mount(templateName, context, target, store, options?) // context/target/store positional
```
The original positional form. Still fully supported — every existing call
keeps working identically — but it emits a one-time (per page load)
`MOUNT_LEGACY_SIGNATURE` dev-mode notice pointing at the options-object
signature. The two styles are distinguished by the 2nd argument: a plain
object carrying a `target` key is the options object; anything else is a
legacy `context`. New code should use the options-object signature.

### 5.2 `unmount(target)`

```js
unmount(document.getElementById('app'));
```
Equivalent to calling the `cleanup()` function `mount()` returned, but
useful when you don't have that reference handy — looked up internally by
`target`. Cancels every reactive subscription tied to that mount and clears
`target`'s content.

### 5.3 `render(fragment, context, store, handlers?)` → cleanup function

The lower-level function `mount()` calls internally — exported for cases
where you already have a `DocumentFragment` (e.g. from `getTemplate()`) and
want to process it without the template-lookup/DOM-append/event-delegation
parts of `mount()`. `handlers` here is only used for block-level
`data-after`/`data-before` lookups (§6) — `data-on-*` delegation itself is
set up only by `mount()`, since it needs a stable `target` to delegate
from.

### 5.4 Pipeline order

```
partial → for → if   (looped until none remain)
  → resolveStatic (top-level ${path})
  → data-model → data-text/{x} → data-show
  → <for data-live>  → <if data-live>
```
Full rationale for this exact order (and the invariants it depends on) is
in [§9](#9-architecture-reference).

---

## 6. Lifecycle hooks

Two independent hook systems exist, at two different scopes:

| | Mount-level | Block-level |
|---|---|---|
| Hooks | `beforeRender`, `afterRender` | `data-after`, `data-before` |
| Declared | JS, in `mount()`'s `options` | HTML, as attributes on `<if data-live>`/`<for data-live>` |
| Scope | The WHOLE `mount()` call | One reactive branch (`<if>`) or one list item (`<for>`) |
| Fires | Once, when `mount()` runs | Every time a branch switches / an item is added or removed — potentially many times over a component's life |
| Typical use | Measuring/logging around a full page render, seeding derived state before the pipeline runs | Initializing/destroying a per-branch or per-item widget (chart, editor, map) as it enters/leaves the DOM |

### 6.1 Mount-level: `beforeRender` / `afterRender`

```js
mount('page', {
  target, store, context: ctx,
  beforeRender(context, store) {
    context.injected = 'value';       // mutating context here is visible
                                        // to the pipeline that runs next
  },
  afterRender(rootEl, store) {
    rootEl.querySelector('.chart');    // content is already in the DOM here
  },
});
```
`beforeRender(context, store)` runs BEFORE the render pipeline — mutations
to `context` are picked up by the same render (useful for injecting
computed/derived fields). `afterRender(rootEl, store)` runs AFTER content
is appended to `target` — safe to do real DOM measurements/third-party
widget setup for the WHOLE mounted tree here. Both optional; omitting
either is a complete no-op (no warning, no cost).

### 6.2 Block-level: `data-after` / `data-before`

```html
<if is-truthy="showChart" data-live el="div" data-after="initChart" data-before="destroyChart">
  <canvas></canvas>
</if>

<for each="rows" as="row" key="row.id" data-live data-after="initRow" data-before="destroyRow">
  <li>${row.label}</li>
</for>
```
```js
mount('page', {
  target, store, context: ctx,
  handlers: {
    initChart(rootEl, store) { /* rootEl is the el="div" container */ },
    destroyChart(rootEl, store) { /* rootEl still in the DOM here */ },
    initRow(rootEl, store) { /* rootEl is this <li> */ },
    destroyRow(rootEl, store) { /* rootEl is the <li> being removed */ },
  },
});
```
Handler signature for both: `(rootElement, store)` — no `event` object (these
aren't DOM events). Looked up in the SAME `handlers` dictionary as
`data-on-*`, by name.

**`<if data-live>`**: `data-after` fires once the winning branch's nodes
are in the DOM — both on the initial render AND every later switch.
`data-before` fires on the OLD branch, synchronously, right before its
`cleanup()` and DOM removal (the element is still attached at call time).
Re-evaluating to the SAME truthiness fires neither.

**`<for data-live>`**: `data-after` fires once per NEW item's nodes being
placed (initial render, every later addition, and every item under
`data-diff="replace"`, since that strategy treats every item as new on every
reconcile). `data-before` fires once per REMOVED item, before its
`cleanup()`/DOM removal. **Moved/reordered survivors never trigger either
hook** — their DOM node was never destroyed, so there's nothing to
(re)initialize or tear down.

`rootElement` is the `el="tag"` container if configured (`<if>`'s whole
branch, or `<for>`'s whole list — NOT per-item for `<for>`); otherwise it's
the branch's/item's own first top-level **element** node (template
whitespace around it is skipped automatically). A handler name that isn't
found in `handlers` → `BLOCK_AFTER_NOT_FOUND`/`BLOCK_BEFORE_NOT_FOUND`
warning, no crash — rendering itself is unaffected.

**Known limitation**: `data-before` is always awaited **synchronously** —
there's no way to `await` an exit animation or other async cleanup before
the DOM node is actually removed. See [§8](#8-known-limitations).

---

## 7. Error codes

Diagnostics are structured and non-throwing. Every diagnostic goes through
`errors.js`'s single `warn(code, message, context)` function and can be
observed with the public `subscribeDiagnostics(listener)` API. Each listener
receives a stable `{ code, message, context }` object; `context` is the
original optional value and DOM nodes are not serialized.

Subscribers run in production and development. Development mode controls only
Lime's own presentation: with dev mode enabled, Lime also calls
`console.warn('[lime-csr] CODE: message', context?)` and shows the visual
overlay. `setDevMode(false)` suppresses that console output and overlay but
does not suppress subscribed applications. Consumers decide which codes map
to their own loading or error UI; diagnostics are not exceptions and are not
all necessarily fatal. Listener failures never stop Lime or other listeners.
Unsubscribe listeners when they are no longer needed.

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

| Code | When it fires | Suggested fix |
|---|---|---|
| `UNKNOWN_OPERATOR` | `<if>` has an `is-*` attribute that isn't in the operator table | Use one of `is-gt`/`is-lt`/`is-gte`/`is-lte`/`is-eq`/`is-neq`/`is-truthy` |
| `MISSING_OPERATOR` | `<if>` has no operator attribute at all | Add one of the operators above |
| `ELSE_AFTER_CONTENT` | An element follows `<else>` as a direct child of `<if>` | Move that content before `<else>`, or into it — it's still treated as "then" either way |
| `PARTIAL_NOT_FOUND` | `<partial name="x">` — no `tpl-x` exists | Define `<template id="tpl-x">`, or check for a typo in `name` |
| `PARTIAL_MISSING_NAME` | `<partial>` has no `name` attribute | Add `name="..."` |
| `PARTIAL_DEPTH_LIMIT` | Recursive partial expansion hit `MAX_DEPTH` (50) | Check for a partial that (in)directly calls itself with no base case |
| `TEMPLATE_NOT_FOUND` | `getTemplate`/`renderTemplate` couldn't find `tpl-x` | Define the `<template id="tpl-x">` |
| `FOR_MISSING_ATTR` | `<for>` is missing `each` and/or `as` | Add both: `<for each="..." as="...">` |
| `FOR_NOT_ARRAY` | `<for each="x">` resolved to a non-array | Check that `x` is really an array in context (static `<for>`) or store (`<for data-live>`) |
| `BINDING_MISSING_PATH` | `data-text=""` (empty) | Give it a store path |
| `BINDING_MISSING_DATA_ATTR` | An `{x}` placeholder has no matching `data-x` | Add `data-x="store.path"`, or remove the `{x}` placeholder |
| `UNSAFE_EVENT_ATTR` | A reactive `{x}`/`data-x` targets an `on*` attribute | Never bind reactive data to event-handler attributes; use `data-on-*` (§3.11) for events |
| `LIVE_IF_MISSING_OP` | `<if data-live>` has no valid operator | Add one (same table as `UNKNOWN_OPERATOR`) |
| `PIPELINE_DEPTH_LIMIT` | `render()`'s structural pipeline hit `MAX_PIPELINE_ITERATIONS` (100) | Look for runaway nested `<partial>`/`<for>`/`<if>` structures, often a self-referencing partial |
| `MOUNT_TEMPLATE_NOT_FOUND` | `mount()`'s `templateName` has no matching `tpl-*` | Check the name passed to `mount()` against your `<template id>`s |
| `FOR_MISSING_KEY` | `<for data-live>` has no `key` | Add `key="item.idPath"` |
| `FOR_DUPLICATE_KEY` | Two items resolved to the same `key` | Use a genuinely unique field, usually an id |
| `MODEL_MISSING_PATH` | `data-model=""` (empty) | Give it a store path |
| `TABLE_FOSTER_PARENTING` | A special tag inside `<table>` looks like it got relocated by the HTML parser | Move the tag outside `<table>`, or wrap the row-producing content in a `<partial>` called from outside the table |
| `SHOW_MISSING_PATH` | `data-show=""` (empty) | Give it a store path |
| `UNKNOWN_EVENT` | `data-on-{event}` uses an unsupported event type | Use one of `click`/`dblclick`/`input`/`change`/`submit`/`keydown`/`keyup` |
| `UNKNOWN_KEY_MODIFIER` | `data-on-keydown-{key}`/`data-on-keyup-{key}` uses an unsupported key modifier | Use one of `enter`/`escape`/`space`/`tab`/`up`/`down`/`left`/`right`/`delete`/`backspace` (§3.11) |
| `HANDLER_NOT_FOUND` | `data-on-*`'s handler name isn't in `handlers` | Define it in the `handlers` object passed to `mount()` |
| `RESERVED_ATTR_NAME` | A `{x}`/`data-x` placeholder used a reserved name | Rename it — reserved: `text`, `model`, `show`, `live`, `ref`, `diff`, anything starting with `on-` |
| `INDEXED_MODEL_PATH` | `data-model` contains a numeric path segment (e.g. `items.0.name`) | Use `<for data-live key>` + bind to a per-item-addressable store location instead of an array index |
| `COMPUTED_MANUAL_SET` | `store.set()` called directly on a `store.computed()` path | Don't; update one of its `deps` instead, or use a different path |
| `IN_PLACE_MUTATION` | `store.set()` got the SAME object/array reference already stored | Pass a new reference: `store.set(path, [...arr])` / `{...obj}` |
| `UNKNOWN_DIFF_STRATEGY` | `data-diff` has a value other than `simple`/`lcs`/`replace` | Use one of those three, or omit the attribute for the default |
| `BLOCK_AFTER_NOT_FOUND` | `data-after`'s handler name isn't in `handlers` | Define it in the `handlers` object passed to `mount()` |
| `BLOCK_BEFORE_NOT_FOUND` | `data-before`'s handler name isn't in `handlers` | Define it in the `handlers` object passed to `mount()` |
| `BATCH_FLUSH_LIMIT` | `store.batch()`'s flush hit the 100-wave limit; pending notifications were dropped | Two subscribers are probably setting each other's paths — break the cycle (often with a `store.computed()` instead of mutual `set`s) |
| `MOUNT_LEGACY_SIGNATURE` | `mount()` was called with the legacy positional signature (one-time notice per page load) | Migrate to `mount(name, { target, context, store, handlers, computed })` (§5.1) — the legacy form keeps working |
| `COMPUTED_WITHOUT_STORE` | `mount()`'s `computed` option was given without a `store` | Pass a `store` in the same options object; without one there is nothing to register the computeds on |
| `PATH_CLOBBER` | `store.set()`/`setByPath` replaced a non-object intermediate segment (e.g. `user` was a string when setting `user.name`) with `{}` | Check the path for a typo, or store that segment as an object from the start |

---

## 8. Known limitations

- **`<table>` foster-parenting is detected, not fixed.** The HTML parser
  itself moves an `<if>`/`<for>`/`<else>` written directly inside `<table>`
  (outside a `<tr>`/`<td>`) to BEFORE the table, before lime-csr ever runs —
  this is standard browser HTML-parsing behavior, outside any framework's
  control. Detected in dev-mode on first template read
  (`TABLE_FOSTER_PARENTING`, §7), not correctable at runtime. **Workaround**:
  move the condition/loop outside `<table>`, or produce the row markup via
  a `<partial>` called from outside the table.

- **`than`/`to` is never reactive.** `<if data-live>` only tracks the
  operator's LEFT side; the right-hand comparison value is always
  static/literal, even if it happens to look like a path. If the
  comparison itself needs to be reactive on both sides, precompute it with
  `store.computed()` (§4.6) into a single trackable boolean path.

- **`data-diff="lcs"` is opt-in, not the default.** `simple` (§3.9) is the
  default reconcile strategy for `<for data-live>` — it's correct and cheap
  to compute, just not globally-minimal on non-trivial reorders. Turn on
  `lcs` explicitly for lists with frequent, large reorders.

- **Block-level hooks (`data-after`/`data-before`) are always synchronous.**
  `data-before` cannot `await` a Promise before the DOM node is actually
  torn down — there's no built-in way to wait for an exit animation to
  finish first. A future extension could support an async before-hook
  (await if a Promise is returned); not implemented today.

- **No rich-HTML rendering path.** `data-text` (§3.2) always uses
  `textContent` — this is exactly what makes it XSS-safe with zero
  escaping, but it also means it can never render markup from the store
  (bold text, links, etc. coming from data). There is no reactive
  equivalent of `innerHTML` anywhere in the engine; any HTML-shaped content
  has to come from the template itself (`${...}`/static markup), never from
  reactive store data.

- **Indexed `data-model` paths are warned about, not blocked.**
  `data-model="items.2.name"` (§3.4) still WORKS today and is not
  prevented — it just emits `INDEXED_MODEL_PATH` in dev-mode, because the
  underlying path-drift risk (index 2 silently pointing at the wrong item
  after a reorder/removal) is real but considered the caller's
  responsibility to avoid, per the project's KISS stance against building
  an automatic path-remapping mechanism.

---

## 9. Architecture (reference)

This section is for people reading or extending the source — everyday
usage doesn't require it.

### 9.1 Module map

Orchestration lives entirely in `src/index.js`. **Modules do not import
each other** (`errors.js` is the sole exception, and it imports nothing
itself) — only `index.js` decides call order.

| Module | Responsibility | Exports |
|---|---|---|
| `store.js` | Path-based reactive state: get/set/subscribe/computed, prototype-pollution rejection | `getByPath`, `setByPath`, `createStore` |
| `utils.js` | Security helpers — XSS/URL sanitization | `escapeHtml`, `safeAttr`, `isSafeUrlProtocol`, `safeUrl`, `safeStyleUrl` |
| `template.js` | `<template>` reading + cache, static `${path}` interpolation, `<table>` foster-parenting detection | `getTemplate`, `resolveStatic`, `renderTemplate` |
| `conditionals.js` | Static `<if>`/`<else>` processing, operator table | `OPERATORS`, `evalCondition`, `processIf`, `processAllIfs` |
| `partials.js` | `<partial>` expansion (isolated context, multi-prop, recursive, depth limit) | `expandPartials` |
| `loops.js` | Static `<for each as index>` list rendering (inherited context) | `expandLoops` |
| `bindings.js` | Reactive `data-text` + `{x}`/`data-x` attribute binding | `setupBindings` |
| `bindings-model.js` | Two-way form binding (`data-model`) | `setupModelBindings` |
| `bindings-show.js` | Reactive visibility (`data-show`) | `setupShowBindings` |
| `bindings-events.js` | Event delegation (`data-on-*`) | `setupEventBindings` |
| `bindings-blocks.js` | Reactive `<if data-live>` (tear-down/rebuild, `el=`, hooks) | `setupLiveIfs` |
| `bindings-loops.js` | Reactive `<for data-live key>` (key-based diff, `data-diff`, `el=`, hooks) | `setupLiveFors` |
| `errors.js` | Structured diagnostic dispatch and dev-mode presentation — the bottom-most layer | `setDevMode`, `isDevMode`, `subscribeDiagnostics`, `warn`, `errors` (namespace) |
| `shared.js` | Pure utility helpers: inLiveBlock, inUnexpandedFor, LIS indices computation | `inLiveBlock`, `inUnexpandedFor`, `longestIncreasingSubsequenceIndices` |
| `index.js` | Orchestration: `render`/`mount`/`unmount` + re-exports of everything above | `render`, `mount`, `unmount`, ... |

### 9.2 Pipeline order and why

```
mount(templateName, { target, context, store, ... })   // or the legacy positional form
  1. options.beforeRender(context, store)
  2. getTemplate(templateName) → fragment (cloneNode(true) from cache)
  3. options.computed: store.computed(path, deps, fn) per entry
     (registered BEFORE render so bindings see initial values; disposed by cleanup)
  4. render(fragment, context, store, options.handlers):
       a. loop until stable: expandPartials → expandLoops → processAllIfs
       b. resolveStatic            (remaining top-level ${path})
       c. setupModelBindings       (data-model)
       d. setupBindings            (data-text + {x}/data-x)
       e. setupShowBindings        (data-show)
       f. setupLiveFors            (<for data-live>)
       g. setupLiveIfs             (<if data-live>)
  5. target.appendChild(fragment)
  6. options.afterRender(target, store)
  7. if options.handlers: setupEventBindings(target, store, handlers)
```

- **3a is a LOOP**, not one pass: a `<partial>`'s own template can contain
  a new `<for>`/`<if>`, a `<for>`'s content can contain a new `<partial>`,
  and so on. Bounded by `MAX_PIPELINE_ITERATIONS = 100`
  (`PIPELINE_DEPTH_LIMIT` if exceeded). `expandPartials` runs BEFORE
  `expandLoops` every pass; a `<partial data="item">` inside a not-yet-expanded
  `<for as="item">` would see `item` unbound if resolved too early — an
  `inUnexpandedFor()` check defers such partials to the SAME pass's
  `expandLoops` call, which resolves them immediately afterward with the
  correct item context (the pipeline's call ORDER never changes — only
  which `<partial>`s get touched narrows).
- **3b runs AFTER structural expansion**: resolving `${item.x}` before a
  `<for>` expands would see the wrong (top-level) context and produce an
  empty string. `expandLoops` already calls `resolveStatic` itself per
  item; 3b only handles what's left at the top level.
- **3c/3d/3e run AFTER structural expansion**, so bindings never attach to
  a node that's about to be deleted (memory leak). Their own relative order
  doesn't matter for correctness EXCEPT that `data-model` (3c) is
  guaranteed to run before `data-on-*` event delegation (step 6) is even
  set up — so if the same element has both `data-model` and `data-on-input`,
  the store is already updated by the time the app-level handler runs.
- **3f runs before 3g**: an `<if data-live>` nested inside a
  `<for data-live>` is handled by the RECURSIVE `render()` call each item
  gets (via `renderFn`); by the time 3g runs at the outer level, those
  inner `<if data-live>`s have already become their own anchors and are no
  longer matched by 3g's top-level query.
- **Step 6 (event delegation) is OUTSIDE `render()` entirely**: it's a
  single delegation listener on `target`, not a per-element subscription —
  there's no "binding too early" risk to guard against, so it doesn't need
  to participate in the render pipeline's ordering at all, and needs no
  `inLiveBlock` filter.

`render()` itself is passed as the `renderFn` callback into `setupLiveIfs`/
`setupLiveFors`, so a branch switch or a new list item runs this ENTIRE
pipeline again, recursively, for just that subtree.

### 9.3 Centralized Utility Helpers (shared.js)

To keep the codebase DRY (Don't Repeat Yourself) and highly maintainable, shared utility functions such as `inLiveBlock(node)`, `inUnexpandedFor(node)`, and `longestIncreasingSubsequenceIndices(seq)` are centralized in `src/shared.js`. 

- **Leaf Dependency**: `shared.js` does not import any other modules. This allows it to be imported by any other module in the codebase without introducing circular dependency risks.
- **`inLiveBlock(node)` and `inUnexpandedFor(node)`**: Content inside a not-yet-expanded `<if data-live>`/`<for data-live>` (or static `<for>`) block must be skipped during the main pipeline passes, as their correct context is only known inside their own recursive `render()` call. If bound too early, subscriptions would leak or resolve against the wrong context.
- **`longestIncreasingSubsequenceIndices(seq)`**: The math utility used by the `"lcs"` loop diffing strategy is placed here to keep `bindings-loops.js` focused entirely on DOM reconciliation.

### 9.4 Security model

- **`data-text`/`${...}`**: written via `textContent`/`nodeValue`/`attr.value`
  — none of these parse HTML, so there is nothing to escape and no XSS
  surface, by construction (not by sanitization).
- **`{x}`/`data-x` on `on*` attributes**: rejected outright
  (`UNSAFE_EVENT_ATTR`) — browsers actually EXECUTE `onclick`/`onerror`/etc.
  when set via `setAttribute`, which would let reactive data run as code.
- **URL attributes** (`href`, `src`, `action`, `formaction`, `data`, `cite`,
  `poster`, `ping`): checked against a protocol whitelist
  (`isSafeUrlProtocol` in `utils.js`) before `setAttribute` —
  `javascript:`/`data:`/other dangerous schemes resolve to `""`.
- **`store.js` prototype-pollution guard**: `__proto__`/`constructor`/`prototype`
  are rejected as path segments in `setByPath`, silently.
- **No `eval`/`new Function` anywhere in the codebase.** `data-on-*` and
  `data-after`/`data-before` handlers are always resolved by NAME LOOKUP in
  a plain object, never by evaluating a string as code — the engine works
  under a strict Content-Security-Policy with no `unsafe-eval` in
  `script-src`.

---

*See also: [README.md](README.md) for the philosophy and a quick feature
tour; [llms.txt](llms.txt) for a short machine-readable index of this repo's
documentation.*
