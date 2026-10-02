---
id: gap-ts-package-json-relations-metrics-inconsistent
title: TS package 层 overview JSON 自相矛盾：relations 折叠成顶层包名、metrics 与 metricVector
  基于另一套数据
status: done
labels:
  - gap
  - defect
  - typescript
  - arch-json
parent: null
children: []
extra:
  schema: execution
---
## Proposal

两个独立会话（archguard 自身、quay 项目）复现：TS 项目 `-f json` 输出的 package 层文件（`overview/package.json`）自相矛盾，消费者只能解析 `relation.id` 字符串才能拿到真实目录边。

archguard 自身的实测（2026-10-02，`.archguard/output/archguard/overview/package.json`）：
- `entities`：9 个，全是顶层包（analysis、cli、core…），而 `extensions.tsAnalysis.moduleGraph` 有 60 个 internal 目录节点，`metricVector.packageCount` 也是 60。
- `relations`：312 条，`source`/`target` 被折叠成顶层包名（`''`、`analysis`、`path`、`vitest`…），同一个 `analysis→analysis` 会出现多次；真正的目录边只在 `id` 里（如 `src/analysis_dependency_src/cli`）。
- `metrics.entityCount=9`、`metrics.relationCount=48`、`stronglyConnectedComponents=4`，与上面的 312 条 relations 对不上。
- `metricVector.totalRelations=48`、`sccCount=0`，而 `moduleGraph.cycles` 有 3 个环（27/3/2 个目录）。

根因（三处机制，已读代码确认）：
1. `src/cli/processors/diagram-pipeline-runner.ts` 先 `aggregator.aggregate(raw, 'package')`（产出 9 个顶层包实体和 48 条聚合关系），再用它算 `metrics` 和 `metricVector`。
2. `src/cli/processors/diagram-output-router.ts` 的 `injectModuleGraphRelations`（约第 208 行）在写 JSON 的最后一步才把 `moduleGraph.edges` 塞进 `relations`，并经 `resolveModuleNodeToPackageId` 把 `source`/`target` 折叠成 `split('/')[0]`（且去掉 `src/`），完整边只留在 `id`。注入发生在 metrics 之后，所以 metrics 不会反映注入的数据。
3. `metricVector.sccCount` 取自 `metrics.cycles.length`（`src/analysis/metric-vector-builder.ts:52`），而 `MetricsCalculator` 在 package 层不填 `cycles`（`computeDetails = !isAtlas && level !== 'package'`），所以 `sccCount` 恒为 0，与 `moduleGraph.cycles` 矛盾。另外 `metrics.stronglyConnectedComponents` 统计的是全部分量（含单点），与"环的个数"口径不同，两个字段名不同义却易被混用。

修复方向（要求一次建出自洽的 package 层数据，再算指标，而不是事后打补丁）：
- 对 TS 且 `level=package` 且存在 moduleGraph 时，在 `diagram-pipeline-runner.ts` 聚合之后、算 metrics 之前，用 internal 的 moduleGraph 节点作为 `entities`（`type: 'package'`，`id` 为目录 id，根目录用 `(root)` 展示名但 id 保持稳定），internal→internal 的边作为 `relations`，`source`/`target` 保持目录级节点 id，不再折叠。
- `relation.id` 保持现有 `${from}_dependency_${to}` 形式，保证按 id 解析的现有消费者（包括 quay 侧）不破。
- 指向外部包（node_modules、node: 内置）的边不进 `relations`（目标不是实体，会产生悬空引用），保留在 `extensions.tsAnalysis.moduleGraph.edges` 作为唯一来源，并在文档里写明。
- 在注入之后再算 `metrics` 和 `metricVector`；package 层让 `metrics.cycles` 取自 `moduleGraph.cycles`（或在 `MetricsCalculator` 里对 package 层也填充非平凡 SCC），使 `metricVector.sccCount === moduleGraph.cycles.length`。
- 删除 `injectModuleGraphRelations` / `resolveModuleNodeToPackageId` 的折叠逻辑，避免两处各自解释一遍。
- `metrics.stronglyConnectedComponents` 的口径在字段注释和文档里写明（全部分量含单点），不改名，避免破坏消费者。

风险与需确认：(a) 这是 ArchJSON 输出结构变化（entities 与 relations 的粒度变了），需先 grep 仓库内对 package 层 JSON 的所有消费者（`DiagramIndexGenerator`、测试夹具、`canonicalize-arch-json.ts`）并同步；(b) 经过 `@/` 别名但未被解析的导入会成为 `node_modules` 类型节点（archguard 自身有 1 条指向 `@/types` 的此类边），不属于本任务，但要在结果里确认不会被误当成 internal 实体；(c) mermaid package 图走 `generateTsModuleGraphOutput`，直接读 moduleGraph，不受影响，需用测试确认。

不在本任务范围：detect_cycles 的 outputScope 问题（gap-detect-cycles-ignores-output-scope-package）、TS package 图能力声明（gap-ts-package-graph-capability-undeclared）。

关联（追溯用，非前置）：以上两个任务；quay 项目会话的复现报告（96 条 relations、metrics entityCount 8/relationCount 3/stronglyConnectedComponents 8）与本仓库同一机制。

## AC

- [x] `tests/unit/cli/processors/diagram-output-router.test.ts` 与 `diagram-pipeline-runner.test.ts` 新增用例：用含 moduleGraph（3 个 internal 目录节点含 1 个互指环、1 条指向外部包的边）的 TS 夹具以 `level=package`、`format=json` 输出，断言每条 `relation.source`/`target` 都等于某个 `entities[].id`，不含折叠后的顶层名，也不含外部包名；运行 `npx vitest run tests/unit/cli/processors` 退出码 0
- [x] 同一夹具断言自洽性：`metrics.entityCount === entities.length`、`metrics.relationCount === relations.length`、`metricVector.totalEntities === entities.length`、`metricVector.totalRelations === relations.length`、`metricVector.sccCount === moduleGraph.cycles.length`
- [x] 同一夹具断言 `relation.id` 仍匹配 `<from>_dependency_<to>`（向后兼容）；并有一条对照用例证明去掉互指后 `sccCount === 0`（成对负对照）
- [x] `npx vitest run tests/unit/cli/processors/diagram-output-router.test.ts` 中原有的非 TS、非 package 层 JSON 输出用例不改动仍然通过（其它语言和 class/method 层输出不变）
- [x] 真实对照：对 archguard 自身重新 `node dist/cli/index.js analyze -f json -v` 后，用脚本读取 `overview/package.json`，断言上述自洽性全部成立，且 `metrics.entityCount` 等于 internal 目录节点数（修前为 9，修后约 60）、`metricVector.sccCount === 3`（修前为 0）
- [x] 对 quay 仓库（`/data/home/yale/work/quay`）做同样的真实对照，`relations` 的 `source`/`target` 不再出现 `packages` 这类折叠名
- [x] `npm run type-check` 与 `npm test` 全量通过

## DoD

必须在真实 TS 项目上用修复后的构建真实生成 `overview/package.json`，用脚本逐条核对 relations 的两端都能在 entities 里找到、metrics 与 metricVector 与实际数组长度一致、`sccCount` 与 `moduleGraph.cycles` 一致，并给出修前修后的数字对照（archguard：entityCount 9→约 60，sccCount 0→3；quay：折叠名消失）。不接受只靠夹具单测通过；也不接受只让 metrics "碰巧对上"而 relations 仍折叠。同时必须确认 mermaid package 图输出与修前一致（没有因为实体粒度变化而回归）。

## Touches

- src/cli/processors/diagram-pipeline-runner.ts
- src/cli/processors/diagram-output-router.ts
- src/parser/metrics-calculator.ts
- src/analysis/metric-vector-builder.ts
- src/types/index.ts
- docs/dev-guide/archjson-levels.md
- tests/unit/cli/processors/diagram-output-router.test.ts
- tests/unit/cli/processors/diagram-pipeline-runner.test.ts
- tasks/gap-ts-package-json-relations-metrics-inconsistent.md
