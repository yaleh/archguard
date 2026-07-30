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
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import os from 'node:os';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const iterationsArg = process.argv.indexOf('--iterations');
const ITERATIONS = iterationsArg > 0 ? Number(process.argv[iterationsArg + 1]) : 50;
const REPETITIONS = 5; // median-of-N per measurement
const e2eIterationsArg = process.argv.indexOf('--e2e-iterations');
const E2E_ITERATIONS = e2eIterationsArg > 0 ? Number(process.argv[e2eIterationsArg + 1]) : 3;
if (!Number.isInteger(E2E_ITERATIONS) || E2E_ITERATIONS < 3) {
  throw new Error('--e2e-iterations must be an integer >= 3');
}
const SIZE_MULTIPLIERS = { small: 1, medium: 10, large: 50 };
const sizeArg = process.argv.indexOf('--size');
const FIXTURE_SIZE = sizeArg > 0 ? process.argv[sizeArg + 1] : 'small';
if (!(FIXTURE_SIZE in SIZE_MULTIPLIERS)) throw new Error('--size must be small, medium, or large');

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
const { runAnalysis } = await import(path.join(repoRoot, 'dist/cli/analyze/run-analysis.js'));
const { ProcessParseWorkerPools } = await import(
  path.join(repoRoot, 'dist/parser/process-parse-worker-pools.js')
);
const { canonicalizeArchJson } = await import(
  path.join(repoRoot, 'dist/cli/utils/canonicalize-arch-json.js')
);
const silentReporter = { start() {}, succeed() {}, fail() {}, warn() {}, info() {}, update() {} };

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

async function benchEndToEnd(testCase, code) {
  const project = mkdtempSync(path.join(os.tmpdir(), `archguard-bench-${testCase.language}-`));
  const extension = path.extname(testCase.file);
  const count = Math.max(12, SIZE_MULTIPLIERS[FIXTURE_SIZE]);
  for (let index = 0; index < count; index++) {
    const dir = path.join(project, 'src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `fixture-${index}${extension}`), code);
  }
  if (testCase.language === 'go') {
    writeFileSync(path.join(project, 'go.mod'), 'module benchmark.local/project\n\ngo 1.22\n');
  }
  const sample = async (runtime) => {
    const pools = new ProcessParseWorkerPools();
    const previous = process.env.ARCHGUARD_PARSER_RUNTIME;
    process.env.ARCHGUARD_PARSER_RUNTIME = runtime;
    const started = performance.now();
    try {
      const analysis = await runAnalysis({
        sessionRoot: project,
        workDir: path.join(project, `.archguard-${runtime}`),
        cliOptions: {
          sources: [path.join(project, 'src')],
          lang: testCase.language,
          format: 'json',
          cache: false,
        },
        reporter: silentReporter,
        parseWorkerPools: pools,
      });
      if (pools.dispatchCount === 0) {
        throw new Error(
          `benchmark did not dispatch ${testCase.language}/${runtime} through a parse worker`
        );
      }
      const jsonPath = analysis.results.find((result) => result.success)?.paths?.json;
      if (!jsonPath) throw new Error(`${testCase.language}/${runtime} produced no ArchJSON path`);
      const archJson = JSON.parse(readFileSync(jsonPath, 'utf8'));
      const canonical = canonicalizeArchJson(archJson);
      return {
        elapsed: performance.now() - started,
        canonical: JSON.parse(
          JSON.stringify(
            {
              version: canonical.version,
              language: canonical.language,
              sourceFiles: canonical.sourceFiles,
              entities: canonical.entities,
              relations: canonical.relations,
              modules: canonical.modules,
            },
            (key, value) =>
              ['timestamp', 'generatedAt', 'parseTime', 'workspaceRoot'].includes(key)
                ? undefined
                : value
          )
        ),
      };
    } finally {
      await pools.terminate();
      if (previous === undefined) delete process.env.ARCHGUARD_PARSER_RUNTIME;
      else process.env.ARCHGUARD_PARSER_RUNTIME = previous;
    }
  };
  try {
    const samples = { native: [], wasm: [] };
    let expected;
    for (let iteration = 0; iteration < E2E_ITERATIONS; iteration++) {
      const order = iteration % 2 === 0 ? ['native', 'wasm'] : ['wasm', 'native'];
      const outputs = {};
      for (const runtime of order) {
        outputs[runtime] = await sample(runtime);
        samples[runtime].push(outputs[runtime].elapsed);
      }
      const nativeJson = JSON.stringify(outputs.native.canonical);
      const wasmJson = JSON.stringify(outputs.wasm.canonical);
      if (nativeJson !== wasmJson)
        throw new Error(`${testCase.language} native/WASM output mismatch`);
      expected ??= nativeJson;
      if (nativeJson !== expected)
        throw new Error(`${testCase.language} output changed between iterations`);
    }
    return { native: median(samples.native), wasm: median(samples.wasm) };
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const PLUGINS = {
  go: GoPlugin,
  java: JavaPlugin,
  python: PythonPlugin,
  cpp: CppPlugin,
  kotlin: KotlinPlugin,
};

const rows = [];
for (const testCase of CASES) {
  const fixtureCode = readFileSync(path.join(repoRoot, testCase.file), 'utf8');
  // Representative sizes repeat valid top-level declarations. Parser-only and
  // full plugin analysis therefore scale over identical input bytes.
  const size = FIXTURE_SIZE;
  const code = Array.from({ length: SIZE_MULTIPLIERS[size] }, () => fixtureCode).join('\n');
  const nativeParse = await benchParserOnly(nativeParserBackend, testCase, code);
  const wasmParse = await benchParserOnly(wasmParserBackend, testCase, code);
  const pipeline = await benchPipeline(PLUGINS[testCase.language], testCase, code);
  const endToEnd = await benchEndToEnd(testCase, fixtureCode);
  rows.push({
    language: testCase.language,
    fixture: testCase.file,
    size,
    nativeParse,
    wasmParse,
    parseRatio: wasmParse / nativeParse,
    nativePipeline: pipeline.native,
    wasmPipeline: pipeline.wasm,
    pipelineRatio: pipeline.wasm / pipeline.native,
    nativeEndToEnd: endToEnd.native,
    wasmEndToEnd: endToEnd.wasm,
    endToEndRatio: endToEnd.wasm / endToEnd.native,
  });
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

console.log(`# Parser backend benchmark (native vs WASM)\n`);
console.log(`- date: ${new Date().toISOString().slice(0, 10)}`);
console.log(`- node: ${process.version}`);
console.log(`- platform: ${process.platform}/${process.arch}`);
console.log(
  `- load average (1/5/15m): ${os
    .loadavg()
    .map((n) => n.toFixed(2))
    .join('/')}`
);
console.log(`- fixture size: ${rows[0]?.size ?? 'small'} (--size small|medium|large)`);
console.log(`- parser iterations per fixture: ${ITERATIONS} (after warm-up)`);
console.log(`- end-to-end iterations per backend: ${E2E_ITERATIONS} (alternating order)\n`);
console.log(
  `| language | parser-only native (ms) | parser-only wasm (ms) | ratio | full-analysis native (ms) | full-analysis wasm (ms) | ratio | end-to-end native (ms) | end-to-end wasm (ms) | ratio |`
);
console.log(`|---|---|---|---|---|---|---|---|---|---|`);
for (const row of rows) {
  console.log(
    `| ${row.language} | ${row.nativeParse.toFixed(3)} | ${row.wasmParse.toFixed(3)} | ${row.parseRatio.toFixed(2)}x | ${row.nativePipeline.toFixed(3)} | ${row.wasmPipeline.toFixed(3)} | ${row.pipelineRatio.toFixed(2)}x | ${row.nativeEndToEnd.toFixed(1)} | ${row.wasmEndToEnd.toFixed(1)} | ${row.endToEndRatio.toFixed(2)}x |`
  );
}
console.log(
  `| **mean** | ${avg(rows.map((r) => r.nativeParse)).toFixed(3)} | ${avg(rows.map((r) => r.wasmParse)).toFixed(3)} | **${avg(rows.map((r) => r.parseRatio)).toFixed(2)}x** | ${avg(rows.map((r) => r.nativePipeline)).toFixed(3)} | ${avg(rows.map((r) => r.wasmPipeline)).toFixed(3)} | **${avg(rows.map((r) => r.pipelineRatio)).toFixed(2)}x** | ${avg(rows.map((r) => r.nativeEndToEnd)).toFixed(1)} | ${avg(rows.map((r) => r.wasmEndToEnd)).toFixed(1)} | **${avg(rows.map((r) => r.endToEndRatio)).toFixed(2)}x** |`
);
console.log(
  `\n"full-analysis" = plugin.parseCode() (tree-sitter parse + extractor + ArchJSON mapping),`
);
console.log(`the parse-dominated portion of an end-to-end ArchGuard analysis.`);
console.log(
  `"end-to-end" = file discovery + threshold decision + worker pool + merge + query persistence.`
);
