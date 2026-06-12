import { C, CEntity, CMethod, CParam, CRelation, EntityType, RelationType, normalizeId } from '../lib/schema.js';

interface RawParam {
  name: string;
  type: string;
}

interface RawMethod {
  name: string;
  params?: RawParam[];
  returnType?: string;
}

interface RawOutgoing {
  relType: string;
  targetId: string;
}

interface RawEntity {
  id: string;
  name: string;
  type: string;
  sourceFile?: string;
  methods?: RawMethod[];
  outgoing?: RawOutgoing[];
}

interface RawOrphanedRelation {
  from: string;
  to: string;
  type: string;
}

interface RawDoc {
  entities: RawEntity[];
  orphanedRelations?: RawOrphanedRelation[];
}

export function parse(text: string): C {
  let doc: RawDoc;
  try {
    doc = JSON.parse(text) as RawDoc;
  } catch (e) {
    throw new Error(`json-adjacency: failed to parse JSON: ${(e as Error).message}`);
  }

  if (!doc || !Array.isArray(doc.entities)) {
    throw new Error('json-adjacency: missing or invalid "entities" array at top level');
  }

  const entities: CEntity[] = [];
  const relations: CRelation[] = [];

  for (const raw of doc.entities) {
    if (!raw.id || !raw.name || !raw.type) {
      throw new Error(`json-adjacency: entity missing required field(s) id/name/type: ${JSON.stringify(raw)}`);
    }

    const methods: CMethod[] = (raw.methods ?? []).map((m: RawMethod) => ({
      name: m.name,
      params: (m.params ?? []).map((p: RawParam) => ({ name: p.name, type: p.type } as CParam)),
      returnType: m.returnType ?? 'void',
    }));

    entities.push({
      id: normalizeId(raw.id),
      name: raw.name,
      type: raw.type as EntityType,
      sourceFile: raw.sourceFile ?? 'unknown',
      methods,
    });

    for (const rel of raw.outgoing ?? []) {
      relations.push({
        from: normalizeId(raw.id),
        to: normalizeId(rel.targetId),
        type: rel.relType as RelationType,
      });
    }
  }

  for (const rel of doc.orphanedRelations ?? []) {
    relations.push({
      from: normalizeId(rel.from),
      to: normalizeId(rel.to),
      type: rel.type as RelationType,
    });
  }

  return { entities, relations };
}
