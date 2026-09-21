/**
 * @module core
 * Public Kernel API for Lime-CSR.
 *
 * Exposes the unprivileged, feature-agnostic Micro-Kernel primitives:
 *   - createEngine: Instantiates an isolated Engine runtime with compiled immutable routes.
 *   - defineModule: Validates and freezes a module definition with triggers and hooks.
 *   - Trigger factories: attr, attrs, tag, pattern for declaring module activation conditions.
 *   - Lexical Scope utilities: createScope, createIsolatedScope, isLocalScopeBinding.
 */

export { createEngine } from './engine.js';
export { defineModule } from './registry.js';
export {
  attr,
  attrs,
  tag,
  pattern,
} from './triggers.js';
export {
  createScope,
  createIsolatedScope,
  isLocalScopeBinding,
  setElementScope,
  getElementScope,
} from './scope.js';
export {
  setDevMode,
  subscribeDiagnostics,
} from '../errors.js';
