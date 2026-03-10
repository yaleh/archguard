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

  it('registers archguard_analyze and resolves projectRoot for sessionRoot/workDir/sources', async () => {
    runAnalysisMock.mockResolvedValue({
      config: {
        workDir: '/other/project/.archguard',
        outputDir: '/other/project/.archguard/output',
      },
      diagrams: [],
      results: [],
      queryScopesPersisted: 1,
      persistedScopeKeys: ['ef6c73d9'],
      hasDiagramFailures: false,
    });

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const toolSpy = vi.spyOn(server, 'tool');

    const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
    registerAnalyzeTool(server, {
      defaultRoot: '/workspace',
    });

    const callback = toolSpy.mock.calls.find(
      ([name]) => name === 'archguard_analyze'
    )?.[3] as Function;
    const result = await callback({ projectRoot: '../other/project', sources: ['./src'] });

    expect(runAnalysisMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionRoot: '/other/project',
        workDir: '/other/project/.archguard',
        cliOptions: expect.objectContaining({ sources: ['/other/project/src'] }),
      })
    );
    expect(result.content[0].text).toContain('Analysis completed');
    expect(result.content[0].text).not.toContain('Scope:');
  });

  it('uses defaultRoot when projectRoot is omitted', async () => {
    runAnalysisMock.mockResolvedValue({
      config: {
        workDir: '/workspace/.archguard',
        outputDir: '/workspace/.archguard/output',
      },
      diagrams: [],
      results: [],
      queryScopesPersisted: 1,
      persistedScopeKeys: ['abcd1234'],
      hasDiagramFailures: false,
    });

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const toolSpy = vi.spyOn(server, 'tool');

    const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
    registerAnalyzeTool(server, {
      defaultRoot: '/workspace',
    });

    const callback = toolSpy.mock.calls.find(
      ([name]) => name === 'archguard_analyze'
    )?.[3] as Function;
    await callback({ sources: ['./src'] });

    expect(runAnalysisMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionRoot: '/workspace',
        workDir: '/workspace/.archguard',
        cliOptions: expect.objectContaining({ sources: ['/workspace/src'] }),
      })
    );
  });

  it('returns failure text when runAnalysis throws', async () => {
    runAnalysisMock.mockRejectedValue(new Error('boom'));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const toolSpy = vi.spyOn(server, 'tool');

    const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
    registerAnalyzeTool(server, {
      defaultRoot: '/project',
    });

    const callback = toolSpy.mock.calls.find(
      ([name]) => name === 'archguard_analyze'
    )?.[3] as Function;
    const result = await callback({});
    expect(result.content[0].text).toContain('Analysis failed: boom');
  });

  it('documents and validates lang as a code language enum', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const toolSpy = vi.spyOn(server, 'tool');

    const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
    registerAnalyzeTool(server, {
      defaultRoot: '/project',
    });

    const registration = toolSpy.mock.calls.find(([name]) => name === 'archguard_analyze');
    const description = registration?.[1];
    const schema = registration?.[2] as Record<
      string,
      { safeParse: (value: unknown) => { success: boolean } }
    >;

    expect(description).toContain('code-language plugin override');
    expect(schema.lang.safeParse('typescript').success).toBe(true);
    expect(schema.lang.safeParse('go').success).toBe(true);
    expect(schema.lang.safeParse('zh-CN').success).toBe(false);
  });

  it('rejects concurrent calls for the same project while an analysis is running', async () => {
    let resolveRun: ((value: unknown) => void) | undefined;
    runAnalysisMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRun = resolve;
        })
    );

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const toolSpy = vi.spyOn(server, 'tool');

    const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
    registerAnalyzeTool(server, {
      defaultRoot: '/workspace',
    });

    const callback = toolSpy.mock.calls.find(
      ([name]) => name === 'archguard_analyze'
    )?.[3] as Function;
    const first = callback({ projectRoot: '/repo-a' });
    const second = await callback({ projectRoot: '/repo-a' });

    expect(second.content[0].text).toContain('already running');

    resolveRun?.({
      config: { workDir: '/repo-a/.archguard', outputDir: '/repo-a/.archguard/output' },
      diagrams: [],
      results: [],
      queryScopesPersisted: 0,
      persistedScopeKeys: [],
      hasDiagramFailures: false,
    });
    await first;
  });

  it('allows concurrent calls for different projects', async () => {
    let releaseA: (() => void) | undefined;
    let releaseB: (() => void) | undefined;
    runAnalysisMock.mockImplementation(({ sessionRoot }: { sessionRoot: string }) => {
      return new Promise((resolve) => {
        if (sessionRoot === '/repo-a') {
          releaseA = () =>
            resolve({
              config: { workDir: '/repo-a/.archguard', outputDir: '/repo-a/.archguard/output' },
              diagrams: [],
              results: [],
              queryScopesPersisted: 1,
              persistedScopeKeys: ['a'],
              hasDiagramFailures: false,
            });
          return;
        }
        releaseB = () =>
          resolve({
            config: { workDir: '/repo-b/.archguard', outputDir: '/repo-b/.archguard/output' },
            diagrams: [],
            results: [],
            queryScopesPersisted: 1,
            persistedScopeKeys: ['b'],
            hasDiagramFailures: false,
          });
      });
    });

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const toolSpy = vi.spyOn(server, 'tool');

    const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
    registerAnalyzeTool(server, {
      defaultRoot: '/workspace',
    });

    const callback = toolSpy.mock.calls.find(
      ([name]) => name === 'archguard_analyze'
    )?.[3] as Function;
    const first = callback({ projectRoot: '/repo-a' });
    const second = callback({ projectRoot: '/repo-b' });

    releaseA?.();
    releaseB?.();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.content[0].text).toContain('Analysis completed');
    expect(secondResult.content[0].text).toContain('Analysis completed');
    expect(runAnalysisMock).toHaveBeenCalledTimes(2);
  });

  it('releases the project lock after a failed analysis', async () => {
    runAnalysisMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({
      config: { workDir: '/repo-a/.archguard', outputDir: '/repo-a/.archguard/output' },
      diagrams: [],
      results: [],
      queryScopesPersisted: 1,
      persistedScopeKeys: ['ok'],
      hasDiagramFailures: false,
    });

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const toolSpy = vi.spyOn(server, 'tool');

    const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
    registerAnalyzeTool(server, {
      defaultRoot: '/workspace',
    });

    const callback = toolSpy.mock.calls.find(
      ([name]) => name === 'archguard_analyze'
    )?.[3] as Function;
    const first = await callback({ projectRoot: '/repo-a' });
    const second = await callback({ projectRoot: '/repo-a' });

    expect(first.content[0].text).toContain('Analysis failed: boom');
    expect(second.content[0].text).toContain('Analysis completed');
  });

  describe('formatAnalyzeResponse Paradigm block', () => {
    it('Go project → output contains Paradigm block', async () => {
      runAnalysisMock.mockResolvedValue({
        config: {
          workDir: '/project/.archguard',
          outputDir: '/project/.archguard/output',
        },
        diagrams: [{ name: 'architecture', level: 'package', sources: [], language: 'go' }],
        results: [],
        queryScopesPersisted: 1,
        persistedScopeKeys: ['abc123'],
        hasDiagramFailures: false,
      });

      const server = new McpServer({ name: 'test', version: '1.0.0' });
      const toolSpy = vi.spyOn(server, 'tool');

      const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
      registerAnalyzeTool(server, { defaultRoot: '/project' });

      const callback = toolSpy.mock.calls.find(
        ([name]) => name === 'archguard_analyze'
      )?.[3] as Function;
      const result = await callback({ projectRoot: '/project' });
      const text: string = result.content[0].text;

      expect(text).toContain('Paradigm: package (Go Atlas)');
      expect(text).toContain('Applicable:');
      expect(text).toContain('Not useful:');
    });

    it('TypeScript project → output does NOT contain Paradigm block', async () => {
      runAnalysisMock.mockResolvedValue({
        config: {
          workDir: '/project/.archguard',
          outputDir: '/project/.archguard/output',
        },
        diagrams: [
          { name: 'architecture', level: 'package', sources: [], language: 'typescript' },
        ],
        results: [],
        queryScopesPersisted: 1,
        persistedScopeKeys: ['abc123'],
        hasDiagramFailures: false,
      });

      const server = new McpServer({ name: 'test', version: '1.0.0' });
      const toolSpy = vi.spyOn(server, 'tool');

      const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
      registerAnalyzeTool(server, { defaultRoot: '/project' });

      const callback = toolSpy.mock.calls.find(
        ([name]) => name === 'archguard_analyze'
      )?.[3] as Function;
      const result = await callback({ projectRoot: '/project' });
      const text: string = result.content[0].text;

      expect(text).not.toContain('Paradigm:');
    });

    it('empty diagrams → no Paradigm block (graceful fallback)', async () => {
      runAnalysisMock.mockResolvedValue({
        config: {
          workDir: '/project/.archguard',
          outputDir: '/project/.archguard/output',
        },
        diagrams: [],
        results: [],
        queryScopesPersisted: 1,
        persistedScopeKeys: ['abc123'],
        hasDiagramFailures: false,
      });

      const server = new McpServer({ name: 'test', version: '1.0.0' });
      const toolSpy = vi.spyOn(server, 'tool');

      const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
      registerAnalyzeTool(server, { defaultRoot: '/project' });

      const callback = toolSpy.mock.calls.find(
        ([name]) => name === 'archguard_analyze'
      )?.[3] as Function;
      const result = await callback({ projectRoot: '/project' });
      const text: string = result.content[0].text;

      expect(text).not.toContain('Paradigm:');
    });
  });
});
