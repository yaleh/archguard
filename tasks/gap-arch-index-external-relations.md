---
id: gap-arch-index-external-relations
title: arch-index 静默丢弃外部/未解析端点：inheritance/implementation 指向外部基类或 type alias
  时整条边消失（claudecodeui + quay 实测）
status: todo
labels:
  - gap
  - defect
  - query
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测）**：arch-index 只保留「两端都能解析成实体」的关系，外部/未解析端点被静默丢弃，下游拿不到这些边。

claudecodeui scope `93e0a992`（`/data/home/yale/work/claudecodeui/.archguard/query/93e0a992/`）：
- `arch.json` 有 inheritance 1 条：`VoiceFrameProcessor → ProcessorBase`（外部基类）；implementation 1 条：`ShellMobileSelectionCore → shared/types.ts.MobileTerminalSelectionManager`；
- `arch-index.json` 的 `relationsByType` 只有 `dependency / call / composition` 三个键 —— 这两条边完全消失，继承/实现在任何消费方都画不出来。

quay scope `b4f87b21`：arch.json 13,630 条，arch-index 内部边 10,493 条，丢弃 dependency **2,489**、composition **644**、inheritance **4**（call 0）。

**根因（代码定位）**：`src/core/query/arch-index-builder.ts:60-78` 的 `resolveId` 先查实体 ID、再查唯一裸名；拿不到就直接 `return null`，不进入 `relationsByType` / `dependencies` / `dependents`。

两类丢失原因（本任务都按「保留边」处理，不做实体面扩张）：
1. 外部目标：`ProcessorBase` 来自外部包/全局，本来就不是项目实体；
2. 源内声明但不是实体：`export type MobileTerminalSelectionManager = { ... }` 是 type alias，TypeScript extractor 不把 type alias 建成实体（当前全仓 `src/parser` 无 `TypeAliasDeclaration` 处理）。**本任务明确不扩实体面**，只保留这条无法解析的边。

**修复方向**：
1. `ArchIndex` 增加可选字段（建议命名 `externalRelationsByType`）：
   ```ts
   interface ExternalRelationEdge {
     from: string;            // 原始 source 字符串
     to: string;              // 原始 target 字符串
     sourceResolved: boolean;
     targetResolved: boolean;
   }
   externalRelationsByType?: Partial<Record<RelationType, ExternalRelationEdge[]>>;
   ```
   只收录「至少一端无法解析、因而不在 relationsByType/邻接表」的边；保持 arch.json 顺序、按 `(type, from, to)` 去重，输出确定。
2. **不要**把外部边加进 `dependencies` / `dependents` 邻接表，避免 BFS 出现幽灵节点或改变现有查询结果。
3. 字段可选、缺失即视为空；不提升 `ARCH_INDEX_VERSION`，旧 index 文件照常加载。
4. 下游（Architecture tab 等）可以据此把外部目标画成 `external:<name>` 节点，或至少展示“存在但未解析”的计数。

## AC

- [ ] 夹具覆盖三类目标：`class A extends ExternalBase`（外部）、`class B implements LocalInterface`（内部，对照）、以及指向 type alias 的 `implementation`；索引后 `externalRelationsByType` 含前两条/第三条中无法解析的边，且带正确的 `type` 与原始 `to` 字符串
- [ ] 负对照：两端都可解析的内部关系只出现在 `relationsByType`，不出现在 `externalRelationsByType`
- [ ] 邻接表不变：`dependencies` / `dependents` 不含外部目标；对同一 index 调 `getDependencies` / `getDependents`，修复前后结果完全一致
- [ ] 向后兼容：读取不含新字段的旧 `arch-index.json` 不报错；`ARCH_INDEX_VERSION` 不变
- [ ] 真实数据（claudecodeui 副本）：重新构建 `93e0a992` 后，`VoiceFrameProcessor → ProcessorBase`（inheritance）与 `ShellMobileSelectionCore → MobileTerminalSelectionManager`（implementation）出现在 `externalRelationsByType`；丢弃总数与 arch.json 差额一致（inheritance 1 / implementation 1）
- [ ] 真实数据（quay 副本）：dependency 2,489 / composition 644 / inheritance 4 / call 0 的差额被 `externalRelationsByType` 完整解释（逐类型计数相等）
- [ ] 明确边界：不提取 `export type` 别名实体、不改变 `Entity` 模型；本任务只保留未解析的边
- [ ] `bash scripts/test.sh --for-task gap-arch-index-external-relations` 与 `npm run type-check` 通过

## DoD

不是「类型里加了个可选字段」就算完成。要在 claudecodeui scope 的真实副本上重建一次 index，展示修复前 `relationsByType` 缺少 inheritance/implementation、修复后 `externalRelationsByType` 里出现这两条边（含 from/to/type）；再对 quay 副本重建一次，给出四类关系的差额与 `externalRelationsByType` 计数的逐项对照；同时验证 `getDependencies` 输出与修复前一致，证明没有把外部边混进 BFS。

## Touches

- tasks/gap-arch-index-external-relations.md
- src/core/query/arch-index.ts
- src/core/query/arch-index-builder.ts
- tests/unit/cli/query/arch-index-builder.test.ts
- tests/unit/cli/query/query-engine.test.ts
