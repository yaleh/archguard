/**
 * Story 5: Configuration File Support Tests
 * TDD: Red phase - These tests should fail initially
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
          maxTokens: 4096,
          temperature: 0,
        },
      });

      const config = await loader.load();
      expect(config.ai?.model).toBe('claude-3-5-sonnet-20241022');
      expect(config.ai?.maxTokens).toBe(4096);
      expect(config.ai?.temperature).toBe(0);
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
});
