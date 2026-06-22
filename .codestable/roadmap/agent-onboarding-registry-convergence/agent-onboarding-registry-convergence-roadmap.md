---
doc_type: roadmap
slug: agent-onboarding-registry-convergence
status: active
created: 2026-06-22
last_reviewed: 2026-06-22
tags: [cli, mcp, agent-onboarding, metadata, codex, claude]
related_requirements:
  - docs/proposals/proposal-agent-install-and-command-registry.md
source_proposals:
  - docs/proposals/proposal-agent-install-and-command-registry.md
related_architecture:
  - ARCHITECTURE
  - docs/adr/006-mcp-tool-design-standards.md
  - docs/adr/007-cli-mcp-interface-parity.md
  - command-metadata-registry
---

# Agent Onboarding And Registry Convergence

## 1. 背景

ArchGuard 已经通过 `command-metadata-registry` roadmap 落地了 typed metadata
registry、`archguard help --json`、MCP tool description 派生、README / user-guide /
agent-surface generated blocks 和 drift tests。这个基线解决了“工具怎么被描述”的第一阶段问题。

剩余缺口在 agent 真实接入和更深层接口收敛：用户仍需要手动把 ArchGuard 配到 Codex /
Claude Code，手动诊断 MCP server 是否能启动，手动同步 agent instructions；同时 CLI
runtime options、MCP schema factory、agent instructions、install/config 文档仍没有完全从
registry 派生。

本 roadmap 把 `docs/proposals/proposal-agent-install-and-command-registry.md` 中第 4、5
点落成可执行路线：先补 agent instructions 生成和 provider 配置基础设施，再做
install/config/update/doctor，最后把 registry 从“描述来源”推进到“更完整的 CLI/MCP/docs
派生来源”。

本 roadmap 直接继承 proposal 中这些决策点，不在后续 feature 中重新争论：

- 第一阶段 provider 只覆盖 Claude Code 和 Codex。
- 对外新增 `install` / `update` / `config` / `agent` 命令组。
- agent instructions、CLI/help/docs/MCP 描述继续从 registry 派生，避免新增手写说明面。
- 写用户配置必须支持 dry-run、结构化解析、backup，并且只修改 ArchGuard entry。
- `config doctor` 必须真实验证 MCP server 可用性，而不是信任当前 agent 会话里的缓存状态。

## 2. 范围与明确不做

### 本 roadmap 覆盖

- 从现有 metadata registry 生成 Claude / Codex agent instructions。
- 新增 provider adapter 层，结构化读写 Claude Code JSON 配置和 Codex TOML 配置。
- 新增 `archguard install` / `archguard update` / `archguard config` / `archguard agent`
  子命令。
- 新增 `config doctor`，真实 probe `archguard mcp` 并输出人类可读和 JSON 诊断。
- 增强 registry schema，覆盖 command lifecycle、surface 豁免、artifact freshness、
  docs/include policy、agent recovery 和 install/config metadata。
- 推进 CLI options、MCP schema/description、docs generated blocks、agent instructions
  从同一份 metadata 派生，并用 E2E 和 drift tests 兜底。
- 覆盖真实 E2E：临时 HOME 中安装 Codex / Claude 配置、启动独立 MCP server、list tools、
  验证 generated instructions 和 doctor recovery。

### 明确不做

- 不接入 Cursor、Windsurf、VS Code 等更多 provider；只为后续扩展保留 adapter 接口。
- 不自动执行 npm 全局升级或包管理器写操作；`archguard update` 只刷新 ArchGuard 集成配置和提示。
- 不修改用户非 ArchGuard MCP server entry。
- 不把业务分析逻辑放进 registry；QueryEngine 和 analysis pipeline 仍是唯一业务能力层。
- 不在本 roadmap 里实现 Codebase Memory 图谱后端。
- 不用手写字符串复制 agent instructions；instructions 必须由 registry 渲染。
- 不在本 roadmap 中生成 bash / zsh / fish shell completion；只保留 registry 字段扩展余地。

## 3. 模块拆分（概设）

```text
agent-onboarding-registry-convergence
├── Agent Guidance Contract：补齐 instructions 渲染所需的 freshness/recovery/docs 字段
├── Install Config Contract：补齐 install/config 所需的 lifecycle、surface policy 和 install metadata
├── Instruction Renderer：从 registry 生成 Claude / Codex agent instructions
├── Provider Config Adapters：读写 Claude JSON 和 Codex TOML，支持 dry-run、backup、remove/show
├── Onboarding CLI Commands：install / update / config / agent 子命令
├── MCP Probe And Doctor：独立启动 archguard mcp，执行 listTools，输出诊断和 recovery
└── Convergence Verification：CLI/MCP/docs/instructions/install E2E 和 drift gates
```

### Agent Guidance Contract · Agent 指引合同

- **职责**：在现有 `AgentGuidance` 基础上补齐 `avoidWhen`、`freshness`、docs include policy
  等 instructions 渲染所需的最小字段。
- **承载的子 feature**：`registry-agent-guidance-contract`
- **触碰的现有代码 / 模块**：`src/cli/metadata/types.ts`,
  `src/cli/metadata/registry.ts`, `src/cli/metadata/validators.ts`,
  `tests/unit/cli/metadata-registry.test.ts`

### Install Config Contract · 安装配置合同

- **职责**：把 install/config/update/doctor 需要的 lifecycle、surface policy、artifact contract、
  install contract 和新 CLI command baseline 加入 registry。
- **承载的子 feature**：`registry-install-config-contract`
- **触碰的现有代码 / 模块**：`src/cli/metadata/types.ts`,
  `src/cli/metadata/registry.ts`, `src/cli/metadata/validators.ts`,
  `tests/unit/cli/cli-metadata-drift.test.ts`

### Instruction Renderer · Agent 使用说明生成器

- **职责**：从 registry 的 agent guidance 生成 Claude / Codex profile 文档，包含
  useWhen、callFirst、recovery、freshness 和常见工作流。
- **承载的子 feature**：`agent-instructions-renderer`
- **触碰的现有代码 / 模块**：`src/cli/metadata/docs-renderer.ts` 或新
  `src/cli/metadata/instruction-renderer.ts`, `docs/user-guide/agent-surface.md`

### Provider Config Adapters · Provider 配置适配器

- **职责**：隔离 Claude / Codex 配置路径、格式、scope、读写、dry-run、backup 和 remove。
- **承载的子 feature**：`provider-config-adapters`
- **触碰的现有代码 / 模块**：新增 `src/cli/agent/` 或 `src/cli/config/agent/`，
  新增单元测试 fixture HOME。

### Onboarding CLI Commands · 安装配置命令

- **职责**：提供 `archguard install|update|config|agent` 的用户入口，并复用 adapters /
  instruction renderer / registry。
- **承载的子 feature**：`agent-onboarding-cli`
- **触碰的现有代码 / 模块**：`src/cli/index.ts`, `src/cli/commands/*`,
  `src/cli/metadata/registry.ts`, README / user guide generated blocks。

### MCP Probe And Doctor · 诊断与真实 MCP 探测

- **职责**：独立启动本地 `archguard mcp`，执行 MCP initialize/listTools 或等价 probe，
  生成 `config doctor` 结果和 recovery。
- **承载的子 feature**：`config-doctor-mcp-e2e`
- **触碰的现有代码 / 模块**：新增 probe helper、integration/e2e tests，
  复用 `createMcpServer` 或 stdio 进程。

### Convergence Verification · 收敛验证

- **职责**：把 install/config/instructions 和 registry 派生纳入 CI 验证，防止 drift。
- **承载的子 feature**：贯穿所有 feature，最终由 `config-doctor-mcp-e2e` 收口。
- **触碰的现有代码 / 模块**：`tests/e2e`, `tests/integration/cli-mcp`,
  `scripts/check-metadata-docs.mjs`, package scripts。

## 4. 模块间接口契约 / 共享协议（架构层详设）

本 roadmap 引入的接口都是本地 TypeScript 模块接口和 CLI 协议，不引入网络 API。

### 4.1 Extended Command Metadata

**方向**：Metadata Contract -> Instruction Renderer / CLI Commands / MCP / Docs / Tests

**形式**：TypeScript 类型

```ts
export type SurfacePolicy = 'both' | 'cli-only' | 'mcp-only' | 'docs-only' | 'internal';
export type Lifecycle = 'stable' | 'experimental' | 'deprecated';

// MetadataCategory 以 src/cli/metadata/types.ts 为准，当前包括
// analysis, query, test-analysis, git-history, atlas, cache, configuration,
// fitness, metrics, mcp, docs。

export interface ArchGuardMetadataEntry {
  id: string;
  title: string;
  summary: string;
  category: MetadataCategory;
  surfaces: ArchGuardSurface[];
  surfacePolicy?: SurfacePolicy;
  lifecycle?: Lifecycle;
  agent: AgentGuidance;
  artifacts?: ArtifactContract;
  docs?: DocsContract;
  install?: InstallContract;
  examples: UsageExample[];
  verification: VerificationHint[];
}

export interface AgentGuidance {
  useWhen: string[];
  avoidWhen?: string[];
  callFirst?: string[];
  followWith?: string[];
  failureRecovery: string[];
  limitations: string[];
  freshness?: string;
}

export interface ArtifactContract {
  reads?: string[];
  writes?: string[];
  requiresAnalyze?: boolean;
  requiresGitAnalyze?: boolean;
  requiresTestAnalyze?: boolean;
}

export interface DocsContract {
  includeInReadme?: boolean;
  includeInCliGuide?: boolean;
  includeInMcpGuide?: boolean;
  includeInAgentSurface?: boolean;
}

export interface InstallContract {
  provider?: 'claude' | 'codex' | 'all';
  configScope?: 'user' | 'project';
  writesConfig?: boolean;
  writesInstructions?: boolean;
}
```

**约束**：

- `lifecycle` 缺省视为 `stable`。
- 任何 `deprecated` entry 必须在 `failureRecovery` 或 `limitations` 中给出替代入口。
- `surfacePolicy` 非 `both` 时必须有显式原因，validator 需要检查。
- 读取 `.archguard/query` 的 tool 必须声明 `artifacts.requiresAnalyze` 或等价 freshness。
- install/config/agent 命令必须声明 `install` 合同，供 docs 和 doctor 渲染使用。
- `help` 命令必须纳入 CLI registry，但作为 `cli-only` command，不需要 `InstallContract`。
- 新增的 `agent` / `install` / `update` / `config` 命令必须加入 `cliCommandBaseline` 和
  registry；其中 `install` / `update` / `config` 必须声明 `InstallContract`。
- 若 `install.writesInstructions: true`，则 `docs.includeInAgentSurface` 必须为 true。
- 若 `install.provider: 'all'`，CLI 层必须逐 provider 报告结果；`configScope` 只能为
  `user` / `project`，不能用 `all` 或 `both` 混淆 provider 与 scope。

### 4.2 Agent Instructions Render Contract

**方向**：Metadata Registry -> Instruction Renderer -> CLI / install / docs

**形式**：TypeScript 函数

```ts
export type AgentProvider = 'claude' | 'codex';

export interface InstructionRenderInput {
  provider: AgentProvider;
  format: 'markdown' | 'text';
  includeCatalog?: boolean;
}

export interface InstructionRenderResult {
  provider: AgentProvider;
  content: string;
  sourceMetadataHash: string;
  generatedAt: string;
}

export function renderAgentInstructions(
  registry: ArchGuardMetadataRegistry,
  input: InstructionRenderInput
): InstructionRenderResult;
```

**约束**：

- 生成内容必须包含：分析前置、查询类工具、测试分析、git-history、Atlas、失败恢复。
- Codex / Claude profile 可以有不同包装格式，但工具事实不能分叉。
- `sourceMetadataHash` 用于 doctor 判断 instructions 是否 stale。
- 生成器不能读写用户配置；写入由 provider adapter 或 CLI command 负责。
- `instruction-renderer.ts` 是 `docs-renderer.ts` 的兄弟模块；`docs-renderer.ts` 必须调用
  instruction renderer 渲染 `docs/user-guide/agent-surface.md` 中的 agent instructions 区块，避免保留第二份手写 workflow 文本。

### 4.3 Provider Config Adapter

**方向**：Onboarding CLI Commands -> Provider Config Adapters

**形式**：TypeScript interface

```ts
export type AgentProvider = 'claude' | 'codex';
export type InstallScope = 'user' | 'project';

export interface ProviderDetection {
  provider: AgentProvider;
  available: boolean;
  configPath: string;
  instructionsPath?: string;
  reason?: string;
}

export interface McpServerConfig {
  name: 'archguard';
  command: string;
  args: string[];
  env?: Record<string, string>;
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
}

export interface WriteOptions {
  scope: InstallScope;
  dryRun: boolean;
  force: boolean;
  backup: boolean;
}

export interface WriteResult {
  changed: boolean;
  path: string;
  backupPath?: string;
  diff?: string;
  warnings: string[];
}

export interface AgentProviderAdapter {
  id: AgentProvider;
  detect(context: ProviderContext): Promise<ProviderDetection>;
  readConfig(context: ProviderContext): Promise<unknown>;
  writeMcpServer(
    context: ProviderContext,
    config: McpServerConfig,
    options: WriteOptions
  ): Promise<WriteResult>;
  removeMcpServer(context: ProviderContext, options: WriteOptions): Promise<WriteResult>;
  writeInstructions(
    context: ProviderContext,
    result: InstructionRenderResult,
    options: WriteOptions
  ): Promise<WriteResult>;
}

export interface ProviderContext {
  scope: InstallScope;
  projectRoot: string;
  homeDir: string;
}
```

**约束**：

- JSON / TOML 必须用结构化 parser 或明确可靠的 serializer；禁止 regex 拼接配置。
- Codex TOML 配置默认必须使用活跃维护的 TOML parser/serializer；只有 feature design 用等价性
  测试证明“受控 serializer”不会破坏未知字段时，才允许不新增依赖。
- 写入只允许修改 ArchGuard entry 和 ArchGuard instructions 区块。
- 默认创建 backup；`--no-backup` 如需支持必须显式记录风险。
- `--dry-run` 不能写磁盘。

### 4.4 CLI Command Surface

**方向**：用户 / agent -> Onboarding CLI Commands

**形式**：Commander commands

```bash
archguard agent instructions [provider] [--format markdown|text]
archguard install [provider] [--scope user|project] [--home <dir>] [--dry-run] [--force]
archguard update [provider] [--scope user|project] [--home <dir>] [--instructions-only] [--dry-run]
archguard config show [provider] [--scope user|project] [--home <dir>] [--json]
archguard config doctor [provider] [--scope user|project] [--home <dir>] [--project-root <dir>] [--json]
archguard config remove [provider] [--scope user|project] [--home <dir>] [--dry-run]
```

**约束**：

- `provider` 缺省可为 `all`，但 destructive/write 操作必须逐 provider 报告结果。
- JSON 输出必须稳定，供 agent 解析。
- 非 JSON 输出面向人类，必须包含下一步 recovery。
- 命令 description / examples / docs entry 必须来自 registry。
- `--home <dir>` 是 install/config/update/doctor E2E 的唯一测试 home override；真实用户默认不传，
  测试必须传临时 HOME，禁止写真实用户 HOME。

### 4.5 Doctor Result

**方向**：MCP Probe / Provider Adapters -> CLI / agent

**形式**：JSON object

```ts
export interface DoctorResult {
  ok: boolean;
  provider?: AgentProvider;
  checks: DoctorCheck[];
  recovery: string[];
}

export interface DoctorCheck {
  id: string;
  status: 'pass' | 'warn' | 'fail' | 'skipped';
  message: string;
  path?: string;
  recovery?: string;
}
```

**约束**：

- `ok=false` 时至少有一条 `fail` check 和一条可执行 recovery。
- MCP probe 的最低可接受验证是独立 stdio 进程启动当前 build 的 `archguard mcp`，完成
  initialize/listTools，默认超时 5 秒；in-process MCP client 只能作为附加 fast-path
  测试，不能替代 doctor 的 stdio probe。
- 配置缺失是 fail；query artifacts 缺失可为 warn，recovery 指向 `archguard analyze`。

## 5. 子 feature 清单

1. **registry-agent-guidance-contract** — 扩展 metadata registry 的 agent guidance 最小合同，
   加入 `avoidWhen`、`freshness`、docs include policy 和 instructions 渲染所需 validator。
   - 所属模块：Agent Guidance Contract
   - 依赖：无
  - 状态：in-progress
  - 对应 feature：`2026-06-22-registry-agent-guidance-contract`
   - 备注：不得重复实现已完成的 command-metadata-registry core，只补 instructions 最小闭环需要的字段。

2. **agent-instructions-renderer** — 从 registry 生成 Claude / Codex agent instructions，并提供
   `archguard agent instructions` 只读输出。
   - 所属模块：Instruction Renderer / Onboarding CLI Commands
   - 依赖：`registry-agent-guidance-contract`
  - 状态：in-progress
  - 对应 feature：`2026-06-22-agent-instructions-renderer`
   - 备注：最小闭环；完成后用户能运行命令看到由 registry 生成的 agent 使用说明。

3. **registry-install-config-contract** — 扩展 registry 的 install/config 合同，加入 lifecycle、
   surface policy、artifact contract、InstallContract，并把 `help`、`agent`、`install`、`update`、
   `config` 纳入 CLI metadata；runtime baseline 与命令 shell 注册同步。
   - 所属模块：Install Config Contract
   - 依赖：`registry-agent-guidance-contract`
  - 状态：in-progress
  - 对应 feature：`2026-06-22-registry-install-config-contract`
   - 备注：为 provider adapters、install CLI、doctor 和 docs generated blocks 提供共同事实来源。

4. **provider-config-adapters** — 实现 Claude / Codex 配置 adapter，支持结构化读写、dry-run、
   backup、show 和 remove 的底层能力。
   - 所属模块：Provider Config Adapters
  - 依赖：`registry-install-config-contract`, `agent-instructions-renderer`
  - 状态：in-progress
  - 对应 feature：`2026-06-22-provider-config-adapters`
   - 备注：必须在临时 HOME fixture 中验证不会破坏已有非 ArchGuard 配置。

5. **agent-onboarding-cli** — 新增 `install` / `update` / `config show/remove` CLI，复用 provider
   adapters 和 instruction renderer 写入 Codex / Claude 配置。
   - 所属模块：Onboarding CLI Commands
   - 依赖：`agent-instructions-renderer`, `provider-config-adapters`
  - 状态：in-progress
  - 对应 feature：`2026-06-22-agent-onboarding-cli`
   - 备注：必须支持 `--dry-run`，默认保守写入。

6. **config-doctor-mcp-e2e** — 新增 `config doctor` 和真实 MCP probe，并把 install/config/
   instructions/registry drift 纳入 E2E 和 docs 校验。
   - 所属模块：MCP Probe And Doctor / Convergence Verification
   - 依赖：`agent-onboarding-cli`
  - 状态：in-progress
  - 对应 feature：`2026-06-22-config-doctor-mcp-e2e`
   - 备注：roadmap 收口条目；必须真实 build CLI 并在临时 HOME 下跑 Codex / Claude 安装和 doctor。

**最小闭环**：第 2 条 `agent-instructions-renderer` 做完后，用户可以运行
`archguard agent instructions codex` 和 `archguard agent instructions claude`，得到由
registry 生成、带 call-first / recovery / freshness 的 agent instructions。它不写用户配置，
但验证了 registry -> agent guidance 的第一条真实链路。

## 6. 排期思路

先做 `registry-agent-guidance-contract`，只补 instructions 最小闭环需要的字段；第二条做只读
`agent instructions`，把最小闭环压到“无用户配置写入”的低风险路径。第三条再补
`registry-install-config-contract`，为 install/config/update/doctor 命令提供完整合同。第四条做
provider adapters，把文件格式和安全写入边界先隔离。第五条暴露写配置 CLI。最后用
`config doctor` 和 E2E 收口，确保 Codex / Claude 的真实安装、MCP probe、docs 和 registry
drift 都能被 CI 看到。

本 roadmap 的实现基线是 `feature/command-metadata-registry` 分支中已完成的
`command-metadata-registry` roadmap。若该基线尚未合入目标开发分支，本 roadmap 不应在
`master` 上单独启动；应先合并或明确以该 feature 分支继续开发。

## 7. 深度规划底稿

### 目标完成信号

- `archguard agent instructions codex|claude` 能输出由 registry 生成的 provider profile。
- `archguard install codex|claude --dry-run` 能展示将写入的配置和 instructions。
- `archguard install codex|claude` 能在临时 HOME 中写入正确配置，不破坏已有配置。
- `archguard config doctor codex|claude --json` 能真实 probe MCP server 并给出 agent 可解析结果。
- README / user-guide / agent-surface 中 install/config/instructions 相关区块由 registry 或 renderer 校验。
- CI 能捕获 CLI/MCP/docs/instructions 与 registry 的 drift。

### Top 3 风险与缓解

1. **自动写用户配置破坏现有 MCP 配置**
   - 缓解：provider adapters 只修改 ArchGuard entry；结构化 parser；默认 backup；dry-run；
     临时 HOME E2E 覆盖“已有 server 保留”。
2. **instructions 又变成第二套手写文档**
   - 缓解：instructions renderer 只能从 registry agent guidance 渲染；E2E 断言 call-first /
     recovery 文本来自 registry；docs generated block 也复用同一 renderer。
3. **doctor 验证不真实，误报可用**
   - 缓解：doctor 必须独立启动当前 build 的 MCP server stdio 进程并执行 listTools；
     in-process MCP client 只能作为附加 fast-path，禁止用当前 agent 会话里已缓存的 MCP server 作为验证证据。

### 非显然依赖

- Codex TOML 读写需要可靠 TOML parser/serializer；若仓库没有依赖，feature design 需要评估新增轻量依赖
  或实现受控 serializer。
- Claude Code project/user scope 配置路径需要在 design 阶段核对当前 Claude Code 行为。
- MCP probe 需要复用 `@modelcontextprotocol/sdk`，并避免污染 stdout/stderr。
- 现有 `command-metadata-registry` roadmap 已完成，后续 feature 不应重做其基线，只做增量扩展。

### 关键假设

- `feature/command-metadata-registry` 分支中的 registry、docs renderer 和 MCP metadata drift tests 会作为本
  roadmap 的实现基线。
- 第一阶段只承诺 Claude Code 和 Codex；其他 provider 通过 adapter 接口预留，不进入验收。
- 用户可接受 install/config 命令默认保守写入，需要 `--force` 才覆盖已有 ArchGuard entry。

### 基线与验证入口

后续 feature 应优先使用：

```bash
npm run build
npm run type-check
npm run test:unit
npm run test:integration
npm run test:e2e
npm run docs:check
```

涉及完整 surface 或 install/config 的 feature 必须至少额外运行：

```bash
node dist/cli/index.js help --json
node dist/cli/index.js agent instructions codex
node dist/cli/index.js agent instructions claude
node dist/cli/index.js install codex --home <tmp-home> --dry-run
node dist/cli/index.js install claude --home <tmp-home> --dry-run
node dist/cli/index.js config doctor codex --home <tmp-home> --json
node dist/cli/index.js config doctor claude --home <tmp-home> --json
```

`--home <tmp-home>` 是本 roadmap 拍板的测试 home override，所有 install/config/update/doctor
命令都必须支持；E2E 禁止写真实用户 HOME。

### 交付物落点

- `src/cli/metadata/*`：扩展 registry 类型、validators、renderers。
- `src/cli/commands/*`：新增 agent/install/update/config 命令。
- `src/cli/agent/*` 或 `src/cli/config/agent/*`：provider adapters、doctor、probe。
- `tests/unit/cli/*`：metadata、renderer、adapter 单测。
- `tests/integration/cli-mcp/*`：MCP probe / listTools。
- `tests/e2e/*`：新建 E2E 目录，承载临时 HOME install/config/doctor E2E；已有
  `npm run test:e2e` 脚本直接指向该目录。
- README / docs generated blocks：安装配置和 agent instructions 使用说明。
- `.codestable/features/*`：每个 feature 的 design/review/QA/acceptance。

### 知识回写点

- 如果 Codex / Claude 配置路径或格式有稳定约定，acceptance 后应沉淀到
  `.codestable/attention.md` 或 guide。
- 如果 MCP probe 流程暴露“不能用当前会话 MCP 验证新代码”的坑，应补充到 agent surface 或 learning。
- 如果 TOML/JSON 配置写入形成通用模式，可沉淀为 trick 或 architecture update。

## 8. 观察项

- `docs/proposals/proposal-agent-install-and-command-registry.md` 目前在 discussion PR 分支中；
  本 roadmap 以该 proposal 为输入，但不要求 proposal 先合并。
- 现有 `docs/user-guide/mcp-usage.md` 已有手动 Codex / Claude 配置说明；落地后需要由 generated block
  或 renderer 校验替换其中事实表。
- `package.json` 目前没有 TOML parser 依赖；provider adapter feature 需要在 design 阶段做依赖选择。
