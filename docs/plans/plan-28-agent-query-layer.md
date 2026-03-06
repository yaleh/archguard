# Plan 28: Agent Query Layer — Development Plan

> Source proposal: `docs/proposals/proposal-agent-query-layer.md`
> Branch: `feat/agent-query-layer`
> Status: Draft (aligned with proposal rev 3)

---

## Overview

本计划按“先纠正数据模型，再暴露命令”的顺序推进。核心变化有三点:

1. 持久化对象从“单一 primary arch.json”改为“每个 source group 一个 query scope”
2. 查询全部显式绑定到 scope；多 scope 时必须 `--scope`
3. 只实现实体级查询；移除 `--calls`

五个 Phase:

| Phase | Scope | Dependency |
|------|------|------------|
| Phase 1 | 暴露 query source groups + 持久化 `manifest.json` / per-scope `arch.json` | None |
| Phase 2 | `ArchIndexBuilder` + `QueryEngine` + 原子一致性 | Phase 1 |
| Phase 3 | `query` 子命令 | Phase 2 |
| Phase 4 | `search` 子命令 | Phase 2 |
| Phase 5 | MCP Server | Phase 3 + 4 |

每个 Phase 都必须独立通过:

```bash
npm test
npm run type-check
```

---

## Pre-flight

先确认当前实现事实，不要再沿用旧文档的错误前提:

```bash
npm test
npm run type-check
npm run build

node dist/cli/index.js analyze -v

# 重点确认:
# 1. workDir 默认是 .archguard
# 2. outputDir 默认是 .archguard/output
# 3. 当前没有 .archguard/query/
```

基线观察点:

- `src/cli/config-loader.ts` 中 `workDir` 与 `outputDir` 的默认值
- `src/cli/processors/diagram-processor.ts` 的 `archJsonCache` 是多 source-group 缓存
- Go Atlas 不是空实体模式

---

## Phase 1 — Query Scope 持久化

### Objectives

1. `DiagramProcessor` 暴露全部可持久化的 raw ArchJSON source groups
2. 新增 `.archguard/query/manifest.json`
3. 为每个 scope 写入独立 `<scope-key>/arch.json`
4. 不再引入 `getPrimaryArchJson()`

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/processors/diagram-processor.ts` | Modify | Add `getQuerySourceGroups()` |
| `src/cli/query/query-manifest.ts` | New | `QueryManifest` types |
| `src/cli/query/query-artifacts.ts` | New | Persist manifest + per-scope `arch.json` |
| `src/cli/commands/analyze.ts` | Modify | Persist all scopes after `processAll()` |
| `tests/unit/cli/processors/diagram-processor-query-scopes.test.ts` | New | Unit tests for `getQuerySourceGroups()` |

### Implementation notes

`DiagramProcessor` 公开的新结构建议如下:

```typescript
export interface QuerySourceGroup {
  key: string;
  sources: string[];
  archJson: ArchJSON;
}
```

`getQuerySourceGroups()` 行为要求:

- 返回所有已缓存的 raw ArchJSON
- 仅包含 `entities.length > 0` 的 group
- 不因为 `extensions.goAtlas` 存在而过滤

`query-artifacts.ts` 先实现 Phase 1 最小集:

- `persistQueryScopes(workDir, scopes)`
- 写 `.archguard/query/manifest.json`
- 写 `.archguard/query/<scope-key>/arch.json`

此阶段先不写 `arch-index.json`，Phase 2 接入。

### Verify

```bash
npm run build
node dist/cli/index.js analyze -v

ls .archguard/query
# Expected: manifest.json + one or more scope directories
```

验收点:

- 单 scope 项目: `manifest.scopes.length === 1`
- 多 scope 项目: `manifest.scopes.length > 1`
- Go Atlas 项目只要实体非空，就会生成 scope

---

## Phase 2 — Arch Index + Query Engine

### Objectives

1. 为每个 scope 构建 `arch-index.json`
2. 引入 manifest-aware 的 `QueryEngine`
3. 缺失或陈旧索引时，同步重建并原子写回
4. 多 scope 时要求显式 `scope`

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/query/arch-index.ts` | New | `ArchIndex` type |
| `src/cli/query/arch-index-builder.ts` | New | `ArchJSON -> ArchIndex` |
| `src/cli/query/query-engine.ts` | New | Load manifest/scope and execute queries |
| `src/cli/query/query-artifacts.ts` | Modify | Also persist `arch-index.json` |
| `tests/unit/cli/query/arch-index-builder.test.ts` | New | Builder tests |
| `tests/unit/cli/query/query-engine.test.ts` | New | Scope selection and fallback tests |

### Required design constraints

#### 1. Atomic writes

不要使用 fire-and-forget。所有写入必须走:

1. write temp file
2. rename to target

至少覆盖:

- `arch.json`
- `arch-index.json`
- `manifest.json`

#### 2. Scope-aware loading

`QueryEngine.load(queryRoot, scope?)` 逻辑:

1. 读取 `manifest.json`
2. `scopes.length === 0` -> 报错
3. `scopes.length === 1 && scope 未指定` -> 自动选中
4. `scopes.length > 1 && scope 未指定` -> 报错并列出可选 scope
5. 校验 `<scope-key>/arch.json`
6. 校验 `<scope-key>/arch-index.json`
7. 必要时同步重建 index

#### 3. 查询边界

只实现 entity-level:

- `findEntity`
- `getDependents`
- `getDependencies`
- `findImplementers`
- `findSubclasses`
- `getFileEntities`
- `getCycles`
- `getSummary`
- `findByType`
- `findHighCoupling`
- `findOrphans`
- `findInCycles`

本阶段不实现 `findCallers`

### Verify

```bash
npm run build
node dist/cli/index.js analyze -v

find .archguard/query -name arch-index.json
# Expected: one file per scope
```

关键测试:

- 缺失 `arch-index.json` -> rebuild and persist
- hash mismatch -> rebuild and persist
- manifest 多 scope 且未指定 scope -> hard error

---

## Phase 3 — `query` Subcommand

### Objectives

实现 scope-aware 的实体级查询命令。

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/query/engine-loader.ts` | New | Resolve `archDir` + `scope` |
| `src/cli/commands/query.ts` | New | Commander query command |
| `src/cli/index.ts` | Modify | Register command |

### Command surface

```bash
archguard query --entity "CacheManager"
archguard query --deps-of "DiagramProcessor" --depth 2
archguard query --used-by "ArchJSON"
archguard query --implementers-of "ILanguagePlugin"
archguard query --subclasses-of "BaseProcessor"
archguard query --file "src/foo.ts"
archguard query --cycles
archguard query --summary
```

新增公共参数:

```bash
--arch-dir <dir>
--scope <scope-key>
--format json|text
```

### Semantics

- `--implementers-of` 仅看 `implementation`
- `--subclasses-of` 仅看 `inheritance`
- `--depth` 仅用于 `--deps-of` / `--used-by`
- 如果多个 scope 且未指定 `--scope`，退出码 1

### Verify

```bash
npm run build
node dist/cli/index.js query --help
node dist/cli/index.js query --summary --scope <scope-key>
```

---

## Phase 4 — `search` Subcommand

### Objectives

实现实体级结构发现命令，不越界承诺调用图。

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/commands/search.ts` | New | Commander search command |
| `src/cli/index.ts` | Modify | Register command |

### Command surface

```bash
archguard search --type interface
archguard search --high-coupling --threshold 8
archguard search --orphans
archguard search --in-cycles
```

公共参数:

```bash
--arch-dir <dir>
--scope <scope-key>
--format json|text
```

明确不实现:

```bash
archguard search --calls ...
```

原因:

- 当前 `ArchJSON` 不包含成员级调用边
- 不应让命令名暗示方法调用精度

### Verify

```bash
npm run build
node dist/cli/index.js search --help
node dist/cli/index.js search --type interface --scope <scope-key>
```

---

## Phase 5 — MCP Server

### Objectives

通过 MCP 暴露与 CLI 一致的 scope-aware 实体级查询能力。

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/mcp/mcp-server.ts` | New | MCP server |
| `src/cli/commands/mcp.ts` | New | Commander wrapper |
| `src/cli/index.ts` | Modify | Register command |
| `package.json` | Modify | Add `@modelcontextprotocol/sdk` |

### Tool surface

建议工具集:

```text
archguard_find_entity
archguard_get_dependents
archguard_get_dependencies
archguard_find_implementers
archguard_find_subclasses
archguard_get_file_entities
archguard_detect_cycles
archguard_summary
```

启动参数:

```bash
archguard mcp --arch-dir ./.archguard --scope <scope-key>
```

规则:

- 单 scope 时可省略 `--scope`
- 多 scope 时必须显式指定
- 启动时立即加载并校验数据

### Verify

```bash
npm run build
node dist/cli/index.js mcp --help
```

---

## Test Matrix

| # | Check | Phase |
|---|-------|------|
| 1 | `manifest.json` created after analyze | 1 |
| 2 | One `arch.json` per non-empty source group | 1 |
| 3 | Go Atlas with non-empty entities persists a scope | 1 |
| 4 | All-empty/all-failed groups produce no scopes and no crash | 1 |
| 5 | One `arch-index.json` per scope | 2 |
| 6 | `archJsonHash` matches persisted `arch.json` | 2 |
| 7 | Missing index rebuilds synchronously and persists | 2 |
| 8 | Hash mismatch rebuilds synchronously and persists | 2 |
| 9 | Multiple scopes without `--scope` fail fast | 2/3/4/5 |
| 10 | `--implementers-of` only follows `implementation` edges | 3 |
| 11 | `--subclasses-of` only follows `inheritance` edges | 3 |
| 12 | `--deps-of` / `--used-by` BFS does not loop on cycles | 3 |
| 13 | `search --type` / `--orphans` / `--high-coupling` / `--in-cycles` work | 4 |
| 14 | No `--calls` flag is exposed | 4 |
| 15 | MCP startup fails fast when scope is ambiguous | 5 |
| 16 | Existing test suite remains green | all |

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Source-group key 不够可读 | CLI 体验一般 | 在 manifest 中加 `label` 字段，但 key 仍保持稳定 |
| 多 scope 项目需要显式 `--scope` | 命令更长 | 这是刻意的精度约束，优先于“省事” |
| 原子写实现不完整 | 可能留下半写状态 | 统一封装到 `query-artifacts.ts`，不要在各处手写 |
| 后续有人重新加回 `--calls` | 工具语义退化 | 在 proposal 与 tests 中都明确禁止 |

---

## Exit Criteria

只有在以下条件全部满足时，本计划才算完成:

1. Proposal 与 plan 对 scope 模型、Atlas 语义、目录结构、命令边界完全一致
2. 代码实现不再依赖“primary arch.json”假设
3. CLI / MCP 都不会在多 scope 下做隐式猜测
4. 文档中不再出现方法级调用查询承诺
