# Fisher Information Matrix Minimum Viable Experiment Report

**Date**: 2026-03-30
**Tool**: `scripts/fim-experiment.mjs`
**Target**: ArchGuard self-analysis

---

## Experiment Design

**Goal**: Construct real FIM from test coverage matrix `I = C^T C`, test 5 falsifiable GIT predictions.

**Method**: Import-based approximate coverage matrix (Phase 1), 170 test files x 163 source files.

**Refactoring event**: commit `429159d` -- DiagramProcessor god class decomposed into 4 focused modules (plan-34)

- Before: `a90bd5e`
- After: `429159d`
- Current HEAD: `a74ba0e`
- 4 new source files + 4 new test files, `diagram-processor.ts`: -201 lines

**Computational method**: Power iteration eigenvalue decomposition, Mantel permutation test (9999 permutations).

**Real runtime coverage**: Also collected via `vitest --coverage` (`coverage-final.json`, 3.1MB).

---

## Key Results

### P5 (most critical): Co-change as FIM proxy

Three time points all show statistically significant correlation:

| Time point | Commit | Mantel r | p-value |
|------------|--------|----------|---------|
| Before refactoring | `a90bd5e` | 0.755 | 0.011 |
| After refactoring | `429159d` | 0.773 | 0.011 |
| Current HEAD | `a74ba0e` | 0.769 | 0.012 |

**Conclusion**: Co-change IS a statistically significant proxy for coverage FIM at package level (r~0.77, p<0.02).

> 这是最重要的发现：co-change 矩阵和 coverage FIM 在 package 粒度上确实存在统计显著的相关性，追溯验证了此前基于 co-change 的 GIT 分析的合理性。

### P2: Refactoring improves FIM condition number

**File-level**:
- Before: kappa=329.69, After: kappa=327.64, Delta=-2.05 --> Improved (weakly)
- Before: N_eff=3.42, After: N_eff=3.39 --> approximately no change

**Package-level**:
- Before: kappa=74,613, After: kappa=79,285, Delta=+4,672 --> Worsened
- Before: N_eff=1.97, After: N_eff=1.92 --> Slightly decreased

> Package-level 恶化的原因：4个新文件全部在 `src/cli/processors/` 内部，package 粒度的聚合无法观测到包内部的拓扑改善。这揭示了 GIT 预测对分析粒度的高度敏感性。

### Eigenvalue spectrum comparison (before vs after refactoring)

| Eigenvalue | Before | After | Change |
|-----------|--------|-------|--------|
| lambda_1 | 1524 (50.7%) | 1633 (51.0%) | +7.1% |
| lambda_2 | 453 (15.1%) | 479 (15.0%) | +5.8% |
| lambda_3 | 225 (7.5%) | 232 (7.3%) | +3.4% |
| lambda_4 | 180 (6.0%) | 189 (5.9%) | +5.0% |
| Cumulative lambda_1..4 | 79.2% | 79.2% | unchanged |

> God class 拆分是一个局部拓扑变换，不改变全局特征值结构。cumulative variance 完全不变，说明 FIM 的全局形状由更宏观的依赖结构决定。

### FIM diagonal: Information bottleneck identification

**Import-approx Top-5 self-information files** (consistent across all time points):

| File | I_ii |
|------|------|
| `src/types/config.ts` | 111 |
| `src/types/config-cli.ts` | 106 |
| `src/types/config-diagram.ts` | 106 |
| `src/types/config-global.ts` | 106 |
| `src/types/config-mermaid.ts` | 106 |

**Fragility points** (I_ii=0): `src/mermaid/render-worker.ts`, `src/mermaid/generator-formatting.ts`, `src/cli/types.ts`, `src/mermaid/index.ts`

---

## Critical finding: Import approximation vs real runtime coverage

Cross-validation with `coverage-final.json` (real V8 coverage data) revealed **systematic bias**.

### Top-3 comparison

**Import approximation**:
1. `src/types/config.ts` (I_ii=111)
2. `src/types/config-cli.ts` (I_ii=106)
3. `src/types/config-diagram.ts` (I_ii=106)

**Real runtime coverage**:
1. `src/plugins/golang/tree-sitter-bridge.ts` (524 stmts)
2. `src/plugins/golang/index.ts` (466 stmts)
3. `src/mermaid/generator.ts` (456 stmts)

> 排名几乎完全倒置。纯类型定义文件被约 100 个测试 import，但运行时语句执行量为零。Import 近似把 "imported = tested" 等价化，但类型文件是编译期依赖，不是运行时可观测量。这导致 import-based FIM 的 lambda_1（51% variance）被虚假的 `src/types/` 信号主导。

### Specific false positives

| File | Import I_ii | Real executed stmts | Verdict |
|------|-------------|---------------------|---------|
| `src/types/config-cli.ts` | 106 | 0 | FALSE POSITIVE |
| `src/types/config-diagram.ts` | 106 | 0 | FALSE POSITIVE |
| `src/types/config-global.ts` | 106 | 0 | FALSE POSITIVE |

### Specific misses

| File | Import I_ii | Real executed stmts | Verdict |
|------|-------------|---------------------|---------|
| `src/cli/processors/diagram-processor.ts` | 0 | 122 | MISSED |
| `src/plugins/golang/index.ts` | 0 | 466 | MISSED |
| `src/plugins/typescript/index.ts` | 0 | 403 | MISSED |

Of 22 files in `types/` directories: 10 have zero real coverage, 12 have some.

---

## Summary of 5 GIT predictions

| # | Prediction | Result | Confidence |
|---|-----------|--------|------------|
| P1 | Good refactoring reduces L(X) | Not tested (needs ArchJSON before/after) | -- |
| P2 | Good refactoring improves kappa | File-level: pass, Package-level: fail | Medium |
| P3 | Assertion hardening reduces CRB | Not tested (needs incremental test event) | -- |
| P4 | Package-level is MDL-optimal granularity | Questionable -- P2 fails at package level | Low |
| P5 | Co-change ~ FIM proxy | Pass: r=0.77, p=0.01 | High |

---

## Implications for Proposal

1. **P5 retroactively validates prior co-change-based GIT analysis.** 这是对 proposal 最有力的实证支撑。

2. **P2's split result reveals granularity sensitivity.** GIT 预测对分析层级高度敏感，而理论本身缺乏对层级选择的指导。Package 粒度看不到包内重构的改善，file 粒度又受 type-file 假阳性干扰。

3. **Import approximation is usable at package level** (Mantel r=0.77) **but UNRELIABLE at file level** due to type-file false positives. 真正的信息瓶颈是逻辑密集型文件（`golang/tree-sitter-bridge.ts`, `mermaid/generator.ts`），而非类型定义文件。

4. **Phase 2a (per-test runtime coverage) should be elevated from optional optimization to prerequisite** for file-level FIM. Import 近似在 file 粒度上的系统性偏差使其无法作为 FIM 的可靠数据源。

5. **The real information hubs are logic-heavy files**, not type definition files. 这对 ArchGuard 的测试策略有直接指导意义：应优先保障 `tree-sitter-bridge.ts`、`generator.ts`、`index.ts` 等高运行时覆盖文件的测试质量。
