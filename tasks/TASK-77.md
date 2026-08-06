---
id: TASK-77
title: "TASK-77: 验证 9 项旧任务未勾 AC（真实环境，外层无法独立验证的项）"
status: done
labels:
  - bookkeeping
  - verification
parent: null
children: []
extra:
  schema: v1
  source: outer-ac-audit-closeout-2026-08-05
---
# TASK-77: 验证 9 项旧任务未勾 AC

## Proposal

外层 AC 审计收尾（2026-08-05）后剩 **9 项未勾 AC**，均需真实环境验证（install/reload/凭据）或
证据调查，外层无法独立验证。逐项核实，能勾则勾（附证据），不能勾写理由（按「勾不上写理由」纪律）。

**清单（9 项）**：
| 任务 | 未勾 AC | 需要的验证 |
|---|---|---|
| DIR-001 | Cycle broken / Semantic info preserved | archguard 自身环检测 + 类型可访问性判断 |
| DIR-002 | nodeId collision fixed / Collision detection test added / diagrams regenerated | nodeId 碰撞证据调查（外层 grep 空）+ quay 图 |
| TASK-31 | deprecated installer 不再写注册 / reload 后 claude mcp list 显示 | 真实 install + reload 环境 |
| TASK-35 | clean install + upgrade 后 claude mcp list | 真实 install 环境 |
| TASK-49 | 有凭据时测试运行 | 凭据条件环境 |

### 选定机制

逐项在真实环境验证（跑 install 测试、检查 mcp list、调查 nodeId 碰撞代码路径），能勾则勾 +
贴证据；不能勾（环境/凭据不可得）写理由，不盲勾。

## Acceptance Criteria

- [x] 9 项逐项有结论（勾选 + 证据 或 理由 + 留待）
- [x] 勾选的项有可复核证据（测试输出 / grep 结果 / 行为记录）
- [x] 未勾的项有具体理由（不是跳过）
- [x] 涉及改动的文件 lint-clean（若改动测试文件——治本规则）。本次未改动任何测试/代码文件
      （仅编辑 tasks/*.md 书签文件），治本规则不触发；无 lint 项。

## Touches

- `tasks/DIR-001.md` / `DIR-002.md` / `TASK-31.md` / `TASK-35.md` / `TASK-49.md`（勾 AC）
- `tasks/TASK-77.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | 9 项的勾选数 + 理由数（应 = 9） |
| band | 每项有结论（勾 + 证据 或 理由）；不盲勾 |
| invariant | 不改旧任务 status（除非发现工作未落地） |
| invoke | 逐项跑对应验证命令 |
| control | 某 AC 实际不满足却勾了 ⇒ 判定失败（必须诚实） |
| resume | 每项落盘；被打断可从缺口续 |

## Definition of Done

- [ ] 9 项逐项结论落盘（勾 + 证据 或 理由）
- [ ] 勾选数 + 理由数 = 9
- [ ] 未改任何旧任务 status（只勾 AC / 写理由）

## Verification Record (2026-08-05, TASK-77 — real environment)

All 9 items verified in the real environment (worktree `task/TASK-77` @ 5096769,
Claude Code 2.1.222, node v26.5.0). Summary:

| # | 任务 | 项 | 结论 | 证据 / 理由 |
|---|---|---|---|---|
| 1 | DIR-001 | Cycle broken | 满足（DoD 行未勾，结论记于文件） | `query --arch-dir .archguard --cycles` → `[]`（757 实体/2142 关系，cycleDetection capability true） |
| 2 | DIR-001 | Semantic info preserved | 满足（DoD 行未勾，结论记于文件） | `src/types/config-global.ts` imports `./fitness-rules.js`；`grep -rln "@/analysis" src/types/` → 0；tsc build 干净 |
| 3 | DIR-002 | nodeId() collision fixed | 满足（DoD 行未勾，结论记于文件） | `test-coverage-renderer.ts:92` `nodeId(label, entityId?)` 追加 entityId；13/13 单测过 |
| 4 | DIR-002 | Collision detection test added | 满足（DoD 行未勾，结论记于文件） | `test-coverage-renderer.test.ts:185-228` 两条碰撞测试；13 passed |
| 5 | DIR-002 | Diagrams regenerated | 满足（DoD 行未勾，结论记于文件） | `coverage-heatmap.md`（12:30，晚于修复 12:17）双 `ValidationError` 节点 ID 互异 |
| 6 | TASK-31 | deprecated installer 不再写注册 | **勾选 [x]** | 当前安装器仅 residue 移除、不写新注册；真实安装未创建 mcp.json；33/33 测试过 |
| 7 | TASK-31 | reload 后 `claude mcp list` 显示 Connected | **未勾 [~]** | 真实安装成功但 MCP 连接失败：launcher createRequire 无法解析 npm-cache 布局里的核心包；NODE_PATH 可复现性证明 |
| 8 | TASK-35 | clean install + upgrade 后 `claude mcp list` | **未勾 [~]** | 与 #7 同根因：安装/升级机制成功（exit 0），但 MCP 连接失败 |
| 9 | TASK-49 | 有凭据时测试运行 | **未勾 [~]** | 环境无 `OPENAI_API_KEY`；测试存在且干净跳过（44 passed | 1 skipped） |

**新发现（真实环境缺陷，非环境不可得）**：#7/#8 不再卡在「包未发布」边界——`@yalehwang/archguard-claude-plugin@0.1.32`
与 `@yalehwang/archguard@0.1.32` 已发布，真实 `claude plugin install` 成功并启用，但 `claude mcp list`
报 `plugin:archguard:archguard … ✘ Failed to connect — MCP error -32000: Connection closed`。
根因：Claude Code 2.1.222 把插件依赖装进兄弟目录 `plugins/npm-cache/node_modules/`，而
`plugin/mcp-launcher.mjs` 用 `createRequire(import.meta.url)` 自插件目录向上解析，够不到该目录且
claude 不设 NODE_PATH。`NODE_PATH=<npm-cache>/node_modules` 启动即成功，证明诊断。需后续修复 launcher
（按 npm-cache 布局解析或要求 claude 注入 NODE_PATH）。

**未改任何旧任务 status**；DIR-001/002 的 DoD 行按纪律未勾（结论记于各文件 Verification 段）。
