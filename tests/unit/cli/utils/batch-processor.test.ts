/**
 * BatchProcessor Unit Tests
 * Following TDD methodology - Test-first approach
 *
 * Note: Uses type assertions to test private methods.
 * This is acceptable for unit testing private implementation details.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BatchProcessor } from '@/cli/utils/batch-processor.js';
import type { Config } from '@/cli/config-loader.js';
import type { ParallelParser } from '@/parser/parallel-parser.js';
import type { PlantUMLGenerator } from '@/ai/plantuml-generator.js';
import type { ProgressReporter } from '@/cli/progress.js';
import type { ArchJSON } from '@/types';

describe('BatchProcessor', () => {
  let mockConfig: Config;
  let mockParser: ParallelParser;
  let mockGenerator: PlantUMLGenerator;
  let mockProgress: ProgressReporter;

  beforeEach(() => {
    // Setup mock config
    mockConfig = {
      source: './src',
      outputDir: './archguard',
      format: 'plantuml',
      exclude: ['**/*.test.ts', '**/*.spec.ts'],
      cli: {
        command: 'claude',
        args: [],
        timeout: 60000,
      },
      cache: {
        enabled: true,
        ttl: 86400,
      },
    } as Config;

    // Mock ParallelParser
    mockParser = {
      parseFiles: vi.fn().mockResolvedValue({
        version: '1.0',
        language: 'typescript',
        timestamp: new Date().toISOString(),
        sourceFiles: ['test.ts'],
        entities: [
          {
            name: 'TestClass',
            type: 'class',
            filePath: 'test.ts',
            decorators: [],
            methods: [],
            properties: [],
          },
        ],
        relations: [],
      } as ArchJSON),
    } as unknown as ParallelParser;

    // Mock PlantUMLGenerator
    mockGenerator = {
      generateAndRender: vi.fn().mockResolvedValue(undefined),
    } as unknown as PlantUMLGenerator;

    // Mock ProgressReporter
    mockProgress = {
      start: vi.fn(),
      update: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      warn: vi.fn(),
    } as unknown as ProgressReporter;
  });

  describe('inferModuleName', () => {
    it('should infer module name from packages structure', () => {
      const processor = new BatchProcessor({
        sources: ['./packages/frontend/src'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      // Access private method via type assertion for testing
      const result = (processor as any).inferModuleName('./packages/frontend/src');
      expect(result).toBe('frontend');
    });

    it('should infer module name from services structure', () => {
      const processor = new BatchProcessor({
        sources: ['./services/auth-service'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const result = (processor as any).inferModuleName('./services/auth-service');
      expect(result).toBe('auth-service');
    });

    it('should handle src directory', () => {
      const processor = new BatchProcessor({
        sources: ['./src'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const result = (processor as any).inferModuleName('./src');
      expect(result).toBe('src');
    });

    it('should handle apps structure', () => {
      const processor = new BatchProcessor({
        sources: ['./apps/web/src'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const result = (processor as any).inferModuleName('./apps/web/src');
      expect(result).toBe('web');
    });

    it('should use fallback for empty path', () => {
      const processor = new BatchProcessor({
        sources: ['.'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const result = (processor as any).inferModuleName('.');
      expect(result).toBe('module');
    });

    it('should filter out dist directories', () => {
      const processor = new BatchProcessor({
        sources: ['./packages/core/dist'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const result = (processor as any).inferModuleName('./packages/core/dist');
      expect(result).toBe('core');
    });
  });

  describe('buildExcludePatterns', () => {
    it('should build exclude patterns from config', () => {
      const processor = new BatchProcessor({
        sources: ['./src'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const result = (processor as any).buildExcludePatterns();
      expect(result).toEqual(['**/*.test.ts', '**/*.spec.ts']);
    });

    it('should handle empty exclude config', () => {
      const configWithoutExclude = { ...mockConfig, exclude: [] };
      const processor = new BatchProcessor({
        sources: ['./src'],
        config: configWithoutExclude,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const result = (processor as any).buildExcludePatterns();
      expect(result).toEqual([]);
    });
  });

  describe('processModule', () => {
    it('should process a single module successfully', async () => {
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      const mockDiscoverFiles = vi.fn().mockResolvedValue(['./src/test.ts']);

      // Mock FileDiscoveryService
      vi.spyOn(FileDiscoveryService.prototype, 'discoverFiles').mockImplementation(
        mockDiscoverFiles
      );

      const processor = new BatchProcessor({
        sources: ['./src'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const result = await (processor as any).processModule('./src', 'src');

      expect(result.moduleName).toBe('src');
      expect(result.sourcePath).toBe('./src');
      expect(result.entities).toBe(1);
      expect(result.relations).toBe(0);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.outputPath).toContain('modules/src');
    });

    it('should handle module processing errors gracefully', async () => {
      const errorMessage = 'File discovery failed';
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      vi.spyOn(FileDiscoveryService.prototype, 'discoverFiles').mockRejectedValue(
        new Error(errorMessage)
      );

      const processor = new BatchProcessor({
        sources: ['./invalid'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const result = await (processor as any).processModule('./invalid', 'invalid');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toBe(errorMessage);
    });

    it('should report progress during processing', async () => {
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      vi.spyOn(FileDiscoveryService.prototype, 'discoverFiles').mockResolvedValue([
        './src/test.ts',
      ]);

      const processor = new BatchProcessor({
        sources: ['./src'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      await (processor as any).processModule('./src', 'src');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockProgress.start).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockProgress.succeed).toHaveBeenCalled();
    });
  });

  describe('processBatch', () => {
    it('should process multiple modules', async () => {
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      const mockDiscoverFiles = vi.fn().mockResolvedValue(['./test.ts']);
      vi.spyOn(FileDiscoveryService.prototype, 'discoverFiles').mockImplementation(
        mockDiscoverFiles
      );

      const processor = new BatchProcessor({
        sources: ['./packages/frontend/src', './packages/backend/src'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const results = await processor.processBatch();

      expect(results).toHaveLength(2);
      expect(results[0].moduleName).toBe('frontend');
      expect(results[1].moduleName).toBe('backend');
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });

    it('should continue processing if one module fails', async () => {
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      const mockDiscoverFiles = vi
        .fn()
        .mockResolvedValueOnce(['./test.ts']) // First module succeeds
        .mockRejectedValueOnce(new Error('Module 2 failed')) // Second module fails
        .mockResolvedValueOnce(['./test.ts']); // Third module succeeds

      vi.spyOn(FileDiscoveryService.prototype, 'discoverFiles').mockImplementation(
        mockDiscoverFiles
      );

      const processor = new BatchProcessor({
        sources: ['./module1', './module2', './module3'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const results = await processor.processBatch();

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });

    it('should generate index if generateIndex option is enabled', async () => {
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      vi.spyOn(FileDiscoveryService.prototype, 'discoverFiles').mockResolvedValue(['./test.ts']);

      const processor = new BatchProcessor({
        sources: ['./src'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
        generateIndex: true,
      });

      // Spy on generateIndex method
      const generateIndexSpy = vi.spyOn(processor as any, 'generateIndex');

      await processor.processBatch();

      expect(generateIndexSpy).toHaveBeenCalled();
    });

    it('should not generate index if generateIndex option is disabled', async () => {
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      vi.spyOn(FileDiscoveryService.prototype, 'discoverFiles').mockResolvedValue(['./test.ts']);

      const processor = new BatchProcessor({
        sources: ['./src'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
        generateIndex: false,
      });

      const generateIndexSpy = vi.spyOn(processor as any, 'generateIndex');

      await processor.processBatch();

      expect(generateIndexSpy).not.toHaveBeenCalled();
    });

    it('should handle empty sources array', async () => {
      const processor = new BatchProcessor({
        sources: [],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const results = await processor.processBatch();

      expect(results).toHaveLength(0);
    });
  });

  describe('generateIndex', () => {
    it('should handle index generation', async () => {
      const processor = new BatchProcessor({
        sources: ['./src'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const mockResults = [
        {
          moduleName: 'frontend',
          sourcePath: './packages/frontend/src',
          entities: 10,
          relations: 5,
          outputPath: './archguard/modules/frontend.puml',
          success: true,
        },
      ];

      // This should not throw
      await expect((processor as any).generateIndex(mockResults)).resolves.not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle absolute paths in module name inference', () => {
      const processor = new BatchProcessor({
        sources: ['/home/user/projects/frontend/src'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const result = (processor as any).inferModuleName('/home/user/projects/frontend/src');
      expect(result).toBe('frontend');
    });

    it('should handle Windows-style paths', () => {
      const processor = new BatchProcessor({
        sources: ['C:\\projects\\frontend\\src'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const result = (processor as any).inferModuleName('C:\\projects\\frontend\\src');
      expect(result).toBe('frontend');
    });

    it('should handle paths with dist directory', () => {
      const processor = new BatchProcessor({
        sources: ['./packages/core/dist'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const result = (processor as any).inferModuleName('./packages/core/dist');
      expect(result).toBe('core');
    });

    it('should handle deeply nested paths', () => {
      const processor = new BatchProcessor({
        sources: ['./apps/web/packages/core/src'],
        config: mockConfig,
        parser: mockParser,
        generator: mockGenerator,
        progress: mockProgress,
      });

      const result = (processor as any).inferModuleName('./apps/web/packages/core/src');
      expect(result).toBe('core');
    });
  });
});
