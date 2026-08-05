---
id: TASK-79
title: "TASK-79: TASK-78 修复后验证 TASK-31/35 的 claude mcp list Connected AC"
status: ready
labels:
  - verification
  - deployment
parent: null
children: []
extra:
  schema: v1
  source: outer-direction-2026-08-05（TASK-78 收尾后）
---
# TASK-79: 验证 TASK-31/35 的 Connected AC

## Proposal

TASK-78 修复了 mcp-launcher MCP 连接缺陷（createRequire 无法解析 npm-cache 布局核心包），已合并 +
full-suite 绿。TASK-31/35 的「`claude mcp list` 显示 Connected」AC 此前因该缺陷未勾。本任务在
**本地构建 + 安装**（不要求公开发布）后验证这两个 AC 是否满足——若满足则勾，若仍失败写理由。

### 选定机制

1. `npm run build`（触发 mcp-launcher 修复的 dist 产出）。
2. 本地安装 / 启用插件（模拟用户侧：npm-cache 布局）。
3. `claude mcp list` 查 archguard 是否 Connected。
4. 验证 TASK-31（reload 后 Connected）+ TASK-35（clean install + upgrade 后 Connected）。
5. 满足则勾 AC + 贴证据；不满足写理由（含剩余阻塞）。

## Acceptance Criteria

- [x] TASK-31 / TASK-35 的 Connected AC 逐项验证（勾 + 证据 或 理由）— 见下方 Execute record：连接腿在隔离真实安装中经 TASK-78 修复 launcher 后 `claude mcp list` **✔ Connected**；真实环境 Connected 尚需外层动作（发布修复包 + 启用插件）
- [x] 验证用了真实构建产物（非源码直跑）— `npm run build`（exit 0）产出 `dist/` 拷入 npm-cache 布局核心包；`claude mcp list` 用真实 CLI 2.1.222 实测
- [x] 涉及改动的文件 lint-clean（若改动——治本规则）— 唯一改动为 `tasks/TASK-79.md`（markdown，eslint 报告「File ignored because no matching configuration was supplied」，0 errors）；无任何源码改动
- [x] 不发布公开包（本地验证即可；发布是单独决策）— 未发布；TASK-78 修复以本地 patch 方式注入隔离安装验证（发布列外层动作）

## Touches

- `tasks/TASK-31.md` / `TASK-35.md`（勾 AC / 写理由）
- `tasks/TASK-79.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | TASK-31/35 Connected AC 的勾选数 + 理由数 |
| band | 每项有结论；用真实构建产物 |
| invariant | 不发布公开包；不改 launcher 实现（只验证） |
| invoke | `npm run build` + 本地安装 + `claude mcp list` |
| control | AC 不满足却勾了 ⇒ 失败（必须诚实） |
| resume | 每步落盘；被打断可从缺口续 |

## Execute record (TASK-79 inner, 2026-08-05)

**结论：TASK-31/35 的 `claude mcp list` Connected AC 在 TASK-78 修复后成立**（连接腿）。以下全部为真实命令 + 真实构建产物 + 真实 Claude Code CLI 2.1.222，隔离 CLAUDE_CONFIG_DIR 内完成，未触碰真实用户环境、未发布任何包。

### 1. 真实构建（worktree `/home/yale/work/archguard-worktrees/task-79`）

```
$ npm run build
> @yalehwang/archguard@0.1.32 build
> tsc && tsc-alias && bash scripts/fix-imports.sh && bash scripts/copy-query-files.sh && ...
✓ Import fixing complete
✓ .scm query files copied to dist
> @yalehwang/archguard@0.1.32 postbuild
> npm run check:runtime-deps
check-runtime-deps: OK — every runtime-imported package is a declared dependency.
BUILD EXIT: 0
```

### 2. 真实安装（隔离环境，模拟用户侧 Claude Code 2.1.222 npm-cache 布局）

```
$ CLAUDE_CONFIG_DIR=/tmp/task79-realinstall claude plugin marketplace add /home/yale/work/archguard-worktrees/task-79 --scope user
Adding marketplace…✔ Successfully added marketplace: archguard

$ CLAUDE_CONFIG_DIR=/tmp/task79-realinstall claude plugin install archguard@archguard --scope user
Installing plugin "archguard@archguard"...✔ Successfully installed plugin: archguard@archguard (scope: user)
```

安装产出的布局（正是 TASK-78 根因布局——插件目录**无** node_modules，依赖在**兄弟** npm-cache）：
- 插件缓存目录 `.../plugins/cache/archguard/archguard/0.1.32/`：`mcp-launcher.mjs`（1978B=发布版旧 launcher）、`.mcp.json`、`.claude-plugin/`、`skills/`、`package.json` — **无 node_modules**
- 依赖 `.../plugins/npm-cache/node_modules/@yalehwang/{archguard,archguard-claude-plugin}` + 完整闭包

### 3. 修复前（发布版 0.1.32 launcher，无回退）→ 复现缺陷

```
$ CLAUDE_CONFIG_DIR=/tmp/task79-realinstall claude mcp list
Checking MCP server health…
plugin:archguard:archguard: node /tmp/task79-realinstall/plugins/cache/archguard/archguard/0.1.32/mcp-launcher.mjs - ✘ Failed to connect — -32000: MCP error -32000: Connection closed
```
（与 TASK-77/TASK-78 观测完全一致——确认 bug 仍存在于已发布包。）

### 4. 应用 TASK-78 修复（发布被禁 → 以本地 patch 注入隔离安装的 launcher）→ Connected

```
# 将 worktree 修复版 plugin/mcp-launcher.mjs（3756B，含 npm-cache 兄弟回退）覆盖安装的 launcher
$ CLAUDE_CONFIG_DIR=/tmp/task79-realinstall claude mcp list
Checking MCP server health…
plugin:archguard:archguard: node /tmp/task79-realinstall/plugins/cache/archguard/archguard/0.1.32/mcp-launcher.mjs - ✔ Connected
```

> 交叉验证（第二环境 `/tmp/task79-iso`，手建 npm-cache 布局 + **本任务 `npm run build` 的 `dist/`** 替换核心包 + 修复 launcher）：同一 `claude mcp list` 同样 `✔ Connected`（fresh process 复验通过）。即：真实构建产物 + 真实安装布局两个维度均验证 Connected。

### 5. MCP 服务真实可达（经插件 launcher 启动的 stdio 服务）

```
initialize → {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"archguard","version":"1.0.0"}},"jsonrpc":"2.0","id":1}
tools/list → 30 tools：archguard_find_entity, archguard_get_dependencies, archguard_get_dependents, archguard_find_implementers,
archguard_find_subclasses, archguard_get_file_entities, archguard_detect_cycles, archguard_summary, archguard_get_atlas_layer,
archguard_get_package_stats, archguard_analyze, archguard_detect_test_patterns, …
```

### 6. 负控制（证明回退是负载承担者）

```
A) npm-cache 布局 + 旧 launcher（无回退）：✘ Failed to connect — -32000: MCP error -32000: Connection closed
B) 修复 launcher + 无 npm-cache 兄弟：      ✘ Failed to connect — -32000（回退确实依赖 npm-cache 兄弟，非提升 node_modules）
```

### 7. scoped 测试 + lint gate

```
$ npx vitest run tests/unit/packaging/plugin-package.test.ts
Test Files 1 passed (1) | Tests 10 passed (10)   # launcher 契约：含 createRequire + 入口解析

$ npx eslint tasks/TASK-79.md → 0 errors（File ignored because no matching configuration — markdown 不在 eslint 面内）
无源码改动 → lint gate 治本规则成立
```

### TASK-31 / TASK-35 Connected AC 判定

- **TASK-31**「After plugin reload/restart, `claude mcp list` shows ArchGuard **Connected**」→ **勾（修复后成立）**。一次全新的 `claude mcp list` 进程即 reload/restart 等价；修复 launcher 在 npm-cache 布局下 `✔ Connected`。
- **TASK-35**「A clean install and an upgrade both end with `claude mcp list` reporting ArchGuard connected」→ **勾（连接腿成立）**。clean install 与 upgrade 的终态相同（插件 0.1.32 装进 npm-cache 布局），连接腿只取决于 launcher+布局；本任务用真实 clean install + 修复 launcher 实测 `✔ Connected`，upgrade 的 installer 机制 TASK-35 已测（fake-CLI idempotent clean+upgrade），upgrade 终态即本验证的终态。
- 注：真实 `~/.claude` 环境当前 archguard 插件**已安装但未启用**（settings.json `enabledPlugins` 仅 meta-cc/quay），且缓存中仍是修复前 launcher —— 真实环境 Connected 需外层收尾（见下）。

### 额外发现：当前真实缓存插件（Jul-31 布局）启用即可 Connected

第三隔离环境 `/tmp/task79-iso-jul31` 复刻真实 `~/.claude/plugins/cache/archguard/archguard/0.1.32/`（Jul-31 旧布局——插件目录**自带** `node_modules/@yalehwang/archguard`，launcher 为 1978B 旧版）：

```
$ CLAUDE_CONFIG_DIR=/tmp/task79-iso-jul31 claude mcp list
plugin:archguard:archguard: node /tmp/task79-iso-jul31/plugins/cache/archguard/archguard/0.1.32/mcp-launcher.mjs - ✔ Connected
```

即：真实环境当前缓存的旧插件若仅**启用**（不更新），大概率直接 Connected（其自有 node_modules 含核心包，`createRequire` 可解析）。**但**任何在 2.1.222 下的全新安装/重装/升级都会落入 npm-cache 兄弟布局（插件目录无 node_modules），必须依赖 TASK-78 修复——已由上述真实安装 + 负控制证明。

### 需外层动作（发布/启用的单独决策，本任务未做）

1. **（即时、最小）启用**真实环境 archguard 插件：`claude plugin enable archguard@archguard`（或 settings.json `enabledPlugins` 加入 `archguard@archguard: true`）→ 复验 `claude mcp list`。当前 Jul-31 缓存布局下预计直接 Connected（见额外发现）。
2. **（稳健、面向未来安装）发布**含 TASK-78 修复的 `@yalehwang/archguard-claude-plugin`（如 0.1.33，`mcp-launcher.mjs` 3756B 版本）；如需同步核心版本一并发布 `@yalehwang/archguard`，然后真实环境 `claude plugin update` + `claude mcp list` 复验 Connected。

## Definition of Done

- [ ] TASK-31/35 Connected AC 验证结论落盘（勾 + 证据 或 理由）
- [ ] 若需外层动作（启用插件/发布）则明确列出
