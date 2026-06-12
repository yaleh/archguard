import type { C, CEntity, CMethod, CParam, CRelation } from './schema.js';
import { normalizeId } from './schema.js';

export interface DiffResult {
  equal: boolean;
  deviations: DiffDeviation[];
}

export interface DiffDeviation {
  rule: 1 | 2 | 3 | 4;
  description: string;
  expected?: unknown;
  actual?: unknown;
}

// Rule 3: normalize nullable fields to their defaults
function normalizeEntity(e: CEntity): CEntity {
  return {
    ...e,
    sourceFile: e.sourceFile ?? 'unknown',
    methods: (e.methods ?? []).map(normalizeMethod),
  };
}

function normalizeMethod(m: CMethod): CMethod {
  return {
    ...m,
    params: m.params ?? [],
    returnType: m.returnType ?? 'void',
  };
}

// Rule 4: normalize IDs before comparison
function applyIdNormalization(e: CEntity): CEntity {
  return { ...normalizeEntity(e), id: normalizeId(e.id) };
}

function normalizeRelation(r: CRelation): CRelation {
  return {
    from: normalizeId(r.from),
    to: normalizeId(r.to),
    type: r.type,
  };
}

function relationKey(r: CRelation): string {
  return `${r.from}|${r.to}|${r.type}`;
}

function paramsEqual(a: CParam[], b: CParam[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.name !== b[i]!.name || a[i]!.type !== b[i]!.type) return false;
  }
  return true;
}

function methodsEqual(a: CMethod[], b: CMethod[]): boolean {
  if (a.length !== b.length) return false;
  // Order-sensitive comparison for methods (positional)
  for (let i = 0; i < a.length; i++) {
    const ma = a[i]!;
    const mb = b[i]!;
    if (
      ma.name !== mb.name ||
      ma.returnType !== mb.returnType ||
      !paramsEqual(ma.params, mb.params)
    ) {
      return false;
    }
  }
  return true;
}

export function diffC(expected: C, actual: C): DiffResult {
  const deviations: DiffDeviation[] = [];

  // Normalize all entities (rules 3 and 4)
  const expectedEntities = expected.entities.map(applyIdNormalization);
  const actualEntities = actual.entities.map(applyIdNormalization);

  // Rule 1: Entity set equality by id (order-independent)
  const expectedEntityMap = new Map<string, CEntity>(expectedEntities.map((e) => [e.id, e]));
  const actualEntityMap = new Map<string, CEntity>(actualEntities.map((e) => [e.id, e]));

  // Check for missing entities
  for (const [id, entity] of expectedEntityMap) {
    if (!actualEntityMap.has(id)) {
      deviations.push({
        rule: 1,
        description: `Entity missing in actual: "${id}"`,
        expected: entity,
        actual: undefined,
      });
    }
  }

  // Check for extra entities
  for (const [id, entity] of actualEntityMap) {
    if (!expectedEntityMap.has(id)) {
      deviations.push({
        rule: 1,
        description: `Extra entity in actual: "${id}"`,
        expected: undefined,
        actual: entity,
      });
    }
  }

  // Field-by-field comparison for matching entities
  for (const [id, expectedEntity] of expectedEntityMap) {
    const actualEntity = actualEntityMap.get(id);
    if (!actualEntity) continue;

    if (expectedEntity.name !== actualEntity.name) {
      deviations.push({
        rule: 1,
        description: `Entity "${id}" name mismatch`,
        expected: expectedEntity.name,
        actual: actualEntity.name,
      });
    }

    if (expectedEntity.type !== actualEntity.type) {
      deviations.push({
        rule: 1,
        description: `Entity "${id}" type mismatch`,
        expected: expectedEntity.type,
        actual: actualEntity.type,
      });
    }

    // Rule 3: sourceFile null → "unknown" already applied
    if (expectedEntity.sourceFile !== actualEntity.sourceFile) {
      deviations.push({
        rule: 3,
        description: `Entity "${id}" sourceFile mismatch`,
        expected: expectedEntity.sourceFile,
        actual: actualEntity.sourceFile,
      });
    }

    // Rule 3: methods null → [] already applied
    if (!methodsEqual(expectedEntity.methods, actualEntity.methods)) {
      deviations.push({
        rule: 3,
        description: `Entity "${id}" methods mismatch`,
        expected: expectedEntity.methods,
        actual: actualEntity.methods,
      });
    }
  }

  // Rule 2: Relation set equality by (from, to, type) triple (order-independent)
  const expectedRelations = expected.relations.map(normalizeRelation);
  const actualRelations = actual.relations.map(normalizeRelation);

  const expectedRelSet = new Set<string>(expectedRelations.map(relationKey));
  const actualRelSet = new Set<string>(actualRelations.map(relationKey));

  for (const key of expectedRelSet) {
    if (!actualRelSet.has(key)) {
      deviations.push({
        rule: 2,
        description: `Relation missing in actual: "${key}"`,
        expected: key,
        actual: undefined,
      });
    }
  }

  for (const key of actualRelSet) {
    if (!expectedRelSet.has(key)) {
      deviations.push({
        rule: 2,
        description: `Extra relation in actual: "${key}"`,
        expected: undefined,
        actual: key,
      });
    }
  }

  return {
    equal: deviations.length === 0,
    deviations,
  };
}
