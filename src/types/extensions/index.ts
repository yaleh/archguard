/**
 * ArchJSON extension types — aggregation barrel
 *
 * Single source of truth for all language-specific extension types (ADR-002).
 * Domain files hold the actual definitions; this file re-exports everything
 * and owns the ArchJSONExtensions container.
 */
export * from './go-atlas.js';
export * from './project-semantics.js';
export * from './ts-analysis.js';
export * from './test-analysis.js';

import type { GoAtlasExtension } from './go-atlas.js';
import type { ProjectSemantics } from './project-semantics.js';
import type { TsAnalysis } from './ts-analysis.js';
import type { TestAnalysis } from './test-analysis.js';

/**
 * Type-safe extension container
 */
export interface ArchJSONExtensions {
  goAtlas?: GoAtlasExtension;
  projectSemantics?: ProjectSemantics;
  tsAnalysis?: TsAnalysis;
  testAnalysis?: TestAnalysis;
  // Future: javaAtlas?, rustAtlas?, ...
}
