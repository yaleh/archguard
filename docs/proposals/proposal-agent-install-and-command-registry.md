# Agent 安装配置与命令元数据 Registry 实施方案

> 状态：草案
> 范围：补齐 ArchGuard 的 agent 安装 / 更新 / 配置能力，并把 CLI、MCP、文档、
>      agent guidance 尽量收敛到同一份 typed command metadata registry。
> 关联：ADR-006 MCP Tool 设计规范、ADR-007 CLI 与 MCP 接口一致性规范。

---

## 摘要

ArchGuard 已经具备 CLI 和 MCP 两个使用入口，但 agent 真实接入成本仍偏高：
用户需要手动安装 CLI、配置 Claude / Codex 的 MCP server、确认路径、写 agent
instructions，并在 ArchGuard 升级后自行同步配置和说明。

同时，ArchGuard 的命令面正在变复杂。CLI command、CLI help、MCP tool schema、
README、user guide、agent surface 文档如果继续多处手写，会持续发生 drift。

本方案建议分两条线推进：

1. 新增 `install` / `update` / `config` / `agent` 子命令，负责把 ArchGuard 一键安装
   到 Claude Code、Codex 等 agent 环境，并提供诊断和升级能力。
2. 建立一份 typed command/tool metadata registry，让 CLI catalog、CLI help、
   structured help、MCP tools、README/help 区块、agent surface 文档和 shell
   completion 尽量从同一份元数据派生。

这两条线的共同目标是：ArchGuard 不只是“能被 agent 调用”，而是“容易被 agent
正确安装、正确发现、正确选择、正确恢复”。

---

## 背景与问题

### Agent 接入成本高

当前用户要把 ArchGuard 接入 Claude Code 或 Codex，通常要手动完成：

- 安装或构建 `archguard`。
- 确认 `archguard` 是否在 `PATH` 中。
- 写入 Claude / Codex 的 MCP 配置。
- 处理项目级和用户级配置差异。
- 运行 `archguard mcp` 验证 server 是否能启动。
- 让 agent 知道什么时候调用 `archguard_analyze`、什么时候调用查询类工具。
- 升级后手动确认配置和说明是否仍然匹配。

这些步骤对人类用户已经繁琐，对 agent 更不稳定。路径错、配置写错、server 起不来、
tool description 过时，都会导致 agent 不调用 ArchGuard 或错误调用 ArchGuard。

### 命令描述多处漂移

ArchGuard 同时维护这些对外能力面：

- CLI command 和 options。
- CLI `--help` 文本。
- structured help / catalog。
- MCP tool name、description、Zod schema。
- README 命令区块。
- `docs/user-guide/cli-usage.md`。
- `docs/user-guide/mcp-usage.md`。
- agent surface / instructions。
- shell completion。

如果这些内容分别手写，就会出现典型 drift：

- CLI 新增了 `--include-tests`，MCP schema 忘记加。
- MCP tool description 写了前置调用，CLI help 没写。
- README 仍然展示旧参数。
- Agent 文档没有告诉 agent 失败后如何补救。
- CI 只能做浅层 drift-check，无法保证语义一致。

ADR-006 和 ADR-007 已经定义了设计规范，但还需要把规范推进到“元数据驱动生成”的实现层。

---

## 非目标

- 不在第一阶段支持所有 agent 平台；先覆盖 Claude Code 和 Codex。
- 不把用户机器上的所有配置都自动修改为不可回滚状态；所有写配置动作必须可预览、可诊断。
- 不把 CLI 和 MCP 的 runtime 业务逻辑塞进 registry；registry 描述接口，不承载分析实现。
- 不一次性删除所有手写文档；先建立生成区块和 drift gate，再逐步迁移。
- 不要求第一阶段实现完整 shell completion 生成；先为 completion 保留 metadata 字段。

---

## 目标架构

```text
src/cli/metadata/registry.ts
  -> CLI builder
  -> CLI help renderer
  -> structured help / catalog
  -> MCP tool registrar
  -> README / docs generated blocks
  -> agent surface docs
  -> install/config guidance
  -> future shell completion

install/config commands
  -> Provider adapters
       -> ClaudeCodeAdapter
       -> CodexAdapter
  -> MCP server probe
  -> command registry
  -> agent instruction renderer
```

核心原则：

- 命令和工具的“事实来源”只有一份 typed metadata。
- CLI 和 MCP 都是薄包装，业务逻辑仍在 QueryEngine / analysis pipeline。
- agent 安装配置命令也复用 registry 中的 tool guidance，而不是另写一套说明。
- 文档生成采用 fenced generated block，保留人工文档上下文。

---

## 第 4 点：install / update / config 子命令

### 命令设计

建议新增顶层命令组：

```bash
archguard install [provider]
archguard update [provider]
archguard config doctor
archguard config show
archguard config path [provider]
archguard config remove [provider]
archguard agent instructions [provider]
```

其中 `provider` 初期支持：

- `claude`
- `codex`
- `all`

后续可扩展：

- `cursor`
- `windsurf`
- `vscode`
- `custom`

### `archguard install`

职责：把当前 ArchGuard 安装成 agent 可用的 MCP server。

示例：

```bash
archguard install codex
archguard install claude --scope user
archguard install claude --scope project
archguard install all --dry-run
```

行为：

- 解析当前 `archguard` 可执行文件路径。
- 检测 `archguard mcp` 是否能启动。
- 根据 provider 写入 MCP 配置。
- 生成或更新 agent instructions。
- 保留已有非 ArchGuard MCP server 配置。
- 支持 `--dry-run` 预览将写入的文件和 diff。
- 支持 `--force` 覆盖已有 ArchGuard 配置。

Claude Code 目标配置：

```json
{
  "mcpServers": {
    "archguard": {
      "command": "archguard",
      "args": ["mcp"]
    }
  }
}
```

Codex 目标配置：

```toml
[mcp_servers.archguard]
command = "archguard"
args = ["mcp"]
startup_timeout_sec = 30
tool_timeout_sec = 60
```

### `archguard update`

职责：升级或刷新 ArchGuard 的 agent 集成配置。

示例：

```bash
archguard update codex
archguard update claude --instructions-only
archguard update all --dry-run
```

行为：

- 检查当前 ArchGuard 版本。
- 检查 provider 配置里的 command / args 是否仍然可用。
- 刷新 agent instructions。
- 在 metadata registry 变化后同步 tool guidance。
- 可选提醒用户升级 npm package，但不强制执行包管理器操作。

### `archguard config doctor`

职责：诊断 ArchGuard 与 agent 集成是否可用。

示例：

```bash
archguard config doctor
archguard config doctor codex --json
archguard config doctor claude --project-root .
```

检查项：

- `archguard` 是否在 `PATH` 中。
- `archguard --version` 是否可执行。
- `archguard mcp` 是否能启动并响应 `listTools`。
- 当前项目是否存在 `.archguard/query`。
- 若无 query artifacts，是否能提示运行 `archguard analyze`。
- Claude / Codex 配置文件是否存在。
- 配置文件格式是否能解析。
- ArchGuard MCP server entry 是否存在。
- entry 中的 command / args 是否可执行。
- tool list 是否包含 registry 中声明的 MCP tools。
- agent instructions 是否存在且版本匹配。

输出应分成人类可读和 JSON 两种：

```bash
archguard config doctor --json
```

JSON 输出便于 agent 自动判断下一步补救动作。

### `archguard config show`

职责：展示当前 provider 配置，不泄漏无关敏感信息。

示例：

```bash
archguard config show codex
archguard config show claude --scope user
```

输出内容：

- provider。
- scope。
- 配置文件路径。
- ArchGuard MCP command / args。
- server probe 结果。
- instructions 路径。

### `archguard agent instructions`

职责：从 registry 生成 agent 可读的 ArchGuard 使用说明。

示例：

```bash
archguard agent instructions codex
archguard agent instructions claude --format markdown
archguard agent instructions all --write
```

内容应包含：

- ArchGuard 能解决什么问题。
- agent 什么时候应该先调用 `archguard_analyze`。
- 哪些工具依赖已有 `.archguard/query`。
- 测试分析工具的前置调用顺序。
- git-history 工具的前置调用顺序。
- 结果可能 stale 时如何 re-analyze。
- 工具失败时的 recovery guidance。

这些说明必须从 registry 的 `agent` 字段生成，而不是另写一份。

### Provider Adapter

新增内部接口：

```ts
interface AgentProviderAdapter {
  id: 'claude' | 'codex';
  detect(): Promise<ProviderDetection>;
  readConfig(scope: InstallScope): Promise<ProviderConfig>;
  writeConfig(config: ProviderConfig, options: WriteOptions): Promise<WriteResult>;
  removeConfig(scope: InstallScope): Promise<WriteResult>;
  renderInstructions(input: InstructionRenderInput): Promise<string>;
  getInstructionTargets(scope: InstallScope): Promise<InstructionTarget[]>;
}
```

初期实现：

- `ClaudeCodeAdapter`
- `CodexAdapter`

Provider adapter 只处理配置文件位置、格式和 provider 特有字段；MCP server 内容、
tool guidance 和 instructions 主体都来自 ArchGuard registry。

### 安全与回滚

写配置必须满足：

- 默认只修改 ArchGuard 自己的 entry。
- 不删除其他 MCP server 配置。
- 写入前创建备份，例如 `<config>.bak.<timestamp>`。
- `--dry-run` 输出 diff。
- JSON / TOML 使用结构化 parser，不用正则拼接。
- 失败时保留原文件。

---

## 第 5 点：Typed Command Metadata Registry

### 目标

把命令描述从“多处手写”收敛成“一份元数据，多处派生”。

一条能力的 canonical metadata 应覆盖：

- 能力 ID。
- CLI command / options。
- MCP tool name / schema。
- 人类 help 文本。
- structured help。
- docs examples。
- agent useWhen / callFirst / recovery / limitations。
- 输出形态。
- 前置 artifact 依赖。
- 测试和 drift gate 要求。

### Metadata Schema 草案

```ts
type CommandMetadata = {
  id: string;
  group: 'analysis' | 'query' | 'git-history' | 'test-analysis' | 'atlas' | 'config' | 'agent';
  lifecycle: 'stable' | 'experimental' | 'deprecated';

  summary: string;
  description: string;

  cli?: {
    command: string;
    aliases?: string[];
    usage: string;
    options: CliOptionMetadata[];
    examples: ExampleMetadata[];
  };

  mcp?: {
    toolName: string;
    inputSchema: SchemaMetadata;
    outputShape: 'text' | 'json-text' | 'artifact-paths';
  };

  agent: {
    useWhen: string;
    avoidWhen?: string;
    callFirst?: string[];
    followUps?: string[];
    recovery?: RecoveryMetadata[];
    limitations?: string[];
    freshness?: string;
  };

  artifacts?: {
    reads?: string[];
    writes?: string[];
    requiresAnalyze?: boolean;
    requiresGitAnalyze?: boolean;
    requiresTestAnalyze?: boolean;
  };

  docs: {
    category: string;
    includeInReadme: boolean;
    includeInAgentSurface: boolean;
    examples: ExampleMetadata[];
  };
};
```

### Schema 约束

CI 必须校验：

- 每个 public CLI command 都有 registry entry。
- 每个 MCP tool 都有 registry entry。
- 每个 MCP 参数都有 description。
- enum 参数不能用裸 string 替代。
- 有前置依赖的工具必须有 `callFirst`。
- 会读取 `.archguard/query` 的工具必须声明 artifacts。
- 会产生大输出的工具必须声明分页、depth 或 scope 限制。
- deprecated command 必须有替代建议。

### CLI 从 Registry 派生

第一阶段不要求完全自动生成 Commander runtime，但至少做到：

- `archguard help` 从 registry 渲染。
- `archguard help --json` 输出 structured catalog。
- `archguard catalog` 输出所有命令和 MCP tools。
- CLI option tests 对比 Commander 实际注册与 registry。

长期目标：

- Commander options 由 registry 构造。
- handler 只绑定 capability function。
- 参数验证复用 schema metadata。

### MCP 从 Registry 派生

MCP tool registration 应从 registry 读取：

- tool name。
- description。
- Zod input schema。
- handler mapping。

第一阶段允许 handler 手动绑定，但 schema 和 description 应来自 registry。

长期目标：

```ts
for (const tool of registry.mcpTools()) {
  server.tool(tool.name, tool.description, tool.zodSchema, tool.handler);
}
```

这样新增工具时，不再需要同时改 `mcp-server.ts`、文档和 drift test baseline。

### Docs 从 Registry 派生

文档中使用 generated block：

```md
<!-- ARCHGUARD:GENERATED:CLI-CATALOG:start -->
...
<!-- ARCHGUARD:GENERATED:CLI-CATALOG:end -->
```

生成目标：

- README command overview。
- `docs/user-guide/cli-usage.md` command catalog。
- `docs/user-guide/mcp-usage.md` tool catalog。
- `docs/user-guide/agent-surface.md`。
- `archguard help --markdown`。

人工文档仍然保留：

- 背景说明。
- 教程。
- 设计取舍。
- 深入指南。

生成区块只负责“事实表”和示例，避免人肉同步。

### Agent Guidance 从 Registry 派生

每个工具必须告诉 agent：

- 什么时候用。
- 不适合什么时候用。
- 先调用哪个工具。
- 失败后怎么补救。
- 结果是否可能 stale。
- 是否有近似、误报或语言限制。

示例：

```ts
agent: {
  useWhen: 'Need a high-level architecture summary after analysis artifacts exist.',
  callFirst: ['archguard_analyze'],
  recovery: [
    {
      when: 'No query data found',
      do: 'Run archguard_analyze with the target projectRoot, then retry.'
    }
  ],
  freshness: 'Reads .archguard/query from the last analyze run.'
}
```

这些字段用于：

- MCP tool description。
- `archguard agent instructions`。
- docs/user-guide/agent-surface.md。
- future skills scaffold。

---

## 实施计划

### 里程碑 1：Registry schema 与基线

- 定义 `CommandMetadata` 类型。
- 为现有 public CLI / MCP tools 建立 registry entries。
- 增加 registry validator。
- 增加 drift tests：
  - CLI command 是否有 metadata。
  - MCP tool 是否有 metadata。
  - schema description 是否完整。

### 里程碑 2：Structured help 与 docs generation

- 新增 `archguard help`。
- 新增 `archguard help --json`。
- 新增 `archguard catalog --json`。
- 新增 docs renderer。
- README / user-guide 引入 generated block。
- CI 增加 `npm run check:metadata-docs`。

### 里程碑 3：MCP schema / description 收敛

- MCP description 从 registry 读取。
- MCP Zod schema 从 registry 或 schema factory 读取。
- MCP listTools E2E 验证 description 与 registry 一致。
- 删除重复手写 description。

### 里程碑 4：Agent instructions 生成

- 新增 `archguard agent instructions`。
- 生成 Claude / Codex 两种 profile。
- 增加 agent surface 文档生成。
- instructions 包含 call-first、recovery、freshness 信息。

### 里程碑 5：Install / config provider adapters

- 新增 `ClaudeCodeAdapter`。
- 新增 `CodexAdapter`。
- 新增 `archguard install claude|codex`。
- 新增 `archguard config show`。
- 所有写配置支持 `--dry-run` 和 backup。

### 里程碑 6：Doctor 与 E2E

- 新增 `archguard config doctor`。
- 独立启动 `archguard mcp` 并执行 listTools probe。
- fixture HOME 下测试 Claude JSON 和 Codex TOML 写入。
- E2E 覆盖：
  - install codex
  - install claude
  - doctor pass
  - broken command doctor fail with recovery
  - update instructions

### 里程碑 7：Commander runtime 进一步派生

- 逐步让 CLI options 由 registry 构造。
- 保持 handler 层薄包装。
- completion generation 接入 registry。

---

## 测试计划

### Unit Tests

- metadata validator：
  - 缺少 description 失败。
  - MCP tool 没有 CLI equivalent 时必须显式豁免。
  - 有 artifact 依赖但无 callFirst 失败。
- docs renderer：
  - generated block 可重复生成。
  - 手写内容不会被覆盖。
- provider adapters：
  - Claude JSON 读写保留其他 server。
  - Codex TOML 读写保留其他配置。
  - dry-run 不写磁盘。
  - 写入前创建 backup。

### Integration Tests

- `archguard help --json` 输出包含所有 registry entries。
- CLI help 与 registry summary 一致。
- MCP listTools 与 registry tool list 一致。
- README / user-guide generated blocks 与当前 registry 一致。

### E2E Tests

在临时 HOME 和 fixture repo 中执行：

```bash
npm run build
node dist/cli/index.js install codex --home <tmp-home> --dry-run
node dist/cli/index.js install codex --home <tmp-home>
node dist/cli/index.js config doctor codex --home <tmp-home> --json
node dist/cli/index.js agent instructions codex
```

断言：

- Codex config TOML 中存在 `mcp_servers.archguard`。
- `archguard mcp` probe 成功。
- instructions 中包含 registry 生成的 call-first guidance。
- doctor 在配置损坏时返回非零 exit code 和可执行 recovery。

---

## 风险与缓解

### 自动写配置有破坏风险

缓解：

- 默认只改 ArchGuard entry。
- 结构化 parser。
- 写前 backup。
- `--dry-run`。
- E2E 覆盖已有配置保留。

### Registry 过度抽象

缓解：

- 第一阶段先驱动 help / docs / MCP description。
- Commander runtime 派生放到后期。
- handler 和业务逻辑仍保持普通 TypeScript。

### Agent instructions 变长

缓解：

- 按 provider profile 生成。
- 默认输出高频工具和工作流。
- 详细 catalog 放 docs，不全部塞进 instructions。

### CLI 与 MCP 无法完全一一对应

缓解：

- registry 支持 `surface: cliOnly | mcpOnly | both`。
- mcpOnly / cliOnly 必须写明原因。
- drift test 检查豁免理由。

---

## 验收标准

- 用户可以运行 `archguard install codex` 完成 Codex MCP 配置。
- 用户可以运行 `archguard install claude` 完成 Claude Code MCP 配置。
- `archguard config doctor --json` 能给出 agent 可读的诊断结果和 recovery。
- `archguard agent instructions codex|claude` 从 registry 生成 instructions。
- README / CLI user guide / MCP user guide 中至少一个命令区块由 registry 生成。
- MCP tool description 和 registry 中的 agent guidance 不再手写两份。
- CI 能检测 CLI / MCP / docs 与 registry 的 drift。

---

## 建议

优先实现 registry schema、structured help 和 docs generation，再实现 install/config。

原因是 install/config 的 agent instructions 应该复用 registry。如果先写安装命令，
很容易再次产生一套独立的说明文本，后续仍然会 drift。正确顺序是先确立命令元数据
事实来源，再让 agent onboarding 命令消费这份事实来源。
