/**
 * Phase 80 — Score Exp 1 results.
 *
 * Reads artifacts/runs/exp1/<format>/<model>/<task>/result.json + task.json,
 * extracts LLM answer, scores against ground truth, writes:
 *   artifacts/analysis/exp1-accuracy.json   (per task/format/model accuracy)
 *   artifacts/analysis/exp1-results.json    (hypothesis verdicts, summary)
 *
 * Usage: npx tsx scripts/score.ts [--runs artifacts/runs/exp1] [--out artifacts/analysis]
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeId } from '../lib/schema.js';

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string, def: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1]! : def; };
  return {
    runsDir: get('--runs', 'artifacts/runs/exp1'),
    outDir: get('--out', 'artifacts/analysis'),
  };
}

// Extract JSON {"answer": ...} from LLM response.
function extractAnswer(response: string): unknown {
  // Try to parse JSON block directly
  const jsonMatch = response.match(/\{[^{}]*"answer"\s*:[^{}]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]).answer; } catch {}
  }
  // Try code fence
  const fenceMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]!).answer; } catch {}
  }
  return null;
}

function normalizeStr(s: unknown): string {
  if (typeof s !== 'string') return String(s ?? '');
  return normalizeId(s.trim());
}

function scoreResponse(answer: unknown, groundTruth: unknown, answerType: string): number {
  if (answer === null || answer === undefined) return 0;

  if (answerType === 'exact') {
    return normalizeStr(answer) === normalizeStr(groundTruth) ? 1 : 0;
  }

  if (answerType === 'integer') {
    const a = typeof answer === 'string' ? parseInt(answer, 10) : Number(answer);
    const g = Number(groundTruth);
    return a === g ? 1 : 0;
  }

  if (answerType === 'boolean') {
    const a = typeof answer === 'string' ? answer.toLowerCase() === 'true' : Boolean(answer);
    return a === groundTruth ? 1 : 0;
  }

  if (answerType === 'set') {
    // Ground truth is a set of acceptable answers (any match = correct)
    const gt = Array.isArray(groundTruth) ? groundTruth : [groundTruth];
    const gtNorm = gt.map(normalizeStr);
    const answerNorm = normalizeStr(answer);
    if (gtNorm.includes(answerNorm)) return 1;
    // Also check if answer is a JSON array (for set-type answers)
    if (Array.isArray(answer)) {
      const ansArr = answer.map(normalizeStr).sort();
      const gtArr = gtNorm.sort();
      return JSON.stringify(ansArr) === JSON.stringify(gtArr) ? 1 : 0;
    }
    return 0;
  }

  return 0;
}

interface TaskResult {
  taskId: string;
  format: string;
  model: string;
  taskClass: string;
  taskType: string;
  k: number;
  scores: number[];
  meanScore: number;
  responses: string[];
}

async function main() {
  const opts = parseArgs();

  const results: TaskResult[] = [];

  // Walk runs directory: exp1/<format>/<model>/<task>/
  let formats: string[];
  try { formats = await readdir(opts.runsDir); } catch { console.error('No runs found in:', opts.runsDir); process.exit(1); }

  for (const format of formats) {
    const formatDir = join(opts.runsDir, format);
    let models: string[];
    try { models = await readdir(formatDir); } catch { continue; }

    for (const model of models) {
      const modelDir = join(formatDir, model);
      let taskDirs: string[];
      try { taskDirs = await readdir(modelDir); } catch { continue; }

      for (const taskId of taskDirs) {
        const taskDir = join(modelDir, taskId);
        const resultPath = join(taskDir, 'result.json');
        const taskMetaPath = join(taskDir, 'task.json');

        let resultData: { responses: string[] };
        let taskMeta: { task: { answerType: string; answer: unknown; taskClass: string; taskType: string } };

        try {
          resultData = JSON.parse(await readFile(resultPath, 'utf-8'));
          taskMeta = JSON.parse(await readFile(taskMetaPath, 'utf-8'));
        } catch { continue; }

        const { answerType, answer: groundTruth, taskClass, taskType } = taskMeta.task;
        const scores: number[] = [];

        for (const response of resultData.responses) {
          const extracted = extractAnswer(response);
          scores.push(scoreResponse(extracted, groundTruth, answerType));
        }

        results.push({
          taskId,
          format,
          model,
          taskClass,
          taskType,
          k: scores.length,
          scores,
          meanScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
          responses: resultData.responses,
        });
      }
    }
  }

  console.log(`Scored ${results.length} (task, format, model) combinations`);

  // Summary by format
  const byFormat: Record<string, { sum: number; count: number }> = {};
  const byModel: Record<string, { sum: number; count: number }> = {};
  const byClass: Record<string, { sum: number; count: number }> = {};

  for (const r of results) {
    if (!byFormat[r.format]) byFormat[r.format] = { sum: 0, count: 0 };
    byFormat[r.format]!.sum += r.meanScore;
    byFormat[r.format]!.count++;

    if (!byModel[r.model]) byModel[r.model] = { sum: 0, count: 0 };
    byModel[r.model]!.sum += r.meanScore;
    byModel[r.model]!.count++;

    if (!byClass[r.taskClass]) byClass[r.taskClass] = { sum: 0, count: 0 };
    byClass[r.taskClass]!.sum += r.meanScore;
    byClass[r.taskClass]!.count++;
  }

  const formatAccuracy = Object.fromEntries(
    Object.entries(byFormat).map(([f, { sum, count }]) => [f, count > 0 ? sum / count : 0])
  );
  const modelAccuracy = Object.fromEntries(
    Object.entries(byModel).map(([m, { sum, count }]) => [m, count > 0 ? sum / count : 0])
  );
  const classAccuracy = Object.fromEntries(
    Object.entries(byClass).map(([c, { sum, count }]) => [c, count > 0 ? sum / count : 0])
  );

  console.log('\nAccuracy by format:', JSON.stringify(formatAccuracy, null, 2));
  console.log('Accuracy by model:', JSON.stringify(modelAccuracy, null, 2));
  console.log('Accuracy by task class:', JSON.stringify(classAccuracy, null, 2));

  await mkdir(opts.outDir, { recursive: true });
  await writeFile(join(opts.outDir, 'exp1-accuracy.json'), JSON.stringify({
    generated: new Date().toISOString(),
    totalCombinations: results.length,
    formatAccuracy,
    modelAccuracy,
    classAccuracy,
    details: results.map(r => ({
      taskId: r.taskId,
      format: r.format,
      model: r.model,
      taskClass: r.taskClass,
      taskType: r.taskType,
      k: r.k,
      meanScore: r.meanScore,
      scores: r.scores,
    })),
  }, null, 2));

  // Placeholder hypothesis verdicts (populated after statistical tests in Phase 80)
  const verdicts = {
    note: 'Hypothesis verdicts require statistical tests (Friedman + pairwise Wilcoxon + BH-FDR). Run statistical analysis script.',
    H1: { verdict: 'PENDING', data: formatAccuracy },
    'H-parse': { verdict: 'PENDING', contrast: 'json-edge-list vs json-adjacency' },
    'H-pretrain': { verdict: 'PENDING', contrast: 'json-edge-list vs custom-dsl (Custom-DSL confirmed simpler)' },
    'H-dense': { verdict: 'PENDING', contrast: 'haskell-adt vs json-edge-list (token-adjusted)' },
    'H-interact': { verdict: 'PENDING', test: 'format × task-class interaction term' },
    'H-attribution': { verdict: 'PENDING', test: 'regression accuracy ~ parsing_burden + tokens + local_density' },
  };

  await writeFile(join(opts.outDir, 'exp1-results.json'), JSON.stringify({
    generated: new Date().toISOString(),
    status: 'PARTIAL — scoring complete, statistical tests pending',
    verdicts,
  }, null, 2));

  console.log('\nWritten:', opts.outDir);
}

main().catch(e => { console.error(e); process.exit(1); });
