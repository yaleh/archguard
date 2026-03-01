import type { ArchJSON, ArchJSONMetrics, RelationType, DetailLevel } from '@/types/index.js';

export class MetricsCalculator {
  calculate(archJSON: ArchJSON, level: DetailLevel): ArchJSONMetrics {
    const { entities, relations } = archJSON;
    const entityCount = entities.length;
    const relationCount = relations.length;

    return {
      level,
      entityCount,
      relationCount,
      relationTypeBreakdown: this.buildTypeBreakdown(relations),
      stronglyConnectedComponents: this.countSCC(entities, relations),
      inferredRelationRatio: this.calcInferredRatio(relations),
    };
  }

  private buildTypeBreakdown(
    relations: ArchJSON['relations']
  ): Partial<Record<RelationType, number>> {
    const breakdown: Partial<Record<RelationType, number>> = {};
    for (const r of relations) {
      breakdown[r.type] = (breakdown[r.type] ?? 0) + 1;
    }
    return breakdown;
  }

  private calcInferredRatio(relations: ArchJSON['relations']): number {
    if (relations.length === 0) return 0;
    const inferredCount = relations.filter(
      r => r.inferenceSource !== undefined && r.inferenceSource !== 'explicit'
    ).length;
    return Math.round((inferredCount / relations.length) * 100) / 100;
  }

  private countSCC(
    entities: ArchJSON['entities'],
    relations: ArchJSON['relations']
  ): number {
    if (entities.length === 0) return 0;

    const entityIds = new Set(entities.map(e => e.id));
    // Skip relations where either endpoint is not in entities (external dependencies)
    const validRelations = relations.filter(
      r => entityIds.has(r.source) && entityIds.has(r.target)
    );

    // Build forward and transposed adjacency lists
    const graph = new Map<string, string[]>();
    const transposed = new Map<string, string[]>();
    for (const id of entityIds) {
      graph.set(id, []);
      transposed.set(id, []);
    }
    for (const r of validRelations) {
      graph.get(r.source)!.push(r.target);
      transposed.get(r.target)!.push(r.source);
    }

    // Pass 1: iterative DFS on forward graph, collect nodes by finish time
    const visited1 = new Set<string>();
    const finishStack: string[] = [];
    for (const id of entityIds) {
      if (!visited1.has(id)) {
        this.dfsIterative(id, graph, visited1, finishStack);
      }
    }

    // Pass 2: iterative DFS on transposed graph in reverse finish order, count SCC roots
    const visited2 = new Set<string>();
    let sccCount = 0;
    while (finishStack.length > 0) {
      const node = finishStack.pop()!;
      if (!visited2.has(node)) {
        this.dfsIterative(node, transposed, visited2, null);
        sccCount++;
      }
    }
    return sccCount;
  }

  /**
   * Iterative DFS to avoid call stack overflow on large graphs.
   * @param finishList - if non-null, push nodes in finish order (pass 1); if null, just mark visited (pass 2)
   */
  private dfsIterative(
    start: string,
    graph: Map<string, string[]>,
    visited: Set<string>,
    finishList: string[] | null
  ): void {
    // Stack entries: [nodeId, neighborIndex]
    const stack: [string, number][] = [[start, 0]];
    visited.add(start);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const [node, idx] = top;
      const neighbors = graph.get(node) ?? [];
      if (idx < neighbors.length) {
        top[1]++;
        const next = neighbors[idx];
        if (!visited.has(next)) {
          visited.add(next);
          stack.push([next, 0]);
        }
      } else {
        stack.pop();
        if (finishList !== null) finishList.push(node);
      }
    }
  }
}
