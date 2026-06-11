import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ChatRequest, ChatResponse, LlmClient } from '../lib/llm-client';
import {
  assertCleanSourcePath,
  BASELINE_PROBE_MODEL,
  BASELINE_PROBE_PROMPT,
  buildCallPlan,
  buildPrompt,
  callKey,
  createRng,
  defaultDerivable,
  formatDryRun,
  isBaselineDrifted,
  isDerivable,
  K,
  LEVELS,
  MODELS,
  runTasks,
  shuffle,
  type CallResult,
  type DerivabilityMatrix,
} from '../run-tasks';
import type { Task } from '../tasks/schema';

const FIXTURES = path.join(__dirname, 'fixtures', 'tasks');
const tasks = JSON.parse(readFileSync(path.join(FIXTURES, 'tasks.fixture.json'), 'utf8')) as Task[];
const mapping = JSON.parse(
  readFileSync(path.join(FIXTURES, 'mapping.fixture.json'), 'utf8')
) as Record<string, string>;

/** Mock client: records every request; probe replies carry promptTokens from `probeTokens` in call order. */
function createMockClient(probeTokens: number[] = [100]): {
  client: LlmClient;
  requests: ChatRequest[];
  probeCount(): number;
} {
  const requests: ChatRequest[] = [];
  let probeIdx = 0;
  const client: LlmClient = {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      requests.push(req);
      if (req.messages[0]?.content === BASELINE_PROBE_PROMPT) {
        const tokens = probeTokens[Math.min(probeIdx, probeTokens.length - 1)]!;
        probeIdx++;
        return { content: 'ok', promptTokens: tokens, completionTokens: 1 };
      }
      return { content: '{"answer": []}', promptTokens: 500, completionTokens: 5 };
    },
  };
  return { client, requests, probeCount: () => probeIdx };
}

const tmpDirs: string[] = [];
function makeRunDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'granularity-run-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const levelTextLoader = (module: string, level: string) => `[obfuscated ${module} at ${level}]`;

describe('frozen §6 sampling parameters', () => {
  it('pins deepseek-v4-flash temperature=0.2 and gpt-5.4 temperature=1 + reasoning_effort low', () => {
    expect(MODELS.find((m) => m.name === 'deepseek-v4-flash')!.params).toEqual({ temperature: 0.2 });
    expect(MODELS.find((m) => m.name === 'gpt-5.4')!.params).toEqual({
      temperature: 1,
      reasoning_effort: 'low',
    });
  });

  it('passes the per-model params through to the client request body', async () => {
    const { client, requests } = createMockClient();
    const plan = buildCallPlan({ tasks, seed: 7 });
    await runTasks({ tasks, plan, client, runDir: makeRunDir(), levelTextLoader });

    const byModel = new Map<string, ChatRequest[]>();
    for (const r of requests.filter((r) => r.messages[0]?.content !== BASELINE_PROBE_PROMPT)) {
      if (!byModel.has(r.model)) byModel.set(r.model, []);
      byModel.get(r.model)!.push(r);
    }
    expect([...byModel.keys()].sort()).toEqual(['deepseek-v4-flash', 'gpt-5.4']);
    for (const r of byModel.get('deepseek-v4-flash')!) expect(r.params).toEqual({ temperature: 0.2 });
    for (const r of byModel.get('gpt-5.4')!) {
      expect(r.params).toEqual({ temperature: 1, reasoning_effort: 'low' });
    }
  });
});

describe('deterministic PRNG and call plan', () => {
  it('mulberry32 stream is reproducible for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual([createRng(43)(), createRng(43)(), createRng(43)(), createRng(43)()]);
  });

  it('shuffle is deterministic under a seeded rng and does not mutate input', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const s1 = shuffle(items, createRng(1));
    const s2 = shuffle(items, createRng(1));
    expect(s1).toEqual(s2);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect([...s1].sort()).toEqual(items);
  });

  it('the same seed reproduces the identical call plan (order included)', () => {
    const p1 = buildCallPlan({ tasks, seed: 1234 });
    const p2 = buildCallPlan({ tasks, seed: 1234 });
    expect(p1).toEqual(p2);
    const p3 = buildCallPlan({ tasks, seed: 4321 });
    expect(p3.calls).not.toEqual(p1.calls);
    // same multiset of calls regardless of seed
    const sortKey = (c: { taskId: string; level: string; model: string; k: number }) =>
      `${c.taskId}|${c.level}|${c.model}|${c.k}`;
    expect(p3.calls.map(sortKey).sort()).toEqual(p1.calls.map(sortKey).sort());
  });

  it('persists the seed to the run directory (seed.json)', async () => {
    const runDir = makeRunDir();
    const plan = buildCallPlan({ tasks, seed: 99 });
    await runTasks({ tasks, plan, client: createMockClient().client, runDir, levelTextLoader });
    expect(JSON.parse(readFileSync(path.join(runDir, 'seed.json'), 'utf8'))).toEqual({ seed: 99 });
  });
});

describe('derivability skips (信息不足)', () => {
  it('defaults: B-class cells at L0–L2 are not derivable; A-class always is', () => {
    const aTask = tasks.find((t) => t.taskClass === 'A')!;
    const bTask = tasks.find((t) => t.taskClass === 'B')!;
    for (const level of LEVELS) {
      expect(defaultDerivable(aTask, level)).toBe(true);
      expect(defaultDerivable(bTask, level)).toBe(!['L0', 'L1', 'L2'].includes(level));
    }
  });

  it('excludes skipped cells from the plan and counts them', () => {
    const plan = buildCallPlan({ tasks, seed: 5 });
    const bTasks = tasks.filter((t) => t.taskClass === 'B');
    expect(plan.skippedCells).toHaveLength(bTasks.length * 3); // L0, L1, L2 each
    const expectedCalls = (tasks.length * LEVELS.length - bTasks.length * 3) * MODELS.length * K;
    expect(plan.calls).toHaveLength(expectedCalls);
    for (const c of plan.calls) {
      const task = tasks.find((t) => t.id === c.taskId)!;
      expect(task.taskClass === 'B' && ['L0', 'L1', 'L2'].includes(c.level)).toBe(false);
    }
  });

  it('an explicit derivability matrix overrides the default in both directions', () => {
    const aTask = tasks.find((t) => t.taskClass === 'A')!;
    const bTask = tasks.find((t) => t.taskClass === 'B')!;
    const matrix: DerivabilityMatrix = {
      [aTask.id]: { L0: false },
      [bTask.id]: { L0: true },
    };
    expect(isDerivable(aTask, 'L0', matrix)).toBe(false);
    expect(isDerivable(bTask, 'L0', matrix)).toBe(true);
    expect(isDerivable(bTask, 'L1', matrix)).toBe(false); // unspecified → default

    const plan = buildCallPlan({ tasks, seed: 5, derivability: matrix });
    expect(plan.skippedCells).toContainEqual({ taskId: aTask.id, level: 'L0' });
    expect(plan.calls.some((c) => c.taskId === bTask.id && c.level === 'L0')).toBe(true);
  });
});

describe('baseline probe (§13.6)', () => {
  it('isBaselineDrifted applies the absolute-token tolerance', () => {
    expect(isBaselineDrifted(100, 116, 16)).toBe(false);
    expect(isBaselineDrifted(100, 117, 16)).toBe(true);
    expect(isBaselineDrifted(100, 83, 16)).toBe(true);
  });

  it('probes gpt-5.4 with the fixed prompt before each batch', async () => {
    const { client, requests } = createMockClient([100, 100, 100]);
    const plan = buildCallPlan({ tasks, seed: 3 });
    await runTasks({ tasks, plan, client, runDir: makeRunDir(), levelTextLoader, batchSize: 50 });

    const probes = requests.filter((r) => r.messages[0]?.content === BASELINE_PROBE_PROMPT);
    expect(probes.length).toBeGreaterThan(0);
    for (const p of probes) expect(p.model).toBe(BASELINE_PROBE_MODEL);
  });

  it('marks the whole batch invalidated when the baseline drifts', async () => {
    // probe sequence: 100 (baseline), then 100 (batch 2 ok), then 400 (batch 3 drifted)
    const { client } = createMockClient([100, 100, 400]);
    const runDir = makeRunDir();
    const plan = buildCallPlan({ tasks, seed: 11 });
    const batchSize = Math.ceil(plan.calls.length / 3);
    const summary = await runTasks({ tasks, plan, client, runDir, levelTextLoader, batchSize });

    expect(summary.invalidatedBatches).toBe(1);
    const results = readdirSync(path.join(runDir, 'calls'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(path.join(runDir, 'calls', f), 'utf8')) as CallResult);
    const invalidated = results.filter((r) => r.invalidated);
    expect(invalidated.length).toBe(plan.calls.length - 2 * batchSize);
    const invalidKeys = new Set(invalidated.map((r) => r.key));
    expect(new Set(plan.calls.slice(2 * batchSize).map((c) => callKey(c)))).toEqual(invalidKeys);
  });
});

describe('resume (断点续跑)', () => {
  it('never re-executes a completed (task, level, model, k) key', async () => {
    const runDir = makeRunDir();
    const plan = buildCallPlan({ tasks, seed: 21 });

    const first = createMockClient([100, 100]);
    const s1 = await runTasks({ tasks, plan, client: first.client, runDir, levelTextLoader });
    expect(s1.executed).toBe(plan.calls.length);
    expect(s1.resumedSkips).toBe(0);

    const second = createMockClient([100, 100]);
    const s2 = await runTasks({ tasks, plan, client: second.client, runDir, levelTextLoader });
    expect(s2.executed).toBe(0);
    expect(s2.resumedSkips).toBe(plan.calls.length);
    // no task calls at all on resume — zero double billing (probes excluded by design)
    const taskCalls = second.requests.filter((r) => r.messages[0]?.content !== BASELINE_PROBE_PROMPT);
    expect(taskCalls).toHaveLength(0);
  });

  it('callKey is filesystem-safe and unique per (task, level, model, k)', () => {
    const k1 = callKey({ taskId: 'modA/x:1', level: 'L3', model: 'gpt-5.4', k: 2 });
    expect(k1).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(k1).not.toBe(callKey({ taskId: 'modA/x:1', level: 'L3', model: 'gpt-5.4', k: 3 }));
  });
});

describe('prompt hygiene (§5: mapping never enters prompts)', () => {
  it('assertCleanSourcePath rejects any mapping.json path', () => {
    expect(() => assertCleanSourcePath('/x/artifacts/gt/mapping.json')).toThrow(/mapping\.json/);
    expect(() => assertCleanSourcePath('mapping.json')).toThrow(/mapping\.json/);
    expect(() => assertCleanSourcePath('/x/levels/L3/modA.txt')).not.toThrow();
    expect(() => assertCleanSourcePath('/x/some-mapping.json.txt')).not.toThrow();
  });

  it('no prompt sent to the client contains any original (pre-obfuscation) name', async () => {
    const { client, requests } = createMockClient();
    const plan = buildCallPlan({ tasks, seed: 13 });
    await runTasks({ tasks, plan, client, runDir: makeRunDir(), levelTextLoader });

    const taskCalls = requests.filter((r) => r.messages[0]?.content !== BASELINE_PROBE_PROMPT);
    expect(taskCalls.length).toBe(plan.calls.length);
    const originals = Object.values(mapping);
    for (const r of taskCalls) {
      for (const original of originals) {
        expect(r.messages[0]!.content).not.toContain(original);
      }
    }
  });

  it('buildPrompt prepends the level text and keeps the task prompt verbatim', () => {
    const p = buildPrompt(tasks[0]!, 'LEVEL TEXT');
    expect(p.startsWith('LEVEL TEXT')).toBe(true);
    expect(p).toContain(tasks[0]!.prompt);
  });
});

describe('dry-run report', () => {
  it('summarises seed, scale, per-model/per-level counts and skipped cells without any client', () => {
    const plan = buildCallPlan({ tasks, seed: 77 });
    const report = formatDryRun(plan, tasks);
    expect(report).toContain('seed: 77');
    expect(report).toContain(`total planned calls: ${plan.calls.length}`);
    expect(report).toContain(`nominal full grid: ${tasks.length * LEVELS.length * MODELS.length * K}`);
    expect(report).toContain('deepseek-v4-flash');
    expect(report).toContain('gpt-5.4');
    expect(report).toContain(`skipped cells (信息不足): ${plan.skippedCells.length}`);
  });
});

describe('runner guards', () => {
  it('throws when the plan references an unknown task', async () => {
    const plan = buildCallPlan({ tasks, seed: 1 });
    await expect(
      runTasks({
        tasks: tasks.slice(1),
        plan,
        client: createMockClient().client,
        runDir: makeRunDir(),
        levelTextLoader,
      })
    ).rejects.toThrow(/unknown task/);
  });

  it('reuses a persisted baseline on resume instead of re-measuring', async () => {
    const runDir = makeRunDir();
    const plan = buildCallPlan({ tasks, seed: 31 });
    await runTasks({ tasks, plan, client: createMockClient([100]).client, runDir, levelTextLoader });
    const baseline = JSON.parse(readFileSync(path.join(runDir, 'baseline.json'), 'utf8')) as {
      promptTokens: number;
    };
    expect(baseline.promptTokens).toBe(100);
    expect(existsSync(path.join(runDir, 'calls', '.probed'))).toBe(true);
  });
});
