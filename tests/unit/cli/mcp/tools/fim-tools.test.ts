import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerFIMTools } from '@/cli/mcp/tools/fim-tools.js';
import * as fimArtifactsModule from '@/analysis/fim/fim-artifacts.js';
import * as fimSnapshotModule from '@/analysis/fim/fim-snapshot.js';
import * as fimAnalysisModule from '@/analysis/fim/fim-analysis.js';
import * as gitReaderModule from '@/cli/git-history/git-log-reader.js';
import { createMcpServer } from '@/cli/mcp/mcp-server.js';

vi.mock('@/analysis/fim/fim-artifacts.js', async () => {
  const actual = await vi.importActual<typeof import('@/analysis/fim/fim-artifacts.js')>(
    '@/analysis/fim/fim-artifacts.js'
  );
  return {
    ...actual,
    readFIMCurrentArtifact: vi.fn(),
  };
});

vi.mock('@/analysis/fim/fim-snapshot.js', async () => {
  const actual = await vi.importActual<typeof import('@/analysis/fim/fim-snapshot.js')>(
    '@/analysis/fim/fim-snapshot.js'
  );
  return {
    ...actual,
    readFIMHistory: vi.fn(),
  };
});

vi.mock('@/analysis/fim/fim-analysis.js', async () => {
  const actual = await vi.importActual<typeof import('@/analysis/fim/fim-analysis.js')>(
    '@/analysis/fim/fim-analysis.js'
  );
  return {
    ...actual,
    validateFIMAgainstGit: vi.fn(),
  };
});

vi.mock('@/cli/git-history/git-log-reader.js', async () => {
  const actual = await vi.importActual<typeof import('@/cli/git-history/git-log-reader.js')>(
    '@/cli/git-history/git-log-reader.js'
  );
  return {
    ...actual,
    isGitRepo: vi.fn(),
    readGitLog: vi.fn(),
  };
});

function collectTools(server: McpServer, defaultRoot = '/workspace'): Map<string, Function> {
  const tools = new Map<string, Function>();
  const originalTool = server.tool.bind(server);

  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    const name = args[0] as string;
    const cb = args[args.length - 1] as Function;
    tools.set(name, cb);
    return (originalTool as Function)(...args);
  });

  registerFIMTools(server, defaultRoot);
  return tools;
}

const readFIMCurrentArtifactMock = vi.mocked(fimArtifactsModule.readFIMCurrentArtifact);
const readFIMHistoryMock = vi.mocked(fimSnapshotModule.readFIMHistory);
const validateFIMAgainstGitMock = vi.mocked(fimAnalysisModule.validateFIMAgainstGit);
const isGitRepoMock = vi.mocked(gitReaderModule.isGitRepo);
const readGitLogMock = vi.mocked(gitReaderModule.readGitLog);

function makeCurrentArtifact() {
  return {
    timestamp: '2026-03-30T00:00:00Z',
    source: 'import-approximation' as const,
    descriptionLength: 42,
    fileIds: ['src/a.ts', 'src/b.ts'],
    packageNames: ['src'],
    fileMatrix: [
      [1, 0],
      [1, 1],
    ],
    packageMatrix: [[2]],
    fileResult: {
      eigenvalues: [2, 1],
      conditionNumber: 2,
      effectiveDimension: 1.8,
      fileCount: 2,
      testCount: 2,
      diagonal: [
        { fileId: 'src/a.ts', selfInfo: 2 },
        { fileId: 'src/b.ts', selfInfo: 1 },
      ],
      uncoveredFiles: [],
      fragilityHotspots: [{ fileId: 'src/b.ts', selfInfo: 1, crb: 1 }],
    },
    packageResult: {
      eigenvalues: [2],
      conditionNumber: 1,
      effectiveDimension: 1,
      fileCount: 1,
      testCount: 2,
      diagonal: [{ fileId: 'src', selfInfo: 2 }],
      uncoveredFiles: [],
      fragilityHotspots: [],
    },
    mantel: {
      observedCorrelation: 0.6,
      permutations: 999,
      pValue: 0.01,
      isValidProxy: true,
    },
  };
}

beforeEach(() => {
  readFIMCurrentArtifactMock.mockReset();
  readFIMHistoryMock.mockReset();
  validateFIMAgainstGitMock.mockReset();
  isGitRepoMock.mockReset();
  readGitLogMock.mockReset();

  readFIMCurrentArtifactMock.mockResolvedValue(makeCurrentArtifact() as any);
  readFIMHistoryMock.mockResolvedValue([
    {
      timestamp: '2026-03-29T00:00:00Z',
      source: 'import-approximation',
      descriptionLength: 40,
      fileCount: 2,
      testCount: 2,
      conditionNumber: 1.5,
      effectiveDimension: 1.7,
      topEigenvalueShares: [0.7, 0.3],
      uncoveredFileCount: 0,
    },
    {
      timestamp: '2026-03-30T00:00:00Z',
      source: 'import-approximation',
      descriptionLength: 42,
      fileCount: 2,
      testCount: 2,
      conditionNumber: 1,
      effectiveDimension: 1,
      topEigenvalueShares: [1],
      uncoveredFileCount: 0,
      mantelCorrelation: 0.6,
      mantelPValue: 0.01,
    },
  ] as any);
  validateFIMAgainstGitMock.mockReturnValue({
    mantel: {
      observedCorrelation: 0.4,
      permutations: 999,
      pValue: 0.02,
      isValidProxy: true,
    },
    packageCochangeMatrix: [[1]],
  });
  isGitRepoMock.mockReturnValue(true);
  readGitLogMock.mockReturnValue([{ sha: 'abc', authorEmail: 'dev@example.com', date: '2026-03-30', files: [] }] as any);
});

describe('registerFIMTools', () => {
  it('returns package-level data by default', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_fim');

    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.current.conditionNumber).toBe(1);
    expect(parsed.current.fileCount).toBe(1);
    expect(parsed.history).toHaveLength(2);
    expect(parsed.gitPredictions.P2_conditionNumber.improved).toBe(true);
  });

  it('returns file-level data when requested', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_fim');

    const result = await cb({ level: 'file' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.current.fileCount).toBe(2);
    expect(parsed.current.fragilityHotspots).toEqual([
      { fileId: 'src/b.ts', selfInfo: 1, crb: 1 },
    ]);
  });

  it('omits mantel when includeMantel=false', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_fim');

    const result = await cb({ includeMantel: false });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.mantel).toBeUndefined();
  });

  it('limits history to snapshotCount entries', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_fim');

    const result = await cb({ snapshotCount: 1 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.history).toHaveLength(1);
  });

  it('recomputes mantel when includeMantel=true and no stored mantel exists', async () => {
    readFIMCurrentArtifactMock.mockResolvedValue({
      ...makeCurrentArtifact(),
      mantel: undefined,
    } as any);

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_fim');

    const result = await cb({ includeMantel: true });
    const parsed = JSON.parse(result.content[0].text);

    expect(validateFIMAgainstGitMock).toHaveBeenCalled();
    expect(parsed.mantel.observedCorrelation).toBe(0.4);
  });

  it('returns a helpful message when no FIM data exists yet', async () => {
    readFIMCurrentArtifactMock.mockResolvedValue(null);

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_fim');

    const result = await cb({});
    expect(result.content[0].text).toContain('No FIM data found');
  });

  it('is registered on the MCP server', () => {
    const server = createMcpServer('/workspace');
    expect(server).toBeDefined();
  });
});
