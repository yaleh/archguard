/**
 * Unit tests for archguard_get_ccb MCP tool.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CognitiveContextBundle } from '@/cli/cognitive/ccb-schema.js';
import fsExtra from 'fs-extra';
import path from 'path';

// ── Mock assembleCcb ──────────────────────────────────────────────────────────
// IMPORTANT: vi.mock is hoisted, so we cannot reference outer variables in the
// factory. Use vi.fn() directly in the factory and retrieve it via importMock.

vi.mock('@/cli/cognitive/ccb-assembler.js', () => ({
  assembleCcb: vi.fn(),
  filePathToId: (p: string) => p.replace(/[/.:]/g, '-').replace(/\.[^-]+$/, ''),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockBundle: CognitiveContextBundle = {
  fileId: 'src-cli-query-query-engine',
  filePath: 'src/cli/query/query-engine.ts',
  fileHash: 'abc123',
  assembledAt: '2026-06-22T00:00:00.000Z',
  structural: {
    name: 'QueryEngine',
    found: true,
    entityId: 'foo',
    methodCount: 5,
    fieldCount: 2,
    inDegree: 3,
    outDegree: 4,
    topDependents: [],
    topDependencies: [],
  },
  behavioral: null,
  git: null,
  guidance: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Register the tool and capture the callback. */
async function registerAndCapture(defaultRoot = '/workspace'): Promise<{
  tools: Map<string, Function>;
  server: McpServer;
  assembleCcbMock: ReturnType<typeof vi.fn>;
}> {
  const { registerCcbTool } = await import('@/cli/mcp/tools/ccb-tool.js');
  const assemblerModule = await import('@/cli/cognitive/ccb-assembler.js');
  const assembleCcbMock = vi.mocked(assemblerModule.assembleCcb);

  const server = new McpServer({ name: 'test', version: '1.0.0' });
  const tools = new Map<string, Function>();

  const originalTool = server.tool.bind(server);
  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    const name = args[0] as string;
    const cb = args[args.length - 1] as Function;
    tools.set(name, cb);
    return (originalTool as Function)(...args);
  });

  registerCcbTool(server, defaultRoot);
  return { tools, server, assembleCcbMock };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('archguard_get_ccb tool registration', () => {
  it('archguard_get_ccb tool is registered', async () => {
    const { tools } = await registerAndCapture();
    expect(tools.has('archguard_get_ccb')).toBe(true);
  });
});

describe('archguard_get_ccb tool behaviour', () => {
  it('tool returns assembled CCB JSON with fileId and assembledAt', async () => {
    const { tools, assembleCcbMock } = await registerAndCapture();
    assembleCcbMock.mockResolvedValue(mockBundle);

    const cb = tools.get('archguard_get_ccb')!;
    const result = await cb({ filePath: 'src/cli/query/query-engine.ts' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.fileId).toBe(mockBundle.fileId);
    expect(parsed.assembledAt).toBe(mockBundle.assembledAt);
    expect(parsed.structural).not.toBeNull();
  });

  it('forceRefresh param is forwarded to assembleCcb', async () => {
    const { tools, assembleCcbMock } = await registerAndCapture();
    assembleCcbMock.mockResolvedValue(mockBundle);

    const cb = tools.get('archguard_get_ccb')!;
    await cb({ filePath: 'src/cli/query/query-engine.ts', forceRefresh: true });

    expect(assembleCcbMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      { forceRefresh: true }
    );
  });

  it('returns error text when assembleCcb throws', async () => {
    const { tools, assembleCcbMock } = await registerAndCapture();
    assembleCcbMock.mockRejectedValue(new Error('assembly failed'));

    const cb = tools.get('archguard_get_ccb')!;
    const result = await cb({ filePath: 'src/nonexistent.ts' });
    expect(result.content[0].text).toContain('Error');
  });
});

describe('cognitive-prep SKILL.md and .gitignore', () => {
  it('cognitive-prep SKILL.md exists', () => {
    const projectRoot = process.cwd();
    const skillPath = path.join(projectRoot, '.claude', 'skills', 'cognitive-prep', 'SKILL.md');
    expect(fsExtra.existsSync(skillPath)).toBe(true);
  });

  it('.gitignore contains .archguard/cognitive', async () => {
    const projectRoot = process.cwd();
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const content = await fsExtra.readFile(gitignorePath, 'utf-8');
    expect(content).toContain('.archguard/cognitive');
  });
});
