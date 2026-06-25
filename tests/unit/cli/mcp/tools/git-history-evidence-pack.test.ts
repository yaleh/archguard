/**
 * TDD tests for archguard_get_evidence_pack MCP tool (TASK-23).
 *
 * Tests:
 * - Tool is registered with name archguard_get_evidence_pack
 * - Single known target: response includes riskScore, riskLevel, topFactor and ## Evidence Pack header
 * - Multiple targets: response includes ## Hotspots block
 * - Target not found: response includes notFound key and does not throw
 * - History data missing (GitHistoryNotFoundError): response matches NOT_ANALYZED_MSG pattern
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerEvidencePackTool } from '@/cli/mcp/tools/git-history-evidence-pack-tool.js';
import * as loaderModule from '@/cli/git-history/history-loader.js';
import { GitHistoryNotFoundError } from '@/cli/git-history/history-loader.js';
import type { LoadedHistoryData } from '@/cli/git-history/history-loader.js';
import type {
  GitHistoryManifest,
  FileHistoryMetrics,
  PackageHistoryMetrics,
  RiskFactors,
} from '@/types/git-history.js';

// ---------------------------------------------------------------------------
// Mock loadHistoryData
// ---------------------------------------------------------------------------

vi.mock('@/cli/git-history/history-loader.js', async () => {
  const actual = await vi.importActual<typeof import('@/cli/git-history/history-loader.js')>(
    '@/cli/git-history/history-loader.js'
  );
  return {
    ...actual,
    loadHistoryData: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeManifest(): GitHistoryManifest {
  return {
    version: '1',
    generatedAt: '2026-01-01T00:00:00Z',
    headRef: 'abc1234',
    analyzedBranch: 'master',
    sinceDays: 90,
    maxCommits: 500,
    totalCommits: 42,
    includeMerges: false,
    granularities: ['package', 'file'],
  };
}

function makeRiskFactors(overrides: Partial<RiskFactors> = {}): RiskFactors {
  return {
    churn: 0.6,
    authorCount: 0.4,
    ownerConcentration: 0.3,
    cochangeBreadth: 0.2,
    recency: 0.5,
    ...overrides,
  };
}

function makeFileMetrics(path: string, riskFactors?: Partial<RiskFactors>): FileHistoryMetrics {
  return {
    path,
    packagePath: path.split('/')[0],
    commitCount: 15,
    activeDays: 10,
    addedLines: 200,
    deletedLines: 80,
    authorCount: 3,
    primaryOwner: 'alice@example.com',
    primaryOwnerShare: 0.7,
    lastChangedAt: '2026-01-01',
    topCochangeNeighbors: [],
    riskFactors: makeRiskFactors(riskFactors),
  };
}

function makeMockData(
  files: Array<{ path: string; rf?: Partial<RiskFactors> }> = [],
  packages: Array<{ path: string; rf?: Partial<RiskFactors> }> = []
): LoadedHistoryData {
  const fileMetrics = new Map<string, FileHistoryMetrics>();
  for (const f of files) {
    fileMetrics.set(f.path, makeFileMetrics(f.path, f.rf));
  }

  const packageMetrics = new Map<string, PackageHistoryMetrics>();
  for (const p of packages) {
    packageMetrics.set(p.path, {
      path: p.path,
      commitCount: 20,
      activeDays: 15,
      addedLines: 400,
      deletedLines: 100,
      authorCount: 4,
      primaryOwner: 'bob@example.com',
      primaryOwnerShare: 0.6,
      lastChangedAt: '2026-01-02',
      topCochangeNeighbors: [],
      riskFactors: makeRiskFactors(p.rf),
    });
  }

  return {
    manifest: makeManifest(),
    fileMetrics,
    packageMetrics,
  };
}

// ---------------------------------------------------------------------------
// collectTools helper
// ---------------------------------------------------------------------------

function collectTools(server: McpServer, defaultRoot = '/workspace'): Map<string, Function> {
  const tools = new Map<string, Function>();
  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    const name = args[0] as string;
    const cb = args[args.length - 1] as Function;
    tools.set(name, cb);
    return server;
  });
  registerEvidencePackTool(server, defaultRoot);
  return tools;
}

const loadHistoryDataMock = vi.mocked(loaderModule.loadHistoryData);

const NOT_ANALYZED_MSG =
  'No git history data found. Run `archguard_analyze_git` first to collect history artifacts.';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  loadHistoryDataMock.mockReset();
});

describe('registerEvidencePackTool — registration', () => {
  it('tool is registered with name archguard_get_evidence_pack', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    expect(tools.has('archguard_get_evidence_pack')).toBe(true);
  });
});

describe('archguard_get_evidence_pack', () => {
  it('single known target: response includes riskScore, riskLevel, topFactor and ## Evidence Pack header', async () => {
    loadHistoryDataMock.mockResolvedValue(
      makeMockData([{ path: 'src/cli/mcp-server.ts' }])
    );
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_evidence_pack')!;

    const result = await cb({
      targets: [{ targetType: 'file', target: 'src/cli/mcp-server.ts' }],
    });

    expect(result.content[0].type).toBe('text');
    const text: string = result.content[0].text;

    expect(text).toContain('## Evidence Pack');
    expect(text).toContain('riskScore');
    expect(text).toContain('riskLevel');
    expect(text).toContain('topFactor');
  });

  it('multiple targets: response includes ## Hotspots block', async () => {
    loadHistoryDataMock.mockResolvedValue(
      makeMockData([
        { path: 'src/a.ts', rf: { churn: 0.2 } },
        { path: 'src/b.ts', rf: { churn: 0.8 } },
        { path: 'src/c.ts', rf: { churn: 0.5 } },
      ])
    );
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_evidence_pack')!;

    const result = await cb({
      targets: [
        { targetType: 'file', target: 'src/a.ts' },
        { targetType: 'file', target: 'src/b.ts' },
        { targetType: 'file', target: 'src/c.ts' },
      ],
    });

    expect(result.content[0].type).toBe('text');
    const text: string = result.content[0].text;
    expect(text).toContain('## Hotspots');
  });

  it('target not found: response includes notFound key and does not throw', async () => {
    loadHistoryDataMock.mockResolvedValue(makeMockData([]));
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_evidence_pack')!;

    // Should not throw — returns a response with notFound info
    const result = await cb({
      targets: [{ targetType: 'file', target: 'src/unknown.ts' }],
    });

    expect(result).toBeDefined();
    expect(result.content[0].type).toBe('text');
    const text: string = result.content[0].text;
    expect(text).toContain('notFound');
  });

  it('history data missing: response matches NOT_ANALYZED_MSG pattern', async () => {
    loadHistoryDataMock.mockRejectedValue(new GitHistoryNotFoundError('/workspace/.archguard'));
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_evidence_pack')!;

    const result = await cb({
      targets: [{ targetType: 'file', target: 'src/any.ts' }],
    });

    expect(result.content[0].text).toBe(NOT_ANALYZED_MSG);
  });

  it('response JSON data is parseable and has results/hotspots/notFound fields', async () => {
    loadHistoryDataMock.mockResolvedValue(
      makeMockData([{ path: 'src/foo.ts' }])
    );
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_evidence_pack')!;

    const result = await cb({
      targets: [{ targetType: 'file', target: 'src/foo.ts' }],
    });

    const text: string = result.content[0].text;
    // Extract embedded JSON — it's in a fenced block after the markdown
    const jsonMatch = text.match(/```json\n([\s\S]+?)\n```/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(jsonMatch![1]);
    expect(parsed).toHaveProperty('results');
    expect(parsed).toHaveProperty('hotspots');
    expect(parsed).toHaveProperty('notFound');
  });
});
