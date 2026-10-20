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

/**
 * Syntactic form of one module reference contributing to a `TsModuleDependency`.
 * `import`         — static `import ... from '...'` / side-effect `import '...'`
 * `export-from`    — `export ... from '...'`
 * `dynamic-import` — literal `import('...')` call (runtime dependency)
 * `import-type`    — type-position `import('...')` (erased at compile time)
 */
export type TsModuleEdgeKind = 'import' | 'export-from' | 'dynamic-import' | 'import-type';

/**
 * Provenance of one statement that contributes to a module edge.
 *
 * Directory-level edges aggregate several statements, and a directory pair can
 * look like a cycle that no single file pair actually performs (e.g. the root
 * module `''` holds both the application entrypoint and leaf bootstrap files).
 * Recording the raw specifier plus the exact `file:line` lets a reported cycle
 * be audited against its source instead of being taken on faith.
 */
export interface TsModuleEdgeEvidence {
  /** Raw module specifier exactly as written in the source file. */
  specifier: string;
  /** Project-root-relative path of the file containing the reference. */
  file: string;
  /** 1-based line of the reference (0 when the node exposes no position). */
  line: number;
  /** Syntactic form of the reference. */
  kind: TsModuleEdgeKind;
}

export interface TsModuleDependency {
  /** Module id of the importing module (project-root-relative directory). */
  from: string;
  /**
   * Target of the edge. Either an internal module id, or — for an **external
   * edge** — the referenced package name (a `node_modules` node such as
   * `fs-extra`, `@scope/pkg`, or a builtin like `node:path`).
   *
   * External-edge semantics: the edge means "this module **references** this
   * package", regardless of whether the package can be resolved to a concrete
   * file. Whether ts-morph (or any resolver) happens to find the package on
   * disk MUST NOT decide whether the edge exists: a static `import ... from
   * '<pkg>'`, an `export ... from '<pkg>'` and a literal `import('<pkg>')` of the
   * same package all contribute to the same external edge (or are all absent).
   */
  to: string;
  /**
   * Total number of statements (static imports, `export ... from` re-exports and
   * literal dynamic `import()` calls) that contribute to this edge.
   * Invariant (for edges produced by builders that populate the split fields):
   * `strength === typeOnlyStrength + valueStrength`.
   */
  strength: number;
  /**
   * Number of contributing statements that are type-only (erased at compile
   * time, produce no runtime coupling): `import type ...`, `export type ... from`,
   * and all-named-type-only forms such as `import { type A, type B }`.
   * Optional — edges produced before this field existed leave it `undefined`,
   * and consumers MUST treat `undefined` as "unknown", never as 0.
   */
  typeOnlyStrength?: number;
  /**
   * Number of contributing statements that are value dependencies (survive to
   * runtime): default/namespace/side-effect imports, mixed `import { type A, B }`,
   * `export { A } from`, `export * from`, and literal dynamic `import()`.
   * Optional — absent means "unknown", not 0.
   */
  valueStrength?: number;
  importedNames: string[];
  /**
   * One entry per statement that contributed to this edge (`strength` equals
   * the number of entries). Optional — graphs produced before this field
   * existed leave it `undefined`, and consumers MUST treat `undefined` as
   * "provenance unknown", never as "no statements".
   */
  evidence?: TsModuleEdgeEvidence[];
}

/** One in-cycle edge with the source provenance needed to audit it. */
export interface TsModuleCycleEdgeEvidence {
  /** Module id of the importing directory. */
  from: string;
  /** Module id of the imported directory. */
  to: string;
  /** Raw specifier written in `file` at `line`. */
  specifier: string;
  /** Project-root-relative file containing the reference. */
  file: string;
  /** 1-based line of the reference. */
  line: number;
}

export interface TsModuleCycle {
  modules: string[];
  severity: 'warning' | 'error';
  /**
   * Every edge whose endpoints both lie in this SCC, with its raw specifier
   * and `file:line`. This is what makes a directory-level "cycle" auditable:
   * a false `(root) ↔ child` reading can be traced to the exact statement
   * (e.g. a side-effect import of a root-level bootstrap file) instead of the
   * shared root module id. Optional for graphs built before it existed.
   */
  edges?: TsModuleCycleEdgeEvidence[];
}
