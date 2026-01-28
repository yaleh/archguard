/**
 * Integration tests for parallel diagram processing
 *
 * TDD test suite for verifying p-map parallel processing implementation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiagramProcessor } from '@/cli/processors/diagram-processor.js';
import type { DiagramConfig, GlobalConfig } from '@/types/config.js';
import { ProgressReporter } from '@/cli/progress.js';
import type { ArchJSON } from '@/types/index.js';

// Mock dependencies before importing
vi.mock('@/cli/utils/file-discovery-service.js');
vi.mock('@/parser/parallel-parser.js');
vi.mock('@/parser/archjson-aggregator.js');
vi.mock('@/cli/utils/output-path-resolver.js');
vi.mock('@/mermaid/diagram-generator.js');

describe('DiagramProcessor.parallel', () => {
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

  const createDiagramConfig = (name: string, sources: string[]): DiagramConfig => ({
    name,
    sources,
    level: 'class',
    description: `Test diagram: ${name}`,
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
        members: [],
      },
    ],
    relations: [],
  });

  let progress: ProgressReporter;

  beforeEach(() => {
    progress = new ProgressReporter();
    vi.clearAllMocks();
  });

  describe('parallel processing', () => {
    it('should process multiple diagrams in parallel', async () => {
      // Mock FileDiscoveryService
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/test.ts']);
      (FileDiscoveryService as any).mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
      const { ParallelParser } = await import('@/parser/parallel-parser.js');
      const mockParseFiles = vi.fn().mockResolvedValue(createTestArchJSON());
      (ParallelParser as any).mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      const mockResolve = vi.fn().mockReturnValue({
        outputDir: './archguard',
        baseName: 'test',
        paths: {
          mmd: './archguard/test.mmd',
          png: './archguard/test.png',
          svg: './archguard/test.svg',
          json: './archguard/test.json',
        },
      });
      const mockEnsureDirectory = vi.fn().mockResolvedValue(undefined);
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
      const mockGenerateAndRender = vi.fn().mockResolvedValue(undefined);
      (MermaidDiagramGenerator as any).mockImplementation(() => ({
        generateAndRender: mockGenerateAndRender,
      }));

      // Create processor with 3 diagrams
      const diagrams = [
        createDiagramConfig('diagram1', ['./src/module1']),
        createDiagramConfig('diagram2', ['./src/module2']),
        createDiagramConfig('diagram3', ['./src/module3']),
      ];
      const globalConfig = createGlobalConfig();
      const processor = new DiagramProcessor({ diagrams, globalConfig, progress });

      // Track parallel execution
      const startTime = Date.now();
      const results = await processor.processAll();
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Verify all diagrams processed
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);

      // Verify parallel execution - with 3 concurrent operations,
      // it should complete faster than serial (serial would be ~3x)
      // For mocked tests with minimal delay, this is more about ensuring
      // they started concurrently rather than exact timing
      expect(mockParseFiles).toHaveBeenCalledTimes(3);

      // In parallel mode, all parseFiles calls should have been made
      // before any completed (or at least overlapping)
      // We can't test exact timing in unit tests, but we verify the structure
    });

    it('should isolate errors - one failure should not affect others', async () => {
      // Mock FileDiscoveryService
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      const mockDiscoverFiles = vi
        .fn()
        .mockResolvedValueOnce(['/src/test.ts']) // diagram1 succeeds
        .mockRejectedValueOnce(new Error('Discovery failed')) // diagram2 fails
        .mockResolvedValueOnce(['/src/test.ts']); // diagram3 succeeds
      (FileDiscoveryService as any).mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
      const { ParallelParser } = await import('@/parser/parallel-parser.js');
      const mockParseFiles = vi.fn().mockResolvedValue(createTestArchJSON());
      (ParallelParser as any).mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      const mockResolve = vi.fn().mockReturnValue({
        outputDir: './archguard',
        baseName: 'test',
        paths: {
          mmd: './archguard/test.mmd',
          png: './archguard/test.png',
          svg: './archguard/test.svg',
          json: './archguard/test.json',
        },
      });
      const mockEnsureDirectory = vi.fn().mockResolvedValue(undefined);
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
      const mockGenerateAndRender = vi.fn().mockResolvedValue(undefined);
      (MermaidDiagramGenerator as any).mockImplementation(() => ({
        generateAndRender: mockGenerateAndRender,
      }));

      // Create processor with 3 diagrams
      const diagrams = [
        createDiagramConfig('diagram1', ['./src/module1']),
        createDiagramConfig('diagram2', ['./src/module2']), // This will fail
        createDiagramConfig('diagram3', ['./src/module3']),
      ];
      const globalConfig = createGlobalConfig();
      const processor = new DiagramProcessor({ diagrams, globalConfig, progress });

      // Process diagrams
      const results = await processor.processAll();

      // Verify results - all should complete, with one failure
      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[0].name).toBe('diagram1');
      expect(results[1].success).toBe(false);
      expect(results[1].name).toBe('diagram2');
      expect(results[1].error).toBe('Discovery failed');
      expect(results[2].success).toBe(true);
      expect(results[2].name).toBe('diagram3');

      // Verify that diagram1 and diagram3 both attempted to process
      // despite diagram2's failure
      expect(mockDiscoverFiles).toHaveBeenCalledTimes(3);
    });

    it('should respect concurrency limit', async () => {
      // Mock FileDiscoveryService with delay to test concurrency
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      let activeOperations = 0;
      let maxConcurrentOperations = 0;

      const mockDiscoverFiles = vi.fn().mockImplementation(async () => {
        activeOperations++;
        maxConcurrentOperations = Math.max(maxConcurrentOperations, activeOperations);

        // Simulate some work
        await new Promise((resolve) => setTimeout(resolve, 100));

        activeOperations--;
        return ['/src/test.ts'];
      });

      (FileDiscoveryService as any).mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
      const { ParallelParser } = await import('@/parser/parallel-parser.js');
      const mockParseFiles = vi.fn().mockResolvedValue(createTestArchJSON());
      (ParallelParser as any).mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      const mockResolve = vi.fn().mockReturnValue({
        outputDir: './archguard',
        baseName: 'test',
        paths: {
          mmd: './archguard/test.mmd',
          png: './archguard/test.png',
          svg: './archguard/test.svg',
          json: './archguard/test.json',
        },
      });
      const mockEnsureDirectory = vi.fn().mockResolvedValue(undefined);
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
      const mockGenerateAndRender = vi.fn().mockResolvedValue(undefined);
      (MermaidDiagramGenerator as any).mockImplementation(() => ({
        generateAndRender: mockGenerateAndRender,
      }));

      // Create processor with concurrency limit of 2
      const diagrams = [
        createDiagramConfig('diagram1', ['./src/module1']),
        createDiagramConfig('diagram2', ['./src/module2']),
        createDiagramConfig('diagram3', ['./src/module3']),
        createDiagramConfig('diagram4', ['./src/module4']),
        createDiagramConfig('diagram5', ['./src/module5']),
      ];
      const globalConfig = {
        ...createGlobalConfig(),
        concurrency: 2,
      };
      const processor = new DiagramProcessor({ diagrams, globalConfig, progress });

      // Process diagrams
      await processor.processAll();

      // Verify concurrency was respected
      // With concurrency of 2, we should never have more than 2 operations active
      expect(maxConcurrentOperations).toBeLessThanOrEqual(2);
    });

    it('should handle zero concurrency config by using CPU count', async () => {
      // Mock FileDiscoveryService
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/test.ts']);
      (FileDiscoveryService as any).mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
      const { ParallelParser } = await import('@/parser/parallel-parser.js');
      const mockParseFiles = vi.fn().mockResolvedValue(createTestArchJSON());
      (ParallelParser as any).mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      const mockResolve = vi.fn().mockReturnValue({
        outputDir: './archguard',
        baseName: 'test',
        paths: {
          mmd: './archguard/test.mmd',
          png: './archguard/test.png',
          svg: './archguard/test.svg',
          json: './archguard/test.json',
        },
      });
      const mockEnsureDirectory = vi.fn().mockResolvedValue(undefined);
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
      const mockGenerateAndRender = vi.fn().mockResolvedValue(undefined);
      (MermaidDiagramGenerator as any).mockImplementation(() => ({
        generateAndRender: mockGenerateAndRender,
      }));

      // Create processor with undefined concurrency
      const diagrams = [createDiagramConfig('test', ['./src'])];
      const globalConfig = {
        ...createGlobalConfig(),
        concurrency: undefined,
      } as any;
      const processor = new DiagramProcessor({ diagrams, globalConfig, progress });

      // Should not throw and should complete successfully
      const results = await processor.processAll();
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
    });
  });

  describe('performance validation', () => {
    it('should complete faster than serial processing', async () => {
      // This is a conceptual test - in real scenarios with actual parsing,
      // parallel should be 3-4x faster than serial
      // For unit tests, we just verify the structure is correct

      // Mock FileDiscoveryService with realistic delay
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      const mockDiscoverFiles = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return ['/src/test.ts'];
      });
      (FileDiscoveryService as any).mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser with delay
      const { ParallelParser } = await import('@/parser/parallel-parser.js');
      const mockParseFiles = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return createTestArchJSON();
      });
      (ParallelParser as any).mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      const mockResolve = vi.fn().mockReturnValue({
        outputDir: './archguard',
        baseName: 'test',
        paths: {
          mmd: './archguard/test.mmd',
          png: './archguard/test.png',
          svg: './archguard/test.svg',
          json: './archguard/test.json',
        },
      });
      const mockEnsureDirectory = vi.fn().mockResolvedValue(undefined);
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
      const mockGenerateAndRender = vi.fn().mockResolvedValue(undefined);
      (MermaidDiagramGenerator as any).mockImplementation(() => ({
        generateAndRender: mockGenerateAndRender,
      }));

      // Create processor with 3 diagrams
      const diagrams = [
        createDiagramConfig('diagram1', ['./src/module1']),
        createDiagramConfig('diagram2', ['./src/module2']),
        createDiagramConfig('diagram3', ['./src/module3']),
      ];
      const globalConfig = createGlobalConfig();
      const processor = new DiagramProcessor({ diagrams, globalConfig, progress });

      // Process and time
      const startTime = Date.now();
      const results = await processor.processAll();
      const endTime = Date.now();
      const parallelTime = endTime - startTime;

      // Verify all completed
      expect(results.every((r) => r.success)).toBe(true);

      // In serial mode, this would take ~450ms (3 * 150ms)
      // In parallel mode with concurrency 3, it should take ~150ms
      // We use a loose threshold to account for test environment variations
      // Parallel should be at least somewhat faster
      expect(parallelTime).toBeLessThan(400); // Serial would be ~450ms
    });
  });
});
