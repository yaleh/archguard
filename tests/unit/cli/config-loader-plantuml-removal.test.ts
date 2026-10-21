/**
 * Config schema: PlantUML is an EMIT-ONLY output format.
 *
 * History: v2.1 removed PlantUML entirely (this file used to assert that
 * `formats: ['plantuml']` was rejected). gap-plantuml-deterministic-generation
 * reintroduced it as a deterministic `.puml` emitter, so the assertions are
 * inverted: `plantuml` is accepted everywhere a format is accepted, while
 * rendering-only formats such as `svg` remain rejected.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigLoader } from '@/cli/config-loader';
import type { OutputFormat, OutputFormats } from '@/types/config';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('PlantUML as an emit-only configuration format', () => {
  let loader: ConfigLoader;
  const testDir = path.join(os.tmpdir(), '.archguard-plantuml-emit-only-test');

  beforeEach(async () => {
    loader = new ConfigLoader(testDir);
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
  });

  describe('Config Schema Validation - PlantUML acceptance', () => {
    it('accepts "plantuml" format in global config', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'overview', sources: ['./src'], level: 'class' }],
        formats: ['plantuml'],
      });

      const config = await loader.load();
      expect(config.formats).toEqual(['plantuml']);
    });

    it('accepts "plantuml" format in diagram config', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [
          {
            name: 'overview',
            sources: ['./src'],
            level: 'class',
            formats: ['plantuml'],
          },
        ],
      });

      const config = await loader.load();
      expect(config.diagrams[0]?.formats).toEqual(['plantuml']);
    });

    it('accepts "plantuml" format via CLI override', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'overview', sources: ['./src'], level: 'class' }],
        formats: ['json'],
      });

      const config = await loader.load({ formats: ['plantuml'] });
      expect(config.formats).toEqual(['plantuml']);
    });

    it('does not enable a renderer for the emit-only plantuml format', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'overview', sources: ['./src'], level: 'class' }],
        formats: ['plantuml'],
      });

      const config = await loader.load();
      // Emit-only: format is plantuml, but the mermaid renderer settings stay at
      // their defaults and are never consulted by the plantuml output path.
      expect(config.formats).toEqual(['plantuml']);
      expect(config.mermaid.renderer).toBe('isomorphic');
    });
  });

  describe('Config Schema Validation - still rejects rendering-only formats', () => {
    it('rejects "svg" format in global config', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'overview', sources: ['./src'], level: 'class' }],
        formats: ['svg'],
      });

      await expect(loader.load()).rejects.toThrow(/Invalid enum value|Invalid option|svg/);
    });

    it('rejects "svg" format in diagram config', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [
          {
            name: 'overview',
            sources: ['./src'],
            level: 'class',
            formats: ['svg'],
          },
        ],
      });

      await expect(loader.load()).rejects.toThrow(/Invalid enum value|Invalid option|svg/);
    });

    it('rejects "svg" format via CLI override', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'overview', sources: ['./src'], level: 'class' }],
      });

      await expect(loader.load({ formats: ['svg'] as unknown as OutputFormats })).rejects.toThrow(
        /Invalid enum value|Invalid option|svg/
      );
    });
  });

  describe('Existing formats keep working', () => {
    it('accepts "mermaid" format', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'overview', sources: ['./src'], level: 'class' }],
        formats: ['mermaid'],
      });

      const config = await loader.load();
      expect(config.formats).toEqual(['mermaid']);
    });

    it('accepts "json" format', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'overview', sources: ['./src'], level: 'class' }],
        formats: ['json'],
      });

      const config = await loader.load();
      expect(config.formats).toEqual(['json']);
    });

    it('defaults to "mermaid" format when not specified', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'overview', sources: ['./src'], level: 'class' }],
      });

      const config = await loader.load();
      expect(config.formats).toEqual(['mermaid']);
    });
  });

  describe('TypeScript Type System', () => {
    it('allows "mermaid", "json" and emit-only "plantuml" as valid format types', async () => {
      const validFormats: OutputFormat[] = ['mermaid', 'json', 'plantuml'];

      for (const format of validFormats) {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, {
          diagrams: [{ name: 'overview', sources: ['./src'], level: 'class' }],
          formats: [format],
        });

        const config = await loader.load();
        expect(config.formats).toEqual([format]);

        await fs.remove(configPath);
      }
    });
  });
});
