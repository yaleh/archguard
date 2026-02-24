/**
 * Unit tests for Mermaid configuration
 */

import { describe, it, expect } from 'vitest';
import { ConfigLoader } from '../../src/cli/config-loader';
import type { Config } from '../../src/cli/config-loader';
import fs from 'fs-extra';

describe('ConfigLoader - Mermaid Configuration', () => {
  describe('mermaid config validation', () => {
    it('should accept valid mermaid configuration', async () => {
      const loader = new ConfigLoader();

      const config: Partial<Config> = {
        format: 'mermaid',
        mermaid: {
          renderer: 'isomorphic',
          theme: 'default',
          transparentBackground: true,
        },
      };

      const result = await loader.load(config);
      expect(result.format).toBe('mermaid');
      expect(result.mermaid?.renderer).toBe('isomorphic');
      expect(result.mermaid?.theme).toBe('default');
      expect(result.mermaid?.transparentBackground).toBe(true);
    });

    it('should use default mermaid config when not specified', async () => {
      const loader = new ConfigLoader();

      const config: Partial<Config> = {
        format: 'mermaid',
      };

      const result = await loader.load(config);
      expect(result.format).toBe('mermaid');
      // Zod applies defaults, so mermaid config will have default values
      expect(result.mermaid).toBeDefined();
      expect(result.mermaid?.renderer).toBe('isomorphic');
      expect(result.mermaid?.theme).toBe('default');
      expect(result.mermaid?.transparentBackground).toBe(false);
    });

    it('should accept partial mermaid configuration', async () => {
      const loader = new ConfigLoader();

      const config: Partial<Config> = {
        format: 'mermaid',
        mermaid: {
          theme: 'dark',
        },
      };

      const result = await loader.load(config);
      expect(result.mermaid?.theme).toBe('dark');
      // Zod applies defaults for unspecified fields
      expect(result.mermaid?.renderer).toBe('isomorphic');
    });

    it('should accept all valid mermaid themes', async () => {
      const loader = new ConfigLoader();

      const themes: Array<'default' | 'forest' | 'dark' | 'neutral'> = [
        'default',
        'forest',
        'dark',
        'neutral',
      ];

      for (const theme of themes) {
        const config: Partial<Config> = {
          format: 'mermaid',
          mermaid: { theme },
        };

        const result = await loader.load(config);
        expect(result.mermaid?.theme).toBe(theme);
      }
    });

    it('should accept both isomorphic and cli renderers', async () => {
      const loader = new ConfigLoader();

      const renderers: Array<'isomorphic' | 'cli'> = ['isomorphic', 'cli'];

      for (const renderer of renderers) {
        const config: Partial<Config> = {
          format: 'mermaid',
          mermaid: { renderer },
        };

        const result = await loader.load(config);
        expect(result.mermaid?.renderer).toBe(renderer);
      }
    });

    it('should reject invalid theme', async () => {
      const loader = new ConfigLoader();

      const config: Partial<Config> = {
        format: 'mermaid',
        mermaid: {
          theme: 'invalid' as any,
        },
      };

      await expect(loader.load(config)).rejects.toThrow(/validation failed/i);
    });

    it('should reject invalid renderer', async () => {
      const loader = new ConfigLoader();

      const config: Partial<Config> = {
        format: 'mermaid',
        mermaid: {
          renderer: 'invalid' as any,
        },
      };

      await expect(loader.load(config)).rejects.toThrow(/validation failed/i);
    });
  });

  describe('PlantUML format deprecation', () => {
    it('should reject plantuml format with validation error', async () => {
      const loader = new ConfigLoader('/tmp/test-config-reject');

      const config: Partial<Config> = {
        format: 'plantuml' as any,
      };

      await expect(loader.load(config)).rejects.toThrow(/Invalid enum value|plantuml/);
      await expect(loader.load(config)).rejects.toThrow(/mermaid|json/);
    });

    it('should reject svg format with validation error', async () => {
      const loader = new ConfigLoader('/tmp/test-config-svg');

      const config: Partial<Config> = {
        format: 'svg' as any,
      };

      await expect(loader.load(config)).rejects.toThrow(/Invalid enum value|svg/);
      await expect(loader.load(config)).rejects.toThrow(/mermaid|json/);
    });

    it('should reject plantuml in diagram config', async () => {
      const loader = new ConfigLoader('/tmp/test-config-diagram');

      const config: Partial<Config> = {
        format: 'mermaid',
        diagrams: [
          {
            name: 'test',
            sources: ['./src'],
            level: 'class',
            format: 'plantuml' as any,
          },
        ],
      };

      await expect(loader.load(config)).rejects.toThrow(/Invalid enum value|plantuml/);
    });
  });

  describe('default format change', () => {
    it('should default to mermaid format when no format specified', async () => {
      const loader = new ConfigLoader('/tmp/test-config-default');

      const result = await loader.load({});
      expect(result.format).toBe('mermaid');
    });

    it('should allow explicit json format', async () => {
      const loader = new ConfigLoader();

      const config: Partial<Config> = {
        format: 'json',
      };

      const result = await loader.load(config);
      expect(result.format).toBe('json');
    });

    it('should allow explicit mermaid format', async () => {
      const loader = new ConfigLoader();

      const config: Partial<Config> = {
        format: 'mermaid',
      };

      const result = await loader.load(config);
      expect(result.format).toBe('mermaid');
    });
  });

  describe('config file integration', () => {
    it('should load mermaid config from JSON file', async () => {
      const testDir = '/tmp/test-archguard-mermaid';
      const loader = new ConfigLoader(testDir);

      const testConfig = {
        format: 'mermaid',
        mermaid: {
          renderer: 'cli',
          theme: 'forest',
          transparentBackground: false,
        },
        diagrams: [],
      };

      await fs.ensureDir(testDir);
      await fs.writeJson(`${testDir}/archguard.config.json`, testConfig);

      try {
        const result = await loader.load();
        expect(result.format).toBe('mermaid');
        expect(result.mermaid?.renderer).toBe('cli');
        expect(result.mermaid?.theme).toBe('forest');
        expect(result.mermaid?.transparentBackground).toBe(false);
      } finally {
        await fs.remove(testDir);
      }
    });

    it('should initialize config with mermaid defaults', async () => {
      const testDir = '/tmp/test-archguard-init';
      const loader = new ConfigLoader(testDir);

      try {
        await fs.ensureDir(testDir);
        await loader.init({ format: 'json' });

        const configPath = `${testDir}/archguard.config.json`;
        const exists = await fs.pathExists(configPath);
        expect(exists).toBe(true);

        const config = await fs.readJson(configPath);
        expect(config.format).toBe('mermaid'); // Should default to mermaid
      } finally {
        await fs.remove(testDir);
      }
    });
  });

  describe('CLI options override', () => {
    it('should allow CLI to override mermaid settings', async () => {
      const testDir = '/tmp/test-archguard-override';
      const loader = new ConfigLoader(testDir);

      const fileConfig = {
        format: 'mermaid',
        mermaid: {
          theme: 'default',
        },
        diagrams: [],
      };

      await fs.ensureDir(testDir);
      await fs.writeJson(`${testDir}/archguard.config.json`, fileConfig);

      try {
        const cliOptions: Partial<Config> = {
          mermaid: {
            theme: 'dark',
          },
        };

        const result = await loader.load(cliOptions);
        expect(result.mermaid?.theme).toBe('dark');
      } finally {
        await fs.remove(testDir);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty mermaid config object', async () => {
      const loader = new ConfigLoader();

      const config: Partial<Config> = {
        format: 'mermaid',
        mermaid: {},
      };

      const result = await loader.load(config);
      expect(result.format).toBe('mermaid');
      // Zod applies defaults even for empty object
      expect(result.mermaid?.renderer).toBe('isomorphic');
      expect(result.mermaid?.theme).toBe('default');
      expect(result.mermaid?.transparentBackground).toBe(false);
    });

    it('should handle mermaid config with json format (should be ignored)', async () => {
      const loader = new ConfigLoader();

      const config: Partial<Config> = {
        format: 'json',
        mermaid: {
          theme: 'dark',
        },
      };

      const result = await loader.load(config);
      expect(result.format).toBe('json');
      // mermaid config can still be present even if format is json
      expect(result.mermaid?.theme).toBe('dark');
    });

    it('should accept boolean flags correctly', async () => {
      const loader = new ConfigLoader();

      const config: Partial<Config> = {
        format: 'mermaid',
        mermaid: {
          transparentBackground: false,
        },
      };

      const result = await loader.load(config);
      expect(result.mermaid?.transparentBackground).toBe(false);
    });
  });
});
