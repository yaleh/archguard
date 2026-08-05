---
id: TASK-79
title: "TASK-79: TASK-78 修复后验证 TASK-31/35 的 claude mcp list Connected AC"
status: todo
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

- [ ] TASK-31 / TASK-35 的 Connected AC 逐项验证（勾 + 证据 或 理由）
- [ ] 验证用了真实构建产物（非源码直跑）
- [ ] 涉及改动的文件 lint-clean（若改动——治本规则）
- [ ] 不发布公开包（本地验证即可；发布是单独决策）

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

## Definition of Done

- [ ] TASK-31/35 Connected AC 验证结论落盘（勾 + 证据 或 理由）
- [ ] 若需外层动作（启用插件/发布）则明确列出
