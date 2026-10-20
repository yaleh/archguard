---
id: gap-ts-god-packages-instrumentation
title: TS 项目也需要 god-package 检测：用 fanIn/fanOut + fileCount/entityCount/loc 叠阈值，复用
  applicable/reason 三态
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`archguard_detect_god_packages` 对 TypeScript 直接返回 `applicable:false`（`src/cli/mcp/tools/atlas-analytics-tools.ts:234-236` 硬绑 Go Atlas），导致 TS 项目没有 god-package 仪器——quay 的 architecture-analysis probe 的 `god-package` 路由在 TS 上全程空转，只能靠外部 `get_package_metrics`+filesystem 手算（本次校准里 `mcp-gateway`/`voice-realtime` 就是这样手标出来的）。修法：不加新解析器，直接用现有 `get_package_metrics`(fanIn/fanOut) + `get_package_stats`(fileCount/entityCount/loc) 叠阈值产出，与 Go 版共用 `applicable/reason` 三态。

## AC

- [ ] TS scope 上 `archguard_detect_god_packages` 不再返回 `applicable:false`，而是返回 `{applicable:true, godPackages:[{packageName, fanIn, fanOut, fileCount, entityCount, loc?, reasons[]}]}`，reason 至少支持 `highFanIn` / `highFanOut` / `tooManyFiles` / 体积阈值
- [ ] Go/Atlas scope 行为不变（仍走 Atlas 包图路径）；无 Atlas 的 TS 走新路径；其它语言仍 `applicable:false` 带 `alternative` 指向 `get_package_metrics`/`get_package_stats`
- [ ] `tests/unit/cli/mcp/atlas-analytics-tools.test.ts` 新增 TS fixture 断言：一个 fanOut 与 fileCount 双超阈值的包被标出且 reason 正确

## DoD

在 claudecodeui 的 server scope（或等价 TS fixture）上，`archguard_detect_god_packages` 能标出 `modules/mcp-gateway`（fanOut 332、41 文件）这类真实 god package 并给出命中的 reason——即 TS 项目不再需要手算。

## Touches

- src/cli/mcp/tools/atlas-analytics-tools.ts
- src/analysis/atlas-metrics-analysis.ts
- tests/unit/cli/mcp/atlas-analytics-tools.test.ts
- tasks/gap-ts-god-packages-instrumentation.md