# ArchGuard Quay Development Loop

Use the quay MCP tools (task_list, task_get, task_write, gate_run, lifecycle_promote)
to drive development of the archguard project's quay task board at
/home/yale/work/archguard/tasks/.

## Cycle

**0. DRAIN.** task_list --label directive --status todo. Disposition each pending directive:
  - milestone-candidate (add label, set dirStatus: applied)
  - standing-rule amendment
  - out-of-cycle action
  Record disposition on the directive task.

**1. SELECT.** task_list --label milestone-candidate --status ready.
  Pick the highest-priority ready task. Exclude label:human-steered.
  If none ready: check for todo candidates that can be promoted.

**2. BUILD.** For the selected task:
  - Set status to in_progress via task_write
  - Create a git worktree: git worktree add ../archguard-<task-id> -b task/<task-id>
  - Implement the task's acceptance criteria in the worktree
  - Run tests: archguard's test suite must stay green

**3. GATE.** task_check the task. All AC checkboxes must be ticked.
  Run any configured gates from .quay/config.yml.

**4. LAND.** lifecycle_promote the task (todo→ready→done).
  Merge worktree to master: git merge task/<task-id>
  Remove worktree: git worktree remove ../archguard-<task-id>
  Record evidence in the task body.

Stop when .halt exists. Otherwise continue.
