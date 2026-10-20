/**
 * Unit tests for QueryScopeCollector
 *
 * Tests scope registration, first-write-wins semantics,
 * and lastArchJson primary-role logic — all in isolation
 * without going through DiagramProcessor.processAll().
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { QueryScopeCollector, mergeQueryScopes } from '@/cli/processors/query-scope-collector.js';
import { loadEngine, resolveScope, MERGED_SCOPE_KEY } from '@/cli/query/engine-loader.js';
import type { ArchJSON, Relation } from '@/types/index.js';
import type { QueryScopeEntry } from '@/types/query-scope.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArchJson(entityCount = 1): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: ['test.ts'],
    entities: Array.from({ length: entityCount }, (_, i) => ({
      id: `TestClass${i}`,
      name: `TestClass${i}`,
      type: 'class' as const,
      visibility: 'public' as const,
      sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
      members: [],
    })),
    relations: [],
  };
}

function makeEmptyArchJson(): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: [],
    entities: [],
    relations: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QueryScopeCollector', () => {
  describe('getQuerySourceGroups()', () => {
    it('returns [] before any register() call', () => {
      const collector = new QueryScopeCollector();
      expect(collector.getQuerySourceGroups()).toEqual([]);
    });
  });

  describe('register()', () => {
    it('with a non-empty ArchJSON adds exactly one scope', () => {
      const collector = new QueryScopeCollector();
      collector.register(['./src'], makeArchJson(3), 'parsed');

      expect(collector.getQuerySourceGroups()).toHaveLength(1);
    });

    it('with an empty-entity ArchJSON adds no scope', () => {
      const collector = new QueryScopeCollector();
      collector.register(['./src'], makeEmptyArchJson(), 'parsed');

      expect(collector.getQuerySourceGroups()).toHaveLength(0);
    });

    it('with the same key twice does not overwrite (first-write-wins)', () => {
      const collector = new QueryScopeCollector();
      const first = makeArchJson(1);
      const second = makeArchJson(5);

      collector.register(['./src'], first, 'parsed');
      collector.register(['./src'], second, 'parsed');

      const scopes = collector.getQuerySourceGroups();
      expect(scopes).toHaveLength(1);
      // First registration wins — second should not overwrite
      expect(scopes[0].archJson.entities).toHaveLength(1);
    });

    it('scope key is an 8-char hex string', () => {
      const collector = new QueryScopeCollector();
      collector.register(['./src'], makeArchJson(), 'parsed');

      const [scope] = collector.getQuerySourceGroups();
      expect(scope.key).toMatch(/^[0-9a-f]{8}$/);
    });

    it('scope sources are resolved to absolute paths', () => {
      const collector = new QueryScopeCollector();
      collector.register(['./src'], makeArchJson(), 'parsed');

      const [scope] = collector.getQuerySourceGroups();
      for (const source of scope.sources) {
        expect(source).toMatch(/^\//);
      }
    });

    describe('symlinked source paths', () => {
      let tmp: string | undefined;
      afterEach(() => {
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
        tmp = undefined;
      });

      it('registers a symlink path and its real path as a single scope', () => {
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scope-symlink-')));
        const real = path.join(tmp, 'real');
        const link = path.join(tmp, 'link');
        fs.mkdirSync(real);
        fs.symlinkSync(real, link, 'dir');

        const collector = new QueryScopeCollector();
        collector.register([real], makeArchJson(1), 'parsed');
        collector.register([link], makeArchJson(2), 'parsed');

        const scopes = collector.getQuerySourceGroups();
        expect(scopes).toHaveLength(1);
        expect(scopes[0].sources).toEqual([real]);
      });

      it('stores the resolved path in scope sources when registered via a symlink', () => {
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scope-symlink-')));
        const real = path.join(tmp, 'real');
        const link = path.join(tmp, 'link');
        fs.mkdirSync(real);
        fs.symlinkSync(real, link, 'dir');

        const collector = new QueryScopeCollector();
        collector.register([link], makeArchJson(1), 'parsed');

        expect(collector.getQuerySourceGroups()[0].sources).toEqual([real]);
      });
    });

    it('stores the provided archJson in the scope', () => {
      const collector = new QueryScopeCollector();
      const archJson = makeArchJson(2);
      collector.register(['./src'], archJson, 'parsed', 'primary');

      const [scope] = collector.getQuerySourceGroups();
      expect(scope.archJson).toBe(archJson);
      expect(scope.kind).toBe('parsed');
      expect(scope.role).toBe('primary');
    });

    it('two different source paths register two distinct scopes', () => {
      const collector = new QueryScopeCollector();
      collector.register(['./src'], makeArchJson(), 'parsed');
      collector.register(['./lib'], makeArchJson(), 'parsed');

      expect(collector.getQuerySourceGroups()).toHaveLength(2);
    });
  });

  describe('getLastArchJson()', () => {
    it('returns null before any setLastArchJson() call', () => {
      const collector = new QueryScopeCollector();
      expect(collector.getLastArchJson()).toBeNull();
    });
  });

  describe('setLastArchJson()', () => {
    it('stores the value when last is null', () => {
      const collector = new QueryScopeCollector();
      const archJson = makeArchJson();

      collector.setLastArchJson(archJson, false);

      expect(collector.getLastArchJson()).toBe(archJson);
    });

    it('does NOT overwrite when incoming has FEWER entities and groupHasPrimary=false (stored richer wins)', () => {
      const collector = new QueryScopeCollector();
      const large = makeArchJson(447);
      const small = makeArchJson(4);

      collector.setLastArchJson(large, false);
      collector.setLastArchJson(small, false);

      expect(collector.getLastArchJson()).toBe(large);
    });

    it('DOES overwrite when incoming has MORE entities and groupHasPrimary=false (richer wins)', () => {
      const collector = new QueryScopeCollector();
      const small = makeArchJson(4);
      const large = makeArchJson(447);

      collector.setLastArchJson(small, false);
      collector.setLastArchJson(large, false);

      expect(collector.getLastArchJson()).toBe(large);
    });

    it('overwrites when groupHasPrimary=true even if incoming is smaller (primary wins)', () => {
      const collector = new QueryScopeCollector();
      const large = makeArchJson(447);
      const small = makeArchJson(4);

      collector.setLastArchJson(large, false);
      collector.setLastArchJson(small, true);

      expect(collector.getLastArchJson()).toBe(small);
    });

    it('primary overwrite then non-primary smaller does NOT overwrite', () => {
      const collector = new QueryScopeCollector();
      const tiny = makeArchJson(4);
      const primary = makeArchJson(100);
      const nonPrimarySmall = makeArchJson(10);

      collector.setLastArchJson(tiny, false);
      collector.setLastArchJson(primary, true);
      collector.setLastArchJson(nonPrimarySmall, false);

      expect(collector.getLastArchJson()).toBe(primary);
    });

    it('primary overwrite then non-primary larger DOES overwrite (richer wins over primary)', () => {
      const collector = new QueryScopeCollector();
      const primary = makeArchJson(50);
      const large = makeArchJson(500);

      collector.setLastArchJson(makeArchJson(4), false);
      collector.setLastArchJson(primary, true);
      collector.setLastArchJson(large, false);

      expect(collector.getLastArchJson()).toBe(large);
    });

    it('handles ArchJSON with undefined entities without throwing', () => {
      const collector = new QueryScopeCollector();
      const noEntities = { ...makeArchJson(0), entities: undefined as any };

      collector.setLastArchJson(noEntities, false);
      expect(collector.getLastArchJson()).toBe(noEntities);

      const withEntities = makeArchJson(100);
      collector.setLastArchJson(withEntities, false);
      expect(collector.getLastArchJson()).toBe(withEntities);
    });

    it('DOES overwrite when groupHasPrimary=true', () => {
      const collector = new QueryScopeCollector();
      const first = makeArchJson(1);
      const second = makeArchJson(2);

      collector.setLastArchJson(first, false);
      collector.setLastArchJson(second, true);

      expect(collector.getLastArchJson()).toBe(second);
    });

    it('two calls with groupHasPrimary=true → last value wins', () => {
      const collector = new QueryScopeCollector();
      const first = makeArchJson(1);
      const second = makeArchJson(2);
      const third = makeArchJson(3);

      collector.setLastArchJson(first, false);
      collector.setLastArchJson(second, true);
      collector.setLastArchJson(third, true);

      expect(collector.getLastArchJson()).toBe(third);
    });
  });
});

// ---------------------------------------------------------------------------
// Merged multi-scope view
// ---------------------------------------------------------------------------

interface FixtureEntity {
  id: string;
  name: string;
  file: string;
}

interface FixtureScopeOptions {
  entities: FixtureEntity[];
  relations?: Relation[];
  /** Internal directory module ids, relative to the scope root. */
  modules?: string[];
}

/**
 * Build a per-scope ArchJSON shaped exactly like the one `analyze` persists:
 * entity ids and relation targets are scope-root-relative, and the module
 * graph knows only the directories inside that root.
 */
function makeScopeArchJson(root: string, options: FixtureScopeOptions): ArchJSON {
  const modules = options.modules ?? [''];
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00.000Z',
    sourceFiles: options.entities.map((entity) => `${root}/${entity.file}`),
    entities: options.entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      type: 'class' as const,
      visibility: 'public' as const,
      sourceLocation: { file: entity.file, startLine: 1, endLine: 2 },
      members: [],
    })),
    relations: options.relations ?? [],
    extensions: {
      tsAnalysis: {
        version: '1.0',
        moduleGraph: {
          nodes: modules.map((id) => ({
            id,
            name: id || '(root)',
            type: 'internal' as const,
            fileCount: 1,
            stats: { classes: 0, interfaces: 0, functions: 0, enums: 0 },
          })),
          edges: [],
          cycles: [],
        },
      },
    },
  };
}

const P_ROOT = '/fixture/p';
const Q_ROOT = '/fixture/q';

function makePQScopes(): {
  pScope: {
    key: string;
    sources: string[];
    archJson: ArchJSON;
    kind: 'parsed';
  };
  qScope: {
    key: string;
    sources: string[];
    archJson: ArchJSON;
    kind: 'parsed';
  };
} {
  const pScope = {
    key: 'p-scope',
    sources: [P_ROOT],
    kind: 'parsed' as const,
    archJson: makeScopeArchJson(P_ROOT, {
      entities: [{ id: 'y.ts.Y', name: 'Y', file: 'y.ts' }],
    }),
  };
  const qScope = {
    key: 'q-scope',
    sources: [Q_ROOT],
    kind: 'parsed' as const,
    archJson: makeScopeArchJson(Q_ROOT, {
      entities: [{ id: 'x.ts.X', name: 'X', file: 'x.ts' }],
      relations: [
        {
          id: 'x.ts.X_dependency_../p/y.ts.Y',
          type: 'dependency',
          source: 'x.ts.X',
          target: '../p/y.ts.Y',
        },
      ],
    }),
  };
  return { pScope, qScope };
}

describe('mergeQueryScopes()', () => {
  it('returns null for a single scope — the per-source behavior must not change', () => {
    const { pScope } = makePQScopes();
    expect(mergeQueryScopes([pScope])).toBeNull();
    expect(mergeQueryScopes([])).toBeNull();
  });

  it('re-bases entities and recovers the q → p cross-scope relation', () => {
    const { pScope, qScope } = makePQScopes();

    const view = mergeQueryScopes([pScope, qScope]);

    expect(view.archJson.entities.map((entity) => entity.id).sort()).toEqual([
      'p/y.ts.Y',
      'q/x.ts.X',
    ]);
    expect(view.archJson.relations).toHaveLength(1);
    expect(view.archJson.relations[0]).toMatchObject({
      source: 'q/x.ts.X',
      target: 'p/y.ts.Y',
      type: 'dependency',
    });
  });

  it('adds the cross-scope edge to the merged module graph', () => {
    const { pScope, qScope } = makePQScopes();

    const view = mergeQueryScopes([pScope, qScope]);
    const graph = view.archJson.extensions?.tsAnalysis?.moduleGraph;

    expect(graph?.nodes.map((node) => node.id).sort()).toEqual(['p', 'q']);
    const edge = graph?.edges.find((candidate) => candidate.from === 'q' && candidate.to === 'p');
    expect(edge).toBeDefined();
    expect(edge?.importedNames).toEqual(['Y']);
    expect(edge?.strength).toBe(1);
    // Relations carry no statement position — the derived edge says so.
    expect(edge?.evidence).toEqual([{ specifier: '', file: 'q/x.ts', line: 0, kind: 'import' }]);
  });

  it('enumerates the recovered cross-scope edge with both scope keys', () => {
    const { pScope, qScope } = makePQScopes();

    const view = mergeQueryScopes([pScope, qScope]);

    expect(view.crossScopeEdges).toEqual([
      {
        from: 'q',
        to: 'p',
        fromScope: 'q-scope',
        toScope: 'p-scope',
        source: 'q/x.ts.X',
        target: 'p/y.ts.Y',
      },
    ]);
  });

  it('does not collide when two scopes use the same scope-relative entity id', () => {
    const aScope = {
      key: 'a-scope',
      sources: [P_ROOT],
      kind: 'parsed' as const,
      archJson: makeScopeArchJson(P_ROOT, {
        entities: [{ id: 'x.ts.X', name: 'X', file: 'x.ts' }],
      }),
    };
    const bScope = {
      key: 'b-scope',
      sources: [Q_ROOT],
      kind: 'parsed' as const,
      archJson: makeScopeArchJson(Q_ROOT, {
        entities: [{ id: 'x.ts.X', name: 'X', file: 'x.ts' }],
      }),
    };

    const view = mergeQueryScopes([aScope, bScope]);

    expect(view.archJson.entities.map((entity) => entity.id).sort()).toEqual([
      'p/x.ts.X',
      'q/x.ts.X',
    ]);
    expect(view.crossScopeEdges).toEqual([]);
  });

  it('recomputes directory cycles over the merged graph', () => {
    const pScope = {
      key: 'p-scope',
      sources: [P_ROOT],
      kind: 'parsed' as const,
      archJson: makeScopeArchJson(P_ROOT, {
        entities: [{ id: 'y.ts.Y', name: 'Y', file: 'y.ts' }],
        relations: [
          {
            id: 'y.ts.Y_dependency_../q/x.ts.X',
            type: 'dependency',
            source: 'y.ts.Y',
            target: '../q/x.ts.X',
          },
        ],
      }),
    };
    const qScope = {
      key: 'q-scope',
      sources: [Q_ROOT],
      kind: 'parsed' as const,
      archJson: makeScopeArchJson(Q_ROOT, {
        entities: [{ id: 'x.ts.X', name: 'X', file: 'x.ts' }],
        relations: [
          {
            id: 'x.ts.X_dependency_../p/y.ts.Y',
            type: 'dependency',
            source: 'x.ts.X',
            target: '../p/y.ts.Y',
          },
        ],
      }),
    };

    const view = mergeQueryScopes([pScope, qScope]);
    const cycles = view.archJson.extensions?.tsAnalysis?.moduleGraph?.cycles ?? [];

    expect(cycles).toHaveLength(1);
    expect(cycles[0].modules).toEqual(['p', 'q']);
    expect(cycles[0].severity).toBe('warning');
    expect(view.crossScopeEdges.map((edge) => `${edge.from}->${edge.to}`).sort()).toEqual([
      'p->q',
      'q->p',
    ]);
  });

  it('leaves targets that resolve to no known scope visible instead of dropping them', () => {
    const pScope = {
      key: 'p-scope',
      sources: [P_ROOT],
      kind: 'parsed' as const,
      archJson: makeScopeArchJson(P_ROOT, {
        entities: [{ id: 'y.ts.Y', name: 'Y', file: 'y.ts' }],
      }),
    };
    const qScope = {
      key: 'q-scope',
      sources: [Q_ROOT],
      kind: 'parsed' as const,
      archJson: makeScopeArchJson(Q_ROOT, {
        entities: [{ id: 'x.ts.X', name: 'X', file: 'x.ts' }],
        relations: [
          {
            id: 'x.ts.X_dependency_../elsewhere/z.ts.Z',
            type: 'dependency',
            source: 'x.ts.X',
            target: '../elsewhere/z.ts.Z',
          },
        ],
      }),
    };

    const view = mergeQueryScopes([pScope, qScope]);

    expect(view.archJson.relations[0].target).toBe('elsewhere/z.ts.Z');
    expect(view.crossScopeEdges).toEqual([]);
  });
});

describe('merged scope through the query loader', () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  function scopeEntry(
    key: string,
    label: string,
    sources: string[],
    archJson: ArchJSON
  ): QueryScopeEntry {
    return {
      key,
      label,
      language: 'typescript',
      kind: 'parsed',
      sources,
      entityCount: archJson.entities.length,
      relationCount: archJson.relations.length,
      hasAtlasExtension: false,
      generatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  function writeWorkspace(entries: QueryScopeEntry[], archJsons: Map<string, ArchJSON>): void {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merged-scope-'));
    const queryDir = path.join(tmp, 'query');
    fs.mkdirSync(queryDir, { recursive: true });
    for (const entry of entries) {
      const archJson = archJsons.get(entry.key);
      if (!archJson) continue;
      const scopeDir = path.join(queryDir, entry.key);
      fs.mkdirSync(scopeDir, { recursive: true });
      fs.writeFileSync(path.join(scopeDir, 'arch.json'), JSON.stringify(archJson, null, 2));
    }
    fs.writeFileSync(
      path.join(queryDir, 'manifest.json'),
      JSON.stringify(
        {
          version: '1.0',
          generatedAt: '2026-01-01T00:00:00.000Z',
          globalScopeKey: entries[0]?.key,
          scopes: entries,
        },
        null,
        2
      )
    );
  }

  function writePQWorkspace(): { pKey: string; qKey: string } {
    const { pScope, qScope } = makePQScopes();
    const pKey = pScope.key;
    const qKey = qScope.key;
    const entries = [
      scopeEntry(pKey, 'p (typescript)', pScope.sources, pScope.archJson),
      scopeEntry(qKey, 'q (typescript)', qScope.sources, qScope.archJson),
    ];
    writeWorkspace(
      entries,
      new Map([
        [pKey, pScope.archJson],
        [qKey, qScope.archJson],
      ])
    );
    return { pKey, qKey };
  }

  it('resolves the synthetic merged scope entry', async () => {
    writePQWorkspace();

    const entry = await resolveScope(tmp, MERGED_SCOPE_KEY);

    expect(entry.key).toBe(MERGED_SCOPE_KEY);
    expect(entry.kind).toBe('derived');
    expect([...entry.sources].sort()).toEqual([P_ROOT, Q_ROOT]);
    expect(entry.label).toBe('merged (2 scopes)');
  });

  it('exposes the q → p edge through the engine and package graph', async () => {
    writePQWorkspace();

    const ctx = await loadEngine(tmp, MERGED_SCOPE_KEY);

    expect(ctx.scopeInfo.key).toBe(MERGED_SCOPE_KEY);
    expect(ctx.engine.getCrossScopeEdges()).toEqual([
      {
        from: 'q',
        to: 'p',
        fromScope: 'q-scope',
        toScope: 'p-scope',
        source: 'q/x.ts.X',
        target: 'p/y.ts.Y',
      },
    ]);
    expect(ctx.engine.findEntity('X')).toHaveLength(1);
    expect(ctx.engine.findEntity('Y')).toHaveLength(1);

    const packageCycles = ctx.engine.getPackageCycles();
    expect(packageCycles.evaluated).toBe(true);
    expect(packageCycles.edgeDeletions?.some((edge) => edge.from === 'q' && edge.to === 'p')).toBe(
      true
    );

    expect(ctx.availableScopes.map((scope) => scope.key)).toContain(MERGED_SCOPE_KEY);
  });

  it('leaves a normal per-scope query untouched (no cross-scope edges attached)', async () => {
    const { pKey } = writePQWorkspace();

    const ctx = await loadEngine(tmp, pKey);

    expect(ctx.scopeInfo.key).toBe(pKey);
    expect(ctx.engine.getCrossScopeEdges()).toBeUndefined();
    expect(ctx.engine.findEntity('Y')).toHaveLength(1);
    expect(ctx.engine.findEntity('X')).toHaveLength(0);
  });

  it('rejects the merged alias when only one scope exists', async () => {
    const { pScope } = makePQScopes();
    const entry = scopeEntry(pScope.key, 'p (typescript)', pScope.sources, pScope.archJson);
    writeWorkspace([entry], new Map([[pScope.key, pScope.archJson]]));

    await expect(resolveScope(tmp, MERGED_SCOPE_KEY)).rejects.toThrow(/at least two/);
  });

  it('lets a real scope whose key is "merged" win over the synthetic alias', async () => {
    const { pScope, qScope } = makePQScopes();
    const realMerged = scopeEntry('merged', 'real merged scope', pScope.sources, pScope.archJson);
    writeWorkspace(
      [realMerged, scopeEntry(qScope.key, 'q (typescript)', qScope.sources, qScope.archJson)],
      new Map([
        ['merged', pScope.archJson],
        [qScope.key, qScope.archJson],
      ])
    );

    const entry = await resolveScope(tmp, 'merged');

    expect(entry.label).toBe('real merged scope');
    expect(entry.kind).toBe('parsed');
  });
});
