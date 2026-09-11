/**
 * @module modules/partials
 * Standard Partials module for Lime-CSR.
 *
 * Implements built-in <partial name="..." data="..." [props...]> with Named & Default Slots:
 *   - Scope Isolation: Partials run with an isolated scope (parent scope not inherited).
 *   - Store Sharing: Mount-level store remains shared.
 *   - Props: Attributes other than "name", "data", and "data-*" are resolved in caller scope/store.
 *   - Slots: Named and default slots with fallback content and caller lexical scope preservation.
 *   - Phase: Transform (structural expansion).
 */

import { createCompositionModule } from '../core/composition.js';

/**
 * Creates the standard Partials module definition.
 *
 * @param {Object} [options={}]
 * @returns {Readonly<Object>} ModuleDefinition
 */
export function partials(options = {}) {
  return createCompositionModule(options);
}

export default partials;
