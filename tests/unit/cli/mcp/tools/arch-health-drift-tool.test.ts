/**
 * Unit tests for the archguard_get_architecture_drift MCP tool (TASK-65 Phase D).
 *
 * readHistoryFile and the baseline re-analyzer are mocked; the tool's own
 * resolution logic (resolveDriftSnapshots) and the real DriftCalculator run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('@/cli/mcp/mcp-server.js', () => ({
  resolveRoot: vi.fn((root: string | undefined, defaultRoot: string) => root ?? defaultRoot),
}));
vi.mock('@/analysis/jl/history-writer.js', () => ({
  readHistoryFile: vi.fn(),
}));
vi.mock('@/cli/utils/drift-baseline.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/cli/utils/drift-baseline.js')>();
  return {
    ...actual,
    reanalyzeCommitSnapshot: vi.fn(),
  };
});

import { readHistoryFile } from '@/analysis/jl/history-writer.js';
import { reanalyzeCommitSnapshot } from '@/cli/utils/drift-baseline.js';
import { registerArchHealthDriftTool } from '@/cli/mcp/tools/arch-health-tools.js';
import type { ArchHealthHistory, DriftSnapshot, IntrinsicDimensionResult } from '@/analysis/jl/types.js';

function makeSnapshot(commitSha: string, timestamp: string): IntrinsicDimensionResult {
  return {
    timestamp,
    commitSha,
    entityCount: 2,
    mode: 'direct',
    featureVersion: '1.0',
    k: null,
    dInt: 1,
    dIntNormalized: 0.5,
    varianceExplained: [1.0],
    epsilon: null,
  };
}

function makeHistory(snapshots: IntrinsicDimensionResult[]): ArchHealthHistory {
  return { schemaVersion: 1, language: 'typescript', snapshots };
}

function buildMockServer() {
  const handlers: Array<(args: Record<string, unknown>) => Promise<unknown>> = [];
  const server = {
    tool: vi.fn(
      (
        _name: string,
        _desc: string,
        _schema: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>
      ) => {
        handlers.push(handler);
      }
    ),
  } as unknown as McpServer;
  return { server, getLastHandler: () => handlers[handlers.length - 1] };
}

async function invokeDriftTool(
  args: Record<string, unknown> = {},
  history: ArchHealthHistory | null = null,
  snapshots?: { from: DriftSnapshot; to: DriftSnapshot }
) {
  vi.mocked(readHistoryFile).mockResolvedValue(history);
  if (snapshots) {
    vi.mocked(reanalyzeCommitSnapshot)
      .mockResolvedValueOnce(snapshots.from)
      .mockResolvedValueOnce(snapshots.to);
  }
  const { server, getLastHandler } = buildMockServer();
  registerArchHealthDriftTool(server, '/project');
  const handler = getLastHandler();
  const result = (await handler(args)) as { content: Array<{ type: string; text: string }> };
  return JSON.parse(result.content[0].text);
}

function zeroMatrix(n: number): number[][] {
  return Array.from({ length: n }, () => Array<number>(n).fill(0));
}

const HISTORY_TWO = makeHistory([
  makeSnapshot('aaa', '2026-01-01T00:00:00Z'),
  makeSnapshot('bbb', '2026-01-02T00:00:00Z'),
]);

describe('archguard_get_architecture_drift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fully reset the shared reanalyze mock (implementation + once-queue) so a
    // previous test's mockResolvedValueOnce queue does not leak into the next.
    vi.mocked(reanalyzeCommitSnapshot).mockReset();
  });

  it('registers the tool name', () => {
    const { server } = buildMockServer();
    registerArchHealthDriftTool(server, '/project');
    const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
    expect(names).toContain('archguard_get_architecture_drift');
  });

  it('no history → "no baseline available" with a null report', async () => {
    const data = await invokeDriftTool({}, null);
    expect(data.message).toBe('no baseline available');
    expect(data.report).toBeNull();
    expect(data.hasBreakingDrift).toBe(false);
    expect(data.breakingEntities).toEqual([]);
  });

  it('fewer than two snapshots → "no baseline available"', async () => {
    const data = await invokeDriftTool({}, makeHistory([makeSnapshot('aaa', '2026-01-01T00:00:00Z')]));
    expect(data.message).toBe('no baseline available');
  });

  it('fromCommit not found in history → structured error', async () => {
    const data = await invokeDriftTool({ fromCommit: 'zzz' }, HISTORY_TWO);
    expect(data.error).toContain('zzz');
  });

  it('hasBreakingDrift true when an entity is critical; breakingEntities ≥ threshold', async () => {
    const from: DriftSnapshot = {
      timestamp: 't1',
      commitSha: 'aaa',
      entityIndex: ['A', 'B'],
      adjacencyRows: zeroMatrix(2),
    };
    // A's row gains a heavy outgoing edge → drift 6 ≥ critical (3.0).
    const to: DriftSnapshot = {
      timestamp: 't2',
      commitSha: 'bbb',
      entityIndex: ['A', 'B'],
      adjacencyRows: [
        [0, 6],
        [0, 0],
      ],
    };
    const data = await invokeDriftTool({}, HISTORY_TWO, { from, to });
    expect(data.hasBreakingDrift).toBe(true);
    expect(data.breakingEntities.length).toBeGreaterThanOrEqual(1);
    expect(data.breakingEntities).toContain('A');
    // The breaking entity's drift meets the critical threshold (3.0).
    const a = data.report.drifts.find((d: { entityId: string }) => d.entityId === 'A');
    expect(a.drift).toBeGreaterThanOrEqual(3.0);
  });

  it('no breaking drift when all entities are stable', async () => {
    const from: DriftSnapshot = {
      timestamp: 't1',
      commitSha: 'aaa',
      entityIndex: ['A', 'B'],
      adjacencyRows: zeroMatrix(2),
    };
    const to: DriftSnapshot = {
      timestamp: 't2',
      commitSha: 'bbb',
      entityIndex: ['A', 'B'],
      adjacencyRows: zeroMatrix(2),
    };
    const data = await invokeDriftTool({}, HISTORY_TWO, { from, to });
    expect(data.hasBreakingDrift).toBe(false);
    expect(data.breakingEntities).toEqual([]);
  });

  it('defaults topK=10 / minLevel=stable (report drifts ≤ 10)', async () => {
    const n = 12;
    const toRows = zeroMatrix(n);
    for (let i = 0; i < n; i++) toRows[i] = [i + 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const from: DriftSnapshot = {
      timestamp: 't1',
      commitSha: 'aaa',
      entityIndex: Array.from({ length: n }, (_, i) => `E${i}`),
      adjacencyRows: zeroMatrix(n),
    };
    const to: DriftSnapshot = {
      timestamp: 't2',
      commitSha: 'bbb',
      entityIndex: Array.from({ length: n }, (_, i) => `E${i}`),
      adjacencyRows: toRows,
    };
    const data = await invokeDriftTool({}, HISTORY_TWO, { from, to });
    expect(data.report.drifts).toHaveLength(10);
  });

  it('forwards topK / minLevel', async () => {
    const n = 12;
    const toRows = zeroMatrix(n);
    for (let i = 0; i < n; i++) toRows[i] = [i + 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const from: DriftSnapshot = {
      timestamp: 't1',
      commitSha: 'aaa',
      entityIndex: Array.from({ length: n }, (_, i) => `E${i}`),
      adjacencyRows: zeroMatrix(n),
    };
    const to: DriftSnapshot = {
      timestamp: 't2',
      commitSha: 'bbb',
      entityIndex: Array.from({ length: n }, (_, i) => `E${i}`),
      adjacencyRows: toRows,
    };
    const data = await invokeDriftTool({ topK: 3, minLevel: 'moderate' }, HISTORY_TWO, { from, to });
    expect(data.report.drifts).toHaveLength(3);
    for (const d of data.report.drifts) {
      expect(['moderate', 'significant', 'critical']).toContain(d.level);
    }
  });

  it('resolves toCommit/fromCommit defaults from history (from before to)', async () => {
    const from: DriftSnapshot = {
      timestamp: 't1',
      commitSha: 'aaa',
      entityIndex: ['A', 'B'],
      adjacencyRows: zeroMatrix(2),
    };
    const to: DriftSnapshot = {
      timestamp: 't2',
      commitSha: 'bbb',
      entityIndex: ['A', 'B'],
      adjacencyRows: zeroMatrix(2),
    };
    const data = await invokeDriftTool({}, HISTORY_TWO, { from, to });
    expect(data.report.fromSnapshot.commitSha).toBe('aaa');
    expect(data.report.toSnapshot.commitSha).toBe('bbb');
  });
});
