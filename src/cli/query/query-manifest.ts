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
