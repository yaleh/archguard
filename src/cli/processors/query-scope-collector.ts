/**
 * QueryScopeCollector — accumulates query-layer scopes during diagram processing.
 *
 * Extracted from DiagramProcessor (Plan 34 – Phase A3).
 *
 * Responsibilities:
 * - Maintain the `queryScopes` map (first-write-wins, keyed by source hash)
 * - Maintain `_lastArchJson` with primary-role override semantics
 *
 * @module cli/processors/query-scope-collector
 */

import { hashSources } from './arch-json-provider.js';
import type { InternalQueryScope } from './diagram-processor.js';
import type { ArchJSON } from '@/types/index.js';
import path from 'path';

/**
 * QueryScopeCollector
 *
 * Accumulates one `InternalQueryScope` per unique source set encountered during
 * a `DiagramProcessor.processAll()` run. Thread-safe for sequential use within
 * a single run (no concurrent access intended).
 */
export class QueryScopeCollector {
  private readonly queryScopes = new Map<string, InternalQueryScope>();
  private _lastArchJson: ArchJSON | null = null;

  /**
   * Register a query scope for the given sources and ArchJSON.
   *
   * No-ops when:
   * - The ArchJSON has no entities (empty parse result)
   * - A scope with the same key is already registered (first-write-wins)
   */
  register(
    sources: string[],
    archJson: ArchJSON,
    kind: 'parsed' | 'derived',
    role?: 'primary' | 'secondary'
  ): void {
    if (!archJson.entities || archJson.entities.length === 0) return;
    const key = hashSources(sources, archJson.language);
    if (this.queryScopes.has(key)) return;
    const normalizedSources = sources.map((s) => path.resolve(s));
    this.queryScopes.set(key, {
      key,
      sources: normalizedSources,
      archJson,
      kind,
      role,
    });
  }

  /**
   * Update the stored "last ArchJSON" with primary-role and richness semantics.
   *
   * Resolution order (highest priority first):
   * 1. If no value is stored yet: always store.
   * 2. If groupHasPrimary === true: always overwrite (explicit primary wins).
   * 3. If incoming has more entities than stored: overwrite (richer wins).
   *    This ensures pMap completion-order nondeterminism does not cause a
   *    small sub-module ArchJSON (e.g. 4 entities from method/analysis) to
   *    permanently block the larger full-project ArchJSON (e.g. 447 entities).
   * 4. Otherwise: no-op.
   */
  setLastArchJson(archJson: ArchJSON, groupHasPrimary: boolean): void {
    if (this._lastArchJson === null) {
      this._lastArchJson = archJson;
    } else if (groupHasPrimary) {
      this._lastArchJson = archJson;
    } else if ((archJson.entities?.length ?? 0) > (this._lastArchJson.entities?.length ?? 0)) {
      this._lastArchJson = archJson;
    }
    // Otherwise: no-op — stored value is richer or equal
  }

  /**
   * Return all registered query scopes.
   */
  getQuerySourceGroups(): InternalQueryScope[] {
    return Array.from(this.queryScopes.values());
  }

  /**
   * Return the stored "last ArchJSON", or null if none has been set yet.
   */
  getLastArchJson(): ArchJSON | null {
    return this._lastArchJson;
  }
}
