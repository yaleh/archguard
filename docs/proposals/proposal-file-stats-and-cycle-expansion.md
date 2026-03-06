# Proposal: 文件级统计与循环依赖展开

**状态**: Draft
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
 */
export interface FileStats {
  /** 源文件路径（相对于 workspaceRoot；C++ 绝对路径已归一化） */
  file: string;

  /** 文件行数（近似值：该文件内所有实体 endLine 的最大值） */
  loc: number;

  /** 该文件中定义的实体数（class / interface / struct / enum 等） */
  entityCount: number;

  /** 该文件所有实体的方法（type='method' | 'constructor'）总数 */
  methodCount: number;

  /** 该文件所有实体的字段（type='property' | 'field'）总数 */
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
 */
export interface CycleInfo {
  /** 环路中的实体数量 */
  size: number;

  /** 环路成员的 entity ID 列表（与 ArchJSON entities[].id 对应） */
  members: string[];

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
   * Go Atlas 模式下为 undefined（实体不对应源文件）。
   */
  fileStats?: FileStats[];

  /**
   * 所有大小 > 1 的 SCC（循环依赖），按 size 降序排列。
   * 空数组表示无循环依赖（等价于 stronglyConnectedComponents === entityCount）。
   */
  cycles?: CycleInfo[];
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
// 只保留 size > 1 的 SCC（非平凡循环）
const nonTrivialSCCs = sccGroups.filter(g => g.length > 1);
```

> 注意：Kosaraju Pass 2 的 `dfsIterative` 调用当前传 `null`（不收集 finish order）。改为传一个数组即可同时收集成员，无需修改 DFS 本身的逻辑。

从 `nonTrivialSCCs` 构造 `CycleInfo[]`：

```typescript
const entityFileMap = new Map<string, string>();
for (const e of entities) {
  const rawFile = e.sourceLocation?.file ?? '';
  const file = workspaceRoot && path.isAbsolute(rawFile)
    ? path.relative(workspaceRoot, rawFile)
    : rawFile;
  entityFileMap.set(e.id, file);
}

const cycles: CycleInfo[] = nonTrivialSCCs
  .map(members => ({
    size: members.length,
    members,
    files: [...new Set(members.map(id => entityFileMap.get(id) ?? '').filter(Boolean))],
  }))
  .sort((a, b) => b.size - a.size);
```

### `FileStats` 聚合算法

```
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
   - methodCount  = sum(entity.members.filter(m => m.type === 'method' || 'constructor').length)
   - fieldCount   = sum(entity.members.filter(m => m.type === 'property' || 'field').length)
   - inDegree     = sum(inDegreeMap.get(entity.id) for entities in file)
   - outDegree    = sum(outDegreeMap.get(entity.id) for entities in file)
   - cycleCount   = cycleCountPerFile.get(file) ?? 0

5. 按 inDegree 降序排列（主键），outDegree 降序为次键
```

### 职责分配

| 组件 | 变更 | 说明 |
|------|------|------|
| `MetricsCalculator` | 修改 | `countSCC()` → `computeCycles()`，返回 `{ sccCount, cycles, nonTrivialSCCs }`；新增 `computeFileStats()` |
| `MetricsCalculator.calculate()` | 修改 | 组合两个新方法的输出，填充 `fileStats`/`cycles` |
| `src/types/index.ts` | 修改 | 新增 `FileStats`、`CycleInfo`；扩展 `ArchJSONMetrics` |
| `DiagramIndexGenerator` | 修改 | 在 `index.md` 末尾追加两张统计表（见下节） |
| 语言插件 | **不改动** | 数据已在 ArchJSON 中，无需插件层介入 |

---

### `index.md` 输出格式

在现有图列表之后追加两个区块。区块仅在对应数据非空时生成。

#### 文件统计表

```markdown
## File Statistics (sorted by InDegree ↓)

> `LOC` is approximate (max entity endLine). `InDegree`/`OutDegree` count relations within parsed scope.

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
- Members 列展示 entity `name`（非 ID），便于人类阅读
- Files 列去重后排列，便于定位源文件
- 表格按 size 降序，较大的环路排在前面
- Go Atlas 模式下两张表均不生成（在 `index.md` 中注明 `File-level stats not available for Go Atlas mode`）

---

## 实现范围

### 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/types/index.ts` | 修改 | 新增 `FileStats`、`CycleInfo` 接口；扩展 `ArchJSONMetrics` 加入 `fileStats?`、`cycles?` |
| `src/parser/metrics-calculator.ts` | 修改 | `countSCC()` 重构为 `computeCycles()`；新增 `computeFileStats()`；更新 `calculate()` |
| `src/cli/utils/diagram-index-generator.ts` | 修改 | 生成 `index.md` 时追加文件统计表和循环依赖表 |
| `tests/unit/parser/metrics-calculator.test.ts` | 修改 | 新增 `FileStats` 和 `CycleInfo` 相关测试用例 |
| `tests/unit/cli/utils/diagram-index-generator.test.ts` | 修改或新建 | 验证两张表的渲染逻辑 |

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
- `index.md` 追加内容在现有图列表之后，不影响已有内容
- ArchJSON `version` 维持 `"1.0"`

---

## 验收标准

### `FileStats` 计算

1. 每个 `sourceLocation.file` 唯一对应一条 `FileStats`
2. `entityCount` === 该文件内实体数（与从 `entities[]` 手工过滤一致）
3. `methodCount` + `fieldCount` 之和 ≤ 该文件所有实体 `members[]` 总数（constructor 归入 methodCount）
4. `inDegree` + `outDegree` 均只统计 source/target 均在解析范围内的关系（排除外部依赖）
5. `cycleCount` === 包含该文件实体的非平凡 SCC 数量
6. 结果按 `inDegree DESC` 排序
7. C++ 项目：`workspaceRoot` 存在时，绝对路径正确归一化为相对路径
8. Go Atlas 模式：`fileStats` 为 `undefined`，不报错

### `CycleInfo` 计算

9. `cycles` 中只包含 `size > 1` 的 SCC（平凡 SCC 不出现）
10. 所有 `cycles[i].members` 中的 entity ID 均存在于 `archJSON.entities`
11. `cycles[i].files` 为成员 `sourceLocation.file` 去重后的列表，长度 ≥ 1
12. `cycles` 按 `size DESC` 排序
13. `cycles.length` 为 0 时等价于 `stronglyConnectedComponents === entityCount`（无循环）
14. `sum(cycles[i].size) >= nonTrivialEntityCount`（同一实体可参与多个 SCC，暂不去重）

### 边界情况

15. 空 ArchJSON：`fileStats = []`，`cycles = []`，不报错
16. 单文件项目（所有实体在同一文件）：`fileStats.length === 1`
17. 无 `sourceLocation` 的实体（理论上不存在，但防御性处理）：跳过，不影响其他实体统计
18. 关系中 source/target 指向外部实体（不在 entities 中）：入度/出度不计此类关系

### `index.md` 输出

19. 文件统计表在循环依赖表之前
20. 两张表均在现有图列表之后
21. `cycles` 为空时，循环依赖区块显示 `No circular dependencies detected.`，不生成空表
22. `fileStats` 为空（Go Atlas 模式）时，文件统计区块整体省略

### 回归

23. 现有所有测试通过（无回归）
24. `npm run type-check` 零错误

---

## 待解决的开放问题

| 问题 | 说明 | 建议处理时机 |
|------|------|------------|
| `index.md` 表格行数上限 | 大型项目可能有数百个文件，全部展示会使 `index.md` 过长 | 默认只展示 Top 30（按 inDegree）；提供 `--stats-top-n` 选项 |
| SCC 路径重建 | 当前输出成员集合，不输出具体路径（A→B→C→A）。重建需 BFS，但成员集合已够用 | 后续 enhancement；无阻塞当前实现 |
| 同一实体参与多个 SCC | Kosaraju 产生的 SCC 是分区（每个节点只属于一个 SCC），所以不存在重叠；但此处 `cycleCount` 计算基于文件粒度，一个文件的多个实体可分属不同 SCC | 文档中说明计数语义 |
| `inDegree` 跨 level 解读差异 | package 层的入度和 class 层的入度含义不同，不可比较 | 与现有 `level` 字段约束一致，文档标注 |
| LOC 精确化路径 | 需在各语言插件的解析阶段统计文件行数 | 独立 Proposal，当前近似值可接受 |
