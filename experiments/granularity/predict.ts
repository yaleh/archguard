/**
 * Stage 61.3 — derivability matrix + H0 / P_GIT pre-registered predictors.
 *
 * Implements proposal §6 (derivability matrix, also the basis of H0) and §3
 * (P_GIT scan with ALL boundary rules, pre-registered):
 *   - d_ℓ is NOT assumed monotone in ℓ: the L0→L5 scan is literal, no
 *     smoothing;
 *   - if NO level satisfies d_ℓ ≥ d_task → P_GIT = L5 (fallback, flagged);
 *   - levels judged "unreliable" by §8.4 are SKIPPED and recorded (they go to
 *     the sensitivity analysis);
 *   - L3/L4 are information-equivalent: any predictor tie resolves to L3.
 *
 * Dimension input: assembled from dimension.py outputs (its per-level result
 * objects carry `twonn` (point estimate) and `reliable` (§8.4 verdict)):
 *
 *   { "levels": { "L0": {"twonn": 3.1, "reliable": true, ...}, ... },
 *     "tasks":  { "A": {"twonn": 4.2, "reliable": true, ...}, "B": {...} } }
 *
 * (`d_task` is accepted as an alias of `twonn` for task entries.)
 *
 * Output is persisted to artifacts/predictions/ with an ISO timestamp and the
 * SHA-256 of every input file (Phase 65 ante-hoc evidence). Pure functions +
 * file I/O only — ZERO LLM calls.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ArchJsonDoc } from './lib/levels/archjson';
import { PREDICTIONS_DIR } from './lib/paths';
import { A_TASK_TYPES, B_TASK_TYPES, type Task } from './tasks/schema';

export const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const;
export type Level = (typeof LEVELS)[number];

// ---------------------------------------------------------------------------
// Derivability matrix (§6) — mechanical judgement per (task × level)
// ---------------------------------------------------------------------------

export interface LevelCapabilities {
  /** Entity-level nodes are visible. */
  entities: boolean;
  /** Entity-level relations (inheritance/implementation/dependency/…) visible. */
  entityRelations: boolean;
  /** method→method call edges visible. */
  callEdges: boolean;
}

/** Information content of the level ladder (§4): L0 files, L1 packages,
 *  L2 + entity relations, L3 ≡ L4 + call edges, L5 full source. */
export const LEVEL_CAPABILITIES: Record<Level, LevelCapabilities> = {
  L0: { entities: false, entityRelations: false, callEdges: false },
  L1: { entities: false, entityRelations: false, callEdges: false },
  L2: { entities: true, entityRelations: true, callEdges: false },
  L3: { entities: true, entityRelations: true, callEdges: true },
  L4: { entities: true, entityRelations: true, callEdges: true },
  L5: { entities: true, entityRelations: true, callEdges: true },
};

/** Edge kind a task's answer needs: A-class → entity relations, B-class → call edges. */
export function requiredEdgeKind(task: Pick<Task, 'taskType'>): 'entityRelations' | 'callEdges' {
  if ((A_TASK_TYPES as readonly string[]).includes(task.taskType)) return 'entityRelations';
  if ((B_TASK_TYPES as readonly string[]).includes(task.taskType)) return 'callEdges';
  throw new Error(`unknown taskType: ${task.taskType}`);
}

/** Strip a member suffix: 'Xq7.m4' → 'Xq7'. */
export function entityBase(name: string): string {
  const dot = name.indexOf('.');
  return dot < 0 ? name : name.slice(0, dot);
}

/**
 * Mechanical derivability: the level must carry the required edge kind AND
 * every task-relevant entity must exist in the level's entity set (L5 source
 * trivially contains everything).
 */
export function isDerivable(
  task: Pick<Task, 'taskType' | 'entities'>,
  level: Level,
  entityNames: ReadonlySet<string>
): boolean {
  if (level === 'L5') return true;
  const caps = LEVEL_CAPABILITIES[level];
  if (!caps[requiredEdgeKind(task)]) return false;
  if (!caps.entities) return false;
  return task.entities.every((n) => entityNames.has(entityBase(n)));
}

export type DerivabilityMatrix = Record<string, Record<Level, boolean>>;

export function buildDerivabilityMatrix(
  tasks: readonly Pick<Task, 'id' | 'taskType' | 'entities'>[],
  entityNames: ReadonlySet<string>
): DerivabilityMatrix {
  const matrix: DerivabilityMatrix = {};
  for (const task of tasks) {
    const row = {} as Record<Level, boolean>;
    for (const level of LEVELS) row[level] = isDerivable(task, level, entityNames);
    matrix[task.id] = row;
  }
  return matrix;
}

// ---------------------------------------------------------------------------
// H0 — coarsest structurally sufficient level (derived from the matrix)
// ---------------------------------------------------------------------------

/** First derivable level scanning L0→L5; L3/L4 tie resolves to L3 by scan
 *  order; the matrix guarantees L5 is always derivable. */
export function computeH0(row: Record<Level, boolean>): Level {
  for (const level of LEVELS) {
    if (row[level]) return normalizeTieToL3(level);
  }
  return 'L5';
}

/** §3 tie rule: predictors never answer L4 when L3 is information-equivalent. */
export function normalizeTieToL3(level: Level): Level {
  return level === 'L4' ? 'L3' : level;
}

// ---------------------------------------------------------------------------
// P_GIT — first level with d_ℓ ≥ d_task (§3 boundary rules)
// ---------------------------------------------------------------------------

export interface DimensionEntry {
  twonn?: number;
  d_task?: number;
  reliable?: boolean;
  [key: string]: unknown;
}

export interface DimensionsInput {
  levels: Record<string, DimensionEntry>;
  tasks?: Record<string, DimensionEntry>;
}

export function dimensionOf(entry: DimensionEntry | undefined): number | undefined {
  return entry?.twonn ?? entry?.d_task;
}

export interface PGitScanStep {
  level: Level;
  d: number | null;
  reliable: boolean;
  satisfied: boolean | null;
  skipped: boolean;
}

export interface PGitResult {
  level: Level;
  dTask: number;
  /** No level satisfied d_ℓ ≥ d_task → fell back to L5 (§3). */
  fallbackToL5: boolean;
  /** Levels skipped because §8.4 judged them unreliable (sensitivity set). */
  skippedUnreliable: Level[];
  /** True when the raw pick was L4 and the tie rule normalized it to L3. */
  tieNormalizedToL3: boolean;
  scan: PGitScanStep[];
}

export function computePGit(dTask: number, levels: Record<string, DimensionEntry>): PGitResult {
  const scan: PGitScanStep[] = [];
  const skippedUnreliable: Level[] = [];
  let chosen: Level | undefined;
  for (const level of LEVELS) {
    const entry = levels[level];
    const d = dimensionOf(entry);
    const reliable = entry !== undefined && d !== undefined && entry.reliable !== false;
    if (!reliable) {
      // §3: unreliable d_ℓ → skip + mark (goes to sensitivity analysis).
      skippedUnreliable.push(level);
      scan.push({ level, d: d ?? null, reliable: false, satisfied: null, skipped: true });
      continue;
    }
    const satisfied = d! >= dTask;
    scan.push({ level, d: d!, reliable: true, satisfied, skipped: false });
    if (satisfied && chosen === undefined) {
      chosen = level; // literal first hit — d_ℓ is not smoothed nor assumed monotone
      break;
    }
  }
  const fallbackToL5 = chosen === undefined;
  const raw: Level = chosen ?? 'L5';
  const normalized = normalizeTieToL3(raw);
  return {
    level: normalized,
    dTask,
    fallbackToL5,
    skippedUnreliable,
    tieNormalizedToL3: normalized !== raw,
    scan,
  };
}

// ---------------------------------------------------------------------------
// Prediction assembly + persistence
// ---------------------------------------------------------------------------

export interface PredictionInputFile {
  path: string;
  sha256: string;
}

export interface PredictionOutput {
  schema: 'prediction-v1';
  generatedAt: string;
  inputs: Record<string, PredictionInputFile>;
  K: number;
  derivability: DerivabilityMatrix;
  h0: Record<string, Level>;
  pGit: Record<
    string,
    (PGitResult & { dTaskReliable: boolean }) | { error: string }
  >;
  perTask: { id: string; taskClass: string; h0: Level; pGit: Level | null }[];
}

export function buildPrediction(args: {
  tasks: readonly Task[];
  dimensions: DimensionsInput;
  arch: ArchJsonDoc;
  inputs: Record<string, PredictionInputFile>;
  now?: Date;
}): PredictionOutput {
  const { tasks, dimensions, arch, inputs } = args;
  const entityNames = new Set(arch.entities.map((e) => e.name));
  const derivability = buildDerivabilityMatrix(tasks, entityNames);

  const h0: Record<string, Level> = {};
  for (const task of tasks) h0[task.id] = computeH0(derivability[task.id]!);

  const pGit: PredictionOutput['pGit'] = {};
  const taskClasses = [...new Set(tasks.map((t) => t.taskClass))].sort();
  for (const cls of taskClasses) {
    const entry = dimensions.tasks?.[cls];
    const dTask = dimensionOf(entry);
    if (dTask === undefined) {
      pGit[cls] = { error: `no d_task for task class '${cls}' in dimensions input` };
      continue;
    }
    pGit[cls] = {
      ...computePGit(dTask, dimensions.levels),
      // d_task itself unreliable → class exits the main analysis (§8.1)
      dTaskReliable: entry?.reliable !== false,
    };
  }

  const perTask = tasks.map((t) => {
    const cls = pGit[t.taskClass];
    return {
      id: t.id,
      taskClass: t.taskClass,
      h0: h0[t.id]!,
      pGit: cls !== undefined && !('error' in cls) ? cls.level : null,
    };
  });

  return {
    schema: 'prediction-v1',
    generatedAt: (args.now ?? new Date()).toISOString(),
    inputs,
    K: arch.entities.length,
    derivability,
    h0,
    pGit,
    perTask,
  };
}

export function sha256OfFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/** Full file-I/O pipeline used by the CLI (unit-tested against fixtures). */
export function runPredict(args: {
  tasksPath: string;
  dimensionsPath: string;
  archjsonPath: string;
  outDir: string;
  now?: Date;
}): { outPath: string; output: PredictionOutput } {
  const tasks = JSON.parse(readFileSync(args.tasksPath, 'utf8')) as Task[];
  const dimensions = JSON.parse(readFileSync(args.dimensionsPath, 'utf8')) as DimensionsInput;
  const arch = JSON.parse(readFileSync(args.archjsonPath, 'utf8')) as ArchJsonDoc;
  const output = buildPrediction({
    tasks,
    dimensions,
    arch,
    inputs: {
      tasks: { path: args.tasksPath, sha256: sha256OfFile(args.tasksPath) },
      dimensions: { path: args.dimensionsPath, sha256: sha256OfFile(args.dimensionsPath) },
      archjson: { path: args.archjsonPath, sha256: sha256OfFile(args.archjsonPath) },
    },
    ...(args.now !== undefined ? { now: args.now } : {}),
  });
  mkdirSync(args.outDir, { recursive: true });
  const stamp = output.generatedAt.replace(/[:.]/g, '-');
  const outPath = path.join(args.outDir, `prediction-${stamp}.json`);
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return { outPath, output };
}

/* c8 ignore start -- CLI entry; logic above is unit-tested */
const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const tasksPath = get('--tasks');
  const dimensionsPath = get('--dimensions');
  const archjsonPath = get('--archjson');
  if (tasksPath === undefined || dimensionsPath === undefined || archjsonPath === undefined) {
    console.error(
      'usage: tsx predict.ts --tasks <tasks.json> --dimensions <dims.json> --archjson <arch.json> [--out-dir <dir>]'
    );
    process.exit(1);
  }
  const { outPath, output } = runPredict({
    tasksPath,
    dimensionsPath,
    archjsonPath,
    outDir: get('--out-dir') ?? PREDICTIONS_DIR,
  });
  console.log(`prediction (${output.perTask.length} tasks) -> ${outPath}`);
  for (const [cls, r] of Object.entries(output.pGit)) {
    if ('error' in r) console.log(`  P_GIT[${cls}]: ${r.error}`);
    else
      console.log(
        `  P_GIT[${cls}] = ${r.level}${r.fallbackToL5 ? ' (fallback L5)' : ''}` +
          `${r.skippedUnreliable.length > 0 ? ` skipped=${r.skippedUnreliable.join(',')}` : ''}` +
          `${r.dTaskReliable ? '' : ' [d_task UNRELIABLE]'}`
      );
  }
}
/* c8 ignore stop */
