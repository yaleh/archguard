/**
 * Configuration Type Tests
 * Testing TDD approach: Red -> Green -> Refactor
 */

import { describe, it, expect } from 'vitest';
import type { Config, AnalyzeOptions } from '@/cli/types';
import { ConfigLoader } from '@/cli/config-loader';

/**
 * Test suite for Config types with multi-source support
 *
 * Phase 1 (RED): These tests will FAIL because:
 * 1. Config.source is currently `string`, not `string | string[]`
 * 2. AnalyzeOptions doesn't have new fields (stdin, baseDir, skipMissing, etc.)
 * 3. Zod schema in config-loader doesn't support union type for source
 */

describe('Config Types - Multi-source Support (TDD RED Phase)', () => {
  describe('Config.source type should support string | string[]', () => {
    it('should accept single string source path', () => {
      const config: Config = {
        source: './src',
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: {
          command: 'claude',
          args: [],
          timeout: 60000,
        },
        cache: {
          enabled: true,
          ttl: 86400,
        },
      };
      expect(config.source).toBe('./src');
    });

    // GREEN PHASE: Now this should PASS with updated type
    it('should accept array of string source paths', () => {
      const config: Config = {
        source: ['./src', './lib', './plugins'],
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: {
          command: 'claude',
          args: [],
          timeout: 60000,
        },
        cache: {
          enabled: true,
          ttl: 86400,
        },
      };
      expect(Array.isArray(config.source)).toBe(true);
      expect(config.source).toHaveLength(3);
    });
  });

  describe('AnalyzeOptions should include new fields', () => {
    // GREEN PHASE: These should now PASS with updated types
    it('should include stdin option', () => {
      const options: AnalyzeOptions = {
        source: './src',
        format: 'plantuml',
        cache: true,
        stdin: true,
      };
      expect(options.stdin).toBe(true);
    });

    it('should include baseDir option', () => {
      const options: AnalyzeOptions = {
        source: './src',
        format: 'plantuml',
        cache: true,
        baseDir: '/home/project',
      };
      expect(options.baseDir).toBe('/home/project');
    });

    it('should include skipMissing option', () => {
      const options: AnalyzeOptions = {
        source: './src',
        format: 'plantuml',
        cache: true,
        skipMissing: true,
      };
      expect(options.skipMissing).toBe(true);
    });

    it('should include batch option', () => {
      const options: AnalyzeOptions = {
        source: './src',
        format: 'plantuml',
        cache: true,
        batch: true,
      };
      expect(options.batch).toBe(true);
    });

    it('should include batchIndex option', () => {
      const options: AnalyzeOptions = {
        source: './src',
        format: 'plantuml',
        cache: true,
        batchIndex: true,
      };
      expect(options.batchIndex).toBe(true);
    });

    it('should include separate option', () => {
      const options: AnalyzeOptions = {
        source: './src',
        format: 'plantuml',
        cache: true,
        separate: true,
      };
      expect(options.separate).toBe(true);
    });

    it('should include name option', () => {
      const options: AnalyzeOptions = {
        source: './src',
        format: 'plantuml',
        cache: true,
        name: 'my-architecture',
      };
      expect(options.name).toBe('my-architecture');
    });

    it('should support multi-source with all new options', () => {
      const options: AnalyzeOptions = {
        source: ['./src', './lib'],
        format: 'plantuml',
        cache: true,
        stdin: false,
        baseDir: '/home/project',
        skipMissing: true,
        batch: true,
        batchIndex: true,
        separate: false,
        name: 'combined-diagram',
      };

      expect(Array.isArray(options.source)).toBe(true);
      expect(options.source).toHaveLength(2);
      expect(options.stdin).toBe(false);
      expect(options.baseDir).toBe('/home/project');
      expect(options.skipMissing).toBe(true);
      expect(options.batch).toBe(true);
      expect(options.batchIndex).toBe(true);
      expect(options.separate).toBe(false);
      expect(options.name).toBe('combined-diagram');
    });
  });
});

describe('ConfigLoader Schema Validation - Multi-source Support (TDD RED Phase)', () => {
  const configLoader = new ConfigLoader('/tmp/test-config');

  describe('Single source validation', () => {
    it('should validate single string source', async () => {
      const config = await configLoader.load({ source: './src' });
      expect(config.source).toBe('./src');
    });

    it('should use default source when not provided', async () => {
      const config = await configLoader.load({});
      expect(config.source).toBe('./src');
    });
  });

  describe('Multiple sources validation - GREEN PHASE', () => {
    // GREEN PHASE: These should now PASS with updated schema
    it('should validate array of strings', async () => {
      const config = await configLoader.load({
        source: ['./src', './lib', './plugins'],
      });
      expect(Array.isArray(config.source)).toBe(true);
      expect(config.source).toHaveLength(3);
      expect(config.source).toEqual(['./src', './lib', './plugins']);
    });

    it('should handle empty array', async () => {
      const config = await configLoader.load({
        source: [],
      });
      expect(Array.isArray(config.source)).toBe(true);
      expect(config.source).toHaveLength(0);
    });

    it('should validate single-element array', async () => {
      const config = await configLoader.load({
        source: ['./src'],
      });
      expect(Array.isArray(config.source)).toBe(true);
      expect(config.source).toHaveLength(1);
      expect(config.source[0]).toBe('./src');
    });
  });

  describe('Invalid input rejection', () => {
    it('should reject number', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configLoader.load({ source: 123 as any })
      ).rejects.toThrow();
    });

    it('should reject object', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configLoader.load({ source: { path: './src' } as any })
      ).rejects.toThrow();
    });

    it('should reject array with non-string elements', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configLoader.load({ source: ['./src', 123, null] as any })
      ).rejects.toThrow();
    });
  });
});

describe('Type System Compilation Checks', () => {
  it('should demonstrate current type limitations', () => {
    // Current Config type only accepts string
    const singleSource: Config = {
      source: './src',
      outputDir: './archguard',
      format: 'plantuml',
      exclude: [],
      cli: {
        command: 'claude',
        args: [],
        timeout: 60000,
      },
      cache: {
        enabled: true,
        ttl: 86400,
      },
    };

    expect(singleSource.source).toBe('./src');

    // This demonstrates the limitation we're fixing:
    // The following would not compile without @ts-expect-error
    /*
    const multiSource: Config = {
      source: ['./src', './lib'],  // Type error: string is not assignable to string[]
      outputDir: './archguard',
      format: 'plantuml',
      exclude: [],
      cli: {
        command: 'claude',
        args: [],
        timeout: 60000,
      },
      cache: {
        enabled: true,
        ttl: 86400,
      },
    };
    */
  });

  it('should demonstrate AnalyzeOptions limitations', () => {
    const currentOptions: AnalyzeOptions = {
      source: './src',
      format: 'plantuml',
      cache: true,
      verbose: true,
    };

    expect(currentOptions.source).toBe('./src');

    // This demonstrates the limitation we're fixing:
    // The following fields don't exist yet:
    /*
    const newOptions: AnalyzeOptions = {
      source: ['./src', './lib'],  // Not supported
      format: 'plantuml',
      cache: true,
      stdin: true,        // Doesn't exist
      baseDir: '/home',   // Doesn't exist
      skipMissing: true,  // Doesn't exist
      batch: true,        // Doesn't exist
      batchIndex: true,   // Doesn't exist
      separate: false,    // Doesn't exist
      name: 'diagram',    // Doesn't exist
    };
    */
  });
});
