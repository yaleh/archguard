---
name: loop-backlog
description: "Autonomous L0 Worker for the backlog.md task queue. Each task runs in an isolated git worktree, then merges back to master on success. Polls for Ready tasks, implements phases, commits results, then self-reschedules via ScheduleWakeup. Invoke /loop-backlog once to start the worker loop; it keeps running until stopped."
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, ScheduleWakeup
---

## Role

This skill is the **L0 Worker** for the backlog.md task queue. It runs one
iteration of the worker loop, then calls ScheduleWakeup to schedule the next
iteration. Invoke `/loop-backlog` once — it self-schedules from there.

Each task executes in an isolated git worktree (`../archguard-TASK-N`), keeping
the master working directory clean. On success the worktree branch is merged
back to master with `--no-ff`.

To stop the loop: simply let the current session close (ScheduleWakeup wakeups
are session-scoped).

---

## Step 0: Reaper — recover stuck tasks

```bash
backlog task list --status "In Progress" --plain
```

For each `TASK-N` found: read its Implementation Notes via
`backlog task view TASK-N --plain` and look for a `claimed:` timestamp.

If the timestamp is more than 30 minutes ago, or no `claimed:` timestamp exists:
```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
backlog task edit TASK-N --status "Ready" \
  --append-notes "Requeued by reaper: in-progress timeout exceeded 30 minutes."

# Clean up any leftover worktree for this task
WORKTREE="${REPO_ROOT}/../archguard-TASK-N"
if [ -d "$WORKTREE" ]; then
  git worktree remove "$WORKTREE" --force 2>/dev/null || true
  git branch -D "task/TASK-N" 2>/dev/null || true
fi
```

## Step 1: Claim next task

```bash
TASK_ID=$(backlog task list --status "Ready" --plain | grep -oP 'TASK-\d+' | head -1)
```

If empty: set `QUEUE_EMPTY=true` and skip to **Scheduling** at the end of this
skill. Do not stop — ScheduleWakeup will check back later.

## Step 2: Atomic claim + create worktree

Immediately claim before reading the body, then create an isolated worktree:

```bash
backlog task edit $TASK_ID --status "In Progress" \
  --append-notes "claimed: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

REPO_ROOT=$(git rev-parse --show-toplevel)
BRANCH="task/${TASK_ID}"
WORKTREE="${REPO_ROOT}/../archguard-${TASK_ID}"

git worktree add "$WORKTREE" -b "$BRANCH"
ln -sf "${REPO_ROOT}/node_modules" "${WORKTREE}/node_modules"

cd "$WORKTREE"
```

All file modifications in Steps 3–6 happen inside `$WORKTREE`. The master
working directory remains untouched during task execution.

## Step 3: Read task

```bash
TASK_VIEW=$(backlog task view $TASK_ID --plain)
```

Extract:
- **Title**: line matching `^Task TASK-\d+ - `
  ```bash
  TITLE=$(echo "$TASK_VIEW" | grep -oP '(?<=Task TASK-\d+ - ).+' | head -1)
  ```
- **Description**: content between `Description:` and the next `----------` line
  — contains the plan markdown with `## Phase` / `### Task` / `### DoD`
- **DoD count**:
  ```bash
  DOD_COUNT=$(echo "$TASK_VIEW" | grep -cP '^\- \[.\] #\d+')
  ```
- **DoD command at index N**:
  ```bash
  CMD=$(echo "$TASK_VIEW" | grep -P "^\- \[.\] #${N} " | sed "s/^- \[.\] #${N} //")
  ```

## Step 4: Implement

Read the Description to understand what to implement (Phase structure, which
files to modify). Work inside `$WORKTREE`.

Do not create additional branches or push to remote.
Follow all `## Constraints` in the Description.

If the Description has multiple `## Phase` sections, implement in order. After
each phase completes:
```bash
backlog task edit $TASK_ID \
  --append-notes "Phase <X> implemented: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

## Step 5: Verify DoD

Run each DoD command in index order from inside `$WORKTREE`. For each index N:

```bash
CMD=$(echo "$TASK_VIEW" | grep -P "^\- \[.\] #${N} " | sed "s/^- \[.\] #${N} //")
eval "$CMD"
```

**On success (exit 0)**:
```bash
backlog task edit $TASK_ID --check-dod $N
```

**On failure**: fix the code and retry. Convergence rule: if the same command
fails 3 consecutive times with no meaningful code change between attempts,
treat as stuck → go to **Step 8**.

After all DoD pass → Step 6.

## Step 6: Commit (inside worktree)

```bash
# Still inside $WORKTREE
git add -A
git commit -m "${TITLE} (${TASK_ID})"
COMMIT_HASH=$(git rev-parse HEAD)
```

## Step 7: Done — merge back to master, clean up worktree

```bash
backlog task edit $TASK_ID \
  --status "Done" \
  --append-notes "Completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --final-summary "commit: ${COMMIT_HASH}"
```

Append to implementation log:
```bash
SLUG=$(echo "$TITLE" | tr '[:upper:] ' '[:lower:]-' | tr -cd '[:alnum:]-' | cut -c1-60)
mkdir -p docs/implemented
printf "\n## %s ✅\nDate: %s\nTask: %s\nCommit: %s\n" \
  "$TITLE" "$(date +%Y-%m-%d)" "$TASK_ID" "$COMMIT_HASH" \
  >> "docs/implemented/${SLUG}.md"
git add "docs/implemented/${SLUG}.md"
git commit --amend --no-edit
COMMIT_HASH=$(git rev-parse HEAD)
```

Merge worktree branch back to master:
```bash
cd "$REPO_ROOT"

if git merge --no-ff "$BRANCH" -m "merge: ${TITLE} (${TASK_ID})"; then
  git worktree remove "$WORKTREE"
  git branch -d "$BRANCH"
else
  # Merge conflict — preserve worktree for human inspection
  backlog task edit $TASK_ID \
    --status "Needs Human" \
    --append-notes "$(printf 'Merge conflict merging %s into master.\n\nResolve manually:\n  cd %s\n  git mergetool\n  git commit\n  git worktree remove %s\n  git branch -d %s' \
      "$BRANCH" "$REPO_ROOT" "$WORKTREE" "$BRANCH")"
  echo "⚠️  Merge conflict: $TASK_ID — worktree preserved at $WORKTREE"
  # Do not set WORK_DONE=true; fall through to Scheduling with 270s delay
  WORK_DONE=false
fi
```

Set `WORK_DONE=true` (only if merge succeeded).

## Step 8: Failure path

```bash
# Return to repo root before cleanup decisions
cd "$REPO_ROOT"

backlog task edit $TASK_ID \
  --status "Needs Human" \
  --append-notes "$(printf 'L0 stuck after 3 consecutive failures on DoD #%s:\n\n```\n%s\n```\n\nLast error:\n%s\n\nWorktree preserved at: %s\nBranch: %s\nClean up: git worktree remove %s --force && git branch -D %s' \
    "$STUCK_INDEX" "$STUCK_CMD" "$LAST_ERROR" "$WORKTREE" "$BRANCH" "$WORKTREE" "$BRANCH")"
```

Do NOT commit. Do NOT merge. Do NOT archive. Worktree is preserved for inspection.

Print:
```
❌ Stuck: $TASK_ID (DoD #$STUCK_INDEX)
Task moved to "Needs Human". Worktree preserved at $WORKTREE
Manual intervention required.
```

Set `WORK_DONE=false`.

---

## Scheduling

**This is the last action of every invocation.** Always call ScheduleWakeup —
do not skip it, even when the queue is empty.

Choose `delaySeconds` based on what happened this iteration:

| Outcome | delaySeconds | reason |
|---------|-------------|--------|
| Work done — merge succeeded (Step 7) | 120 | task completed, check for next item soon |
| Stuck → Needs Human (Step 8) | 270 | escalated, poll at normal cadence |
| Merge conflict → Needs Human (Step 7) | 270 | escalated, poll at normal cadence |
| Queue empty (Step 1) | 270 | nothing to do, stay within cache window |

Call ScheduleWakeup now:

```
ScheduleWakeup(
  delaySeconds = <from table above>,
  reason = "<one sentence: what happened this iteration>",
  prompt = "/loop-backlog"
)
```
