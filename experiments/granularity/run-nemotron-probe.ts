/**
 * Probe run: nvidia/nemotron-3-nano-30b-a3b:free accuracy on v2 tasks.
 * All 68 tasks × derivable levels × k=3. Uses existing run-tasks + score infrastructure.
 *
 * Usage:
 *   LLM_BASE_URL=... LLM_API_KEY=... npx tsx run-nemotron-probe.ts [--dry-run]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLlmClient } from './lib/llm-client';
import { ARTIFACTS_DIR, LEVELS_DIR } from './lib/paths';
import {
  buildCallPlan,
  callKey,
  buildPrompt,
  createV2LevelTextLoader,
  type ModelSpec,
  type PlannedCall,
} from './run-tasks';
import { aggregateVotes, scoreRuns, type ScoreRow } from './score';

const GRANULARITY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const MODEL_ARG = process.argv.find(a => a.startsWith('--model='))?.slice('--model='.length)
  ?? 'nvidia/nemotron-3-nano-30b-a3b:free';

const PROBE_MODEL: ModelSpec = {
  name: MODEL_ARG,
  // max_tokens=8192: reasoning models exhaust smaller budgets on long prompts (D-71.2).
  // L4 prompt is ~61k tokens; 4096 was insufficient for reasoning + output on that level.
  params: { temperature: 0.2, max_tokens: 8192 },
};

const K = 3;
const CONCURRENCY = 6;
const CALL_TIMEOUT_MS = 60_000;
const RUN_SLUG = MODEL_ARG.replace(/[^A-Za-z0-9]/g, '-');
const RUN_DIR_ARG = process.argv.find(a => a.startsWith('--run-dir='))?.slice('--run-dir='.length);
const RUN_DIR = RUN_DIR_ARG
  ? path.isAbsolute(RUN_DIR_ARG) ? RUN_DIR_ARG : path.join(GRANULARITY_ROOT, RUN_DIR_ARG)
  : path.join(ARTIFACTS_DIR, `runs-probe-${RUN_SLUG}`);

const isDryRun = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
async function main() {
  mkdirSync(path.join(RUN_DIR, 'calls'), { recursive: true });

  const tasksPath = path.join(GRANULARITY_ROOT, 'tasks', 'v2-tasks.json');
  const tasks = JSON.parse(readFileSync(tasksPath, 'utf8')) as Array<Record<string, unknown>>;
  console.log(`Tasks: ${tasks.length}`);

  const plan = buildCallPlan({
    tasks: tasks as never,
    seed: 20260612,
    models: [PROBE_MODEL],
    k: K,
  });

  console.log(`Planned calls: ${plan.calls.length} (${plan.skippedCells.length} cells skipped)`);
  console.log(`Estimate: ~${Math.ceil(plan.calls.length / CONCURRENCY * 1.8 / 60)} min at ${CONCURRENCY} concurrency`);

  if (isDryRun) {
    const byLevel = new Map<string, number>();
    for (const c of plan.calls) byLevel.set(c.level, (byLevel.get(c.level) ?? 0) + 1);
    for (const [l, n] of [...byLevel].sort()) console.log(`  ${l}: ${n} calls`);
    return;
  }

  const client = createLlmClient();
  const levelTextLoader = createV2LevelTextLoader(LEVELS_DIR);
  const taskById = new Map(tasks.map((t) => [t.id as string, t]));

  // Resume: skip calls that already have non-empty content.
  // Calls with empty content (silent inference failures) are treated as pending and re-run.
  const callsDir = path.join(RUN_DIR, 'calls');
  const done = new Set(
    readdirSync(callsDir)
      .filter(f => f.endsWith('.json'))
      .filter(f => {
        try {
          const rec = JSON.parse(readFileSync(path.join(callsDir, f), 'utf8')) as { content?: string };
          return typeof rec.content === 'string' && rec.content.trim().length > 0;
        } catch { return false; }
      })
      .map(f => f.slice(0, -5))
  );
  const pending = plan.calls.filter(c => !done.has(callKey(c)));
  console.log(`Resuming: ${done.size} done (non-empty), ${pending.length} pending (incl. retries)`);

  let executed = 0;
  const startTime = Date.now();

  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const chunk = pending.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (call) => {
      const task = taskById.get(call.taskId);
      if (!task) throw new Error(`unknown task: ${call.taskId}`);
      const levelText = levelTextLoader((call as PlannedCall & { module: string }).module ?? 'v2-arch', call.level);
      const prompt = buildPrompt(task as never, levelText);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
      let content = '';
      let promptTokens = -1;
      let completionTokens = -1;
      let timedOut = false;

      try {
        const res = await client.chat({
          model: PROBE_MODEL.name,
          messages: [{ role: 'user', content: prompt }],
          params: PROBE_MODEL.params,
        });
        content = res.content;
        promptTokens = res.promptTokens;
        completionTokens = res.completionTokens;
      } catch {
        timedOut = true;
      } finally {
        clearTimeout(timer);
      }

      return { call, content, promptTokens, completionTokens, timedOut };
    }));

    for (const { call, content, promptTokens, completionTokens, timedOut } of results) {
      const record = {
        ...call,
        key: callKey(call),
        content,
        promptTokens,
        completionTokens,
        invalidated: timedOut,
        timestamp: new Date().toISOString(),
      };
      writeFileSync(path.join(callsDir, `${callKey(call)}.json`), JSON.stringify(record, null, 2) + '\n');
      executed++;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const total = pending.length;
    process.stderr.write(`[${elapsed}s] ${executed}/${total} calls\n`);
  }

  console.log(`\nExecuted ${executed} calls. Scoring...`);

  // Score
  const results = readdirSync(callsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(path.join(callsDir, f), 'utf8')));

  const rows: ScoreRow[] = scoreRuns(tasks as never, results);
  const outPath = path.join(RUN_DIR, 'scores-nemotron.json');
  writeFileSync(outPath, JSON.stringify(rows, null, 2) + '\n');

  // Summary by class × level
  const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
  const byClassLevel = new Map<string, number[]>();
  for (const row of rows) {
    const key = `${row.taskClass}__${row.level}`;
    if (!byClassLevel.has(key)) byClassLevel.set(key, []);
    byClassLevel.get(key)!.push(row.score);
  }

  console.log('\n=== Mean score by class × level ===');
  for (const cls of ['A', 'B', 'C', 'ALL']) {
    const parts: string[] = [];
    for (const lv of LEVELS) {
      const key = cls === 'ALL' ? null : `${cls}__${lv}`;
      const scores = cls === 'ALL'
        ? rows.filter(r => r.level === lv).map(r => r.score)
        : (byClassLevel.get(key!) ?? []);
      if (scores.length === 0) { parts.push(`${lv}:—`); continue; }
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      parts.push(`${lv}:${mean.toFixed(3)}`);
    }
    console.log(`  ${cls}: ${parts.join('  ')}`);
  }

  // Overall mean
  const overall = rows.reduce((s, r) => s + r.score, 0) / rows.length;
  console.log(`\nOverall mean score: ${overall.toFixed(3)}  (${rows.length} rows)`);
  console.log(`Results: ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
