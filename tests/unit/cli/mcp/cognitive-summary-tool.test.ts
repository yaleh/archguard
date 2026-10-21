/**
 * Unit tests for archguard_get_cognitive_summary MCP tool.
 *
 * Mocking pattern follows test-analysis-mcp.test.ts and atlas-analytics-tools.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Entity, ArchJSON } from '@/types/index.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import { registerCognitiveSummaryTool } from '@/cli/mcp/tools/cognitive-summary-tool.js';
import { loadEngine } from '@/cli/query/engine-loader.js';
import { ExtensionAccessor } from '@/core/query/extension-accessor.js';
import { GitHistoryNotFoundError } from '@/cli/git-history/history-loader.js';

// ── Mock loadEngine (disk I/O) ────────────────────────────────────────────────

vi.mock('@/cli/query/engine-loader.js', async () => {
  const actual = await vi.importActual<typeof import('@/cli/query/engine-loader.js')>(
    '@/cli/query/engine-loader.js'
  );
  return { ...actual, loadEngine: vi.fn() };
});

// ── Mock history loader (disk I/O) ────────────────────────────────────────────

vi.mock('@/cli/git-history/history-loader.js', async () => {
  const actual = await vi.importActual<typeof import('@/cli/git-history/history-loader.js')>(
    '@/cli/git-history/history-loader.js'
  );
  return { ...actual, loadHistoryData: vi.fn() };
});

// ── Mock HistoryQuery ─────────────────────────────────────────────────────────

vi.mock('@/cli/git-history/history-query.js', () => {
  return {
    HistoryQuery: vi.fn().mockImplementation(() => ({
      getChangeRisk: vi.fn().mockReturnValue({
        riskLevel: 'low',
        riskScore: 0.1,
        target: 'src/foo.ts',
        targetType: 'file',
        factors: {},
        factorExplanations: {},
        currentlyExists: true,
        limitation: '',
      }),
    })),
  };
});

// ── Import mocks after vi.mock calls ─────────────────────────────────────────

import { loadHistoryData } from '@/cli/git-history/history-loader.js';

const loadEngineMock = vi.mocked(loadEngine);
const loadHistoryDataMock = vi.mocked(loadHistoryData);

// ── Helpers ───────────────────────────────────────────────────────────────────

const scopeEntry: QueryScopeEntry = {
  key: 'test-scope',
  label: 'src (typescript)',
  language: 'typescript',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 2,
  relationCount: 1,
  hasAtlasExtension: false,
};

function makeEntity(id: string, name: string, file = 'src/foo.ts'): Entity {
  return {
    id,
    name,
    type: 'class',
    visibility: 'public',
    members: [
      { name: 'doStuff', type: 'method', visibility: 'public', returnType: 'void' },
      { name: 'helperField', type: 'field', visibility: 'private' },
    ],
    sourceLocation: { file, startLine: 1, endLine: 50 },
  };
}

function buildEngineContext(entities: Entity[], relations: ArchJSON['relations'] = []) {
  const archJson: ArchJSON = {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities,
    relations,
  };
  const archIndex = buildArchIndex(archJson, 'hash');
  const engine = new QueryEngine({ archJson, archIndex, scopeEntry });
  const extensionAccessor = new ExtensionAccessor(archJson);
  return {
    engine,
    extensionAccessor,
    scopeEntry,
    relationQueryService: engine.relationQueryService,
  };
}

/** Collect all registered tool callbacks by tool name. */
function collectTools(server: McpServer, defaultRoot = '/workspace'): Map<string, Function> {
  const tools = new Map<string, Function>();
  const originalTool = server.tool.bind(server);
  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    const name = args[0] as string;
    const cb = args[args.length - 1] as Function;
    tools.set(name, cb);
    return (originalTool as Function)(...args);
  });
  registerCognitiveSummaryTool(server, defaultRoot);
  return tools;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  loadEngineMock.mockReset();
  loadHistoryDataMock.mockReset();
  // Default: git artifacts present, HistoryQuery returns low risk
  loadHistoryDataMock.mockResolvedValue({} as any);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('archguard_get_cognitive_summary — single entity', () => {
  it('returns CognitiveSummaryEntry with correct shape for a found entity', async () => {
    const entity = makeEntity('src/foo.ts.QueryEngine', 'QueryEngine');
    loadEngineMock.mockResolvedValue(buildEngineContext([entity]));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_cognitive_summary');

    const result = await cb({ entities: ['QueryEngine'] });
    const parsed = JSON.parse(result.content[0].text) as any[];

    expect(parsed).toHaveLength(1);
    const entry = parsed[0];
    expect(entry.name).toBe('QueryEngine');
    expect(entry.found).toBe(true);
    expect(entry.entityId).toBeDefined();
    expect(typeof entry.methodCount).toBe('number');
    expect(typeof entry.fieldCount).toBe('number');
    expect(typeof entry.inDegree).toBe('number');
    expect(typeof entry.outDegree).toBe('number');
    expect(Array.isArray(entry.topDependents)).toBe(true);
    expect(entry.topDependents.length).toBeLessThanOrEqual(5);
    expect(Array.isArray(entry.topDependencies)).toBe(true);
    expect(entry.topDependencies.length).toBeLessThanOrEqual(5);
    // testCoverageRatio — null when no test analysis
    expect(entry.testCoverageRatio === null || typeof entry.testCoverageRatio === 'number').toBe(
      true
    );
    // gitRiskLevel — string when git artifacts present
    expect(entry.gitRiskLevel === null || typeof entry.gitRiskLevel === 'string').toBe(true);
  });
});

describe('archguard_get_cognitive_summary — batch of 10', () => {
  it('returns array of 10 entries and total JSON length < 20480 bytes', async () => {
    const entities = Array.from({ length: 10 }, (_, i) =>
      makeEntity(`src/mod${i}.ts.Entity${i}`, `Entity${i}`, `src/mod${i}.ts`)
    );
    loadEngineMock.mockResolvedValue(buildEngineContext(entities));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_cognitive_summary');

    const entityNames = entities.map((e) => e.name);
    const result = await cb({ entities: entityNames });

    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    const parsed = JSON.parse(result.content[0].text) as any[];
    expect(parsed).toHaveLength(10);
    expect(result.content[0].text.length).toBeLessThan(20480);
  });
});

describe('archguard_get_cognitive_summary — missing entity', () => {
  it('returns { name, found: false, reason: not-in-graph } for an unknown entity', async () => {
    loadEngineMock.mockResolvedValue(buildEngineContext([]));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_cognitive_summary');

    const result = await cb({ entities: ['NonExistent'] });
    const parsed = JSON.parse(result.content[0].text) as any[];

    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('NonExistent');
    expect(parsed[0].found).toBe(false);
    expect(parsed[0].reason).toBe('not-in-graph');
    expect(typeof parsed[0].reasonDetail).toBe('string');
    expect(parsed[0].entityId).toBeUndefined();
    expect(parsed[0].methodCount).toBeUndefined();
  });

  it('returns reason id-format-mismatch + resolvedName when queried by entity id', async () => {
    const entity = makeEntity('src/foo.ts.QueryEngine', 'QueryEngine');
    loadEngineMock.mockResolvedValue(buildEngineContext([entity]));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_cognitive_summary');

    const result = await cb({ entities: ['src/foo.ts.QueryEngine'] });
    const parsed = JSON.parse(result.content[0].text) as any[];

    expect(parsed[0].found).toBe(false);
    expect(parsed[0].reason).toBe('id-format-mismatch');
    expect(parsed[0].resolvedName).toBe('QueryEngine');
  });

  it('returns reason in-graph-no-artifact when ArchJSON has the entity but the name index does not', async () => {
    // Simulate a stale/incomplete arch-index artifact: the entity id exists in
    // ArchJSON, but the name→id index has no entry for it.
    const entity = makeEntity('src/legacy.ts.StaleWidget', 'LegacyWidget');
    const ctx = buildEngineContext([entity]);
    vi.spyOn(ctx.extensionAccessor, 'getEntityIds').mockReturnValue(['src/legacy.ts.StaleWidget']);
    loadEngineMock.mockResolvedValue(ctx);

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_cognitive_summary');

    const result = await cb({ entities: ['StaleWidget'] });
    const parsed = JSON.parse(result.content[0].text) as any[];

    expect(parsed[0].found).toBe(false);
    expect(parsed[0].reason).toBe('in-graph-no-artifact');
  });

  it('returns reason in-graph-no-artifact when the entity exists in another query scope', async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'archguard-cognitive-summary-'));
    try {
      const archDir = path.join(tmp, '.archguard');
      const primaryDir = path.join(archDir, 'query', 'primary');
      const otherDir = path.join(archDir, 'query', 'other');
      await fsp.mkdir(primaryDir, { recursive: true });
      await fsp.mkdir(otherDir, { recursive: true });

      const scope = (key: string, entityCount: number) => ({
        key,
        label: key,
        language: 'typescript',
        kind: 'parsed' as const,
        sources: [`/${key}/src`],
        entityCount,
        relationCount: 0,
        hasAtlasExtension: false,
      });
      await fsp.writeFile(
        path.join(archDir, 'query', 'manifest.json'),
        JSON.stringify({
          version: '1.0',
          generatedAt: '2026-01-01T00:00:00Z',
          scopes: [scope('primary', 0), scope('other', 1)],
        })
      );
      await fsp.writeFile(path.join(primaryDir, 'arch.json'), JSON.stringify({ entities: [] }));
      await fsp.writeFile(
        path.join(otherDir, 'arch.json'),
        JSON.stringify({
          entities: [{ id: 'cross.ts.CrossScope', name: 'CrossScope', type: 'class' }],
        })
      );

      const ctx = buildEngineContext([]);
      ctx.scopeEntry = { ...ctx.scopeEntry, key: 'primary' };
      loadEngineMock.mockResolvedValue(ctx);

      const server = new McpServer({ name: 'test', version: '1.0.0' });
      const tools = collectTools(server);
      const cb = tools.get('archguard_get_cognitive_summary');

      const result = await cb({
        entities: ['CrossScope', 'cross.ts.CrossScope'],
        projectRoot: tmp,
      });
      const parsed = JSON.parse(result.content[0].text) as any[];

      expect(parsed[0].found).toBe(false);
      expect(parsed[0].reason).toBe('in-graph-no-artifact');
      expect(parsed[0].reasonDetail).toContain("'other'");

      // The same entity, addressed by its id, is an id-format problem.
      expect(parsed[1].reason).toBe('id-format-mismatch');
      expect(parsed[1].resolvedName).toBe('CrossScope');
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  it('reports projectSemantics "missing" instead of a silent null coverage ratio', async () => {
    const entity = makeEntity('src/ps.ts.PsClass', 'PsClass');
    loadEngineMock.mockResolvedValue(buildEngineContext([entity]));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_cognitive_summary');

    const result = await cb({ entities: ['PsClass'] });
    const parsed = JSON.parse(result.content[0].text) as any[];

    expect(parsed[0].projectSemantics).toBe('missing');
    expect(parsed[0].testCoverageRatio).toBeNull();
    expect(parsed[0].testCoverageReason).toBe('no-test-analysis-artifacts');
  });
});

describe('archguard_get_cognitive_summary — absent test artifacts', () => {
  it('returns testCoverageRatio: null when test analysis throws', async () => {
    const entity = makeEntity('src/bar.ts.MyClass', 'MyClass');
    const ctx = buildEngineContext([entity]);

    // Make getEntityCoverage throw so we confirm null fallback
    vi.spyOn(ctx.engine, 'getEntityCoverage').mockImplementation(() => {
      throw new Error('test artifacts not found');
    });
    // Also make extensionAccessor.hasTestAnalysis return true so we enter the try block
    vi.spyOn(ctx.extensionAccessor, 'hasTestAnalysis').mockReturnValue(true);

    loadEngineMock.mockResolvedValue(ctx);

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_cognitive_summary');

    const result = await cb({ entities: ['MyClass'] });
    const parsed = JSON.parse(result.content[0].text) as any[];

    expect(parsed[0].found).toBe(true);
    expect(parsed[0].testCoverageRatio).toBeNull();
    expect(parsed[0].testCoverageReason).toBe('coverage-lookup-failed');
  });
});

describe('archguard_get_cognitive_summary — absent git artifacts', () => {
  it('returns gitRiskLevel: null when loadHistoryData throws GitHistoryNotFoundError', async () => {
    const entity = makeEntity('src/baz.ts.BazClass', 'BazClass');
    loadEngineMock.mockResolvedValue(buildEngineContext([entity]));
    // Simulate git artifacts absent
    loadHistoryDataMock.mockRejectedValue(new GitHistoryNotFoundError('/workspace/.archguard'));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_cognitive_summary');

    const result = await cb({ entities: ['BazClass'] });
    const parsed = JSON.parse(result.content[0].text) as any[];

    expect(parsed[0].found).toBe(true);
    expect(parsed[0].gitRiskLevel).toBeNull();
    expect(parsed[0].gitRiskReason).toBe('no-git-history-artifacts');
  });
});

describe('archguard_get_cognitive_summary — tool registration', () => {
  it('registers archguard_get_cognitive_summary when called', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    expect(tools.has('archguard_get_cognitive_summary')).toBe(true);
  });
});

describe('archguard_get_cognitive_summary — payload size constraint', () => {
  it('keeps per-entry JSON < 2048 bytes even when entity has 20 dependents and 20 dependencies', async () => {
    // Create an entity and 20 dependents + 20 dependency entities
    const mainEntity = makeEntity('src/hub.ts.Hub', 'Hub');

    const depOnHub = Array.from({ length: 20 }, (_, i) =>
      makeEntity(`src/dep${i}.ts.Dep${i}`, `Dep${i}`, `src/dep${i}.ts`)
    );
    const hubDepsOn = Array.from({ length: 20 }, (_, i) =>
      makeEntity(`src/lib${i}.ts.Lib${i}`, `Lib${i}`, `src/lib${i}.ts`)
    );

    const relations: ArchJSON['relations'] = [
      // 20 entities that depend on Hub
      ...depOnHub.map((d) => ({
        id: `rel-in-${d.id}`,
        type: 'dependency' as const,
        source: d.id,
        target: mainEntity.id,
      })),
      // Hub depends on 20 entities
      ...hubDepsOn.map((l) => ({
        id: `rel-out-${l.id}`,
        type: 'dependency' as const,
        source: mainEntity.id,
        target: l.id,
      })),
    ];

    const allEntities = [mainEntity, ...depOnHub, ...hubDepsOn];
    loadEngineMock.mockResolvedValue(buildEngineContext(allEntities, relations));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_cognitive_summary');

    const result = await cb({ entities: ['Hub'] });
    const parsed = JSON.parse(result.content[0].text) as any[];

    expect(parsed).toHaveLength(1);
    const entry = parsed[0];
    // topDependents and topDependencies must be capped at 5
    expect(entry.topDependents.length).toBeLessThanOrEqual(5);
    expect(entry.topDependencies.length).toBeLessThanOrEqual(5);
    // Total JSON for the single entry must be < 2048 bytes
    expect(JSON.stringify(entry).length).toBeLessThan(2048);
  });
});

describe('archguard_get_cognitive_summary — doc presence', () => {
  it('MCP usage guide contains archguard_get_cognitive_summary', async () => {
    const fs = await import('fs-extra');
    const path = await import('path');
    // Resolve relative to the project root (where package.json lives)
    const projectRoot = path.default.resolve(process.cwd());
    const docPath = path.default.join(projectRoot, 'docs', 'user-guide', 'mcp-usage.md');
    const content = await fs.default.readFile(docPath, 'utf-8');
    expect(content).toContain('archguard_get_cognitive_summary');
  });
});
