/**
 * Core query module — pure domain logic for graph queries over ArchJSON.
 *
 * Re-exports from the three domain files so consumers can import from
 * '@/core/query' instead of individual sub-paths.
 */

export { ARCH_INDEX_VERSION } from './arch-index.js';
export type { ArchIndex } from './arch-index.js';

export { buildArchIndex } from './arch-index-builder.js';

export {
  QueryEngine,
} from './query-engine.js';
export type {
  EntitySummary,
  PackageStatEntry,
  PackageStatMeta,
  PackageStatsResult,
  QueryEngineOptions,
} from './query-engine.js';

export * from './arch-metrics.js';
