---
id: gap-query-cycles-ignores-output-scope-package
title: CLI `query --cycles --output-scope package` 忽略 output-scope，对存在目录级环的树报"无环"
status: ready
labels:
  - gap
  - defect
  - cli
  - typescript
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`archguard_detect_cycles(outputScope=package)` 的同类缺陷已在 37005f9a 修复（MCP handler 改走 `engine.getPackageCycles()`，三态返回）。但 CLI `query` 的 `--cycles` 分支漏修：`src/cli/commands/query.ts:389-391` 直接 `engine.getCycles()`（实体级 `index.cycles`），完全无视 `opts.outputScope`（该 flag 在 :208 声明、:698 校验，却只在别处生效）。实测（2026-10-03 当前树）：`node dist/cli/index.js query --cycles --output-scope package` 打印 "No dependency cycles detected."，而对同一产物手工跑 Tarjan SCC 得到 4 个目录级 SCC（size 13/10/2/2）——"忽略 flag"与"已评估无环"再次同形，正是三态原则要消灭的形状。修复：`--cycles` 读 outputScope，package 时走 `getPackageCycles()` 并输出 `{granularity,evaluated,reason?,cycles}`；not-evaluated 时打印原因且退出码非 0。class 缺省行为保持不变。

## AC

- [x] `query.ts` 的 `--cycles` 分支读取 `opts.outputScope`，package 时调用 `engine.getPackageCycles()`，按三态输出
- [x] `tests/unit/cli/commands/query.test.ts` 新增成对用例：含目录级互指的夹具 package 返回非空 cycles；无 moduleGraph 返回 `evaluated:false` + 非空 reason；`npx vitest run tests/unit/cli/commands/query.test.ts` 退出码 0
- [x] 真实对照：对 archguard 自身 `query --cycles --output-scope package` 输出非空 cycles（当前树 4 个 SCC），修前同参数为 "No dependency cycles detected."
- [x] class 缺省调用返回与修前一致；type-check + 全量测试通过

## DoD

不是"handler 读了 outputScope"就算完成：必须在真实 TS 项目（archguard 自身）用修复后的构建真实调用 CLI，读到非空的目录级环（修前同参数无输出），确认 class 缺省输出与修前逐字一致，且有一个真实触发的 not-evaluated 样本（如 Go scope）。

## Touches

- src/cli/commands/query.ts
- tests/unit/cli/commands/query.test.ts
- tasks/gap-query-cycles-ignores-output-scope-package.md