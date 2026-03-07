import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const runAnalysisMock = vi.fn();

vi.mock('@/cli/analyze/run-analysis.js', () => ({
  runAnalysis: runAnalysisMock,
}));

describe('registerAnalyzeTool', () => {
  beforeEach(() => {
    vi.resetModules();
    runAnalysisMock.mockReset();
  });

  it('registers archguard_analyze and invalidates engine when there is no fixed scope', async () => {
    runAnalysisMock.mockResolvedValue({
      config: {
        workDir: '/project/.archguard',
        outputDir: '/project/.archguard/output',
      },
      diagrams: [],
      results: [],
      queryScopesPersisted: 1,
      persistedScopeKeys: ['ef6c73d9'],
      hasDiagramFailures: false,
    });

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const toolSpy = vi.spyOn(server, 'tool');
    const invalidateEngine = vi.fn();
    const setActiveScope = vi.fn();

    const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
    registerAnalyzeTool(server, {
      sessionRoot: '/project',
      archDir: '/project/.archguard',
      getActiveScope: () => undefined,
      setActiveScope,
      invalidateEngine,
    });

    const callback = toolSpy.mock.calls.find(([name]) => name === 'archguard_analyze')?.[3] as Function;
    const result = await callback({ sources: ['./src'] });

    expect(invalidateEngine).toHaveBeenCalledTimes(1);
    expect(setActiveScope).not.toHaveBeenCalled();
    expect(runAnalysisMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionRoot: '/project',
        workDir: '/project/.archguard',
        cliOptions: expect.objectContaining({ sources: ['/project/src'] }),
      }),
    );
    expect(result.content[0].text).toContain('Analysis completed');
  });

  it('updates fixed scope only when the persisted scope key exists', async () => {
    const { hashSources } = await import('@/cli/processors/arch-json-provider.js');
    const expectedScopeKey = hashSources(['/project/src']);
    runAnalysisMock.mockResolvedValue({
      config: {
        workDir: '/project/.archguard',
        outputDir: '/project/.archguard/output',
      },
      diagrams: [],
      results: [],
      queryScopesPersisted: 1,
      persistedScopeKeys: [expectedScopeKey],
      hasDiagramFailures: false,
    });

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const toolSpy = vi.spyOn(server, 'tool');
    const invalidateEngine = vi.fn();
    const setActiveScope = vi.fn();

    const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
    registerAnalyzeTool(server, {
      sessionRoot: '/project',
      archDir: '/project/.archguard',
      getActiveScope: () => 'oldscope',
      setActiveScope,
      invalidateEngine,
    });

    const callback = toolSpy.mock.calls.find(([name]) => name === 'archguard_analyze')?.[3] as Function;
    await callback({ sources: ['./src'] });

    expect(setActiveScope).toHaveBeenCalledWith(expectedScopeKey);
    expect(invalidateEngine).not.toHaveBeenCalled();
  });

  it('returns failure text when runAnalysis throws', async () => {
    runAnalysisMock.mockRejectedValue(new Error('boom'));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const toolSpy = vi.spyOn(server, 'tool');

    const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
    registerAnalyzeTool(server, {
      sessionRoot: '/project',
      archDir: '/project/.archguard',
      getActiveScope: () => undefined,
      setActiveScope: vi.fn(),
      invalidateEngine: vi.fn(),
    });

    const callback = toolSpy.mock.calls.find(([name]) => name === 'archguard_analyze')?.[3] as Function;
    const result = await callback({});
    expect(result.content[0].text).toContain('Analysis failed: boom');
  });

  it('rejects concurrent calls while an analysis is running', async () => {
    let resolveRun: ((value: unknown) => void) | undefined;
    runAnalysisMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRun = resolve;
        }),
    );

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const toolSpy = vi.spyOn(server, 'tool');

    const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
    registerAnalyzeTool(server, {
      sessionRoot: '/project',
      archDir: '/project/.archguard',
      getActiveScope: () => undefined,
      setActiveScope: vi.fn(),
      invalidateEngine: vi.fn(),
    });

    const callback = toolSpy.mock.calls.find(([name]) => name === 'archguard_analyze')?.[3] as Function;
    const first = callback({});
    const second = await callback({});

    expect(second.content[0].text).toContain('already running');

    resolveRun?.({
      config: { workDir: '/project/.archguard', outputDir: '/project/.archguard/output' },
      diagrams: [],
      results: [],
      queryScopesPersisted: 0,
      persistedScopeKeys: [],
      hasDiagramFailures: false,
    });
    await first;
  });
});
