---
id: gap-ts-parser-hoc-memo-forwardref-entities
title: TypeScript 解析器把 memo/forwardRef/HOC 包装的组件解包为实体，前端主组件不再整体漏出实体图
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

实测（claudecodeui 校准跑，2026-10-20）发现 `src/**/*.tsx` 里 37 个用 `memo(...)`/`forwardRef(...)` 包装的组件（含 722 行的 `MessageComponent`，及 `ChatMessagesPane`、`ChatInterface`、`Markdown`、`ToolGroupContainer`）都不进 ArchJSON 实体图，`get_file_entities` 对它们返回 `[]`，导致前端 42 包 SCC 的实体/边、fanIn/fanOut、ownership、cognitive 全漏掉这些主组件。根因在 `FunctionExtractor.extract`（`src/parser/function-extractor.ts:54-75`）：只解包「直接」的 ArrowFunction/FunctionExpression 初始化器，`export const X = memo(() => …)` 这类 initializer 是 CallExpression 时整条被跳过。修法：识别 `memo`/`forwardRef`/`React.memo`/`React.forwardRef` 等 HOC 包装调用，unwrap 出内层函数再建实体。

## AC

- [x] `src/parser/function-extractor.ts` 对 `memo` / `forwardRef` / `React.memo` / `React.forwardRef` 包裹的箭头或函数表达式初始化器，unwrap 内层函数并生成 `type:'function'` 实体，name 取变量声明名
- [x] `tests/unit/parser/function-extractor.test.ts` 新增 fixture：`export const MessageComponent = memo((props) => …)` 与 `export const ToolGroup = forwardRef<HTMLDivElement, P>(function ToolGroup(){…})` 经 `parseCode` 各产出 1 个 entity，`npm test -- --run tests/unit/parser/function-extractor.test.ts` 绿
- [x] 现有 function-extractor 用例不回归：`export const bar = () => …` 与 `export function foo()` 仍照常产出实体

## DoD

一个含 `memo(...)` 组件的真实 `.tsx` fixture 经 `node dist/cli/index.js analyze -f json` 后，`archjson.entities` 里出现该组件实体、且其 import 边出现在 relations / moduleGraph 里——即「组件本身进入实体图」在真实产物中可查，而非仅单测通过。

## Touches

- src/parser/function-extractor.ts
- tests/unit/parser/function-extractor.test.ts
- tasks/gap-ts-parser-hoc-memo-forwardref-entities.md
