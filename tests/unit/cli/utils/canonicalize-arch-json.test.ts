import { describe, expect, it } from 'vitest';
import { canonicalizeArchJson } from '@/cli/utils/canonicalize-arch-json.js';
import type { ArchJSON, Entity, Member, Relation, Module } from '@/types/index.js';

function makeMinimalArchJson(overrides: Partial<ArchJSON> = {}): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    sourceFiles: [],
    entities: [],
    relations: [],
    ...overrides,
  };
}

function makeEntity(id: string, name: string, members: Member[] = []): Entity {
  return {
    id,
    name,
    type: 'class',
    visibility: 'public',
    members,
    sourceLocation: { file: `${id}.ts`, startLine: 1, endLine: 10 },
  };
}

function makeMember(name: string, type: 'method' | 'field' = 'method'): Member {
  return {
    name,
    type,
    visibility: 'public',
  };
}

function makeRelation(id: string, source: string, target: string, type = 'dependency'): Relation {
  return {
    id,
    type: type as Relation['type'],
    source,
    target,
  };
}

function makeModule(name: string, entities: string[] = [], submodules?: Module[]): Module {
  return { name, entities, submodules };
}

describe('canonicalizeArchJson', () => {
  describe('sourceFiles sorting', () => {
    it('sorts sourceFiles alphabetically', () => {
      const input = makeMinimalArchJson({ sourceFiles: ['z.ts', 'a.ts', 'm.ts'] });
      const result = canonicalizeArchJson(input);
      expect(result.sourceFiles).toEqual(['a.ts', 'm.ts', 'z.ts']);
    });

    it('leaves empty sourceFiles as empty array', () => {
      const input = makeMinimalArchJson({ sourceFiles: [] });
      const result = canonicalizeArchJson(input);
      expect(result.sourceFiles).toEqual([]);
    });

    it('handles undefined sourceFiles gracefully', () => {
      const input = makeMinimalArchJson({ sourceFiles: undefined });
      const result = canonicalizeArchJson(input);
      expect(result.sourceFiles).toEqual([]);
    });
  });

  describe('entities sorting', () => {
    it('sorts entities by id|name key', () => {
      const entityA = makeEntity('pkg.Zebra', 'Zebra');
      const entityB = makeEntity('pkg.Alpha', 'Alpha');
      const input = makeMinimalArchJson({ entities: [entityA, entityB] });
      const result = canonicalizeArchJson(input);
      expect(result.entities[0].id).toBe('pkg.Alpha');
      expect(result.entities[1].id).toBe('pkg.Zebra');
    });

    it('sorts members within each entity by name|type|visibility', () => {
      const members: Member[] = [
        makeMember('render'),
        makeMember('alpha'),
        makeMember('initialize'),
      ];
      const entity = makeEntity('pkg.Foo', 'Foo', members);
      const input = makeMinimalArchJson({ entities: [entity] });
      const result = canonicalizeArchJson(input);
      const memberNames = result.entities[0].members.map((m) => m.name);
      expect(memberNames).toEqual(['alpha', 'initialize', 'render']);
    });

    it('sorts genericParams within each entity', () => {
      const entity: Entity = {
        ...makeEntity('pkg.Container', 'Container'),
        genericParams: ['Z', 'A', 'M'],
      };
      const input = makeMinimalArchJson({ entities: [entity] });
      const result = canonicalizeArchJson(input);
      expect(result.entities[0].genericParams).toEqual(['A', 'M', 'Z']);
    });

    it('sorts implements within each entity', () => {
      const entity: Entity = {
        ...makeEntity('pkg.Impl', 'Impl'),
        implements: ['Runnable', 'Closeable', 'AutoCloseable'],
      };
      const input = makeMinimalArchJson({ entities: [entity] });
      const result = canonicalizeArchJson(input);
      expect(result.entities[0].implements).toEqual(['AutoCloseable', 'Closeable', 'Runnable']);
    });
  });

  describe('relations sorting', () => {
    it('sorts relations by id|source|target|type composite key', () => {
      const rel1 = makeRelation('r2', 'pkg.B', 'pkg.C');
      const rel2 = makeRelation('r1', 'pkg.A', 'pkg.B');
      const input = makeMinimalArchJson({ relations: [rel1, rel2] });
      const result = canonicalizeArchJson(input);
      expect(result.relations[0].id).toBe('r1');
      expect(result.relations[1].id).toBe('r2');
    });

    it('produces stable order for relations with same id but different source', () => {
      const rel1 = makeRelation('r1', 'pkg.Z', 'pkg.A');
      const rel2 = makeRelation('r1', 'pkg.A', 'pkg.Z');
      const input = makeMinimalArchJson({ relations: [rel1, rel2] });
      const result = canonicalizeArchJson(input);
      // r1|pkg.A sorts before r1|pkg.Z
      expect(result.relations[0].source).toBe('pkg.A');
      expect(result.relations[1].source).toBe('pkg.Z');
    });
  });

  describe('modules sorting', () => {
    it('sorts modules alphabetically by name', () => {
      const mods: Module[] = [makeModule('ui'), makeModule('core'), makeModule('api')];
      const input = makeMinimalArchJson({ modules: mods });
      const result = canonicalizeArchJson(input);
      const names = result.modules.map((m) => m.name);
      expect(names).toEqual(['api', 'core', 'ui']);
    });

    it('sorts entities array within each module', () => {
      const mod = makeModule('core', ['Zebra', 'Alpha', 'Mango']);
      const input = makeMinimalArchJson({ modules: [mod] });
      const result = canonicalizeArchJson(input);
      expect(result.modules[0].entities).toEqual(['Alpha', 'Mango', 'Zebra']);
    });

    it('sorts submodules recursively', () => {
      const child1 = makeModule('zeta');
      const child2 = makeModule('alpha');
      const parent = makeModule('core', [], [child1, child2]);
      const input = makeMinimalArchJson({ modules: [parent] });
      const result = canonicalizeArchJson(input);
      const subNames = result.modules[0].submodules.map((m) => m.name);
      expect(subNames).toEqual(['alpha', 'zeta']);
    });

    it('leaves modules undefined when not provided', () => {
      const input = makeMinimalArchJson({ modules: undefined });
      const result = canonicalizeArchJson(input);
      expect(result.modules).toBeUndefined();
    });
  });

  describe('idempotency', () => {
    it('is idempotent: applying twice gives the same result as once', () => {
      const entities = [makeEntity('pkg.B', 'B'), makeEntity('pkg.A', 'A')];
      const relations = [makeRelation('r2', 'b', 'c'), makeRelation('r1', 'a', 'b')];
      const mods = [makeModule('ui', ['Z', 'A']), makeModule('core', ['M', 'B'])];
      const input = makeMinimalArchJson({
        sourceFiles: ['z.ts', 'a.ts'],
        entities,
        relations,
        modules: mods,
      });

      const once = canonicalizeArchJson(input);
      const twice = canonicalizeArchJson(once);
      expect(twice).toEqual(once);
    });
  });

  describe('preserves non-sorting fields', () => {
    it('preserves version, language, and other scalar fields unchanged', () => {
      const input = makeMinimalArchJson();
      input.version = '2.0';
      input.language = 'go';
      const result = canonicalizeArchJson(input);
      expect(result.version).toBe('2.0');
      expect(result.language).toBe('go');
    });

    it('does not mutate the original input arrays', () => {
      const sourceFiles = ['z.ts', 'a.ts'];
      const input = makeMinimalArchJson({ sourceFiles });
      canonicalizeArchJson(input);
      // original should be untouched
      expect(sourceFiles).toEqual(['z.ts', 'a.ts']);
    });
  });
});
