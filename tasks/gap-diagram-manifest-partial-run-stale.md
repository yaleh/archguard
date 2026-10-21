---
id: gap-diagram-manifest-partial-run-stale
title: 带 sources/diagrams 的 partial analyze 完全不回写 diagram-manifest：lastRun
  停在旧日期、split 产物不在册（quay 实测）
status: done
labels:
  - gap
  - defect
  - mcp
  - cli
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测）**：`/data/home/yale/work/quay/.archguard/cache/diagram-manifest.json` 的 `lastRun` 停在 `2026-10-09T09:02:55.915Z`，而 `.archguard/output/quay/**` 下 6 个 `.mmd` 的 mtime 全是 `2026-10-21 06:29`；manifest 的 `diagrams` 只列 `quay/overview/package` 与 `quay/class/all-classes`，split 出来的 `Quay_Layer.mmd` / `Scripts_Layer.mmd` 等 5 个文件不在册。下游任何按 manifest 判断“分析结果新不新”的工具都会读到过期状态。

**根因（代码定位）**：`src/cli/analyze/run-analysis.ts:139-143` 把“带 sources 或 diagrams 过滤”定义为 partial；`run-analysis.ts:308-320` 用 `!partial` 直接跳过 `writeManifest`（`run-analysis.ts:185-193` 的 stale 清理同样跳过）。而 MCP `archguard_analyze` 在 `src/cli/mcp/analyze-tool.ts:131` 正常把 `sources` 透传给 `runAnalysis`，所以只要用户带 `sources`（最常见的调用方式），manifest 就永远不更新。这不是偶发失败，是分支设计问题。

**修复方向**：
1. partial run 不再“完全不写”，而是 merge：`readManifest` → 把本次 `successfulNames` 并入既有 entries（同名替换）→ 刷新 `lastRun` → 写回；不执行 stale 清理（partial 无权判断其他产物是否过期）。
2. manifest 增加可选的 per-diagram 产物清单（如 `outputs: { [diagramName]: string[] }`），记录本次实际渲染出的 `.mmd` 文件；对 split 输出（class 图按 layer/namespace 拆文件）也能枚举。向后兼容：旧 manifest 无该字段时按 `diagrams` 名单工作。
3. 全量 run 的语义保持不变（本次成功名单为准 + stale 清理），避免把 partial 的宽松语义带进全量路径。

<!-- dedup-ref -->
相关但不同机制：`bug-query-scope-no-prune-command` 处理的是 `.archguard/query/manifest.json` 的手动 prune；本任务只改 `.archguard/cache/diagram-manifest.json` 的写入语义，不涉及 query scope 生命周期。

## AC

- [x] partial run（带 `sources` 或 `diagrams` 过滤）成功后，manifest 的 `lastRun` 晚于本次运行开始时间，且本次成功的 diagram name 被并入既有 entries（不是覆盖掉其他 entry）——用单测 + 真实 CLI 调用各验证一次
- [x] 负对照：partial run 不得触发 stale diagram 清理；未参与本次运行的既有 diagram 文件仍在磁盘上、仍留在 manifest 中
- [x] 全量 run 语义不变：manifest 仍以本次成功名单为准、仍能清理 stale；`tests/unit/cli/cache/diagram-manifest.test.ts` 与 `tests/unit/cli/analyze/run-analysis.test.ts` 现有用例保持通过
- [x] manifest 能枚举实际渲染产物：对产生 split 输出（多 layer/namespace 文件）的 class 图，该 diagram 的 `outputs` 列出全部 `.mmd`；用合成夹具机械断言 `outputs` 与 outputDir 下实际 `.mmd` 文件集合一致
- [x] 真实数据验证：把 `/data/home/yale/work/quay/.archguard` 复制到 `/tmp` 夹具（不改原仓库），带 `sources` 跑一次分析后，manifest `lastRun` 被刷新且不再出现“mmd 新、manifest 旧”
- [x] `bash scripts/test.sh --for-task gap-diagram-manifest-partial-run-stale` 与 `npm run type-check` 通过

## DoD

不是“单测里 mock 了 writeManifest”就算完成。要在真实 analyze 调用上跑两次：先做一次全量 run 建立 manifest，再做一次带 `sources` 的 partial run，前后 diff manifest 文件，展示 `lastRun` 刷新、entries 并集、`outputs` 与磁盘文件一致；另外在 quay 的 `.archguard` 副本上重复一次，证明修复对真实多 layer 产物（Quay_Layer/Scripts_Layer 等）成立，而不是只对合成夹具成立。

## Touches

- tasks/gap-diagram-manifest-partial-run-stale.md
- src/cli/analyze/run-analysis.ts
- src/cli/cache/diagram-manifest.ts
- src/cli/processors/diagram-processor.ts
- src/cli/processors/diagram-output-router.ts
- src/cli/processors/diagram-pipeline-runner.ts
- src/types/diagram-result.ts
- tests/unit/cli/cache/diagram-manifest.test.ts
- tests/unit/cli/analyze/run-analysis.test.ts
- tests/unit/cli/processors/diagram-output-router-split-outputs.test.ts
