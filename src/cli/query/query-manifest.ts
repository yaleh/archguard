/**
 * Query manifest types for the agent query layer.
 *
 * A QueryManifest describes the available query scopes (parsed or derived
 * ArchJSON datasets) so that downstream consumers can discover what data
 * is available for querying without loading the full ArchJSON payloads.
 */

import type { ArchJSON } from '@/types/index.js';
import type { QueryScopeEntry } from '@/types/query-scope.js';

// Re-exported so existing importers of this module keep their paths
// (cli/query/*, core/query/query-engine.ts, and the query tests).
export type { QueryScopeEntry };

// ---------------------------------------------------------------------------
// Auxiliary artifacts — duplicates / shape-smells / git-history
// ---------------------------------------------------------------------------

/** Auxiliary artifact kinds persisted under `.archguard/query/`. */
export type AuxArtifactKind = 'duplicates' | 'shape-smells' | 'git-history';

/**
 * One auxiliary artifact recorded in the main query manifest.
 *
 * `analyze` does not rewrite these artifacts (only scopes and the main
 * manifest), so consumers need their generation time and source identity to
 * tell a current result from a stale leftover of an earlier manual run.
 */
export interface AuxArtifactEntry {
  /** Query scope key this artifact belongs to. */
  scopeKey: string;

  /** Human-readable label of that scope. */
  label: string;

  /** ISO-8601 `generatedAt` read from the artifact's own manifest. */
  generatedAt: string;

  /**
   * `hashSources()` of the sources the artifact was generated from. When the
   * artifact still belongs to its scope this equals `scopeKey`; a consumer can
   * therefore treat `scopeKey !== sourcesHash` as "the artifact no longer
   * matches the scope it claims to describe".
   */
  sourcesHash: string;
}

/**
 * Auxiliary artifacts present on disk when the main manifest was written.
 * A kind is omitted when no artifact of that kind exists.
 */
export type AuxArtifactsBlock = Partial<Record<AuxArtifactKind, AuxArtifactEntry[]>>;

// ---------------------------------------------------------------------------
// QueryManifest — persisted to .archguard/query-manifest.json
// ---------------------------------------------------------------------------

/**
 * Current manifest schema version.
 *
 * - `1.0`: scopes carry no `parentScopeKey` (field never appears).
 * - `1.1`: scopes may carry `parentScopeKey`; the field is still optional
 *   because root and disjoint scopes legitimately have no parent.
 */
export const QUERY_MANIFEST_VERSION = '1.1';

/** Manifest versions this reader understands. Unknown (newer) versions are also read. */
export const SUPPORTED_QUERY_MANIFEST_VERSIONS = ['1.0', '1.1'] as const;

export interface QueryManifest {
  /** Schema version for forward compatibility ("1.0" legacy, "1.1" adds parentScopeKey). */
  version: string;

  /** ISO-8601 timestamp of when the manifest was generated. */
  generatedAt: string;

  /**
   * The default "global" scope for this query dataset.
   * When omitted and multiple scopes exist, callers must not guess.
   */
  globalScopeKey?: string;

  /** Available query scopes. */
  scopes: QueryScopeEntry[];

  /**
   * Auxiliary artifacts (duplicates / shape-smells / git-history) found on disk
   * at manifest-write time. Compare each entry's `generatedAt` with
   * `manifest.generatedAt` (or the owning scope's) to detect stale results.
   * Absent when no auxiliary artifact has been persisted yet.
   */
  auxArtifacts?: AuxArtifactsBlock;
}

// ---------------------------------------------------------------------------
// QuerySourceGroup — in-memory intermediate used by DiagramProcessor
// ---------------------------------------------------------------------------

export interface QuerySourceGroup {
  /** Scope key matching QueryScopeEntry.key. */
  key: string;

  /** Source paths for this group. */
  sources: string[];

  /** The full ArchJSON payload for this group. */
  archJson: ArchJSON;

  /** Whether this group was directly parsed or derived. */
  kind: 'parsed' | 'derived';

  /** Optional role hint used when selecting the preferred global scope. */
  role?: 'primary' | 'secondary';
}
