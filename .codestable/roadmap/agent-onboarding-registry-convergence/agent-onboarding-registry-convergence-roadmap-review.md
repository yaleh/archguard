---
doc_type: roadmap-review
roadmap: agent-onboarding-registry-convergence
status: passed
reviewed: 2026-06-22
round: 1
---

# agent-onboarding-registry-convergence roadmap 审查报告

## 1. Scope And Inputs

- Roadmap: `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md`
- Items: `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-items.yaml`
- Related docs:
  - `.codestable/attention.md`
  - `.codestable/architecture/ARCHITECTURE.md`
  - `.codestable/roadmap/command-metadata-registry/command-metadata-registry-roadmap.md`
  - `.codestable/roadmap/command-metadata-registry/command-metadata-registry-items.yaml`
  - `docs/adr/006-mcp-tool-design-standards.md`
  - `docs/adr/007-cli-mcp-interface-parity.md`
  - `docs/proposals/proposal-agent-install-and-command-registry.md`
- Code facts checked:
  - `src/cli/metadata/types.ts`
  - `src/cli/metadata/registry.ts`
  - `src/cli/index.ts`
  - `src/cli/commands/mcp.ts`
  - `package.json`

### Independent Review

- Status: completed
- Detection: paseo-subagent
- Provider / agent: `claude/opus`, agent id `4e6859fb-1866-422c-b0e3-66c46e8625f3`
- Raw output: Paseo notification returned findings B1-B3, I1-I5, N1-N3, R1-R2.
- Merge policy: 已逐条核验；采纳 B1/B2/I1/I2/I3/I4/I5/N1/N2/N3/R1/R2 并修订 roadmap/items。
  B3 被驳回：按 `.codestable/reference/shared-conventions.md` 和 `cs-roadmap`，planned item
  在 feature-design 启动前 `feature: null` 是合法初始状态；feature design 阶段才写入
  `YYYY-MM-DD-{slug}`。
- Gate effect: none

## 2. Roadmap Summary

- Goal completion signal: 用户能通过 `archguard agent instructions`、`archguard install`、
  `archguard config doctor` 完成 Codex / Claude 接入、诊断和恢复；CI 能验证 registry /
  docs / instructions / MCP probe 不漂移。
- Module split: Metadata Contract、Instruction Renderer、Provider Config Adapters、
  Onboarding CLI Commands、MCP Probe And Doctor、Convergence Verification。
- Interface contracts: roadmap 定义了 Extended Command Metadata、Instruction Render Contract、
  Provider Config Adapter、CLI Command Surface、Doctor Result。
- Items: 6 个 feature 已进入 design 阶段；`agent-instructions-renderer` 是 minimal loop。
- Dependency shape: DAG，无未知依赖和自依赖；`agent-onboarding-cli` 依赖 instructions renderer
  和 provider adapters，`config-doctor-mcp-e2e` 收口。

## 3. Findings

### blocking

- none

### important

- [x] RMR-001 `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md#frontmatter` proposal 追溯链不明确
  - Evidence: independent reviewer 指出 roadmap 以 `docs/proposals/proposal-agent-install-and-command-registry.md` 为输入，但 frontmatter 未记录 proposal。
  - Impact: 用户无法确认 roadmap 继承了 proposal 的哪些决策点。
  - Resolution: 增加 `source_proposals`，并在背景节列出直接继承且不重新争论的决策点。

- [x] RMR-002 `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md#7` E2E 落点悬空
  - Evidence: repo 当前无 `tests/e2e/`，但 roadmap 原计划把收口 E2E 放在 `tests/e2e/*`。
  - Impact: E2E 验证入口不可执行。
  - Resolution: 明确本 roadmap 新建 `tests/e2e/`，复用现有 `npm run test:e2e` 脚本。

- [x] RMR-003 `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md#4.4` `--home` 测试 override 未拍板
  - Evidence: 原文把 `--home` 或环境变量留给 feature design。
  - Impact: install/config/doctor E2E 无统一入口。
  - Resolution: 拍板 `--home <dir>` 为唯一测试 HOME override，所有 install/config/update/doctor 命令必须支持。

- [x] RMR-004 `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md#4.5` doctor probe 最低要求不明确
  - Evidence: 原文允许 stdio 或 in-process MCP client。
  - Impact: in-process 无法证明 `archguard mcp` stdio 启动路径可用。
  - Resolution: 明确 doctor 最低要求为独立 stdio 进程 initialize/listTools，默认 5 秒超时；in-process 只能作附加 fast-path。

- [x] RMR-005 `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md#5` 最小闭环被完整 contract 阻塞
  - Evidence: 原 `agent-instructions-renderer` 依赖完整 `registry-contract-for-onboarding`。
  - Impact: 最小闭环要等 install/config 合同完成后才能验证。
  - Resolution: 拆成 `registry-agent-guidance-contract` 和 `registry-install-config-contract`；最小闭环只依赖前者。

- [x] RMR-006 `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md#4.1` 新 CLI 命令和 `help` baseline 未明确
  - Evidence: 当前 `help` 不在 registry baseline，新 roadmap 会新增 `agent/install/update/config`。
  - Impact: 后续 drift tests 的预期不清。
  - Resolution: 明确 `help` 进入 registry 但为 `cli-only`；新增命令进入 `cliCommandBaseline`，install/update/config 声明 `InstallContract`。

- [x] RMR-007 `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md#4.1` InstallContract 和 DocsContract 交互规则缺失
  - Evidence: 原文定义两个 contract 但未规定互相约束。
  - Impact: docs / instructions 可能继续漂移。
  - Resolution: 增加 validator 约束：`writesInstructions` 要求 `includeInAgentSurface`；provider=all 必须逐 provider 报告结果。

- [x] RMR-008 `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md#4.3` Codex TOML parser 风险
  - Evidence: package 当前无 TOML parser，原文把选择推到 design。
  - Impact: 可能手写脆弱 serializer 破坏用户配置。
  - Resolution: 增加硬约束：Codex 默认使用活跃维护 parser/serializer；手写 serializer 必须证明等价性。

### nit

- [x] RMR-009 `src/cli/metadata/types.ts` MetadataCategory 现状未在 roadmap 承认
  - Resolution: 在 Extended Command Metadata 约束中注明 category 以 `types.ts` 为准，并列出当前集合。

- [x] RMR-010 `docs/user-guide/agent-surface.md` 与 instruction renderer 关系未声明
  - Resolution: 明确 `instruction-renderer.ts` 是 `docs-renderer.ts` 的兄弟模块，docs renderer 可调用它渲染 agent surface 区块。

- [x] RMR-011 `docs/proposals/proposal-agent-install-and-command-registry.md` 提到 shell completion，但 roadmap 未排除
  - Resolution: 在明确不做中加入 shell completion 生成不在本 roadmap 范围。

### suggestion

- none

### learning

- 当前 roadmap 正确避免重复规划已完成的 `command-metadata-registry` 基线，把本次范围聚焦为
  agent onboarding 和更深层 registry convergence。

### praise

- roadmap 明确把真实 MCP probe 与临时 HOME install E2E 作为收口验收，降低“配置看似写入但 agent 不可用”的风险。
- independent reviewer 提出的 `feature: null` finding 被本地核验后驳回：在 CodeStable roadmap 阶段，
  planned items 的 `feature: null` 是正确状态，feature-design 启动时才写入 feature 目录。

## 4. User Review Focus

- 用户需要重点拍板：
  - 第一阶段 provider 是否只覆盖 Codex 和 Claude Code。
  - `archguard install` 默认是否允许写用户级配置，还是默认 project scope。
  - shell completion 明确不在本 roadmap 内是否接受。
- 后续 feature-design 需要重点复核：
  - Codex TOML parser/serializer 依赖选择。
  - Claude Code user/project scope 配置路径。
  - 独立 stdio MCP probe 的 CI 超时和错误恢复。
- 不能靠 roadmap review 完全确认的点：
  - 当前本机 Claude / Codex 配置格式的最新细节，需要 feature design 阶段以代码或命令事实核验。

## 5. Residual Risk

- Provider 配置路径和格式可能随 Codex / Claude Code 版本变化；后续 feature 需要把 doctor recovery
  和 parser 错误处理写成可维护边界。

## 6. Verdict

- Status: passed
- Next: 交给用户 review；用户确认后把 roadmap 标为 active，并进入所有 feature design 阶段。
