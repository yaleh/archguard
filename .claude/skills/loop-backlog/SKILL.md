---
name: loop-backlog
description: "Autonomous L0 Worker for the backlog.md task queue. Each task runs in an isolated git worktree, then merges back to master on success. Polls for Ready tasks, executes by description, commits if changes exist, then self-reschedules via ScheduleWakeup. Invoke /loop-backlog once to start the worker loop; it keeps running until stopped."
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, ScheduleWakeup
---

λ() → workerLoop()

## Spec

data Outcome = Done CommitHash | NeedsHuman Reason | Idle

workerLoop :: () → Outcome
workerLoop() = {
  _:      reap(inProgressTasks()),
  task:   claim(),

  if (empty(task)):
    return: schedule(270, "queue empty") >> Idle,

  result: withWorktree(task, execute),
  _:      schedule(delayFor(result), summarise(task, result)),
  return: result
}

reap :: [Task] → ()
reap(tasks) = ∀t ∈ tasks
  where claimAge(t) > 30min ∨ ¬hasClaimed(t): {
    reset(t, "Ready"),
    appendNote(t, "Requeued by reaper: in-progress timeout."),
    removeWorktree(t)
  }

claim :: () → Maybe Task
claim() = {
  t: head(readyTasks()),
  if (empty(t)): return Nothing,
  atomically: {
    setStatus(t, "In Progress"),
    appendNote(t, "claimed: " + now())
  },
  return: Just(t)
}

withWorktree :: Task → (Task → a) → a
withWorktree(T, f) = {
  wt: createWorktree(T),
  cd: wt,
  return: f(T)
}

-- execute is task-type-agnostic: T.description is the sole authority on what to do
execute :: Task → Outcome
execute(T) = {
  _:      followDescription(T.description),
  _:      ∀(n, cmd) ∈ enumerate(T.dodCommands): verifyDod(T, n, cmd),
  hash:   conditionalCommit(T),
  return: merge(T, hash)
}

verifyDod :: (Task, Int, ShellCmd) → ()
verifyDod(T, n, cmd) =
  | eval(cmd).exitCode == 0 → checkDod(T, n)
  | attempts(n) < 3         → fix(); verifyDod(T, n, cmd)
  | otherwise               → raise Stuck(n, cmd)

conditionalCommit :: Task → Maybe CommitHash
conditionalCommit(T) =
  | hasChanges() → git add -A; commit(T); return Just(HEAD)
  | otherwise    → return Nothing

merge :: (Task, Maybe CommitHash) → Outcome
merge(T, hash) =
  | mergeNoFF(T.branch) succeeds → markDone(T, hash); removeWorktree(T); Done(hash)
  | otherwise                    → markNeedsHuman(T, "merge conflict"); NeedsHuman("merge conflict")

delayFor :: Outcome → Seconds
delayFor(Done _)       = 120
delayFor(NeedsHuman _) = 270
delayFor(Idle)         = 270

## Implementation

### reap

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
backlog task list --status "In Progress" --plain \
  | grep -oP 'TASK-\d+' \
  | while read TASK_ID; do
    VIEW=$(backlog task view "$TASK_ID" --plain)
    CLAIMED=$(echo "$VIEW" | grep -oP '(?<=claimed: )\S+' | tail -1)
    AGE=9999
    if [ -n "$CLAIMED" ]; then
      AGE=$(( $(date -u +%s) - $(date -u -d "$CLAIMED" +%s 2>/dev/null || echo 0) ))
    fi
    if [ $AGE -gt 1800 ]; then
      backlog task edit "$TASK_ID" --status "Ready" \
        --append-notes "Requeued by reaper: in-progress timeout exceeded 30 minutes."
      WORKTREE="${REPO_ROOT}/../archguard-${TASK_ID}"
      [ -d "$WORKTREE" ] && git worktree remove "$WORKTREE" --force 2>/dev/null || true
      git branch -D "task/${TASK_ID}" 2>/dev/null || true
    fi
  done
```

### claim

```bash
TASK_ID=$(backlog task list --status "Ready" --plain | grep -oP 'TASK-\d+' | head -1)
```

If empty: set `QUEUE_EMPTY=true` and skip to **Scheduling**.

```bash
backlog task edit "$TASK_ID" --status "In Progress" \
  --append-notes "claimed: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

### withWorktree

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
BRANCH="task/${TASK_ID}"
WORKTREE="${REPO_ROOT}/../archguard-${TASK_ID}"
git worktree add "$WORKTREE" -b "$BRANCH"
ln -sf "${REPO_ROOT}/node_modules" "${WORKTREE}/node_modules"
cd "$WORKTREE"
```

### execute → followDescription

```bash
TASK_VIEW=$(backlog task view "$TASK_ID" --plain)
TITLE=$(echo "$TASK_VIEW" | grep -oP '(?<=Task TASK-\d+ - ).+' | head -1)
```

Read the task Description in full. The Description is the sole authority on what to
do — it may call for code changes, documentation, experiments, or analysis. Follow its
`## Phase` sections in order. After each phase completes:

```bash
backlog task edit "$TASK_ID" \
  --append-notes "Phase <X> completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

Do not invent steps beyond what the Description specifies. Do not assume a task type.

### verifyDod

```bash
DOD_COUNT=$(echo "$TASK_VIEW" | grep -cP '^\- \[.\] #\d+')

for N in $(seq 0 $((DOD_COUNT - 1))); do
  CMD=$(echo "$TASK_VIEW" | grep -P "^\- \[.\] #${N} " | sed "s/^- \[.\] #${N} //")
  ATTEMPTS=0
  while true; do
    if eval "$CMD"; then
      backlog task edit "$TASK_ID" --check-dod $N
      break
    fi
    ATTEMPTS=$((ATTEMPTS + 1))
    if [ $ATTEMPTS -ge 3 ]; then
      STUCK_INDEX=$N
      STUCK_CMD="$CMD"
      LAST_ERROR="$(eval "$CMD" 2>&1 || true)"
      # → Failure path below
      break 2
    fi
    # Fix the issue causing the failure, then retry
  done
done
```

### conditionalCommit

```bash
git add -A
if ! git diff --cached --quiet; then
  git commit -m "${TITLE} (${TASK_ID})"
  COMMIT_HASH=$(git rev-parse HEAD)
else
  COMMIT_HASH="(no file changes)"
fi
```

### merge

```bash
cd "$REPO_ROOT"
if git merge --no-ff "$BRANCH" -m "merge: ${TITLE} (${TASK_ID})"; then
  backlog task edit "$TASK_ID" \
    --status "Done" \
    --append-notes "Completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --final-summary "commit: ${COMMIT_HASH}"
  git worktree remove "$WORKTREE"
  git branch -d "$BRANCH"
  WORK_DONE=true
else
  backlog task edit "$TASK_ID" \
    --status "Needs Human" \
    --append-notes "$(printf 'Merge conflict merging %s into master.\n\nResolve manually:\n  cd %s\n  git mergetool\n  git commit\n  git worktree remove %s\n  git branch -d %s' \
      "$BRANCH" "$REPO_ROOT" "$WORKTREE" "$BRANCH")"
  echo "⚠️  Merge conflict: $TASK_ID — worktree preserved at $WORKTREE"
  WORK_DONE=false
fi
```

### Failure path (Stuck)

```bash
cd "$REPO_ROOT"
backlog task edit "$TASK_ID" \
  --status "Needs Human" \
  --append-notes "$(printf 'L0 stuck after 3 consecutive failures on DoD #%s:\n\n```\n%s\n```\n\nLast error:\n%s\n\nWorktree preserved at: %s\nBranch: %s\nClean up: git worktree remove %s --force && git branch -D %s' \
    "$STUCK_INDEX" "$STUCK_CMD" "$LAST_ERROR" "$WORKTREE" "$BRANCH" "$WORKTREE" "$BRANCH")"
echo "❌ Stuck: $TASK_ID (DoD #$STUCK_INDEX)"
echo "Task moved to Needs Human. Worktree preserved at $WORKTREE"
WORK_DONE=false
```

## Scheduling

Always the last action of every invocation. Never skip.

| Outcome        | delaySeconds | reason                                   |
|----------------|-------------|------------------------------------------|
| Done           | 120         | task completed, check for next item      |
| NeedsHuman     | 270         | escalated, poll at normal cadence        |
| Idle           | 270         | queue empty, stay within cache window    |

```
ScheduleWakeup(
  delaySeconds = <from table>,
  reason       = "<one sentence: what happened this iteration>",
  prompt       = "/loop-backlog"
)
```
