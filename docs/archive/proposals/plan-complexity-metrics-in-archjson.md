# ArchJSON 复杂度指标 — 实施计划

> Source proposal: `docs/proposals/PROPOSAL-complexity-metrics-in-archjson.md` (v2)
> Status: Draft (v2 — 经架构审查修订)
>
> v2 变更：修复缓存污染 bug、合并 A-2/A-3 消除占位值、修正类型引用、修正测试路径、
> 缩减 Mermaid 格式的计算范围、修复构造器风格、修复文档结构。

---

## 概述

本计划将 Proposal v2 映射为两个串行阶段：

| 阶段 | 内容 | 性质 | 说明 |
|------|------|------|------|
| **Phase A** | 类型定义 + `MetricsCalculator` | 基础 | 纯计算逻辑，无副作用；所有下游依赖此阶段 |
| **Phase B** | 集成到 `DiagramProcessor` | 集成 | 依赖 Phase A；将指标写入 JSON 格式的 ArchJSON 输出 |

两阶段必须串行：Phase B 依赖 Phase A 产出的类型和计算模块。

### 关键架构决策

**`metrics` 仅在 `json` 格式下计算和输出。**

Mermaid 格式不将 ArchJSON 写入磁盘（只输出 `.mmd/.svg/.png`），`metrics` 字段无法被下游工具消费。在 Mermaid 格式下计算 metrics 没有可验证的产出，因此不执行。这使验收标准可以被客观核实。

### 测试基准

**≥ 1308 tests passing**（`tests/integration/mermaid/e2e.test.ts` 中 7 个预存失败与本工作无关）。
所有阶段必须维持或增加此数量。

### 代码预算（每 Stage）

- 实现代码：≤ 150 行
- 新增测试：≤ 200 行

---

## Phase A — 类型定义与计算核心

### 目标

- 在 `src/types/index.ts` 中新增 `ArchJSONMetrics` 接口，并将 `metrics?` 字段加入 `ArchJSON`
- 新建 `src/parser/metrics-calculator.ts`，实现**全部**指标计算逻辑（含 SCC），纯函数，无副作用
- 覆盖全部边界情况（空图、无环图、全环图、外部依赖、除零保护）

### 架构约束

- `ArchJSONAggregator` **不改动**
- `MetricsCalculator` 对外暴露单一方法：`calculate(archJSON: ArchJSON, level: DetailLevel): ArchJSONMetrics`
- `ArchJSONMetrics.level` 使用已有的 `DetailLevel` 类型（`@/types/index.js` 通过 `export * from './config.js'` 已 re-export），**不重新声明 union**
- SCC 使用 **Kosaraju 算法**（两次 DFS on directed graph）
- `relations` 中 endpoint 不在 `entities` 集合中时，**静默跳过**（外部依赖），不报错

### 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/types/index.ts` | 新增类型 | 新增 `ArchJSONMetrics` 接口；在 `ArchJSON` 接口中追加 `metrics?: ArchJSONMetrics` |
| `src/parser/metrics-calculator.ts` | 新建文件 | `MetricsCalculator` 类，完整实现（含 SCC），对外暴露 `calculate(archJSON, level)` |
| `tests/unit/parser/metrics-calculator.test.ts` | 新建测试 | 覆盖全部验收标准场景 |

---

### Stage A-1 — 类型定义（纯类型，无逻辑）

在 `src/types/index.ts` 中新增 `ArchJSONMetrics` 接口。注意：`DetailLevel` 已通过 `export * from './config.js'`（第 6 行）在此文件中可用，直接引用，不重新声明。

```typescript
/**
 * Structural proxy metrics for ArchJSON.
 * Computed by MetricsCalculator after aggregation; all values are bound to `level`.
 * Do NOT compare values across different levels.
 */
export interface ArchJSONMetrics {
  /** The aggregation level that produced these metrics. Must be checked before interpreting any value. */
  level: DetailLevel;

  /** Total entity count at this level (= entities.length) */
  entityCount: number;

  /** Total relation count at this level (= relations.length) */
  relationCount: number;

  /**
   * Per-type relation counts. Only types with count > 0 are present.
   * Sum of all values equals relationCount.
   */
  relationTypeBreakdown: Partial<Record<RelationType, number>>;

  /**
   * Number of strongly connected components (Kosaraju algorithm) in the directed dependency graph.
   * - Equals entityCount → no cyclic dependencies
   * - Less than entityCount → cyclic dependencies exist; (entityCount - SCC) is a rough cycle size indicator
   * - Equals 0 → entities array is empty
   */
  stronglyConnectedComponents: number;

  /**
   * Ratio of inferred relations (inferenceSource !== 'explicit') to total relations. Range: [0, 1].
   * Higher values mean heavier reliance on static analysis inference, lower result confidence.
   * Returns 0 when relationCount === 0.
   */
  inferredRelationRatio: number;
}
```

同时在 `ArchJSON` 接口末尾追加（`src/types/index.ts:63` 之后）：

```typescript
/**
 * Structural proxy metrics, computed by MetricsCalculator after aggregation.
 * Only present in json-format output. Bound to the aggregation level used.
 */
metrics?: ArchJSONMetrics;
```

**验证**：`npm run type-check` 通过，不新增任何运行时逻辑。

**代码量估计**：~30 行类型定义

---

### Stage A-2 — MetricsCalculator 完整实现（含 SCC）

> **注意**：Stage A-2 和 A-3 合并为单一 Stage。SCC 是核心指标，不得以占位值（`0`）交付中间状态，因为 `0` 与"无实体"场景的真实值相同，语义上无法区分。

新建 `src/parser/metrics-calculator.ts`：

```typescript
import type { ArchJSON, ArchJSONMetrics, RelationType, DetailLevel } from '@/types/index.js';

export class MetricsCalculator {
  calculate(archJSON: ArchJSON, level: DetailLevel): ArchJSONMetrics {
    const { entities, relations } = archJSON;
    const entityCount = entities.length;
    const relationCount = relations.length;

    return {
      level,
      entityCount,
      relationCount,
      relationTypeBreakdown: this.buildTypeBreakdown(relations),
      stronglyConnectedComponents: this.countSCC(entities, relations),
      inferredRelationRatio: this.calcInferredRatio(relations),
    };
  }

  private buildTypeBreakdown(
    relations: ArchJSON['relations']
  ): Partial<Record<RelationType, number>> {
    const breakdown: Partial<Record<RelationType, number>> = {};
    for (const r of relations) {
      breakdown[r.type] = (breakdown[r.type] ?? 0) + 1;
    }
    return breakdown;
  }

  private calcInferredRatio(relations: ArchJSON['relations']): number {
    if (relations.length === 0) return 0;
    const inferredCount = relations.filter(
      r => r.inferenceSource !== undefined && r.inferenceSource !== 'explicit'
    ).length;
    return Math.round((inferredCount / relations.length) * 100) / 100;
  }

  private countSCC(
    entities: ArchJSON['entities'],
    relations: ArchJSON['relations']
  ): number {
    if (entities.length === 0) return 0;

    const entityIds = new Set(entities.map(e => e.id));
    // Skip relations where either endpoint is not in entities (external dependencies)
    const validRelations = relations.filter(
      r => entityIds.has(r.source) && entityIds.has(r.target)
    );

    // Build forward and transposed adjacency lists
    const graph = new Map<string, string[]>();
    const transposed = new Map<string, string[]>();
    for (const id of entityIds) {
      graph.set(id, []);
      transposed.set(id, []);
    }
    for (const r of validRelations) {
      graph.get(r.source)!.push(r.target);
      transposed.get(r.target)!.push(r.source);
    }

    // Pass 1: DFS on forward graph, collect nodes by finish time (iterative to avoid stack overflow)
    const visited1 = new Set<string>();
    const finishStack: string[] = [];
    for (const id of entityIds) {
      if (!visited1.has(id)) {
        this.dfsIterative(id, graph, visited1, finishStack);
      }
    }

    // Pass 2: DFS on transposed graph in reverse finish order
    const visited2 = new Set<string>();
    let sccCount = 0;
    while (finishStack.length > 0) {
      const node = finishStack.pop()!;
      if (!visited2.has(node)) {
        this.dfsIterative(node, transposed, visited2, null);
        sccCount++;
      }
    }
    return sccCount;
  }

  /**
   * Iterative DFS to avoid call stack overflow on large graphs.
   * @param finishList - if non-null, push nodes in finish order (pass 1); if null, just mark visited (pass 2)
   */
  private dfsIterative(
    start: string,
    graph: Map<string, string[]>,
    visited: Set<string>,
    finishList: string[] | null
  ): void {
    // Stack entries: [nodeId, neighborIndex]
    const stack: [string, number][] = [[start, 0]];
    visited.add(start);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const [node, idx] = top;
      const neighbors = graph.get(node) ?? [];
      if (idx < neighbors.length) {
        top[1]++;
        const next = neighbors[idx];
        if (!visited.has(next)) {
          visited.add(next);
          stack.push([next, 0]);
        }
      } else {
        stack.pop();
        if (finishList !== null) finishList.push(node);
      }
    }
  }
}
```

实现细节说明：
- `inferenceSource` 缺失（`undefined`）视为 `'explicit'`，向后兼容
- `inferredRelationRatio` 四舍五入到 2 位小数（`Math.round * 100 / 100`）
- DFS 使用**迭代**而非递归，避免大型代码库下的调用栈溢出
- `buildTypeBreakdown` 只写入 count > 0 的类型，零值类型不出现在结果对象中

测试文件 `tests/unit/parser/metrics-calculator.test.ts`：

```typescript
describe('MetricsCalculator — basic metrics', () => {
  it('空图：所有计数为 0，ratio 为 0，SCC 为 0')
  it('entityCount === entities.length')
  it('relationCount === relations.length')
  it('level 字段与传入的 DetailLevel 一致')
  it('relationTypeBreakdown 仅列出数量 > 0 的类型')
  it('relationTypeBreakdown 各类型之和 === relationCount')
  it('inferredRelationRatio：全 explicit 时返回 0')
  it('inferredRelationRatio：全 inferred 时返回 1')
  it('inferredRelationRatio：混合时精确到 2 位小数')
  it('inferredRelationRatio：relationCount=0 时返回 0，不除零')
  it('inferenceSource 缺失视为 explicit')
})

describe('MetricsCalculator — SCC', () => {
  it('无关系：SCC === entityCount（每节点自成一个分量）')
  it('无环有向图（DAG A→B→C）：SCC === entityCount')
  it('单节点自环（A→A）：SCC === entityCount（自环不形成多节点 SCC）')
  it('两节点互相依赖（A→B, B→A）：SCC === 1')
  it('三节点环（A→B→C→A）：SCC === 1')
  it('两个独立的环（A→B→A, C→D→C）：SCC === 2')
  it('关系含外部 endpoint：跳过该关系，不报错，不影响结果')
  it('entities=[], relations=[]：SCC === 0')
  it('SCC 不大于 entityCount')
  it('大图（100 节点线性链）：不抛出栈溢出错误')
})
```

**代码量估计**：实现 ~100 行，测试 ~150 行

### Stage A-2 完成标准

- `npm test` 全部通过，新增测试用例 ≥ 21 个
- `npm run type-check` 通过
- `MetricsCalculator` 中无 I/O、无外部依赖，仅依赖 `@/types/index.js`
- `stronglyConnectedComponents` 无占位值，所有 SCC 测试用例覆盖且通过

---

## Phase B — 集成到 DiagramProcessor（仅 json 格式）

### 目标

在 `diagram-processor.ts` 的 `processDiagramWithArchJSON()` 中，当 `format === 'json'` 时，计算 metrics 并将其写入输出的 ArchJSON 文件。

### 关键约束：不得修改 `aggregatedJSON` 或 `rawArchJSON`

`ArchJSONAggregator.aggregate()` 在 `method` 级别下直接返回 `rawArchJSON` 的原始引用（`archjson-aggregator.ts:33`），而 `rawArchJSON` 存储在 `this.archJsonCache` 中被多个 diagram 共享。直接赋值 `aggregatedJSON.metrics = ...` 会污染缓存，导致后续 diagram 拿到错误数据。

**正确做法**：创建新对象，不修改 `aggregatedJSON`：

```typescript
const outputJSON = { ...aggregatedJSON, metrics };
```

`generateOutput()` 接收 `outputJSON`（含 metrics），`DiagramResult.stats` 继续使用 `aggregatedJSON`（不含 metrics，避免对象拷贝的性能浪费）。

### 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/cli/processors/diagram-processor.ts` | 少量修改 | 4 处改动（见下方） |
| `tests/unit/cli/processors/diagram-processor.test.ts` | 追加测试 | 在**现有文件**中追加 metrics 相关用例 |

### diagram-processor.ts 的 4 处改动

**① 顶部新增 import**

```typescript
import { MetricsCalculator } from '@/parser/metrics-calculator.js';
```

**② 构造器中新增字段初始化**（遵循现有风格，在 constructor body 中初始化，而非字段初始化器）

```typescript
constructor(options: DiagramProcessorOptions) {
  // ... 现有代码 ...
  this.aggregator = new ArchJSONAggregator();
  this.metricsCalculator = new MetricsCalculator();  // 新增，紧跟 aggregator
  // ... 现有代码 ...
}
```

以及在类属性声明区（第 104 行附近）新增：

```typescript
private metricsCalculator: MetricsCalculator;
```

**③ `processDiagramWithArchJSON()` 中的集成点**

当前代码（约第 336–355 行）：

```typescript
// 1. Aggregate to specified level
const aggregatedJSON = this.aggregator.aggregate(rawArchJSON, diagram.level);

// 2. Resolve output paths
// ...
const format = diagram.format || this.globalConfig.format;
await this.generateOutput(aggregatedJSON, paths, format, diagram.level, diagram);
```

修改后：

```typescript
// 1. Aggregate to specified level
const aggregatedJSON = this.aggregator.aggregate(rawArchJSON, diagram.level);

// 2. Resolve output paths
// ...
const format = diagram.format || this.globalConfig.format;

// For json format: compute metrics and produce a new object (never mutate aggregatedJSON or rawArchJSON,
// as rawArchJSON may be a shared cached reference returned by the 'method'-level aggregator).
const outputJSON =
  format === 'json'
    ? { ...aggregatedJSON, metrics: this.metricsCalculator.calculate(aggregatedJSON, diagram.level) }
    : aggregatedJSON;

await this.generateOutput(outputJSON, paths, format, diagram.level, diagram);
```

**④ `DiagramResult.stats` 保持不变**（继续使用 `aggregatedJSON`，不受影响）

```typescript
stats: {
  entities: aggregatedJSON.entities.length,   // 不变
  relations: aggregatedJSON.relations.length, // 不变
  parseTime,
},
```

**代码量估计**：实现 ~10 行（4 处小改动），测试 ~50 行

---

### Stage B-1 — 集成与验证

改动 `diagram-processor.ts`（如上所示），然后验证：

**单元测试**（追加到 `tests/unit/cli/processors/diagram-processor.test.ts`）：

```typescript
describe('DiagramProcessor — metrics integration', () => {
  it('json 格式：输出的 ArchJSON 包含 metrics 字段')
  it('json 格式：metrics.level 与 diagram.level 一致')
  it('json 格式：metrics.entityCount === aggregatedJSON.entities.length')
  it('mermaid 格式：不计算 metrics，输出对象不含 metrics 字段')
  it('method 级别：不修改 rawArchJSON（缓存对象无 metrics 字段）')
  it('metrics 字段不影响现有 DiagramResult.stats 的值')
})
```

**自验证**（构建后对 ArchGuard 自身执行）：

```bash
npm run build
# class 级别
node dist/cli/index.js analyze -f json -s ./src -l class -n test-metrics
# 检查 archguard/test-metrics.json 中存在 metrics 字段，level === "class"

# package 级别
node dist/cli/index.js analyze -f json -s ./src -l package -n test-metrics-pkg
# 检查 metrics.level === "package"，entityCount 远小于 class 级别（符合聚合预期）
```

### Stage B-1 完成标准

- `npm test` 全部通过，无回归
- `npm run type-check` 通过
- `npm run build` 成功
- `archguard/test-metrics.json` 中存在 `metrics` 字段，各数值合理
- `metrics.level` 在 `package` / `class` / `method` 三种情况下均正确
- 共享缓存测试：同一 sources、不同 level 的两个 diagram 各自得到正确的 `metrics.level`，且 `rawArchJSON` 不含 `metrics` 字段

---

## 完整验收检查清单

| # | 验收标准 | 验证方式 |
|---|---------|---------|
| 1 | `json` 格式输出包含 `metrics` 字段 | Stage B-1 自验证 + 单元测试 |
| 2 | `mermaid` 格式不计算 `metrics` | Stage B-1 单元测试 |
| 3 | `metrics.level` 与聚合层级一致 | Stage B-1 单元测试 |
| 4 | `entityCount === entities.length` | Stage A-2 单元测试 |
| 5 | `relationCount === relations.length` | Stage A-2 单元测试 |
| 6 | `relationTypeBreakdown` 各类型之和 === `relationCount` | Stage A-2 单元测试 |
| 7 | 无环图：`SCC === entityCount` | Stage A-2 单元测试 |
| 8 | 全连通环：`SCC === 1` | Stage A-2 单元测试 |
| 9 | 孤立节点：`SCC === entityCount` | Stage A-2 单元测试 |
| 10 | 含外部 endpoint 的关系：跳过，不报错 | Stage A-2 单元测试 |
| 11 | 空图：`SCC=0, ratio=0`，不报错 | Stage A-2 单元测试 |
| 12 | `relationCount=0` 时 `ratio=0`，不除零 | Stage A-2 单元测试 |
| 13 | 全 explicit 时 `ratio=0` | Stage A-2 单元测试 |
| 14 | `relationTypeBreakdown` 只列 count > 0 的类型 | Stage A-2 单元测试 |
| 15 | `method` 级别下不污染 rawArchJSON 缓存 | Stage B-1 单元测试 |
| 16 | 现有所有测试通过 | 每个 Stage 结束后 `npm test` |

---

## 文件变更汇总

```
src/types/index.ts                                    ← 新增 ArchJSONMetrics + metrics? 字段
src/parser/metrics-calculator.ts                      ← 新建：MetricsCalculator（完整实现）
src/cli/processors/diagram-processor.ts               ← 集成：4 处小改动
tests/unit/parser/metrics-calculator.test.ts          ← 新建：≥ 21 个测试用例
tests/unit/cli/processors/diagram-processor.test.ts   ← 追加：6 个测试用例
```

共 5 个文件（其中 2 个新建，3 个修改）。`ArchJSONAggregator` 不改动。
