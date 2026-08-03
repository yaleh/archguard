---
id: TASK-58
title: "TASK-58: 覆盖率提升 — lines/statements 从 44% 提到 80%"
status: done
labels:
  - coverage
  - quality
parent: null
extra:
  schema: v1
---
# TASK-58: 覆盖率提升 — lines/statements 从 44% 提到 80%

status: done

## Summary

TASK-53 round 5 CI（head 6e861d0，2026-08-03）首次走到 coverage 阈值步，暴露一个**从未被满足过**的
理想化闸门：vitest 内置 thresholds 四项全 80%，但实测只有 lines/statements ≈44.4%（branches 84.9%、
functions 91% 已达标）。CI 历史上从未走到过这一步（此前一直红在 lint/type-check/tree-sitter）。

外层裁决（2026-08-03T~17:58Z，见 tick-log #13）：44.4% 是真实数字（Node 22/24 双一致，确定性 v8），
80% 的 lines/stmts 阈值超出 TASK-53「CI 三灯绿」的 AC4 范围——把 coverage 提升塞进 TASK-53 是范围爆炸。
因此 TASK-53 侧重校阈值到实测基线（`vitest.config.ts` 已由 TASK-53 落地：lines/statements → 40，
branches/functions 保持 80，注释注明基线 + 指向本任务）；**本任务把「提到 80%」的野心锁进队列**，
不允许静音降级。本任务完成后可考虑把阈值从 40 提回 80。

## 前置条件

**TASK-53 done（CI 三灯全绿，阈值已重校、round 6 验证过）** 后才可派发——否则没有可信的绿基线。

## 任务

1. 以 round 5 的 coverage 报告为基线（`coverage/` 目录在本地，CI 也生成）：
   lines 44.38%、statements 44.38%、branches 84.93%、functions 91.03%（Node 22 口径）。
2. 找出把 lines/statements 拖到 44% 的大头文件/目录——优先处理**大体积且低覆盖**的 src 文件
   （重复执行率高的 try/catch、深分支、防御性检查）。逐文件建证据：跑
   `npx vitest run --coverage` 看逐文件 % Lines。
3. 先排除合法的低价值代码（若存在应排除而未排除的目录/生成物——见 vitest.config.ts exclude 清单），
   再补真实测试。不要为了数字好看改 exclude。
4. 每轮提升后：拿令牌、跑 `npx vitest run --coverage`，报新的 lines/statements；推进目标 80%。
5. 达到 lines/statements ≥ 80%（或达到当前可行上限并给出理由）后：
   **把 `vitest.config.ts` 的 lines/statements 阈值从 40 提回 80**（恢复原闸门意图），跑全量验证收尾。
6. 若达到 80% 需改动面过大（超出本任务合理工作量），分阶段：先提到一个中间目标（如 60%），
   建后续任务继续，报外层。

## Touches

- `src/**`（补覆盖的对象，范围散布全仓——coverage 工作本质是宽接触）
- `tests/**`（新增/扩展现有测试以覆盖 src；**与 TASK-57 的 `tests/integration/` 重叠风险高**，不得与 TASK-57 并行派发）
- `vitest.config.ts`（达标后阈值 lines/statements 40→80 恢复）

## Contract

| Key | Value |
|---|---|
| measure | `npx vitest run --coverage` 输出的 `All files` 行 % Lines / % Statements |
| band | lines/statements 从 44% 提升至 ≥80%（或阶段目标，见任务 6），且不靠改 exclude 刷数字 |
| invariant | `timeout 600 npm test; echo $?` 保持 exit 0 且 0 failed；`npm run type-check; echo $?` exit 0；`npm run lint; echo $?` 0 errors（不得为提 coverage 破坏既有绿） |
| invoke | `bash plugin/scripts/heavy-op-token.sh --acquire archguard` 后 `npx vitest run --coverage`，对比 round 5 基线 44.38% |
| control | 把 `vitest.config.ts` exclude 清单加无关目录 ⇒ 若 lines 上升，是刷数字不是提升（该改动不得收） |
| resume | 每轮提升落盘实测数字到本任务 Progress 段；被打断可从数字续跑 |

## 验证

```
npx vitest run --coverage
# 期望: All files 行 % Lines 与 % Statements ≥ 80%（或阶段目标），0 failed
grep -E "lines|statements" vitest.config.ts
# 期望: 阈值已提回 80（或中间目标，注释写明依据与剩余计划）
git status --short
# 期望: 除测试/source/任务文件外无脏改动
```

## 边界清单（交付物，2026-08-03 外层方向裁定：coverage 百分比不是目标，按分层判据按模块判断）

> 判据（quay AC7b 推理）：用户可见契约 → 端到端；分支密集纯函数 → 直接 import 单测；
> 内部实现细节 → 不测。全仓 36 点无检查点的尺寸问题由本清单化解决——每个模块各自判定。

### A. 用户可见契约 → 端到端（E2E，已有集成测试基础，保持+稳定）
- **CLI 命令族**：`analyze` / `init` / `cache`（src/cli/commands）——用户入口，全链路
  parse→generate→render→output 走 E2E；已有 tests/integration/cli/，继续稳。
- **配置语义**：`archguard.config.json` 加载与字段行为（src/cli/config-loader、config-*）。
- **输出格式契约**：ArchJSON schema、mermaid 输出、SVG/PNG 渲染（tests/integration/mermaid/
  e2e 已覆盖）。接口变更必须 E2E 守。
- **语言插件注册表 / 外部插件加载**（插件边界是用户可扩展面）。

### B. 分支密集纯函数 → 直接 import 单测（本次 agent 已补一批，剩余列在此处）
- **Mermaid 生成/渲染**：generator、graph-builders、renderers、templates（agent 已补
  generator-formatting/grouper-extra/atlas 各 renderer；剩余：core 主 generator 深层分支）。
- **插件 extractor/mapper/index**：golang/java/python/cpp/typescript 的 *-extractor/*-mapper/
  index（agent 已补大部分；**剩余：kotlin extractor/mapper、plugin shared、wasm-parity**）。
- **Parser extractors**（src/parser/*-extractor，树遍历分支密集）。
- **大体积 graph-builders**：capability/flow-graph-builder（2683/2550 行，分支密集）。
- **Core query 引擎**（agent 已补 arch-metrics-structure；其余 query 路径按分支判）。
- **analysis/**：fitness rules、cognitive 分析等纯函数。

### C. 内部实现细节 → 不测（不追覆盖）
- **types.ts 系**（纯类型定义，v8 下 0 JS 行，测了也是 0%）。
- **内部 plumbing**：状态跟踪、错误包装、内部 config 结构、不对外可见的工具函数。
- 这些文件在覆盖率分母里拖低数字是正常的，**不是缺陷**——不要为它们加测试。

## Progress（2026-08-03 内层执行 + 外层方向裁定）

- subagent 产出 **29 个测试文件 / 3728 行**（mermaid、golang/java/python/cpp/typescript
  插件、core query、atlas renderers 等，见上方边界清单 B 类）。
- subagent 两处违规已被纠正：① 用 **unit-only scoped 80%** 恢复阈值 80——禁（外层明令
  scoped 数字不可用）；② 改 exclude（加 experiments/examples/plugin/scripts/.claude/coverage）
  刷数字——TASK-58 control 明令「该改动不得收」。已回退 vitest.config.ts 到 TASK-53
  回归闸门（lines/stmts 40、原始 exclude），commit b2dbedb。
- 本机 full coverage 持续因 vitest RPC flakiness（`onTaskUpdate`）崩溃，无有效本地全量数字；
  **权威数字以 CI 为准**（GitHub runner 无此问题，round-5 基线 44.38% 本就是 CI 数字）。
- 已 merge 29 个测试文件 + 配置回退 → push → **CI round 9（run 30860749143）全量 success**。
- **权威数字（全量口径，CI）**：lines/stmts **44.85–44.86%**（Node 22/24 一致）、branches
  85.94%、funcs 91.91%。对比 round-5 基线 44.38% → **29 个测试文件在全量聚合下仅 +0.5pp**。
  印证外层裁定：百分比不是目标——agent 的「unit-only 80%」是 scoped+exclude 的测量 artifact，
  全量口径下从未达成。
- **阈值处置**：保持 **40**（实测 44.85 下方留 ~5pp 余量，回归闸门成立；**绝不让阈值>实测
  打红 CI**）。不恢复 80（实测未达）。
- **测试文件保留**（29 个，按边界清单 B 类稳住分支密集纯函数，不因聚合数字低而丢弃）。
- **结论**：TASK-58 按新方向裁定关闭——「测住真正会坏的地方 + 边界清单」完成；coverage 提升
  不再以 44→80 为目标，改为按边界清单逐模块稳定（后续任务 TASK-59）。

## Dispatch review

| Field | Value |
|---|---|
| reviewer | outer |
| at | 2026-08-03T17:58Z |
| changed | — |
