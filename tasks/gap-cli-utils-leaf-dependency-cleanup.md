---
id: gap-cli-utils-leaf-dependency-cleanup
title: src/cli/utils 退出 cli 10 目录环：搬走 drift-baseline.ts、抽出 DiagramResult 类型，消除两条反向依赖
status: ready
labels:
  - gap
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Proposal

2026-10-08 的 Phase D1 dogfooding 自查（调用 `.claude/skills/arch-layer-review`，对 archguard 自身跑 `analyze -f json` + `check-layers.mjs`）发现：`extensions.tsAnalysis.moduleGraph.cycles` 里有一个 10 目录的 `error` 级环（`src/cli` 及其 9 个子目录），`check-layers.mjs` 对它结构性地看不见（它只比较跨层边，这 10 个目录全部属于 `layers.yml` 声明的同一个 `cli` 层，不是违例）。环内 31 条边里 89 是值依赖、仅 13 是 type-only，不是无害的类型噪音。

逐条核实后，环的诱因之一精确定位到 `src/cli/utils`——它被几乎所有 cli 子模块依赖，理应是叶子，但它自己有且仅有两条指回环内其它目录的出边（已用 `python` 脚本对 `src/cli/utils` 的全部出边逐条核对，这是它仅有的两条伸进 cli 环内部的边）：

1. `src/cli/utils/drift-baseline.ts:22` `import { runAnalysis } from '../analyze/run-analysis.js'`（值依赖，对应 moduleGraph 边 `src/cli/utils -> src/cli/analyze` strength=1）。`drift-baseline.ts` 本身是"重跑完整分析管线取 drift 基线快照"（TASK-65），语义上属于 `cli/analyze` 的关注点，却放在 `cli/utils`——它反过来被 4 个调用方依赖（`src/cli/commands/analyze.ts`、`src/cli/commands/query.ts`、`src/cli/mcp/tools/arch-health-tools.ts`、以及它自己），说明它在依赖层级上本来就"高于" utils。
2. `src/cli/utils/diagram-index-generator.ts:13` `import type { DiagramResult } from '@/cli/processors/diagram-processor.js'`（type-only 依赖，对应 moduleGraph 边 `src/cli/utils -> src/cli/processors` strength=1）。`DiagramResult` 是一个纯数据接口（`diagram-processor.ts:93`），自己的文档注释已经写明"Used by DiagramIndexGenerator"，是跨两个目录共用的数据形状，不该定义在消费者之一（`processors`）里让另一个消费者（`utils`）反向 import。

**最小可验证切片**（不泛化成大规模 CLI 重写，只做这两处）：

- 把 `src/cli/utils/drift-baseline.ts` 整体搬到 `src/cli/analyze/drift-baseline.ts`（不改内部逻辑，只改它自己 `../analyze/run-analysis.js` → `./run-analysis.js` 这一处相对路径），同步改 4 个调用方的 import 路径（`src/cli/commands/analyze.ts:30-31`、`src/cli/commands/query.ts:33`、`src/cli/mcp/tools/arch-health-tools.ts:19`、`tests/unit/cli/mcp/tools/arch-health-drift-tool.test.ts:17-18,26`），以及 `src/cli/analyze/arch-health.ts:23` 的文档注释（它提到"Duplicated from `cli/utils/drift-baseline.ts`"，搬完要改成新路径；该注释解释的"为什么 `resolveHeadCommitSha` 要在本文件里重复一份而不是从 drift-baseline 导入"——`run-analysis.ts` 会 import `arch-health.ts` 的 `computeArchHealth`，反向 import 会成环——这条既有的防环设计本身不动，只改它引用的路径文字）。
- 把 `DiagramResult` 接口从 `src/cli/processors/diagram-processor.ts` 抽到新文件 `src/types/diagram-result.ts`（跟 `src/types/` 下 `config-diagram.ts`/`metric-vector.ts` 等现有的主题化类型文件同构），从 `src/types/index.ts` re-export；`diagram-processor.ts` 改为从 `@/types/diagram-result.js`（或 `@/types/index.js`）导入该类型供自己使用；`src/cli/utils/diagram-index-generator.ts` 和 `tests/unit/cli/utils/diagram-index-generator.test.ts` 的 import 源头同步改掉。纯类型搬迁，编译期擦除，不改任何运行时行为。

<!-- dedup-ref -->
与 `DIR-001`（已 done，修的是 types↔analysis 的双向环）属于同一类"精确定位反向边再搬迁"的既有模式，但目标文件和目录完全不同，不是重复。

## AC

- [ ] `node dist/cli/index.js analyze -f json --output-dir <tmp> --diagrams package` 重跑后，`extensions.tsAnalysis.moduleGraph.edges` 里不再存在 `{from: "src/cli/utils", to: "src/cli/analyze"}` 或 `{from: "src/cli/utils", to: "src/cli/processors"}` 这两条边（搬迁前这两条边各自 strength=1，用于对比的 before 产物由本任务自己在实现前先跑一次留存）
- [ ] 同一产物的 `extensions.tsAnalysis.moduleGraph.cycles` 里，原 10 目录（`src/cli` + 9 子目录）的 `error` 环成员不再包含 `src/cli/utils`（即该环收缩为 9 个目录，或因此被拆成更小的环/完全消失——以实测为准，但 `src/cli/utils` 必须不在其中任何一个环里）
- [ ] `node docs/experiments/layer-map/check-layers.mjs <上面的 package.json> docs/experiments/layer-map/layers.yml` 仍为 `status=pass`，`violations=0`（本次改动不引入新的跨层违例——搬迁后 `cli/analyze` 内部边增多、`cli -> processors`/`types -> ...` 等跨层边方向不变，理论上不影响声明层判定，但要求实测确认，不能假设）
- [ ] `npm run type-check` 通过（搬迁文件、改 import 路径后 TS 编译零错误）
- [ ] `npm test`（或至少 `tests/unit/cli/utils/drift-baseline*.test.ts`[若存在]、`tests/unit/cli/mcp/tools/arch-health-drift-tool.test.ts`、`tests/unit/cli/utils/diagram-index-generator.test.ts`、`tests/unit/cli/analyze/run-analysis.test.ts` 对应的 scoped 测试）全绿
- [ ] `src/cli/analyze/arch-health.ts` 里引用旧路径 `cli/utils/drift-baseline.ts` 的文档注释已更新为新路径，注释所解释的防环理由本身不变

## DoD

不是"文件挪了 + 编译过"就算完成，必须证明：

1. **before/after 的 moduleGraph/cycle 证据真实存在且可复核**——实现者必须在动手前先跑一次 `analyze -f json`（作为 before 基线，建议存到 `/tmp` 而不是提交进仓库），动手后再跑一次（after），把两次 `cycles` 和两条目标边的读数都写进本任务的实现说明或 PR 描述里，不能只说"应该修好了"。
2. **没有把问题搬到别处而不是真正消除**——`drift-baseline.ts` 搬进 `src/cli/analyze/` 之后，必须确认 `cli/analyze` 内部或 `cli/analyze -> ` 别的目录没有因此新增一条反向进环的边（比如如果 `drift-baseline.ts` 搬过去后又被环内别的目录反向依赖，等于没解决，只是换了个地方画圈）。
3. **范围没有扩大**——只动上面列的两处反向依赖，不借机重排 `cli/` 下其它目录结构、不去动环内本来就互相合法依赖的 `cli/mcp <-> cli/mcp/tools`（14/14 强度，另一个真实存在但本任务明确不处理的耦合，留给以后单独评估）。

## Touches

- src/cli/utils/drift-baseline.ts
- src/cli/analyze/drift-baseline.ts
- src/cli/commands/analyze.ts
- src/cli/commands/query.ts
- src/cli/mcp/tools/arch-health-tools.ts
- src/cli/analyze/arch-health.ts
- tests/unit/cli/mcp/tools/arch-health-drift-tool.test.ts
- src/cli/processors/diagram-processor.ts
- src/cli/utils/diagram-index-generator.ts
- src/types/diagram-result.ts
- src/types/index.ts
- tests/unit/cli/utils/diagram-index-generator.test.ts
- tasks/gap-cli-utils-leaf-dependency-cleanup.md
