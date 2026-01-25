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
        source: './src',
        output: './docs',
        format: 'plantuml',
      });

      const config = await loader.load();

      expect(config.source).toBe('./src');
      expect(config.output).toBe('./docs');
      expect(config.format).toBe('plantuml');
    });

    it('should use default values when config file not found', async () => {
      const config = await loader.load();

      expect(config.source).toBe('./src');
      expect(config.format).toBe('plantuml');
    });

    it('should merge CLI options with config file', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        source: './src',
        format: 'plantuml',
      });

      const config = await loader.load({ output: './custom.puml' });

      expect(config.source).toBe('./src'); // From config
      expect(config.output).toBe('./custom.puml'); // From CLI (overrides)
      expect(config.format).toBe('plantuml'); // From config
    });

    it('should give CLI options higher priority', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        source: './src',
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
        source: './src',
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
      expect(config).toHaveProperty('source');
      expect(config).toHaveProperty('format');
    });

    it('should not overwrite existing config', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, { source: './custom' });

      await expect(loader.init()).rejects.toThrow('already exists');
    });

    it('should create config with all default values', async () => {
      await loader.init();

      const configPath = path.join(testDir, 'archguard.config.json');
      const config = await fs.readJson(configPath);

      expect(config.source).toBe('./src');
      expect(config.format).toBe('plantuml');
      expect(config.exclude).toBeInstanceOf(Array);
      expect(config.cache).toBeDefined();
      expect(config.cache.enabled).toBe(true);
    });
  });

  describe('Default Values', () => {
    it('should use default source directory', async () => {
      const config = await loader.load();
      expect(config.source).toBe('./src');
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
    it('should load AI configuration', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        ai: {
          model: 'claude-3-5-sonnet-20241022',
          timeout: 60000,
        },
      });

      const config = await loader.load();
      // ai.model is migrated to cli.args
      expect(config.cli.args).toEqual(['--model', 'claude-3-5-sonnet-20241022']);
      expect(config.cli.timeout).toBe(60000);
    });

    it('should show deprecation warning for apiKey', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        ai: {
          apiKey: 'sk-ant-12345',
          model: 'claude-3-5-sonnet-20241022',
        },
      });

      const config = await loader.load();
      expect(config.ai?.apiKey).toBeUndefined(); // apiKey should be filtered out
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ai.apiKey is deprecated'));

      consoleSpy.mockRestore();
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

    describe('Backward Compatibility: AI to CLI Migration', () => {
      it('should convert ai.model to cli.args', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          ai: {
            model: 'claude-3-5-sonnet-20241022',
          },
        });

        const config = await loader.load();
        expect(config.cli.args).toEqual(['--model', 'claude-3-5-sonnet-20241022']);
      });

      it('should convert ai.timeout to cli.timeout', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          ai: {
            timeout: 120000,
          },
        });

        const config = await loader.load();
        expect(config.cli.timeout).toBe(120000);
      });

      it('should handle both ai.model and ai.timeout conversion', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          ai: {
            model: 'claude-3-5-sonnet-20241022',
            timeout: 120000,
          },
        });

        const config = await loader.load();
        expect(config.cli.args).toEqual(['--model', 'claude-3-5-sonnet-20241022']);
        expect(config.cli.timeout).toBe(120000);
      });

      it('should not overwrite existing cli.args with ai.model', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          cli: {
            args: ['--custom-arg'],
          },
          ai: {
            model: 'claude-3-5-sonnet-20241022',
          },
        });

        const config = await loader.load();
        expect(config.cli.args).toEqual(['--custom-arg']); // Existing cli.args preserved
      });

      it('should not overwrite existing cli.timeout with ai.timeout', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          cli: {
            timeout: 90000,
          },
          ai: {
            timeout: 120000,
          },
        });

        const config = await loader.load();
        expect(config.cli.timeout).toBe(90000); // Existing cli.timeout preserved
      });

      it('should remove deprecated ai fields after conversion', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          ai: {
            model: 'claude-3-5-sonnet-20241022',
            timeout: 120000,
          },
        });

        const config = await loader.load();
        // ai object should be removed if empty after migration
        expect(config.ai).toBeUndefined();
      });
    });

    describe('Deprecated Config Removal', () => {
      it('should remove deprecated ai.apiKey', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          ai: {
            apiKey: 'sk-ant-12345',
          },
        });

        const config = await loader.load();
        expect(config.ai?.apiKey).toBeUndefined();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ai.apiKey is deprecated'));

        consoleSpy.mockRestore();
      });

      it('should remove deprecated ai.maxTokens', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          ai: {
            maxTokens: 8192,
          },
        });

        const config = await loader.load();
        expect(config.ai?.maxTokens).toBeUndefined();
      });

      it('should remove deprecated ai.temperature', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          ai: {
            temperature: 0.7,
          },
        });

        const config = await loader.load();
        expect(config.ai?.temperature).toBeUndefined();
      });

      it('should remove all deprecated ai fields simultaneously', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          ai: {
            apiKey: 'sk-ant-12345',
            maxTokens: 8192,
            temperature: 0.7,
            model: 'claude-3-5-sonnet-20241022',
          },
        });

        const config = await loader.load();
        expect(config.ai?.apiKey).toBeUndefined();
        expect(config.ai?.maxTokens).toBeUndefined();
        expect(config.ai?.temperature).toBeUndefined();
        expect(config.ai?.model).toBeUndefined(); // Migrated to cli.args
        expect(config.cli.args).toEqual(['--model', 'claude-3-5-sonnet-20241022']);

        consoleSpy.mockRestore();
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
          source: './lib',
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
        expect(config.source).toBe('./lib');
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

      it('should migrate old config to new format automatically', async () => {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          source: './src',
          format: 'plantuml',
          ai: {
            model: 'claude-3-5-sonnet-20241022',
            timeout: 120000,
            apiKey: 'sk-ant-12345', // Deprecated
            maxTokens: 8192, // Deprecated
          },
        });

        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const config = await loader.load();

        // Verify migration
        expect(config.cli.args).toEqual(['--model', 'claude-3-5-sonnet-20241022']);
        expect(config.cli.timeout).toBe(120000);
        expect(config.ai?.apiKey).toBeUndefined();
        expect(config.ai?.maxTokens).toBeUndefined();
        expect(config.ai?.model).toBeUndefined();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ai.apiKey is deprecated'));

        consoleSpy.mockRestore();
      });
    });
  });
});
