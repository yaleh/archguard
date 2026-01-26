/**
 * Story 5: Configuration File Support Tests
 * TDD: Red phase - These tests should fail initially
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigLoader } from '@/cli/config-loader';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('Story 5: Configuration File Support', () => {
  let loader: ConfigLoader;
  const testDir = path.join(os.tmpdir(), '.archguard-config-test');

  beforeEach(async () => {
    loader = new ConfigLoader(testDir);
    // Clean up before each test
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    // Clean up after each test
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
  });

  describe('Loading archguard.config.json', () => {
    it('should load config from archguard.config.json', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [
          {
            name: 'overview',
            sources: ['./src'],
            level: 'class',
          },
        ],
        format: 'plantuml',
      });

      const config = await loader.load();

      expect(config.diagrams).toHaveLength(1);
      expect(config.diagrams[0].name).toBe('overview');
      expect(config.diagrams[0].sources).toEqual(['./src']);
      expect(config.format).toBe('plantuml');
    });

    it('should use default values when config file not found', async () => {
      const config = await loader.load();

      expect(config.diagrams).toEqual([]);
      expect(config.format).toBe('plantuml');
    });

    it('should merge CLI options with config file', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'test', sources: ['./src'], level: 'class' }],
        format: 'plantuml',
      });

      const config = await loader.load({ outputDir: './custom' });

      expect(config.diagrams).toHaveLength(1); // From config
      expect(config.outputDir).toBe('./custom'); // From CLI (overrides)
      expect(config.format).toBe('plantuml'); // From config
    });

    it('should give CLI options higher priority', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'test', sources: ['./src'], level: 'class' }],
        format: 'plantuml',
      });

      const config = await loader.load({ format: 'json' });

      expect(config.format).toBe('json'); // CLI overrides config
    });
  });

  describe('Config Validation', () => {
    it('should validate format option', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'test', sources: ['./src'], level: 'class' }],
        format: 'invalid-format',
      });

      await expect(loader.load()).rejects.toThrow();
    });

    it('should accept valid formats', async () => {
      const formats = ['plantuml', 'json', 'svg'];

      for (const format of formats) {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, { format });

        const config = await loader.load();
        expect(config.format).toBe(format);

        await fs.remove(configPath);
      }
    });

    it('should validate exclude patterns as array', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        exclude: '**/*.test.ts', // Invalid: should be array
      });

      await expect(loader.load()).rejects.toThrow();
    });

    it('should accept valid exclude patterns array', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        exclude: ['**/*.test.ts', '**/*.spec.ts'],
      });

      const config = await loader.load();
      expect(config.exclude).toEqual(['**/*.test.ts', '**/*.spec.ts']);
    });
  });

  describe('Config Initialization', () => {
    it('should create default config with init command', async () => {
      await loader.init();

      const configPath = path.join(testDir, 'archguard.config.json');
      const exists = await fs.pathExists(configPath);
      expect(exists).toBe(true);

      const config = await fs.readJson(configPath);
      expect(config).toHaveProperty('diagrams');
      expect(config).toHaveProperty('format');
    });

    it('should not overwrite existing config', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, { diagrams: [] });

      await expect(loader.init()).rejects.toThrow('already exists');
    });

    it('should create config with all default values', async () => {
      await loader.init();

      const configPath = path.join(testDir, 'archguard.config.json');
      const config = await fs.readJson(configPath);

      expect(config.diagrams).toBeDefined();
      expect(config.format).toBe('plantuml');
      expect(config.exclude).toBeInstanceOf(Array);
      expect(config.cache).toBeDefined();
      expect(config.cache.enabled).toBe(true);
    });
  });

  describe('Default Values', () => {
    it('should use default diagrams array', async () => {
      const config = await loader.load();
      expect(config.diagrams).toEqual([]);
    });

    it('should use default format', async () => {
      const config = await loader.load();
      expect(config.format).toBe('plantuml');
    });

    it('should use default exclude patterns', async () => {
      const config = await loader.load();
      expect(config.exclude).toContain('**/*.test.ts');
      expect(config.exclude).toContain('**/*.spec.ts');
    });

    it('should use default cache settings', async () => {
      const config = await loader.load();
      expect(config.cache.enabled).toBe(true);
      expect(config.cache.ttl).toBe(86400); // 24 hours
    });
  });

  describe('Advanced Options', () => {
    it('should load CLI configuration', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        cli: {
          command: 'claude',
          args: ['--model', 'claude-3-5-sonnet-20241022'],
          timeout: 60000,
        },
      });

      const config = await loader.load();
      expect(config.cli.args).toEqual(['--model', 'claude-3-5-sonnet-20241022']);
      expect(config.cli.timeout).toBe(60000);
    });

    it('should load cache configuration', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        cache: {
          enabled: false,
          ttl: 3600,
        },
      });

      const config = await loader.load();
      expect(config.cache.enabled).toBe(false);
      expect(config.cache.ttl).toBe(3600);
    });
  });

  describe('Phase 4.1: CLI Configuration Schema', () => {
    describe('CLI Configuration', () => {
      it('should parse cli.command with default value', async () => {
        const config = await loader.load();
        expect(config.cli).toBeDefined();
        expect(config.cli.command).toBe('claude');
      });

      it('should parse custom cli.command from config', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          cli: {
            command: '/usr/local/bin/claude',
          },
        });

        const config = await loader.load();
        expect(config.cli.command).toBe('/usr/local/bin/claude');
      });

      it('should parse cli.args from config', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          cli: {
            args: ['--model', 'claude-3-5-sonnet-20241022', '--timeout', '120000'],
          },
        });

        const config = await loader.load();
        expect(config.cli.args).toEqual([
          '--model',
          'claude-3-5-sonnet-20241022',
          '--timeout',
          '120000',
        ]);
      });

      it('should parse cli.timeout with default value', async () => {
        const config = await loader.load();
        expect(config.cli.timeout).toBe(60000);
      });

      it('should parse custom cli.timeout from config', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          cli: {
            timeout: 120000,
          },
        });

        const config = await loader.load();
        expect(config.cli.timeout).toBe(120000);
      });

      it('should merge CLI options with file config using deep merge', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          cli: {
            command: 'claude',
            args: ['--model', 'claude-3-5-sonnet-20241022'],
            timeout: 60000,
          },
        });

        const config = await loader.load({
          cli: {
            timeout: 120000,
          },
        });

        expect(config.cli.command).toBe('claude');
        expect(config.cli.args).toEqual(['--model', 'claude-3-5-sonnet-20241022']);
        expect(config.cli.timeout).toBe(120000); // CLI override
      });
    });

    describe('Output Directory Configuration', () => {
      it('should parse outputDir with default value', async () => {
        const config = await loader.load();
        expect(config.outputDir).toBe('./archguard');
      });

      it('should parse custom outputDir from config', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          outputDir: './docs/archguard',
        });

        const config = await loader.load();
        expect(config.outputDir).toBe('./docs/archguard');
      });

      it('should allow CLI options to override outputDir', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          outputDir: './docs/archguard',
        });

        const config = await loader.load({ outputDir: './custom/output' });
        expect(config.outputDir).toBe('./custom/output');
      });
    });


    describe('Deep Merge Logic', () => {
      it('should deep merge nested objects', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          cli: {
            command: 'claude',
            args: ['--model', 'claude-3-5-sonnet-20241022'],
          },
          cache: {
            enabled: true,
            ttl: 3600,
          },
        });

        const config = await loader.load({
          cli: {
            timeout: 120000,
          },
          cache: {
            enabled: false,
          },
        });

        expect(config.cli.command).toBe('claude'); // From file
        expect(config.cli.args).toEqual(['--model', 'claude-3-5-sonnet-20241022']); // From file
        expect(config.cli.timeout).toBe(120000); // From CLI
        expect(config.cache.enabled).toBe(false); // From CLI
        expect(config.cache.ttl).toBe(3600); // From file
      });

      it('should not merge arrays', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          exclude: ['**/*.test.ts'],
        });

        const config = await loader.load({
          exclude: ['**/*.spec.ts'],
        });

        // Arrays should be replaced, not merged
        expect(config.exclude).toEqual(['**/*.spec.ts']);
      });

      it('should handle empty nested objects', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          cli: {},
        });

        const config = await loader.load();
        expect(config.cli.command).toBe('claude'); // Default value
        expect(config.cli.timeout).toBe(60000); // Default value
      });
    });

    describe('Integration Tests', () => {
      it('should load complete config with all fields', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          diagrams: [
            { name: 'overview', sources: ['./lib'], level: 'class' },
          ],
          outputDir: './docs/output',
          format: 'json',
          exclude: ['**/*.test.ts', '**/dist/**'],
          cli: {
            command: '/usr/local/bin/claude',
            args: ['--model', 'claude-3-5-sonnet-20241022'],
            timeout: 120000,
          },
          cache: {
            enabled: false,
            ttl: 7200,
          },
          concurrency: 4,
          verbose: true,
        });

        const config = await loader.load();
        expect(config.diagrams).toHaveLength(1);
        expect(config.diagrams[0].name).toBe('overview');
        expect(config.outputDir).toBe('./docs/output');
        expect(config.format).toBe('json');
        expect(config.exclude).toEqual(['**/*.test.ts', '**/dist/**']);
        expect(config.cli.command).toBe('/usr/local/bin/claude');
        expect(config.cli.args).toEqual(['--model', 'claude-3-5-sonnet-20241022']);
        expect(config.cli.timeout).toBe(120000);
        expect(config.cache.enabled).toBe(false);
        expect(config.cache.ttl).toBe(7200);
        expect(config.concurrency).toBe(4);
        expect(config.verbose).toBe(true);
      });

      it('should validate complete config with multiple diagrams', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          diagrams: [
            { name: 'overview', sources: ['./src'], level: 'package' },
            { name: 'modules/parser', sources: ['./src/parser'], level: 'class' },
          ],
          format: 'plantuml',
          cli: {
            command: 'claude',
            args: ['--model', 'claude-3-5-sonnet-20241022'],
            timeout: 120000,
          },
        });

        const config = await loader.load();

        // Verify diagrams
        expect(config.diagrams).toHaveLength(2);
        expect(config.diagrams[0].level).toBe('package');
        expect(config.diagrams[1].level).toBe('class');
        expect(config.cli.args).toEqual(['--model', 'claude-3-5-sonnet-20241022']);
        expect(config.cli.timeout).toBe(120000);
      });
    });
  });

  describe('Custom Config Path', () => {
    it('should load config from custom path', async () => {
      const customPath = path.join(testDir, 'custom.config.json');
      await fs.writeJson(customPath, {
        diagrams: [
          {
            name: 'custom-diagram',
            sources: ['./custom/src'],
            level: 'class',
          },
        ],
        format: 'json',
        outputDir: './custom-output',
      });

      const config = await loader.load({}, customPath);

      expect(config.diagrams).toHaveLength(1);
      expect(config.diagrams[0].name).toBe('custom-diagram');
      expect(config.format).toBe('json');
      expect(config.outputDir).toBe('./custom-output');
    });

    it('should load config from custom path with .js extension', async () => {
      const customPath = path.join(testDir, 'custom.config.js');
      const jsContent = `export default ${JSON.stringify({
        diagrams: [
          {
            name: 'js-diagram',
            sources: ['./js/src'],
            level: 'package',
          },
        ],
        format: 'plantuml',
      }, null, 2)};
`;
      await fs.writeFile(customPath, jsContent);

      const config = await loader.load({}, customPath);

      expect(config.diagrams).toHaveLength(1);
      expect(config.diagrams[0].name).toBe('js-diagram');
      expect(config.format).toBe('plantuml');
    });

    it('should throw error if custom config path does not exist', async () => {
      const customPath = path.join(testDir, 'nonexistent.config.json');

      await expect(loader.load({}, customPath)).rejects.toThrow('Config file not found');
    });

    it('should resolve relative custom config path', async () => {
      const customPath = path.join(testDir, 'subdir', 'nested.config.json');
      await fs.ensureDir(path.join(testDir, 'subdir'));
      await fs.writeJson(customPath, {
        diagrams: [
          {
            name: 'nested-diagram',
            sources: ['./nested/src'],
            level: 'method',
          },
        ],
      });

      // Use relative path
      const relativePath = path.relative(process.cwd(), customPath);
      const config = await loader.load({}, relativePath);

      expect(config.diagrams).toHaveLength(1);
      expect(config.diagrams[0].name).toBe('nested-diagram');
    });

    it('should merge CLI options with custom config file', async () => {
      const customPath = path.join(testDir, 'custom.config.json');
      await fs.writeJson(customPath, {
        diagrams: [
          {
            name: 'custom-diagram',
            sources: ['./custom/src'],
            level: 'class',
          },
        ],
        format: 'json',
        outputDir: './custom-output',
      });

      const config = await loader.load({ format: 'plantuml' }, customPath);

      expect(config.diagrams).toHaveLength(1);
      expect(config.format).toBe('plantuml'); // CLI override
      expect(config.outputDir).toBe('./custom-output'); // From custom config
    });

    it('should prioritize custom config over default config files', async () => {
      // Create default config file
      const defaultPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(defaultPath, {
        diagrams: [
          {
            name: 'default-diagram',
            sources: ['./default/src'],
            level: 'class',
          },
        ],
        format: 'json',
      });

      // Create custom config file
      const customPath = path.join(testDir, 'custom.config.json');
      await fs.writeJson(customPath, {
        diagrams: [
          {
            name: 'custom-diagram',
            sources: ['./custom/src'],
            level: 'package',
          },
        ],
        format: 'plantuml',
      });

      // Load with custom path
      const config = await loader.load({}, customPath);

      // Should use custom config, not default
      expect(config.diagrams).toHaveLength(1);
      expect(config.diagrams[0].name).toBe('custom-diagram');
      expect(config.format).toBe('plantuml');
    });
  });
});
