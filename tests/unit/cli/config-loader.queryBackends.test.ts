/**
 * TASK-22.2: queryBackends configuration schema tests
 *
 * Covers proposal phases 1-5 (config surface only):
 * - queryBackends is optional; omitting it is equivalent to default (primary: archguard).
 * - zod schema fills defaults for codebaseMemory sub-fields.
 * - illegal values are rejected.
 * - explicit CLI/MCP options override config file values (CLI > config > default).
 *
 * Design doc: docs/proposals/proposal-codebase-memory-backend-adapter.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigLoader } from '@/cli/config-loader';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('TASK-22.2: queryBackends configuration', () => {
  let loader: ConfigLoader;
  const testDir = path.join(os.tmpdir(), '.archguard-querybackends-test');

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

  describe('Phase A: optional + default equivalence', () => {
    it('should not require queryBackends (omitted is valid)', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'overview', sources: ['./src'], level: 'class' }],
      });

      const config = await loader.load();

      // Omitting queryBackends must not throw and must not inject a value.
      expect(config.queryBackends).toBeUndefined();
    });

    it('should behave as primary: archguard when queryBackends is omitted', async () => {
      const config = await loader.load();

      // Default behavior: equivalent to primary archguard, no fallback configured.
      const primary = config.queryBackends?.primary ?? 'archguard';
      expect(primary).toBe('archguard');
      expect(config.queryBackends?.fallback).toBeUndefined();
    });
  });

  describe('Phase B: zod schema, default filling, rejection, precedence', () => {
    it('should fill codebaseMemory defaults when queryBackends is partially provided', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        queryBackends: {
          primary: 'archguard',
          fallback: 'codebase-memory',
          codebaseMemory: {},
        },
      });

      const config = await loader.load();

      expect(config.queryBackends?.primary).toBe('archguard');
      expect(config.queryBackends?.fallback).toBe('codebase-memory');
      const cbm = config.queryBackends?.codebaseMemory;
      expect(cbm).toBeDefined();
      expect(cbm?.command).toBe('codebase-memory-mcp');
      expect(cbm?.project).toBe('auto');
      expect(cbm?.autoIndex).toBe(false);
      expect(cbm?.timeoutMs).toBe(10000);
      expect(cbm?.maxResults).toBe(20);
    });

    it('should default primary to archguard when queryBackends provided without primary', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        queryBackends: {
          fallback: 'codebase-memory',
        },
      });

      const config = await loader.load();

      expect(config.queryBackends?.primary).toBe('archguard');
    });

    it('should accept all valid backend enum values for primary', async () => {
      for (const primary of ['archguard', 'codebase-memory', 'auto'] as const) {
        const configPath = path.join(testDir, 'archguard.config.json');
        await fs.writeJson(configPath, { queryBackends: { primary } });
        const config = await loader.load();
        expect(config.queryBackends?.primary).toBe(primary);
      }
    });

    it('should reject an invalid primary backend value', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        queryBackends: { primary: 'not-a-backend' },
      });

      await expect(loader.load()).rejects.toThrow(/queryBackends/);
    });

    it('should reject an invalid fallback backend value', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        queryBackends: { fallback: 'mystery' },
      });

      await expect(loader.load()).rejects.toThrow(/queryBackends/);
    });

    it('should reject non-numeric timeoutMs', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        queryBackends: { codebaseMemory: { timeoutMs: 'soon' } },
      });

      await expect(loader.load()).rejects.toThrow(/queryBackends/);
    });

    it('should let explicit CLI/MCP options override config file queryBackends', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        queryBackends: { primary: 'archguard', fallback: 'codebase-memory' },
      });

      const config = await loader.load({
        queryBackends: { primary: 'codebase-memory' },
      });

      // CLI > config: primary overridden, fallback retained from config merge.
      expect(config.queryBackends?.primary).toBe('codebase-memory');
      expect(config.queryBackends?.fallback).toBe('codebase-memory');
    });
  });

  describe('Backward compatibility', () => {
    it('should not affect existing config fields when queryBackends absent', async () => {
      const configPath = path.join(testDir, 'archguard.config.json');
      await fs.writeJson(configPath, {
        diagrams: [{ name: 'test', sources: ['./src'], level: 'class' }],
        format: 'json',
      });

      const config = await loader.load();

      expect(config.format).toBe('json');
      expect(config.diagrams).toHaveLength(1);
      expect(config.queryBackends).toBeUndefined();
    });
  });
});
