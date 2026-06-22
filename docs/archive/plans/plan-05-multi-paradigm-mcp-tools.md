# Plan 05: Multi-Paradigm MCP Tools

## Overview

本计划落实 [proposal-multi-paradigm-mcp-tools.md](../proposals/proposal-multi-paradigm-mcp-tools.md) 中的全部变更，分三个阶段实施：

1. **QueryEngine 扩展** — `getAtlasLayer<K>()` 方法 + `getSummary()` capabilities 字段
2. **新 MCP 工具** — `archguard_get_atlas_layer`
3. **范式路由** — 工具描述静态注释 + `archguard_analyze` Paradigm 块

阶段 1 是阶段 2 的前置依赖（新工具通过 `engine.getAtlasLayer()` 访问数据）。阶段 3 独立但顺序靠后，以便在 Paradigm 块中正确引用已实现的新工具。

前置条件：`proposal-go-atlas-mcp-query-awareness.md` 中的 Fix 1 + Fix 2 必须已合并。

实施遵循 TDD：每个阶段先补充失败测试，再修改实现直到测试通过。

---

## Test Fixtures

以下 fixture 形状被三个测试文件共用，在各阶段测试中作为最小可用示例。

### GoAtlas ArchJSON Fixture（package 层）

```typescript
const goAtlasArchJson: ArchJSON = {
  version: '1.0',
  language: 'go',
  timestamp: '2026-01-01T00:00:00Z',
  sourceFiles: [],
  entities: [],
  relations: [],
  extensions: {
    goAtlas: {
      version: '2.0', // GO_ATLAS_EXTENSION_VERSION = "2.0"
      layers: {
        package: {
          nodes: [
            { id: 'github.com/example/app/pkg/hub', name: 'pkg/hub', type: 'internal', fileCount: 3 },
            { id: 'github.com/example/app/pkg/store', name: 'pkg/store', type: 'internal', fileCount: 2 },
          ],
          edges: [
            { from: 'github.com/example/app/pkg/hub', to: 'github.com/example/app/pkg/store', strength: 4 },
          ],
          cycles: [],
        },
      },
      metadata: {
        generatedAt: '2024-01-01T00:00:00Z',
        generationStrategy: {
          functionBodyStrategy: 'none',
          detectedFrameworks: [],
          followIndirectCalls: false,
          goplsEnabled: false,
        },
        completeness: { package: 1.0, capability: 0, goroutine: 0, flow: 0 },
        performance: { fileCount: 5, parseTime: 100, totalTime: 200, memoryUsage: 1024 },
      },
    },
  },
};
```

> **Important**: `PackageDependency.from`/`to` are package IDs (full module paths), not short
> names. `PackageNode.name` is the short path (e.g. `"pkg/hub"`). `toAdjacency` for the
> `package` layer must join via `nodes.find(n => n.id === edge.from)?.name ?? edge.from` to
> obtain the short name.

### GoAtlas ArchJSON Fixture（capability 層）

```typescript
extensions: {
  goAtlas: {
    version: '2.0',
    layers: {
      capability: {
        nodes: [
          { id: 'pkg/hub.Handler', name: 'Handler', type: 'interface', package: 'pkg/hub', exported: true },
          { id: 'pkg/store.StoreImpl', name: 'StoreImpl', type: 'struct', package: 'pkg/store', exported: true },
        ],
        edges: [
          {
            id: 'e1',
            type: 'implements',   // 'implements' | 'uses'
            source: 'pkg/store.StoreImpl',  // source is an ID
            target: 'pkg/hub.Handler',      // target is an ID
            confidence: 1.0,
          },
        ],
      },
    },
  },
},
```

> **Important**: `CapabilityRelation` uses `source`/`target` (not `from`/`to`). Both are IDs.
> `toAdjacency` for `capability` must use `edge.source`/`edge.target` and look up names via
> `nodes.find(n => n.id === edge.source)?.name ?? edge.source` /
> `nodes.find(n => n.id === edge.target)?.name ?? edge.target`.

### GoAtlas ArchJSON Fixture（goroutine 层）

```typescript
extensions: {
  goAtlas: {
    version: '2.0',
    layers: {
      goroutine: {
        nodes: [
          { id: 'spawn-1', name: 'handleConn', type: 'spawned', package: 'pkg/hub', location: { file: 'hub.go', line: 42 } },
          { id: 'spawn-2', name: 'worker', type: 'spawned', package: 'pkg/hub', location: { file: 'hub.go', line: 55 } },
        ],
        edges: [
          { from: 'spawn-1', to: 'spawn-2', spawnType: 'go-stmt' },
          //  ↑ SpawnRelation.from/to are GoroutineNode IDs, not names
        ],
        channels: [],
        channelEdges: [],
      },
    },
  },
},
```

> **Important**: `SpawnRelation.from`/`to` are function IDs (matching `GoroutineNode.id`),
> not names. `toAdjacency` for `goroutine` must resolve names via
> `nodes.find(n => n.id === edge.from)?.name ?? edge.from` /
> `nodes.find(n => n.id === edge.to)?.name ?? edge.to`.

### RunAnalysisResult Mock（Phase 3）

```typescript
runAnalysisMock.mockResolvedValue({
  config: { workDir: '/project/.archguard', outputDir: '/project/.archguard/output' },
  // diagrams must be DiagramConfig[] with language field set — NOT empty []
  diagrams: [{ name: 'architecture', level: 'package', sources: [], language: 'go' }],
  results: [],
  queryScopesPersisted: 1,
  persistedScopeKeys: ['abc123'],
  hasDiagramFailures: false,
});
```

> `language` comes from `DiagramConfig.language` (optional field on `DiagramConfig`).
> `RunAnalysisResult.diagrams` is `DiagramConfig[]`. The expression
> `result.diagrams.find(d => d.language)?.language` accesses `DiagramConfig.language` —
> this is the correct path. The fixture must include at least one diagram with `language: 'go'`
> for the Paradigm block to appear. With `diagrams: []`, language is undefined and the block
> is correctly omitted.

---

## Phases

### Phase 1: QueryEngine 扩展

#### Objectives

- 在 `QueryEngine` 上新增 `getAtlasLayer<K>()` 泛型公开方法，暴露 Atlas 扩展数据
- 扩展 `getSummary()` 返回类型，增加 `capabilities` 对象和 `topDependedOn` 抑制逻辑

#### Stages

1. 补充失败测试

   修改 `tests/unit/cli/query/query-engine.test.ts`：

   - `getAtlasLayer('package')` 对含 Atlas 扩展的 ArchJSON 返回 `PackageGraph`
   - `getAtlasLayer('flow')` 返回 `FlowGraph | undefined`
   - `getAtlasLayer('package')` 对无 Atlas 扩展的 ArchJSON 返回 `undefined`
   - `getSummary()` 对 Go Atlas 项目返回 `capabilities.classHierarchy: false`、`capabilities.packageGraph: true`、`capabilities.cycleDetection: false`
   - `getSummary()` 对 TypeScript 项目返回 `capabilities.classHierarchy: true`、`capabilities.packageGraph: false`、`capabilities.cycleDetection: true`
   - `getSummary()` 对含 implementation 关系的项目返回 `capabilities.interfaceImplementation: true`
   - `getSummary()` 对 Go Atlas 项目返回 `topDependedOn: []` 和非空 `topDependedOnNote`
   - `getSummary()` 对 TypeScript 项目返回非空 `topDependedOn`、`topDependedOnNote: undefined`
   - `getSummary()` 对标准模式 Go 项目（无 Atlas 扩展，`language: 'go'`）返回 `capabilities.cycleDetection: false`（Go 编译器强制无环；无论是否有 Atlas 扩展，Go 项目均返回 false）

   Acceptance criteria：所有新测试在实现前失败。

   Dependencies：无。

2. 实现 `getAtlasLayer<K>()`

   修改 `src/cli/query/query-engine.ts`：

   ```typescript
   import type { GoAtlasLayers } from '@/types/extensions.js';

   getAtlasLayer<K extends keyof GoAtlasLayers>(layer: K): GoAtlasLayers[K] | undefined {
     return this.archJson.extensions?.goAtlas?.layers?.[layer];
   }
   ```

   Acceptance criteria：
   - `getAtlasLayer` 系列测试通过
   - `npm run type-check` 无报错
   - 现有 QueryEngine 测试全部通过

   Dependencies：Stage 1 测试就位。

3. 扩展 `getSummary()`

   修改 `src/cli/query/query-engine.ts`，在 `getSummary()` 中增加：

   - `capabilities` 对象，按照 proposal §3b 的推导逻辑：
     - `classHierarchy: this.archJson.language !== 'go'`
     - `interfaceImplementation: hasImplementation`（基于 `index.relationsByType['implementation']`）
     - `packageGraph: hasAtlas`（基于 `extensions?.goAtlas?.layers?.package` 是否存在）
     - `cycleDetection: this.archJson.language !== 'go'`（Go 编译器强制无环；对所有 Go 项目均返回 false，无论 Atlas 模式是否开启）
   - `topDependedOn`：`hasAtlas` 时置为 `[]`
   - `topDependedOnNote`：`hasAtlas` 时填入引导文本，否则 `undefined`

   同步更新 `getSummary()` 的内联返回类型注解。**注意**：`capabilities` 和 `topDependedOnNote`
   两个新字段必须在同一次提交/同一 Stage 中同时添加到返回类型注解中，否则 TypeScript 会在
   类型注解与实现不一致时报错。

   Acceptance criteria：
   - `getSummary()` 系列测试通过
   - `topDependedOn` 抑制测试通过
   - TypeScript 项目的现有 summary 测试通过（`topDependedOn` 行为不变）

   Dependencies：Stage 2 完成。

#### Test strategy

```bash
npx vitest run tests/unit/cli/query/query-engine.test.ts
npm run type-check
```

---

### Phase 2: 新 MCP 工具 `archguard_get_atlas_layer`

#### Objectives

- 在 `mcp-server.ts` 中注册 `archguard_get_atlas_layer` 工具
- 支持 `package`、`capability`、`goroutine`、`flow` 四个层
- 支持 `full`（默认）和 `adjacency` 两种格式；`flow` 层禁用 `adjacency`

#### Stages

1. 补充失败测试

   修改 `tests/unit/cli/mcp/mcp-server.test.ts`，新增 `archguard_get_atlas_layer` 测试组：

   - `format='full'`：返回 Go Atlas 项目 `package` 层的原始 JSON 对象
   - `format='adjacency'`，`layer='package'`：返回 `[{from, to, label}]` 列表，`from`/`to` 使用 `PackageNode.name`（短路径），`label` 格式为 `"N refs"`
   - `format='adjacency'`，`layer='capability'`：返回 `[{from, to, label}]`，`label` 为 `"implements"` 或 `"uses"`
   - `format='adjacency'`，`layer='goroutine'`：返回 `[{from, to}]`，无 label
   - `format='adjacency'`，`layer='flow'`：返回错误消息（不支持）
   - 无 Atlas 扩展的项目：返回 no-Atlas 错误消息
   - 层存在于 schema 但在该项目中为空（如 `flow` 无入口点）：返回空层提示
   - 默认 `format='full'`（不传 format 参数时使用 full）

   **注意（唯一例外）**：新增 `archguard_get_atlas_layer` 测试组时，必须同时将
   `mcp-server.test.ts` 中现有的 `expect(tools.size).toBe(8)` 断言更新为
   `expect(tools.size).toBe(9)`。这是对现有测试的必要修改，是验收标准 8 的唯一例外。

   **`tools.size` の計上範囲**：`mcp-server.test.ts` の `collectTools()` ヘルパーは
   `registerTools(server, defaultRoot)` のみを呼び出し、`registerAnalyzeTool` は呼ばない。
   したがって `tools.size` は `registerTools` 内に登録されたクエリツール数のみを表す
   （`archguard_analyze` はこのカウントに含まれない）。現在 `registerTools` には 8 ツール
   が登録されており、`archguard_get_atlas_layer` 追加後に 9 となる。テスト更新時は
   `tests/unit/cli/mcp/mcp-server.test.ts` の `'registers all 8 tools'` という describe
   ラベルと `expect(tools.size).toBe(8)` の両方を `9` に変更すること。

   Acceptance criteria：所有新测试在实现前失败。

   Dependencies：Phase 1 全部完成（测试需通过 `engine.getAtlasLayer()`）。

2. 实现工具

   **前置：新增 `hasAtlasExtension()` 方法**

   在 `src/cli/query/query-engine.ts` 中新增（与 Phase 1 Stage 2 的 `getAtlasLayer` 并列）：

   ```typescript
   /** Returns true when the ArchJSON carries a goAtlas extension container. */
   hasAtlasExtension(): boolean {
     return !!this.archJson.extensions?.goAtlas;
   }
   ```

   此方法区分"完全没有 Atlas 扩展"和"Atlas 扩展存在但该层为空"两种情况，供 handler 用于
   精确的 no-Atlas 错误判断。

   修改 `src/cli/mcp/mcp-server.ts`，在 `registerTools()` に新ツールを追加するとともに、
   関数直前の JSDoc コメント `"Register all 8 query tools"` を `"Register all 9 query tools"` に
   更新すること（`mcp-server.ts` 先頭の `"Provides 8 tools"` という文章も同様に `9` に修正する）。

   `registerTools()` 中新增：

   ```typescript
   server.tool(
     'archguard_get_atlas_layer',
     'Query a named layer of the Go Atlas architecture graph; returns nodes and edges for ' +
     '`package`, `capability`, `goroutine`, or call chains for `flow`.',
     {
       projectRoot: projectRootParam,
       scope:       scopeParam,
       layer: z.enum(['package', 'capability', 'goroutine', 'flow'])
                .describe('Atlas layer to retrieve'),
       format: z.enum(['full', 'adjacency'])
                 .default('full')
                 .describe(
                   'full: raw layer object as JSON (works for all layers). ' +
                   'adjacency: simplified [{from, to, label}] edge list — ' +
                   'not supported for the flow layer.'
                 ),
     },
     async ({ projectRoot, scope, layer, format }) => { ... }
   );
   ```

   Handler 逻辑：
   1. 调用 `loadEngine` 获取 engine
   2. 调用 `engine.hasAtlasExtension()`：若返回 `false` → 立即返回 no-Atlas 错误（不做
      进一步层查询）。这是 no-Atlas 检查的**权威判断**；使用此方法而非
      `engine.getAtlasLayer('package') === undefined`，因为后者无法区分"没有 Atlas 扩展"
      与"Atlas 扩展存在但 package 层未生成"。
   3. 调用 `engine.getAtlasLayer(layer)`；若返回 `undefined`（且 `hasAtlasExtension()` 为
      true）→ 该层为空提示
   4. 若 `format === 'adjacency'` 且 `layer === 'flow'` → 返回不支持错误
   5. 若 `format === 'adjacency'` → 调用对应 `toAdjacency` 函数
   6. 若 `format === 'full'` → 序列化返回

   `toAdjacency` 转换规则（proposal §5）：
   - `package`：`PackageDependency.from`/`to` 是完整 module path ID（非短名）。必须通过
     `nodes.find(n => n.id === edge.from)?.name ?? edge.from` /
     `nodes.find(n => n.id === edge.to)?.name ?? edge.to`
     查找短名（`PackageNode.name`）。`label` = `"${strength} refs"`
   - `capability`：`CapabilityRelation` 使用 `source`/`target` 字段（**不是** `from`/`to`）。
     `source`/`target` 均为 ID。必须通过
     `nodes.find(n => n.id === edge.source)?.name ?? edge.source` /
     `nodes.find(n => n.id === edge.target)?.name ?? edge.target`
     查找名称。`label` = `edge.type`（`"implements"` 或 `"uses"`）
   - `goroutine`：`SpawnRelation.from`/`to` 是函数 ID（匹配 `GoroutineNode.id`），不是名称。
     必须通过 `nodes.find(n => n.id === edge.from)?.name ?? edge.from` /
     `nodes.find(n => n.id === edge.to)?.name ?? edge.to`
     查找名称。无 label

   Acceptance criteria：
   - 所有新工具测试通过
   - 现有 8 个工具的测试不受影响
   - `npm run type-check` 无报错

   Dependencies：Stage 1 测试就位；Phase 1 完成。

#### Test strategy

```bash
npx vitest run tests/unit/cli/mcp/mcp-server.test.ts
npm run type-check
```

---

### Phase 3: 范式路由

#### Objectives

- 为 5 个受限工具的 description 追加单句语言适用性说明
- 为 Go 项目的 `archguard_analyze` 响应追加 `Paradigm:` 块

#### Stages

1. 补充失败测试

   修改 `tests/unit/cli/mcp/analyze-tool.test.ts`：

   - Go 语言项目的 `formatAnalyzeResponse` 输出包含 `"Paradigm: package (Go Atlas)"`
   - Go 语言项目输出包含 `"Applicable:"` 和 `"Not useful:"` 段落
   - TypeScript 项目的输出不包含 `"Paradigm:"` 字符串
   - `result.diagrams` 为空时输出不包含 `"Paradigm:"`（降级行为）

   **Fixture 要求**：Go 项目的 `runAnalysisMock` 返回值中，`diagrams` 必须是包含至少一个
   带 `language: 'go'` 字段的 `DiagramConfig` 对象的数组（**不能是 `[]`**）。例如：
   `diagrams: [{ name: 'architecture', level: 'package', sources: [], language: 'go' }]`。
   `language` 字段来自 `DiagramConfig`（`src/types/config-diagram.ts`），不来自 `DiagramResult`。
   表达式 `result.diagrams.find(d => d.language)?.language` 访问的是
   `RunAnalysisResult.diagrams`（类型 `DiagramConfig[]`）上的 `DiagramConfig.language` 可选
   字段——路径正确，fixture 必须保证该字段有值。

   Acceptance criteria：所有新测试在实现前失败。

   Dependencies：无。

2. 更新工具 description 字符串

   修改 `src/cli/mcp/mcp-server.ts`，对 5 个工具各追加一句（proposal §1）：

   | 工具 | 追加内容 |
   |------|---------|
   | `archguard_find_subclasses` | `"Only applicable to OO languages; Go has no class inheritance and will always return empty."` |
   | `archguard_find_implementers` | `"For Go, finds struct types satisfying an interface via implicit structural typing."` |
   | `archguard_get_dependencies` | `"Operates at entity (class/struct) level; for Go package-level dependencies use archguard_get_atlas_layer."` |
   | `archguard_get_dependents` | `"Operates at entity (class/struct) level; for Go package-level reverse dependencies use archguard_get_atlas_layer."` |
   | `archguard_detect_cycles` | `"For Go: the compiler prevents import cycles, so this tool will return empty for any valid Go project."` |

   Acceptance criteria：`npm run type-check` 通过；字符串更新不影响任何现有测试。

   Dependencies：无（可与 Stage 3 并行，但放在 Stage 1 之后以避免测试干扰）。

3. 实现 `formatAnalyzeResponse()` Paradigm 块

   修改 `src/cli/mcp/analyze-tool.ts`，在 `formatAnalyzeResponse()` 末尾、`Next step:` 行之前插入：

   ```typescript
   const language = result.diagrams.find(d => d.language)?.language;
   if (language === 'go') {
     lines.push('', PARADIGM_BLOCK_GO);
   }
   ```

   `PARADIGM_BLOCK_GO` 为 proposal §2 中的静态字符串常量（提取为模块级 const，便于测试断言）。

   Acceptance criteria：
   - Paradigm 块测试通过
   - TypeScript 项目无 Paradigm 块测试通过
   - 降级测试（空 diagrams）通过

   Dependencies：Stage 1 测试就位；Stage 2 完成（描述字符串已更新，`archguard_get_atlas_layer` 名称在块中引用正确）。

#### Test strategy

```bash
npx vitest run tests/unit/cli/mcp/analyze-tool.test.ts
npx vitest run tests/unit/cli/mcp/mcp-server.test.ts
npm run type-check
```

---

## Dependencies

```
Phase 1 (QueryEngine)
  └─► Phase 2 (new tool — uses engine.getAtlasLayer())
        └─► Phase 3 Stage 3 (Paradigm block references the new tool by name)

Phase 3 Stage 1 (analyze tests) — independent, can start anytime
Phase 3 Stage 2 (description strings) — independent, no code dependency
```

Phase 1 和 Phase 3 Stage 1/2 可以并行开始；Phase 2 必须等 Phase 1 全部完成后启动；Phase 3 Stage 3 必须等 Phase 2 完成后启动（确保 `archguard_get_atlas_layer` 已注册，工具名引用有效）。

## Files Changed

| 文件 | 阶段 |
|------|------|
| `tests/unit/cli/query/query-engine.test.ts` | Phase 1 Stage 1 |
| `src/cli/query/query-engine.ts` | Phase 1 Stage 2-3 |
| `tests/unit/cli/mcp/mcp-server.test.ts` | Phase 2 Stage 1 |
| `src/cli/mcp/mcp-server.ts` | Phase 2 Stage 2、Phase 3 Stage 2 |
| `tests/unit/cli/mcp/analyze-tool.test.ts` | Phase 3 Stage 1 |
| `src/cli/mcp/analyze-tool.ts` | Phase 3 Stage 3 |

## Acceptance Criteria（全局）

1. `archguard_analyze` 对 Go 项目返回包含 `Paradigm: package (Go Atlas)` 的响应。
2. `archguard_analyze` 对 TypeScript 项目响应不包含 `Paradigm:` 块。
3. `archguard_summary` 对所有语言返回 `capabilities` 对象；Go Atlas 项目 `packageGraph: true`、`classHierarchy: false`、`cycleDetection: false`。
4. `archguard_summary` 对 Go Atlas 项目返回 `topDependedOn: []` 和非空 `topDependedOnNote`。
5. `archguard_get_atlas_layer({ layer: 'package', format: 'adjacency' })` 对 Go 项目返回使用短包名的边列表。
6. `archguard_get_atlas_layer({ layer: 'flow', format: 'adjacency' })` 返回不支持错误。
7. `archguard_get_atlas_layer` 对非 Go 项目返回 no-Atlas 错误。
8. 所有现有测试通过；`tools.size` 断言作为 Phase 2 的一部分从 `8` 更新为 `9`（这是对现有测试的唯一必要修改）。
