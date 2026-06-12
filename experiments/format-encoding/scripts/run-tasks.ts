/**
 * Phase 78.1 — Exp 1 full run: 8 formats × task set × answer models × k=5.
 *
 * Usage:
 *   npx tsx scripts/run-tasks.ts <archJson.json> [--tasks artifacts/tasks.json]
 *     [--models haiku,glm] [--formats all] [--k 5] [--out artifacts/runs/exp1]
 *
 * Credentials via LLM_BASE_URL + LLM_API_KEY env vars (fail-fast if missing).
 * Checkpoint/resume by (task_id, format, model, k_idx) — skips existing result files.
 * max_tokens=8192 per plan Phase 78.1.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { archJsonToC } from '../lib/corpus.js';
import { createLlmClient } from '../lib/llm-client.js';
import type { TaskDef } from './generate-tasks.js';
import type { C } from '../lib/schema.js';

import { render as renderJsonAdj }   from '../renderers/json-adjacency.js';
import { render as renderJsonEdge }  from '../renderers/json-edge-list.js';
import { render as renderYaml }      from '../renderers/yaml.js';
import { render as renderMd }        from '../renderers/markdown-table.js';
import { render as renderMermaid }   from '../renderers/mermaid.js';
import { render as renderHaskell }   from '../renderers/haskell-adt.js';
import { render as renderDsl }       from '../renderers/custom-dsl.js';
import { render as renderNl }        from '../renderers/nl-exhaustive.js';

const FORMAT_RENDERERS: Record<string, (c: C) => string> = {
  'json-adjacency': renderJsonAdj,
  'json-edge-list': renderJsonEdge,
  'yaml': renderYaml,
  'markdown-table': renderMd,
  'mermaid': renderMermaid,
  'haskell-adt': renderHaskell,
  'custom-dsl': renderDsl,
  'nl-exhaustive': renderNl,
};

const ALL_FORMATS = Object.keys(FORMAT_RENDERERS);

// Pre-registered model configs per plan Phase 74 (pre-freeze-decisions.md)
const MODEL_CONFIGS: Record<string, Record<string, unknown>> = {
  'claude-haiku-4-5-20251001': { temperature: 0, max_tokens: 8192 },
  'glm-4.5-flash': { temperature: 0, max_tokens: 8192 },
};

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1]! : def;
  };
  const corpusPath = argv.find(a => !a.startsWith('-')) ?? '';
  return {
    corpusPath,
    tasksPath: get('--tasks', 'artifacts/tasks.json'),
    models: get('--models', 'claude-haiku-4-5-20251001').split(','),
    formats: get('--formats', 'all') === 'all' ? ALL_FORMATS : get('--formats', 'all').split(','),
    k: parseInt(get('--k', '5'), 10),
    outDir: get('--out', 'artifacts/runs/exp1'),
  };
}

function buildPrompt(representation: string, taskPrompt: string): string {
  return `Here is an architecture description:\n\n${representation}\n\n${taskPrompt}`;
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
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
    console.log(`  [SKIP] ${resultPath.split('/').slice(-3).join('/')}`);
    return existing;
  }

  const responses: string[] = [];
  let promptTokens = 0;
  let completionTokens = 0;

  for (let i = 0; i < k; i++) {
    const res = await llm.chat({
      model,
      messages: [{ role: 'user', content: prompt }],
      params: MODEL_CONFIGS[model] ?? { temperature: 0, max_tokens: 8192 },
      timeoutMs: 300_000, // 5 min — large prompts (65K+ tokens) need more time
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
    console.error('Usage: tsx scripts/run-tasks.ts <archJson.json> [options]');
    process.exit(1);
  }

  const raw = JSON.parse(await readFile(opts.corpusPath, 'utf-8'));
  const c = archJsonToC(raw as Parameters<typeof archJsonToC>[0]);
  const tasks: TaskDef[] = JSON.parse(await readFile(opts.tasksPath, 'utf-8'));

  console.log(`Corpus: ${c.entities.length} entities, ${c.relations.length} relations`);
  console.log(`Tasks: ${tasks.length} | Formats: ${opts.formats.length} | Models: ${opts.models.join(', ')} | k=${opts.k}`);
  console.log(`Expected calls: ${tasks.length * opts.formats.length * opts.models.length * opts.k}`);

  const llm = createLlmClient();

  for (const format of opts.formats) {
    const renderer = FORMAT_RENDERERS[format];
    if (!renderer) { console.warn(`Unknown format: ${format}`); continue; }
    const representation = renderer(c);
    console.log(`\n[Format: ${format}] (${representation.length} chars)`);

    for (const model of opts.models) {
      for (const task of tasks) {
        const prompt = buildPrompt(representation, task.prompt);
        const taskDir = join(opts.outDir, format, model, task.id);
        await mkdir(taskDir, { recursive: true });
        const resultPath = join(taskDir, 'result.json');

        process.stdout.write(`  ${model} / ${task.id} `);
        await runTask(llm, model, prompt, opts.k, resultPath);

        // Also save task metadata alongside result for scoring
        const metaPath = join(taskDir, 'task.json');
        if (!(await fileExists(metaPath))) {
          await writeFile(metaPath, JSON.stringify({ task, format, model }, null, 2));
        }
      }
    }
  }

  console.log('\nDone. Results in:', opts.outDir);
}

main().catch(e => { console.error(e); process.exit(1); });
