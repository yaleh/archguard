/**
 * TASK-71 — ArchJsonMapper branch-dense path extra tests.
 *
 * Fills gaps in archjson-mapper.test.ts:
 *   - `abstract_class` → `isAbstract: true` on the Entity (branch at
 *     mapEntities line `...(cls.kind === 'abstract_class' ? { isAbstract: true } : {})`)
 *   - mapMember: field WITHOUT a type → no `fieldType` key; method WITHOUT a
 *     type → no `returnType` key (member-type branches)
 *   - mapRelations: fully-qualified superType name (contains '.') resolved via
 *     the entityById path
 *   - mapRelations: unresolvable superType produces no relation
 */
import { describe, it, expect } from 'vitest';
import { ArchJsonMapper } from '@/plugins/kotlin/archjson-mapper.js';
import type { RawKotlinFile, RawKotlinClass } from '@/plugins/kotlin/types.js';

const mapper = new ArchJsonMapper();

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

describe('ArchJsonMapper.mapEntities — abstract_class branch', () => {
  it('sets isAbstract: true for abstract_class kind', () => {
    const entities = mapper.mapEntities([
      mkFile({ classes: [mkClass({ kind: 'abstract_class' })] }),
    ]);
    expect(entities[0].type).toBe('class');
    expect(entities[0].isAbstract).toBe(true);
  });

  it('does NOT set isAbstract for a plain class', () => {
    const entities = mapper.mapEntities([mkFile({ classes: [mkClass({ kind: 'class' })] })]);
    expect(entities[0].isAbstract).toBeUndefined();
  });

  it('does NOT set isAbstract for an interface', () => {
    const entities = mapper.mapEntities([mkFile({ classes: [mkClass({ kind: 'interface' })] })]);
    expect(entities[0].isAbstract).toBeUndefined();
  });
});

describe('ArchJsonMapper.mapMember — optional type branches', () => {
  it('field WITHOUT type → no fieldType key', () => {
    const cls = mkClass({
      name: 'Foo',
      members: [
        {
          name: 'untyped',
          kind: 'field',
          visibility: 'public',
          isStatic: false,
          decorators: [],
          startLine: 1,
          endLine: 1,
        },
      ],
    });
    const entities = mapper.mapEntities([mkFile({ classes: [cls] })]);
    const field = entities[0].members[0];
    expect(field.type).toBe('field');
    expect(field.fieldType).toBeUndefined();
  });

  it('field WITH type → fieldType key present', () => {
    const cls = mkClass({
      name: 'Foo',
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
    const entities = mapper.mapEntities([mkFile({ classes: [cls] })]);
    const field = entities[0].members[0];
    expect(field.fieldType).toBe('UserRepository');
  });

  it('method WITHOUT type → no returnType key', () => {
    const cls = mkClass({
      name: 'Foo',
      members: [
        {
          name: 'doWork',
          kind: 'method',
          visibility: 'public',
          isStatic: false,
          decorators: [],
          startLine: 1,
          endLine: 1,
        },
      ],
    });
    const entities = mapper.mapEntities([mkFile({ classes: [cls] })]);
    const method = entities[0].members[0];
    expect(method.type).toBe('method');
    expect(method.returnType).toBeUndefined();
  });

  it('method WITH type → returnType key present', () => {
    const cls = mkClass({
      name: 'Foo',
      members: [
        {
          name: 'doWork',
          kind: 'method',
          visibility: 'public',
          type: 'String',
          isStatic: false,
          decorators: [],
          startLine: 1,
          endLine: 1,
        },
      ],
    });
    const entities = mapper.mapEntities([mkFile({ classes: [cls] })]);
    const method = entities[0].members[0];
    expect(method.returnType).toBe('String');
  });
});

describe('ArchJsonMapper.mapRelations — fully-qualified superType resolution', () => {
  it('resolves a dotted fully-qualified superType via entityById', () => {
    const cls = mkClass({ name: 'MainViewModel', superTypes: ['androidx.lifecycle.ViewModel'] });
    const vmEntity = {
      id: 'androidx.lifecycle.ViewModel',
      name: 'ViewModel',
      type: 'class',
      packageName: 'androidx.lifecycle',
      methods: [],
      fields: [],
    };
    const files = [mkFile({ classes: [cls] })];
    const entities = mapper.mapEntities(files);
    const relations = mapper.mapRelations(files, [...entities, vmEntity as any]);
    const rel = relations.find((r) => r.type === 'inheritance');
    expect(rel).toBeDefined();
    expect(rel?.target).toBe('androidx.lifecycle.ViewModel');
  });

  it('produces no relation when superType cannot be resolved', () => {
    const cls = mkClass({ name: 'Foo', superTypes: ['NoSuchEntity'] });
    const files = [mkFile({ classes: [cls] })];
    const entities = mapper.mapEntities(files);
    const relations = mapper.mapRelations(files, entities);
    expect(relations).toHaveLength(0);
  });

  it('resolves superType by simple name (entityByName path)', () => {
    const cls = mkClass({ name: 'Child', superTypes: ['Parent'] });
    const parentEntity = {
      id: 'com.example.app.Parent',
      name: 'Parent',
      type: 'class',
      packageName: 'com.example.app',
      methods: [],
      fields: [],
    };
    const files = [mkFile({ classes: [cls] })];
    const entities = mapper.mapEntities(files);
    const relations = mapper.mapRelations(files, [...entities, parentEntity as any]);
    const rel = relations.find((r) => r.type === 'inheritance');
    expect(rel?.target).toBe('com.example.app.Parent');
  });
});
