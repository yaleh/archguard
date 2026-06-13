import type { Entity, Relation } from '@/types/index.js';
import type { OutputScope } from './query-engine.js';

export function narrowEntity(entity: Entity, scope: OutputScope): Partial<Entity> {
  if (scope === 'method') return entity;

  if (scope === 'class') {
    const { members: _m, ...rest } = entity;
    return rest;
  }

  // 'package': keep only identity + file path
  return {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    sourceLocation: { file: entity.sourceLocation.file, startLine: 0, endLine: 0 },
  };
}

export function narrowEntities(entities: Entity[], scope: OutputScope): Partial<Entity>[] {
  return entities.map((e) => narrowEntity(e, scope));
}

/**
 * Filter/transform relations based on the output scope.
 *
 * - scope='package': remove all call edges (method-level noise at package view)
 * - scope='class': aggregate call edges into dependency edges; pairs already covered
 *   by an existing dependency relation are NOT duplicated
 * - scope='method': preserve all relations including call edges with sourceMethod/targetMethod
 */
export function filterRelationsForScope(relations: Relation[], scope: OutputScope): Relation[] {
  if (scope === 'package') {
    return relations.filter((r) => r.type !== 'call');
  }
  if (scope === 'class') {
    const callEdges = relations.filter((r) => r.type === 'call');
    const nonCallEdges = relations.filter((r) => r.type !== 'call');
    const existingDeps = new Set(
      nonCallEdges
        .filter((r) => r.type === 'dependency')
        .map((r) => `${r.source}:${r.target}`)
    );
    const aggregated: Relation[] = [];
    const seen = new Set<string>();
    for (const edge of callEdges) {
      const key = `${edge.source}:${edge.target}`;
      if (!existingDeps.has(key) && !seen.has(key)) {
        seen.add(key);
        aggregated.push({
          id: `call-aggregated:${edge.source}:${edge.target}`,
          type: 'dependency',
          source: edge.source,
          target: edge.target,
          inferenceSource: 'call-aggregated',
        });
      }
    }
    return [...nonCallEdges, ...aggregated];
  }
  // scope='method': preserve all relations
  return relations;
}
