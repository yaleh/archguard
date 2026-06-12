/**
 * Phase 79.1 — Exp 2 Answer Tasks
 *
 * Runs answer tasks on 5 Exp 2 arms:
 *   1. deterministic-haskell  — rendered by haskell-adt renderer
 *   2. rewrite-haskell        — from exp2-rewrite/rewrite-haskell.json (roundtrip-pass only)
 *   3. rewrite-json           — from exp2-rewrite/rewrite-json.json (roundtrip-pass only)
 *   4. rewrite-clean-prose    — from exp2-rewrite/rewrite-clean-prose.json (human-sample)
 *   5. baseline               — NL-exhaustive (reuse from Exp 1 if available)
 *
 * Usage:
 *   export LLM_BASE_URL=... LLM_API_KEY=...
 *   npx tsx scripts/run-exp2-answers.ts <archJson.json>
 *     [--rewrite artifacts/runs/exp2-rewrite] [--exp1 artifacts/runs/exp1]
 *     [--tasks artifacts/tasks.json] [--models haiku,glm] [--k 5]
 *     [--out artifacts/runs/exp2-answers]
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archJsonToC } from '../lib/corpus.js';
import { createLlmClient } from '../lib/llm-client.js';
import type { TaskDef } from './generate-tasks.js';
import type { C } from '../lib/schema.js';
import { render as renderHaskell } from '../renderers/haskell-adt.js';
import { render as renderNl } from '../renderers/nl-exhaustive.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const MODEL_CONFIGS: Record<string, Record<string, unknown>> = {
  'claude-haiku-4-5-20251001': { temperature: 0, max_tokens: 8192 },
  'glm-4.5-flash': { temperature: 0, max_tokens: 8192 },
};

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string, def: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1]! : def; };
  const corpusPath = argv.find(a => !a.startsWith('-')) ?? '';
  return {
    corpusPath,
    rewriteDir: get('--rewrite', join(ROOT, 'artifacts/runs/exp2-rewrite')),
    exp1Dir: get('--exp1', join(ROOT, 'artifacts/runs/exp1')),
    tasksPath: get('--tasks', join(ROOT, 'artifacts/tasks.json')),
    models: get('--models', 'claude-haiku-4-5-20251001').split(','),
    k: parseInt(get('--k', '5'), 10),
    outDir: get('--out', join(ROOT, 'artifacts/runs/exp2-answers')),
  };
}

function buildPrompt(representation: string, taskPrompt: string): string {
  return `Here is an architecture description:\n\n${representation}\n\n${taskPrompt}`;
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

interface RewriteResultFile {
  armId: string;
  responses: string[];
  roundtripResults: Array<{ pass: boolean; parseError: string | null; hInfoTriggered: boolean }>;
}

// Select the first roundtrip-passing rewrite, or null if none pass.
async function loadRewriteRepresentation(rewriteDir: string, armId: string): Promise<string | null> {
  const resultPath = join(rewriteDir, `${armId}.json`);
  if (!(await fileExists(resultPath))) return null;
  const data: RewriteResultFile = JSON.parse(await readFile(resultPath, 'utf-8'));
  for (let i = 0; i < data.responses.length; i++) {
    const rt = data.roundtripResults[i];
    if (rt?.pass) return data.responses[i]!;
  }
  return null; // No roundtrip-passing instance
}

async function runTask(
  llm: ReturnType<typeof createLlmClient>,
  model: string,
  prompt: string,
  k: number,
  resultPath: string,
): Promise<{ responses: string[]; promptTokens: number; completionTokens: number }> {
  if (await fileExists(resultPath)) {
    const existing = JSON.parse(await readFile(resultPath, 'utf-8'));
    console.log(`  [SKIP]`);
    return existing;
  }
  const responses: string[] = [];
  let promptTokens = 0, completionTokens = 0;
  for (let i = 0; i < k; i++) {
    const res = await llm.chat({
      model,
      messages: [{ role: 'user', content: prompt }],
      params: MODEL_CONFIGS[model] ?? { temperature: 0, max_tokens: 8192 },
    });
    responses.push(res.content);
    promptTokens += res.promptTokens;
    completionTokens += res.completionTokens;
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  const result = { responses, promptTokens, completionTokens };
  await writeFile(resultPath, JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const opts = parseArgs();
  if (!opts.corpusPath) {
    console.error('Usage: tsx scripts/run-exp2-answers.ts <archJson.json> [options]');
    process.exit(1);
  }

  const raw = JSON.parse(await readFile(opts.corpusPath, 'utf-8'));
  const c = archJsonToC(raw as Parameters<typeof archJsonToC>[0]);
  const tasks: TaskDef[] = JSON.parse(await readFile(opts.tasksPath, 'utf-8'));

  const llm = createLlmClient();

  // Build arm representations
  const deterministicHaskell = renderHaskell(c);
  const nlExhaustive = renderNl(c);

  const rewriteHaskell = await loadRewriteRepresentation(opts.rewriteDir, 'rewrite-haskell');
  const rewriteJson = await loadRewriteRepresentation(opts.rewriteDir, 'rewrite-json');
  const rewriteCleanProse = await loadRewriteRepresentation(opts.rewriteDir, 'rewrite-clean-prose');

  const ARMS: Array<{ id: string; representation: string | null; note?: string }> = [
    { id: 'deterministic-haskell', representation: deterministicHaskell },
    { id: 'rewrite-haskell', representation: rewriteHaskell, note: rewriteHaskell ? undefined : 'NO_ROUNDTRIP_PASS — skipped' },
    { id: 'rewrite-json', representation: rewriteJson, note: rewriteJson ? undefined : 'NO_ROUNDTRIP_PASS — skipped' },
    { id: 'rewrite-clean-prose', representation: rewriteCleanProse, note: 'human-sample arm (Q5)' },
    { id: 'baseline-nl-exhaustive', representation: nlExhaustive },
  ];

  console.log('Arm availability:');
  for (const arm of ARMS) {
    console.log(`  ${arm.id}: ${arm.representation ? `${arm.representation.length} chars` : 'UNAVAILABLE'} ${arm.note ? `(${arm.note})` : ''}`);
  }

  for (const arm of ARMS) {
    if (!arm.representation) {
      console.log(`\n[SKIP arm: ${arm.id}] no roundtrip-passing rewrite available`);
      continue;
    }

    console.log(`\n[Arm: ${arm.id}]`);

    for (const model of opts.models) {
      for (const task of tasks) {
        const prompt = buildPrompt(arm.representation, task.prompt);
        const taskDir = join(opts.outDir, arm.id, model, task.id);
        await mkdir(taskDir, { recursive: true });
        const resultPath = join(taskDir, 'result.json');

        process.stdout.write(`  ${model} / ${task.id} `);
        await runTask(llm, model, prompt, opts.k, resultPath);

        const metaPath = join(taskDir, 'task.json');
        if (!(await fileExists(metaPath))) {
          await writeFile(metaPath, JSON.stringify({ task, arm: arm.id, model, note: arm.note }, null, 2));
        }
      }
    }
  }

  console.log('\nDone. Results in:', opts.outDir);
}

main().catch(e => { console.error(e); process.exit(1); });
