---
id: gap-class-diagram-directory-namespaces
title: class 图只发一层启发式 namespace：Quay_Layer 601 类、Scripts_Layer 2343
  类挤在一个块，目录结构丢失（quay 实测）
status: done
labels:
  - gap
  - mermaid
  - cli
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测）**：quay 的 class 级产物按启发式分成 5 个文件，但每个文件只有一个顶层 namespace：
```
Quay_Layer.mmd       namespaces=1  classes=601
Scripts_Layer.mmd    namespaces=1  classes=2343
Quay_Github_Layer.mmd / Quay_Native_Layer.mmd / Criterion_Fidelity_Layer.mmd 也都是 1
```
`package.mmd` 保留着目录树（`packages/quay/dist`、`archive_group` 等），class 图却把整棵目录压成一个 `namespace Quay_Layer { ... }`，大仓不可读。

**根因（代码定位）**：
- `src/mermaid/grouper.ts:180-240` 用启发式只取一层目录名（`src|lib|packages|<next>`），并追加 “ Layer” 后缀；`mergeSmallPackages`（约 255 行起）还会把小包并掉，层级信息在分组阶段就丢了；
- `src/mermaid/generator.ts:171-175 / 318-322 / 413-417 / 591-596` 对每个 group 只发一个平铺 `namespace <group.name> {`；
- `src/mermaid/auto-repair.ts:88-117` 的 `flattenNestedNamespaces` 会主动把嵌套 namespace 拍平（历史 workaround），说明“嵌套 namespace 能否被渲染”本身需要先实测确认，不能假设。

**修复方向（先验证后实现）**：
1. 先用仓库内置 isomorphic-mermaid 渲染一个两层嵌套 namespace 的 classDiagram 样例，确认渲染器是否支持；支持则生成嵌套 namespace（目录路径直接映射层级），不支持则改为按目录拆多个 diagram/文件。
2. 分组阶段保留至少两级目录信息；只有叶子级小目录才允许合并，且合并后仍需保留父目录层级。
3. 若采用嵌套 namespace，需同步调整 `auto-repair` 的拍平逻辑，避免自己生成的嵌套结构又被自己拍平。
4. 输出必须确定性（同一输入两次生成字节一致），并保持现有 class/interface/enum 声明与关系发射不变。

## AC

- [x] 渲染能力先行实测并留证：对两层嵌套 namespace 的 classDiagram 样例跑一次内置渲染，明确给出“支持/不支持”的结论与输出，再据此选择实现路线（嵌套 namespace 或按目录拆图）
- [x] 合成夹具（`a/b/c/` 与 `a/b/d/` 各含若干类）：class 级产物中不同子目录的类不会全部落在同一个 namespace；机械断言存在 namespace 路径深度 ≥2，或存在 ≥2 个分组且最大分组不包含全部类
- [x] quay 副本实跑后，Scripts 层不再由单个 namespace 承载全部 2343 类：记录修复前后每个输出文件的 namespace 数与“最大单 namespace 类数”，后者必须显著下降
- [x] 生成物可渲染：对修复后生成的 `.mmd` 跑一次内置渲染校验，无 parse error（拆分方案则每个文件都校验）
- [x] 确定性：同一输入连续生成两次，`.mmd` 字节一致
- [x] `bash scripts/test.sh --for-task gap-class-diagram-directory-namespaces` 与 `npm run type-check` 通过

## DoD

不是“namespace 里多了一行嵌套”就算完成。要在合成夹具和 quay 副本上各跑一次真实 analyze：前者证明层级不再丢失、且每个产物都能被内置渲染器成功渲染；后者给出修复前后的 namespace 数、最大 namespace 类数、文件数对照，证明大仓的可读性问题确实缓解（而不是仅仅把 2343 个类换个地方塞）。若最终选择“按目录拆图”，也必须证明产物数量与文件命名的确定性，以及索引（index.md/manifest）能枚举全部拆出的文件。

## Touches

- tasks/gap-class-diagram-directory-namespaces.md
- src/mermaid/generator.ts
- src/mermaid/grouper.ts
- src/mermaid/types.ts
- src/mermaid/generator-grouping.ts
- src/mermaid/generator-formatting.ts
- src/mermaid/auto-repair.ts
- src/mermaid/diagram-generator.ts
- src/cli/processors/diagram-output-router.ts
- src/cli/processors/diagram-pipeline-runner.ts
- src/cli/utils/diagram-index-generator.ts
- src/types/diagram-result.ts
- tests/unit/mermaid/generator.test.ts
- tests/unit/mermaid/grouper.test.ts
- tests/unit/mermaid/auto-repair.test.ts
- tests/unit/mermaid/generator-formatting.test.ts
- tests/unit/mermaid/class-diagram-directory-namespaces.test.ts
