/**
 * Tests for the archguard_simulate_refactor_slice MCP tool.
 *
 * The handler is invoked directly (via a spy on `server.tool`) with the GOAL-033
 * fixture graph, so the test proves the tool wiring end-to-end without a live
 * MCP transport. `loadEngine` is mocked, matching the other tool tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerSliceDeltaTool } from '@/cli/mcp/tools/slice-delta-tool.js';
import { loadEngine } from '@/cli/query/engine-loader.js';
import { runSliceDelta } from '@/cli/commands/slice-delta.js';

vi.mock('@/cli/query/engine-loader.js', async () => {
  const actual = await vi.importActual<typeof import('@/cli/query/engine-loader.js')>(
    '@/cli/query/engine-loader.js'
  );
  return { ...actual, loadEngine: vi.fn() };
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const FIX = path.join(REPO_ROOT, 'tests', 'fixtures', 'slice-delta');
const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, 'utf8'));

const goalGraph = readJson(path.join(FIX, 'goal-033-fork-point.arch.json')).extensions.tsAnalysis
  .moduleGraph;
const goalSlice = readJson(path.join(FIX, 'goal-033-slice.json'));

const loadEngineMock = vi.mocked(loadEngine);

function collectTools(server: McpServer, defaultRoot = '/workspace'): Map<string, Function> {
  const tools = new Map<string, Function>();
  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    tools.set(args[0] as string, args[args.length - 1] as Function);
    return server;
  });
  registerSliceDeltaTool(server, defaultRoot);
  return tools;
}

function mockGraph(graph: unknown, scopeKey = 'scope1') {
  loadEngineMock.mockResolvedValue({
    extensionAccessor: { getTsModuleGraph: () => graph },
    scopeEntry: { key: scopeKey },
  } as any);
}

describe('archguard_simulate_refactor_slice — registration', () => {
  it('registers the tool', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    expect(tools.has('archguard_simulate_refactor_slice')).toBe(true);
  });
});

describe('archguard_simulate_refactor_slice — handler', () => {
  beforeEach(() => {
    loadEngineMock.mockReset();
    mockGraph(goalGraph);
  });

  it('returns the 6 → 4 delta for the GOAL-033 slice object', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const handler = collectTools(server).get('archguard_simulate_refactor_slice');
    const result = await handler({ projectRoot: '/workspace', slice: goalSlice });
    const report = JSON.parse(String(result.content[0].text));

    expect(report.status).toBe('evaluated');
    expect(report.current.sccSize).toBe(6);
    expect(report.computedDelta.sccAfter).toEqual(['', 'gate', 'gate/config', 'gate/factories']);
    expect([...report.computedDelta.sccLeft].sort()).toEqual(['cli', 'fan-in']);
    expect(report.guards.clean).toBe(true);
    expect(report.provenance.tool.archguardVersion).toBeTruthy();
  });

  it('passes an optional observed object through to the comparison section only', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const handler = collectTools(server).get('archguard_simulate_refactor_slice');
    const result = await handler({
      projectRoot: '/workspace',
      slice: goalSlice,
      observed: { sccSize: 999, sccMembers: ['nope'] },
    });
    const report = JSON.parse(String(result.content[0].text));
    expect(report.computedDelta.sccAfter).toEqual(['', 'gate', 'gate/config', 'gate/factories']);
    expect(report.observedDelta.sccSize).toBe(999);
    expect(report.predictionComparison.observedVsComputed.relation).toBe('diverges');
  });

  it('returns isError with an actionable hint when the scope cannot be resolved', async () => {
    loadEngineMock.mockRejectedValue(
      new Error('No query data found. Run `archguard analyze` first.')
    );
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const handler = collectTools(server).get('archguard_simulate_refactor_slice');
    const result = await handler({ projectRoot: '/workspace', slice: goalSlice });
    expect(result.isError).toBe(true);
    expect(String(result.content[0].text)).toMatch(/archguard_analyze/);
  });

  it('returns isError with an actionable hint when the scope has no TS module graph', async () => {
    mockGraph(undefined);
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const handler = collectTools(server).get('archguard_simulate_refactor_slice');
    const result = await handler({ projectRoot: '/workspace', slice: goalSlice });
    expect(result.isError).toBe(true);
    expect(String(result.content[0].text)).toMatch(/archguard_analyze/);
    expect(String(result.content[0].text)).toMatch(/moduleGraph/);
  });
});

// ── claudecodeui real fixture + CLI/MCP parity ────────────────────────────────

const CC_ARCH = path.join(FIX, 'claudecodeui-frontend.arch.json');
const CC_SLICE_PATH = path.join(FIX, 'claudecodeui-readdevicename-slice.json');
const ccGraph = readJson(CC_ARCH).extensions.tsAnalysis.moduleGraph;
const ccSlice = readJson(CC_SLICE_PATH);

describe('archguard_simulate_refactor_slice — claudecodeui real fixture', () => {
  beforeEach(() => {
    loadEngineMock.mockReset();
    mockGraph(ccGraph);
  });

  it('AC1: evaluates the real single-symbol cut once stays is declared', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const handler = collectTools(server).get('archguard_simulate_refactor_slice');
    const result = await handler({ projectRoot: '/workspace', slice: ccSlice });
    const report = JSON.parse(String(result.content[0].text));
    expect(report.status).toBe('evaluated');
    expect(report.current.sccSize).toBe(42);
    expect(report.accounting.length).toBeGreaterThanOrEqual(3);
    expect(report.unknowns.barrelEdges.length).toBeGreaterThanOrEqual(2);
  });

  it('AC9: CLI and MCP agree byte-for-byte on computedDelta / negativeControl / guards / accounting', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const handler = collectTools(server).get('archguard_simulate_refactor_slice');
    const mcpResult = await handler({ projectRoot: '/workspace', slice: ccSlice });
    const mcpReport = JSON.parse(String(mcpResult.content[0].text));

    const cli = await runSliceDelta({ slice: CC_SLICE_PATH, arch: CC_ARCH });
    const cliReport = cli.report;

    expect(JSON.stringify(mcpReport.computedDelta)).toBe(JSON.stringify(cliReport.computedDelta));
    expect(JSON.stringify(mcpReport.negativeControl)).toBe(
      JSON.stringify(cliReport.negativeControl)
    );
    expect(JSON.stringify(mcpReport.guards)).toBe(JSON.stringify(cliReport.guards));
    expect(JSON.stringify(mcpReport.accounting)).toBe(JSON.stringify(cliReport.accounting));
    expect(JSON.stringify(mcpReport.unknowns)).toBe(JSON.stringify(cliReport.unknowns));
  });
});
