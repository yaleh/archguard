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
}
