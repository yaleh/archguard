/**
 * TASK-43: MCP protocol stdout must stay clean. Parser-runtime diagnostics
 * (effective-runtime lines, deprecation warnings) route through the
 * StderrReporter — never into MCP response payloads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const runAnalysisMock = vi.fn();

vi.mock('@/cli/analyze/run-analysis.js', () => ({
  runAnalysis: runAnalysisMock,
}));

const DIAGNOSTIC_LINE =
  '[parser-runtime] go: policy=auto source=default -> wasm (native probe failed: no native runtime)';

describe('MCP analyze stdout cleanliness (TASK-43)', () => {
  beforeEach(() => {
    vi.resetModules();
    runAnalysisMock.mockReset();
  });

  it('routes runtime diagnostics to stderr and never into the MCP response payload', async () => {
    runAnalysisMock.mockImplementation(async (options: { reporter: { info: (m: string) => void } }) => {
      // The analyze path surfaces the effective-runtime summary via the reporter.
      options.reporter.info(DIAGNOSTIC_LINE);
      return {
        config: { workDir: '/workspace/.archguard', outputDir: '/workspace/.archguard/output' },
        diagrams: [],
        results: [],
        queryScopesPersisted: 1,
        persistedScopeKeys: ['k'],
        hasDiagramFailures: false,
      };
    });

    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const toolSpy = vi.spyOn(server, 'tool');
    const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
    registerAnalyzeTool(server, { defaultRoot: '/workspace' });
    const callback = toolSpy.mock.calls.find(([name]) => name === 'archguard_analyze')?.[3] as Function;

    const result = await callback({ lang: 'go' });
    const payload = result.content[0].text as string;

    // Stdout (MCP payload) is protocol-clean:
    expect(payload).not.toContain('[parser-runtime]');
    expect(payload).toContain('Analysis completed');

    // The diagnostic went to stderr via StderrReporter:
    expect(stderrSpy.mock.calls.some((args) => String(args[0]).includes('[parser-runtime] go:'))).toBe(true);

    stderrSpy.mockRestore();
  });

  it('keeps error payloads actionable without leaking diagnostic internals', async () => {
    const { ParserInitializationError } = await import('@/plugins/shared/parser-backend.js');
    runAnalysisMock.mockRejectedValue(
      new ParserInitializationError('kotlin', 'native', new Error('probe failed; ARCHGUARD_PARSER_RUNTIME=wasm fixes it'))
    );

    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const toolSpy = vi.spyOn(server, 'tool');
    const { registerAnalyzeTool } = await import('@/cli/mcp/analyze-tool.js');
    registerAnalyzeTool(server, { defaultRoot: '/workspace' });
    const callback = toolSpy.mock.calls.find(([name]) => name === 'archguard_analyze')?.[3] as Function;

    const result = await callback({ lang: 'kotlin' });
    const payload = result.content[0].text as string;
    expect(payload).toContain('Analysis failed (parser initialization)');
    expect(payload).toContain('ARCHGUARD_PARSER_RUNTIME=wasm');
    stderrSpy.mockRestore();
  });
});
