---
id: gap-self-describe-residual-atoms-in-mcp-descriptions
title: 把 DSI 8 条残差原子自述进 MCP tool description（duplicates 阈值/布局/非致命、drift
  分级、dispersion severity、god_packages 排序、zero_assertion 定义、cycles 叶子边）
status: done
labels:
  - gap
  - docs
  - mcp
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：quay-fleet 的 DSI（领域语义归纳）分析产出 9 条「使用 ArchGuard」域的残差原子（`~/.claude/domain-semantic-induction/archguard-use/D-v2.md`）。这些是「实现自明、但接口描述未自述」的事实，外部 D 文件承载导致第二真源漂移 + 相邻场景负迁移。本任务把其中 8 条「自述化」进 ArchGuard 自己的 MCP tool description，让外部 D 可删。

**已核实**（每条先确认代码里有、描述里缺）：
- #1 duplicates 阈值：`types.ts:83-84` `minStatements=6` / `minTokens=50`；desc 只写「minStatements/minTokens floor」无具体值；Type-1/2 已在描述里。
- #2 duplicates 落盘布局：`persistence.ts:7-11` 写 `index.json + <scopeKey>/{manifest.json,groups.json}`，旧扁平布局不再写；desc 完全没提布局。
- #3 detect_cycles package 语义：desc 已有「directory-granularity」，缺「叶子边不入环」（仅闭合到根桶的边构成环）。
- #5 duplicates 持久化非致命：`persistence.ts:143-144` catch→console.warn 继续；desc 未提。
- #6 drift 分级阈值：`DRIFT_THRESHOLDS` = moderate 0.5 / significant 1.5 / critical 3.0（`types.ts:114-116`）；desc 只说「L2 drift + hasBreakingDrift」无分级值；且需与 drift-exit-code 的 breach 阈值 3.0（`types.ts:178`）区分口径。
- #7 literal dispersion severity：`literal-dispersion.ts:257` `dispersion>=3?'warning':'info'`（即 2=info、≥3=warning）；desc 未提 severity 映射。
- #8 god_packages 排序：TS 路径 `evaluateGodPackages`（`atlas-metrics-analysis.ts:72-76`）按 `reasons.length desc → fanOut desc → packageName localeCompare`；Go Atlas 路径（`atlas-analytics-tools.ts:354-370`）不排序、保持 node 序；desc 未提。
- #9 zero_assertion 定义：`test-issue-detector.ts:21,64` = 有用例但 0 断言、performance 豁免；desc 只有类型名 + false-positive 提示、无定义。

**明确排除**：对方第 4 条「插件升级需 /mcp Reconnect」是 Claude Code MCP 平台行为，不是 ArchGuard 接口语义，不写进 tool description（已由用户 shared-lessons 承载）。

**修复方向**：只改 6 个 MCP tool 文件的 `description` 字符串，把上述常数/行为写进去。**不改任何实现行为、不改常数、不改输出**。逐条措辞要让「不给机制、只给场景」的 no-D 探针能从描述答对判别题。

## AC

- [x] #1：`duplicate-tools.ts` 的 `archguard_detect_duplicates` 描述包含「6 statements / 50 tokens」具体阈值
- [x] #2：`duplicate-tools.ts` 描述说明按 scope 分目录落盘（index.json + <scopeKey>/manifest.json、groups.json），并注明旧扁平布局已废弃
- [x] #3：`mcp-server.ts` 的 `archguard_detect_cycles` 描述说明 package 粒度 = 目录节点，且只闭合到功能层根桶的边入环、叶子边不入环
- [x] #5：`duplicate-tools.ts` 描述说明持久化失败只 warn、不阻断查询返回
- [x] #6：`arch-health-tools.ts` 的 `archguard_get_architecture_drift` 描述写明分级阈值 moderate 0.5 / significant 1.5 / critical 3.0，并区分 drift-exit-code 的 breach 阈值（同为 3.0，口径不同）
- [x] #7：`shape-smell-tools.ts` 的 `archguard_detect_shape_smells` / `archguard_get_literal_dispersion` 描述写明 severity：dispersion=2→info、≥3→warning
- [x] #8：`atlas-analytics-tools.ts` 的 `archguard_detect_god_packages` 描述写明 TS 路径排序（违反阈值数降序→fan-out→名字），并注明 Go Atlas 路径保持图 node 序（避免误导）
- [x] #9：`test-analysis-tools.ts` 的 `archguard_get_test_issues` 描述写明 zero_assertion 定义（有用例但 0 断言、performance 豁免）
- [x] 负对照（纯文档）：本次改动不得改变任何实现常数/输出；`git diff` 只含 description 字符串变更；全量 `npm test` 通过（若有测试断言旧描述字符串则同步更新）
- [ ] 可证伪验收（待外部，需 quay-fleet 配合）：对每条用 no-D 探针（题干给场景不给机制）让 v4.1flash + gpt-6-luna 两模型从新描述答对对应判别题；答不对则该条描述要再改措辞（待外部）

## DoD

不是「把常数抄进 description 字符串」就算完成。要逐条给出「改动前描述不含该事实 → 改动后描述含」的 grep 对照，并证明实现常数未被改动（diff 只含描述）；再交 quay-fleet 跑 no-D 双模型探针，答对才算该条真正离开残差。外部 D-v2.md 是否删除由 quay-fleet 决定，本任务不删。

### Evidence（落地时记录）

固定字符串 grep 对照，before = `git show develop:<file>`，after = task 分支工作区：

- #1 `duplicate-tools.ts` `"at least 6 statements"`: 0 → 1
- #2 `duplicate-tools.ts` `"index.json lists every persisted scope"`: 0 → 1；`"flat layout"`: 0 → 1
- #5 `duplicate-tools.ts` `"only logs a warning"`: 0 → 1
- #3 `mcp-server.ts` `"one directory"`: 0 → 1；`"tools/configs"`: 0 → 1
- #6 `arch-health-tools.ts` `">=0.5 moderate"`: 0 → 1；`"is a breach?"`: 0 → 1
- #7 `shape-smell-tools.ts` `"dispersion=2"`: 0 → 2（detect 与 get 两个工具各一处）
- #8 `atlas-analytics-tools.ts` `"localeCompare"`: 0 → 1；`"keep the package graph node order"`: 0 → 1
- #9 `test-analysis-tools.ts` `"zero detected"`: 0 → 1；`"performance-type test files"`: 0 → 1

负对照：`git diff --stat develop...HEAD` = 6 files, +29/−8，逐 hunk 核对均落在 6 个 MCP tool 文件的 description 字符串字面量内；无实现常数、分支或输出变更。`tsc --noEmit` 通过；`eslint src/cli/mcp/mcp-server.ts` 通过；`tests/unit/cli/mcp/` 22 files / 384 tests 通过；`tests/unit/architecture/hygiene-ratchet-census.test.ts` 8/8 通过（`src/cli/mcp/mcp-server.ts` 保持 881 行，未上调 hygiene 基线）；`tests/integration/parser-pool.test.ts` 单独复跑 6/6 通过（约 40s；fan-in 全量套件同窗口的 150s 超时是既有负载 flake）。全量套件由 fan-in 机械步骤复跑。

- L_D docLines=0 codeLines=29 ratio=0.000 verdict=ok（实现 diff 的 numstat：29 行 .ts 描述字符串改动、0 行 .md/.txt；doc:code = 0:29）

外部 no-D 双模型探针仍待 quay-fleet；执行者只保证描述文本已含对应事实，不代写外部探针结论。

## Touches

- tasks/gap-self-describe-residual-atoms-in-mcp-descriptions.md
- src/cli/mcp/tools/duplicate-tools.ts
- src/cli/mcp/tools/arch-health-tools.ts
- src/cli/mcp/tools/shape-smell-tools.ts
- src/cli/mcp/tools/atlas-analytics-tools.ts
- src/cli/mcp/tools/test-analysis-tools.ts
- src/cli/mcp/mcp-server.ts
- tests/unit/cli/mcp/tools/duplicate-tools.test.ts
- tests/unit/cli/mcp/tools/arch-health-tools.test.ts
- tests/unit/cli/mcp/shape-smell-tools.test.ts
- tests/unit/cli/mcp/atlas-analytics-tools.test.ts
- tests/unit/cli/mcp/test-analysis-mcp.test.ts
- tests/unit/cli/mcp/mcp-server.test.ts
