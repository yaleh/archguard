---
id: gap-multi-output-format-selection
title: 多输出选择接口：formats 数组统一 CLI/配置文件/MCP，路由按集合循环产出
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> merge-candidate 已查：与 ready 中的 gap-default-exclude-build-artifacts 同改 src/cli/config-loader.ts，但机制不同（它改 default-excludes，本任务改 format→formats）且它已进 worktree——保持分开，由调度器按 Touches 串行。同机制重复无（TASK-83 是输出布局嵌套问题，已 done，非格式选择）。

现状 format 单值散落三处（config-loader `format: z.enum`、CLI `-f` 单值、MCP `format: z.enum`），router 单分支 if/else；plantuml emit 已落地但只能单选一种。本任务把「选输出」统一成单一模型：`OutputFormat = 'mermaid'|'json'|'plantuml'`，规范形态 `OutputFormat[]`（内部去重，默认 {mermaid}），四入口同构、单一键单一形状（不做 format 兼容别名）：

- 配置文件 `formats: [...]`（全局 + 每 diagram）
- CLI `-f` 可重复
- MCP `formats: [...]`
- 程序化 `resolveFormats()` 归一 + 优先级（CLI/MCP > 每 diagram > 全局 > 默认；覆盖不并集）

router `route()` 由单分支改为按集合循环。选择接口只决定「要哪些格式」，不管每种格式怎么产（json=写 .json；plantuml=emit .puml；mermaid=渲染 .mmd/.svg/.png）。

## AC

- [ ] src/types/config-mermaid.ts 增 `OutputFormats = OutputFormat[]`；src/cli/utils/format-selection.ts 的 `resolveFormats()` 归一 CLI/config/MCP 三来源为有序去重集合（优先级覆盖不并集、空→默认 {mermaid}）
- [ ] config-loader：全局与每 diagram 的 `format: z.enum([...])` 改 `formats: z.array(z.enum([...]))`，删除 `format` 键（配置含旧 `format` 键时拒绝、不静默忽略）；GlobalConfig/DiagramConfig/CLIOptions 的 `format` 字段改 `formats`
- [ ] CLI：`-f, --format <type>` 改可重复 collect（不做逗号简写），帮助文本 `mermaid|json|plantuml（可重复，默认 mermaid）`
- [ ] MCP analyze-tool：`format: z.enum([...])` 改 `formats: z.array(z.enum([...]))`
- [ ] router `route()` 按 resolveFormats 集合循环分发 json/plantuml/mermaid；diagram-pipeline-runner 的 resultPaths 按集合累积
- [ ] 测试：config-loader `formats` 数组解析 + 旧 `format` 键拒绝；resolveFormats 优先级；router 多格式（plantuml+mermaid 同产 .puml 与 .mmd/.svg/.png）；CLI 重复 -f；MCP formats 数组

## DoD

对 fixture 项目跑 `node dist/cli/index.js analyze -f plantuml -f mermaid` 产出 .puml 与 .mmd/.svg/.png 并存，`-f json -f plantuml` 产出 .json 与 .puml 并存；npm test / type-check / build 全绿。

## Touches

- src/types/config-mermaid.ts
- src/types/config-global.ts
- src/types/config-diagram.ts
- src/types/config-cli.ts
- src/cli/config-loader.ts
- src/cli/commands/analyze.ts
- src/cli/mcp/analyze-tool.ts
- src/cli/processors/diagram-output-router.ts
- src/cli/processors/diagram-pipeline-runner.ts
- src/cli/utils/format-selection.ts
- tests/unit/cli/config-loader.test.ts
- tests/unit/cli/analyze-command.test.ts
- tests/unit/cli/mcp/analyze-tool.test.ts
- tests/unit/cli/processors/diagram-output-router.test.ts
- tests/unit/cli/processors/diagram-pipeline-runner.test.ts
- tests/unit/cli/utils/format-selection.test.ts
- tasks/gap-multi-output-format-selection.md