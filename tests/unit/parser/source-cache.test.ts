import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SourceCache } from '@/parser/source-cache';
import type { TypeScriptParser } from '@/parser';
import type { ArchJSON } from '@/types/index.js';

// Synthetic result returned by the mocked parser — cache logic doesn't care about content
const MOCK_ARCHJSON: ArchJSON = {
  version: '1.0',
  language: 'typescript',
  timestamp: new Date().toISOString(),
  sourceFiles: ['stub.ts'],
  entities: [
    {
      id: 'Stub',
      name: 'Stub',
      type: 'class',
      members: [],
      decorators: [],
      visibility: 'public',
      sourceLocation: { file: 'stub.ts', startLine: 1, endLine: 1 },
    },
  ],
  relations: [],
};

describe('SourceCache', () => {
  let cache: SourceCache;
  let parser: TypeScriptParser;

  beforeEach(() => {
    cache = new SourceCache();
    // Use mockImplementation so each parse call returns a new object reference
    // (mirrors real parser behaviour — required for cache clear/TTL tests)
    parser = {
      parseProject: vi.fn().mockImplementation(() => Promise.resolve({ ...MOCK_ARCHJSON })),
    } as unknown as TypeScriptParser;
  });

  describe('Cache Hit and Reuse', () => {
    it('should cache and reuse ArchJSON for same sources', async () => {
      const sources = ['./src/parser'];

      // First call - should parse
      const result1 = await cache.getOrParse(sources, parser);
      expect(result1).toBeDefined();
      expect(result1.entities).toBeInstanceOf(Array);

      // Second call - should return cached
      const result2 = await cache.getOrParse(sources, parser);
      expect(result2).toBe(result1); // Same reference
    });

    it('should return same cached result across multiple calls', async () => {
      const sources = ['./src/parser'];

      const result1 = await cache.getOrParse(sources, parser);
      const result2 = await cache.getOrParse(sources, parser);
      const result3 = await cache.getOrParse(sources, parser);

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate different cache keys for different sources', async () => {
      const sources1 = ['./src/parser'];
      const sources2 = ['./src/cli'];

      const result1 = await cache.getOrParse(sources1, parser);
      const result2 = await cache.getOrParse(sources2, parser);

      expect(result1).not.toBe(result2);
    });

    it('should normalize path separators in cache key', async () => {
      const sources1 = ['./src/parser'];
      const sources2 = ['.\\src\\parser']; // Windows path

      const result1 = await cache.getOrParse(sources1, parser);
      const result2 = await cache.getOrParse(sources2, parser);

      expect(result1).toBe(result2); // Should be same cache entry
    });

    it('should sort sources for cache key generation', async () => {
      const sources1 = ['./src/parser', './src/cli'];
      const sources2 = ['./src/cli', './src/parser']; // Different order

      const result1 = await cache.getOrParse(sources1, parser);
      const result2 = await cache.getOrParse(sources2, parser);

      expect(result1).toBe(result2); // Should be same cache entry
    });
  });

  describe('TTL Expiration', () => {
    it('should invalidate cache after TTL expires', async () => {
      const shortCache = new SourceCache(100); // 100ms TTL
      const sources = ['./src/parser'];

      const result1 = await shortCache.getOrParse(sources, parser);
      await new Promise((resolve) => setTimeout(resolve, 150));

      const result2 = await shortCache.getOrParse(sources, parser);
      expect(result2).not.toBe(result1);
    });

    it('should not invalidate cache before TTL expires', async () => {
      const shortCache = new SourceCache(200); // 200ms TTL
      const sources = ['./src/parser'];

      const result1 = await shortCache.getOrParse(sources, parser);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result2 = await shortCache.getOrParse(sources, parser);
      expect(result2).toBe(result1); // Still cached
    });
  });

  describe('Cache Management', () => {
    it('should clear all cached entries', async () => {
      const sources = ['./src/parser'];

      const result1 = await cache.getOrParse(sources, parser);
      cache.clear();

      const result2 = await cache.getOrParse(sources, parser);
      expect(result2).not.toBe(result1); // New instance after clear
    });

    it('should provide cache statistics', async () => {
      const sources1 = ['./src/parser'];
      const sources2 = ['./src/cli'];

      await cache.getOrParse(sources1, parser);
      await cache.getOrParse(sources2, parser);

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.entries).toHaveLength(2);
      expect(stats.entries[0]).toHaveProperty('key');
      expect(stats.entries[0]).toHaveProperty('age');
      expect(stats.entries[0]).toHaveProperty('valid');
    });

    it('should track validity of cache entries', async () => {
      const shortCache = new SourceCache(100); // 100ms TTL
      const sources = ['./src/parser'];

      await shortCache.getOrParse(sources, parser);

      let stats = shortCache.getStats();
      expect(stats.entries[0].valid).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 150));

      stats = shortCache.getStats();
      expect(stats.entries[0].valid).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty sources array', async () => {
      const sources: string[] = [];

      const result = await cache.getOrParse(sources, parser);
      expect(result).toBeDefined();
    });

    it('should handle single source', async () => {
      const sources = ['./src/parser'];

      const result = await cache.getOrParse(sources, parser);
      expect(result).toBeDefined();
      expect(result.entities.length).toBeGreaterThan(0);
    });

    it('should handle multiple sources', async () => {
      const sources = ['./src/parser', './src/cli'];

      const result = await cache.getOrParse(sources, parser);
      expect(result).toBeDefined();
    });
  });

  describe('Debug Logging', () => {
    it('should not log when debug is disabled', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const sources = ['./src/parser'];

      await cache.getOrParse(sources, parser);

      // By default, debug mode is off
      expect(debugSpy).not.toHaveBeenCalled();

      debugSpy.mockRestore();
    });
  });
});
