---
id: gap-ts-module-graph-type-only-edge-split
title: TS moduleGraph 边区分 type-only 与值依赖：新增 typeOnlyStrength / valueStrength（A4
  分层检查的前提）
status: ready
labels:
  - gap
  - typescript
  - arch-json
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ts-module-graph-misses-reexport-dynamic-and-bare-alias-edges
---
## Proposal

目录级依赖边（`TsModuleDependency`，`src/types/extensions/ts-analysis.ts`）目前只有 `strength`（语句条数）和 `importedNames`，**不区分 `import type` 与值依赖**。后果：分层检查、环检测、"消除违例"的优先级判断都无法区分"只借类型"（可以靠下移类型修复、不产生运行时耦合）与"真实运行时依赖"。2026-10-02 在 archguard 自身做分层检查时，5 条违例里只有 2 条含值依赖，其余全是 type-only，这个信息是靠外部脚本按位置扫描源文件补出来的（`docs/experiments/layer-map/check-layers.mjs`），ArchGuard 自己给不出。quay 项目的架构审查（B8/A4）提出了同一需求。

本任务只做"在边上增加可选的计数字段"，不改变现有字段含义：

- `TsModuleDependency` 新增可选字段 `typeOnlyStrength: number` 与 `valueStrength: number`，不变式：`strength === typeOnlyStrength + valueStrength`。旧数据缺这两个字段时消费者按"未知"处理，不得当 0。
- 判定规则（在 `src/plugins/typescript/builders/module-graph-builder.ts` 的边收集循环里，用 ts-morph 的 `isTypeOnly()`，不要用正则）：
  - `import type { A } from 'x'`、`import type X from 'x'`、`export type { A } from 'x'`、`export type * from 'x'` → type-only；
  - `import { type A, type B } from 'x'`（所有具名导入都带 `type` 修饰，且没有默认导入/命名空间导入）→ type-only；
  - `import { type A, B } from 'x'`（混合）、`import X from 'x'`、`import * as X`、副作用导入 `import 'x'`、`export { A } from 'x'`、`export * from 'x'`、字面量动态 `import()` → 值依赖。
- 本任务依赖 gap-ts-module-graph-misses-reexport-dynamic-and-bare-alias-edges 先落地：只有边集合完整（含 re-export、动态 import）之后，拆分才覆盖全部边；否则 re-export 边会没有分类。若该任务尚未合入，本任务不得开始。
- 下游透传：`src/cli/processors/arch-json-utils.ts` 在子模块过滤 moduleGraph 时按原对象复制边，需确认新增字段不丢；`src/cli/utils/canonicalize-arch-json.ts` 对边排序，确认新增字段不破坏确定性（相同输入两次输出逐字节一致）。

不在本任务范围：分层规则声明与检查器（A4，见 proposal）；mermaid package 图对 type-only 边用虚线展示（可另立）；Go/Java 等其他语言。

关联（追溯用，非前置）：docs/experiments/layer-map/（外部原型，已提交 2a75651e）。

## AC

- [ ] `tests/unit/plugins/typescript/builders/module-graph-builder.test.ts` 新增用例，逐形态断言（每个形态一个夹具，目录 a 引用目录 b）：`import type {A}` → `typeOnlyStrength=1,valueStrength=0`；`import {type A, type B}` → type-only；`import {type A, B}` → value；`import * as X` → value；`import 'x'`（副作用）→ value；`export {A} from` → value；`export type {A} from` → type-only；字面量 `import()` → value
- [ ] 同一测试文件新增用例：同一目录对之间混合 3 条 type-only 与 2 条值依赖，得到 `strength=5,typeOnlyStrength=3,valueStrength=2`；并断言对所有边 `strength === typeOnlyStrength + valueStrength`
- [ ] 确定性：对同一夹具连续两次生成并经 `canonicalizeArchJson` 序列化，输出逐字节一致（在 `tests/unit/cli/utils/` 现有 canonicalize 测试文件里新增用例，或新增用例文件并在 Touches 中声明）
- [ ] 运行 `npx vitest run tests/unit/plugins/typescript/builders/module-graph-builder.test.ts tests/plugins/typescript/builders/module-graph-builder.test.ts tests/unit/mermaid/ts-module-graph-renderer.test.ts` 退出码 0，且原有用例不改动仍通过
- [ ] 真实对照：对 archguard 自身重新 `node dist/cli/index.js analyze -f json --diagrams package --output-dir /tmp/<dir>` 后，`moduleGraph.edges` 全部满足 `strength === typeOnlyStrength + valueStrength`，存在至少一条 `typeOnlyStrength>0` 且 `valueStrength=0` 的边和至少一条 `valueStrength>0` 的边；抽查 3 条边，其 `typeOnlyStrength` 与位置判定的 grep（行首 `import type`/`export type` 语句、不含注释）计数一致
- [ ] `npm run type-check` 与 `npm test` 全量通过

## DoD

必须在真实 TS 项目（archguard 自身）上用修复后的构建生成 `overview/package.json`，读取 `moduleGraph.edges`，给出抽查的 3 条边的 `typeOnlyStrength/valueStrength` 与独立 grep 计数的逐条对照，证明拆分与源码一致，而不是只靠夹具。旧版本产物（缺这两个字段）被读取时必须不报错且按"未知"处理（给一个缺字段的旧 JSON 实测一次）。

## Touches

- src/plugins/typescript/builders/module-graph-builder.ts
- src/types/extensions/ts-analysis.ts
- src/cli/processors/arch-json-utils.ts
- src/cli/utils/canonicalize-arch-json.ts
- tests/unit/plugins/typescript/builders/module-graph-builder.test.ts
- tests/plugins/typescript/builders/module-graph-builder.test.ts
- tasks/gap-ts-module-graph-type-only-edge-split.md
