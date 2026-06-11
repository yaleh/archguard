/**
 * Stage 67.1 — Strong-version leak probe (v2.2)
 *
 * Tests whether LLM models have memorised ArchGuard's call graph by asking a
 * specific structural question with a known ground-truth answer.
 *
 * Pre-registered probe question (plan §Stage 67.1):
 *   "请列举直接调用 `MermaidGenerator` 类（或 `ValidatedMermaidGenerator`）的调用方法
 *    （格式：`ClassName.methodName`，逗号分隔）"
 *
 * GT (from callgraph.json kind='call', external callers only):
 *   MermaidDiagramGenerator.generateOnly  (1 entity)
 *
 * Verdict threshold: F1 ≥ 0.5 → LEAK
 *
 * Usage: LLM_BASE_URL=... LLM_API_KEY=... npx tsx leak-probe-v2.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLlmClient } from './lib/llm-client.js';
import { getEnv } from './lib/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODELS = [
  { name: 'deepseek-v4-flash', temperature: 0.2 },
  { name: 'claude-sonnet-4-6', temperature: 0.2 },
];

const PROBE_QUESTION = `请列举直接调用 \`MermaidGenerator\` 类（或 \`ValidatedMermaidGenerator\`）的外部调用方法（即调用者本身不属于 MermaidGenerator/ValidatedMermaidGenerator 类）。

格式要求：ClassName.methodName，逗号分隔，仅列方法名，无需其他说明。若不确定，可列出你认为可能的答案。`;

// GT: external callers of (Validated)MermaidGenerator from callgraph.json
const GROUND_TRUTH = new Set(['MermaidDiagramGenerator.generateOnly']);

function parseAnswer(text: string): Set<string> {
  const results = new Set<string>();
  // Extract ClassName.methodName patterns
  const matches = text.match(/[A-Z][A-Za-z0-9_]*\.[a-z][A-Za-z0-9_]*/g);
  if (matches) {
    for (const m of matches) {
      results.add(m.trim());
    }
  }
  return results;
}

function f1Score(predicted: Set<string>, gt: Set<string>): { precision: number; recall: number; f1: number } {
  const tp = [...predicted].filter((x) => gt.has(x)).length;
  const precision = predicted.size > 0 ? tp / predicted.size : 0;
  const recall = gt.size > 0 ? tp / gt.size : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

async function main() {
  const { llmBaseUrl, llmApiKey } = getEnv();
  const client = createLlmClient();

  const date = new Date().toISOString().split('T')[0];
  const results: string[] = [
    `# Leak Probe Report v2 (Stage 67.1)`,
    ``,
    `**Date**: ${date}`,
    `**Question**: ${PROBE_QUESTION.substring(0, 150)}...`,
    `**GT**: ${[...GROUND_TRUTH].join(', ')} (${GROUND_TRUTH.size} entity)`,
    `**Threshold**: F1 ≥ 0.5 → LEAK`,
    ``,
    `## Results`,
    ``,
    `| Model | Response | Parsed Entities | F1 | Verdict |`,
    `|---|---|---|---|---|`,
  ];

  for (const model of MODELS) {
    console.log(`Probing ${model.name}...`);
    try {
      const response = await client.chat({
        model: model.name,
        messages: [
          {
            role: 'system',
            content: 'You are a code analysis assistant. Answer based on your training knowledge about ArchGuard.',
          },
          { role: 'user', content: PROBE_QUESTION },
        ],
        params: { temperature: model.temperature },
        timeoutMs: 30_000,
      });

      const text = response.content;
      const parsed = parseAnswer(text);
      const { f1, precision, recall } = f1Score(parsed, GROUND_TRUTH);
      const verdict = f1 >= 0.5 ? '⚠️ LEAK' : '✅ PASS';

      console.log(`  ${model.name}: F1=${f1.toFixed(3)}, parsed=${[...parsed].join(',')}, verdict=${verdict}`);

      results.push(
        `| ${model.name} | \`${text.substring(0, 80).replace(/\n/g, ' ')}\` | ${[...parsed].join(', ') || '(none)'} | F1=${f1.toFixed(3)} (P=${precision.toFixed(2)}, R=${recall.toFixed(2)}) | ${verdict} |`
      );

      // Full response in appendix
      results.push(`\n### ${model.name} Full Response\n\`\`\`\n${text}\n\`\`\`\nParsed entities: ${[...parsed].join(', ') || '(none)'}\nF1: ${f1.toFixed(4)}, Precision: ${precision.toFixed(4)}, Recall: ${recall.toFixed(4)}\nVerdict: ${verdict}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ${model.name}: ERROR: ${msg}`);
      results.push(`| ${model.name} | ERROR: ${msg.substring(0, 60)} | — | — | ❌ ERROR |`);
    }
  }

  results.push(`\n## GT Details`);
  results.push(`Ground truth from \`artifacts/gt/callgraph.json\` (kind='call', external callers only):`);
  for (const gt of GROUND_TRUTH) {
    results.push(`- \`${gt}\``);
  }
  results.push(``);
  results.push(`**Overall Verdict**: If any model has F1 ≥ 0.5, ArchGuard must not be used as a scoring subject (demoted to reference-only per plan §Stage 67.1).`);

  const outPath = path.join(__dirname, 'artifacts/gt/leak-probe-v2.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, results.join('\n'), 'utf-8');
  console.log(`Written: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
