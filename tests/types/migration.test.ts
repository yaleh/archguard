/**
 * Type migration tests for multi-language support (Phase 0.1)
 *
 * These tests verify that the ArchJSON type definitions support
 * multiple languages while maintaining backward compatibility.
 */

import { describe, it, expect } from 'vitest';
import type {
  ArchJSON,
  SupportedLanguage,
  EntityType,
  MemberType,
  RelationType,
  Decorator,
  Relation,
  Module,
  Entity,
} from '@/types/index.js';

describe('Type Migration - Multi-Language Support', () => {
  describe('SupportedLanguage', () => {
    it('should accept new languages (go, java, python, rust)', () => {
      const languages: SupportedLanguage[] = ['go', 'java', 'python', 'rust'];

      languages.forEach((lang) => {
        const archJson: ArchJSON = {
          version: '1.0',
          language: lang,
          timestamp: new Date().toISOString(),
          sourceFiles: [],
          entities: [],
          relations: [],
        };

        expect(archJson.language).toBe(lang);
      });
    });

    it('should maintain backward compatibility with typescript literal', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: new Date().toISOString(),
        sourceFiles: [],
        entities: [],
        relations: [],
      };

      expect(archJson.language).toBe('typescript');
    });

    it('should accept all supported languages in a union type', () => {
      const allLanguages: SupportedLanguage[] = [
        'typescript',
        'go',
        'java',
        'python',
        'rust',
      ];

      allLanguages.forEach((lang) => {
        const archJson: ArchJSON = {
          version: '1.0',
          language: lang,
          timestamp: new Date().toISOString(),
          sourceFiles: [],
          entities: [],
          relations: [],
        };

        expect(allLanguages).toContain(archJson.language);
      });
    });
  });

  describe('EntityType Extensions', () => {
    it('should accept struct as EntityType (for Go, Rust)', () => {
      const entity: Entity = {
        id: 'test-struct',
        name: 'TestStruct',
        type: 'struct',
        visibility: 'public',
        members: [],
        sourceLocation: {
          file: 'test.go',
          startLine: 1,
          endLine: 10,
        },
      };

      expect(entity.type).toBe('struct');
    });

    it('should accept trait as EntityType (for Rust)', () => {
      const entity: Entity = {
        id: 'test-trait',
        name: 'TestTrait',
        type: 'trait',
        visibility: 'public',
        members: [],
        sourceLocation: {
          file: 'test.rs',
          startLine: 1,
          endLine: 10,
        },
      };

      expect(entity.type).toBe('trait');
    });

    it('should accept abstract_class as EntityType', () => {
      const entity: Entity = {
        id: 'test-abstract',
        name: 'TestAbstract',
        type: 'abstract_class',
        visibility: 'public',
        members: [],
        sourceLocation: {
          file: 'test.java',
          startLine: 1,
          endLine: 10,
        },
      };

      expect(entity.type).toBe('abstract_class');
    });

    it('should accept function as EntityType (for top-level functions)', () => {
      const entity: Entity = {
        id: 'test-function',
        name: 'testFunction',
        type: 'function',
        visibility: 'public',
        members: [],
        sourceLocation: {
          file: 'test.py',
          startLine: 1,
          endLine: 10,
        },
      };

      expect(entity.type).toBe('function');
    });

    it('should maintain backward compatibility with existing types', () => {
      const existingTypes: EntityType[] = ['class', 'interface', 'enum'];

      existingTypes.forEach((type) => {
        const entity: Entity = {
          id: `test-${type}`,
          name: `Test${type}`,
          type: type,
          visibility: 'public',
          members: [],
          sourceLocation: {
            file: 'test.ts',
            startLine: 1,
            endLine: 10,
          },
        };

        expect(entity.type).toBe(type);
      });
    });
  });

  describe('MemberType Extensions', () => {
    it('should accept field as MemberType (for Go structs, Rust structs)', () => {
      const entity: Entity = {
        id: 'test-struct',
        name: 'TestStruct',
        type: 'struct',
        visibility: 'public',
        members: [
          {
            name: 'id',
            type: 'field',
            visibility: 'public',
            fieldType: 'string',
          },
        ],
        sourceLocation: {
          file: 'test.go',
          startLine: 1,
          endLine: 10,
        },
      };

      expect(entity.members[0].type).toBe('field');
    });

    it('should maintain backward compatibility with existing member types', () => {
      const existingTypes: MemberType[] = ['property', 'method', 'constructor'];

      existingTypes.forEach((type) => {
        const entity: Entity = {
          id: 'test-class',
          name: 'TestClass',
          type: 'class',
          visibility: 'public',
          members: [
            {
              name: type === 'constructor' ? 'constructor' : 'testMember',
              type: type,
              visibility: 'public',
            },
          ],
          sourceLocation: {
            file: 'test.ts',
            startLine: 1,
            endLine: 10,
          },
        };

        expect(entity.members[0].type).toBe(type);
      });
    });
  });

  describe('RelationType Extensions', () => {
    it('should accept association as RelationType', () => {
      const relation: Relation = {
        id: 'test-association',
        type: 'association',
        source: 'ClassA',
        target: 'ClassB',
      };

      expect(relation.type).toBe('association');
    });

    it('should maintain backward compatibility with existing relation types', () => {
      const existingTypes: RelationType[] = [
        'inheritance',
        'implementation',
        'composition',
        'aggregation',
        'dependency',
      ];

      existingTypes.forEach((type) => {
        const relation: Relation = {
          id: `test-${type}`,
          type: type,
          source: 'ClassA',
          target: 'ClassB',
        };

        expect(relation.type).toBe(type);
      });
    });
  });

  describe('Decorator Arguments Extensions', () => {
    it('should accept string array format (backward compatibility)', () => {
      const decorator: Decorator = {
        name: 'Component',
        arguments: ['selector: app-root', 'templateUrl: ./app.component.html'],
      };

      expect(Array.isArray(decorator.arguments)).toBe(true);
      expect(decorator.arguments?.length).toBe(2);
    });

    it('should accept object format (for structured annotations)', () => {
      const decorator: Decorator = {
        name: 'Component',
        arguments: {
          selector: 'app-root',
          templateUrl: './app.component.html',
          styleUrls: ['./app.component.css'],
        },
      };

      expect(typeof decorator.arguments).toBe('object');
      expect(Array.isArray(decorator.arguments)).toBe(false);
      expect((decorator.arguments as Record<string, unknown>).selector).toBe('app-root');
    });

    it('should accept both formats in the same entity', () => {
      const entity: Entity = {
        id: 'test-class',
        name: 'TestClass',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: {
          file: 'test.ts',
          startLine: 1,
          endLine: 10,
        },
        decorators: [
          {
            name: 'Injectable',
            arguments: ['providedIn: root'],
          },
          {
            name: 'Component',
            arguments: {
              selector: 'app-test',
              template: '<div>Test</div>',
            },
          },
        ],
      };

      expect(entity.decorators?.length).toBe(2);
      expect(Array.isArray(entity.decorators?.[0].arguments)).toBe(true);
      expect(typeof entity.decorators?.[1].arguments).toBe('object');
    });
  });

  describe('Relation Extensions - Inference Metadata', () => {
    it('should accept confidence field on relations', () => {
      const relation: Relation = {
        id: 'test-relation',
        type: 'dependency',
        source: 'ClassA',
        target: 'ClassB',
        confidence: 0.95,
      };

      expect(relation.confidence).toBe(0.95);
    });

    it('should accept inferenceSource field with explicit value', () => {
      const relation: Relation = {
        id: 'test-relation',
        type: 'inheritance',
        source: 'ClassA',
        target: 'ClassB',
        inferenceSource: 'explicit',
      };

      expect(relation.inferenceSource).toBe('explicit');
    });

    it('should accept inferenceSource field with inferred value', () => {
      const relation: Relation = {
        id: 'test-relation',
        type: 'dependency',
        source: 'ClassA',
        target: 'ClassB',
        inferenceSource: 'inferred',
        confidence: 0.75,
      };

      expect(relation.inferenceSource).toBe('inferred');
      expect(relation.confidence).toBe(0.75);
    });

    it('should accept relations without optional inference fields', () => {
      const relation: Relation = {
        id: 'test-relation',
        type: 'composition',
        source: 'ClassA',
        target: 'ClassB',
      };

      expect(relation.confidence).toBeUndefined();
      expect(relation.inferenceSource).toBeUndefined();
    });
  });

  describe('ArchJSON Extensions - Modules and Metadata', () => {
    it('should accept optional modules field', () => {
      const module: Module = {
        name: 'core',
        entities: ['ClassA', 'ClassB'],
        submodules: [],
      };

      const archJson: ArchJSON = {
        version: '1.0',
        language: 'go',
        timestamp: new Date().toISOString(),
        sourceFiles: [],
        entities: [],
        relations: [],
        modules: [module],
      };

      expect(archJson.modules).toBeDefined();
      expect(archJson.modules?.length).toBe(1);
      expect(archJson.modules?.[0].name).toBe('core');
    });

    it('should accept nested submodules', () => {
      const module: Module = {
        name: 'core',
        entities: ['CoreClass'],
        submodules: [
          {
            name: 'utils',
            entities: ['UtilClass'],
            submodules: [],
          },
        ],
      };

      const archJson: ArchJSON = {
        version: '1.0',
        language: 'java',
        timestamp: new Date().toISOString(),
        sourceFiles: [],
        entities: [],
        relations: [],
        modules: [module],
      };

      expect(archJson.modules?.[0].submodules?.length).toBe(1);
      expect(archJson.modules?.[0].submodules?.[0].name).toBe('utils');
    });

    it('should accept optional metadata field', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'python',
        timestamp: new Date().toISOString(),
        sourceFiles: [],
        entities: [],
        relations: [],
        metadata: {
          parserVersion: '2.0.0',
          analysisDate: '2024-01-28',
          projectName: 'test-project',
        },
      };

      expect(archJson.metadata).toBeDefined();
      expect(archJson.metadata?.parserVersion).toBe('2.0.0');
    });

    it('should accept ArchJSON without optional fields', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: new Date().toISOString(),
        sourceFiles: [],
        entities: [],
        relations: [],
      };

      expect(archJson.modules).toBeUndefined();
      expect(archJson.metadata).toBeUndefined();
    });
  });

  describe('Module Interface', () => {
    it('should define module with required fields', () => {
      const module: Module = {
        name: 'authentication',
        entities: ['AuthService', 'User', 'Token'],
        submodules: [],
      };

      expect(module.name).toBe('authentication');
      expect(module.entities.length).toBe(3);
      expect(module.submodules).toEqual([]);
    });

    it('should support optional submodules field', () => {
      const moduleWithoutSubmodules: Module = {
        name: 'simple',
        entities: ['SimpleClass'],
      };

      expect(moduleWithoutSubmodules.name).toBe('simple');
      expect(moduleWithoutSubmodules.submodules).toBeUndefined();
    });

    it('should support deeply nested module hierarchies', () => {
      const deepModule: Module = {
        name: 'root',
        entities: [],
        submodules: [
          {
            name: 'level1',
            entities: ['L1Class'],
            submodules: [
              {
                name: 'level2',
                entities: ['L2Class'],
                submodules: [
                  {
                    name: 'level3',
                    entities: ['L3Class'],
                    submodules: [],
                  },
                ],
              },
            ],
          },
        ],
      };

      expect(deepModule.submodules?.[0].submodules?.[0].submodules?.[0].name).toBe('level3');
    });
  });
});
