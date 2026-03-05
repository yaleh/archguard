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
  });
});
