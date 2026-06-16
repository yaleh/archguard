---
name: task-to-backlog
description: "Converts a non-development task (analysis, research, documentation, experiment, survey) into a backlog task. Single draft + review loop produces a phase-based execution plan with shell-verifiable DoD. No TDD structure required. Ends with a git commit of the plan doc and the task in Backlog status."
argument-hint: [task-description]
allowed-tools: Read, Glob, Grep, Bash, Agent
---

λ(topic) → taskToBacklog(topic)

## Spec

Config :: {
  docPath : String   -- root directory for plan docs and task outputs
}

loadConfig :: () → Config
loadConfig() =
  | fromClaudeMd()   -- explicit: "## L0 Config" section in CLAUDE.md
  | autoDetect()     -- implicit: use "docs" if it exists, otherwise "."

autoDetect :: () → Config
autoDetect() =
  | exists("docs/") → { docPath: "docs" }
  | otherwise       → { docPath: "." }

-- Non-development task types this skill handles (non-exhaustive)
TaskType = Analysis | Documentation | Research | Experiment | Survey | Setup

-- Plan structure — no TDD constraint; DoD is any shell-verifiable command
Phase :: {
  title        : String,
  instructions : String,    -- what to do; specific tools, files, commands
  dod          : [ShellCmd] -- any shell command; exit 0 = pass
                             -- common patterns:
                             --   test -f <path>          (file exists)
                             --   test -s <path>          (file non-empty)
                             --   grep -q '<pat>' <path>  (content check)
                             --   <tool> && exit 0        (tool succeeded)
}

Plan :: {
  phases      : [Phase],    -- ordered; earlier phases produce inputs for later ones
  constraints : [String],   -- non-executable criteria (NOT in dod)
  acceptance  : [ShellCmd]  -- final gate; at least one item required
}

-- Workflow: single draft + single review loop (softer than feature-to-backlog)
taskToBacklog :: Topic → BacklogTask
taskToBacklog(T) = {
  cfg:  loadConfig(),
  task: createTask(T),
  plan: reviewLoop(task, draftPlan(task, T), 4),
  _:    finalise(task, plan, cfg),
  return: task   -- status: Backlog
}

reviewLoop :: (Task, Plan, MaxRounds) → ApprovedPlan
reviewLoop(_, plan, 0) = escalate(plan)   -- not converged; move to Needs Human
reviewLoop(T, plan, n) = {
  verdict: review(T, plan),
  if (verdict == APPROVED): return plan,
  return: reviewLoop(T, revise(plan, verdict.fixes), n - 1)
}

-- Review invariants (all must hold for APPROVED)
reviewPlan :: Plan → Verdict
reviewPlan(P) = {
  assert: ¬empty(P.phases),
  ∀phase ∈ P.phases: {
    assert: ¬empty(phase.instructions),         -- phase must say what to do
    assert: ¬empty(phase.dod),                  -- phase must be verifiable
    assert: ∀cmd ∈ phase.dod: isShellCmd(cmd)  -- no natural-language DoD
  },
  assert: ¬empty(P.acceptance),
  assert: ∀cmd ∈ P.acceptance: isShellCmd(cmd),
  return: APPROVED | NEEDS_REVISION
}

## Implementation

### loadConfig

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)

L0_SECTION=$(awk '/^## L0 Config/{found=1; next} found && /^## /{exit} found{print}' \
  "${REPO_ROOT}/CLAUDE.md" 2>/dev/null)

parse_cfg() { echo "$L0_SECTION" | grep -oP "(?<=^$1:\s)\S.*" | head -1 | xargs; }

CFG_DOC_PATH=$(parse_cfg "doc-path")

if [ -z "$L0_SECTION" ]; then
  if [ -d "${REPO_ROOT}/docs" ]; then
    CFG_DOC_PATH="${CFG_DOC_PATH:-docs}"
  else
    CFG_DOC_PATH="${CFG_DOC_PATH:-.}"
  fi
  echo "L0 auto-detected config: docPath=${CFG_DOC_PATH}"
else
  CFG_DOC_PATH="${CFG_DOC_PATH:-docs}"
  echo "L0 config loaded from CLAUDE.md: docPath=${CFG_DOC_PATH}"
fi
```

Derive slug and title:

```bash
SLUG=$(echo "<topic>" | tr '[:upper:] ' '[:lower:]-' | tr -cd '[:alnum:]-' | cut -c1-50)
TITLE=$(echo "<topic>" | cut -c1-70)
```

If `<topic>` is empty: print usage and stop.

---

### Phase 1: createTask

```bash
backlog task create "$TITLE" \
  --status "Plan Draft" \
  --description "<topic>" \
  --plain
```

Extract task ID from output line `Task TASK-N`. Write to `$TMPDIR/ttb-task-id.txt`.

---

### Phase 2: draftPlan

Spawn Task agent:

> Draft an execution plan for a non-development task and update the backlog task.
>
> Task ID: `<TASK_ID>`
> Doc root: `<CFG_DOC_PATH>`
>
> 1. Read the task topic: `<topic>`
> 2. Search the codebase or project structure as needed to understand context.
> 3. Write `$TMPDIR/ttb-plan.md`:
>
>    ```markdown
>    # Plan: <title>
>
>    ## Context
>    (1-4 lines: why this task, what problem it addresses)
>
>    ## Phase 1: <title>
>    <Specific instructions: which tools to run, which files to read/write,
>    what commands to execute. Be concrete — avoid "analyse" without saying how.>
>    ### DoD
>    - [ ] `<shell command>`   ← exit 0 = done; use test -f, grep -q, tool exit code
>    - [ ] `<shell command>`
>
>    ## Phase 2: <title>
>    ...
>    ### DoD
>    - [ ] `<shell command>`
>
>    ## Constraints
>    (What NOT to do; scope limits; non-executable criteria only)
>
>    ## Acceptance Gate
>    - [ ] `<final verification command>`
>    ```
>
>    DoD rules (STRICT):
>    - Every `### DoD` and `## Acceptance Gate` item MUST be a shell command
>      (exit 0 = pass; never natural language)
>    - Prefer precise checks: `grep -q '<section-header>' <file>` over `test -f <file>`
>    - Absence check: `! grep -q <pattern> <file>` (NOT `grep -qv`)
>    - Natural-language criteria → `## Constraints` only
>    - Phases ordered so earlier outputs are available to later phases
>    - Minimum 1 phase, maximum 6 phases
>
>    Common DoD patterns for non-dev tasks:
>    - Output file created:    `test -f <CFG_DOC_PATH>/tasks/<slug>-output.md`
>    - Output non-empty:       `test -s <CFG_DOC_PATH>/tasks/<slug>-output.md`
>    - Report has section:     `grep -q '## Recommendations' <path>`
>    - Tool exited cleanly:    `<tool command with flags>`
>    - At least N lines:       `[ $(wc -l < <path>) -ge N ]`
>
> 4. Update task:
>    ```bash
>    backlog task edit <TASK_ID> \
>      --description "$(cat $TMPDIR/ttb-plan.md)" \
>      --status "Plan Review"
>    ```

---

### Phase 3: reviewLoop(plan)

**Soft limit: 4 iterations.** On exhaustion:

```bash
backlog task edit $TASK_ID --status "Needs Human" \
  --append-notes "Plan review did not converge after 4 iterations. Manual review required."
```

Print current `$TMPDIR/ttb-plan.md` and stop.

Each iteration — spawn Task agent:

> You are reviewing an execution plan for a non-development task.
>
> Task ID: `<TASK_ID>` — Iteration: `<N>`
>
> 1. Read `$TMPDIR/ttb-plan.md`
>
> 2. Check each item:
>    - **Clarity**: Does each Phase have specific, actionable instructions?
>      Flag vague instructions like "analyse X" without saying how.
>    - **DoD executability**: Every `### DoD` and `## Acceptance Gate` item
>      is a shell command (exit 0 = pass). Flag natural-language items
>      and move them to `## Constraints`.
>    - **DoD precision**: Prefer `grep -q '<section>'` over bare `test -f`.
>      A file existing is weaker than a file containing the expected content.
>    - **Absence checks**: `! grep -q` used, not `grep -qv`.
>    - **Phase ordering**: Outputs of earlier phases are available to later phases.
>    - **Scope**: No phase does something outside the task's stated purpose.
>
> 3a. ALL pass:
>    ```bash
>    backlog task edit <TASK_ID> \
>      --append-notes "Plan review iteration <N>: APPROVED"
>    echo "APPROVED" > $TMPDIR/ttb-plan-verdict.txt
>    ```
>
> 3b. ANY fail: fix `$TMPDIR/ttb-plan.md`, update task description,
>    write `NEEDS_REVISION` to verdict file.

After each agent run, read `$TMPDIR/ttb-plan-verdict.txt`:
- `APPROVED` → proceed to Phase 4
- `NEEDS_REVISION` → increment counter, repeat Phase 3

---

### Phase 4: finalise

Spawn Task agent (pass `CFG_DOC_PATH`, `TASK_ID`, `SLUG` as literal values):

> Finalise the backlog task and commit the plan document.
>
> Task ID: `<TASK_ID>` — Slug: `<SLUG>` — Doc root: `<CFG_DOC_PATH>`
>
> **Step A — Plan number**:
> ```bash
> NEXT_N=$(ls <CFG_DOC_PATH>/plans/ 2>/dev/null \
>   | grep -oP '^\d+' | sort -n | tail -1 \
>   | xargs -I{} expr {} + 1 2>/dev/null || echo "101")
> ```
>
> **Step B — Copy plan doc**:
> ```bash
> mkdir -p <CFG_DOC_PATH>/plans
> cp $TMPDIR/ttb-plan.md <CFG_DOC_PATH>/plans/${NEXT_N}-<SLUG>.md
> ```
>
> **Step C — Commit**:
> ```bash
> git add <CFG_DOC_PATH>/plans/${NEXT_N}-<SLUG>.md
> git commit -m "docs(<SLUG>): add task plan"
> ```
> Only this file. Verify with `git status` first.
>
> **Step D — Extract DoD commands and add to task**:
> ```bash
> grep -oP '(?<=- \[ \] `)[^`]+(?=`)' $TMPDIR/ttb-plan.md \
>   > $TMPDIR/ttb-dod-cmds.txt
>
> DOD_ARGS=()
> while IFS= read -r cmd; do
>   DOD_ARGS+=("--dod" "$cmd")
> done < $TMPDIR/ttb-dod-cmds.txt
>
> backlog task edit <TASK_ID> \
>   --status "Backlog" \
>   --append-notes "Plan committed: <CFG_DOC_PATH>/plans/${NEXT_N}-<SLUG>.md" \
>   "${DOD_ARGS[@]}"
> ```
>
> **Step E — Print completion**:
> ```
> ✅ Task <TASK_ID> is now in Backlog.
>
> 计划草拟 + 审查已完成。文档已提交。
>
> 请在 web UI 确认 Definition of Done 命令：
>   backlog browser --no-open --port 6421
>
> 确认无误后，将任务移入执行队列：
>   backlog task edit <TASK_ID> --status "Ready"
>
> 等待 loop-backlog 自动拾取，或立即启动：
>   /loop-backlog
> ```

---

## Constraints

- This skill outputs a plan doc and a backlog task only — it does not execute the task
- No branch creation, no worktree operations, no git push, no PR creation
- One task per topic; the same TASK_ID moves through all columns
- Phase count: minimum 1, maximum 6
- Must run from the project root of a git repository
- `$TMPDIR` files are ephemeral; do not reference them after Phase 4 completes
