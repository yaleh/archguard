import { describe, expect, it } from 'vitest';
import { Project } from 'ts-morph';
import { canonicalizeArchJson } from '@/cli/utils/canonicalize-arch-json.js';
import { buildArchIndex } from '@/core/query/arch-index-builder.js';
import { ModuleGraphBuilder } from '@/plugins/typescript/builders/module-graph-builder.js';
import type { ArchJSON, Entity, Member, Relation, Module } from '@/types/index.js';
import type { TsModuleGraph } from '@/types/extensions/ts-analysis.js';

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

  describe('moduleGraph edge determinism with type-only split fields', () => {
    const buildGraph = (): TsModuleGraph => {
      const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { target: 99 } });
      project.createSourceFile(
        '/root/src/b/index.ts',
        `export const A = 1;\nexport interface T {}`
      );
      project.createSourceFile(
        '/root/src/a/x.ts',
        `import type { T } from '../b/index';\nimport { A } from '../b/index';`
      );
      return new ModuleGraphBuilder().build('/root', project.getSourceFiles(), []);
    };

    const makeArchJson = (moduleGraph: TsModuleGraph): ArchJSON =>
      makeMinimalArchJson({
        extensions: { tsAnalysis: { version: '1.0', moduleGraph } },
      });

    it('serializes byte-for-byte identically across two independent generations', () => {
      const first = JSON.stringify(canonicalizeArchJson(makeArchJson(buildGraph())));
      const second = JSON.stringify(canonicalizeArchJson(makeArchJson(buildGraph())));

      expect(second).toBe(first);
      // The split fields survive canonicalization (the edge sort must not drop them).
      expect(first).toContain('"typeOnlyStrength":1');
      expect(first).toContain('"valueStrength":1');
      // And the per-edge invariant holds after serialization.
      const canon = canonicalizeArchJson(makeArchJson(buildGraph()));
      for (const edge of canon.extensions?.tsAnalysis?.moduleGraph?.edges ?? []) {
        expect(edge.strength).toBe((edge.typeOnlyStrength ?? 0) + (edge.valueStrength ?? 0));
      }
    });
  });

  describe('workspace identity normalization', () => {
    const WS = '/tmp/ws';
    const ABS_FILE = `${WS}/a/b.ts`;

    function absoluteFixture(): ArchJSON {
      const nameId = `${ABS_FILE}.Name`;
      const otherId = `${ABS_FILE}.Other`;
      return makeMinimalArchJson({
        workspaceRoot: WS,
        entities: [
          {
            id: nameId,
            name: 'Name',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: ABS_FILE, startLine: 1, endLine: 9 },
          },
          {
            id: otherId,
            name: 'Other',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: ABS_FILE, startLine: 11, endLine: 20 },
          },
        ],
        relations: [
          {
            id: `${nameId}_dependency_${otherId}`,
            type: 'dependency',
            source: nameId,
            target: otherId,
          },
          {
            // Unresolved target: stays verbatim, but its source moves with the entity.
            id: `${nameId}_dependency_ExternalBase`,
            type: 'dependency',
            source: nameId,
            target: 'ExternalBase',
          },
        ],
      });
    }

    it('normalizes absolute entity ids, source files and relation endpoints to workspace-relative posix', () => {
      const canon = canonicalizeArchJson(absoluteFixture());

      expect(canon.entities.map((entity) => entity.id)).toEqual(['a/b.ts.Name', 'a/b.ts.Other']);
      expect(canon.entities.map((entity) => entity.sourceLocation.file)).toEqual([
        'a/b.ts',
        'a/b.ts',
      ]);
      expect(canon.relations).toContainEqual({
        id: 'a/b.ts.Name_dependency_a/b.ts.Other',
        type: 'dependency',
        source: 'a/b.ts.Name',
        target: 'a/b.ts.Other',
      });
      // Both embedded ids in the relation id are replaced; the unresolved bare
      // target keeps its name.
      expect(canon.relations).toContainEqual({
        id: 'a/b.ts.Name_dependency_ExternalBase',
        type: 'dependency',
        source: 'a/b.ts.Name',
        target: 'ExternalBase',
      });
      // No absolute workspace prefix survives anywhere in the identity fields.
      expect(
        JSON.stringify({ entityIds: canon.entities.map((e) => e.id), relations: canon.relations })
      ).not.toContain(WS);
    });

    it('converts backslash separators under the workspace root to posix', () => {
      const input = makeMinimalArchJson({
        workspaceRoot: '/tmp/ws',
        entities: [
          {
            id: '/tmp/ws\\a\\b.ts.Name',
            name: 'Name',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: '/tmp/ws\\a\\b.ts', startLine: 1, endLine: 2 },
          },
        ],
      });

      const canon = canonicalizeArchJson(input);
      expect(canon.entities[0].id).toBe('a/b.ts.Name');
      expect(canon.entities[0].sourceLocation.file).toBe('a/b.ts');
    });

    it('leaves already-relative posix entities and relations byte-identical (negative control)', () => {
      const entity: Entity = {
        id: 'dir/x.ts.Foo',
        name: 'Foo',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'dir/x.ts', startLine: 1, endLine: 5 },
      };
      const relation: Relation = {
        id: 'dir/x.ts.Foo_dependency_bar.Baz',
        type: 'dependency',
        source: 'dir/x.ts.Foo',
        target: 'bar.Baz',
      };
      const input = makeMinimalArchJson({
        workspaceRoot: WS,
        entities: [entity],
        relations: [relation],
      });

      const canon = canonicalizeArchJson(input);
      expect(canon.entities[0]).toEqual(entity);
      expect(canon.relations[0]).toEqual(relation);
      expect(canon.workspaceRoot).toBe(WS);
    });

    it('keeps symbol names and tsAnalysis module-graph coordinates untouched', () => {
      const moduleGraph = {
        version: '1.0',
        nodes: [{ id: '/tmp/ws/a', fileCount: 1 }],
        edges: [],
      } as unknown as TsModuleGraph;
      const input = makeMinimalArchJson({
        workspaceRoot: WS,
        entities: absoluteFixture().entities as Entity[],
        extensions: { tsAnalysis: { version: '1.0', moduleGraph } },
      });

      const canon = canonicalizeArchJson(input);
      // Entity names (the part after `.`) are not paths.
      expect(canon.entities.map((entity) => entity.name)).toEqual(['Name', 'Other']);
      // Directory ids are a different coordinate system and stay as emitted.
      expect(canon.extensions?.tsAnalysis?.moduleGraph?.nodes?.[0]).toEqual({
        id: '/tmp/ws/a',
        fileCount: 1,
      });
    });

    it('buildArchIndex reports identical internal/external relation counts per type before and after normalization', () => {
      const raw = absoluteFixture();
      const before = buildArchIndex(raw, 'hash-before');
      const after = buildArchIndex(canonicalizeArchJson(raw), 'hash-after');

      const internalCounts = (index: typeof before) =>
        Object.fromEntries(
          Object.entries(index.relationsByType ?? {}).map(([type, edges]) => [
            type,
            (edges ?? []).length,
          ])
        );
      expect(internalCounts(after)).toEqual(internalCounts(before));
      expect(internalCounts(before)).toEqual({ dependency: 1 });
      const externalCounts = (index: typeof before) =>
        Object.fromEntries(
          Object.entries(index.externalRelationsByType ?? {}).map(([type, edges]) => [
            type,
            (edges ?? []).length,
          ])
        );
      expect(externalCounts(after)).toEqual(externalCounts(before));
      // The unresolved endpoint is still visible as external, now keyed by the
      // normalized source id.
      expect(after.externalRelationsByType?.dependency).toEqual([
        { from: 'a/b.ts.Name', to: 'ExternalBase', sourceResolved: true, targetResolved: false },
      ]);
      expect(after.relationsByType.dependency).toEqual([['a/b.ts.Name', 'a/b.ts.Other']]);
    });

    it('is byte-identical when canonicalized twice', () => {
      const once = canonicalizeArchJson(absoluteFixture());
      const twice = canonicalizeArchJson(once);
      expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    });

    it('normalizes module entity-id references together with the entities', () => {
      const input = makeMinimalArchJson({
        workspaceRoot: WS,
        entities: absoluteFixture().entities as Entity[],
        modules: [{ name: 'b', entities: [`${ABS_FILE}.Other`, `${ABS_FILE}.Name`] }],
      });

      const canon = canonicalizeArchJson(input);
      expect(canon.modules?.[0].entities).toEqual(['a/b.ts.Name', 'a/b.ts.Other']);
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
