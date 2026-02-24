import { describe, it, expect, beforeEach } from 'vitest';
import { ArchJsonMapper } from '@/plugins/java/archjson-mapper.js';
import type {
  JavaRawPackage,
  JavaRawClass,
  JavaRawInterface,
  JavaRawEnum,
} from '@/plugins/java/types.js';

describe('JavaArchJsonMapper', () => {
  let mapper: ArchJsonMapper;

  beforeEach(() => {
    mapper = new ArchJsonMapper();
  });

  describe('Entity Mapping', () => {
    it('should map Java class to Entity', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [
          {
            name: 'User',
            packageName: 'com.example',
            modifiers: ['public'],
            interfaces: [],
            fields: [
              {
                name: 'name',
                type: 'String',
                modifiers: ['private'],
                annotations: [],
              },
            ],
            methods: [
              {
                name: 'getName',
                returnType: 'String',
                parameters: [],
                modifiers: ['public'],
                annotations: [],
                isAbstract: false,
              },
            ],
            constructors: [],
            annotations: [],
            isAbstract: false,
            filePath: 'User.java',
            startLine: 1,
            endLine: 10,
          },
        ],
        interfaces: [],
        enums: [],
      };

      const entities = mapper.mapEntities([pkg]);

      expect(entities).toHaveLength(1);
      expect(entities[0].id).toBe('com.example.User');
      expect(entities[0].name).toBe('User');
      expect(entities[0].type).toBe('class');
      expect(entities[0].visibility).toBe('public');
      expect(entities[0].members).toHaveLength(2);
    });

    it('should map Java interface to Entity', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [],
        interfaces: [
          {
            name: 'Service',
            packageName: 'com.example',
            modifiers: ['public'],
            extends: [],
            methods: [
              {
                name: 'start',
                returnType: 'void',
                parameters: [],
                modifiers: ['public'],
                annotations: [],
                isAbstract: false,
              },
            ],
            annotations: [],
            filePath: 'Service.java',
            startLine: 1,
            endLine: 5,
          },
        ],
        enums: [],
      };

      const entities = mapper.mapEntities([pkg]);

      expect(entities).toHaveLength(1);
      expect(entities[0].id).toBe('com.example.Service');
      expect(entities[0].name).toBe('Service');
      expect(entities[0].type).toBe('interface');
      expect(entities[0].visibility).toBe('public');
    });

    it('should map Java enum to Entity', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [],
        interfaces: [],
        enums: [
          {
            name: 'Status',
            packageName: 'com.example',
            modifiers: ['public'],
            values: ['ACTIVE', 'INACTIVE'],
            filePath: 'Status.java',
            startLine: 1,
            endLine: 5,
          },
        ],
      };

      const entities = mapper.mapEntities([pkg]);

      expect(entities).toHaveLength(1);
      expect(entities[0].id).toBe('com.example.Status');
      expect(entities[0].name).toBe('Status');
      expect(entities[0].type).toBe('enum');
      expect(entities[0].members).toHaveLength(2);
      expect(entities[0].members[0].name).toBe('ACTIVE');
      expect(entities[0].members[1].name).toBe('INACTIVE');
    });

    it('should map abstract class correctly', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [
          {
            name: 'AbstractService',
            packageName: 'com.example',
            modifiers: ['public', 'abstract'],
            interfaces: [],
            fields: [],
            methods: [],
            constructors: [],
            annotations: [],
            isAbstract: true,
            filePath: 'AbstractService.java',
            startLine: 1,
            endLine: 5,
          },
        ],
        interfaces: [],
        enums: [],
      };

      const entities = mapper.mapEntities([pkg]);

      expect(entities[0].isAbstract).toBe(true);
    });
  });

  describe('Member Mapping', () => {
    it('should map fields correctly', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [
          {
            name: 'User',
            packageName: 'com.example',
            modifiers: ['public'],
            interfaces: [],
            fields: [
              {
                name: 'name',
                type: 'String',
                modifiers: ['private'],
                annotations: [],
              },
              {
                name: 'age',
                type: 'int',
                modifiers: ['private'],
                annotations: [],
              },
            ],
            methods: [],
            constructors: [],
            annotations: [],
            isAbstract: false,
            filePath: 'User.java',
            startLine: 1,
            endLine: 10,
          },
        ],
        interfaces: [],
        enums: [],
      };

      const entities = mapper.mapEntities([pkg]);
      const fields = entities[0].members.filter((m) => m.type === 'field');

      expect(fields).toHaveLength(2);
      expect(fields[0].name).toBe('name');
      expect(fields[0].fieldType).toBe('String');
      expect(fields[0].visibility).toBe('private');
      expect(fields[1].name).toBe('age');
      expect(fields[1].fieldType).toBe('int');
    });

    it('should map methods correctly', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [
          {
            name: 'User',
            packageName: 'com.example',
            modifiers: ['public'],
            interfaces: [],
            fields: [],
            methods: [
              {
                name: 'getName',
                returnType: 'String',
                parameters: [],
                modifiers: ['public'],
                annotations: [],
                isAbstract: false,
              },
              {
                name: 'setName',
                returnType: 'void',
                parameters: [{ name: 'name', type: 'String', annotations: [] }],
                modifiers: ['public'],
                annotations: [],
                isAbstract: false,
              },
            ],
            constructors: [],
            annotations: [],
            isAbstract: false,
            filePath: 'User.java',
            startLine: 1,
            endLine: 10,
          },
        ],
        interfaces: [],
        enums: [],
      };

      const entities = mapper.mapEntities([pkg]);
      const methods = entities[0].members.filter((m) => m.type === 'method');

      expect(methods).toHaveLength(2);
      expect(methods[0].name).toBe('getName');
      expect(methods[0].returnType).toBe('String');
      expect(methods[0].parameters).toHaveLength(0);
      expect(methods[1].name).toBe('setName');
      expect(methods[1].returnType).toBe('void');
      expect(methods[1].parameters).toHaveLength(1);
      expect(methods[1].parameters?.[0].name).toBe('name');
    });

    it('should map constructors correctly', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [
          {
            name: 'User',
            packageName: 'com.example',
            modifiers: ['public'],
            interfaces: [],
            fields: [],
            methods: [],
            constructors: [
              {
                parameters: [
                  { name: 'name', type: 'String', annotations: [] },
                  { name: 'age', type: 'int', annotations: [] },
                ],
                modifiers: ['public'],
                annotations: [],
              },
            ],
            annotations: [],
            isAbstract: false,
            filePath: 'User.java',
            startLine: 1,
            endLine: 10,
          },
        ],
        interfaces: [],
        enums: [],
      };

      const entities = mapper.mapEntities([pkg]);
      const constructors = entities[0].members.filter((m) => m.type === 'constructor');

      expect(constructors).toHaveLength(1);
      expect(constructors[0].name).toBe('User');
      expect(constructors[0].parameters).toHaveLength(2);
    });
  });

  describe('Visibility Mapping', () => {
    it('should map public modifier correctly', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [
          {
            name: 'User',
            packageName: 'com.example',
            modifiers: ['public'],
            interfaces: [],
            fields: [],
            methods: [],
            constructors: [],
            annotations: [],
            isAbstract: false,
            filePath: 'User.java',
            startLine: 1,
            endLine: 10,
          },
        ],
        interfaces: [],
        enums: [],
      };

      const entities = mapper.mapEntities([pkg]);
      expect(entities[0].visibility).toBe('public');
    });

    it('should map private modifier correctly', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [
          {
            name: 'InternalUser',
            packageName: 'com.example',
            modifiers: ['private'],
            interfaces: [],
            fields: [],
            methods: [],
            constructors: [],
            annotations: [],
            isAbstract: false,
            filePath: 'User.java',
            startLine: 1,
            endLine: 10,
          },
        ],
        interfaces: [],
        enums: [],
      };

      const entities = mapper.mapEntities([pkg]);
      expect(entities[0].visibility).toBe('private');
    });

    it('should map protected modifier correctly', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [
          {
            name: 'User',
            packageName: 'com.example',
            modifiers: ['protected'],
            interfaces: [],
            fields: [],
            methods: [],
            constructors: [],
            annotations: [],
            isAbstract: false,
            filePath: 'User.java',
            startLine: 1,
            endLine: 10,
          },
        ],
        interfaces: [],
        enums: [],
      };

      const entities = mapper.mapEntities([pkg]);
      expect(entities[0].visibility).toBe('protected');
    });

    it('should default to public for package-private classes', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [
          {
            name: 'User',
            packageName: 'com.example',
            modifiers: [],
            interfaces: [],
            fields: [],
            methods: [],
            constructors: [],
            annotations: [],
            isAbstract: false,
            filePath: 'User.java',
            startLine: 1,
            endLine: 10,
          },
        ],
        interfaces: [],
        enums: [],
      };

      const entities = mapper.mapEntities([pkg]);
      expect(entities[0].visibility).toBe('public');
    });
  });

  describe('Relation Mapping', () => {
    it('should create inheritance relation for extends', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [
          {
            name: 'AdminUser',
            packageName: 'com.example',
            modifiers: ['public'],
            superClass: 'User',
            interfaces: [],
            fields: [],
            methods: [],
            constructors: [],
            annotations: [],
            isAbstract: false,
            filePath: 'AdminUser.java',
            startLine: 1,
            endLine: 10,
          },
        ],
        interfaces: [],
        enums: [],
      };

      const relations = mapper.mapRelations([pkg]);

      expect(relations).toHaveLength(1);
      expect(relations[0].type).toBe('inheritance');
      expect(relations[0].source).toBe('com.example.AdminUser');
      expect(relations[0].target).toContain('User');
    });

    it('should create implementation relation for implements', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [
          {
            name: 'UserService',
            packageName: 'com.example',
            modifiers: ['public'],
            interfaces: ['Service'],
            fields: [],
            methods: [],
            constructors: [],
            annotations: [],
            isAbstract: false,
            filePath: 'UserService.java',
            startLine: 1,
            endLine: 10,
          },
        ],
        interfaces: [],
        enums: [],
      };

      const relations = mapper.mapRelations([pkg]);

      expect(relations).toHaveLength(1);
      expect(relations[0].type).toBe('implementation');
      expect(relations[0].source).toBe('com.example.UserService');
      expect(relations[0].target).toContain('Service');
    });

    it('should create inheritance relation for interface extends', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [],
        interfaces: [
          {
            name: 'ExtendedService',
            packageName: 'com.example',
            modifiers: ['public'],
            extends: ['Service', 'AnotherService'],
            methods: [],
            annotations: [],
            filePath: 'ExtendedService.java',
            startLine: 1,
            endLine: 5,
          },
        ],
        enums: [],
      };

      const relations = mapper.mapRelations([pkg]);

      expect(relations).toHaveLength(2);
      expect(relations[0].type).toBe('inheritance');
      expect(relations[1].type).toBe('inheritance');
    });

    it('should create dependency relation for field types', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [
          {
            name: 'UserService',
            packageName: 'com.example',
            modifiers: ['public'],
            interfaces: [],
            fields: [
              {
                name: 'repository',
                type: 'UserRepository',
                modifiers: ['private'],
                annotations: [],
              },
            ],
            methods: [],
            constructors: [],
            annotations: [],
            isAbstract: false,
            filePath: 'UserService.java',
            startLine: 1,
            endLine: 10,
          },
        ],
        interfaces: [],
        enums: [],
      };

      const relations = mapper.mapRelations([pkg]);

      const dependencies = relations.filter((r) => r.type === 'dependency');
      expect(dependencies.length).toBeGreaterThan(0);
      expect(dependencies[0].source).toBe('com.example.UserService');
      expect(dependencies[0].target).toContain('UserRepository');
    });
  });

  describe('Annotation Handling', () => {
    it('should preserve decorators from annotations', () => {
      const pkg: JavaRawPackage = {
        name: 'com.example',
        classes: [
          {
            name: 'LegacyService',
            packageName: 'com.example',
            modifiers: ['public'],
            interfaces: [],
            fields: [],
            methods: [],
            constructors: [],
            annotations: [{ name: 'Deprecated', arguments: undefined }],
            isAbstract: false,
            filePath: 'LegacyService.java',
            startLine: 1,
            endLine: 5,
          },
        ],
        interfaces: [],
        enums: [],
      };

      const entities = mapper.mapEntities([pkg]);

      expect(entities[0].decorators).toHaveLength(1);
      expect(entities[0].decorators?.[0].name).toBe('Deprecated');
    });
  });
});
