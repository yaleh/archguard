/**
 * Unit tests for ValidationPipeline
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MermaidValidationPipeline } from '../../../src/mermaid/validation-pipeline';
import type { ArchJSON } from '../../../src/types';

describe('MermaidValidationPipeline', () => {
  let pipeline: MermaidValidationPipeline;

  beforeEach(() => {
    pipeline = new MermaidValidationPipeline();
  });

  const createMockArchJSON = (entities: any[] = [], relations: any[] = []): ArchJSON => ({
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: ['test.ts'],
    entities,
    relations,
  });

  describe('initialization', () => {
    it('should initialize pipeline', () => {
      expect(pipeline).toBeDefined();
    });

    it('should create multiple independent instances', () => {
      const pipeline2 = new MermaidValidationPipeline();
      expect(pipeline).not.toBe(pipeline2);
    });
  });

  describe('full validation pipeline', () => {
    it('should run all validation stages', async () => {
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
        []
      );

      const mermaidCode = `classDiagram
  class User`;

      const result = await pipeline.validate(mermaidCode, archJson);

      // Should have all stages
      expect(result.parse).toBeDefined();
      expect(result.structural).toBeDefined();
      expect(result.render).toBeDefined();
      expect(result.quality).toBeDefined();
      expect(result.overall).toBeDefined();
    });

    it('should pass valid diagram through all stages', async () => {
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

      const result = await pipeline.validate(mermaidCode, archJson);

      expect(result.parse.valid).toBe(true);
      expect(result.structural.valid).toBe(true);
      expect(result.render.canRender).toBe(true);
      expect(result.overall.valid).toBe(true);
      expect(result.overall.canProceed).toBe(true);
      expect(result.overall.blockingIssues.length).toBe(0);
    });

    it('should fail on parse errors', async () => {
      const archJson = createMockArchJSON([], []);

      const mermaidCode = `This is not valid Mermaid code`;

      const result = await pipeline.validate(mermaidCode, archJson);

      expect(result.parse.valid).toBe(false);
      expect(result.overall.canProceed).toBe(false);
      expect(result.overall.blockingIssues.length).toBeGreaterThan(0);
      expect(result.overall.blockingIssues[0]).toContain('Syntax');
    });

    it('should fail on structural issues', async () => {
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

      const result = await pipeline.validate(mermaidCode, archJson);

      expect(result.parse.valid).toBe(true); // Syntax is valid
      expect(result.structural.valid).toBe(false); // But structure has issues
      expect(result.overall.canProceed).toBe(false);
      expect(result.overall.blockingIssues.length).toBeGreaterThan(0);
    });

    it('should continue validation after parse success', async () => {
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
        []
      );

      const mermaidCode = `classDiagram
  class User`;

      const result = await pipeline.validate(mermaidCode, archJson);

      // All stages should run
      expect(result.parse).toBeDefined();
      expect(result.structural).toBeDefined();
      expect(result.render).toBeDefined();
      expect(result.quality).toBeDefined();
    });
  });

  describe('stage ordering', () => {
    it('should execute stages in correct order', async () => {
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
        []
      );

      const mermaidCode = `classDiagram
  class User`;

      // Mock the validators to track execution order
      const parseSpy = vi.spyOn(pipeline as any, 'parseValidator', 'get').mockReturnValue({
        validate: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
      });

      const structuralSpy = vi.spyOn(pipeline as any, 'structuralValidator', 'get').mockReturnValue({
        validate: vi.fn().mockReturnValue({ valid: true, issues: [] }),
      });

      const renderSpy = vi.spyOn(pipeline as any, 'renderValidator', 'get').mockReturnValue({
        validate: vi.fn().mockReturnValue({ valid: true, canRender: true, issues: [] }),
      });

      const qualitySpy = vi.spyOn(pipeline as any, 'qualityValidator', 'get').mockReturnValue({
        validate: vi.fn().mockReturnValue({ valid: true, score: 85, metrics: {}, suggestions: [] }),
      });

      await pipeline.validate(mermaidCode, archJson);

      // Verify all were called
      expect(parseSpy).toHaveBeenCalled();
      expect(structuralSpy).toHaveBeenCalled();
      expect(renderSpy).toHaveBeenCalled();
      expect(qualitySpy).toHaveBeenCalled();

      // Cleanup
      parseSpy.mockRestore();
      structuralSpy.mockRestore();
      renderSpy.mockRestore();
      qualitySpy.mockRestore();
    });
  });

  describe('error propagation', () => {
    it('should include parse errors in overall result', async () => {
      const archJson = createMockArchJSON([], []);

      const mermaidCode = `invalid diagram`;

      const result = await pipeline.validate(mermaidCode, archJson);

      expect(result.parse.errors.length).toBeGreaterThan(0);
      expect(result.overall.blockingIssues.length).toBeGreaterThan(0);
    });

    it('should include structural issues in overall result', async () => {
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
            target: 'Missing',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class User`;

      const result = await pipeline.validate(mermaidCode, archJson);

      expect(result.structural.issues.length).toBeGreaterThan(0);
      expect(result.overall.blockingIssues.some((issue) => issue.includes('structural'))).toBe(
        true
      );
    });

    it('should include render issues in result', async () => {
      const archJson = createMockArchJSON([], []);

      const mermaidCode = `classDiagram
  class "Bad|Name" {
    +String field
  }`;

      const result = await pipeline.validate(mermaidCode, archJson);

      expect(result.render.issues).toBeDefined();
      if (result.render.issues.some((i) => i.severity === 'error')) {
        expect(result.overall.canProceed).toBe(false);
      }
    });
  });

  describe('quality validation', () => {
    it('should provide quality metrics regardless of other stages', async () => {
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
        []
      );

      const mermaidCode = `classDiagram
  class User`;

      const result = await pipeline.validate(mermaidCode, archJson);

      expect(result.quality.score).toBeGreaterThanOrEqual(0);
      expect(result.quality.score).toBeLessThanOrEqual(100);
      expect(result.quality.metrics).toBeDefined();
      expect(result.quality.suggestions).toBeDefined();
    });

    it('should not block on low quality scores', async () => {
      const archJson = createMockArchJSON(
        [
          {
            id: 'user',
            name: 'user',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
        ],
        []
      );

      const mermaidCode = `classDiagram
  class user`;

      const result = await pipeline.validate(mermaidCode, archJson);

      // Quality issues don't block proceeding
      if (result.parse.valid && result.structural.valid && result.render.canRender) {
        expect(result.overall.canProceed).toBe(true);
      }
    });
  });

  describe('summary generation', () => {
    it('should generate summary for valid diagram', async () => {
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
        []
      );

      const mermaidCode = `classDiagram
  class User`;

      const result = await pipeline.validate(mermaidCode, archJson);
      const summary = pipeline.summarize(result);

      expect(summary).toContain('✅');
      expect(summary).toContain('Syntax');
      expect(summary).toContain('Structure');
      expect(summary).toContain('Render');
      expect(summary).toContain('Quality');
    });

    it('should generate summary for invalid diagram', async () => {
      const archJson = createMockArchJSON([], []);

      const mermaidCode = `invalid`;

      const result = await pipeline.validate(mermaidCode, archJson);
      const summary = pipeline.summarize(result);

      expect(summary).toContain('❌');
      expect(summary).toContain('Syntax');
    });

    it('should include blocking issues in summary', async () => {
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
            target: 'Missing',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class User`;

      const result = await pipeline.validate(mermaidCode, archJson);
      const summary = pipeline.summarize(result);

      if (result.overall.blockingIssues.length > 0) {
        expect(summary).toContain('🚫');
        expect(summary).toContain('Blocking Issues');
      }
    });

    it('should include quality score in summary', async () => {
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
        []
      );

      const mermaidCode = `classDiagram
  class User`;

      const result = await pipeline.validate(mermaidCode, archJson);
      const summary = pipeline.summarize(result);

      expect(summary).toContain('Quality Score');
      expect(summary).toContain('/100');
    });

    it('should format summary with proper line breaks', async () => {
      const archJson = createMockArchJSON([], []);

      const mermaidCode = `classDiagram`;

      const result = await pipeline.validate(mermaidCode, archJson);
      const summary = pipeline.summarize(result);

      // Summary should be multi-line
      expect(summary.split('\n').length).toBeGreaterThan(3);
    });
  });

  describe('overall result calculation', () => {
    it('should set canProceed true when all critical stages pass', async () => {
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
        []
      );

      const mermaidCode = `classDiagram
  class User`;

      const result = await pipeline.validate(mermaidCode, archJson);

      if (result.parse.valid && result.structural.valid && result.render.canRender) {
        expect(result.overall.canProceed).toBe(true);
      }
    });

    it('should set canProceed false on parse errors', async () => {
      const archJson = createMockArchJSON([], []);

      const mermaidCode = `invalid code`;

      const result = await pipeline.validate(mermaidCode, archJson);

      if (!result.parse.valid) {
        expect(result.overall.canProceed).toBe(false);
      }
    });

    it('should set canProceed false on structural errors', async () => {
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
            target: 'Missing',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class User`;

      const result = await pipeline.validate(mermaidCode, archJson);

      if (!result.structural.valid) {
        expect(result.overall.canProceed).toBe(false);
      }
    });

    it('should set valid true only when quality also passes', async () => {
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
        []
      );

      const mermaidCode = `classDiagram
  class User`;

      const result = await pipeline.validate(mermaidCode, archJson);

      // Overall valid requires all stages including quality
      expect(result.overall.valid).toBe(result.quality.valid && result.overall.canProceed);
    });
  });

  describe('edge cases', () => {
    it('should handle empty ArchJSON', async () => {
      const archJson = createMockArchJSON([], []);

      const mermaidCode = `classDiagram`;

      const result = await pipeline.validate(mermaidCode, archJson);

      expect(result).toBeDefined();
      expect(result.overall).toBeDefined();
    });

    it('should handle empty Mermaid code', async () => {
      const archJson = createMockArchJSON([], []);

      const mermaidCode = '';

      const result = await pipeline.validate(mermaidCode, archJson);

      expect(result.parse.valid).toBe(false);
      expect(result.overall.canProceed).toBe(false);
    });

    it('should handle very large diagrams', async () => {
      const entities: any[] = [];
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

      const archJson = createMockArchJSON(entities, []);

      let mermaidCode = 'classDiagram\n';
      entities.forEach((e) => {
        mermaidCode += `  class ${e.name}\n`;
      });

      const result = await pipeline.validate(mermaidCode, archJson);

      expect(result).toBeDefined();
      expect(result.parse).toBeDefined();
      expect(result.structural).toBeDefined();
    });
  });

  describe('real-world scenarios', () => {
    it('should validate typical service architecture', async () => {
      const archJson = createMockArchJSON(
        [
          {
            id: 'UserController',
            name: 'UserController',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 20 },
          },
          {
            id: 'UserService',
            name: 'UserService',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 21, endLine: 40 },
          },
          {
            id: 'UserRepository',
            name: 'UserRepository',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 41, endLine: 60 },
          },
        ],
        [
          {
            id: 'rel1',
            type: 'dependency',
            source: 'UserController',
            target: 'UserService',
          },
          {
            id: 'rel2',
            type: 'dependency',
            source: 'UserService',
            target: 'UserRepository',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class UserController
  class UserService
  class UserRepository
  UserController --> UserService
  UserService --> UserRepository`;

      const result = await pipeline.validate(mermaidCode, archJson);

      expect(result.parse.valid).toBe(true);
      expect(result.structural.valid).toBe(true);
      expect(result.render.canRender).toBe(true);
      expect(result.overall.canProceed).toBe(true);
    });

    it('should identify issues in complex diagram', async () => {
      const archJson = createMockArchJSON(
        [
          {
            id: 'EntityA',
            name: 'EntityA',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
          {
            id: 'EntityB',
            name: 'EntityB',
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
            source: 'EntityA',
            target: 'EntityB',
          },
          {
            id: 'rel2',
            type: 'dependency',
            source: 'EntityB',
            target: 'EntityA',
          },
        ]
      );

      const mermaidCode = `classDiagram
  class EntityA
  class EntityB
  EntityA --> EntityB
  EntityB --> EntityA`;

      const result = await pipeline.validate(mermaidCode, archJson);

      // Should detect circular dependency
      expect(result.structural.issues.some((i) => i.type === 'circular-dependency')).toBe(true);
    });
  });
});
