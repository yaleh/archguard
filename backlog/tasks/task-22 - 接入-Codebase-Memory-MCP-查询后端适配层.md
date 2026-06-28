---
id: TASK-22
title: 接入 Codebase Memory MCP 查询后端适配层
status: 'Epic: Backlog'
assignee: []
created_date: '2026-06-28 01:25'
updated_date: '2026-06-28 01:34'
labels:
  - 'kind:epic'
dependencies: []
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
实现 docs/proposals/proposal-codebase-memory-backend-adapter.md 这套设计：为 ArchGuard 查询能力增加可选的 codebase-memory-mcp 外部图后端适配层（CLI query 命令 + MCP 查询类工具），默认行为不变，支持 archguard|codebase-memory|auto 后端选择、project 解析、查询映射、统一 result envelope、错误归一化、config doctor 只读检查与文档。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Epic Proposal: 接入 Codebase Memory MCP 查询后端适配层

## Background

ArchGuard 的查询能力（CLI `query` 命令与 `archguard_*` MCP 工具）当前**强依赖** `archguard analyze` 生成的 `.archguard/query` 产物（`manifest.json`、`arch.json`、`arch-index.json`）。一旦项目未执行过 analyze 或产物缺失，`engine-loader.ts` 直接抛出 "Run `archguard analyze` first"，MCP 工具同样提示先索引，agent 只能退回 grep / 文件搜索——结构查询退化成文本匹配，token 与延迟成本陡增。与此同时，`codebase-memory-mcp` 已能通过持久化 SQLite 图谱提供 `search_graph` / `trace_path` / `get_code_snippet` / `get_architecture` 等查询，若同一仓库已被它索引，ArchGuard 却无法复用。这是一个**横切多个查询入口**（CLI query、`archguard_find_entity`、`archguard_get_file_entities`、`archguard_find_callers`、`archguard_summary`）的集成问题：后端选择、project 解析、result envelope、错误归一化、doctor 检查彼此耦合，需作为 epic 统一协调，逐入口分阶段落地，否则各入口会各自发明不一致的 fallback 语义。

## Goals

1. 不传 `--backend`（CLI）/ 不传 `backend`（MCP）时，现有 ArchGuard CLI 与 MCP 查询行为**逐字节不变**——通过现有 query 测试套件全绿验证。
2. 新增独立窄集成层 `src/integrations/codebase-memory/`（`types.ts` / `client.ts` / `project-resolver.ts` / `adapter.ts`），CLI 与 MCP 工具仅依赖 `adapter`，**不直接拼 subprocess**——通过 grep 确认 `src/cli/` 下无 `codebase-memory-mcp` 字面 subprocess 调用验证。
3. `archguard query --entity <name> --backend codebase-memory` 在**无 `.archguard/query`** 的情况下，能从已索引的 Codebase Memory project 返回符号结果。
4. `--backend auto` 在 ArchGuard 产物缺失 / 结果为空 / 不支持时 fallback，且**响应 envelope 明确标注 provenance**（`backend: "archguard" | "codebase-memory" | "combined"`、`projectRoot`、可选 `codebaseMemoryProject` / `stale` / `diagnostics`）。
5. binary 缺失、project 未索引、timeout、JSON 解析失败均**归一化为可读 diagnostics**（含 `index_repository` 等 next steps），不泄漏 subprocess 细节、不让 MCP server 崩溃。
6. `archguard config doctor codebase-memory` 在**不修改用户环境**的前提下报告 binary / CLI 可调用性 / project resolution / 索引状态。
7. `codebase-memory-mcp` 保持**可选依赖**：不进 `package.json` `dependencies`、不 `postinstall` 下载、普通 `archguard mcp` 启动不强制检查；单元测试不要求本机安装（通过 fixture + mock client）。
8. 文档覆盖 setup、indexing、backend selection 与 limitations（明确不走 Codebase Memory 的能力：Atlas、测试分析、git history、架构图生成、analyze）。

## Decomposition Sketch

- **集成层骨架：CodebaseMemoryClient + Project Resolver + Result Envelope**（对应阶段 1）— 新建 `src/integrations/codebase-memory/{types,client,project-resolver}.ts`：`client.ts` 封装 `codebase-memory-mcp cli <tool> <json>`（timeout / stdout-stderr / JSON parse / 错误归一化）；`project-resolver.ts` 基于 `list_projects` 实现 auto 解析（精确 path → 目录名 → 歧义诊断）；`types.ts` 定义 `BackendResult<T>` envelope。配 mock 单元测试与合约 fixture（`search_graph.*.json` / `trace_path.*.json` / `list_projects.json`）。
- **查询意图映射 adapter**（对应阶段 2-4 的映射逻辑）— 新建 `src/integrations/codebase-memory/adapter.ts`：把 ArchGuard 查询意图映射到 Codebase Memory 工具——`findEntity`→`search_graph(name_pattern)`、`getFileEntities`→`search_graph(file_pattern)`、`findCallers`→`trace_path(direction:inbound)`、snippet enrichment→`get_code_snippet`、summary enrichment→`get_architecture`；含 trace 失败时回退 `search_graph` 候选消歧、返回大小 limit。
- **CLI `query` 命令后端接入**（对应阶段 2-5 的 CLI 侧）— 在 `src/cli/commands/query.ts` 增加 `--backend archguard|codebase-memory|auto`、`--cbm-project`，串接 adapter 与现有 `engine-loader.ts` 路径；`--entity`(P2)、`--file`(P3)、`--callers`(P4) 支持 fallback/codebase-memory，`--summary`(P5) 仅 enrichment；CLI 文本输出加 provenance 页脚；默认仍 `archguard`。
- **MCP 查询工具后端接入**（对应阶段 2-5 的 MCP 侧）— 给 `src/cli/mcp/mcp-server.ts`（`archguard_find_entity` / `archguard_get_file_entities` / `archguard_summary`）与 `src/cli/mcp/tools/call-graph-tools.ts`（`archguard_find_callers`）增加可选 `backend` / `projectRoot` / `codebaseMemoryProject` 入参，返回统一 envelope；默认行为不变。
- **配置 schema 接入 `queryBackends`**（横切阶段 1-5）— 在 `src/types/config-global.ts`（`GlobalConfig` / `ArchGuardConfig`）与 `src/cli/config-loader.ts` zod schema 增加可选 `queryBackends`（`primary` / `fallback` / `codebaseMemory.{command,project,autoIndex,timeoutMs,maxResults}`）；显式 CLI/MCP 参数优先级高于配置。
- **`config doctor codebase-memory` 只读检查命令**（对应阶段 1 的 doctor 项）— 新增 doctor 子命令（PR #60 的 install/doctor provider 框架若届时已合入则复用其 dry-run/backup 语义，否则按提案契约新增）：检查 PATH/配置 command、`list_projects` 可执行性、project 解析、索引状态，输出结构化 `{ok, binary, project, nextSteps}`，绝不修改环境。
- **文档与示例**（对应阶段 6）— 更新 user-guide / dev-guide：安装预期、doctor 用法、`index_repository` 索引命令、backend 选择语义与限制、CLI/MCP 示例，并说明为何普通查询路径不自动索引。

## Trade-offs and Risks

**不做（非目标）**：不替换 `archguard analyze` / ArchJSON / Mermaid·PlantUML / Atlas / 测试分析 / git history；不导入 Codebase Memory 的 SQLite schema；不在 ArchGuard 内重实现 Cypher-like / 语义搜索 / Hybrid LSP；不在普通查询路径自动 `index_repository`；不给现有 CLI/MCP 命令新增硬运行时依赖；第一阶段不走 "ArchGuard 调用 agent 侧 MCP tool"（改用 CLI process boundary，避开跨 host MCP 注册不可控问题）。

**已知风险与缓解**：
- **Schema 不一致**（ArchGuard `Entity` ≠ Codebase Memory graph node）：用统一 envelope + 显式 provenance，无法无损映射的字段放入 `raw`/`source`，不伪装成同一对象。
- **依赖边界被误解**（用户误以为从此强依赖外部 binary）：默认后端恒为 `archguard`，仅显式配置/参数启用，测试默认不依赖外部 binary。
- **`auto` 行为不确定**（同一命令因机器是否安装/索引而表现不同）：CLI 默认 `archguard`，`auto` 需显式开启，MCP 是否默认 `auto` 待适配层稳定后再定（提案待定问题）。
- **新鲜度混淆**（两套 index 时间不同步）：只在 Codebase Memory 明确报告 stale/failed 时标 `stale:true`，不自证其新鲜，不静默合并双来源结果。
- **返回结果过大**（图搜索撑爆 agent context）：小默认 limit + 支持显式 limit + 对高容量输出做摘要。
- **PR #60 依赖不确定**（install/doctor provider 框架是否已合入未知）：doctor 子任务设计为"复用 if 已合入，否则按契约新增"，不阻塞 epic 其余子任务。

---

# Epic Plan: 接入 Codebase Memory MCP 查询后端适配层

## Background

ArchGuard 的查询能力（CLI `query` 命令与 `archguard_*` MCP 工具）当前**强依赖**
`archguard analyze` 生成的 `.archguard/query` 产物（`manifest.json`、`arch.json`、
`arch-index.json`）。一旦项目未执行过 analyze 或产物缺失，`src/cli/query/engine-loader.ts`
直接抛出 "Run `archguard analyze` first"，MCP 工具同样提示先索引，agent 只能退回
grep / 文件搜索——结构查询退化成文本匹配，token 与延迟成本陡增。与此同时，
`codebase-memory-mcp` 已能通过持久化 SQLite 图谱提供 `search_graph` / `trace_path` /
`get_code_snippet` / `get_architecture` 等查询，若同一仓库已被它索引，ArchGuard 却无法复用。

这是一个**横切多个查询入口**（CLI `query`、`archguard_find_entity`、
`archguard_get_file_entities`、`archguard_find_callers`、`archguard_summary`）的集成问题：
后端选择、project 解析、result envelope、错误归一化、doctor 检查彼此耦合，必须作为 epic
统一协调、逐入口分阶段落地，否则各入口会各自发明不一致的 fallback 语义。完整设计见
`docs/proposals/proposal-codebase-memory-backend-adapter.md`（分阶段计划 阶段 1-6、查询映射、
错误处理、测试策略、验收标准）。

## Goals

1. **默认行为逐字节不变**：不传 `--backend`（CLI）/ 不传 `backend`（MCP）时，现有
   ArchGuard CLI 与 MCP 查询行为保持不变——通过现有 query 测试套件全绿验证。
2. **独立窄集成层**：新增 `src/integrations/codebase-memory/`（`types.ts` / `client.ts` /
   `project-resolver.ts` / `adapter.ts`），CLI 与 MCP 工具仅依赖 `adapter`，不直接拼
   subprocess——通过 grep 确认 `src/cli/` 下无 `codebase-memory-mcp` 字面 subprocess 调用验证。
3. **entity 查询 codebase-memory 后端可用**：`archguard query --entity <name> --backend
   codebase-memory` 在无 `.archguard/query` 的情况下，能从已索引的 Codebase Memory project
   返回符号结果。
4. **`auto` fallback 带 provenance**：`--backend auto` 在 ArchGuard 产物缺失 / 结果为空 /
   不支持时 fallback，响应 envelope 明确标注 provenance（`backend`、`projectRoot`、可选
   `codebaseMemoryProject` / `stale` / `diagnostics`）。
5. **错误归一化**：binary 缺失、project 未索引、timeout、JSON 解析失败均归一化为可读
   diagnostics（含 `index_repository` 等 next steps），不泄漏 subprocess 细节、不让 MCP server 崩溃。
6. **只读 doctor**：`archguard config doctor codebase-memory` 在不修改用户环境的前提下，
   报告 binary / CLI 可调用性 / project resolution / 索引状态。
7. **可选依赖**：`codebase-memory-mcp` 不进 `package.json` `dependencies`、不 `postinstall`
   下载、普通 `archguard mcp` 启动不强制检查；单元测试不要求本机安装（fixture + mock client）。
8. **文档覆盖**：覆盖 setup、indexing、backend selection 与 limitations（明确不走 Codebase
   Memory 的能力：Atlas、测试分析、git history、架构图生成、analyze）。

## Sub-Task Decomposition

> 以下为预期 child basic task 的稳定清单。自治 epic worker 后续会把每条转成真实 child task。
> 这里**不创建**任何 child。每条 child 设计为 Basic-Task 粒度（可含多 phase、约 1000s LOC），
> 并锚定到已确认存在的真实模块。

1. **集成层骨架：Client + Project Resolver + Result Envelope** — 新建
   `src/integrations/codebase-memory/{types,client,project-resolver}.ts`：`client.ts` 封装
   `codebase-memory-mcp cli <tool> <json>`（timeout / stdout-stderr 捕获 / JSON parse /
   错误归一化），`project-resolver.ts` 基于 `list_projects` 实现 auto 解析（精确 path →
   目录名 → 歧义诊断），`types.ts` 定义 `BackendResult<T>` envelope 与诊断类型；配 mock
   单元测试与合约 fixture（`search_graph.*.json`、`trace_path.*.json`、`list_projects.json`）。
   对应阶段 1。

2. **配置 schema 接入 `queryBackends`** — 在 `src/types/config-global.ts`（`GlobalConfig` /
   `ArchGuardConfig` 接口）与 `src/cli/config-loader.ts` 的 zod schema 增加可选 `queryBackends`
   （`primary` / `fallback` / `codebaseMemory.{command,project,autoIndex,timeoutMs,maxResults}`），
   并约定显式 CLI/MCP 参数优先级高于配置；含 schema 默认值与校验单测。横切阶段 1-5，作为后续
   CLI/MCP 接入的前置基座。

3. **查询意图映射 adapter** — 新建 `src/integrations/codebase-memory/adapter.ts`：把 ArchGuard
   查询意图映射到 Codebase Memory 工具——`findEntity`→`search_graph(name_pattern)`、
   `getFileEntities`→`search_graph(file_pattern)`、`findCallers`→`trace_path(direction:inbound)`、
   snippet enrichment→`get_code_snippet`、summary enrichment→`get_architecture`；含 `trace_path`
   失败时回退 `search_graph` 候选消歧、返回大小 limit；配 mock 单测。对应阶段 2-5 的映射逻辑。

4. **CLI `query` 命令后端接入** — 在 `src/cli/commands/query.ts` 增加
   `--backend archguard|codebase-memory|auto` 与 `--cbm-project`，串接 adapter 与现有
   `src/cli/query/engine-loader.ts` / `src/core/query/{entity-query-service,relation-query-service,
   query-engine}.ts` 路径；`--entity`、`--file`、`--callers` 支持 fallback / codebase-memory，
   `--summary` 仅 enrichment；CLI 文本输出加 provenance 页脚；默认仍 `archguard`。对应阶段 2-5 CLI 侧。

5. **MCP 查询工具后端接入** — 给 `src/cli/mcp/mcp-server.ts`（`archguard_find_entity` /
   `archguard_get_file_entities` / `archguard_summary`）与 `src/cli/mcp/tools/call-graph-tools.ts`
   （`archguard_find_callers`）增加可选 `backend` / `projectRoot` / `codebaseMemoryProject` 入参，
   返回统一 envelope，默认行为不变。对应阶段 2-5 MCP 侧。

6. **`config doctor codebase-memory` 只读检查命令** — 新增 doctor 子命令（PR #60
   `feature/command-metadata-registry` 当前为 OPEN/未合入；设计为"复用 if 届时已合入其
   install/doctor provider 框架及 dry-run/backup 语义，否则按提案契约新增"）：检查 PATH /
   配置 `command`、`list_projects` 可执行性、project 解析、索引状态，输出结构化
   `{ok, binary, project, nextSteps}`，绝不修改环境。对应阶段 1 的 doctor 项。

7. **文档与示例** — 更新 `docs/user-guide` / `docs/dev-guide`：安装预期、doctor 用法、
   `index_repository` 索引命令、backend 选择语义与限制、CLI/MCP 示例，并说明为何普通查询路径
   不自动索引。对应阶段 6。

## Sequencing

整体按提案阶段 1→6 的分层推进：**集成层骨架 → adapter 映射 → CLI/MCP 接入 → doctor → 文档**。

- **Child 1（集成层骨架）** 与 **Child 2（config schema）** 是基座，可**并行**进行：
  child 1 建 `types/client/project-resolver` 与 fixture，child 2 建 `queryBackends` 配置类型与
  zod schema。两者互不依赖，但都必须先于映射与接入层落地。
- **Child 3（adapter 映射）** 依赖 child 1 的 `client` / `project-resolver` / `types`（envelope）；
  必须在 child 1 之后。可与 child 2 重叠，但消费 schema 默认值（command/timeout/maxResults）需
  child 2 的类型就绪。
- **Child 4（CLI 接入）** 与 **Child 5（MCP 接入）** 都依赖 child 3 的 adapter 与 child 2 的配置；
  二者面向不同入口、互不依赖，可在 child 3 落地后**并行**进行。
- **Child 6（doctor）** 依赖 child 1 的 `client` / `project-resolver`（复用其检查能力）与 child 2 的
  `command` 配置；与 child 4 / child 5 无强耦合，可在 child 1+2 之后随时进行（含 PR #60 合入与否
  的复用/新建分支判断）。
- **Child 7（文档）** 依赖前序面向用户的能力（child 4 / 5 / 6）基本就绪，**最后**进行，覆盖
  setup / doctor / indexing / backend 选择与 limitations。

推荐落地顺序：`(1 ‖ 2) → 3 → (4 ‖ 5) → 6 → 7`。

## Constraints

- **默认行为不变**：不传 `--backend` / `backend` 时，CLI 与 MCP 查询逐字节不变，现有 query
  测试套件保持全绿。
- **不进硬依赖**：`codebase-memory-mcp` 不进 `package.json` `dependencies`、不 `postinstall`
  下载、`archguard mcp` 启动不强制检查；单元测试不要求安装 `codebase-memory-mcp`（fixture + mock）。
- **统一 envelope 标注 provenance**：所有后端感知响应使用 `BackendResult<T>` envelope，显式标注
  `backend` / `projectRoot` / 可选 `codebaseMemoryProject` / `stale` / `diagnostics`；不静默合并
  双来源结果，不自证 Codebase Memory index 新鲜度（仅在其明确报告 stale/failed 时标 `stale:true`）。
- **adapter 边界隔离**：CLI / MCP 仅依赖 `adapter`，`src/cli/` 下不得出现 `codebase-memory-mcp`
  字面 subprocess 调用。
- **不自动索引、不改用户环境**：普通查询路径不执行 `index_repository`；doctor 只读不修改环境。
- **不替换 ArchGuard 自有能力**：Atlas、测试分析、git history、架构图生成、`archguard analyze`
  不走 Codebase Memory。
- **测试命令**：每 phase 用 `npm test -- --run`，全量用 `npm test`；类型检查 `npm run type-check`、
  lint `npm run lint`。
- **doctor 复用判定**：PR #60 provider/doctor 框架当前未合入；child 6 须在实现时重新判定"复用 if
  已合入，否则按契约新增"，不阻塞 epic 其余子任务。

## Goal → Child Coverage 检查

- Goal 1（默认行为不变）→ Child 4、Child 5（默认 `archguard` 分支保持；现有 query 测试全绿）。
- Goal 2（独立窄集成层 + 仅依赖 adapter）→ Child 1（建层）、Child 3（adapter）、Child 4 / Child 5
  （仅依赖 adapter）。
- Goal 3（entity 查询 codebase-memory 后端）→ Child 3（`findEntity`→`search_graph` 映射）、
  Child 4（CLI `--entity --backend codebase-memory`）。
- Goal 4（auto fallback + provenance envelope）→ Child 1（envelope 类型）、Child 3（fallback 映射）、
  Child 4 / Child 5（接入并输出 provenance）。
- Goal 5（错误归一化）→ Child 1（client 错误归一化为 diagnostics）、Child 3（不支持/歧义诊断）、
  Child 6（next steps 复用）。
- Goal 6（只读 doctor）→ Child 6。
- Goal 7（可选依赖 / 单测不依赖 binary）→ Child 1（mock client + fixture）、Child 2（配置可选，
  无硬依赖）、Child 6（仅显式 doctor 时检查）。
- Goal 8（文档覆盖）→ Child 7。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Epic proposal self-review: APPROVED
premise-ledger:
[E] background 行数与 WHY: 直接读 etb-proposal.md Background 段（单段约10行，含强依赖→grep退化→无法复用 因果）
[E] Goals 编号且可验证: 直接读文件，8 条均带验证手段（测试/grep/envelope字段/不修改环境）
[E] Decomposition ≥2 且每条一行 scope: 直接读文件，共 7 条候选子任务
[C] decomposition 覆盖 Goals: 须逐条对照 Goals 1-8 与 7 个子任务映射（骨架→G2/3/4/5，config→queryBackends，doctor→G6，可选依赖→G7，文档→G8，默认不变→G1）
[E] 模块路径真实存在: 已 grep/ls 确认 src/cli/commands/query.ts、src/cli/query/engine-loader.ts、src/core/query/{entity,relation}-query-service.ts、src/cli/mcp/mcp-server.ts、src/cli/mcp/tools/call-graph-tools.ts、src/types/config-global.ts、src/cli/config-loader.ts 存在
[E] src/integrations 为新增: ls 确认当前不存在
[E] PR #60 doctor/install 框架未合入: grep doctor/provider 在 src/ 无结果，故 doctor 子任务设计为条件复用
[C] trade-offs/风险完整: 对照 proposal 非目标与风险章节核对（6 风险均有缓解）
[H] epic 粒度基准: 7 个候选子任务是否为合理 epic 粒度靠背景知识判断
[H] background 8 行上界判定: 单段密集文本按视觉行计约 10 行，是否超 8 行上界靠主观判断（判为可接受）
GCL-self-report: E=6 C=2 H=2

Epic proposal approved. Starting epic plan draft.

Epic plan review iteration 1: APPROVED
premise-ledger:
[E] sub-task count: 从 plan 文件直接数出 7 条 child
[E] no-premature-creation: plan 显式声明不创建任何 child
[E] sequencing acyclic: (1‖2)→3→(4‖5)→6→7 无环
[C] goal coverage: 对照 Goals 1-8 逐条独立构建映射验证
[C] file-path feasibility: grep 实际源码确认所有引用模块存在，src/integrations 正确缺席
[C] adapter 边界隔离: grep src/cli 确认无 codebase-memory-mcp 字面 subprocess
[H] scope discipline: child 粒度判断靠背景知识
[H] sequencing 合理性: 基座先于消费者顺序靠背景知识
GCL-self-report: E=3 C=3 H=2

cap:propose=approved
<!-- SECTION:NOTES:END -->
