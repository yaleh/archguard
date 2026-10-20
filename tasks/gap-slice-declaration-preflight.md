---
id: gap-slice-declaration-preflight
title: slice-delta 增加 preflight：从 subject 枚举可合法声明的 moves/stays/newDirs
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 关联 open 任务 gap-slice-delta-explicit-new-destination-dir（已支持 newDirs 表达）；本任务处理的是「给定 subject 能合法声明哪些 slice」的 discoverability 缺口，机制不同，独立验收，保留分离。

`simulate_refactor_slice` 的 slice 契约难写：0.1.38 上 7/7 not-evaluated，0.1.40 补了 stays/newDirs/accounting/unknowns 但未重跑确认。调用方需要一个 preflight——从某个 `subject` 出发，能合法声明哪些 moves/stays/newDirs，避免试错式 not-evaluated。修法：加 preflight（或 `simulate_refactor_slice` 的 preflight 模式），从 subject 的入/出边与 importedNames 枚举合法声明。

## AC

- [x] 新增 `archguard_slice_preflight`（或 `simulate_refactor_slice` 的 preflight 模式）：给定 `subject` dir，返回可合法声明的 moves/stays/newDirs 与每条的理由；新增用例到 `tests/unit/analysis/slice-delta/simulate.test.ts`
- [x] preflight 输出涵盖 0.1.38 那 4 条 `MOVE_TO_NOT_AN_INTERNAL_DIR` 的合法目标（或明确指出需声明 newDirs），使同类 not-evaluated 可被避免
- [x] 现有 `simulate_refactor_slice` 行为与 fail-closed 语义不回归

## DoD

对一个真实 subject（如 claudecodeui 的某目录）调 preflight，能给出「下一步该怎么声明 slice」的可执行答案，而不是让调用方撞 not-evaluated 后自己读 accounting 反推。

## Touches

- src/analysis/slice-delta/simulate.ts
- src/analysis/slice-delta/types.ts
- src/analysis/slice-delta/index.ts
- src/cli/mcp/tools/slice-delta-tool.ts
- tests/unit/analysis/slice-delta/simulate.test.ts
- tests/unit/cli/mcp/slice-delta-tool.test.ts
- tasks/gap-slice-declaration-preflight.md
