/**
 * Core types for the shape smells analysis layer.
 *
 * "Literal dispersion" detects enum/string-union discriminators compared
 * across multiple modules in ways that indicate a missing structured abstraction.
 */

/**
 * A location in a source file identified by path and 1-based line number.
 */
export interface SourceLocation {
  file: string;
  line: number;
}

/**
 * The kind of discriminator type discovered in the source.
 */
export type DiscriminatorKind = 'string-literal-union' | 'enum';

/**
 * Metadata for a discriminator type (enum or string literal union)
 * whose literal values may be dispersed across multiple files.
 */
export interface DiscriminatorType {
  /** Name of the type (e.g. "AppKind" for `type AppKind = "a" | "b"`). */
  name: string;
  /** All literal values declared in this type. */
  values: string[];
  /** Kind of discriminator. */
  kind: DiscriminatorKind;
  /** File where the type is defined. */
  file: string;
  /** 1-based line number of the declaration. */
  line: number;
}

/**
 * A smell produced when a literal value from a discriminator type appears
 * in comparison expressions across multiple files, suggesting Shotgun Surgery
 * risk.
 */
export interface LiteralDispersionSmell {
  /** Name of the discriminator type. */
  typeName: string;
  /** The specific literal value that is dispersed. */
  value: string;
  /** Files where the value appears (sorted alphabetically). */
  files: string[];
  /** Number of files containing the value. */
  dispersion: number;
  /** Severity (info at dispersion=2, warning at >=3). */
  severity: 'info' | 'warning';
  /** Per-file locations where the value was found. */
  locations: SourceLocation[];
}

/**
 * Manifest emitted alongside shape-smell results for a run.
 */
export interface ShapeSmellManifest {
  /** Schema version for compatibility. */
  version: string;
  /** ISO 8601 timestamp. */
  generatedAt: string;
  /** Total number of smells across all layers. */
  totalSmells: number;
  /** Breakdown by severity. */
  bySeverity: {
    info: number;
    warning: number;
  };
}

/**
 * Known shape smell layers. Only "literal-dispersion" is implemented in v1;
 * "hidden-coupling" and "enum-extension-impact" are deferred (Layer 2-3).
 */
export type ShapeSmellLayer = 'literal-dispersion' | 'hidden-coupling' | 'enum-extension-impact';

/**
 * Union of all smell types keyed by layer.
 */
export interface ShapeSmellResult {
  layer: ShapeSmellLayer;
  smells: LiteralDispersionSmell[];
  /** For unimplemented layers: hints about limitations. Empty string when the layer is implemented. */
  diagnostic?: string;
}

/**
 * Full result of a shape-smell detection run.
 */
export interface ShapeSmellAnalysis {
  manifest: ShapeSmellManifest;
  results: ShapeSmellResult[];
}
