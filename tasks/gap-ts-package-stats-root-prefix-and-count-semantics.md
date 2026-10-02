---
id: gap-ts-package-stats-root-prefix-and-count-semantics
title: TS package stats 根目录 entityCount 恒为 0，且 entityCount 按子树累计而
  fileCount/languageStats 只算目录自身
status: ready
labels:
  - gap
  - defect
  - typescript
  - query
parent: null
children: []
extra:
  schema: execution
---
## Proposal

两个独立会话（archguard 自身、quay 项目）复现：`archguard_get_package_stats` / `archguard_summary(outputScope=package)` 的 `topPackages` 在 TS 上读数互相矛盾。

archguard 自身实测（2026-10-02，scope 8f71319d，`archguard_get_package_stats`）：
- `(root)`：`fileCount=2`，`entityCount=0`，`languageStats` 全 0。
- `src`：`fileCount=1`，`entityCount=794`，`languageStats` 全 0；而它的子目录（`src/cli` 182、`src/core` 73…）各自也有自己的 entityCount。
quay 的 plugin/scripts（276 个 .ts 平铺）：`totalPackageCount=1`，`(root)` 的 `entityCount=0`，而 `languageStats.functions=2755`。

根因（两处，已读代码确认，均在 `src/core/query/arch-metrics-structure.ts`）：
1. 根目录前缀 bug：TS 路径 B 调用 `aggregateEntityMetrics(node.id)`（约第 119 行），根目录节点 id 为 `''`，函数里 `sep = packagePrefix + '/'` 得到 `'/'`（第 329 行），而相对路径 `foo.ts` 既不等于 `''` 也不以 `'/'` 开头（第 346 行），所有文件都被 `continue` 跳过，`entityCount` 恒为 0。平铺目录项目（quay 的 plugin/scripts）整个包因此全 0。
2. 口径不一致：非根目录时 `aggregateEntityMetrics` 按前缀匹配整棵子树（`file.startsWith(sep)`），所以父目录 `src` 的 `entityCount` 把所有子目录的实体都累计进来（794），而同一条记录里的 `fileCount`（来自 moduleGraph 节点）和 `languageStats` 只统计目录自身。调用方把各包的 `entityCount` 相加会重复计数，`topPackages` 排序也被父目录支配。

修复方向：
- 根目录特判：`packagePrefix === ''` 时只匹配没有 `/` 的相对路径（目录自身的文件）。
- 统一口径为"目录自身"（direct），与 `fileCount`、`languageStats` 对齐，使各包 `entityCount` 之和等于总实体数（无重复）。如需保留子树累计值，另加明确命名的字段（如 `entityCountInclusive`），不要复用 `entityCount`。
- 在 `PackageStatEntry` 的类型注释和 MCP 工具描述里写明口径。
- 先 grep `getPackageStats` / `topPackages` / `PackageStatEntry` 的全部消费者（`metric-vector-builder.ts` 的 maxPackageSize/gini、`archguard_get_package_metrics`、cognitive 摘要等），确认口径变化对它们的影响并同步测试；口径变化会改变 `src` 这类父目录的数值。

不在本任务范围：Go Atlas 路径 A 与 OO 路径 C 的统计（先确认是否有同样的口径问题，如有另立）；overview/package.json 的 entities/relations 一致性（gap-ts-package-json-relations-metrics-inconsistent）。

关联（追溯用，非前置）：gap-ts-package-json-relations-metrics-inconsistent、gap-ts-package-graph-capability-undeclared（同属 TS package 层读数不可信的一组问题）。

## AC

- [ ] `tests/unit/core/query/arch-metrics-structure.test.ts` 新增用例：TS 夹具含根目录文件（`a.ts` 含 1 个类）和子目录文件（`sub/b.ts` 含 2 个类），`getPackageStats()` 返回 `(root)` 的 `entityCount === 1`（修前为 0），`sub` 的 `entityCount === 2`；运行 `npx vitest run tests/unit/core/query/arch-metrics-structure.test.ts` 退出码 0
- [ ] 同一测试文件新增用例（口径）：同一夹具里父目录 `p`（自身 1 个类）与子目录 `p/c`（2 个类），断言 `p.entityCount === 1`（不含子树），且所有包的 `entityCount` 之和等于夹具总实体数
- [ ] 平铺目录用例：夹具全部文件在根目录时，`totalPackageCount === 1` 且该包 `entityCount` 等于总实体数（非 0），且与 `languageStats` 同向非零
- [ ] 对 Go 夹具与 OO（Java/Python）夹具的现有 `getPackageStats` 用例不改动仍然通过
- [ ] 真实对照：对 archguard 自身重新分析后，`archguard_get_package_stats` 返回的 `(root)` 的 `entityCount` 大于 0（修前为 0），`src` 的 `entityCount` 不再是 794（修前 794），且全部包 `entityCount` 之和等于 `archguard_summary` 的 `entityCount`
- [ ] `npm run type-check` 与 `npm test` 全量通过

## DoD

必须在真实 TS 项目上用修复后的构建真实调用 `archguard_get_package_stats` 与 `archguard_summary`，读到：根目录包 `entityCount` 非 0、父目录不再累计子树、各包 `entityCount` 之和等于总实体数，并给出修前修后的数字对照（archguard：`(root)` 0→大于 0，`src` 794→目录自身值）。有平铺目录样本时（如 quay 的 plugin/scripts，或构造一个等价的真实平铺目录）也要真实跑一次，确认不再是全 0。不接受只让夹具单测通过。

## Touches

- src/core/query/arch-metrics-structure.ts
- src/analysis/metric-vector-builder.ts
- tests/unit/core/query/arch-metrics-structure.test.ts
- tasks/gap-ts-package-stats-root-prefix-and-count-semantics.md
