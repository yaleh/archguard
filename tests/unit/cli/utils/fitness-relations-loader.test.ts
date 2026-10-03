/**
 * Unit tests for the fitness relations loader.
 *
 * The loader is the seam that keeps `no-dependency` rules honest: it must
 * return `null` (→ not-evaluated) — never an empty array (→ vacuous pass) —
 * whenever the relation graph cannot actually be read.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { loadFitnessRelations } from '@/cli/utils/fitness-relations-loader.js';

describe('loadFitnessRelations', () => {
  let tmpDirs: string[];

  async function makeTmpDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-rel-'));
    tmpDirs.push(dir);
    return dir;
  }

  async function writeManifest(archDir: string, manifest: unknown): Promise<void> {
    await fs.ensureDir(path.join(archDir, 'query'));
    await fs.writeJson(path.join(archDir, 'query', 'manifest.json'), manifest);
  }

  beforeEach(() => {
    tmpDirs = [];
  });

  afterEach(async () => {
    await Promise.all(tmpDirs.map((d) => fs.remove(d)));
  });

  it('reads relations from the global scope arch.json', async () => {
    const dir = await makeTmpDir();
    await writeManifest(dir, { globalScopeKey: 'abc123', scopes: [{ key: 'abc123' }] });
    await fs.ensureDir(path.join(dir, 'query', 'abc123'));
    await fs.writeJson(path.join(dir, 'query', 'abc123', 'arch.json'), {
      version: '1.0',
      language: 'typescript',
      entities: [],
      relations: [{ id: 'r1', type: 'dependency', source: 'src/a.ts.A', target: 'src/b.ts.B' }],
    });

    const result = await loadFitnessRelations(dir);

    expect(result.relations).toHaveLength(1);
    expect(result.relations?.[0]).toMatchObject({ source: 'src/a.ts.A', target: 'src/b.ts.B' });
    expect(result.scopeKey).toBe('abc123');
  });

  it('falls back to the first scope when no globalScopeKey is set', async () => {
    const dir = await makeTmpDir();
    await writeManifest(dir, { scopes: [{ key: 'zzz999' }] });
    await fs.ensureDir(path.join(dir, 'query', 'zzz999'));
    await fs.writeJson(path.join(dir, 'query', 'zzz999', 'arch.json'), {
      version: '1.0',
      language: 'typescript',
      entities: [],
      relations: [{ id: 'r1', type: 'dependency', source: 'x', target: 'y' }],
    });

    const result = await loadFitnessRelations(dir);

    expect(result.scopeKey).toBe('zzz999');
    expect(result.relations).toHaveLength(1);
  });

  it('returns null (not an empty array) when no query manifest exists', async () => {
    const dir = await makeTmpDir();

    const result = await loadFitnessRelations(dir);

    expect(result.relations).toBeNull();
    expect(result.detail).toContain('no query artifacts');
  });

  it('returns null when the manifest declares no scope', async () => {
    const dir = await makeTmpDir();
    await writeManifest(dir, { scopes: [] });

    const result = await loadFitnessRelations(dir);

    expect(result.relations).toBeNull();
    expect(result.detail).toContain('declares no scope');
  });

  it('returns null when arch.json for the scope is missing', async () => {
    const dir = await makeTmpDir();
    await writeManifest(dir, { globalScopeKey: 'gone01', scopes: [{ key: 'gone01' }] });

    const result = await loadFitnessRelations(dir);

    expect(result.relations).toBeNull();
    expect(result.detail).toContain('arch.json missing');
  });

  it('returns null when the scope has zero edges (no granularity to evaluate)', async () => {
    const dir = await makeTmpDir();
    await writeManifest(dir, { globalScopeKey: 'empty1', scopes: [{ key: 'empty1' }] });
    await fs.ensureDir(path.join(dir, 'query', 'empty1'));
    await fs.writeJson(path.join(dir, 'query', 'empty1', 'arch.json'), {
      version: '1.0',
      language: 'typescript',
      entities: [],
      relations: [],
    });

    const result = await loadFitnessRelations(dir);

    expect(result.relations).toBeNull();
    expect(result.detail).toContain('no relation edges');
  });

  it('returns null when the manifest is unparseable', async () => {
    const dir = await makeTmpDir();
    await fs.ensureDir(path.join(dir, 'query'));
    await fs.writeFile(path.join(dir, 'query', 'manifest.json'), '{ not json');

    const result = await loadFitnessRelations(dir);

    expect(result.relations).toBeNull();
    expect(result.detail).toContain('unreadable query manifest');
  });
});
