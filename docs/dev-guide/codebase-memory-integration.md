# Codebase Memory 集成层（开发者）

本文面向开发者，说明 `src/integrations/codebase-memory/` 集成层的边界、模块职责、
result envelope 的 provenance 语义，以及 CLI / MCP 入口如何接入。用户视角的安装、
后端选择与限制见 [codebase-memory-backend.md](../user-guide/codebase-memory-backend.md)；
设计动机见
[proposal-codebase-memory-backend-adapter.md](../proposals/proposal-codebase-memory-backend-adapter.md)。

## 分层与边界

集成层把外部 `codebase-memory-mcp` 后端封装在一个稳定的适配器表面之后。
**CLI 与 MCP 入口只依赖 adapter，绝不直接 spawn 子进程，也不依赖 Codebase
Memory 的原始 schema。**

```
CLI query / MCP tools
   |
   v
CodebaseMemoryAdapter        <- 唯一对外表面（映射查询意图）
   |  resolveProject()
   v
CodebaseMemoryClient         <- 子进程边界（codebase-memory-mcp cli <tool> <json>）
   |
   v
codebase-memory-mcp (外部 binary)
```

模块职责（`src/integrations/codebase-memory/`）：

| 模块 | 职责 |
|---|---|
| `types.ts` | 共享类型：`BackendResult<T>` 信封、`BackendDiagnostic`、`QueryBackend`、构造函数。无运行时依赖，被其余模块依赖。 |
| `client.ts` | 子进程客户端。封装 `execFile`，把超时/缺失 binary/非零退出/JSON 解析失败统一归一化为 `BackendDiagnostic`，不抛子进程异常；`ProcessRunner` seam 便于单测注入。 |
| `project-resolver.ts` | 通过 `list_projects` 把 `projectRoot` 解析为 project 名（精确路径 > 目录名 > 诊断）。只读，永不触发 `index_repository`。 |
| `adapter.ts` | 把 ArchGuard 查询意图映射为 Codebase Memory tool 调用，归一化结果，统一返回 `BackendResult` 信封。 |

意图映射（adapter）：

| adapter 方法 | Codebase Memory tool |
|---|---|
| `findEntity(name)` | `search_graph({ name_pattern })` |
| `getFileEntities(file)` | `search_graph({ file_pattern })` |
| `findCallers(name)` | `trace_path({ direction: "inbound" })`，失败时 `search_graph` 候选回退 |
| `getCodeSnippet(qn)` | `get_code_snippet`（enrichment，截断） |
| `getArchitecture()` | `get_architecture`（enrichment，原样保留） |

## CLI / MCP 接入点

- CLI：`src/cli/commands/query.ts` 通过 `src/cli/query/query-backend.ts` 的
  `createCodebaseMemoryAdapter()` 构造 adapter，是 query 命令与集成层之间唯一的桥。
  命令解析 `--backend archguard|codebase-memory|auto` 与 `--cbm-project`，
  并由 `printProvenanceFooter()` 渲染 provenance footer。
- MCP：`src/cli/mcp/tools/call-graph-tools.ts` 等工具暴露可选的 `backend`、
  `projectRoot`、`codebaseMemoryProject` 入参，通过
  `src/cli/mcp/codebase-memory-backend.ts` 的 `runBackendQuery()` 走同一 adapter。
- doctor：`src/cli/commands/doctor.ts` 实现只读的
  `archguard config doctor codebase-memory`，仅调用 `list_projects` 产出
  `{ok, binary, project, nextSteps}` 报告。
- 配置：`src/cli/config-loader.ts` 定义 `queryBackends` schema
  （`primary` / `fallback` / `codebaseMemory.{command,project,autoIndex,timeoutMs,maxResults}`）。

### MCP 工具 backend 入参示例

`archguard_find_callers` 接受可选 `backend` 参数：

```jsonc
// 默认（省略或 "archguard"）：走 ArchGuard 调用图，行为不变
{ "entityName": "UserService.login", "depth": 1 }

// 走 Codebase Memory：返回 BackendResult 信封；project 由 projectRoot 解析
{ "entityName": "UserService.login", "depth": 2, "backend": "codebase-memory" }

// 显式指定 project，跳过自动解析
{
  "entityName": "UserService.login",
  "backend": "codebase-memory",
  "codebaseMemoryProject": "my-repo",
  "projectRoot": "/path/to/repo"
}
```

## Result envelope 与 provenance 语义

每个 adapter 方法都返回统一的 `BackendResult<T>` 信封（`types.ts`），让调用方
无需在 payload 形状里编码元数据即可区分来源与新鲜度：

```ts
interface BackendResult<T> {
  backend: 'archguard' | 'codebase-memory' | 'combined'; // provenance：谁产出的 data
  projectRoot: string;                  // 查询针对的仓库根
  codebaseMemoryProject?: string;       // 解析出的 Codebase Memory project 名
  stale?: boolean;                      // 仅在后端明确报告索引过期时置位
  data: T;                              // 后端特定 payload
  diagnostics?: BackendDiagnostic[];    // 归一化诊断（含 nextSteps）
}
```

provenance 规则：

- `backend` 字段标明实际产出 `data` 的后端，CLI/MCP 据此渲染 footer。
- Codebase Memory 节点**不会**被伪装成 ArchGuard `Entity`；无法无损映射的字段
  保留在 `raw` 下。
- `diagnostics` 把子进程层失败归一化为稳定 `code`（`binary-missing` /
  `timeout` / `parse-error` / `backend-error` / `project-not-indexed` /
  `project-ambiguous` / `unsupported`）+ 可操作 `nextSteps`，子进程原始细节
  不泄漏到调用点。
- `stale` 只在后端给出明确证据时置位；缺省不代表新鲜。

新鲜度模型上，ArchGuard 与 Codebase Memory 各自独立：ArchGuard 以
`.archguard` 产物为准，Codebase Memory 以其自身索引状态为准，二者互不代理。

## 设计约束（不变量）

- 查询路径与 doctor 只读 `list_projects`，**永不**自动 `index_repository`
  （索引有成本且写持久状态，须用户显式触发）。
- 默认后端保持 `archguard`；Codebase Memory 仅在显式 `--backend` /
  `queryBackends.primary` 下启用。
- 默认测试套件不依赖外部 `codebase-memory-mcp` binary（`ProcessRunner` 可 mock）。
- Atlas、测试分析、git history、架构图、`analyze` 不走 Codebase Memory。
