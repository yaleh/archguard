/**
 * Unit tests for C++ ArchJsonMapper.
 */

import { describe, it, expect } from 'vitest';
import { ArchJsonMapper } from '@/plugins/cpp/archjson-mapper.js';
import type { MergedCppEntity, RawEnum, RawFunction } from '@/plugins/cpp/types.js';
import type { Entity } from '@/types/index.js';

const mapper = new ArchJsonMapper();

function makeClass(overrides: Partial<MergedCppEntity> = {}): MergedCppEntity {
  return {
    name: 'Renderer',
    qualifiedName: 'engine::Renderer',
    kind: 'class',
    bases: [{ name: 'engine::Base', access: 'public' }],
    fields: [{ name: 'id_', fieldType: 'int', visibility: 'private', isStatic: false }],
    methods: [
      { name: 'draw', returnType: 'void', parameters: [{ name: 'x', type: 'int' }], visibility: 'public', isVirtual: false, isStatic: false, isPure: false, isConst: false, sourceFile: 'renderer.cpp', startLine: 1 },
    ],
    sourceFile: 'renderer.hpp',
    startLine: 1,
    endLine: 20,
    declarationFile: 'renderer.hpp',
    ...overrides,
  } as MergedCppEntity;
}

function makeEnum(overrides: Partial<RawEnum> = {}): RawEnum {
  return {
    name: 'Color',
    qualifiedName: 'engine::Color',
    isScoped: true,
    members: ['RED', 'GREEN'],
    sourceFile: 'color.hpp',
    startLine: 1,
    endLine: 5,
    ...overrides,
  };
}

function makeFn(overrides: Partial<RawFunction> = {}): RawFunction {
  return {
    name: 'start',
    qualifiedName: 'engine::start',
    returnType: 'void',
    parameters: [],
    isStatic: false,
    sourceFile: 'app.cpp',
    startLine: 1,
    endLine: 3,
    ...overrides,
  };
}

describe('ArchJsonMapper.mapEntities', () => {
  it('maps classes with namespace ids and members', () => {
    const entities = mapper.mapEntities([makeClass()], [], [], '/proj');
    const entity = entities[0];
    expect(entity.name).toBe('Renderer');
    expect(entity.type).toBe('class');
    expect(entity.id).toContain('engine');
    expect(entity.members.some((m) => m.name === 'draw')).toBe(true);
    expect(entity.extends).toEqual(['engine::Base']);
  });

  it('maps enums with field members', () => {
    const entities = mapper.mapEntities([], [makeEnum()], [], '/proj');
    const e = entities[0];
    expect(e.type).toBe('enum');
    expect(e.members.map((m) => m.name)).toEqual(['RED', 'GREEN']);
  });

  it('maps free functions', () => {
    const entities = mapper.mapEntities([], [], [makeFn()], '/proj');
    const f = entities[0];
    expect(f.type).toBe('function');
    expect(f.name).toBe('start');
  });

  it('marks abstract classes when a method is pure virtual', () => {
    const cls = makeClass();
    cls.methods[0].isPure = true;
    const entities = mapper.mapEntities([cls], [], [], '/proj');
    expect(entities[0].isAbstract).toBe(true);
  });
});

describe('ArchJsonMapper.mapRelations', () => {
  it('creates inheritance relations between classes', () => {
    const base = makeClass({ name: 'Base', qualifiedName: 'engine::Base', declarationFile: 'base.hpp', sourceFile: 'base.hpp' });
    const derived = makeClass();
    const allEntities = mapper.mapEntities([base, derived], [], [], '/proj');
    const relations = mapper.mapRelations([base, derived], allEntities, '/proj');
    const inheritance = relations.filter((r) => r.type === 'inheritance');
    expect(inheritance.length).toBeGreaterThan(0);
    expect(inheritance[0].target).toContain('Base');
  });

  it('creates dependency relations from method parameters', () => {
    const cls = makeClass();
    cls.methods[0].parameters = [{ name: 'c', type: 'engine::Canvas' }];
    const canvas = makeClass({ name: 'Canvas', qualifiedName: 'engine::Canvas', declarationFile: 'canvas.hpp', sourceFile: 'canvas.hpp' });
    const allEntities = mapper.mapEntities([cls, canvas], [], [], '/proj');
    const relations = mapper.mapRelations([cls, canvas], allEntities, '/proj');
    expect(relations.some((r) => r.type === 'dependency')).toBe(true);
  });

  it('deduplicates identical relations', () => {
    const cls = makeClass();
    const allEntities = mapper.mapEntities([cls], [], [], '/proj');
    const relations = mapper.mapRelations([cls, cls], allEntities, '/proj');
    const keys = new Set(relations.map((r) => `${r.type}:${r.source}:${r.target}`));
    expect(keys.size).toBe(relations.length);
  });
});
