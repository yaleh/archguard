---
id: gap-arch-index-entity-types
title: arch-index 缺 entity.type：下游无法判断 UML stereotype（claudecodeui 800 function
  vs 6 class 只能回读 arch.json）
status: ready
labels:
  - gap
  - query
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测）**：`arch-index.json` 只有 `idToFile` / `idToName` / 邻接 / `relationsByType`，**没有 entity 的 `type`**。下游要画 UML class diagram 的 stereotype（`«function»` / `«interface»` / class）时，只能回读 `arch.json` 的实体全集。

- claudecodeui scope `93e0a992`：arch.json 的 type 分布是 **function 800 / class 6**；这个分布正是「该仓库几乎没有 OO」的关键证据，但 arch-index 无法单独表达。
- 体积实测（可选字段的代价）：`entityTypes`（id→type）序列化后 claudecodeui 57 KB、quay 397 KB；作为对照，`members` 是 claudecodeui 216 KB、quay **1.99 MB**（quay arch-index 当前 5.66 MB，+35%）。

**修复方向**：
1. `ArchIndex` 增加可选字段 `entityTypes: Record<string, EntityType>`（entity ID → `entity.type`）。覆盖 arch.json 的全部实体（与 `idToName` 同源），保持确定性顺序（实体在 arch.json 中的顺序）。
2. 字段可选、缺失即视为空；不提升 `ARCH_INDEX_VERSION`，旧 index 照常加载。
3. **本任务不塞 `members`**：它会显著增大 index（quay +2 MB），而下游已经读取 arch.json，可以从中取 members；如果下游要改成 index-only 渲染，另立任务并先做体积/收益评估。
4. 不改变 `nameToIds` / `idToFile` / `idToName` / 邻接 / `relationsByType` / `externalRelationsByType` 的语义。

## AC

- [x] 夹具含 class / interface / function / enum 四类实体：重建 index 后 `entityTypes` 逐实体等于 arch.json 的 `type`（全量比对，不是抽样）
- [x] 默认路径不变：`nameToIds` / `idToFile` / `idToName` / `dependencies` / `dependents` / `relationsByType` 与修复前完全一致（现有 arch-index 测试全绿）
- [x] 向后兼容：读取不含 `entityTypes` 的旧 arch-index.json 不报错；字段类型为可选
- [x] 体积有数字：在 claudecodeui 93e0a992 与 quay b4f87b21 副本上重建 index，记录 `entityTypes` 的 JSON 字节数与 index 总大小增量
- [x] 真实数据：claudecodeui 副本重建后 `entityTypes` 的分布为 function 800 / class 6（与 arch.json 一致）；quay 副本的分布与 arch.json 一致
- [x] 明确边界：不新增 `members` 字段；本任务只加 `entityTypes`
- [x] `bash scripts/test.sh --for-task gap-arch-index-entity-types` 与 `npm run type-check` 通过

## DoD

不是「类型里加了一个 map」就算完成。要在 claudecodeui 与 quay 的真实副本上各重建一次 index：展示 `entityTypes` 的完整分布与体积增量，并逐实体比对 arch.json 的 type；同时验证旧 index 文件仍能加载、现有查询结果不变。产物要足以让下游在不读 arch.json 的情况下判断每个实体的 stereotype。

## Touches

- tasks/gap-arch-index-entity-types.md
- src/core/query/arch-index.ts
- src/core/query/arch-index-builder.ts
- tests/unit/cli/query/arch-index-builder.test.ts
- tests/unit/cli/query/engine-loader.test.ts

## Evidence

验证于 7fa054a9（worktree 树，已确认与 develop 无差异合并）。七条 AC 逐条复验：

- **AC1** `tests/unit/cli/query/arch-index-builder.test.ts` 新增 `entityTypes` 夹具含 class / interface / function / enum 四类；`Object.keys(entityTypes)` 与 arch.json 实体顺序逐一相等，并逐 id 断言 `=== entity.type`（全量，非抽样）。真实数据全量比对：claudecodeui 806/806、quay 5747/5747，mismatch 0、missing 0、extra 0。
- **AC2** 以主检出 `dist`（改前构建，无 `entityTypes`）为基线，同一 arch.json 重建后，除 `entityTypes`/`generatedAt` 外逐字段 JSON 完全相同（`structureExceptEntityTypesUnchanged: true`）；现有 arch-index 测试 24 passed；`npm run type-check` 通过。
- **AC3** 字段为 `entityTypes?: Record<string, EntityType>`；`tests/unit/cli/query/engine-loader.test.ts` 新增「旧 index（无 entityTypes、hash 相同）经 loadEngine 加载不报错且原样复用」用例。真实旧 index（同时缺 `externalRelationsByType`）经 loadEngine 加载成功、文件未被重写；换入新 index 后 findEntity / getFileEntities / findByType / getCycles / getSummary 输出与旧 index 完全一致（`queryResultsIdentical: true`）。
- **AC4** 重建实测（同一 `JSON.stringify(…, null, 2)` 口径，基线 = 主检出改前 dist）：
  - claudecodeui@93e0a992：`entityTypes` 57,481 B（56.1 KB）；index 1,119,395 → 1,181,734 B，+62,339 B（+5.57%）。
  - quay@b4f87b21：`entityTypes` 397,063 B（387.8 KB）；index 6,295,565 → 6,727,132 B，+431,567 B（+6.86%）。
- **AC5** claudecodeui 分布 `{function: 800, class: 6}`；quay 分布 `{function: 4236, interface: 1495, class: 16}`，均与 arch.json 全量逐实体一致。
- **AC6** 新 index 无 `members` 键（`membersFieldPresent: false`）；本次 diff 只新增 `entityTypes`，未改变 `nameToIds` / `idToFile` / `idToName` / 邻接 / `relationsByType` / `externalRelationsByType` 语义。
- **AC7** `bash scripts/test.sh --for-task gap-arch-index-entity-types --allow-thin` → 24 passed, exit 0；`npm run type-check` → exit 0；`npm run build` → exit 0。
