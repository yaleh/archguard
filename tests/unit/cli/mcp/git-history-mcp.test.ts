/**
 * Unit tests for git history MCP tools (Stage 3.1).
 *
 * Mocks loadHistoryData and tests all four query tool behaviors:
 *   1. archguard_get_change_context
 *   2. archguard_get_cochange
 *   3. archguard_get_change_risk
 *   4. archguard_get_ownership
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGitHistoryTools } from '@/cli/mcp/tools/git-history-tools.js';
import * as loaderModule from '@/cli/git-history/history-loader.js';
import type { LoadedHistoryData } from '@/cli/git-history/history-loader.js';
import type {
  GitHistoryManifest,
  FileHistoryMetrics,
  PackageHistoryMetrics,
  RiskFactors,
  CochangeEdge,
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

function makeRiskFactors(): RiskFactors {
  return {
    churn: 0.6,
    authorCount: 0.4,
    ownerConcentration: 0.3,
    cochangeBreadth: 0.2,
    recency: 0.5,
  };
}

function makeCochangeEdge(target: string, strength: number): CochangeEdge {
  return {
    target,
    jointChangeCount: 10,
    strength,
    windowCoverage: 0.5,
  };
}

function makeFileMetrics(path: string): FileHistoryMetrics {
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
    topCochangeNeighbors: [
      makeCochangeEdge('src/cli/other.ts', 0.8),
      makeCochangeEdge('src/parser/index.ts', 0.6),
      makeCochangeEdge('src/types/index.ts', 0.4),
    ],
    riskFactors: makeRiskFactors(),
  };
}

function makePackageMetrics(path: string): PackageHistoryMetrics {
  return {
    path,
    commitCount: 30,
    activeDays: 20,
    addedLines: 500,
    deletedLines: 150,
    authorCount: 4,
    primaryOwner: 'bob@example.com',
    primaryOwnerShare: 0.55,
    lastChangedAt: '2026-01-02',
    topCochangeNeighbors: [
      makeCochangeEdge('src/types', 0.75),
      makeCochangeEdge('src/mermaid', 0.5),
    ],
    riskFactors: makeRiskFactors(),
  };
}

function makeMockData(): LoadedHistoryData {
  const fileMetrics = new Map<string, FileHistoryMetrics>();
  fileMetrics.set('src/cli/mcp/mcp-server.ts', makeFileMetrics('src/cli/mcp/mcp-server.ts'));
  fileMetrics.set('src/parser/typescript-parser.ts', makeFileMetrics('src/parser/typescript-parser.ts'));

  const packageMetrics = new Map<string, PackageHistoryMetrics>();
  packageMetrics.set('src/cli', makePackageMetrics('src/cli'));
  packageMetrics.set('src/parser', makePackageMetrics('src/parser'));

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
  const originalTool = server.tool.bind(server);

  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    const name = args[0] as string;
    const cb = args[args.length - 1] as Function;
    tools.set(name, cb);
    return (originalTool as Function)(...args);
  });

  registerGitHistoryTools(server, defaultRoot);
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

describe('registerGitHistoryTools — tool registration', () => {
  it('registers all four git history query tools', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    expect(tools.has('archguard_get_change_context')).toBe(true);
    expect(tools.has('archguard_get_cochange')).toBe(true);
    expect(tools.has('archguard_get_change_risk')).toBe(true);
    expect(tools.has('archguard_get_ownership')).toBe(true);
  });

  it('does not register other git-history tools', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    expect(tools.has('archguard_analyze_git')).toBe(false);
    expect(tools.has('archguard_get_git_history')).toBe(false);
  });
});

describe('archguard_get_change_context', () => {
  it('returns JSON text for a valid file target', async () => {
    loadHistoryDataMock.mockResolvedValue(makeMockData());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_change_context')!;

    const result = await cb({ targetType: 'file', target: 'src/cli/mcp/mcp-server.ts' });
    expect(result.content[0].type).toBe('text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.target).toBe('src/cli/mcp/mcp-server.ts');
    expect(parsed.targetType).toBe('file');
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.commitCount).toBe(15);
    expect(parsed.recentChurn).toBeDefined();
    expect(parsed.ownerConcentration).toBeDefined();
    expect(parsed.topCochangeNeighbors).toBeDefined();
    expect(parsed.risk).toBeDefined();
    expect(parsed.risk.riskScore).toBeTypeOf('number');
    expect(parsed.risk.riskLevel).toMatch(/^(low|medium|high|critical)$/);
  });

  it('returns JSON text for a valid package target', async () => {
    loadHistoryDataMock.mockResolvedValue(makeMockData());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_change_context')!;

    const result = await cb({ targetType: 'package', target: 'src/cli' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.target).toBe('src/cli');
    expect(parsed.targetType).toBe('package');
  });

  it('returns NOT_ANALYZED_MSG when GitHistoryNotFoundError is thrown', async () => {
    loadHistoryDataMock.mockRejectedValue(
      new loaderModule.GitHistoryNotFoundError('/workspace/.archguard')
    );
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_change_context')!;

    const result = await cb({ targetType: 'file', target: 'src/foo.ts' });
    expect(result.content[0].text).toBe(NOT_ANALYZED_MSG);
  });

  it('returns descriptive error for unknown target', async () => {
    loadHistoryDataMock.mockResolvedValue(makeMockData());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_change_context')!;

    const result = await cb({ targetType: 'file', target: 'nonexistent/path.ts' });
    expect(result.content[0].text).toContain('nonexistent/path.ts');
    // Must not return JSON (it's an error message)
    expect(() => JSON.parse(result.content[0].text)).toThrow();
  });
});

describe('archguard_get_cochange', () => {
  it('returns neighbors JSON for valid target', async () => {
    loadHistoryDataMock.mockResolvedValue(makeMockData());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_cochange')!;

    const result = await cb({ targetType: 'file', target: 'src/cli/mcp/mcp-server.ts' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.target).toBe('src/cli/mcp/mcp-server.ts');
    expect(Array.isArray(parsed.neighbors)).toBe(true);
    expect(parsed.neighbors.length).toBeGreaterThan(0);
    // neighbors should be sorted by strength desc
    if (parsed.neighbors.length >= 2) {
      expect(parsed.neighbors[0].strength).toBeGreaterThanOrEqual(parsed.neighbors[1].strength);
    }
    expect(parsed.limitation).toBeDefined();
  });

  it('respects topN parameter', async () => {
    loadHistoryDataMock.mockResolvedValue(makeMockData());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_cochange')!;

    const result = await cb({
      targetType: 'file',
      target: 'src/cli/mcp/mcp-server.ts',
      topN: 1,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.neighbors.length).toBeLessThanOrEqual(1);
  });

  it('returns NOT_ANALYZED_MSG when history not found', async () => {
    loadHistoryDataMock.mockRejectedValue(
      new loaderModule.GitHistoryNotFoundError('/workspace/.archguard')
    );
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_cochange')!;

    const result = await cb({ targetType: 'package', target: 'src/cli' });
    expect(result.content[0].text).toBe(NOT_ANALYZED_MSG);
  });
});

describe('archguard_get_change_risk', () => {
  it('returns risk JSON with riskScore and riskLevel', async () => {
    loadHistoryDataMock.mockResolvedValue(makeMockData());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_change_risk')!;

    const result = await cb({ targetType: 'file', target: 'src/cli/mcp/mcp-server.ts' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.target).toBe('src/cli/mcp/mcp-server.ts');
    expect(typeof parsed.riskScore).toBe('number');
    expect(parsed.riskScore).toBeGreaterThanOrEqual(0);
    expect(parsed.riskScore).toBeLessThanOrEqual(1);
    expect(parsed.riskLevel).toMatch(/^(low|medium|high|critical)$/);
    expect(parsed.factors).toBeDefined();
    expect(parsed.factorExplanations).toBeDefined();
    expect(parsed.limitation).toBeDefined();
  });

  it('works for package target', async () => {
    loadHistoryDataMock.mockResolvedValue(makeMockData());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_change_risk')!;

    const result = await cb({ targetType: 'package', target: 'src/parser' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.riskScore).toBeTypeOf('number');
    expect(parsed.riskLevel).toMatch(/^(low|medium|high|critical)$/);
  });

  it('returns NOT_ANALYZED_MSG when history not found', async () => {
    loadHistoryDataMock.mockRejectedValue(
      new loaderModule.GitHistoryNotFoundError('/workspace/.archguard')
    );
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_change_risk')!;

    const result = await cb({ targetType: 'file', target: 'src/cli/mcp/mcp-server.ts' });
    expect(result.content[0].text).toBe(NOT_ANALYZED_MSG);
  });
});

describe('archguard_get_ownership', () => {
  it('returns ownership JSON with busFactor', async () => {
    loadHistoryDataMock.mockResolvedValue(makeMockData());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_ownership')!;

    const result = await cb({ targetType: 'file', target: 'src/cli/mcp/mcp-server.ts' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.target).toBe('src/cli/mcp/mcp-server.ts');
    expect(Array.isArray(parsed.contributors)).toBe(true);
    expect(parsed.primaryOwner).toBe('alice@example.com');
    expect(typeof parsed.primaryOwnerShare).toBe('number');
    expect(typeof parsed.activeMaintainers).toBe('number');
    expect(typeof parsed.busFactor).toBe('number');
    expect(parsed.analyzedWindow).toBeDefined();
  });

  it('works for package target', async () => {
    loadHistoryDataMock.mockResolvedValue(makeMockData());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_ownership')!;

    const result = await cb({ targetType: 'package', target: 'src/cli' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.primaryOwner).toBe('bob@example.com');
    expect(typeof parsed.busFactor).toBe('number');
  });

  it('returns NOT_ANALYZED_MSG when history not found', async () => {
    loadHistoryDataMock.mockRejectedValue(
      new loaderModule.GitHistoryNotFoundError('/workspace/.archguard')
    );
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_ownership')!;

    const result = await cb({ targetType: 'package', target: 'src/cli' });
    expect(result.content[0].text).toBe(NOT_ANALYZED_MSG);
  });
});

describe('NOT_ANALYZED_MSG consistency across all tools', () => {
  it('all four tools return the same NOT_ANALYZED_MSG on GitHistoryNotFoundError', async () => {
    const toolNames = [
      'archguard_get_change_context',
      'archguard_get_cochange',
      'archguard_get_change_risk',
      'archguard_get_ownership',
    ];

    for (const toolName of toolNames) {
      loadHistoryDataMock.mockRejectedValue(
        new loaderModule.GitHistoryNotFoundError('/workspace/.archguard')
      );

      const server = new McpServer({ name: 'test', version: '1.0.0' });
      const tools = collectTools(server);
      const cb = tools.get(toolName)!;
      expect(cb).toBeDefined();

      const result = await cb({ targetType: 'file', target: 'src/foo.ts' });
      expect(result.content[0].text).toBe(NOT_ANALYZED_MSG);
    }
  });
});
