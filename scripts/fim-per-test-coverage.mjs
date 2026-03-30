#!/usr/bin/env node
/**
 * Per-test runtime coverage FIM
 *
 * 对每个 unit 测试文件单独跑 vitest --coverage，
 * 收集真实运行时覆盖矩阵 C[test][source]，
 * 计算 FIM = C^T C，与 import 近似结果对比。
 *
 * 用法：
 *   node scripts/fim-per-test-coverage.mjs [--concurrency 4] [--skip-run]
 *
 * --skip-run  : 跳过实际运行，直接从已有的 .archguard/per-test-cov/ 读取结果
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, relative, basename, dirname } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { cpus } from 'os';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const COV_DIR = resolve(ROOT, '.archguard/per-test-cov');
const SRC_DIR = resolve(ROOT, 'src');

// ── CLI args ──────────────────────────────────────────────
const args = process.argv.slice(2);
const CONCURRENCY = parseInt(args[args.indexOf('--concurrency') + 1] || String(Math.min(cpus().length, 6)));
const SKIP_RUN = args.includes('--skip-run');

// ── 发现测试文件 ──────────────────────────────────────────
function findTestFiles(dir) {
  const results = [];
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = resolve(d, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') walk(full);
      else if (entry.isFile() && /\.(test|spec)\.(ts|js)$/.test(entry.name))
        results.push(full);
    }
  }
  walk(dir);
  return results;
}

// ── 发现源文件 ────────────────────────────────────────────
function findSourceFiles(dir) {
  const results = [];
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = resolve(d, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') walk(full);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name))
        results.push(relative(ROOT, full).replace(/\\/g, '/'));
    }
  }
  walk(dir);
  return results.sort();
}

// ── 运行单个测试文件的覆盖率 ──────────────────────────────
async function runSingleTestCoverage(testFile) {
  const relTest = relative(ROOT, testFile).replace(/\\/g, '/');
  const safeName = relTest.replace(/[/\\:]/g, '__');
  const outDir = resolve(COV_DIR, safeName);

  if (existsSync(resolve(outDir, 'coverage-final.json'))) {
    return { testFile: relTest, outDir, cached: true };
  }

  mkdirSync(outDir, { recursive: true });

  try {
    await execFileAsync(
      'node',
      [
        'node_modules/.bin/vitest',
        'run',
        relTest,
        '--coverage',
        '--coverage.reporter=json',
        '--coverage.reportsDirectory=' + outDir,
        '--coverage.enabled=true',
        '--reporter=dot',
      ],
      {
        cwd: ROOT,
        timeout: 60000,
        env: { ...process.env, FORCE_COLOR: '0' },
      }
    );
    return { testFile: relTest, outDir, cached: false };
  } catch (err) {
    // vitest exits non-zero on test failure, but coverage-final.json may still exist
    if (existsSync(resolve(outDir, 'coverage-final.json'))) {
      return { testFile: relTest, outDir, cached: false, hadFailures: true };
    }
    return { testFile: relTest, outDir, error: String(err.message).slice(0, 120) };
  }
}

// ── 并发控制 ──────────────────────────────────────────────
async function runWithConcurrency(tasks, concurrency, onDone) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      const result = await tasks[i]();
      results[i] = result;
      onDone(result, i + 1, tasks.length);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── 解析 coverage-final.json → 源文件执行集合 ─────────────
function parseCoverage(outDir) {
  const path = resolve(outDir, 'coverage-final.json');
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const executed = new Set();
  for (const [absPath, data] of Object.entries(raw)) {
    const rel = relative(ROOT, absPath).replace(/\\/g, '/');
    if (!rel.startsWith('src/')) continue;
    const stmts = data.s || {};
    if (Object.values(stmts).some(v => v > 0)) {
      executed.add(rel);
    }
  }
  return executed;
}

// ── FIM 计算（同 fim-experiment.mjs）─────────────────────
function computeGramMatrix(C, T, F) {
  const I = Array.from({ length: F }, () => new Array(F).fill(0));
  for (let i = 0; i < F; i++) {
    for (let j = i; j < F; j++) {
      let sum = 0;
      for (let t = 0; t < T; t++) sum += C[t][i] * C[t][j];
      I[i][j] = sum;
      I[j][i] = sum;
    }
  }
  return I;
}

function eigenDecompose(M, numEigs) {
  const n = M.length;
  const eigenvalues = [];
  let A = M.map(row => [...row]);

  for (let k = 0; k < numEigs; k++) {
    let v = Array.from({ length: n }, () => Math.random());
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    v = v.map(x => x / norm);

    let lambda = 0;
    for (let iter = 0; iter < 500; iter++) {
      const w = new Array(n).fill(0);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) w[i] += A[i][j] * v[j];
      lambda = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
      if (lambda < 1e-12) break;
      v = w.map(x => x / lambda);
    }
    eigenvalues.push(lambda);

    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        A[i][j] -= lambda * v[i] * v[j];
  }
  return eigenvalues.sort((a, b) => b - a);
}

function summarizeFIM(eigenvalues, F) {
  const total = eigenvalues.reduce((s, x) => s + Math.abs(x), 0);
  const nonZero = eigenvalues.filter(x => x > 1e-6);
  const kappa = nonZero.length > 1 ? nonZero[0] / nonZero[nonZero.length - 1] : Infinity;
  const neff = total > 0 ? total ** 2 / eigenvalues.reduce((s, x) => s + x * x, 0) : 0;
  return { kappa, neff, nonZeroCount: nonZero.length, total, eigenvalues };
}

// ── 包级聚合 ──────────────────────────────────────────────
function aggregateToPackage(fim, fileIds, depth = 2) {
  const pkgMap = new Map();
  fileIds.forEach((f, i) => {
    const pkg = f.split('/').slice(0, depth).join('/');
    if (!pkgMap.has(pkg)) pkgMap.set(pkg, []);
    pkgMap.get(pkg).push(i);
  });
  const pkgNames = [...pkgMap.keys()].sort();
  const P = pkgNames.length;
  const pkgFIM = Array.from({ length: P }, () => new Array(P).fill(0));
  pkgNames.forEach((pi, a) => {
    pkgNames.forEach((pj, b) => {
      for (const fi of pkgMap.get(pi))
        for (const fj of pkgMap.get(pj))
          pkgFIM[a][b] += fim[fi][fj];
    });
  });
  return { pkgFIM, pkgNames };
}

// ── Mantel test ───────────────────────────────────────────
function upperTriCorr(A, B) {
  const n = A.length;
  const pa = [], pb = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) { pa.push(A[i][j]); pb.push(B[i][j]); }
  const mA = pa.reduce((s, x) => s + x, 0) / pa.length;
  const mB = pb.reduce((s, x) => s + x, 0) / pb.length;
  let num = 0, dA = 0, dB = 0;
  for (let k = 0; k < pa.length; k++) {
    const a = pa[k] - mA, b = pb[k] - mB;
    num += a * b; dA += a * a; dB += b * b;
  }
  return dA > 0 && dB > 0 ? num / Math.sqrt(dA * dB) : 0;
}

function normalizeMatrix(M) {
  const flat = M.flat();
  const max = Math.max(...flat);
  return max === 0 ? M : M.map(row => row.map(v => v / max));
}

function mantelTest(A, B, nPerms = 9999) {
  const n = A.length;
  const nA = normalizeMatrix(A), nB = normalizeMatrix(B);
  const rObs = upperTriCorr(nA, nB);
  let count = 0;
  for (let p = 0; p < nPerms; p++) {
    const perm = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const Bp = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => nB[perm[i]][perm[j]]));
    if (upperTriCorr(nA, Bp) >= rObs) count++;
  }
  return { r: rObs, p: (count + 1) / (nPerms + 1) };
}

// ── MAIN ──────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('FIM: Per-test Runtime Coverage vs Import Approximation');
  console.log('═══════════════════════════════════════════════════════\n');

  const testFiles = findTestFiles(resolve(ROOT, 'tests/unit'));
  const sourceFiles = findSourceFiles(SRC_DIR);
  console.log(`单元测试文件: ${testFiles.length}`);
  console.log(`源文件: ${sourceFiles.length}`);

  mkdirSync(COV_DIR, { recursive: true });

  // ── Phase 1: 跑每个测试文件的覆盖率 ──
  if (!SKIP_RUN) {
    console.log(`\n[1/${testFiles.length}] 运行覆盖率测试 (并发=${CONCURRENCY})...\n`);
    const tasks = testFiles.map(tf => () => runSingleTestCoverage(tf));
    const results = await runWithConcurrency(tasks, CONCURRENCY, (r, done, total) => {
      const status = r.error ? '✗' : r.cached ? '·' : '✓';
      process.stdout.write(`  ${status} [${done}/${total}] ${relative(ROOT, r.testFile || r.outDir)}\n`);
    });

    const errors = results.filter(r => r.error);
    if (errors.length > 0) {
      console.log(`\n  ⚠ ${errors.length} 个测试运行失败（已跳过）:`);
      errors.forEach(e => console.log(`    - ${e.testFile}: ${e.error}`));
    }
    console.log(`\n  完成: ${results.length - errors.length}/${results.length} 成功`);
  } else {
    console.log('\n[跳过运行] 从已有覆盖率数据重建矩阵...');
  }

  // ── Phase 2: 构建覆盖矩阵 ──
  console.log('\n[Phase 2] 构建覆盖矩阵...');
  const fileIndex = new Map(sourceFiles.map((f, i) => [f, i]));
  const F = sourceFiles.length;
  const matrixRows = [];
  const usedTestIds = [];

  for (const tf of testFiles) {
    const relTest = relative(ROOT, tf).replace(/\\/g, '/');
    const safeName = relTest.replace(/[/\\:]/g, '__');
    const outDir = resolve(COV_DIR, safeName);
    const executed = parseCoverage(outDir);
    if (!executed) continue;

    const row = new Array(F).fill(0);
    for (const f of executed) {
      const idx = fileIndex.get(f);
      if (idx !== undefined) row[idx] = 1;
    }
    matrixRows.push(row);
    usedTestIds.push(relTest);
  }

  const T = matrixRows.length;
  console.log(`  覆盖矩阵维度: ${T} × ${F}`);

  const density = matrixRows.flat().filter(x => x > 0).length / (T * F);
  console.log(`  非零元素占比: ${(density * 100).toFixed(1)}%`);

  const coveredPerFile = sourceFiles.map((_, j) =>
    matrixRows.filter(row => row[j] > 0).length);
  const zeroCovFiles = sourceFiles.filter((_, j) => coveredPerFile[j] === 0);
  console.log(`  零覆盖文件: ${zeroCovFiles.length}/${F}`);

  // ── Phase 3: File-level FIM ──
  console.log('\n[Phase 3] 文件级 FIM...');
  const I_file = computeGramMatrix(matrixRows, T, F);
  const diagFile = sourceFiles.map((f, i) => ({ file: f, selfInfo: I_file[i][i] }))
    .sort((a, b) => b.selfInfo - a.selfInfo);

  console.log('\n  Top-10 自信息（实际运行次数最多的源文件）:');
  diagFile.slice(0, 10).forEach(d =>
    console.log(`    I_ii=${String(d.selfInfo).padStart(4)}  ${d.file}`));

  console.log('\n  脆弱点 (I_ii = 0，即从未被执行):');
  const fragile = diagFile.filter(d => d.selfInfo === 0);
  fragile.slice(0, 15).forEach(d => console.log(`    ${d.file}`));
  if (fragile.length > 15) console.log(`    ... 共 ${fragile.length} 个`);

  const fileEigs = eigenDecompose(I_file, Math.min(F, 30));
  const fileSummary = summarizeFIM(fileEigs, F);

  console.log('\n  特征值谱 (top 10):');
  let cum = 0;
  fileEigs.slice(0, 10).forEach((ev, i) => {
    cum += Math.abs(ev);
    console.log(`    λ${String(i+1).padStart(2)} = ${ev.toFixed(2).padStart(8)}  (${(Math.abs(ev)/fileSummary.total*100).toFixed(1).padStart(5)}%)  cum: ${(cum/fileSummary.total*100).toFixed(1)}%`);
  });

  // ── Phase 4: Package-level FIM + Mantel ──
  console.log('\n[Phase 4] 包级 FIM + Mantel test...');
  const { pkgFIM, pkgNames } = aggregateToPackage(I_file, sourceFiles, 2);
  const P = pkgNames.length;

  console.log(`  包数: ${P}`);
  console.log('  包级对角线:');
  pkgNames.forEach((pkg, i) =>
    console.log(`    ${pkg.padEnd(35)} I_pkg=${String(pkgFIM[i][i]).padStart(6)}`));

  const pkgEigs = eigenDecompose(pkgFIM, P);
  const pkgSummary = summarizeFIM(pkgEigs, P);

  console.log('\n  包级特征值:');
  pkgEigs.forEach((ev, i) =>
    console.log(`    λ${i+1} = ${ev.toFixed(2).padStart(8)}  (${(Math.abs(ev)/pkgSummary.total*100).toFixed(1)}%)`));

  // Co-change matrix (hardcoded from experiment report, package-level)
  const cochangeManual = {
    'src/cli':      { 'src/types': 30, 'src/plugins': 24, 'src/mermaid': 22, 'src/parser': 18, 'src/core': 6, 'src/analysis': 7 },
    'src/types':    { 'src/plugins': 21, 'src/mermaid': 15, 'src/parser': 12, 'src/core': 6, 'src/analysis': 3 },
    'src/plugins':  { 'src/mermaid': 16, 'src/parser': 10, 'src/core': 7, 'src/analysis': 6 },
    'src/mermaid':  { 'src/parser': 13, 'src/core': 3, 'src/analysis': 3 },
    'src/parser':   { 'src/core': 0, 'src/analysis': 0 },
    'src/core':     { 'src/analysis': 3 },
  };
  const corePkgs = ['src/cli', 'src/types', 'src/plugins', 'src/mermaid', 'src/parser', 'src/core', 'src/analysis'];
  const coreIdx = corePkgs.map(p => pkgNames.indexOf(p)).filter(i => i >= 0);
  const coreNames = coreIdx.map(i => pkgNames[i]);
  const CP = coreNames.length;

  if (CP >= 4) {
    const fimSub = Array.from({ length: CP }, (_, a) =>
      Array.from({ length: CP }, (_, b) => pkgFIM[coreIdx[a]][coreIdx[b]]));
    const ccSub = Array.from({ length: CP }, () => new Array(CP).fill(0));
    for (let a = 0; a < CP; a++) {
      ccSub[a][a] = 1;
      for (let b = a + 1; b < CP; b++) {
        const pa = coreNames[a], pb = coreNames[b];
        const val = (cochangeManual[pa]?.[pb]) || (cochangeManual[pb]?.[pa]) || 0;
        ccSub[a][b] = val; ccSub[b][a] = val;
      }
    }

    console.log('\n  ─── Mantel Test (runtime coverage FIM vs co-change) ───');
    console.log(`  核心包: ${coreNames.join(', ')}`);
    const result = mantelTest(fimSub, ccSub, 9999);
    console.log(`  Mantel r = ${result.r.toFixed(4)}`);
    console.log(`  p-value  = ${result.p.toFixed(4)}`);
    console.log(`  结论: ${result.p < 0.05
      ? '✓ Co-change IS a statistically significant proxy (p < 0.05)'
      : '✗ Co-change is NOT a significant proxy (p >= 0.05)'}`);
  }

  // ── 汇总对比 ──────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('汇总对比');
  console.log('═══════════════════════════════════════════════════════');
  console.log('                         Import 近似    Runtime 覆盖');
  console.log(`  文件级 κ                ${'329.69'.padStart(12)}    ${fileSummary.kappa.toFixed(2).padStart(12)}`);
  console.log(`  文件级 N_eff            ${'3.42'.padStart(12)}    ${fileSummary.neff.toFixed(2).padStart(12)}`);
  console.log(`  包级 κ                  ${'74613'.padStart(12)}    ${pkgSummary.kappa.toFixed(2).padStart(12)}`);
  console.log(`  包级 N_eff              ${'1.97'.padStart(12)}    ${pkgSummary.neff.toFixed(2).padStart(12)}`);
  console.log(`  零覆盖文件              ${'0/163'.padStart(12)}    ${zeroCovFiles.length}/${F}`);

  // Save result
  const output = {
    timestamp: new Date().toISOString(),
    source: 'per-test-runtime-coverage',
    testCount: T,
    fileCount: F,
    packageCount: P,
    fileLevel: {
      conditionNumber: fileSummary.kappa,
      effectiveDimension: fileSummary.neff,
      nonZeroEigenvalues: fileSummary.nonZeroCount,
      top10Diagonal: diagFile.slice(0, 10),
      zeroCoverageFiles: zeroCovFiles,
      eigenvalues: fileEigs.slice(0, 20),
    },
    packageLevel: {
      conditionNumber: pkgSummary.kappa,
      effectiveDimension: pkgSummary.neff,
      packages: pkgNames.map((name, i) => ({ name, selfInfo: pkgFIM[i][i] })),
      eigenvalues: pkgEigs,
    },
  };

  const outPath = resolve(ROOT, '.archguard/fim-runtime-result.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n  结果已保存: .archguard/fim-runtime-result.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
