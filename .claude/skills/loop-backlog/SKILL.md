---
name: loop-backlog
description: "Autonomous L0 Worker for the backlog.md task queue. Polls for Ready tasks, implements phases, commits results, then self-reschedules via ScheduleWakeup. Invoke /loop-backlog once to start the worker loop; it keeps running until stopped."
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, ScheduleWakeup
---

## Role

This skill is the **L0 Worker** for the backlog.md task queue. It runs one
iteration of the worker loop, then calls ScheduleWakeup to schedule the next
iteration. Invoke `/loop-backlog` once — it self-schedules from there.

To stop the loop: call `CronDelete <id>` (find the id via `CronList`), or
simply let the current session close.

---

## Step 0: Reaper — recover stuck tasks

```bash
backlog task list --status "In Progress" --plain
```

For each `TASK-N` found: read its Implementation Notes via
`backlog task view TASK-N --plain` and look for a `claimed:` timestamp.

If the timestamp is more than 30 minutes ago, or no `claimed:` timestamp exists:
```bash
backlog task edit TASK-N --status "Ready" \
  --append-notes "Requeued by reaper: in-progress timeout exceeded 30 minutes."
```

## Step 1: Claim next task

```bash
TASK_ID=$(backlog task list --status "Ready" --plain | grep -oP 'TASK-\d+' | head -1)
```

If empty: set `QUEUE_EMPTY=true` and skip to **Scheduling** at the end of this
skill. Do not stop — ScheduleWakeup will check back later.

## Step 2: Atomic claim

Immediately claim before reading the body:

```bash
backlog task edit $TASK_ID --status "In Progress" \
  --append-notes "claimed: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

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
files to modify). Work in the current working directory.

Do not create branches, worktrees, or push to remote.
Follow all `## Constraints` in the Description.

If the Description has multiple `## Phase` sections, implement in order. After
each phase completes:
```bash
backlog task edit $TASK_ID \
  --append-notes "Phase <X> implemented: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

## Step 5: Verify DoD

Run each DoD command in index order. For each index N:

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

## Step 6: Commit

```bash
git add -A
git commit -m "${TITLE} (${TASK_ID})"
COMMIT_HASH=$(git rev-parse HEAD)
```

## Step 7: Done

```bash
backlog task edit $TASK_ID \
  --status "Done" \
  --append-notes "Completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --final-summary "commit: ${COMMIT_HASH}"

backlog task archive $TASK_ID
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
```

Set `WORK_DONE=true`.

## Step 8: Failure path

```bash
backlog task edit $TASK_ID \
  --status "Needs Human" \
  --append-notes "$(printf 'L0 stuck after 3 consecutive failures on DoD #%s:\n\n```\n%s\n```\n\nLast error:\n%s' \
    "$STUCK_INDEX" "$STUCK_CMD" "$LAST_ERROR")"
```

Do NOT commit. Do NOT archive.

Print:
```
❌ Stuck: $TASK_ID (DoD #$STUCK_INDEX)
Task moved to "Needs Human". Manual intervention required.
```

Set `WORK_DONE=false`.

---

## Scheduling

**This is the last action of every invocation.** Always call ScheduleWakeup —
do not skip it, even when the queue is empty.

Choose `delaySeconds` based on what happened this iteration:

| Outcome | delaySeconds | reason |
|---------|-------------|--------|
| Work done (Step 7) | 120 | task completed, check for next item soon |
| Stuck → Needs Human (Step 8) | 270 | escalated, poll at normal cadence |
| Queue empty (Step 1) | 270 | nothing to do, stay within cache window |

Call ScheduleWakeup now:

```
ScheduleWakeup(
  delaySeconds = <from table above>,
  reason = "<one sentence: what happened this iteration>",
  prompt = "/loop-backlog"
)
```