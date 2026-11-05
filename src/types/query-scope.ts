/**
 * QueryScopeEntry — the shape of one persisted query scope.
 *
 * Lives in the `types` layer (below core and cli) because it is the input shape
 * the query engine consumes (core) and the cli query artifact layer produces.
 * `src/cli/query/query-manifest.ts` re-exports it so existing import paths keep
 * working; core may now take it from here without importing cli (layer guard:
 * tests/unit/architecture/layer-imports.test.ts).
 */

export interface QueryScopeEntry {
  /** Normalized-sources hash, 8 hex chars. */
  key: string;

  /** Human-readable display name (e.g. "src/cli"). */
  label: string;

  /** Programming language of the parsed source. */
  language: string;

  /** Whether this scope was directly parsed or derived from a parent scope. */
  kind: 'parsed' | 'derived';

  /** Stable source-root relative paths. */
  sources: string[];

  /** Number of entities in the ArchJSON for this scope. */
  entityCount: number;

  /** Number of relations in the ArchJSON for this scope. */
  relationCount: number;

  /** Whether Go Atlas extensions are present. */
  hasAtlasExtension: boolean;

  /** ISO-8601 timestamp of when this scope was last written. Absent in manifests from older versions. */
  generatedAt?: string;

  /** Optional role hint used to identify primary vs secondary scopes. */
  role?: 'primary' | 'secondary';

  /**
   * Direct containing scope key, when one exists in the same manifest.
   *
   * A scope is the parent of another when every one of the child's `sources`
   * (realpath-resolved) lies inside one of the parent's sources — a strict
   * subset relation, computed among scopes of the same language. The link
   * points at the *immediate* container (the smallest strict superset), so
   * consumers that need the outermost scope walk the chain until the field is
   * absent; no path heuristics are needed.
   *
   * Absent for root scopes (nothing contains them), for scopes whose sources
   * are disjoint from every other scope, and in manifests written before
   * schema version 1.1 (see `QUERY_MANIFEST_VERSION`).
   */
  parentScopeKey?: string;

  /**
   * True when at least one of `sources` (realpath-resolved) lies outside the
   * project root, i.e. outside the directory that contains `.archguard`.
   *
   * Multi-source analysis of another directory is legitimate, so such scopes
   * are still registered and queryable; the marker only keeps them from being
   * chosen as the manifest's `globalScopeKey` (see `selectGlobalScopeKey`).
   * Absent on in-project scopes and on manifests written by older versions.
   */
  outsideProjectRoot?: boolean;
}
