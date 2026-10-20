import type { Entity, Relation } from '@/types/index.js';
import type {
  OutputScope,
  EdgeListOutput,
  EdgeListEntity,
  EdgeListField,
  EdgeListRelation,
} from './query-engine.js';

export interface SerializeOptions {
  /** Relation fields to include (default: from, to, type). */
  relationFields?: readonly EdgeListField[];
  /** Relation count in the closure before topN truncation. */
  totalRelations?: number;
  /** Whether topN truncated the relation list. */
  truncated?: boolean;
}

export function serialize(
  entities: Partial<Entity>[],
  relations: Relation[],
  outputScope: OutputScope,
  options: SerializeOptions = {}
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

  const fields =
    options.relationFields && options.relationFields.length > 0
      ? new Set<EdgeListField>(options.relationFields)
      : undefined;

  const serializedRelations: Array<Partial<EdgeListRelation>> = relations.map((r) => {
    const relation: Partial<EdgeListRelation> = {};
    if (!fields || fields.has('from')) relation.from = r.source;
    if (!fields || fields.has('to')) relation.to = r.target;
    if (!fields || fields.has('type')) relation.type = r.type;
    return relation;
  });

  const output: EdgeListOutput = {
    entities: serializedEntities,
    relations: serializedRelations,
  };
  if (options.totalRelations !== undefined) output.totalRelations = options.totalRelations;
  if (options.truncated !== undefined) output.truncated = options.truncated;
  return output;
}
