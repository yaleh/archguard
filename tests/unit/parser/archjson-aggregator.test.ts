/**
 * Unit tests for ArchJSONAggregator
 *
 * TDD test suite for the three-level detail aggregator (v2.0 core component)
 */

import { describe, it, expect } from 'vitest';
import { ArchJSONAggregator } from '@/parser/archjson-aggregator.js';
import type { ArchJSON, Entity, Relation, Member } from '@/types/index.js';
import type { DetailLevel } from '@/types/config.js';

describe('ArchJSONAggregator', () => {
  const aggregator = new ArchJSONAggregator();

  // Sample test data
  const createTestArchJSON = (): ArchJSON => ({
    version: '1.0',
    language: 'typescript',
    timestamp: '2024-01-01T00:00:00.000Z',
    sourceFiles: ['src/services/user.ts', 'src/repositories/user-repo.ts'],
    entities: [
      {
        id: 'src.services.UserService',
        name: 'UserService',
        type: 'class',
        visibility: 'public',
        sourceLocation: {
          file: 'src/services/user.ts',
          startLine: 10,
          endLine: 50,
        },
        members: [
          {
            name: 'getUser',
            type: 'method',
            visibility: 'public',
            returnType: 'User',
            parameters: [{ name: 'id', type: 'string' }],
          },
          {
            name: 'getUserInternal',
            type: 'method',
            visibility: 'private',
            returnType: 'User',
            parameters: [{ name: 'id', type: 'string' }],
          },
          {
            name: 'userRepository',
            type: 'property',
            visibility: 'private',
            fieldType: 'UserRepository',
          },
        ],
      },
      {
        id: 'src.repositories.UserRepository',
        name: 'UserRepository',
        type: 'class',
        visibility: 'public',
        sourceLocation: {
          file: 'src/repositories/user-repo.ts',
          startLine: 5,
          endLine: 30,
        },
        members: [
          {
            name: 'findById',
            type: 'method',
            visibility: 'public',
            returnType: 'User',
            parameters: [{ name: 'id', type: 'string' }],
          },
          {
            name: 'dbConnection',
            type: 'property',
            visibility: 'private',
            fieldType: 'Connection',
          },
        ],
      },
    ],
    relations: [
      {
        id: 'rel-1',
        type: 'dependency',
        source: 'src.services.UserService',
        target: 'src.repositories.UserRepository',
      },
    ],
  });

  describe('aggregate', () => {
    it('should return original archJSON for method level', () => {
      const archJSON = createTestArchJSON();
      const result = aggregator.aggregate(archJSON, 'method');

      expect(result).toEqual(archJSON);
      expect(result.entities).toHaveLength(2);
      expect(result.entities[0].members).toHaveLength(3);
    });

    it('should filter to public members for class level', () => {
      const archJSON = createTestArchJSON();
      const result = aggregator.aggregate(archJSON, 'class');

      expect(result.entities).toHaveLength(2);

      const userService = result.entities.find((e) => e.name === 'UserService');
      expect(userService).toBeDefined();
      expect(userService.members).toHaveLength(1);
      expect(userService.members[0].name).toBe('getUser');
      expect(userService.members[0].visibility).toBe('public');

      const userRepo = result.entities.find((e) => e.name === 'UserRepository');
      expect(userRepo).toBeDefined();
      expect(userRepo.members).toHaveLength(1);
      expect(userRepo.members[0].name).toBe('findById');
    });

    it('should aggregate to package level', () => {
      const archJSON = createTestArchJSON();
      const result = aggregator.aggregate(archJSON, 'package');

      // Should have package entities
      expect(result.entities.length).toBeGreaterThan(0);

      // All entities should be packages
      result.entities.forEach((entity) => {
        expect(entity.type).toBe('package' as any); // Using 'any' as package type isn't in EntityType yet
        expect(entity.members).toEqual([]);
      });

      // Should have package-level relations
      expect(result.relations.length).toBeGreaterThan(0);
    });
  });

  describe('aggregateToClassLevel', () => {
    it('should keep only public members', () => {
      const archJSON = createTestArchJSON();
      const result = aggregator['aggregateToClassLevel'](archJSON);

      const userService = result.entities.find((e) => e.name === 'UserService');
      expect(userService.members.every((m) => m.visibility === 'public')).toBe(true);
    });

    it('should preserve entity metadata', () => {
      const archJSON = createTestArchJSON();
      const result = aggregator['aggregateToClassLevel'](archJSON);

      const originalEntity = archJSON.entities[0];
      const resultEntity = result.entities[0];

      expect(resultEntity.id).toBe(originalEntity.id);
      expect(resultEntity.name).toBe(originalEntity.name);
      expect(resultEntity.type).toBe(originalEntity.type);
      expect(resultEntity.sourceLocation).toEqual(originalEntity.sourceLocation);
    });

    it('should handle entities with no members', () => {
      const archJSON: ArchJSON = {
        ...createTestArchJSON(),
        entities: [
          {
            id: 'src.utils.Empty',
            name: 'Empty',
            type: 'interface',
            visibility: 'public',
            sourceLocation: { file: 'src/utils/empty.ts', startLine: 1, endLine: 1 },
            members: [],
          },
        ],
      };

      const result = aggregator['aggregateToClassLevel'](archJSON);
      expect(result.entities[0].members).toEqual([]);
    });

    it('should treat undefined visibility as public', () => {
      const archJSON: ArchJSON = {
        ...createTestArchJSON(),
        entities: [
          {
            id: 'src.test.TestClass',
            name: 'TestClass',
            type: 'class',
            visibility: 'public',
            sourceLocation: { file: 'src/test.ts', startLine: 1, endLine: 10 },
            members: [
              {
                name: 'publicMethod',
                type: 'method',
                visibility: undefined as any, // undefined should be treated as public
                returnType: 'void',
              },
              {
                name: 'privateMethod',
                type: 'method',
                visibility: 'private',
                returnType: 'void',
              },
            ],
          },
        ],
      };

      const result = aggregator['aggregateToClassLevel'](archJSON);
      expect(result.entities[0].members).toHaveLength(1);
      expect(result.entities[0].members[0].name).toBe('publicMethod');
    });
  });

  describe('aggregateToPackageLevel', () => {
    it('should extract unique packages from entities', () => {
      const archJSON = createTestArchJSON();
      const result = aggregator['aggregateToPackageLevel'](archJSON);

      expect(result.entities.length).toBe(2); // services and repositories
      expect(result.entities.find((e) => e.name === 'services')).toBeDefined();
      expect(result.entities.find((e) => e.name === 'repositories')).toBeDefined();
    });

    it('should create package entities with empty members', () => {
      const archJSON = createTestArchJSON();
      const result = aggregator['aggregateToPackageLevel'](archJSON);

      result.entities.forEach((entity) => {
        expect(entity.members).toEqual([]);
        expect(entity.type).toBe('package' as any);
      });
    });

    it('should analyze package dependencies correctly', () => {
      const archJSON = createTestArchJSON();
      const result = aggregator['aggregateToPackageLevel'](archJSON);

      // Should have relation from services to repositories
      const relation = result.relations.find(
        (r) => r.source === 'services' && r.target === 'repositories'
      );
      expect(relation).toBeDefined();
      expect(relation.type).toBe('dependency');
    });

    it('should handle multiple classes in the same package', () => {
      const archJSON: ArchJSON = {
        ...createTestArchJSON(),
        entities: [
          {
            id: 'src.services.UserService',
            name: 'UserService',
            type: 'class',
            visibility: 'public',
            sourceLocation: { file: 'src/services/user.ts', startLine: 1, endLine: 10 },
            members: [],
          },
          {
            id: 'src.services.AuthService',
            name: 'AuthService',
            type: 'class',
            visibility: 'public',
            sourceLocation: { file: 'src/services/auth.ts', startLine: 1, endLine: 10 },
            members: [],
          },
        ],
      };

      const result = aggregator['aggregateToPackageLevel'](archJSON);
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('services');
    });

    it('should deduplicate package-level relations', () => {
      const archJSON: ArchJSON = {
        ...createTestArchJSON(),
        entities: [
          {
            id: 'src.services.UserService',
            name: 'UserService',
            type: 'class',
            visibility: 'public',
            sourceLocation: { file: 'src/services/user.ts', startLine: 1, endLine: 10 },
            members: [],
          },
          {
            id: 'src.services.AuthService',
            name: 'AuthService',
            type: 'class',
            visibility: 'public',
            sourceLocation: { file: 'src/services/auth.ts', startLine: 1, endLine: 10 },
            members: [],
          },
          {
            id: 'src.repositories.UserRepository',
            name: 'UserRepository',
            type: 'class',
            visibility: 'public',
            sourceLocation: { file: 'src/repositories/user.ts', startLine: 1, endLine: 10 },
            members: [],
          },
        ],
        relations: [
          {
            id: 'rel-1',
            type: 'dependency',
            source: 'src.services.UserService',
            target: 'src.repositories.UserRepository',
          },
          {
            id: 'rel-2',
            type: 'dependency',
            source: 'src.services.AuthService',
            target: 'src.repositories.UserRepository',
          },
        ],
      };

      const result = aggregator['aggregateToPackageLevel'](archJSON);

      // Should have only one relation from services to repositories
      const packageRelations = result.relations.filter(
        (r) => r.source === 'services' && r.target === 'repositories'
      );
      expect(packageRelations).toHaveLength(1);
    });

    it('should ignore self-relations in same package', () => {
      const archJSON: ArchJSON = {
        ...createTestArchJSON(),
        entities: [
          {
            id: 'src.services.UserService',
            name: 'UserService',
            type: 'class',
            visibility: 'public',
            sourceLocation: { file: 'src/services/user.ts', startLine: 1, endLine: 10 },
            members: [],
          },
          {
            id: 'src.services.AuthService',
            name: 'AuthService',
            type: 'class',
            visibility: 'public',
            sourceLocation: { file: 'src/services/auth.ts', startLine: 1, endLine: 10 },
            members: [],
          },
        ],
        relations: [
          {
            id: 'rel-1',
            type: 'dependency',
            source: 'src.services.UserService',
            target: 'src.services.AuthService',
          },
        ],
      };

      const result = aggregator['aggregateToPackageLevel'](archJSON);

      // Should not have any relations (both in same package)
      expect(result.relations).toHaveLength(0);
    });
  });

  describe('extractPackages', () => {
    it('should extract package names from file paths', () => {
      const entities: Entity[] = [
        {
          id: 'src.services.UserService',
          name: 'UserService',
          type: 'class',
          visibility: 'public',
          sourceLocation: { file: 'src/services/user.ts', startLine: 1, endLine: 10 },
          members: [],
        },
        {
          id: 'src.repositories.UserRepository',
          name: 'UserRepository',
          type: 'class',
          visibility: 'public',
          sourceLocation: { file: 'src/repositories/user.ts', startLine: 1, endLine: 10 },
          members: [],
        },
      ];

      const packages = aggregator['extractPackages'](entities);
      // Package names are extracted from file paths, not entity IDs
      expect(packages).toEqual(['repositories', 'services']); // Sorted alphabetically
    });

    it('should deduplicate packages', () => {
      const entities: Entity[] = [
        {
          id: 'src.services.UserService',
          name: 'UserService',
          type: 'class',
          visibility: 'public',
          sourceLocation: { file: 'src/services/user.ts', startLine: 1, endLine: 10 },
          members: [],
        },
        {
          id: 'src.services.AuthService',
          name: 'AuthService',
          type: 'class',
          visibility: 'public',
          sourceLocation: { file: 'src/services/auth.ts', startLine: 1, endLine: 10 },
          members: [],
        },
      ];

      const packages = aggregator['extractPackages'](entities);
      // Package names are extracted from file paths
      expect(packages).toEqual(['services']);
    });

    it('should handle single-level package names', () => {
      const entities: Entity[] = [
        {
          id: 'utils.Helper',
          name: 'Helper',
          type: 'class',
          visibility: 'public',
          sourceLocation: { file: 'utils/helper.ts', startLine: 1, endLine: 10 },
          members: [],
        },
      ];

      const packages = aggregator['extractPackages'](entities);
      expect(packages).toEqual(['utils']);
    });

    it('should handle entities without package (root level)', () => {
      const entities: Entity[] = [
        {
          id: 'GlobalClass',
          name: 'GlobalClass',
          type: 'class',
          visibility: 'public',
          sourceLocation: { file: 'global.ts', startLine: 1, endLine: 10 },
          members: [],
        },
      ];

      const packages = aggregator['extractPackages'](entities);
      // Root level files (no directory) are filtered out
      expect(packages).toEqual([]);
    });
  });

  describe('analyzePackageDependencies', () => {
    it('should map class relations to package relations', () => {
      const entities: Entity[] = [
        {
          id: 'src.services.UserService',
          name: 'UserService',
          type: 'class',
          visibility: 'public',
          sourceLocation: { file: 'src/services/user.ts', startLine: 1, endLine: 10 },
          members: [],
        },
        {
          id: 'src.repositories.UserRepository',
          name: 'UserRepository',
          type: 'class',
          visibility: 'public',
          sourceLocation: { file: 'src/repositories/user.ts', startLine: 1, endLine: 10 },
          members: [],
        },
      ];

      const relations: Relation[] = [
        {
          id: 'rel-1',
          type: 'dependency',
          source: 'src.services.UserService',
          target: 'src.repositories.UserRepository',
        },
      ];

      const packageRelations = aggregator['analyzePackageDependencies'](entities, relations);

      expect(packageRelations).toHaveLength(1);
      // Package names are extracted from file paths, not entity IDs
      expect(packageRelations[0].source).toBe('services');
      expect(packageRelations[0].target).toBe('repositories');
      expect(packageRelations[0].type).toBe('dependency');
    });

    it('should deduplicate package-level relations', () => {
      const entities: Entity[] = [
        {
          id: 'a.A1',
          name: 'A1',
          type: 'class',
          visibility: 'public',
          sourceLocation: { file: 'a/a1.ts', startLine: 1, endLine: 1 },
          members: [],
        },
        {
          id: 'a.A2',
          name: 'A2',
          type: 'class',
          visibility: 'public',
          sourceLocation: { file: 'a/a2.ts', startLine: 1, endLine: 1 },
          members: [],
        },
        {
          id: 'b.B1',
          name: 'B1',
          type: 'class',
          visibility: 'public',
          sourceLocation: { file: 'b/b1.ts', startLine: 1, endLine: 1 },
          members: [],
        },
      ];

      const relations: Relation[] = [
        { id: 'rel-1', type: 'dependency', source: 'a.A1', target: 'b.B1' },
        { id: 'rel-2', type: 'dependency', source: 'a.A2', target: 'b.B1' },
      ];

      const packageRelations = aggregator['analyzePackageDependencies'](entities, relations);

      expect(packageRelations).toHaveLength(1);
      expect(packageRelations[0].source).toBe('a');
      expect(packageRelations[0].target).toBe('b');
    });

    it('should filter out self-relations within same package', () => {
      const entities: Entity[] = [
        {
          id: 'a.A1',
          name: 'A1',
          type: 'class',
          visibility: 'public',
          sourceLocation: { file: 'a/a1.ts', startLine: 1, endLine: 1 },
          members: [],
        },
        {
          id: 'a.A2',
          name: 'A2',
          type: 'class',
          visibility: 'public',
          sourceLocation: { file: 'a/a2.ts', startLine: 1, endLine: 1 },
          members: [],
        },
      ];

      const relations: Relation[] = [
        { id: 'rel-1', type: 'dependency', source: 'a.A1', target: 'a.A2' },
      ];

      const packageRelations = aggregator['analyzePackageDependencies'](entities, relations);

      expect(packageRelations).toHaveLength(0);
    });

    it('should preserve relation types', () => {
      const entities: Entity[] = [
        {
          id: 'a.A',
          name: 'A',
          type: 'class',
          visibility: 'public',
          sourceLocation: { file: 'a/a.ts', startLine: 1, endLine: 1 },
          members: [],
        },
        {
          id: 'b.B',
          name: 'B',
          type: 'class',
          visibility: 'public',
          sourceLocation: { file: 'b/b.ts', startLine: 1, endLine: 1 },
          members: [],
        },
      ];

      const relations: Relation[] = [
        { id: 'rel-1', type: 'composition', source: 'a.A', target: 'b.B' },
      ];

      const packageRelations = aggregator['analyzePackageDependencies'](entities, relations);

      expect(packageRelations[0].type).toBe('composition');
    });
  });

  describe('edge cases', () => {
    it('should handle empty entities array', () => {
      const archJSON: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2024-01-01T00:00:00.000Z',
        sourceFiles: [],
        entities: [],
        relations: [],
      };

      const result = aggregator.aggregate(archJSON, 'package');
      expect(result.entities).toEqual([]);
      expect(result.relations).toEqual([]);
    });

    it('should handle entities with all private members', () => {
      const archJSON: ArchJSON = {
        ...createTestArchJSON(),
        entities: [
          {
            id: 'src.PrivateClass',
            name: 'PrivateClass',
            type: 'class',
            visibility: 'public',
            sourceLocation: { file: 'src/private.ts', startLine: 1, endLine: 10 },
            members: [
              { name: 'private1', type: 'method', visibility: 'private', returnType: 'void' },
              { name: 'private2', type: 'property', visibility: 'private', fieldType: 'string' },
            ],
          },
        ],
      };

      const result = aggregator.aggregate(archJSON, 'class');
      expect(result.entities[0].members).toEqual([]);
    });

    it('should preserve timestamp and metadata', () => {
      const archJSON = createTestArchJSON();
      const result = aggregator.aggregate(archJSON, 'class');

      expect(result.version).toBe(archJSON.version);
      expect(result.language).toBe(archJSON.language);
      expect(result.timestamp).toBe(archJSON.timestamp);
    });
  });
});
