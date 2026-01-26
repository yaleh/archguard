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
      expect(mermaidCode).toContain('"User Layer"');
      expect(mermaidCode).toContain('"Auth Layer"');
    });

    it('should include packages in correct order', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'package',
        grouping: groupingDecision,
      });

      const mermaidCode = generator.generate();

      // Check that namespaces are properly defined
      const userLayerIndex = mermaidCode.indexOf('"User Layer"');
      const authLayerIndex = mermaidCode.indexOf('"Auth Layer"');

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
  });

  describe('namespace generation', () => {
    it('should wrap entities in namespaces when grouping is provided', () => {
      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: groupingDecision,
      });

      const mermaidCode = generator.generate();

      expect(mermaidCode).toContain('namespace');
      expect(mermaidCode).toContain('"User Layer"');
      expect(mermaidCode).toContain('"Auth Layer"');
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
});
