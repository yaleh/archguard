/**
 * FileDiscoveryService Tests
 * TDD: Red phase - These tests should fail initially
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileDiscoveryService } from '@/cli/utils/file-discovery-service';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('FileDiscoveryService', () => {
  let service: FileDiscoveryService;
  let testDir: string;

  beforeEach(async () => {
    service = new FileDiscoveryService();
    testDir = path.join(os.tmpdir(), `archguard-test-${Date.now()}`);

    // Create test directory structure
    await fs.ensureDir(testDir);
    await fs.ensureDir(path.join(testDir, 'src'));
    await fs.ensureDir(path.join(testDir, 'lib'));
    await fs.ensureDir(path.join(testDir, 'src/components'));
    await fs.ensureDir(path.join(testDir, 'lib/utils'));

    // Create test files
    await fs.writeFile(path.join(testDir, 'src/index.ts'), 'export const a = 1;');
    await fs.writeFile(path.join(testDir, 'src/app.ts'), 'export const b = 2;');
    await fs.writeFile(path.join(testDir, 'src/components/button.ts'), 'export const c = 3;');
    await fs.writeFile(path.join(testDir, 'src/index.test.ts'), 'test("a", () => {});');
    await fs.writeFile(path.join(testDir, 'src/app.spec.ts'), 'test("b", () => {});');
    await fs.writeFile(path.join(testDir, 'lib/helper.ts'), 'export const d = 4;');
    await fs.writeFile(path.join(testDir, 'lib/utils/format.ts'), 'export const e = 5;');
  });

  afterEach(async () => {
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
  });

  describe('Single Source Discovery', () => {
    it('should discover TypeScript files from a single source', async () => {
      const files = await service.discoverFiles({
        sources: [path.join(testDir, 'src')],
        baseDir: testDir,
      });

      expect(files).toBeDefined();
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);

      // Should find .ts files but not .test.ts or .spec.ts by default
      const fileNames = files.map((f) => path.basename(f));
      expect(fileNames).toContain('index.ts');
      expect(fileNames).toContain('app.ts');
      expect(fileNames).toContain('button.ts');
    });

    it('should exclude .test.ts files by default', async () => {
      const files = await service.discoverFiles({
        sources: [path.join(testDir, 'src')],
        baseDir: testDir,
      });

      const fileNames = files.map((f) => path.basename(f));
      expect(fileNames).not.toContain('index.test.ts');
    });

    it('should exclude .spec.ts files by default', async () => {
      const files = await service.discoverFiles({
        sources: [path.join(testDir, 'src')],
        baseDir: testDir,
      });

      const fileNames = files.map((f) => path.basename(f));
      expect(fileNames).not.toContain('app.spec.ts');
    });
  });

  describe('Multiple Sources Discovery', () => {
    it('should discover files from multiple sources', async () => {
      const files = await service.discoverFiles({
        sources: [path.join(testDir, 'src'), path.join(testDir, 'lib')],
        baseDir: testDir,
      });

      expect(files.length).toBeGreaterThan(0);

      const fileNames = files.map((f) => path.basename(f));
      // Should find files from both src and lib
      expect(fileNames).toContain('index.ts'); // from src
      expect(fileNames).toContain('helper.ts'); // from lib
      expect(fileNames).toContain('format.ts'); // from lib/utils
    });

    it('should handle empty sources array', async () => {
      const files = await service.discoverFiles({
        sources: [],
        baseDir: testDir,
      });

      expect(files).toBeDefined();
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBe(0);
    });

    it('should use default source ./src when sources is undefined', async () => {
      const files = await service.discoverFiles({
        baseDir: testDir,
      });

      expect(files).toBeDefined();
      expect(Array.isArray(files)).toBe(true);
    });
  });

  describe('File Deduplication', () => {
    it('should deduplicate files from overlapping sources', async () => {
      const files = await service.discoverFiles({
        sources: [
          path.join(testDir, 'src'),
          path.join(testDir, 'src/components'), // Overlapping with src
        ],
        baseDir: testDir,
      });

      // Should not have duplicates
      const uniqueFiles = new Set(files);
      expect(files.length).toBe(uniqueFiles.size);

      // Button.ts should appear only once
      const buttonFiles = files.filter((f) => f.endsWith('button.ts'));
      expect(buttonFiles.length).toBe(1);
    });

    it('should deduplicate files with absolute paths', async () => {
      const srcPath = path.join(testDir, 'src');

      const files = await service.discoverFiles({
        sources: [
          srcPath,
          srcPath, // Exact duplicate
        ],
        baseDir: testDir,
      });

      // Should not have duplicates
      const uniqueFiles = new Set(files);
      expect(files.length).toBe(uniqueFiles.size);
    });
  });

  describe('Exclude Patterns', () => {
    it('should apply custom exclude patterns', async () => {
      const files = await service.discoverFiles({
        sources: [path.join(testDir, 'src')],
        baseDir: testDir,
        exclude: ['**/components/**'],
      });

      const fileNames = files.map((f) => path.basename(f));
      expect(fileNames).toContain('index.ts');
      expect(fileNames).toContain('app.ts');
      expect(fileNames).not.toContain('button.ts'); // Should be excluded
    });

    it('should combine default and custom exclude patterns', async () => {
      const files = await service.discoverFiles({
        sources: [path.join(testDir, 'src')],
        baseDir: testDir,
        exclude: ['**/components/**'],
      });

      const fileNames = files.map((f) => path.basename(f));
      // Default excludes should still work
      expect(fileNames).not.toContain('index.test.ts');
      expect(fileNames).not.toContain('app.spec.ts');
      // Custom exclude
      expect(fileNames).not.toContain('button.ts');
    });

    it('should support multiple exclude patterns', async () => {
      const files = await service.discoverFiles({
        sources: [path.join(testDir, 'src')],
        baseDir: testDir,
        exclude: ['**/components/**', '**/app.ts'],
      });

      const fileNames = files.map((f) => path.basename(f));
      expect(fileNames).toContain('index.ts');
      expect(fileNames).not.toContain('app.ts'); // Excluded by pattern
      expect(fileNames).not.toContain('button.ts'); // Excluded by pattern
    });
  });

  describe('Skip Missing Files', () => {
    it('should skip non-existent source directories when skipMissing is true', async () => {
      const files = await service.discoverFiles({
        sources: [path.join(testDir, 'src'), path.join(testDir, 'non-existent')],
        baseDir: testDir,
        skipMissing: true,
      });

      expect(files.length).toBeGreaterThan(0);
      const fileNames = files.map((f) => path.basename(f));
      expect(fileNames).toContain('index.ts');
    });

    it('should throw error for non-existent source when skipMissing is false', async () => {
      await expect(
        service.discoverFiles({
          sources: [path.join(testDir, 'non-existent')],
          baseDir: testDir,
          skipMissing: false,
        })
      ).rejects.toThrow();
    });

    it('should default skipMissing to false', async () => {
      await expect(
        service.discoverFiles({
          sources: [path.join(testDir, 'non-existent')],
          baseDir: testDir,
        })
      ).rejects.toThrow();
    });
  });

  describe('Path Resolution', () => {
    it('should return absolute paths', async () => {
      const files = await service.discoverFiles({
        sources: [path.join(testDir, 'src')],
        baseDir: testDir,
      });

      files.forEach((file) => {
        expect(path.isAbsolute(file)).toBe(true);
      });
    });

    it('should resolve relative source paths against baseDir', async () => {
      const files = await service.discoverFiles({
        sources: ['src'],
        baseDir: testDir,
      });

      expect(files.length).toBeGreaterThan(0);
      const fileNames = files.map((f) => path.basename(f));
      expect(fileNames).toContain('index.ts');
    });
  });

  describe('Single File Path Support', () => {
    it('should return the file itself when source is a single .ts file', async () => {
      const singleFilePath = path.join(testDir, 'src/index.ts');

      const files = await service.discoverFiles({
        sources: [singleFilePath],
        baseDir: testDir,
      });

      expect(files).toEqual([singleFilePath]);
    });

    it('should return empty array when source is a non-.ts file', async () => {
      const nonTsFile = path.join(testDir, 'README.md');
      await fs.writeFile(nonTsFile, '# Test');

      const files = await service.discoverFiles({
        sources: [nonTsFile],
        baseDir: testDir,
      });

      expect(files).toEqual([]);
    });

    it('should return empty array when source is a .js file', async () => {
      const jsFile = path.join(testDir, 'script.js');
      await fs.writeFile(jsFile, 'console.log("test");');

      const files = await service.discoverFiles({
        sources: [jsFile],
        baseDir: testDir,
      });

      expect(files).toEqual([]);
    });

    it('should handle mixed file and directory sources', async () => {
      const singleFilePath = path.join(testDir, 'src/app.ts');

      const files = await service.discoverFiles({
        sources: [singleFilePath, path.join(testDir, 'lib')],
        baseDir: testDir,
      });

      expect(files.length).toBeGreaterThan(0);
      // Should contain the single file
      expect(files).toContain(singleFilePath);
      // Should also contain files from lib directory
      const fileNames = files.map((f) => path.basename(f));
      expect(fileNames).toContain('helper.ts');
      expect(fileNames).toContain('format.ts');
    });

    it('should deduplicate when single file appears in both file and directory sources', async () => {
      const singleFilePath = path.join(testDir, 'src/index.ts');

      const files = await service.discoverFiles({
        sources: [singleFilePath, path.join(testDir, 'src')],
        baseDir: testDir,
      });

      // The single file should appear only once
      const indexCount = files.filter((f) => f.endsWith('index.ts')).length;
      expect(indexCount).toBe(1);
    });

    it('should throw error when single file path does not exist', async () => {
      const nonExistentFile = path.join(testDir, 'does-not-exist.ts');

      await expect(
        service.discoverFiles({
          sources: [nonExistentFile],
          baseDir: testDir,
        })
      ).rejects.toThrow('Source path does not exist');
    });

    it('should skip missing single file when skipMissing is true', async () => {
      const nonExistentFile = path.join(testDir, 'does-not-exist.ts');

      const files = await service.discoverFiles({
        sources: [nonExistentFile],
        baseDir: testDir,
        skipMissing: true,
      });

      expect(files).toEqual([]);
    });
  });

  describe('Default Behavior', () => {
    it('should use default excludes for test files', async () => {
      const files = await service.discoverFiles({
        sources: [path.join(testDir, 'src')],
        baseDir: testDir,
      });

      // Should exclude .test.ts and .spec.ts by default
      const hasTestFiles = files.some((f) => f.endsWith('.test.ts') || f.endsWith('.spec.ts'));
      expect(hasTestFiles).toBe(false);
    });

    it('should exclude node_modules by default', async () => {
      // Create node_modules directory with a file
      await fs.ensureDir(path.join(testDir, 'src/node_modules'));
      await fs.writeFile(
        path.join(testDir, 'src/node_modules/package.ts'),
        'export const pkg = 1;'
      );

      const files = await service.discoverFiles({
        sources: [path.join(testDir, 'src')],
        baseDir: testDir,
      });

      const hasNodeModules = files.some((f) => f.includes('node_modules'));
      expect(hasNodeModules).toBe(false);
    });
  });
});
