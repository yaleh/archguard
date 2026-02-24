/**
 * Tests for Python ArchJsonMapper
 */

import { describe, it, expect } from 'vitest';
import { ArchJsonMapper } from '@/plugins/python/archjson-mapper.js';
import type {
  PythonRawModule,
  PythonRawClass,
  PythonRawFunction,
  PythonRawMethod,
} from '@/plugins/python/types.js';

describe('ArchJsonMapper', () => {
  const mapper = new ArchJsonMapper();

  describe('mapModule', () => {
    it('should map a simple class with methods', () => {
      const module: PythonRawModule = {
        name: 'test_module',
        filePath: '/test/module.py',
        classes: [
          {
            name: 'User',
            moduleName: 'test_module',
            baseClasses: [],
            methods: [
              {
                name: '__init__',
                parameters: [
                  { name: 'self', isVarArgs: false, isKwArgs: false },
                  { name: 'name', type: 'str', isVarArgs: false, isKwArgs: false },
                ],
                returnType: undefined,
                decorators: [],
                isClassMethod: false,
                isStaticMethod: false,
                isProperty: false,
                isAsync: false,
                isPrivate: false,
                startLine: 3,
                endLine: 5,
              },
              {
                name: 'get_name',
                parameters: [{ name: 'self', isVarArgs: false, isKwArgs: false }],
                returnType: 'str',
                decorators: [],
                isClassMethod: false,
                isStaticMethod: false,
                isProperty: false,
                isAsync: false,
                isPrivate: false,
                startLine: 7,
                endLine: 9,
              },
            ],
            properties: [],
            classAttributes: [],
            decorators: [],
            docstring: 'User class with basic methods.',
            filePath: '/test/module.py',
            startLine: 3,
            endLine: 10,
          },
        ],
        functions: [],
        imports: [],
      };

      const result = mapper.mapModule(module);

      expect(result.entities).toHaveLength(1);
      expect(result.relations).toHaveLength(0);

      const entity = result.entities[0];
      expect(entity.name).toBe('User');
      expect(entity.type).toBe('class');
      expect(entity.visibility).toBe('public');
      expect(entity.members).toHaveLength(2);

      // Check constructor
      const constructor = entity.members.find((m) => m.name === '__init__');
      expect(constructor).toBeDefined();
      expect(constructor?.type).toBe('method');
      expect(constructor?.parameters).toHaveLength(2);

      // Check method
      const getName = entity.members.find((m) => m.name === 'get_name');
      expect(getName).toBeDefined();
      expect(getName?.returnType).toBe('str');
    });

    it('should map class inheritance', () => {
      const module: PythonRawModule = {
        name: 'test_module',
        filePath: '/test/module.py',
        classes: [
          {
            name: 'User',
            moduleName: 'test_module',
            baseClasses: [],
            methods: [],
            properties: [],
            classAttributes: [],
            decorators: [],
            filePath: '/test/module.py',
            startLine: 3,
            endLine: 5,
          },
          {
            name: 'AdminUser',
            moduleName: 'test_module',
            baseClasses: ['User'],
            methods: [],
            properties: [],
            classAttributes: [],
            decorators: [],
            filePath: '/test/module.py',
            startLine: 7,
            endLine: 10,
          },
        ],
        functions: [],
        imports: [],
      };

      const result = mapper.mapModule(module);

      expect(result.entities).toHaveLength(2);
      expect(result.relations).toHaveLength(1);

      const relation = result.relations[0];
      expect(relation.type).toBe('inheritance');
      expect(relation.source).toContain('AdminUser');
      expect(relation.target).toContain('User');
    });

    it('should map multiple inheritance', () => {
      const module: PythonRawModule = {
        name: 'test_module',
        filePath: '/test/module.py',
        classes: [
          {
            name: 'User',
            moduleName: 'test_module',
            baseClasses: [],
            methods: [],
            properties: [],
            classAttributes: [],
            decorators: [],
            filePath: '/test/module.py',
            startLine: 3,
            endLine: 5,
          },
          {
            name: 'Auditable',
            moduleName: 'test_module',
            baseClasses: [],
            methods: [],
            properties: [],
            classAttributes: [],
            decorators: [],
            filePath: '/test/module.py',
            startLine: 7,
            endLine: 9,
          },
          {
            name: 'AdminUser',
            moduleName: 'test_module',
            baseClasses: ['User', 'Auditable'],
            methods: [],
            properties: [],
            classAttributes: [],
            decorators: [],
            filePath: '/test/module.py',
            startLine: 11,
            endLine: 15,
          },
        ],
        functions: [],
        imports: [],
      };

      const result = mapper.mapModule(module);

      expect(result.entities).toHaveLength(3);
      expect(result.relations).toHaveLength(2);

      const inheritanceRelations = result.relations.filter((r) => r.type === 'inheritance');
      expect(inheritanceRelations).toHaveLength(2);
      expect(inheritanceRelations[0].source).toContain('AdminUser');
      expect(inheritanceRelations[0].target).toContain('User');
      expect(inheritanceRelations[1].source).toContain('AdminUser');
      expect(inheritanceRelations[1].target).toContain('Auditable');
    });

    it('should map module-level functions as entities', () => {
      const module: PythonRawModule = {
        name: 'test_module',
        filePath: '/test/module.py',
        classes: [],
        functions: [
          {
            name: 'calculate_sum',
            moduleName: 'test_module',
            parameters: [
              { name: 'a', type: 'int', isVarArgs: false, isKwArgs: false },
              { name: 'b', type: 'int', isVarArgs: false, isKwArgs: false },
            ],
            returnType: 'int',
            decorators: [],
            isAsync: false,
            docstring: 'Calculate sum of two numbers',
            filePath: '/test/module.py',
            startLine: 3,
            endLine: 6,
          },
        ],
        imports: [],
      };

      const result = mapper.mapModule(module);

      expect(result.entities).toHaveLength(1);

      const entity = result.entities[0];
      expect(entity.name).toBe('calculate_sum');
      expect(entity.type).toBe('function');
      expect(entity.visibility).toBe('public');
      expect(entity.members).toHaveLength(1);
      expect(entity.members[0].name).toBe('calculate_sum');
      expect(entity.members[0].type).toBe('method');
    });

    it('should map decorated methods', () => {
      const module: PythonRawModule = {
        name: 'test_module',
        filePath: '/test/module.py',
        classes: [
          {
            name: 'Circle',
            moduleName: 'test_module',
            baseClasses: [],
            methods: [
              {
                name: 'radius',
                parameters: [{ name: 'self', isVarArgs: false, isKwArgs: false }],
                returnType: 'float',
                decorators: [{ name: 'property' }],
                isClassMethod: false,
                isStaticMethod: false,
                isProperty: true,
                isAsync: false,
                isPrivate: false,
                startLine: 5,
                endLine: 7,
              },
              {
                name: 'from_json',
                parameters: [
                  { name: 'cls', isVarArgs: false, isKwArgs: false },
                  { name: 'data', type: 'dict', isVarArgs: false, isKwArgs: false },
                ],
                returnType: 'Circle',
                decorators: [{ name: 'classmethod' }],
                isClassMethod: true,
                isStaticMethod: false,
                isProperty: false,
                isAsync: false,
                isPrivate: false,
                startLine: 9,
                endLine: 12,
              },
            ],
            properties: [],
            classAttributes: [],
            decorators: [],
            filePath: '/test/module.py',
            startLine: 3,
            endLine: 15,
          },
        ],
        functions: [],
        imports: [],
      };

      const result = mapper.mapModule(module);

      const entity = result.entities[0];
      expect(entity.members).toHaveLength(2);

      const property = entity.members.find((m) => m.name === 'radius');
      expect(property).toBeDefined();
      expect(property?.decorators).toHaveLength(1);
      expect(property?.decorators?.[0].name).toBe('property');

      const classmethod = entity.members.find((m) => m.name === 'from_json');
      expect(classmethod).toBeDefined();
      expect(classmethod?.decorators).toHaveLength(1);
      expect(classmethod?.decorators?.[0].name).toBe('classmethod');
      expect(classmethod?.isStatic).toBe(false);
    });

    it('should map async methods', () => {
      const module: PythonRawModule = {
        name: 'test_module',
        filePath: '/test/module.py',
        classes: [
          {
            name: 'AsyncService',
            moduleName: 'test_module',
            baseClasses: [],
            methods: [
              {
                name: 'fetch_data',
                parameters: [{ name: 'self', isVarArgs: false, isKwArgs: false }],
                returnType: 'str',
                decorators: [],
                isClassMethod: false,
                isStaticMethod: false,
                isProperty: false,
                isAsync: true,
                isPrivate: false,
                startLine: 5,
                endLine: 7,
              },
            ],
            properties: [],
            classAttributes: [],
            decorators: [],
            filePath: '/test/module.py',
            startLine: 3,
            endLine: 10,
          },
        ],
        functions: [],
        imports: [],
      };

      const result = mapper.mapModule(module);

      const entity = result.entities[0];
      const asyncMethod = entity.members.find((m) => m.name === 'fetch_data');
      expect(asyncMethod).toBeDefined();
      expect(asyncMethod?.isAsync).toBe(true);
    });

    it('should map private methods (double underscore prefix)', () => {
      const module: PythonRawModule = {
        name: 'test_module',
        filePath: '/test/module.py',
        classes: [
          {
            name: 'BankAccount',
            moduleName: 'test_module',
            baseClasses: [],
            methods: [
              {
                name: '__validate',
                parameters: [{ name: 'self', isVarArgs: false, isKwArgs: false }],
                returnType: 'bool',
                decorators: [],
                isClassMethod: false,
                isStaticMethod: false,
                isProperty: false,
                isAsync: false,
                isPrivate: true,
                startLine: 5,
                endLine: 7,
              },
            ],
            properties: [],
            classAttributes: [],
            decorators: [],
            filePath: '/test/module.py',
            startLine: 3,
            endLine: 10,
          },
        ],
        functions: [],
        imports: [],
      };

      const result = mapper.mapModule(module);

      const entity = result.entities[0];
      const privateMethod = entity.members.find((m) => m.name === '__validate');
      expect(privateMethod).toBeDefined();
      expect(privateMethod?.visibility).toBe('private');
    });

    it('should map static methods', () => {
      const module: PythonRawModule = {
        name: 'test_module',
        filePath: '/test/module.py',
        classes: [
          {
            name: 'Utility',
            moduleName: 'test_module',
            baseClasses: [],
            methods: [
              {
                name: 'format_date',
                parameters: [{ name: 'date', type: 'str', isVarArgs: false, isKwArgs: false }],
                returnType: 'str',
                decorators: [{ name: 'staticmethod' }],
                isClassMethod: false,
                isStaticMethod: true,
                isProperty: false,
                isAsync: false,
                isPrivate: false,
                startLine: 5,
                endLine: 7,
              },
            ],
            properties: [],
            classAttributes: [],
            decorators: [],
            filePath: '/test/module.py',
            startLine: 3,
            endLine: 10,
          },
        ],
        functions: [],
        imports: [],
      };

      const result = mapper.mapModule(module);

      const entity = result.entities[0];
      const staticMethod = entity.members.find((m) => m.name === 'format_date');
      expect(staticMethod).toBeDefined();
      expect(staticMethod?.isStatic).toBe(true);
    });

    it('should map imports as dependency relations', () => {
      const module: PythonRawModule = {
        name: 'test_module',
        filePath: '/test/module.py',
        classes: [],
        functions: [],
        imports: [
          { module: 'os' },
          { module: 'sys', alias: 'system' },
          { module: 'typing', items: [{ name: 'List' }, { name: 'Dict', alias: 'Dictionary' }] },
        ],
      };

      const result = mapper.mapModule(module);

      // Imports should create dependency relations
      expect(result.relations.length).toBeGreaterThan(0);

      const depRelations = result.relations.filter((r) => r.type === 'dependency');
      expect(depRelations.length).toBe(3);

      const osDep = depRelations.find((r) => r.target === 'os');
      expect(osDep).toBeDefined();

      const sysDep = depRelations.find((r) => r.target === 'sys');
      expect(sysDep).toBeDefined();

      const typingDep = depRelations.find((r) => r.target === 'typing');
      expect(typingDep).toBeDefined();
    });
  });

  describe('mapModules', () => {
    it('should map multiple modules', () => {
      const modules: PythonRawModule[] = [
        {
          name: 'module1',
          filePath: '/test/module1.py',
          classes: [
            {
              name: 'Class1',
              moduleName: 'module1',
              baseClasses: [],
              methods: [],
              properties: [],
              classAttributes: [],
              decorators: [],
              filePath: '/test/module1.py',
              startLine: 1,
              endLine: 5,
            },
          ],
          functions: [],
          imports: [],
        },
        {
          name: 'module2',
          filePath: '/test/module2.py',
          classes: [
            {
              name: 'Class2',
              moduleName: 'module2',
              baseClasses: [],
              methods: [],
              properties: [],
              classAttributes: [],
              decorators: [],
              filePath: '/test/module2.py',
              startLine: 1,
              endLine: 5,
            },
          ],
          functions: [],
          imports: [],
        },
      ];

      const result = mapper.mapModules(modules);

      expect(result.entities).toHaveLength(2);
      expect(result.entities[0].name).toBe('Class1');
      expect(result.entities[1].name).toBe('Class2');
    });
  });
});
