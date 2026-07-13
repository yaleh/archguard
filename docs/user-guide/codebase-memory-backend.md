# Codebase Memory 后端使用指南

ArchGuard 的查询能力默认基于 `archguard analyze` 生成的本地分析产物
（`.archguard/query/`）。从该版本起，部分查询意图（实体查找、文件实体、调用者）
可以可选地路由到外部 [Codebase Memory](https://github.com/) 图后端
（`codebase-memory-mcp`），用于在 ArchGuard 产物缺失或需要补充语义时回退或对照。

本指南面向使用者，说明安装预期、诊断命令、索引命令、后端选择语义、CLI/MCP 示例
以及当前限制。其设计动机与完整契约见
[proposal-codebase-memory-backend-adapter.md](../proposals/proposal-codebase-memory-backend-adapter.md)。

## 安装预期

Codebase Memory 是**可选依赖**，ArchGuard 在以下方面保持克制：

- **不进入 `package.json` 的 `dependencies`。** 安装 ArchGuard 不会安装
  `codebase-memory-mcp`。
- **不自动安装、不自动索引。** ArchGuard 永远不会替你下载二进制，也不会替你
  运行 `index_repository`。
- **默认不启用。** 不显式选择 `codebase-memory` / `auto` 后端时，行为与之前
  完全一致（只走 ArchGuard 本地产物）。

要使用该后端，你需要自行安装 `codebase-memory-mcp` 并确保它在 `PATH` 上
（或通过配置指定命令路径，见下文 `queryBackends.codebaseMemory.command`），
然后显式对目标仓库执行一次索引。

## 诊断：`archguard config doctor codebase-memory`

在动手之前，可以用只读 doctor 子命令检查环境是否就绪。它**不会修改任何状态**：
只发起一次 `list_projects` 读取，并据此推导一份结构化报告。

```bash
archguard config doctor codebase-memory
archguard config doctor codebase-memory --json
archguard config doctor codebase-memory --project-root /path/to/repo
```

doctor 检查四件事：

1. **binary** —— `codebase-memory-mcp`（或配置的命令）能否被定位/启动；
2. **list_projects** —— 调用是否返回可解析的 JSON；
3. **project** —— 当前 `projectRoot` 是否解析到唯一的 Codebase Memory project；
4. **indexed** —— 该 project 是否已索引；未索引时给出 `index_repository` 的
   下一步命令（doctor 自身永远不会执行它）。

`--json` 输出的结构为只读报告 `{ok, binary, project, nextSteps}`（外加可选
`diagnostics`）：

```json
{
  "ok": false,
  "backend": "codebase-memory",
  "binary": { "found": true, "command": "codebase-memory-mcp" },
  "project": { "found": true, "root": "/path/to/repo", "name": "repo", "indexed": false },
  "nextSteps": [
    "codebase-memory-mcp cli index_repository '{\"repo_path\":\"/path/to/repo\"}'"
  ]
}
```

`ok` 仅在 binary 找到、project 解析成功且已索引时为 `true`；否则退出码为 1。

> 注意：普通的 `archguard mcp` 启动**不会**触发该检查，只有显式调用 doctor
> 子命令时才会运行。

## 索引：`index_repository`

索引由**用户显式执行**，ArchGuard 不代为触发。使用 Codebase Memory 自带的 CLI：

```bash
codebase-memory-mcp cli index_repository '{"repo_path":"/path/to/repo"}'
```

当 doctor 或某次查询报告 `project-not-indexed` 时，它会在 `nextSteps` 里直接给出
针对当前仓库的 `index_repository` 命令，复制执行即可。索引完成后，project 名称
默认等于仓库目录名，可用 `--cbm-project` 显式覆盖。

### 为什么普通查询路径不自动索引

索引是有成本的操作：它会扫描整个仓库、写入持久化状态（图数据库），耗时与磁盘
占用都不可忽略。把它隐藏在一次普通查询里会带来不可预期的副作用——一次只读的
`archguard query` 可能突然变成一次重量级的写操作。因此 ArchGuard 的查询路径
和 doctor 都**只读 `list_projects`**，在缺失索引时返回可操作的提示，由用户在
合适的时机显式触发索引。

## 后端选择语义

通过 CLI `--backend` 标志或配置 `queryBackends.primary` 选择后端：

| 取值 | 语义 |
|---|---|
| `archguard`（默认） | 只走 ArchGuard 本地产物，行为不变。 |
| `codebase-memory` | 对可路由的意图（`--entity` / `--file` / `--callers`）始终走 Codebase Memory 适配器。 |
| `auto` | 先尝试 ArchGuard；当产物缺失/损坏或结果为空时，fallback 到 Codebase Memory，并在输出中注明回退。 |

优先级：显式 `--backend` 标志 > 配置 `queryBackends.primary` > 默认 `archguard`。
非法的 `--backend` 值会直接报错。

只有**实体查找（`--entity`）、文件实体（`--file`）、调用者（`--callers`）**这三类
意图会进入后端路由；其余意图（`--summary`、`--cycles`、`--deps-of` 等）始终走
ArchGuard 引擎，与所选后端无关。

每个后端结果都带 **provenance footer**（provenance 信封 `BackendResult<T>`），
打印实际使用的 `Backend`、解析出的 project、project root、staleness 以及归一化
诊断和下一步建议。`auto` 命中 ArchGuard 时会追加一行 `Backend: archguard`；
回退到 Codebase Memory 时会先打印一行说明再附诊断信息。

### 项目解析

未用 `--cbm-project` 显式指定时，适配器按以下优先级解析 project：

1. 仓库根路径与某个 project 的 `root` 精确匹配；
2. 否则，与某个 project 名（仓库目录名）唯一匹配；
3. 否则返回可操作诊断：`project-not-indexed`（未索引，附 `index_repository`）
   或 `project-ambiguous`（多个匹配，附 `--cbm-project <name>` 候选）。

## CLI 示例

```bash
# auto：ArchGuard 有答案就用它，否则回退到 Codebase Memory
archguard query --entity UserService --backend auto

# 强制走 Codebase Memory，并显式指定 project，跳过自动解析
archguard query --entity UserService --backend codebase-memory --cbm-project my-repo

# 文件实体（codebase-memory 后端）
archguard query --file src/services/user.ts --backend codebase-memory

# 调用者查询（trace_path inbound；歧义时返回候选项要求用 qualified name 重试）
archguard query --callers UserService.login --backend auto --callers-depth 2

# JSON 输出：直接打印完整 BackendResult 信封（含 backend/project/diagnostics）
archguard query --entity UserService --backend codebase-memory --format json
```

## 配置

在 `archguard.config.json` 中通过可选的 `queryBackends` 块设置默认值。整个块
缺省时等价于 `{ primary: "archguard" }`（即旧行为）。

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

字段说明：

- `primary` —— 默认后端（`archguard` | `codebase-memory` | `auto`），默认 `archguard`。
- `codebaseMemory.command` —— 后端 CLI 命令/路径，默认 `codebase-memory-mcp`。
- `codebaseMemory.project` —— 默认 project；`auto`（默认）表示自动解析。
- `codebaseMemory.autoIndex` —— 保留字段，默认 `false`；查询路径不会自动索引。
- `codebaseMemory.timeoutMs` —— 单次子进程调用超时，默认 `10000`。
- `codebaseMemory.maxResults` —— 返回结果上限提示，默认 `20`。

## 限制

以下能力**不走** Codebase Memory，始终由 ArchGuard 自有数据提供：

- Atlas 分析（package fan-in/fan-out、god-package 检测、Atlas layer 视图）；
- 测试分析（测试指标、测试问题、覆盖关系）；
- git history（变更风险、co-change、ownership）；
- 架构图生成（Mermaid/PlantUML）；
- `archguard analyze` 本身（解析与产物生成）。

这些能力依赖 ArchGuard 自有扩展数据，不适合用外部通用图后端替代。Codebase Memory
仅覆盖实体查找、文件实体、调用者三类意图，外加 `get_code_snippet` /
`get_architecture` 等纯 enrichment（不会被当作权威 ArchGuard 数据）。

此外：

- 返回结果有显式上限/截断，避免大段源码塞满调用方上下文；
- 调用者查询依赖精确（qualified）名称，歧义时只返回候选项而非猜测；
- ArchGuard summary 仍是 entity/relation 计数、Atlas、测试分析、git history 的
  权威来源——Codebase Memory 的同类输出仅作对照/补充。

## 相关文档

- [proposal-codebase-memory-backend-adapter.md](../proposals/proposal-codebase-memory-backend-adapter.md) —— 设计与契约
- [codebase-memory-integration.md](../dev-guide/codebase-memory-integration.md) —— 开发者集成层说明
- [mcp-usage.md](./mcp-usage.md) —— MCP 工具使用
