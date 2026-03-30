# Proposal: 基于测试覆盖矩阵的 Fisher 信息度量 — GIT 理论的经验检验框架

**状态**: Draft (v2 — post-experiment revision)
**日期**: 2026-03-30

| Version | Changes |
|---------|---------|
| v1 | Initial draft |
| v2 | Post-experiment revision: elevate Phase 2a priority based on spike findings; correct import-approximation limitations; add type-file false positive mitigation |
**关联**: proposal-jl-intrinsic-dimension.md、proposal-information-shape-smell-detection.md、proposal-test-analysis.md
**起源**: 对 ArchGuard 项目自身执行 GIT (几何信息论) 框架的统计度量时，发现协变矩阵作为 Fisher 信息矩阵(FIM)的代理缺乏数学合法性——协变计数既非正半定，也不源于概率模型。需要一种从概率模型严格推导的 FIM 构造方法。

---

## 背景与动机

### GIT 框架的经验检验困境

几何信息论 (GIT) 将软件系统建模为统计流形 $\mathcal{M}$，其黎曼度量由 Fisher 信息矩阵 (FIM) 定义。GIT 的核心预测包括：

1. 良好重构应降低描述长度 $L(X)$
2. 架构健康度与 FIM 条件数 $\kappa(I)$ 负相关
3. 断言加固（增加测试）应降低 Cramér-Rao 界限
4. 包级粒度是 MDL 最优的分析层级

然而，当我们对 ArchGuard 自身执行这些度量时，发现一个根本问题：**没有概率模型，就没有真正的 FIM**。

此前的分析使用 co-change 矩阵（$C_{ij} = \text{joint\_commits}(i,j) / \text{self\_commits}(i)$）作为 FIM 代理。这一代理存在三个结构性缺陷：

| 缺陷 | 说明 |
|------|------|
| **非正半定** | $C$ 不对称（$C_{ij} \neq C_{ji}$），特征值可为负 |
| **无概率模型** | 提交计数比值不对应任何 $\partial \ln p / \partial \theta$ |
| **混淆信号** | 单作者项目中，co-change 混合了结构耦合与个人工作习惯 |

### 解决方案：测试套件作为采样预言机

软件系统有一个多数统计问题不具备的资源：**测试套件定义了一个可操作的概率模型**。

- $\theta$ = 代码状态（按文件/函数参数化）
- $x$ = 测试结果向量（每个测试的 pass/fail）
- $p(x|\theta)$ = 给定代码状态时测试套件产生结果 $x$ 的概率

对 $\theta$ 做微小扰动（代码变异），观察 $x$ 的变化——这**就是** Fisher 信息的经验估计，不是隐喻。

**覆盖矩阵** $C \in \{0,1\}^{T \times F}$（$T$ = 测试数，$F$ = 源文件数），其中 $C_{tf} = 1$ 当且仅当测试 $t$ 执行了文件 $f$ 中的代码。由此构造：

$$I = C^\top C \in \mathbb{R}^{F \times F}$$

$I$ 是 Gram 矩阵，**保证正半定**，特征值保证非负。$I_{ij}$ = 同时覆盖文件 $i$ 和文件 $j$ 的测试数——直接度量"观测 $x$ 能提供多少关于 $\theta_i$ 和 $\theta_j$ 联合信息"。

---

## 目标

1. 从 istanbul/c8 覆盖数据构造覆盖矩阵 $C$，计算 Gram 矩阵 $I = C^\top C$ 作为真正的 FIM
2. 提取特征值谱、条件数 $\kappa$、有效维度 $N_{\text{eff}}$，作为架构健康的几何指标
3. 与现有 co-change 矩阵做 Mantel test（矩阵相关性检验），验证 co-change 作为 FIM 代理的有效性
4. 支持纵向快照对比，检验 GIT 的可证伪预测
5. 通过 MCP 工具和 CLI flag 暴露结果

---

## 非目标

- 不实现变异测试集成（Stryker 等）。变异矩阵 FIM 精度更高，但计算成本为 $O(\text{mutations} \times \text{tests})$，作为可选 Phase 2 保留。
- 不自动生成重构建议。本提案提供度量基础设施，处方性功能由消费者（LLM 对话层、未来的推荐工具）完成。
- 不替代现有 co-change 分析。本提案提供**交叉验证**信号，而非替代品。
- 不实现自然梯度计算。$I^{-1} \nabla \mathcal{L}$ 需要定义损失函数和梯度，属于后续研究。

---

## 现状审计

### ArchGuard 已有的测试/覆盖能力

| 能力 | 位置 | 覆盖矩阵可用？ |
|------|------|----------------|
| `isTestFile()` / `extractTestStructure()` | 各语言插件 | 否——仅识别测试文件，不读取运行时覆盖 |
| `TestCoverageMapper` | `src/analysis/test-coverage-mapper.ts` | 否——使用 import 分析 + 路径约定推断覆盖，不读取 istanbul 数据 |
| `TestIssueDetector` | `src/analysis/test-issue-detector.ts` | 否——消费 coverage score，不提供文件级覆盖矩阵 |
| Co-change 分析 | `src/cli/git-history/` | 间接——提供协变频率，可做交叉验证参照 |

### 缺口

1. **istanbul/c8 JSON 报告解析器**——不存在。需要把 `coverage-final.json` 解析为 $C_{tf}$ 矩阵。
2. **Gram 矩阵计算 + 特征值分解**——不存在。`proposal-jl-intrinsic-dimension` 引入了 `ml-matrix` 的 SVD，本提案复用。
3. **Mantel test**——不存在。需要矩阵相关性检验（置换检验）。
4. **纵向快照存储**——`arch-health-history.json` 已由 JL proposal 设计，可扩展。

### 可复用的现有组件

| 组件 | 来源 | 复用方式 |
|------|------|---------|
| `ml-matrix` SVD | proposal-jl-intrinsic-dimension | 特征值分解 |
| `ArchHealthHistory` | proposal-jl-intrinsic-dimension | 扩展快照 schema，共用存储文件 |
| Co-change 矩阵 | `archguard_analyze_git` | Mantel test 的参照矩阵 |
| 实体/关系图 | ArchJSON | 文件→实体映射 |

---

## 设计

### 架构决策

#### 决策1：覆盖粒度 — 文件级 vs 函数级

| 方案 | 矩阵维度 | 精度 | 与 co-change 可比性 |
|------|---------|------|-------------------|
| 文件级 | $T \times F$，$F$ ≈ 156 (ArchGuard) | 粗 | 高（co-change 也是文件级） |
| 函数级 | $T \times M$，$M$ ≈ 700+ | 高 | 低（co-change 无函数级数据） |

**决策**：Phase 1 使用**文件级**。理由：(a) 与 co-change 矩阵粒度对齐，Mantel test 才有意义；(b) istanbul JSON 天然以文件为单位组织；(c) 包级聚合可从文件级矩阵直接导出。

#### 决策2：覆盖判定阈值

一个测试"覆盖"一个文件的判定：$C_{tf} = 1 \iff$ 测试 $t$ 运行时文件 $f$ 中至少有 1 个语句被执行。

不使用行覆盖率作为连续值（$C_{tf} = \text{coverage\%}$），因为 Gram 矩阵 $C^\top C$ 的 FIM 语义要求二值矩阵：Fisher 信息度量的是"观测到/未观测到"的区分能力，而非"观测了多少"。

#### 决策3：Mantel test 实现

Mantel test 检验两个距离矩阵之间的相关性：

1. 将覆盖 FIM $I_{\text{cov}}$ 和 co-change 矩阵 $I_{\text{cc}}$ 分别转换为距离矩阵（$D_{ij} = 1 - I_{ij}/\max(I)$，归一化）
2. 计算 Pearson 相关 $r_{\text{obs}}$ 在上三角元素之间
3. 对 $I_{\text{cc}}$ 做 $N = 999$ 次行列同步置换，每次重算 $r$
4. $p = (\text{count}(r_{\text{perm}} \geq r_{\text{obs}}) + 1) / (N + 1)$
5. $p < 0.05$ → co-change 是覆盖 FIM 的有效代理

### 数据流

```
vitest --coverage → coverage-final.json
                           ↓
                   coverage-parser.ts
                   (解析 istanbul JSON → C[test][file] 二值矩阵)
                           ↓
                    fim-builder.ts
                   (I = CᵀC, 特征值分解, κ, N_eff)
                           ↓
               ┌───────────┴───────────┐
               ↓                       ↓
        mantel-test.ts          fim-snapshot.ts
     (I_cov vs I_cochange       (追加到
      置换检验)                  arch-health-history.json)
               ↓                       ↓
          MCP tools               CLI output
```

### istanbul/c8 覆盖数据解析

istanbul `coverage-final.json` 结构：

```json
{
  "/absolute/path/to/file.ts": {
    "s": { "0": 5, "1": 0, "2": 3, ... },  // 语句执行次数
    "b": { "0": [3, 2], ... },               // 分支执行次数
    "f": { "0": 5, ... },                    // 函数执行次数
    ...
  }
}
```

但 `coverage-final.json` 是**聚合后**的全局覆盖（所有测试合并）。要构造 $C_{tf}$ 矩阵（每个测试对每个文件的覆盖），需要**per-test 覆盖数据**。

**获取 per-test 覆盖的方法**：

vitest 支持 `--coverage.perFile` 尚未稳定。替代方案：

1. **V8 覆盖 + vitest reporter**：使用 vitest 的 `@vitest/coverage-v8`，配合自定义 reporter，在每个测试用例完成后输出增量覆盖。
2. **Istanbul per-test 模式**：c8 的 `--per-file` 输出或 `NYC_PROCESS_ID` 环境变量分离。
3. **近似方案（Phase 1 采用）**：使用 vitest 的 `--reporter=json` 获取测试列表，结合 `--coverage.all` 获取全局覆盖，然后用**测试文件→源文件 import 依赖**构造近似 $C$ 矩阵。这与现有 `TestCoverageMapper` 的 import-layer 一致，但输出格式为标准化的二值矩阵。

**Phase 1 数据源决策**：

| 数据源 | $C$ 矩阵精度 | 实现成本 | 可用性 |
|--------|-------------|---------|--------|
| 真实 per-test 覆盖 | 高 | 高（需定制 reporter）| Phase 2 |
| import 依赖近似 | 中 | 低（复用 TestCoverageMapper）| **Phase 1** |
| 全局覆盖 + 测试文件归属 | 中 | 中 | Phase 1 备选 |

**⚠ Import 近似的已知偏差（spike 实测）**：

`scripts/fim-experiment.mjs` 在 ArchGuard 自身上的实验（`docs/spikes/fim-experiment-report.md`）发现 import 近似存在系统性失真：纯类型定义文件（如 `src/types/config-cli.ts`）被 ~100 个测试 import 但运行时零语句执行，导致 import-based FIM 的 $I_{ii}$ 严重虚高（106 vs 真实 0）。

文件级排名几乎完全翻转：import 近似的 Top-10 全是 `src/types/` 文件，真实覆盖的 Top-10 是 `golang/tree-sitter-bridge.ts`、`mermaid/generator.ts` 等业务逻辑文件。

**结论**：import 近似在包级聚合后仍然有效（Mantel r=0.77, p=0.01），但**文件级 FIM 不可信**。如需文件级分析，必须使用 Phase 2a 的运行时覆盖数据。

Phase 1 使用 import 依赖近似：对每个测试文件 $t$，追踪其 import 链到达的源文件集合 $\{f_1, f_2, ...\}$，令 $C_{t,f_k} = 1$。这与真实运行时覆盖有偏差（import 不等于执行），但：
- 保证 $C$ 是二值矩阵
- 保证 $I = C^\top C$ 正半定
- 与 co-change 的 Mantel test 仍然有意义（两者都是静态代理）

**Phase 2 升级路径**：接入真实 per-test 覆盖数据后，仅需替换 `coverage-parser.ts` 的数据源，下游 `fim-builder.ts` 和 `mantel-test.ts` 无需修改。

### 覆盖矩阵构造

```typescript
// src/analysis/fim/coverage-parser.ts

export interface CoverageMatrix {
  /** 行：测试文件 ID，列：源文件 ID */
  matrix: number[][];    // T×F 二值矩阵 (0 或 1)
  testIds: string[];     // 长度 T
  fileIds: string[];     // 长度 F
}

/**
 * Phase 1: 从 import 依赖构造近似覆盖矩阵
 * Phase 2: 从 per-test 覆盖数据构造精确覆盖矩阵
 */
export function buildCoverageMatrix(
  testFiles: TestFileInfo[],
  sourceFiles: string[],
  importGraph: Map<string, Set<string>>
): CoverageMatrix;
```

> **Phase 1 缓解措施**：可选地排除纯类型定义文件（仅含 `interface`/`type`/`enum` 声明、无可执行语句的文件）以降低 false positive。但此过滤需要 AST 分析或启发式规则，且可能引入 false negative。推荐方案仍为升级至 Phase 2a。

### FIM 构造与特征值分析

```typescript
// src/analysis/fim/fim-builder.ts

export interface FisherInformationResult {
  /** I = CᵀC 的特征值（降序） */
  eigenvalues: number[];
  /** 条件数 κ = λ_max / λ_min（λ_min > ε 时；否则 Infinity） */
  conditionNumber: number;
  /** 有效维度 N_eff = (Σλ)² / Σλ² */
  effectiveDimension: number;
  /** 源文件数 */
  fileCount: number;
  /** 测试数 */
  testCount: number;
  /** FIM 对角线 I_ii（每个文件的自信息 = 覆盖该文件的测试数） */
  diagonal: { fileId: string; selfInfo: number }[];
  /** CRB 脆弱点（I_ii = 0 的文件 = 零测试覆盖） */
  uncoveredFiles: string[];
  /** CRB 高脆弱点（I_ii < threshold 的文件） */
  fragilityHotspots: { fileId: string; selfInfo: number; crb: number }[];
}

export function computeFisherInformation(
  coverage: CoverageMatrix,
  fragilityThreshold?: number  // 默认: 3（少于 3 个测试覆盖 = 脆弱）
): FisherInformationResult;
```

计算步骤：

```
1. I = Cᵀ × C                          // F×F Gram 矩阵
2. SVD(I) → eigenvalues σ₁² ≥ σ₂² ≥ ...  // 或直接对 C 做 SVD 取奇异值平方
3. κ = σ₁² / σ_r²                       // r = rank(I), σ_r 为最小非零奇异值
4. N_eff = (Σσᵢ²)² / Σσᵢ⁴
5. diagonal[f] = I[f][f] = 覆盖文件 f 的测试数
6. uncoveredFiles = { f | I[f][f] = 0 }
7. fragilityHotspots = { f | 0 < I[f][f] < threshold }
```

**实现注意**：对于 $F \leq 500$（ArchGuard 量级），直接计算 $C^\top C$ 后用 `ml-matrix` SVD。对于 $F > 500$，对 $C$ 做 SVD（$T \times F$ 通常 $T > F$），取右奇异值平方，避免构造大矩阵。

### 包级聚合

文件级 FIM 可聚合为包级 FIM，与 co-change 包级矩阵对齐：

```
对每个包 P，定义指示矩阵 G ∈ {0,1}^{F×P}，G[f][p] = 1 iff file f ∈ package p
包级覆盖矩阵 C_pkg = C × G    (T × P)
包级 FIM I_pkg = C_pkg^T C_pkg  (P × P)
```

### Mantel Test

```typescript
// src/analysis/fim/mantel-test.ts

export interface MantelTestResult {
  /** 观测相关系数 */
  observedCorrelation: number;
  /** 置换次数 */
  permutations: number;
  /** p 值 */
  pValue: number;
  /** co-change 是否为有效 FIM 代理（p < 0.05） */
  isValidProxy: boolean;
}

/**
 * 检验覆盖 FIM 与 co-change 矩阵之间的矩阵相关性。
 * 输入必须为相同维度（包级聚合后）。
 */
export function mantelTest(
  fimMatrix: number[][],
  cochangeMatrix: number[][],
  permutations?: number  // 默认: 999
): MantelTestResult;
```

### 纵向快照

复用 `proposal-jl-intrinsic-dimension` 的 `ArchHealthHistory` schema，扩展快照类型：

```typescript
// 扩展 src/analysis/jl/types.ts
export interface FIMSnapshot {
  timestamp: string;
  commitSha?: string;
  source: 'import-approximation' | 'per-test-coverage' | 'mutation';
  fileCount: number;
  testCount: number;
  conditionNumber: number;
  effectiveDimension: number;
  /** 前 20 个特征值（归一化为占比） */
  topEigenvalueShares: number[];
  /** 零覆盖文件数 */
  uncoveredFileCount: number;
  /** Mantel test 结果（如已执行） */
  mantelCorrelation?: number;
  mantelPValue?: number;
}
```

存储路径：`.archguard/query/fim/fim-history.json`

### GIT 可证伪预测的检验

本提案的核心价值是使 GIT 理论的预测可被数据否定。以下每条预测都定义了明确的否定条件：

| # | GIT 预测 | 可观测量 | 计算方法 | 否定条件 |
|---|----------|---------|---------|---------|
| P1 | 良好重构降低描述长度 | $\rho = L(X)_{\text{after}} / L(X)_{\text{before}}$ | ArchJSON 实体/关系数变化 | 公认好重构后 $\rho \geq 1.0$ |
| P2 | 良好重构改善 FIM 条件 | $\Delta\kappa = \kappa_{\text{after}} - \kappa_{\text{before}}$ | 重构前后各取一次 FIM 快照 | 好重构后 $\Delta\kappa \geq 0$（条件未改善） |
| P3 | 断言加固降低 CRB | 新增测试后 $I_{ii}$ 增加 | FIM 对角线变化 | 新增测试后 $I_{ii}$ 不变（新测试未覆盖目标文件，或覆盖已充分） |
| P4 | 包级是 MDL 最优粒度 | $L_{\text{pkg}}$ vs $L_{\text{file}}$ vs $L_{\text{system}}$ | 三级 FIM 的 MDL 计算比较 | 文件级 MDL 始终低于包级 |
| P5 | co-change 是 FIM 的有效代理 | Mantel $r$ 和 $p$ | 覆盖 FIM vs co-change 矩阵的置换检验 | $p \geq 0.05$（相关性不显著） |

**P5 是最关键的检验**——它直接决定了此前所有基于 co-change 的分析是否有效。

### CLI 集成

```bash
# 计算覆盖 FIM（需要先运行 coverage）
node dist/cli/index.js analyze --fim

# 同时执行 co-change 交叉验证（需要先运行 archguard_analyze_git）
node dist/cli/index.js analyze --fim --fim-validate
```

CLI 输出示例：

```
Fisher Information Matrix (coverage-based)
  Source:     import-approximation (Phase 1)
  Files:      156 source files, 3141 tests
  κ(I):       12.34
  N_eff:      5.8 / 8 packages (72.5%)
  Zero-cover: 3 files (src/ai/...)
  Fragile:    7 files (I_ii < 3)

  Mantel Test (coverage FIM vs co-change):
    r = 0.47, p = 0.003 → co-change IS a valid FIM proxy
```

### MCP 工具

新增 `archguard_get_fim`：

```typescript
// 输入
{
  "level": "file" | "package",    // 默认: "package"
  "includeMantel": true,          // 是否执行 Mantel test（需 git history）
  "snapshotCount": 5              // 返回最近 N 个快照
}

// 输出
{
  "current": {
    "conditionNumber": 12.34,
    "effectiveDimension": 5.8,
    "fileCount": 156,
    "testCount": 3141,
    "topEigenvalues": [0.312, 0.148, ...],
    "uncoveredFiles": ["src/ai/plantuml-generator.ts", ...],
    "fragilityHotspots": [
      { "fileId": "src/core/plugin-registry.ts", "selfInfo": 2, "crb": 0.5 }
    ]
  },
  "mantel": {
    "observedCorrelation": 0.47,
    "pValue": 0.003,
    "isValidProxy": true
  },
  "history": [...],
  "gitPredictions": {
    "P1_descriptionLength": { "current": 7076, "previous": null },
    "P2_conditionNumber": { "current": 12.34, "previous": null, "improved": null },
    "P5_cochangeValidity": { "correlation": 0.47, "significant": true }
  }
}
```

---

## 文件结构

```
src/analysis/fim/
  types.ts                    # CoverageMatrix, FisherInformationResult, FIMSnapshot
  coverage-parser.ts          # Phase 1: import 依赖 → C 矩阵
                              # Phase 2: istanbul JSON → C 矩阵
  fim-builder.ts              # I = CᵀC, SVD, κ, N_eff, 脆弱点
  mantel-test.ts              # 矩阵相关性置换检验
  fim-snapshot.ts             # 追加到 fim-history.json

src/cli/commands/
  analyze.ts                  # --fim, --fim-validate flags

src/cli/mcp/tools/
  fim-tools.ts                # archguard_get_fim MCP 工具

tests/unit/analysis/fim/
  coverage-parser.test.ts
  fim-builder.test.ts
  mantel-test.test.ts
```

---

## 实现范围

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/analysis/fim/types.ts` | 新建 | 类型定义 |
| `src/analysis/fim/coverage-parser.ts` | 新建 | import 依赖 → 覆盖矩阵 |
| `src/analysis/fim/fim-builder.ts` | 新建 | Gram 矩阵, SVD, 条件数, 脆弱点识别 |
| `src/analysis/fim/mantel-test.ts` | 新建 | 置换检验 |
| `src/analysis/fim/fim-snapshot.ts` | 新建 | 纵向快照存储 |
| `src/cli/commands/analyze.ts` | 修改 | 新增 `--fim`, `--fim-validate` flags |
| `src/cli/mcp/tools/fim-tools.ts` | 新建 | MCP 工具 |
| `src/cli/mcp/server.ts` | 修改 | 注册新 MCP 工具 |
| `tests/unit/analysis/fim/*.test.ts` | 新建 | 单元测试 |

### 不在本次范围内

- 变异测试集成（Stryker）——Phase 2
- 真实 per-test 运行时覆盖——Phase 2
- 自然梯度计算 $I^{-1}\nabla\mathcal{L}$——后续研究
- 自动重构建议——后续研究
- 其他语言（Go/Java/Python/C++）的覆盖数据解析——按需扩展

---

## Phase 2 升级路径

Phase 1 使用 import 近似构造 $C$ 矩阵，**但 spike 实验已证明 import 近似仅在包级聚合后有效，文件级 FIM 不可信**。因此 Phase 2a 不是可选升级，而是**文件级 FIM 分析的必要前提**。Phase 1 仅适用于包级聚合分析。

| 阶段 | $C$ 矩阵数据源 | FIM 精度 | 成本 | 文件级可信度 |
|------|---------------|---------|------|------------|
| Phase 1 | import 依赖图（静态） | 中——import ≠ 执行，类型文件 false positive | 低——复用现有 import 分析 | ✗ 不可信（spike 已验证） |
| Phase 2a | per-test 运行时覆盖（vitest custom reporter）| 高 | 中——需定制 reporter | ✓ 可信 |
| Phase 2b | 变异检测结果（Stryker）| 最高——直接度量 $\partial p/\partial\theta$ | 高——$O(M \times T)$ | ✓ 最高 |

**关键设计约束**：`fim-builder.ts` 只接收 `CoverageMatrix`（二值矩阵），不关心数据来源。Phase 升级只需替换 `coverage-parser.ts`，下游全部不变。

---

## 向后兼容性

- 所有新文件独立于现有分析链路
- `--fim` 为可选 flag，默认不触发
- `.archguard/query/fim/` 可随时删除，下次分析自动重建
- 不修改 ArchJSON schema
- 复用 `ml-matrix` 依赖（已由 JL proposal 引入）

---

## 验收标准

### 覆盖矩阵构造

1. 3 个测试文件、5 个源文件、已知 import 关系 → $C$ 矩阵与预期一致
2. 测试文件不出现在 $C$ 的列中（源文件列只包含非测试文件）
3. 无 import 关系的测试文件 → 该行全零

### FIM 构造

4. 人造 $C$（单位矩阵）→ $I$ = 单位矩阵，$\kappa = 1$，$N_{\text{eff}} = F$
5. 人造 $C$（所有测试覆盖所有文件）→ $I$ 为秩 1，$\kappa = \infty$（或极大），$N_{\text{eff}} = 1$
6. 人造 $C$（某列全零）→ 该文件出现在 `uncoveredFiles` 中
7. $I$ 的所有特征值 $\geq 0$（正半定性）
8. `diagonal[f]` = $C$ 的第 $f$ 列的 $L_1$ 范数（即覆盖该文件的测试数）

### Mantel Test

9. 两个相同矩阵的 Mantel test → $r = 1.0$，$p < 0.05$
10. 覆盖 FIM 与随机矩阵的 Mantel test → $p > 0.05$（大概率）
11. 固定 seed 下，两次运行产生相同的 $p$ 值

### 包级聚合

12. 文件级 FIM 聚合到包级后，矩阵维度 = 包数
13. 包级 FIM 的对角线 = 该包内所有文件的 $I_{ii}$ 之和

### 纵向快照

14. 连续两次 `--fim` 分析后，`fim-history.json` 包含 2 条记录
15. `source` 字段正确反映数据源（Phase 1 为 `'import-approximation'`）

### 回归

16. 现有所有测试通过，`--fim` 未指定时不影响任何现有流程

---

## Spike 实验结果

实验已在 ArchGuard 自身上完成。详见 `docs/spikes/fim-experiment-report.md`。

关键发现：
1. **P5 成立**：Co-change 是覆盖 FIM 的统计显著代理（Mantel r=0.77, p=0.01），回溯验证了基于 co-change 的 GIT 分析
2. **P2 粒度敏感**：DiagramProcessor 重构（`429159d`）在文件级改善 κ（329.69→327.64），包级反而恶化（74613→79285）
3. **Import 近似文件级不可信**：纯类型文件的 false positive 主导了 λ₁（51%方差），文件级 Top-10 排名与真实覆盖完全翻转
4. **包级有效**：包级聚合消除了类型文件偏差，Mantel test 在三个时间点一致通过

---

## 开放问题

| 问题 | 说明 | 建议处理时机 |
|------|------|------------|
| Per-test 覆盖的最佳获取方式 | vitest 的 `@vitest/coverage-v8` 尚无官方 per-test API。可能需要 custom reporter 或 fork | Phase 2 前评估 |
| $\kappa$ 的"健康"阈值 | 不同项目的 $\kappa$ 基线不同。是否存在跨项目的通用阈值？ | 在多项目验证后确定 |
| Mantel test 的统计功效 | 当包数 $P < 10$ 时，$P(P-1)/2$ 个独立元素太少，置换检验功效低 | 文件级 Mantel test 作为补充 |
| 与 JL intrinsic dimension 的关系 | FIM 特征值谱与邻接矩阵 SVD 的 $d_{int}$ 是否等价？理论上一个度量测试可观测性，一个度量依赖结构 | 实测后比较 |
| 跨语言支持 | Go/Java/Python/C++ 的覆盖工具格式不同（go test -cover、JaCoCo、coverage.py） | 按需扩展 coverage-parser |
| Import 近似的类型文件偏差 | 纯类型定义文件（interface-only）导致 $I_{ii}$ 虚高。Phase 1 可通过排除无可执行语句文件缓解，但根本解决需 Phase 2a | Phase 2a 前评估排除策略 |

---

## 与相关 Proposal 的关系

| Proposal | 关系 |
|----------|------|
| `proposal-jl-intrinsic-dimension` | 共享 `ml-matrix` 依赖和 SVD 基础设施。$d_{int}$（依赖图结构复杂度）与 $\kappa(I)$（测试可观测性复杂度）是互补指标 |
| `proposal-information-shape-smell-detection` | FIM 对角线为零的文件 = 无覆盖 = CRB infinite = 最脆弱环节，与 smell 检测的脆弱性分析互补 |
| `proposal-test-analysis` | 本提案消费 `isTestFile()` 和 `extractTestStructure()` 的输出，将测试发现转化为覆盖矩阵的行 |

---

## 参考

- Fisher, R.A. (1925). Theory of Statistical Estimation. *Proc. Cambridge Phil. Soc.* 22(5).
- Amari, S. (1998). Natural Gradient Works Efficiently in Learning. *Neural Computation* 10(2).
- Rissanen, J. (1996). Fisher Information and Stochastic Complexity. *IEEE Trans. IT* 42(1).
- Mantel, N. (1967). The Detection of Disease Clustering and a Generalized Regression Approach. *Cancer Research* 27(2).
- Legendre, P. & Legendre, L. (2012). *Numerical Ecology*, 3rd ed. — Mantel test 的标准参考。
- `src/analysis/test-coverage-mapper.ts` — 现有 import-layer 覆盖映射逻辑
- `src/types/index.ts:185-192` — `Relation` 接口
- `proposal-jl-intrinsic-dimension.md` — `ml-matrix` SVD, `ArchHealthHistory` schema
