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

interface RawEntity {
  id: string;
  name: string;
  type: string;
  sourceFile?: string;
  methods?: RawMethod[];
}

interface RawRelation {
  from: string;
  to: string;
  type: string;
}

interface RawDoc {
  entities: RawEntity[];
  relations: RawRelation[];
}

export function parse(text: string): C {
  // Strip markdown code fences if present (LLM rewrite output may wrap JSON in ```json...```)
  const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  let doc: RawDoc;
  try {
    doc = JSON.parse(stripped) as RawDoc;
  } catch (e) {
    throw new Error(`json-edge-list: failed to parse JSON: ${(e as Error).message}`);
  }

  if (!doc || !Array.isArray(doc.entities)) {
    throw new Error('json-edge-list: missing or invalid "entities" array at top level');
  }
  if (!Array.isArray(doc.relations)) {
    throw new Error('json-edge-list: missing or invalid "relations" array at top level');
  }

  const entities: CEntity[] = doc.entities.map((raw: RawEntity) => {
    if (!raw.id || !raw.name || !raw.type) {
      throw new Error(`json-edge-list: entity missing required field(s) id/name/type: ${JSON.stringify(raw)}`);
    }
    const methods: CMethod[] = (raw.methods ?? []).map((m: RawMethod) => ({
      name: m.name,
      params: (m.params ?? []).map((p: RawParam) => ({ name: p.name, type: p.type } as CParam)),
      returnType: m.returnType ?? 'void',
    }));
    return {
      id: normalizeId(raw.id),
      name: raw.name,
      type: raw.type as EntityType,
      sourceFile: raw.sourceFile ?? 'unknown',
      methods,
    };
  });

  const relations: CRelation[] = doc.relations.map((raw: RawRelation) => {
    if (!raw.from || !raw.to || !raw.type) {
      throw new Error(`json-edge-list: relation missing required field(s) from/to/type: ${JSON.stringify(raw)}`);
    }
    return {
      from: normalizeId(raw.from),
      to: normalizeId(raw.to),
      type: raw.type as RelationType,
    };
  });

  return { entities, relations };
}
