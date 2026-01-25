/**
 * Tests for OutputPathResolver
 * Phase 4.4: Output Path Management Refactoring
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OutputPathResolver } from '../output-path-resolver';
import type { Config } from '../../config-loader';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('OutputPathResolver', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-test-')));
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('resolve() - default behavior', () => {
    it('should resolve default output directory ./archguard', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './archguard',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({});

      // Should resolve to current working directory + archguard
      expect(result.outputDir).toContain('archguard');
      expect(result.baseName).toBe('architecture');
      expect(result.paths.puml).toContain('archguard');
      expect(result.paths.puml).toMatch(/architecture\.puml$/);
      expect(result.paths.png).toContain('archguard');
      expect(result.paths.png).toMatch(/architecture\.png$/);
      expect(result.paths.svg).toContain('archguard');
      expect(result.paths.svg).toMatch(/architecture\.svg$/);
    });

    it('should use default base name "architecture"', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './output',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({});

      expect(result.baseName).toBe('architecture');
      expect(result.paths.puml).toContain('architecture.puml');
    });
  });

  describe('resolve() - custom output directory from config', () => {
    it('should resolve custom output directory', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './diagrams',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({});

      expect(result.outputDir).toContain('diagrams');
      expect(result.paths.puml).toContain('diagrams');
      expect(result.paths.puml).toMatch(/architecture\.puml$/);
    });

    it('should handle absolute paths in outputDir', () => {
      const absolutePath = path.join(testDir, 'absolute', 'path', 'diagrams');
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: absolutePath,
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({});

      expect(result.outputDir).toBe(absolutePath);
      expect(result.paths.puml).toBe(path.join(absolutePath, 'architecture.puml'));
    });
  });

  describe('resolve() - CLI output option override', () => {
    it('should prioritize CLI output option over config.outputDir', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './archguard',
        output: './custom-dir/diagram',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({});

      // When config.output is set, it should be used
      expect(result.outputDir).toContain('custom-dir');
      expect(result.baseName).toBe('diagram');
      expect(result.paths.puml).toContain('custom-dir');
      expect(result.paths.puml).toMatch(/diagram\.puml$/);
    });

    it('should handle CLI output with absolute path', () => {
      const absolutePath = path.join(testDir, 'absolute', 'path');
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './archguard',
        output: path.join(absolutePath, 'my-diagram'),
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({});

      expect(result.outputDir).toBe(absolutePath);
      expect(result.baseName).toBe('my-diagram');
      expect(result.paths.png).toBe(path.join(absolutePath, 'my-diagram.png'));
    });

    it('should handle CLI output with .png extension', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './archguard',
        output: './output/my-diagram.png',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({});

      expect(result.outputDir).toContain('output');
      expect(result.baseName).toBe('my-diagram');
      expect(result.paths.png).toContain('output');
      expect(result.paths.png).toMatch(/my-diagram\.png$/);
    });

    it('should prioritize options.output over config.output', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './archguard',
        output: './config-output/diagram',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({ output: './cli-output/custom' });

      expect(result.outputDir).toContain('cli-output');
      expect(result.baseName).toBe('custom');
    });
  });

  describe('resolve() - path resolution for all file types', () => {
    it('should generate correct .puml path', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './diagrams',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({ baseName: 'my-arch' });

      expect(result.paths.puml).toContain('diagrams');
      expect(result.paths.puml).toMatch(/my-arch\.puml$/);
    });

    it('should generate correct .png path', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './diagrams',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({ baseName: 'my-arch' });

      expect(result.paths.png).toContain('diagrams');
      expect(result.paths.png).toMatch(/my-arch\.png$/);
    });

    it('should generate correct .svg path', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './diagrams',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({ baseName: 'my-arch' });

      expect(result.paths.svg).toContain('diagrams');
      expect(result.paths.svg).toMatch(/my-arch\.svg$/);
    });
  });

  describe('resolve() - base name customization', () => {
    it('should use custom base name from options', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './archguard',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({ baseName: 'custom-name' });

      expect(result.baseName).toBe('custom-name');
      expect(result.paths.puml).toContain('custom-name.puml');
      expect(result.paths.png).toContain('custom-name.png');
      expect(result.paths.svg).toContain('custom-name.svg');
    });

    it('should handle base name with spaces', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './diagrams',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({ baseName: 'my architecture' });

      expect(result.baseName).toBe('my architecture');
      expect(result.paths.puml).toContain('my architecture.puml');
    });
  });

  describe('resolve() - relative vs absolute paths', () => {
    it('should resolve relative paths from current working directory', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './output',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({});

      expect(result.outputDir).toContain('output');
      expect(result.paths.puml).toContain('output');
      expect(result.paths.puml).toMatch(/architecture\.puml$/);
    });

    it('should preserve absolute paths', () => {
      const absolutePath = path.join(testDir, 'usr', 'local', 'diagrams');
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: absolutePath,
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({});

      expect(result.outputDir).toBe(absolutePath);
      expect(result.paths.puml).toBe(path.join(absolutePath, 'architecture.puml'));
    });

    it('should handle nested relative paths', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './docs/diagrams/architecture',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({});

      expect(result.outputDir).toContain('docs/diagrams/architecture');
    });
  });

  describe('ensureDirectory() - directory creation', () => {
    it('should create output directory if it does not exist', async () => {
      const outputPath = path.join(testDir, 'new-dir', 'diagrams');
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: outputPath,
      };
      const resolver = new OutputPathResolver(config);

      await resolver.ensureDirectory();

      // Verify directory was created
      const exists = await fs.access(outputPath).then(
        () => true,
        () => false
      );
      expect(exists).toBe(true);
    });

    it('should not error if directory already exists', async () => {
      const outputPath = path.join(testDir, 'archguard');
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: outputPath,
      };
      const resolver = new OutputPathResolver(config);

      // Create directory first
      await fs.mkdir(outputPath, { recursive: true });

      // Should not throw
      await expect(resolver.ensureDirectory()).resolves.not.toThrow();
    });

    it('should create nested directories', async () => {
      const outputPath = path.join(testDir, 'level1', 'level2', 'level3');
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: outputPath,
      };
      const resolver = new OutputPathResolver(config);

      await resolver.ensureDirectory();

      const exists = await fs.access(outputPath).then(
        () => true,
        () => false
      );
      expect(exists).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty outputDir by using default', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: '',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({});

      expect(result.outputDir).toBeTruthy();
      expect(result.baseName).toBe('architecture');
    });

    it('should handle output with extension stripped correctly', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './diagrams',
        output: 'my-diagram.puml',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({});

      expect(result.baseName).toBe('my-diagram');
      expect(result.paths.puml).toContain('my-diagram.puml');
    });

    it('should handle output without directory as filename in outputDir', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './diagrams',
        output: 'my-diagram',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({});

      expect(result.outputDir).toContain('diagrams');
      expect(result.baseName).toBe('my-diagram');
    });

    it('should handle output with just directory name', () => {
      const config: Pick<Config, 'outputDir' | 'output'> = {
        outputDir: './output',
        output: './diagrams/',
      };
      const resolver = new OutputPathResolver(config);

      const result = resolver.resolve({});

      expect(result.outputDir).toContain('diagrams');
      expect(result.baseName).toBe('architecture');
    });
  });
});
