# Proposal: 文件级统计与循环依赖展开

**状态**: Revised (2026-03-06 → 2026-03-06)
**日期**: 2026-03-06
**关联**: [proposal-complexity-metrics-in-archjson.md](./proposal-complexity-metrics-in-archjson.md)

---

## 背景与动机

现有 `ArchJSONMetrics`（见关联 Proposal）已提供全局层面的实体数、关系数和 SCC 计数。但在真实项目中，用户反馈这些聚合数字不足以定位问题：

- **问题 A（文件盲区）**：`stronglyConnectedComponents` 告诉你有 3 个循环，却不说是哪些文件；质量分 53/100 告诉你"实体数过多"，却不指出是哪几个文件最密集。用户仍需手工逐一检查。
- **问题 B（SCC 无成员）**：`MetricsCalculator.countSCC()` 在 Pass 2 里只递增计数器，成员集合直接丢弃。输出给用户的是一个数字，不是结构信息。

本 Proposal 的目标是：在**不做任何价值判断**的前提下，将已经存在于 ArchJSON 中但尚未聚合的数据整理成两张新表，使用户（或后续 LLM）能直接读取，无需重新解析：

1. **`fileStats[]`**：以文件为单位的多维统计视图（行数、实体数、方法数、入度、出度、环路参与数）
2. **`cycles[]`**：每个 SCC（环路）的成员列表，从数字展开为可读结构

两者均作为纯统计数据输出，**不附带阈值、标签或建议**。排序方式（如按入度降序）是展示约定，不是诊断结论。

---

## 语言覆盖范围

所有计算均基于 ArchJSON 标准字段，与语言插件无关：

| 语言 | `sourceLocation.file` | 字段来源 | 备注 |
|------|----------------------|---------|------|
| TypeScript | 相对路径（含 `src/` 前缀） | `class-extractor.ts` | ✓ 稳定 |
| Go（标准模式） | 相对路径 | `archjson-mapper.ts` | ✓ 稳定 |
| Go（Atlas 模式） | N/A | Atlas 实体为包级抽象，无文件粒度 | ⚠️ 见下方说明 |
| Java | 相对路径 | `archjson-mapper.ts` | ✓ 稳定 |
| Python | 相对路径 | `archjson-mapper.ts` | ✓ 稳定 |
| C++ | **绝对路径** | `tree-sitter-bridge.ts` | ✓ 稳定，需 `workspaceRoot` 归一化 |

**Go Atlas 模式**：Atlas 的实体对应"能力域"（CapabilityNode）、goroutine 拓扑节点等，不对应源文件。`fileStats` 对 Atlas 输出无意义，计算时应跳过（`archJSON.extensions?.goAtlas` 存在时不生成 `fileStats`）。

**C++ 路径归一化**：C++ 实体的 `sourceLocation.file` 为绝对路径（如 `/home/user/llama.cpp/src/llama.cpp`），需使用 `archJSON.workspaceRoot` 计算相对路径后再参与聚合，否则按绝对路径分组会导致每个实体各成一个文件桶。

---

## 设计约束与数据流

### 约束：`fileStats` 仅适用于 class / method 级别

`ArchJSONAggregator` 在 package 聚合时，每个 package 实体的 `sourceLocation` 取的是该包**第一个成员实体**的 `sourceLocation`（而非包目录）。在 package 级 ArchJSON 上计算 `fileStats` 会产生无意义的结果——每个 package 实体被归入一个任意具体文件，`entityCount`、`methodCount` 等均为 1。

**规则**：`MetricsCalculator.calculate()` 仅在 `level === 'class'` 或 `level === 'method'` 时填充 `fileStats`；`level === 'package'` 时 `fileStats` 为 `undefined`。

### 约束：metrics 计算必须与输出格式解耦

当前代码中，`MetricsCalculator.calculate()` 仅在 `format === 'json'` 时被调用（`diagram-processor.ts:680`）。`index.md` 只在 Mermaid 格式下生成，两者在现有流程中互斥。

**解决方案**：在 `processDiagramWithArchJSON()` 中，无论 `format` 为何，始终计算 metrics，并将结果存入 `DiagramResult.metrics`（新增字段）。`MetricsCalculator.calculate()` 本身是纯函数，无副作用，调用两次的开销可忽略不计。

### 数据流

```
MetricsCalculator.calculate(aggregatedJSON, level)
  └─→ ArchJSONMetrics { ..., fileStats?, cycles? }
        └─→ DiagramResult.metrics                   ← 新增字段
              └─→ DiagramIndexGenerator.generate(results)
                    └─→ index.md（文件统计表 + 循环依赖表）
```

### 多图场景的 metrics 选取

一次完整分析可产生多张图（package/class/method 各一张），每张图均携带自己的 `DiagramResult.metrics`。`index.md` 的两张统计表按以下优先级选取：

1. 优先使用 **class 级别**图的 metrics（文件粒度最完整）
2. 若无 class 级别，退而使用 **method 级别**
3. 若均无，省略两张表（不报错）

package 级别的 metrics 不参与 `index.md` 的文件统计渲染，即使它是唯一一张图。

---

## 设计

### 新增类型

```typescript
// src/types/index.ts 新增，附加到 ArchJSONMetrics

/**
 * 以源文件为单位的统计维度。
 * 所有数值均为原始计数，不携带阈值或建议。
 *
 * `loc` 为近似值（见下方"LOC 计算说明"）。
 * `cycleCount` 表示该文件中有多少个不同的 SCC（大小 > 1）包含了该文件内的实体。
 *
 * 仅在 level === 'class' | 'method' 时存在；level === 'package' 时为 undefined。
 */
export interface FileStats {
  /** 源文件路径（相对于 workspaceRoot；C++ 绝对路径已归一化） */
  file: string;

  /** 文件行数（近似值：该文件内所有实体 endLine 的最大值） */
  loc: number;

  /** 该文件中定义的实体数（class / interface / struct / enum 等） */
  entityCount: number;

  /** 该文件所有实体的方法（type === 'method' 或 type === 'constructor'）总数 */
  methodCount: number;

  /** 该文件所有实体的字段（type === 'property' 或 type === 'field'）总数 */
  fieldCount: number;

  /**
   * 入度：关系图中以该文件实体为 target 的边数。
   * 高入度意味着该文件被大量其他模块依赖，改动影响范围广。
   */
  inDegree: number;

  /**
   * 出度：关系图中以该文件实体为 source 的边数。
   * 高出度意味着该文件依赖大量其他模块。
   */
  outDegree: number;

  /**
   * 该文件参与的环路数（含该文件实体的 SCC，大小 > 1 的数量）。
   * 0 表示文件内实体不参与任何循环依赖。
   */
  cycleCount: number;
}

/**
 * 一个强连通分量（循环依赖环）的成员信息。
 * 只记录 size > 1 的 SCC（单节点 SCC 是平凡的，无循环语义）。
 *
 * 注意：自循环（A→A）产生 size=1 的 SCC，不出现在此列表中。
 * Kosaraju 算法产生图的分区，每个实体恰好属于一个 SCC，因此 members 集合之间无重叠。
 */
export interface CycleInfo {
  /** 环路中的实体数量 */
  size: number;

  /** 环路成员的 entity ID 列表（与 ArchJSON entities[].id 对应，供程序化查询） */
  members: string[];

  /**
   * 环路成员的 entity name 列表（与 members 一一对应，供人类阅读和 index.md 渲染）。
   * DiagramIndexGenerator 直接使用此字段，无需持有 entities[] 引用。
   */
  memberNames: string[];

  /**
   * 环路成员所在的源文件列表（去重后的相对路径）。
   * 长度为 1 时表示循环发生在单文件内；
   * 长度 > 1 时表示跨文件循环依赖。
   */
  files: string[];
}
```

### `ArchJSONMetrics` 扩展

```typescript
// src/types/index.ts — 在现有 ArchJSONMetrics 中追加两个可选字段

export interface ArchJSONMetrics {
  // 现有字段（不变）
  level: DetailLevel;
  entityCount: number;
  relationCount: number;
  relationTypeBreakdown: Partial<Record<RelationType, number>>;
  stronglyConnectedComponents: number;
  inferredRelationRatio: number;

  // 新增字段
  /**
   * 以源文件为单位的统计视图，按 inDegree 降序排列。
   * 仅在 level === 'class' | 'method' 时存在。
   * Go Atlas 模式或 level === 'package' 时为 undefined。
   */
  fileStats?: FileStats[];

  /**
   * 所有大小 > 1 的 SCC（循环依赖），按 size 降序排列。
   * 空数组表示不存在 size > 1 的循环依赖（自循环不计入）。
   * 注意：自循环（A→A）的 SCC size=1，不出现在此列表中；
   * 因此 cycles 为空不等同于图中无任何环——可能仍有自循环。
   */
  cycles?: CycleInfo[];
}
```

### `DiagramResult` 扩展

```typescript
// src/cli/processors/diagram-processor.ts — 在 DiagramResult 中追加 metrics 字段

export interface DiagramResult {
  name: string;
  success: boolean;
  paths?: { mmd?: string; svg?: string; png?: string; json?: string };
  stats?: { entities: number; relations: number; parseTime: number };
  error?: string;

  /**
   * 该图的结构代理指标，无论输出格式如何均计算。
   * 供 DiagramIndexGenerator 渲染 index.md 的统计表使用。
   * 仅 success === true 时存在。
   */
  metrics?: ArchJSONMetrics;
}
```

---

### LOC 计算说明（近似值 vs 精确值）

**当前选择：近似值（`max(endLine)`）**

`sourceLocation.endLine` 已在所有实体上存在，按文件分组后取最大值是零额外 I/O 的下界估算。

```
file LOC ≈ max(entity.sourceLocation.endLine for entities in file)
```

**误差来源**：
- 文件顶部的 import 区块（约 5-50 行）不被计入
- 最后一个实体结束后仍可能有代码（少见）

对于"文件是否异常大"的判断，这个误差（通常 < 10%）不影响相对排序，可接受。

**精确值路径（留作后续 enhancement）**：`ParallelParser` 读取文件时顺带计行数，存入 `ArchJSON.sourceFiles` 扩展为 `{ path: string; loc: number }[]`，此时 `FileStats.loc` 可切换为精确值。本 Proposal 不实现此路径，但类型设计已兼容（字段名保持 `loc`，语义升级无破坏性）。

---

### 算法改动：`MetricsCalculator`

当前 `countSCC()` 的 Pass 2 只递增计数器：

```typescript
// 现有（丢弃成员）
while (finishStack.length > 0) {
  const node = finishStack.pop()!;
  if (!visited2.has(node)) {
    this.dfsIterative(node, transposed, visited2, null);
    sccCount++;   // ← 成员信息完全丢失
  }
}
```

改为同时收集成员，并提取非平凡 SCC：

```typescript
// 改动后（保留成员）
const sccGroups: string[][] = [];
while (finishStack.length > 0) {
  const node = finishStack.pop()!;
  if (!visited2.has(node)) {
    const members: string[] = [];
    this.dfsIterative(node, transposed, visited2, members);  // Pass 2 的 finishList 复用为成员收集
    sccGroups.push(members);
  }
}

const sccCount = sccGroups.length;
// 只保留 size > 1 的 SCC（非平凡循环；自循环 size=1 亦被过滤）
const nonTrivialSCCs = sccGroups.filter(g => g.length > 1);
```

> 注意：Kosaraju Pass 2 的 `dfsIterative` 调用当前传 `null`（不收集 finish order）。改为传一个数组即可同时收集成员，无需修改 DFS 本身的逻辑。

从 `nonTrivialSCCs` 构造 `CycleInfo[]`：

```typescript
const entityFileMap = new Map<string, string>();
const entityNameMap = new Map<string, string>();
for (const e of entities) {
  const rawFile = e.sourceLocation?.file ?? '';
  const file = workspaceRoot && path.isAbsolute(rawFile)
    ? path.relative(workspaceRoot, rawFile)
    : rawFile;
  entityFileMap.set(e.id, file);
  entityNameMap.set(e.id, e.name);
}

const cycles: CycleInfo[] = nonTrivialSCCs
  .map(members => ({
    size: members.length,
    members,
    memberNames: members.map(id => entityNameMap.get(id) ?? id),
    files: [...new Set(members.map(id => entityFileMap.get(id) ?? '').filter(Boolean))],
  }))
  .sort((a, b) => b.size - a.size);
```

### `FileStats` 聚合算法

```
前置条件：level === 'class' || level === 'method'，且非 Go Atlas 模式
输入：entities[], relations[], workspaceRoot?

1. 构建 fileEntityMap: Map<file, Entity[]>
   - 对每个 entity，归一化 sourceLocation.file（C++ 绝对路径转相对）
   - 分组

2. 构建 inDegree/outDegree: Map<entityId, {in: number, out: number}>
   - 遍历 relations，只统计 source/target 均在 entityIds 集合内的边

3. 构建 cycleCountPerFile: Map<file, number>
   - 从 nonTrivialSCCs 中，对每个 member 找到其 file，对该 file 计数

4. 对每个 file 生成 FileStats：
   - loc          = max(entity.sourceLocation.endLine)
   - entityCount  = entities.length
   - methodCount  = sum of (members where m.type === 'method' || m.type === 'constructor') across all entities in file
   - fieldCount   = sum of (members where m.type === 'property' || m.type === 'field') across all entities in file
   - inDegree     = sum(inDegreeMap.get(entity.id) for entities in file)
   - outDegree    = sum(outDegreeMap.get(entity.id) for entities in file)
   - cycleCount   = cycleCountPerFile.get(file) ?? 0

5. 按 inDegree 降序排列（主键），outDegree 降序为次键
```

### 职责分配

| 组件 | 变更 | 说明 |
|------|------|------|
| `MetricsCalculator` | 修改 | `countSCC()` → `computeCycles()`，返回 `{ sccCount, cycles, nonTrivialSCCs }`；新增 `computeFileStats()`；`calculate()` 按 level 和模式决定是否填充 `fileStats`/`cycles` |
| `DiagramProcessor.processDiagramWithArchJSON()` | 修改 | 无论 `format` 为何，始终调用 `metricsCalculator.calculate()` 并将结果写入 `DiagramResult.metrics` |
| `DiagramResult` | 修改 | 新增 `metrics?: ArchJSONMetrics` 字段 |
| `src/types/index.ts` | 修改 | 新增 `FileStats`、`CycleInfo`；扩展 `ArchJSONMetrics`；`CycleInfo` 增加 `memberNames` 字段 |
| `DiagramIndexGenerator` | 修改 | `generate(results)` 从 results 中按优先级（class > method）选取 metrics，追加两张统计表 |
| 语言插件 | **不改动** | 数据已在 ArchJSON 中，无需插件层介入 |

---

### `index.md` 输出格式

在现有图列表之后追加两个区块。区块仅在对应数据非空时生成。

**选取逻辑**（`DiagramIndexGenerator` 内部）：

```typescript
// 优先 class 级，其次 method 级，均无则跳过
const metricsForStats =
  results.find(r => r.success && r.metrics?.level === 'class')?.metrics ??
  results.find(r => r.success && r.metrics?.level === 'method')?.metrics;
```

#### 文件统计表

```markdown
## File Statistics (sorted by InDegree ↓)

> `LOC` is approximate (max entity endLine). `InDegree`/`OutDegree` count relations within parsed scope.
> Showing top 30 files. All values are bound to the `class` aggregation level.

| File | LOC | Entities | Methods | Fields | InDegree | OutDegree | Cycles |
|------|-----|----------|---------|--------|----------|-----------|--------|
| src/interfaces/plugins.ts | 766 | 3 | 34 | 12 | 10 | 2 | 1 |
| src/index.ts              | 312 | 5 |  8 |  6 |  8 | 12 | 0 |
| src/api/index.ts          | 203 | 2 |  6 |  3 |  5 |  4 | 2 |
```

#### 循环依赖表

```markdown
## Circular Dependencies

3 cycles detected.

| # | Size | Files | Members |
|---|------|-------|---------|
| 1 | 3 | src/api/index.ts, src/root/index.ts, src/config/config.ts | ApiRouter, App, ConfigApp |
| 2 | 2 | src/interfaces/plugins.ts, src/root/index.ts | PluginManager, App |
| 3 | 2 | src/config/config.ts, src/root/index.ts | ConfigApp, App |
```

**设计说明**：
- Members 列使用 `CycleInfo.memberNames`（entity name），便于人类阅读；`DiagramIndexGenerator` 无需持有 `entities[]` 引用
- Files 列使用 `CycleInfo.files`（去重后相对路径），便于定位源文件
- 表格按 size 降序，较大的环路排在前面
- 文件统计表默认只展示 Top 30（按 inDegree），表头注明 level 名称
- Go Atlas 模式下两张表均不生成（在 `index.md` 中注明 `File-level stats not available for Go Atlas mode`）
- `level === 'package'` 时两张表均不生成（注明 `File-level stats not available at package level`）

---

## 实现范围

### 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/types/index.ts` | 修改 | 新增 `FileStats`、`CycleInfo` 接口（含 `memberNames`）；扩展 `ArchJSONMetrics` 加入 `fileStats?`、`cycles?` |
| `src/parser/metrics-calculator.ts` | 修改 | `countSCC()` 重构为 `computeCycles()`；新增 `computeFileStats()`；更新 `calculate()` 按 level/模式条件填充新字段 |
| `src/cli/processors/diagram-processor.ts` | 修改 | `DiagramResult` 新增 `metrics?` 字段；`processDiagramWithArchJSON()` 始终计算 metrics 并写入结果 |
| `src/cli/utils/diagram-index-generator.ts` | 修改 | 生成 `index.md` 时按优先级选取 metrics，追加文件统计表和循环依赖表 |
| `tests/unit/parser/metrics-calculator.test.ts` | 修改 | 新增 `FileStats` 和 `CycleInfo`（含 `memberNames`）相关测试用例 |
| `tests/unit/cli/utils/diagram-index-generator.test.ts` | 修改或新建 | 验证两张表的渲染逻辑及 metrics 选取优先级 |

### 不在本次范围内

- 精确 LOC（需改 ParallelParser + 各语言插件，独立 Proposal）
- SCC 内部路径重建（从成员集合恢复具体的 A→B→C→A 路径，需 BFS；可作为后续 enhancement）
- 基于指标的阈值告警（无 LLM，不做判断）
- 历史趋势对比（需 git 时序数据）
- Go Atlas 实体的文件级统计（Atlas 实体无文件粒度，语义不适用）

---

## 向后兼容性

- `fileStats` 和 `cycles` 均为可选字段（`?`），现有消费者零影响
- `stronglyConnectedComponents` 保留不变（已有消费者依赖此字段）
- `DiagramResult.metrics` 为新增可选字段，现有消费者零影响
- `index.md` 追加内容在现有图列表之后，不影响已有内容
- ArchJSON `version` 维持 `"1.0"`

---

## 验收标准

### `FileStats` 计算

1. 每个 `sourceLocation.file` 唯一对应一条 `FileStats`
2. `entityCount` === 该文件内实体数（与从 `entities[]` 手工过滤一致）
3. `methodCount` === 该文件所有实体中 `m.type === 'method' || m.type === 'constructor'` 的 members 总数；`fieldCount` === `m.type === 'property' || m.type === 'field'` 的 members 总数；两者之和 ≤ 该文件 members 总数（其他 MemberType 不计入任何一列）
4. `inDegree` + `outDegree` 均只统计 source/target 均在解析范围内的关系（排除外部依赖）
5. `cycleCount` === 包含该文件实体的非平凡 SCC 数量
6. 结果按 `inDegree DESC` 排序
7. C++ 项目：`workspaceRoot` 存在时，绝对路径正确归一化为相对路径
8. Go Atlas 模式：`fileStats` 为 `undefined`，不报错
9. `level === 'package'`：`fileStats` 为 `undefined`，不报错

### `CycleInfo` 计算

10. `cycles` 中只包含 `size > 1` 的 SCC（平凡 SCC 和自循环不出现）
11. 所有 `cycles[i].members` 中的 entity ID 均存在于 `archJSON.entities`
12. `cycles[i].memberNames[k]` === `archJSON.entities.find(e => e.id === cycles[i].members[k])?.name`（与 members 一一对应）
13. `cycles[i].files` 为成员 `sourceLocation.file` 去重后的列表，长度 ≥ 1
14. `cycles` 按 `size DESC` 排序
15. `cycles.length === 0` 表示不存在 size > 1 的循环依赖；图中可能仍有自循环（A→A），此时 `stronglyConnectedComponents === entityCount` 但 `cycles` 为空，两者不矛盾
16. Kosaraju 产生图的分区：`sum(cycles[i].size) === nonTrivialSCCEntityCount`（精确等于，无重叠）

### 边界情况

17. 空 ArchJSON：`fileStats = []`，`cycles = []`，不报错
18. 单文件项目（所有实体在同一文件）：`fileStats.length === 1`
19. 无 `sourceLocation` 的实体（理论上不存在，但防御性处理）：跳过，不影响其他实体统计
20. 关系中 source/target 指向外部实体（不在 entities 中）：入度/出度不计此类关系

### `DiagramResult.metrics` 计算时机

21. `format === 'mermaid'` 时，`DiagramResult.metrics` 仍被计算并写入（不依赖 format）
22. `format === 'json'` 时，`DiagramResult.metrics` 同样被写入（不变）

### `index.md` 输出

23. 文件统计表在循环依赖表之前
24. 两张表均在现有图列表之后
25. `cycles` 为空时，循环依赖区块显示 `No circular dependencies detected.`，不生成空表
26. `fileStats` 为 `undefined`（Go Atlas 模式或 package 级别）时，文件统计区块整体省略并注明原因
27. 多张图时，统计表取自 class 级别图的 metrics；如无 class 级别则取 method 级别；均无则省略两张表

### 回归

28. 现有所有测试通过（无回归）
29. `npm run type-check` 零错误

---

## 待解决的开放问题

| 问题 | 说明 | 建议处理时机 |
|------|------|------------|
| `index.md` 表格行数上限 | 大型项目可能有数百个文件，全部展示会使 `index.md` 过长 | 默认只展示 Top 30（按 inDegree）；后续可提供 `--stats-top-n` 选项 |
| SCC 路径重建 | 当前输出成员集合，不输出具体路径（A→B→C→A）。重建需 BFS，但成员集合已够用 | 后续 enhancement；无阻塞当前实现 |
| `inDegree` 跨 level 解读差异 | package 层的入度和 class 层的入度含义不同，不可比较 | 与现有 `level` 字段约束一致，`index.md` 表头标注 level 名称 |
| LOC 精确化路径 | 需在各语言插件的解析阶段统计文件行数 | 独立 Proposal，当前近似值可接受 |
