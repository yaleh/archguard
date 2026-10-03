/**
 * TypeScript analysis extension types
 *
 * Defined in ADR-002: ArchJSON Extensions v1.2
 * Domain: TypeScript module graph analysis
 */

// ========== TypeScript Analysis Extension ==========

export const TS_ANALYSIS_EXTENSION_VERSION = '1.0';

export interface TsAnalysis {
  version: string;
  moduleGraph?: TsModuleGraph;
}

export interface TsModuleGraph {
  nodes: TsModuleNode[];
  edges: TsModuleDependency[];
  cycles: TsModuleCycle[];
  /**
   * Alias-prefixed module specifiers (e.g. bare `@/types`) that could not be
   * resolved to an internal module. They are recorded here instead of being
   * silently misclassified as external `node_modules` nodes, so a dropped
   * internal edge stays visible. Optional — consumers predating this field are
   * unaffected.
   */
  unresolved?: TsModuleUnresolvedRef[];
  /**
   * Number of dynamic `import()` calls whose argument was not a string literal
   * and therefore could not be evaluated statically. Optional.
   */
  unevaluatedDynamicImports?: number;
}

export interface TsModuleUnresolvedRef {
  /** Module id of the importing file (project-root-relative directory). */
  from: string;
  /** Raw module specifier that could not be resolved to an internal module. */
  specifier: string;
}

export interface TsModuleNode {
  id: string;
  name: string;
  type: 'internal' | 'external' | 'node_modules';
  fileCount: number;
  stats: { classes: number; interfaces: number; functions: number; enums: number };
}

export interface TsModuleDependency {
  from: string;
  to: string;
  strength: number;
  importedNames: string[];
}

export interface TsModuleCycle {
  modules: string[];
  severity: 'warning' | 'error';
}
