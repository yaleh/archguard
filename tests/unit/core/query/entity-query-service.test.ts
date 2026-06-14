/**
 * TDD tests for EntityQueryService (Phase 110)
 *
 * Covers the 5 entity-search methods: findEntity, findByType, findByAttr,
 * findByTypeAndAttr, getFileEntities. Edge cases: empty list, missing name/type.
 */
import { describe, it, expect } from 'vitest';
import { EntityQueryService } from '@/core/query/entity-query-service.js';
import type { ArchJSON, Entity } from '@/types/index.js';
import { buildArchIndex } from '@/core/query/arch-index-builder.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(id: string, name: string, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    name,
    type: 'class',
    visibility: 'public',
    members: [],
    sourceLocation: { file: `src/${name.toLowerCase()}.ts`, startLine: 1, endLine: 10 },
    ...overrides,
  };
}

function makeArchJson(overrides: Partial<ArchJSON> = {}): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: [],
    entities: [],
    relations: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fooEntity = makeEntity('src/foo.ts.Foo', 'Foo', {
  type: 'class',
  attributes: { deprecated: true, module: 'core' },
});
const barEntity = makeEntity('src/bar.ts.Bar', 'Bar', {
  type: 'interface',
  sourceLocation: { file: 'src/bar.ts', startLine: 1, endLine: 5 },
});
const bazEntity = makeEntity('src/baz.ts.Baz', 'Baz', {
  type: 'class',
  attributes: { module: 'utils' },
});

const archJson = makeArchJson({ entities: [fooEntity, barEntity, bazEntity] });
const index = buildArchIndex(archJson);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EntityQueryService — findEntity', () => {
  const svc = new EntityQueryService(archJson, index);

  it('returns entities matching exact name', () => {
    const result = svc.findEntity('Foo');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('src/foo.ts.Foo');
  });

  it('returns empty array for unknown name', () => {
    expect(svc.findEntity('Unknown')).toHaveLength(0);
  });

  it('handles empty entity list', () => {
    const emptyJson = makeArchJson();
    const emptyIndex = buildArchIndex(emptyJson);
    const emptySvc = new EntityQueryService(emptyJson, emptyIndex);
    expect(emptySvc.findEntity('Foo')).toHaveLength(0);
  });
});

describe('EntityQueryService — findByType', () => {
  const svc = new EntityQueryService(archJson, index);

  it('returns only entities of the given type', () => {
    const classes = svc.findByType('class');
    expect(classes).toHaveLength(2);
    expect(classes.every((e) => e.type === 'class')).toBe(true);
  });

  it('returns interfaces when type=interface', () => {
    const ifaces = svc.findByType('interface');
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].name).toBe('Bar');
  });

  it('returns empty array for unknown type', () => {
    expect(svc.findByType('enum')).toHaveLength(0);
  });

  it('handles abstract_class match on isAbstract class', () => {
    const abstractEntity = makeEntity('src/abs.ts.Abs', 'Abs', {
      type: 'class',
      isAbstract: true,
    });
    const json = makeArchJson({ entities: [abstractEntity] });
    const idx = buildArchIndex(json);
    const s = new EntityQueryService(json, idx);
    const result = s.findByType('abstract_class');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Abs');
  });
});

describe('EntityQueryService — findByAttr', () => {
  const svc = new EntityQueryService(archJson, index);

  it('returns entities that have the key (key-only check)', () => {
    const result = svc.findByAttr('deprecated');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Foo');
  });

  it('returns entities where key=value matches', () => {
    const result = svc.findByAttr('module', 'core');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Foo');
  });

  it('returns empty when no entity has the key', () => {
    expect(svc.findByAttr('nonexistent')).toHaveLength(0);
  });

  it('returns empty when key exists but value does not match', () => {
    expect(svc.findByAttr('module', 'unknown')).toHaveLength(0);
  });

  it('returns multiple entities sharing the same key', () => {
    const result = svc.findByAttr('module');
    // Foo has module=core, Baz has module=utils
    expect(result).toHaveLength(2);
  });
});

describe('EntityQueryService — findByTypeAndAttr', () => {
  const svc = new EntityQueryService(archJson, index);

  it('filters by type only when no attrKey given', () => {
    const result = svc.findByTypeAndAttr('class');
    expect(result).toHaveLength(2);
  });

  it('filters by type + attrKey presence', () => {
    const result = svc.findByTypeAndAttr('class', 'deprecated');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Foo');
  });

  it('filters by type + attrKey + attrValue', () => {
    const result = svc.findByTypeAndAttr('class', 'module', 'utils');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Baz');
  });

  it('returns empty when type matches but attr does not', () => {
    const result = svc.findByTypeAndAttr('class', 'module', 'nonexistent');
    expect(result).toHaveLength(0);
  });

  it('returns empty for unknown type', () => {
    expect(svc.findByTypeAndAttr('enum', 'module')).toHaveLength(0);
  });
});

describe('EntityQueryService — getFileEntities', () => {
  const svc = new EntityQueryService(archJson, index);

  it('returns entities defined in the given file', () => {
    const result = svc.getFileEntities('src/foo.ts');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Foo');
  });

  it('returns empty array for unknown file path', () => {
    expect(svc.getFileEntities('src/unknown.ts')).toHaveLength(0);
  });
});
