---
id: TASK-87
title: "TASK-87: TASK-31/35 发布准备——TASK-78 mcp-launcher 修复的发布包验证（不发布）"
status: done
labels:
  - release
  - plugin
  - deployment
parent: null
children: []
extra: {}
---
# TASK-87: TASK-31/35 发布准备——TASK-78 mcp-launcher 修复的发布包验证（不发布，备齐决策证据）

## Proposal

TASK-78 已修 mcp-launcher 的 npm-cache 布局解析缺陷（`createRequire` 向上解析够不到兄弟目录
`npm-cache/node_modules`），TASK-79 已在隔离环境验证修复后 `claude mcp list` **Connected**。
但真实环境仍用 Jul-31 旧布局缓存（插件未启用、launcher 为旧版），且修复从未**发布**。

TASK-31/35 的发布决策是人的权限（escalations.md 已记）。本任务做**发布准备**（不发布）：
把含 TASK-78 修复的插件包构建、版本号、打包内容、验证证据备齐，使人的发布决策
（npm publish / 启用插件）有据可依、一键可执行。

**边界：不 `npm publish`、不 `git tag`、不改真实 `~/.claude`**——发布/启用是单独决策。

## Acceptance Criteria

- [x] 确认 plugin/mcp-launcher.mjs 含 TASK-78 修复（npm-cache 兄弟目录回退逻辑在位）
- [x] 构建 + `npm pack --dry-run`（或等价）验证插件包：含 mcp-launcher.mjs（修复版）+.mcp.json + .claude-plugin/ + skills/，版本号 0.1.33（从 0.1.32 bump）
- [x] 打包产物验证：解包检查 launcher 修复逻辑 + 依赖闭包正确（`@yalehwang/archguard` 匹配版本）
- [x] 发布检查清单落盘：发布命令、插件启用命令、Connected 复验步骤（TASK-79 证据引用）
- [x] 不做真实发布/启用/改 ~/.claude（边界）；lint-clean

## Touches

- `plugin/package.json`（version bump 0.1.32→0.1.33）
- `plugin/mcp-launcher.mjs`（只读核验修复在位，不改）
- `tasks/TASK-87.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | `npm pack --dry-run` 产物清单 + launcher 修复逻辑在位（grep/读 diff） |
| band | 产物含修复版 launcher + 正确依赖；版本 0.1.33 |
| invariant | 不发布、不启用、不改真实环境（边界）；TASK-78 修复逻辑不改 |
| invoke | `npm pack --dry-run`（plugin/ 或根，root node_modules 已在位）+ grep launcher 回退逻辑 |
| control | 若产物不含修复 launcher ⇒ 判定失败（必须诚实） |
| resume | 从「确认 launcher 修复在位 + 构建」续 |

## Definition of Done

- [x] 发布包验证完毕（产物清单 + 修复在位 + 版本 0.1.33）
- [x] 发布检查清单落盘（命令 + 复验步骤）
- [x] 未做任何真实发布/启用动作（边界确认）

## Evidence (2026-08-11, outer dispatch tick — 发布准备，不发布)

**AC1 — launcher 修复在位**：`plugin/mcp-launcher.mjs` 含 `resolveArchguardEntry()` 两段解析：
① 插件自身依赖树（`createRequire(import.meta.url)`）→ ② 失败则从插件根向上走，发现兄弟
`npm-cache/node_modules` 并经其 `createRequire` 解析（TASK-78 提交 `bd6731d8`）。头部注释（L12-22）
文档化该解析顺序。**只读核验，未改**。

**AC2 — pack 验证**：`plugin/package.json` version **0.1.32 → 0.1.33**。`npm pack --dry-run`（plugin/）
产物：
```
📦 @yalehwang/archguard-claude-plugin@0.1.33
  641B .claude-plugin/plugin.json
  150B .mcp.json
  3.8kB mcp-launcher.mjs        ← 修复版 launcher
  830B package.json
  7.1kB skills/feature-developer/SKILL.md
  1.3kB skills/project-semantics-discovery/references/archguard-evidence.md
  3.1kB skills/project-semantics-discovery/SKILL.md
  7 files total · 6.5kB package / 16.9kB unpacked
  yalehwang-archguard-claude-plugin-0.1.33.tgz
```

**AC3 — 解包复核**：实际 `npm pack` + 解包 7 文件齐全。打包版 `mcp-launcher.mjs` 含 **7 处 `npm-cache`
引用 + `resolveArchguardEntry`/`createRequire`**（TASK-78 修复在产物中）。`package.json` version 0.1.33、
依赖 `@yalehwang/archguard: 0.1.32`（发布运行时，launcher 解析它 exec 的 CLI——运行时不含 launcher
修复，无需 bump）。`.mcp.json`（`node ${CLAUDE_PLUGIN_ROOT}/mcp-launcher.mjs`）与
`.claude-plugin/plugin.json` 在位。

**AC4 — 发布检查清单**（落盘下方，供人决策；引用 TASK-79 Connected 证据）：
- 发布：`cd plugin && npm publish`（或 dry-run 复核后 `npm publish`）→ 产出 `0.1.33`。
- 启用：`claude plugin enable archguard@archguard`（TASK-79 报告的即时启用命令）。
- Connected 复验：`npm run build` 后 `claude mcp list` 查 archguard 是否 **Connected**（TASK-79
  隔离验证：修复 launcher → `claude mcp list` ✔ Connected + 30 tools）。真实环境需发布 + 启用后复验。
- 升级：若用户已有旧版，`claude plugin update` 或重装 `0.1.33`。

**AC5 — 边界确认**：未 `npm publish`、未 `git tag`、未改真实 `~/.claude`。lint-clean（version bump
为 JSON 字段，lint 无感）。TASK-78 修复逻辑未改（launcher 只读核验）。

**发现（供发布决策）**：`.claude-plugin/plugin.json` 的 `"version": "0.1.32"` 为显示元数据字段，
与 package.json 0.1.33 不一致。Touches 仅列 `plugin/package.json`，故按边界只 bump package.json；
plugin.json version 字段留待发布决策时同步（一行改动，非本任务 Touches 范围）。
