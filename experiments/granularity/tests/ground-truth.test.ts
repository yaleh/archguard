/**
 * Stage 60.3 tests — query CLI wrapper arg assembly (mocked subprocess),
 * built-in graph algorithms, reconcile mode and SHA-256 artifact hashing.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  QUERY_FLAGS,
  buildAnalyzeArgs,
  buildQueryArgs,
  generateGroundTruth,
  translateGroundTruth,
  diffGroundTruth,
  reconcile,
  sha256OfString,
  sha256OfFile,
  writeHashManifest,
  type ExecFn,
  type GroundTruth,
  type TreeSpec,
} from '../ground-truth';
import { articulationPoints } from '../lib/graph/articulation-points';
import { inDegreeRanking } from '../lib/graph/in-degree';

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'gt');
const TMP_DIR = mkdtempSync(path.join(os.tmpdir(), 'gt-test-'));

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

const TREE: TreeSpec = {
  name: 'orig',
  sourceDir: '/tmp/trees/original/src',
  workDir: '/tmp/work/orig',
};

describe('CLI arg assembly (review note C2: explicit work-dir / arch-dir, never repo-root .archguard)', () => {
  it('analyze args carry -s, an explicit --work-dir, -f json and --no-cache', () => {
    const args = buildAnalyzeArgs('dist/cli/index.js', TREE);
    expect(args[0]).toBe('dist/cli/index.js');
    expect(args[1]).toBe('analyze');
    expect(args).toContain('-s');
    expect(args[args.indexOf('-s') + 1]).toBe(TREE.sourceDir);
    expect(args).toContain('--work-dir');
    expect(args[args.indexOf('--work-dir') + 1]).toBe(TREE.workDir);
    expect(args).toContain('-f');
    expect(args[args.indexOf('-f') + 1]).toBe('json');
    expect(args).toContain('--no-cache');
  });

  it('query args carry an explicit --arch-dir equal to the tree work dir and --format json', () => {
    const args = buildQueryArgs('dist/cli/index.js', TREE.workDir, {
      flag: '--deps-of',
      value: 'C1',
    });
    expect(args[1]).toBe('query');
    expect(args).toContain('--arch-dir');
    expect(args[args.indexOf('--arch-dir') + 1]).toBe(TREE.workDir);
    expect(args).toContain('--format');
    expect(args[args.indexOf('--format') + 1]).toBe('json');
    expect(args).toContain('--deps-of');
    expect(args[args.indexOf('--deps-of') + 1]).toBe('C1');
  });

  it('valueless flags (e.g. --cycles) do not append an argument', () => {
    const args = buildQueryArgs('dist/cli/index.js', TREE.workDir, { flag: '--cycles' });
    expect(args).toContain('--cycles');
    expect(args[args.length - 1]).toBe('--cycles');
  });

  it('wraps exactly the 7 ground-truth query flags from proposal §5', () => {
    expect([...QUERY_FLAGS].sort()).toEqual(
      [
        '--cycles',
        '--deps-of',
        '--file',
        '--high-coupling',
        '--implementers-of',
        '--subclasses-of',
        '--used-by',
      ].sort()
    );
  });

  it('generateGroundTruth runs analyze first, then every query with the same explicit --arch-dir', async () => {
    const calls: string[][] = [];
    const exec: ExecFn = vi.fn(async (_cmd, args) => {
      calls.push(args);
      return { stdout: '{"results": []}', stderr: '', exitCode: 0 };
    });

    const gt = await generateGroundTruth(
      TREE,
      [
        { flag: '--deps-of', value: 'C1' },
        { flag: '--used-by', value: 'C1' },
        { flag: '--implementers-of', value: 'I1' },
        { flag: '--subclasses-of', value: 'C2' },
        { flag: '--cycles' },
        { flag: '--high-coupling' },
        { flag: '--file', value: 'f1.ts' },
      ],
      { cliPath: 'dist/cli/index.js', exec }
    );

    // First call is analyze with explicit --work-dir.
    expect(calls[0]).toContain('analyze');
    expect(calls[0]).toContain('--work-dir');
    expect(calls[0]![calls[0]!.indexOf('--work-dir') + 1]).toBe(TREE.workDir);

    // All remaining calls are queries with explicit --arch-dir = workDir.
    const queryCalls = calls.slice(1);
    expect(queryCalls).toHaveLength(7);
    for (const qc of queryCalls) {
      expect(qc).toContain('query');
      expect(qc).toContain('--arch-dir');
      expect(qc[qc.indexOf('--arch-dir') + 1]).toBe(TREE.workDir);
    }

    expect(gt.tree).toBe('orig');
    expect(Object.keys(gt.queries)).toHaveLength(7);
    expect(gt.queries['deps-of:C1']).toEqual({ results: [] });
    expect(gt.queries['cycles']).toEqual({ results: [] });
  });

  it('generateGroundTruth throws when the CLI exits non-zero', async () => {
    const exec: ExecFn = async () => ({ stdout: '', stderr: 'boom', exitCode: 1 });
    await expect(
      generateGroundTruth(TREE, [{ flag: '--cycles' }], { cliPath: 'cli.js', exec })
    ).rejects.toThrow(/exit/i);
  });
});

describe('graph algorithms: articulation points (Tarjan, undirected)', () => {
  it('path graph A-B-C: B is the only articulation point', () => {
    expect(
      articulationPoints(
        ['A', 'B', 'C'],
        [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
        ]
      )
    ).toEqual(['B']);
  });

  it('cycle A-B-C-A: no articulation points', () => {
    expect(
      articulationPoints(
        ['A', 'B', 'C'],
        [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
          { from: 'C', to: 'A' },
        ]
      )
    ).toEqual([]);
  });

  it('two triangles sharing vertex D: D is the articulation point', () => {
    const edges = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'D' },
      { from: 'D', to: 'A' },
      { from: 'D', to: 'E' },
      { from: 'E', to: 'F' },
      { from: 'F', to: 'D' },
    ];
    expect(articulationPoints(['A', 'B', 'D', 'E', 'F'], edges)).toEqual(['D']);
  });

  it('handles disconnected graphs and isolated nodes', () => {
    expect(
      articulationPoints(
        ['A', 'B', 'C', 'X', 'Y', 'Z', 'LONE'],
        [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
          { from: 'X', to: 'Y' },
          { from: 'Y', to: 'Z' },
        ]
      )
    ).toEqual(['B', 'Y']);
  });

  it('ignores self-loops and duplicate edges', () => {
    expect(
      articulationPoints(
        ['A', 'B', 'C'],
        [
          { from: 'A', to: 'A' },
          { from: 'A', to: 'B' },
          { from: 'B', to: 'A' },
          { from: 'B', to: 'C' },
        ]
      )
    ).toEqual(['B']);
  });
});

describe('graph algorithms: in-degree ranking', () => {
  it('counts incoming relations and sorts descending, ties broken by id', () => {
    const relations = [
      { from: 'A', to: 'C', type: 'dependency' },
      { from: 'B', to: 'C', type: 'dependency' },
      { from: 'D', to: 'C', type: 'inheritance' },
      { from: 'A', to: 'B', type: 'dependency' },
      { from: 'C', to: 'B', type: 'dependency' },
      { from: 'A', to: 'D', type: 'dependency' },
    ];
    expect(inDegreeRanking(relations)).toEqual([
      { id: 'C', inDegree: 3 },
      { id: 'B', inDegree: 2 },
      { id: 'D', inDegree: 1 },
    ]);
  });

  it('excludes self-relations', () => {
    expect(
      inDegreeRanking([
        { from: 'A', to: 'A' },
        { from: 'B', to: 'A' },
      ])
    ).toEqual([{ id: 'A', inDegree: 1 }]);
  });

  it('returns empty for no relations', () => {
    expect(inDegreeRanking([])).toEqual([]);
  });
});

describe('reconcile: mapping translation + diff', () => {
  const mapping = JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'mapping.json'), 'utf8'));
  const original: GroundTruth = JSON.parse(
    readFileSync(path.join(FIXTURE_DIR, 'original-gt.json'), 'utf8')
  );
  const obf: GroundTruth = JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'obf-gt.json'), 'utf8'));

  it('translates identifiers, file paths and query keys via mapping.json', () => {
    const translated = translateGroundTruth(original, mapping);
    expect(translated.queries['deps-of:C1']).toEqual(['C2']);
    expect(translated.queries['file:f1.ts']).toEqual(['C1']);
    expect(translated.graph?.articulationPoints).toEqual(['C1']);
    expect(translated.graph?.inDegreeRanking).toEqual([
      { id: 'C2', inDegree: 3 },
      { id: 'C1', inDegree: 1 },
    ]);
  });

  it('isomorphic GT pair reconciles to zero differences', () => {
    const diffs = diffGroundTruth(translateGroundTruth(original, mapping), obf);
    expect(diffs).toEqual([]);
  });

  it('an injected difference is captured with its path', () => {
    const mutated: GroundTruth = JSON.parse(JSON.stringify(obf));
    (mutated.queries['deps-of:C1'] as string[]).push('C9');
    const diffs = diffGroundTruth(translateGroundTruth(original, mapping), mutated);
    expect(diffs.length).toBe(1);
    expect(diffs[0]!.path).toContain('deps-of:C1');
  });

  it('array order does not produce spurious differences (set semantics)', () => {
    const reordered: GroundTruth = JSON.parse(JSON.stringify(obf));
    (reordered.queries['used-by:C2'] as string[]).reverse();
    const diffs = diffGroundTruth(translateGroundTruth(original, mapping), reordered);
    expect(diffs).toEqual([]);
  });

  it('the tree label is not compared (differs by design)', () => {
    const translated = translateGroundTruth(original, mapping);
    expect(translated.tree).toBe('original');
    expect(diffGroundTruth(translated, obf)).toEqual([]);
  });

  it('reconcile() end-to-end on fixture files reports zero differences', async () => {
    const diffs = await reconcile(
      path.join(FIXTURE_DIR, 'original-gt.json'),
      path.join(FIXTURE_DIR, 'obf-gt.json'),
      path.join(FIXTURE_DIR, 'mapping.json')
    );
    expect(diffs).toEqual([]);
  });

  it('reconcile() end-to-end catches an injected difference', async () => {
    const mutated = JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'obf-gt.json'), 'utf8'));
    mutated.graph.articulationPoints = ['C2'];
    const mutatedPath = path.join(TMP_DIR, 'obf-gt-mutated.json');
    writeFileSync(mutatedPath, JSON.stringify(mutated));
    const diffs = await reconcile(
      path.join(FIXTURE_DIR, 'original-gt.json'),
      mutatedPath,
      path.join(FIXTURE_DIR, 'mapping.json')
    );
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs.some((d) => d.path.includes('articulationPoints'))).toBe(true);
  });
});

describe('SHA-256 artifact hashing', () => {
  it('sha256OfString matches the known digest of "hello"', () => {
    expect(sha256OfString('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('sha256OfFile is stable across repeated calls', () => {
    const f = path.join(TMP_DIR, 'stable.txt');
    writeFileSync(f, 'frozen artifact');
    const h1 = sha256OfFile(f);
    const h2 = sha256OfFile(f);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writeHashManifest writes a sorted, relative-keyed manifest', () => {
    const f1 = path.join(TMP_DIR, 'b-artifact.json');
    const f2 = path.join(TMP_DIR, 'a-artifact.json');
    writeFileSync(f1, '{"b":1}');
    writeFileSync(f2, '{"a":1}');
    const manifestPath = path.join(TMP_DIR, 'hashes.json');
    writeHashManifest([f1, f2], manifestPath, TMP_DIR);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(Object.keys(manifest)).toEqual(['a-artifact.json', 'b-artifact.json']);
    expect(manifest['a-artifact.json']).toBe(sha256OfFile(f2));
  });
});
