/**
 * Unit tests for arch-health-tools.ts (TASK-64 Phase E).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('@/cli/mcp/mcp-server.js', () => ({
  resolveRoot: vi.fn((root: string | undefined, defaultRoot: string) => root ?? defaultRoot),
}));
vi.mock('@/analysis/jl/history-writer.js', () => ({
  readHistoryFile: vi.fn(),
}));

import { readHistoryFile } from '@/analysis/jl/history-writer.js';
import { registerArchHealthTools } from '@/cli/mcp/tools/arch-health-tools.js';
import type { ArchHealthHistory, IntrinsicDimensionResult } from '@/analysis/jl/types.js';

function makeSnapshot(
  dInt: number,
  timestamp: string,
  overrides: Partial<IntrinsicDimensionResult> = {}
): IntrinsicDimensionResult {
  return {
    timestamp,
    entityCount: 100,
    mode: 'direct',
    featureVersion: '1.0',
    k: null,
    dInt,
    dIntNormalized: dInt / 100,
    varianceExplained: [1.0],
    epsilon: null,
    ...overrides,
  };
}

function makeHistory(snapshots: IntrinsicDimensionResult[]): ArchHealthHistory {
  return {
    schemaVersion: 1,
    language: 'typescript',
    snapshots,
  };
}

function buildMockServer() {
  let registeredHandler: ((args: Record<string, unknown>) => Promise<unknown>) | null = null;
  const server = {
    tool: vi.fn(
      (
        _name: string,
        _desc: string,
        _schema: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>
      ) => {
        registeredHandler = handler;
      }
    ),
  } as unknown as McpServer;
  return { server, getHandler: () => registeredHandler };
}

async function invokeTool(
  args: Record<string, unknown> = {},
  history: ArchHealthHistory | null = null
) {
  vi.mocked(readHistoryFile).mockResolvedValue(history);
  const { server, getHandler } = buildMockServer();
  registerArchHealthTools(server, '/project');
  const handler = getHandler();
  const result = (await handler(args)) as { content: Array<{ type: string; text: string }> };
  return JSON.parse(result.content[0].text);
}

describe('registerArchHealthTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the archguard_get_intrinsic_dimension tool name', () => {
    const { server } = buildMockServer();
    registerArchHealthTools(server, '/project');
    const toolMock = vi.mocked(server.tool);
    const registeredName = toolMock.mock.calls[0][0];
    expect(registeredName).toBe('archguard_get_intrinsic_dimension');
  });

  it('empty history → { current: null, history: [], trend: "stable" }', async () => {
    const data = await invokeTool({}, makeHistory([]));
    expect(data).toEqual({ current: null, history: [], trend: 'stable' });
  });

  it('missing history file → same empty shape', async () => {
    const data = await invokeTool({}, null);
    expect(data).toEqual({ current: null, history: [], trend: 'stable' });
  });

  it('current is the newest snapshot (chronological)', async () => {
    const data = await invokeTool(
      {},
      makeHistory([
        makeSnapshot(1, '2026-01-01T00:00:00Z'),
        makeSnapshot(2, '2026-01-02T00:00:00Z'),
      ])
    );
    expect(data.current.dInt).toBe(2);
    expect(data.current.timestamp).toBe('2026-01-02T00:00:00Z');
    expect(data.history).toHaveLength(2);
  });

  it('snapshotCount slices the most-recent history', async () => {
    const snapshots = [
      makeSnapshot(1, '2026-01-01T00:00:00Z'),
      makeSnapshot(2, '2026-01-02T00:00:00Z'),
      makeSnapshot(3, '2026-01-03T00:00:00Z'),
      makeSnapshot(4, '2026-01-04T00:00:00Z'),
      makeSnapshot(5, '2026-01-05T00:00:00Z'),
    ];
    const data = await invokeTool({ snapshotCount: 2 }, makeHistory(snapshots));
    expect(data.history).toHaveLength(2);
    expect(data.history[0].dInt).toBe(4);
    expect(data.history[1].dInt).toBe(5);
    expect(data.current.dInt).toBe(5);
  });

  it('returns all history when snapshotCount is omitted', async () => {
    const snapshots = [
      makeSnapshot(1, '2026-01-01T00:00:00Z'),
      makeSnapshot(2, '2026-01-02T00:00:00Z'),
    ];
    const data = await invokeTool({}, makeHistory(snapshots));
    expect(data.history).toHaveLength(2);
  });

  it('trend is rising when dIntNormalized delta > 0.002', async () => {
    const snapshots = [
      makeSnapshot(10, '2026-01-01T00:00:00Z', { dIntNormalized: 0.1 }),
      makeSnapshot(20, '2026-01-02T00:00:00Z', { dIntNormalized: 0.15 }),
    ];
    const data = await invokeTool({}, makeHistory(snapshots));
    expect(data.trend).toBe('rising');
  });

  it('trend is decreasing when dIntNormalized delta < -0.002', async () => {
    const snapshots = [
      makeSnapshot(20, '2026-01-01T00:00:00Z', { dIntNormalized: 0.15 }),
      makeSnapshot(10, '2026-01-02T00:00:00Z', { dIntNormalized: 0.1 }),
    ];
    const data = await invokeTool({}, makeHistory(snapshots));
    expect(data.trend).toBe('decreasing');
  });

  it('trend is stable when delta is within the threshold', async () => {
    const snapshots = [
      makeSnapshot(10, '2026-01-01T00:00:00Z', { dIntNormalized: 0.1 }),
      makeSnapshot(11, '2026-01-02T00:00:00Z', { dIntNormalized: 0.101 }),
    ];
    const data = await invokeTool({}, makeHistory(snapshots));
    expect(data.trend).toBe('stable');
  });

  it('trend is stable with fewer than 2 snapshots', async () => {
    const data = await invokeTool({}, makeHistory([makeSnapshot(5, '2026-01-01T00:00:00Z')]));
    expect(data.trend).toBe('stable');
  });
});
