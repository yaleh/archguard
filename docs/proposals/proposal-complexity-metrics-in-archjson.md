# Proposal: ArchJSON 基础复杂度指标

**状态**: Draft (v2 — 经架构审查修订)
**日期**: 2026-03-01
**关联**: [GIT 框架分析](../references/GIT_Analysis_for_ArchGuard.md)

---

## 背景与动机

ArchGuard 当前将实体数和关系数作为运行时日志输出（`DiagramResult.stats`），但这些数字不会写入 ArchJSON 文件本身，无法被下游工具消费。

本 Proposal 的目标是：在 ArchJSON 中增加一组**代理指标（proxy metrics）**，使下游工具（CI 检查、趋势分析、架构健康看板）无需重新解析实体/关系数组即可获取基础的结构数量信息，并引入**强连通分量数（SCC）**用于循环依赖检测。

> **关于 GIT / MDL 关联**：这些指标是粗粒度的代理指标，不是 GIT 框架中 MDL 压缩率 ρ 的直接计算。ρ 的严格计算需要对源代码和 ArchJSON 使用相同单位的描述长度度量，不在本次范围内。本 Proposal 仅承诺提供可供后续校准的原始数据。

---

## 目标

在 ArchJSON 输出中新增 `metrics` 字段，包含：

1. **实体数** (`entityCount`) — 当前聚合层级下的实体总数
2. **关系数** (`relationCount`) — 当前聚合层级下的关系总数
3. **关系类型分布** (`relationTypeBreakdown`) — 各类型关系的数量，保留类型信息
4. **强连通分量数** (`stronglyConnectedComponents`) — 有向依赖图中的 SCC 数量，用于检测循环依赖；SCC 数等于实体数说明无环，SCC 数 < 实体数说明存在循环依赖
5. **推断关系占比** (`inferredRelationRatio`) — `inferenceSource !== 'explicit'` 的关系占比，反映解析结果的可信度
6. **聚合层级** (`level`) — 产生本次指标的聚合层级，消费者必须结合此字段解读数值

---

## 设计

### 类型定义

```typescript
// src/types/index.ts 新增

export interface ArchJSONMetrics {
  /** 产生本次指标的聚合层级，解读所有数值时必须参考此字段 */
  level: 'package' | 'class' | 'method';

  /** 当前层级下的实体总数 */
  entityCount: number;

  /** 当前层级下的关系总数 */
  relationCount: number;

  /**
   * 各类型关系的数量。
   * 只列出数量 > 0 的类型，不出现的类型可视为 0。
   */
  relationTypeBreakdown: Partial<Record<RelationType, number>>;

  /**
   * 有向依赖图中的强连通分量（SCC）数量。
   * - SCC 数 === entityCount：无循环依赖
   * - SCC 数 < entityCount：存在循环依赖，差值越大环越复杂
   */
  stronglyConnectedComponents: number;

  /**
   * 推断关系（inferenceSource !== 'explicit'）在所有关系中的占比，范围 [0, 1]。
   * 占比越高，ArchJSON 对静态分析的依赖越重，结果可信度越低。
   * relationCount === 0 时返回 0。
   */
  inferredRelationRatio: number;
}

// ArchJSON 接口新增字段
interface ArchJSON {
  // ... 现有字段不变 ...

  /**
   * 结构代理指标。
   * 由 MetricsCalculator 在聚合完成后计算，与 level 绑定。
   */
  metrics?: ArchJSONMetrics;
}
```

### 关于 `sourceFileCount` 的决定

不新增此字段。`sourceFiles` 数组已在 ArchJSON 中，消费者可直接取 `.length`。固化冗余字段会引入不一致风险（`sourceFiles` 更新而计数未同步）。

### 强连通分量算法

使用 **Kosaraju 算法**（两次 DFS）在有向依赖图上求 SCC：

```
输入: entities (节点), relations (有向边，source → target)
输出: SCC 数量

第一轮 DFS: 按 finish time 逆序压栈
第二轮 DFS: 在转置图上按栈顺序 DFS，每棵 DFS 树是一个 SCC

SCC 数 = 第二轮 DFS 的起始节点数（即树根数）
```

注意：`relations` 中 `source`/`target` 指向的 entity id 可能不存在于 `entities`（外部依赖）。处理方式：跳过 endpoint 不在 entities 集合中的关系，不影响 SCC 计算。

### 示例输出

```json
{
  "version": "1.0",
  "language": "typescript",
  "timestamp": "2026-03-01T12:00:00.000Z",
  "sourceFiles": ["src/cli/index.ts", "src/parser/index.ts"],
  "entities": [...],
  "relations": [...],
  "metrics": {
    "level": "class",
    "entityCount": 42,
    "relationCount": 87,
    "relationTypeBreakdown": {
      "dependency": 61,
      "inheritance": 12,
      "implementation": 9,
      "composition": 5
    },
    "stronglyConnectedComponents": 39,
    "inferredRelationRatio": 0.23
  }
}
```

**解读示例**：`stronglyConnectedComponents: 39` 而 `entityCount: 42`，说明有 3 个实体参与了循环依赖（形成了若干 SCC，大小 > 1）。`inferredRelationRatio: 0.23` 表示 23% 的关系是推断出的，需留意这部分的准确性。

---

## 实现范围

### 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/types/index.ts` | 新增类型 | 添加 `ArchJSONMetrics` 接口，在 `ArchJSON` 中增加 `metrics?` 字段 |
| `src/parser/metrics-calculator.ts` | 新建文件 | 唯一承担指标计算的模块；接收聚合后的 ArchJSON 和 level，返回 `ArchJSONMetrics` |
| `src/cli/processors/diagram-processor.ts` | 少量修改 | 在聚合完成后调用 `MetricsCalculator`，将结果写入 `aggregatedJSON.metrics` 再输出 |
| `tests/unit/parser/metrics-calculator.test.ts` | 新建测试 | 见下方验收标准 |

### 职责边界说明

- `ArchJSONAggregator`：**不改动**。它的职责是结构变换，不承担指标计算。
- `DiagramResult.stats`：**不改动**。它是运行时 CLI 报告，与持久化到文件的 `metrics` 并存，用途不同（前者给用户看，后者给工具消费）。
- `MetricsCalculator`：纯函数模块，输入聚合后的 ArchJSON + level，输出 `ArchJSONMetrics`，无副作用。

### 计算时机

在 `diagram-processor.ts` 的流程中，**聚合之后、写文件之前**计算：

```
parseProject()
  → ArchJSONAggregator.aggregate(level)   // 现有
  → MetricsCalculator.calculate(aggregatedJSON, level)  // 新增
  → aggregatedJSON.metrics = result
  → generateOutput()                       // 写入文件
```

两种格式（`json` 和 `mermaid`）都计算指标，因为 Mermaid 格式将来也可能需要展示统计信息。

### 不在本次范围内

- 基于指标的健康阈值告警（需先积累实证数据）
- 指标的历史趋势分析（需 git 时序数据）
- Mermaid 图中展示指标
- 弱连通分量（WCC）：当前不计算，SCC 对架构分析更有价值

---

## 向后兼容性

- `metrics` 为可选字段（`?`），不影响现有消费者
- 不改变 `entities` / `relations` / `extensions` 的结构
- 版本号维持 `"1.0"`（新增可选字段，非 breaking change）
- 如后续 `ArchJSONMetrics` 需要新增字段，同样以可选字段方式追加

---

## 验收标准

### 功能正确性

1. `format=json` 和 `format=mermaid` 两种格式的 ArchJSON 均包含 `metrics` 字段
2. `metrics.level` 与实际聚合层级一致
3. `entityCount` === `aggregatedJSON.entities.length`
4. `relationCount` === `aggregatedJSON.relations.length`
5. `relationTypeBreakdown` 中各类型数量之和 === `relationCount`

### SCC 计算

6. 无环图：`stronglyConnectedComponents` === `entityCount`
7. 全连通环（所有节点成一个环）：`stronglyConnectedComponents` === 1
8. 孤立节点（无任何关系）：每个节点各自是一个 SCC，`stronglyConnectedComponents` === `entityCount`
9. 关系中包含不存在于 entities 的 endpoint 时，不报错，跳过该关系

### 边界情况

10. 空 ArchJSON（entities=[], relations=[]）：`stronglyConnectedComponents=0`, `inferredRelationRatio=0`，不报错
11. `relationCount=0` 时：`inferredRelationRatio=0`（不出现除零错误）
12. 所有关系均为 explicit：`inferredRelationRatio=0.00`
13. `relationTypeBreakdown` 中只列出数量 > 0 的类型

### 回归

14. 现有所有测试通过（无回归）

---

## 待解决的开放问题

| 问题 | 说明 | 建议处理时机 |
|------|------|------------|
| 健康阈值 | 当前没有实证数据支撑任何数值阈值 | 在 5 个以上真实项目积累数据后再定 |
| SCC 与 package 层级 | package 层级的 SCC 检测包的循环依赖，语义清晰；class 层级的 SCC 检测类循环，也有价值；但两者数值不可比较 | 文档中明确说明 level 语义，禁止跨 level 比较 |
| 外部依赖的处理 | 关系可能指向外部库的实体（不在 entities 中），当前方案是跳过 | 后续可增加 `externalDependencyCount` 指标 |

---

## 参考

- [GIT_Software_Dev_Future.md](../references/GIT_Software_Dev_Future.md) — §8.1 基于 GIT 的系统健康度量体系
- [GIT_Analysis_for_ArchGuard.md](../references/GIT_Analysis_for_ArchGuard.md) — 第 6 节，可量化的新指标方向
- ADR-002（`src/types/extensions.ts`）— ArchJSON 扩展规范
- `src/cli/processors/diagram-processor.ts:383` — 现有 DiagramResult.stats 实现
