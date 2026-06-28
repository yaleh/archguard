# ArchGuard 接入 Codebase Memory MCP 查询后端方案

> 状态：提案
> 方向：方向 1 - 为 ArchGuard 查询能力增加可选外部图后端
> 范围：CLI `query` 命令、MCP 查询类工具；默认不改变 ArchGuard 分析产物与现有行为
> 依赖：现有 `.archguard/query` 产物；可选 `codebase-memory-mcp` CLI

---

## 背景

ArchGuard 当前的查询能力以 `archguard analyze` 生成的本地分析产物为中心：

- `.archguard/query/manifest.json`
- `.archguard/query/<scope>/arch.json`
- `.archguard/query/<scope>/arch-index.json`

`QueryEngine` 基于这些产物提供实体查找、依赖遍历、包级统计、循环检测、测试分析视图和调用图查询。这是 ArchGuard 应该保留的默认路径，因为它的数据模型可控、可复现，并且和 ArchGuard 特有能力绑定紧密，例如 Atlas 分析、测试分析、git history、架构图生成等。

`codebase-memory-mcp` 解决的是相邻但不同的问题：它维护一个持久化的 SQLite 知识图谱，并通过 MCP/CLI 暴露 `search_graph`、`trace_path`、`query_graph`、`get_code_snippet`、`get_architecture` 等工具。它更偏向 agent 在大型、多语言代码库里的结构化探索，尤其适合符号搜索、调用链追踪、源码片段读取、架构概览和复杂图查询。

因此，方向 1 的核心不是用 Codebase Memory 替换 ArchGuard，而是给 ArchGuard 增加一个可选查询后端：当 `.archguard/query` 缺失、过期、结果为空，或者 ArchGuard 当前查询模型覆盖不够时，可以显式或自动降级到 Codebase Memory。

---

## 问题描述

现在 ArchGuard 查询工具强依赖 `.archguard/query` 产物。如果项目没有执行过 `archguard analyze`，或者产物已经缺失，MCP 工具如 `archguard_find_entity`、`archguard_find_callers` 会提示先运行 `archguard_analyze`。此时 agent 通常会退回到 grep、文件搜索和手动读取。

这个 fallback 有几个问题：

1. **结构问题会退化成文本搜索**：grep 找到的是字符串，不是定义、调用点、调用者、被调用者或类型引用。
2. **token 与延迟成本更高**：agent 往往需要多轮 search/read 才能回答一个简单的“这个符号在哪里被调用”。
3. **重复建设**：如果同一个仓库已经被 `codebase-memory-mcp` 索引，本地结构图已经存在，但 ArchGuard 无法复用它。

目标是保留 ArchGuard 自有产物的权威地位，同时让通用代码发现类查询可以选择委托给 Codebase Memory。

---

## 目标

- 增加一个可选的 `codebase-memory-mcp` 查询后端适配层。
- 默认仍使用 ArchGuard 的 `.archguard/query` 产物。
- 支持符号搜索、文件实体查询、调用者/被调用者追踪、源码片段和架构概览的 fallback 或 enrichment。
- 在响应里明确标注结果来源，调用方能区分结果来自 `archguard`、`codebase-memory` 还是组合结果。
- 保持 Codebase Memory 为可选依赖：不强制安装、不自动安装、不在普通查询路径里自动索引。
- 将外部后端差异隔离在 adapter 边界内，避免 CLI/MCP 工具直接拼 subprocess 调用。

## 非目标

- 不替换 `archguard analyze`、ArchJSON、Mermaid/PlantUML 生成、Atlas、测试分析或 git history 能力。
- 不把 Codebase Memory 的 SQLite schema 导入 ArchGuard。
- 不在 ArchGuard 内重实现 Codebase Memory 的 Cypher-like 查询、语义搜索或 Hybrid LSP。
- 不在普通查询过程中修改 Codebase Memory 索引。
- 不让现有 ArchGuard CLI/MCP 命令新增硬运行时依赖。

---

## 总体设计

### 新增模块边界

新增一个窄集成层：

```text
src/integrations/codebase-memory/
  types.ts
  client.ts
  project-resolver.ts
  adapter.ts
```

职责划分：

| 文件 | 职责 |
|---|---|
| `types.ts` | 定义后端选择、诊断信息、结果来源、Codebase Memory 响应映射类型 |
| `client.ts` | 负责调用 `codebase-memory-mcp cli <tool> <json>`，处理 timeout、stdout/stderr、JSON parse |
| `project-resolver.ts` | 根据 `projectRoot` 解析 Codebase Memory project |
| `adapter.ts` | 将 ArchGuard 查询意图映射到 Codebase Memory 工具调用 |

CLI 和 MCP 工具只依赖 adapter，不直接依赖 subprocess 细节。

### 进程调用方式

第一阶段使用 Codebase Memory 的 CLI 模式，而不是直接在 ArchGuard 内管理一个 MCP stdio 连接：

```bash
codebase-memory-mcp cli list_projects
codebase-memory-mcp cli search_graph '{"name_pattern": ".*Handler.*"}'
codebase-memory-mcp cli trace_path '{"function_name": "OrderHandler", "direction": "both"}'
codebase-memory-mcp cli get_code_snippet '{"qualified_name": "pkg.orders.OrderHandler"}'
```

这样做的好处：

- 不需要在 ArchGuard 内管理长生命周期 MCP 子进程。
- 单元测试容易 mock。
- 用户可以直接复制命令复现失败场景。
- 后续如需优化延迟，可以在 `CodebaseMemoryClient` 接口后面替换为 stdio-MCP 实现，而不用改上层 CLI/MCP 工具。

---

## 后端选择

为查询类入口增加后端选项：

```text
--backend archguard|codebase-memory|auto
```

语义如下：

| 后端 | 行为 |
|---|---|
| `archguard` | 当前行为。读取 `.archguard/query`，使用 `QueryEngine` 查询。 |
| `codebase-memory` | 直接调用 Codebase Memory。无需 `.archguard/query`，但要求目标仓库已被 Codebase Memory 索引。 |
| `auto` | 优先使用 ArchGuard；当产物缺失、过期、结果为空或查询不支持时，fallback 到 Codebase Memory。 |

默认值保持 `archguard`，保证现有行为稳定。MCP 工具未来是否默认使用 `auto`，需要等适配层稳定后再决定。

### 配置示例

可以在 ArchGuard 配置中增加可选配置：

```json
{
  "queryBackends": {
    "primary": "archguard",
    "fallback": "codebase-memory",
    "codebaseMemory": {
      "command": "codebase-memory-mcp",
      "project": "auto",
      "autoIndex": false,
      "timeoutMs": 10000,
      "maxResults": 20
    }
  }
}
```

CLI/MCP 显式参数优先级高于配置：

```bash
archguard query --entity OrderHandler --backend auto
archguard query --callers OrderHandler.handle --backend codebase-memory --cbm-project my-repo
```

MCP 工具可以扩展可选字段：

```typescript
{
  projectRoot?: string;
  backend?: "archguard" | "codebase-memory" | "auto";
  codebaseMemoryProject?: string;
}
```

---

## 安装与依赖处理

这里需要区分两类依赖：

1. **ArchGuard 内部后端依赖**：ArchGuard 通过 `codebase-memory-mcp cli ...` 调用外部 binary。
2. **Agent 直接可见的 MCP tool 依赖**：Claude/Codex 等 agent 自己注册并调用 `codebase-memory-mcp` MCP server。

方向 1 应优先实现第一类：ArchGuard 自己通过 CLI 后端调用 Codebase Memory。这样 ArchGuard 的 MCP surface 对 agent 仍然是 `archguard_*` 工具，不要求 agent 同时注册两个 MCP server。agent 只需要知道 ArchGuard 有一个可选 `backend` 参数，真正的 Codebase Memory 调用由 ArchGuard adapter 隔离。

### 默认安装策略

`codebase-memory-mcp` 不应进入 ArchGuard 的硬依赖：

- 不加入 `dependencies`，避免 `npm install archguard` 时强制安装 native/static binary。
- 不在 `postinstall` 里下载 binary，避免供应链、代理、离线安装和 CI 可复现性问题。
- 不在 `archguard mcp` 启动时强制检查 Codebase Memory。
- 只有当用户选择 `--backend codebase-memory`、`--backend auto`，或运行专门的 doctor/onboarding 命令时，才检查它是否可用。

### 推荐的命令契约

如果当前分支已有 agent onboarding 命令，可以直接挂到其中；如果没有，则先按这个契约新增：

```bash
archguard config doctor codebase-memory
archguard install codebase-memory
archguard update codebase-memory
```

职责划分：

| 命令 | 职责 |
|---|---|
| `archguard config doctor codebase-memory` | 只检查，不修改。检测 binary、版本、CLI 可调用性、project 是否已索引。 |
| `archguard install codebase-memory` | 明确安装/配置外部依赖。可提示官方安装命令，或在用户确认后下载 binary。 |
| `archguard update codebase-memory` | 显式更新外部 binary。默认不自动更新。 |

如果 PR #60 的 `archguard install/update/config doctor` 已合入，应复用那套 provider adapter 和 dry-run/force/backup 语义，不单独发明第二套安装框架。

### Doctor 检查项

`config doctor codebase-memory` 至少检查：

1. `codebase-memory-mcp` 是否在 PATH，或配置的 `queryBackends.codebaseMemory.command` 是否存在。
2. `codebase-memory-mcp cli list_projects` 是否能执行并返回 JSON。
3. 当前 `projectRoot` 是否能解析到唯一 Codebase Memory project。
4. project 是否已索引；未索引时给出 `index_repository` 命令。
5. 可选：调用 `index_status`，把 stale/failed 状态作为 diagnostics。
6. 可选：执行一次轻量 `search_graph` smoke，确认图查询链路可用。

doctor 输出示例：

```json
{
  "ok": false,
  "backend": "codebase-memory",
  "binary": {
    "found": true,
    "path": "/Users/me/.local/bin/codebase-memory-mcp"
  },
  "project": {
    "found": false,
    "root": "/repo"
  },
  "nextSteps": [
    "codebase-memory-mcp cli index_repository '{\"repo_path\":\"/repo\"}'"
  ]
}
```

### Install 行为

`archguard install codebase-memory` 不应静默修改用户环境。建议分两档：

1. **提示模式**：默认只打印官方安装命令和 ArchGuard 配置示例。
2. **执行模式**：用户显式传 `--write` 或 `--yes` 后，才下载/安装 binary 或写入配置。

示例：

```bash
archguard install codebase-memory --dry-run
archguard install codebase-memory --write
archguard install codebase-memory --command /custom/bin/codebase-memory-mcp
```

安装完成后只保证 binary 可用，不自动索引所有仓库。索引仍由用户显式执行，或者通过单独命令触发：

```bash
codebase-memory-mcp cli index_repository '{"repo_path": "/repo"}'
```

后续可以增加 ArchGuard 包装命令：

```bash
archguard query-backend index codebase-memory --project-root /repo
```

但这应属于后续增强，不是第一阶段必需能力。

### 如果选择依赖 MCP tool 而不是 CLI binary

如果后续决定让 ArchGuard 直接依赖“agent 已注册的 Codebase Memory MCP tool”，安装模型会明显更复杂，因为 ArchGuard 无法可靠控制 agent host 的 MCP 注册状态。需要额外处理：

- Claude/Codex/Cursor 等 provider 的 MCP 配置位置不同。
- ArchGuard MCP server 内部不能假设另一个 MCP server 已在同一个 agent session 中可调用。
- MCP tool-to-tool 调用通常不是稳定的跨 host 契约。
- doctor 需要检查 agent host 配置，而不是只检查本机 binary。

因此第一阶段不建议走“ArchGuard 调用 agent 侧 MCP tool”的设计。更稳妥的方案是：ArchGuard adapter 调用 `codebase-memory-mcp cli`；agent 如果也想直接使用 Codebase Memory，可以由独立 onboarding 命令把它注册到 agent 配置中，但这不是 ArchGuard 查询后端可用的前置条件。

---

## Codebase Memory 项目解析

当配置里的 `codebaseMemory.project` 是 `auto` 时，ArchGuard 按如下规则解析 project：

1. 调用 `codebase-memory-mcp cli list_projects`。
2. 优先选择 root path 与 `projectRoot` 完全匹配的 project。
3. 如果没有完全匹配，则尝试用仓库目录名匹配唯一 project。
4. 如果找不到或存在歧义，返回可执行的诊断信息。

示例诊断：

```text
Codebase Memory 尚未索引当前仓库：/path/to/repo
请先运行：
  codebase-memory-mcp cli index_repository '{"repo_path": "/path/to/repo"}'
```

普通查询路径不自动执行 `index_repository`。索引可能成本较高，也会写入持久化状态，必须由用户显式触发。

---

## 查询映射

### 实体搜索：`findEntity`

ArchGuard 当前路径：

```typescript
engine.findEntity(name)
```

Codebase Memory 映射：

```json
{
  "tool": "search_graph",
  "args": {
    "project": "<resolved-project>",
    "name_pattern": ".*<escaped-name>.*",
    "limit": 20
  }
}
```

规则：

- `auto` 模式下先执行 ArchGuard 精确查询。
- 如果 ArchGuard 结果为空，再调用 Codebase Memory。
- Codebase Memory 返回 exact hit 与模糊/模式匹配 hit 时，响应中保留排序和来源。
- 不强行把 Codebase Memory node 完全伪装成 ArchGuard `Entity`；无法无损映射的字段放入 `raw` 或 `source`。

### 文件实体：`getFileEntities`

ArchGuard 当前路径：

```typescript
engine.getFileEntities(filePath)
```

Codebase Memory 映射：

```json
{
  "tool": "search_graph",
  "args": {
    "project": "<resolved-project>",
    "file_pattern": "src/path/to/file.ts",
    "limit": 100
  }
}
```

规则：

- Codebase Memory 可能返回 function、method、class、variable、route、module 等多类节点。
- ArchGuard 响应应按文件聚合，输出紧凑实体列表。
- 不假设两边 schema 一一对应。

### 调用者/被调用者：`findCallers` 与依赖追踪

ArchGuard 当前路径：

```typescript
relationQueryService.findCallers(entityName, depth)
```

Codebase Memory 映射：

```json
{
  "tool": "trace_path",
  "args": {
    "project": "<resolved-project>",
    "function_name": "<entity-or-method-name>",
    "direction": "inbound",
    "depth": 2,
    "mode": "calls"
  }
}
```

规则：

- `direction: "inbound"` 映射 callers。
- `direction: "outbound"` 映射 callees/dependencies。
- `trace_path` 更依赖精确名称或 qualified name；如果直接 trace 失败，adapter 应调用 `search_graph` 返回候选项，让调用方消歧。

### 源码片段：`get_code_snippet`

ArchGuard 当前没有专门的 snippet 查询。Codebase Memory 可作为 enrichment：

```json
{
  "tool": "get_code_snippet",
  "args": {
    "project": "<resolved-project>",
    "qualified_name": "<qualified-name-from-search_graph>",
    "include_neighbors": true
  }
}
```

规则：

- snippet 是补充信息，不替代读取文件。
- 必须限制返回大小，避免 MCP 响应塞入大段源码。
- 需要先通过 `search_graph` 找到准确 `qualified_name`。

### 架构概览：`get_architecture`

ArchGuard 当前路径：

```typescript
engine.getSummary()
```

Codebase Memory 映射：

```json
{
  "tool": "get_architecture",
  "args": {
    "project": "<resolved-project>"
  }
}
```

规则：

- ArchGuard summary 仍然是 ArchGuard entity/relation 计数、Atlas、测试分析、git history 的权威来源。
- Codebase Memory 的 architecture 输出只作为 agent guidance enrichment，例如 package、cluster、高度连接节点。

---

## 响应结构

所有后端感知的响应使用统一 envelope：

```typescript
type QueryBackend = "archguard" | "codebase-memory" | "combined";

interface BackendResult<T> {
  backend: QueryBackend;
  projectRoot: string;
  codebaseMemoryProject?: string;
  stale?: boolean;
  data: T;
  diagnostics?: string[];
}
```

示例：

```json
{
  "backend": "codebase-memory",
  "projectRoot": "/repo",
  "codebaseMemoryProject": "repo",
  "data": {
    "results": [
      {
        "name": "OrderHandler",
        "qualifiedName": "src.orders.OrderHandler",
        "kind": "Class",
        "file": "src/orders/order-handler.ts"
      }
    ]
  },
  "diagnostics": [
    "ArchGuard query artifacts were missing; fell back to Codebase Memory."
  ]
}
```

CLI 文本输出可以用页脚展示来源：

```text
Backend: codebase-memory (project: repo)
Note: ArchGuard query artifacts were missing; fell back to Codebase Memory.
```

MCP JSON 输出则直接返回 envelope。

---

## CLI 与 MCP 接入范围

先接入最小可用面：

| 入口 | 阶段 | 后端支持 |
|---|---:|---|
| `archguard query --entity` | 1 | `auto`、`codebase-memory` |
| `archguard_find_entity` | 1 | 可选 `backend` |
| `archguard query --file` | 2 | `auto`、`codebase-memory` |
| `archguard_get_file_entities` | 2 | 可选 `backend` |
| `archguard query --callers` | 3 | `auto`、`codebase-memory` |
| `archguard_find_callers` | 3 | 可选 `backend` |
| `archguard query --summary` | 4 | 只做 enrichment |
| `archguard_summary` | 4 | 只做 enrichment |

以下能力不走 Codebase Memory：

- Atlas package fan-in/fan-out、god-package 检测
- 测试指标、测试问题、覆盖关系
- git history 风险、co-change、ownership
- 架构图生成
- `archguard analyze`

这些能力依赖 ArchGuard 自有扩展数据，不适合通过外部通用图后端替代。

---

## 错误处理

adapter 应把外部后端失败归一化成诊断信息，避免 subprocess 细节泄漏到每个调用点。

| 失败场景 | 处理方式 |
|---|---|
| 找不到 `codebase-memory-mcp` binary | 返回安装/路径提示；如果可能，fallback 到 ArchGuard。 |
| project 未索引 | 返回 `index_repository` 命令提示；不自动索引。 |
| 符号歧义 | 返回 `search_graph` 候选项，要求调用方用 qualified name 重试。 |
| 超时 | kill subprocess，返回 timeout 诊断；如果可能，fallback 到 ArchGuard。 |
| JSON 解析失败 | 返回 stdout/stderr 摘要；不能让 MCP server 崩溃。 |
| 后端不支持该映射 | 返回明确的“不支持”诊断。 |

如果未来改为直接 MCP stdio 客户端，还要额外处理 MCP transport 不可用的问题。第一阶段通过 CLI process boundary 可以避开这类生命周期复杂度。

---

## 新鲜度模型

ArchGuard 和 Codebase Memory 的 freshness 模型彼此独立：

- ArchGuard 用 `arch.json` hash 校验 `arch-index.json`。
- Codebase Memory 维护自己的持久化图和 index 状态。

第一阶段规则：

1. 不尝试自行证明 Codebase Memory index 是最新的。
2. 如果 Codebase Memory 通过 `index_status` 暴露状态，则把它作为 diagnostics 返回。
3. 只有当 Codebase Memory 明确报告 stale 或 index 失败时，才标记 `stale: true`。
4. 宁可明确标注 provenance，也不要给出虚假的 freshness 精度。

未来可以在 Codebase Memory 状态契约稳定后，再比较 repository HEAD、mtime 或 index metadata。

---

## 测试策略

### 单元测试

使用 mock 的 `CodebaseMemoryClient`，覆盖：

- `search_graph` 到 ArchGuard 风格实体摘要的映射。
- `trace_path` 到 caller/callee 结果的映射。
- `get_code_snippet` 的返回大小限制。
- `list_projects` 在完全匹配、名称匹配、无匹配、歧义场景下的解析。
- subprocess 错误归一化为 diagnostics。
- `auto` 只在预期条件下 fallback。

### 合约 fixture

增加代表性 Codebase Memory 输出 fixture：

- `search_graph.class.json`
- `search_graph.function.json`
- `trace_path.inbound.json`
- `trace_path.outbound.json`
- `get_code_snippet.json`
- `list_projects.json`

这些测试不要求本机安装 `codebase-memory-mcp`。

### 可选集成测试

通过环境变量开启：

```text
ARCHGUARD_TEST_CODEBASE_MEMORY=1
```

开启后测试流程：

1. 创建小型 fixture 仓库。
2. 执行 `codebase-memory-mcp cli index_repository`。
3. 通过 ArchGuard `--backend codebase-memory` 查询。
4. 校验 provenance 和核心结果结构。

默认测试套件必须在未安装 Codebase Memory 的环境里通过。

---

## 分阶段计划

### 阶段 1：Client 与 Project Resolver

- 增加 `CodebaseMemoryClient`。
- 基于 `list_projects` 增加 project resolver。
- 增加统一 result envelope 和 diagnostics。
- 增加 `config doctor codebase-memory` 的只读检查逻辑，或接入现有 `config doctor` 框架。
- 增加 mock 单元测试。

### 阶段 2：实体搜索 fallback

- 给 `archguard query --entity` 增加 `--backend`。
- 给 `archguard_find_entity` 增加可选 `backend`。
- 支持 `.archguard/query` 缺失或 ArchGuard 结果为空时 fallback。
- binary 缺失或 project 未索引时，复用 doctor 的诊断与 next steps。

### 阶段 3：文件实体与 snippet enrichment

- 给文件级实体查询增加 Codebase Memory 支持。
- 增加 snippet enrichment 内部 helper 或显式选项。
- 加强返回大小限制。

### 阶段 4：调用追踪

- 使用 `trace_path` 支持 callers/callees。
- 增加基于 `search_graph` 候选项的消歧诊断。
- ArchGuard 调用图仍作为默认路径，因为当前工具描述已经清楚标注不同语言的精度与限制。

### 阶段 5：summary enrichment

- 对 summary 类入口增加可选 `get_architecture` enrichment。
- ArchGuard 自有计数和扩展数据仍为权威来源。

### 阶段 6：文档与示例

- 文档说明安装预期、doctor 检查、索引命令、后端选择和限制。
- 增加 CLI/MCP 示例。
- 明确说明为什么 ArchGuard 不在普通查询路径里自动索引 Codebase Memory。

---

## 风险与取舍

### Schema 不一致

ArchGuard entity 和 Codebase Memory graph node 不是同一模型。强行伪装成同一种对象会让结果误导调用方。

缓解：使用统一 envelope，明确 backend provenance，并保留必要的 raw/source 字段。

### 依赖边界不清

用户可能误以为 ArchGuard 从此强依赖 Codebase Memory。

缓解：默认后端保持 `archguard`；Codebase Memory 只在显式配置或参数下启用；测试默认不依赖外部 binary。

### 新鲜度混淆

ArchGuard 与 Codebase Memory 可能在不同时间索引。

缓解：来源必须显式标注；只在有明确证据时标注 stale；不静默合并两个来源的结果。

### 返回结果过大

图搜索可能返回大量结果，MCP 响应容易撑爆 agent context。

缓解：设置小默认 limit，支持显式 limit，并对高容量输出做摘要。

### `auto` 行为不稳定

`auto` 会让同一命令在不同机器上因是否安装/索引 Codebase Memory 而表现不同。

缓解：CLI 默认仍为 `archguard`；`auto` 先要求显式开启，等行为稳定后再考虑 agent-facing 默认值。

---

## 验收标准

- 不传 `--backend` 时，现有 ArchGuard CLI/MCP 查询行为不变。
- `archguard query --entity <name> --backend codebase-memory` 可以在没有 `.archguard/query` 的情况下，从已索引 Codebase Memory project 返回符号结果。
- `--backend auto` 发生 fallback 时，响应中明确说明从 ArchGuard fallback 到 Codebase Memory。
- 响应包含 backend provenance。
- binary 缺失、project 未索引、timeout、JSON 解析失败都返回清晰 diagnostics。
- `config doctor codebase-memory` 能在不修改用户环境的前提下报告 binary、CLI、project resolution 和索引状态。
- 普通安装 ArchGuard 不会强制下载或注册 `codebase-memory-mcp`。
- 单元测试不要求安装 `codebase-memory-mcp`。
- 文档说明 setup、indexing、backend selection 和 limitations。

---

## 待定问题

- MCP 工具未来是否默认 `auto`，还是永远要求显式传 `backend` 以保证确定性？
- snippet retrieval 应该做成独立 ArchGuard MCP 工具，还是只作为现有工具的 enrichment？
- 是否要在 ArchGuard 内直接暴露 `query_graph` 给高级用户，还是让它保持为 Codebase Memory 自身的 escape hatch？
- `index_status` 是否应该每次查询都调用，还是只在用户要求诊断时调用？
