#!/usr/bin/env node
/**
 * Benchmark baselines: native (node-tree-sitter) vs WASM (web-tree-sitter)
 * parser backends. Requires `npm run build` (imports from dist/).
 *
 * Measures:
 *  1. Parser-only: session.parse() over representative fixtures, N iterations.
 *  2. Pipeline: plugin.parseCode() (bridge + ArchJSON mapping, the dominant
 *     parse cost of an end-to-end ArchGuard analysis) over the same fixtures.
 *
 * Usage: node scripts/benchmark-parser-backends.mjs [--iterations N]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const iterationsArg = process.argv.indexOf('--iterations');
const ITERATIONS = iterationsArg > 0 ? Number(process.argv[iterationsArg + 1]) : 50;
const REPETITIONS = 5; // median-of-N per measurement

const { nativeParserBackend } = await import(
  path.join(repoRoot, 'dist/plugins/shared/native-parser-backend.js')
);
const { wasmParserBackend } = await import(
  path.join(repoRoot, 'dist/plugins/shared/wasm-parser-backend.js')
);
const { GoPlugin } = await import(path.join(repoRoot, 'dist/plugins/golang/index.js'));
const { JavaPlugin } = await import(path.join(repoRoot, 'dist/plugins/java/index.js'));
const { PythonPlugin } = await import(path.join(repoRoot, 'dist/plugins/python/index.js'));
const { CppPlugin } = await import(path.join(repoRoot, 'dist/plugins/cpp/index.js'));
const { KotlinPlugin } = await import(path.join(repoRoot, 'dist/plugins/kotlin/index.js'));

const CASES = [
  { language: 'go', file: 'tests/fixtures/go/sample.go' },
  { language: 'java', file: 'tests/fixtures/java/simple-class.java' },
  { language: 'python', file: 'tests/fixtures/python/simple-class.py' },
  { language: 'cpp', file: 'tests/plugins/wasm-parity/fixtures/sample.cpp' },
  { language: 'kotlin', file: 'tests/plugins/wasm-parity/fixtures/sample.kt' },
];

async function benchParserOnly(backend, testCase, code) {
  const session = await backend.createSession(testCase.language);
  try {
    for (let i = 0; i < 10; i++) session.parse(code).dispose();
    const samples = [];
    for (let rep = 0; rep < REPETITIONS; rep++) {
      const start = performance.now();
      for (let i = 0; i < ITERATIONS; i++) session.parse(code).dispose();
      samples.push((performance.now() - start) / ITERATIONS);
    }
    return median(samples);
  } finally {
    session.dispose();
  }
}

async function benchPipeline(PluginClass, testCase, code) {
  const workspaceRoot = path.join(repoRoot, 'tests/fixtures');
  const nativePlugin = new PluginClass(nativeParserBackend);
  await nativePlugin.initialize({ workspaceRoot });
  const wasmPlugin = new PluginClass(wasmParserBackend);
  await wasmPlugin.initialize({ workspaceRoot });
  try {
    // Warm both instances before measuring either, so JIT cost is not
    // attributed to whichever backend happens to run first.
    for (let i = 0; i < 10; i++) {
      nativePlugin.parseCode(code, testCase.file);
      wasmPlugin.parseCode(code, testCase.file);
    }
    const sample = async (plugin) => {
      const start = performance.now();
      for (let i = 0; i < ITERATIONS; i++) plugin.parseCode(code, testCase.file);
      return (performance.now() - start) / ITERATIONS;
    };
    const nativeSamples = [];
    const wasmSamples = [];
    for (let rep = 0; rep < REPETITIONS; rep++) {
      nativeSamples.push(await sample(nativePlugin));
      wasmSamples.push(await sample(wasmPlugin));
    }
    return { native: median(nativeSamples), wasm: median(wasmSamples) };
  } finally {
    nativePlugin.dispose?.();
    wasmPlugin.dispose?.();
  }
}

function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const PLUGINS = { go: GoPlugin, java: JavaPlugin, python: PythonPlugin, cpp: CppPlugin, kotlin: KotlinPlugin };

const rows = [];
for (const testCase of CASES) {
  const code = readFileSync(path.join(repoRoot, testCase.file), 'utf8');
  const nativeParse = await benchParserOnly(nativeParserBackend, testCase, code);
  const wasmParse = await benchParserOnly(wasmParserBackend, testCase, code);
  const pipeline = await benchPipeline(PLUGINS[testCase.language], testCase, code);
  rows.push({
    language: testCase.language,
    fixture: testCase.file,
    nativeParse,
    wasmParse,
    parseRatio: wasmParse / nativeParse,
    nativePipeline: pipeline.native,
    wasmPipeline: pipeline.wasm,
    pipelineRatio: pipeline.wasm / pipeline.native,
  });
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

console.log(`# Parser backend benchmark (native vs WASM)\n`);
console.log(`- date: ${new Date().toISOString().slice(0, 10)}`);
console.log(`- node: ${process.version}`);
console.log(`- platform: ${process.platform}/${process.arch}`);
console.log(`- iterations per fixture: ${ITERATIONS} (after warm-up)\n`);
console.log(`| language | parser-only native (ms) | parser-only wasm (ms) | ratio | pipeline native (ms) | pipeline wasm (ms) | ratio |`);
console.log(`|---|---|---|---|---|---|---|`);
for (const row of rows) {
  console.log(
    `| ${row.language} | ${row.nativeParse.toFixed(3)} | ${row.wasmParse.toFixed(3)} | ${row.parseRatio.toFixed(2)}x | ${row.nativePipeline.toFixed(3)} | ${row.wasmPipeline.toFixed(3)} | ${row.pipelineRatio.toFixed(2)}x |`
  );
}
console.log(
  `| **mean** | ${avg(rows.map((r) => r.nativeParse)).toFixed(3)} | ${avg(rows.map((r) => r.wasmParse)).toFixed(3)} | **${avg(rows.map((r) => r.parseRatio)).toFixed(2)}x** | ${avg(rows.map((r) => r.nativePipeline)).toFixed(3)} | ${avg(rows.map((r) => r.wasmPipeline)).toFixed(3)} | **${avg(rows.map((r) => r.pipelineRatio)).toFixed(2)}x** |`
);
console.log(`\n"pipeline" = plugin.parseCode() (tree-sitter parse + extractor + ArchJSON mapping),`);
console.log(`the parse-dominated portion of an end-to-end ArchGuard analysis.`);
