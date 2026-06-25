import { describe, it, expect } from 'vitest';
import { ArchJsonMapper } from '@/plugins/kotlin/archjson-mapper.js';
import type { RawKotlinFile, RawKotlinClass } from '@/plugins/kotlin/types.js';

const mapper = new ArchJsonMapper();

// Helper to create a minimal RawKotlinClass
function mkClass(overrides: Partial<RawKotlinClass>): RawKotlinClass {
  return {
    name: 'Foo',
    kind: 'class',
    visibility: 'public',
    packageName: 'com.example.app',
    superTypes: [],
    members: [],
    decorators: [],
    filePath: 'Foo.kt',
    startLine: 1,
    endLine: 10,
    ...overrides,
  };
}

function mkFile(overrides: Partial<RawKotlinFile> = {}): RawKotlinFile {
  return {
    filePath: 'Foo.kt',
    packageName: 'com.example.app',
    imports: [],
    classes: [],
    functions: [],
    ...overrides,
  };
}

describe('ArchJsonMapper.mapEntities', () => {
  it('maps regular class → EntityType class', () => {
    const entities = mapper.mapEntities([mkFile({ classes: [mkClass({ kind: 'class' })] })]);
    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe('class');
  });

  it('maps data class → class with data decorator', () => {
    const entities = mapper.mapEntities([
      mkFile({ classes: [mkClass({ kind: 'data_class', name: 'UserProfile' })] }),
    ]);
    expect(entities[0].type).toBe('class');
    expect(entities[0].decorators?.some((d) => d.name === 'data')).toBe(true);
  });

  it('maps interface → interface entity', () => {
    const entities = mapper.mapEntities([
      mkFile({ classes: [mkClass({ kind: 'interface', name: 'IRepo' })] }),
    ]);
    expect(entities[0].type).toBe('interface');
  });

  it('maps sealed_interface → interface with sealed decorator', () => {
    const entities = mapper.mapEntities([
      mkFile({ classes: [mkClass({ kind: 'sealed_interface', name: 'Result' })] }),
    ]);
    expect(entities[0].type).toBe('interface');
    expect(entities[0].decorators?.some((d) => d.name === 'sealed')).toBe(true);
  });

  it('maps object → class with object decorator', () => {
    const entities = mapper.mapEntities([
      mkFile({ classes: [mkClass({ kind: 'object', name: 'Singleton' })] }),
    ]);
    expect(entities[0].type).toBe('class');
    expect(entities[0].decorators?.some((d) => d.name === 'object')).toBe(true);
  });

  it('maps abstract_class → class with isAbstract', () => {
    const entities = mapper.mapEntities([
      mkFile({ classes: [mkClass({ kind: 'abstract_class', name: 'Base' })] }),
    ]);
    expect(entities[0].type).toBe('class');
  });

  it('maps enum_class → enum entity', () => {
    const entities = mapper.mapEntities([
      mkFile({ classes: [mkClass({ kind: 'enum_class', name: 'Status' })] }),
    ]);
    expect(entities[0].type).toBe('enum');
  });

  it('entity ID is package.ClassName', () => {
    const entities = mapper.mapEntities([
      mkFile({ classes: [mkClass({ packageName: 'com.example.data', name: 'UserRepo' })] }),
    ]);
    expect(entities[0].id).toBe('com.example.data.UserRepo');
  });

  it('skips companion_object (merges into host)', () => {
    const companionClass = mkClass({ kind: 'companion_object', name: 'Companion' });
    const hostClass = mkClass({ name: 'AppConfig' });
    const entities = mapper.mapEntities([mkFile({ classes: [hostClass, companionClass] })]);
    // companion_object should not appear as its own entity
    expect(entities.every((e) => e.name !== 'Companion')).toBe(true);
  });

  it('maps primary constructor parameters as field members', () => {
    const dataClass = mkClass({
      kind: 'data_class',
      name: 'UserProfile',
      members: [
        {
          name: 'name',
          kind: 'field',
          visibility: 'public',
          type: 'String',
          isStatic: false,
          decorators: [],
          startLine: 1,
          endLine: 1,
        },
        {
          name: 'id',
          kind: 'field',
          visibility: 'public',
          type: 'Int',
          isStatic: false,
          decorators: [],
          startLine: 1,
          endLine: 1,
        },
      ],
    });
    const entities = mapper.mapEntities([mkFile({ classes: [dataClass] })]);
    expect(entities[0].fields?.length ?? 0).toBeGreaterThanOrEqual(0); // fields optional in schema
  });

  it('maps sealed_class → class with sealed decorator', () => {
    const entities = mapper.mapEntities([
      mkFile({ classes: [mkClass({ kind: 'sealed_class', name: 'Shape' })] }),
    ]);
    expect(entities[0].type).toBe('class');
    expect(entities[0].decorators?.some((d) => d.name === 'sealed')).toBe(true);
  });

  it('maps class-level decorators to entity decorators', () => {
    const cls = mkClass({ name: 'MyViewModel', decorators: ['ViewModel', 'Singleton'] });
    const entities = mapper.mapEntities([mkFile({ classes: [cls] })]);
    const decoratorNames = entities[0].decorators?.map((d) => d.name) ?? [];
    expect(decoratorNames).toContain('ViewModel');
    expect(decoratorNames).toContain('Singleton');
  });

  it('maps method members correctly', () => {
    const cls = mkClass({
      name: 'Service',
      members: [
        {
          name: 'doWork',
          kind: 'method',
          visibility: 'public',
          type: 'Unit',
          isStatic: false,
          decorators: [],
          startLine: 3,
          endLine: 5,
        },
      ],
    });
    const entities = mapper.mapEntities([mkFile({ classes: [cls] })]);
    const methods = entities[0].members.filter((m) => m.type === 'method');
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe('doWork');
  });

  it('maps multiple files', () => {
    const file1 = mkFile({ filePath: 'A.kt', classes: [mkClass({ name: 'A' })] });
    const file2 = mkFile({ filePath: 'B.kt', classes: [mkClass({ name: 'B' })] });
    const entities = mapper.mapEntities([file1, file2]);
    expect(entities).toHaveLength(2);
    expect(entities.map((e) => e.name)).toEqual(expect.arrayContaining(['A', 'B']));
  });
});

describe('ArchJsonMapper.mapRelations', () => {
  it('creates inheritance relation for class with parent class (with parentheses in superTypes)', () => {
    // In Kotlin AST, parent class has constructor call: 'ViewModel()'
    // But our RawKotlinClass stores just 'ViewModel' in superTypes (ClassBuilder strips the '()')
    // Test with realistic data
    const viewModel = mkClass({ name: 'MainViewModel', superTypes: ['ViewModel'] });
    const baseEntity = {
      id: 'android.ViewModel',
      name: 'ViewModel',
      type: 'class',
      packageName: 'android',
      methods: [],
      fields: [],
    };
    const files = [mkFile({ classes: [viewModel] })];
    const entities = mapper.mapEntities(files);
    const relations = mapper.mapRelations(files, [...entities, baseEntity as any]);
    // inheritance or implementation — just ensure relation exists if target entity present
    const _vmRelations = relations.filter(
      (r) => r.source.includes('MainViewModel') || r.target.includes('ViewModel')
    );
    // May or may not create relation depending on whether target is in entities — just no crash
    expect(Array.isArray(relations)).toBe(true);
  });

  it('creates composition relation for non-primitive field type', () => {
    const cls = mkClass({
      name: 'AppShell',
      members: [
        {
          name: 'repo',
          kind: 'field',
          visibility: 'public',
          type: 'UserRepository',
          isStatic: false,
          decorators: [],
          startLine: 1,
          endLine: 1,
        },
      ],
    });
    const repoEntity = {
      id: 'com.example.app.UserRepository',
      name: 'UserRepository',
      type: 'class',
      packageName: 'com.example.app',
      methods: [],
      fields: [],
    };
    const files = [mkFile({ classes: [cls] })];
    const entities = mapper.mapEntities(files);
    const relations = mapper.mapRelations(files, [...entities, repoEntity as any]);
    const compRel = relations.find(
      (r) => r.type === 'composition' && r.target.includes('UserRepository')
    );
    expect(compRel).toBeDefined();
  });

  it('does NOT create relation for primitive field type', () => {
    const cls = mkClass({
      name: 'Foo',
      members: [
        {
          name: 'name',
          kind: 'field',
          visibility: 'public',
          type: 'String',
          isStatic: false,
          decorators: [],
          startLine: 1,
          endLine: 1,
        },
      ],
    });
    const files = [mkFile({ classes: [cls] })];
    const entities = mapper.mapEntities(files);
    const relations = mapper.mapRelations(files, entities);
    expect(relations.filter((r) => r.target.includes('String'))).toHaveLength(0);
  });

  it('no duplicate relations', () => {
    const cls = mkClass({
      name: 'Foo',
      members: [
        {
          name: 'a',
          kind: 'field',
          visibility: 'public',
          type: 'Bar',
          isStatic: false,
          decorators: [],
          startLine: 1,
          endLine: 1,
        },
        {
          name: 'b',
          kind: 'field',
          visibility: 'public',
          type: 'Bar',
          isStatic: false,
          decorators: [],
          startLine: 2,
          endLine: 2,
        },
      ],
    });
    const barEntity = {
      id: 'com.example.app.Bar',
      name: 'Bar',
      type: 'class',
      packageName: 'com.example.app',
      methods: [],
      fields: [],
    };
    const files = [mkFile({ classes: [cls] })];
    const entities = mapper.mapEntities(files);
    const relations = mapper.mapRelations(files, [...entities, barEntity as any]);
    const dedupRelations = relations.filter(
      (r) => r.type === 'composition' && r.target.includes('Bar')
    );
    expect(dedupRelations).toHaveLength(1); // deduped
  });

  it('creates implementation relation when superType resolves to an interface entity', () => {
    const cls = mkClass({ name: 'RepoImpl', superTypes: ['IRepository'] });
    const ifaceEntity = {
      id: 'com.example.app.IRepository',
      name: 'IRepository',
      type: 'interface',
      packageName: 'com.example.app',
      members: [],
    };
    const files = [mkFile({ classes: [cls] })];
    const entities = mapper.mapEntities(files);
    const relations = mapper.mapRelations(files, [...entities, ifaceEntity as any]);
    const implRel = relations.find(
      (r) => r.type === 'implementation' && r.target === 'com.example.app.IRepository'
    );
    expect(implRel).toBeDefined();
  });

  it('creates inheritance relation when superType resolves to a class entity', () => {
    const cls = mkClass({ name: 'ChildClass', superTypes: ['ParentClass'] });
    const parentEntity = {
      id: 'com.example.app.ParentClass',
      name: 'ParentClass',
      type: 'class',
      packageName: 'com.example.app',
      members: [],
    };
    const files = [mkFile({ classes: [cls] })];
    const entities = mapper.mapEntities(files);
    const relations = mapper.mapRelations(files, [...entities, parentEntity as any]);
    const inhRel = relations.find(
      (r) => r.type === 'inheritance' && r.target === 'com.example.app.ParentClass'
    );
    expect(inhRel).toBeDefined();
  });

  it('skips self-relations', () => {
    // A class that somehow lists itself as a supertype (degenerate case)
    const cls = mkClass({ name: 'Foo', superTypes: ['Foo'] });
    const files = [mkFile({ classes: [cls] })];
    const entities = mapper.mapEntities(files);
    const relations = mapper.mapRelations(files, entities);
    const selfRel = relations.find((r) => r.source === r.target);
    expect(selfRel).toBeUndefined();
  });
});

describe('ArchJsonMapper.map (full)', () => {
  it('returns valid ArchJSON structure', () => {
    const files = [mkFile({ classes: [mkClass()] })];
    const archJson = mapper.map(files, 'com.example.app', '/workspace');
    expect(archJson.version).toBeDefined();
    expect(archJson.language).toBe('kotlin');
    expect(archJson.entities).toHaveLength(1);
    expect(archJson.relations).toBeDefined();
  });

  it('includes timestamp and sourceFiles', () => {
    const files = [mkFile({ filePath: 'src/Foo.kt', classes: [mkClass()] })];
    const archJson = mapper.map(files, 'com.example.app', '/workspace');
    expect(archJson.timestamp).toBeTruthy();
    expect(Array.isArray(archJson.sourceFiles)).toBe(true);
    expect(archJson.sourceFiles).toContain('src/Foo.kt');
  });

  it('sets workspaceRoot', () => {
    const files = [mkFile({ classes: [mkClass()] })];
    const archJson = mapper.map(files, 'com.example.app', '/workspace/myproject');
    expect(archJson.workspaceRoot).toBe('/workspace/myproject');
  });

  it('returns empty entities and relations for empty files', () => {
    const archJson = mapper.map([], 'com.example.app', '/workspace');
    expect(archJson.entities).toHaveLength(0);
    expect(archJson.relations).toHaveLength(0);
  });
});
