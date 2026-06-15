# L0 Agent Queue

Autonomous task execution via GitHub Issues + `/loop`.

## 概念

```
讨论 → /feature-to-issues → GitHub Issue (agent-run) → L0 Loop → PR → 合并
```

人工参与两个节点：
1. **创建 Issue 后审阅 DoD**（确认执行命令正确后手动加 `agent-run` 标签）
2. **PR 合并**（代码审查）

其余流程由 L0 Loop 自动完成。

---

## 快速使用

### 创建任务

```
/feature-to-issues <功能描述>
```

生成 Issue，经过 2 轮生成 + 2 轮迭代审查后创建，**不自动加执行标签**。
审阅 Issue 中的 `### DoD` 命令，确认无误后在 GitHub 上手动加 `agent-run` 标签。

### 触发执行

```
@.claude/loop.md
```

或启动定时轮询：

```
/loop 5m @.claude/loop.md
```

Loop 会自动完成：认领 Issue → 创建 worktree → 顺序执行各 Phase → 验证 DoD → 开 PR → 关闭 Issue。

---

## Issue 格式

### 多 Phase 格式（推荐，`/feature-to-issues` 输出）

```markdown
## Background
（问题背景）

## Goals
1. 可量化目标

## Phase A: <标题>
### Task
（做什么，改哪些文件）
### DoD
- [ ] `shell command`   ← 必须是可执行命令

## Phase B: <标题>
...

## Constraints
（全局约束）

## Acceptance Gate
- [ ] `最终验收命令`
```

### 单任务格式（legacy，`.github/ISSUE_TEMPLATE/l0-task.md`）

```markdown
## Task
（任务描述）

## DoD
- [ ] `shell command`

## Constraints
（可选约束）
```

---

## 标签体系

| 标签 | 含义 | 操作者 |
|------|------|--------|
| `agent-run` | 就绪，等待 Loop 认领 | **人工添加** |
| `in-progress` | Loop 正在执行 | 自动 |
| `done` | DoD 通过，PR 已开 | 自动 |
| `needs-human` | DoD 失败 3 次，需人工介入 | 自动 |
| `blocked` | 被其他任务阻塞（预留） | 预留 |

---

## Loop 执行流程（`.claude/loop.md`）

```
Step 0  Reaper：检查 in-progress 超 30 分钟的 Issue，重置为 agent-run
Step 1  从队列取一个 agent-run Issue（--author yaleh 过滤）
Step 2  原子 claim：移除 agent-run，加 in-progress
Step 3  解析 Issue 格式（多 Phase / 单任务）
Step 4  创建 worktree（../archguard-T<N>），symlink node_modules 和 .agents
Step 5  按 Phase 顺序实现，每 Phase 完成后 comment "Phase X ✅"
Step 6  运行 DoD 命令（最多 3 次重试），全部通过后继续
Step 7  追加 docs/implemented/<slug>.md → commit → push → PR → 关闭 Issue
Step 8  失败路径：comment 失败信息，加 needs-human，不开 PR，不关闭
```

---

## 实现记录

执行成功后，Loop 自动追加到 `docs/implemented/<slug>.md`：

```
## <Issue 标题> ✅
Date: YYYY-MM-DD
Issue: #N
PR: <url>
```

该目录为只追加日志，不手动编辑。

---

## 相关文件

| 文件 | 用途 |
|------|------|
| `.claude/loop.md` | L0 Worker 执行规范（Loop 的 prompt） |
| `.claude/skills/feature-to-issues/SKILL.md` | 生成 Issue 的 skill |
| `.github/ISSUE_TEMPLATE/l0-task.md` | 手动创建单任务 Issue 的模板 |
| `scripts/setup-l0-labels.sh` | 创建所有必需 GitHub 标签（幂等） |
| `docs/implemented/` | 执行完成记录（只追加） |
| `docs/proposals/proposal-l0-agent-queue.md` | 设计提案 |
| `docs/plans/plan-121-122-l0-agent-queue.md` | 初始实现计划 |
