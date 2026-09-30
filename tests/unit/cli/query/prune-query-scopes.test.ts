import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { pruneQueryScopes } from '@/cli/query/query-artifacts.js';

const entry = (key: string, generatedAt?: string) => ({
  key,
  label: key,
  language: 'typescript',
  kind: 'parsed',
  sources: [key],
  entityCount: 1,
  relationCount: 0,
  hasAtlasExtension: false,
  generatedAt,
});

describe('pruneQueryScopes', () => {
  let dir: string;
  const now = new Date('2026-09-30T00:00:00Z');
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prune-'));
    const scopes = [
      entry('aaaaaaaa', '2026-09-06T00:00:00Z'),
      entry('bbbbbbbb', '2026-09-29T00:00:00Z'),
      entry('cccccccc', '2026-09-29T00:00:00Z'),
    ];
    await fs.outputJson(path.join(dir, 'query', 'manifest.json'), {
      version: '1.0',
      generatedAt: now.toISOString(),
      globalScopeKey: 'aaaaaaaa',
      scopes,
    });
    for (const s of scopes) await fs.outputJson(path.join(dir, 'query', s.key, 'arch.json'), {});
  });
  afterEach(() => fs.remove(dir));

  const keysOnDisk = async () =>
    (await fs.readdir(path.join(dir, 'query'))).filter((n) => n !== 'manifest.json').sort();
  const manifestKeys = async () =>
    (await fs.readJson(path.join(dir, 'query', 'manifest.json'))).scopes.map(
      (s: { key: string }) => s.key
    );

  it('removes a scope by key, keeps others', async () => {
    await pruneQueryScopes(dir, { keys: ['bbbbbbbb'] });
    expect(await manifestKeys()).toEqual(['aaaaaaaa', 'cccccccc']);
    expect(await keysOnDisk()).toEqual(['aaaaaaaa', 'cccccccc']);
  });

  it('dry-run changes nothing', async () => {
    const r = await pruneQueryScopes(dir, { olderThanDays: 7, dryRun: true, now });
    expect(r.removed.map((s) => s.key)).toEqual(['aaaaaaaa']);
    expect(await manifestKeys()).toHaveLength(3);
    expect(await keysOnDisk()).toHaveLength(3);
  });

  it('prunes by age and reselects global scope', async () => {
    await pruneQueryScopes(dir, { olderThanDays: 7, now });
    expect(await manifestKeys()).toEqual(['bbbbbbbb', 'cccccccc']);
    const m = await fs.readJson(path.join(dir, 'query', 'manifest.json'));
    expect(['bbbbbbbb', 'cccccccc']).toContain(m.globalScopeKey);
    expect(await keysOnDisk()).toEqual(['bbbbbbbb', 'cccccccc']);
  });

  it('reports missing keys and requires a selector', async () => {
    const r = await pruneQueryScopes(dir, { keys: ['zzzzzzzz'] });
    expect(r.missingKeys).toEqual(['zzzzzzzz']);
    await expect(pruneQueryScopes(dir, {})).rejects.toThrow();
  });
});
