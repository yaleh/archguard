/**
 * Unit tests for StructuralValidator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StructuralValidator } from '../../../src/mermaid/validator-structural';
import type { ArchJSON } from '../../../src/types';
import type { StructuralValidationResult } from '../../../src/mermaid/types';

describe('StructuralValidator', () => {
  let validator: StructuralValidator;

  beforeEach(() => {
    validator = new StructuralValidator();
  });

  const createMockArchJSON = (entities: any[] = [], relations: any[] = []): ArchJSON => ({
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: ['test.ts'],
    entities,
    relations,
  });

  describe('missing entity detection', () => {
    it('should detect when entity is missing from diagram', () => {
      const archJson = createMockArchJSON([
        {
          id: 'User',
          name: 'User',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
        },
      ]);

      const mermaidCode = `classDiagram
  class Admin
  Admin --> User`;

      const result = validator.validate(mermaidCode, archJson);

      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);

      const missingIssue = result.issues.find((i) => i.type === 'missing-entity');
      expect(missingIssue).toBeDefined();
      expect(missingIssue?.entity).toBe('User');
    });

    it('should pass when all entities are present', () => {
      const archJson = createMockArchJSON([
        {
          id: 'User',
          name: 'User',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
        },
        {
          id: 'Admin',
          name: 'Admin',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'test.ts', startLine: 11, endLine: 20 },
        },
      ]);

      const mermaidCode = `classDiagram
  class User
  class Admin`;

      const result = validator.validate(mermaidCode, archJson);

      const missingIssues = result.issues.filter((i) => i.type === 'missing-entity');
      expect(missingIssues.length).toBe(0);
    });

    it('should detect multiple missing entities', () => {
      const archJson = createMockArchJSON([
        {
          id: 'User',
          name: 'User',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
        },
        {
          id: 'Admin',
          name: 'Admin',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'test.ts', startLine: 11, endLine: 20 },
        },
      ]);

      const mermaidCode = `classDiagram
  class Guest`;

      const result = validator.validate(mermaidCode, archJson);

      const missingIssues = result.issues.filter((i) => i.type === 'missing-entity');
      expect(missingIssues.length).toBe(2);
    });

    it('should handle entity names with special regex characters', () => {
      const archJson = createMockArchJSON([
        {
          id: 'User.Service',
          name: 'User.Service',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
        },
      ]);

      const mermaidCode = `classDiagram
  class Admin`;

      const result = validator.validate(mermaidCode, archJson);

      const missingIssue = result.issues.find((i) => i.type === 'missing-entity');
      expect(missingIssue).toBeDefined();
      expect(missingIssue?.entity).toBe('User.Service');
    });
  });

  describe('invalid relation detection', () => {
    it('should detect relation with missing source entity', () => {
      const archJson = createMockArchJSON(
        [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
        ],
        [
          {
            id: 'rel1',
            type: 'dependency',
            source: 'NonExistent',
            target: 'User',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class User`;

      const result = validator.validate(mermaidCode, archJson);

      const invalidRelation = result.issues.find((i) => i.type === 'invalid-relation');
      expect(invalidRelation).toBeDefined();
      expect(invalidRelation?.details?.sourceExists).toBe(false);
    });

    it('should detect relation with missing target entity', () => {
      const archJson = createMockArchJSON(
        [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
        ],
        [
          {
            id: 'rel1',
            type: 'dependency',
            source: 'User',
            target: 'NonExistent',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class User`;

      const result = validator.validate(mermaidCode, archJson);

      const invalidRelation = result.issues.find((i) => i.type === 'invalid-relation');
      expect(invalidRelation).toBeDefined();
      expect(invalidRelation?.details?.targetExists).toBe(false);
    });

    it('should detect relation with both source and target missing', () => {
      const archJson = createMockArchJSON(
        [],
        [
          {
            id: 'rel1',
            type: 'dependency',
            source: 'NonExistent1',
            target: 'NonExistent2',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class Other`;

      const result = validator.validate(mermaidCode, archJson);

      const invalidRelation = result.issues.find((i) => i.type === 'invalid-relation');
      expect(invalidRelation).toBeDefined();
      expect(invalidRelation?.details?.sourceExists).toBe(false);
      expect(invalidRelation?.details?.targetExists).toBe(false);
    });

    it('should pass when all relations reference valid entities', () => {
      const archJson = createMockArchJSON(
        [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
          {
            id: 'Admin',
            name: 'Admin',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 11, endLine: 20 },
          },
        ],
        [
          {
            id: 'rel1',
            type: 'dependency',
            source: 'User',
            target: 'Admin',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class User
  class Admin
  User --> Admin`;

      const result = validator.validate(mermaidCode, archJson);

      const invalidRelations = result.issues.filter((i) => i.type === 'invalid-relation');
      expect(invalidRelations.length).toBe(0);
    });
  });

  describe('circular dependency detection', () => {
    it('should detect simple circular dependency', () => {
      const archJson = createMockArchJSON(
        [
          {
            id: 'A',
            name: 'A',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
          {
            id: 'B',
            name: 'B',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 11, endLine: 20 },
          },
        ],
        [
          {
            id: 'rel1',
            type: 'dependency',
            source: 'A',
            target: 'B',
          },
          {
            id: 'rel2',
            type: 'dependency',
            source: 'B',
            target: 'A',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class A
  class B
  A --> B
  B --> A`;

      const result = validator.validate(mermaidCode, archJson);

      const circularIssue = result.issues.find((i) => i.type === 'circular-dependency');
      expect(circularIssue).toBeDefined();
    });

    it('should detect complex circular dependency chain', () => {
      const archJson = createMockArchJSON(
        [
          {
            id: 'A',
            name: 'A',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
          {
            id: 'B',
            name: 'B',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 11, endLine: 20 },
          },
          {
            id: 'C',
            name: 'C',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 21, endLine: 30 },
          },
        ],
        [
          {
            id: 'rel1',
            type: 'dependency',
            source: 'A',
            target: 'B',
          },
          {
            id: 'rel2',
            type: 'dependency',
            source: 'B',
            target: 'C',
          },
          {
            id: 'rel3',
            type: 'dependency',
            source: 'C',
            target: 'A',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class A
  class B
  class C
  A --> B
  B --> C
  C --> A`;

      const result = validator.validate(mermaidCode, archJson);

      const circularIssue = result.issues.find((i) => i.type === 'circular-dependency');
      expect(circularIssue).toBeDefined();
    });

    it('should not report circular dependency for acyclic graph', () => {
      const archJson = createMockArchJSON(
        [
          {
            id: 'A',
            name: 'A',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
          {
            id: 'B',
            name: 'B',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 11, endLine: 20 },
          },
          {
            id: 'C',
            name: 'C',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 21, endLine: 30 },
          },
        ],
        [
          {
            id: 'rel1',
            type: 'dependency',
            source: 'A',
            target: 'B',
          },
          {
            id: 'rel2',
            type: 'dependency',
            source: 'B',
            target: 'C',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class A
  class B
  class C
  A --> B
  B --> C`;

      const result = validator.validate(mermaidCode, archJson);

      const circularIssues = result.issues.filter((i) => i.type === 'circular-dependency');
      expect(circularIssues.length).toBe(0);
    });
  });

  describe('orphan entity detection', () => {
    it('should detect entity with no relations', () => {
      const archJson = createMockArchJSON(
        [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
          {
            id: 'Admin',
            name: 'Admin',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 11, endLine: 20 },
          },
        ],
        [
          {
            id: 'rel1',
            type: 'dependency',
            source: 'User',
            target: 'Admin',
          },
        ]
      );

      // Add a third entity with no relations
      archJson.entities.push({
        id: 'Guest',
        name: 'Guest',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'test.ts', startLine: 21, endLine: 30 },
      });

      const mermaidCode = `classDiagram
  class User
  class Admin
  class Guest
  User --> Admin`;

      const result = validator.validate(mermaidCode, archJson);

      const orphanIssue = result.issues.find((i) => i.type === 'orphan-entity');
      expect(orphanIssue).toBeDefined();
      expect(orphanIssue?.entity).toBe('Guest');
    });

    it('should not report entities with relations as orphans', () => {
      const archJson = createMockArchJSON(
        [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
          {
            id: 'Admin',
            name: 'Admin',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 11, endLine: 20 },
          },
        ],
        [
          {
            id: 'rel1',
            type: 'dependency',
            source: 'User',
            target: 'Admin',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class User
  class Admin
  User --> Admin`;

      const result = validator.validate(mermaidCode, archJson);

      const orphanIssues = result.issues.filter((i) => i.type === 'orphan-entity');
      expect(orphanIssues.length).toBe(0);
    });

    it('should detect multiple orphan entities', () => {
      const archJson = createMockArchJSON([]);

      // Add entities without relations
      archJson.entities.push(
        {
          id: 'User',
          name: 'User',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
        },
        {
          id: 'Admin',
          name: 'Admin',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'test.ts', startLine: 11, endLine: 20 },
        }
      );

      const mermaidCode = `classDiagram
  class User
  class Admin`;

      const result = validator.validate(mermaidCode, archJson);

      const orphanIssues = result.issues.filter((i) => i.type === 'orphan-entity');
      expect(orphanIssues.length).toBe(2);
    });
  });

  describe('overall validation', () => {
    it('should return valid when no issues found', () => {
      const archJson = createMockArchJSON(
        [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
          {
            id: 'Admin',
            name: 'Admin',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 11, endLine: 20 },
          },
        ],
        [
          {
            id: 'rel1',
            type: 'dependency',
            source: 'User',
            target: 'Admin',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class User
  class Admin
  User --> Admin`;

      const result = validator.validate(mermaidCode, archJson);

      expect(result.valid).toBe(true);
      expect(result.issues.length).toBe(0);
    });

    it('should return invalid when issues found', () => {
      const archJson = createMockArchJSON(
        [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
        ],
        [
          {
            id: 'rel1',
            type: 'dependency',
            source: 'User',
            target: 'NonExistent',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class Admin`;

      const result = validator.validate(mermaidCode, archJson);

      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should collect multiple issue types', () => {
      const archJson = createMockArchJSON(
        [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
          {
            id: 'Admin',
            name: 'Admin',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 11, endLine: 20 },
          },
        ],
        [
          {
            id: 'rel1',
            type: 'dependency',
            source: 'Admin',
            target: 'User',
          },
          {
            id: 'rel2',
            type: 'dependency',
            source: 'User',
            target: 'Admin',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class Guest`;

      const result = validator.validate(mermaidCode, archJson);

      // Should have missing-entity issues and circular-dependency
      const issueTypes = new Set(result.issues.map((i) => i.type));
      expect(issueTypes.has('missing-entity')).toBe(true);
      expect(issueTypes.has('circular-dependency')).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty ArchJSON', () => {
      const archJson = createMockArchJSON([], []);

      const mermaidCode = `classDiagram`;

      const result = validator.validate(mermaidCode, archJson);

      expect(result).toBeDefined();
      expect(result.valid).toBe(true); // No issues if everything is empty
    });

    it('should handle entities with no relations', () => {
      const archJson = createMockArchJSON([
        {
          id: 'User',
          name: 'User',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
        },
      ]);

      const mermaidCode = `classDiagram
  class User`;

      const result = validator.validate(mermaidCode, archJson);

      // Should have orphan-entity issue
      const orphanIssues = result.issues.filter((i) => i.type === 'orphan-entity');
      expect(orphanIssues.length).toBe(1);
    });

    it('should handle large number of entities and relations', () => {
      const entities: any[] = [];
      const relations: any[] = [];

      for (let i = 0; i < 50; i++) {
        entities.push({
          id: `Entity${i}`,
          name: `Entity${i}`,
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'test.ts', startLine: i * 10, endLine: (i + 1) * 10 },
        });
      }

      for (let i = 0; i < 49; i++) {
        relations.push({
          id: `rel${i}`,
          type: 'dependency',
          source: `Entity${i}`,
          target: `Entity${i + 1}`,
        });
      }

      const archJson = createMockArchJSON(entities, relations);

      let mermaidCode = 'classDiagram\n';
      entities.forEach((e) => {
        mermaidCode += `  class ${e.name}\n`;
      });
      relations.forEach((r) => {
        mermaidCode += `  ${r.source} --> ${r.target}\n`;
      });

      const result = validator.validate(mermaidCode, archJson);

      expect(result).toBeDefined();
      // Should not have structural issues
      expect(result.issues.filter((i) => i.type === 'invalid-relation').length).toBe(0);
    });
  });
});
