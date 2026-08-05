---
id: TASK-78
title: "TASK-78: mcp-launcher MCP 连接缺陷——依赖解析与 Claude Code 插件缓存布局不兼容"
status: ready
labels:
  - defect
  - plugin
  - mcp
parent: null
children: []
extra:
  schema: v1
  source: outer-filing-2026-08-05（TASK-77 真实环境核验产出）
---

# TASK-78: mcp-launcher MCP 连接缺陷——依赖解析与 Claude Code 插件缓存布局不兼容

## Proposal

**问题**：`plugin/mcp-launcher.mjs` 的 MCP 服务器无法连接（`claude mcp list` → `✘ Failed to
connect — MCP error -32000: Connection closed`），阻塞 TASK-31/TASK-35 的 `claude mcp list`
Connected AC。

**证据**（TASK-77 真实环境核验，2026-08-05）：
- 包已发布（`@yalehwang/archguard-claude-plugin@0.1.32`），真实 `claude plugin install` 成功并启用
  插件，但 MCP 连接腿断裂。
- `plugin/mcp-launcher.mjs:19` `const require = createRequire(import.meta.url)` —— 从插件目录
  向上解析依赖。
- **根因**：Claude Code 2.1.222 把插件依赖装进**兄弟目录** `plugins/npm-cache/node_modules/`，
  `createRequire(import.meta.url)` 从插件目录向上解析够不到它，且 claude 不设 `NODE_PATH`。
- **复现闭环**：`require.resolve` 报 `MODULE_NOT_FOUND`；设 `NODE_PATH=<npm-cache>/node_modules`
  启动即成功——诊断正确，非「环境不可得」。
- launcher 头部注释声明「deliberately does NOT rely on ... NODE_PATH」——该假设在 Claude Code
  2.1.222 的插件缓存布局下失效。

**选定机制**：修 launcher 的依赖解析以兼容 npm-cache 布局（解析失败时回退到 Claude Code 的
`npm-cache/node_modules` 兄弟目录，或支持 `NODE_PATH` 注入），保持「不依赖全局 install / 仓库
父 node_modules / vendored dist」的既有纪律。

## 任务

1. 复现：真实 `claude plugin install`（或最小等价——构造 npm-cache 兄弟布局 + 插件目录结构）
   下确认 `require.resolve` 失败、`NODE_PATH` 注入成功。
2. 修 `plugin/mcp-launcher.mjs`：`createRequire(import.meta.url)` 解析失败时，回退到
   Claude Code 插件缓存的 `npm-cache/node_modules`（相对插件目录计算或探测），或
   在进程内把该路径并入模块解析（如设置 `process.env.NODE_PATH` + 重新 `import` 语义，
   或以解析出的绝对路径直接加载）。保留「不依赖全局 install」纪律。
3. 验证：构造的 npm-cache 布局下 launcher 能解析并启动 MCP 服务器（exit 0、stdio 服务可达）；
   真实 `claude mcp list` 若环境可得则复验 Connected。
4. 回归：launcher 在「插件自身依赖树」（nested/hoisted）布局下仍工作——不破坏 TASK-31 已满足的
   install 契约（`cleanupDeprecatedMcpJson` 等）。
5. 报告：根因→修复→验证证据；TASK-31/TASK-35 的 `claude mcp list` AC 是否可勾。

## Acceptance Criteria

- [ ] `plugin/mcp-launcher.mjs` 在 Claude Code npm-cache 插件布局下能解析 `@yalehwang/archguard`
      （构造该布局实测：launcher exit 0、MCP stdio 服务启动）
- [ ] 回退逻辑有负控制：`createRequire` 正常路径（插件自身依赖树）仍工作，不依赖全局 install
- [ ] 真实 `claude mcp list`（环境可得时）显示 Connected；环境不可得则写明理由 + 构造布局实测证据
- [ ] `npm run lint` 0 errors（lint gate——改动的 plugin 文件 lint-clean）
- [ ] TASK-31/TASK-35 的 `claude mcp list` Connected AC 状态更新（可勾则勾+证据，不可则理由）

## Touches

- plugin/mcp-launcher.mjs
- tasks/TASK-78.md

## Contract

| Key | Value |
|---|---|
| measure | 构造 npm-cache 布局下 `node plugin/mcp-launcher.mjs --help`（或等价）的退出码 + `require.resolve` 结果 |
| band | 修复后退出码 0、resolve 成功；修复前 MODULE_NOT_FOUND |
| invariant | 不依赖全局 install / 仓库父 node_modules / vendored dist（launcher 头部声明纪律）；不破坏嵌套/提升布局 |
| invoke | 构造布局实测 + `npm run lint` |
| control | 移除回退逻辑 ⇒ 又 MODULE_NOT_FOUND（负控制）；或把依赖改回插件自身树 ⇒ 仍工作 |
| resume | 每步落盘；被打断可从「复现 + 定位」续 |

## Definition of Done

- [ ] 修复提交 + 构造 npm-cache 布局实测通过（launcher 解析成功、服务可启动）
- [ ] 负控制/回归验证（插件自身树布局不回归）
- [ ] lint 0 errors
- [ ] TASK-31/35 的 `claude mcp list` Connected AC 状态更新（勾或理由）

## Dispatch review

| Field | Value |
|---|---|
| reviewer | outer |
| at | 2026-08-05T19:25Z |
| changed | 外层立案：TASK-77 核验产出（真实证据 + 阻塞两 AC）；lint gate 含入 |
