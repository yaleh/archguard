import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const runAnalysisMock = vi.fn();

vi.mock('@/cli/analyze/run-analysis.js', () => ({
  runAnalysis: runAnalysisMock,
}));

describe('MCP analyze stdout safety', () => {
  beforeEach(() => {
    vi.resetModules();
    runAnalysisMock.mockReset();
    runAnalysisMock.mockResolvedValue({
      config: {
        workDir: '/project/.archguard',
        outputDir: '/project/.archguard/output',
      },
      diagrams: [],
      results: [],
      queryScopesPersisted: 1,
      persistedScopeKeys: ['abcd1234'],
      hasDiagramFailures: false,
    });
  });

  it('does not write business logs to stdout during analyze tool execution', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const toolSpy = vi.spyOn(server, 'tool');
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
    registerAnalyzeTool(server, {
      sessionRoot: '/project',
      archDir: '/project/.archguard',
      getActiveScope: () => undefined,
      setActiveScope: vi.fn(),
      invalidateEngine: vi.fn(),
    });

    const callback = toolSpy.mock.calls.find(([name]) => name === 'archguard_analyze')?.[3] as Function;
    await callback({ sources: ['./src'] });

    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });
});
