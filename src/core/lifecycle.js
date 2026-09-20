/**
 * @module core/lifecycle
 * Two-phase lifecycle runner (Transform and Link) for the Module Kernel.
 *
 * Architectural Invariants:
 *   1. Transform Phase:
 *      - Structural compilation / fixed-point loop.
 *      - Bounded by MAX_PIPELINE_ITERATIONS (100) to guarantee termination.
 *      - All structural DOM mutations (replacements, expansions, removals) are
 *        confined strictly to this phase.
 *   2. Link Phase:
 *      - Behavioral attachment / single-pass non-mutating traversal.
 *      - Zero structural DOM mutations.
 *      - Triggers execute in DOM attribute order (multi-attribute anchored by first required).
 *      - read() runs pure and exactly once during setup.
 *      - update() executes strictly via explicit reactive subscriptions (never store -> read -> setup).
 *   3. Teardown:
 *      - Single unified LIFO cleanup stack with fault isolation and idempotence.
 *      - Cleanup executes before DOM detachment.
 */

import { reportError } from '../errors.js';
import { inIgnoredBlock } from '../shared.js';
import { createCleanupStack, createModuleContext } from './context.js';
import { getElementScope } from './scope.js';

export const MAX_PIPELINE_ITERATIONS = 100;

/**
 * Returns all elements in the root tree in document order, including root if it is an Element.
 *
 * @param {Element|DocumentFragment} root
 * @returns {Element[]}
 */
function getAllElements(root) {
  const elements = [];
  if (root && root.nodeType === 1) {
    elements.push(root);
  }
  if (root && typeof root.querySelectorAll === 'function') {
    const descendants = root.querySelectorAll('*');
    for (let i = 0; i < descendants.length; i++) {
      elements.push(descendants[i]);
    }
  }
  return elements;
}

/**
 * Captures queued subtree elements and their scopes before a fragment is moved.
 *
 * @param {Element|DocumentFragment} root
 * @param {Object} scope
 * @returns {Array<{ element: Element, scope: Object }>}
 */
function snapshotDeferredElements(root, scope) {
  const elements = getAllElements(root);
  const snapshots = [];

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    snapshots.push({
      element,
      scope: getElementScope(element) || scope,
    });
  }

  return snapshots;
}

/**
 * Executes Phase 1: Transform (Structural Compilation / Fixed-Point Loop).
 *
 * Scans the tree for elements matching transform routes, runs their setup/transform hooks,
 * and repeats until no more transform routes match (stable tree) or the max iteration guard triggers.
 *
 * @param {Element|DocumentFragment} root - Target DOM tree
 * @param {Object} router - Compiled router instance
 * @param {Object} [options={}] - Execution options
 * @param {*} [options.store=null] - Reactive store instance
 * @param {Object} [options.scope] - Lexical scope
 * @param {Object} [options.cleanupStack] - Mount cleanup stack
 * @param {Document} [options.document] - Document context
 * @param {number} [options.maxIterations=100] - Fixed-point loop iteration limit
 * @param {Object} [options.refs] - Element references map
 * @returns {number} number of passes executed
 */
export function runTransform(root, router, options = {}) {
  if (!root || !router || typeof router.hasTransformRoutes !== 'function' || !router.hasTransformRoutes()) {
    return 0;
  }

  const {
    store = null,
    scope = Object.create(null),
    cleanupStack = createCleanupStack(),
    document = root.ownerDocument || globalThis.document,
    maxIterations = MAX_PIPELINE_ITERATIONS,
    linkedElements = options.linkedElements || new WeakSet(),
    refs = options.refs || Object.create(null),
  } = options;

  let iterations = 0;
  let scanRoot = true;
  const deferredElements = [];

  /**
   * Queues built-in static structural work without recursively starting an
   * independent transform lifecycle. The elements must be captured now because
   * callers commonly move the DocumentFragment immediately afterwards.
   *
   * @param {Element|DocumentFragment} subNode
   * @param {Object} subScope
   */
  function deferTransform(subNode, subScope) {
    if (!subNode) return;
    deferredElements.push(...snapshotDeferredElements(subNode, subScope || scope));
  }

  /**
   * Runs the transform matches from one scanned or deferred batch.
   *
   * @param {Array<{ element: Element, matches: Array, scope?: Object }>} candidateMatches
   * @returns {boolean} whether setup/transform hooks ran
   */
  function processMatches(candidateMatches) {
    let transformedAny = false;

    for (let i = 0; i < candidateMatches.length; i++) {
      const { element, matches, scope: capturedScope } = candidateMatches[i];

      // Deferred snapshots may refer to elements that an earlier structural
      // transformation has already removed or replaced.
      if (element !== root && !root.contains(element)) {
        continue;
      }

      for (let m = 0; m < matches.length; m++) {
        if (element !== root && !root.contains(element)) {
          break;
        }

        const { record, matchedAttribute, attributes } = matches[m];
        const { trigger, moduleName } = record;
        const elementScope = capturedScope || getElementScope(element) || scope;

        const { ctx } = createModuleContext({
          store,
          scope: elementScope,
          element,
          trigger,
          moduleName,
          cleanupStack,
          document,
          matchedAttribute,
          attributes,
          handlers: options.handlers || null,
          options: options.options || options,
          target: options.target || null,
          refs,
          transform: (subNode, subScope) => runTransform(subNode, router, {
            store,
            scope: subScope || elementScope,
            cleanupStack,
            document,
            maxIterations,
            handlers: options.handlers || null,
            options: options.options || options,
            target: options.target || null,
            linkedElements,
            refs,
          }),
          deferTransform,
          link: (subNode, subScope, customCleanupStack) => runLink(subNode, router, {
            store,
            scope: subScope || elementScope,
            cleanupStack: customCleanupStack || cleanupStack,
            document,
            handlers: options.handlers || null,
            options: options.options || options,
            target: options.target || null,
            linkedElements,
            refs,
          }),
        });

        let data;
        if (typeof trigger.read === 'function') {
          try {
            data = trigger.read(element, ctx);
          } catch (err) {
            reportError('MODULE_READ_FAILED', { module: moduleName, error: err }, element);
          }
        } else if (attributes) {
          data = attributes;
        }

        const transformFn = trigger.setup || trigger.transform;
        if (typeof transformFn === 'function') {
          try {
            const returnedCleanup = transformFn(element, data, ctx);
            cleanupStack.attachSetupCleanup(returnedCleanup);
            transformedAny = true;
          } catch (err) {
            reportError('MODULE_SETUP_FAILED', { module: moduleName, error: err }, element);
          }
        }
      }
    }

    return transformedAny;
  }

  while (iterations < maxIterations) {
    const candidateMatches = [];

    if (scanRoot) {
      // Exact tag/attribute routes can prove that no structural work remains
      // without materializing and matching the entire tree one final time.
      if (typeof router.hasTransformCandidates === 'function' && !router.hasTransformCandidates(root)) {
        break;
      }

      const allElements = getAllElements(root);
      for (let i = 0; i < allElements.length; i++) {
        const element = allElements[i];
        if (inIgnoredBlock(element)) continue;
        const matches = router.matchElement(element, 'transform');
        if (matches.length > 0) {
          candidateMatches.push({ element, matches });
        }
      }
    } else {
      // Process one queued generation at once. This amortizes static loop
      // expansion while still making nested structural output a later pass.
      const currentBatch = deferredElements.splice(0);
      for (let i = 0; i < currentBatch.length; i++) {
        const { element, scope: deferredScope } = currentBatch[i];
        if (element !== root && !root.contains(element)) continue;
        if (inIgnoredBlock(element)) continue;
        const matches = router.matchElement(element, 'transform');
        if (matches.length > 0) {
          candidateMatches.push({ element, matches, scope: deferredScope });
        }
      }
    }

    if (candidateMatches.length === 0) {
      if (!scanRoot && deferredElements.length > 0) {
        continue;
      }
      // A complete root scan remains the conservative fallback for custom
      // modules and any structural mutation that was not explicitly deferred.
      if (!scanRoot) {
        scanRoot = true;
        continue;
      }
      break;
    }

    iterations++;
    const transformedAny = processMatches(candidateMatches);

    if (!transformedAny) {
      break;
    }

    scanRoot = deferredElements.length === 0;
  }

  // Avoid reporting the guard merely because the final allowed pass happened
  // to complete the tree. Pattern and multi-attribute routes intentionally
  // retain the conservative diagnostic because they cannot be selected safely.
  if (
    iterations >= maxIterations
    && (typeof router.hasTransformCandidates !== 'function' || router.hasTransformCandidates(root))
  ) {
    reportError('PIPELINE_DEPTH_LIMIT', { maxIter: maxIterations }, root);
  }

  return iterations;
}

/**
 * Executes Phase 2: Link (Behavioral Attachment / Single-Pass Traversal).
 *
 * Traverses the stable DOM tree in a single pass without performing any structural mutations,
 * dispatching triggers in DOM attribute order, reading initial state, running setup, and
 * attaching reactive subscriptions and cleanups.
 *
 * @param {Element|DocumentFragment} root - Stable DOM tree
 * @param {Object} router - Compiled router instance
 * @param {Object} [options={}] - Execution options
 * @param {*} [options.store=null] - Reactive store instance
 * @param {Object} [options.scope] - Lexical scope
 * @param {Object} [options.cleanupStack] - Mount cleanup stack
 * @param {Document} [options.document] - Document context
 * @param {Object} [options.refs] - Element references map
 * @returns {Object} cleanupStack
 */
export function runLink(root, router, options = {}) {
  const cleanupStack = options.cleanupStack || createCleanupStack();

  if (!root || !router || typeof router.hasLinkRoutes !== 'function' || !router.hasLinkRoutes()) {
    return cleanupStack;
  }

  const {
    store = null,
    scope = Object.create(null),
    document = root.ownerDocument || globalThis.document,
    linkedElements = options.linkedElements || new WeakSet(),
    refs = options.refs || Object.create(null),
  } = options;

  // Single-pass snapshot of elements in document order
  const elements = getAllElements(root);

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (inIgnoredBlock(el)) continue;
    if (linkedElements.has(el)) continue;
    const matches = router.matchElement(el, 'link');
    if (matches.length === 0) continue;

    linkedElements.add(el);

    const elementScope = getElementScope(el) || scope;

    for (let m = 0; m < matches.length; m++) {
      const { record, matchedAttribute, attributes } = matches[m];
      const { trigger, moduleName } = record;

      const { ctx } = createModuleContext({
        store,
        scope: elementScope,
        element: el,
        trigger,
        moduleName,
        cleanupStack,
        document,
        matchedAttribute,
        attributes,
        handlers: options.handlers || null,
        options: options.options || options,
        target: options.target || null,
        refs,
        transform: (subNode, subScope) => runTransform(subNode, router, {
          store,
          scope: subScope || elementScope,
          cleanupStack,
          document,
          handlers: options.handlers || null,
          options: options.options || options,
          target: options.target || null,
          linkedElements,
          refs,
        }),
        link: (subNode, subScope, customCleanupStack) => runLink(subNode, router, {
          store,
          scope: subScope || elementScope,
          cleanupStack: customCleanupStack || cleanupStack,
          document,
          handlers: options.handlers || null,
          options: options.options || options,
          target: options.target || null,
          linkedElements,
          refs,
        }),
      });

      // 1. Read phase (pure read phase, executed ONCE during Link setup)
      let data;
      if (typeof trigger.read === 'function') {
        try {
          data = trigger.read(el, ctx);
        } catch (err) {
          reportError('MODULE_READ_FAILED', { module: moduleName, error: err }, el);
        }
      } else if (attributes) {
        data = attributes;
      }

      // 2. Setup phase (executed ONCE during Link)
      if (typeof trigger.setup === 'function') {
        try {
          const returnedCleanup = trigger.setup(el, data, ctx);
          cleanupStack.attachSetupCleanup(returnedCleanup);
        } catch (err) {
          reportError('MODULE_SETUP_FAILED', { module: moduleName, error: err }, el);
        }
      }

      // 3. Optional trigger-level cleanup hook
      if (typeof trigger.cleanup === 'function') {
        cleanupStack.onCleanup(() => {
          try {
            trigger.cleanup(el, data, ctx);
          } catch (err) {
            reportError('MODULE_CLEANUP_FAILED', { module: moduleName, error: err }, el);
          }
        });
      }
    }
  }

  return cleanupStack;
}
