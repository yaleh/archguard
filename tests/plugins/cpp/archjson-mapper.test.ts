import { describe, it, expect } from 'vitest';
import { ArchJsonMapper } from '@/plugins/cpp/archjson-mapper.js';
import type { MergedCppEntity } from '@/plugins/cpp/types.js';

function makeEntity(overrides: Partial<MergedCppEntity> = {}): MergedCppEntity {
  return {
    name: 'Foo',
    qualifiedName: 'Foo',
    kind: 'class',
    bases: [],
    fields: [],
    methods: [],
    sourceFile: 'src/foo.hpp',
    declarationFile: 'src/foo.hpp',
    startLine: 1,
    endLine: 10,
    ...overrides,
  };
}

describe('ArchJsonMapper', () => {
  const mapper = new ArchJsonMapper();

  describe('mapEntities', () => {
    it('uses generateEntityId format: ns.qualifiedName', () => {
      const entity = makeEntity({ qualifiedName: 'engine::Renderer', declarationFile: 'src/engine/renderer.hpp' });
      const entities = mapper.mapEntities([entity], [], [], 'src');
      expect(entities[0].id).toBe('engine.engine::Renderer');
    });

    it('maps class kind correctly', () => {
      const entities = mapper.mapEntities([makeEntity({ kind: 'class' })], [], [], '');
      expect(entities[0].type).toBe('class');
    });

    it('maps struct kind correctly', () => {
      const entities = mapper.mapEntities([makeEntity({ kind: 'struct' })], [], [], '');
      expect(entities[0].type).toBe('struct');
    });

    it('sourceLocation uses declarationFile', () => {
      const entity = makeEntity({ declarationFile: 'src/foo.hpp', startLine: 5, endLine: 20 });
      const entities = mapper.mapEntities([entity], [], [], '');
      expect(entities[0].sourceLocation.file).toBe('src/foo.hpp');
      expect(entities[0].sourceLocation.startLine).toBe(5);
    });
  });

  describe('mapRelations', () => {
    it('inheritance base → Relation type inheritance', () => {
      const baseEntity = makeEntity({ name: 'Base', qualifiedName: 'Base' });
      const derivedEntity = makeEntity({
        name: 'Derived',
        qualifiedName: 'Derived',
        bases: [{ name: 'Base', access: 'public' }],
      });
      const allEntities = mapper.mapEntities([baseEntity, derivedEntity], [], [], '');
      const relations = mapper.mapRelations([derivedEntity], allEntities);
      expect(relations).toHaveLength(1);
      expect(relations[0].type).toBe('inheritance');
      expect(relations[0].inferenceSource).toBe('explicit');
    });

    it('unresolved base name → relation omitted', () => {
      const derived = makeEntity({ bases: [{ name: 'ExternalBase', access: 'public' }] });
      const allEntities = mapper.mapEntities([derived], [], [], '');
      const relations = mapper.mapRelations([derived], allEntities);
      expect(relations).toHaveLength(0);
    });

    it('relation id uses source_type_target format', () => {
      const baseE = makeEntity({ name: 'A', qualifiedName: 'A' });
      const derived = makeEntity({ name: 'B', qualifiedName: 'B', bases: [{ name: 'A', access: 'public' }] });
      const all = mapper.mapEntities([baseE, derived], [], [], '');
      const relations = mapper.mapRelations([derived], all);
      expect(relations[0].id).toMatch(/inheritance/);
    });

    it('value-type field → composition relation', () => {
      const target = makeEntity({ name: 'Engine', qualifiedName: 'Engine' });
      const src = makeEntity({
        name: 'Car',
        qualifiedName: 'Car',
        fields: [{ name: 'engine', fieldType: 'Engine', visibility: 'private', isStatic: false }],
      });
      const all = mapper.mapEntities([target, src], [], [], '');
      const relations = mapper.mapRelations([src], all);
      expect(relations).toHaveLength(1);
      expect(relations[0].type).toBe('composition');
    });

    it('unique_ptr field → composition relation', () => {
      const target = makeEntity({ name: 'Widget', qualifiedName: 'Widget' });
      const src = makeEntity({
        name: 'Window',
        qualifiedName: 'Window',
        fields: [{ name: 'w', fieldType: 'std::unique_ptr<Widget>', visibility: 'private', isStatic: false }],
      });
      const all = mapper.mapEntities([target, src], [], [], '');
      const relations = mapper.mapRelations([src], all);
      expect(relations).toHaveLength(1);
      expect(relations[0].type).toBe('composition');
    });

    it('raw pointer field → aggregation relation', () => {
      const target = makeEntity({ name: 'Context', qualifiedName: 'Context' });
      const src = makeEntity({
        name: 'Renderer',
        qualifiedName: 'Renderer',
        fields: [{ name: 'ctx', fieldType: 'Context*', visibility: 'private', isStatic: false }],
      });
      const all = mapper.mapEntities([target, src], [], [], '');
      const relations = mapper.mapRelations([src], all);
      expect(relations).toHaveLength(1);
      expect(relations[0].type).toBe('aggregation');
    });

    it('method param → dependency relation', () => {
      const target = makeEntity({ name: 'Config', qualifiedName: 'Config' });
      const src = makeEntity({
        name: 'Loader',
        qualifiedName: 'Loader',
        methods: [{
          name: 'load',
          returnType: 'void',
          parameters: [{ name: 'cfg', type: 'Config' }],
          visibility: 'public',
          isVirtual: false,
          isStatic: false,
          isPure: false,
          isConst: false,
          sourceFile: 'src/loader.hpp',
          startLine: 1,
        }],
      });
      const all = mapper.mapEntities([target, src], [], [], '');
      const relations = mapper.mapRelations([src], all);
      expect(relations).toHaveLength(1);
      expect(relations[0].type).toBe('dependency');
    });

    it('method return type → dependency relation', () => {
      const target = makeEntity({ name: 'Result', qualifiedName: 'Result' });
      const src = makeEntity({
        name: 'Factory',
        qualifiedName: 'Factory',
        methods: [{
          name: 'create',
          returnType: 'Result',
          parameters: [],
          visibility: 'public',
          isVirtual: false,
          isStatic: false,
          isPure: false,
          isConst: false,
          sourceFile: 'src/factory.hpp',
          startLine: 1,
        }],
      });
      const all = mapper.mapEntities([target, src], [], [], '');
      const relations = mapper.mapRelations([src], all);
      expect(relations).toHaveLength(1);
      expect(relations[0].type).toBe('dependency');
    });

    it('deduplicates identical relations', () => {
      const target = makeEntity({ name: 'Dep', qualifiedName: 'Dep' });
      const src = makeEntity({
        name: 'Owner',
        qualifiedName: 'Owner',
        fields: [
          { name: 'a', fieldType: 'Dep', visibility: 'private', isStatic: false },
          { name: 'b', fieldType: 'Dep', visibility: 'private', isStatic: false },
        ],
      });
      const all = mapper.mapEntities([target, src], [], [], '');
      const relations = mapper.mapRelations([src], all);
      // Both fields produce composition:Owner→Dep but should be deduplicated
      const compRels = relations.filter(r => r.type === 'composition');
      expect(compRels).toHaveLength(1);
    });

    it('no self-relations', () => {
      const src = makeEntity({
        name: 'Node',
        qualifiedName: 'Node',
        fields: [{ name: 'next', fieldType: 'Node*', visibility: 'public', isStatic: false }],
      });
      const all = mapper.mapEntities([src], [], [], '');
      const relations = mapper.mapRelations([src], all);
      expect(relations.every(r => r.from !== r.to)).toBe(true);
    });

    it('unresolved field type → relation omitted', () => {
      const src = makeEntity({
        name: 'Foo',
        qualifiedName: 'Foo',
        fields: [{ name: 'x', fieldType: 'UnknownType', visibility: 'private', isStatic: false }],
      });
      const all = mapper.mapEntities([src], [], [], '');
      const relations = mapper.mapRelations([src], all);
      expect(relations).toHaveLength(0);
    });

    it('primitive field type → no relation', () => {
      const src = makeEntity({
        name: 'Foo',
        qualifiedName: 'Foo',
        fields: [{ name: 'count', fieldType: 'int', visibility: 'private', isStatic: false }],
      });
      const all = mapper.mapEntities([src], [], [], '');
      const relations = mapper.mapRelations([src], all);
      expect(relations).toHaveLength(0);
    });
  });
});
