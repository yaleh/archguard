/**
 * Unit tests for the pure core `simulateRefactorSlice`.
 *
 * These lock in the semantics migrated from the frozen prototype
 * (`docs/experiments/layer-map/slice-delta.mjs`): the fail-closed behaviour
 * (self-check, coverage shortfall, missing negative control), the negative
 * control criterion relative to the before-SCC, and the physical partitioning
 * of computed vs observed readings (anti-stuffing).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateRefactorSlice } from '@/analysis/slice-delta/index.js';
import type { RefactorSliceDeclaration } from '@/analysis/slice-delta/index.js';
import type { TsModuleGraph } from '@/types/extensions/ts-analysis.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const FIX = path.join(REPO_ROOT, 'tests', 'fixtures', 'slice-delta');

const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, 'utf8'));

const goalArch = readJson(path.join(FIX, 'goal-033-fork-point.arch.json'));
const goalSlice = readJson(path.join(FIX, 'goal-033-slice.json')) as RefactorSliceDeclaration;
const goalObserved = readJson(path.join(FIX, 'goal-033-observed.json'));
const goalGraph = goalArch.extensions.tsAnalysis.moduleGraph as TsModuleGraph;

const synthArch = readJson(path.join(FIX, 'synthetic-small.arch.json'));
const synthGraph = synthArch.extensions.tsAnalysis.moduleGraph as TsModuleGraph;

const SYN_MOVES = [
  { file: 'alpha-main.ts', from: 'alpha', to: '', symbols: ['alphaMain', 'alphaHelper'] },
];
const synSlice = (over: Record<string, unknown> = {}): RefactorSliceDeclaration =>
  ({
    subject: '',
    concern: 'synthetic-small',
    proposedCut: { moves: SYN_MOVES, consumers: [] },
    negativeControl: {
      description: 'restore the only cycle edge',
      restoreEdges: [{ from: '', to: 'alpha' }],
    },
    ...over,
  }) as RefactorSliceDeclaration;

// ── GOAL-033 dogfood ──────────────────────────────────────────────────────────

describe('simulateRefactorSlice — GOAL-033 dogfood', () => {
  const report = simulateRefactorSlice({
    graph: goalGraph,
    slice: goalSlice,
    observed: goalObserved,
  });

  it('computes 6 → 4, fan-in leaving with cli', () => {
    expect(report.status).toBe('evaluated');
    if (report.status !== 'evaluated') return;
    expect(report.current.sccSize).toBe(6);
    expect(report.current.sccMembers).toEqual(
      expect.arrayContaining(['', 'cli', 'fan-in', 'gate', 'gate/config', 'gate/factories'])
    );
    expect(report.subject).toBe('');

    expect(report.computedDelta.sccAfter).toEqual(['', 'gate', 'gate/config', 'gate/factories']);
    expect(report.computedDelta.sccAfter).not.toContain('cli');
    expect(report.computedDelta.sccAfter).not.toContain('fan-in');
    expect([...report.computedDelta.sccLeft].sort()).toEqual(['cli', 'fan-in']);
  });

  it('removes exactly "" -> cli and adds nothing -> fan-in', () => {
    expect(report.status).toBe('evaluated');
    if (report.status !== 'evaluated') return;
    expect(report.computedDelta.removedEdges).toHaveLength(1);
    expect(report.computedDelta.removedEdges[0].from).toBe('');
    expect(report.computedDelta.removedEdges[0].to).toBe('cli');
    expect(report.computedDelta.addedEdges.filter((a) => a.to === 'fan-in')).toEqual([]);
    // No edge newly created: the declared consumers' cli -> "" edge already exists.
    expect(report.computedDelta.addedEdges).toEqual([]);
    expect(report.guards.clean).toBe(true);
  });

  it('records the pre-existing edge the cut touches as strengthened (not silently dropped)', () => {
    expect(report.status).toBe('evaluated');
    if (report.status !== 'evaluated') return;
    const strengthened = report.computedDelta.strengthenedEdges;
    expect(strengthened.some((s) => s.from === 'cli' && s.to === '')).toBe(true);
    for (const s of strengthened) {
      expect(s.effect).toBe('strengthens-existing-edge');
      expect(s.strength).toBeNull();
      expect(s.note).toMatch(/强度|增量|定位/);
    }
  });

  it('derives why-left from recomputed reachability', () => {
    expect(report.status).toBe('evaluated');
    if (report.status !== 'evaluated') return;
    const fanIn = report.computedDelta.whyLeft.find((w) => w.dir === 'fan-in');
    expect(fanIn).toBeDefined();
    expect(fanIn.inEdgeSourcesBefore).toEqual(['cli']);
    expect(fanIn.inEdgeSourcesAfter).toEqual(['cli']);
    expect(fanIn.inCycleAfter).toBe(false);
    expect(fanIn.reason).toContain('cli');
  });

  it('keeps declared / computed / observed as three independent readings', () => {
    expect(report.status).toBe('evaluated');
    if (report.status !== 'evaluated') return;
    expect(report.negativeControl.falsified).toBe(true);
    expect(report.negativeControl.reason).toBeNull();
    expect(report.declaredPrediction?.sccSize).toBe(5);
    expect(report.predictionComparison.declaredVsComputed?.relation).toBe('diverges');
    expect(report.predictionComparison.observedVsComputed?.relation).toBe('agrees');
  });

  it('carries computedDelta.inputsUsed honestly', () => {
    expect(report.status).toBe('evaluated');
    if (report.status !== 'evaluated') return;
    expect(report.computedDelta.inputsUsed).toEqual([
      'extensions.tsAnalysis.moduleGraph',
      'slice.proposedCut',
      'slice.mustNotChange',
      'slice.negativeControl',
    ]);
  });
});

// ── anti-stuffing ─────────────────────────────────────────────────────────────

describe('simulateRefactorSlice — anti-stuffing (observed never feeds computed)', () => {
  const withReal = simulateRefactorSlice({
    graph: goalGraph,
    slice: goalSlice,
    observed: goalObserved,
  });
  const withTampered = simulateRefactorSlice({
    graph: goalGraph,
    slice: goalSlice,
    observed: { sccSize: 999, sccMembers: ['nope'] },
  });
  const without = simulateRefactorSlice({ graph: goalGraph, slice: goalSlice });

  it('computedDelta and negativeControl are byte-identical across all three observed variants', () => {
    for (const r of [withReal, withTampered, without]) expect(r.status).toBe('evaluated');
    const a = withReal as any;
    const b = withTampered as any;
    const c = without as any;
    expect(JSON.stringify(b.computedDelta)).toBe(JSON.stringify(a.computedDelta));
    expect(JSON.stringify(c.computedDelta)).toBe(JSON.stringify(a.computedDelta));
    expect(JSON.stringify(b.negativeControl)).toBe(JSON.stringify(a.negativeControl));
    expect(JSON.stringify(c.negativeControl)).toBe(JSON.stringify(a.negativeControl));
  });

  it('the difference lands only in observedDelta / predictionComparison', () => {
    expect((withTampered as any).observedDelta.sccSize).toBe(999);
    expect((withTampered as any).predictionComparison.observedVsComputed.relation).toBe('diverges');
    expect((without as any).observedDelta).toBeNull();
    expect((without as any).predictionComparison.observedVsComputed).toBeNull();
  });
});

// ── negative control: relative to the before-SCC ──────────────────────────────

describe('simulateRefactorSlice — negative control', () => {
  it('falsified := sccLeft non-empty && restored membership equals before', () => {
    const r = simulateRefactorSlice({ graph: goalGraph, slice: goalSlice });
    expect(r.status).toBe('evaluated');
    if (r.status !== 'evaluated') return;
    const { sccLeft } = r.computedDelta;
    const expected = sccLeft.length > 0 && r.negativeControl.restoresBeforeMembership;
    expect(r.negativeControl.falsified).toBe(expected);
  });

  it('a cut that does NOT change the SCC is not misjudged falsifiable', () => {
    // subject "" is in a real size-2 cycle ('' ⇄ p); the cut removes p -> q, an
    // edge that does not touch that cycle. sccLeft is empty, so the control can
    // not be falsified — even though subject IS in a size>1 cycle.
    const graph: TsModuleGraph = {
      nodes: [
        { id: '', name: '(root)', type: 'internal', fileCount: 1, stats: zeroStats() },
        { id: 'p', name: 'p', type: 'internal', fileCount: 1, stats: zeroStats() },
        { id: 'q', name: 'q', type: 'internal', fileCount: 1, stats: zeroStats() },
      ],
      edges: [edge('', 'p', ['pEntry']), edge('p', '', ['rootUtil']), edge('p', 'q', ['qOne'])],
      cycles: [{ modules: ['', 'p'], severity: 'error' }],
    };
    const slice: RefactorSliceDeclaration = {
      subject: '',
      proposedCut: { moves: [{ from: 'q', to: '', symbols: ['qOne'] }] },
      negativeControl: { restoreEdges: [{ from: '', to: 'p' }] },
    };
    const r = simulateRefactorSlice({ graph, slice });
    expect(r.status).toBe('evaluated');
    if (r.status !== 'evaluated') return;
    expect(r.current.sccSize).toBe(2);
    expect(r.computedDelta.sccLeft).toEqual([]);
    expect(r.negativeControl.falsified).toBe(false);
    expect(r.negativeControl.reason).toBeTruthy();
    expect(r.negativeControl.reason).toMatch(/sccLeft|环/);
  });
});

// ── fail-closed: not-evaluated, never "best effort" ───────────────────────────

describe('simulateRefactorSlice — fail-closed', () => {
  it('self-check failure (recomputed SCC ≠ cycles) → not-evaluated, no partial delta', () => {
    const graph: TsModuleGraph = JSON.parse(JSON.stringify(synthGraph));
    graph.edges = graph.edges.filter((e) => !(e.from === 'beta' && e.to === ''));
    const r = simulateRefactorSlice({ graph, slice: synSlice() });
    expect(r.status).toBe('not-evaluated');
    if (r.status !== 'not-evaluated') return;
    expect(r.reason).toMatch(/自校验/);
    expect((r as any).computedDelta).toBeUndefined();
  });

  it('coverage shortfall names the edge and the uncovered symbols', () => {
    const slice = synSlice({
      proposedCut: {
        moves: [{ file: 'alpha-main.ts', from: 'alpha', to: '', symbols: ['alphaMain'] }],
        consumers: [],
      },
    });
    const r = simulateRefactorSlice({ graph: synthGraph, slice });
    expect(r.status).toBe('not-evaluated');
    if (r.status !== 'not-evaluated') return;
    expect(r.reason).toContain('alphaHelper');
    expect(r.reason).toMatch(/-> alpha/);
  });

  it('missing negative control → not-evaluated (mechanically enforced)', () => {
    const slice = {
      subject: '',
      proposedCut: { moves: SYN_MOVES, consumers: [] },
    } as RefactorSliceDeclaration;
    const r = simulateRefactorSlice({ graph: synthGraph, slice });
    expect(r.status).toBe('not-evaluated');
    if (r.status !== 'not-evaluated') return;
    expect(r.reason).toMatch(/negative control/);
  });

  it('empty cycles with a genuinely acyclic graph passes the self-check', () => {
    const graph: TsModuleGraph = {
      nodes: [
        { id: '', name: '(root)', type: 'internal', fileCount: 1, stats: zeroStats() },
        { id: 'a', name: 'a', type: 'internal', fileCount: 1, stats: zeroStats() },
        { id: 'b', name: 'b', type: 'internal', fileCount: 1, stats: zeroStats() },
      ],
      edges: [edge('', 'a', ['x']), edge('a', 'b', ['y'])],
      cycles: [],
    };
    const r = simulateRefactorSlice({
      graph,
      slice: {
        subject: '',
        proposedCut: { moves: [{ from: 'b', to: 'a', symbols: ['y'] }] },
        negativeControl: { restoreEdges: [{ from: 'a', to: '' }] },
      },
    });
    // recomputed SCCs == [] == cycles ⇒ the self-check must NOT fire.
    expect(r.status).toBe('evaluated');
    if (r.status !== 'evaluated') return;
    expect(r.current.sccSize).toBe(1);
  });

  it('positive case on the synthetic graph → evaluated', () => {
    const r = simulateRefactorSlice({ graph: synthGraph, slice: synSlice() });
    expect(r.status).toBe('evaluated');
    if (r.status !== 'evaluated') return;
    expect(r.current.sccMembers).toEqual(['', 'alpha', 'beta']);
    expect(r.computedDelta.sccAfter).toEqual(['']);
    expect([...r.computedDelta.sccLeft].sort()).toEqual(['alpha', 'beta']);
    expect(r.negativeControl.falsified).toBe(true);
  });
});

// ── report field boundaries ───────────────────────────────────────────────────

describe('simulateRefactorSlice — field boundaries', () => {
  it('produces no pass / fail / exitCode field names anywhere', () => {
    const r = simulateRefactorSlice({ graph: goalGraph, slice: goalSlice, observed: goalObserved });
    const keys = new Set<string>();
    const walk = (o: unknown): void => {
      if (!o || typeof o !== 'object') return;
      for (const k of Object.keys(o as Record<string, unknown>)) {
        keys.add(k);
        walk((o as Record<string, unknown>)[k]);
      }
    };
    walk(r);
    expect(keys.has('pass')).toBe(false);
    expect(keys.has('fail')).toBe(false);
    expect(keys.has('passed')).toBe(false);
    expect(keys.has('exitCode')).toBe(false);
    expect(['evaluated', 'not-evaluated']).toContain((r as any).status);
  });

  it('injects caller-supplied provenance verbatim and never reads the environment', () => {
    const provenance = { analysis: { source: 'x' }, tool: { archguardVersion: '9.9.9' } };
    const r = simulateRefactorSlice({ graph: goalGraph, slice: goalSlice, provenance });
    expect(r.status).toBe('evaluated');
    if (r.status !== 'evaluated') return;
    expect(r.provenance).toEqual(provenance);
  });
});

// ── src must not depend on the experiment path ────────────────────────────────

describe('src does not import the frozen experiment path', () => {
  it('no file under src/ references docs/experiments', () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full);
        else if (
          name.endsWith('.ts') &&
          fs.readFileSync(full, 'utf8').includes('docs/experiments')
        ) {
          hits.push(path.relative(REPO_ROOT, full));
        }
      }
    };
    walk(path.join(REPO_ROOT, 'src'));
    expect(hits).toEqual([]);
  });
});

// ── claudecodeui real fixture: symbol-level partial migration ─────────────────

const ccArch = readJson(path.join(FIX, 'claudecodeui-frontend.arch.json'));
const ccGraph = ccArch.extensions.tsAnalysis.moduleGraph as TsModuleGraph;
const ccSlice = readJson(
  path.join(FIX, 'claudecodeui-readdevicename-slice.json')
) as RefactorSliceDeclaration;
const ccNoStays: RefactorSliceDeclaration = {
  ...ccSlice,
  proposedCut: { moves: ccSlice.proposedCut.moves, consumers: [] },
};
const STAYS_5 = [
  'readMcpNavigationPolicy',
  'writeMcpNavigationPolicy',
  'McpNavigationPolicy',
  'useSettingsController',
  'useWebPush',
];
/** Proposal §1, rejection #1 — the exact sentence the pre-change tool emitted (a prefix). */
const PROPOSAL_QUOTE_1 =
  '切法覆盖不足：边 modules/settings -> modules/settings/hooks 的 importedNames=[' +
  'readDeviceName, readMcpNavigationPolicy, writeMcpNavigationPolicy, McpNavigationPolicy, useSettingsController, useWebPush' +
  '] 中 [readMcpNavigationPolicy, writeMcpNavigationPolicy, McpNavigationPolicy, useSettingsController, useWebPush] 未被任何 move 的 symbols 覆盖';

describe('claudecodeui real fixture — symbol-level partial migration', () => {
  it('AC1 baseline: the single-symbol cut WITHOUT stays reproduces the Proposal reason verbatim', () => {
    const r = simulateRefactorSlice({ graph: ccGraph, slice: ccNoStays });
    expect(r.status).toBe('not-evaluated');
    if (r.status !== 'not-evaluated') return;
    expect(r.reason.startsWith(PROPOSAL_QUOTE_1)).toBe(true);
    expect(r.reason).toBe(
      `${PROPOSAL_QUOTE_1} —— 目录粒度上无法判断这条边是否随搬迁消失，本实现不猜`
    );
  });

  it('AC1/AC2: adding the stays clause flips the SAME cut to evaluated (was not-evaluated)', () => {
    const r = simulateRefactorSlice({ graph: ccGraph, slice: ccSlice });
    expect(r.status).toBe('evaluated');
    if (r.status !== 'evaluated') return;
    expect(r.subject).toBe('modules/settings');
  });

  it('AC2: shared/context -> modules/settings is removed and retargeted to shared', () => {
    const r = simulateRefactorSlice({ graph: ccGraph, slice: ccSlice });
    if (r.status !== 'evaluated') throw new Error('expected evaluated');
    const removed = r.computedDelta.removedEdges.find(
      (e) => e.from === 'shared/context' && e.to === 'modules/settings'
    );
    expect(removed).toBeDefined();
    expect(removed?.becomes).toBe('retargeted-to:shared');
    expect(removed?.importedNames).toEqual(['readDeviceName']);
    const retargets = [
      ...r.computedDelta.addedEdges.map((a) => `${a.from} -> ${a.to}`),
      ...r.computedDelta.strengthenedEdges.map((s) => `${s.from} -> ${s.to}`),
    ];
    expect(retargets).toContain('shared/context -> shared');
  });

  it('AC2: modules/settings -> modules/settings/hooks SURVIVES with all 5 staying names, unaccounted empty', () => {
    const r = simulateRefactorSlice({ graph: ccGraph, slice: ccSlice });
    if (r.status !== 'evaluated') throw new Error('expected evaluated');
    const key = 'modules/settings -> modules/settings/hooks';
    expect(r.computedDelta.removedEdges.map((e) => `${e.from} -> ${e.to}`)).not.toContain(key);
    const entry = (r.accounting ?? []).find((a) => a.edge === key);
    expect(entry).toBeDefined();
    expect(entry?.staying.slice().sort()).toEqual([...STAYS_5].sort());
    expect(entry?.unaccounted).toEqual([]);
    expect(entry?.moving).toEqual([{ name: 'readDeviceName', to: 'shared' }]);
    // DoD #3: the surviving edge's strength increment is not computed — always null.
    expect(entry?.survives).toBe(true);
    expect(entry?.strength).toBeNull();
    expect(typeof entry?.note).toBe('string');
  });

  it('AC4: fail-closed is NOT weakened — the no-stays cut still names all 5 uncovered symbols', () => {
    const r = simulateRefactorSlice({ graph: ccGraph, slice: ccNoStays });
    if (r.status !== 'not-evaluated') throw new Error('expected not-evaluated');
    for (const name of STAYS_5) expect(r.reason).toContain(name);
    expect(r.reason).toMatch(/modules\/settings -> modules\/settings\/hooks/);
  });

  it('AC7: unknowns section is present and never feeds the delta', () => {
    const r = simulateRefactorSlice({ graph: ccGraph, slice: ccSlice });
    if (r.status !== 'evaluated') throw new Error('expected evaluated');
    expect(r.unknowns).toBeDefined();
    expect(r.unknowns?.unevaluatedDynamicImports).toBe(2);
    expect(r.unknowns?.unresolvedAliasRefs.some((u) => u.from === 'modules/chat/audio')).toBe(true);
    expect(r.unknowns?.barrelEdges).toEqual(
      expect.arrayContaining([
        'modules/chat/hooks -> modules/settings',
        'shared/context -> modules/settings',
      ])
    );
    // None of the unknown refs is in an added/removed edge's name list.
    const deltaStrings = JSON.stringify(r.computedDelta);
    expect(deltaStrings).not.toContain('voiceFrameProcessor');
  });

  it('AC7: a cut FROM modules/settings misses the real modules/chat/hooks consumer', () => {
    const slice: RefactorSliceDeclaration = {
      subject: 'modules/settings',
      proposedCut: {
        moves: [{ from: 'modules/settings', to: 'shared', symbols: ['readDeviceName'] }],
        consumers: [],
      },
      negativeControl: { restoreEdges: [{ from: 'shared/context', to: 'modules/settings' }] },
    };
    const r = simulateRefactorSlice({ graph: ccGraph, slice });
    expect(r.status).toBe('not-evaluated');
    if (r.status !== 'not-evaluated') return;
    expect(r.reason).toContain('modules/chat/hooks -> modules/settings');
    expect(r.reason).toContain('readMcpNavigationPolicy');
    expect(r.reason).toContain('writeMcpNavigationPolicy');
  });

  it('AC8: barrel/re-export edges carry certainty=unknown; deterministic edges omit it', () => {
    const r = simulateRefactorSlice({ graph: ccGraph, slice: ccSlice });
    if (r.status !== 'evaluated') throw new Error('expected evaluated');
    const removed = r.computedDelta.removedEdges.find((e) => e.to === 'modules/settings');
    expect(removed?.certainty).toBe('unknown'); // barrel edge
    const byEdge = new Map((r.accounting ?? []).map((a) => [a.edge, a]));
    expect(byEdge.get('shared/context -> modules/settings')?.certainty).toBe('unknown');
    expect(byEdge.get('modules/settings -> modules/settings/hooks')?.certainty).toBe(
      'deterministic'
    );
  });

  it('AC9: a file-path subject normalizes to its containing internal dir', () => {
    const r = simulateRefactorSlice({
      graph: ccGraph,
      slice: { ...ccSlice, subject: 'modules/settings/hooks/useMcpNavigationSettings.ts' },
    });
    expect(r.status).toBe('evaluated');
    if (r.status !== 'evaluated') return;
    expect(r.subject).toBe('modules/settings/hooks');
  });

  it('AC9: a subject that is neither a node nor a resolvable path is not-evaluated (never silently emptied)', () => {
    const r = simulateRefactorSlice({
      graph: ccGraph,
      slice: { ...ccSlice, subject: 'does/not/exist.ts' },
    });
    expect(r.status).toBe('not-evaluated');
    if (r.status !== 'not-evaluated') return;
    expect(r.reason).toMatch(/不静默取空|文件路径/);
  });

  it('AC11: the real-fixture report still has no pass / fail / exitCode field names', () => {
    const r = simulateRefactorSlice({ graph: ccGraph, slice: ccSlice });
    const keys = new Set<string>();
    const walk = (o: unknown): void => {
      if (!o || typeof o !== 'object') return;
      for (const k of Object.keys(o as Record<string, unknown>)) {
        keys.add(k);
        walk((o as Record<string, unknown>)[k]);
      }
    };
    walk(r);
    expect(keys.has('pass')).toBe(false);
    expect(keys.has('fail')).toBe(false);
    expect(keys.has('exitCode')).toBe(false);
  });
});

// ── additive-only compatibility for a plain (no-stays) cut ────────────────────

describe('additive-only: a plain cut report is unchanged in shape', () => {
  it('GOAL-033 (no stays) emits NEITHER accounting NOR unknowns, and no proposedCut.stays', () => {
    const r = simulateRefactorSlice({ graph: goalGraph, slice: goalSlice, observed: goalObserved });
    expect(r.status).toBe('evaluated');
    if (r.status !== 'evaluated') return;
    expect(Object.prototype.hasOwnProperty.call(r, 'accounting')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(r, 'unknowns')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(r.proposedCut, 'stays')).toBe(false);
    // core sections unchanged (6 → 4, one removed edge, guard clean)
    expect(r.current.sccSize).toBe(6);
    expect(r.computedDelta.sccAfter).toEqual(['', 'gate', 'gate/config', 'gate/factories']);
    expect(r.computedDelta.removedEdges).toHaveLength(1);
    expect(r.computedDelta.addedEdges).toEqual([]);
    expect(r.guards.clean).toBe(true);
  });

  it('a stays-carrying cut adds exactly the two new sections + proposedCut.stays', () => {
    const r = simulateRefactorSlice({ graph: ccGraph, slice: ccSlice });
    if (r.status !== 'evaluated') throw new Error('expected evaluated');
    expect(Array.isArray(r.accounting)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(r, 'unknowns')).toBe(true);
    expect(r.proposedCut.stays).toEqual(ccSlice.proposedCut.stays);
  });
});

// ── partial-migration vocabulary cases (synthetic) ────────────────────────────

const pm = readJson(path.join(FIX, 'partial-migration-cases.json'));
const pmGraph = pm.graph as TsModuleGraph;
const pmCase = (name: string): RefactorSliceDeclaration =>
  pm.cases[name].slice as RefactorSliceDeclaration;

describe('partial-migration vocabulary', () => {
  it('AC6: one edge declared to two different destinations is legal (evaluated)', () => {
    const r = simulateRefactorSlice({ graph: pmGraph, slice: pmCase('mixedDestinationsPositive') });
    expect(r.status).toBe('evaluated');
    if (r.status !== 'evaluated') return;
    const entry = (r.accounting ?? []).find(
      (a) => a.edge === pm.cases.mixedDestinationsPositive.expect.accountingEdge
    );
    expect(entry?.destinations.slice().sort()).toEqual(['c', 'd']);
    const added = r.computedDelta.addedEdges.map((a) => `${a.from} -> ${a.to}`);
    for (const e of pm.cases.mixedDestinationsPositive.expect.added) expect(added).toContain(e);
  });

  it('AC5: one symbol to two different destinations (two moves) is not-evaluated', () => {
    const r = simulateRefactorSlice({ graph: pmGraph, slice: pmCase('mixedDestinationsNegative') });
    expect(r.status).toBe('not-evaluated');
    if (r.status !== 'not-evaluated') return;
    expect(r.reason).toContain(pm.cases.mixedDestinationsNegative.expect.reasonContains);
  });

  it('AC5: a symbol both moved and declared staying is a destination conflict', () => {
    const r = simulateRefactorSlice({ graph: pmGraph, slice: pmCase('symbolMovedAndStayed') });
    expect(r.status).toBe('not-evaluated');
    if (r.status !== 'not-evaluated') return;
    expect(r.reason).toContain('目的地冲突');
  });

  it('AC5: from === to is not-evaluated and points at stays (not at "mixed destinations")', () => {
    const r = simulateRefactorSlice({ graph: pmGraph, slice: pmCase('fromEqualsTo') });
    expect(r.status).toBe('not-evaluated');
    if (r.status !== 'not-evaluated') return;
    expect(r.reason).toContain('proposedCut.stays');
    expect(r.reason).not.toContain('混合目的地');
  });

  it('AC7: a missed real consumer is not-evaluated, naming the edge and the uncovered name', () => {
    const c = pm.cases.missedConsumer;
    const r = simulateRefactorSlice({ graph: pmGraph, slice: pmCase('missedConsumer') });
    expect(r.status).toBe('not-evaluated');
    if (r.status !== 'not-evaluated') return;
    expect(r.reason).toContain(c.expect.reasonContains); // the "d -> a" edge (sourceDir d locatable)
    for (const n of c.expect.reasonNamesAll) expect(r.reason).toContain(n);
  });

  it('AC7: a NON-participating unresolved ref appears in unknowns (and does not block evaluation)', () => {
    const r = simulateRefactorSlice({ graph: pmGraph, slice: pmCase('mixedDestinationsPositive') });
    expect(r.status).toBe('evaluated');
    if (r.status !== 'evaluated') return;
    expect(r.unknowns?.unresolvedAliasRefs).toEqual([
      { from: 'b', specifier: '@/b/missing-thing' },
    ]);
    expect(r.unknowns?.unevaluatedDynamicImports).toBe(1);
  });

  it('AC7/NEW fail-closed: an unresolved ref whose `from` PARTICIPATES in the cut is not-evaluated', () => {
    const graph: TsModuleGraph = JSON.parse(JSON.stringify(pmGraph));
    graph.unresolved = [{ from: 'a', specifier: '@/a/missing-thing' }];
    const r = simulateRefactorSlice({ graph, slice: pmCase('mixedDestinationsPositive') });
    expect(r.status).toBe('not-evaluated');
    if (r.status !== 'not-evaluated') return;
    expect(r.reason).toMatch(/未解析别名/);
    expect(r.reason).toContain('@/a/missing-thing');
  });
});

function zeroStats(): { classes: number; interfaces: number; functions: number; enums: number } {
  return { classes: 0, interfaces: 0, functions: 0, enums: 0 };
}
function edge(from: string, to: string, importedNames: string[]) {
  return { from, to, strength: 1, typeOnlyStrength: 0, valueStrength: 1, importedNames };
}
