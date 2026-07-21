import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('@/analysis/snapshot-store.js', () => ({
  loadSnapshots: vi.fn(),
}));
vi.mock('@/analysis/gim/direction-hint.js', () => ({
  computeDirectionHint: vi.fn(),
}));
vi.mock('@/analysis/gim/gim-loss-evaluator.js', () => ({
  computeAllLosses: vi.fn(),
}));
vi.mock('@/cli/mcp/mcp-server.js', () => ({
  resolveRoot: vi.fn((root: string | undefined, defaultRoot: string) => root ?? defaultRoot),
}));
vi.mock('@/cli/query/engine-loader.js', () => ({
  loadEngine: vi.fn(),
}));
vi.mock('@/analysis/package-metrics-analysis.js', () => ({
  extractPackageName: vi.fn((id: string) => id.split('/')[0]),
  computePackageFanMetricsFromRelations: vi.fn(),
}));

import { loadSnapshots } from '@/analysis/snapshot-store.js';
import { computeDirectionHint } from '@/analysis/gim/direction-hint.js';
import { computeAllLosses } from '@/analysis/gim/gim-loss-evaluator.js';
import { loadEngine } from '@/cli/query/engine-loader.js';
import { computePackageFanMetricsFromRelations } from '@/analysis/package-metrics-analysis.js';
import { registerGIMTools } from '@/cli/mcp/tools/gim-tools.js';

function makeSnapshot(totalEntities: number, timestamp: string) {
  return {
    schemaVersion: 1,
    commitSha: 'abc',
    branch: 'main',
    timestamp,
    archguardVersion: '0.1.0',
    metricVector: {
      schemaVersion: 1,
      totalEntities,
      totalRelations: 200,
      inferredRelationRatio: 0.1,
      sccCount: 0,
      relationTypeBreakdown: {},
      maxInDegree: 10,
      maxOutDegree: 5,
      maxPackageSize: 20,
      giniInDegree: 0.5,
      giniPackageSize: 0.4,
      packageCount: 10,
    },
  };
}

const DEFAULT_DIRECTION = {
  direction: 'expansion' as const,
  confidence: 'low' as const,
  signals: [],
  caveat: 'caveat text',
  recommendation: 'consider contraction',
};

const DEFAULT_LOSSES = {
  feasibility: { value: 0, status: 'healthy' as const, detail: 'd', proxy: true as const },
  consistency: { value: 0.1, status: 'healthy' as const, detail: 'd', proxy: true as const },
  'description-length': { value: 700, status: 'info' as const, detail: 'd', proxy: true as const },
  'generation-alignment': { value: 0.4, status: 'healthy' as const, detail: 'd', proxy: true as const },
};

function buildMockServer() {
  let registeredHandler: ((args: Record<string, unknown>) => Promise<unknown>) | null = null;
  const server = {
    tool: vi.fn((_name: string, _desc: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
      registeredHandler = handler;
    }),
  } as unknown as McpServer;
  return { server, getHandler: () => registeredHandler! };
}

async function invokeGimTool(args: Record<string, unknown> = {}) {
  const { server, getHandler } = buildMockServer();
  registerGIMTools(server, '/project');
  const handler = getHandler();
  const result = await handler(args) as { content: Array<{ type: string; text: string }> };
  return JSON.parse(result.content[0].text);
}

describe('registerGIMTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(computeDirectionHint).mockReturnValue(DEFAULT_DIRECTION);
    vi.mocked(computeAllLosses).mockReturnValue(DEFAULT_LOSSES);
    vi.mocked(computePackageFanMetricsFromRelations).mockReturnValue({
      fanIn: new Map([['src/types', 196], ['src/cli', 50]]),
      fanOut: new Map([['src/types', 5], ['src/cli', 47]]),
    });
    vi.mocked(loadEngine).mockResolvedValue({
      engine: { getCycles: vi.fn(() => []) } as unknown as Awaited<ReturnType<typeof loadEngine>>['engine'],
      archDir: '/project/.archguard',
      extensionAccessor: {
        getEntityIds: vi.fn(() => ['src/types/index', 'src/cli/mcp/tools']),
        getRelations: vi.fn(() => []),
      },
      scopeEntry: {} as unknown,
      relationQueryService: {} as unknown,
    } as unknown as Awaited<ReturnType<typeof loadEngine>>);
  });

  it('returns direction hint when 2 snapshots available', async () => {
    vi.mocked(loadSnapshots).mockResolvedValue([
      makeSnapshot(130, '2026-01-02T00:00:00Z'),
      makeSnapshot(100, '2026-01-01T00:00:00Z'),
    ]);
    const data = await invokeGimTool();
    expect(data.direction.direction).toBe('expansion');
    expect(data.direction.confidence).toBe('low');
    expect(Array.isArray(data.direction.signals)).toBe(true);
  });

  it('returns all 4 loss statuses each with proxy:true', async () => {
    vi.mocked(loadSnapshots).mockResolvedValue([makeSnapshot(100, '2026-01-01T00:00:00Z')]);
    const data = await invokeGimTool();
    expect(data.losses.feasibility.proxy).toBe(true);
    expect(data.losses.consistency.proxy).toBe(true);
    expect(data.losses['description-length'].proxy).toBe(true);
    expect(data.losses['generation-alignment'].proxy).toBe(true);
  });

  it('returns insufficient_data direction when 0 snapshots', async () => {
    vi.mocked(loadSnapshots).mockResolvedValue([]);
    vi.mocked(computeDirectionHint).mockReturnValue({
      direction: 'insufficient_data',
      confidence: null,
      signals: [],
      caveat: 'need more snapshots',
      recommendation: 'run analyze first',
    });
    const data = await invokeGimTool();
    expect(data.direction.direction).toBe('insufficient_data');
  });

  it('returns highInfluencePackages sorted by fanIn DESC, top 5 only', async () => {
    vi.mocked(loadSnapshots).mockResolvedValue([makeSnapshot(100, '2026-01-01T00:00:00Z')]);
    vi.mocked(computePackageFanMetricsFromRelations).mockReturnValue({
      fanIn: new Map([
        ['pkg/a', 10], ['pkg/b', 50], ['pkg/c', 30], ['pkg/d', 20], ['pkg/e', 40], ['pkg/f', 5],
      ]),
      fanOut: new Map([
        ['pkg/a', 2], ['pkg/b', 5], ['pkg/c', 3], ['pkg/d', 1], ['pkg/e', 4], ['pkg/f', 1],
      ]),
    });
    vi.mocked(loadEngine).mockResolvedValue({
      engine: { getCycles: vi.fn(() => []) } as unknown as Awaited<ReturnType<typeof loadEngine>>['engine'],
      extensionAccessor: {
        getEntityIds: vi.fn(() => ['pkg/a/x', 'pkg/b/x', 'pkg/c/x', 'pkg/d/x', 'pkg/e/x', 'pkg/f/x']),
        getRelations: vi.fn(() => []),
      },
      scopeEntry: {},
      relationQueryService: {},
    } as unknown as Awaited<ReturnType<typeof loadEngine>>);
    const data = await invokeGimTool();
    expect(data.highInfluencePackages.length).toBeLessThanOrEqual(5);
    if (data.highInfluencePackages.length >= 2) {
      expect(data.highInfluencePackages[0].fanIn).toBeGreaterThanOrEqual(data.highInfluencePackages[1].fanIn);
    }
  });

  it('response includes methodology field mentioning proxy approximations', async () => {
    vi.mocked(loadSnapshots).mockResolvedValue([]);
    const data = await invokeGimTool();
    expect(data.methodology).toMatch(/proxy/i);
  });

  it('snapshotCount field reflects actual number of snapshots', async () => {
    vi.mocked(loadSnapshots).mockResolvedValue([
      makeSnapshot(130, '2026-01-02T00:00:00Z'),
      makeSnapshot(100, '2026-01-01T00:00:00Z'),
    ]);
    const data = await invokeGimTool();
    expect(data.snapshotCount).toBe(2);
  });

  it('tool name archguard_get_gim_context is registered', () => {
    const { server } = buildMockServer();
    registerGIMTools(server, '/project');
    const toolMock = vi.mocked(server.tool);
    const registeredName = toolMock.mock.calls[0][0];
    expect(registeredName).toBe('archguard_get_gim_context');
  });
});
