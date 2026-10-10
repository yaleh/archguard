/**
 * CLI adapter tests for `archguard slice-delta` — the three-state exit codes,
 * provenance, and the fail-closed paths. The command runs against the real
 * `.archguard`-free `--arch` path (fixture file) so no analyze step is needed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runSliceDelta, buildSliceDeltaProvenance } from '@/cli/commands/slice-delta.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const FIX = path.join(REPO_ROOT, 'tests', 'fixtures', 'slice-delta');
const GOAL_ARCH = path.join(FIX, 'goal-033-fork-point.arch.json');
const GOAL_SLICE = path.join(FIX, 'goal-033-slice.json');
const GOAL_OBSERVED = path.join(FIX, 'goal-033-observed.json');
const SYNTH_ARCH = path.join(FIX, 'synthetic-small.arch.json');

const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, 'utf8'));
const PKG_VERSION = readJson(path.join(REPO_ROOT, 'package.json')).version;

let TMP = '';
beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'slice-delta-cli-'));
});
afterAll(() => {
  if (TMP) fs.rmSync(TMP, { recursive: true, force: true });
});
const writeSlice = (name: string, obj: unknown): string => {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
};

const goal = (over: Record<string, unknown> = {}) => ({
  ...readJson(GOAL_SLICE),
  ...over,
});
const synSlice = (over: Record<string, unknown> = {}) => ({
  subject: '',
  concern: 'synthetic-small',
  proposedCut: {
    moves: [
      { file: 'alpha-main.ts', from: 'alpha', to: '', symbols: ['alphaMain', 'alphaHelper'] },
    ],
    consumers: [],
  },
  negativeControl: { description: 'restore', restoreEdges: [{ from: '', to: 'alpha' }] },
  ...over,
});

describe('archguard slice-delta — GOAL-033 happy path', () => {
  it('exits 0 and reports the 6 → 4 delta', async () => {
    const r = await runSliceDelta({
      slice: GOAL_SLICE,
      arch: GOAL_ARCH,
      observed: GOAL_OBSERVED,
    });
    expect(r.exitCode).toBe(0);
    expect(r.report.status).toBe('evaluated');
    if (r.report.status !== 'evaluated') return;
    expect(r.report.current.sccSize).toBe(6);
    expect(r.report.computedDelta.sccAfter).toEqual(['', 'gate', 'gate/config', 'gate/factories']);
    expect([...r.report.computedDelta.sccLeft].sort()).toEqual(['cli', 'fan-in']);
    expect(r.report.computedDelta.removedEdges).toHaveLength(1);
    expect(r.report.computedDelta.removedEdges[0]).toMatchObject({ from: '', to: 'cli' });
    expect(r.report.computedDelta.addedEdges.filter((a) => a.to === 'fan-in')).toEqual([]);
    expect(r.report.guards.clean).toBe(true);
  });

  it('carries all five provenance sections with a real archguardVersion', async () => {
    const r = await runSliceDelta({ slice: GOAL_SLICE, arch: GOAL_ARCH, observed: GOAL_OBSERVED });
    if (r.report.status !== 'evaluated') throw new Error('expected evaluated');
    const p = r.report.provenance as any;
    for (const section of ['analysis', 'slice', 'observed', 'tool', 'provenanceConsistency']) {
      expect(p[section]).toBeDefined();
    }
    expect(p.tool.archguardVersion).toBe(PKG_VERSION);
    expect(p.analysis.workspaceRoot).toBe('/tmp/g033-before/packages/quay/src');
    expect(p.slice.commit).toBe('1ac06fd85094a58d4954640811a787873f8ad2a1');
    expect(p.observed).not.toBeNull();
    // fixture workspaceRoot is not a git work tree → honestly not-checked
    expect(p.provenanceConsistency.status).toBe('not-checked');
    expect(p.provenanceConsistency.reason).toMatch(/git/);
  });

  it('reports provenance.observed === null when --observed is omitted', async () => {
    const r = await runSliceDelta({ slice: GOAL_SLICE, arch: GOAL_ARCH });
    if (r.report.status !== 'evaluated') throw new Error('expected evaluated');
    expect((r.report.provenance as any).observed).toBeNull();
  });
});

describe('archguard slice-delta — exit code 1 (guard triggered)', () => {
  it('an unrelated negative control is not falsifiable', async () => {
    const slice = writeSlice(
      'slice-unrelated.json',
      goal({ negativeControl: { restoreEdges: [{ from: 'kernel', to: 'ts-demo' }] } })
    );
    const r = await runSliceDelta({ slice, arch: GOAL_ARCH });
    expect(r.exitCode).toBe(1);
    if (r.report.status !== 'evaluated') throw new Error('expected evaluated');
    expect(r.report.negativeControl.falsified).toBe(false);
    expect(r.report.negativeControl.subjectBackInScc).toBe(false);
    expect(r.report.negativeControl.reason).toBeTruthy();
    expect(r.report.guards.clean).toBe(false);
  });

  it('a forbidden new edge triggers must-not-change', async () => {
    const slice = writeSlice(
      'slice-mnc.json',
      goal({
        proposedCut: {
          moves: [
            {
              file: 'cli/driver.ts',
              from: 'cli',
              to: 'fan-in',
              symbols: ['runDriver', 'ALL_SERVICE_NAMES', 'HOSTED_SERVICE_NAMES'],
            },
          ],
          consumers: [],
        },
      })
    );
    const r = await runSliceDelta({ slice, arch: GOAL_ARCH });
    expect(r.exitCode).toBe(1);
    if (r.report.status !== 'evaluated') throw new Error('expected evaluated');
    expect(r.report.mustNotChange.violations.length).toBeGreaterThan(0);
    expect(
      r.report.mustNotChange.violations.some(
        (v) => v.kind === 'forbidden-new-edge' && v.edge === ' -> fan-in'
      )
    ).toBe(true);
  });
});

describe('archguard slice-delta — exit code 2 (not evaluated)', () => {
  it('missing negative control', async () => {
    const slice = writeSlice('slice-no-negctl.json', {
      subject: '',
      proposedCut: {
        moves: [
          { file: 'alpha-main.ts', from: 'alpha', to: '', symbols: ['alphaMain', 'alphaHelper'] },
        ],
        consumers: [],
      },
    });
    const r = await runSliceDelta({ slice, arch: SYNTH_ARCH });
    expect(r.exitCode).toBe(2);
    expect(r.report.status).toBe('not-evaluated');
    if (r.report.status !== 'not-evaluated') return;
    expect(r.report.reason).toMatch(/negative control/);
  });

  it('coverage shortfall names the uncovered symbol', async () => {
    const slice = writeSlice(
      'slice-partial.json',
      synSlice({
        proposedCut: {
          moves: [{ file: 'alpha-main.ts', from: 'alpha', to: '', symbols: ['alphaMain'] }],
          consumers: [],
        },
      })
    );
    const r = await runSliceDelta({ slice, arch: SYNTH_ARCH });
    expect(r.exitCode).toBe(2);
    if (r.report.status !== 'not-evaluated') return;
    expect(r.report.reason).toContain('alphaHelper');
  });

  it('self-check failure (tampered SCC) is not-evaluated', async () => {
    const arch = readJson(SYNTH_ARCH);
    arch.extensions.tsAnalysis.moduleGraph.edges =
      arch.extensions.tsAnalysis.moduleGraph.edges.filter(
        (e: any) => !(e.from === 'beta' && e.to === '')
      );
    const archPath = writeSlice('syn-broken.arch.json', arch);
    const slice = writeSlice('syn-ok.json', synSlice());
    const r = await runSliceDelta({ slice, arch: archPath });
    expect(r.exitCode).toBe(2);
    if (r.report.status !== 'not-evaluated') return;
    expect(r.report.reason).toMatch(/自校验/);
  });

  it('an unresolvable scope is a hard not-evaluated (never an empty graph)', async () => {
    const r = await runSliceDelta({ slice: GOAL_SLICE, projectRoot: path.join(TMP, 'nope') });
    expect(r.exitCode).toBe(2);
    if (r.report.status !== 'not-evaluated') return;
    expect(r.report.reason).toMatch(/analyze|解析|moduleGraph/);
  });

  it('missing --slice is not-evaluated, not a throw', async () => {
    const r = await runSliceDelta({ arch: GOAL_ARCH });
    expect(r.exitCode).toBe(2);
    expect(r.report.status).toBe('not-evaluated');
  });
});

describe('archguard slice-delta — field boundaries', () => {
  it('the report has no pass / fail / exitCode field names', async () => {
    const r = await runSliceDelta({ slice: GOAL_SLICE, arch: GOAL_ARCH, observed: GOAL_OBSERVED });
    const keys = new Set<string>();
    const walk = (o: unknown): void => {
      if (!o || typeof o !== 'object') return;
      for (const k of Object.keys(o as Record<string, unknown>)) {
        keys.add(k);
        walk((o as Record<string, unknown>)[k]);
      }
    };
    walk(r.report);
    expect(keys.has('pass')).toBe(false);
    expect(keys.has('fail')).toBe(false);
    expect(keys.has('passed')).toBe(false);
    expect(keys.has('exitCode')).toBe(false);
  });
});

const CC_ARCH = path.join(FIX, 'claudecodeui-frontend.arch.json');
const CC_SLICE = path.join(FIX, 'claudecodeui-readdevicename-slice.json');

describe('archguard slice-delta — claudecodeui real fixture (partial migration)', () => {
  it('AC1/AC9: with stays the real single-symbol cut is evaluated end-to-end', async () => {
    const r = await runSliceDelta({ slice: CC_SLICE, arch: CC_ARCH });
    expect(r.report.status).toBe('evaluated');
    if (r.report.status !== 'evaluated') return;
    expect(r.report.current.sccSize).toBe(42);
    expect(r.report.computedDelta.removedEdges).toHaveLength(1);
    expect(r.report.computedDelta.removedEdges[0]).toMatchObject({
      from: 'shared/context',
      to: 'modules/settings',
      becomes: 'retargeted-to:shared',
    });
    expect(r.report.accounting?.length).toBeGreaterThanOrEqual(3);
    expect(r.report.unknowns?.unevaluatedDynamicImports).toBe(2);
    // Honest reading: this cut does NOT shrink the real 42-member cycle (the two
    // surviving edges keep it), so the declared negative control has nothing to
    // falsify. The report is `evaluated`; the guard is tripped → exit 1. DoD #4
    // forbids loosening the fail-closed guard just to force a green exit 0.
    expect(r.report.guards.clean).toBe(false);
    expect(r.exitCode).toBe(1);
  });

  it('AC4: without stays the same cut is not-evaluated, exit 2', async () => {
    const base = readJson(CC_SLICE);
    const noStays = writeSlice('cc-nostays.json', {
      ...base,
      proposedCut: { moves: base.proposedCut.moves, consumers: [] },
    });
    const r = await runSliceDelta({ slice: noStays, arch: CC_ARCH });
    expect(r.exitCode).toBe(2);
    if (r.report.status !== 'not-evaluated') return;
    expect(r.report.reason).toContain('modules/settings -> modules/settings/hooks');
    expect(r.report.reason).toContain('readDeviceName');
  });

  it('AC10: the real 137-node / 549-edge graph evaluates comfortably under 5s', async () => {
    const t0 = Date.now();
    const r = await runSliceDelta({ slice: CC_SLICE, arch: CC_ARCH });
    const ms = Date.now() - t0;
    expect(r.report.status).toBe('evaluated');
    expect(ms).toBeLessThan(5000);
  });
});

describe('buildSliceDeltaProvenance — git consistency three-state', () => {
  it('not-checked when no commit is declared', () => {
    const p = buildSliceDeltaProvenance({
      analysisSource: 'a.json',
      workspaceRoot: null,
      timestamp: null,
      language: 'typescript',
      sliceSource: 's.json',
      observed: null,
      observedSource: null,
      gitRoot: null,
    }) as any;
    expect(p.provenanceConsistency.status).toBe('not-checked');
    expect(p.tool.archguardVersion).toBe(PKG_VERSION);
  });

  it('match / mismatch on a real git work tree', () => {
    const head = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).stdout.trim();
    const base = {
      analysisSource: 'a.json',
      workspaceRoot: REPO_ROOT,
      timestamp: null,
      language: 'typescript',
      sliceSource: 's.json',
      observed: null,
      observedSource: null,
      gitRoot: REPO_ROOT,
    };
    expect(
      (buildSliceDeltaProvenance({ ...base, sliceProvenance: { commit: head } }) as any)
        .provenanceConsistency.status
    ).toBe('match');
    expect(
      (buildSliceDeltaProvenance({ ...base, sliceProvenance: { commit: '0'.repeat(40) } }) as any)
        .provenanceConsistency.status
    ).toBe('mismatch');
  });
});
