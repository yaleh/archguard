/**
 * GLM timeout diagnostic probe.
 * Tests glm-4.5-flash on prompts of increasing size to find the reliable timeout threshold.
 * Also compares thinking:enabled vs thinking:disabled (zero_think).
 *
 * Usage:
 *   npx tsx scripts/probe-glm.ts
 *
 * Credentials via LLM_BASE_URL + LLM_API_KEY env vars (fail-fast).
 */
import { readFile } from 'node:fs/promises';
import { archJsonToC } from '../lib/corpus.js';
import { getLLMBaseUrl, getLLMApiKey, validateEnv } from '../lib/env.js';

import { render as renderMd }     from '../renderers/markdown-table.js';
import { render as renderNl }     from '../renderers/nl-exhaustive.js';
import { render as renderYaml }   from '../renderers/yaml.js';
import { render as renderJsonAdj } from '../renderers/json-adjacency.js';

const TASK_PROMPT = 'How many entities are in this graph? Reply with just the number.';
const MODEL = 'glm-4.5-flash';
const TIMEOUT_MS = 120_000; // 2 min per call — same as original D-78.1 context

async function callGLM(
  prompt: string,
  extraBody: Record<string, unknown> = {},
  label: string,
): Promise<{ ms: number; tokens: number; content: string; error?: string }> {
  validateEnv();
  const url = `${getLLMBaseUrl().replace(/\/+$/, '')}/v1/chat/completions`;
  const body = JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 64,
    ...extraBody,
  });

  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${getLLMApiKey()}` },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const ms = Date.now() - start;
    if (!res.ok) {
      const text = await res.text();
      return { ms, tokens: 0, content: '', error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      ms,
      tokens: json.usage?.prompt_tokens ?? -1,
      content: json.choices?.[0]?.message?.content ?? '(empty)',
    };
  } catch (err) {
    clearTimeout(timer);
    const ms = Date.now() - start;
    return { ms, tokens: 0, content: '', error: String(err) };
  }
}

async function main() {
  const corpusPath = '/home/yale/work/archguard/.archguard/output/archguard/class/all-classes.json';
  const raw = JSON.parse(await readFile(corpusPath, 'utf-8'));
  const c = archJsonToC(raw as Parameters<typeof archJsonToC>[0]);

  const formats = [
    { name: 'markdown-table', render: renderMd },
    { name: 'nl-exhaustive',  render: renderNl },
    { name: 'yaml',           render: renderYaml },
    { name: 'json-adjacency', render: renderJsonAdj },
  ] as const;

  console.log(`Model: ${MODEL}`);
  console.log(`Timeout: ${TIMEOUT_MS / 1000}s per call`);
  console.log(`Task: "${TASK_PROMPT}"`);
  console.log('');
  console.log('Format              Tokens  Thinking  Elapsed   Result');
  console.log('─'.repeat(70));

  for (const { name, render } of formats) {
    const repr = render(c);
    const prompt = `Here is an architecture description:\n\n${repr}\n\n${TASK_PROMPT}`;
    const promptTokensApprox = Math.round(prompt.length / 4); // rough estimate

    // Test 1: default (no thinking override)
    {
      const r = await callGLM(prompt, {}, name);
      const status = r.error ? `ERROR: ${r.error.slice(0, 60)}` : `OK: "${r.content.trim().slice(0, 40)}"`;
      console.log(`${name.padEnd(20)} ~${promptTokensApprox.toString().padStart(6)}  default   ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${status}`);
    }

    // Test 2: thinking disabled (zero_think via extra_body)
    {
      const r = await callGLM(prompt, { extra_body: { thinking: { type: 'disabled' } } }, name + '-nothink');
      const status = r.error ? `ERROR: ${r.error.slice(0, 60)}` : `OK: "${r.content.trim().slice(0, 40)}"`;
      console.log(`${name.padEnd(20)} ~${promptTokensApprox.toString().padStart(6)}  no-think  ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${status}`);
    }

    console.log('');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
