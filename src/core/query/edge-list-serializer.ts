import type { Entity, Relation } from '@/types/index.js';
import type { OutputScope, EdgeListOutput, EdgeListEntity } from './query-engine.js';

export function serialize(
  entities: Partial<Entity>[],
  relations: Relation[],
  outputScope: OutputScope
): EdgeListOutput {
  const serializedEntities: EdgeListEntity[] = entities.map((e) => ({
    id: e.id ?? '',
    name: e.name ?? '',
    type: e.type ?? '',
    sourceFile: e.sourceLocation?.file ?? 'unknown',
    methods:
      outputScope === 'method'
        ? (e.members ?? [])
            .filter((m) => m.type === 'method' || m.type === 'constructor')
            .map((m) => ({
              name: m.name,
              params: (m.parameters ?? []).map((p) => ({ name: p.name, type: p.type })),
              returnType: m.returnType ?? 'void',
            }))
        : [],
  }));

  const serializedRelations = relations.map((r) => ({
    from: r.source,
    to: r.target,
    type: r.type,
  }));

  return { entities: serializedEntities, relations: serializedRelations };
}
