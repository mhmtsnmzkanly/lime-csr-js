/**
 * @module store
 * @description Path-based reactive state management.
 *
 * Core rules:
 *   - State access via dot-path: "user.profile.name"
 *   - When a path changes, all ancestor segments are also notified.
 *     E.g. changing "a.b.c" triggers subscribers for "a", "a.b", "a.b.c".
 *   - Downward notification: changing "a.b" also notifies descendants like "a.b.c"
 *     (subscribers whose path starts with the changed path). This means
 *     store.set("user", {name:"new"}) correctly updates data-text="user.name" bindings.
 *   - Object.is change check: setting the same value again does not trigger subscribers.
 *   - subscribe() returns a cancel function; when the last subscriber for a path is
 *     removed, that path's Map entry is deleted — leak-free cleanup.
 *   - __proto__/constructor/prototype are rejected as path segments (prototype
 *     pollution guard); set/update silently do nothing for such paths.
 *   - store.computed(path, deps, fn): registers a derived value that auto-updates
 *     when any dep changes. Returns a dispose function.
 *   - store.batch(fn): coalesces all set() notifications inside fn into one
 *     deduplicated flush wave when fn returns. Nested batches flush only at
 *     the outermost exit; a throwing fn still flushes.
 */
import { warn } from './errors.js';

/**
 * @typedef {Object} Store
 * @property {function(string=): *} get
 *   Returns the value at path; returns the entire state if no path is given.
 * @property {function(string, *): boolean} set
 *   Writes value to path, notifies subscribers; returns whether a change occurred.
 * @property {function(string, function(*): *): boolean} update
 *   Passes the current value to the updater function, sets the result.
 * @property {function(string, function(*, *, string): void): function(): void} subscribe
 *   Subscribes to path; the returned function cancels the subscription.
 * @property {function(function(): void): void} batch
 *   Runs fn; all set() notifications inside it are coalesced into one flush.
 */

/**
 * Reads a value from an object via a dotted path.
 *
 * @param {Object} source - Source object
 * @param {string} path   - Dotted path, e.g. "user.profile.name"
 * @returns {*} The found value; `undefined` if any segment is missing.
 */
export function getByPath(source, path) {
  const keys = String(path).split('.');
  if (keys.some((key) => UNSAFE_PATH_SEGMENTS.has(key))) return undefined;

  return keys.reduce((value, key) => {
    if (value == null || !Object.hasOwn(value, key)) return undefined;
    return value[key];
  }, source);
}

// __proto__/constructor/prototype are never accepted as a path segment.
// Otherwise "obj[key]" would point to an existing (typeof "object") prototype
// chain, and the next assignment would pollute Object.prototype globally.
const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Writes a value to an object via a dotted path; mutates the source object.
 * Intermediate objects are created if missing.
 *
 * Security: if any path segment is `__proto__`, `constructor`, or `prototype`,
 * the write is silently rejected (prototype pollution guard).
 *
 * Dev-mode: if an intermediate segment holds a non-object (e.g. `user` is a
 * string and the path is "user.name"), the primitive is replaced with `{}` as
 * before, but a PATH_CLOBBER warning names the overwritten segment.
 *
 * @param {Object} source   - Target object
 * @param {string} path     - Dotted path
 * @param {*}      newValue - Value to write
 * @returns {{ changed: boolean, previousValue: * }}
 *   `changed`: whether a real change occurred (Object.is comparison).
 *   `previousValue`: the previous value (`undefined` if no change).
 */
export function setByPath(source, path, newValue) {
  const keys = String(path).split(".");
  const lastKey = keys.pop();

  if (UNSAFE_PATH_SEGMENTS.has(lastKey) || keys.some((key) => UNSAFE_PATH_SEGMENTS.has(key))) {
    return { changed: false };
  }

  // Walk all but the last segment; create intermediate objects if missing
  const target = keys.reduce((obj, key, index) => {
    if (obj[key] == null || typeof obj[key] !== "object") {
      // Dev-mode: a present non-object value (primitive/function) is about to
      // be silently replaced with {} — almost always a path typo or a shape mismatch
      if (obj[key] != null) {
        const segmentPath = keys.slice(0, index + 1).join(".");
        warn('PATH_CLOBBER',
          `setByPath("${path}"): intermediate segment "${segmentPath}" held a ` +
          `non-object value (${typeof obj[key]}) and was overwritten with {}. ` +
          `If this is unintended, check the path or store that segment as an object.`);
      }
      obj[key] = {};
    }
    return obj[key];
  }, source);

  const previousValue = target[lastKey];
  if (Object.is(previousValue, newValue)) return { changed: false };

  target[lastKey] = newValue;
  return { changed: true, previousValue };
}

/**
 * Deletes the value at a dotted path; mutates the source object.
 * Missing/non-object intermediate segments → silent no-op (nothing to delete).
 *
 * Security: same prototype-pollution guard as setByPath — any `__proto__`,
 * `constructor`, or `prototype` segment silently rejects the delete.
 *
 * @param {Object} source - Target object
 * @param {string} path   - Dotted path
 */
function deleteByPath(source, path) {
  const keys = String(path).split(".");
  const lastKey = keys.pop();

  if (UNSAFE_PATH_SEGMENTS.has(lastKey) || keys.some((key) => UNSAFE_PATH_SEGMENTS.has(key))) return;

  let target = source;
  for (const key of keys) {
    if (target == null || typeof target !== "object" || !Object.hasOwn(target, key)) return;
    target = target[key];
  }
  if (target != null && typeof target === "object") delete target[lastKey];
}

/**
 * Creates a path-based reactive store.
 *
 * @param {Object} [initialState={}] - Initial state object (held by reference, not copied).
 * @returns {Store}
 */
export function createStore(initialState = {}) {
  // Map holding subscriber functions per path
  const subscribers = new Map();

  // Set of computed paths — direct store.set() on these warns in dev-mode
  const computedPaths = new Set();

  // Guard flag to swallow a computed's own re-trigger (loop prevention)
  const computedUpdating = new Set();

  // Batching state: depth of nested batch() calls, and the notifications
  // deferred while inside one. Keyed by path so repeated sets coalesce;
  // the value is the FIRST previousValue so the whole batch reads as a
  // single before→after transition from the outside.
  let batchDepth = 0;
  const pendingNotifies = new Map(); // path → first previousValue

  // True while flushNotifies() is draining — sets fired by subscribers
  // mid-flush are queued into the next wave instead of notifying inline
  let flushing = false;

  // Wave guard for flushNotifies — mirrors MAX_PIPELINE_ITERATIONS in index.js
  const MAX_FLUSH_WAVES = 100;

  /**
   * Notifies subscribers for the changed path, all ancestor segments (upward),
   * and all descendant paths (downward — keys that start with `path + "."``).
   *
   * Upward: "a.b.c" changed → notify "a", "a.b", "a.b.c".
   * Downward: "user" changed → also notify "user.name", "user.profile.age", etc.
   * This ensures store.set("user", {...}) updates data-text="user.name" bindings.
   *
   * previousValue is only meaningful for the changed path itself, so only
   * exact-path subscribers receive it; ancestor/descendant subscribers get
   * `undefined` (their own path's previous value is unknown at this point).
   *
   * @param {string}         path          - The changed full path
   * @param {*}              previousValue - Value before the change
   * @param {Set<Function>?} [seen]        - Batch-flush only: callbacks already
   *   invoked this wave; a callback in the set is skipped (and added when
   *   invoked), so one subscriber runs at most once per wave even if several
   *   of its paths changed. `null` outside a flush — no dedup.
   */
  function notify(path, previousValue, seen = null) {
    const segments = String(path).split(".");

    const invoke = (callback, currentValue, prev) => {
      if (seen) {
        if (seen.has(callback)) return;
        seen.add(callback);
      }
      callback(currentValue, prev, path);
    };

    // Upward: "a.b.c" → notify "a", "a.b", "a.b.c"
    segments.forEach((_, index) => {
      const currentPath = segments.slice(0, index + 1).join(".");
      const bucket = subscribers.get(currentPath);
      if (!bucket) return;
      const currentValue = getByPath(initialState, currentPath);
      const prev = currentPath === path ? previousValue : undefined;
      bucket.forEach((callback) => invoke(callback, currentValue, prev));
    });

    // Downward: notify all subscribers whose path starts with `path + "."`
    const prefix = path + ".";
    for (const [subPath, bucket] of subscribers) {
      if (!subPath.startsWith(prefix)) continue;
      const currentValue = getByPath(initialState, subPath);
      bucket.forEach((callback) => invoke(callback, currentValue, undefined));
    }
  }

  /**
   * Routes a change notification: queued while a batch (or a flush wave) is
   * active, delivered immediately otherwise. If the path is already queued,
   * the existing (first) previousValue is kept — later sets to the same path
   * within the batch must not reset the "before" side of the transition.
   *
   * @param {string} path          - The changed full path
   * @param {*}      previousValue - Value before the change
   */
  function scheduleNotify(path, previousValue) {
    if (batchDepth > 0 || flushing) {
      if (!pendingNotifies.has(path)) pendingNotifies.set(path, previousValue);
      return;
    }
    notify(path, previousValue);
  }

  /**
   * Drains pendingNotifies in waves: each wave snapshots the queue, clears it,
   * then notifies each (path, previousValue). Within a wave, each subscriber
   * callback runs at most once — a computed's recompute subscribed to several
   * changed deps still fires a single time. Entries queued DURING a wave
   * (e.g. a computed's recompute firing mid-flush) land in the next wave.
   * Guard: after MAX_FLUSH_WAVES waves, warns (BATCH_FLUSH_LIMIT) and clears
   * the queue — the usual cause is two subscribers setting each other.
   */
  function flushNotifies() {
    flushing = true;
    try {
      let waves = 0;
      while (pendingNotifies.size > 0) {
        if (++waves > MAX_FLUSH_WAVES) {
          warn('BATCH_FLUSH_LIMIT',
            `store.batch(): flush reached the ${MAX_FLUSH_WAVES} wave limit (possible infinite loop). ` +
            `Stopping and discarding pending notifications. ` +
            `Two subscribers are probably setting each other's paths.`);
          pendingNotifies.clear();
          break;
        }
        const wave = [...pendingNotifies.entries()];
        pendingNotifies.clear();
        const seen = new Set(); // per-wave: one invocation per subscriber
        for (const [path, previousValue] of wave) notify(path, previousValue, seen);
      }
    } finally {
      flushing = false;
    }
  }

  return {
    /**
     * Returns the value at path.
     *
     * @param {string} [path=""] - If empty, returns the entire state object.
     * @returns {*}
     */
    get(path = "") {
      return path ? getByPath(initialState, path) : initialState;
    },

    /**
     * Writes value to path; notifies subscribers if the value changed.
     * Dev-mode warnings:
     *   - Computed path: warns that computed paths should not be set directly.
     *   - In-place mutation: if value is an object/array and the reference is
     *     identical to the stored value, warns about same-reference mutation.
     *
     * @param {string} path
     * @param {*}      value
     * @returns {boolean} `true` if a change occurred.
     */
    set(path, value) {
      // Dev-mode: warn about direct writes to computed paths
      if (computedPaths.has(path) && !computedUpdating.has(path)) {
        warn('COMPUTED_MANUAL_SET',
          `Path "${path}" is managed by store.computed(). Manual store.set() will be ` +
          `overwritten on next dep change. Use store.computed() or a different path.`);
      }

      // Dev-mode: warn about in-place mutation (same object/array reference)
      const existing = getByPath(initialState, path);
      if (value !== null && typeof value === 'object' && Object.is(existing, value)) {
        warn('IN_PLACE_MUTATION',
          `store.set("${path}", value): value is the SAME reference as the stored object/array. ` +
          `In-place mutation detected — subscriber will NOT fire. Pass a new reference: ` +
          `e.g. store.set("${path}", [...arr]) or store.set("${path}", {...obj}).`);
        return false;
      }

      const result = setByPath(initialState, path, value);
      if (result.changed) scheduleNotify(path, result.previousValue);
      return result.changed;
    },

    /**
     * Runs `fn` with notification batching: every store.set() inside it
     * queues its notification instead of firing immediately, and the queue is
     * flushed as ONE deduplicated wave (one notify per changed path) when
     * `fn` returns. Repeated sets to the same path keep the FIRST
     * previousValue, so subscribers see the batch as a single before→after
     * transition. Nested batch() calls are safe — only the outermost flushes.
     * `fn` throwing still flushes (the error propagates after).
     *
     * Note: batching is synchronous — sets after an `await` inside `fn` are
     * NOT batched, because `fn` has already returned by then.
     *
     * @param {function(): void} fn - Synchronous function containing the sets.
     * @returns {void}
     */
    batch(fn) {
      batchDepth++;
      try {
        fn();
      } finally {
        batchDepth--;
        if (batchDepth === 0) flushNotifies();
      }
    },

    /**
     * Passes the current value to `updater`, sets the return value.
     *
     * @param {string}            path
     * @param {function(*): *}    updater
     * @returns {boolean}
     */
    update(path, updater) {
      return this.set(path, updater(this.get(path)));
    },

    /**
     * Subscribes to path. The returned function cancels the subscription.
     * When the last subscriber for a path is removed, its Map entry is deleted (no leak).
     *
     * previousValue is only passed when `changedPath` equals the subscribed
     * path (exact match); on ancestor/descendant notifications it is
     * `undefined` — the changed path's old value would be misleading there.
     *
     * @param {string}   path
     * @param {function(currentValue: *, previousValue: *, changedPath: string): void} callback
     * @returns {function(): void} Cleanup — removes the subscription.
     */
    subscribe(path, callback) {
      if (!subscribers.has(path)) subscribers.set(path, new Set());
      subscribers.get(path).add(callback);
      return () => {
        const bucket = subscribers.get(path);
        if (!bucket) return;
        bucket.delete(callback);
        if (bucket.size === 0) subscribers.delete(path);
      };
    },

    /**
     * Registers a computed (derived) value at `path`.
     * Immediately computes and sets the initial value, then re-computes
     * whenever any of the `deps` paths change.
     *
     * Chaining: a computed path can itself be a dep of another computed.
     * Loop prevention: if a dep change triggers the same computed recursively,
     * the re-entry is swallowed.
     *
     * Dev-mode: calling store.set(path) on a computed path warns the developer.
     *
     * @param {string}            path   - Destination path in the store (ordinary path).
     * @param {string[]}          deps   - Array of store paths to watch.
     * @param {function(): *}     fn     - Pure function; return value is written to path.
     * @returns {function(): void}        dispose — cancels all dep subscriptions AND
     *   deletes the computed value from state, so no ghost value remains
     *   (store.get(path) → undefined afterwards). The deletion itself emits
     *   no notification — disposal is teardown, not a state change.
     *
     * @example
     * const dispose = store.computed('fullName', ['firstName', 'lastName'],
     *   () => store.get('firstName') + ' ' + store.get('lastName'));
     * // later:
     * dispose(); // stops recomputing AND removes "fullName" from state
     */
    computed(path, deps, fn) {
      computedPaths.add(path);

      const recompute = () => {
        if (computedUpdating.has(path)) return; // loop guard
        computedUpdating.add(path);
        try {
          const newVal = fn();
          // Bypass the computed-path warning by going through setByPath directly
          const result = setByPath(initialState, path, newVal);
          if (result.changed) scheduleNotify(path, result.previousValue);
        } finally {
          computedUpdating.delete(path);
        }
      };

      // Initial computation
      recompute();

      // Subscribe to each dep
      const unsubs = deps.map((dep) => this.subscribe(dep, recompute));

      return function dispose() {
        for (const unsub of unsubs) unsub();
        computedPaths.delete(path);
        // Ghost-value removal: delete the last computed value from state so
        // nothing stale remains readable after disposal (silent — no notify)
        deleteByPath(initialState, path);
      };
    },
  };
}

