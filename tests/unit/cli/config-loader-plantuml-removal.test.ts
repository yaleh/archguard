/**
 * Phase 3: PlantUML Removal Tests
 * TDD: Tests to verify PlantUML format is rejected from configuration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigLoader } from '@/cli/config-loader';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('Phase 3: PlantUML Removal from Configuration Schema', () => {
  let loader: ConfigLoader;
  const testDir = path.join(os.tmpdir(), '.archguard-plantuml-removal-test');

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

  describe('Config Schema Validation - Format Rejection', () => {
    it('should reject "plantuml" format in global config', async () => {
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

      await expect(loader.load()).rejects.toThrow(/Invalid enum value|plantuml/);
    });

    it('should reject "svg" format in global config', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [
          {
            name: 'overview',
            sources: ['./src'],
            level: 'class',
          },
        ],
        format: 'svg',
      });

      await expect(loader.load()).rejects.toThrow(/Invalid enum value|svg/);
    });

    it('should reject "plantuml" format in diagram config', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [
          {
            name: 'overview',
            sources: ['./src'],
            level: 'class',
            format: 'plantuml',
          },
        ],
      });

      await expect(loader.load()).rejects.toThrow(/Invalid enum value|plantuml/);
    });

    it('should reject "svg" format in diagram config', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [
          {
            name: 'overview',
            sources: ['./src'],
            level: 'class',
            format: 'svg',
          },
        ],
      });

      await expect(loader.load()).rejects.toThrow(/Invalid enum value|svg/);
    });

    it('should accept "mermaid" format', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [
          {
            name: 'overview',
            sources: ['./src'],
            level: 'class',
          },
        ],
        format: 'mermaid',
      });

      const config = await loader.load();
      expect(config.format).toBe('mermaid');
    });

    it('should accept "json" format', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [
          {
            name: 'overview',
            sources: ['./src'],
            level: 'class',
          },
        ],
        format: 'json',
      });

      const config = await loader.load();
      expect(config.format).toBe('json');
    });

    it('should default to "mermaid" format when not specified', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [
          {
            name: 'overview',
            sources: ['./src'],
            level: 'class',
          },
        ],
      });

      const config = await loader.load();
      expect(config.format).toBe('mermaid');
    });
  });

  describe('CLI Options Format Validation', () => {
    it('should reject "plantuml" format via CLI override', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [
          {
            name: 'overview',
            sources: ['./src'],
            level: 'class',
          },
        ],
      });

      await expect(loader.load({ format: 'plantuml' as any })).rejects.toThrow(
        /Invalid enum value|plantuml/
      );
    });

    it('should reject "svg" format via CLI override', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [
          {
            name: 'overview',
            sources: ['./src'],
            level: 'class',
          },
        ],
      });

      await expect(loader.load({ format: 'svg' as any })).rejects.toThrow(/Invalid enum value|svg/);
    });

    it('should accept "mermaid" format via CLI override', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [
          {
            name: 'overview',
            sources: ['./src'],
            level: 'class',
          },
        ],
        format: 'json',
      });

      const config = await loader.load({ format: 'mermaid' });
      expect(config.format).toBe('mermaid');
    });
  });

  describe('TypeScript Type System', () => {
    it('should only allow "mermaid" and "json" as valid format types', async () => {
      // This test verifies the type system at runtime
      const validFormats: Array<'mermaid' | 'json'> = ['mermaid', 'json'];

      for (const format of validFormats) {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          diagrams: [
            {
              name: 'overview',
              sources: ['./src'],
              level: 'class',
            },
          ],
          format,
        });

        const config = await loader.load();
        expect(config.format).toBe(format);

        await fs.remove(configPath);
      }
    });
  });

  describe('Error Messages', () => {
    it('should provide helpful error message for PlantUML format', async () => {
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

      await expect(loader.load()).rejects.toThrow(/mermaid|json/);
    });

    it('should provide helpful error message for SVG format', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [
          {
            name: 'overview',
            sources: ['./src'],
            level: 'class',
          },
        ],
        format: 'svg',
      });

      await expect(loader.load()).rejects.toThrow(/mermaid|json/);
    });

    it('should indicate validation error', async () => {
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

      await expect(loader.load()).rejects.toThrow(/Configuration validation failed/);
    });
  });
});
