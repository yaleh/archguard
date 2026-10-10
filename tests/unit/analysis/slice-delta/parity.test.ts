/**
 * Parity test: the migrated library must match the FROZEN prototype on the same
 * input. This is the key evidence that the semantics were *migrated*, not rewritten
 * (DoD #1). The prototype is invoked as a subprocess; the library runs in-process.
 *
 * Comparison surface, per the frozen prototype's own fields:
 *   - computedDelta   — every prototype key must deep-equal
 *   - negativeControl — every prototype key must deep-equal
 *   - sccAfter        — must deep-equal
 * The library is allowed exactly ONE extra computedDelta key (`strengthenedEdges`,
 * spec §2.6 — the prototype silently dropped pre-existing edges) and ONE extra
 * negativeControl key (`reason`). Anything else diverging reds this test.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateRefactorSlice } from '@/analysis/slice-delta/index.js';
import type { RefactorSliceDeclaration } from '@/analysis/slice-delta/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'docs', 'experiments', 'layer-map', 'slice-delta.mjs');
const FIX = path.join(REPO_ROOT, 'tests', 'fixtures', 'slice-delta');

const GOAL_ARCH = path.join(FIX, 'goal-033-fork-point.arch.json');
const GOAL_SLICE = path.join(FIX, 'goal-033-slice.json');
const GOAL_OBSERVED = path.join(FIX, 'goal-033-observed.json');
const SYNTH_ARCH = path.join(FIX, 'synthetic-small.arch.json');

const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, 'utf8'));

let TMP = '';
beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'slice-delta-parity-'));
});
afterAll(() => {
  if (TMP) fs.rmSync(TMP, { recursive: true, force: true });
});

function runPrototype(arch: string, slice: string, observed?: string): any {
  const out = path.join(TMP, `proto-${Math.random().toString(36).slice(2)}.json`);
  const args = [SCRIPT, arch, '--slice', slice];
  if (observed) args.push('--observed', observed);
  args.push('--json', out);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  expect(r.status).toBe(0);
  return readJson(out);
}

function assertParity(protoReport: any, libReport: any): void {
  expect(libReport.status).toBe('evaluated');
  if (libReport.status !== 'evaluated') return;

  // computedDelta — all prototype keys deep-equal
  const protoComputedKeys = Object.keys(protoReport.computedDelta);
  const computedProjection = Object.fromEntries(
    protoComputedKeys.map((k) => [k, libReport.computedDelta[k]])
  );
  expect(computedProjection).toEqual(protoReport.computedDelta);
  const extraComputed = Object.keys(libReport.computedDelta).filter(
    (k) => !protoComputedKeys.includes(k)
  );
  expect(extraComputed).toEqual(['strengthenedEdges']);

  // negativeControl — all prototype keys deep-equal
  const protoNegKeys = Object.keys(protoReport.negativeControl);
  const negProjection = Object.fromEntries(
    protoNegKeys.map((k) => [k, libReport.negativeControl[k]])
  );
  expect(negProjection).toEqual(protoReport.negativeControl);
  const extraNeg = Object.keys(libReport.negativeControl).filter((k) => !protoNegKeys.includes(k));
  expect(extraNeg).toEqual(['reason']);

  // sccAfter
  expect(libReport.computedDelta.sccAfter).toEqual(protoReport.computedDelta.sccAfter);
}

describe('slice-delta parity — library vs frozen prototype', () => {
  it('GOAL-033 fixture: computedDelta / negativeControl / sccAfter agree', () => {
    const proto = runPrototype(GOAL_ARCH, GOAL_SLICE, GOAL_OBSERVED);
    const arch = readJson(GOAL_ARCH);
    const lib = simulateRefactorSlice({
      graph: arch.extensions.tsAnalysis.moduleGraph,
      slice: readJson(GOAL_SLICE) as RefactorSliceDeclaration,
      observed: readJson(GOAL_OBSERVED),
    });
    assertParity(proto, lib);
  });

  it('GOAL-033 fixture without observed: computedDelta / negativeControl agree', () => {
    const proto = runPrototype(GOAL_ARCH, GOAL_SLICE);
    const arch = readJson(GOAL_ARCH);
    const lib = simulateRefactorSlice({
      graph: arch.extensions.tsAnalysis.moduleGraph,
      slice: readJson(GOAL_SLICE) as RefactorSliceDeclaration,
    });
    assertParity(proto, lib);
  });

  it('synthetic-small fixture: computedDelta / negativeControl / sccAfter agree', () => {
    const slicePath = path.join(TMP, 'syn-slice.json');
    fs.writeFileSync(
      slicePath,
      JSON.stringify({
        subject: '',
        concern: 'synthetic-small',
        proposedCut: {
          moves: [
            { file: 'alpha-main.ts', from: 'alpha', to: '', symbols: ['alphaMain', 'alphaHelper'] },
          ],
          consumers: [],
        },
        negativeControl: {
          description: 'restore the only cycle edge',
          restoreEdges: [{ from: '', to: 'alpha' }],
        },
      })
    );
    const proto = runPrototype(SYNTH_ARCH, slicePath);
    const lib = simulateRefactorSlice({
      graph: readJson(SYNTH_ARCH).extensions.tsAnalysis.moduleGraph,
      slice: readJson(slicePath) as RefactorSliceDeclaration,
    });
    assertParity(proto, lib);
  });
});
