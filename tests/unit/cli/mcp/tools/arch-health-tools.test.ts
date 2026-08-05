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
vi.mock('@/cli/utils/cluster-archjson-loader.js', () => ({
  loadArchJsonForCluster: vi.fn(),
}));

import { readHistoryFile } from '@/analysis/jl/history-writer.js';
import {
  registerArchHealthTools,
  registerClusterBoundaryTool,
} from '@/cli/mcp/tools/arch-health-tools.js';
import { loadArchJsonForCluster } from '@/cli/utils/cluster-archjson-loader.js';
import type { ArchHealthHistory, IntrinsicDimensionResult } from '@/analysis/jl/types.js';
import type { ArchJSON } from '@/types/index.js';

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

// ---------------------------------------------------------------------------
// TASK-66 — archguard_get_cluster_boundary
// ---------------------------------------------------------------------------

function makeEntity(id: string, name: string) {
  return {
    id,
    name,
    type: 'class',
    visibility: 'public' as const,
    members: [],
    sourceLocation: { file: 'x.ts', startLine: 1, endLine: 1 },
  };
}

function makeRelation(id: string, source: string, target: string) {
  return { id, type: 'dependency' as const, source, target };
}

/**
 * 3 entities in `aa.core` with identical structural rows, 3 in `bb.core`, and
 * one orphan (zero row). Packages are perfectly aligned after clustering.
 */
function makeClusterArchJson(): ArchJSON {
  const entities = [
    makeEntity('a1', 'aa.core.A1'),
    makeEntity('a2', 'aa.core.A2'),
    makeEntity('a3', 'aa.core.A3'),
    makeEntity('b1', 'bb.core.B1'),
    makeEntity('b2', 'bb.core.B2'),
    makeEntity('b3', 'bb.core.B3'),
    makeEntity('z1', 'zz.core.Orphan'),
  ];
  const relations = [
    makeRelation('r1', 'a1', 'a1'),
    makeRelation('r2', 'a2', 'a1'),
    makeRelation('r3', 'a3', 'a1'),
    makeRelation('r4', 'b1', 'b1'),
    makeRelation('r5', 'b2', 'b1'),
    makeRelation('r6', 'b3', 'b1'),
  ];
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities,
    relations,
  };
}

async function invokeClusterTool(args: Record<string, unknown> = {}) {
  const { server, getHandler } = buildMockServer();
  registerClusterBoundaryTool(server, '/project');
  const handler = getHandler();
  const result = (await handler(args)) as { content: Array<{ type: string; text: string }> };
  return JSON.parse(result.content[0].text);
}

describe('registerClusterBoundaryTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadArchJsonForCluster).mockResolvedValue(makeClusterArchJson());
  });

  it('registers archguard_get_cluster_boundary with the expected parameter schema', () => {
    const { server } = buildMockServer();
    registerClusterBoundaryTool(server, '/project');
    const toolMock = vi.mocked(server.tool);
    const name = toolMock.mock.calls[0][0];
    expect(name).toBe('archguard_get_cluster_boundary');
    const schema = toolMock.mock.calls[0][2] as Record<string, unknown>;
    expect(schema).toHaveProperty('minPackageSize');
    expect(schema).toHaveProperty('splitThreshold');
    expect(schema).toHaveProperty('packageDepth');
    expect(schema).toHaveProperty('includeOrphans');
  });

  it('returns a ClusterBoundaryReport-shaped object for a valid fixture', async () => {
    const data = await invokeClusterTool();
    expect(data).toHaveProperty('mode');
    expect(data).toHaveProperty('globalBAS');
    expect(data).toHaveProperty('silhouetteScore');
    expect(data).toHaveProperty('clusterCount');
    expect(data).toHaveProperty('packageScores');
    expect(data).toHaveProperty('splitPackages');
    expect(data).toHaveProperty('crossDomainFusions');
    expect(data).toHaveProperty('orphanEntities');
    expect(data).toHaveProperty('clusters');
  });

  it('globalBAS is in [0,1] for a non-trivial fixture', async () => {
    const data = await invokeClusterTool();
    expect(data.globalBAS).toBeGreaterThanOrEqual(0);
    expect(data.globalBAS).toBeLessThanOrEqual(1);
    // Perfectly aligned fixture → BAS 1.0.
    expect(data.globalBAS).toBe(1.0);
  });

  it('errors when ArchJSON has fewer than 2 entities', async () => {
    vi.mocked(loadArchJsonForCluster).mockResolvedValue({
      ...makeClusterArchJson(),
      entities: [makeEntity('a1', 'aa.core.A1')],
      relations: [],
    });
    const data = await invokeClusterTool();
    expect(data.error).toContain('at least 2 entities');
  });

  it('forwards minPackageSize (large value → packageScores empty)', async () => {
    const data = await invokeClusterTool({ minPackageSize: 10 });
    expect(data.packageScores).toEqual([]);
  });

  it('includeOrphans=false → empty orphanEntities (orphans still excluded from clustering)', async () => {
    const data = await invokeClusterTool({ includeOrphans: false });
    expect(data.orphanEntities).toEqual([]);
    // The orphan is still removed from the clustering input.
    expect(data.entityCount).toBe(6);
  });

  it('includeOrphans=true (default) → orphan listed', async () => {
    const data = await invokeClusterTool();
    expect(data.orphanEntities).toEqual(['zz.core.Orphan']);
  });
});
