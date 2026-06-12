import type { Entity } from '@/types/index.js';
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
