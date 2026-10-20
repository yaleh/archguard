---
id: gap-ts-parser-export-default-hoc-entities
title: TS 解析器识别 export default / export { X } 引用的 memo/forwardRef 组件，补全仍缺的 22 个
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

<!-- dedup-ref --> 关联已 done 的 gap-ts-parser-hoc-memo-forwardref-entities（其只修了 `export const X = memo(...)` 这一种形态）。

复测（HEAD c585aca2 新 build）发现 src 范围 26 个 memo/forwardRef 名字只有 4 个进图（`Markdown`/`MemoryCitations`/`SubagentPanel`/`TodoListContent`，都是 `export const X = memo(...)`），**22 个仍缺**，含 `MessageComponent`（`const MessageComponent = memo(...)` + `export default MessageComponent`）、`ChatMessagesPane`（`const ...` + `export default memo(ChatMessagesPane)`）、`ChatInterface`（`function ChatInterface(...)` + `export default React.memo(ChatInterface)`）、`ToolGroupContainer`（`function ...` + `export default memo(ToolGroupContainer)`）。根因在 `function-extractor.ts:46` 与 `:68` 的 `isExported()` 只认「声明语句本身 exported」，`export default <Identifier>` / `export default HOC(<Identifier>)` / `export { X }` 不会把被引用的声明标成导出。修法：先收集默认/命名导出的目标标识符，再把被引用的函数声明与变量声明视为导出并走既有 HOC 解包。

## AC

- [ ] `src/parser/function-extractor.ts` 对 `export default <Identifier>`、`export default memo/forwardRef/React.memo/React.forwardRef(<Identifier>)`、`export { X }` 三种形态，把被引用的函数/变量声明视为导出并生成实体
- [ ] `tests/unit/parser/function-extractor.test.ts` 新增三条真实形态 fixture：`const MessageComponent = memo(...)` + `export default MessageComponent`；`const X = ...` + `export default memo(X)`；`function Y(...)` + `export default React.memo(Y)`，各经 `parseCode` 产出 1 个 entity
- [ ] `export const Z = memo(...)` 既有形态不回归；`npm test -- --run tests/unit/parser/function-extractor.test.ts` 绿

## DoD

在 claudecodeui 的 src scope 上重跑 analyze，`get_file_entities` 对 `MessageComponent`/`ChatInterface`/`ToolGroupContainer` 返回非空——即 `export default` 形态的组件也进入实体图，而非仅单测通过。

## Touches

- src/parser/function-extractor.ts
- tests/unit/parser/function-extractor.test.ts
- tasks/gap-ts-parser-export-default-hoc-entities.md