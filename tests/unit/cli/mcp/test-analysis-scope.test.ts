/**
 * Unit tests for Phase 38D: MCP test analysis scope fix.
 *
 * Tests:
 * 1. When engine returns 0 test files, tools return actionable diagnostic
 * 2. scope parameter is threaded to loadEngine
 * 3. When test data exists, normal response is returned
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Entity, ArchJSON } from '@/types/index.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import type { ArchJSONExtensions, TestAnalysis } from '@/types/extensions.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import { registerTestAnalysisTools } from '@/cli/mcp/tools/test-analysis-tools.js';
import { loadEngine, readManifest } from '@/cli/query/engine-loader.js';
import { ExtensionAccessor } from '@/core/query/extension-accessor.js';

vi.mock('@/cli/query/engine-loader.js', async () => {
  const actual = await vi.importActual<typeof import('@/cli/query/engine-loader.js')>(
    '@/cli/query/engine-loader.js'
  );
  return {
    ...actual,
    loadEngine: vi.fn(),
    readManifest: vi.fn(),
  };
});

const scopeEntry: QueryScopeEntry = {
  key: 'src-scope',
  label: 'src (typescript)',
  language: 'typescript',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 5,
  relationCount: 2,
  hasAtlasExtension: false,
};

function makeEntity(id: string, name: string): Entity {
  return {
    id,
    name,
    type: 'class',
    visibility: 'public',
    members: [],
    sourceLocation: { file: 'src/foo.ts', startLine: 1, endLine: 10 },
  };
}

const sampleAnalysis: TestAnalysis = {
  version: '1.1',
  patternConfigSource: 'auto',
  testFiles: [
    {
      id: 'tests/unit/foo.test.ts',
      filePath: '/project/tests/unit/foo.test.ts',
      frameworks: ['vitest'],
      testType: 'unit',
      testCaseCount: 3,
      assertionCount: 9,
      skipCount: 0,
      assertionDensity: 3.0,
      coveredEntityIds: ['entity-1'],
    },
  ],
  coverageMap: [
    {
      sourceEntityId: 'entity-1',
      coveredByTestIds: ['tests/unit/foo.test.ts'],
      coverageScore: 0.9,
    },
  ],
  issues: [],
  metrics: {
    totalTestFiles: 1,
    byType: { unit: 1, integration: 0, e2e: 0, performance: 0, debug: 0, unknown: 0 },
    entityCoverageRatio: 0.9,
    assertionDensity: 3.0,
    skipRatio: 0.0,
    issueCount: { zero_assertion: 0, orphan_test: 0, skip_accumulation: 0, assertion_poverty: 0 },
  },
};

/** Engine with test analysis containing 0 test files — simulates src-only scope */
function createEngineWithZeroTestFiles(): { engine: QueryEngine; archJson: ArchJSON } {
  const emptyAnalysis: TestAnalysis = {
    ...sampleAnalysis,
    testFiles: [],
    coverageMap: [],
    issues: [],
    metrics: {
      ...sampleAnalysis.metrics,
      totalTestFiles: 0,
    },
  };
  const extensions: ArchJSONExtensions = { testAnalysis: emptyAnalysis };
  const archJson: ArchJSON = {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities: [makeEntity('entity-1', 'Foo')],
    relations: [],
    extensions,
  };
  const archIndex = buildArchIndex(archJson, 'hash');
  const engine = new QueryEngine({ archJson, archIndex, scopeEntry });
  return { engine, archJson };
}

/** Engine with test analysis containing test files */
function createEngineWithTestFiles(): { engine: QueryEngine; archJson: ArchJSON } {
  const extensions: ArchJSONExtensions = { testAnalysis: sampleAnalysis };
  const archJson: ArchJSON = {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities: [makeEntity('entity-1', 'Foo')],
    relations: [],
    extensions,
  };
  const archIndex = buildArchIndex(archJson, 'hash');
  const engine = new QueryEngine({ archJson, archIndex, scopeEntry });
  return { engine, archJson };
}

function wrapEngine({ engine, archJson }: { engine: QueryEngine; archJson: ArchJSON }) {
  return { engine, extensionAccessor: new ExtensionAccessor(archJson), scopeEntry };
}

function collectTools(server: McpServer, defaultRoot = '/workspace'): Map<string, Function> {
  const tools = new Map<string, Function>();
  const originalTool = server.tool.bind(server);

  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    const name = args[0] as string;
    const cb = args[args.length - 1] as Function;
    tools.set(name, cb);
    return (originalTool as Function)(...args);
  });

  registerTestAnalysisTools(server, defaultRoot);
  return tools;
}

const loadEngineMock = vi.mocked(loadEngine);
const readManifestMock = vi.mocked(readManifest);

beforeEach(() => {
  loadEngineMock.mockReset();
  readManifestMock.mockReset();
});

// ---------------------------------------------------------------------------
// Diagnostic when totalTestFiles === 0 (scope mismatch scenario)
// ---------------------------------------------------------------------------

describe('38D — diagnostic when totalTestFiles is 0', () => {
  beforeEach(() => {
    loadEngineMock.mockResolvedValue(wrapEngine(createEngineWithZeroTestFiles()));
    // readManifest returns scopes listing so we can show them in diagnostic
    readManifestMock.mockResolvedValue({
      version: '1.1',
      generatedAt: '2026-01-01T00:00:00Z',
      globalScopeKey: 'global-scope',
      scopes: [
        {
          key: 'src-scope',
          label: 'src (typescript)',
          language: 'typescript',
          kind: 'parsed',
          sources: ['/project/src'],
          entityCount: 5,
          relationCount: 2,
          hasAtlasExtension: false,
        },
        {
          key: 'global-scope',
          label: 'global (typescript)',
          language: 'typescript',
          kind: 'derived',
          sources: ['/project'],
          entityCount: 20,
          relationCount: 10,
          hasAtlasExtension: false,
        },
      ],
    });
  });

  it('archguard_detect_test_patterns returns diagnostic when 0 test files', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_detect_test_patterns');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain('No test files');
    expect(Array.isArray(parsed.diagnosis)).toBe(true);
    expect(parsed.diagnosis.some((d: string) => d.includes('src/'))).toBe(true);
  });

  it('archguard_detect_test_patterns diagnostic includes available scopes', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_detect_test_patterns');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    // Should mention at least one scope key
    const diagText = parsed.diagnosis.join(' ');
    expect(diagText).toMatch(/src-scope|global-scope|Available scopes/i);
  });

  it('archguard_get_test_metrics returns diagnostic when 0 test files', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_metrics');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain('No test files');
    expect(Array.isArray(parsed.diagnosis)).toBe(true);
  });

  it('archguard_get_test_issues returns diagnostic when 0 test files', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_issues');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain('No test files');
    expect(Array.isArray(parsed.diagnosis)).toBe(true);
  });

  it('diagnostic mentions --include-tests flag', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_metrics');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    const diagText = parsed.diagnosis.join(' ');
    expect(diagText).toContain('--include-tests');
  });
});

// ---------------------------------------------------------------------------
// scope parameter is threaded to loadEngine
// ---------------------------------------------------------------------------

describe('38D — scope parameter threading', () => {
  beforeEach(() => {
    loadEngineMock.mockResolvedValue(wrapEngine(createEngineWithTestFiles()));
  });

  it('archguard_detect_test_patterns threads scope to loadEngine', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/project');
    const cb = tools.get('archguard_detect_test_patterns');
    await cb({ scope: 'global-scope' });
    expect(loadEngineMock).toHaveBeenCalledWith(
      expect.stringContaining('.archguard'),
      'global-scope'
    );
  });

  it('archguard_get_test_metrics threads scope to loadEngine', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/project');
    const cb = tools.get('archguard_get_test_metrics');
    await cb({ scope: 'src-scope' });
    expect(loadEngineMock).toHaveBeenCalledWith(expect.stringContaining('.archguard'), 'src-scope');
  });

  it('archguard_get_test_issues threads scope to loadEngine', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/project');
    const cb = tools.get('archguard_get_test_issues');
    await cb({ scope: 'global-scope' });
    expect(loadEngineMock).toHaveBeenCalledWith(
      expect.stringContaining('.archguard'),
      'global-scope'
    );
  });

  it('archguard_get_test_metrics uses no scope when omitted', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/project');
    const cb = tools.get('archguard_get_test_metrics');
    await cb({});
    // called with archDir and undefined (no scope key)
    const calls = loadEngineMock.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[1]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Normal response when test data exists
// ---------------------------------------------------------------------------

describe('38D — normal response when test data exists', () => {
  beforeEach(() => {
    loadEngineMock.mockResolvedValue(wrapEngine(createEngineWithTestFiles()));
  });

  it('archguard_detect_test_patterns returns frameworks when data present', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_detect_test_patterns');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    // Normal response — no error field
    expect(parsed.error).toBeUndefined();
    expect(parsed.detectedFrameworks).toBeDefined();
    expect(parsed.detectedFrameworks.some((f: { name: string }) => f.name === 'vitest')).toBe(true);
  });

  it('archguard_get_test_metrics returns metrics when data present', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_metrics');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeUndefined();
    expect(parsed.totalTestFiles).toBe(1);
  });

  it('archguard_get_test_issues returns issues when data present', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_issues');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    // issues is an array, not an error object
    expect(Array.isArray(parsed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Diagnostic when readManifest throws (no manifest yet)
// ---------------------------------------------------------------------------

describe('38D — diagnostic fallback when readManifest fails', () => {
  beforeEach(() => {
    loadEngineMock.mockResolvedValue(wrapEngine(createEngineWithZeroTestFiles()));
    readManifestMock.mockRejectedValue(new Error('No query data found'));
  });

  it('archguard_get_test_metrics still returns diagnostic even if manifest unreadable', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_metrics');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeDefined();
    // Should fall back gracefully — diagnosis still present
    expect(Array.isArray(parsed.diagnosis)).toBe(true);
  });
});
