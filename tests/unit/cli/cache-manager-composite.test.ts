import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { CacheManager } from '@/cli/cache-manager.js';
import type { TestAnalysis } from '@/types/extensions.js';

const makeTestAnalysis = (): TestAnalysis => ({
  version: '1.0',
  patternConfigSource: 'auto',
  testFiles: [],
  coverageMap: [],
  issues: [],
  metrics: {
    totalTestFiles: 2,
    byType: { unit: 2, integration: 0, e2e: 0, performance: 0, debug: 0, unknown: 0 },
    entityCoverageRatio: 0.5,
    assertionDensity: 3.0,
    skipRatio: 0.0,
    issueCount: {
      zero_assertion: 0,
      orphan_test: 0,
      skip_accumulation: 0,
      assertion_poverty: 0,
    },
  },
});

describe('CacheManager composite key', () => {
  let cache: CacheManager;
  const testCacheDir = path.join(os.tmpdir(), `.archguard-composite-cache-${Date.now()}`);

  beforeEach(async () => {
    cache = new CacheManager(testCacheDir);
    await fs.ensureDir(testCacheDir);
  });

  afterEach(async () => {
    await fs.remove(testCacheDir);
  });

  describe('getCompositeKey', () => {
    it('returns a 16-character hex string', () => {
      const key = cache.getCompositeKey(['a.ts', 'b.ts'], 'config-blob');
      expect(key).toMatch(/^[a-f0-9]{16}$/);
    });

    it('returns the same key for the same inputs', () => {
      const key1 = cache.getCompositeKey(['a.ts', 'b.ts'], 'config');
      const key2 = cache.getCompositeKey(['a.ts', 'b.ts'], 'config');
      expect(key1).toBe(key2);
    });

    it('returns different keys for different config blobs', () => {
      const key1 = cache.getCompositeKey(['a.ts', 'b.ts'], 'config-A');
      const key2 = cache.getCompositeKey(['a.ts', 'b.ts'], 'config-B');
      expect(key1).not.toBe(key2);
    });

    it('returns different keys for different file sets', () => {
      const key1 = cache.getCompositeKey(['a.ts'], 'config');
      const key2 = cache.getCompositeKey(['b.ts'], 'config');
      expect(key1).not.toBe(key2);
    });

    it('is order-insensitive for file list', () => {
      const key1 = cache.getCompositeKey(['a.ts', 'b.ts'], 'config');
      const key2 = cache.getCompositeKey(['b.ts', 'a.ts'], 'config');
      expect(key1).toBe(key2);
    });

    it('invalidates cache when patternConfig changes', () => {
      const files = ['tests/foo.test.ts', 'tests/bar.test.ts'];
      const keyWithDefault = cache.getCompositeKey(files, 'auto');
      const keyWithCustom = cache.getCompositeKey(files, JSON.stringify({ assertionPatterns: ['expect'] }));
      expect(keyWithDefault).not.toBe(keyWithCustom);
    });
  });

  describe('loadCachedTestAnalysis / saveCachedTestAnalysis', () => {
    it('returns null on cache miss', async () => {
      const result = await cache.loadCachedTestAnalysis('nonexistent-key');
      expect(result).toBeNull();
    });

    it('saves and loads a TestAnalysis', async () => {
      const analysis = makeTestAnalysis();
      const key = cache.getCompositeKey(['file.ts'], 'auto');
      await cache.saveCachedTestAnalysis(key, analysis);
      const loaded = await cache.loadCachedTestAnalysis(key);
      expect(loaded).not.toBeNull();
      expect(loaded?.version).toBe('1.0');
      expect(loaded?.metrics.totalTestFiles).toBe(2);
    });

    it('returns null when a different key is queried', async () => {
      const analysis = makeTestAnalysis();
      const key1 = cache.getCompositeKey(['file.ts'], 'config-A');
      const key2 = cache.getCompositeKey(['file.ts'], 'config-B');
      await cache.saveCachedTestAnalysis(key1, analysis);
      const result = await cache.loadCachedTestAnalysis(key2);
      expect(result).toBeNull();
    });
  });
});
