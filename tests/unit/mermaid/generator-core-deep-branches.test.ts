/**
 * TASK-72: core mermaid generator deep-branch direct-import unit tests.
 *
 * Focuses on branch-dense paths in src/mermaid/generator.ts NOT covered by the
 * main generator.test.ts / generator-deep-branches.test.ts suites:
 *
 *  1. Layered package-level relation source/target resolution fallbacks
 *     (normalizeEntityName fallback when the raw relation id is not in the
 *     entity-package index).
 *  2. Layered package-level relation filtering: unresolved (ghost) targets and
 *     same-package relations are skipped.
 *  3. normalizePackagePath workspaceRoot + absolute-path branch (the relative
 *     path computed against workspaceRoot is what lets a layer match).
 *  4. Layered flowchart direction fallback to 'TB' when grouping has no layout.
 *  5. Layered package-level skip of root-level entities (packageName === '.').
 *  6. Empty namespace skip (grouping lists an entity id that does not exist)
 *     at package level and at method level.
 *  7. Node-type-annotation dedup (two visible entities normalising to the same
 *     id) at class level and at method level.
 *  8. generateClassDiagrams split mode: a module-prefix relation source is
 *     accepted in the owning group, and a cross-group target gets a stub.
 */

import { describe, it, expect } from 'vitest';
import { ValidatedMermaidGenerator } from '@/mermaid/generator.js';
import type { ArchJSON } from '@/types/index.js';
import type { GroupingDecision } from '@/mermaid/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_EXTENSIONS = {
  projectSemantics: {
    version: '1.1' as const,
    nonProductionPatterns: [],
    barrelFiles: [],
    additionalTestPatterns: [],
    customAssertionPatterns: [],
    confidence: 0.9,
    architecturalLayers: {
      'src/domain': 'Domain',
      'src/infra': 'Infrastructure',
    },
  },
};

function makeEntity(
  id: string,
  name: string,
  file: string,
  type = 'class'
): ArchJSON['entities'][number] {
  return {
    id,
    name,
    type,
    visibility: 'public',
    members: [],
    sourceLocation: { file, startLine: 1, endLine: 10 },
  };
}

function makeLayeredArchJson(
  entities: ArchJSON['entities'],
  relations: ArchJSON['relations'],
  overrides: Partial<ArchJSON> = {}
): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-08-05T00:00:00Z',
    sourceFiles: [],
    entities,
    relations,
    extensions: BASE_EXTENSIONS,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1-2. Layered relation resolution fallbacks + skip branches
// ---------------------------------------------------------------------------

describe('ValidatedMermaidGenerator — layered relation source/target resolution', () => {
  it('resolves a relation source via normalizeEntityName fallback when the raw id is not indexed', () => {
    const archJson = makeLayeredArchJson(
      [
        makeEntity('User', 'User', 'src/domain/User.ts'),
        makeEntity('AuthService', 'AuthService', 'src/infra/AuthService.ts'),
      ],
      [{ id: 'r1', type: 'dependency', source: "import('@/svc').AuthService", target: 'User' }]
    );
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'package',
      grouping: { packages: [], layout: { direction: 'LR', reasoning: '' } },
    });
    const code = gen.generate();
    // raw "import('@/svc').AuthService" is not an entity id/name; only the
    // normalizeEntityName fallback ('AuthService' → src/infra) can resolve it.
    expect(code).toContain('pkg_src_infra --> pkg_src_domain');
  });

  it('resolves a relation target via normalizeEntityName fallback when the raw id is not indexed', () => {
    const archJson = makeLayeredArchJson(
      [
        makeEntity('User', 'User', 'src/domain/User.ts'),
        makeEntity('AuthService', 'AuthService', 'src/infra/AuthService.ts'),
      ],
      [{ id: 'r1', type: 'dependency', source: 'AuthService', target: "import('@/dom').User" }]
    );
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'package',
      grouping: { packages: [], layout: { direction: 'LR', reasoning: '' } },
    });
    const code = gen.generate();
    expect(code).toContain('pkg_src_infra --> pkg_src_domain');
  });

  it('skips a layered relation whose target resolves to no package (unresolved external/ghost target)', () => {
    const archJson = makeLayeredArchJson(
      [makeEntity('AuthService', 'AuthService', 'src/infra/AuthService.ts')],
      [
        {
          id: 'r1',
          type: 'dependency',
          source: 'AuthService',
          target: 'ExternalModule.ExternalThing',
        },
      ]
    );
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'package',
      grouping: { packages: [], layout: { direction: 'LR', reasoning: '' } },
    });
    const code = gen.generate();
    // source resolves to src/infra, target does not → whole edge is skipped.
    expect(code).not.toContain('ExternalThing');
    expect(code).not.toContain('-->');
  });

  it('skips a layered relation whose source and target live in the same package', () => {
    const archJson = makeLayeredArchJson(
      [
        makeEntity('User', 'User', 'src/domain/User.ts'),
        makeEntity('UserHelper', 'UserHelper', 'src/domain/UserHelper.ts'),
      ],
      [{ id: 'r1', type: 'dependency', source: 'User', target: 'UserHelper' }]
    );
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'package',
      grouping: { packages: [], layout: { direction: 'LR', reasoning: '' } },
    });
    const code = gen.generate();
    // both resolve to src/domain → same-package skip → no self loop edge.
    expect(code).not.toContain('-->');
    // the packages themselves are still emitted as nodes
    expect(code).toContain('pkg_src_domain["src/domain"]');
  });
});

// ---------------------------------------------------------------------------
// 3. normalizePackagePath workspaceRoot + absolute path
// ---------------------------------------------------------------------------

describe('ValidatedMermaidGenerator — normalizePackagePath workspaceRoot branch', () => {
  it('normalises absolute entity paths against workspaceRoot so layers match', () => {
    const archJson = makeLayeredArchJson(
      [
        makeEntity('User', 'User', '/repo/src/domain/User.ts'),
        makeEntity('AuthService', 'AuthService', '/repo/src/infra/AuthService.ts'),
      ],
      [{ id: 'r1', type: 'dependency', source: 'AuthService', target: 'User' }],
      { workspaceRoot: '/repo' }
    );
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'package',
      grouping: { packages: [], layout: { direction: 'LR', reasoning: '' } },
    });
    const code = gen.generate();
    // workspaceRoot + isAbsolute → dirname(relative) = 'src/domain' / 'src/infra'
    expect(code).toContain('subgraph layer_Domain["Domain"]');
    expect(code).toContain('subgraph layer_Infrastructure["Infrastructure"]');
    expect(code).toContain('pkg_src_infra --> pkg_src_domain');
  });
});

// ---------------------------------------------------------------------------
// 4. Layered flowchart direction fallback
// ---------------------------------------------------------------------------

describe('ValidatedMermaidGenerator — layered flowchart direction fallback', () => {
  it('defaults to flowchart TB when grouping has no layout decision', () => {
    const archJson = makeLayeredArchJson([makeEntity('User', 'User', 'src/domain/User.ts')], []);
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'package',
      grouping: { packages: [] } as GroupingDecision, // no layout
    });
    const code = gen.generate();
    expect(code.startsWith('flowchart TB')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Root-level entity skip (packageName === '.')
// ---------------------------------------------------------------------------

describe('ValidatedMermaidGenerator — layered root-level entity skip', () => {
  it('skips entities whose file is at the repo root (package ".")', () => {
    const archJson = makeLayeredArchJson(
      [
        makeEntity('RootHelper', 'RootHelper', 'RootHelper.ts'),
        makeEntity('User', 'User', 'src/domain/User.ts'),
      ],
      [{ id: 'r1', type: 'dependency', source: 'RootHelper', target: 'User' }]
    );
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'package',
      grouping: { packages: [], layout: { direction: 'LR', reasoning: '' } },
    });
    const code = gen.generate();
    // RootHelper.dirname === '.' → not added to the package index → no node, no edge.
    expect(code).not.toContain('pkg__'); // nodeIdForPackage('.') would be 'pkg__'
    expect(code).not.toContain('-->');
    // User is still indexed and rendered in its layer subgraph.
    expect(code).toContain('pkg_src_domain["src/domain"]');
  });
});

// ---------------------------------------------------------------------------
// 6. Empty namespace skip (package + method level)
// ---------------------------------------------------------------------------

describe('ValidatedMermaidGenerator — empty namespace skip', () => {
  const realPlusGhost: GroupingDecision = {
    packages: [
      { name: 'Real', entities: ['Foo'], reasoning: '' },
      { name: 'Ghost', entities: ['NoSuchEntity'], reasoning: '' },
    ],
    layout: { direction: 'TB', reasoning: '' },
  };

  it('skips an empty package group at package level', () => {
    // no architecturalLayers — must exercise the non-layered namespace branch
    const archJson: ArchJSON = {
      version: '1.1',
      language: 'typescript',
      timestamp: '2026-08-05T00:00:00Z',
      sourceFiles: [],
      entities: [makeEntity('Foo', 'Foo', 'src/Foo.ts')],
      relations: [],
    };
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'package',
      grouping: realPlusGhost,
    });
    const code = gen.generate();
    expect(code).toContain('namespace Real');
    expect(code).not.toContain('namespace Ghost');
  });

  it('skips an empty package group at method level', () => {
    const archJson = makeLayeredArchJson([makeEntity('Foo', 'Foo', 'src/Foo.ts')], []);
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'method',
      grouping: realPlusGhost,
    });
    const code = gen.generate();
    expect(code).toContain('namespace Real');
    expect(code).not.toContain('namespace Ghost');
  });
});

// ---------------------------------------------------------------------------
// 7. Node-type annotation dedup (class + method level)
// ---------------------------------------------------------------------------

describe('ValidatedMermaidGenerator — node-type annotation dedup', () => {
  const dupNames: ArchJSON = {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-08-05T00:00:00Z',
    sourceFiles: [],
    entities: [
      makeEntity('Foo', 'Foo', 'src/Foo.ts'),
      makeEntity('FooImport', "import('@/types').Foo", 'src/Bar.ts'),
    ],
    relations: [],
  };

  it('emits a single annotation line for entities that normalise to the same id (class level)', () => {
    const gen = new ValidatedMermaidGenerator(dupNames, {
      level: 'class',
      grouping: { packages: [], layout: { direction: 'TB', reasoning: '' } },
    });
    const code = gen.generate();
    const annotationLines = code.split('\n').filter((l) => l.trim().match(/^class Foo:::/));
    expect(annotationLines).toHaveLength(1);
  });

  it('emits a single annotation line for entities that normalise to the same id (method level)', () => {
    const gen = new ValidatedMermaidGenerator(dupNames, {
      level: 'method',
      grouping: { packages: [], layout: { direction: 'TB', reasoning: '' } },
    });
    const code = gen.generate();
    const annotationLines = code.split('\n').filter((l) => l.trim().match(/^class Foo:::/));
    expect(annotationLines).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Split mode: module-prefix relation source + cross-group stub
// ---------------------------------------------------------------------------

describe('ValidatedMermaidGenerator — split mode module-prefix source', () => {
  it('accepts a module-prefix relation source in the owning group and stubs the cross-group target', () => {
    const archJson: ArchJSON = {
      version: '1.1',
      language: 'python',
      timestamp: '2026-08-05T00:00:00Z',
      sourceFiles: [],
      entities: [
        makeEntity('lmdeploy.models.Llama', 'Llama', 'src/models/llama.py'),
        makeEntity('lmdeploy.views.App', 'App', 'src/views/app.py'),
      ],
      relations: [
        { id: 'r1', type: 'dependency', source: 'lmdeploy.models', target: 'lmdeploy.views.App' },
      ],
    };
    const grouping: GroupingDecision = {
      packages: [
        { name: 'models', entities: ['lmdeploy.models.Llama'], reasoning: '' },
        { name: 'views', entities: ['lmdeploy.views.App'], reasoning: '' },
      ],
      layout: { direction: 'TB', reasoning: '' },
    };
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'class',
      grouping,
    });
    // 2 entities, 2 groups, limit 1 → split.
    const result = gen.generateClassDiagrams(1);
    const models = result.find((r) => r.name === 'models');
    expect(models).toBeDefined();

    // source 'lmdeploy.models' is not a direct member but is a module prefix of
    // Llama → the relation is kept (sourceViaPrefix path).
    expect(models.content).toContain('lmdeploy_models --> App');
    // target 'App' lives in another group → declared as a stub to avoid a ghost node.
    expect(models.content).toContain('class App');
    // namespace block still declares Llama.
    expect(models.content).toContain('class Llama {');
  });

  it('dedups node-type annotations inside a split group (per-group seen set)', () => {
    // Two entities in the same split group whose names normalise to the same id.
    const archJson: ArchJSON = {
      version: '1.1',
      language: 'typescript',
      timestamp: '2026-08-05T00:00:00Z',
      sourceFiles: [],
      entities: [
        makeEntity('Foo', 'Foo', 'src/Foo.ts'),
        makeEntity('FooImport', "import('@/types').Foo", 'src/Bar.ts'),
        makeEntity('Other', 'Other', 'src/Other.ts'),
      ],
      relations: [],
    };
    const grouping: GroupingDecision = {
      packages: [
        { name: 'Real', entities: ['Foo', 'FooImport'], reasoning: '' },
        { name: 'Extra', entities: ['Other'], reasoning: '' },
      ],
      layout: { direction: 'TB', reasoning: '' },
    };
    const gen = new ValidatedMermaidGenerator(archJson, { level: 'class', grouping });
    // 3 entities, 2 groups, limit 1 → split.
    const result = gen.generateClassDiagrams(1);
    const real = result.find((r) => r.name === 'Real');
    expect(real).toBeDefined();
    const annotationLines = real.content.split('\n').filter((l) => l.trim().match(/^class Foo:::/));
    expect(annotationLines).toHaveLength(1);
  });
});
