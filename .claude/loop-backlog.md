# ArchGuard L0 Worker (backlog.md)

Poll the backlog task queue for pending development tasks. Work autonomously.
Do not ask for clarification. Do not create branches or open PRs unless
explicitly requested.

## Step 0: Reaper — recover stuck tasks

List tasks currently in progress:

```bash
backlog task list --status "In Progress" --plain
```

For each `TASK-N` found: read its Implementation Notes and look for a
`claimed:` timestamp. If the timestamp is more than 30 minutes ago:

```bash
backlog task edit TASK-N --status "Ready" \
  --append-notes "Requeued by reaper: in-progress timeout exceeded 30 minutes."
```

If no `claimed:` timestamp is present in the notes, treat it as stale and
also reset to Ready.

## Step 1: Claim next task

```bash
backlog task list --status "Ready" --plain
```

Parse the first `TASK-N` from the output with:
```bash
TASK_ID=$(backlog task list --status "Ready" --plain | grep -oP 'TASK-\d+' | head -1)
```

If no task found: print "Queue empty." and stop.

## Step 2: Atomic claim

Immediately claim the task before reading its body:

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
- **Description**: content between `Description:` and the next `---` separator —
  contains the plan markdown with `## Phase` sections and `### Task` / `### DoD`
- **DoD count**: `echo "$TASK_VIEW" | grep -cP '^\- \[.\] #\d+'`
- **DoD command at index N**:
  `echo "$TASK_VIEW" | grep -P "^\- \[.\] #${N} " | sed "s/^- \[.\] #${N} //"`

## Step 4: Implement

Read the Description section to understand what to implement (Phase structure,
which files to modify). Work directly in the current working directory.

Do not create branches. Do not create git worktrees. Do not modify files
outside the project root.

Follow all `## Constraints` found in the Description.

If the Description contains multiple `## Phase` sections, implement them in
order. After completing each phase, append a progress note:

```bash
backlog task edit $TASK_ID --append-notes "Phase <X> implemented: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

## Step 5: Verify DoD

Run each DoD command in index order. For each command at index N:

```bash
CMD=$(echo "$TASK_VIEW" | grep -P "^\- \[.\] #${N} " | sed "s/^- \[.\] #${N} //")
eval "$CMD"
```

**On success (exit 0)**:
```bash
backlog task edit $TASK_ID --check-dod $N
```

**On failure**: fix the code and retry. Convergence rule:
- Retry after each fix (no hard iteration cap)
- If the same DoD command fails 3 times in a row with no meaningful progress
  (same error, no relevant code change), treat it as stuck → go to Step 8

After all DoD items pass, proceed to Step 6.

## Step 6: Commit

```bash
TITLE=$(echo "$TASK_VIEW" | grep -oP '(?<=Task TASK-\d+ - ).+' | head -1)
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

Print:
```
✅ Done: $TASK_ID
Commit: $COMMIT_HASH
```

## Step 8: Failure path

```bash
backlog task edit $TASK_ID \
  --status "Needs Human" \
  --append-notes "$(printf 'L0 stuck after 3 consecutive failures on DoD #%s:\n\n```\n%s\n```\n\nLast error:\n%s' "$STUCK_INDEX" "$STUCK_CMD" "$LAST_ERROR")"
```

Do NOT commit. Do NOT archive the task.

Print:
```
❌ Stuck: $TASK_ID (DoD #$STUCK_INDEX)
Task moved to "Needs Human". Manual intervention required.
```
