# Plan 96-100 — Architecture Cleanup（QueryEngine 分解、src/cli 整理、FIM 清除）

> Proposal: `docs/proposals/proposal-architecture-cleanup.md`
> Status: **DRAFT**
> 前置依赖: Plan 89-95（`filterRelationsForScope` 已在 `query-engine.ts` 实现，`OutputScope` 类型已稳定）
> 涉及文件: `src/core/query/query-engine.ts`（999 行）、`src/cli/` 根目录散件、`src/analysis/fim/`

---

## 总览

| Phase | 内容 | 依赖 | 预计改动量 |
|---|---|---|---|
| 96 | QueryEngine → ArchMetrics 提取；`filterRelationsForScope` 移至 `output-scope-filter.ts` | 无 | ~480 行 |
| 97 | Move A：`progress.ts` → `src/cli/progress/index.ts` + 6 个 import 路径更新 | 无 | ~30 行 |
| 98 | Move B：`cache-manager.ts` → `src/cli/cache/cache-manager.ts` + 1 个 import 更新 | 无 | ~5 行 |
| 99 | Move C：`errors.ts` + `error-handler.ts` → `src/cli/errors/index.ts`（barrel）+ import 更新 | 无 | ~20 行 |
| 100 | FIM 模块删除（Option B）：删除 `src/analysis/fim/` 及对应测试 | 无 | ~-1500 行 |

**总改动量估算**：约 535 行新增/修改，约 1500 行净删除（Phase 100）。各 Phase ≤500 行，各 Stage ≤200 行。

**测试策略（TDD）**：
- Phase 96：先写 `arch-metrics.test.ts`（覆盖全部 7 个提取方法），再迁移实现，最后验证 `query-engine.test.ts` 回归全绿。
- Phase 97/98/99：文件移动，无新业务逻辑，测试策略以 `npm run type-check` + 全套回归测试为主；不需要新增业务逻辑测试。
- Phase 100：删除 `tests/unit/analysis/fim/` 下的全部测试文件，确认无遗留引用。

**覆盖率目标**：Phase 96 新增文件 `arch-metrics.ts` 覆盖率 ≥80%（由迁移自现有 `query-engine.test.ts` 的测试 + 新增 `arch-metrics.test.ts` 保证）。

**各 Phase 互相独立**：Phase 97/98/99/100 之间无依赖，可并行执行。Phase 96 对其他 Phase 无依赖，但建议最先执行以减少 `query-engine.ts` 的方法列表对后续理解的干扰。

---

## Phase 96 — QueryEngine → ArchMetrics 提取

**目标**：将 `query-engine.ts`（999 行）的 metrics 方法群提取到独立 `ArchMetrics` 类；将已在 `query-engine.ts` 中的私有方法 `filterRelationsForScope` 移为 `output-scope-filter.ts` 的具名导出；`QueryEngine` 缩减至 ≤580 行并通过 delegation wrapper 保持公开 API 不变。

**依赖**：无前置 Phase。

**修改文件**：
- `src/core/query/arch-metrics.ts`（**新建**，~430 行）
- `src/core/query/query-engine.ts`（迁出 metrics cluster，收缩 ~430 行 → ≤580 行）
- `src/core/query/output-scope-filter.ts`（追加 `filterRelationsForScope` 具名导出，~30 行）
- `src/core/query/index.ts`（追加 `export * from './arch-metrics.js'`）

**测试文件（先写）**：
- `tests/unit/core/query/arch-metrics.test.ts`（**新增**，覆盖 7 个公开方法）

---

### Stage 96.1 — 新建 `arch-metrics.ts` + 测试（~200 行）

**测试先行**：先创建 `tests/unit/core/query/arch-metrics.test.ts`，覆盖以下 7 个方法：

```
getSummary()
getPackageStats(depth?, topN?)
getPackageCoverage()
getEntityCoverage(entityId)
findHighCoupling(threshold?)
findOrphans()
findInCycles()
```

测试 fixture 复用 `tests/unit/core/query/query-engine.test.ts` 中的 `ArchJSON` + `ArchIndex` 构造模式。每个方法至少一个 happy-path 测试 + 一个边界测试（空数据集）。

**修改**：新建 `src/core/query/arch-metrics.ts`，包含：

```typescript
/**
 * ArchMetrics — package-level and entity-level metrics computed over an ArchJSON scope.
 *
 * Stateless with respect to query routing; depends only on (ArchJSON, ArchIndex).
 * Extracted from QueryEngine (was ~450 lines of the god class).
 */
export class ArchMetrics {
  constructor(
    private readonly archJson: ArchJSON,
    private readonly index: ArchIndex
  ) {}

  getSummary(): { entityCount: number; relationCount: number; ... } { ... }
  getPackageStats(depth?: number, topN?: number): PackageStatsResult { ... }
  getPackageCoverage(): PackageCoverage[] { ... }
  getEntityCoverage(entityId: string): { ... } { ... }
  findHighCoupling(threshold?: number): Entity[] { ... }
  findOrphans(): Entity[] { ... }
  findInCycles(): Entity[] { ... }

  // private helpers（不对外暴露，不需要 delegation wrapper）
  private getKotlinPackageStats(topN?: number): PackageStatsResult { ... }
  private aggregateEntityMetrics(packagePrefix: string): { ... } { ... }
  private buildTestPattern(): RegExp { ... }
}
```

**迁移内容**（从 `query-engine.ts` 剪切）：
- `getSummary()`（行 190–237）
- `getPackageCoverage()`（行 467–509）
- `getEntityCoverage()`（行 510–566）
- `getPackageStats()`（行 567–718）
- `getKotlinPackageStats()`（行 719–805 private helper）
- `findHighCoupling()`（行 345–353）
- `findOrphans()`（行 354–362）
- `findInCycles()`（行 363–376）
- `aggregateEntityMetrics()`（行 823–863 private helper）
- `buildTestPattern()`（行 864–998 private helper）

**导出接口**（从 `query-engine.ts` 随方法一同迁移，`query-engine.ts` 以 re-export 形式保持向后兼容）：
- `PackageStatEntry`
- `PackageStatMeta`
- `PackageStatsResult`

**`EntitySummary` 留在 `query-engine.ts`**：它是 `toSummary()` 的返回类型，属于实体投影层，不随 metrics 迁移。

**`getSummary()` 内部调用**：该方法在行 238 调用 `this.getPackageStats(3)`——迁移后变为 `this.getPackageStats(3)`（同类内调用，无需修改签名）。

**验收**：`tests/unit/core/query/arch-metrics.test.ts` 全绿；`npm run type-check` 通过。

---

### Stage 96.2 — `filterRelationsForScope` 移至 `output-scope-filter.ts`（~50 行）

**背景**：`filterRelationsForScope`（行 402–433）目前是 `query-engine.ts` 的私有方法，由 `applyOutputOptions` 调用。Proposal 要求将其移为 `output-scope-filter.ts` 的具名导出，使三个输出整形关切（`narrowEntities`、`filterRelationsForScope`、`serialize`）集中在专用文件中。

**修改**：`src/core/query/output-scope-filter.ts`，追加具名导出：

```typescript
/**
 * Filter/transform relations based on the output scope.
 *
 * - scope='package': remove all call edges (method-level noise at package view)
 * - scope='class': aggregate call edges into dependency edges; pairs already covered
 *   by an existing dependency relation are NOT duplicated
 * - scope='method': preserve all relations including call edges
 */
export function filterRelationsForScope(relations: Relation[], scope: OutputScope): Relation[] {
  // ← 直接从 query-engine.ts 行 402-433 复制实现
}
```

**修改**：`src/core/query/query-engine.ts`，在 `applyOutputOptions` 中将私有方法调用改为导入调用：

```typescript
import { narrowEntities, filterRelationsForScope } from './output-scope-filter.js';
// ...
// applyOutputOptions 中原 this.filterRelationsForScope(...) 改为：
const filteredRelations = filterRelationsForScope(this.archJson.relations, scope);
```

删除 `query-engine.ts` 中的私有方法 `filterRelationsForScope`（行 402–433）。

**测试**：`tests/unit/core/query/output-scope-filter.test.ts` 中已有 `narrowEntities` 测试——扩展此文件，增加 `filterRelationsForScope` 的测试分组（scope='package'、'class'、'method' 三条 happy-path + 空数组边界）。不新建文件。

**验收**：`npm run type-check` 通过；`tests/unit/core/query/output-scope-filter.test.ts` 全绿。

---

### Stage 96.3 — `QueryEngine` delegation wrappers + `index.ts` 更新（~80 行）

**修改**：`src/core/query/query-engine.ts`：

1. 新增 `private readonly metrics: ArchMetrics` 字段，在构造函数中初始化（只传 `archJson` 和 `archIndex`，**不传 `scopeEntry`**）：

   ```typescript
   import { ArchMetrics } from './arch-metrics.js';
   // ...
   private readonly metrics: ArchMetrics;
   constructor(options: QueryEngineOptions) {
     this.archJson   = options.archJson;
     this.index      = options.archIndex;
     this.scopeEntry = options.scopeEntry;
     this.metrics    = new ArchMetrics(options.archJson, options.archIndex);
   }
   ```

2. 添加 7 个 delegation wrapper（每个单行委托）：

   ```typescript
   getSummary()                           { return this.metrics.getSummary(); }
   getPackageStats(depth?, topN?)         { return this.metrics.getPackageStats(depth, topN); }
   getPackageCoverage()                   { return this.metrics.getPackageCoverage(); }
   getEntityCoverage(entityId: string)    { return this.metrics.getEntityCoverage(entityId); }
   findHighCoupling(threshold?: number)   { return this.metrics.findHighCoupling(threshold); }
   findOrphans()                          { return this.metrics.findOrphans(); }
   findInCycles()                         { return this.metrics.findInCycles(); }
   ```

3. `toSummary(entity: Entity): EntitySummary` **留在 `QueryEngine`**（实体投影 helper，不迁移）。

4. Re-export 迁移走的接口（使现有 import 路径不变）：

   ```typescript
   export type { PackageStatEntry, PackageStatMeta, PackageStatsResult } from './arch-metrics.js';
   ```

**修改**：`src/core/query/index.ts`，追加：

```typescript
export * from './arch-metrics.js';
```

**验收标准**：
- `src/core/query/query-engine.ts` 行数 ≤580
- `npm run type-check` 零错误
- `npm test` 全绿（现有 `query-engine.test.ts`、`query-engine-summary.test.ts`、`call-edge-filter.test.ts`、`find-callers.test.ts`、`cli-mcp-parity.test.ts` 等回归通过）
- `src/cli/commands/query.ts`、`src/cli/mcp/mcp-server.ts`、`src/cli/mcp/tools/test-analysis-tools.ts`、`src/cli/processors/diagram-pipeline-runner.ts` 等调用方零修改（delegation wrappers 保持 API 稳定）
- `src/cli/query/query-engine.ts`（shim）零修改

---

## Phase 97 — Move A：progress.ts → src/cli/progress/index.ts

**目标**：消除 `src/cli/` 根目录中最大的散件（254 行，5 个导出符号），并入已存在的 `src/cli/progress/` 子目录。

**依赖**：无前置 Phase。Phase 97/98/99 彼此独立，可并行。

**关键约束**：`"moduleResolution": "node"` 不会将 `.js` 后缀的 import 自动重定向到目录 `index.ts`。所有 6 个 importer 的 import 路径**必须**手动更新，无例外。

**修改文件**：

| 文件 | 变更 |
|------|------|
| `src/cli/progress/index.ts` | **新建**（内容来自 `src/cli/progress.ts`，完整移植） |
| `src/cli/progress.ts` | **删除** |
| `src/cli/mcp/analyze-tool.ts` | `'../progress.js'` → `'../progress/index.js'`（从 `src/cli/mcp/` 相对路径，`progress/` 在上一层 `src/cli/progress/`） |
| `src/cli/analyze/run-analysis.ts` | `'../progress.js'` → `'../progress/index.js'` |
| `src/cli/commands/analyze.ts` | `'../progress.js'` → `'../progress/index.js'` |
| `src/cli/processors/diagram-processor.ts` | `'@/cli/progress.js'` → `'@/cli/progress/index.js'` |
| `src/cli/processors/diagram-output-router.ts` | `'@/cli/progress.js'` → `'@/cli/progress/index.js'` |
| `src/cli/processors/diagram-pipeline-runner.ts` | `'@/cli/progress.js'` → `'@/cli/progress/index.js'` |

**注意**：`src/mermaid/progress.ts` 是独立的 mermaid 模块进度报告（`IProgressReporter`/`NoopProgressReporter`），与 `src/cli/progress.ts` 无关，**不受影响**。

**测试策略**：无新业务逻辑，无需新增测试。验证手段：
- `npm run type-check` 零错误（漏改任何路径会在此暴露）
- `npm test` 全套回归（确认无运行时 import 断裂）

**向后兼容**：`ProgressReporter`、`StderrReporter`、`NoopReporter`、`ProgressReporterLike`、`Stage`、`ProgressSummary` 的导出符号名称不变；只有 import 路径变更。

**验收标准**：
- `src/cli/progress.ts` 不存在
- `src/cli/progress/index.ts` 存在，包含原文件全部导出
- `npm run type-check` 零错误
- `npm test` 全绿

---

## Phase 98 — Move B：cache-manager.ts → src/cli/cache/cache-manager.ts

**目标**：将 `src/cli/cache-manager.ts`（261 行，`CacheManager` 类）移入已存在的 `src/cli/cache/` 子目录，与 `arch-json-disk-cache.ts`、`diagram-manifest.ts`、`render-hash-cache.ts` 并列。

**依赖**：无前置 Phase。

**修改文件**：

| 文件 | 变更 |
|------|------|
| `src/cli/cache/cache-manager.ts` | **新建**（内容来自 `src/cli/cache-manager.ts`，完整移植） |
| `src/cli/cache-manager.ts` | **删除** |
| `src/cli/commands/cache.ts` | `'../cache-manager.js'` → `'../cache/cache-manager.js'`（1 行） |

**命名冲突检查**：`src/cli/cache/` 已有 `arch-json-disk-cache.ts`、`diagram-manifest.ts`、`render-hash-cache.ts`，无 `cache-manager.ts`——无冲突。

**测试策略**：无新业务逻辑。
- `npm run type-check` 零错误
- `npm test` 全套回归

**验收标准**：
- `src/cli/cache-manager.ts` 不存在
- `src/cli/cache/cache-manager.ts` 存在
- `npm run type-check` 零错误
- `npm test` 全绿

---

## Phase 99 — Move C：errors.ts + error-handler.ts → src/cli/errors/index.ts

**目标**：将 `src/cli/errors.ts`（48 行）和 `src/cli/error-handler.ts`（202 行）合并为 `src/cli/errors/` 子目录下的单一 barrel 入口，保留 `ParseError` 的 re-export 链。

**依赖**：无前置 Phase。

**修改文件**：

| 文件 | 变更 |
|------|------|
| `src/cli/errors/` | **新建目录** |
| `src/cli/errors/index.ts` | **新建**（barrel，内容见下） |
| `src/cli/errors.ts` | **删除** |
| `src/cli/error-handler.ts` | **删除** |
| `src/cli/commands/init.ts` | 更新 2 行 import（`ErrorHandler` + `ValidationError`） |
| `src/cli/commands/analyze.ts` | 更新 1 行 import（`ErrorHandler`） |
| `src/cli/commands/cache.ts` | 更新 1 行 import（`ErrorHandler`） |

**barrel 内容**（`src/cli/errors/index.ts`）：

```typescript
// Error classes（原 errors.ts 内容）
export { ParseError, ValidationError, APIError, FileError } from '@/parser/errors.js';
// ^ ParseError re-export 链保留：errors.ts 原本 re-export 自 @/parser/errors.js，此处直接转写

// Error handler（原 error-handler.ts 内容，内联或 re-export）
export { ErrorHandler } from './error-handler.js';
// 或：直接将 error-handler.ts 内容并入 index.ts（推荐，减少文件数）
```

**实现建议**：将 `error-handler.ts` 的实现直接写入 `errors/index.ts`（而非新建 `errors/error-handler.ts` 再 re-export），使目录中只有一个文件，与 barrel 模式一致。`errors.ts` 中的类定义（`ValidationError`、`APIError`、`FileError`）也内联，只保留 `ParseError` 的 re-export（因为其定义来自 parser 层，不属于 cli/errors）。

**更新 import 路径示例**：

```typescript
// commands/init.ts（改前）
import { ErrorHandler }    from '../error-handler.js';
import { ValidationError } from '../errors.js';
// 改后
import { ErrorHandler, ValidationError } from '../errors/index.js';
```

**`src/core/interfaces/errors.ts` 说明**：该文件仅有 JSDoc 注释提及 `@/cli/errors.js`，无 runtime import，无需修改。

**测试策略**：无新业务逻辑。
- `npm run type-check` 零错误
- `npm test` 全套回归

**验收标准**：
- `src/cli/errors.ts` 和 `src/cli/error-handler.ts` 均不存在
- `src/cli/errors/index.ts` 存在，导出全部原有符号（`ErrorHandler`、`ValidationError`、`APIError`、`FileError`、`ParseError`）
- `npm run type-check` 零错误
- `npm test` 全绿

---

## Phase 100 — FIM 模块删除（Option B）

**目标**：删除死代码模块 `src/analysis/fim/`（8 个源文件，~1447 行）及其对应测试（6 个测试文件）。修正 `fim-analysis.ts` 中声称 `archguard_get_fim` MCP 工具存在的失实 JSDoc（随文件删除一并消除）。

**依赖**：无前置 Phase。

**选型理由**（Option B 而非 Option A）：
- 模块外无任何 importer（grep 确认零跨模块引用）
- `archguard_get_fim` MCP 工具从未实现，JSDoc 声明是误导性遗留注释
- FIM 是算法实验（README 自注明 "experimental, research/historical use only"），不应在生产代码中持续维护
- 删除比实现缺失工具（Option A）的风险更低——无外部消费者，无破坏性变更

**删除文件**：

| 文件 | 行数 |
|------|------|
| `src/analysis/fim/cochange-matrix-builder.ts` | 86 |
| `src/analysis/fim/coverage-parser.ts` | 83 |
| `src/analysis/fim/fim-analysis.ts` | 535 |
| `src/analysis/fim/fim-artifacts.ts` | 66 |
| `src/analysis/fim/fim-builder.ts` | 267 |
| `src/analysis/fim/fim-snapshot.ts` | 60 |
| `src/analysis/fim/mantel-test.ts` | 267 |
| `src/analysis/fim/types.ts` | 83 |
| `src/analysis/fim/README.md` | — |

**删除测试文件**：

| 文件 |
|------|
| `tests/unit/analysis/fim/cochange-matrix-builder.test.ts` |
| `tests/unit/analysis/fim/coverage-parser.test.ts` |
| `tests/unit/analysis/fim/fim-builder.test.ts` |
| `tests/unit/analysis/fim/fim-integration.test.ts` |
| `tests/unit/analysis/fim/fim-snapshot.test.ts` |
| `tests/unit/analysis/fim/mantel-test.test.ts` |

**删除步骤**：

```bash
rm -rf src/analysis/fim/
rm -rf tests/unit/analysis/fim/
```

**文档清理**（执行 grep 确认，按需处理）：
- `CLAUDE.md`：搜索 `fim`，如有提及则删除对应条目
- `docs/` 目录：搜索 `proposal-coverage-fisher-information.md` 中的 FIM 引用，**本 Phase 不修改**（该 proposal 是独立文档，超出本 Plan 范围）

**测试策略**：删除操作无新逻辑。
- 删除后立即运行 `npm test` 确认测试总数减少（减少约 6 个文件、~N 个测试），无其他测试失败
- `npm run type-check` 确认无悬空 import

**验收标准**：
- `src/analysis/fim/` 目录不存在
- `tests/unit/analysis/fim/` 目录不存在
- `npm run type-check` 零错误（无悬空引用）
- `npm test` 全绿（测试总数比删除前减少 FIM 相关测试数量，其余测试无回归）
- `node dist/cli/index.js analyze -v` 正常运行，自分析输出中 `src/analysis/fim` 不再出现

---

## 依赖关系图

```
Phase 96 (QueryEngine → ArchMetrics 提取；filterRelationsForScope 具名导出)
    │
    └──→ 独立，不阻塞其他 Phase

Phase 97 (Move A: progress.ts → progress/index.ts)  ─┐
Phase 98 (Move B: cache-manager.ts → cache/)         ─┤→ 彼此独立，可并行
Phase 99 (Move C: errors/ barrel)                    ─┘

Phase 100 (FIM 删除)  → 完全独立
```

**可并行执行**：Phase 96、97、98、99、100 均无依赖关系，可在独立 worktree 中并行开发。

---

## 测试文件清单

| 文件 | Phase | 类型 |
|---|---|---|
| `tests/unit/core/query/arch-metrics.test.ts` | 96 | **新增**（unit，7 个公开方法覆盖） |
| `tests/unit/core/query/output-scope-filter.test.ts` | 96 | 扩展现有（追加 `filterRelationsForScope` 分组） |
| `tests/unit/core/query/query-engine.test.ts` | 96 | 回归（确认 delegation wrappers 行为一致） |
| `tests/unit/core/query/query-engine-summary.test.ts` | 96 | 回归 |
| `tests/unit/core/query/call-edge-filter.test.ts` | 96 | 回归（`filterRelationsForScope` 路径变更） |
| `tests/unit/core/query/find-callers.test.ts` | 96 | 回归 |
| `tests/unit/core/query/cli-mcp-parity.test.ts` | 96 | 回归 |
| *(所有使用 ProgressReporter 的测试)* | 97 | 回归（无修改，自动通过） |
| *(所有使用 CacheManager 的测试)* | 98 | 回归（无修改，自动通过） |
| *(所有使用 ErrorHandler/errors 的测试)* | 99 | 回归（无修改，自动通过） |
| `tests/unit/analysis/fim/*.test.ts`（6 个） | 100 | **删除** |

---

## 改动量汇总

| Phase | Stage | 主要修改内容 | 估计改动行数 |
|---|---|---|---|
| 96.1 | arch-metrics.ts 新建 + 测试 | `arch-metrics.ts`（~430 行），`arch-metrics.test.ts`（~80 行） | ~200 |
| 96.2 | filterRelationsForScope 移至 output-scope-filter.ts | `output-scope-filter.ts`（+30 行），`query-engine.ts`（-33 行 + 1 行 import）| ~50 |
| 96.3 | delegation wrappers + index.ts | `query-engine.ts`（+15 行 wrapper，-430 行 metrics）；`index.ts`（+1 行）| ~30 |
| 97 | progress.ts 移动 | 6 个 import 路径更新（各 1 行）；`progress.ts` → `progress/index.ts` | ~10 |
| 98 | cache-manager.ts 移动 | 1 个 import 路径更新 | ~3 |
| 99 | errors barrel | 创建 `errors/index.ts`（~250 行内联）；4 行 import 更新；删除 2 文件 | ~20 |
| 100 | FIM 删除 | 删除 9 个源文件 + 6 个测试文件（~-1500 行净） | ~0 修改 |
| **合计** | | | **~313 行修改/新增；~1500 行净删除** |

各 Phase ≤500 行，各 Stage ≤200 行，满足约束。

---

## 验收标准（全 Phase 通用门控）

- [ ] `npm test` 全绿，测试总数 ≥ 当前数量 + Phase 96 新增测试数 − Phase 100 删除测试数
- [ ] `npm run type-check` 零错误
- [ ] `npm run lint` 零 error
- [ ] `npm run build` 成功
- [ ] `node dist/cli/index.js analyze -v` 正常运行

**Phase 96 专项**：
- [ ] `src/core/query/query-engine.ts` 行数 ≤580
- [ ] `src/core/query/arch-metrics.ts` 存在，包含 `getSummary`、`getPackageStats`、`getPackageCoverage`、`getEntityCoverage`、`findHighCoupling`、`findOrphans`、`findInCycles` 共 7 个公开方法
- [ ] `toSummary` 保留在 `QueryEngine`（不在 `ArchMetrics`）
- [ ] `applyOutputOptions` 保留在 `QueryEngine`（private，不迁移）
- [ ] `filterRelationsForScope` 在 `output-scope-filter.ts` 中作为具名导出
- [ ] `src/cli/commands/query.ts`、`src/cli/mcp/mcp-server.ts`、`src/cli/mcp/tools/*.ts`、`src/cli/processors/diagram-pipeline-runner.ts` 零修改
- [ ] `src/cli/query/query-engine.ts`（shim）零修改

**Phase 97 专项**：
- [ ] `src/cli/progress.ts` 不存在
- [ ] `src/cli/progress/index.ts` 存在，导出全部原有符号
- [ ] `src/cli/progress/parallel-progress.ts` 不受影响

**Phase 98 专项**：
- [ ] `src/cli/cache-manager.ts` 不存在
- [ ] `src/cli/cache/cache-manager.ts` 存在

**Phase 99 专项**：
- [ ] `src/cli/errors.ts` 和 `src/cli/error-handler.ts` 均不存在
- [ ] `src/cli/errors/index.ts` 存在，导出 `ErrorHandler`、`ValidationError`、`APIError`、`FileError`、`ParseError`
- [ ] `ParseError` re-export 链完整（最终来自 `@/parser/errors.js`）

**Phase 100 专项**：
- [ ] `src/analysis/fim/` 目录不存在
- [ ] `tests/unit/analysis/fim/` 目录不存在
- [ ] 自分析输出中 `src/analysis/fim` 不出现（零孤立节点）

---

## 向后兼容声明

**Phase 96**：`QueryEngine` 公开 API 完全不变（delegation wrappers 保持方法签名和返回类型）。`src/cli/query/query-engine.ts`（shim）零修改。现有 MCP 工具、CLI 命令、pipeline 处理器均无需修改。

**Phase 97/98/99**：导出符号名称不变，只有 import 路径更新。第三方代码若直接 import `src/cli/progress.ts` 等路径需自行更新（属于私有 API，无承诺保证）。

**Phase 100**：FIM 模块无外部 importer（grep 确认），删除不产生任何下游破坏。`archguard_get_fim` MCP 工具从未实现，删除不破坏任何已有 MCP 客户端集成。
