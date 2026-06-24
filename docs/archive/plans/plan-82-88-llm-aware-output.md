# Plan 82-88 — LLM-Aware Output（查询格式自适应与粒度路由）

> Proposal: `docs/proposals/proposal-llm-aware-output.md`
> Status: **DRAFT**
> 承接实验: granularity-v2.2 (B4)、format-encoding-v1.1 (H1、H-dense)
> 涉及 ADR: ADR-006（MCP Tool 设计规范）、ADR-007（CLI/MCP 接口一致性）

---

## 总览

| Phase | 内容 | 依赖 | 预计改动量 |
|---|---|---|---|
| 82 | 基础设施：类型定义（含 shim re-export）+ `OutputScopeFilter` + `EdgeListSerializer` | 无 | ~288 行 |
| 83 | `QueryEngine` 集成：`getSummary()` 扩展 + D5 三个新字段 | Phase 82 | ~120 行 |
| 84 | `QueryEngine` 集成：查询方法接受 `outputScope`/`queryFormat` | Phase 82 | ~180 行 |
| 85 | CLI 集成：`query` 命令新增 flags + `formatSummary` 打印新字段 | Phase 84 | ~120 行 |
| 86 | MCP 集成：工具 schema + 路由表默认值 | Phase 84 | ~200 行 |
| 87 | 描述更新：ADR-006 合规工具描述 | Phase 86 | ~80 行 |
| 88 | 集成验证：端到端等价测试 + 覆盖率扫描 | Phase 82-87 | ~150 行测试 |

**总改动量估算**：约 1128 行（含测试，排除空行和注释头）。各 Phase ≤500 行，各 Stage ≤200 行。

**测试策略（TDD）**：每个 Phase 先写测试，再实现。目标覆盖率 ≥80%。使用 vitest，测试文件置于 `tests/unit/core/query/`（新模块）和相关现有目录。

---

## Phase 82 — 基础设施：类型定义 + 新模块骨架

**目标**：建立两个新核心模块（`OutputScopeFilter`、`EdgeListSerializer`）和类型定义，为后续 Phase 提供稳定接口。

**依赖**：无前置 Phase。

**新文件**：
- `src/core/query/output-scope-filter.ts`
- `src/core/query/edge-list-serializer.ts`

**修改文件**：
- `src/core/query/query-engine.ts`（仅新增类型导出，不改逻辑）
- `src/cli/query/query-engine.ts`（shim 追加 re-export 新类型，~8 行）

**测试文件**（先写）：
- `tests/unit/core/query/output-scope-filter.test.ts`
- `tests/unit/core/query/edge-list-serializer.test.ts`

---

### Stage 82.1 — 类型定义（~40 行）

**文件**：`src/core/query/query-engine.ts` 顶部新增导出

**内容**：

```typescript
// 新增类型（在现有 exports 之后）
export type OutputScope = 'package' | 'class' | 'method';
export type QueryOutputFormat = 'structured' | 'edge-list';

export interface QueryMethodOptions {
  outputScope?: OutputScope;
  queryFormat?: QueryOutputFormat;
}

// EdgeListSerializer 输出结构（与 experiments/format-encoding/renderers/json-edge-list.ts 对齐）
export interface EdgeListEntity {
  id: string;
  name: string;
  type: string;
  sourceFile: string;
  methods: Array<{
    name: string;
    params: Array<{ name: string; type: string }>;
    returnType: string;
  }>;
}

export interface EdgeListRelation {
  from: string;
  to: string;
  type: string;
}

export interface EdgeListOutput {
  entities: EdgeListEntity[];
  relations: EdgeListRelation[];
}
```

同时在 `src/cli/query/query-engine.ts`（shim）末尾追加 re-export，确保 `mcp-server.ts`
通过现有导入路径可访问新类型（~8 行）：

```typescript
export type {
  OutputScope,
  QueryOutputFormat,
  QueryMethodOptions,
  EdgeListEntity,
  EdgeListRelation,
  EdgeListOutput,
} from '@/core/query/query-engine.js';
```

**修改文件**：
- `src/core/query/query-engine.ts`（新增类型，~40 行）
- `src/cli/query/query-engine.ts`（shim 追加 re-export，~8 行）

**验收**：`npm run type-check` 通过；上述类型从 `src/core/query/query-engine.ts` 和
`src/cli/query/query-engine.ts`（shim）均可导出。

---

### Stage 82.2 — `OutputScopeFilter` 实现（~100 行）

**文件**：`src/core/query/output-scope-filter.ts`

**职责**：根据 `OutputScope` 裁减 Entity 字段，不改变原始 ArchJSON 数据（纯函数）。

**接口设计**：

```typescript
import type { Entity } from '@/types/index.js';
import type { OutputScope } from './query-engine.js';

/**
 * Project an Entity to the fields appropriate for the given OutputScope.
 *
 * - 'package': strip members[], keep identity + sourceLocation (file only)
 * - 'class':   strip members[], keep all structural fields (current default)
 * - 'method':  keep all fields including members[] with method signatures
 */
export function narrowEntity(entity: Entity, scope: OutputScope): Partial<Entity>;

/**
 * Project an array of entities.
 */
export function narrowEntities(entities: Entity[], scope: OutputScope): Partial<Entity>[];
```

**字段保留规范**：

| `outputScope` | 保留字段 | 裁减字段 |
|---|---|---|
| `'package'` | `id`, `name`, `type`, `sourceLocation.file` | `members[]`, `visibility`, `attributes`, `isAbstract` |
| `'class'` | `id`, `name`, `type`, `visibility`, `sourceLocation`, `isAbstract`, `attributes` | `members[]` |
| `'method'` | 全部字段（原样返回，不裁减） | — |

**测试要求（先写）**：`tests/unit/core/query/output-scope-filter.test.ts`

- `narrowEntity` / `package` scope：返回对象不含 `members` 键
- `narrowEntity` / `class` scope：返回对象不含 `members` 键，保留 `visibility`
- `narrowEntity` / `method` scope：返回对象与原 entity 相同（`===` 或深等价）
- 边界：`members` 为空数组时，`class` scope 仍不返回 `members`
- 边界：entity 无 `attributes` 字段时，`package` scope 不报错

**验收**：测试全绿；函数无副作用（不修改传入 entity）。

---

### Stage 82.3 — `EdgeListSerializer` 实现（~120 行）

**文件**：`src/core/query/edge-list-serializer.ts`

**职责**：将 Entity[] + Relation[] 序列化为 `EdgeListOutput`，格式与 `experiments/format-encoding/renderers/json-edge-list.ts` 产物一致。

**接口设计**：

```typescript
import type { Entity, Relation } from '@/types/index.js';
import type { OutputScope, EdgeListOutput } from './query-engine.js';

/**
 * Serialize entities and relations to flat json-edge-list format.
 *
 * @param entities  Already scope-filtered entities (from OutputScopeFilter)
 * @param relations Full relation list from ArchJSON
 * @param outputScope Controls whether methods[] is populated (only for 'method' scope)
 */
export function serialize(
  entities: Partial<Entity>[],
  relations: Relation[],
  outputScope: OutputScope
): EdgeListOutput;
```

**序列化规则**：

- `entities[].id`：`entity.id`
- `entities[].name`：`entity.name`
- `entities[].type`：`entity.type`
- `entities[].sourceFile`：`entity.sourceLocation?.file ?? 'unknown'`
- `entities[].methods`：当 `outputScope === 'method'` 时，从 `entity.members` 中过滤 `type === 'method' || type === 'constructor'`，映射为 `{ name, params: [{name, type}], returnType }`；否则为 `[]`
- `relations[].from`：`relation.from`
- `relations[].to`：`relation.to`
- `relations[].type`：`relation.type`

**测试要求（先写）**：`tests/unit/core/query/edge-list-serializer.test.ts`

- `outputScope='class'`：所有 entity 的 `methods` 字段为 `[]`
- `outputScope='method'`：entity 的 `methods` 包含正确的方法签名（name、params、returnType）
- `outputScope='method'`：`params` 内容映射正确（member.parameters[] → `{name, type}`）
- relations 映射：`from`/`to`/`type` 均正确
- `sourceFile` fallback：`sourceLocation` 缺失时输出 `'unknown'`
- 输出顶层结构：`{ entities: [...], relations: [...] }`（与实验 renderer 等价）
- `returnType` fallback：method 无 returnType 时输出 `'void'`

**验收**：测试全绿；`serialize` 是纯函数；与实验 `experiments/format-encoding/renderers/json-edge-list.ts` 的产物结构字节级等价（用同一 fixture 验证）。

---

## Phase 83 — `QueryEngine` 集成：`getSummary()` 扩展

**目标**：在 `getSummary()` 中新增三个字段（`relationCountByType`、`topByMethodCount`、`topByOutDegree`），消除 format-encoding 实验中的计数类"地板任务"。

**依赖**：Phase 82（类型定义 `OutputScope` 等已导出）。

**修改文件**：
- `src/core/query/query-engine.ts`（`getSummary()` 方法和返回类型）

**测试文件**（先写）：
- `tests/unit/core/query/query-engine-summary.test.ts`（新增；与现有 `query-engine.test.ts` 分文件避免超大测试文件）

---

### Stage 83.1 — `getSummary()` 返回类型扩展（~30 行）

**修改**：在 `src/core/query/query-engine.ts` 的 `getSummary()` 返回类型中新增三个字段：

```typescript
relationCountByType: Partial<Record<RelationType, number>>;
topByMethodCount: Array<{ name: string; methodCount: number }>;
topByOutDegree: Array<{ name: string; outDegree: number }>;
```

保持现有字段（`entityCount`、`relationCount`、`language`、`kind`、`topDependedOn`、`topDependedOnNote`、`capabilities`、`topPackages`、`totalPackageCount`）不变。

**验收**：`npm run type-check` 通过。

---

### Stage 83.2 — `getSummary()` 实现（~90 行）

**修改**：在 `QueryEngine.getSummary()` 方法体末尾，在 `return` 语句之前插入三段计算逻辑：

```typescript
// relationCountByType
const relationCountByType: Partial<Record<RelationType, number>> = {};
for (const [type, rels] of Object.entries(this.index.relationsByType)) {
  relationCountByType[type as RelationType] = rels.length;
}

// topByMethodCount（与 getPackageStats methodCount 计算逻辑一致：method + constructor）
const topByMethodCount = this.archJson.entities
  .map(e => ({
    name: this.index.idToName[e.id] ?? e.id,
    methodCount: (e.members ?? []).filter(
      m => m.type === 'method' || m.type === 'constructor'
    ).length,
  }))
  .sort((a, b) => b.methodCount - a.methodCount)
  .slice(0, 10);

// topByOutDegree（ArchIndex.dependencies 是 Record<string, string[]>，用 .length）
const topByOutDegree = this.archJson.entities
  .map(e => ({
    name: this.index.idToName[e.id] ?? e.id,
    outDegree: (this.index.dependencies[e.id] ?? []).length,
  }))
  .sort((a, b) => b.outDegree - a.outDegree)
  .slice(0, 10);
```

**测试要求（先写）**：`tests/unit/core/query/query-engine-summary.test.ts`

- `relationCountByType`：给定含已知 `inheritance` 和 `composition` 关系的 fixture，
  返回值中各类型计数与 fixture 数量一致
- `relationCountByType`：无关系时返回空对象 `{}`
- `topByMethodCount`：按 methodCount 降序，至多 10 条
- `topByMethodCount`：methodCount = 0 的实体仍参与排序（不过滤）
- `topByMethodCount`：`constructor` 类型 member 计入 methodCount
- `topByOutDegree`：按 outDegree 降序，至多 10 条
- `topByOutDegree`：与 `topDependedOn`（入度）数据源不同（不混淆）
- 现有字段（`entityCount`、`relationCount` 等）在扩展后仍正确返回（回归测试）

**验收**：测试全绿；`npm run type-check` 通过；运行 `npm test` 现有 2787 个测试不减少。

---

## Phase 84 — `QueryEngine` 集成：查询方法接受 options

**目标**：为 `QueryEngine` 中所有面向实体的查询方法新增可选的 `options?: QueryMethodOptions` 参数，在返回前调用 `OutputScopeFilter` 和/或 `EdgeListSerializer`。

**依赖**：Phase 82（`OutputScopeFilter`、`EdgeListSerializer`、类型定义已就绪）。

**修改文件**：
- `src/core/query/query-engine.ts`

---

### Stage 84.1 — 辅助方法 `applyOutputOptions`（~50 行）

**在 `QueryEngine` 中新增私有辅助方法**：

```typescript
private applyOutputOptions(
  entities: Entity[],
  relations: Relation[],
  options?: QueryMethodOptions
): Entity[] | Partial<Entity>[] | EdgeListOutput {
  const scope = options?.outputScope ?? 'class';
  const format = options?.queryFormat ?? 'structured';

  const narrowed = narrowEntities(entities, scope);
  if (format === 'edge-list') {
    return serialize(narrowed, relations, scope);
  }
  return narrowed;
}
```

**注意**：
- `outputScope='method'` 时 `narrowEntities` 返回原始 entity（不裁减），
  `applyOutputOptions` 返回 `Entity[]`（等价于现有 verbose=true 行为）
- `outputScope='class'`（默认）时返回 `Partial<Entity>[]`（无 members，等价于现有 summary 视图）
- 关系列表从 `this.archJson.relations` 取（不需要从方法参数传入）

**验收**：`npm run type-check` 通过；私有方法有 JSDoc 注释说明 scope 优先级。

---

### Stage 84.2 — 查询方法 options 参数（~130 行）

为以下 9 个公开方法添加可选 `options?: QueryMethodOptions` 末参数：

1. `findEntity(name: string, options?)` 
2. `getDependencies(entityName: string, depth?: number, options?)`
3. `getDependents(entityName: string, depth?: number, options?)`
4. `findImplementers(interfaceName: string, options?)`
5. `findSubclasses(className: string, options?)`
6. `getFileEntities(filePath: string, options?)`
7. `findByType(entityType: string, options?)`
8. `findByAttr(key: string, value?, options?)`
9. `findByTypeAndAttr(entityType: string, attrKey?, attrValue?, options?)`

每个方法在计算完原始 `Entity[]` 后，调用 `this.applyOutputOptions(entities, this.archJson.relations, options)` 并返回其结果。

**向后兼容**：`options` 为可选参数，默认值 `undefined` → scope=`'class'`，format=`'structured'`，行为与现有完全一致（现有调用方无需修改）。

**测试要求**（在现有 `tests/unit/core/query/query-engine.test.ts` 中新增分组）：

- `findEntity` 传 `outputScope='method'`：返回结果含 `members` 字段
- `findEntity` 传 `outputScope='class'`（默认）：返回结果不含 `members` 字段（等价于原 `toSummary` 行为）
- `getDependencies` 传 `queryFormat='edge-list'`：返回 `EdgeListOutput` 结构 `{ entities, relations }`
- `getDependencies` 传 `outputScope='method'` + `queryFormat='edge-list'`：返回 edge-list 且 methods[] 非空
- 不传 options：返回结果与现有行为完全相同（回归测试）

**验收**：测试全绿；现有 2787 个测试不减少；`findHighCoupling`、`findOrphans`、`findInCycles` 暂不添加 options（这三个方法返回值在 MCP/CLI 层不经过 options 处理，见 Phase 86 说明）。

---

## Phase 85 — CLI 集成：`query` 命令新增 flags

**目标**：在 `src/cli/commands/query.ts` 的 `createQueryCommand()` 中新增 `--output-scope` 和 `--query-format` 两个 flag，并在 `queryHandler` 中将其传入 QueryEngine 方法 options。

**依赖**：Phase 84（`QueryMethodOptions` 类型和 QueryEngine 方法签名已更新）。

**修改文件**：
- `src/cli/commands/query.ts`

---

### Stage 85.1 — flag 声明（~30 行）

在 `QueryOptions` 接口中新增：

```typescript
outputScope?: string;   // 'package' | 'class' | 'method'
queryFormat?: string;   // 'structured' | 'edge-list'
```

在 `createQueryCommand()` 的 option 链中新增：

```
.option('--output-scope <scope>', 'Output granularity: package|class|method (default: class)')
.option('--query-format <format>', 'Output format: structured|edge-list (default: structured)')
```

**验收**：`node dist/cli/index.js query --help` 输出含两个新 flag。

---

### Stage 85.2 — handler 中 options 解析与传递（~70 行）

在 `validateQueryOptions` 中新增枚举校验：

```typescript
const validScopes = ['package', 'class', 'method'];
const validFormats = ['structured', 'edge-list'];
if (opts.outputScope && !validScopes.includes(opts.outputScope)) {
  throw new Error(`Invalid --output-scope: "${opts.outputScope}". Expected: ${validScopes.join('|')}.`);
}
if (opts.queryFormat && !validFormats.includes(opts.queryFormat)) {
  throw new Error(`Invalid --query-format: "${opts.queryFormat}". Expected: ${validFormats.join('|')}.`);
}
```

在 `queryHandler` 中构建 `queryOptions`：

```typescript
const queryOptions: QueryMethodOptions = {
  outputScope: (opts.outputScope as OutputScope) ?? 'class',
  queryFormat: (opts.queryFormat as QueryOutputFormat) ?? 'structured',
};
```

将所有 `engine.findEntity(...)` / `engine.getDependencies(...)` 等调用改为传入 `queryOptions`：

```typescript
// 示例（修改前）
const entities = engine.findEntity(opts.entity);
// 修改后
const entities = engine.findEntity(opts.entity, queryOptions);
```

**注意**：`--verbose` 标志现有行为保留不变。当 `--output-scope=method` 时，QueryEngine 内部已处理（返回完整 entity），CLI 层无需额外处理。

**测试要求**（在 `tests/unit/cli/commands/query.test.ts` 中新增分组）：

- `validateQueryOptions`：`--output-scope=invalid` 抛出有意义错误
- `validateQueryOptions`：`--query-format=invalid` 抛出有意义错误
- `validateQueryOptions`：合法值 `package`/`class`/`method`/`structured`/`edge-list` 不抛出
- 集成路径：传入 `--output-scope=method` 时，`queryOptions.outputScope === 'method'`

**验收**：测试全绿；`npm run type-check` 通过。

---

### Stage 85.3 — `formatSummary` 打印新字段（~20 行）

**背景**：`formatSummary()` 当前只打印 `language`、`kind`、`entityCount`、`relationCount`、
`topDependedOn`。Phase 83 扩展了 `getSummary()` 的返回值，但 `formatSummary` 是静态
`ReturnType<>` 类型推导，TypeScript 不会报错——新字段会被静默忽略，
导致 Phase 88 验收标准 `query --summary` 输出含 `relationCountByType` 无法通过。

**修改**：在 `formatSummary()` 函数末尾追加打印三个新字段：

```typescript
if (Object.keys(summary.relationCountByType).length > 0) {
  console.log('\n  Relations by type:');
  for (const [type, count] of Object.entries(summary.relationCountByType)) {
    console.log(`    ${type}: ${count}`);
  }
}
if (summary.topByMethodCount.length > 0) {
  console.log('\n  Top by method count:');
  for (const item of summary.topByMethodCount) {
    console.log(`    ${item.name}: ${item.methodCount} methods`);
  }
}
if (summary.topByOutDegree.length > 0) {
  console.log('\n  Top by out-degree:');
  for (const item of summary.topByOutDegree) {
    console.log(`    ${item.name}: ${item.outDegree} deps`);
  }
}
```

> **注**：`--format=json` 路径（`result = summary`）自动包含新字段，无需额外处理。

**验收**：`node dist/cli/index.js query --summary --format=json` 输出含 `relationCountByType`；
`node dist/cli/index.js query --summary`（非 JSON 模式）打印 "Relations by type:" 段落。

---

## Phase 86 — MCP 集成：工具 schema + 路由表默认值

**目标**：在 `src/cli/mcp/mcp-server.ts` 的 `registerTools()` 中，为 9 个 ArchJSON 查询工具添加 `outputScope` / `queryFormat` 参数，并按路由表设置各工具的不同默认值。

**依赖**：Phase 84（`QueryEngine` 方法支持 options）。

**修改文件**：
- `src/cli/mcp/mcp-server.ts`

**不修改**：
- `src/cli/mcp/tools/git-history-tools.ts`（git 历史工具不适用，见 Proposal P1）
- `archguard_get_atlas_layer` 工具（已有 `format` 参数，见 Proposal P2）

---

### Stage 86.1 — 共享参数定义（~40 行）

在 `mcp-server.ts` 文件顶部（`verboseParam` 定义附近）新增：

```typescript
function outputScopeParam(defaultScope: OutputScope = 'class') {
  return z
    .enum(['package', 'class', 'method'])
    .default(defaultScope)
    .describe(
      'Output granularity: "package" (package-level only), ' +
      '"class" (entity-level, no members, default), ' +
      '"method" (full entity with method signatures). ' +
      'edge-list format recommended for LLM reasoning ' +
      '(+38pp vs mermaid, format-encoding experiment, n=14 tasks).'
    );
}

const queryFormatParam = z
  .enum(['structured', 'edge-list'])
  .default('structured')
  .describe(
    'Output format: "structured" (nested JSON objects, default) or ' +
    '"edge-list" (flat { entities[], relations[] } — best for LLM reasoning).'
  );
```

**验收**：`npm run type-check` 通过；`OutputScope` 从 `../query/query-engine.js`（即 shim）导入，无循环依赖。

---

### Stage 86.2 — 工具 schema 更新（~160 行）

按路由表为 9 个工具添加参数，各工具的 `outputScope` 默认值不同：

| 工具 | 默认 `outputScope` | 理由 |
|---|---|---|
| `archguard_summary` | `package` | 概览任务；class 级是噪声 |
| `archguard_get_package_stats` | `package` | 统计任务；同上 |
| `archguard_find_entity` | `class` | 实体查找；class 级完整 |
| `archguard_get_file_entities` | `class` | 同上 |
| `archguard_get_dependencies` | `method` | 关系推理；B 类 18/22；暴露 members[] |
| `archguard_get_dependents` | `method` | 同上 |
| `archguard_find_subclasses` | `class` | 继承关系 class 级即完整 |
| `archguard_find_implementers` | `class` | 同上 |
| `archguard_detect_cycles` | `class` | 环路检测不需要方法签名 |

**每个工具 schema** 在现有参数后追加：

```typescript
outputScope: outputScopeParam('<default-for-this-tool>'),
queryFormat: queryFormatParam,
```

**handler 修改**：在各工具的 handler 函数中，将 `outputScope` / `queryFormat` 封装为 `QueryMethodOptions` 传给 QueryEngine 调用。对于 `archguard_summary`（不接受 options），不传这两个参数（summary 的 outputScope 在 Phase 83 中独立处理）。

**测试要求**（在 `tests/unit/cli/mcp/mcp-server.test.ts` 中新增分组）：

- `archguard_get_dependencies` schema：`outputScope` 参数默认值为 `'method'`
- `archguard_summary` schema：`outputScope` 参数默认值为 `'package'`
- `archguard_find_entity` schema：`outputScope` 枚举包含 `['package', 'class', 'method']`
- `queryFormat` 参数：非法值 `'invalid'` 触发 zod 校验错误
- handler 集成：`outputScope='method'` 传递到 QueryEngine（mock engine 验证调用参数）

**验收**：测试全绿；`npm run type-check` 通过；MCP 工具注册数量不变（仍 10 个核心工具）。

---

## Phase 87 — 描述更新：ADR-006 合规

**目标**：按 ADR-006 §2.3 更新受影响工具的描述字符串，内联粒度声明和"优先调用"语义。

**依赖**：Phase 86（工具参数已更新，描述需与参数对应）。

**修改文件**：
- `src/cli/mcp/mcp-server.ts`（工具描述字符串）

**不需要新文件或测试**（描述更新无逻辑，通过人工 review 和 snapshot 验证）。

---

### Stage 87.1 — 关键工具描述更新（~80 行）

按 Proposal 决策 4 更新以下 4 个工具的 description 参数（第 2 个位置参数）：

**`archguard_summary`**：
```
"Return pre-computed architecture statistics: exact entity/relation counts
 (no graph enumeration needed), relation breakdown by type, top-N entities by
 in-degree / out-degree / method count.
 ALWAYS call this tool first for any counting or ranking query — do NOT attempt
 to enumerate or count items from other tool outputs.
 Default outputScope=package (L1 granularity); for method-level detail call
 archguard_get_dependencies."
```

**`archguard_get_dependencies`**：
```
"Return direct and transitive class-level dependency graph with method
 signatures (outputScope=method by default); call graph edges
 (method→method calls) are not included — only class-level structural
 relations. For Go package-level dependencies use archguard_get_atlas_layer."
```

**`archguard_get_dependents`**：
```
"Return entities that depend on the named entity, with method signatures
 (outputScope=method by default). For Go package-level reverse dependencies
 use archguard_get_atlas_layer."
```

**`archguard_get_package_stats`**：
```
"Get per-package volume metrics (file count, entity count, approximate line
 count) sorted and filtered by threshold. Returns package-level data only
 (outputScope=package by default); entity-level detail is stripped."
```

其余 5 个工具（`archguard_find_entity`、`archguard_get_file_entities`、
`archguard_find_subclasses`、`archguard_find_implementers`、`archguard_detect_cycles`）
在现有描述末尾追加：`" Use outputScope param to control result granularity."`

**验收**：`grep -c 'outputScope' src/cli/mcp/mcp-server.ts` 出现在 ≥9 个工具的 description 中；`npm run type-check` 通过。

---

## Phase 88 — 集成验证：端到端等价测试

**目标**：验证 CLI 和 MCP 在相同 fixture + 相同 options 下产物等价；扫描测试覆盖率。

**依赖**：Phase 82-87 全部完成。

**新增测试文件**：
- `tests/unit/core/query/cli-mcp-parity.test.ts`

---

### Stage 88.1 — CLI/MCP 等价快照测试（~100 行）

**测试场景**（使用 `tests/fixtures/` 中的现有 ArchJSON fixture，或新增最小 fixture）：

1. **outputScope parity**：
   - 相同 fixture + `outputScope='method'` → CLI handler 和 MCP handler 返回相同 payload
   - 相同 fixture + `outputScope='package'` → 两侧返回值不含 `members` 且不含 `visibility`

2. **edge-list parity**：
   - 相同 fixture + `queryFormat='edge-list'` → 返回值顶层结构为 `{ entities, relations }`
   - edge-list entities 的 `sourceFile` 字段不含 `undefined`（fallback 为 `'unknown'`）

3. **默认行为回归**：
   - 不传 options → 返回结果与修改前行为字节级等价（使用 snapshot）

**测试实现方式**：直接实例化 `QueryEngine`（不需要 CLI 进程或 MCP 服务器进程），传入 mock ArchJSON + ArchIndex，分别调用引擎方法，对比结果。MCP handler 层通过 mock 的 `loadEngine` 验证参数透传。

---

### Stage 88.2 — 覆盖率扫描（~50 行测试）

**目标**：确认 Phase 82-87 引入的新代码覆盖率 ≥80%。

```bash
npm run test:coverage -- --reporter=text 2>&1 | grep -E 'output-scope-filter|edge-list-serializer|query-engine'
```

若覆盖率不足，补充边界测试（`members` 包含 `constructor` 类型、`outputScope` 默认值路径、`queryFormat` 两个值的分支）。

**最终验收标准（Phase 88 门控）**：

- [ ] `npm test` 全绿，测试总数 ≥ 2787 + Phase 82-88 新增数量
- [ ] `npm run type-check` 零错误
- [ ] `npm run lint` 零 error（warning 可接受）
- [ ] `npm run build` 成功
- [ ] `node dist/cli/index.js query --summary` 输出含 `relationCountByType` 字段（需 Stage 85.3）
- [ ] `node dist/cli/index.js query --summary` 输出含 `topByMethodCount` 字段（需 Stage 85.3）
- [ ] `node dist/cli/index.js query --summary --format=json` 输出 JSON 含 `relationCountByType`/`topByMethodCount`/`topByOutDegree` 三个字段
- [ ] `node dist/cli/index.js query --entity <name> --output-scope=method` 输出含 `members` 字段
- [ ] `node dist/cli/index.js query --entity <name> --query-format=edge-list` 输出 `{ entities, relations }` 顶层结构
- [ ] MCP schema 中 `archguard_get_dependencies` 的 `outputScope` 默认值为 `'method'`
- [ ] MCP schema 中 `archguard_summary` 的 `outputScope` 默认值为 `'package'`
- [ ] `src/cli/query/query-engine.ts`（shim）已追加 re-export `OutputScope`、`QueryMethodOptions`、`QueryOutputFormat`、`EdgeListOutput`（Stage 82.1 执行后）

---

## 依赖关系图

```
Phase 82 (类型 + OutputScopeFilter + EdgeListSerializer)
    │
    ├──→ Phase 83 (getSummary 扩展)   [可与 84 并行]
    │
    └──→ Phase 84 (QueryEngine 方法 options)
              │
              ├──→ Phase 85 (CLI flags)
              │
              └──→ Phase 86 (MCP schema)
                        │
                        └──→ Phase 87 (工具描述)
                                  │
                                  └──→ Phase 88 (集成验证)
```

**可并行执行**：Phase 83 和 Phase 84 均依赖 Phase 82，但两者之间无依赖，可并行开发。

---

## 测试文件清单

| 文件 | Phase | 类型 |
|---|---|---|
| `tests/unit/core/query/output-scope-filter.test.ts` | 82 | 新增（unit） |
| `tests/unit/core/query/edge-list-serializer.test.ts` | 82 | 新增（unit） |
| `tests/unit/core/query/query-engine-summary.test.ts` | 83 | 新增（unit） |
| `tests/unit/core/query/query-engine.test.ts` | 84 | 扩展现有文件（新增分组） |
| `tests/unit/cli/commands/query.test.ts` | 85 | 扩展现有文件（新增分组） |
| `tests/unit/cli/mcp/mcp-server.test.ts` | 86 | 扩展现有文件（新增分组） |
| `tests/unit/core/query/cli-mcp-parity.test.ts` | 88 | 新增（集成快照） |

---

## 改动量汇总

| Phase | 主要修改文件 | 新增测试文件 | 估计改动行数 |
|---|---|---|---|
| 82.1 | `src/core/query/query-engine.ts`（类型）+ `src/cli/query/query-engine.ts`（shim） | — | ~40 + ~8 |
| 82.2 | `src/core/query/output-scope-filter.ts`（新） | `output-scope-filter.test.ts`（新） | ~100 + ~60 |
| 82.3 | `src/core/query/edge-list-serializer.ts`（新） | `edge-list-serializer.test.ts`（新） | ~120 + ~80 |
| 83 | `src/core/query/query-engine.ts`（getSummary） | `query-engine-summary.test.ts`（新） | ~90 + ~80 |
| 84 | `src/core/query/query-engine.ts`（方法 options） | `query-engine.test.ts`（扩展） | ~180 + ~60 |
| 85 | `src/cli/commands/query.ts`（flags + handler + formatSummary） | `query.test.ts`（扩展） | ~120 + ~40 |
| 86 | `src/cli/mcp/mcp-server.ts`（schema） | `mcp-server.test.ts`（扩展） | ~200 + ~60 |
| 87 | `src/cli/mcp/mcp-server.ts`（描述） | — | ~80 |
| 88 | — | `cli-mcp-parity.test.ts`（新） | ~150 |
| **合计** | | | **~1128 行** |

各 Phase 均 ≤500 行，各 Stage 均 ≤200 行，满足约束。

---

## 向后兼容保证

1. 所有新参数均为可选（`options?: QueryMethodOptions`），默认值与当前行为等价。
2. `src/cli/query/query-engine.ts`（shim）仅追加 re-export 新类型（Stage 82.1），
   不删除任何现有 export；现有调用方的 import 路径不变，无破坏性修改。
3. `verbose` 参数保留不变，与 `outputScope` 独立共存（`outputScope='method'` 优先于 `verbose=false`）。
4. MCP 工具现有参数（`projectRoot`、`scope`、`verbose`、`depth` 等）不修改，新增参数在末尾追加。
5. CLI `query` 命令现有 flag 不修改，新增 `--output-scope` / `--query-format` 在末尾。

---

## 遗留问题追踪

| ID | 描述 | 处理方式 |
|---|---|---|
| P1 | git 历史 4 个工具不支持 outputScope/queryFormat | 不实施；路由表标注"不适用" |
| P2 | `archguard_get_atlas_layer` 已有 `format` 参数与 queryFormat 语义重叠 | 不添加 queryFormat；维持现有 `format` 参数 |
| P3 | `externalDependencies` 暴露（direct-deps-0 地板任务） | 不在本 plan 范围；建议作为后续小增量 |
