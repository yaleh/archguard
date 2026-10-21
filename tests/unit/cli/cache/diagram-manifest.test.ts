import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  readManifest,
  writeManifest,
  mergeManifest,
  cleanStaleDiagrams,
  clearRenderHashes,
  MANIFEST_VERSION,
  MANIFEST_FILENAME,
  type DiagramManifest,
} from '@/cli/cache/diagram-manifest.js';

describe('diagram-manifest', () => {
  let tmpDir: string;
  let cacheDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diagram-manifest-test-'));
    cacheDir = path.join(tmpDir, 'cache');
    outputDir = path.join(tmpDir, 'output');
    await fs.ensureDir(cacheDir);
    await fs.ensureDir(outputDir);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  // ── readManifest ───────────────────────────────────────────────────────────

  describe('readManifest', () => {
    it('returns null when file does not exist', async () => {
      const result = await readManifest(cacheDir);
      expect(result).toBeNull();
    });

    it('returns null for corrupted JSON', async () => {
      await fs.writeFile(path.join(cacheDir, MANIFEST_FILENAME), 'not-valid-json{{{');
      const result = await readManifest(cacheDir);
      expect(result).toBeNull();
    });

    it('returns null for JSON with wrong version', async () => {
      await fs.writeJson(path.join(cacheDir, MANIFEST_FILENAME), {
        version: '0.0',
        lastRun: new Date().toISOString(),
        outputDir: '/some/dir',
        diagrams: ['overview/package'],
      });
      const result = await readManifest(cacheDir);
      expect(result).toBeNull();
    });

    it('returns null when diagrams field is missing', async () => {
      await fs.writeJson(path.join(cacheDir, MANIFEST_FILENAME), {
        version: MANIFEST_VERSION,
        lastRun: new Date().toISOString(),
        outputDir: '/some/dir',
        // no diagrams field
      });
      const result = await readManifest(cacheDir);
      expect(result).toBeNull();
    });
  });

  // ── writeManifest + readManifest round-trip ────────────────────────────────

  describe('writeManifest + readManifest', () => {
    it('round-trips successfully', async () => {
      const diagrams = ['overview/package', 'class/all-classes', 'method/core'];
      await writeManifest(cacheDir, diagrams, outputDir);

      const result = await readManifest(cacheDir);
      expect(result).not.toBeNull();
      expect(result.version).toBe(MANIFEST_VERSION);
      expect(result.diagrams).toEqual(diagrams);
      expect(result.outputDir).toBe(outputDir);
      expect(result.lastRun).toBeTruthy();
    });

    it('creates cacheDir if it does not exist', async () => {
      const newCacheDir = path.join(tmpDir, 'new-cache');
      await writeManifest(newCacheDir, ['overview/package'], outputDir);
      expect(await fs.pathExists(path.join(newCacheDir, MANIFEST_FILENAME))).toBe(true);
    });

    it('normalizes outputDir to an absolute path', async () => {
      const relativeOutputDir = path.relative(process.cwd(), outputDir);
      await writeManifest(cacheDir, ['overview/package'], relativeOutputDir);

      const result = await readManifest(cacheDir);
      expect(result?.outputDir).toBe(path.resolve(relativeOutputDir));
    });

    it('records per-diagram output artifacts and drops entries for other diagrams', async () => {
      const mmdA = path.join(outputDir, 'class', 'A_Layer.mmd');
      const mmdB = path.join(outputDir, 'class', 'B_Layer.mmd');
      await writeManifest(cacheDir, ['class/all-classes'], outputDir, {
        'class/all-classes': [mmdA, mmdB],
        'other/diagram': [path.join(outputDir, 'other.mmd')],
      });

      const result = await readManifest(cacheDir);
      expect(result?.outputs).toEqual({ 'class/all-classes': [mmdA, mmdB] });
    });

    it('omits outputs when none were provided (backward compatibility)', async () => {
      await writeManifest(cacheDir, ['overview/package'], outputDir);

      const result = await readManifest(cacheDir);
      expect(result?.outputs).toBeUndefined();
    });
  });

  // ── mergeManifest ──────────────────────────────────────────────────────────

  describe('mergeManifest', () => {
    it('creates a manifest when none exists', async () => {
      const mmd = path.join(outputDir, 'class', 'A_Layer.mmd');
      await mergeManifest(cacheDir, ['class/all-classes'], outputDir, {
        'class/all-classes': [mmd],
      });

      const result = await readManifest(cacheDir);
      expect(result?.diagrams).toEqual(['class/all-classes']);
      expect(result?.outputs).toEqual({ 'class/all-classes': [mmd] });
      expect(result?.lastRun).toBeTruthy();
    });

    it('preserves existing entries and refreshes lastRun', async () => {
      await fs.writeJson(path.join(cacheDir, MANIFEST_FILENAME), {
        version: MANIFEST_VERSION,
        lastRun: '2026-01-01T00:00:00.000Z',
        outputDir,
        diagrams: ['overview/package', 'class/all-classes'],
        outputs: {
          'overview/package': [path.join(outputDir, 'overview', 'package.mmd')],
        },
      });
      const before = Date.now();

      const partialMmd = path.join(outputDir, 'class', 'A_Layer.mmd');
      await mergeManifest(cacheDir, ['class/all-classes'], outputDir, {
        'class/all-classes': [partialMmd],
      });

      const result = await readManifest(cacheDir);
      expect(result?.diagrams).toEqual(['overview/package', 'class/all-classes']);
      // Existing entry survives instead of the partial run overwriting the list.
      expect(result?.outputs?.['overview/package']).toEqual([
        path.join(outputDir, 'overview', 'package.mmd'),
      ]);
      expect(result?.outputs?.['class/all-classes']).toEqual([partialMmd]);
      expect(new Date(result.lastRun).getTime()).toBeGreaterThanOrEqual(before);
    });

    it('appends a new diagram to the existing entry list', async () => {
      await writeManifest(cacheDir, ['overview/package'], outputDir);

      await mergeManifest(cacheDir, ['method/core'], outputDir);

      const result = await readManifest(cacheDir);
      expect(result?.diagrams).toEqual(['overview/package', 'method/core']);
    });

    it('replaces the outputs of a diagram that runs again', async () => {
      await writeManifest(cacheDir, ['class/all-classes'], outputDir, {
        'class/all-classes': [path.join(outputDir, 'old.mmd')],
      });

      const replacement = path.join(outputDir, 'class', 'New_Layer.mmd');
      await mergeManifest(cacheDir, ['class/all-classes'], outputDir, {
        'class/all-classes': [replacement],
      });

      const result = await readManifest(cacheDir);
      expect(result?.outputs?.['class/all-classes']).toEqual([replacement]);
      // Same entry, not duplicated.
      expect(result?.diagrams).toEqual(['class/all-classes']);
    });

    it('does not delete files for diagrams that did not participate', async () => {
      const untouched = path.join(outputDir, 'overview', 'package.mmd');
      await fs.ensureDir(path.dirname(untouched));
      await fs.writeFile(untouched, 'graph LR\n  A');
      await writeManifest(cacheDir, ['overview/package'], outputDir, {
        'overview/package': [untouched],
      });

      await mergeManifest(cacheDir, ['class/all-classes'], outputDir);

      expect(await fs.pathExists(untouched)).toBe(true);
      const result = await readManifest(cacheDir);
      expect(result?.diagrams).toContain('overview/package');
    });
  });

  // ── cleanStaleDiagrams ─────────────────────────────────────────────────────

  describe('cleanStaleDiagrams', () => {
    function makeManifest(diagrams: string[]): DiagramManifest {
      return {
        version: MANIFEST_VERSION,
        lastRun: new Date().toISOString(),
        outputDir,
        diagrams,
      };
    }

    it('returns empty array when no stale diagrams', async () => {
      const manifest = makeManifest(['overview/package', 'class/all-classes']);
      const stale = await cleanStaleDiagrams(
        ['overview/package', 'class/all-classes'],
        manifest,
        outputDir
      );
      expect(stale).toHaveLength(0);
    });

    it('removes mmd/svg/png/render-hash files for stale diagrams', async () => {
      // Create stale files
      const staleBase = path.join(outputDir, 'old-diagram');
      await fs.ensureDir(path.dirname(staleBase));
      await fs.writeFile(`${staleBase}.mmd`, 'graph LR\n  A --> B');
      await fs.writeFile(`${staleBase}.mmd.render-hash`, 'abc123');
      await fs.writeFile(`${staleBase}.svg`, '<svg/>');
      await fs.writeFile(`${staleBase}.png`, 'PNG_DATA');

      const manifest = makeManifest(['old-diagram']);
      const stale = await cleanStaleDiagrams([], manifest, outputDir);

      expect(stale).toEqual(['old-diagram']);
      expect(await fs.pathExists(`${staleBase}.mmd`)).toBe(false);
      expect(await fs.pathExists(`${staleBase}.mmd.render-hash`)).toBe(false);
      expect(await fs.pathExists(`${staleBase}.svg`)).toBe(false);
      expect(await fs.pathExists(`${staleBase}.png`)).toBe(false);
    });

    it('does NOT remove files for current diagrams', async () => {
      // Create a "current" diagram's files
      const keepDir = path.join(outputDir, 'overview');
      await fs.ensureDir(keepDir);
      await fs.writeFile(path.join(keepDir, 'package.mmd'), 'graph LR\n  A --> B');
      await fs.writeFile(path.join(keepDir, 'package.svg'), '<svg/>');

      // Also create a stale one
      await fs.ensureDir(path.join(outputDir, 'old'));
      await fs.writeFile(path.join(outputDir, 'old', 'diagram.mmd'), 'graph LR\n  X --> Y');

      const manifest = makeManifest(['overview/package', 'old/diagram']);
      const stale = await cleanStaleDiagrams(['overview/package'], manifest, outputDir);

      expect(stale).toEqual(['old/diagram']);
      // Current diagram files intact
      expect(await fs.pathExists(path.join(keepDir, 'package.mmd'))).toBe(true);
      expect(await fs.pathExists(path.join(keepDir, 'package.svg'))).toBe(true);
      // Stale diagram file removed
      expect(await fs.pathExists(path.join(outputDir, 'old', 'diagram.mmd'))).toBe(false);
    });

    it('is safe when stale files do not exist on disk', async () => {
      const manifest = makeManifest(['ghost/diagram']);
      // No actual files on disk — should not throw
      const stale = await cleanStaleDiagrams([], manifest, outputDir);
      expect(stale).toEqual(['ghost/diagram']);
    });

    it('removes .json file for stale diagrams', async () => {
      const staleBase = path.join(outputDir, 'overview', 'package');
      await fs.ensureDir(path.dirname(staleBase));
      await fs.writeFile(`${staleBase}.json`, '{"version":"1.0"}');

      const manifest = makeManifest(['overview/package']);
      const stale = await cleanStaleDiagrams([], manifest, outputDir);

      expect(stale).toEqual(['overview/package']);
      expect(await fs.pathExists(`${staleBase}.json`)).toBe(false);
    });

    it('removes Atlas json sidecar file for stale diagrams', async () => {
      const atlasDir = path.join(outputDir, 'arch');
      await fs.ensureDir(atlasDir);
      await fs.writeFile(path.join(atlasDir, 'architecture-atlas.json'), '{"layers":[]}');

      const manifest = makeManifest(['arch/architecture']);
      const stale = await cleanStaleDiagrams([], manifest, outputDir);

      expect(stale).toEqual(['arch/architecture']);
      expect(await fs.pathExists(path.join(atlasDir, 'architecture-atlas.json'))).toBe(false);
    });

    it('removes Atlas layer .mmd and .mmd.render-hash files', async () => {
      // Simulate Atlas layers: name-package.mmd, name-capability.mmd
      const atlasDir = path.join(outputDir, 'arch');
      await fs.ensureDir(atlasDir);
      await fs.writeFile(path.join(atlasDir, 'architecture-package.mmd'), 'graph LR\n  P');
      await fs.writeFile(path.join(atlasDir, 'architecture-package.mmd.render-hash'), 'hash1');
      await fs.writeFile(path.join(atlasDir, 'architecture-capability.mmd'), 'graph LR\n  C');

      const manifest = makeManifest(['arch/architecture']);
      const stale = await cleanStaleDiagrams([], manifest, outputDir);

      expect(stale).toEqual(['arch/architecture']);
      expect(await fs.pathExists(path.join(atlasDir, 'architecture-package.mmd'))).toBe(false);
      expect(await fs.pathExists(path.join(atlasDir, 'architecture-package.mmd.render-hash'))).toBe(
        false
      );
      expect(await fs.pathExists(path.join(atlasDir, 'architecture-capability.mmd'))).toBe(false);
    });

    it('removes split outputs recorded in the manifest (names not derived from the diagram)', async () => {
      const classDir = path.join(outputDir, 'quay', 'class');
      await fs.ensureDir(classDir);
      const quayLayer = path.join(classDir, 'Quay_Layer.mmd');
      const scriptsLayer = path.join(classDir, 'Scripts_Layer.mmd');
      await fs.writeFile(quayLayer, 'classDiagram\n  class A');
      await fs.writeFile(`${quayLayer}.render-hash`, 'hash');
      await fs.writeFile(path.join(classDir, 'Quay_Layer.svg'), '<svg/>');
      await fs.writeFile(scriptsLayer, 'classDiagram\n  class B');

      const manifest: DiagramManifest = {
        ...makeManifest(['quay/class/all-classes']),
        outputs: { 'quay/class/all-classes': [quayLayer, scriptsLayer] },
      };
      const stale = await cleanStaleDiagrams([], manifest, outputDir);

      expect(stale).toEqual(['quay/class/all-classes']);
      expect(await fs.pathExists(quayLayer)).toBe(false);
      expect(await fs.pathExists(`${quayLayer}.render-hash`)).toBe(false);
      expect(await fs.pathExists(path.join(classDir, 'Quay_Layer.svg'))).toBe(false);
      expect(await fs.pathExists(scriptsLayer)).toBe(false);
    });
  });

  // ── clearRenderHashes ──────────────────────────────────────────────────────

  describe('clearRenderHashes', () => {
    it('returns 0 when no sidecar files exist', async () => {
      const count = await clearRenderHashes(outputDir);
      expect(count).toBe(0);
    });

    it('returns 0 when outputDir does not exist', async () => {
      const count = await clearRenderHashes(path.join(tmpDir, 'nonexistent'));
      expect(count).toBe(0);
    });

    it('deletes all .mmd.render-hash files recursively', async () => {
      // Create nested render-hash files
      const sub1 = path.join(outputDir, 'overview');
      const sub2 = path.join(outputDir, 'class', 'sub');
      await fs.ensureDir(sub1);
      await fs.ensureDir(sub2);

      await fs.writeFile(path.join(sub1, 'package.mmd'), 'graph LR\n  A');
      await fs.writeFile(path.join(sub1, 'package.mmd.render-hash'), 'hash1');
      await fs.writeFile(path.join(sub2, 'all-classes.mmd'), 'classDiagram\n  Foo');
      await fs.writeFile(path.join(sub2, 'all-classes.mmd.render-hash'), 'hash2');
      await fs.writeFile(path.join(outputDir, 'root.mmd.render-hash'), 'hash3');

      const count = await clearRenderHashes(outputDir);

      expect(count).toBe(3);
      expect(await fs.pathExists(path.join(sub1, 'package.mmd.render-hash'))).toBe(false);
      expect(await fs.pathExists(path.join(sub2, 'all-classes.mmd.render-hash'))).toBe(false);
      expect(await fs.pathExists(path.join(outputDir, 'root.mmd.render-hash'))).toBe(false);
      // Non-hash files unaffected
      expect(await fs.pathExists(path.join(sub1, 'package.mmd'))).toBe(true);
      expect(await fs.pathExists(path.join(sub2, 'all-classes.mmd'))).toBe(true);
    });
  });
});
