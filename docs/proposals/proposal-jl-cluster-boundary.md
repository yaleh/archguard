# Proposal: 基于 JL 投影的模块聚类与包边界一致性分析

**状态**: Draft (v2 — 与 intrinsic-dimension v2 对齐)
**日期**: 2026-03-26
**关联**: proposal-jl-intrinsic-dimension.md（共享 JL 投影基础设施）

---

## 修订记录

| 版本 | 变更 |
|------|------|
| v1 | 初稿 |
| v2 | 与 intrinsic-dimension v2 对齐：特征空间改为邻接矩阵行/JL 投影空间（非手工 10 维），适配自适应双模式（DIRECT/JL），明确 K-Means 在邻接矩阵空间（DIRECT 模式）或 JL 投影空间上操作，补充孤立实体在邻接矩阵表征下的精确定义。 |

---

## 背景与动机

在领域驱动设计（DDD）中，理想状态下模块的**逻辑边界**（包/命名空间/目录）与模块的**结构行为**（依赖关系、耦合模式）应当高度吻合。但在软件演化过程中，这两层边界往往逐渐偏离：

- 最初属于同一领域的两个类，因为业务扩张而承担了不同的职责，在结构上已然"分离"，却仍处于同一包内（**包内结构分裂**）
- 属于不同包的两个类，因为历史原因形成了深度耦合，在结构上"合并"到了一起（**跨包结构融合**）

**现有工具的局限**：`archguard_detect_cycles` 只检测循环依赖（边的方向问题），无法回答"这些模块在结构上是否形成了自然的群落？群落边界与包边界是否重合？"

**本 Proposal 的思路**：

将每个实体的邻接矩阵行（或 JL 投影后的低维坐标）视为其"结构位置"，在这个位置空间中做聚类，得到**几何群落**（geometric clusters）。将几何群落与**声明边界**（package/namespace，即实体名前缀）对比，计算**边界一致性分数**（Boundary Alignment Score, BAS）。BAS 低的包，意味着其内部实体在结构上已经"各奔东西"，或者它与外部包之间形成了隐性的结构融合。

---

## 目标

1. 在邻接矩阵空间（DIRECT 模式）或 JL 投影空间（JL 模式）中对实体做无监督聚类
2. 将聚类结果与包（package/namespace）边界对比，计算每个包的 BAS
3. 识别**结构分裂包**（同包实体被分配到不同几何群落）和**跨域融合包**（不同包实体被分配到同一几何群落）
4. 通过 MCP 工具和 CLI 输出一致性报告
5. 在 Mermaid 图中可视化聚类结果（可选，Phase 2）

---

## 设计

### 输入：来自 intrinsic-dimension 基础设施

本 Proposal 在单个快照内操作，无跨时间需求。输入为 intrinsic-dimension proposal 中定义的：

```
DIRECT 模式 (n < 1000):
  输入矩阵 M = A_normalized ∈ ℝ^{n×n}（标准化邻接矩阵）
  每个实体的"结构位置" = M 的第 i 行 ∈ ℝ^n

JL 模式 (n ≥ 1000):
  输入矩阵 M = P ∈ ℝ^{n×k}（JL 投影后的矩阵）
  每个实体的"结构位置" = P 的第 i 行 ∈ ℝ^k
```

聚类和 BAS 计算均作用于 M 的行向量。

### 聚类算法选择

| 算法 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| K-Means | 简单，确定性（固定 seed）| 需要预设 K | 当包数量已知时 |
| DBSCAN | 无需预设 K，能检测噪声点 | 超参数敏感（ε、minPts）| 密度不均匀的依赖图 |
| Ward 层次聚类 | 无需预设 K，结果稳定 | O(n²) 内存 | n < 2000 时 |

**决策**：以**包数量**作为 K 的初始估计，用 K-Means 聚类（固定 seed 保证确定性）。对于大型项目（n > 1000），降级为 Mini-Batch K-Means。K 的选取策略：

```
K_init = max(2, distinct_package_count)
K_range = [max(2, K_init - 2), K_init + 3]
最终 K: 从 K_range 中选择 Silhouette Score 最高的值
```

Silhouette Score 同时也是衡量"聚类本身质量"的信号，若 Score < 0.2 则说明实体在空间中分布均匀，没有自然的群落结构，此时输出 `"no clear cluster structure detected"` 警告。

> **K-Means 在高维邻接矩阵空间的适用性**：DIRECT 模式下，K-Means 在 $\mathbb{R}^n$（$n$ 可能数百维）上运行。K-Means 在高维空间中的 curse of dimensionality 主要影响密度估计类算法（如 DBSCAN），对基于质心距离的 K-Means 影响有限。JL 模式下 $k \leq 400$，高维问题进一步缓解。

### 边界一致性分数（BAS）

对于包 $p$ 中的实体集合 $E_p$：

$$\text{purity}(p) = \frac{\max_{c} |E_p \cap C_c|}{|E_p|}$$

其中 $C_c$ 是第 $c$ 个几何群落。Purity 衡量"包内实体有多少比例落在同一个群落里"（范围 [0,1]，1 = 完全一致）。

**BAS** 综合两个方向：

$$\text{BAS}(p) = \frac{1}{2} \left( \text{purity}(p) + \text{coverage}(p) \right)$$

$$\text{coverage}(p) = \frac{\max_{c} |E_p \cap C_c|}{|C_c|}$$

- `purity` 衡量**包内纯度**：包内实体是否聚集在一个群落
- `coverage` 衡量**群落代表性**：该包是否主导了对应群落（防止小包因偶然落入同一群落而得高分）

> **coverage 的 $C_c$ 取法**：对于每个包 $p$，$c$ 取 $\argmax_c |E_p \cap C_c|$（即该包在哪个群落中出现最多）。

**系统级 BAS**：

$$\text{BAS}_{global} = \frac{\sum_p |E_p| \cdot \text{BAS}(p)}{\sum_p |E_p|}$$

（按包大小加权平均，防止小包主导评分）

### 分类输出

**结构分裂包**（Split Package）：

```
条件: purity(p) < 0.5 且 |E_p| ≥ 3
含义: 包内实体被分配到多个不同的几何群落
解读: 该包可能承担了多个不相关的职责，候选拆分点
```

**跨域融合**（Cross-Domain Fusion）：

```
条件: 一个几何群落 C_c 中，来自不同包的实体比例 > 60%，
      且最大贡献包的 coverage < 0.5
含义: 多个不同包的实体在结构上形成了一个群落
解读: 这些包之间存在隐性的高度耦合，可能需要合并或提取共享层
```

**孤立实体**（Orphan）：

```
条件: 邻接矩阵行为全零向量（fanIn=0 且 fanOut=0），即该实体
      与其他实体无任何依赖关系
含义: 该实体与系统其他部分几乎没有结构关联
解读: 可能是废弃代码、纯工具类或尚未集成的新代码
注意: 在聚类之前检测并从聚类输入中移除，避免零向量干扰质心计算
```

### 报告格式

#### CLI 输出

```
Module Cluster Boundary Analysis
  Mode: DIRECT (n=312)
  Entities: 312  |  Packages: 12  |  Clusters: 11  |  Silhouette: 0.47

  Global BAS: 0.71  (moderate alignment)

  Split Packages (purity < 0.5):
    src/cli         purity=0.38  BAS=0.31  → Cluster 3 (41%) + Cluster 7 (35%) + Cluster 1 (24%)
                    Suggestion: consider splitting into src/cli/commands and src/cli/query

  Cross-Domain Fusion:
    Cluster 5  →  src/analysis (52%) + src/parser (31%) + src/types (17%)
                  Shared entities: TestAnalyzer, ArchJSONAggregator, ArchJSON
                  Suggestion: these entities may warrant a shared abstraction layer

  Orphan Entities (2):
    src/utils/temp-helper.ts  (zero adjacency row)
    src/scripts/spike.ts      (zero adjacency row)

  Package BAS Scores:
    src/mermaid       BAS=0.91  well-aligned
    src/plugins/go    BAS=0.87  well-aligned
    src/analysis      BAS=0.73  moderate
    src/cli           BAS=0.31  split detected
    ...
```

#### JSON 输出（供 MCP 消费）

```typescript
export interface ClusterBoundaryReport {
  mode: ProjectionMode;
  globalBAS: number;
  silhouetteScore: number;
  clusterCount: number;
  entityCount: number;
  packageCount: number;
  packageScores: PackageBASScore[];
  splitPackages: SplitPackageIssue[];
  crossDomainFusions: CrossDomainFusion[];
  orphanEntities: string[];
  clusters: ClusterSummary[];
}

export interface ClusterSummary {
  clusterId: number;
  entityCount: number;
  dominantPackage: string;
  dominantPackageRatio: number;
}

export interface PackageBASScore {
  packageName: string;
  entityCount: number;
  purity: number;
  coverage: number;
  bas: number;
  dominantCluster: number;
}

export interface SplitPackageIssue {
  packageName: string;
  purity: number;
  bas: number;
  clusterDistribution: Array<{ clusterId: number; ratio: number }>;
}

export interface CrossDomainFusion {
  clusterId: number;
  involvedPackages: Array<{ packageName: string; ratio: number }>;
  representativeEntities: string[];
}
```

> **v2 变更**：移除了 `SplitPackageIssue.splitSuggestion` 和 `CrossDomainFusion.fusionSuggestion` 字符串字段。自然语言建议在边界情况下不可靠，且与 CLI 输出中的 Suggestion 行重复。CLI 的 Suggestion 行由渲染层根据结构化数据生成，不由分析层产生。

### K-Means 实现

**决策**：手写 Lloyd's Algorithm + K-Means++ 初始化，约 80 行核心逻辑。

理由：
- K-Means 逻辑简单，不值得引入外部依赖（`ml-matrix` 已在 intrinsic-dimension 中引入，但它不提供 K-Means）
- K-Means++ 初始化避免随机初始化的不稳定性
- 固定 seed（复用 `jl-state.json` 中的 seed），保证确定性

```
参数:
  maxIterations: 100
  convergenceThreshold: 0.001（质心移动距离）
  seed: 来自 jl-state.json
```

Silhouette Score 计算：对每个实体，计算与同群落其他实体的平均距离（cohesion $a_i$）和最近邻群落实体的平均距离（separation $b_i$），$s_i = (b_i - a_i) / \max(a_i, b_i)$。

- 时间复杂度 O(n²)
- 对 n > 2000：抽样 500 个实体估算（固定 seed，抽样结果确定性）

### 包名提取

从 `entity.name` 提取包名（不依赖语言特定逻辑）：

```
包前缀层级: 可配置，默认 2（取 entity.name 按 '.' 分割后的前 2 级）

示例:
  entity.name = "parser.extractors.RelationExtractor"
  packageDepth = 2 → package = "parser.extractors"
  packageDepth = 1 → package = "parser"

  entity.name = "cli.commands.analyze.AnalyzeCommand"
  packageDepth = 2 → package = "cli.commands"
```

> 各语言插件已通过 `entity.name` 的点号命名约定提供包前缀。分析层只做字符串分割，不感知语言。`packageDepth` 可通过 `--package-depth` CLI flag 覆盖。

### MCP 工具

新增 `archguard_get_cluster_alignment`：

```typescript
// 输入
{
  "minPackageSize": 3,     // 忽略小于 N 个实体的包（默认 3）
  "splitThreshold": 0.5,  // purity 低于此值标记为 split（默认 0.5）
  "packageDepth": 2,      // 包名层级（默认 2）
  "includeOrphans": true  // 是否包含孤立实体列表
}

// 输出
ClusterBoundaryReport
```

### 与现有工具的关系

| 现有工具 | 本工具补充 |
|---------|----------|
| `archguard_detect_cycles` | 检测循环依赖（有向图中的环）→ 本工具检测无向结构群落的边界违规 |
| `archguard_get_dependencies` | 列出直接依赖 → 本工具将依赖模式转化为几何群落，识别隐性结构融合 |
| `archguard_get_package_stats` | 包的基本统计 → 本工具增加包的结构一致性维度（BAS）|

---

## 实现范围

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/analysis/jl/types.ts` | 修改 | 追加聚类相关类型（`ClusterBoundaryReport` 等）|
| `src/analysis/jl/kmeans.ts` | 新建 | Lloyd's Algorithm + K-Means++ 初始化 + Silhouette Score |
| `src/analysis/jl/cluster-boundary-analyzer.ts` | 新建 | BAS 计算、Split/Fusion 检测、孤立实体检测、报告生成 |
| `src/cli/commands/analyze.ts` | 修改 | 新增 `--cluster-analysis` 和 `--package-depth` flags |
| `src/cli/mcp/tools/arch-health-tools.ts` | 修改 | 追加 `archguard_get_cluster_alignment` 工具 |
| `tests/unit/analysis/jl/kmeans.test.ts` | 新建 | K-Means + Silhouette Score 单元测试 |
| `tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts` | 新建 | BAS 计算 + 问题检测单元测试 |

**依赖**：本 Proposal 依赖 proposal-jl-intrinsic-dimension.md 中的 `adjacency-builder`（构造邻接矩阵）和 `jl-projector`（JL 模式时投影）。

### Phase 2（本次不实现）

- Mermaid 可视化：在 package 图中为每个包着色标注聚类结果和 BAS 分数
- BAS 历史趋势追踪（类似 $d_{int}$ 历史）
- 基于 BAS 的重构建议自动生成（LLM 辅助）

---

## 向后兼容性

- 所有新增 flag 为可选项，默认行为不变
- 不修改 ArchJSON schema
- 聚类结果不写入历史文件（无状态，每次重新计算），不影响 JL 状态文件

---

## 验收标准

### 聚类正确性

1. 人造数据：两个明显分离的簇（10 个实体各自聚集），K=2 时 Silhouette Score > 0.8
2. 人造数据：所有实体随机分布（无结构），Silhouette Score < 0.2，输出 `"no clear cluster structure"` 警告
3. 相同输入下，两次运行结果完全一致（确定性，固定 seed）
4. 零向量实体（邻接矩阵行全为零）在聚类前被移除，出现在 `orphanEntities` 列表中

### BAS 计算

5. 人造数据：包内所有实体落入同一群落，purity = 1.0，BAS = 1.0（当该包主导该群落时）
6. 人造数据：包内实体均匀分布在 K 个群落，purity = 1/K
7. 单实体包（`|E_p| = 1`）：purity = 1.0，不报告为 split
8. `minPackageSize` 过滤：当设置为 3 时，实体数 < 3 的包不出现在 `packageScores` 中

### 问题检测

9. 两个包的实体在空间中高度混合时，`crossDomainFusions` 中报告这两个包
10. 一个包的实体明显分为两组时，`splitPackages` 中报告该包
11. fanIn=0 且 fanOut=0 的实体在 `orphanEntities` 中出现

### 报告输出

12. `globalBAS` ∈ [0, 1]
13. `packageScores` 中每个包的 `purity`、`coverage`、`bas` 均 ∈ [0, 1]
14. `splitPackages` 中 `clusterDistribution` 的 ratio 之和 === 1.0（浮点精度内）
15. `clusters` 中每个 `ClusterSummary.dominantPackageRatio` ∈ [0, 1]

### 回归

16. 未指定 `--cluster-analysis` 时，所有现有测试和行为不受影响

---

## 开放问题

| 问题 | 说明 | 建议处理时机 |
|------|------|------------|
| K 的选取策略 | Silhouette Score 选 K 需要计算 K_range 中每个 K 的聚类结果，计算量较大 | 对 n > 500 的项目，先以包数量为 K 跑一次，仅在 Silhouette < 0.3 时尝试 K±2 |
| 包的定义层级 | 对于深层包（如 `src/plugins/typescript/builders`），应使用几级前缀作为"包"？ | 默认使用 `packageDepth=2`（可配置），避免过细的包导致每个包只有 1-2 个实体 |
| BAS 的"好坏"基线 | BAS=0.71 是好是坏？无跨项目参考 | 在 5 个真实项目上运行后，建立 P25/P50/P75 基准线 |
| 动态语言的包边界 | Python 的 `__init__.py` 包边界与 TypeScript 的目录包边界定义方式不同 | 由各语言插件通过 `entity.name` 的命名约定提供包前缀，分析层不感知语言 |
| 高维 K-Means 收敛性 | DIRECT 模式下 $n$ 可能数百维，K-Means 收敛可能较慢 | 监控迭代次数，若 > 80 次未收敛则 warn 并返回当前结果 |

---

## 参考

- proposal-jl-intrinsic-dimension.md (v2) — 邻接矩阵构造、JL 投影、基线标准化、自适应双模式
- proposal-jl-architecture-drift.md (v2) — 架构漂移监测（共享基础设施）
- `src/types/index.ts:185-192` — `Relation` 接口（`source`/`target` 字段）
- `src/cli/mcp/tools/test-analysis-tools.ts` — 现有 MCP 工具结构参考
- `src/analysis/test-issue-detector.ts` — 现有问题检测器结构参考
- Evans, E. (2003). *Domain-Driven Design*. — 聚类 vs 包边界一致性的业务动机
- Rousseeuw, P.J. (1987). Silhouettes: a graphical aid to the interpretation and validation of cluster analysis. JCAM 20:53–65.
