/**
 * Unit tests for Java ArchJsonMapper mapEntities/mapRelations (complements the
 * existing archjson-mapper.test.ts which focuses on reconcileInheritanceTargets).
 */

import { describe, it, expect } from 'vitest';
import { ArchJsonMapper } from '@/plugins/java/archjson-mapper.js';
import type {
  JavaRawPackage,
  JavaRawClass,
  JavaRawInterface,
  JavaRawEnum,
} from '@/plugins/java/types.js';

const mapper = new ArchJsonMapper();

function makeClass(overrides: Partial<JavaRawClass> = {}): JavaRawClass {
  return {
    name: 'UserService',
    packageName: 'com.example.service',
    modifiers: ['public'],
    superClass: 'com.example.BaseService',
    interfaces: ['com.example.api.UserApi'],
    fields: [{ name: 'repo', type: 'UserRepo', modifiers: ['private'], annotations: [] }],
    methods: [
      {
        name: 'find',
        returnType: 'User',
        parameters: [{ name: 'id', type: 'long' }],
        modifiers: ['public'],
        annotations: [],
        isAbstract: false,
      },
    ],
    constructors: [],
    annotations: [],
    isAbstract: false,
    filePath: 'src/com/example/service/UserService.java',
    startLine: 1,
    endLine: 30,
    ...overrides,
  } as JavaRawClass;
}

function makePkg(
  classes: JavaRawClass[] = [makeClass()],
  overrides: Partial<JavaRawPackage> = {}
): JavaRawPackage {
  return { name: 'com.example.service', classes, interfaces: [], enums: [], ...overrides };
}

describe('Java ArchJsonMapper.mapEntities', () => {
  it('maps classes with package-derived ids and members', () => {
    const entities = mapper.mapEntities([makePkg()]);
    const e = entities[0];
    expect(e.name).toBe('UserService');
    expect(e.type).toBe('class');
    expect(e.id).toContain('com.example.service');
    expect(e.extends).toContain('com.example.BaseService');
    expect(e.implements).toContain('com.example.api.UserApi');
    expect(e.members.some((m) => m.name === 'find')).toBe(true);
  });

  it('maps interfaces and enums', () => {
    const iface: JavaRawInterface = {
      name: 'UserApi',
      packageName: 'com.example.api',
      modifiers: ['public'],
      extends: [],
      methods: [
        {
          name: 'get',
          returnType: 'User',
          parameters: [],
          modifiers: ['public'],
          annotations: [],
          isAbstract: true,
        },
      ],
      annotations: [],
      filePath: 'src/com/example/api/UserApi.java',
      startLine: 1,
      endLine: 10,
    };
    const en: JavaRawEnum = {
      name: 'Role',
      packageName: 'com.example.model',
      modifiers: ['public'],
      values: ['ADMIN', 'USER'],
      filePath: 'src/com/example/model/Role.java',
      startLine: 1,
      endLine: 8,
    };
    const entities = mapper.mapEntities([
      { name: 'com.example.api', classes: [], interfaces: [iface], enums: [] },
      { name: 'com.example.model', classes: [], interfaces: [], enums: [en] },
    ]);
    expect(entities.some((e) => e.type === 'interface' && e.name === 'UserApi')).toBe(true);
    const role = entities.find((e) => e.type === 'enum' && e.name === 'Role');
    expect(role?.members.map((m) => m.name)).toEqual(['ADMIN', 'USER']);
  });
});

describe('Java ArchJsonMapper.mapRelations', () => {
  it('creates inheritance relations from superClass', () => {
    const base = makeClass({
      name: 'BaseService',
      packageName: 'com.example',
      superClass: undefined,
      interfaces: [],
    });
    const pkg2: JavaRawPackage = {
      name: 'com.example',
      classes: [base],
      interfaces: [],
      enums: [],
    };
    const pkg = makePkg([makeClass()], { name: 'com.example.service' });
    const relations = mapper.mapRelations([pkg2, pkg]);
    expect(relations.some((r) => r.type === 'inheritance')).toBe(true);
  });

  it('creates implementation relations for interfaces', () => {
    const relations = mapper.mapRelations([makePkg()]);
    expect(relations.some((r) => r.type === 'implementation')).toBe(true);
  });
});
