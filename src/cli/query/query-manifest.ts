/**
 * Query manifest types for the agent query layer.
 *
 * A QueryManifest describes the available query scopes (parsed or derived
 * ArchJSON datasets) so that downstream consumers can discover what data
 * is available for querying without loading the full ArchJSON payloads.
 */

import type { ArchJSON } from '@/types/index.js';

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

  /** Optional role hint used to identify primary vs secondary scopes. */
  role?: 'primary' | 'secondary';
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
