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
   * Update the stored "last ArchJSON" with primary-role semantics.
   *
   * - If no value is stored yet, always stores the given archJson.
   * - If a value is already stored:
   *   - When groupHasPrimary=false: does NOT overwrite.
   *   - When groupHasPrimary=true: overwrites (primary wins).
   */
  setLastArchJson(archJson: ArchJSON, groupHasPrimary: boolean): void {
    if (this._lastArchJson === null || groupHasPrimary) {
      this._lastArchJson = archJson;
    }
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
