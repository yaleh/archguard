/**
 * Tests for archguard_detect_god_classes (Dart-only god-class detector).
 *
 * Covers:
 *  - detectGodClasses pure function: threshold flagging, reasons, fan-in, sorting
 *  - tool registration
 *  - Dart-only guard: non-dart scope returns a descriptive message
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ArchJSON, Entity, Relation } from '@/types/index.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import { ExtensionAccessor } from '@/core/query/extension-accessor.js';
import { registerGodClassTool } from '@/cli/mcp/tools/god-class-tools.js';
import { detectGodClasses } from '@/core/query/god-class-detector.js';
import { loadEngine } from '@/cli/query/engine-loader.js';

vi.mock('@/cli/query/engine-loader.js', async () => {
  const actual = await vi.importActual<typeof import('@/cli/query/engine-loader.js')>(
    '@/cli/query/engine-loader.js'
  );
  return { ...actual, loadEngine: vi.fn() };
});

const loadEngineMock = vi.mocked(loadEngine);

function makeEntity(
  id: string,
  name: string,
  file: string,
  methodCount: number,
  fieldCount: number,
  startLine = 1,
  endLine = 20
): Entity {
  const members: Entity['members'] = [];
  for (let i = 0; i < methodCount; i++) {
    members.push({ name: `m${i}`, type: 'method', visibility: 'public' });
  }
  for (let i = 0; i < fieldCount; i++) {
    members.push({ name: `f${i}`, type: 'field', visibility: 'public', fieldType: 'int' });
  }
  return {
    id,
    name,
    type: 'class',
    visibility: 'public',
    members,
    sourceLocation: { file, startLine, endLine },
  };
}

const DART_SCOPE: QueryScopeEntry = {
  key: 'dart-scope',
  label: 'lib (dart)',
  language: 'dart',
  kind: 'parsed',
  sources: ['/project/lib'],
  entityCount: 3,
  relationCount: 2,
  hasAtlasExtension: false,
};

const TS_SCOPE: QueryScopeEntry = {
  key: 'ts-scope',
  label: 'src (typescript)',
  language: 'typescript',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 3,
  relationCount: 2,
  hasAtlasExtension: false,
};

describe('detectGodClasses (pure function)', () => {
  const thresholds = { minMethods: 30, minFields: 30, minLoc: 800, minFanIn: 40 };

  it('flags a class exceeding the method threshold', () => {
    const entities = [
      makeEntity('a.Big', 'Big', 'a.dart', 50, 5, 1, 100),
      makeEntity('a.Small', 'Small', 'a.dart', 5, 2, 1, 50),
    ];
    const relations: Relation[] = [];
    const result = detectGodClasses(entities, relations, thresholds);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Big');
    expect(result[0].methodCount).toBe(50);
    expect(result[0].reasons).toContain('tooManyMethods');
  });

  it('flags high fan-in classes', () => {
    const hub = makeEntity('a.Hub', 'Hub', 'hub.dart', 5, 2, 1, 50);
    const others = Array.from({ length: 45 }, (_, i) =>
      makeEntity(`a.C${i}`, `C${i}`, `c${i}.dart`, 1, 0, 1, 10)
    );
    const entities = [hub, ...others];
    const relations: Relation[] = others.map((o) => ({
      id: `${o.id}_dep_${hub.id}`,
      source: o.id,
      target: hub.id,
      type: 'dependency',
    }));

    const result = detectGodClasses(entities, relations, thresholds);
    const hubEntry = result.find((e) => e.name === 'Hub');
    expect(hubEntry).toBeDefined();
    expect(hubEntry?.fanIn).toBe(45);
    expect(hubEntry?.reasons).toContain('highFanIn');
  });

  it('counts fan-in as distinct source classes, deduplicating relation types and self-edges', () => {
    const hub = makeEntity('a.Hub', 'Hub', 'hub.dart', 5, 2, 1, 50);
    const consumer = makeEntity('a.C0', 'C0', 'c0.dart', 1, 0, 1, 10);
    const entities = [hub, consumer];
    // The same source class relates to Hub via three different relation types
    // plus a self-edge on Hub. All must collapse to fan-in = 1.
    const relations: Relation[] = [
      { id: 'r1', source: consumer.id, target: hub.id, type: 'dependency' },
      { id: 'r2', source: consumer.id, target: hub.id, type: 'composition' },
      { id: 'r3', source: consumer.id, target: hub.id, type: 'implementation' },
      { id: 'r4', source: hub.id, target: hub.id, type: 'dependency' }, // self-edge
    ];

    const result = detectGodClasses(entities, relations, {
      minMethods: 0,
      minFields: 0,
      minLoc: 0,
      minFanIn: 1,
    });
    const hubEntry = result.find((e) => e.name === 'Hub');
    expect(hubEntry).toBeDefined();
    expect(hubEntry?.fanIn).toBe(1);
    expect(hubEntry?.reasons).toContain('highFanIn');
  });

  it('accumulates multiple reasons and sorts by LOC first', () => {
    // Huge: loc=1000, 3 violations. Tall: loc=100, 1 violation.
    // Even though Huge has more violations, LOC dominates — and here Huge also
    // wins on LOC. Reverse the loc to prove LOC is the primary key below.
    const huge = makeEntity('a.Huge', 'Huge', 'huge.dart', 60, 40, 1, 1000);
    const tall = makeEntity('a.Tall', 'Tall', 'tall.dart', 35, 3, 1, 100);
    const entities = [tall, huge];
    const result = detectGodClasses(entities, [], thresholds);

    expect(result[0].name).toBe('Huge'); // loc 1000 > 100
    expect(result[0].reasons).toContain('tooManyMethods');
    expect(result[0].reasons).toContain('tooManyFields');
    expect(result[0].reasons).toContain('highLoc');
  });

  it('LOC is the primary sort key, ahead of violation count', () => {
    // Long has FEWER violations (only highLoc) but larger LOC; it must rank first.
    const long = makeEntity('a.Long', 'Long', 'long.dart', 5, 2, 1, 5000); // 1 violation
    const dense = makeEntity('a.Dense', 'Dense', 'dense.dart', 60, 40, 1, 900); // 3 violations
    const entities = [dense, long];
    const result = detectGodClasses(entities, [], thresholds);

    expect(result[0].name).toBe('Long'); // loc 5000 > 900, despite fewer violations
    expect(result[1].name).toBe('Dense');
  });

  it('treats a threshold of 0 as disabled', () => {
    const entities = [makeEntity('a.Big', 'Big', 'a.dart', 50, 0, 1, 10)];
    const result = detectGodClasses(entities, [], {
      minMethods: 0,
      minFields: 30,
      minLoc: 800,
      minFanIn: 40,
    });
    expect(result).toHaveLength(0);
  });

  it('returns empty array when no class violates any threshold', () => {
    const entities = [makeEntity('a.Normal', 'Normal', 'a.dart', 10, 5, 1, 100)];
    expect(detectGodClasses(entities, [], thresholds)).toHaveLength(0);
  });

  it('excludes enums and extensions/mixins from god-class candidates', () => {
    const bigEnum: Entity = {
      ...makeEntity('a.BigEnum', 'BigEnum', 'a.dart', 50, 50, 1, 1000),
      type: 'enum',
    };
    const bigExtension: Entity = {
      ...makeEntity('a.BigExt', 'BigExt', 'a.dart', 50, 50, 1, 1000),
      type: 'class',
      decorators: [{ name: 'extension' }],
    };
    const bigMixin: Entity = {
      ...makeEntity('a.BigMixin', 'BigMixin', 'a.dart', 50, 50, 1, 1000),
      type: 'class',
      decorators: [{ name: 'mixin' }],
    };
    const realClass = makeEntity('a.RealGod', 'RealGod', 'a.dart', 50, 50, 1, 1000);

    const result = detectGodClasses([bigEnum, bigExtension, bigMixin, realClass], [], thresholds);
    const names = result.map((e) => e.name);
    expect(names).not.toContain('BigEnum');
    expect(names).not.toContain('BigExt');
    expect(names).not.toContain('BigMixin');
    expect(names).toContain('RealGod');
  });
});

describe('archguard_detect_god_classes — registration & guard', () => {
  beforeEach(() => {
    loadEngineMock.mockReset();
  });

  function collectTools(server: McpServer): Map<string, Function> {
    const tools = new Map<string, Function>();
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      const name = args[0] as string;
      const cb = args[args.length - 1] as Function;
      tools.set(name, cb);
      return server;
    });
    registerGodClassTool(server, '/workspace');
    return tools;
  }

  function buildArchJson(): ArchJSON {
    return {
      version: '1.1',
      language: 'dart',
      timestamp: '2026-01-01T00:00:00Z',
      sourceFiles: ['lib/a.dart'],
      entities: [makeEntity('a.Big', 'Big', 'lib/a.dart', 50, 5, 1, 100)],
      relations: [],
    };
  }

  function wrap(archJson: ArchJSON, scopeEntry: QueryScopeEntry) {
    const archIndex = buildArchIndex(archJson, 'testhash');
    const engine = new QueryEngine({ archJson, archIndex, scopeEntry });
    return {
      engine,
      extensionAccessor: new ExtensionAccessor(archJson),
      scopeEntry,
      relationQueryService: engine.relationQueryService,
    };
  }

  it('registers the archguard_detect_god_classes tool', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    expect(collectTools(server).has('archguard_detect_god_classes')).toBe(true);
  });

  it('returns god classes for a dart scope', async () => {
    const archJson = buildArchJson();
    loadEngineMock.mockResolvedValue(wrap(archJson, DART_SCOPE));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const handler = collectTools(server).get('archguard_detect_god_classes');
    if (!handler) throw new Error('tool not registered');
    const result = await handler({ projectRoot: '/workspace' });
    const payload = JSON.parse(result.content[0].text) as {
      language: string;
      godClasses: Array<{ name: string }>;
    };

    expect(payload.language).toBe('dart');
    expect(payload.godClasses).toHaveLength(1);
    expect(payload.godClasses[0].name).toBe('Big');
  });

  it('refuses a non-dart scope with a descriptive message', async () => {
    const archJson = { ...buildArchJson(), language: 'typescript' as const };
    loadEngineMock.mockResolvedValue(wrap(archJson, TS_SCOPE));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const handler = collectTools(server).get('archguard_detect_god_classes');
    if (!handler) throw new Error('tool not registered');
    const result = await handler({ projectRoot: '/workspace' });
    const text = result.content[0].text as string;

    expect(text).toContain('Dart-only');
    expect(text).toContain('typescript');
  });
});
