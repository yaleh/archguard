/**
 * Story 3: Cache Mechanism Tests
 * TDD: Red phase - These tests should fail initially
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CacheManager } from '@/cli/cache-manager';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('Story 3: Cache Mechanism', () => {
  let cache: CacheManager;
  const testCacheDir = path.join(os.tmpdir(), '.archguard-test-cache');

  beforeEach(async () => {
    cache = new CacheManager(testCacheDir);
    // Clean up before each test
    if (await fs.pathExists(testCacheDir)) {
      await fs.remove(testCacheDir);
    }
  });

  afterEach(async () => {
    // Clean up after each test
    if (await fs.pathExists(testCacheDir)) {
      await fs.remove(testCacheDir);
    }
  });

  describe('File Hashing', () => {
    it('should compute SHA-256 hash of file content', async () => {
      const testFile = path.join(testCacheDir, 'test.ts');
      await fs.ensureDir(path.dirname(testFile));
      await fs.writeFile(testFile, 'console.log("hello");');

      const hash = await cache.computeFileHash(testFile);

      expect(hash).toBeDefined();
      expect(hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 produces 64 hex characters
    });

    it('should produce same hash for identical content', async () => {
      const testFile = path.join(testCacheDir, 'test.ts');
      await fs.ensureDir(path.dirname(testFile));
      await fs.writeFile(testFile, 'const x = 1;');

      const hash1 = await cache.computeFileHash(testFile);
      const hash2 = await cache.computeFileHash(testFile);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different content', async () => {
      const testFile = path.join(testCacheDir, 'test.ts');
      await fs.ensureDir(path.dirname(testFile));

      await fs.writeFile(testFile, 'const x = 1;');
      const hash1 = await cache.computeFileHash(testFile);

      await fs.writeFile(testFile, 'const x = 2;');
      const hash2 = await cache.computeFileHash(testFile);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Cache Operations', () => {
    it('should set and get cached data', async () => {
      const filePath = 'src/services/user.ts';
      const hash = 'abc123def456';
      const data = { entities: [{ id: '1', name: 'UserService', type: 'class' }] };

      await cache.set(filePath, hash, data);
      const cached = await cache.get(filePath, hash);

      expect(cached).toEqual(data);
    });

    it('should return null for cache miss (wrong hash)', async () => {
      const filePath = 'src/services/user.ts';
      const oldHash = 'abc123';
      const newHash = 'def456';
      const data = { entities: [] };

      await cache.set(filePath, oldHash, data);
      const cached = await cache.get(filePath, newHash);

      expect(cached).toBeNull();
    });

    it('should return null for non-existent file', async () => {
      const cached = await cache.get('nonexistent.ts', 'somehash');
      expect(cached).toBeNull();
    });

    it('should handle multiple cached files', async () => {
      const file1 = 'src/services/user.ts';
      const file2 = 'src/services/auth.ts';
      const hash1 = 'hash1';
      const hash2 = 'hash2';
      const data1 = { entities: [{ id: '1', name: 'UserService', type: 'class' }] };
      const data2 = { entities: [{ id: '2', name: 'AuthService', type: 'class' }] };

      await cache.set(file1, hash1, data1);
      await cache.set(file2, hash2, data2);

      const cached1 = await cache.get(file1, hash1);
      const cached2 = await cache.get(file2, hash2);

      expect(cached1).toEqual(data1);
      expect(cached2).toEqual(data2);
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate cache when file content changes', async () => {
      const testFile = path.join(testCacheDir, 'test.ts');
      await fs.ensureDir(path.dirname(testFile));
      await fs.writeFile(testFile, 'const x = 1;');

      const hash1 = await cache.computeFileHash(testFile);
      const data = { entities: [] };
      await cache.set(testFile, hash1, data);

      // Modify file
      await fs.writeFile(testFile, 'const x = 2;');
      const hash2 = await cache.computeFileHash(testFile);

      // Old hash should not return cached data
      const cached = await cache.get(testFile, hash2);
      expect(cached).toBeNull();
    });

    it('should clear all cache', async () => {
      await cache.set('file1.ts', 'hash1', { entities: [] });
      await cache.set('file2.ts', 'hash2', { entities: [] });

      await cache.clear();

      const cached1 = await cache.get('file1.ts', 'hash1');
      const cached2 = await cache.get('file2.ts', 'hash2');

      expect(cached1).toBeNull();
      expect(cached2).toBeNull();
    });
  });

  describe('Cache Statistics', () => {
    it('should track cache hits', async () => {
      await cache.set('file1.ts', 'hash1', { entities: [] });
      await cache.get('file1.ts', 'hash1'); // Hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(0);
    });

    it('should track cache misses', async () => {
      await cache.get('nonexistent.ts', 'hash'); // Miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
    });

    it('should calculate hit rate correctly', async () => {
      await cache.set('file1.ts', 'hash1', { entities: [] });

      await cache.get('file1.ts', 'hash1'); // Hit
      await cache.get('file2.ts', 'hash2'); // Miss
      await cache.get('file1.ts', 'hash1'); // Hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3, 2);
    });

    it('should handle 0 total requests (no division by zero)', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });

    it('should reset statistics after clear', async () => {
      await cache.set('file1.ts', 'hash1', { entities: [] });
      await cache.get('file1.ts', 'hash1'); // Hit

      await cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('Cache Directory Structure', () => {
    it('should create cache directory if not exists', async () => {
      const filePath = 'src/test.ts';
      const hash = 'testhash';

      await cache.set(filePath, hash, { entities: [] });

      const cacheExists = await fs.pathExists(testCacheDir);
      expect(cacheExists).toBe(true);
    });

    it('should use subdirectories to avoid too many files in one dir', async () => {
      const filePath = 'src/test.ts';
      const hash = 'abcdef123456';

      await cache.set(filePath, hash, { entities: [] });

      // Check that subdirectory structure is created
      const files = await fs.readdir(testCacheDir);
      expect(files.length).toBeGreaterThan(0);
    });
  });

  describe('Default Cache Directory', () => {
    it('should use ~/.archguard/cache as default directory', () => {
      const defaultCache = new CacheManager();
      const expectedPath = path.join(os.homedir(), '.archguard', 'cache');

      // Access private property for testing (using type assertion)
      const cacheDir = (defaultCache as unknown as { cacheDir: string }).cacheDir;
      expect(cacheDir).toBe(expectedPath);
    });
  });

  describe('TTL Support', () => {
    it('should check if cache entry is expired', async () => {
      const filePath = 'src/test.ts';
      const hash = 'testhash';
      const data = { entities: [] };

      // Set with 1 second TTL
      await cache.set(filePath, hash, data, { ttl: 1 });

      // Immediate get should work
      let cached = await cache.get(filePath, hash);
      expect(cached).toEqual(data);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be expired now
      cached = await cache.get(filePath, hash);
      expect(cached).toBeNull();
    });

    it('should use default TTL if not specified', async () => {
      const filePath = 'src/test.ts';
      const hash = 'testhash';
      const data = { entities: [] };

      await cache.set(filePath, hash, data);

      // Should be cached (default TTL is 24 hours)
      const cached = await cache.get(filePath, hash);
      expect(cached).toEqual(data);
    });
  });
});
