/**
 * Phase 77.1 — Structural Covariate Measurement
 * Renders all 8 formats for each corpus instance and measures:
 *   - token count (chars / 4, GPT-style approximation)
 *   - max nesting depth
 *   - tokens per relation
 *   - delimiter density (delimiters per 100 tokens)
 *   - key relation position (fraction in text where call/inheritance rels appear)
 * Writes artifacts/covariates/structural-metrics.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { archJsonToC } from '../lib/corpus.js';
import type { C } from '../lib/schema.js';

import { render as renderJsonAdj }   from '../renderers/json-adjacency.js';
import { render as renderJsonEdge }  from '../renderers/json-edge-list.js';
import { render as renderYaml }      from '../renderers/yaml.js';
import { render as renderMd }        from '../renderers/markdown-table.js';
import { render as renderMermaid }   from '../renderers/mermaid.js';
import { render as renderHaskell }   from '../renderers/haskell-adt.js';
import { render as renderDsl }       from '../renderers/custom-dsl.js';
import { render as renderNl }        from '../renderers/nl-exhaustive.js';

const FORMATS = [
  { name: 'json-adjacency',  render: renderJsonAdj,  delimiters: '{}[],:' },
  { name: 'json-edge-list',  render: renderJsonEdge, delimiters: '{}[],:' },
  { name: 'yaml',            render: renderYaml,     delimiters: ':-' },
  { name: 'markdown-table',  render: renderMd,       delimiters: '|' },
  { name: 'mermaid',         render: renderMermaid,  delimiters: '{}|:' },
  { name: 'haskell-adt',     render: renderHaskell,  delimiters: '{}|:,[]' },
  { name: 'custom-dsl',      render: renderDsl,      delimiters: '->:' },
  { name: 'nl-exhaustive',   render: renderNl,       delimiters: '.,' },
] as const;

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function maxNestingDepth(text: string): number {
  let maxDepth = 0;
  let depth = 0;
  for (const ch of text) {
    if (ch === '{' || ch === '[') { depth++; maxDepth = Math.max(maxDepth, depth); }
    else if (ch === '}' || ch === ']') { depth = Math.max(0, depth - 1); }
  }
  return maxDepth;
}

function yamlNestingDepth(text: string): number {
  let maxDepth = 0;
  for (const line of text.split('\n')) {
    const leading = line.length - line.trimStart().length;
    const depth = Math.floor(leading / 2);
    maxDepth = Math.max(maxDepth, depth);
  }
  return maxDepth;
}

function delimiterDensity(text: string, delimiters: string, tokens: number): number {
  const delimSet = new Set(delimiters);
  let count = 0;
  for (const ch of text) { if (delimSet.has(ch)) count++; }
  return tokens > 0 ? (count / tokens) * 100 : 0;
}

function keyRelationPositions(text: string, c: C): { medianPosition: number; fractionInFirst20pct: number } {
  const textLen = text.length;
  if (textLen === 0 || c.relations.length === 0) return { medianPosition: 0.5, fractionInFirst20pct: 0 };

  const keyRels = c.relations.filter(r => r.type === 'call' || r.type === 'inheritance');
  if (keyRels.length === 0) return { medianPosition: 0.5, fractionInFirst20pct: 0 };

  const positions: number[] = [];
  for (const rel of keyRels) {
    const needle = rel.from.slice(-20);
    const idx = text.indexOf(needle);
    if (idx >= 0) positions.push(idx / textLen);
  }

  if (positions.length === 0) return { medianPosition: 0.5, fractionInFirst20pct: 0 };

  positions.sort((a, b) => a - b);
  const mid = Math.floor(positions.length / 2);
  const medianPosition = positions.length % 2 === 0
    ? (positions[mid - 1]! + positions[mid]!) / 2
    : positions[mid]!;

  const fractionInFirst20pct = positions.filter(p => p <= 0.2).length / positions.length;
  return { medianPosition, fractionInFirst20pct };
}

// Custom-DSL vocabulary: unique tokens (split on whitespace + punctuation)
function vocabularySize(text: string): number {
  const tokens = text.split(/[\s\->:,;.{}[\]()|]+/).filter(t => t.length > 0);
  return new Set(tokens).size;
}

interface FormatMetrics {
  tokens: number;
  chars: number;
  nestingDepth: number;
  tokensPerRelation: number;
  delimiterDensityPer100: number;
  keyRelMedianPosition: number;
  keyRelFractionFirst20pct: number;
  vocabularySize: number;
}

interface InstanceMetrics {
  instance: string;
  entityCount: number;
  relationCount: number;
  methodCount: number;
  formats: Record<string, FormatMetrics>;
}

async function main() {
  const corpusPaths = process.argv.slice(2);
  if (corpusPaths.length === 0) {
    console.error('Usage: tsx scripts/measure-covariates.ts <archJson1.json> [...]');
    process.exit(1);
  }

  const results: InstanceMetrics[] = [];

  for (const p of corpusPaths) {
    let raw: unknown;
    try { raw = JSON.parse(await readFile(p, 'utf-8')); } catch { console.warn(`skip ${p}`); continue; }
    const c = archJsonToC(raw as Parameters<typeof archJsonToC>[0]);
    if (c.entities.length === 0) continue;

    const label = p.split('/').slice(-3).join('/');
    const methodCount = c.entities.reduce((s, e) => s + e.methods.length, 0);
    const formats: Record<string, FormatMetrics> = {};

    for (const fmt of FORMATS) {
      const rendered = fmt.render(c);
      const tokens = approxTokens(rendered);
      const nesting = fmt.name === 'yaml'
        ? yamlNestingDepth(rendered)
        : maxNestingDepth(rendered);
      const { medianPosition, fractionInFirst20pct } = keyRelationPositions(rendered, c);

      formats[fmt.name] = {
        tokens,
        chars: rendered.length,
        nestingDepth: nesting,
        tokensPerRelation: c.relations.length > 0 ? tokens / c.relations.length : 0,
        delimiterDensityPer100: delimiterDensity(rendered, fmt.delimiters, tokens),
        keyRelMedianPosition: Math.round(medianPosition * 1000) / 1000,
        keyRelFractionFirst20pct: Math.round(fractionInFirst20pct * 1000) / 1000,
        vocabularySize: vocabularySize(rendered),
      };
    }

    results.push({
      instance: label,
      entityCount: c.entities.length,
      relationCount: c.relations.length,
      methodCount,
      formats,
    });

    console.log(`Measured: ${label} (${c.entities.length} entities, ${c.relations.length} relations)`);
  }

  // Custom-DSL simpler judgment (pre-registered rule)
  console.log('\n## Custom-DSL "Simpler" Judgment (Pre-registered)');
  for (const inst of results) {
    const json = inst.formats['json-edge-list'];
    const dsl = inst.formats['custom-dsl'];
    if (!json || !dsl) continue;
    const vocabSmaller = dsl.vocabularySize <= json.vocabularySize;
    const tokenRatio = dsl.tokensPerRelation / (json.tokensPerRelation || 1);
    const tokenSmaller = tokenRatio <= 0.8;
    const verdict = vocabSmaller && tokenSmaller ? 'SIMPLER (H-pretrain testable)' : 'COMPARABLE (H-pretrain indeterminate)';
    console.log(`  ${inst.instance}: vocab ${dsl.vocabularySize}/${json.vocabularySize} (${vocabSmaller ? '✓' : '✗'}), token-ratio ${tokenRatio.toFixed(2)} (${tokenSmaller ? '✓' : '✗'}) → ${verdict}`);
  }

  const output = {
    generated: new Date().toISOString(),
    tokenApprox: 'chars/4 (GPT-style approximation)',
    instances: results,
  };

  await mkdir('artifacts/covariates', { recursive: true });
  await writeFile('artifacts/covariates/structural-metrics.json', JSON.stringify(output, null, 2));
  console.log('\nWritten: artifacts/covariates/structural-metrics.json');
}

main().catch(e => { console.error(e); process.exit(1); });
