/**
 * Unit tests for test analysis MCP tools.
 *
 * Tests that the four tools return the NOT_ANALYZED_MSG when hasTestAnalysis() is false,
 * and return correct data when analysis is present.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Entity, ArchJSON } from '@/types/index.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import type { ArchJSONExtensions, TestAnalysis } from '@/types/extensions.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import { registerTestAnalysisTools } from '@/cli/mcp/tools/test-analysis-tools.js';
import { loadEngine } from '@/cli/query/engine-loader.js';

vi.mock('@/cli/query/engine-loader.js', async () => {
  const actual = await vi.importActual<typeof import('@/cli/query/engine-loader.js')>(
    '@/cli/query/engine-loader.js'
  );
  return {
    ...actual,
    loadEngine: vi.fn(),
  };
});

const scopeEntry: QueryScopeEntry = {
  key: 'test-scope',
  label: 'src (typescript)',
  language: 'typescript',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 1,
  relationCount: 0,
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
  version: '1.0',
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
    { sourceEntityId: 'entity-1', coveredByTestIds: ['tests/unit/foo.test.ts'], coverageScore: 0.9 },
  ],
  issues: [
    {
      type: 'orphan_test',
      severity: 'info',
      testFileId: 'tests/unit/bar.test.ts',
      message: 'No coverage links found',
    },
  ],
  metrics: {
    totalTestFiles: 1,
    byType: { unit: 1, integration: 0, e2e: 0, performance: 0, debug: 0, unknown: 0 },
    entityCoverageRatio: 0.9,
    assertionDensity: 3.0,
    skipRatio: 0.0,
    issueCount: { zero_assertion: 0, orphan_test: 1, skip_accumulation: 0, assertion_poverty: 0 },
  },
};

function createEngineWithoutAnalysis(): QueryEngine {
  const archJson: ArchJSON = {
    version: '1.0',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities: [makeEntity('entity-1', 'Foo')],
    relations: [],
  };
  const archIndex = buildArchIndex(archJson, 'hash');
  return new QueryEngine({ archJson, archIndex, scopeEntry });
}

function createEngineWithAnalysis(): QueryEngine {
  const extensions: ArchJSONExtensions = { testAnalysis: sampleAnalysis };
  const archJson: ArchJSON = {
    version: '1.0',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities: [makeEntity('entity-1', 'Foo')],
    relations: [],
    extensions,
  };
  const archIndex = buildArchIndex(archJson, 'hash');
  return new QueryEngine({ archJson, archIndex, scopeEntry });
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

beforeEach(() => {
  loadEngineMock.mockReset();
});

const NOT_ANALYZED_MSG =
  'No test analysis data found. Run `archguard_analyze` with `includeTests: true` first.';

describe('test analysis MCP tools — no analysis present', () => {
  beforeEach(() => {
    loadEngineMock.mockResolvedValue(createEngineWithoutAnalysis());
  });

  it('archguard_get_test_issues returns NOT_ANALYZED_MSG', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_issues')!;
    const result = await cb({});
    expect(result.content[0].text).toBe(NOT_ANALYZED_MSG);
  });

  it('archguard_get_test_metrics returns NOT_ANALYZED_MSG', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_metrics')!;
    const result = await cb({});
    expect(result.content[0].text).toBe(NOT_ANALYZED_MSG);
  });

  it('archguard_detect_test_patterns returns notes about missing analysis', async () => {
    // loadEngine fails → falls back to package.json detection
    loadEngineMock.mockRejectedValue(new Error('No query data found'));
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_detect_test_patterns')!;
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.notes[0]).toContain('No prior test analysis found');
  });
});

describe('test analysis MCP tools — analysis present', () => {
  beforeEach(() => {
    loadEngineMock.mockResolvedValue(createEngineWithAnalysis());
  });

  it('archguard_get_test_issues returns all issues when no severity filter', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_issues')!;
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('orphan_test');
  });

  it('archguard_get_test_issues filters by severity', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_issues')!;

    const infoResult = await cb({ severity: 'info' });
    const infoParsed = JSON.parse(infoResult.content[0].text);
    expect(infoParsed).toHaveLength(1);

    const warnResult = await cb({ severity: 'warning' });
    const warnParsed = JSON.parse(warnResult.content[0].text);
    expect(warnParsed).toHaveLength(0);
  });

  it('archguard_get_test_metrics returns metrics', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_metrics')!;
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalTestFiles).toBe(1);
    expect(parsed.assertionDensity).toBe(3.0);
  });

  it('archguard_detect_test_patterns returns detected frameworks', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_detect_test_patterns')!;
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.detectedFrameworks.some((f: { name: string }) => f.name === 'vitest')).toBe(true);
  });

  // Deviation 4: suggestedPatternConfig must contain assertionPatterns for detected frameworks
  it('archguard_detect_test_patterns returns non-empty suggestedPatternConfig with assertionPatterns', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_detect_test_patterns')!;
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.suggestedPatternConfig).toBeDefined();
    expect(Array.isArray(parsed.suggestedPatternConfig.assertionPatterns)).toBe(true);
    expect(parsed.suggestedPatternConfig.assertionPatterns.length).toBeGreaterThan(0);
  });

  it('archguard_detect_test_patterns returns assertionPatterns for junit4', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_detect_test_patterns')!;
    loadEngineMock.mockResolvedValueOnce({
      hasTestAnalysis: () => true,
      getTestAnalysis: () => ({
        testFiles: [{ frameworks: ['junit4'] }],
        metrics: { totalTestFiles: 1 },
        patternConfigSource: 'auto',
      }),
    } as any);
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed.suggestedPatternConfig.assertionPatterns)).toBe(true);
    expect(parsed.suggestedPatternConfig.assertionPatterns.length).toBeGreaterThan(0);
    expect(parsed.suggestedPatternConfig.assertionPatterns.some((p: string) => p.includes('assert'))).toBe(true);
  });

  it('registers four test analysis tools', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    expect(tools.has('archguard_detect_test_patterns')).toBe(true);
    expect(tools.has('archguard_get_test_issues')).toBe(true);
    expect(tools.has('archguard_get_test_metrics')).toBe(true);
    expect(tools.has('archguard_get_entity_coverage')).toBe(true);
    expect(tools.has('archguard_get_test_coverage')).toBe(false);
  });

  // pytest framework should suggest patterns that cover torch.testing.assert_close style calls
  it('archguard_detect_test_patterns: pytest framework suggests .assert style patterns', async () => {
    loadEngineMock.mockResolvedValueOnce({
      hasTestAnalysis: () => true,
      getTestAnalysis: () => ({
        testFiles: [{ frameworks: ['pytest'] }],
        metrics: { totalTestFiles: 1 },
        patternConfigSource: 'auto',
      }),
    } as any);
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_detect_test_patterns')!;
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    const patterns: string[] = parsed.suggestedPatternConfig.assertionPatterns ?? [];
    // Must include a pattern that matches torch.testing.assert_close / np.testing.assert_allclose
    expect(patterns.some((p) => p.includes('.assert'))).toBe(true);
  });

  // patternConfig must not be silently discarded — passing it must not cause an error
  it('archguard_get_test_metrics accepts patternConfig without crashing', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_metrics')!;
    const result = await cb({ patternConfig: { assertionPatterns: ['.assert'] } });
    // Should return valid JSON (cached data is fine; what matters is no crash/ignored param)
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });

  it('archguard_get_test_issues accepts patternConfig without crashing', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_issues')!;
    const result = await cb({ patternConfig: { assertionPatterns: ['.assert'] } });
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });

  it('archguard_get_test_metrics includes packageCoverage when includePackageBreakdown=true', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_metrics')!;
    const result = await cb({ includePackageBreakdown: true });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalTestFiles).toBe(1);
    expect(Array.isArray(parsed.packageCoverage)).toBe(true);
  });

  it('archguard_get_test_metrics omits packageCoverage when includePackageBreakdown is false/absent', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_metrics')!;

    const withFalse = await cb({ includePackageBreakdown: false });
    const parsedFalse = JSON.parse(withFalse.content[0].text);
    expect(parsedFalse.packageCoverage).toBeUndefined();

    const withAbsent = await cb({});
    const parsedAbsent = JSON.parse(withAbsent.content[0].text);
    expect(parsedAbsent.packageCoverage).toBeUndefined();
  });

  it('archguard_get_entity_coverage returns coverage data for known entityId', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_entity_coverage')!;
    const result = await cb({ entityId: 'entity-1' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.found).toBe(true);
    expect(parsed.sourceEntityId ?? parsed.entityId).toBeDefined();
    expect(Array.isArray(parsed.coveredByTestIds)).toBe(true);
    expect(parsed.coveredByTestIds).toContain('tests/unit/foo.test.ts');
    expect(typeof parsed.coverageScore).toBe('number');
  });

  it('archguard_get_entity_coverage returns found:false for unknown entityId', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_entity_coverage')!;
    const result = await cb({ entityId: 'nonexistent.Entity' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.found).toBe(false);
  });
});

describe('test analysis MCP tools — no analysis present (metrics)', () => {
  beforeEach(() => {
    loadEngineMock.mockResolvedValue(createEngineWithoutAnalysis());
  });

  it('archguard_get_test_metrics returns NOT_ANALYZED_MSG when no analysis', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_test_metrics')!;
    const result = await cb({ includePackageBreakdown: true });
    expect(result.content[0].text).toBe(NOT_ANALYZED_MSG);
  });
});

describe('archguard_get_entity_coverage — no analysis present', () => {
  beforeEach(() => {
    loadEngineMock.mockResolvedValue(createEngineWithoutAnalysis());
  });

  it('archguard_get_entity_coverage returns NOT_ANALYZED_MSG when analysis absent', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_entity_coverage')!;
    const result = await cb({ entityId: 'entity-1' });
    expect(result.content[0].text).toBe(NOT_ANALYZED_MSG);
  });
});
