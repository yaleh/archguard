---
id: gap-git-ref-drift-entry
title: drift 增加轻量 git-ref 入口：两个 ref/scope 直接 diff，不依赖 arch-health-history
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`archguard_get_architecture_drift` 需要 `.archguard/arch-health-history.json`（两次 `analyze --arch-health`），没有历史文件就完全无法 drift；轻量场景（对比两个 git ref / 两个 scope 的当前架构）没有入口。修法：提供按 git ref 分析（不 checkout）或两个 scope/commit 直接 diff 的轻量 drift 入口。

## AC

- [ ] 新增轻量 drift 入口：给定两个 git ref（或两个 scope key），直接分析/比对出 per-entity drift，不依赖 `arch-health-history.json`；新增用例到 `tests/unit/cli/mcp/tools/arch-health-tools.test.ts`
- [ ] 缺两个可比对象时返回 not-evaluated 带 reason（不伪造空报告）
- [ ] 现有基于快照的 `get_architecture_drift` 行为不回归

## DoD

在 claudecodeui 上对两个 commit 直接算出架构 drift（不先跑两次 `analyze --arch-health`）——before/after 对比不再需要把 baseline 复制到 /tmp 分别 analyze 再手比。

## Touches

- src/cli/mcp/tools/arch-health-tools.ts
- src/analysis/jl/drift-calculator.ts
- tests/unit/cli/mcp/tools/arch-health-tools.test.ts
- tasks/gap-git-ref-drift-entry.md