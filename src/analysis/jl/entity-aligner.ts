/**
 * Cross-snapshot entity alignment (TASK-65 Phase A).
 *
 * Two snapshots rarely share an identical entity set: files get added, removed,
 * renamed (deferred — see proposal) between commits. Drift distances require
 * both snapshots' adjacency rows in a single coordinate system. This module
 * computes the union coordinate system E_union = E1 ∪ E2 and maps a row
 * expressed in one snapshot's coordinates into the union coordinates, zero-
 * padding any column the source snapshot does not contain.
 *
 * E_union is used (not E_shared) so that "entity i gained a dependency on a
 * newly-added entity j" is a visible drift signal.
 *
 * @module analysis/jl/entity-aligner
 */

import type { AlignmentResult } from './types.js';

export class EntityAligner {
  /**
   * Align two snapshots' entity sets into a union coordinate system.
   *
   * @param entityIndex1 - Ordered entity IDs of the earlier snapshot (E1).
   * @param entityIndex2 - Ordered entity IDs of the later snapshot (E2).
   * @returns The union coordinate system plus shared/added/removed sets.
   */
  static align(entityIndex1: string[], entityIndex2: string[]): AlignmentResult {
    const s1 = new Set(entityIndex1);
    const s2 = new Set(entityIndex2);

    // Preserve first-seen order across both snapshots (E1 order, then E2-only).
    const union: string[] = [];
    const seen = new Set<string>();
    for (const id of entityIndex1) {
      if (!seen.has(id)) {
        seen.add(id);
        union.push(id);
      }
    }
    for (const id of entityIndex2) {
      if (!seen.has(id)) {
        seen.add(id);
        union.push(id);
      }
    }

    const shared = entityIndex1.filter((id) => s2.has(id));
    const added = entityIndex2.filter((id) => !s1.has(id));
    const removed = entityIndex1.filter((id) => !s2.has(id));

    return { entityIndex: union, shared, added, removed };
  }

  /**
   * Map an adjacency row from a source snapshot's coordinates into the union
   * coordinate system.
   *
   * @param row - The row vector in `sourceEntityIndex` coordinates.
   * @param sourceEntityIndex - Ordered entity IDs the row is expressed in.
   * @param alignedEntityIndex - The union coordinate system (result of `align`).
   * @returns A row vector of length `|alignedEntityIndex|`; columns the source
   *   snapshot does not contain are zero-padded.
   */
  static buildAlignedRow(
    row: number[],
    sourceEntityIndex: string[],
    alignedEntityIndex: string[]
  ): number[] {
    const sourceIndex = new Map<string, number>();
    sourceEntityIndex.forEach((id, i) => sourceIndex.set(id, i));

    return alignedEntityIndex.map((id) => {
      const i = sourceIndex.get(id);
      return i === undefined ? 0 : (row[i] ?? 0);
    });
  }
}
