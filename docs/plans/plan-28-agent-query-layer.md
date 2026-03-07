# Plan 28: Agent Query Layer — Development Plan

> Source proposal: `docs/proposals/proposal-agent-query-layer.md`
> Branch: `feat/agent-query-layer`
> Status: Draft (aligned with proposal rev 3)

---

## Overview

本计划按“先纠正数据模型，再暴露命令”的顺序推进。核心变化有三点:

1. 持久化对象从“单一 primary arch.json”改为“每个可查询 source group 一个 query scope”，并区分 parsed / derived
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

1. `DiagramProcessor` 暴露全部可持久化的 query source groups，并标记 `kind: parsed | derived`
2. 修复所有会遗漏 scope 的路径，而不只是 TypeScript package-level disk-cache-hit
3. scope-key 基于稳定源码路径标准化生成，而不是 `path.relative(workDir)`
4. 新增 `.archguard/query/manifest.json`
5. 为每个 scope 写入独立 `<scope-key>/arch.json`
6. 不再引入 `getPrimaryArchJson()`

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/processors/diagram-processor.ts` | Modify | Register all final query scopes (parsed + derived); fix missing-scope paths; add `getQuerySourceGroups()` |
| `src/cli/query/query-manifest.ts` | New | `QueryManifest` types |
| `src/cli/query/query-artifacts.ts` | New | Persist manifest + per-scope `arch.json` (atomic writes with random tmp suffix) |
| `src/cli/commands/analyze.ts` | Modify | Persist all scopes after `processAll()` (including partial success) |
| `tests/unit/cli/processors/diagram-processor-query-scopes.test.ts` | New | Unit tests for `getQuerySourceGroups()` |

### Implementation notes

`DiagramProcessor` 公开的新结构建议如下:

```typescript
export interface QuerySourceGroup {
  key: string;
  sources: string[];
  archJson: ArchJSON;
  kind: 'parsed' | 'derived';
}
```

`getQuerySourceGroups()` 行为要求:

- 返回所有最终可查询的 `ArchJSON` 视图
- 仅包含 `entities.length > 0` 的 group
- 不因为 `extensions.goAtlas` 存在而过滤
- 对派生自父级 scope 的结果标记 `kind: 'derived'`

**前置修复: 所有遗漏 scope 的路径**

当前 `processSourceGroup` 的 scope 丢失不止一条路径:

- TypeScript package-level disk cache 命中时直接使用 `cachedArchJSON`
- C++ 子模块由父级 `ArchJSON` 裁剪得到时，没有统一登记
- 普通 TypeScript 子目录由父级 `ArchJSON` 裁剪得到时，也没有统一登记

因此不能只修一个 disk-cache-hit 分支。必须把“最终用于该 source group 的 `ArchJSON`”统一登记到 query scope 集合，来源可以是解析、内存缓存、磁盘缓存或父级派生。

**scope-key 标准化**

当前 `hashSources()` 直接使用 CLI 传入的路径字符串，导致同一项目用不同路径（`./src` vs `/abs/path/src`）analyze 产生不同 scope-key。并且 `workDir` 不是稳定源码锚点，不能作为 `path.relative()` 基准。修改 `hashSources()` 或在 `getQuerySourceGroups()` 中:

1. 对每个 source 执行 `path.resolve()`
2. 再相对于源码工程根（`workspaceRoot` / detected project root / source root parent）做标准化；若无法确定稳定源码根，则退回 canonical absolute path
3. 排序后拼接计算 SHA-256 前 8 位

manifest 中的 `sources[]` 也存储标准化后的路径。

`query-artifacts.ts` 先实现 Phase 1 最小集:

- `persistQueryScopes(workDir, scopes)`
- 写 `.archguard/query/manifest.json`
- 写 `.archguard/query/<scope-key>/arch.json`
- 所有写入使用随机后缀 tmp 文件 + rename（`arch.json.tmp.<random>`）

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
- 部分 diagram 失败时，成功的 scope 仍然持久化
- 同一项目用相对路径和绝对路径 analyze，产生相同的 scope-key
- derived scope 会被显式标记，不再伪装成 raw parse 结果

---

## Phase 2 — Arch Index + Query Engine

### Objectives

1. 为每个 scope 构建 `arch-index.json`
2. 引入 manifest-aware 的 `QueryEngine`
3. 缺失或陈旧索引时，同步重建并原子写回
4. 多 scope 时要求显式 `scope`
5. 提供最小可用的 scope discovery 信息（至少 `key + label + kind + sources`）

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/query/arch-index.ts` | New | `ArchIndex` type (use normal import, not inline `import()`) |
| `src/cli/query/arch-index-builder.ts` | New | `ArchJSON -> ArchIndex` |
| `src/cli/query/query-engine.ts` | New | Load manifest/scope, validate index, execute queries |
| `src/cli/query/engine-loader.ts` | New | `resolveArchDir()` / `resolveScope()` / `loadEngine()` (提前到 Phase 2，Phase 3 的 CLI 只做参数解析到此模块的桥接) |
| `src/cli/query/query-artifacts.ts` | Modify | Also persist `arch-index.json` |
| `tests/unit/cli/query/arch-index-builder.test.ts` | New | Builder tests |
| `tests/unit/cli/query/query-engine.test.ts` | New | Scope selection and fallback tests |

### Required design constraints

#### 1. Atomic writes

不要使用 fire-and-forget。所有写入必须走:

1. write temp file with random suffix (`<target>.tmp.<crypto.randomUUID().slice(0,8)>`)
2. rename to target

至少覆盖:

- `arch.json`
- `arch-index.json`
- `manifest.json`

随机后缀确保并发进程（如 `query` 和 `mcp` 同时重建 index）不会互相截断 tmp 文件。

#### 2. Hash 基于磁盘字节

`archJsonHash` 必须基于 `arch.json` 的**磁盘字节**计算，不是 parsed object 再 stringify:

- 写入时: `const buf = Buffer.from(JSON.stringify(archJson, null, 2))` → 写 buf → `SHA-256(buf)`
- 加载时: `const buf = await fs.readFile(archJsonPath)` → `SHA-256(buf)` → 与 index 中的 hash 比对
- parse 用 `JSON.parse(buf.toString())`

这避免了 JSON key 顺序变化导致的不必要 index 重建。

#### 3. Scope-aware loading

`QueryEngine.load(queryRoot, scope?)` 逻辑:

1. 读取 `manifest.json`
2. `scopes.length === 0` -> 报错
3. `scopes.length === 1 && scope 未指定` -> 自动选中
4. `scopes.length > 1 && scope 未指定` -> 报错并列出可选 scope
5. 读取 `<scope-key>/arch.json` 为原始 `Buffer`
6. 计算 `Buffer` 的 SHA-256
7. 校验 `<scope-key>/arch-index.json`（hash 比对）
8. 必要时同步重建 index 并原子写回

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

补充约束:

- 对 `kind: "derived"` 的 scope，查询语义按“裁剪后的局部视图”解释
- CLI/MCP 输出中必须显式标注该 scope 为 derived，避免把局部结果当成全局事实

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
- 多 scope 报错信息包含 `key + label + kind + sources`

---

## Phase 3 — `query` Subcommand

### Objectives

实现 scope-aware 的实体级查询命令。

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/commands/query.ts` | New | Commander query command (参数解析 → `engine-loader` 桥接) |
| `src/cli/index.ts` | Modify | Register command |

注意: `engine-loader.ts` 已在 Phase 2 实现。本阶段只做 CLI 参数到 `loadEngine()` 的桥接。

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

需要配套一个 scope 发现入口，至少满足其一:

- `archguard query --list-scopes`
- 或在多 scope 报错时打印完整候选列表

### Semantics

- `--implementers-of` 仅看 `implementation`
- `--subclasses-of` 仅看 `inheritance`
- `--depth` 仅用于 `--deps-of` / `--used-by`:
  - depth=1 = 一跳直接邻居（不包含起始实体本身）
  - 默认 1，硬上限 5
  - `--deps-of` 沿 `dependencies` 方向，`--used-by` 沿 `dependents` 方向
- **所有 relation type 都参与 BFS 遍历**（不做类型过滤）
  - BFS + visited set 防环
- 如果多个 scope 且未指定 `--scope`，退出码 1
- 若选中的 scope 是 `derived`，输出中显式提示这是裁剪视图

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

### Pre-requisite: SDK Spike

在开始 Phase 5 实现前，必须先完成一个 spike 验证 `@modelcontextprotocol/sdk`:

1. ESM 兼容性: 项目是 `"type": "module"`，确认 SDK 支持纯 ESM import
2. stdio transport: 确认 SDK 提供 stdio server transport（不需要 HTTP）
3. bundle size: 评估对 CLI 安装体积的影响
4. optional dependency: 评估是否应设为 `optionalDependencies`（不用 MCP 的用户无需安装）

spike 失败时，考虑手写轻量 JSON-RPC stdio server 替代。

### Objectives

通过 MCP 暴露与 CLI 一致的 scope-aware 实体级查询能力。

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/mcp/mcp-server.ts` | New | MCP server |
| `src/cli/commands/mcp.ts` | New | Commander wrapper |
| `src/cli/index.ts` | Modify | Register command |
| `package.json` | Modify | Add `@modelcontextprotocol/sdk` (or lightweight alternative per spike result) |

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
| 5 | Disk-cache-hit TypeScript scopes appear in `getQuerySourceGroups()` | 1 |
| 6 | Same sources via relative/absolute paths produce identical scope-key | 1 |
| 7 | Partial diagram failure still persists successful scopes | 1 |
| 8 | One `arch-index.json` per scope | 2 |
| 9 | `archJsonHash` matches `arch.json` disk bytes (not re-serialized) | 2 |
| 10 | Missing index rebuilds synchronously and persists | 2 |
| 11 | Hash mismatch rebuilds synchronously and persists | 2 |
| 12 | Concurrent index rebuild uses random tmp suffix (no file collision) | 2 |
| 13 | Multiple scopes without `--scope` fail fast | 2/3/4/5 |
| 14 | `--implementers-of` only follows `implementation` edges | 3 |
| 15 | `--subclasses-of` only follows `inheritance` edges | 3 |
| 16 | `--deps-of` / `--used-by` BFS does not loop on cycles | 3 |
| 17 | `--depth 1` returns one-hop neighbors only | 3 |
| 18 | `search --type` / `--orphans` / `--high-coupling` / `--in-cycles` work | 4 |
| 19 | No `--calls` flag is exposed | 4 |
| 20 | MCP SDK spike passes (ESM + stdio + bundle size) | 5 |
| 21 | MCP startup fails fast when scope is ambiguous | 5 |
| 22 | Existing test suite remains green | all |

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Parsed / derived scope 混用导致语义误读 | 查询结果被误当成全局事实 | 在 manifest 与 CLI/MCP 输出里强制显示 `kind`，必要时只默认暴露 parsed scope |
| 多 scope 项目需要显式 `--scope` | 命令更长 | 这是刻意的精度约束，优先于”省事” |
| 原子写实现不完整 | 可能留下半写状态 | 统一封装到 `query-artifacts.ts`，随机 tmp 后缀，不要在各处手写 |
| 后续有人重新加回 `--calls` | 工具语义退化 | 在 proposal 与 tests 中都明确禁止 |
| `@modelcontextprotocol/sdk` ESM 不兼容 | Phase 5 阻塞 | 前置 spike 验证；备选方案: 手写轻量 JSON-RPC stdio |
| `scope-key` 对 `workDir` 敏感 | 同项目不同入口产生不同 key | 改为基于稳定源码根标准化，不再使用 `path.relative(workDir)` |
| scope 丢失 | `getQuerySourceGroups()` 返回不完整 | Phase 1 必须覆盖所有 `processSourceGroup` 路径统一登记最终 query scope，而不只是修 disk-cache-hit |

---

## Exit Criteria

只有在以下条件全部满足时，本计划才算完成:

1. Proposal 与 plan 对 scope 模型、Atlas 语义、目录结构、命令边界完全一致
2. 代码实现不再依赖“primary arch.json”假设
3. CLI / MCP 都不会在多 scope 下做隐式猜测
4. 文档中不再出现方法级调用查询承诺
