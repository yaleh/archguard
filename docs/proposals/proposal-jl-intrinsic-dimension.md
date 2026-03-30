# Proposal: 基于 JL 随机投影的架构本征维度追踪

**状态**: Draft (v3 — 经严苛架构审查修订)
**日期**: 2026-03-26
**关联**: proposal-complexity-metrics-in-archjson.md、proposal-jl-architecture-drift.md、proposal-jl-cluster-boundary.md

---

## 修订记录

| 版本 | 变更 |
|------|------|
| v1 | 初稿 |
| v2 | 修正 F1（N=10 时 JL 无意义）：改用邻接矩阵行作为主特征，引入自适应 JL/直接 SVD 双模式。修正 F2（示例数据矛盾）。修正 M1（跨快照标准化）、M2（特征冗余）、M3（效度论证）、M4/M5（字段名不匹配实际类型）。修正 m1-m5 全部次要问题。 |
| v3 | 修正 F1（ε 参数前后不一致）：统一为 ε=0.3、常数=4。修正 F2（遗漏 `association` 关系类型）。修正 M1（基线标准化列对齐矛盾）：改为快照内独立标准化。修正 M2（零矩阵边界条件）。修正 M3（ml-matrix 性能未验证）：新增 spike 要求。修正 M4（arch-health 不应耦合 diagram-processor）。修正 m1-m5 全部次要问题。 |

---

## 背景与动机

当前 ArchGuard 能够检测**局部结构问题**（循环依赖、测试覆盖缺失、变更风险），但缺乏反映**系统整体复杂度演化趋势**的全局指标。

> **核心洞察**：一个健康的架构，其依赖关系矩阵呈现明显的低秩结构——大多数实体的依赖模式可以用少数几个"基本方向"的线性组合来表达（例如：多个 handler 都依赖同一个 service 层）。而腐化的架构中，模块之间形成混乱的交叉耦合，每个实体的依赖模式都是独特的，需要越来越多的维度才能表达这种混乱。这一现象可以用**本征维度**（Intrinsic Dimension, $d_{int}$）来量化。

Johnson-Lindenstrauss（JL）Lemma 保证：对于 $n$ 个高维向量，存在随机线性投影将其映射到 $k = O(\epsilon^{-2} \log n)$ 维空间，同时以 $1 \pm \epsilon$ 的精度保持所有点对距离。当特征维度 $N$ 远大于 $k$ 时（$N \gg k$），JL 投影能以极低的计算代价实现无损降维。

在投影后的坐标矩阵上做 SVD，观察解释 95% 方差所需的维度数即为 $d_{int}$：

$$d_{int}(t) = \min\left\{d : \frac{\sum_{i=1}^{d} \sigma_i^2}{\sum_{j=1}^{r} \sigma_j^2} \geq 0.95\right\}$$

其中 $r = \min(n, k)$ 为 SVD 的最大秩。

**解读约束**：$d_{int}$ 上升不一定等于架构腐化。健康的模块化增长（新增独立模块）也会提升 $d_{int}$。真正的腐化信号是**归一化本征维度** $\hat{d}_{int} = d_{int} / n$ 持续上升——即每个实体的依赖模式变得越来越"独特"，共享结构在消失。详见"效度验证计划"一节。

---

## 目标

1. 将 ArchJSON 的依赖图表征为邻接矩阵，使每个实体获得 $N$ 维结构向量（$N$ = 实体数）
2. 当 $N \geq 1000$ 时，使用固定 seed 的 JL 随机矩阵投影到 $k$ 维；当 $N < 1000$ 时，直接对原始矩阵做 SVD（**自适应双模式**）
3. 计算 $d_{int}$ 和归一化 $\hat{d}_{int}$
4. 支持多个 git 快照的时序输出，供趋势分析
5. 通过 MCP 工具和 CLI flag 暴露结果

---

## 设计

### 架构决策：邻接矩阵行 vs 手工特征

v1 使用 10 维手工特征向量，导致 $k \geq N$，JL 退化为恒等变换。v2 做出以下决策：

| 方案 | N | JL 有效？ | 信息完整性 |
|------|---|----------|-----------|
| 手工特征（v1） | 10 | 否（$k > N$）| 丢失拓扑细节 |
| **邻接矩阵行（v2）** | **实体数（数百~数千）** | **是（$N \gg k$）** | **保留完整依赖指纹** |

**决策**：以有向加权邻接矩阵行作为主特征表征。每个实体的特征向量即为该实体在依赖图中的"行"，天然编码了它与所有其他实体的关系。

### 特征向量构造

给定 ArchJSON 中 $n$ 个实体和关系集合，构造邻接矩阵 $A \in \mathbb{R}^{n \times n}$：

```
对每个 relation r ∈ ArchJSON.relations:
  i = entityIndex(r.source)    // 注意: Relation 字段为 source/target，非 from/to
  j = entityIndex(r.target)
  A[i][j] += weight(r.type)
```

**关系类型权重表**（v1，后续可调）：

| 关系类型 | 权重 | 理由 |
|---------|------|------|
| `inheritance` | 2.0 | 最强耦合，breaking change 必然传播 |
| `implementation` | 2.0 | 同上 |
| `composition` | 1.5 | 强持有关系 |
| `aggregation` | 1.0 | 弱持有关系 |
| `dependency` | 1.0 | 一般使用关系 |
| `association` | 1.0 | 一般关联关系 |

**未知关系类型处理**：遇到不在权重表中的关系类型时，使用默认权重 1.0，并 log warning。这确保未来新增 `RelationType` 时不会导致运行时异常。

实体 $i$ 的特征向量为 $v_i = A[i, :] \in \mathbb{R}^n$（第 $i$ 行）。

> **为什么不用 incoming+outgoing 拼接（$\mathbb{R}^{2n}$）？**
> SVD 作用于完整矩阵 $A_{n \times n}$ 时，已经同时捕获了行空间（outgoing 模式）和列空间（incoming 模式）的结构。拼接会引入冗余维度，不改善 $d_{int}$ 的信噪比。

**外部依赖处理**：`relation.source` 或 `relation.target` 指向不在 `entities` 集合中的 ID 时，跳过该关系。外部依赖不参与邻接矩阵构建。

### 自适应双模式：JL vs 直接 SVD

```
输入: A ∈ ℝ^{n×n}

若 n < 1000（小型/中型项目，如 ArchGuard 自身）:
  模式 = DIRECT
  直接对 A 做 SVD，无投影开销
  d_int 精确（无 JL 近似误差）

若 n ≥ 1000（大型项目，如 llama.cpp）:
  模式 = JL
  计算 k = ceil(4 * ln(n) / ε²)，ε = 0.3
  生成 Achlioptas 矩阵 R ∈ ℝ^{k×n}
  投影: P = (1/√k) · A · Rᵀ ∈ ℝ^{n×k}
  对 P 做 SVD

  n=1000 → k = 307
  n=5000 → k = 378
  n=5698 → k = 384  // llama.cpp
```

> **JL 参数选择**：$\epsilon = 0.3$（距离保持精度 $1 \pm 0.3$），常数 = 4（JL 理论下界）。更保守的 $\epsilon = 0.15$ 会导致 $k > n$（在 $n < 10^5$ 范围内），JL 压缩退化为无效。$\epsilon = 0.3$ 在实际架构分析场景中足够——我们关注的是全局结构趋势而非精确距离。

> **Achlioptas 矩阵**：$R[i][j] \in \{+1, 0, -1\}$，概率 $\{1/6, 4/6, 1/6\}$。当 $n \geq 1000$ 时稀疏性带来显著计算优势（2/3 的元素为零）。对于 $n < 1000$，不使用该矩阵。

**模式切换阈值 1000 的依据**：
- $n = 300$（ArchGuard）：$300 \times 300$ SVD 耗时 < 50ms，JL 无收益
- $n = 1000$：$k = 307$，压缩比约 3.3 倍，开始有收益
- $n = 5000$：$k = 378$，压缩比约 13 倍，收益显著

### 标准化策略

**架构决策：快照内独立标准化（非跨快照基线锚定）**

v1/v2 尝试跨快照基线锚定标准化，但存在根本性矛盾：邻接矩阵的列与实体一一对应，跨快照实体集合会变化（新增、删除、重命名），导致基线 $\mu_{baseline}[j]$ 和 $\sigma_{baseline}[j]$ 与当前矩阵的列无法对齐——即使只新增 1 个实体，列索引就已错位。

**v3 方案：快照内独立列标准化**

```
每次运行:
  对邻接矩阵 A 的每一列 j 计算:
    μ[j] = mean(A[:, j])
    σ[j] = std(A[:, j])  // 若 σ=0 则置为 1
  A_normalized[i][j] = (A[i][j] - μ[j]) / σ[j]
  使用 A_normalized 进行投影/SVD
```

**为什么快照内标准化足够？** $d_{int}$ 度量的是"解释 95% 方差需要多少个主方向"，这是一个**比例指标**——不依赖绝对值大小。标准化的目的是防止高被依赖度的列（如核心模块列）主导 SVD，这一目标在快照内即可实现。跨快照可比性由 $\hat{d}_{int} = d_{int} / n$（归一化本征维度）保证，无需标准化基准一致。

### 本征维度计算

```
输入:
  DIRECT 模式: M = A_normalized ∈ ℝ^{n×n}（标准化后的邻接矩阵）
  JL 模式:     M = P ∈ ℝ^{n×k}（标准化后的邻接矩阵经投影）

步骤:
  1. 中心化: M_c = M - mean(M, axis=0)
  2. SVD: M_c = U Σ Vᵀ，取奇异值 σ_1 ≥ σ_2 ≥ ... ≥ σ_r
     其中 r = min(n, cols(M))
  3. 计算累积方差解释比:
     cumvar[d] = Σσ_i² (i=1..d) / Σσ_i² (i=1..r)
  4. d_int = min{d : cumvar[d] ≥ 0.95}
  5. d_int_normalized = d_int / n

边界条件 — 零矩阵（所有实体互不依赖）:
  所有奇异值为零，分母 Σσ_i² = 0
  → d_int = 0, d_int_normalized = 0
  → varianceExplained = []（空数组）
  → 输出 noDependenciesWarning

输出:
  d_int          — 绝对本征维度
  d_int_normalized — 归一化本征维度（消除规模效应）
  cumvar[]       — 累积方差曲线，截断为前 d_int + 10 个值，末尾补 1.0
                   零矩阵时为空数组
```

### 快照存储与时序输出

每次分析完成后，结果追加到 `.archguard/arch-health-history.json`：

```json
{
  "schemaVersion": 1,
  "language": "typescript",
  "snapshots": [
    {
      "timestamp": "2026-03-26T10:00:00Z",
      "commitSha": "6445680",
      "entityCount": 312,
      "mode": "direct",
      "featureVersion": "1.0",
      "k": null,
      "dInt": "...(占位符，待实测)",
      "dIntNormalized": "...(占位符，待实测)",
      "varianceExplained": "...(占位符，待实测)",
      "epsilon": null
    },
    {
      "timestamp": "2026-03-27T10:00:00Z",
      "commitSha": "abc1234",
      "entityCount": 5698,
      "mode": "jl",
      "featureVersion": "1.0",
      "k": 384,
      "dInt": "...(占位符，待实测)",
      "dIntNormalized": "...(占位符，待实测)",
      "varianceExplained": "...(截断为 d_int + 10 个值)",
      "epsilon": 0.3
    }
  ]
}
```

**示例数据说明**：上述 `dInt`/`dIntNormalized`/`varianceExplained` 为占位符。实际数值需在实现后通过 ArchGuard 自身（$n \approx 312$，DIRECT 模式）和 llama.cpp（$n = 5698$，JL 模式）实测获得。格式结构以 JSON schema 为准。

CLI 输出（`--arch-health`）：

```
Architecture Intrinsic Dimension
  Mode:       DIRECT (n=312, threshold=1000)
  d_int:      <N> / 312 entities
  d_int_norm: <x.xxxx>
  Previous:   <N'> / <n'> entities  (d_int_norm: <x.xxxx>, <date>)
  Trend:      → STABLE | RISING | DECREASING (Δd_int_norm = <±x.xxxx>)
```

### 类型定义

```typescript
// src/analysis/jl/types.ts

export type ProjectionMode = 'direct' | 'jl';

export interface JLConfig {
  seed: number;
  epsilon: number;               // default: 0.3
  /** 自适应模式切换阈值 */
  directModeThreshold: number;   // default: 1000
}

export interface IntrinsicDimensionResult {
  timestamp: string;
  commitSha?: string;
  entityCount: number;
  mode: ProjectionMode;
  featureVersion: string;
  k: number | null;
  dInt: number;
  dIntNormalized: number;
  /**
   * 累积方差解释比，截断为前 dInt + 10 个值，末尾补 1.0。
   * 零矩阵时为空数组。
   * 当 varianceExplained 非空时，最后一个值 === 1.0（浮点精度 |1.0 - last| < 1e-10）。
   */
  varianceExplained: number[];
  epsilon: number | null;
}

export interface ArchHealthHistory {
  schemaVersion: number;  // 当前: 1
  language: string;
  snapshots: IntrinsicDimensionResult[];
}
```

### 文件结构

```
src/analysis/jl/
  types.ts                    # 类型定义
  adjacency-builder.ts        # 从 ArchJSON 构造加权邻接矩阵 + 快照内列标准化
  jl-projector.ts             # Achlioptas 矩阵生成 + 投影（仅 JL 模式使用）
  intrinsic-dimension.ts      # SVD + d_int 计算（纯函数，无 I/O）
  history-writer.ts           # 追加到 arch-health-history.json

src/cli/commands/
  analyze.ts                  # --arch-health flag + arch-health 编排逻辑

src/cli/mcp/tools/
  arch-health-tools.ts        # MCP 工具
```

### MCP 工具

新增 `archguard_get_intrinsic_dimension`：

```typescript
// 输入
{
  "snapshotCount": 10   // 返回最近 N 个快照
}

// 输出
{
  "current": {
    "dInt": 7,
    "dIntNormalized": 0.022,
    "entityCount": 312,
    "mode": "direct",
    "timestamp": "2026-03-26T10:00:00Z"
  },
  "history": [...],
  "trend": "stable" | "rising" | "decreasing"
}
```

> **v1 中的 `interpretation` 字段已移除**。自然语言解读在边界情况下不可靠，消费者应根据结构化数据自行判断。

---

## 效度验证计划

$d_{int}$ 作为架构健康信号，必须在真实项目上验证其**效度**（validity）——即它是否确实与人工判定的架构质量事件相关。

### 已知反例与应对

| 反例 | $d_{int}$ 行为 | $\hat{d}_{int}$ 行为 | 结论 |
|------|---------------|---------------------|------|
| 健康增长：新增 3 个独立微服务 | ↑ +3 | → 持平（$n$ 同步增长）| 归一化消除假阳性 |
| 好的重构：God class 拆分为 5 个单一职责类 | 可能 ↑ | 短期 ↑，中期 → 或 ↓ | 需结合窗口观察 |
| 坏的腐化：所有模块逐渐互相依赖 | ↑ | ↑（$n$ 不变但依赖模式混乱）| 真阳性 |

### 验证步骤（实现后执行，不阻塞本 Proposal）

1. **ArchGuard 自身**：取最近 50 个 git commit，逐个 checkout 计算 $d_{int}(t)$ 和 $\hat{d}_{int}(t)$。人工标注已知的架构事件（如 C++ 插件引入、测试分析模块重构），检查 $d_{int}$ 曲线是否在这些事件处出现可辨识的信号。
2. **llama.cpp**：取 3 个 release tag（如 v0.1、v0.2、v0.3），计算 $\hat{d}_{int}$，与已知的架构变化（如模型后端拆分）对比。
3. **相关性检验**：如果 $d_{int}$ 与 SCC 数（循环依赖指标）的 Pearson 相关系数 $|r| > 0.6$，则认为 $d_{int}$ 作为架构复杂度代理指标具有初步效度。

验证结果将记录在 `docs/spikes/` 中，作为后续设定阈值告警的依据。

---

## SVD 实现

**决策**：引入 `ml-matrix` npm 包。

| 考量 | 结论 |
|------|------|
| 项目已有外部依赖？ | 是（tree-sitter-cpp、sharp 等），非零依赖项目 |
| `ml-matrix` 体积 | ~50KB minified，TypeScript 类型完整 |
| SVD 实现质量 | 基于 Golub-Kahan bidiagonalization，成熟稳定 |
| 替代方案 | 手写 Power Iteration 需处理收敛、数值稳定等边界情况，ROI 不佳 |

安装：`npm install ml-matrix`

使用：
```typescript
import { SVD } from 'ml-matrix';
const svd = new SVD(centeredMatrix);
const singularValues = svd.diagonal;  // σ_1 ≥ σ_2 ≥ ...
```

**性能验证前置条件**（实现前必须完成）：

`ml-matrix` 为纯 JavaScript 实现。在进入实现阶段前，需在 `docs/spikes/` 中完成以下 spike：

| 矩阵规模 | 预期场景 | 可接受耗时 |
|----------|---------|-----------|
| 300 × 300 | ArchGuard 自身，DIRECT 模式 | < 200ms |
| 1000 × 307 | 中型项目，JL 模式 | < 500ms |
| 5000 × 378 | llama.cpp，JL 模式 | < 2s |
| 5000 × 5000 | llama.cpp，DIRECT 模式（对照组）| 记录实际耗时 |

若 5000 × 378 超过 2s，需评估替代方案（truncated SVD / randomized SVD，仅需前 $d_{int}$ 个奇异值）。

---

## 实现范围

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/analysis/jl/types.ts` | 新建 | 类型定义（`JLConfig`, `IntrinsicDimensionResult`, `ArchHealthHistory`）|
| `src/analysis/jl/adjacency-builder.ts` | 新建 | 从 ArchJSON 构造加权邻接矩阵 + 快照内列标准化 |
| `src/analysis/jl/jl-projector.ts` | 新建 | Achlioptas 矩阵生成 + 投影（仅 n ≥ 1000 时调用）|
| `src/analysis/jl/intrinsic-dimension.ts` | 新建 | SVD + d_int / d_int_normalized 计算（纯函数，无 I/O）|
| `src/analysis/jl/history-writer.ts` | 新建 | 追加到 arch-health-history.json |
| `src/cli/commands/analyze.ts` | 修改 | 新增 `--arch-health` flag + arch-health 编排逻辑（与 diagram 生成并列，非嵌套）|
| `src/cli/mcp/tools/arch-health-tools.ts` | 新建 | MCP 工具实现 |
| `src/cli/mcp/server.ts` | 修改 | 注册新 MCP 工具 |
| `package.json` | 修改 | 新增 `ml-matrix` 依赖 |
| `tests/unit/analysis/jl/` | 新建目录 | 各模块单元测试 |

### 不在本次范围内

- 阈值告警（需先完成效度验证）
- 手工语义特征向量（v1 的 10 维特征，作为 Phase 2 的可选增强维度）
- Mermaid 图中可视化 $d_{int}$ 趋势
- 与 CI/CD 系统的集成脚本

---

## 向后兼容性

- 所有新文件独立于现有分析链路
- `--arch-health` 为可选 flag，默认不触发
- `.archguard/arch-health-history.json` 可随时删除，下次分析自动重新生成
- 不修改 ArchJSON schema（结果单独存储）
- 新增 `ml-matrix` 依赖不影响现有功能（仅 `--arch-health` 路径加载）

---

## 验收标准

### 邻接矩阵构造

1. 对于含 3 个实体、2 条 `dependency` 关系的 ArchJSON，邻接矩阵为 3×3，非零位置与 `relation.source`/`relation.target` 一致
2. `inheritance` 关系的权重 = 2.0，`dependency` 关系的权重 = 1.0，`association` 关系的权重 = 1.0
3. `relation.source` 或 `relation.target` 指向 entities 外的 ID 时，跳过该关系，不报错
4. 同一对实体之间有多条关系时，权重**累加**
5. 遇到不在权重表中的关系类型时，使用默认权重 1.0 并 log warning

### 自适应模式

6. $n = 100$：使用 DIRECT 模式，输出中 `mode === 'direct'`，`k === null`
7. $n = 1000$，$\epsilon = 0.3$：$k = \lceil 4 \times \ln(1000) / 0.3^2 \rceil = 307$，JL 模式，投影矩阵维度为 $307 \times 1000$
8. $n = 5000$，$\epsilon = 0.3$：$k = \lceil 4 \times \ln(5000) / 0.3^2 \rceil = 378$，JL 模式
9. 相同 seed 下，两次运行产生完全相同的 Achlioptas 矩阵
10. JL 模式切换阈值可通过配置的 `directModeThreshold` 自定义

### 标准化

11. 每次运行独立进行列标准化，不依赖外部状态文件
12. 标准化后，每列均值为 0、标准差为 1（$\sigma = 0$ 的列除外，保持为 0）

### 本征维度计算

13. 当 `varianceExplained` 非空时，累积方差解释比数组单调递增，最后一个值 === 1.0（在浮点精度 $|1.0 - \text{last}| < 10^{-10}$ 内）
14. 人造数据：所有实体依赖同一个 hub（邻接矩阵秩 ≈ 1）→ $d_{int} = 1$
15. 人造数据：$n$ 个实体互不依赖（零矩阵）→ $d_{int} = 0$，`varianceExplained = []`（空数组），输出 `noDependenciesWarning`
16. `entityCount < 3` 时：输出 `lowEntityCountWarning`，$d_{int}$ 仍正常计算
17. `dIntNormalized` = `dInt` / `entityCount`，精度保留 4 位小数
18. `varianceExplained` 截断为前 `dInt + 10` 个值，末尾补 1.0

### 历史追踪

19. 连续两次分析后，历史文件 `snapshots` 数组包含 2 条记录
20. 历史文件包含 `schemaVersion` 字段，值为 1
21. `featureVersion` 变更时，在快照中标注新的 `featureVersion`，**不自动清空历史**——消费者根据 `featureVersion` 字段自行决定是否忽略旧版本数据
22. 快照上限可通过配置设定（默认 500），超出时删除最旧记录

### 回归

23. 现有所有测试通过，`--arch-health` 未指定时不影响任何现有流程

---

## 开放问题

| 问题 | 说明 | 建议处理时机 |
|------|------|------------|
| $\hat{d}_{int}$ 的"正常"范围 | 不同项目的 $\hat{d}_{int}$ 基线不同。初步猜测：$\hat{d}_{int} < 0.05$ 为结构良好，$> 0.15$ 为高熵 | 在效度验证后根据实测数据定 |
| 关系权重调优 | 当前权重表是经验值，可能需要根据实测相关性调整 | 效度验证阶段用 grid search 微调 |
| 跨语言比较 | TypeScript 的 $d_{int}$ 与 Go 的 $d_{int}$ 是否可比？相同语言不同项目呢？ | 当前不支持，历史文件按语言分开存储；$\hat{d}_{int}$ 是更合适的跨项目比较指标 |

---

## 与下游 Proposal 的接口约定

本 Proposal 是 JL 系列三份 Proposal 的基础设施层。下游 Proposal 的依赖关系：

| 下游 Proposal | 依赖的模块 | 特殊需求 |
|--------------|----------|---------|
| proposal-jl-architecture-drift.md | `adjacency-builder`, `jl-projector` | 需要存储投影向量到历史快照（由 drift proposal 扩展 `ArchHealthHistory`）；跨快照实体对齐（由 drift proposal 自行处理）|
| proposal-jl-cluster-boundary.md | `adjacency-builder`, `jl-projector`（或 DIRECT 模式的原始矩阵）| 在单个快照内操作，无跨时间需求 |

**关键约定**：`adjacency-builder.ts` 和 `jl-projector.ts` 的输出格式必须稳定——返回普通的 `number[][]`（行优先矩阵），不绑定 `ml-matrix` 的 `Matrix` 类型，以便下游消费者无需引入该依赖。

---

## 参考

- Johnson, W.B. & Lindenstrauss, J. (1984). Extensions of Lipschitz mappings into a Hilbert space.
- Achlioptas, D. (2003). Database-friendly random projections: Johnson-Lindenstrauss with binary coins. JCSS 66(4).
- proposal-complexity-metrics-in-archjson.md — ArchJSON 基础指标（`stronglyConnectedComponents` 等）
- `src/types/index.ts:185-192` — `Relation` 接口（`source`/`target` 字段）
- `src/types/index.ts:174-180` — `RelationType`（含 `association`，共 6 种）
- `src/types/index.ts:105-118` — `Entity` 接口（`members: Member[]` 字段，按 `type` 区分 method/field）
- `src/analysis/test-coverage-mapper.ts` — 现有 coverage score 来源
