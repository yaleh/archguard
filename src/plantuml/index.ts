/**
 * Deterministic PlantUML emission layer.
 *
 * Public surface: the emitter, its formatting helpers, and the structural
 * validator. Rendering (SVG/PNG) is intentionally out of scope — `plantuml`
 * is an emit-only output format.
 */

export { PlantUmlGenerator } from './generator.js';
export type { PlantUmlGeneratorOptions } from './generator.js';

export { containsGenericType } from './validator-structural.js';
export { PlantUmlStructuralValidator } from './validator-structural.js';
export type {
  PlantUmlStructuralIssue,
  PlantUmlStructuralIssueType,
  PlantUmlStructuralValidationResult,
} from './validator-structural.js';

export {
  entityDisplayName,
  escapeId,
  generateClassDefinition,
  generateMemberLine,
  generatePackageHeader,
  generateRelationLine,
  getVisibilitySymbol,
  isNoisyTarget,
  needsAlias,
  normalizeEntityName,
  sanitizeType,
  shouldIncludeMember,
  stripGenericParameters,
} from './generator-formatting.js';
export type { PlantUmlEntityOptions } from './generator-formatting.js';
