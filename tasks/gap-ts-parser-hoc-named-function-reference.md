---
id: gap-ts-parser-hoc-named-function-reference
title: TS 解析器处理 export const X = memo(<NamedFunction>) 形态（内层具名函数引用，MarkdownBody 单例）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 关联已 done 的 gap-ts-parser-export-default-hoc-entities（覆盖 `export default HOC(<Identifier>)` 与 `export { X }`）与 gap-ts-parser-hoc-memo-forwardref-entities（覆盖 `export const X = HOC(<inline arrow>)`）。

复测（发布版 0.1.41，HEAD 2a706bb2）确认前两条路径已修、原 22 个组件全进图，但发现第三条路径仍漏：`src/modules/chat/transcript/Markdown.tsx:348` 的 `export const MarkdownBody = memo(MarkdownBodyRenderer)` —— 内层是**具名函数引用**（Identifier），不是内联箭头。根因在 `function-extractor.ts` 的 `unwrapFunctionInitializer` 只返回 ArrowFunction/FunctionExpression：HOC 解包到 Identifier 时 firstArg 是 Identifier、直接 `return undefined`，const-export 分支拿不到函数体，`MarkdownBody` 无实体。修法：HOC 解包到 Identifier 时 fallback 到「把该 const 标记为函数实体」（可不取参数/成员）。

## AC

- [x] `unwrapFunctionInitializer` 对 `memo/forwardRef/React.memo/React.forwardRef(<NamedFunctionIdentifier>)` 形态产出实体（name 取 const 名），不因 firstArg 是 Identifier 而 return undefined
- [x] `tests/unit/parser/function-extractor.test.ts` 新增 fixture：`function MarkdownBodyRenderer(){…}` + `export const MarkdownBody = memo(MarkdownBodyRenderer)`，经 `parseCode` 产出 1 个 entity
- [x] 现有三种形态不回归：`export const X = memo((inline arrow))`、`export default memo(<Identifier>)`、`export { X }`

## DoD

在 claudecodeui src scope 重跑 analyze，`get_file_entities` 对 `src/modules/chat/transcript/Markdown.tsx` 返回含 `MarkdownBody` 的实体——即第三条 HOC 形态也进图。

## Touches

- src/parser/function-extractor.ts
- tests/unit/parser/function-extractor.test.ts
- tasks/gap-ts-parser-hoc-named-function-reference.md
