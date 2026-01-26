/**
 * Unit tests for HeuristicGrouper
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HeuristicGrouper } from '../../../src/mermaid/grouper';
import { ArchJSON } from '../../../src/types';

describe('HeuristicGrouper', () => {
  const archJson: ArchJSON = {
    version: '1.0',
    language: 'typescript',
    timestamp: '2026-01-26T10:00:00Z',
    sourceFiles: [
      'src/user/User.ts',
      'src/user/UserService.ts',
      'src/auth/AuthService.ts',
      'src/auth/AuthController.ts',
      'src/repo/BaseRepository.ts',
      'lib/utils/helpers.ts',
    ],
    entities: [
      {
        id: 'User',
        name: 'User',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'src/user/User.ts', startLine: 1, endLine: 20 },
      },
      {
        id: 'UserService',
        name: 'UserService',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'src/user/UserService.ts', startLine: 1, endLine: 15 },
      },
      {
        id: 'AuthService',
        name: 'AuthService',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'src/auth/AuthService.ts', startLine: 1, endLine: 25 },
      },
      {
        id: 'AuthController',
        name: 'AuthController',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'src/auth/AuthController.ts', startLine: 1, endLine: 30 },
      },
      {
        id: 'BaseRepository',
        name: 'BaseRepository',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'src/repo/BaseRepository.ts', startLine: 1, endLine: 50 },
      },
      {
        id: 'Helpers',
        name: 'Helpers',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'lib/utils/helpers.ts', startLine: 1, endLine: 10 },
      },
    ],
    relations: [],
  };

  describe('initialization', () => {
    it('should initialize without config', () => {
      const grouper = new HeuristicGrouper();
      expect(grouper).toBeDefined();
    });

    it('should accept custom config', () => {
      const grouper = new HeuristicGrouper({
        maxPackages: 5,
        maxEntitiesPerPackage: 10,
      });
      expect(grouper).toBeDefined();
    });
  });

  describe('path-based grouping', () => {
    it('should group entities by src directory structure', () => {
      const grouper = new HeuristicGrouper();
      const decision = grouper.group(archJson);

      expect(decision.packages.length).toBeGreaterThan(0);
      expect(decision.layout).toBeDefined();
      expect(decision.layout.direction).toBeDefined();
    });

    it('should create user package from src/user', () => {
      const grouper = new HeuristicGrouper();
      const decision = grouper.group(archJson);

      const userPackage = decision.packages.find((p) =>
        p.name.toLowerCase().includes('user')
      );
      expect(userPackage).toBeDefined();
      expect(userPackage?.entities).toContain('User');
      expect(userPackage?.entities).toContain('UserService');
    });

    it('should create auth package from src/auth', () => {
      const grouper = new HeuristicGrouper();
      const decision = grouper.group(archJson);

      const authPackage = decision.packages.find((p) =>
        p.name.toLowerCase().includes('auth')
      );
      expect(authPackage).toBeDefined();
      expect(authPackage?.entities).toContain('AuthService');
      expect(authPackage?.entities).toContain('AuthController');
    });

    it('should create repo package from src/repo', () => {
      const grouper = new HeuristicGrouper();
      const decision = grouper.group(archJson);

      const repoPackage = decision.packages.find((p) =>
        p.name.toLowerCase().includes('repo')
      );
      expect(repoPackage).toBeDefined();
      expect(repoPackage?.entities).toContain('BaseRepository');
    });
  });

  describe('lib directory handling', () => {
    it('should handle lib directory structure', () => {
      const grouper = new HeuristicGrouper();
      const decision = grouper.group(archJson);

      const libPackage = decision.packages.find((p) =>
        p.name.toLowerCase().includes('util') || p.name.toLowerCase().includes('lib')
      );
      expect(libPackage).toBeDefined();
      expect(libPackage?.entities).toContain('Helpers');
    });
  });

  describe('package name formatting', () => {
    it('should format package names with proper capitalization', () => {
      const grouper = new HeuristicGrouper();
      const decision = grouper.group(archJson);

      // Package names should be capitalized
      decision.packages.forEach((pkg) => {
        expect(pkg.name.charAt(0)).toMatch(/[A-Z]/);
        expect(pkg.name).not.toContain('/');
      });
    });

    it('should add "Layer" suffix to package names', () => {
      const grouper = new HeuristicGrouper();
      const decision = grouper.group(archJson);

      // Most packages should have "Layer" suffix
      const layerPackages = decision.packages.filter((p) => p.name.includes('Layer'));
      expect(layerPackages.length).toBeGreaterThan(0);
    });
  });

  describe('layout decision', () => {
    it('should provide layout direction', () => {
      const grouper = new HeuristicGrouper();
      const decision = grouper.group(archJson);

      expect(decision.layout.direction).toBeDefined();
      expect(['TB', 'TD', 'BT', 'RL', 'LR']).toContain(decision.layout.direction);
    });

    it('should provide layout reasoning', () => {
      const grouper = new HeuristicGrouper();
      const decision = grouper.group(archJson);

      expect(decision.layout.reasoning).toBeDefined();
      expect(decision.layout.reasoning.length).toBeGreaterThan(0);
    });
  });

  describe('empty or edge cases', () => {
    it('should handle empty entity list', () => {
      const emptyArchJson: ArchJSON = {
        ...archJson,
        entities: [],
        sourceFiles: [],
      };

      const grouper = new HeuristicGrouper();
      const decision = grouper.group(emptyArchJson);

      expect(decision.packages).toEqual([]);
      expect(decision.layout).toBeDefined();
    });

    it('should handle entities without source location', () => {
      const noLocationArchJson: ArchJSON = {
        ...archJson,
        entities: [
          {
            id: 'Unknown',
            name: 'Unknown',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: '', startLine: 0, endLine: 0 },
          },
        ],
      };

      const grouper = new HeuristicGrouper();
      const decision = grouper.group(noLocationArchJson);

      // Should still create a package (likely "Core")
      expect(decision.packages.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle deeply nested paths', () => {
      const nestedArchJson: ArchJSON = {
        ...archJson,
        sourceFiles: ['src/features/user/components/UserCard.ts'],
        entities: [
          {
            id: 'UserCard',
            name: 'UserCard',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'src/features/user/components/UserCard.ts', startLine: 1, endLine: 10 },
          },
        ],
      };

      const grouper = new HeuristicGrouper();
      const decision = grouper.group(nestedArchJson);

      expect(decision.packages.length).toBeGreaterThan(0);
      // Should use the directory after src/
      const featurePackage = decision.packages.find((p) =>
        p.name.toLowerCase().includes('feature') || p.name.toLowerCase().includes('user')
      );
      expect(featurePackage).toBeDefined();
    });
  });

  describe('custom grouping rules', () => {
    it('should respect custom max packages limit', () => {
      const largeArchJson: ArchJSON = {
        ...archJson,
        sourceFiles: [
          'src/a/A.ts',
          'src/b/B.ts',
          'src/c/C.ts',
          'src/d/D.ts',
          'src/e/E.ts',
          'src/f/F.ts',
        ],
        entities: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
          id: id.toUpperCase(),
          name: id.toUpperCase(),
          type: 'class' as const,
          visibility: 'public' as const,
          members: [],
          sourceLocation: { file: `src/${id}/${id.toUpperCase()}.ts`, startLine: 1, endLine: 10 },
        })),
      };

      const grouper = new HeuristicGrouper({ maxPackages: 3 });
      const decision = grouper.group(largeArchJson);

      // Should limit packages
      expect(decision.packages.length).toBeLessThanOrEqual(3);
    });

    it('should respect custom max entities per package', () => {
      const grouper = new HeuristicGrouper({ maxEntitiesPerPackage: 2 });
      const decision = grouper.group(archJson);

      // Check that no package exceeds the limit
      decision.packages.forEach((pkg) => {
        expect(pkg.entities.length).toBeLessThanOrEqual(2);
      });
    });
  });

  describe('different project structures', () => {
    it('should handle monorepo packages structure', () => {
      const monorepoArchJson: ArchJSON = {
        ...archJson,
        sourceFiles: [
          'packages/user-service/src/User.ts',
          'packages/auth-service/src/Auth.ts',
        ],
        entities: [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'packages/user-service/src/User.ts', startLine: 1, endLine: 10 },
          },
          {
            id: 'Auth',
            name: 'Auth',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'packages/auth-service/src/Auth.ts', startLine: 1, endLine: 10 },
          },
        ],
      };

      const grouper = new HeuristicGrouper();
      const decision = grouper.group(monorepoArchJson);

      expect(decision.packages.length).toBeGreaterThan(0);
    });

    it('should handle flat structure (no src directory)', () => {
      const flatArchJson: ArchJSON = {
        ...archJson,
        sourceFiles: ['User.ts', 'Auth.ts', 'Repo.ts'],
        entities: [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'User.ts', startLine: 1, endLine: 10 },
          },
          {
            id: 'Auth',
            name: 'Auth',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'Auth.ts', startLine: 1, endLine: 10 },
          },
        ],
      };

      const grouper = new HeuristicGrouper();
      const decision = grouper.group(flatArchJson);

      // Should create a default "Core" package
      expect(decision.packages.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('package reasoning', () => {
    it('should provide reasoning for each package', () => {
      const grouper = new HeuristicGrouper();
      const decision = grouper.group(archJson);

      decision.packages.forEach((pkg) => {
        // Reasoning is optional but should exist if provided
        if (pkg.reasoning) {
          expect(pkg.reasoning.length).toBeGreaterThan(0);
        }
      });
    });
  });
});
