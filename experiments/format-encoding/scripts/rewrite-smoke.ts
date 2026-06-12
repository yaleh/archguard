/**
 * Phase 76.2 — Rewrite Prompt Smoke Test
 *
 * Sends k=1 rewrite request per arm to the rewrite model, then runs
 * p_f(rewrite_output) == C roundtrip check via diff.ts.
 *
 * Usage:
 *   export LLM_BASE_URL=... LLM_API_KEY=...
 *   npx tsx scripts/rewrite-smoke.ts <archJson.json>
 *     [--model deepseek-v4-flash] [--out artifacts/roundtrip/rewrite-smoke.md]
 *
 * Credentials via LLM_BASE_URL + LLM_API_KEY only (fail-fast if missing).
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
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
}

const ARMS: ArmConfig[] = [
  {
    id: 'rewrite-haskell',
    label: 'NL-Exhaustive → Haskell-ADT',
    promptFile: join(ROOT, 'freeze/rewrite-prompts/rewrite-haskell.md'),
    parse: parseHaskell,
  },
  {
    id: 'rewrite-json',
    label: 'NL-Exhaustive → JSON-Edge-List',
    promptFile: join(ROOT, 'freeze/rewrite-prompts/rewrite-json.md'),
    parse: parseJson,
  },
  {
    id: 'rewrite-clean-prose',
    label: 'NL-Exhaustive → Clean Prose',
    promptFile: join(ROOT, 'freeze/rewrite-prompts/rewrite-clean-prose.md'),
    parse: parseNl,
  },
];

// Extract the prompt template from the frozen prompt file (between --- delimiters).
function extractPromptTemplate(promptFileContent: string): string {
  const match = promptFileContent.match(/---\n([\s\S]*?)\n---/);
  if (!match) throw new Error('Could not extract prompt from file (no --- delimiters found)');
  return match[1]!.trim();
}

function fillPrompt(template: string, input: string): string {
  return template.replace('{{INPUT}}', input);
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1]! : def;
  };
  const corpusPath = argv.find(a => !a.startsWith('-')) ?? '';
  return {
    corpusPath,
    model: get('--model', 'deepseek-v4-flash'),
    outPath: get('--out', join(ROOT, 'artifacts/roundtrip/rewrite-smoke.md')),
  };
}

interface SmokeResult {
  armId: string;
  armLabel: string;
  model: string;
  nlInput: string;
  rewriteOutput: string;
  parseError: string | null;
  roundtripPass: boolean;
  deviationCount: number;
  deviations: string[];
  hInfoTriggered: boolean;
}

async function main() {
  const opts = parseArgs();
  if (!opts.corpusPath) {
    console.error('Usage: tsx scripts/rewrite-smoke.ts <archJson.json> [--model <model>] [--out <path>]');
    process.exit(1);
  }

  const llm = createLlmClient();

  const raw = JSON.parse(await readFile(opts.corpusPath, 'utf-8'));
  const c = archJsonToC(raw as Parameters<typeof archJsonToC>[0]);

  // Use a small slice for smoke test — take first 10 entities, relations among them
  const smokeEntityIds = new Set(c.entities.slice(0, 10).map(e => e.id));
  const smokeC: C = {
    entities: c.entities.filter(e => smokeEntityIds.has(e.id)),
    relations: c.relations.filter(r => smokeEntityIds.has(r.from) && smokeEntityIds.has(r.to)),
  };

  console.log(`Smoke corpus: ${smokeC.entities.length} entities, ${smokeC.relations.length} relations`);

  const nlInput = renderNl(smokeC);
  const results: SmokeResult[] = [];

  for (const arm of ARMS) {
    console.log(`\n[${arm.id}] sending rewrite request to ${opts.model}...`);
    const promptFile = await readFile(arm.promptFile, 'utf-8');
    const template = extractPromptTemplate(promptFile);
    const prompt = fillPrompt(template, nlInput);

    let rewriteOutput = '';
    let parseError: string | null = null;
    let parsedC: C | null = null;

    try {
      const res = await llm.chat({
        model: opts.model,
        messages: [{ role: 'user', content: prompt }],
        params: { temperature: 0, max_tokens: 8192 },
      });
      rewriteOutput = res.content;
      console.log(`  response: ${rewriteOutput.length} chars`);
    } catch (err) {
      parseError = `LLM call failed: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`  ERROR: ${parseError}`);
    }

    if (rewriteOutput && !parseError) {
      try {
        parsedC = arm.parse(rewriteOutput);
      } catch (err) {
        parseError = `Parse failed: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`  PARSE ERROR: ${parseError}`);
      }
    }

    const diffResult = parsedC ? diffC(smokeC, parsedC) : null;
    const roundtripPass = diffResult?.equal ?? false;
    const deviations = diffResult?.deviations.map(d => d.description) ?? [];

    // H-info check: added entities or relations not in original
    let hInfoTriggered = false;
    if (parsedC) {
      const origIds = new Set(smokeC.entities.map(e => e.id));
      const addedEntities = parsedC.entities.filter(e => !origIds.has(e.id));
      const origRels = new Set(smokeC.relations.map(r => `${r.from}|${r.to}|${r.type}`));
      const addedRels = parsedC.relations.filter(r => !origRels.has(`${r.from}|${r.to}|${r.type}`));
      hInfoTriggered = addedEntities.length > 0 || addedRels.length > 0;
    }

    console.log(`  roundtrip: ${roundtripPass ? 'PASS' : 'FAIL'} (${deviations.length} deviations)`);
    if (hInfoTriggered) console.log(`  H-INFO TRIGGERED: model added entities/relations not in original!`);

    results.push({
      armId: arm.id,
      armLabel: arm.label,
      model: opts.model,
      nlInput: nlInput.slice(0, 500) + (nlInput.length > 500 ? '...' : ''),
      rewriteOutput: rewriteOutput.slice(0, 2000) + (rewriteOutput.length > 2000 ? '...' : ''),
      parseError,
      roundtripPass,
      deviationCount: deviations.length,
      deviations: deviations.slice(0, 5),
      hInfoTriggered,
    });
  }

  // Generate report
  // Clean-prose arm has no deterministic parser (Q5 decision: 10% human sample) — expected fail
  const allPass = results.every(r => r.armId === 'rewrite-clean-prose' ? true : r.roundtripPass);
  const anyHInfo = results.some(r => r.hInfoTriggered);

  const lines: string[] = [
    '# Phase 76.2 — Rewrite Prompt Smoke Test',
    '',
    `**Status: ${allPass && !anyHInfo ? 'PASS' : 'FAIL'}**`,
    `**Date**: ${new Date().toISOString()}`,
    `**Rewrite model**: ${opts.model}`,
    `**Corpus**: ${smokeC.entities.length} entities, ${smokeC.relations.length} relations (first-10 slice)`,
    '',
    '## Summary',
    '',
    '| Arm | Roundtrip | Parse Error | H-info Triggered | Deviations |',
    '|---|---|---|---|---|',
    ...results.map(r =>
      `| ${r.armLabel} | ${r.roundtripPass ? '✓ PASS' : '✗ FAIL'} | ${r.parseError ? r.parseError.slice(0, 60) : '—'} | ${r.hInfoTriggered ? '⚠ YES' : 'No'} | ${r.deviationCount} |`
    ),
    '',
    '## Protocol Deviation Log',
    '',
    '**D-76.2**: Planned rewrite model `qwen3-235b-a22b` unavailable on gateway (`/v1/models` returns 404 for this ID).',
    `Replacement: \`${opts.model}\` (DeepSeek family — satisfies cross-family requirement vs Claude + Zhipu answer models).`,
    'Impact: Minor — model capability tier similar; cross-family isolation maintained.',
    'Resolution: Use deepseek-v4-flash as rewrite model for all Exp 2 arms.',
    '',
  ];

  for (const r of results) {
    lines.push(`## Arm: ${r.armLabel}`);
    lines.push('');
    lines.push(`**Roundtrip**: ${r.roundtripPass ? 'PASS' : 'FAIL'}`);
    lines.push(`**H-info triggered**: ${r.hInfoTriggered ? 'YES — deviations recorded' : 'No'}`);
    if (r.parseError) lines.push(`**Parse error**: ${r.parseError}`);
    lines.push(`**Deviations**: ${r.deviationCount}`);
    if (r.deviations.length > 0) {
      lines.push('');
      lines.push('Top deviations:');
      for (const d of r.deviations) lines.push(`- ${d}`);
    }
    lines.push('');
    lines.push('<details>');
    lines.push('<summary>Rewrite output (first 2000 chars)</summary>');
    lines.push('');
    lines.push('```');
    lines.push(r.rewriteOutput);
    lines.push('```');
    lines.push('</details>');
    lines.push('');
  }

  const report = lines.join('\n');
  await writeFile(opts.outPath, report);
  console.log(`\nReport written: ${opts.outPath}`);
  console.log(`Overall status: ${allPass && !anyHInfo ? 'PASS' : 'FAIL'}`);
}

main().catch(e => { console.error(e); process.exit(1); });
