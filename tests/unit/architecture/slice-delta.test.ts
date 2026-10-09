/**
 * Regression guard for docs/experiments/layer-map/slice-delta.mjs
 * ("Refactor Slice / Expected Delta" prototype).
 *
 * The prototype answers exactly one question — "given this explicitly supplied
 * cut, what is the expected architecture delta?" — and answers it from the
 * package-level moduleGraph alone. Two properties are load-bearing and are what
 * most of these tests exist to pin down:
 *
 *   1. `computedDelta` is COMPUTED, not fed. The cut input carries file-move
 *      intent and symbol names, never "delete edge A -> B"; the reconciliation
 *      is a set operation over the graph's own `importedNames`. The anti-stuffing
 *      test below swaps the observed reading for a deliberately absurd one and
 *      asserts the computed section is byte-identical — that is the mechanical
 *      evidence that nothing leaks from declared/observed into computed.
 *   2. The reading is FALSIFIABLE. A slice with no negative control is reported
 *      not-evaluated rather than "looks fine", and the falsification criterion is
 *      relative to the before-SCC (a restored edge that does not bring the
 *      departed directories back fails the criterion and exits 1).
 *
 * The dogfood case is quay GOAL-033, whose hand-written prediction was SCC
 * 6 -> 5 while the measured result was 6 -> 4. The fixture is the real fork-point
 * subtree (treeSha 5213eb61...) analysed by ArchGuard; the prototype is expected
 * to recompute 6 -> 4 from the graph, which is why the declared prediction and
 * the observed reading are kept as separate readings rather than reconciled.
 */

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'docs/experiments/layer-map/slice-delta.mjs');
const FIXTURES = path.join(REPO_ROOT, 'tests/fixtures/slice-delta');
const G033_ARCH = path.join(FIXTURES, 'goal-033-fork-point.arch.json');
const G033_SLICE = path.join(FIXTURES, 'goal-033-slice.json');
const G033_OBSERVED = path.join(FIXTURES, 'goal-033-observed.json');
const SYNTH_ARCH = path.join(FIXTURES, 'synthetic-small.arch.json');

type Json = Record<string, any>;

let tmpDir: string;
function tmpFile(name: string, content: unknown): string {
  tmpDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'slice-delta-test-'));
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, JSON.stringify(content, null, 2));
  return p;
}
function readJson(p: string): Json {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
/** Run the script with `--json` pointed at a temp file and return exit code + report. */
function run(args: string[]): { code: number; report: Json; stdout: string } {
  tmpDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'slice-delta-test-'));
  const out = path.join(tmpDir, `report-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--json', out], { encoding: 'utf8' });
  return {
    code: r.status ?? -1,
    report: fs.existsSync(out) ? readJson(out) : {},
    stdout: r.stdout ?? '',
  };
}
/** Write a mutated copy of the GOAL-033 slice and return its path. */
function mutatedSlice(name: string, mutate: (s: Json) => void): string {
  const s = readJson(G033_SLICE);
  mutate(s);
  return tmpFile(name, s);
}

const SYNTH_SLICE: Json = {
  subject: '',
  concern: 'synthetic: retarget into a third directory + an already-present destination edge',
  provenance: { repo: '/nonexistent/synthetic-small', ref: 'n/a', commit: '', worktree: 'n/a' },
  proposedCut: {
    moves: [
      { file: 'a/x.ts', from: 'a', to: 'c', symbols: ['x'] },
      { file: 'b/y.ts', from: 'b', to: 'c', symbols: ['y'] },
    ],
    consumers: [],
  },
  mustNotChange: { forbiddenNewEdges: [], untouchedDirs: [] },
  negativeControl: {
    description: 'restore both removed edges; the before-SCC must come back in full',
    restoreEdges: [
      { from: '', to: 'a' },
      { from: 'a', to: 'b' },
    ],
  },
};

describe('slice-delta prototype', () => {
  it('prints the usage and exits 2 when invoked without the required arguments', () => {
    const noArgs = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(noArgs.status).toBe(2);
    expect(noArgs.stdout).toContain('用法:');

    const noSlice = spawnSync(process.execPath, [SCRIPT, G033_ARCH], { encoding: 'utf8' });
    expect(noSlice.status).toBe(2);
  });

  describe('GOAL-033 dogfood (the prototype recomputes the delta from the graph)', () => {
    const { code, report } = run([G033_ARCH, '--slice', G033_SLICE, '--observed', G033_OBSERVED]);

    it('exits 0 with every guard satisfied', () => {
      expect(code).toBe(0);
      expect(report.status).toBe('evaluated');
      expect(report.guards.passed).toBe(true);
    });

    it('reproduces the fork-point baseline: a size-6 SCC containing cli and fan-in', () => {
      expect(report.current.sccSize).toBe(6);
      expect(report.current.sccMembers).toEqual(
        expect.arrayContaining(['', 'cli', 'fan-in', 'gate', 'gate/config', 'gate/factories'])
      );
      // cli's fan-in value strength is 2 — the same reading GOAL-033 recorded as cliPackageFanIn.
      expect(report.current.targets).toEqual([
        { dir: 'cli', inEdges: 1, inValueStrength: 2, inTypeOnlyStrength: 0 },
      ]);
    });

    it('removes exactly the core-root -> cli edge and adds no edge at all', () => {
      expect(report.computedDelta.removedEdges).toHaveLength(1);
      expect(report.computedDelta.removedEdges[0]).toMatchObject({
        from: '',
        to: 'cli',
        importedNames: ['runDriver', 'ALL_SERVICE_NAMES', 'HOSTED_SERVICE_NAMES'],
        becomes: 'intra-directory',
      });
      expect(report.computedDelta.addedEdges).toEqual([]);
      // The shell trap GOAL-033 warns about: no core-root -> fan-in edge may appear.
      expect(report.computedDelta.addedEdges.some((e: Json) => e.to === 'fan-in')).toBe(false);
      expect(report.computedDelta.targetsAfter).toEqual([
        { dir: 'cli', inEdges: 0, inValueStrength: 0, inTypeOnlyStrength: 0 },
      ]);
    });

    it('predicts SCC 6 -> 4 — fan-in leaves with cli, and says so from recomputed reachability', () => {
      expect(report.computedDelta.sccAfter).toEqual(['', 'gate', 'gate/config', 'gate/factories']);
      expect(report.computedDelta.sccLeft).toEqual(['cli', 'fan-in']);
      expect(report.computedDelta.sccRemaining).not.toContain('cli');
      expect(report.computedDelta.sccRemaining).not.toContain('fan-in');
      const cli = report.computedDelta.whyLeft.find((w: Json) => w.dir === 'cli');
      const fanIn = report.computedDelta.whyLeft.find((w: Json) => w.dir === 'fan-in');
      expect(cli.leftBecause).toBe('own-in-edges-removed');
      // fan-in's own in-edge count is UNCHANGED — it left because its only in-edge comes from cli.
      expect(fanIn).toMatchObject({
        inEdgesBefore: 1,
        inEdges: 1,
        leftBecause: 'transitively-via',
        via: ['cli'],
      });
    });

    it('keeps declared (6->5), computed (6->4) and observed (6->4) as three separated readings', () => {
      expect(report.declaredPrediction.sccSize).toBe(5);
      expect(report.declaredPrediction.sccMembers).toEqual(
        expect.arrayContaining(['', 'fan-in', 'gate', 'gate/config', 'gate/factories'])
      );
      expect(report.predictionComparison.declaredVsComputed).toMatchObject({
        declaredSccSize: 5,
        computedSccSize: 4,
        sizeMatches: false,
      });
      expect(report.observedDelta.sccSize).toBe(4);
      expect(report.predictionComparison.observedVsComputed).toMatchObject({
        observedSccSize: 4,
        computedSccSize: 4,
        sizeMatches: true,
      });
      // the declared prediction is echoed, never rewritten into the computed value
      expect(report.declaredPrediction.sccSize).not.toBe(report.computedDelta.sccAfter.length);
    });

    it('verifies the negative control against the before-SCC membership', () => {
      expect(report.negativeControl.restoreEdges).toEqual([{ from: '', to: 'cli' }]);
      expect(report.negativeControl.leftDirs).toEqual(['cli', 'fan-in']);
      expect(report.negativeControl.leftDirsRejoined).toEqual(['cli', 'fan-in']);
      expect(report.negativeControl.restoresBeforeMembership).toBe(true);
      expect(report.negativeControl.falsified).toBe(true);
    });

    it('records provenance for the analysis, the slice, the tool and the observed input', () => {
      expect(report.provenance.analysis.workspaceRoot).toBeTruthy();
      expect(report.provenance.analysis.timestamp).toBeTruthy();
      expect(report.provenance.slice.commit).toBe('1ac06fd85094a58d4954640811a787873f8ad2a1');
      expect(report.provenance.tool.archguardVersion).toBeTruthy();
      expect(report.provenance.tool.script).toBe('docs/experiments/layer-map/slice-delta.mjs');
      expect(report.provenance.observed.source).toBe(G033_OBSERVED);
      // the fixture's workspaceRoot is an exported tree, not a git work tree — reported honestly, not faked
      expect(['match', 'mismatch', 'not-checked']).toContain(
        report.provenance.provenanceConsistency.status
      );
      expect(report.provenance.provenanceConsistency.reason).toBeTruthy();
    });

    it('declares which inputs the computed delta was allowed to use', () => {
      expect(report.computedDelta.inputsUsed).toContain('extensions.tsAnalysis.moduleGraph');
      expect(report.computedDelta.inputsUsed).toContain('slice.proposedCut');
      expect(report.computedDelta.inputsUsed.some((i: string) => i.includes('observed'))).toBe(
        false
      );
      expect(report.computedDelta.inputsUsed.some((i: string) => i.includes('declared'))).toBe(
        false
      );
    });

    it('emits no gate-style verdict field names (this prototype is not a gate)', () => {
      const forbidden = new Set(['pass', 'fail', 'exitCode']);
      const seen: string[] = [];
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (node && typeof node === 'object') {
          for (const [k, v] of Object.entries(node as Json)) {
            seen.push(k);
            walk(v);
          }
        }
      };
      walk(report);
      expect(seen.filter((k) => forbidden.has(k))).toEqual([]);
      expect(['evaluated', 'not-evaluated']).toContain(report.status);
    });
  });

  describe('anti-stuffing', () => {
    it('never lets --observed feed into the computed delta', () => {
      const tampered = tmpFile('tampered-observed.json', {
        provenance: { repo: '/nonexistent', ref: 'bogus', commit: 'deadbeef' },
        sccSize: 999,
        sccMembers: ['x', 'y', 'z'],
      });
      const withReal = run([G033_ARCH, '--slice', G033_SLICE, '--observed', G033_OBSERVED]);
      const withBogus = run([G033_ARCH, '--slice', G033_SLICE, '--observed', tampered]);
      const withNone = run([G033_ARCH, '--slice', G033_SLICE]);

      const computed = (r: { report: Json }) => JSON.stringify(r.report.computedDelta);
      const negctl = (r: { report: Json }) => JSON.stringify(r.report.negativeControl);
      const declared = (r: { report: Json }) => JSON.stringify(r.report.declaredPrediction);

      expect(computed(withBogus)).toBe(computed(withReal));
      expect(computed(withNone)).toBe(computed(withReal));
      expect(negctl(withBogus)).toBe(negctl(withReal));
      expect(negctl(withNone)).toBe(negctl(withReal));
      expect(declared(withBogus)).toBe(declared(withReal));

      // the only thing that may differ is the observed reading and its comparison
      expect(withBogus.report.observedDelta.sccSize).toBe(999);
      expect(withBogus.report.predictionComparison.observedVsComputed.sizeMatches).toBe(false);
      expect(withNone.report.observedDelta).toBeNull();
      expect(withNone.report.predictionComparison.observedVsComputed).toBeNull();
      expect(withReal.report.predictionComparison.observedVsComputed.sizeMatches).toBe(true);
    });
  });

  describe('guards', () => {
    it('fails the criterion (exit 1) when the restored edge does not bring the departed dirs back', () => {
      const slice = mutatedSlice('unrelated-restore.json', (s) => {
        s.negativeControl.restoreEdges = [{ from: 'kernel', to: 'ts-demo' }];
      });
      const { code, report } = run([G033_ARCH, '--slice', slice]);
      expect(code).toBe(1);
      expect(report.status).toBe('evaluated');
      expect(report.negativeControl.falsified).toBe(false);
      expect(report.negativeControl.leftDirsRejoined).toEqual([]);
      expect(report.guards.passed).toBe(false);
      // the computed delta itself is untouched by the failed criterion
      expect(report.computedDelta.sccAfter).toEqual(['', 'gate', 'gate/config', 'gate/factories']);
    });

    it('catches the shell trap: a new core-root -> fan-in edge violates must-not-change', () => {
      const slice = mutatedSlice('shell-trap.json', (s) => {
        // moving the driver client into fan-in instead of core-root is exactly the shape
        // GOAL-033 forbids (fan-in -> core-root already exists, so this would create mutual coupling)
        s.proposedCut.moves.forEach((m: Json) => (m.to = 'fan-in'));
        s.proposedCut.consumers = [];
      });
      const { code, report } = run([G033_ARCH, '--slice', slice]);
      expect(code).toBe(1);
      expect(report.computedDelta.addedEdges).toEqual([
        { from: '', to: 'fan-in', source: 'retarget-from-removed-edge' },
      ]);
      expect(report.mustNotChange.violations).toEqual([
        { kind: 'forbidden-new-edge', edge: ' -> fan-in' },
      ]);
      expect(report.guards.passed).toBe(false);
    });
  });

  describe('not-evaluated instead of guessing', () => {
    it('degrades when its own SCC recomputation disagrees with moduleGraph.cycles', () => {
      const arch = readJson(G033_ARCH);
      const mg = arch.extensions.tsAnalysis.moduleGraph;
      const i = mg.edges.findIndex((e: Json) => e.from === 'cli' && e.to === 'fan-in');
      expect(i).toBeGreaterThanOrEqual(0);
      mg.edges.splice(i, 1);
      const broken = tmpFile('broken-graph.arch.json', arch);

      const { code, report } = run([broken, '--slice', G033_SLICE]);
      expect(code).toBe(2);
      expect(report.status).toBe('not-evaluated');
      expect(report.reason).toContain('自校验失败');
      expect(report.computedDelta).toBeUndefined();
    });

    it('degrades when the cut does not fully account for an edge it would have to remove', () => {
      const slice = mutatedSlice('partial-coverage.json', (s) => {
        s.proposedCut.moves[1].symbols = ['ALL_SERVICE_NAMES']; // drops HOSTED_SERVICE_NAMES
      });
      const { code, report } = run([G033_ARCH, '--slice', slice]);
      expect(code).toBe(2);
      expect(report.status).toBe('not-evaluated');
      expect(report.reason).toContain(' -> cli');
      expect(report.reason).toContain('HOSTED_SERVICE_NAMES');
    });

    it('degrades when the slice carries no negative control at all', () => {
      const slice = mutatedSlice('no-negative-control.json', (s) => {
        delete s.negativeControl;
      });
      const { code, report } = run([G033_ARCH, '--slice', slice]);
      expect(code).toBe(2);
      expect(report.status).toBe('not-evaluated');
      expect(report.reason).toContain('negative control');
    });

    it('degrades on a missing or unreadable input rather than reporting an empty result', () => {
      const missing = run([path.join(FIXTURES, 'does-not-exist.json'), '--slice', G033_SLICE]);
      expect(missing.code).toBe(2);
      expect(missing.report.status).toBe('not-evaluated');

      const notAGraph = tmpFile('not-a-graph.arch.json', {
        version: '1.0',
        language: 'typescript',
      });
      const noGraph = run([notAGraph, '--slice', G033_SLICE]);
      expect(noGraph.code).toBe(2);
      expect(noGraph.report.reason).toContain('moduleGraph');
    });
  });

  describe('synthetic graph: the branches the GOAL-033 fixture cannot exercise', () => {
    const slicePath = tmpFile('synthetic-slice.json', SYNTH_SLICE);
    const { code, report } = run([SYNTH_ARCH, '--slice', slicePath]);

    it('retargets a removed edge into a third directory and reports an already-present edge as strengthened', () => {
      expect(code).toBe(0);
      expect(report.status).toBe('evaluated');
      // a -> b retargets to a -> c, which did not exist before: a real added edge
      expect(report.computedDelta.addedEdges).toEqual([
        { from: 'a', to: 'c', source: 'retarget-from-removed-edge' },
      ]);
      // "" -> a retargets to "" -> c, which already existed: not a new edge, and the strength delta is not computable
      expect(report.computedDelta.strengthenedEdges).toEqual([
        {
          from: '',
          to: 'c',
          source: 'retarget-from-removed-edge',
          via: null,
          effect: 'strengthens-existing-edge',
        },
      ]);
      expect(
        report.computedDelta.removedEdges.map((e: Json) => `${e.from} -> ${e.to}`).sort()
      ).toEqual([' -> a', 'a -> b']);
    });

    it('dissolves the cycle entirely and falsifies via a multi-edge restore', () => {
      expect(report.current.sccSize).toBe(3);
      expect(report.computedDelta.sccAfter).toEqual(['']);
      expect(report.computedDelta.sccLeft).toEqual(['a', 'b']);
      expect(report.negativeControl.restoresBeforeMembership).toBe(true);
      expect(report.negativeControl.falsified).toBe(true);
      expect(code).toBe(0);
    });
  });
});
