/**
 * Integration tests for render stage separation
 *
 * TDD test suite for verifying two-stage rendering:
 * Stage 1: Generate Mermaid code (CPU intensive)
 * Stage 2: Batch parallel render (I/O intensive)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MermaidDiagramGenerator } from '@/mermaid/diagram-generator.js';
import { HeuristicGrouper } from '@/mermaid/grouper.js';
import { ValidatedMermaidGenerator } from '@/mermaid/generator.js';
import { MermaidValidationPipeline } from '@/mermaid/validation-pipeline.js';
import { IsomorphicMermaidRenderer } from '@/mermaid/renderer.js';
import type { GlobalConfig, DiagramConfig, DetailLevel } from '@/types/config.js';
import type { ArchJSON } from '@/types/index.js';
import type { RenderJob } from '@/mermaid/diagram-generator.js';

describe('Render Stage Separation', () => {
  const createGlobalConfig = (): GlobalConfig => ({
    outputDir: './archguard',
    format: 'mermaid',
    exclude: ['**/*.test.ts'],
    cli: {
      command: 'claude',
      args: [],
      timeout: 180000,
    },
    cache: {
      enabled: true,
      ttl: 3600,
    },
    concurrency: 4,
    verbose: false,
  });

  const createTestArchJSON = (): ArchJSON => ({
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: ['test.ts'],
    entities: [
      {
        id: 'TestClass',
        name: 'TestClass',
        type: 'class',
        visibility: 'public',
        sourceLocation: {
          file: 'test.ts',
          startLine: 1,
          endLine: 10,
        },
        members: [
          {
            name: 'testMethod',
            kind: 'method',
            visibility: 'public',
            static: false,
            abstract: false,
            sourceLocation: {
              file: 'test.ts',
              startLine: 5,
              endLine: 7,
            },
          },
        ],
      },
    ],
    relations: [],
  });

  const createOutputOptions = (baseName: string = 'test') => ({
    outputDir: './archguard',
    baseName,
    paths: {
      mmd: `./archguard/${baseName}.mmd`,
      svg: `./archguard/${baseName}.svg`,
      png: `./archguard/${baseName}.png`,
    },
  });

  describe('Stage 1: generateOnly', () => {
    it('should generate Mermaid code without rendering', async () => {
      const globalConfig = createGlobalConfig();
      const generator = new MermaidDiagramGenerator(globalConfig);
      const archJson = createTestArchJSON();
      const outputOptions = createOutputOptions('test-diagram');

      // Mock HeuristicGrouper
      const mockGrouping = {
        packages: [
          {
            name: 'default',
            entities: ['TestClass'],
            reasoning: 'Test grouping',
          },
        ],
        layout: {
          direction: 'TB' as const,
          reasoning: 'Test layout',
        },
      };

      vi.spyOn(HeuristicGrouper.prototype, 'group').mockReturnValue(mockGrouping);

      // Mock ValidatedMermaidGenerator.generate
      const mockMermaidCode = 'classDiagram\n  class TestClass {\n    +testMethod()\n  }\n';
      vi.spyOn(ValidatedMermaidGenerator.prototype, 'generate').mockReturnValue(mockMermaidCode);

      // Mock MermaidValidationPipeline.validateFull
      const mockValidationReport = {
        overallValid: true,
        stages: [
          {
            name: 'parse',
            result: {
              valid: true,
              errors: [],
              warnings: [],
            },
          },
        ],
      };
      vi.spyOn(MermaidValidationPipeline.prototype, 'validateFull').mockResolvedValue(
        mockValidationReport
      );

      // Generate Mermaid code only (no rendering)
      const renderJobs = await generator.generateOnly(archJson, outputOptions, 'class');

      // Verify render job structure
      expect(renderJobs).toHaveLength(1);
      expect(renderJobs[0]).toEqual({
        name: 'test-diagram',
        mermaidCode: mockMermaidCode,
        outputPath: outputOptions.paths,
      });
    });

    it('should support multiple diagrams with different configurations', async () => {
      const globalConfig = createGlobalConfig();
      const generator = new MermaidDiagramGenerator(globalConfig);
      const archJson = createTestArchJSON();

      // Mock HeuristicGrouper
      const mockGrouping = {
        packages: [
          {
            name: 'default',
            entities: ['TestClass'],
            reasoning: 'Test grouping',
          },
        ],
        layout: {
          direction: 'TB' as const,
          reasoning: 'Test layout',
        },
      };

      vi.spyOn(HeuristicGrouper.prototype, 'group').mockReturnValue(mockGrouping);

      // Mock ValidatedMermaidGenerator.generate
      const mockMermaidCode = 'classDiagram\n  class TestClass\n';
      vi.spyOn(ValidatedMermaidGenerator.prototype, 'generate').mockReturnValue(mockMermaidCode);

      // Mock MermaidValidationPipeline.validateFull
      const mockValidationReport = {
        overallValid: true,
        stages: [
          {
            name: 'parse',
            result: {
              valid: true,
              errors: [],
              warnings: [],
            },
          },
        ],
      };
      vi.spyOn(MermaidValidationPipeline.prototype, 'validateFull').mockResolvedValue(
        mockValidationReport
      );

      // Generate multiple diagrams
      const outputOptions1 = createOutputOptions('diagram1');
      const outputOptions2 = createOutputOptions('diagram2');

      const jobs1 = await generator.generateOnly(archJson, outputOptions1, 'class');
      const jobs2 = await generator.generateOnly(archJson, outputOptions2, 'class');

      // Verify both jobs created correctly
      expect(jobs1).toHaveLength(1);
      expect(jobs2).toHaveLength(1);
      expect(jobs1[0].name).toBe('diagram1');
      expect(jobs2[0].name).toBe('diagram2');
      expect(jobs1[0].outputPath.mmd).toContain('diagram1.mmd');
      expect(jobs2[0].outputPath.mmd).toContain('diagram2.mmd');
    });

    it('should include validation in generation stage', async () => {
      const globalConfig = createGlobalConfig();
      const generator = new MermaidDiagramGenerator(globalConfig);
      const archJson = createTestArchJSON();
      const outputOptions = createOutputOptions('test');

      // Mock HeuristicGrouper
      const mockGrouping = {
        packages: [
          {
            name: 'default',
            entities: ['TestClass'],
            reasoning: 'Test grouping',
          },
        ],
        layout: {
          direction: 'TB' as const,
          reasoning: 'Test layout',
        },
      };

      vi.spyOn(HeuristicGrouper.prototype, 'group').mockReturnValue(mockGrouping);

      // Mock ValidatedMermaidGenerator.generate
      const mockMermaidCode = 'classDiagram\n  class TestClass\n';
      vi.spyOn(ValidatedMermaidGenerator.prototype, 'generate').mockReturnValue(mockMermaidCode);

      // Mock MermaidValidationPipeline.validateFull - mark as invalid
      const mockValidationReport = {
        overallValid: false,
        stages: [
          {
            name: 'parse',
            result: {
              valid: false,
              errors: [
                {
                  message: 'Syntax error',
                  line: 1,
                  column: 1,
                },
              ],
              warnings: [],
            },
          },
        ],
      };
      vi.spyOn(MermaidValidationPipeline.prototype, 'validateFull').mockResolvedValue(
        mockValidationReport
      );

      // Should throw validation error
      await expect(generator.generateOnly(archJson, outputOptions, 'class')).rejects.toThrow();
    });
  });

  describe('Stage 2: renderJobsInParallel', () => {
    it('should render all render jobs in parallel', async () => {
      const renderJobs: RenderJob[] = [
        {
          name: 'diagram1',
          mermaidCode: 'classDiagram\n  class TestClass1\n',
          outputPath: {
            mmd: './archguard/diagram1.mmd',
            svg: './archguard/diagram1.svg',
            png: './archguard/diagram1.png',
          },
        },
        {
          name: 'diagram2',
          mermaidCode: 'classDiagram\n  class TestClass2\n',
          outputPath: {
            mmd: './archguard/diagram2.mmd',
            svg: './archguard/diagram2.svg',
            png: './archguard/diagram2.png',
          },
        },
        {
          name: 'diagram3',
          mermaidCode: 'classDiagram\n  class TestClass3\n',
          outputPath: {
            mmd: './archguard/diagram3.mmd',
            svg: './archguard/diagram3.svg',
            png: './archguard/diagram3.png',
          },
        },
      ];

      // Mock IsomorphicMermaidRenderer.renderAndSave
      const mockRenderAndSave = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(IsomorphicMermaidRenderer.prototype, 'renderAndSave').mockImplementation(
        mockRenderAndSave
      );

      // Render all jobs in parallel with concurrency of 2
      await MermaidDiagramGenerator.renderJobsInParallel(renderJobs, 2);

      // Verify all jobs were rendered
      expect(mockRenderAndSave).toHaveBeenCalledTimes(3);
      expect(mockRenderAndSave).toHaveBeenCalledWith(
        renderJobs[0].mermaidCode,
        renderJobs[0].outputPath
      );
      expect(mockRenderAndSave).toHaveBeenCalledWith(
        renderJobs[1].mermaidCode,
        renderJobs[1].outputPath
      );
      expect(mockRenderAndSave).toHaveBeenCalledWith(
        renderJobs[2].mermaidCode,
        renderJobs[2].outputPath
      );
    });

    it('should respect concurrency limit during rendering', async () => {
      const renderJobs: RenderJob[] = [
        {
          name: 'diagram1',
          mermaidCode: 'classDiagram\n  class TestClass1\n',
          outputPath: {
            mmd: './archguard/diagram1.mmd',
            svg: './archguard/diagram1.svg',
            png: './archguard/diagram1.png',
          },
        },
        {
          name: 'diagram2',
          mermaidCode: 'classDiagram\n  class TestClass2\n',
          outputPath: {
            mmd: './archguard/diagram2.mmd',
            svg: './archguard/diagram2.svg',
            png: './archguard/diagram2.png',
          },
        },
        {
          name: 'diagram3',
          mermaidCode: 'classDiagram\n  class TestClass3\n',
          outputPath: {
            mmd: './archguard/diagram3.mmd',
            svg: './archguard/diagram3.svg',
            png: './archguard/diagram3.png',
          },
        },
        {
          name: 'diagram4',
          mermaidCode: 'classDiagram\n  class TestClass4\n',
          outputPath: {
            mmd: './archguard/diagram4.mmd',
            svg: './archguard/diagram4.svg',
            png: './archguard/diagram4.png',
          },
        },
      ];

      let activeOperations = 0;
      let maxConcurrentOperations = 0;

      // Mock IsomorphicMermaidRenderer.renderAndSave with concurrency tracking
      vi.spyOn(IsomorphicMermaidRenderer.prototype, 'renderAndSave').mockImplementation(
        async () => {
          activeOperations++;
          maxConcurrentOperations = Math.max(maxConcurrentOperations, activeOperations);

          // Simulate some rendering work
          await new Promise((resolve) => setTimeout(resolve, 50));

          activeOperations--;
        }
      );

      // Render with concurrency limit of 2
      await MermaidDiagramGenerator.renderJobsInParallel(renderJobs, 2);

      // Verify concurrency was respected (should not exceed 2)
      expect(maxConcurrentOperations).toBeLessThanOrEqual(2);
    });

    it('should handle rendering errors gracefully', async () => {
      const renderJobs: RenderJob[] = [
        {
          name: 'diagram1',
          mermaidCode: 'classDiagram\n  class TestClass1\n',
          outputPath: {
            mmd: './archguard/diagram1.mmd',
            svg: './archguard/diagram1.svg',
            png: './archguard/diagram1.png',
          },
        },
        {
          name: 'diagram2',
          mermaidCode: 'classDiagram\n  class TestClass2\n',
          outputPath: {
            mmd: './archguard/diagram2.mmd',
            svg: './archguard/diagram2.svg',
            png: './archguard/diagram2.png',
          },
        },
        {
          name: 'diagram3',
          mermaidCode: 'classDiagram\n  class TestClass3\n',
          outputPath: {
            mmd: './archguard/diagram3.mmd',
            svg: './archguard/diagram3.svg',
            png: './archguard/diagram3.png',
          },
        },
      ];

      // Mock IsomorphicMermaidRenderer.renderAndSave - diagram2 fails
      const mockRenderAndSave = vi.fn().mockImplementation(async (code: string, paths: any) => {
        if (paths.mmd.includes('diagram2')) {
          throw new Error('Rendering failed for diagram2');
        }
      });

      vi.spyOn(IsomorphicMermaidRenderer.prototype, 'renderAndSave').mockImplementation(
        mockRenderAndSave
      );

      // Should throw error (first failure)
      await expect(MermaidDiagramGenerator.renderJobsInParallel(renderJobs, 2)).rejects.toThrow(
        'Rendering failed for diagram2'
      );
    });
  });

  describe('Integration: Full Two-Stage Flow', () => {
    it('should complete two-stage flow for multiple diagrams', async () => {
      const globalConfig = createGlobalConfig();
      const generator = new MermaidDiagramGenerator(globalConfig);
      const archJson = createTestArchJSON();

      // Mock HeuristicGrouper
      const mockGrouping = {
        packages: [
          {
            name: 'default',
            entities: ['TestClass'],
            reasoning: 'Test grouping',
          },
        ],
        layout: {
          direction: 'TB' as const,
          reasoning: 'Test layout',
        },
      };

      vi.spyOn(HeuristicGrouper.prototype, 'group').mockReturnValue(mockGrouping);

      // Mock ValidatedMermaidGenerator.generate
      const mockMermaidCode = 'classDiagram\n  class TestClass\n';
      vi.spyOn(ValidatedMermaidGenerator.prototype, 'generate').mockReturnValue(mockMermaidCode);

      // Mock MermaidValidationPipeline.validateFull
      const mockValidationReport = {
        overallValid: true,
        stages: [
          {
            name: 'parse',
            result: {
              valid: true,
              errors: [],
              warnings: [],
            },
          },
        ],
      };
      vi.spyOn(MermaidValidationPipeline.prototype, 'validateFull').mockResolvedValue(
        mockValidationReport
      );

      // Mock IsomorphicMermaidRenderer.renderAndSave
      const mockRenderAndSave = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(IsomorphicMermaidRenderer.prototype, 'renderAndSave').mockImplementation(
        mockRenderAndSave
      );

      // Stage 1: Generate Mermaid code for all diagrams
      const outputOptions1 = createOutputOptions('diagram1');
      const outputOptions2 = createOutputOptions('diagram2');

      const jobs1 = await generator.generateOnly(archJson, outputOptions1, 'class');
      const jobs2 = await generator.generateOnly(archJson, outputOptions2, 'class');

      const allRenderJobs = [...jobs1, ...jobs2];

      // Verify stage 1 completed
      expect(allRenderJobs).toHaveLength(2);
      expect(allRenderJobs.every((job) => job.mermaidCode)).toBe(true);

      // Stage 2: Render all jobs in parallel
      await MermaidDiagramGenerator.renderJobsInParallel(allRenderJobs, 4);

      // Verify stage 2 completed
      expect(mockRenderAndSave).toHaveBeenCalledTimes(2);
    });
  });
});
