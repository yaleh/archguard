/**
 * Unit tests for git-history-analyze-tool.ts (archguard_analyze_git).
 *
 * Focuses on the summary output: existing vs deleted files are listed separately.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CommitRecord } from '@/cli/git-history/git-log-reader.js';

// ---------------------------------------------------------------------------
// Hoisted mock functions (must be top-level so vi.mock factories can close over them)
// ---------------------------------------------------------------------------

const { mockPathExists, mockReadGitLog, mockIsGitRepo, mockGetHeadRef, mockGetBranch, mockWriteArtifacts } =
  vi.hoisted(() => ({
    mockPathExists: vi.fn(),
    mockReadGitLog: vi.fn(),
    mockIsGitRepo: vi.fn().mockReturnValue(true),
    mockGetHeadRef: vi.fn().mockReturnValue('abc1234'),
    mockGetBranch: vi.fn().mockReturnValue('master'),
    mockWriteArtifacts: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock('@/cli/git-history/git-log-reader.js', () => ({
  readGitLog: mockReadGitLog,
  isGitRepo: mockIsGitRepo,
  getHeadRef: mockGetHeadRef,
  getCurrentBranch: mockGetBranch,
}));

vi.mock('fs-extra', async () => {
  const actual = await vi.importActual<typeof import('fs-extra')>('fs-extra');
  return {
    ...actual,
    default: {
      ...(actual as any).default,
      pathExists: mockPathExists,
      ensureDir: vi.fn().mockResolvedValue(undefined),
      writeJson: vi.fn().mockResolvedValue(undefined),
    },
    pathExists: mockPathExists,
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/cli/git-history/history-writer.js', () => ({
  writeHistoryArtifacts: mockWriteArtifacts,
}));

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are registered)
// ---------------------------------------------------------------------------

const { registerGitHistoryAnalyzeTool } = await import(
  '@/cli/mcp/tools/git-history-analyze-tool.js'
);

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCommit(
  sha: string,
  files: Array<{ path: string; added: number; deleted: number }>
): CommitRecord {
  return { sha, authorEmail: 'dev@example.com', date: '2026-06-13', files };
}

/**
 * Build a commit list where activeFile appears activeCount times
 * and deletedFile appears deletedCount times (interleaved).
 */
function makeCommits(
  activeFile: string,
  activeCount: number,
  deletedFile: string,
  deletedCount: number
): CommitRecord[] {
  const commits: CommitRecord[] = [];
  for (let i = 0; i < Math.max(activeCount, deletedCount); i++) {
    const files = [];
    if (i < activeCount) files.push({ path: activeFile, added: 10, deleted: 2 });
    if (i < deletedCount) files.push({ path: deletedFile, added: 8, deleted: 200 });
    if (files.length > 0) commits.push(makeCommit(`sha${i}`, files));
  }
  return commits;
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
    return undefined as any;
  });
  registerGitHistoryAnalyzeTool(server, defaultRoot);
  return tools;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockIsGitRepo.mockReturnValue(true);
  mockGetHeadRef.mockReturnValue('abc1234');
  mockGetBranch.mockReturnValue('master');
  mockWriteArtifacts.mockResolvedValue(undefined);
});

describe('archguard_analyze_git — summary: active vs deleted files', () => {
  it('lists only existing files under "Top churned files"', async () => {
    // deletedFile has more commits but is deleted — must not be in active section
    const commits = makeCommits('src/cli/run.ts', 10, 'src/analysis/fim/old.ts', 12);
    mockReadGitLog.mockReturnValue(commits);
    mockPathExists.mockImplementation(async (p: string) => p.includes('run.ts'));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_analyze_git');
    const result = await cb({ projectRoot: '/workspace' });
    const text: string = result.content[0].text;

    const activeSection = text.slice(0, text.indexOf('Deleted') === -1 ? undefined : text.indexOf('Deleted'));
    expect(activeSection).toContain('src/cli/run.ts');
    expect(activeSection).not.toContain('src/analysis/fim/old.ts');
  });

  it('deleted files appear in a separate "Deleted" section, not in the active top list', async () => {
    const commits = makeCommits('src/active.ts', 5, 'src/deleted.ts', 10);
    mockReadGitLog.mockReturnValue(commits);
    mockPathExists.mockImplementation(async (p: string) => p.includes('active.ts'));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_analyze_git');
    const result = await cb({ projectRoot: '/workspace' });
    const text: string = result.content[0].text;

    const activeHeaderIdx = text.indexOf('Top churned files');
    const deletedHeaderIdx = text.indexOf('Deleted');
    const deletedFileIdx = text.indexOf('src/deleted.ts');
    const activeFileIdx = text.indexOf('src/active.ts');

    expect(activeHeaderIdx).toBeGreaterThanOrEqual(0);
    expect(deletedHeaderIdx).toBeGreaterThanOrEqual(0);
    // deleted file listed after the Deleted header
    expect(deletedFileIdx).toBeGreaterThan(deletedHeaderIdx);
    // active file listed before the Deleted header
    expect(activeFileIdx).toBeLessThan(deletedHeaderIdx);
  });

  it('omits the deleted section when all files still exist', async () => {
    const commits = [
      makeCommit('sha0', [
        { path: 'src/a.ts', added: 10, deleted: 2 },
        { path: 'src/b.ts', added: 5, deleted: 1 },
      ]),
    ];
    mockReadGitLog.mockReturnValue(commits);
    mockPathExists.mockResolvedValue(true);

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_analyze_git');
    const result = await cb({ projectRoot: '/workspace' });
    const text: string = result.content[0].text;

    expect(text).not.toContain('Deleted');
    expect(text).toContain('src/a.ts');
  });

  it('shows deleted count note in the file count line when deleted files are present', async () => {
    const commits = makeCommits('src/active.ts', 3, 'src/gone.ts', 8);
    mockReadGitLog.mockReturnValue(commits);
    mockPathExists.mockImplementation(async (p: string) => p.includes('active.ts'));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_analyze_git');
    const result = await cb({ projectRoot: '/workspace' });
    const text: string = result.content[0].text;

    // e.g. "Files:     N changed (1 deleted)"
    expect(text).toMatch(/\d+ deleted/);
  });
});
