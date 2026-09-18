/**
 * @module modules
 * Standard unprivileged modules for Lime-CSR.
 *
 * Phase 5 Structural Modules:
 *   - partials: <partial> template expansion with isolated scopes
 *   - conditionals: <if>, <template data-if>, <else> branching
 *   - loops: <for>, <template data-for> list rendering with prototypal scopes
 *
 * Phase 6 Behavioral Modules:
 *   - text: data-text and {x} attribute template reactive bindings
 *   - show: data-show reactive visibility toggle
 *   - model: data-model two-way form binding
 *   - events: data-on-{event} delegated event dispatch
 *   - ref: data-ref DOM element reference collection
 */

export { partials } from './partials.js';
export { conditionals } from './conditionals.js';
export { loops } from './loops.js';
export { text } from './text.js';
export { show } from './show.js';
export { model } from './model.js';
export { events } from './events.js';
export { ref } from './ref.js';

