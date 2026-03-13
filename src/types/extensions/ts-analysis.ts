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
