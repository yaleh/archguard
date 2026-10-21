---
id: gap-call-edge-dedup-collapses-method-edges
title: call 边被类级去重键二次合并：extractor 原始 9 条归档只剩 2 条，findCallers 方法级过滤丢调用者（quay 实测）
status: done
labels:
  - gap
  - defect
  - parser
  - query
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测）**：quay scope `b4f87b21` 的归档里 `call` 边只有 2 条；但用当前 `dist` 的 `CallEdgeExtractor` 对同一批 534 个文件原样复跑，extractor 本身产出 **9 条**（`PhaseDifferentialAccounting` 类内 6 条、`StageJournalStore` 类内 3 条）。归档恰好只剩每组第一条，**9→2 精确复现**。

**根因（代码定位）**：两个解析入口的 `deduplicateRelations` 都用类级三元组做键：
- `src/parser/typescript-parser.ts:391-406`
- `src/parser/parallel-parser.ts:376-390`（同一份逻辑的副本）

```ts
const key = `${relation.type}:${relation.source}:${relation.target}`;
```

而 call 边是**方法级**的关系，extractor 特意带了 `sourceMethod`/`targetMethod`（`src/parser/call-edge-extractor.ts:78-92`），`id` 也已唯一（`call:${relPath}.${class}.${method}:${targetClass}.${targetMethod}`）。去重键丢掉方法信息后，同一个类里多个方法调用同一目标方法会被合并成一条。这不是统计口径问题，是数据丢失。

**下游影响（同一根因的第二个症状）**：`src/core/query/relation-query-service.ts:108-110` 的 `findCallers` 按 `edge.targetMethod` 过滤。边被合并后，`findCallers("PhaseDifferentialAccounting.readFor")` 只返回 `init`，丢掉 `boundary` / `finalize`。也就是说方法级调用查询目前给出的是不完整答案，不只是“边少”。

**修复方向**：
1. call 类型的去重键纳入 `sourceMethod` / `targetMethod`（或直接使用 extractor 生成的唯一 `relation.id`）；非 call 关系（inheritance/dependency/composition 等）保持现有键，避免行为漂移。
2. 两处 `deduplicateRelations` 必须同步修改；建议抽成共享 helper，避免再次分叉。
3. 补回归测试：同一个类里两个方法调用同一目标方法必须产出 2 条边；`findCallers` 必须返回全部调用者。

**预期效果**：仅修去重、不动 extractor 覆盖范围，quay 上 call 边 2 → 9；方法级 `findCallers` 恢复完整结果。

## AC

- [x] 单测：夹具中 `class A { m1(){ b.x() } m2(){ b.x() } }` 必须产出 2 条 call 边（两条边的 `sourceMethod` 分别为 `m1`/`m2`）；修复前该夹具只能得到 1 条
- [x] 非 call 关系去重语义不变：inheritance/dependency/composition 的现有去重行为与测试保持通过
- [x] 两个解析入口一致：`typescript-parser` 与 `parallel-parser` 对同一输入产出相同的 call 边集合（共享 helper 则单测 helper；各写一份则两边各有用例）
- [x] `findCallers` 回归：夹具上 `findCallers("<Class>.<targetMethod>")` 返回全部调用方法，不再只返回第一个
- [x] 真实数据：把 `/data/home/yale/work/quay/.archguard` 复制到 `/tmp` 夹具复跑分析后，`relationCountByType.call` 从 2 变为 9（若 extractor 行为另有变化，记录实测值并解释）；`findCallers("PhaseDifferentialAccounting.readFor")` 返回 `init`/`boundary`/`finalize` 三个调用者
- [x] `bash scripts/test.sh --for-task gap-call-edge-dedup-collapses-method-edges` 与 `npm run type-check` 通过

## DoD

不是“单测里两条边的 key 不一样”就算完成。要在 quay 的真实副本上复跑一次分析，展示 `arch.json` 里 call 边数量与具体边列表（source/sourceMethod/target/targetMethod），并实际调用一次方法级 `findCallers` 证明丢失的调用者回来了；同时给出一个非 call 关系的对照，证明去重键改动没有顺带改变继承/依赖边。

## Touches

- tasks/gap-call-edge-dedup-collapses-method-edges.md
- src/parser/typescript-parser.ts
- src/parser/parallel-parser.ts
- src/parser/relation-dedup.ts
- tests/unit/parser/typescript-parser.test.ts
- tests/unit/parser/call-edge-extractor.test.ts
- tests/unit/core/query/find-callers.test.ts
- tests/unit/parser/relation-dedup.test.ts
