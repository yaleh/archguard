/**
 * Relation deduplication shared by every parser entry point.
 *
 * Extracted from TypeScriptParser and ParallelParser so the two copies cannot
 * drift apart again (they previously carried byte-identical local copies of the
 * same logic).
 */

import type { Relation } from '@/types';

/**
 * Build the deduplication key for a relation.
 *
 * Most relations describe a class-level dependency, so the class-level triple
 * (type, source, target) is the right identity. Call edges are different: they
 * are method-level relations. Two methods of the same class calling the same
 * target method must stay two edges — collapsing them loses the caller identity
 * and makes `findCallers` return an incomplete answer. The key therefore keeps
 * `sourceMethod` / `targetMethod` for call edges only.
 *
 * @param relation - Relation to build a key for
 * @returns Stable deduplication key
 */
export function relationDedupKey(relation: Relation): string {
  const classLevelKey = `${relation.type}:${relation.source}:${relation.target}`;

  // Non-call relations keep the original class-level semantics unchanged.
  if (relation.type !== 'call') return classLevelKey;

  return `${classLevelKey}:${relation.sourceMethod ?? ''}:${relation.targetMethod ?? ''}`;
}

/**
 * Remove duplicate relations.
 *
 * Call edges are deduplicated at method granularity; all other relation types
 * are deduplicated at class granularity (the historical behavior).
 *
 * @param relations - Relations to deduplicate
 * @returns Deduplicated relations, preserving first-seen order
 */
export function deduplicateRelations(relations: readonly Relation[]): Relation[] {
  const seen = new Set<string>();
  const unique: Relation[] = [];

  for (const relation of relations) {
    const key = relationDedupKey(relation);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(relation);
    }
  }

  return unique;
}
