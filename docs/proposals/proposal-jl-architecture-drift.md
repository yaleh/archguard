# Proposal: 基于 JL 投影的架构漂移监测

**状态**: Draft (v2 — 与 intrinsic-dimension v2 对齐)
**日期**: 2026-03-26
**关联**: proposal-jl-intrinsic-dimension.md（共享 JL 投影基础设施）

---

## 修订记录

| 版本 | 变更 |
|------|------|
| v1 | 初稿 |
| v2 | 与 intrinsic-dimension v2 对齐：特征表征改为邻接矩阵行（非手工 10 维），适配自适应双模式（DIRECT/JL），修正 Relation 字段名（`source`/`target`），修正 `ε` 参数（0.15→0.3），修正历史文件名，新增跨快照实体对齐策略，修正存储体积估算。 |

---

## 背景与动机

ArchGuard 已有 `archguard_get_change_risk` 工具，它基于文件变更频率评估风险。但变更频率回答的是"哪里改动最多"，而不是"这些改动是否破坏了架构拓扑结构"。

**核心区别**：

- 一个模块频繁修改内部实现（bug fix、性能优化）→ 变更频率高，但**架构位置稳定**
- 一个模块在重构中悄悄获得了 20 个新的外部依赖 → 变更行数可能不多，但**架构拓扑剧变**

本 Proposal 将每个实体表征为邻接矩阵行（其在依赖图中的完整"指纹"），当两个 git 快照之间某实体的行向量距离超过阈值，说明它在"架构拓扑空间"中发生了位移——即**架构漂移**（Architecture Drift）。

$$\text{drift}(i, t_1, t_2) = \|v_{i,t_1} - v_{i,t_2}\|_2$$

这一指标对以下场景特别有价值：

- **功能蔓延检测**：一个原本职责单一的模块，经过多次迭代后承接了不相关的职责
- **隐性耦合告警**：重构时两个模块之间新增了间接依赖，行数变化不大但拓扑距离显著
- **CI/CD 门禁**：在合并 PR 前量化该 PR 对架构拓扑的"扰动幅度"

---

## 目标

1. 基于 proposal-jl-intrinsic-dimension.md 定义的邻接矩阵 + 自适应 JL/DIRECT 基础设施，为每个实体计算跨快照的拓扑位移距离
2. 识别漂移最显著的实体（Top-K 漂移者）
3. 区分**良性漂移**（有计划的重构）与**异常漂移**（意外耦合增加）
4. 通过 MCP 工具和 CLI 输出漂移报告
5. 支持设定漂移阈值，超阈值时在 CLI 以非零退出码报错（供 CI/CD 集成）

---

## 设计

### 跨快照实体对齐

邻接矩阵的维度 $N$ = 实体数，两个快照的实体集可能不同。漂移计算要求两个向量处于同一坐标空间。

**对齐策略**：

```
E1 = 快照 t1 的实体 ID 集合
E2 = 快照 t2 的实体 ID 集合
E_union = E1 ∪ E2     // 全集，作为统一坐标系
E_shared = E1 ∩ E2    // 共有实体，参与漂移计算
E_added = E2 \ E1     // 新增实体
E_removed = E1 \ E2   // 删除实体

对每个快照，以 E_union 为列索引构造邻接矩阵:
  A1 ∈ ℝ^{|E1| × |E_union|}    // t1 中不存在于 E_union 的列填零
  A2 ∈ ℝ^{|E2| × |E_union|}    // t2 中不存在于 E_union 的列填零

对每个共有实体 i ∈ E_shared:
  v1_i = A1[i, :]   // 在 E_union 坐标系下的行向量
  v2_i = A2[i, :]
  drift(i) = ||v1_i - v2_i||_2
```

> **为何用 E_union 而非 E_shared 作为列坐标？**
> 若仅用 E_shared 列，会丢失"实体 i 新增了对 E_added 中实体 j 的依赖"这一重要漂移信号。

### 自适应模式下的漂移计算

```
N_union = |E_union|

若 N_union < 1000（DIRECT 模式）:
  直接在 ℝ^{N_union} 空间计算 L2 距离
  drift(i) = ||A1[i,:] - A2[i,:]||_2

若 N_union ≥ 1000（JL 模式）:
  生成 Achlioptas 矩阵 R ∈ ℝ^{k × N_union}（固定 seed）
  k = ceil(4 * ln(N_union) / 0.3²)
  投影: P1 = (1/√k) · A1 · Rᵀ,  P2 = (1/√k) · A2 · Rᵀ
  drift(i) = ||P1[i,:] - P2[i,:]||_2

  JL 保证: (1-ε)||v1-v2|| ≤ ||P1[i]-P2[i]|| ≤ (1+ε)||v1-v2||
  即 drift 的近似误差 ≤ ±30%（ε=0.3）
```

> **注意**：漂移专用的 JL 矩阵 $R$ 的维度取决于 $N_{union}$（两个快照的并集），不同于 intrinsic-dimension 中单快照内使用的矩阵。因此**漂移的 $R$ 不复用 jl-state.json 中持久化的矩阵**——每次漂移比较按需生成，用固定 seed 保证确定性。

### 标准化

使用 intrinsic-dimension proposal 中定义的**基线锚定标准化**。两个快照使用同一组基线 $\mu$/$\sigma$（来自 jl-state.json），保证标准化基准一致。

当 $N_{union}$ 超过基线维度时，新增列的 $\mu$/$\sigma$ 取 0/1（即不标准化），因为基线中没有这些列的统计量。

### 漂移分级

| 级别 | 阈值（默认） | 含义 |
|------|------------|------|
| `stable` | drift < 0.5 | 架构位置稳定 |
| `moderate` | 0.5 ≤ drift < 1.5 | 有一定变化，值得关注 |
| `significant` | 1.5 ≤ drift < 3.0 | 拓扑位置明显移动 |
| `critical` | drift ≥ 3.0 | 架构位置剧变，建议审查 |

> 阈值单位为邻接矩阵空间（或 JL 投影空间）中的 L2 距离。默认阈值来自初步推导，应在积累实证数据后调整。

### 漂移分类辅助（区分良性 vs 异常）

单纯的距离无法区分有意重构与意外耦合。引入辅助信号，从邻接矩阵行直接计算：

| 辅助信号 | 计算方式 | 良性漂移特征 | 异常漂移特征 |
|---------|---------|------------|------------|
| `deltaFanIn` | `Σ(A2[:,i]) - Σ(A1[:,i])`（列和差） | 不增加或小幅增加 | 显著增加 |
| `deltaFanOut` | `Σ(A2[i,:]) - Σ(A1[i,:])`（行和差） | 受控变化 | 显著增加 |
| `deltaCoverage` | TestCoverageMapper 分数差 | 维持或上升 | 下降 |

输出中对每个高漂移实体附加这些 delta 值，供人工判断，不做自动二元分类（避免误报）。

### CLI 输出格式

```
Architecture Drift Report
  Comparing: abc1234 → def5678 (2026-03-20 → 2026-03-26)
  Mode: DIRECT (N_union=325)
  Shared entities: 298 / 325

  Critical drift (≥ 3.0):
    diagram-processor (DiagramProcessor)   drift=4.21  ΔfanOut=+8  ΔfanIn=+2
    test-analyzer (TestAnalyzer)           drift=3.65  ΔfanIn=+5   ΔfanOut=+3

  Significant drift (1.5–3.0):
    typescript/index (TypeScriptPlugin)    drift=2.10  ΔfanOut=+4

  New entities (14):  src/analysis/jl/* ...
  Removed entities (3):  src/parser/old-parser.ts ...

  Summary: 2 critical, 1 significant, 295 stable
  Exit code: 1  (critical threshold exceeded)
```

### 快照持久化

漂移计算需要历史快照。扩展 intrinsic-dimension 的 `arch-health-history.json`，在 `snapshots` 数组每条记录中新增可选 `projections` 字段：

```json
{
  "schemaVersion": 2,
  "language": "typescript",
  "baselineEntityCount": 312,
  "snapshots": [
    {
      "timestamp": "2026-03-26T10:00:00Z",
      "commitSha": "6445680",
      "entityCount": 312,
      "mode": "direct",
      "k": null,
      "dInt": 7,
      "dIntNormalized": 0.022,
      "varianceExplained": [0.28, 0.45, "..."],
      "epsilon": null,
      "adjacencyRows": {
        "parser.TypeScriptParser": [0, 0, 1.0, 0, 2.0, "...(length=312)"],
        "cli.DiagramProcessor": [1.0, 0, 0, 1.5, 0, "...(length=312)"]
      },
      "entityIndex": ["parser.TypeScriptParser", "cli.DiagramProcessor", "..."]
    }
  ]
}
```

**存储大小估算**（修正 v1）：
- DIRECT 模式，$n = 312$：每行 312 个 float64 × 8 字节 = 2.5KB/行 × 312 行 ≈ 780KB/快照
- JL 模式，$n = 5698$，$k = 378$：378 × 8 = 3KB/行 × 5698 行 ≈ 17MB/快照 → **过大**

**优化决策**：不存储完整矩阵/投影。改为**按需重新计算**：

```
漂移比较时:
  1. 从 arch-health-history.json 取两个快照的 commitSha
  2. 对每个 commitSha，git checkout → 重新解析 → 构造邻接矩阵
  3. 对齐 + 计算漂移
  4. 仅在快照中存储 entityIndex（实体 ID 列表），用于快速判断 E_shared

历史文件仅存储:
  - entityIndex: string[]  (~10KB for n=300)
  - 其余 intrinsic-dimension 字段不变
```

> **权衡**：按需重新计算增加了漂移比较的时间（需要解析两个版本的源码），但避免了历史文件膨胀。对于 CI/CD 场景（`--drift-base HEAD~1`），两个版本都在本地，解析时间可接受（< 30s for n=5000）。

### 类型定义

```typescript
// src/analysis/jl/types.ts 追加

export interface EntityDrift {
  entityId: string;
  drift: number;
  level: 'stable' | 'moderate' | 'significant' | 'critical';
  deltaFanIn: number;
  deltaFanOut: number;
  deltaCoverage: number;
}

export interface DriftReport {
  fromSnapshot: { timestamp: string; commitSha?: string };
  toSnapshot: { timestamp: string; commitSha?: string };
  mode: ProjectionMode;
  nUnion: number;
  k: number | null;
  sharedEntityCount: number;
  addedEntities: string[];
  removedEntities: string[];
  drifts: EntityDrift[];   // sorted by drift descending
  summary: {
    critical: number;
    significant: number;
    moderate: number;
    stable: number;
  };
}
```

### MCP 工具

新增 `archguard_get_arch_drift`：

```typescript
// 输入
{
  "fromCommit": "abc1234",  // 可选，默认为历史倒数第二条
  "toCommit": "def5678",   // 可选，默认为最新快照
  "topK": 10,              // 返回漂移最大的 K 个实体
  "minLevel": "moderate"  // 过滤级别下限
}

// 输出
{
  "report": DriftReport,
  "hasBreakingDrift": true,
  "breakingEntities": ["cli.DiagramProcessor"]
}
```

### CLI Flag

```
node dist/cli/index.js analyze --arch-health --drift-threshold 3.0
  # 若有实体 drift ≥ 3.0，以退出码 1 退出（CI/CD 门禁用）

node dist/cli/index.js analyze --arch-health --drift-base abc1234
  # 与指定 commit 对比
```

---

## 实现范围

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/analysis/jl/types.ts` | 修改 | 追加 `EntityDrift`、`DriftReport` 类型 |
| `src/analysis/jl/drift-calculator.ts` | 新建 | 实体对齐（E_union/E_shared）+ 邻接矩阵构造 + L2 距离 + 分级 |
| `src/analysis/jl/adjacency-builder.ts` | 修改 | 新增 `buildAlignedAdjacency(archJson, entityIndex)` 方法（接受外部列索引）|
| `src/cli/commands/analyze.ts` | 修改 | 新增 `--drift-threshold`、`--drift-base` flags |
| `src/cli/mcp/tools/arch-health-tools.ts` | 修改 | 追加 `archguard_get_arch_drift` 工具 |
| `tests/unit/analysis/jl/drift-calculator.test.ts` | 新建 | 单元测试 |

**依赖**：本 Proposal 核心依赖 proposal-jl-intrinsic-dimension.md 中的 `adjacency-builder`、`jl-projector`（JL 模式时）、`jl-state-manager`（标准化参数）。两个 Proposal 可并行实现，但应共享 `src/analysis/jl/` 目录。

### 不在本次范围内

- 自动判断漂移原因（良性 vs 异常的自动分类）
- PR 级别的 GitHub Actions 集成（属于用户文档/外部脚本）
- 基于漂移历史的预测（需要更多数据）

---

## 向后兼容性

- 所有新增 flag 为可选项，默认行为不变
- 历史文件扩展了可选的 `entityIndex` 字段，不影响 intrinsic-dimension 工具的读取
- 快照文件可随时删除，不影响基本分析功能

---

## 验收标准

### 实体对齐

1. 两个快照有完全相同的实体集：`E_shared === E1 === E2`，`addedEntities` 和 `removedEntities` 为空
2. 快照 t2 新增 5 个实体：`addedEntities` 包含这 5 个 ID，`E_union` 比 `E1` 大 5
3. 对齐后的邻接矩阵列数 = `|E_union|`，新增实体对应的列在 t1 矩阵中全为零

### 漂移计算正确性

4. 两个完全相同的快照，所有实体 drift = 0
5. 一个实体新增 5 条 `dependency` 出边（权重 1.0 × 5），其 drift = $\sqrt{5} \approx 2.24$（假设其他列不变）
6. 新增/删除的实体不计入 drift，正确出现在报告中
7. drift 分级与阈值定义一致（边界值 0.5、1.5、3.0 测试）

### 自适应模式

8. `N_union < 1000`：使用 DIRECT 模式，报告中 `mode === 'direct'`
9. `N_union ≥ 1000`：使用 JL 模式，报告中 `mode === 'jl'`，`k` 与公式一致
10. JL 模式下同一 seed 产生确定性结果

### CLI 集成

11. `--drift-threshold 3.0` 且存在 critical 实体时，退出码为 1
12. `--drift-threshold 3.0` 且无 critical 实体时，退出码为 0
13. `--drift-base` 指定不存在的 commit sha 时，输出清晰错误信息（退出码 2）
14. 首次运行无历史快照时，输出 `"no baseline available"` 提示（退出码 0）

### 回归

15. 未指定 `--arch-health` 时，所有现有测试和行为不受影响

---

## 开放问题

| 问题 | 说明 | 建议处理时机 |
|------|------|------------|
| 阈值校准 | 默认阈值 0.5/1.5/3.0 是推导值，需实证验证 | 在 3 个真实项目（ArchGuard 自身、llama.cpp、lmdeploy）上运行后调整 |
| 按需解析的性能 | 大型项目的两次全量解析可能耗时较长（> 30s）| 可引入增量解析或仅解析依赖图（跳过方法体），作为后续优化 |
| 首次运行无历史 | 第一次分析时没有历史快照，无法计算漂移 | 输出提示并建议用户再次运行建立基线 |
| 重命名检测 | 实体 rename 会导致同一实体在 E_shared 中"消失"，报告为删除+新增 | 可通过源文件路径匹配做 rename heuristic，但增加复杂度，暂不实现 |

---

## 参考

- proposal-jl-intrinsic-dimension.md (v2) — 邻接矩阵构造、JL 投影、基线标准化、自适应双模式
- proposal-jl-cluster-boundary.md — 聚类分析（共享基础设施）
- `src/types/index.ts:185-192` — `Relation` 接口（`source`/`target` 字段）
- `src/cli/mcp/tools/test-analysis-tools.ts` — 现有 MCP 工具结构参考
- `src/cli/query/query-engine.ts getChangeRisk()` — 现有变更风险指标（互补关系）
