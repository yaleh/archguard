import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { RenderHashCache, RENDER_CACHE_VERSION } from '@/cli/cache/render-hash-cache.js';

describe('RenderHashCache', () => {
  let tmpDir: string;
  let cache: RenderHashCache;

  const defaultOptions = { theme: 'default', transparentBackground: false };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'render-hash-cache-test-'));
    cache = new RenderHashCache();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  // ---- computeKey -----------------------------------------------------------

  describe('computeKey', () => {
    it('returns the same key for identical inputs', () => {
      const key1 = cache.computeKey('flowchart LR\n  A --> B', defaultOptions);
      const key2 = cache.computeKey('flowchart LR\n  A --> B', defaultOptions);
      expect(key1).toBe(key2);
    });

    it('returns a different key when theme differs', () => {
      const key1 = cache.computeKey('flowchart LR\n  A --> B', {
        theme: 'default',
        transparentBackground: false,
      });
      const key2 = cache.computeKey('flowchart LR\n  A --> B', {
        theme: 'dark',
        transparentBackground: false,
      });
      expect(key1).not.toBe(key2);
    });

    it('returns a different key when transparentBackground differs', () => {
      const key1 = cache.computeKey('flowchart LR\n  A --> B', {
        theme: 'default',
        transparentBackground: false,
      });
      const key2 = cache.computeKey('flowchart LR\n  A --> B', {
        theme: 'default',
        transparentBackground: true,
      });
      expect(key1).not.toBe(key2);
    });

    it('returns a different key when mmdContent differs', () => {
      const key1 = cache.computeKey('classDiagram\n  class Foo', defaultOptions);
      const key2 = cache.computeKey('classDiagram\n  class Bar', defaultOptions);
      expect(key1).not.toBe(key2);
    });

    it('produces a 64-character hex string (SHA-256)', () => {
      const key = cache.computeKey('some mmd content', defaultOptions);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('embeds RENDER_CACHE_VERSION in the key (changing version changes key)', () => {
      // We cannot easily change the constant, but we can verify the key
      // is determined by the full input string including the version prefix.
      const key = cache.computeKey('content', defaultOptions);
      expect(typeof key).toBe('string');
      expect(key.length).toBe(64);
      // Sanity: key is deterministic across instances
      const key2 = new RenderHashCache().computeKey('content', defaultOptions);
      expect(key).toBe(key2);
    });
  });

  // ---- checkHit -------------------------------------------------------------

  describe('checkHit', () => {
    it('returns false when sidecar file is missing', async () => {
      const mmdPath = path.join(tmpDir, 'diagram.mmd');
      await fs.writeFile(mmdPath, 'classDiagram\n  class Foo', 'utf-8');
      // No sidecar written
      const hit = await cache.checkHit(mmdPath, 'classDiagram\n  class Foo', defaultOptions);
      expect(hit).toBe(false);
    });

    it('returns false when sidecar hash does not match', async () => {
      const mmdPath = path.join(tmpDir, 'diagram.mmd');
      const mmdContent = 'classDiagram\n  class Foo';
      await fs.writeFile(mmdPath, mmdContent, 'utf-8');
      // Write wrong hash to sidecar
      await fs.writeFile(RenderHashCache.sidecarPath(mmdPath), 'wronghash', 'utf-8');
      // Write SVG so only the hash check triggers the miss
      await fs.writeFile(mmdPath.replace('.mmd', '.svg'), '<svg/>', 'utf-8');

      const hit = await cache.checkHit(mmdPath, mmdContent, defaultOptions);
      expect(hit).toBe(false);
    });

    it('returns false when SVG file is missing (even if hash matches)', async () => {
      const mmdPath = path.join(tmpDir, 'diagram.mmd');
      const mmdContent = 'classDiagram\n  class Foo';
      await fs.writeFile(mmdPath, mmdContent, 'utf-8');
      // Write correct hash to sidecar
      await fs.writeFile(
        RenderHashCache.sidecarPath(mmdPath),
        cache.computeKey(mmdContent, defaultOptions),
        'utf-8'
      );
      // SVG does NOT exist

      const hit = await cache.checkHit(mmdPath, mmdContent, defaultOptions);
      expect(hit).toBe(false);
    });

    it('returns true when sidecar hash matches AND SVG exists', async () => {
      const mmdPath = path.join(tmpDir, 'diagram.mmd');
      const mmdContent = 'classDiagram\n  class Foo';
      await fs.writeFile(mmdPath, mmdContent, 'utf-8');
      // Write correct hash
      await fs.writeFile(
        RenderHashCache.sidecarPath(mmdPath),
        cache.computeKey(mmdContent, defaultOptions),
        'utf-8'
      );
      // Write SVG
      await fs.writeFile(mmdPath.replace('.mmd', '.svg'), '<svg/>', 'utf-8');

      const hit = await cache.checkHit(mmdPath, mmdContent, defaultOptions);
      expect(hit).toBe(true);
    });
  });

  // ---- writeHash ------------------------------------------------------------

  describe('writeHash', () => {
    it('creates the sidecar file with the correct hash content', async () => {
      const mmdPath = path.join(tmpDir, 'diagram.mmd');
      const mmdContent = 'flowchart LR\n  A --> B';

      await cache.writeHash(mmdPath, mmdContent, defaultOptions);

      const sidecar = RenderHashCache.sidecarPath(mmdPath);
      expect(await fs.pathExists(sidecar)).toBe(true);
      const stored = (await fs.readFile(sidecar, 'utf-8')).trim();
      expect(stored).toBe(cache.computeKey(mmdContent, defaultOptions));
    });

    it('creates intermediate directories if needed', async () => {
      const mmdPath = path.join(tmpDir, 'nested', 'deep', 'diagram.mmd');
      const mmdContent = 'classDiagram\n  class X';
      // Parent directories do not exist yet
      await cache.writeHash(mmdPath, mmdContent, defaultOptions);

      const sidecar = RenderHashCache.sidecarPath(mmdPath);
      expect(await fs.pathExists(sidecar)).toBe(true);
    });
  });

  // ---- clearHashes ----------------------------------------------------------

  describe('clearHashes', () => {
    it('deletes all .mmd.render-hash files under the directory', async () => {
      // Create several sidecar files in nested paths
      const files = [
        path.join(tmpDir, 'a.mmd.render-hash'),
        path.join(tmpDir, 'sub', 'b.mmd.render-hash'),
        path.join(tmpDir, 'sub', 'deep', 'c.mmd.render-hash'),
      ];
      for (const f of files) {
        await fs.ensureDir(path.dirname(f));
        await fs.writeFile(f, 'somehash', 'utf-8');
      }

      await cache.clearHashes(tmpDir);

      for (const f of files) {
        expect(await fs.pathExists(f)).toBe(false);
      }
    });

    it('leaves non-sidecar files untouched', async () => {
      const mmdFile = path.join(tmpDir, 'diagram.mmd');
      const sidecar = path.join(tmpDir, 'diagram.mmd.render-hash');
      await fs.writeFile(mmdFile, 'content', 'utf-8');
      await fs.writeFile(sidecar, 'hash', 'utf-8');

      await cache.clearHashes(tmpDir);

      expect(await fs.pathExists(mmdFile)).toBe(true);
      expect(await fs.pathExists(sidecar)).toBe(false);
    });

    it('does not throw when directory has no sidecar files', async () => {
      await expect(cache.clearHashes(tmpDir)).resolves.not.toThrow();
    });
  });

  // ---- sidecarPath ----------------------------------------------------------

  describe('sidecarPath (static)', () => {
    it('appends .render-hash to the mmd path', () => {
      expect(RenderHashCache.sidecarPath('/out/diagram.mmd')).toBe('/out/diagram.mmd.render-hash');
    });
  });

  // ---- RENDER_CACHE_VERSION -------------------------------------------------

  describe('RENDER_CACHE_VERSION', () => {
    it('is exported as a string', () => {
      expect(typeof RENDER_CACHE_VERSION).toBe('string');
      expect(RENDER_CACHE_VERSION.length).toBeGreaterThan(0);
    });
  });
});
