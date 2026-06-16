# Autonomous Task Queue

This project uses a backlog-driven autonomous execution system built on three
Claude Code skills. Tasks are created, reviewed, and queued by humans; the
L0 worker picks them up and executes them automatically.

```
/feature-to-backlog  ─┐
/task-to-backlog     ─┼──▶  Backlog  ──▶  Ready  ──▶  /loop-backlog (L0 worker)
  (manual create)   ─┘
```

---

## Quick Start

### 1. One-time setup

```bash
/backlog-setup
```

Creates the required Kanban columns. Safe to run multiple times.

### 2. Create a task

**For feature development** (generates TDD plan with proposal + plan docs):

```bash
/feature-to-backlog <feature description>
```

**For analysis, research, documentation, experiments**:

```bash
/task-to-backlog <task description>
```

Both skills draft a plan, run an iterative review loop, commit the plan doc to
`docs/plans/`, register DoD commands on the task, and leave the task in **Backlog**.

### 3. Approve and queue

Review the generated DoD commands:

```bash
backlog browser --no-open --port 6421
```

Move to the execution queue:

```bash
backlog task edit TASK-N --status "Ready"
```

### 4. Start the worker

```bash
/loop-backlog
```

The worker self-schedules via `ScheduleWakeup` and keeps running until the
session closes. It picks up Ready tasks, executes them in isolated git
worktrees, and merges results back to master.

---

## Kanban Columns

| Column | Meaning |
|--------|---------|
| **Plan Draft** | Skill is generating the execution plan |
| **Plan Review** | Skill is running the review loop |
| **Backlog** | Plan approved; awaiting human review of DoD |
| **Ready** | Human approved; queued for L0 worker |
| **In Progress** | L0 worker has claimed and is executing |
| **Done** | Completed; branch merged to master |
| **Needs Human** | Stuck (DoD failure ×3), merge conflict, or review timeout |

`feature-to-backlog` also uses **Proposal Draft**, **Proposal Review** columns
before the plan phases.

---

## Skills Reference

### `/feature-to-backlog <topic>`

Workflow: Proposal Draft → Proposal Review → Plan Draft → Plan Review → Backlog

Generates a two-document output:
- `docs/proposals/proposal-<slug>.md`
- `docs/plans/<N>-<slug>.md`

Plan structure enforces **TDD order**: every Phase has `### Tests (write first)`
before `### Implementation`, and `DoD[0]` must be a test runner command.

Review limits: 8 rounds per loop (proposal + plan).

### `/task-to-backlog <topic>`

Workflow: Plan Draft → Plan Review → Backlog

For non-development tasks (analysis, documentation, research, experiment).
Single document output: `docs/plans/<N>-<slug>.md`.

Plan structure: `## Phase N` → free-form instructions → `### DoD` (any shell
command: `test -f`, `grep -q`, tool exit codes).

Review limit: 4 rounds.

### `/loop-backlog`

Autonomous L0 worker. One invocation starts the loop; it self-reschedules.

Each iteration:
1. **Reap** — reset In Progress tasks stuck > 30 min
2. **Claim** — atomically take the next Ready task
3. **Worktree** — create isolated branch `task/TASK-N` in `../archguard-TASK-N`
4. **Execute** — follow the task Description (type-agnostic)
5. **Verify DoD** — run each DoD command; retry up to 3× on failure
6. **Commit** — only if file changes exist
7. **Merge** — `--no-ff` back to master; move task to Done

On unrecoverable failure: task moves to **Needs Human**, worktree preserved
for inspection.

### `/backlog-setup`

One-time initializer. Checks `backlog` CLI, runs `backlog init` if needed,
adds all required columns.

---

## Project Configuration

Add an `## L0 Config` section to `CLAUDE.md` to override auto-detected defaults:

```markdown
## L0 Config

test-cmd: npm test -- --run     # per-phase test runner (feature-to-backlog DoD[0])
test-all: npm test              # full suite (Acceptance Gate[0])
worktree-symlinks: node_modules # space-separated dirs to symlink into worktree
doc-path: docs                  # root for proposals/ and plans/
```

All fields are optional. Without this section, skills auto-detect from
`package.json`, `go.mod`, `Cargo.toml`, or `pyproject.toml`.

---

## Worktree Layout

```
~/work/
  archguard/          ← master (untouched during task execution)
  archguard-TASK-2/   ← isolated worktree, branch task/TASK-2
  archguard-TASK-3/   ← next task (if parallel — currently serial)
```

Symlinks (`node_modules` etc.) are created inside the worktree to avoid
reinstall. The worktree is removed on successful merge or preserved on failure.

---

## Failure Handling

| Failure | Action |
|---------|--------|
| DoD command fails ×3 | Task → Needs Human; worktree preserved |
| Merge conflict | Task → Needs Human; worktree preserved with instructions |
| Review loop timeout | Task → Needs Human; plan printed for manual review |
| Reaper (>30 min stuck) | Task → Ready; worktree cleaned up |

Manual recovery for preserved worktrees:

```bash
# Inspect
cd ../archguard-TASK-N

# Fix and re-commit, then:
cd ~/work/archguard
git merge --no-ff task/TASK-N
git worktree remove ../archguard-TASK-N
git branch -d task/TASK-N
backlog task edit TASK-N --status "Done"
```
