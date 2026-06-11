/**
 * Task runner (Stage 63.2): every task × every level × k=5 × 2 models.
 *
 * - Per-model sampling params per §6 (deepseek-v4-flash temperature=0.2;
 *   gpt-5.4 temperature=1 + reasoning_effort "low").
 * - Task and level presentation order randomised with a reproducible PRNG
 *   (mulberry32); the seed is persisted to the run directory.
 * - "Insufficient information" cells of the derivability matrix are skipped.
 * - gpt-5.4 baseline probe before every batch (§13.6): prompt_tokens drift
 *   beyond tolerance marks the whole batch invalidated (to be re-run).
 * - Resume: completed calls are persisted one file per (task, level, model, k)
 *   key under artifacts/runs/calls/; restarts never re-bill completed keys.
 * - Dry-run prints the full call plan + scale estimate without any network.
 * - The prompt-build path never touches mapping.json (asserted at runtime).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createLlmClient, type LlmClient } from './lib/llm-client';
import { GRANULARITY_ROOT, GT_DIR, LEVELS_DIR, RUNS_DIR } from './lib/paths';
import { validateTasks, type Task } from './tasks/schema';

export const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const;
export type Level = (typeof LEVELS)[number];

export interface ModelSpec {
  name: string;
  params: Record<string, unknown>;
}

/** §6 frozen sampling parameters, per model. */
export const MODELS: readonly ModelSpec[] = [
  { name: 'deepseek-v4-flash', params: { temperature: 0.2 } },
  { name: 'gpt-5.4', params: { temperature: 1, reasoning_effort: 'low' } },
];

export const K = 5;

/** §13.6 baseline probe (fixed prompt; gpt-5.4 hidden-injection drift watch). */
export const BASELINE_PROBE_MODEL = 'gpt-5.4';
export const BASELINE_PROBE_PROMPT = 'Reply with the single word: ok';
export const BASELINE_DRIFT_TOLERANCE_TOKENS = 16;
export const DEFAULT_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Reproducible PRNG (mulberry32) — determinism requirement: no Math.random.
// ---------------------------------------------------------------------------
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Call plan
// ---------------------------------------------------------------------------
export type DerivabilityMatrix = Record<string, Partial<Record<Level, boolean>>>;

/** Default §6 rule when predict.ts matrix is absent: B-class answers are not derivable at L0–L2. */
export function defaultDerivable(task: Task, level: Level): boolean {
  return !(task.taskClass === 'B' && (level === 'L0' || level === 'L1' || level === 'L2'));
}

export function isDerivable(task: Task, level: Level, matrix?: DerivabilityMatrix): boolean {
  const cell = matrix?.[task.id]?.[level];
  return cell !== undefined ? cell : defaultDerivable(task, level);
}

export interface PlannedCall {
  taskId: string;
  taskClass: 'A' | 'B';
  module: string;
  level: Level;
  model: string;
  k: number;
}

export interface CallPlan {
  seed: number;
  calls: PlannedCall[];
  skippedCells: Array<{ taskId: string; level: Level }>;
}

export function buildCallPlan(options: {
  tasks: Task[];
  seed: number;
  models?: readonly ModelSpec[];
  k?: number;
  derivability?: DerivabilityMatrix;
}): CallPlan {
  const models = options.models ?? MODELS;
  const k = options.k ?? K;
  const rng = createRng(options.seed);
  const calls: PlannedCall[] = [];
  const skippedCells: Array<{ taskId: string; level: Level }> = [];

  for (const task of shuffle(options.tasks, rng)) {
    for (const level of shuffle(LEVELS, rng)) {
      if (!isDerivable(task, level, options.derivability)) {
        skippedCells.push({ taskId: task.id, level });
        continue;
      }
      for (const model of models) {
        for (let rep = 1; rep <= k; rep++) {
          calls.push({
            taskId: task.id,
            taskClass: task.taskClass,
            module: task.module,
            level,
            model: model.name,
            k: rep,
          });
        }
      }
    }
  }
  return { seed: options.seed, calls, skippedCells };
}

export function callKey(call: Pick<PlannedCall, 'taskId' | 'level' | 'model' | 'k'>): string {
  return `${call.taskId}__${call.level}__${call.model}__k${call.k}`.replace(/[^A-Za-z0-9._-]/g, '_');
}

// ---------------------------------------------------------------------------
// Prompt building — mapping.json must never enter this path (§5).
// ---------------------------------------------------------------------------
export function assertCleanSourcePath(filePath: string): void {
  if (/(^|[\\/])mapping\.json$/i.test(filePath)) {
    throw new Error(
      `prompt-build path must not reference mapping.json (got: ${filePath}); ` +
        'the obfuscation mapping never enters any prompt (proposal §5)'
    );
  }
}

export function buildPrompt(task: Task, levelText: string): string {
  return `${levelText}\n\n---\n\n${task.prompt}`;
}

export type LevelTextLoader = (module: string, level: Level) => string;

export function createFileLevelTextLoader(levelsDir: string): LevelTextLoader {
  return (module, level) => {
    const p = path.join(levelsDir, level, `${module}.txt`);
    assertCleanSourcePath(p);
    return readFileSync(p, 'utf8');
  };
}

// ---------------------------------------------------------------------------
// Baseline probe (§13.6)
// ---------------------------------------------------------------------------
export async function runBaselineProbe(client: LlmClient): Promise<number> {
  const probeParams = MODELS.find((m) => m.name === BASELINE_PROBE_MODEL)?.params ?? {};
  const res = await client.chat({
    model: BASELINE_PROBE_MODEL,
    messages: [{ role: 'user', content: BASELINE_PROBE_PROMPT }],
    params: probeParams,
  });
  return res.promptTokens;
}

export function isBaselineDrifted(
  baseline: number,
  observed: number,
  tolerance: number = BASELINE_DRIFT_TOLERANCE_TOKENS
): boolean {
  return Math.abs(observed - baseline) > tolerance;
}

// ---------------------------------------------------------------------------
// Runner with resume + batch invalidation
// ---------------------------------------------------------------------------
export interface CallResult extends PlannedCall {
  key: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
  /** True when the §13.6 baseline drifted for this batch → re-run required. */
  invalidated: boolean;
  timestamp: string;
}

export interface RunSummary {
  executed: number;
  resumedSkips: number;
  invalidatedBatches: number;
}

export async function runTasks(options: {
  tasks: Task[];
  plan: CallPlan;
  client: LlmClient;
  runDir: string;
  levelTextLoader: LevelTextLoader;
  models?: readonly ModelSpec[];
  batchSize?: number;
  driftTolerance?: number;
}): Promise<RunSummary> {
  const models = options.models ?? MODELS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const callsDir = path.join(options.runDir, 'calls');
  mkdirSync(callsDir, { recursive: true });

  // Seed persisted to disk — the "可复现" half of the randomisation contract.
  writeFileSync(
    path.join(options.runDir, 'seed.json'),
    `${JSON.stringify({ seed: options.plan.seed }, null, 2)}\n`,
    'utf8'
  );

  const taskById = new Map(options.tasks.map((t) => [t.id, t]));
  const paramsByModel = new Map(models.map((m) => [m.name, m.params]));

  // Baseline: established on first run, persisted, reused on resume.
  const baselinePath = path.join(options.runDir, 'baseline.json');
  let baseline: number;
  if (existsSync(baselinePath)) {
    baseline = (JSON.parse(readFileSync(baselinePath, 'utf8')) as { promptTokens: number }).promptTokens;
  } else {
    baseline = await runBaselineProbe(options.client);
    writeFileSync(baselinePath, `${JSON.stringify({ promptTokens: baseline, probe: BASELINE_PROBE_PROMPT }, null, 2)}\n`, 'utf8');
  }

  const summary: RunSummary = { executed: 0, resumedSkips: 0, invalidatedBatches: 0 };

  for (let start = 0; start < options.plan.calls.length; start += batchSize) {
    const batch = options.plan.calls.slice(start, start + batchSize);
    const pending = batch.filter((c) => !existsSync(path.join(callsDir, `${callKey(c)}.json`)));
    summary.resumedSkips += batch.length - pending.length;
    if (pending.length === 0) continue;

    // §13.6: fixed probe before each batch; skip re-probing the very first
    // batch of a fresh run (the baseline probe just measured it).
    const observed = start === 0 && !existsSync(path.join(callsDir, '.probed'))
      ? baseline
      : await runBaselineProbe(options.client);
    writeFileSync(path.join(callsDir, '.probed'), '', 'utf8');
    const invalidated = isBaselineDrifted(baseline, observed, options.driftTolerance);
    if (invalidated) summary.invalidatedBatches++;

    for (const call of pending) {
      const task = taskById.get(call.taskId);
      if (!task) throw new Error(`plan references unknown task '${call.taskId}'`);
      const prompt = buildPrompt(task, options.levelTextLoader(call.module, call.level));
      const res = await options.client.chat({
        model: call.model,
        messages: [{ role: 'user', content: prompt }],
        params: paramsByModel.get(call.model) ?? {},
      });
      const result: CallResult = {
        ...call,
        key: callKey(call),
        content: res.content,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        invalidated,
        timestamp: new Date().toISOString(),
      };
      writeFileSync(path.join(callsDir, `${callKey(call)}.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      summary.executed++;
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Dry-run report
// ---------------------------------------------------------------------------
export function formatDryRun(plan: CallPlan, tasks: Task[]): string {
  const byModel = new Map<string, number>();
  const byLevel = new Map<string, number>();
  for (const c of plan.calls) {
    byModel.set(c.model, (byModel.get(c.model) ?? 0) + 1);
    byLevel.set(c.level, (byLevel.get(c.level) ?? 0) + 1);
  }
  const lines = [
    '=== run-tasks dry-run (no gateway calls) ===',
    `seed: ${plan.seed}`,
    `tasks: ${tasks.length} (A: ${tasks.filter((t) => t.taskClass === 'A').length}, B: ${tasks.filter((t) => t.taskClass === 'B').length})`,
    `levels: ${LEVELS.length}, k: ${K}, models: ${MODELS.map((m) => `${m.name} ${JSON.stringify(m.params)}`).join(' | ')}`,
    `skipped cells (信息不足): ${plan.skippedCells.length} (= ${plan.skippedCells.length * MODELS.length * K} calls saved)`,
    `total planned calls: ${plan.calls.length}`,
    ...[...byModel].map(([m, n]) => `  by model ${m}: ${n}`),
    ...[...byLevel].sort().map(([l, n]) => `  by level ${l}: ${n}`),
    `nominal full grid: ${tasks.length * LEVELS.length * MODELS.length * K}`,
    'first 10 calls (presentation order):',
    ...plan.calls.slice(0, 10).map((c) => `  ${c.taskId} ${c.level} ${c.model} k${c.k}`),
  ];
  return lines.join('\n');
}

/* c8 ignore start -- CLI entry; the pieces above are unit-tested */
const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dryRun = args.includes('--dry-run');
  const fixtureTasks = path.join(GRANULARITY_ROOT, 'tests', 'fixtures', 'tasks', 'tasks.fixture.json');
  let tasksPath = get('--tasks') ?? path.join(GT_DIR, 'tasks.json');
  if (!existsSync(tasksPath) && dryRun) {
    console.log(`note: ${tasksPath} not found; dry-run falls back to fixture ${fixtureTasks}`);
    tasksPath = fixtureTasks;
  }
  assertCleanSourcePath(tasksPath);
  const tasks = JSON.parse(readFileSync(tasksPath, 'utf8')) as Task[];
  const v = validateTasks(tasks);
  if (!v.valid) {
    console.error(`invalid tasks file:\n${v.errors.join('\n')}`);
    process.exit(1);
  }
  const runDir = get('--run-dir') ?? RUNS_DIR;
  const seedFile = path.join(runDir, 'seed.json');
  const seed = existsSync(seedFile)
    ? (JSON.parse(readFileSync(seedFile, 'utf8')) as { seed: number }).seed
    : get('--seed') !== undefined
      ? Number(get('--seed'))
      : Date.now() >>> 0;
  const derivabilityPath = get('--derivability');
  const derivability = derivabilityPath
    ? (JSON.parse(readFileSync(derivabilityPath, 'utf8')) as DerivabilityMatrix)
    : undefined;
  const plan = buildCallPlan({ tasks, seed, derivability });

  if (dryRun) {
    console.log(formatDryRun(plan, tasks));
    process.exit(0);
  }
  const levelsDir = get('--levels-dir') ?? LEVELS_DIR;
  runTasks({
    tasks,
    plan,
    client: createLlmClient(),
    runDir,
    levelTextLoader: createFileLevelTextLoader(levelsDir),
  })
    .then((s) =>
      console.log(
        `done: executed=${s.executed} resumed-skips=${s.resumedSkips} invalidated-batches=${s.invalidatedBatches}`
      )
    )
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
/* c8 ignore stop */
