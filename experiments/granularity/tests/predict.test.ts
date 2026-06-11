import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  LEVELS,
  buildDerivabilityMatrix,
  buildPrediction,
  computeH0,
  computePGit,
  entityBase,
  isDerivable,
  normalizeTieToL3,
  requiredEdgeKind,
  runPredict,
  sha256OfFile,
  type DimensionEntry,
} from '../predict';
import type { Task } from '../tasks/schema';

const entityNames = new Set(['Xq7', 'Ma26', 'Rx34']);

const taskA: Task = {
  id: 'modA-highest-in-degree-1',
  taskClass: 'A',
  module: 'modA',
  taskType: 'highest-in-degree',
  prompt: 'pick one. {"answer": "name"}',
  entities: ['Ma26'],
  answerType: 'exact',
  answer: 'Ma26',
};
const taskB: Task = {
  id: 'modA-signature-change-impact-1',
  taskClass: 'B',
  module: 'modA',
  taskType: 'signature-change-impact',
  prompt: 'list callers. {"answer": ["x"]}',
  entities: ['Xq7.m1', 'Rx34'],
  answerType: 'set',
  answer: ['Rx34'],
  gtVariant: 'expanded',
};

function dims(values: Partial<Record<string, Partial<DimensionEntry>>>): Record<string, DimensionEntry> {
  const out: Record<string, DimensionEntry> = {};
  for (const [lvl, v] of Object.entries(values)) out[lvl] = { reliable: true, ...v };
  return out;
}

describe('derivability matrix (§6, mechanical)', () => {
  it('A-class tasks need entity relations: derivable L2..L5, not L0/L1', () => {
    expect(requiredEdgeKind(taskA)).toBe('entityRelations');
    expect(LEVELS.map((l) => isDerivable(taskA, l, entityNames))).toEqual([
      false, false, true, true, true, true,
    ]);
  });

  it('B-class tasks need call edges: derivable L3..L5 only', () => {
    expect(requiredEdgeKind(taskB)).toBe('callEdges');
    expect(LEVELS.map((l) => isDerivable(taskB, l, entityNames))).toEqual([
      false, false, false, true, true, true,
    ]);
  });

  it('member-qualified task entities are matched by their base entity', () => {
    expect(entityBase('Xq7.m1')).toBe('Xq7');
    expect(entityBase('Rx34')).toBe('Rx34');
  });

  it('a task naming an unknown entity is only derivable at L5 (full source)', () => {
    const ghost: Task = { ...taskA, id: 'ghost', entities: ['Zz99'] };
    expect(LEVELS.map((l) => isDerivable(ghost, l, entityNames))).toEqual([
      false, false, false, false, false, true,
    ]);
  });

  it('buildDerivabilityMatrix covers every task × level', () => {
    const matrix = buildDerivabilityMatrix([taskA, taskB], entityNames);
    expect(Object.keys(matrix)).toEqual([taskA.id, taskB.id]);
    expect(Object.keys(matrix[taskA.id]!)).toEqual([...LEVELS]);
  });
});

describe('H0 — coarsest structurally sufficient level', () => {
  it('picks the coarsest derivable level per task', () => {
    const matrix = buildDerivabilityMatrix([taskA, taskB], entityNames);
    expect(computeH0(matrix[taskA.id]!)).toBe('L2');
    expect(computeH0(matrix[taskB.id]!)).toBe('L3');
  });

  it('normalizes an L4-only row to L3 via the §3 tie rule', () => {
    const row = { L0: false, L1: false, L2: false, L3: false, L4: true, L5: true } as const;
    expect(computeH0({ ...row })).toBe('L3');
    expect(normalizeTieToL3('L4')).toBe('L3');
    expect(normalizeTieToL3('L2')).toBe('L2');
  });
});

describe('P_GIT boundary rules (§3, each pre-registered rule)', () => {
  const base = {
    L0: { twonn: 1 }, L1: { twonn: 2 }, L2: { twonn: 3 },
    L3: { twonn: 4 }, L4: { twonn: 4 }, L5: { twonn: 6 },
  };

  it('normal hit: first level with d_ℓ ≥ d_task', () => {
    const r = computePGit(2.5, dims(base));
    expect(r.level).toBe('L2');
    expect(r.fallbackToL5).toBe(false);
    expect(r.skippedUnreliable).toEqual([]);
  });

  it('non-monotone d sequence is scanned literally, no smoothing', () => {
    // d dips after L1; literal scan must still take L1, the FIRST satisfier
    const r = computePGit(4, dims({
      L0: { twonn: 1 }, L1: { twonn: 5 }, L2: { twonn: 2 },
      L3: { twonn: 3 }, L4: { twonn: 3 }, L5: { twonn: 6 },
    }));
    expect(r.level).toBe('L1');
  });

  it('no level satisfies d_ℓ ≥ d_task → fallback L5, flagged', () => {
    const r = computePGit(99, dims(base));
    expect(r.level).toBe('L5');
    expect(r.fallbackToL5).toBe(true);
    expect(r.scan.every((s) => s.satisfied === false)).toBe(true);
  });

  it('unreliable levels are skipped AND marked', () => {
    const r = computePGit(2.5, dims({ ...base, L2: { twonn: 3, reliable: false } }));
    expect(r.level).toBe('L3'); // L2 would satisfy but is unreliable
    expect(r.skippedUnreliable).toEqual(['L2']);
    expect(r.scan.find((s) => s.level === 'L2')).toMatchObject({ skipped: true, reliable: false });
  });

  it('a level missing its estimate is treated as unreliable (skipped + marked)', () => {
    const r = computePGit(2.5, dims({ ...base, L2: { twonn: undefined } }));
    expect(r.level).toBe('L3');
    expect(r.skippedUnreliable).toEqual(['L2']);
  });

  it('L3/L4 tie (information-equivalent, equal d) resolves to L3', () => {
    const r = computePGit(4, dims(base)); // d_L3 = d_L4 = 4 both satisfy
    expect(r.level).toBe('L3');
  });

  it('raw L4 pick (L3 unreliable) is normalized to L3 and flagged as a tie', () => {
    const r = computePGit(4, dims({ ...base, L3: { twonn: 4, reliable: false } }));
    expect(r.level).toBe('L3'); // normalized: L3 ≡ L4 (§3)
    expect(r.tieNormalizedToL3).toBe(true);
    expect(r.skippedUnreliable).toEqual(['L3']);
  });

  it('accepts d_task alias and flags unreliable d_task at the class level', () => {
    const out = buildPrediction({
      tasks: [taskA, taskB],
      dimensions: {
        levels: dims(base),
        tasks: { A: { d_task: 2.5 }, B: { twonn: 4, reliable: false } },
      },
      arch: { entities: [{ id: 'x', name: 'Xq7', type: 'class' }, { id: 'y', name: 'Ma26', type: 'interface' }, { id: 'z', name: 'Rx34', type: 'function' }], relations: [] },
      inputs: {},
    });
    const a = out.pGit['A']!;
    const b = out.pGit['B']!;
    expect('error' in a ? null : a.level).toBe('L2');
    expect('error' in b ? null : b.dTaskReliable).toBe(false);
  });
});

describe('prediction persistence (timestamp + input hashes)', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'predict-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('writes ISO timestamp and SHA-256 of every input file into the output', () => {
    const tasksPath = path.join(tmp, 'tasks.json');
    const dimsPath = path.join(tmp, 'dims.json');
    const archPath = path.join(__dirname, 'fixtures', 'levels', 'arch.fixture.json');
    writeFileSync(tasksPath, JSON.stringify([taskA, taskB]), 'utf8');
    writeFileSync(
      dimsPath,
      JSON.stringify({
        levels: dims({
          L0: { twonn: 1 }, L1: { twonn: 2 }, L2: { twonn: 3 },
          L3: { twonn: 4 }, L4: { twonn: 4 }, L5: { twonn: 6 },
        }),
        tasks: { A: { twonn: 2.5 }, B: { twonn: 4 } },
      }),
      'utf8'
    );
    const now = new Date('2026-06-11T12:00:00.000Z');
    const { outPath, output } = runPredict({
      tasksPath,
      dimensionsPath: dimsPath,
      archjsonPath: archPath,
      outDir: path.join(tmp, 'predictions'),
      now,
    });
    expect(output.generatedAt).toBe('2026-06-11T12:00:00.000Z');
    expect(outPath).toContain('prediction-2026-06-11T12-00-00-000Z.json');

    const onDisk = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(onDisk.generatedAt).toBe(output.generatedAt);
    expect(Date.parse(onDisk.generatedAt)).not.toBeNaN();

    const expectHash = (p: string): string =>
      createHash('sha256').update(readFileSync(p)).digest('hex');
    expect(onDisk.inputs.tasks.sha256).toBe(expectHash(tasksPath));
    expect(onDisk.inputs.dimensions.sha256).toBe(expectHash(dimsPath));
    expect(onDisk.inputs.archjson.sha256).toBe(expectHash(archPath));
    expect(sha256OfFile(tasksPath)).toBe(expectHash(tasksPath));

    // end-to-end sanity: H0 + P_GIT present per task
    expect(onDisk.h0[taskA.id]).toBe('L2');
    expect(onDisk.h0[taskB.id]).toBe('L3');
    expect(onDisk.perTask).toEqual([
      { id: taskA.id, taskClass: 'A', h0: 'L2', pGit: 'L2' },
      { id: taskB.id, taskClass: 'B', h0: 'L3', pGit: 'L3' },
    ]);
    expect(onDisk.K).toBe(3);
  });
});
