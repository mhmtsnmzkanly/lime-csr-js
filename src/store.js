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
  const target = keys.reduce((obj, key) => {
    if (obj[key] == null || typeof obj[key] !== "object") obj[key] = {};
    return obj[key];
  }, source);

  const previousValue = target[lastKey];
  if (Object.is(previousValue, newValue)) return { changed: false };

  target[lastKey] = newValue;
  return { changed: true, previousValue };
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

  /**
   * Notifies subscribers for the changed path, all ancestor segments (upward),
   * and all descendant paths (downward — keys that start with `path + "."``).
   *
   * Upward: "a.b.c" changed → notify "a", "a.b", "a.b.c".
   * Downward: "user" changed → also notify "user.name", "user.profile.age", etc.
   * This ensures store.set("user", {...}) updates data-text="user.name" bindings.
   *
   * @param {string} path          - The changed full path
   * @param {*}      previousValue - Value before the change
   */
  function notify(path, previousValue) {
    const segments = String(path).split(".");

    // Upward: "a.b.c" → notify "a", "a.b", "a.b.c"
    segments.forEach((_, index) => {
      const currentPath = segments.slice(0, index + 1).join(".");
      const bucket = subscribers.get(currentPath);
      if (!bucket) return;
      const currentValue = getByPath(initialState, currentPath);
      bucket.forEach((callback) => callback(currentValue, previousValue, path));
    });

    // Downward: notify all subscribers whose path starts with `path + "."`
    const prefix = path + ".";
    for (const [subPath, bucket] of subscribers) {
      if (!subPath.startsWith(prefix)) continue;
      const currentValue = getByPath(initialState, subPath);
      bucket.forEach((callback) => callback(currentValue, previousValue, path));
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
      if (result.changed) notify(path, result.previousValue);
      return result.changed;
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
     * @returns {function(): void}        dispose — cancels all dep subscriptions.
     *
     * @example
     * const dispose = store.computed('fullName', ['firstName', 'lastName'],
     *   () => store.get('firstName') + ' ' + store.get('lastName'));
     * // later:
     * dispose();
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
          if (result.changed) notify(path, result.previousValue);
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
      };
    },
  };
}

