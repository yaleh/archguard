import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { ArchJsonDiskCache } from '@/cli/cache/arch-json-disk-cache.js';
import type { ArchJSON } from '@/types/index.js';

describe('ArchJsonDiskCache', () => {
  let cacheDir: string;
  let cache: ArchJsonDiskCache;

  const mockArchJson: ArchJSON = {
    version: '1.0',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities: [{ id: 'e1', name: 'Foo', type: 'class' } as any],
    relations: [],
  };

  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arch-json-cache-test-'));
    cache = new ArchJsonDiskCache(cacheDir);
  });

  afterEach(async () => {
    await fs.remove(cacheDir);
  });

  it('returns null on cache miss', async () => {
    const result = await cache.get('nonexistent-key');
    expect(result).toBeNull();
  });

  it('round-trips ArchJSON through set/get', async () => {
    await cache.set('test-key-123', mockArchJson);
    const result = await cache.get('test-key-123');
    expect(result).not.toBeNull();
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].id).toBe('e1');
    expect(result.language).toBe('typescript');
  });

  it('returns null for corrupted cache entry', async () => {
    // Write a corrupted file at the expected path
    const keyDir = path.join(cacheDir, 'te');
    await fs.ensureDir(keyDir);
    await fs.writeFile(path.join(keyDir, 'test-key-corrupt.json'), 'not-json{{{');
    const result = await cache.get('test-key-corrupt');
    expect(result).toBeNull();
  });

  it('returns null for cache entry with wrong version', async () => {
    // Write a file with old version
    const key = 'test-key-oldver';
    const keyDir = path.join(cacheDir, key.slice(0, 2));
    await fs.ensureDir(keyDir);
    await fs.writeJson(path.join(keyDir, `${key}.json`), {
      version: 'v0.0.0-old',
      createdAt: new Date().toISOString(),
      archJson: mockArchJson,
    });
    const result = await cache.get(key);
    expect(result).toBeNull();
  });

  it('computeKey returns consistent hash for same files', async () => {
    // Create two temp files with known content
    const file1 = path.join(cacheDir, 'a.ts');
    const file2 = path.join(cacheDir, 'b.ts');
    await fs.writeFile(file1, 'export class A {}');
    await fs.writeFile(file2, 'export class B {}');

    const key1 = await cache.computeKey([file1, file2]);
    const key2 = await cache.computeKey([file2, file1]); // different order
    expect(key1).toBe(key2); // order-independent
    expect(key1).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });

  it('computeKey changes when file content changes', async () => {
    const file = path.join(cacheDir, 'x.ts');
    await fs.writeFile(file, 'export class X {}');
    const key1 = await cache.computeKey([file]);

    await fs.writeFile(file, 'export class X { method() {} }');
    const key2 = await cache.computeKey([file]);

    expect(key1).not.toBe(key2);
  });

  it('clear() removes all cache entries', async () => {
    await cache.set('key1', mockArchJson);
    await cache.set('key2', mockArchJson);
    await cache.clear();
    expect(await cache.get('key1')).toBeNull();
    expect(await cache.get('key2')).toBeNull();
  });
});
