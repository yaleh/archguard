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

export interface QueryManifest {
  /** Schema version for forward compatibility. */
  version: string; // "1.0"

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
