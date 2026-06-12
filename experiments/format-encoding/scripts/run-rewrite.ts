/**
 * Phase 78.2 — Exp 2 Rewrite Step
 *
 * Runs 3 rewrite arms (rewrite-Haskell, rewrite-JSON, rewrite-CleanProse)
 * against the NL-exhaustive rendering of each C instance.
 * Then runs p_f(rewrite_output) == C roundtrip check.
 * H-info instances (C' != C) are separated out.
 *
 * Usage:
 *   export LLM_BASE_URL=... LLM_API_KEY=...
 *   npx tsx scripts/run-rewrite.ts <archJson.json>
 *     [--model deepseek-v4-flash] [--k 3] [--out artifacts/runs/exp2-rewrite]
 *
 * Credentials via LLM_BASE_URL + LLM_API_KEY only (fail-fast if missing).
 * Checkpoint/resume by (arm, k_idx): skips existing result files.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archJsonToC } from '../lib/corpus.js';
import { createLlmClient } from '../lib/llm-client.js';
import { diffC } from '../lib/diff.js';
import type { C } from '../lib/schema.js';
import { render as renderNl } from '../renderers/nl-exhaustive.js';
import { parse as parseHaskell } from '../parsers/haskell-adt.js';
import { parse as parseJson } from '../parsers/json-edge-list.js';
import { parse as parseNl } from '../parsers/nl-exhaustive.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

interface ArmConfig {
  id: string;
  label: string;
  promptFile: string;
  parse: (text: string) => C;
  humanSampleOnly: boolean; // Q5: clean-prose has no deterministic parser
}

const ARMS: ArmConfig[] = [
  {
    id: 'rewrite-haskell',
    label: 'NL-Exhaustive → Haskell-ADT',
    promptFile: join(ROOT, 'freeze/rewrite-prompts/rewrite-haskell.md'),
    parse: parseHaskell,
    humanSampleOnly: false,
  },
  {
    id: 'rewrite-json',
    label: 'NL-Exhaustive → JSON-Edge-List',
    promptFile: join(ROOT, 'freeze/rewrite-prompts/rewrite-json.md'),
    parse: parseJson,
    humanSampleOnly: false,
  },
  {
    id: 'rewrite-clean-prose',
    label: 'NL-Exhaustive → Clean Prose',
    promptFile: join(ROOT, 'freeze/rewrite-prompts/rewrite-clean-prose.md'),
    parse: parseNl,
    humanSampleOnly: true, // Q5 decision: 10% human sample, no deterministic parser
  },
];

function extractPromptTemplate(content: string): string {
  const match = content.match(/---\n([\s\S]*?)\n---/);
  if (!match) throw new Error('Could not extract prompt template (no --- delimiters)');
  return match[1]!.trim();
}

function fillPrompt(template: string, input: string): string {
  return template.replace('{{INPUT}}', input);
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string, def: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1]! : def; };
  const corpusPath = argv.find(a => !a.startsWith('-')) ?? '';
  return {
    corpusPath,
    model: get('--model', 'deepseek-v4-flash'),
    k: parseInt(get('--k', '3'), 10),
    outDir: get('--out', join(ROOT, 'artifacts/runs/exp2-rewrite')),
  };
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

interface RewriteResult {
  armId: string;
  armLabel: string;
  model: string;
  k: number;
  responses: string[];
  roundtripResults: Array<{
    pass: boolean;
    parseError: string | null;
    deviationCount: number;
    hInfoTriggered: boolean;
  }>;
  promptTokens: number;
  completionTokens: number;
}

async function runArmRewrites(
  llm: ReturnType<typeof createLlmClient>,
  arm: ArmConfig,
  c: C,
  nlInput: string,
  model: string,
  k: number,
  resultPath: string,
): Promise<RewriteResult> {
  if (await fileExists(resultPath)) {
    const existing = JSON.parse(await readFile(resultPath, 'utf-8'));
    console.log(`  [SKIP] ${arm.id}`);
    return existing;
  }

  const promptFile = await readFile(arm.promptFile, 'utf-8');
  const template = extractPromptTemplate(promptFile);
  const prompt = fillPrompt(template, nlInput);

  const responses: string[] = [];
  const roundtripResults: RewriteResult['roundtripResults'] = [];
  let promptTokens = 0;
  let completionTokens = 0;

  for (let i = 0; i < k; i++) {
    const res = await llm.chat({
      model,
      messages: [{ role: 'user', content: prompt }],
      params: { temperature: 0, max_tokens: 8192 },
    });
    responses.push(res.content);
    promptTokens += res.promptTokens;
    completionTokens += res.completionTokens;
    process.stdout.write('.');

    // Roundtrip check (skip for human-sample-only arms)
    if (arm.humanSampleOnly) {
      roundtripResults.push({ pass: false, parseError: 'human-sample-only (Q5)', deviationCount: 0, hInfoTriggered: false });
    } else {
      let parsedC: C | null = null;
      let parseError: string | null = null;
      try { parsedC = arm.parse(res.content); } catch (e) { parseError = (e as Error).message; }

      if (parsedC) {
        const diff = diffC(c, parsedC);
        const origIds = new Set(c.entities.map(e => e.id));
        const addedEntities = parsedC.entities.filter(e => !origIds.has(e.id));
        const origRels = new Set(c.relations.map(r => `${r.from}|${r.to}|${r.type}`));
        const addedRels = parsedC.relations.filter(r => !origRels.has(`${r.from}|${r.to}|${r.type}`));
        roundtripResults.push({
          pass: diff.equal,
          parseError: null,
          deviationCount: diff.deviations.length,
          hInfoTriggered: addedEntities.length > 0 || addedRels.length > 0,
        });
      } else {
        roundtripResults.push({ pass: false, parseError, deviationCount: 0, hInfoTriggered: false });
      }
    }
  }
  process.stdout.write('\n');

  const result: RewriteResult = {
    armId: arm.id,
    armLabel: arm.label,
    model,
    k,
    responses,
    roundtripResults,
    promptTokens,
    completionTokens,
  };
  await writeFile(resultPath, JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const opts = parseArgs();
  if (!opts.corpusPath) {
    console.error('Usage: tsx scripts/run-rewrite.ts <archJson.json> [--model <model>] [--k <k>] [--out <dir>]');
    process.exit(1);
  }

  const raw = JSON.parse(await readFile(opts.corpusPath, 'utf-8'));
  const c = archJsonToC(raw as Parameters<typeof archJsonToC>[0]);
  console.log(`Corpus: ${c.entities.length} entities, ${c.relations.length} relations`);

  const nlInput = renderNl(c);
  const llm = createLlmClient();

  await mkdir(opts.outDir, { recursive: true });

  const results: RewriteResult[] = [];

  for (const arm of ARMS) {
    const resultPath = join(opts.outDir, `${arm.id}.json`);
    console.log(`\n[${arm.id}] model=${opts.model} k=${opts.k}`);
    const result = await runArmRewrites(llm, arm, c, nlInput, opts.model, opts.k, resultPath);
    results.push(result);

    const passCount = result.roundtripResults.filter(r => r.pass).length;
    const hInfoCount = result.roundtripResults.filter(r => r.hInfoTriggered).length;
    console.log(`  roundtrip: ${passCount}/${result.roundtripResults.length} pass, ${hInfoCount} H-info`);
  }

  // Build H-info instance list
  const hInfoInstances: Array<{ armId: string; rewriteIdx: number; hInfoTriggered: boolean; pass: boolean }> = [];
  for (const r of results) {
    for (let i = 0; i < r.roundtripResults.length; i++) {
      const rt = r.roundtripResults[i]!;
      if (!rt.pass || rt.hInfoTriggered) {
        hInfoInstances.push({ armId: r.armId, rewriteIdx: i, hInfoTriggered: rt.hInfoTriggered, pass: rt.pass });
      }
    }
  }

  await writeFile(
    join(opts.outDir, 'h-info-instances.json'),
    JSON.stringify({ generated: new Date().toISOString(), hInfoInstances }, null, 2),
  );

  console.log(`\nDone. H-info instances: ${hInfoInstances.length}`);
  console.log(`Results in: ${opts.outDir}`);
}

main().catch(e => { console.error(e); process.exit(1); });
