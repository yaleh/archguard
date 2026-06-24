# 融合 Codebase Memory 作为 ArchGuard 图谱后端

> 状态：草案
> 范围：将 `codebase-memory-mcp` 作为 ArchGuard 内部可选图谱后端集成，
>      对外仍只暴露 ArchGuard 的 CLI / MCP surface。
> 分支：待规划

---

## 摘要

ArchGuard 不应该从零重写 `codebase-memory-mcp` 已经具备的完整图谱索引、搜索、
调用链追踪、语义检索和 Cypher-like 查询能力。更合理的方案是：把
`codebase-memory-mcp` 作为 ArchGuard 内部管理的本地图谱后端，通过 ArchGuard
自己的 CLI / MCP 工具对外提供统一能力。

对外契约保持 ArchGuard-only：

- 用户只安装 `archguard`。
- Agent 只配置 `archguard mcp`。
- CLI 和 MCP tool name 都保持在 `archguard_*` 命名空间下。
- `codebase-memory-mcp` 是内部实现细节，不要求用户直接安装、配置或调用。

这样 ArchGuard 可以获得高性能图谱索引和查询能力，同时保留自身已有优势：
架构图、Go Atlas、静态测试分析、git-history 分析，以及 registry 驱动的
CLI/MCP/docs/agent surface。

---

## 背景与动机

ArchGuard 和 `codebase-memory-mcp` 在“代码结构分析”这一层有重叠，但产品目标不同。

ArchGuard 更强的方向：

- 架构图和 Mermaid 渲染
- Go Atlas 的 package / capability / goroutine / flow 多层架构视图
- ArchJSON 和 query artifacts
- 静态测试质量分析与 inferred coverage
- git churn、ownership、co-change、risk 分析
- typed command/tool metadata registry，驱动 CLI help、MCP descriptions、docs 和
  agent guidance

`codebase-memory-mcp` 更强的方向：

- 高速本地图谱索引
- SQLite graph store
- `search_graph` 结构化搜索与分页
- `trace_path` 调用链 / data-flow / cross-service 追踪
- `query_graph` Cypher-like 图查询
- `get_code_snippet`
- 可选 semantic search
- auto-index、watcher、压缩图谱 artifact
- 多 agent 安装和 hook 集成

如果 ArchGuard 完整重写 `codebase-memory-mcp`，成本会很高，也会分散 ArchGuard
在架构分析和可视化上的核心优势。更低风险、更快落地的路径是通过 adapter 融合。

---

## 非目标

- 不直接通过 ArchGuard MCP 暴露 `codebase-memory-mcp` 原始 tool name。
- 不要求用户手动安装或配置 `codebase-memory-mcp`。
- 第一阶段不替换 `.archguard/` 原生 artifacts。
- 不把 `codebase-memory-mcp` 重写成 TypeScript。
- 第一阶段不让每次 `archguard analyze` 都强制执行图谱索引。
- 在语义对齐被验证前，不承诺只有一份物理数据源。

---

## 当前重叠能力

| 能力 | ArchGuard 当前 | `codebase-memory-mcp` |
|---|---|---|
| 项目分析 / 索引 | `archguard_analyze` | `index_repository` |
| 实体 / 符号搜索 | `find_entity`, `get_file_entities` | `search_graph` |
| 依赖 / 调用查询 | `get_dependencies`, `get_dependents`, `find_callers` | `trace_path`, `query_graph` |
| 架构概览 | `summary`, package stats, Atlas | `get_architecture`, `get_graph_schema` |
| 变更影响 | git history risk/co-change/ownership | `detect_changes` |
| 代码片段 | 当前偏 entity summary，不主打 snippet | `get_code_snippet` |
| 多跳图查询 | 固定工具组合 | `query_graph` |
| 测试关系 | 静态 test analyzer | `TESTS` graph edges |
| 可视化 | Mermaid / Atlas diagrams | 可选 3D graph UI |

这些能力有重叠，但数据模型并不等价：

- ArchGuard artifacts 面向 ArchJSON、query、diagram、test analysis、git-history。
- `codebase-memory-mcp` 存储的是通用 SQLite graph，包括 nodes、edges、properties 和
  图查询 primitive。

因此第一阶段应采用“一个 ArchGuard surface + 两个内部后端”，而不是强行合并成单一数据源。

---

## 目标架构

```text
User / Agent
  -> archguard CLI / archguard MCP
       -> ArchGuard native analyzer
       -> ArchGuard metadata registry
       -> Graph backend adapter
            -> managed codebase-memory-mcp binary
            -> codebase-memory-mcp cli <tool> <json>
```

### 对外能力面

ArchGuard 用自己的命名暴露图谱能力：

- `archguard graph index`
- `archguard graph search`
- `archguard graph trace`
- `archguard graph query`
- `archguard graph snippet`
- `archguard graph doctor`

MCP tools：

- `archguard_index_graph`
- `archguard_search_graph`
- `archguard_trace_path`
- `archguard_query_graph`
- `archguard_get_code_snippet`
- `archguard_detect_change_impact`

`codebase-memory-mcp` 的 CLI 和 MCP tools 不直接暴露给用户或 agent。

### 内部适配器

新增内部 adapter 模块：

```ts
interface GraphBackend {
  doctor(): Promise<GraphBackendStatus>;
  indexRepository(input: GraphIndexInput): Promise<GraphIndexResult>;
  searchGraph(input: GraphSearchInput): Promise<GraphSearchResult>;
  tracePath(input: GraphTraceInput): Promise<GraphTraceResult>;
  queryGraph(input: GraphQueryInput): Promise<GraphQueryResult>;
  getCodeSnippet(input: GraphSnippetInput): Promise<GraphSnippetResult>;
  detectChanges(input: GraphChangeInput): Promise<GraphChangeResult>;
}
```

第一版实现：

```text
CodebaseMemoryGraphBackend
  -> 解析 managed binary 路径
  -> 执行 `codebase-memory-mcp cli <tool> <json>`
  -> 解析 stdout / stderr
  -> 归一化结果和错误为 ArchGuard 类型
```

第一阶段不要在 ArchGuard 内部再启动并调用 `codebase-memory-mcp` 的 MCP server。
优先使用它的 CLI mode。subprocess 边界更简单、更容易测试，也避免 MCP stdio 嵌套。

---

## Binary 管理策略

### 阶段 1：可选 npm 依赖

先把 `codebase-memory-mcp` 作为 optional dependency：

```json
{
  "optionalDependencies": {
    "codebase-memory-mcp": "^0.8.1"
  }
}
```

它的 npm wrapper 会在 postinstall 下载对应平台二进制，并提供
`codebase-memory-mcp` bin shim。

ArchGuard 必须把它视为可选能力：

- package 或 binary 缺失时，graph tools 返回可执行的错误提示。
- 原生 `archguard analyze` 仍然可用。
- `archguard graph doctor` 输出安装状态和恢复命令。

### 阶段 2：ArchGuard 托管二进制缓存

如果 optional dependency 对目标用户不够可靠，再把 binary 管理收进 ArchGuard：

```text
~/.cache/archguard/bin/codebase-memory-mcp/<version>/<platform>/<binary>
```

收益：

- ArchGuard 控制版本 pinning。
- ArchGuard 可以支持代理和镜像配置。
- ArchGuard 可以校验 checksum。
- 企业或离线环境可以提前预置 binary cache。

### 阶段 3：内置源码或源码构建

只有当 release binary 依赖不可接受时，才考虑 vendoring 源码或源码构建。
这不适合第一阶段，因为会把 C 构建、跨平台编译和发布复杂度带入 ArchGuard。

---

## 存储策略

第一版不要追求只有一份数据源。

初始存储布局：

```text
<project>/.archguard/
  query/...
  diagrams/...
  graph/
    codebase-memory/
      optional adapter metadata

~/.cache/archguard/codebase-memory/
  codebase-memory-mcp SQLite databases, 或 CBM_CACHE_DIR override
```

推荐 adapter 环境变量：

```text
CBM_CACHE_DIR=<project>/.archguard/graph/codebase-memory
```

这样 graph 数据归属在 ArchGuard work directory 下，用户更容易理解，也减少隐藏的全局状态。
全局 cache 可以作为后续性能优化。

长期统一数据源之前，需要先完成这些语义映射：

- ArchGuard `Entity` / `Relation` / scope key
- codebase-memory node label 和 edge type
- package / class / method diagram level
- Go Atlas layers
- static test analysis metadata
- git-history artifacts

在这些语义验证完成前，两套内部存储是可接受的，因为用户只接触一个 ArchGuard surface。

---

## `archguard_analyze` 集成方式

`archguard_analyze` 应支持图谱索引 sidecar，但第一阶段不默认强制开启。

新增 MCP 参数和 CLI flag：

```ts
includeGraph?: boolean;
graphMode?: 'fast' | 'moderate' | 'full';
graphStrict?: boolean;
```

CLI：

```bash
archguard analyze --include-graph
archguard analyze --include-graph --graph-mode fast
archguard graph index --mode moderate
```

默认行为：

```text
archguard_analyze
  -> 执行 ArchGuard 原生分析
  -> 如果 includeGraph=true，则执行 graph index sidecar
  -> 如果 graph indexing 失败且 graphStrict=false，返回原生分析成功 + warning
  -> 如果 graph indexing 失败且 graphStrict=true，整个命令 / tool 失败
```

理由：

- 原生 ArchGuard analysis 应保持稳定、可预期。
- graph indexing 可能依赖 managed binary，耗时更长，也占用更多磁盘。
- Agent 可以在搜索、调用链、snippet、Cypher 工作流中显式请求 graph indexing。

Agent guidance 应写清楚：

- 架构图、Atlas、测试分析、git-history 分析：先调用 `archguard_analyze`。
- 代码搜索、snippet、调用链追踪、Cypher-like 图查询：先调用
  `archguard_index_graph`，或调用 `archguard_analyze(includeGraph: true)`。

---

## Tool 映射

| ArchGuard tool | 内部 codebase-memory 调用 | 说明 |
|---|---|---|
| `archguard_index_graph` | `index_repository` | 传入 `repo_path`, `mode`，后续可支持 persistence |
| `archguard_search_graph` | `search_graph` | 归一化 pagination 字段 |
| `archguard_trace_path` | `trace_path` | 暴露 calls / data_flow / cross_service modes |
| `archguard_query_graph` | `query_graph` | 明确标记为高级图查询能力 |
| `archguard_get_code_snippet` | `get_code_snippet` | guidance：歧义时先 search |
| `archguard_detect_change_impact` | `detect_changes` | 和 ArchGuard git-history risk 区分清楚 |

第一阶段现有 ArchGuard tools 继续走原生实现：

- `archguard_summary`
- `archguard_get_dependencies`
- `archguard_get_dependents`
- `archguard_find_entity`
- `archguard_detect_cycles`
- Go Atlas tools
- test-analysis tools
- git-history tools

后续可以让部分重叠查询工具可选使用 graph backend，并保留 `.archguard/query` fallback。

---

## Metadata Registry 集成

所有新增 graph tools 都必须加入 `src/cli/metadata/registry.ts`。

registry entry 必须包含：

- CLI equivalent
- MCP parameters
- `useWhen`
- `callFirst`
- recovery guidance
- limitations
- verification hints

示例 agent guidance：

```text
archguard_search_graph:
  Use when: Search indexed code symbols, routes, files, or graph nodes.
  Call first: archguard_index_graph.
  Recovery: If the project is not indexed, call archguard_index_graph and retry.
  Limit: Results come from the code graph backend and may be stale until re-indexed.
```

Docs 和测试继续沿用现有 generated-surface 模型：

- CLI catalog
- structured help
- MCP descriptions
- README blocks
- user-guide MCP/CLI docs
- agent-surface docs

---

## 错误处理

把后端失败归一化成 ArchGuard 风格错误：

| 后端失败 | ArchGuard 响应 |
|---|---|
| binary 缺失 | `Graph backend unavailable. Run archguard graph doctor.` |
| postinstall / download 失败 | 包含平台、期望版本和恢复方式 |
| project 未索引 | call-first recovery：`archguard_index_graph` |
| 平台不支持 | graph backend unavailable，原生 ArchGuard 仍可用 |
| 后端输出非法 JSON | adapter error，保留 stderr 诊断 |
| 后端超时 | 提供 retry guidance 和 `fast` mode 建议 |
| indexing 失败 | 包含后端 hint；除非 strict，否则保留 native analyze 成功结果 |

Graph tools 不应该静默 fallback 到过期的 native query artifacts，除非 tool description
明确说明。显式索引错误比返回 stale 数据更安全。

---

## 测试计划

### 单元测试

- binary resolver：
  - 能找到 npm dependency binary
  - 支持 configured override path
  - binary 缺失时给出明确状态
- adapter command construction：
  - JSON 通过参数传递，不使用 shell interpolation
  - 设置 `CBM_CACHE_DIR`
  - 正确处理 stdout / stderr / exit code
- result normalization：
  - 解析成功的 MCP CLI envelope
  - 把后端错误映射成 ArchGuard 错误
- metadata registry：
  - 新 graph tools 出现在 baseline
  - 有 call-first guidance
  - 有 CLI mappings

### 集成测试

使用小型 fixture 仓库：

```text
tests/fixtures/graph-backend/simple-ts/
```

测试流程：

```bash
npm run build
node dist/cli/index.js graph doctor
node dist/cli/index.js graph index --project-root <fixture>
node dist/cli/index.js graph search --query Handler --project-root <fixture>
node dist/cli/index.js graph trace --function-name main --project-root <fixture>
```

### MCP 端到端测试

MCP listTools 可以用 in-process MCP client；实际 graph backend 调用应覆盖 subprocess adapter：

- `listTools` 只暴露 ArchGuard graph tools。
- `archguard_index_graph` 能索引 fixture。
- `archguard_search_graph` 返回期望 symbols。
- `archguard_get_code_snippet` 返回源码文本。
- 后端原始 tool names，例如 `search_graph`，不会直接暴露。

### analyze sidecar 端到端测试

```text
archguard_analyze(includeGraph: true)
  -> native artifacts exist
  -> graph backend index exists
  -> graph search succeeds
```

失败模式 E2E：

```text
archguard_analyze(includeGraph: true, graphStrict: false)
  with missing backend
  -> native analysis succeeds
  -> result includes graph warning
```

---

## 分阶段实施计划

### 里程碑 1：适配器基础

- 新增 `GraphBackend` interface。
- 新增 `CodebaseMemoryGraphBackend`。
- 新增 binary resolver 和 `graph doctor`。
- 暂不加 MCP tools。

### 里程碑 2：CLI graph 命令

- 新增 `archguard graph index/search/trace/query/snippet`。
- 通过 subprocess adapter 调用后端。
- 增加 fixture-based CLI E2E。

### 里程碑 3：MCP graph tools

- 新增 ArchGuard 命名的 MCP tools。
- 增加 metadata registry entries。
- 更新 generated docs。
- 增加 MCP E2E。

### 里程碑 4：analyze sidecar

- 新增 `includeGraph`, `graphMode`, `graphStrict`。
- analyze result 中返回 graph warnings。
- 更新 agent guidance 和 E2E。

### 里程碑 5：查询 provider 收敛

- 新增 `GraphQueryProvider`。
- 让部分现有工具可选使用 graph backend：
  - `find_callers`
  - code snippet retrieval
  - broader symbol search
- 保留 native fallback。

### 里程碑 6：存储收敛评估

- 在 fixtures 上对比 ArchGuard query artifacts 和 backend graph results。
- 决定继续保留两套 store，还是把 ArchGuard 数据写入 graph，或从 graph backend 派生部分
  query artifacts。

---

## 风险

### 额外 binary 依赖

风险：optional dependency 下载失败，或平台支持滞后。

缓解：

- graph backend 默认可选
- `graph doctor`
- 明确 recovery messages
- 后续 ArchGuard-managed binary cache

### 结果语义不一致

风险：ArchGuard dependency 查询结果和 graph trace 结果不同。

缓解：

- 第一阶段把 graph tools 明确标记为 graph-specific
- 不静默替换现有 tools
- 在 convergence 前做 parity experiments

### Tool budget 增长

风险：新增 graph tools 增加 MCP token/tool selection 压力。

缓解：

- registry descriptions 保持简洁
- 能合并的 graph tools 尽量合并
- 如果 tool budget 紧张，考虑一个 multiplexed `archguard_graph` tool
- 继续保留 generated docs 和 drift tests

### 双 store stale 问题

风险：`.archguard/query` 和 codebase graph 不一致。

缓解：

- 显式 `includeGraph`
- result timestamps / index status
- recovery guidance 提醒 re-index
- 后续在 `.archguard/graph/` 下记录 shared freshness metadata

---

## 开放问题

- 稳定后，MCP 场景下 `includeGraph` 是否默认 true？
- graph cache 默认应该放在 `.archguard/graph/`，还是全局 cache？
- ArchGuard 是否直接暴露 raw `query_graph`，还是先限制为安全 query templates？
- `archguard_search_graph` 是否应合并 native ArchGuard entities 和 backend graph results？
- code snippet 是否应成为 ArchGuard 通用能力，并在有 graph backend 时由 graph 支撑？
- `detect_changes` 是否保留为独立 graph change impact，还是和 ArchGuard git-history risk 合并？

---

## 建议

推进 adapter-based integration。

不要完整重写 `codebase-memory-mcp`。把它作为 ArchGuard 内部图谱后端使用，隐藏在
ArchGuard registry-driven CLI/MCP/docs surface 后面；第一阶段让 graph indexing 可选、
可观察、可回退；等语义一致性和 freshness 机制被验证后，再逐步收敛重叠查询能力。
