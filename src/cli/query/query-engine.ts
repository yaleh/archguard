/**
 * QueryEngine — re-export shim for backward compatibility.
 *
 * The domain class and interfaces now live in @/core/query/query-engine.
 * All existing import sites continue to work without changes.
 */

export { QueryEngine } from '@/core/query/query-engine.js';
export type {
  EntitySummary,
  PackageStatEntry,
  PackageStatMeta,
  PackageStatsResult,
  QueryEngineOptions,
} from '@/core/query/query-engine.js';
export type {
  OutputScope,
  QueryOutputFormat,
  QueryMethodOptions,
  EdgeListEntity,
  EdgeListRelation,
  EdgeListOutput,
} from '@/core/query/query-engine.js';
