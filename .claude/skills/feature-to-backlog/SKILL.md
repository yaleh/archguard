---
name: feature-to-backlog
description: "Converts a feature description into a single backlog task that moves through Proposal Draft → Proposal Review → Plan Draft → Plan Review → Backlog columns. Two iterative review loops (each converges on APPROVED, soft limit 8 rounds). Ends with a git commit of the docs and the task in Backlog status with native DoD items. No branch creation, no PRs."
argument-hint: [feature-topic-or-description]
allowed-tools: Read, Glob, Grep, Bash, Agent
---

## Role

This skill is an **orchestrator**. It spawns Task agents for each generation and
review phase and does not write files or code directly.

One backlog task is created at the start and moves through columns as work
progresses. The human sees the task's current column at any time.

```
Proposal Draft → Proposal Review → Plan Draft → Plan Review → Backlog
```

After the skill completes, the human reviews DoD items in the web UI and moves
the task to **Ready** to trigger L0 execution.

---

## Input

`/feature-to-backlog <topic>`

`<topic>` is the feature description: problem, goals, any agreed design
decisions. If empty, print usage and stop.

Derive once and reuse throughout:
```bash
SLUG=$(echo "<topic>" | tr '[:upper:] ' '[:lower:]-' | tr -cd '[:alnum:]-' | cut -c1-50)
TITLE=$(echo "<topic>" | cut -c1-70)
```

---

## Phase 1: Create Task + Draft Proposal

**1a. Create the backlog task** (orchestrator runs directly):

```bash
backlog task create "$TITLE" \
  --status "Proposal Draft" \
  --description "<topic>" \
  --plain
```

Extract the task ID from the output line `Task TASK-N`:
```bash
TASK_ID=TASK-N   # e.g. TASK-3
```

Write `$TASK_ID` to `$TMPDIR/ftb-task-id.txt` for use by all subsequent agents.

**1b. Draft the proposal** — spawn a Task agent:

> Draft a technical proposal and update the backlog task description.
>
> Task ID: `<TASK_ID>` (literal value, e.g. TASK-3)
>
> Steps:
>
> 1. Search the codebase to understand the current architecture relevant to this
>    feature topic: `<topic>`
>
> 2. Write the proposal to `$TMPDIR/ftb-proposal.md` in this format:
>    ```markdown
>    # Proposal: <title>
>
>    ## Background
>    (3-8 lines: WHY this feature is needed, what problem it solves)
>
>    ## Goals
>    1. (concrete, measurable outcome)
>    2. ...
>
>    ## Proposed Approach
>    (High-level design: what to build, key components involved — no implementation code)
>
>    ## Trade-offs and Risks
>    (What we are not doing, known risks, alternatives considered)
>    ```
>
> 3. Update the task description with the draft:
>    ```bash
>    backlog task edit <TASK_ID> \
>      --description "$(cat $TMPDIR/ftb-proposal.md)" \
>      --status "Proposal Review"
>    ```
>
> Rules:
> - Background must state WHY, not just WHAT
> - Each Goal must be verifiable by inspection or shell command
> - No implementation phases or DoD commands in this document

---

## Phase 2: Proposal Review Loop (until APPROVED)

**Soft limit: 8 iterations.** If not APPROVED after 8 rounds:
```bash
backlog task edit $TASK_ID \
  --status "Needs Human" \
  --append-notes "Proposal review did not converge after 8 iterations. Manual review required."
```
Print the current `$TMPDIR/ftb-proposal.md` and stop.

Repeat until approved — spawn a Task agent each iteration:

> You are a strict software architect reviewing a proposal.
>
> Task ID: `<TASK_ID>` — Iteration: `<N>`
>
> 1. Read `$TMPDIR/ftb-proposal.md`
>
> 2. Check each item:
>    - **Motivation**: Does Background explain WHY (not just WHAT)? Is it 3-8 lines?
>    - **Goals**: Are all Goals numbered and concretely verifiable? No vague language?
>    - **Feasibility**: Does the Proposed Approach align with the codebase?
>      Search relevant files to verify.
>    - **Completeness**: Are trade-offs and risks identified?
>    - **Consistency**: No contradictions between sections?
>
> 3a. If ALL checks pass:
>    ```bash
>    backlog task edit <TASK_ID> \
>      --append-notes "Proposal review iteration <N>: APPROVED"
>    echo "APPROVED" > $TMPDIR/ftb-proposal-verdict.txt
>    ```
>
> 3b. If ANY check fails:
>    - Fix the failing sections in `$TMPDIR/ftb-proposal.md` directly
>    - Update the task description with the revised draft:
>      ```bash
>      backlog task edit <TASK_ID> \
>        --description "$(cat $TMPDIR/ftb-proposal.md)" \
>        --append-notes "Proposal review iteration <N>: NEEDS_REVISION — <brief list of fixes>"
>      echo "NEEDS_REVISION" > $TMPDIR/ftb-proposal-verdict.txt
>      ```

After each agent run, read `$TMPDIR/ftb-proposal-verdict.txt`:
- `APPROVED` → proceed to Phase 3
- `NEEDS_REVISION` → increment counter, repeat Phase 2

---

## Phase 3: Move to Plan Draft + Draft Plan

**3a. Move column** (orchestrator runs directly):

```bash
backlog task edit $TASK_ID \
  --status "Plan Draft" \
  --append-notes "Proposal approved. Starting plan draft."
```

**3b. Draft the plan** — spawn a Task agent:

> Draft an implementation plan and update the backlog task.
>
> Task ID: `<TASK_ID>`
>
> 1. Read the approved proposal from `$TMPDIR/ftb-proposal.md`
>
> 2. Search the codebase to identify exact file paths to modify.
>
> 3. Write the plan to `$TMPDIR/ftb-plan.md`:
>    ```markdown
>    # Plan: <title>
>
>    Proposal: docs/proposals/proposal-<slug>.md
>
>    ## Phase A: <title>
>    ### Task
>    (what to implement; which specific files; 3-6 lines)
>    ### DoD
>    - [ ] `<executable shell command>`
>    - [ ] `<executable shell command>`
>
>    ## Phase B: <title>
>    ...
>
>    ## Constraints
>    (global constraints; non-executable criteria go here — NOT in DoD)
>
>    ## Acceptance Gate
>    - [ ] `<final verification shell command>`
>    ```
>
>    DoD rules (STRICT):
>    - Every `### DoD` and `## Acceptance Gate` item MUST be a shell command
>      that exits 0 on success
>    - Absence check: `! grep -q <pattern> <file>` (NOT `grep -qv`)
>    - Natural-language criteria → `## Constraints` only
>    - Each Phase ≤ 200 lines of code change
>    - Phases ordered so earlier phases produce what later phases need
>
> 4. Update the task:
>    ```bash
>    backlog task edit <TASK_ID> \
>      --description "$(cat $TMPDIR/ftb-plan.md)" \
>      --status "Plan Review"
>    ```

---

## Phase 4: Plan Review Loop (until APPROVED)

**Soft limit: 8 iterations.** If not APPROVED after 8 rounds:
```bash
backlog task edit $TASK_ID \
  --status "Needs Human" \
  --append-notes "Plan review did not converge after 8 iterations. Manual review required."
```
Print the current `$TMPDIR/ftb-plan.md` and stop.

Repeat until approved — spawn a Task agent each iteration:

> You are a strict software architect reviewing an implementation plan for
> alignment with its proposal and for DoD quality.
>
> Task ID: `<TASK_ID>` — Iteration: `<N>`
>
> 1. Read `$TMPDIR/ftb-proposal.md` and `$TMPDIR/ftb-plan.md`
>
> 2. Check each item:
>    - **Goal coverage**: Every proposal Goal is addressed by at least one
>      Phase Task or Acceptance Gate item
>    - **DoD executability**: Every `### DoD` and `## Acceptance Gate` item
>      is a shell command (exit 0 = pass). Flag natural-language items and
>      move them to `## Constraints`
>    - **Absence checks**: `! grep -q` pattern used, not `grep -qv`
>    - **Phase ordering**: earlier phases produce what later phases need;
>      no circular dependencies
>    - **Scope discipline**: no Phase implements something not backed by a Goal
>    - **File paths**: referenced files exist in the codebase (search to verify)
>
> 3a. If ALL checks pass:
>    ```bash
>    backlog task edit <TASK_ID> \
>      --append-notes "Plan review iteration <N>: APPROVED"
>    echo "APPROVED" > $TMPDIR/ftb-plan-verdict.txt
>    ```
>
> 3b. If ANY check fails:
>    - Fix `$TMPDIR/ftb-plan.md` (and `$TMPDIR/ftb-proposal.md` if needed)
>    - Update the task:
>      ```bash
>      backlog task edit <TASK_ID> \
>        --description "$(cat $TMPDIR/ftb-plan.md)" \
>        --append-notes "Plan review iteration <N>: NEEDS_REVISION — <brief list of fixes>"
>      echo "NEEDS_REVISION" > $TMPDIR/ftb-plan-verdict.txt
>      ```

After each agent run, read `$TMPDIR/ftb-plan-verdict.txt`:
- `APPROVED` → proceed to Phase 5
- `NEEDS_REVISION` → increment counter, repeat Phase 4

---

## Phase 5: Commit Docs + Add DoD + Move to Backlog

Spawn a Task agent:

> Finalise the backlog task and commit documents to the repository.
>
> Task ID: `<TASK_ID>`
> Slug: `<SLUG>`
>
> **Step A — Determine plan number**:
> ```bash
> NEXT_N=$(ls docs/plans/ 2>/dev/null \
>   | grep -oP '^\d+' | sort -n | tail -1 \
>   | xargs -I{} expr {} + 1 2>/dev/null || echo "101")
> ```
>
> **Step B — Copy docs**:
> ```bash
> mkdir -p docs/proposals docs/plans
> cp $TMPDIR/ftb-proposal.md docs/proposals/proposal-<SLUG>.md
> cp $TMPDIR/ftb-plan.md    docs/plans/${NEXT_N}-<SLUG>.md
> ```
>
> **Step C — Commit**:
> ```bash
> git add docs/proposals/proposal-<SLUG>.md docs/plans/${NEXT_N}-<SLUG>.md
> git commit -m "docs(<SLUG>): add proposal and plan"
> ```
> Only commit these two files. Verify with `git status` first.
>
> **Step D — Extract DoD commands and add to task**:
> ```bash
> # Extract all shell commands from DoD and Acceptance Gate sections
> grep -oP '(?<=- \[ \] `)[^`]+(?=`)' $TMPDIR/ftb-plan.md \
>   > $TMPDIR/ftb-dod-cmds.txt
>
> # Build and run backlog task edit with one --dod per command
> DOD_ARGS=()
> while IFS= read -r cmd; do
>   DOD_ARGS+=("--dod" "$cmd")
> done < $TMPDIR/ftb-dod-cmds.txt
>
> backlog task edit <TASK_ID> \
>   --status "Backlog" \
>   --append-notes "Docs committed: docs/proposals/proposal-<SLUG>.md + docs/plans/${NEXT_N}-<SLUG>.md" \
>   "${DOD_ARGS[@]}"
> ```
>
> **Step E — Print completion message**:
> ```
> ✅ Task <TASK_ID> is now in Backlog.
>
> 两轮起草 + 两轮迭代审查已完成。文档已提交。
>
> 请在 web UI 审阅 Definition of Done 中的命令：
>   backlog browser --no-open --port 6421
>
> 确认无误后，将任务移入执行队列：
>   backlog task edit <TASK_ID> --status "Ready"
>
> 启动 L0 执行：
>   @.claude/loop-backlog.md
> ```

---

## Constraints

- This skill outputs docs and a backlog task only — it does not implement code
- No branch creation, no worktree operations, no git push, no PR creation
- One task per feature throughout; the same TASK_ID moves through all columns
- Phase count in generated plans: minimum 1, maximum 8
- Must run from the project root of the archguard repository
- `$TMPDIR` files are ephemeral; do not reference them after Phase 5 completes
