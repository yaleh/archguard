import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IndexGenerator } from '@/cli/utils/index-generator.js';
import type { Config } from '@/cli/types.js';
import type { BatchResult } from '@/cli/utils/batch-processor.js';
import * as path from 'path';

// Mock fs-extra
vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn(),
    writeFile: vi.fn(),
  },
  ensureDir: vi.fn(),
  writeFile: vi.fn(),
}));

import fs from 'fs-extra';

describe('IndexGenerator', () => {
  let config: Config;
  let generator: IndexGenerator;

  beforeEach(() => {
    config = {
      source: './src',
      output: './architecture.puml',
      format: 'plantuml' as const,
      outputDir: '/tmp/archguard-test',
      exclude: [],
    };
    generator = new IndexGenerator(config);
    vi.clearAllMocks();
  });

  describe('generate', () => {
    it('should generate index.md file', async () => {
      const results: BatchResult[] = [
        {
          moduleName: 'frontend',
          sourcePath: './packages/frontend/src',
          success: true,
          outputPath: '/tmp/archguard-test/modules/frontend.puml',
          pngPath: '/tmp/archguard-test/modules/frontend.png',
          entities: 42,
          relations: 30,
        },
      ];

      vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await generator.generate(results);

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(config.outputDir!, 'index.md'),
        expect.stringContaining('# Architecture Diagrams Index'),
        'utf-8'
      );
    });

    it('should include timestamp in ISO 8601 format', async () => {
      const results: BatchResult[] = [
        {
          moduleName: 'test',
          sourcePath: './src',
          success: true,
          outputPath: '/tmp/archguard-test/modules/test.puml',
          entities: 10,
          relations: 5,
        },
      ];

      vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await generator.generate(results);

      const content = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(content).toMatch(/\*\*Generated\*\*: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    });

    it('should include total modules count', async () => {
      const results: BatchResult[] = [
        {
          moduleName: 'module1',
          sourcePath: './src/module1',
          success: true,
          outputPath: '/tmp/archguard-test/modules/module1.puml',
          entities: 10,
          relations: 5,
        },
        {
          moduleName: 'module2',
          sourcePath: './src/module2',
          success: true,
          outputPath: '/tmp/archguard-test/modules/module2.puml',
          entities: 20,
          relations: 15,
        },
        {
          moduleName: 'module3',
          sourcePath: './src/module3',
          success: false,
          error: 'No TypeScript files found',
        },
      ];

      vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await generator.generate(results);

      const content = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(content).toContain('**Total Modules**: 3 (2 successful, 1 failed)');
    });

    it('should include module details', async () => {
      const results: BatchResult[] = [
        {
          moduleName: 'frontend',
          sourcePath: './packages/frontend/src',
          success: true,
          outputPath: '/tmp/archguard-test/modules/frontend.puml',
          pngPath: '/tmp/archguard-test/modules/frontend.png',
          entities: 42,
          relations: 30,
        },
      ];

      vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await generator.generate(results);

      const content = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(content).toContain('### frontend');
      expect(content).toContain('**Source**: `./packages/frontend/src`');
      expect(content).toContain('**Entities**: 42');
      expect(content).toContain('**Relations**: 30');
      expect(content).toContain('**Complexity**: High');
    });

    it('should use relative paths for diagrams', async () => {
      const results: BatchResult[] = [
        {
          moduleName: 'frontend',
          sourcePath: './packages/frontend/src',
          success: true,
          outputPath: '/tmp/archguard-test/modules/frontend.puml',
          pngPath: '/tmp/archguard-test/modules/frontend.png',
          entities: 10,
          relations: 5,
        },
      ];

      vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await generator.generate(results);

      const content = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(content).toContain('[View PNG](modules/frontend.png)');
      expect(content).toContain('![frontend](modules/frontend.png)');
      expect(content).not.toContain('/tmp/archguard-test');
    });

    it('should include summary statistics', async () => {
      const results: BatchResult[] = [
        {
          moduleName: 'module1',
          sourcePath: './src/module1',
          success: true,
          outputPath: '/tmp/archguard-test/modules/module1.puml',
          entities: 30,
          relations: 20,
        },
        {
          moduleName: 'module2',
          sourcePath: './src/module2',
          success: true,
          outputPath: '/tmp/archguard-test/modules/module2.puml',
          entities: 50,
          relations: 30,
        },
      ];

      vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await generator.generate(results);

      const content = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(content).toContain('## Summary Statistics');
      expect(content).toContain('**Total Modules**: 2');
      expect(content).toContain('**Successful**: 2');
      expect(content).toContain('**Failed**: 0');
      expect(content).toContain('**Total Entities**: 80');
      expect(content).toContain('**Total Relations**: 50');
      expect(content).toContain('**Average Entities per Module**: 40.0');
      expect(content).toContain('**Average Relations per Module**: 25.0');
    });

    it('should include failed modules section', async () => {
      const results: BatchResult[] = [
        {
          moduleName: 'valid-module',
          sourcePath: './src/valid',
          success: true,
          outputPath: '/tmp/archguard-test/modules/valid-module.puml',
          entities: 10,
          relations: 5,
        },
        {
          moduleName: 'invalid-module',
          sourcePath: './packages/invalid',
          success: false,
          error: 'No TypeScript files found',
        },
      ];

      vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await generator.generate(results);

      const content = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(content).toContain('## Failed Modules');
      expect(content).toContain('### invalid-module');
      expect(content).toContain('**Source**: `./packages/invalid`');
      expect(content).toContain('**Error**: No TypeScript files found');
    });

    it('should not include failed modules section when all successful', async () => {
      const results: BatchResult[] = [
        {
          moduleName: 'module1',
          sourcePath: './src/module1',
          success: true,
          outputPath: '/tmp/archguard-test/modules/module1.puml',
          entities: 10,
          relations: 5,
        },
      ];

      vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await generator.generate(results);

      const content = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(content).not.toContain('## Failed Modules');
    });
  });

  describe('calculateComplexity', () => {
    it('should return "Low" for score < 20', () => {
      const result: BatchResult = {
        moduleName: 'test',
        sourcePath: './src',
        success: true,
        outputPath: '/tmp/test.puml',
        entities: 10,
        relations: 5,
      };

      // score = 10 + 5 * 0.5 = 12.5
      const complexity = (generator as any).calculateComplexity(result);
      expect(complexity).toBe('Low');
    });

    it('should return "Medium" for score >= 20 and < 50', () => {
      const result: BatchResult = {
        moduleName: 'test',
        sourcePath: './src',
        success: true,
        outputPath: '/tmp/test.puml',
        entities: 30,
        relations: 20,
      };

      // score = 30 + 20 * 0.5 = 40
      const complexity = (generator as any).calculateComplexity(result);
      expect(complexity).toBe('Medium');
    });

    it('should return "High" for score >= 50 and < 100', () => {
      const result: BatchResult = {
        moduleName: 'test',
        sourcePath: './src',
        success: true,
        outputPath: '/tmp/test.puml',
        entities: 60,
        relations: 40,
      };

      // score = 60 + 40 * 0.5 = 80
      const complexity = (generator as any).calculateComplexity(result);
      expect(complexity).toBe('High');
    });

    it('should return "Very High" for score >= 100', () => {
      const result: BatchResult = {
        moduleName: 'test',
        sourcePath: './src',
        success: true,
        outputPath: '/tmp/test.puml',
        entities: 100,
        relations: 80,
      };

      // score = 100 + 80 * 0.5 = 140
      const complexity = (generator as any).calculateComplexity(result);
      expect(complexity).toBe('Very High');
    });

    it('should handle missing entities/relations', () => {
      const result: BatchResult = {
        moduleName: 'test',
        sourcePath: './src',
        success: true,
        outputPath: '/tmp/test.puml',
      };

      const complexity = (generator as any).calculateComplexity(result);
      expect(complexity).toBe('Low');
    });
  });

  describe('generateInsights', () => {
    it('should identify most complex module', async () => {
      const results: BatchResult[] = [
        {
          moduleName: 'backend',
          sourcePath: './src/backend',
          success: true,
          outputPath: '/tmp/backend.puml',
          entities: 60,
          relations: 45,
        },
        {
          moduleName: 'frontend',
          sourcePath: './src/frontend',
          success: true,
          outputPath: '/tmp/frontend.puml',
          entities: 30,
          relations: 20,
        },
      ];

      vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await generator.generate(results);

      const content = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(content).toContain('## Insights');
      expect(content).toContain('**Most Complex Module**: backend (60 entities, 45 relations)');
    });

    it('should identify least complex module', async () => {
      const results: BatchResult[] = [
        {
          moduleName: 'utils',
          sourcePath: './src/utils',
          success: true,
          outputPath: '/tmp/utils.puml',
          entities: 10,
          relations: 5,
        },
        {
          moduleName: 'backend',
          sourcePath: './src/backend',
          success: true,
          outputPath: '/tmp/backend.puml',
          entities: 60,
          relations: 45,
        },
      ];

      vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await generator.generate(results);

      const content = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(content).toContain('**Least Complex Module**: utils (10 entities, 5 relations)');
    });

    it('should calculate average complexity', async () => {
      const results: BatchResult[] = [
        {
          moduleName: 'module1',
          sourcePath: './src/module1',
          success: true,
          outputPath: '/tmp/module1.puml',
          entities: 30,
          relations: 20,
        },
        {
          moduleName: 'module2',
          sourcePath: './src/module2',
          success: true,
          outputPath: '/tmp/module2.puml',
          entities: 50,
          relations: 30,
        },
      ];

      vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await generator.generate(results);

      const content = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(content).toContain('**Average Complexity**: 40.0 entities per module');
    });

    it('should recommend refactoring for modules > 50 entities', async () => {
      const results: BatchResult[] = [
        {
          moduleName: 'large-module',
          sourcePath: './src/large',
          success: true,
          outputPath: '/tmp/large.puml',
          entities: 75,
          relations: 50,
        },
        {
          moduleName: 'small-module',
          sourcePath: './src/small',
          success: true,
          outputPath: '/tmp/small.puml',
          entities: 20,
          relations: 10,
        },
      ];

      vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await generator.generate(results);

      const content = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(content).toContain('**Recommendation**: Consider refactoring large-module - high complexity detected');
    });

    it('should not recommend refactoring when all modules <= 50 entities', async () => {
      const results: BatchResult[] = [
        {
          moduleName: 'module1',
          sourcePath: './src/module1',
          success: true,
          outputPath: '/tmp/module1.puml',
          entities: 30,
          relations: 20,
        },
        {
          moduleName: 'module2',
          sourcePath: './src/module2',
          success: true,
          outputPath: '/tmp/module2.puml',
          entities: 40,
          relations: 25,
        },
      ];

      vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await generator.generate(results);

      const content = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(content).not.toContain('**Recommendation**:');
    });

    it('should handle single module', async () => {
      const results: BatchResult[] = [
        {
          moduleName: 'single',
          sourcePath: './src',
          success: true,
          outputPath: '/tmp/single.puml',
          entities: 25,
          relations: 15,
        },
      ];

      vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await generator.generate(results);

      const content = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(content).toContain('**Most Complex Module**: single (25 entities, 15 relations)');
      expect(content).toContain('**Least Complex Module**: single (25 entities, 15 relations)');
    });
  });
});
