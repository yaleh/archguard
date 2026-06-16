/**
 * RelationQueryService — graph-traversal query methods over a single ArchJSON scope.
 *
 * Extracted from QueryEngine to enforce single responsibility.
 * Handles BFS-based dependency traversal, implementer/subclass lookup, and call-chain traversal.
 * Returns raw Entity[] or caller-result arrays — callers are responsible for applying output
 * options (scope narrowing, format serialization) via QueryEngine.applyOutputOptions().
 *
 * No import from query-engine.ts to avoid circular dependencies.
 */

import type { ArchJSON, Entity } from '@/types/index.js';
import type { ArchIndex } from './arch-index.js';
import type { EntityQueryService } from './entity-query-service.js';

export class RelationQueryService {
  constructor(
    private readonly archJson: ArchJSON,
    private readonly index: ArchIndex,
    private readonly entityQueryService: EntityQueryService
  ) {}

  /** BFS along the dependencies direction (what entityName depends on). */
  getDependencies(entityName: string, depth: number = 1): Entity[] {
    return this.bfs(entityName, 'dependencies', depth);
  }

  /** BFS along the dependents direction (what depends on entityName). */
  getDependents(entityName: string, depth: number = 1): Entity[] {
    return this.bfs(entityName, 'dependents', depth);
  }

  /** Find entities that implement the given interface (relation.type === 'implementation'). */
  findImplementers(interfaceName: string): Entity[] {
    const pairs = this.index.relationsByType['implementation'] ?? [];
    const ids = this.index.nameToIds[interfaceName] ?? [];
    const targetSet = new Set(ids);
    const implementerIds = pairs
      .filter(([, target]) => targetSet.has(target))
      .map(([source]) => source);
    const entities = [...new Set(implementerIds)]
      .map((id) => this.entityQueryService.getById(id))
      .filter(Boolean) as Entity[];
    return entities;
  }

  /** Find subclasses of the given class (relation.type === 'inheritance'). */
  findSubclasses(className: string): Entity[] {
    const pairs = this.index.relationsByType['inheritance'] ?? [];
    const ids = this.index.nameToIds[className] ?? [];
    const targetSet = new Set(ids);
    const subclassIds = pairs
      .filter(([, target]) => targetSet.has(target))
      .map(([source]) => source);
    const entities = [...new Set(subclassIds)]
      .map((id) => this.entityQueryService.getById(id))
      .filter(Boolean) as Entity[];
    return entities;
  }

  /**
   * BFS over call edges to find all callers of a given entity (and optionally a specific method).
   *
   * @param entityName  Entity name or "ClassName.methodName" for method-level filtering.
   * @param depth       BFS depth (1–5; clamped automatically).
   */
  findCallers(
    entityName: string,
    depth: number = 1
  ): Array<{ callerEntity: string; callerMethod: string; callType: string; depth: number }> {
    const maxDepth = Math.min(Math.max(depth, 1), 5);
    const dotIdx = entityName.indexOf('.');
    const [targetClass, targetMethod] =
      dotIdx !== -1
        ? [entityName.slice(0, dotIdx), entityName.slice(dotIdx + 1)]
        : [entityName, undefined];

    // Resolve target entity IDs from name
    const targetIds = new Set(this.index.nameToIds[targetClass] ?? []);
    if (targetIds.size === 0) return [];

    const callEdges = this.archJson.relations.filter((r) => r.type === 'call');
    const result: Array<{
      callerEntity: string;
      callerMethod: string;
      callType: string;
      depth: number;
    }> = [];
    const visited = new Set<string>();

    interface QueueItem {
      targetIds: Set<string>;
      targetMethod: string | undefined;
      currentDepth: number;
    }

    const queue: QueueItem[] = [{ targetIds, targetMethod, currentDepth: 1 }];

    while (queue.length > 0) {
      const item = queue.shift()!;
      const { targetIds: tIds, targetMethod: tMethod, currentDepth } = item;
      if (currentDepth > maxDepth) continue;

      // Collect callers at this level grouped by (source, sourceMethod) to feed next BFS level
      const nextTargetIds = new Set<string>();
      const nextTargetMethods = new Map<string, string | undefined>();

      for (const edge of callEdges) {
        if (!tIds.has(edge.target)) continue;
        if (tMethod && edge.targetMethod !== tMethod) continue;

        const callerKey = `${edge.source}:${edge.sourceMethod ?? ''}@${currentDepth}`;
        if (visited.has(callerKey)) continue;
        visited.add(callerKey);

        result.push({
          callerEntity: edge.source,
          callerMethod: edge.sourceMethod ?? '',
          callType: edge.callType ?? 'direct',
          depth: currentDepth,
        });

        if (currentDepth < maxDepth) {
          nextTargetIds.add(edge.source);
          // Track the source method to use as method filter at next depth
          if (!nextTargetMethods.has(edge.source)) {
            nextTargetMethods.set(edge.source, edge.sourceMethod);
          } else {
            // Multiple source methods from same entity → no method filter at next level
            nextTargetMethods.set(edge.source, undefined);
          }
        }
      }

      if (nextTargetIds.size > 0 && currentDepth < maxDepth) {
        queue.push({
          targetIds: nextTargetIds,
          targetMethod: undefined, // at deeper levels, don't restrict target method
          currentDepth: currentDepth + 1,
        });
      }
    }

    return result;
  }

  private bfs(
    startName: string,
    direction: 'dependencies' | 'dependents',
    maxDepth: number
  ): Entity[] {
    const clampedDepth = Math.max(1, Math.min(5, maxDepth));
    const startIds = this.index.nameToIds[startName] ?? [];
    if (startIds.length === 0) return [];

    const visited = new Set<string>(startIds);
    const result: Entity[] = [];
    let frontier = [...startIds];

    for (let d = 0; d < clampedDepth; d++) {
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        const neighbors = this.index[direction][id] ?? [];
        for (const neighborId of neighbors) {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            nextFrontier.push(neighborId);
            const entity = this.entityQueryService.getById(neighborId);
            if (entity) result.push(entity);
          }
        }
      }
      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    return result;
  }
}
