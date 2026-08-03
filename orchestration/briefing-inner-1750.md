# 内层接续简报 — TASK-53（2026-08-03 ~17:50Z）

> 写给 archguard 内层开发会话（全新 flash 会话，零上下文）。读完后**先按你的 tick 文档冷启动**，再执行本简报的 TASK-53 接续步骤。

## 0. 你现在是谁、第一动作是什么

你是 archguard 双层机制的内层开发会话（tmux archguard-2:0.0，deepseek-v4-flash，全新会话）。外层在另一个会话，观察你、给你指令、补队列。

**第一动作（强制，外层会用证据验证、不是听你说读了）**：完整读你的 tick 指令文档
`docs/analysis/fast-mode-loop-tick.md`，按它的「冷启动」一节先读四份文件建立状态，再进入 tick 步骤。这份文档定义了你该做什么、怎么派发、怎么计量。

**硬判据（外层如何确认你在真的跑机制）**：外层对你的验证是 **`.workflow-events/` 出现真实记录**（gitignored、不脏工作树）——不是你说「我读了」。按 tick 文档 §3.5 计量，你开工 TASK-53 时必须跑：

```bash
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --task-start --taskId TASK-53
```

这会向 `.workflow-events/<runId>.jsonl` 追加真实事件。派发工作按文档走**后台 Agent + 对抗审查**（工作产出会继续产生 workflow 事件）。**请确保 `.workflow-events/` 下有非空记录**——这是外层确认机制真正在跑的唯一证据。若 `.workflow-events` 不在 .gitignore，把 `/.workflow-events/` 加进 .gitignore 保持树干净。

## 1. 队列状态

- **TASK-53（AC4 CI 三灯全绿）进行中**——你现在唯一要干的活
- TASK-56（测试套件基线度量，只测不改）、TASK-57（墙钟优化，改善必须超 σ）已就绪，**前置是 TASK-53 done** 后才派发

## 2. TASK-53 —— 不要重跑前四轮

四轮 CI 失败分析已完整落盘在 `tasks/TASK-53.md` 的 Progress 段（commit 4b4e4f7 + 后续更新），**不需要重查前几轮的根因**。已确认的事实：

- CI 全链路唯一红步是 Run tests（type-check/lint/format/build 全绿）
- 根因：native tree-sitter 系列是 optional peer，`npm ci` 不装；`npm install --no-save` 对 manifest 已声明的包是 no-op
- 修复方案已在本地端到端验证（scratch 前缀安装 + 拷入 node_modules）：46 个 native 相关测试文件 691 passed / 0 failed
- **修复已经写进 `.github/workflows/ci.yml`（commit 5f39b8c：scratch 前缀 + copy + native 冒烟测试）**——已提交、**还没推**（本地 master ahead 4）

## 3. TASK-53 下一步（你的活）

1. 读 `tasks/TASK-53.md` 的 Progress 段，吸收已确认事实与修复方案（不用重跑前几轮）
2. 开工前跑 §3.5 计量：`node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --task-start --taskId TASK-53`
3. 核实 `.github/workflows/ci.yml` 里已有 scratch 修复（`git log 5f39b8c -- .github/workflows/ci.yml` 可查）
4. **push master** → 触发 round 5 CI（会带着修复跑）
5. `gh run watch` 验证结果：
   - **success** → AC4 ✅：更新 `orchestration/goals-and-ac.md` 的 AC4 为 ✅（写明依据），关闭 TASK-53（勾 AC + DoD），随后派发 TASK-56
   - **failure** → `gh run view <id> --log-failed` 定位新失败点，把实测写回任务体，报告外层；**不要无依据改配置**
6. 覆盖闸门提醒：Progress 段发现 vitest.config.ts 缺 json-summary reporter——若 round 5 Run tests 转绿，是首次接受 coverage 阈值检验。本地先 `npm run test:coverage` 预验证再收工

## 4. 备注

- 本地 node_modules 的 native 包已被某次 npm ci 清掉（本地 `require('tree-sitter')` 也 MODULE_NOT_FOUND）——若要本地跑 native 相关测试，按 Progress 段的 scratch 手法补回；只做 CI 验证则不需要
- 资源纪律：跑全量测试前先 `bash plugin/scripts/heavy-op-token.sh --acquire archguard`（跨项目共享令牌）再 `bash plugin/scripts/resource-gate.sh --for full-suite`
- 你的会话存活监视：按 tick 文档 AC13 挂 `session-liveness.sh`
