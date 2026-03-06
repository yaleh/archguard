/**
 * Unit tests for ValidatedMermaidGenerator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ValidatedMermaidGenerator } from '../../../src/mermaid/generator';
import { ArchJSON } from '../../../src/types';
import type {
  MermaidDetailLevel,
  GroupingDecision,
  PackageGroup,
} from '../../../src/mermaid/types';

describe('ValidatedMermaidGenerator', () => {
  let archJson: ArchJSON;
  let groupingDecision: GroupingDecision;

  beforeEach(() => {
    // Create sample ArchJSON
    archJson = {
      version: '1.0',
      language: 'typescript',
      timestamp: '2026-01-26T10:00:00Z',
      sourceFiles: ['src/user/User.ts', 'src/auth/AuthService.ts'],
      entities: [
        {
          id: 'User',
          name: 'User',
          type: 'class',
          visibility: 'public',
          members: [
            {
              name: 'id',
              type: 'property',
              visibility: 'public',
              fieldType: 'string',
              isReadonly: true,
            },
            {
              name: 'getName',
              type: 'method',
              visibility: 'public',
              returnType: 'string',
              parameters: [],
            },
            {
              name: 'setName',
              type: 'method',
              visibility: 'public',
              returnType: 'void',
              parameters: [{ name: 'name', type: 'string' }],
            },
          ],
          sourceLocation: { file: 'src/user/User.ts', startLine: 1, endLine: 20 },
        },
        {
          id: 'AuthService',
          name: 'AuthService',
          type: 'class',
          visibility: 'public',
          members: [
            {
              name: 'login',
              type: 'method',
              visibility: 'public',
              returnType: 'boolean',
              parameters: [
                { name: 'username', type: 'string' },
                { name: 'password', type: 'string' },
              ],
            },
          ],
          sourceLocation: { file: 'src/auth/AuthService.ts', startLine: 1, endLine: 15 },
        },
      ],
      relations: [
        {
          id: 'rel1',
          type: 'dependency',
          source: 'AuthService',
          target: 'User',
        },
      ],
    };

    // Create grouping decision
    groupingDecision = {
      packages: [
        {
          name: 'User Layer',
          entities: ['User'],
          reasoning: 'User-related classes',
        },
        {
          name: 'Auth Layer',
          entities: ['AuthService'],
          reasoning: 'Authentication classes',
        },
      ],
      layout: {
        direction: 'TB',
        reasoning: 'Top-to-bottom flow',
      },
    };
  });

  describe('initialization', () => {
    it('should initialize with required parameters', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: groupingDecision,
      });

      expect(generator).toBeDefined();
    });

    it('should accept package level', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'package',
        grouping: groupingDecision,
      });

      expect(generator).toBeDefined();
    });

    it('should accept method level', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'method',
        grouping: groupingDecision,
      });

      expect(generator).toBeDefined();
    });

    it('should accept custom theme', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: groupingDecision,
        theme: {
          name: 'dark',
        },
      });

      expect(generator).toBeDefined();
    });
  });

  describe('package level generation', () => {
    it('should generate valid Mermaid code for package level', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'package',
        grouping: groupingDecision,
      });

      const mermaidCode = generator.generate();

      expect(mermaidCode).toContain('classDiagram');
      expect(mermaidCode).toContain('namespace');
      // Namespace names are unquoted identifiers (Mermaid doesn't support quoted namespace names)
      expect(mermaidCode).toContain('namespace User_Layer');
      expect(mermaidCode).toContain('namespace Auth_Layer');
    });

    it('should include packages in correct order', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'package',
        grouping: groupingDecision,
      });

      const mermaidCode = generator.generate();

      // Check that namespaces are properly defined (unquoted identifiers)
      const userLayerIndex = mermaidCode.indexOf('namespace User_Layer');
      const authLayerIndex = mermaidCode.indexOf('namespace Auth_Layer');

      expect(userLayerIndex).toBeGreaterThanOrEqual(0);
      expect(authLayerIndex).toBeGreaterThanOrEqual(0);
    });
  });

  describe('class level generation', () => {
    it('should generate valid Mermaid code for class level', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: groupingDecision,
      });

      const mermaidCode = generator.generate();

      expect(mermaidCode).toContain('classDiagram');
      expect(mermaidCode).toContain('class User');
      expect(mermaidCode).toContain('class AuthService');
    });

    it('should include class properties', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: groupingDecision,
      });

      const mermaidCode = generator.generate();

      expect(mermaidCode).toContain('readonly id: string');
    });

    it('should include class methods', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: groupingDecision,
      });

      const mermaidCode = generator.generate();

      expect(mermaidCode).toContain('getName(): string');
      expect(mermaidCode).toContain('setName(name: string): void');
    });

    it('should include visibility modifiers', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: groupingDecision,
      });

      const mermaidCode = generator.generate();

      // Should include + for public
      expect(mermaidCode).toMatch(/\+readonly id:/);
      expect(mermaidCode).toMatch(/\+getName\(/);
    });
  });

  describe('method level generation', () => {
    it('should generate valid Mermaid code for method level', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'method',
        grouping: groupingDecision,
      });

      const mermaidCode = generator.generate();

      expect(mermaidCode).toContain('classDiagram');
      expect(mermaidCode).toContain('class User');
      expect(mermaidCode).toContain('class AuthService');
    });

    it('should include all method parameters', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'method',
        grouping: groupingDecision,
      });

      const mermaidCode = generator.generate();

      // Should include detailed parameter information
      expect(mermaidCode).toContain('setName(name: string)');
      expect(mermaidCode).toContain('login(username: string, password: string)');
    });
  });

  describe('relationship generation', () => {
    it('should include relationships between classes', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: groupingDecision,
      });

      const mermaidCode = generator.generate();

      expect(mermaidCode).toContain('AuthService');
      expect(mermaidCode).toContain('User');
      // Should have some kind of relationship indicator
      expect(mermaidCode).toMatch(/AuthService.*User|User.*AuthService/);
    });

    it('should handle inheritance relationships', () => {
      const adminGrouping: GroupingDecision = {
        packages: [
          ...groupingDecision.packages,
          {
            name: 'Admin Layer',
            entities: ['Admin'],
            reasoning: 'Admin classes',
          },
        ],
        layout: groupingDecision.layout,
      };

      const inheritanceArchJson: ArchJSON = {
        ...archJson,
        entities: [
          ...archJson.entities,
          {
            id: 'Admin',
            name: 'Admin',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'src/admin/Admin.ts', startLine: 1, endLine: 10 },
            extends: ['User'],
          },
        ],
        relations: [
          ...archJson.relations,
          {
            id: 'rel2',
            type: 'inheritance',
            source: 'Admin',
            target: 'User',
          },
        ],
      };

      const generator = new ValidatedMermaidGenerator(inheritanceArchJson, {
        level: 'class',
        grouping: adminGrouping,
      });

      const mermaidCode = generator.generate();

      expect(mermaidCode).toContain('class Admin');
      expect(mermaidCode).toContain('<|--');
    });

    it('should generate inheritance relation in correct direction (parent <|-- child)', () => {
      const errorGrouping: GroupingDecision = {
        packages: [
          {
            name: 'Error Layer',
            entities: ['Error', 'ParseError'],
            reasoning: 'Error classes',
          },
        ],
        layout: groupingDecision.layout,
      };

      const errorInheritanceArchJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-26T10:00:00Z',
        sourceFiles: ['src/errors.ts'],
        entities: [
          {
            id: 'Error',
            name: 'Error',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'src/errors.ts', startLine: 1, endLine: 5 },
          },
          {
            id: 'ParseError',
            name: 'ParseError',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'src/errors.ts', startLine: 10, endLine: 20 },
            extends: ['Error'],
          },
        ],
        relations: [
          {
            id: 'rel1',
            type: 'inheritance',
            source: 'ParseError', // child class
            target: 'Error', // parent class
          },
        ],
      };

      const generator = new ValidatedMermaidGenerator(errorInheritanceArchJson, {
        level: 'class',
        grouping: errorGrouping,
      });

      const mermaidCode = generator.generate();

      // Mermaid syntax: Parent <|-- Child
      // Since ParseError extends Error, the relation should be: Error <|-- ParseError
      expect(mermaidCode).toContain('Error <|-- ParseError');
      // Should NOT have the reversed direction
      expect(mermaidCode).not.toContain('ParseError <|-- Error');
    });

    it('should handle implementation relationships', () => {
      const repoGrouping: GroupingDecision = {
        packages: [
          ...groupingDecision.packages,
          {
            name: 'Repository Layer',
            entities: ['IRepository', 'UserRepository'],
            reasoning: 'Repository classes',
          },
        ],
        layout: groupingDecision.layout,
      };

      const interfaceArchJson: ArchJSON = {
        ...archJson,
        entities: [
          ...archJson.entities,
          {
            id: 'IRepository',
            name: 'IRepository',
            type: 'interface',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'src/repo/IRepository.ts', startLine: 1, endLine: 5 },
          },
          {
            id: 'UserRepository',
            name: 'UserRepository',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'src/repo/UserRepository.ts', startLine: 1, endLine: 10 },
            implements: ['IRepository'],
          },
        ],
        relations: [
          ...archJson.relations,
          {
            id: 'rel2',
            type: 'implementation',
            source: 'UserRepository',
            target: 'IRepository',
          },
        ],
      };

      const generator = new ValidatedMermaidGenerator(interfaceArchJson, {
        level: 'class',
        grouping: repoGrouping,
      });

      const mermaidCode = generator.generate();

      expect(mermaidCode).toContain('class IRepository');
      expect(mermaidCode).toContain('class UserRepository');
      expect(mermaidCode).toContain('<|..');
    });

    it('should generate implementation relation in correct direction (interface <|.. class)', () => {
      const repoGrouping: GroupingDecision = {
        packages: [
          {
            name: 'Repository Layer',
            entities: ['IRepository', 'UserRepository'],
            reasoning: 'Repository classes',
          },
        ],
        layout: groupingDecision.layout,
      };

      const interfaceArchJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-26T10:00:00Z',
        sourceFiles: ['src/repo/IRepository.ts', 'src/repo/UserRepository.ts'],
        entities: [
          {
            id: 'IRepository',
            name: 'IRepository',
            type: 'interface',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'src/repo/IRepository.ts', startLine: 1, endLine: 5 },
          },
          {
            id: 'UserRepository',
            name: 'UserRepository',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'src/repo/UserRepository.ts', startLine: 1, endLine: 10 },
            implements: ['IRepository'],
          },
        ],
        relations: [
          {
            id: 'rel1',
            type: 'implementation',
            source: 'UserRepository', // implementing class
            target: 'IRepository', // interface being implemented
          },
        ],
      };

      const generator = new ValidatedMermaidGenerator(interfaceArchJson, {
        level: 'class',
        grouping: repoGrouping,
      });

      const mermaidCode = generator.generate();

      // Mermaid syntax: Interface <|.. ImplementingClass
      // Since UserRepository implements IRepository, the relation should be: IRepository <|.. UserRepository
      expect(mermaidCode).toContain('IRepository <|.. UserRepository');
      // Should NOT have the reversed direction
      expect(mermaidCode).not.toContain('UserRepository <|.. IRepository');
    });
  });

  describe('namespace generation', () => {
    it('should wrap entities in namespaces when grouping is provided', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: groupingDecision,
      });

      const mermaidCode = generator.generate();

      expect(mermaidCode).toContain('namespace');
      // Namespace names are unquoted identifiers (Mermaid doesn't support quoted namespace names)
      expect(mermaidCode).toContain('namespace User_Layer');
      expect(mermaidCode).toContain('namespace Auth_Layer');
    });

    it('should generate without namespaces when no grouping', () => {
      const noGrouping: GroupingDecision = {
        packages: [],
        layout: {
          direction: 'TB',
          reasoning: 'No grouping',
        },
      };

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: noGrouping,
      });

      const mermaidCode = generator.generate();

      // Should still generate valid Mermaid code
      expect(mermaidCode).toContain('classDiagram');
      expect(mermaidCode).toContain('class User');
      expect(mermaidCode).toContain('class AuthService');
    });
  });

  describe('special character handling', () => {
    it('should escape special characters in entity names', () => {
      const specialCharArchJson: ArchJSON = {
        ...archJson,
        entities: [
          {
            id: 'User-Class',
            name: 'User-Class',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'src/user/User.ts', startLine: 1, endLine: 10 },
          },
        ],
      };

      const generator = new ValidatedMermaidGenerator(specialCharArchJson, {
        level: 'class',
        grouping: groupingDecision,
      });

      const mermaidCode = generator.generate();

      // Should handle special characters properly
      expect(mermaidCode).toContain('class');
    });

    it('should escape special characters in type names', () => {
      const typeTestGrouping: GroupingDecision = {
        packages: [
          {
            name: 'Test Layer',
            entities: ['TypeTest'],
            reasoning: 'Test classes',
          },
        ],
        layout: groupingDecision.layout,
      };

      const specialTypeArchJson: ArchJSON = {
        ...archJson,
        entities: [
          {
            id: 'TypeTest',
            name: 'TypeTest',
            type: 'class',
            visibility: 'public',
            members: [
              {
                name: 'data',
                type: 'property',
                visibility: 'public',
                fieldType: 'Map&lt;string, User[]&gt;',
              },
            ],
            sourceLocation: { file: 'src/test/TypeTest.ts', startLine: 1, endLine: 10 },
          },
        ],
        relations: [],
      };

      const generator = new ValidatedMermaidGenerator(specialTypeArchJson, {
        level: 'class',
        grouping: typeTestGrouping,
      });

      const mermaidCode = generator.generate();

      // Should handle complex types
      expect(mermaidCode).toContain('data');
      expect(mermaidCode).toContain('class TypeTest');
    });
  });

  describe('generic type handling', () => {
    it('should handle generic types in entities', () => {
      const repoGrouping: GroupingDecision = {
        packages: [
          {
            name: 'Repository Layer',
            entities: ['Repository'],
            reasoning: 'Repository classes',
          },
        ],
        layout: groupingDecision.layout,
      };

      const genericArchJson: ArchJSON = {
        ...archJson,
        entities: [
          {
            id: 'Repository',
            name: 'Repository',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'src/repo/Repository.ts', startLine: 1, endLine: 10 },
            genericParams: ['T'],
          },
        ],
        relations: [],
      };

      const generator = new ValidatedMermaidGenerator(genericArchJson, {
        level: 'class',
        grouping: repoGrouping,
      });

      const mermaidCode = generator.generate();

      expect(mermaidCode).toContain('Repository');
      expect(mermaidCode).toContain('classDiagram');
    });
  });

  describe('validation before generation', () => {
    it('should validate ArchJSON structure before generation', () => {
      const invalidArchJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-26',
        sourceFiles: [],
        entities: [],
        relations: [
          {
            id: 'invalid',
            type: 'dependency',
            source: 'NonExistent',
            target: 'AlsoNonExistent',
          },
        ],
      };

      const generator = new ValidatedMermaidGenerator(invalidArchJson, {
        level: 'class',
        grouping: groupingDecision,
      });

      // Should still generate, but handle missing entities gracefully
      const mermaidCode = generator.generate();
      expect(mermaidCode).toContain('classDiagram');
    });

    it('should handle empty entities list', () => {
      const emptyArchJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-26',
        sourceFiles: [],
        entities: [],
        relations: [],
      };

      const generator = new ValidatedMermaidGenerator(emptyArchJson, {
        level: 'class',
        grouping: groupingDecision,
      });

      const mermaidCode = generator.generate();

      expect(mermaidCode).toContain('classDiagram');
    });
  });

  describe('post-processing', () => {
    it('should format generated code properly', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: groupingDecision,
      });

      const mermaidCode = generator.generate();

      // Check basic formatting
      expect(mermaidCode).toMatch(/classDiagram[\s\S]+class User/);
      expect(mermaidCode.trim()).toEqual(mermaidCode); // No leading/trailing whitespace
    });

    it('should handle layout direction in generated code', () => {
      const lrLayout: GroupingDecision = {
        ...groupingDecision,
        layout: {
          direction: 'LR',
          reasoning: 'Left-to-right layout',
        },
      };

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: lrLayout,
      });

      const mermaidCode = generator.generate();

      expect(mermaidCode).toContain('classDiagram');
      // Layout direction should be reflected
    });
  });

  describe('visibility options', () => {
    it('should respect includePrivate option', () => {
      const privateMemberArchJson: ArchJSON = {
        ...archJson,
        entities: [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [
              {
                name: 'privateField',
                type: 'property',
                visibility: 'private',
                fieldType: 'string',
              },
            ],
            sourceLocation: { file: 'src/user/User.ts', startLine: 1, endLine: 20 },
          },
        ],
      };

      const generator = new ValidatedMermaidGenerator(privateMemberArchJson, {
        level: 'class',
        grouping: groupingDecision,
        includePrivate: true,
      });

      const mermaidCode = generator.generate();

      // Should include private members when option is true
      expect(mermaidCode).toContain('privateField');
    });

    it('should exclude private members when includePrivate is false', () => {
      const privateMemberArchJson: ArchJSON = {
        ...archJson,
        entities: [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [
              {
                name: 'privateField',
                type: 'property',
                visibility: 'private',
                fieldType: 'string',
              },
            ],
            sourceLocation: { file: 'src/user/User.ts', startLine: 1, endLine: 20 },
          },
        ],
      };

      const generator = new ValidatedMermaidGenerator(privateMemberArchJson, {
        level: 'class',
        grouping: groupingDecision,
        includePrivate: false,
      });

      const mermaidCode = generator.generate();

      // Should not include private members when option is false
      expect(mermaidCode).not.toContain('-privateField');
    });
  });

  describe('orphan relation filtering', () => {
    it('should render cross-module targets as ghost nodes (source known, target unknown)', () => {
      // Cross-module types (e.g. ArchJSON from another module) should appear as ghost nodes.
      // Fix 3 (RelationExtractor) already removes npm-imported types, so unknown targets
      // reaching the generator are cross-module references — they SHOULD be shown.
      const archJsonWithCrossModule: ArchJSON = {
        ...archJson,
        relations: [
          { id: 'rel-valid', type: 'dependency', source: 'AuthService', target: 'User' },
          { id: 'rel-cross', type: 'dependency', source: 'AuthService', target: 'CrossModuleType' },
        ],
      };

      const generator = new ValidatedMermaidGenerator(archJsonWithCrossModule, {
        level: 'class',
        grouping: { packages: [] },
      });
      const result = generator.generate();

      expect(result).toContain('AuthService');
      // Cross-module target appears as a Mermaid ghost node
      expect(result).toContain('CrossModuleType');
    });

    it('should not render relations where source is not in archJson entities', () => {
      const archJsonWithOrphan: ArchJSON = {
        ...archJson,
        relations: [
          { id: 'rel-orphan', type: 'dependency', source: 'GhostClass', target: 'User' },
        ],
      };

      const generator = new ValidatedMermaidGenerator(archJsonWithOrphan, {
        level: 'method',
        grouping: { packages: [] },
      });
      const result = generator.generate();

      expect(result).not.toContain('GhostClass');
    });

    it('should still render valid relations between known entities', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: groupingDecision,
      });
      const result = generator.generate();

      expect(result).toMatch(/AuthService.+-->|-->.+AuthService/s);
    });

    it('should render cross-module targets as ghost nodes in package-level diagrams', () => {
      const archJsonWithCrossModule: ArchJSON = {
        ...archJson,
        relations: [
          { id: 'rel-valid', type: 'dependency', source: 'AuthService', target: 'User' },
          { id: 'rel-cross', type: 'composition', source: 'AuthService', target: 'CrossModuleService' },
        ],
      };

      const generator = new ValidatedMermaidGenerator(archJsonWithCrossModule, {
        level: 'package',
        grouping: groupingDecision,
      });
      const result = generator.generate();

      // Cross-module target should be shown as ghost node
      expect(result).toContain('CrossModuleService');
    });

    it('should filter noisy inline object type targets', () => {
      const archJsonWithNoisy: ArchJSON = {
        ...archJson,
        relations: [
          { id: 'rel-noisy', type: 'dependency', source: 'AuthService', target: '{ host: string }' },
        ],
      };

      const generator = new ValidatedMermaidGenerator(archJsonWithNoisy, {
        level: 'class',
        grouping: { packages: [] },
      });
      const result = generator.generate();

      expect(result).not.toContain('{ host: string }');
    });

    it('should filter single-letter generic targets', () => {
      const archJsonWithNoisy: ArchJSON = {
        ...archJson,
        relations: [
          { id: 'rel-generic-T', type: 'dependency', source: 'AuthService', target: 'T' },
          { id: 'rel-generic-K', type: 'dependency', source: 'AuthService', target: 'K' },
        ],
      };

      const generator = new ValidatedMermaidGenerator(archJsonWithNoisy, {
        level: 'class',
        grouping: { packages: [] },
      });
      const result = generator.generate();

      // Single-letter generics should be filtered as noise
      expect(result).not.toMatch(/\bT\b.*-->/);
      expect(result).not.toMatch(/\bK\b.*-->/);
    });

    it('should allow Error class as a ghost node (not filtered as noise)', () => {
      const archJsonWithError: ArchJSON = {
        ...archJson,
        relations: [
          { id: 'rel-error', type: 'inheritance', source: 'ParseError', target: 'Error' },
        ],
        entities: [
          ...archJson.entities,
          {
            id: 'ParseError',
            name: 'ParseError',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'src/errors.ts', startLine: 1, endLine: 5 },
          },
        ],
      };

      const generator = new ValidatedMermaidGenerator(archJsonWithError, {
        level: 'class',
        grouping: { packages: [] },
      });
      const result = generator.generate();

      // Error class should appear as a ghost node with inheritance arrow
      expect(result).toContain('Error');
      expect(result).toContain('<|--');
    });

    it('should NOT filter known entity IDs that match namespace.class pattern (C++ style)', () => {
      // C++ entity IDs like "tests.test_case" match the /^[a-z]\w*\./ noisy-filter regex,
      // but they are real entities and must not be suppressed.
      const archJsonCpp: ArchJSON = {
        ...archJson,
        entities: [
          ...archJson.entities,
          {
            id: 'tests.child_class',
            name: 'child_class',
            type: 'class' as const,
            visibility: 'public' as const,
            members: [],
            sourceLocation: { file: 'tests/child.cpp', startLine: 1, endLine: 5 },
          },
          {
            id: 'tests.base_class',
            name: 'base_class',
            type: 'class' as const,
            visibility: 'public' as const,
            members: [],
            sourceLocation: { file: 'tests/base.cpp', startLine: 1, endLine: 5 },
          },
        ],
        relations: [
          {
            id: 'rel-cpp',
            type: 'inheritance',
            source: 'tests.child_class',
            target: 'tests.base_class',
            inferenceSource: 'explicit',
          },
        ],
      };

      const generator = new ValidatedMermaidGenerator(archJsonCpp, {
        level: 'class',
        grouping: { packages: [] },
      });
      const result = generator.generate();
      // The inheritance relation must appear in the diagram
      expect(result).toContain('<|--');
      expect(result).toContain('base_class');
      expect(result).toContain('child_class');
    });

    it('should filter arrow function type targets', () => {
      const archJsonWithNoisy: ArchJSON = {
        ...archJson,
        relations: [
          { id: 'rel-fn', type: 'dependency', source: 'AuthService', target: '(x: string) => boolean' },
        ],
      };

      const generator = new ValidatedMermaidGenerator(archJsonWithNoisy, {
        level: 'class',
        grouping: { packages: [] },
      });
      const result = generator.generate();

      expect(result).not.toContain('=>');
    });
  });

  /**
   * Scoped entity ID support
   *
   * When parseTsProject() is used (triggered by a package-level diagram sharing the same
   * source group), relation sources and targets are scoped IDs:
   *   "src/mermaid/auto-repair.ts.MermaidAutoRepair"
   * But entity names remain bare: "MermaidAutoRepair"
   *
   * The generator must resolve scoped IDs to bare names for both filtering and rendering.
   */
  describe('scoped entity ID relations (parseTsProject path)', () => {
    const scopedGrouping: GroupingDecision = {
      packages: [
        {
          name: 'Mermaid_Layer',
          entities: [
            'src/mermaid/auto-repair.ts.AutoRepair',
            'src/mermaid/validator-parse.ts.ParseValidator',
          ],
          reasoning: 'Mermaid module',
        },
      ],
      layout: { direction: 'TB', reasoning: '' },
    };

    const scopedArchJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      timestamp: '2026-01-26T10:00:00Z',
      sourceFiles: [
        'src/mermaid/auto-repair.ts',
        'src/mermaid/validator-parse.ts',
      ],
      entities: [
        {
          id: 'src/mermaid/auto-repair.ts.AutoRepair',
          name: 'AutoRepair',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'src/mermaid/auto-repair.ts', startLine: 1, endLine: 20 },
        },
        {
          id: 'src/mermaid/validator-parse.ts.ParseValidator',
          name: 'ParseValidator',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'src/mermaid/validator-parse.ts', startLine: 1, endLine: 10 },
        },
      ],
      relations: [
        {
          id: 'src/mermaid/auto-repair.ts.AutoRepair_dependency_src/mermaid/validator-parse.ts.ParseValidator',
          type: 'dependency',
          source: 'src/mermaid/auto-repair.ts.AutoRepair',
          target: 'src/mermaid/validator-parse.ts.ParseValidator',
        },
      ],
    };

    it('should render relations when source is a scoped entity ID (class level)', () => {
      const generator = new ValidatedMermaidGenerator(scopedArchJson, {
        level: 'class',
        grouping: scopedGrouping,
      });
      const result = generator.generate();

      expect(result).toContain('AutoRepair');
      expect(result).toContain('ParseValidator');
      // Relation must be present with bare class names
      expect(result).toContain('AutoRepair --> ParseValidator');
    });

    it('should render relations when source is a scoped entity ID (method level)', () => {
      const generator = new ValidatedMermaidGenerator(scopedArchJson, {
        level: 'method',
        grouping: scopedGrouping,
      });
      const result = generator.generate();

      expect(result).toContain('AutoRepair --> ParseValidator');
    });

    it('should render inheritance relations with scoped IDs in correct direction', () => {
      const inheritanceGrouping: GroupingDecision = {
        packages: [
          {
            name: 'Error_Layer',
            entities: [
              'src/errors/base.ts.BaseError',
              'src/errors/parse.ts.ParseError',
            ],
            reasoning: 'Error classes',
          },
        ],
        layout: { direction: 'TB', reasoning: '' },
      };

      const inheritanceArchJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-26T10:00:00Z',
        sourceFiles: ['src/errors/base.ts', 'src/errors/parse.ts'],
        entities: [
          {
            id: 'src/errors/base.ts.BaseError',
            name: 'BaseError',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'src/errors/base.ts', startLine: 1, endLine: 5 },
          },
          {
            id: 'src/errors/parse.ts.ParseError',
            name: 'ParseError',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'src/errors/parse.ts', startLine: 1, endLine: 10 },
          },
        ],
        relations: [
          {
            id: 'rel-inherit',
            type: 'inheritance',
            source: 'src/errors/parse.ts.ParseError',
            target: 'src/errors/base.ts.BaseError',
          },
        ],
      };

      const generator = new ValidatedMermaidGenerator(inheritanceArchJson, {
        level: 'class',
        grouping: inheritanceGrouping,
      });
      const result = generator.generate();

      // Parent <|-- Child direction
      expect(result).toContain('BaseError <|-- ParseError');
    });

    it('should not render scoped source IDs as literal text in output', () => {
      const generator = new ValidatedMermaidGenerator(scopedArchJson, {
        level: 'class',
        grouping: scopedGrouping,
      });
      const result = generator.generate();

      // Raw scoped IDs must not appear in the rendered Mermaid
      expect(result).not.toContain('src/mermaid/auto-repair.ts.AutoRepair');
      expect(result).not.toContain('src/mermaid/validator-parse.ts.ParseValidator');
    });
  });
});

// ─── semantic classDef (Plan 19 Phase C) ─────────────────────────────────────

import type { EntityType } from '../../../src/types/index.js';

const makeMinimalEntity = (name: string, type: EntityType) => ({
  id: `src/test.ts.${name}`,
  name,
  type,
  visibility: 'public' as const,
  members: [],
  sourceLocation: { file: 'src/test.ts', startLine: 1, endLine: 10 },
});

const makeMinimalArchJson = (entities: ReturnType<typeof makeMinimalEntity>[]) => ({
  version: '1.0',
  language: 'typescript' as const,
  timestamp: new Date().toISOString(),
  sourceFiles: ['src/test.ts'],
  entities,
  relations: [],
});

describe('ValidatedMermaidGenerator — semantic classDef (Plan 19)', () => {
  const makeGen = (entities: ReturnType<typeof makeMinimalEntity>[], level: 'class' | 'method' | 'package' = 'class') =>
    new ValidatedMermaidGenerator(
      makeMinimalArchJson(entities),
      { level, grouping: { strategy: 'none', packages: [] } }
    );

  it('emits classDef block with all 7 EntityType entries in class-level output', () => {
    const gen = makeGen([makeMinimalEntity('Foo', 'class')]);
    const output = gen.generate();
    expect(output).toContain('classDef classNode');
    expect(output).toContain('classDef interface');
    expect(output).toContain('classDef enum');
    expect(output).toContain('classDef struct');
    expect(output).toContain('classDef trait');
    expect(output).toContain('classDef abstract_class');
    expect(output).toContain('classDef function');
  });

  it('emits classDef block in method-level output', () => {
    const gen = makeGen([makeMinimalEntity('Foo', 'class')], 'method');
    const output = gen.generate();
    expect(output).toContain('classDef classNode');
    expect(output).toContain('classDef interface');
  });

  it('does NOT emit classDef block in package-level output', () => {
    const gen = makeGen([makeMinimalEntity('Foo', 'class')], 'package');
    const output = gen.generate();
    expect(output).not.toContain('classDef classNode');
    expect(output).not.toContain('classDef interface');
  });

  it('annotates a class entity with classNode style', () => {
    const gen = makeGen([makeMinimalEntity('MyClass', 'class')]);
    const output = gen.generate();
    expect(output).toContain('class MyClass:::classNode');
  });

  it('annotates an interface entity with interface style', () => {
    const gen = makeGen([makeMinimalEntity('IRepo', 'interface')]);
    const output = gen.generate();
    expect(output).toContain('class IRepo:::interface');
  });

  it('annotates an enum entity with enum style', () => {
    const gen = makeGen([makeMinimalEntity('Status', 'enum')]);
    const output = gen.generate();
    expect(output).toContain('class Status:::enum');
  });

  it('annotates a struct entity with struct style', () => {
    const gen = makeGen([makeMinimalEntity('Config', 'struct')]);
    const output = gen.generate();
    expect(output).toContain('class Config:::struct');
  });

  it('annotates a trait entity with trait style', () => {
    const gen = makeGen([makeMinimalEntity('Printable', 'trait')]);
    const output = gen.generate();
    expect(output).toContain('class Printable:::trait');
  });

  it('annotates an abstract_class entity with abstract_class style', () => {
    const gen = makeGen([makeMinimalEntity('BaseHandler', 'abstract_class')]);
    const output = gen.generate();
    expect(output).toContain('class BaseHandler:::abstract_class');
  });

  it('does NOT annotate a function entity (function-type entities are filtered from diagrams)', () => {
    const gen = makeGen([makeMinimalEntity('parseConfig', 'function')]);
    const output = gen.generate();
    // Function entities must not appear as class nodes or annotations
    expect(output).not.toContain('class parseConfig');
  });

  it('annotation ID matches the normalized entity name used in the class declaration', () => {
    const gen = makeGen([makeMinimalEntity('MyService', 'class')]);
    const output = gen.generate();
    // Both declaration and annotation must use same ID
    expect(output).toContain('class MyService {');
    expect(output).toContain('class MyService:::classNode');
  });

  it('emits no duplicate annotation lines for the same entity', () => {
    const gen = makeGen([makeMinimalEntity('Foo', 'class'), makeMinimalEntity('Bar', 'interface')]);
    const output = gen.generate();
    // Annotation lines: `  class Foo styleName` (lowercase style) vs declaration `  class Foo {`
    const fooAnnotations = output.split('\n').filter(l => l.match(/^  class Foo:::[a-z]/));
    const barAnnotations = output.split('\n').filter(l => l.match(/^  class Bar:::[a-z]/));
    expect(fooAnnotations).toHaveLength(1);
    expect(barAnnotations).toHaveLength(1);
  });
});

// ─── function entity filtering ────────────────────────────────────────────────

describe('ValidatedMermaidGenerator — function entity filtering', () => {
  const makeGen = (
    entities: ReturnType<typeof makeMinimalEntity>[],
    relations: ArchJSON['relations'] = [],
    level: 'class' | 'method' = 'class',
    grouping: GroupingDecision = { packages: [] },
  ) =>
    new ValidatedMermaidGenerator(
      { ...makeMinimalArchJson(entities), relations },
      { level, grouping },
    );

  it('excludes function-type entities from class diagram', () => {
    const entities = [
      makeMinimalEntity('MyClass', 'class'),
      makeMinimalEntity('myFreeFunc', 'function'),
    ];
    const gen = makeGen(entities);
    const output = gen.generate();

    // The class node must appear
    expect(output).toContain('class MyClass {');
    // The function entity must NOT appear as a class node declaration
    expect(output).not.toContain('class myFreeFunc {');
    // The function entity must NOT appear as a classDef annotation
    expect(output).not.toContain('class myFreeFunc');
  });

  it('excludes function-type entities from relations in class diagram', () => {
    // A relation where the source is a function entity should be suppressed
    // because the function is not in knownEntityNames/knownEntityIds after filtering.
    const entities = [
      makeMinimalEntity('myFreeFunc', 'function'),
    ];
    const relations: ArchJSON['relations'] = [
      {
        id: 'rel-fn',
        type: 'dependency',
        source: 'myFreeFunc',
        target: 'MyClass',
      },
    ];
    const gen = makeGen(entities, relations);
    const output = gen.generate();

    // The relation must not appear because the source is a filtered-out function entity
    expect(output).not.toContain('myFreeFunc');
    expect(output).not.toContain('-->');
  });

  it('excludes function-type entities from method diagram', () => {
    const entities = [
      makeMinimalEntity('MyService', 'class'),
      makeMinimalEntity('helperFunc', 'function'),
    ];
    const gen = makeGen(entities, [], 'method');
    const output = gen.generate();

    expect(output).toContain('class MyService {');
    expect(output).not.toContain('class helperFunc {');
    expect(output).not.toContain('class helperFunc');
  });

  it('excludes function-type entities from namespace blocks in grouped class diagram', () => {
    const entities = [
      makeMinimalEntity('MyClass', 'class'),
      makeMinimalEntity('myFreeFunc', 'function'),
    ];
    const grouping: GroupingDecision = {
      packages: [
        {
          name: 'Core',
          entities: ['src/test.ts.MyClass', 'src/test.ts.myFreeFunc'],
          reasoning: 'Core layer',
        },
      ],
    };
    const gen = makeGen(entities, [], 'class', grouping);
    const output = gen.generate();

    // Namespace must still be rendered (MyClass is in it)
    expect(output).toContain('namespace Core');
    expect(output).toContain('class MyClass {');
    // Function entity must not appear in namespace block
    expect(output).not.toContain('class myFreeFunc {');
    expect(output).not.toContain('class myFreeFunc');
  });

  it('still emits classDef function in the style block even though function nodes are filtered', () => {
    const entities = [
      makeMinimalEntity('MyClass', 'class'),
      makeMinimalEntity('myFreeFunc', 'function'),
    ];
    const gen = makeGen(entities);
    const output = gen.generate();

    // The classDef style declaration must still exist (it is part of the style block)
    expect(output).toContain('classDef function');
  });
});

// ─── generateClassDiagrams ────────────────────────────────────────────────────

describe('ValidatedMermaidGenerator — generateClassDiagrams', () => {
  const makeGenWithGrouping = (
    entities: ReturnType<typeof makeMinimalEntity>[],
    relations: ArchJSON['relations'] = [],
    grouping: GroupingDecision = { packages: [] },
  ) =>
    new ValidatedMermaidGenerator(
      { ...makeMinimalArchJson(entities), relations },
      { level: 'class', grouping },
    );

  it('returns single diagram when node count is at or below maxNodesPerDiagram', () => {
    // 3 class entities in 2 groups, limit = 3 (not split)
    const entities = [
      makeMinimalEntity('ClassA', 'class'),
      makeMinimalEntity('ClassB', 'class'),
      makeMinimalEntity('ClassC', 'class'),
    ];
    const grouping: GroupingDecision = {
      packages: [
        { name: 'GroupOne', entities: ['src/test.ts.ClassA', 'src/test.ts.ClassB'], reasoning: '' },
        { name: 'GroupTwo', entities: ['src/test.ts.ClassC'], reasoning: '' },
      ],
    };
    const gen = makeGenWithGrouping(entities, [], grouping);
    const result = gen.generateClassDiagrams(3);

    expect(result.length).toBe(1);
    expect(result[0].name).toBeNull();
  });

  it('returns single diagram when there is only one group', () => {
    // 10 entities in 1 group, limit = 2 (10 > 2, but only 1 group)
    const entities = Array.from({ length: 10 }, (_, i) => makeMinimalEntity(`Class${i}`, 'class'));
    const grouping: GroupingDecision = {
      packages: [
        { name: 'OnlyGroup', entities: entities.map(e => e.id), reasoning: '' },
      ],
    };
    const gen = makeGenWithGrouping(entities, [], grouping);
    const result = gen.generateClassDiagrams(2);

    expect(result.length).toBe(1);
    expect(result[0].name).toBeNull();
  });

  it('splits into multiple diagrams when node count exceeds limit and multiple groups exist', () => {
    // 6 entities in 3 groups (A:2, B:2, C:2), limit = 4 (6 > 4)
    const entitiesA = [makeMinimalEntity('A1', 'class'), makeMinimalEntity('A2', 'class')];
    const entitiesB = [makeMinimalEntity('B1', 'class'), makeMinimalEntity('B2', 'class')];
    const entitiesC = [makeMinimalEntity('C1', 'class'), makeMinimalEntity('C2', 'class')];
    const allEntities = [...entitiesA, ...entitiesB, ...entitiesC];
    const grouping: GroupingDecision = {
      packages: [
        { name: 'A', entities: entitiesA.map(e => e.id), reasoning: '' },
        { name: 'B', entities: entitiesB.map(e => e.id), reasoning: '' },
        { name: 'C', entities: entitiesC.map(e => e.id), reasoning: '' },
      ],
    };
    const gen = makeGenWithGrouping(allEntities, [], grouping);
    const result = gen.generateClassDiagrams(4);

    expect(result.length).toBe(3);
    expect(result.map(r => r.name)).toEqual(['A', 'B', 'C']);
    for (const r of result) {
      expect(r.content).toContain('classDiagram');
    }
    expect(result[0].content).toContain('namespace A {');
    expect(result[1].content).toContain('namespace B {');
    expect(result[2].content).toContain('namespace C {');
  });

  it('each split diagram contains classDef styles', () => {
    const entitiesA = [makeMinimalEntity('A1', 'class'), makeMinimalEntity('A2', 'class')];
    const entitiesB = [makeMinimalEntity('B1', 'class'), makeMinimalEntity('B2', 'class')];
    const entitiesC = [makeMinimalEntity('C1', 'class'), makeMinimalEntity('C2', 'class')];
    const allEntities = [...entitiesA, ...entitiesB, ...entitiesC];
    const grouping: GroupingDecision = {
      packages: [
        { name: 'A', entities: entitiesA.map(e => e.id), reasoning: '' },
        { name: 'B', entities: entitiesB.map(e => e.id), reasoning: '' },
        { name: 'C', entities: entitiesC.map(e => e.id), reasoning: '' },
      ],
    };
    const gen = makeGenWithGrouping(allEntities, [], grouping);
    const result = gen.generateClassDiagrams(4);

    for (const r of result) {
      expect(r.content).toContain('classDef classNode');
    }
  });

  it('each split diagram contains only relations from that group', () => {
    // Group A has EntityA, Group B has EntityB; relation A --> B
    const entityA = makeMinimalEntity('EntityA', 'class');
    const entityB = makeMinimalEntity('EntityB', 'class');
    const relations: ArchJSON['relations'] = [
      { id: 'rel-ab', type: 'dependency', source: 'EntityA', target: 'EntityB' },
    ];
    const grouping: GroupingDecision = {
      packages: [
        { name: 'GroupA', entities: [entityA.id], reasoning: '' },
        { name: 'GroupB', entities: [entityB.id], reasoning: '' },
      ],
    };
    const gen = makeGenWithGrouping([entityA, entityB], relations, grouping);
    // limit = 1, total visible = 2 → split
    const result = gen.generateClassDiagrams(1);

    expect(result.length).toBe(2);
    const diagA = result.find(r => r.name === 'GroupA')!;
    const diagB = result.find(r => r.name === 'GroupB')!;

    // GroupA's diagram should contain the relation (source EntityA is in GroupA)
    expect(diagA.content).toContain('EntityA --> EntityB');
    // GroupB's diagram should NOT contain the relation (source EntityA is NOT in GroupB)
    expect(diagB.content).not.toContain('EntityA --> EntityB');
  });

  it('excludes function-type entities from split count and content', () => {
    // 2 class entities + 3 function entities, 2 groups; visible = 2, limit = 3 → NOT split
    const classA = makeMinimalEntity('ClassA', 'class');
    const classB = makeMinimalEntity('ClassB', 'class');
    const fn1 = makeMinimalEntity('fn1', 'function');
    const fn2 = makeMinimalEntity('fn2', 'function');
    const fn3 = makeMinimalEntity('fn3', 'function');
    const allEntities = [classA, classB, fn1, fn2, fn3];
    const grouping: GroupingDecision = {
      packages: [
        { name: 'GroupA', entities: [classA.id, fn1.id, fn2.id], reasoning: '' },
        { name: 'GroupB', entities: [classB.id, fn3.id], reasoning: '' },
      ],
    };
    const gen = makeGenWithGrouping(allEntities, [], grouping);
    const result = gen.generateClassDiagrams(3);

    expect(result.length).toBe(1);
    expect(result[0].name).toBeNull();
  });
});

describe('generateClassDiagrams — relation ID resolution', () => {
  // C++ entities have IDs like "namespace.ClassName" and names like "ClassName"
  const makeCppEntity = (namespace: string, name: string) => ({
    id: `${namespace}.${name}`,
    name,
    type: 'class' as const,
    visibility: 'public' as const,
    members: [],
    sourceLocation: { file: `${namespace}/${name}.cpp`, startLine: 1, endLine: 10 },
  });

  const makeGrouping = (groups: Array<{ name: string; entities: Array<{ id: string }> }>): GroupingDecision => ({
    packages: groups.map(g => ({ name: g.name, entities: g.entities.map(e => e.id), reasoning: '' })),
  });

  it('uses entity simple name (not escaped ID) in split diagram relation lines', () => {
    // C++ entity: id="ggml.ggml_backend_opencl_buffer_context" name="ggml_backend_opencl_buffer_context"
    const entityA = makeCppEntity('ggml', 'ggml_backend_opencl_buffer_context');
    const entityB = makeCppEntity('ggml', 'ggml_backend_opencl_device');
    // A third entity in a different group is needed to trigger splitting (requires ≥2 groups)
    const entityC = makeCppEntity('common', 'common_utils');
    const entities = [entityA, entityB, entityC];
    const relations: ArchJSON['relations'] = [
      { source: entityA.id, target: entityB.id, type: 'dependency' },
    ];
    const grouping = makeGrouping([
      { name: 'ggml', entities: [entityA, entityB] },
      { name: 'common', entities: [entityC] },
    ]);
    const gen = new ValidatedMermaidGenerator(
      { version: '1.0', language: 'typescript', timestamp: new Date().toISOString(), sourceFiles: [], entities, relations },
      { level: 'class', grouping },
    );
    // 3 entities, limit = 2 → split
    const result = gen.generateClassDiagrams(2);
    const diagGgml = result.find(r => r.name === 'ggml')!;

    // Namespace block uses entity.name directly: "ggml_backend_opencl_buffer_context"
    // Relation must also use simple name, not "ggml_ggml_backend_opencl_buffer_context"
    expect(diagGgml.content).toContain('ggml_backend_opencl_buffer_context --> ggml_backend_opencl_device');
    expect(diagGgml.content).not.toContain('ggml_ggml_backend_opencl_buffer_context');
  });

  it('produces no ghost nodes — relation node IDs match namespace block node IDs', () => {
    const entityA = makeCppEntity('mod', 'MyClass');
    const entityB = makeCppEntity('mod', 'MyBase');
    // Third entity in another group to trigger splitting
    const entityC = makeCppEntity('other', 'OtherClass');
    const entities = [entityA, entityB, entityC];
    const relations: ArchJSON['relations'] = [
      { source: entityA.id, target: entityB.id, type: 'inheritance' },
    ];
    const grouping = makeGrouping([
      { name: 'mod', entities: [entityA, entityB] },
      { name: 'other', entities: [entityC] },
    ]);
    const gen = new ValidatedMermaidGenerator(
      { version: '1.0', language: 'typescript', timestamp: new Date().toISOString(), sourceFiles: [], entities, relations },
      { level: 'class', grouping },
    );
    // 3 entities, limit = 2 → split
    const result = gen.generateClassDiagrams(2);
    const diag = result.find(r => r.name === 'mod')!;
    const lines = diag.content.split('\n');

    // Collect all class node definitions from namespace block
    const classDefs = new Set(
      lines
        .filter(l => /^\s+class \w+\s*\{/.test(l))
        .map(l => l.match(/class (\w+)\s*\{/)![1])
    );

    // Collect all node IDs referenced in relations
    const relationNodeIds = new Set<string>();
    for (const line of lines) {
      // inheritance: "MyBase <|-- MyClass" → ["MyBase", "MyClass"]
      const m = line.match(/(\w+)\s+(?:<\|--|<\|\.\.|\*--|o--|-->)\s+(\w+)/);
      if (m) { relationNodeIds.add(m[1]); relationNodeIds.add(m[2]); }
    }

    // Every relation node ID must appear in namespace block definitions
    for (const id of relationNodeIds) {
      expect(classDefs).toContain(id);
    }
  });

  it('backward compat: TypeScript scoped IDs (.ts.ClassName) still normalise correctly', () => {
    // TypeScript entities: id="src/foo.ts.MyService" name="MyService"
    const entityA = {
      id: 'src/foo.ts.MyService',
      name: 'MyService',
      type: 'class' as const,
      visibility: 'public' as const,
      members: [],
      sourceLocation: { file: 'src/foo.ts', startLine: 1, endLine: 10 },
    };
    const entityB = {
      id: 'src/bar.ts.IRepo',
      name: 'IRepo',
      type: 'interface' as const,
      visibility: 'public' as const,
      members: [],
      sourceLocation: { file: 'src/bar.ts', startLine: 1, endLine: 5 },
    };
    const entities = [entityA, entityB];
    const relations: ArchJSON['relations'] = [
      { source: entityA.id, target: entityB.id, type: 'dependency' },
    ];
    const grouping: GroupingDecision = {
      packages: [
        { name: 'foo', entities: [entityA.id], reasoning: '' },
        { name: 'bar', entities: [entityB.id], reasoning: '' },
      ],
    };
    const gen = new ValidatedMermaidGenerator(
      { version: '1.0', language: 'typescript', timestamp: new Date().toISOString(), sourceFiles: [], entities, relations },
      { level: 'class', grouping },
    );
    // 2 entities, limit = 1 → split
    const result = gen.generateClassDiagrams(1);
    const diagFoo = result.find(r => r.name === 'foo')!;

    // Should use simple names "MyService" and "IRepo", not "src_foo_ts_MyService"
    expect(diagFoo.content).toContain('MyService --> IRepo');
    expect(diagFoo.content).not.toContain('src_foo_ts_MyService');
  });
});
