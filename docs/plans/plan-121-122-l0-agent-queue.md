# Plan 121–122 — L0 Agent Queue（`.claude/loop.md` + Issue 模板 + 端到端验证）

> Proposal: `docs/proposals/proposal-l0-agent-queue.md`
> Status: **DRAFT**
> 前置依赖: 无（纯配置文件，不依赖任何代码变更）
> 涉及文件:
>   - `.claude/loop.md`（新建）
>   - `.github/ISSUE_TEMPLATE/l0-task.md`（新建）
>   - `scripts/setup-l0-labels.sh`（新建，辅助脚本）

---

## 总览

| Phase | 内容 | 依赖 | 预计改动量 |
|---|---|---|---|
| 121 | 创建 loop.md、Issue 模板、label 设置脚本 | 无 | ~150 行（配置文件） |
| 122 | 端到端验证：使用真实 plan phase 走完完整 loop 流程 | Phase 121 完成 | 0 行（验证，无代码变更） |

**测试策略**：Phase 121 不需要单元测试（配置文件，无逻辑）。Phase 122 是集成验证：手动运行 `/loop 5m` 并跟踪 Issue 状态流转。

**各 Phase 关系**：Phase 122 依赖 Phase 121，必须顺序执行。

---

## Phase 121 — 创建配置文件

### 目标

创建 L0 Agent Queue 所需的三个配置文件：
1. `.claude/loop.md` — L0 worker prompt，loop 的执行指令
2. `.github/ISSUE_TEMPLATE/l0-task.md` — GitHub Issue 模板（含 YAML front matter）
3. `scripts/setup-l0-labels.sh` — 一次性 label 创建脚本

### Stage 121-A：创建 `.claude/` 目录结构并写 `loop.md`

**前置检查**：

```bash
ls .claude/ 2>/dev/null || echo ".claude/ does not exist"
gh auth status
```

如果 `.claude/` 不存在，创建目录。

**文件内容** (`.claude/loop.md`)：

```markdown
# ArchGuard L0 Worker

Poll the GitHub Issue queue for pending development tasks. Work autonomously. Do not ask for clarification.

## Step 0: Reaper — recover stuck tasks

gh issue list --label "in-progress" --state open --json number,updatedAt --limit 10

For each result: if updatedAt is more than 30 minutes ago:
  gh issue edit <number> --remove-label "in-progress" --add-label "agent-run"
  gh issue comment <number> --body "Requeued by L0 reaper: in-progress timeout exceeded 30 minutes."

## Step 1: Claim next task

gh issue list --label "agent-run" --state open \
  --author yaleh \
  --json number,title,body --limit 1

If no results: print "Queue empty." and stop.

## Step 2: Atomic claim

gh issue edit <number> --remove-label "agent-run" --add-label "in-progress"

(Do this immediately. Do not read the issue body first. This minimises the window in which
two sessions could claim the same issue.)

## Step 3: Read and parse

Read the full issue body. Extract:
- The task description
- The `## DoD` section (list of shell commands)
- The `## Constraints` section if present

## Step 4: Prepare worktree

git worktree add ../archguard-T<number> -b task/T<number>
cd ../archguard-T<number>
npm ci --silent --prefer-offline

Work exclusively inside this worktree. Do not modify the main working tree.

(Note: `--prefer-offline` reuses cached packages from `~/.npm`; a full download still occurs
if the cache is empty. The worktree shares git objects with the main tree but has its own
`node_modules` directory.)

## Step 5: Implement

Implement the task described in Step 3. Follow all constraints. Do not introduce changes
outside the scope described.

## Step 6: Verify DoD

Run each command from the `## DoD` section. Commands must exit 0.

If all pass → proceed to Step 7.
If any fail → fix and retry (maximum 3 attempts). If still failing after 3 attempts → proceed to Step 8.

## Step 7: Success path

git add -A && git commit -m "<task title> (closes #<number>)"
gh pr create --title "<task title>" --body "Closes #<number>." --label "ready-for-review"

# Run from inside the worktree (../archguard-T<number>) where the branch is checked out:
PR_URL=$(gh pr view --json url -q .url)

# Update issue state before removing worktree (update is idempotent; removal might fail)
gh issue comment <number> --body "PR opened: ${PR_URL}"
gh issue edit <number> --remove-label "in-progress" --add-label "done"
gh issue close <number>

# Remove worktree last; if this fails, run `git worktree prune` manually
cd /home/yale/work/archguard
git worktree remove ../archguard-T<number>

## Step 8: Failure path

gh issue comment <number> --body "L0 failed after 3 attempts. Last DoD failure:

\`\`\`
<paste the exact failing command and its output>
\`\`\`

Escalating to human."

gh issue edit <number> --remove-label "in-progress" --add-label "needs-human"

Do NOT open a PR. Do NOT close the issue.

cd /home/yale/work/archguard
git worktree remove ../archguard-T<number> --force
```

**验收**：`cat .claude/loop.md` 输出完整 8 步内容，包含 Step 0（reaper）和 `--author yaleh` 过滤。

### Stage 121-B：创建 GitHub Issue 模板

**文件路径**：`.github/ISSUE_TEMPLATE/l0-task.md`

**前置检查**：

```bash
ls .github/ISSUE_TEMPLATE/ 2>/dev/null || echo "dir does not exist"
```

如果 `.github/ISSUE_TEMPLATE/` 不存在，创建目录。

**文件内容**：

```markdown
---
name: L0 Agent Task
about: Queue an atomic plan phase for autonomous L0 execution
title: "[L0] "
labels: ""
assignees: ""
---

## Task

<!-- One-paragraph description of the specific work. Reference the plan file and phase. -->


See: `docs/plans/<plan-file>.md` § Phase <N>.

## DoD

<!-- Exact shell commands. The L0 loop runs these in order; all must exit 0. -->
- [ ] `npm run type-check`
- [ ] `npm test -- --reporter=verbose 2>&1 | tail -5`

## Constraints

<!-- Optional: anything the agent must not do. Leave empty if no constraints. -->
```

**验收**：
```bash
cat .github/ISSUE_TEMPLATE/l0-task.md | grep -E "^name:|^about:|^labels:"
# Expected output:
# name: L0 Agent Task
# about: Queue an atomic plan phase for autonomous L0 execution
# labels: ""
```

### Stage 121-C：创建 label 设置脚本

**文件路径**：`scripts/setup-l0-labels.sh`

**文件内容**：

```bash
#!/usr/bin/env bash
# One-time script to create GitHub labels for the L0 Agent Queue.
# Safe to re-run: gh label create is idempotent with --force.
set -euo pipefail

REPO="yaleh/archguard"

gh label create "agent-run"    --repo "$REPO" --color "0075ca" --description "L0: task ready for autonomous execution" --force
gh label create "in-progress"  --repo "$REPO" --color "e4e669" --description "L0: task currently being executed"      --force
gh label create "needs-human"  --repo "$REPO" --color "d73a4a" --description "L0: task failed DoD after 3 retries"   --force
gh label create "done"         --repo "$REPO" --color "0e8a16" --description "L0: task completed, PR opened"          --force

echo "Labels created successfully."
```

**验收**：`bash scripts/setup-l0-labels.sh` 运行无错误（需要 `gh auth status` 已通过）。

### Phase 121 DoD

```bash
# 1. 三个文件都存在
test -f .claude/loop.md && echo "loop.md OK"
test -f .github/ISSUE_TEMPLATE/l0-task.md && echo "template OK"
test -f scripts/setup-l0-labels.sh && echo "label script OK"

# 2. loop.md 包含必要的安全过滤
grep -q -- "--author yaleh" .claude/loop.md && echo "author filter OK"

# 3. Issue 模板包含 YAML front matter
grep -q "^name: L0 Agent Task" .github/ISSUE_TEMPLATE/l0-task.md && echo "front matter OK"

# 4. label 脚本可执行（语法检查）
bash -n scripts/setup-l0-labels.sh && echo "label script syntax OK"
```

---

## Phase 122 — 端到端验证

### 目标

使用一个真实的 plan phase 走完完整的 L0 loop 流程，验证所有 Acceptance Criteria。

选择任务：**plan-96-100 Phase 97**（`progress.ts` 文件移动 + 6 处 import 更新）。此任务：
- 边界清晰（纯文件移动，无逻辑变更）
- DoD 可用 shell 命令验证
- 对 master 分支无破坏性影响（改动被隔离在 worktree branch）

### Stage 122-A：准备环境

```bash
# 1. 确认 GitHub labels 已创建
gh label list --repo yaleh/archguard | grep -E "agent-run|in-progress|needs-human|done"

# 2. 确认 gh auth
gh auth status

# 3. 确认无遗留 worktree
git worktree list
```

### Stage 122-B：创建测试 Issue

在 GitHub 上手动创建 Issue（使用 `l0-task.md` 模板），或使用 CLI：

```bash
gh issue create \
  --title "[L0] plan-96 Phase 97: move progress.ts → src/cli/progress/index.ts" \
  --body "## Task

Implement plan-96 Phase 97: move \`progress.ts\` to \`src/cli/progress/index.ts\`
and update all 6 import paths.

See: \`docs/plans/plan-96-100-architecture-cleanup.md\` § Phase 97.

## DoD

- [ ] \`npm run type-check\`
- [ ] \`npm test 2>&1 | tail -3\`
- [ ] \`test -f src/cli/progress/index.ts && echo moved\`

## Constraints

- Do not rename public exports; only move the file.
- Do not create new tests; this is a pure file move." \
  --label "agent-run"
```

### Stage 122-C：运行 loop 并观察状态流转

```bash
# 在 tmux 里运行，保持 session 开启
/loop 5m
```

**预期观察顺序**：

| 时间 | Issue 状态 | loop 动作 |
|------|-----------|-----------|
| T+0 | `agent-run` | loop 领取 Issue，切换到 `in-progress` |
| T+1~5 | `in-progress` | 创建 worktree，实现 Phase 97，验证 DoD |
| T+5~6 | `done` (closed) | 开 PR，Issue 关闭，worktree 删除 |

### Stage 122-D：验收检查清单

```bash
# 1. Issue 已关闭且带有 'done' label
gh issue view <number> --json state,labels | jq '{state: .state, labels: [.labels[].name]}'
# 期望: {"state": "closed", "labels": ["done"]}

# 2. PR 已开启
gh pr list --label "ready-for-review" --json number,title | head -5

# 3. 无残留 worktree
git worktree list
# 期望: 只有主 worktree

# 4. Issue 有 L0 worker 的注释（PR URL）
gh issue view <number> --comments | grep "PR opened:"
```

### Stage 122-E：Reaper 验证（必须，对应 AC#5）

Reaper 验证是 Proposal Acceptance Criteria #5 的强制要求，不可跳过。

```bash
# Step 1: 创建一个 in-progress 状态的测试 Issue（模拟 crashed task）
REAPER_NUM=$(gh issue create \
  --title "[L0-reaper-test] stuck task" \
  --body "## Task
Reaper test — intentionally stuck.

## DoD
- [ ] \`true\`

## Constraints
- Do not implement. This Issue is for reaper testing only." \
  --label "in-progress" \
  --json number -q .number)
echo "Created stuck issue #${REAPER_NUM}"

# Step 2: 确认 issue 处于 in-progress 状态
gh issue view "${REAPER_NUM}" --json labels -q '[.labels[].name]'
# 期望: ["in-progress"]
```

由于 `gh` API 不允许直接修改 `updatedAt`，使用以下方法绕过 30 分钟等待：

**验证方式 A（快速，白盒）**：直接检查 loop.md Step 0 的逻辑正确性：

```bash
# 确认 Step 0 包含正确的 reaper 逻辑
grep -A 5 "Step 0" .claude/loop.md | grep -q "in-progress" && echo "reaper step present OK"
grep -q "30 minutes" .claude/loop.md && echo "30-min threshold present OK"
grep -q -- "--add-label \"agent-run\"" .claude/loop.md && echo "requeue logic present OK"
grep -q "Requeued by L0 reaper" .claude/loop.md && echo "reaper comment template present OK"
```

**验证方式 B（端到端，黑盒，需等待 30 分钟）**：
```bash
# 等待 30 分钟后在新 session 启动 loop，观察 Step 0 输出：
# /loop 5m
# 预期 Step 0 输出：将 issue #${REAPER_NUM} 从 in-progress → agent-run，并添加注释。
# 验证：
gh issue view "${REAPER_NUM}" --json labels -q '[.labels[].name]'
# 期望: ["agent-run"]
gh issue view "${REAPER_NUM}" --comments | grep "Requeued by L0 reaper"
```

**清理**（不论选 A 或 B）：
```bash
# 关闭测试 issue，避免污染队列
gh issue close "${REAPER_NUM}" --comment "Reaper test complete. Closing."
```

### Stage 122-F：Failure Path 验证（必须，对应 AC#6）

Proposal Acceptance Criteria #6 要求验证 Step 8 的失败路径：注释含精确失败命令输出，标签切换为 `needs-human`，不开 PR，不关闭 Issue。

```bash
# Step 1: 创建一个 DoD 必然失败的 Issue
FAIL_NUM=$(gh issue create \
  --title "[L0-fail-test] intentionally failing DoD" \
  --body "## Task
Failure path test — DoD will always fail.

## DoD
- [ ] \`exit 99\`

## Constraints
- Do not fix the DoD. This Issue is for failure-path testing only." \
  --label "agent-run" \
  --json number -q .number)
echo "Created fail-test issue #${FAIL_NUM}"
```

```bash
# Step 2: 启动 loop（或手动执行 Step 1–8 逻辑）
# /loop 5m
# Loop 将领取此 Issue，执行 3 次 `exit 99`，进入 Step 8。
```

```bash
# Step 3: 验证 Step 8 行为
# a. Issue 标签为 needs-human（不是 done，不是 in-progress）
gh issue view "${FAIL_NUM}" --json state,labels | \
  jq '{state: .state, labels: [.labels[].name]}'
# 期望: {"state": "OPEN", "labels": ["needs-human"]}

# b. Issue 有包含失败命令输出的注释
gh issue view "${FAIL_NUM}" --comments | grep -q "L0 failed after 3 attempts" && \
  echo "failure comment OK"

# c. 无以此 Issue 为来源的 PR
gh pr list --json title | jq '.[].title' | grep -q "fail-test" && \
  echo "ERROR: PR should not have been opened" || echo "no spurious PR OK"

# d. 无残留 worktree
git worktree list | grep -v "^/home/yale/work/archguard " && \
  echo "ERROR: orphaned worktree found" || echo "no orphaned worktrees OK"
```

```bash
# 清理
gh issue close "${FAIL_NUM}" --comment "Failure path test complete. Closing."
```

### Phase 122 DoD

```bash
# E2E 验证通过的标志（AC#4）：
# 1. 主测试 Issue 已关闭
gh issue view <number> --json state -q .state | grep -q "CLOSED" && echo "issue closed OK"

# 2. PR 存在且源分支为 task/T<number>（AC#7）
gh pr list --json headRefName | jq '.[].headRefName' | grep -q "task/T" && echo "PR branch OK"

# 3. 无残留 worktree（AC#7）
WORKTREES=$(git worktree list | wc -l)
test "$WORKTREES" -eq 1 && echo "no orphaned worktrees OK"

# 4. Reaper 白盒验证通过（AC#5）
grep -q "Requeued by L0 reaper" .claude/loop.md && echo "reaper logic OK"

# 5. Failure path 测试 Issue 为 needs-human 状态（AC#6）
gh issue view "${FAIL_NUM}" --json state,labels | \
  jq -e '.state == "OPEN" and ([.labels[].name] | contains(["needs-human"]))' && \
  echo "failure path OK"
```

---

## 文件清单

| 文件 | 操作 | Phase |
|------|------|-------|
| `.claude/loop.md` | 新建 | 121-A |
| `.github/ISSUE_TEMPLATE/l0-task.md` | 新建 | 121-B |
| `scripts/setup-l0-labels.sh` | 新建 | 121-C |

Phase 122 不产生代码变更（验证过程）；Phase 97 的代码变更在其自己的 PR 中。

---

## 注意事项

**Open Question Q3 预案**：如果 `gh pr create` 在 worktree 内报"no remote"错误，在 loop.md 的 Step 7 中为 `gh pr create` 加 `--repo yaleh/archguard` 参数并重新提交 loop.md。

**`npm ci` 耗时**：首次运行时 `~/.npm` 缓存为空，`npm ci` 可能需要 60–90 秒。后续 worktree 从缓存安装约 15–30 秒。在 Phase 122 验证时注意观察此耗时。

**`/loop` 50-task cap**：Phase 122 单次验证只消耗 1 个 tick（1/50），无需担心上限。
