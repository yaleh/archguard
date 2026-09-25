/**
 * Unit tests for the shared arch-health computation (TASK-97).
 * Uses the real filesystem so the persisted history file is verified end to end.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { computeArchHealth, runArchHealth } from '@/cli/analyze/arch-health.js';
import type { ArchJSON } from '@/types/index.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-health-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeArchJson(): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: [],
    entities: ['A', 'B', 'C'].map((id) => ({
      id,
      name: id,
      type: 'class' as const,
      visibility: 'public' as const,
      members: [],
      sourceLocation: { file: `${id}.ts`, startLine: 1, endLine: 1 },
    })),
    relations: [
      { id: 'r1', type: 'dependency' as const, source: 'A', target: 'B' },
      { id: 'r2', type: 'dependency' as const, source: 'B', target: 'C' },
    ],
  };
}

describe('computeArchHealth', () => {
  it('persists a snapshot without printing anything (MCP-safe)', async () => {
    const dir = makeTempDir();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const outcome = await computeArchHealth(makeArchJson(), dir);

    expect(log).not.toHaveBeenCalled();
    expect(outcome.persisted).toBe(true);
    expect(outcome.previous).toBeNull();
    const history = await fs.readJson(path.join(dir, 'arch-health-history.json'));
    expect(history.snapshots).toHaveLength(1);
    expect(history.snapshots[0].entityIndex).toEqual(['A', 'B', 'C']);
    // No scope supplied → no scope fields (CLI history shape unchanged).
    expect(history.snapshots[0]).not.toHaveProperty('scopeKey');
    expect(history.snapshots[0]).not.toHaveProperty('sources');
  });

  it('records scope identity and returns the previous snapshot on the second run', async () => {
    const dir = makeTempDir();
    await computeArchHealth(makeArchJson(), dir, undefined, { scopeKey: 'k1', sources: ['/src'] });
    const second = await computeArchHealth(makeArchJson(), dir, undefined, { scopeKey: 'k1' });

    expect(second.previous?.scopeKey).toBe('k1');
    const history = await fs.readJson(path.join(dir, 'arch-health-history.json'));
    expect(history.snapshots).toHaveLength(2);
    expect(history.snapshots[0].sources).toEqual(['/src']);
  });

  it('reports persisted=false with a reason on incompatible schemaVersion', async () => {
    const dir = makeTempDir();
    await fs.writeJson(path.join(dir, 'arch-health-history.json'), {
      schemaVersion: 99,
      snapshots: [],
    });

    const outcome = await computeArchHealth(makeArchJson(), dir);

    expect(outcome.persisted).toBe(false);
    expect(outcome.reason).toContain('schemaVersion');
  });
});

describe('runArchHealth', () => {
  it('prints the report after persisting', async () => {
    const dir = makeTempDir();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    await runArchHealth(makeArchJson(), dir);

    expect(logs.join('\n')).toContain('Architecture Intrinsic Dimension');
    expect(await fs.pathExists(path.join(dir, 'arch-health-history.json'))).toBe(true);
  });
});
