---
id: TASK-27
title: 'Refactor: separate Atlas capability from GoPlugin core parse logic'
status: 'Basic: Backlog'
assignee: []
created_date: '2026-06-30 05:20'
updated_date: '2026-06-30 05:21'
labels:
  - 'kind:basic'
dependencies: []
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
将 src/plugins/golang/index.ts（GoPlugin，361行，fan-out 21）中的 Atlas 分析能力（generateAtlas、renderLayer、GoAtlasCoordinator 依赖）提取到独立层，主 GoPlugin 只关注标准 ILanguagePlugin 接口的 parse 流程。必须参考 ADR-001 确保不重新引入 double-parse bug。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: Separate Atlas capability from GoPlugin core parse logic

## Background

GoPlugin (`src/plugins/golang/index.ts`, 361 行) 同时实现 `ILanguagePlugin`（标准 parse 接口）和 `IGoAtlas`（Atlas 架构分析接口），fan-out 达 21（imports GoParseCoordinator、GoAtlasCoordinator、GoTestAnalyzer、GoplsInterfaceResolver 等 12 个外部依赖）。ADR-001 记录了将原本分开的 GoPlugin 和 GoAtlasPlugin 合并的决策，根本原因是 **double-parse bug**：旧组合模式中 `GoAtlasPlugin.parseProjectWithAtlas()` 先调 `goPlugin.parseProject()` 再调 `generateAtlas()` → `goPlugin.parseToRawData()`，导致 Tree-sitter 解析执行两次。

当前实现已通过 `parseProject()` 内部直接调用 `atlasCoordinator.buildAtlasFromRawData(rawData, ...)` 解决 double-parse（rawData 只生成一次）。但 `generateAtlas()` 作为独立入口仍调用 `parseToRawData()`（此为合法的独立调用路径，非 bug）。

## Goals

1. 将 `generateAtlas()` 和 `renderLayer()` 的**实现主体**迁移到 `GoAtlasAdapter`，GoPlugin 保留两个代理方法（满足 IGoAtlas 接口，对外无感知）
2. GoPlugin 行数 ≤ 280（当前 361），直接持有的 Atlas 专属依赖减少（`AtlasGenerationOptions`、`AtlasConfig` 等类型仅在 adapter 引用）
3. **parseToRawData 在任何路径下仍只被调用一次（不得引入 double-parse）**
4. plugin-registry、CLI flags（`--atlas` 等）行为不变；GoPlugin 继续 `implements IGoAtlas`
5. 所有现有 Go 插件测试和 Atlas 测试依然通过

## Proposed Approach

**组合模式（Adapter）而非继承**。

```
GoPlugin implements ILanguagePlugin, IGoAtlas
  ├── private atlasAdapter: GoAtlasAdapter    ← 新增
  ├── generateAtlas()  → this.atlasAdapter.generateAtlas(...)  [代理]
  └── renderLayer()    → this.atlasAdapter.renderLayer(...)    [代理]

GoAtlasAdapter
  ├── constructor(private plugin: GoPlugin, private atlasCoordinator: GoAtlasCoordinator)
  ├── generateAtlas(rootPath, options)    ← 从 GoPlugin 迁入实现
  └── renderLayer(atlas, layer, format)   ← 从 GoPlugin 迁入实现
```

`GoAtlasAdapter.generateAtlas()` 通过 `plugin.parseToRawData(...)` 调用 GoPlugin 的公共方法（ADR-001 规定的公共 API），无需访问任何 private 成员，无 bracket hack。AtlasConfig 解析逻辑留在 `parseProject()`（属于标准流程的一部分，不属于 Atlas 独立入口）。

## Trade-offs and Risks

- **不采用继承**（GoAtlasPlugin extends GoPlugin）——ADR-001 已明确拒绝，会破坏封装、引入脆弱基类
- **代理模式保持接口稳定**：GoPlugin 仍 implements IGoAtlas，外部使用者（CLI processor、MCP tools）无需修改
- **风险**：`generateAtlas()` 中 `isTestPackage` 过滤逻辑需随方法一起迁移，避免逻辑分散；`inferBodyStrategy` helper 可提升为模块级函数，两侧均可使用
- `GoAtlasAdapter` 的构造参数 `GoPlugin` 必须是已 `initialize()` 的实例，需在 GoPlugin.initialize() 中创建 adapter

# Plan: Separate Atlas capability from GoPlugin core parse logic

## Phase A：新建 GoAtlasAdapter，迁移 Atlas 方法实现

### Tests（先写）
新建 `tests/plugins/golang/go-atlas-adapter.test.ts`：
- 验证 `GoAtlasAdapter.generateAtlas()` 内部调用 `GoPlugin.parseToRawData()` 恰好一次（vi.spyOn）
- 验证 `GoAtlasAdapter.renderLayer()` 委托到 `GoAtlasCoordinator.renderLayer()`
- 验证 `parseProject()` 调用链中 `parseToRawData` 仍只被调用一次（double-parse 防护）

### Implementation
1. 新建 `src/plugins/golang/go-atlas-adapter.ts`
   - `GoAtlasAdapter` 构造函数：`(private plugin: GoPlugin, private atlasCoordinator: GoAtlasCoordinator)`
   - 迁入 `generateAtlas()` 实现（含 `isTestPackage` 过滤逻辑）
   - 迁入 `renderLayer()` 实现（一行委托）
   - 模块级迁移 `inferBodyStrategy` helper（从 index.ts 搬至此文件）
2. 修改 `src/plugins/golang/index.ts`
   - import GoAtlasAdapter
   - `initialize()` 末尾：`this._atlasAdapter = new GoAtlasAdapter(this, this.atlasCoordinator)`
   - `generateAtlas()` → 单行代理：`return this._atlasAdapter.generateAtlas(rootPath, options)`
   - `renderLayer()` → 单行代理：`return this._atlasAdapter.renderLayer(atlas, layer, format)`
   - 移除 Atlas 专属 imports（`AtlasGenerationOptions`、`inferBodyStrategy` 等）从 index.ts 顶部

### DoD
- [ ] `npm test -- --run tests/plugins/golang/go-atlas-adapter.test.ts` 全绿
- [ ] `wc -l src/plugins/golang/index.ts` 输出 ≤ 280

## Phase B：验证 double-parse 约束 + 全量回归

### Tests
- 扩展 `tests/plugins/golang/go-plugin.test.ts`：`parseProject()` 路径中 `parseToRawData` spy 计数 === 1
- 确认 `tests/plugins/golang/atlas/` 所有现有测试通过（行为不变）

### Implementation
- 检查 `src/cli/processors/diagram-processor.ts` 中 GoPlugin 使用路径，确认无需修改（GoPlugin 仍 implements IGoAtlas）
- 确认 MCP tools 中无直接调用 `generateAtlas` 的路径需要类型调整

### DoD
- [ ] `npm test -- --run tests/plugins/golang/`
- [ ] `npm test -- --run tests/plugins/golang/atlas/`

## Acceptance Gate
- [ ] `npm test`
- [ ] `npm run type-check`
- [ ] `npm run lint`

## Constraints
- GoPlugin 继续 `implements IGoAtlas`（代理模式）
- `parseToRawData` 调用次数 = 1 per parseProject invocation，不得因重构引入 double-parse
- plugin-registry.ts 和 CLI 的 `--atlas` flag 行为不变
- 不采用继承（ADR-001 已拒绝此方案）
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test
- [ ] #2 npm run type-check
- [ ] #3 npm run lint
<!-- DOD:END -->
