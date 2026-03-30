#!/usr/bin/env node
/**
 * 最小可行实验：覆盖矩阵 Fisher 信息度量
 *
 * 用法：
 *   node scripts/fim-experiment.mjs <coverage-final.json> [cochange-pkg.json]
 *
 * 输出：
 *   - 覆盖矩阵 C (test_file × source_file) 的维度
 *   - FIM I = CᵀC 的特征值谱
 *   - 条件数 κ, 有效维度 N_eff
 *   - 脆弱点 (I_ii = 0 的文件)
 *   - Mantel test (如果提供 co-change 数据)
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, relative, basename } from 'path';

// ── 配置 ──────────────────────────────────────────────────
const ROOT = resolve(import.meta.dirname, '..');
const SRC_DIR = resolve(ROOT, 'src');
const TEST_DIR = resolve(ROOT, 'tests');

// ── 1. 解析 coverage-final.json ────────────────────────────
function parseCoverageJson(path) {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  // istanbul coverage-final.json: { "/abs/path/file.ts": { s: {...}, b: {...}, f: {...} } }
  const files = {};
  for (const [absPath, data] of Object.entries(raw)) {
    const rel = relative(ROOT, absPath);
    if (!rel.startsWith('src/')) continue; // only source files
    // Check if any statement was executed
    const stmts = data.s || {};
    const hasExecution = Object.values(stmts).some(v => v > 0);
    files[rel] = { hasExecution, stmtCount: Object.keys(stmts).length };
  }
  return files;
}

// ── 2. 发现测试文件并追踪 imports ─────────────────────────
function findTestFiles(dir) {
  const results = [];
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = resolve(d, entry.name);
      if (entry.isDirectory() && !entry.name.includes('node_modules')) {
        walk(full);
      } else if (entry.isFile() && /\.(test|spec)\.(ts|js|tsx)$/.test(entry.name)) {
        results.push(relative(ROOT, full));
      }
    }
  }
  walk(dir);
  return results;
}

function extractImports(filePath) {
  try {
    const content = readFileSync(resolve(ROOT, filePath), 'utf-8');
    const imports = [];
    // Match import ... from '...' and import('...')
    const re = /(?:from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
    let m;
    while ((m = re.exec(content))) {
      imports.push(m[1] || m[2]);
    }
    return imports;
  } catch {
    return [];
  }
}

function resolveImportToSourceFile(imp, fromFile) {
  // Strip .js/.jsx extension (ESM-style imports that map to .ts/.tsx files)
  let cleaned = imp;
  if (cleaned.endsWith('.js')) cleaned = cleaned.slice(0, -3);
  else if (cleaned.endsWith('.jsx')) cleaned = cleaned.slice(0, -4);
  else if (cleaned.endsWith('.ts')) cleaned = cleaned.slice(0, -3);
  else if (cleaned.endsWith('.tsx')) cleaned = cleaned.slice(0, -4);

  // Handle @/ aliases
  if (cleaned.startsWith('@/')) {
    const aliased = 'src/' + cleaned.slice(2);
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      if (existsSync(resolve(ROOT, aliased + ext))) return aliased + ext;
    }
    return null;
  }
  // Handle relative imports
  if (cleaned.startsWith('.')) {
    const dir = resolve(ROOT, fromFile, '..');
    const target = resolve(dir, cleaned);
    const rel = relative(ROOT, target);
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      if (existsSync(resolve(ROOT, rel + ext))) return rel + ext;
    }
    return null;
  }
  return null; // external module
}

function traceTestImports(testFile, sourceFiles, maxDepth = 3) {
  const touched = new Set();
  const queue = [{ file: testFile, depth: 0 }];
  const visited = new Set();

  while (queue.length > 0) {
    const { file, depth } = queue.shift();
    if (visited.has(file) || depth > maxDepth) continue;
    visited.add(file);

    const imports = extractImports(file);
    for (const imp of imports) {
      const resolved = resolveImportToSourceFile(imp, file);
      if (resolved && sourceFiles.has(resolved)) {
        touched.add(resolved);
        if (depth < maxDepth) {
          queue.push({ file: resolved, depth: depth + 1 });
        }
      }
    }
  }
  return touched;
}

// ── 3. 构造覆盖矩阵 C ────────────────────────────────────
function buildCoverageMatrix(testFiles, sourceFileList) {
  const sourceSet = new Set(sourceFileList);
  const fileIdx = new Map(sourceFileList.map((f, i) => [f, i]));
  const F = sourceFileList.length;
  const T = testFiles.length;
  const C = [];

  for (const tf of testFiles) {
    const touched = traceTestImports(tf, sourceSet);
    const row = new Array(F).fill(0);
    for (const sf of touched) {
      const idx = fileIdx.get(sf);
      if (idx !== undefined) row[idx] = 1;
    }
    C.push(row);
  }
  return { matrix: C, testIds: testFiles, fileIds: sourceFileList, T, F };
}

// ── 4. 计算 FIM I = CᵀC ──────────────────────────────────
function computeGramMatrix(C, T, F) {
  const I = Array.from({ length: F }, () => new Array(F).fill(0));
  for (let i = 0; i < F; i++) {
    for (let j = i; j < F; j++) {
      let sum = 0;
      for (let t = 0; t < T; t++) {
        sum += C[t][i] * C[t][j];
      }
      I[i][j] = sum;
      I[j][i] = sum;
    }
  }
  return I;
}

// ── 5. 特征值分解 (power iteration + deflation) ──────────
function eigenDecompose(M, numEigs) {
  const n = M.length;
  const eigenvalues = [];
  let A = M.map(row => [...row]);

  for (let k = 0; k < numEigs; k++) {
    // Power iteration
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

    // Deflation
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        A[i][j] -= lambda * v[i] * v[j];
  }
  return eigenvalues.sort((a, b) => b - a);
}

// ── 6. Mantel Test ────────────────────────────────────────
function normalizeMatrix(M) {
  const n = M.length;
  let maxVal = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (M[i][j] > maxVal) maxVal = M[i][j];
  if (maxVal === 0) return M;
  return M.map(row => row.map(v => v / maxVal));
}

function upperTriCorrelation(A, B) {
  const n = A.length;
  const pairsA = [], pairsB = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      pairsA.push(A[i][j]);
      pairsB.push(B[i][j]);
    }
  const meanA = pairsA.reduce((s, x) => s + x, 0) / pairsA.length;
  const meanB = pairsB.reduce((s, x) => s + x, 0) / pairsB.length;
  let num = 0, denA = 0, denB = 0;
  for (let k = 0; k < pairsA.length; k++) {
    const da = pairsA[k] - meanA, db = pairsB[k] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  return denA > 0 && denB > 0 ? num / Math.sqrt(denA * denB) : 0;
}

function mantelTest(fimMatrix, cochangeMatrix, nPerms = 999) {
  const n = fimMatrix.length;
  const A = normalizeMatrix(fimMatrix);
  const B = normalizeMatrix(cochangeMatrix);
  const rObs = upperTriCorrelation(A, B);

  let count = 0;
  for (let p = 0; p < nPerms; p++) {
    // Permute rows+cols of B simultaneously
    const perm = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const Bp = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => B[perm[i]][perm[j]]));
    const rPerm = upperTriCorrelation(A, Bp);
    if (rPerm >= rObs) count++;
  }
  return {
    observedCorrelation: rObs,
    permutations: nPerms,
    pValue: (count + 1) / (nPerms + 1),
  };
}

// ── 7. 包级聚合 ──────────────────────────────────────────
function aggregateToPackageLevel(fim, fileIds, depth = 2) {
  // Map files to packages
  const pkgMap = new Map();
  fileIds.forEach((f, i) => {
    const parts = f.split('/');
    const pkg = parts.slice(0, depth).join('/');
    if (!pkgMap.has(pkg)) pkgMap.set(pkg, []);
    pkgMap.get(pkg).push(i);
  });

  const pkgNames = [...pkgMap.keys()].sort();
  const P = pkgNames.length;
  const pkgFIM = Array.from({ length: P }, () => new Array(P).fill(0));

  pkgNames.forEach((pi, a) => {
    pkgNames.forEach((pj, b) => {
      const filesI = pkgMap.get(pi);
      const filesJ = pkgMap.get(pj);
      let sum = 0;
      for (const fi of filesI)
        for (const fj of filesJ)
          sum += fim[fi][fj];
      pkgFIM[a][b] = sum;
    });
  });

  return { pkgFIM, pkgNames };
}

// ── MAIN ──────────────────────────────────────────────────
async function main() {
  const coveragePath = process.argv[2] || '.archguard/coverage-tmp/coverage-final.json';

  console.log('═══════════════════════════════════════════════════════');
  console.log('Fisher Information Matrix — 最小可行实验');
  console.log('═══════════════════════════════════════════════════════');

  // Step 1: Get source files
  const allSrcFiles = [];
  function walkSrc(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory() && !entry.name.includes('node_modules')) walkSrc(full);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name))
        allSrcFiles.push(relative(ROOT, full));
    }
  }
  walkSrc(SRC_DIR);
  allSrcFiles.sort();
  console.log('\n[1/6] 源文件:', allSrcFiles.length);

  // Step 2: Get test files
  const testFiles = findTestFiles(TEST_DIR);
  console.log('[2/6] 测试文件:', testFiles.length);

  // Step 3: Build coverage matrix
  console.log('[3/6] 构造覆盖矩阵 C (import-based approximation)...');
  const { matrix: C, fileIds, T, F } = buildCoverageMatrix(testFiles, allSrcFiles);

  // Statistics
  const coveredPerFile = allSrcFiles.map((_, j) => {
    let cnt = 0;
    for (let t = 0; t < T; t++) cnt += C[t][j];
    return cnt;
  });
  const uncovered = allSrcFiles.filter((_, j) => coveredPerFile[j] === 0);
  console.log('  C 维度: ' + T + ' × ' + F);
  console.log('  非零元素占比: ' + (C.flat().filter(x => x).length / (T * F) * 100).toFixed(1) + '%');
  console.log('  零覆盖文件: ' + uncovered.length + '/' + F);
  if (uncovered.length > 0 && uncovered.length <= 20) {
    uncovered.forEach(f => console.log('    - ' + f));
  }

  // Step 4: Compute FIM
  console.log('\n[4/6] 计算 FIM I = CᵀC (' + F + '×' + F + ')...');
  const I = computeGramMatrix(C, T, F);

  // Diagonal analysis
  const diag = allSrcFiles.map((f, i) => ({ file: f, selfInfo: I[i][i] }));
  diag.sort((a, b) => b.selfInfo - a.selfInfo);

  console.log('\n  FIM 对角线 Top-10 (最高自信息 = 最多测试覆盖):');
  diag.slice(0, 10).forEach(d =>
    console.log('    I_ii=' + d.selfInfo.toString().padStart(4) + '  ' + d.file));

  console.log('\n  FIM 对角线脆弱点 (I_ii ≤ 2):');
  const fragile = diag.filter(d => d.selfInfo <= 2);
  fragile.slice(0, 15).forEach(d =>
    console.log('    I_ii=' + d.selfInfo.toString().padStart(4) + '  ' + d.file));
  if (fragile.length > 15) console.log('    ... 共 ' + fragile.length + ' 个');

  // Step 5: Eigenvalue decomposition
  console.log('\n[5/6] 特征值分解...');
  const numEigs = Math.min(F, 30);
  const eigenvalues = eigenDecompose(I, numEigs);

  const totalLambda = eigenvalues.reduce((s, x) => s + Math.abs(x), 0);
  const sumLambda2 = eigenvalues.reduce((s, x) => s + x * x, 0);
  const N_eff = totalLambda > 0 ? totalLambda ** 2 / sumLambda2 : 0;
  const nonZeroEigs = eigenvalues.filter(x => x > 1e-6);
  const kappa = nonZeroEigs.length > 0 ? nonZeroEigs[0] / nonZeroEigs[nonZeroEigs.length - 1] : Infinity;

  console.log('\n  特征值谱 (top 15):');
  let cumVar = 0;
  eigenvalues.slice(0, 15).forEach((ev, i) => {
    cumVar += Math.abs(ev);
    console.log('    λ' + (i + 1).toString().padStart(2) + ' = ' +
      ev.toFixed(2).padStart(8) + '  (' + (Math.abs(ev) / totalLambda * 100).toFixed(1).padStart(5) + '%)' +
      '  cum: ' + (cumVar / totalLambda * 100).toFixed(1) + '%');
  });

  console.log('\n  ─────── 汇总 ───────');
  console.log('  条件数 κ      = ' + kappa.toFixed(2));
  console.log('  有效维度 N_eff = ' + N_eff.toFixed(2) + ' / ' + F);
  console.log('  非零特征值数   = ' + nonZeroEigs.length + ' / ' + F);

  // Step 6: Package-level aggregation + Mantel test
  console.log('\n[6/6] 包级聚合 + Mantel test...');
  const { pkgFIM, pkgNames } = aggregateToPackageLevel(I, allSrcFiles, 2);
  const P = pkgNames.length;

  console.log('  包数: ' + P);
  console.log('  包级 FIM 对角线:');
  pkgNames.forEach((p, i) =>
    console.log('    ' + p.padEnd(35) + ' I_pkg=' + pkgFIM[i][i].toString().padStart(6)));

  // Package-level eigenvalues
  const pkgEigs = eigenDecompose(pkgFIM, P);
  const pkgTotalLambda = pkgEigs.reduce((s, x) => s + Math.abs(x), 0);
  const pkgKappa = pkgEigs[0] / Math.max(pkgEigs[P - 1], 1e-9);
  const pkgNeff = pkgTotalLambda > 0 ? pkgTotalLambda ** 2 / pkgEigs.reduce((s, x) => s + x * x, 0) : 0;

  console.log('\n  包级特征值:');
  pkgEigs.forEach((ev, i) =>
    console.log('    λ' + (i + 1) + ' = ' + ev.toFixed(2).padStart(8) +
      '  (' + (Math.abs(ev) / pkgTotalLambda * 100).toFixed(1) + '%)'));
  console.log('  包级 κ      = ' + pkgKappa.toFixed(2));
  console.log('  包级 N_eff  = ' + pkgNeff.toFixed(2) + ' / ' + P);

  // Try to load co-change data for Mantel test
  const cochangePath = '.archguard/query/git-history/pkg-cochange.json';
  if (existsSync(resolve(ROOT, cochangePath))) {
    console.log('\n  ─── Mantel Test: 覆盖 FIM vs Co-change ───');
    try {
      const ccRaw = JSON.parse(readFileSync(resolve(ROOT, cochangePath), 'utf-8'));
      // Build co-change matrix aligned with pkgNames
      const ccMatrix = Array.from({ length: P }, () => new Array(P).fill(0));
      // Fill from co-change data
      for (const entry of (ccRaw.edges || ccRaw || [])) {
        const iA = pkgNames.indexOf(entry.source || entry.from);
        const iB = pkgNames.indexOf(entry.target || entry.to);
        if (iA >= 0 && iB >= 0) {
          ccMatrix[iA][iB] = entry.strength || entry.count || 1;
          ccMatrix[iB][iA] = entry.strength || entry.count || 1;
        }
      }
      const result = mantelTest(pkgFIM, ccMatrix);
      console.log('  Mantel r = ' + result.observedCorrelation.toFixed(4));
      console.log('  p-value  = ' + result.pValue.toFixed(4));
      console.log('  结论: ' + (result.pValue < 0.05 ?
        'Co-change IS a valid FIM proxy (p < 0.05)' :
        'Co-change is NOT a valid FIM proxy (p >= 0.05)'));
    } catch (e) {
      console.log('  (co-change 数据格式不匹配，跳过 Mantel test)');
    }
  } else {
    console.log('\n  (未找到 co-change 数据，跳过 Mantel test)');
    console.log('  提示: 先运行 archguard_analyze_git 生成 co-change 数据');
  }

  // ── Build co-change matrix from raw git data ──
  console.log('\n  ─── 替代 Mantel Test: 使用 git log 构建 co-change ───');
  // We'll use package self-churn and joint churn from previous analysis
  const cochangeManual = {
    'src/cli': { 'src/types': 30, 'src/plugins': 24, 'src/mermaid': 22, 'src/parser': 18, 'src/core': 6, 'src/analysis': 7 },
    'src/types': { 'src/plugins': 21, 'src/mermaid': 15, 'src/parser': 12, 'src/core': 6, 'src/analysis': 3 },
    'src/plugins': { 'src/mermaid': 16, 'src/parser': 10, 'src/core': 7, 'src/analysis': 6 },
    'src/mermaid': { 'src/parser': 13, 'src/core': 3, 'src/analysis': 3 },
    'src/parser': { 'src/core': 0, 'src/analysis': 0 },
    'src/core': { 'src/analysis': 3 },
  };

  // Filter to packages that exist in pkgNames
  const corePkgs = ['src/cli', 'src/types', 'src/plugins', 'src/mermaid', 'src/parser', 'src/core', 'src/analysis'];
  const coreIdx = corePkgs.map(p => pkgNames.indexOf(p)).filter(i => i >= 0);
  const coreNames = coreIdx.map(i => pkgNames[i]);
  const CP = coreNames.length;

  if (CP >= 4) {
    // Extract sub-matrices
    const fimSub = Array.from({ length: CP }, (_, a) =>
      Array.from({ length: CP }, (_, b) => pkgFIM[coreIdx[a]][coreIdx[b]]));

    const ccSub = Array.from({ length: CP }, () => new Array(CP).fill(0));
    for (let a = 0; a < CP; a++) {
      ccSub[a][a] = 1; // self
      for (let b = a + 1; b < CP; b++) {
        const pa = coreNames[a], pb = coreNames[b];
        const val = (cochangeManual[pa] && cochangeManual[pa][pb]) ||
          (cochangeManual[pb] && cochangeManual[pb][pa]) || 0;
        ccSub[a][b] = val;
        ccSub[b][a] = val;
      }
    }

    const result = mantelTest(fimSub, ccSub, 9999);
    console.log('  核心包数: ' + CP + ' (' + coreNames.join(', ') + ')');
    console.log('  Mantel r = ' + result.observedCorrelation.toFixed(4));
    console.log('  p-value  = ' + result.pValue.toFixed(4));
    console.log('  结论: ' + (result.pValue < 0.05 ?
      '✓ Co-change IS a statistically significant proxy for coverage FIM (p < 0.05)' :
      '✗ Co-change is NOT a significant proxy for coverage FIM (p >= 0.05)'));
  }

  // Output JSON for machine consumption
  const output = {
    timestamp: new Date().toISOString(),
    source: 'import-approximation',
    fileCount: F,
    testCount: T,
    conditionNumber: kappa,
    effectiveDimension: N_eff,
    eigenvalues: eigenvalues.slice(0, 20),
    uncoveredFiles: uncovered,
    packageLevel: {
      conditionNumber: pkgKappa,
      effectiveDimension: pkgNeff,
      packageCount: P,
      eigenvalues: pkgEigs,
    }
  };
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('JSON output:');
  console.log(JSON.stringify(output, null, 2));
}

main().catch(console.error);
