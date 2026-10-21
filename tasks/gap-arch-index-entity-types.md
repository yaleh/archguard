---
id: gap-arch-index-entity-types
title: arch-index 缺 entity.type：下游无法判断 UML stereotype（claudecodeui 800 function
  vs 6 class 只能回读 arch.json）
status: todo
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

- [ ] 夹具含 class / interface / function / enum 四类实体：重建 index 后 `entityTypes` 逐实体等于 arch.json 的 `type`（全量比对，不是抽样）
- [ ] 默认路径不变：`nameToIds` / `idToFile` / `idToName` / `dependencies` / `dependents` / `relationsByType` 与修复前完全一致（现有 arch-index 测试全绿）
- [ ] 向后兼容：读取不含 `entityTypes` 的旧 arch-index.json 不报错；字段类型为可选
- [ ] 体积有数字：在 claudecodeui 93e0a992 与 quay b4f87b21 副本上重建 index，记录 `entityTypes` 的 JSON 字节数与 index 总大小增量
- [ ] 真实数据：claudecodeui 副本重建后 `entityTypes` 的分布为 function 800 / class 6（与 arch.json 一致）；quay 副本的分布与 arch.json 一致
- [ ] 明确边界：不新增 `members` 字段；本任务只加 `entityTypes`
- [ ] `bash scripts/test.sh --for-task gap-arch-index-entity-types` 与 `npm run type-check` 通过

## DoD

不是「类型里加了一个 map」就算完成。要在 claudecodeui 与 quay 的真实副本上各重建一次 index：展示 `entityTypes` 的完整分布与体积增量，并逐实体比对 arch.json 的 type；同时验证旧 index 文件仍能加载、现有查询结果不变。产物要足以让下游在不读 arch.json 的情况下判断每个实体的 stereotype。

## Touches

- tasks/gap-arch-index-entity-types.md
- src/core/query/arch-index.ts
- src/core/query/arch-index-builder.ts
- tests/unit/cli/query/arch-index-builder.test.ts
