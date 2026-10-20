---
id: gap-package-cycle-count-and-evidence
title: get_package_metrics.cycleCount 改用包级 SCC、detect_cycles(package) 输出带上
  from→to+specifier+file:line 边证据
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

两个包级环的面自相矛盾：`archguard_get_package_metrics.cycleCount` 恒 0，而 `detect_cycles(outputScope=package)` 能报出 SCC。根因：`package-metrics-tools.ts:92` 用 `engine.getCycles()`（实体/class 粒度 SCC）算 cycleCount，而包级环来自目录粒度 `engine.getPackageCycles()`；TS 的 directory tangle 只存在于目录 SCC，class 级环为空 ⇒ cycleCount 全 0。同时 `detect_cycles(package)` 只回 `{size,modules}` 无边证据（`query-engine.ts:177-230`），`(root)↔browser-use` 这类假环无法自查。修法：cycleCount 改用 `getPackageCycles()`（not-evaluated 时显式标 reason、别落 0）；package cycle 输出补 `from→to + specifier + file:line`。

## AC

- [ ] `archguard_get_package_metrics` 的 `cycleCount`/`cyclesWith` 改由 `engine.getPackageCycles()` 推导，与 `detect_cycles(outputScope=package)` 同源；新增单测在 `tests/unit/cli/mcp/tools/package-metrics-tool.test.ts` 断言：目录级 SCC 存在、class 级环为空时 cycleCount > 0
- [ ] `getPackageCycles()` 的每个 SCC 额外输出参与边（`from`/`to`/`specifier`/`file:line`），`detect_cycles(outputScope=package)` 结果里能据此自查每一条环边
- [ ] `getPackageCycles()` 的 `evaluated:false` 分支在 `get_package_metrics` 里显式透出（不落 0）；`tests/unit/core/query/query-engine.test.ts` 有对应断言
- [ ] 现有 package-metrics / query-engine 用例不回归

## DoD

用含目录级环的 fixture（`a/` 与 `b/` 互相 import）跑 `get_package_metrics`，`cycleCount` 非 0 且 `cyclesWith` 非空；跑 `detect_cycles(outputScope=package)` 能列出每条环边的 specifier 与 file:line——两个工具对同一目录环给出同源、可互证的读数。

## Touches

- src/cli/mcp/tools/package-metrics-tools.ts
- src/core/query/query-engine.ts
- src/types/index.ts
- tests/unit/cli/mcp/tools/package-metrics-tool.test.ts
- tests/unit/core/query/query-engine.test.ts
- tasks/gap-package-cycle-count-and-evidence.md