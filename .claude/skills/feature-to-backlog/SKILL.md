---
name: feature-to-backlog
description: "Converts a feature description into a single backlog task with TDD implementation plan, moving through Proposal Draft → Proposal Review → Plan Draft → Plan Review → Backlog. Two iterative review loops (each converges on APPROVED, soft limit 8 rounds). Ends with a git commit of the docs and the task in Backlog status with native DoD items. No branch creation, no PRs."
argument-hint: [feature-topic-or-description]
allowed-tools: Read, Glob, Grep, Bash, Agent
---

λ(topic) → featureToBacklog(topic)

## Spec

-- Core document types

Proposal :: {
  background : String,           -- WHY this feature is needed (3-8 lines)
  goals      : [VerifiableGoal], -- each Goal checkable by inspection or shell command
  approach   : String,           -- high-level design; no implementation code
  tradeoffs  : String            -- what we are NOT doing; known risks
}

Phase :: {
  title  : String,
  tests  : [TestSpec],           -- written before implementation; must fail first
  impl   : [FileChange],         -- code that makes the tests pass
  dod    : [ShellCmd]            -- dod[0] MUST be a test runner command (red→green proof)
}

Plan :: {
  phases      : [Phase],         -- ordered; earlier phases feed later ones
  constraints : [String],        -- non-executable criteria (NOT in dod)
  acceptance  : [ShellCmd]       -- final gate; acceptance[0] is a full test run
}

-- Workflow

featureToBacklog :: Topic → BacklogTask
featureToBacklog(T) = {
  task:     createTask(T),
  proposal: reviewLoop(task, draftProposal(task, T), 8),
  plan:     reviewLoop(task, draftPlan(task, proposal), 8),
  _:        finalise(task, proposal, plan),
  return:   task  -- status: Backlog
}

reviewLoop :: (Task, Doc, MaxRounds) → ApprovedDoc
reviewLoop(_, doc, 0) = escalate(doc)   -- not converged; move to Needs Human
reviewLoop(T, doc, n) = {
  verdict: review(T, doc),
  if (verdict == APPROVED): return doc,
  return: reviewLoop(T, revise(doc, verdict.fixes), n - 1)
}

-- Plan review invariants (all must hold for APPROVED)

reviewPlan :: Plan → Verdict
reviewPlan(P) = {
  ∀phase ∈ P.phases: {
    assert: ¬empty(phase.tests),              -- TDD: Tests section must exist
    assert: isTestCommand(phase.dod[0]),       -- TDD: first DoD proves red→green
    assert: ∀cmd ∈ phase.dod: isShellCmd(cmd)
  },
  assert: ∀goal ∈ proposal.goals: coveredBy(goal, P.phases ∪ P.acceptance),
  assert: ∀phase ∈ P.phases: allFilesExist(phase.impl),
  return: APPROVED | NEEDS_REVISION
}

## Implementation

Derive once and reuse throughout:

```bash
SLUG=$(echo "<topic>" | tr '[:upper:] ' '[:lower:]-' | tr -cd '[:alnum:]-' | cut -c1-50)
TITLE=$(echo "<topic>" | cut -c1-70)
```

If `<topic>` is empty: print usage and stop.

---

### Phase 1: createTask + draftProposal

**1a. createTask** (orchestrator runs directly):

```bash
backlog task create "$TITLE" \
  --status "Proposal Draft" \
  --description "<topic>" \
  --plain
```

Extract task ID from output line `Task TASK-N`. Write to `$TMPDIR/ftb-task-id.txt`.

**1b. draftProposal** — spawn Task agent:

> Draft a technical proposal and update the backlog task.
>
> Task ID: `<TASK_ID>`
>
> 1. Search the codebase to understand current architecture relevant to: `<topic>`
>
> 2. Write `$TMPDIR/ftb-proposal.md`:
>    ```markdown
>    # Proposal: <title>
>
>    ## Background
>    (3-8 lines: WHY this feature is needed, what problem it solves)
>
>    ## Goals
>    1. (concrete, verifiable outcome)
>    2. ...
>
>    ## Proposed Approach
>    (High-level design: what to build, key components — no implementation code)
>
>    ## Trade-offs and Risks
>    (What we are not doing, known risks, alternatives considered)
>    ```
>
> 3. Update task:
>    ```bash
>    backlog task edit <TASK_ID> \
>      --description "$(cat $TMPDIR/ftb-proposal.md)" \
>      --status "Proposal Review"
>    ```
>
> Rules: Background must state WHY, not just WHAT. Each Goal must be verifiable.
> No implementation phases or DoD commands in this document.

---

### Phase 2: reviewLoop(proposal)

**Soft limit: 8 iterations.** On exhaustion:

```bash
backlog task edit $TASK_ID --status "Needs Human" \
  --append-notes "Proposal review did not converge after 8 iterations. Manual review required."
```

Print current `$TMPDIR/ftb-proposal.md` and stop.

Each iteration — spawn Task agent:

> You are a strict software architect reviewing a proposal.
>
> Task ID: `<TASK_ID>` — Iteration: `<N>`
>
> 1. Read `$TMPDIR/ftb-proposal.md`
>
> 2. Check each item:
>    - **Motivation**: Does Background explain WHY (not just WHAT)? Is it 3-8 lines?
>    - **Goals**: All numbered and concretely verifiable? No vague language?
>    - **Feasibility**: Does Approach align with the codebase? Search to verify.
>    - **Completeness**: Are trade-offs and risks identified?
>    - **Consistency**: No contradictions between sections?
>
> 3a. ALL pass:
>    ```bash
>    backlog task edit <TASK_ID> \
>      --append-notes "Proposal review iteration <N>: APPROVED"
>    echo "APPROVED" > $TMPDIR/ftb-proposal-verdict.txt
>    ```
>
> 3b. ANY fail: fix the failing sections in `$TMPDIR/ftb-proposal.md` directly,
>    update task description with revised draft, write `NEEDS_REVISION` to verdict file.

After each agent run, read `$TMPDIR/ftb-proposal-verdict.txt`:
- `APPROVED` → proceed to Phase 3
- `NEEDS_REVISION` → increment counter, repeat Phase 2

---

### Phase 3: draftPlan

```bash
backlog task edit $TASK_ID \
  --status "Plan Draft" \
  --append-notes "Proposal approved. Starting plan draft."
```

Spawn Task agent:

> Draft a TDD implementation plan and update the backlog task.
>
> Task ID: `<TASK_ID>`
>
> 1. Read the approved proposal from `$TMPDIR/ftb-proposal.md`
> 2. Search the codebase to identify exact file paths to create or modify.
> 3. Write `$TMPDIR/ftb-plan.md`:
>
>    ```markdown
>    # Plan: <title>
>
>    Proposal: docs/proposals/proposal-<slug>.md
>
>    ## Phase A: <title>
>    ### Tests (write first)
>    (Test file paths and test case names to add; these must fail before implementation)
>    ### Implementation
>    (Files to create or modify; code that makes the tests pass)
>    ### DoD
>    - [ ] `npm test -- --run <test-file>`   ← first item MUST be a test runner command
>    - [ ] `<other verification command>`
>
>    ## Phase B: <title>
>    ### Tests (write first)
>    ...
>    ### Implementation
>    ...
>    ### DoD
>    - [ ] `npm test -- --run <test-file>`
>    - [ ] `<other verification command>`
>
>    ## Constraints
>    (Non-executable criteria — goes here, NOT in DoD)
>
>    ## Acceptance Gate
>    - [ ] `npm test`                         ← full test suite green
>    - [ ] `<final verification command>`
>    ```
>
>    DoD rules (STRICT):
>    - Every `### DoD` and `## Acceptance Gate` item MUST be an executable shell command
>      (exit 0 = pass)
>    - `### Tests` section MUST exist in every Phase — this is the TDD specification
>    - First `### DoD` item MUST be a test runner command — proves red→green
>    - Each Phase ≤ 200 lines of code change
>    - Absence check: `! grep -q <pattern> <file>` (NOT `grep -qv`)
>    - Natural-language criteria → `## Constraints` only, never in DoD
>    - Phases ordered so earlier phases produce what later phases need
>
> 4. Update task:
>    ```bash
>    backlog task edit <TASK_ID> \
>      --description "$(cat $TMPDIR/ftb-plan.md)" \
>      --status "Plan Review"
>    ```

---

### Phase 4: reviewLoop(plan)

**Soft limit: 8 iterations.** On exhaustion: move to Needs Human, print plan, stop.

Each iteration — spawn Task agent:

> You are a strict software architect reviewing a TDD implementation plan.
>
> Task ID: `<TASK_ID>` — Iteration: `<N>`
>
> 1. Read `$TMPDIR/ftb-proposal.md` and `$TMPDIR/ftb-plan.md`
>
> 2. Check each item:
>    - **Goal coverage**: Every proposal Goal addressed by at least one Phase or
>      Acceptance Gate item
>    - **TDD structure**: Every Phase has a `### Tests` section AND
>      `### Implementation` section (in that order)
>    - **TDD order**: First `### DoD` item is a test runner command (proves red→green)
>    - **DoD executability**: All `### DoD` and `## Acceptance Gate` items are shell
>      commands (exit 0 = pass). Flag natural-language items and move to `## Constraints`
>    - **Absence checks**: `! grep -q` pattern used, not `grep -qv`
>    - **Phase ordering**: Earlier phases produce what later phases need; no circular deps
>    - **Scope discipline**: No Phase implements something not backed by a Goal
>    - **File paths**: Referenced files exist in the codebase (search to verify)
>
> 3a. ALL pass:
>    ```bash
>    backlog task edit <TASK_ID> \
>      --append-notes "Plan review iteration <N>: APPROVED"
>    echo "APPROVED" > $TMPDIR/ftb-plan-verdict.txt
>    ```
>
> 3b. ANY fail: fix `$TMPDIR/ftb-plan.md` (and `$TMPDIR/ftb-proposal.md` if needed),
>    update task description, write `NEEDS_REVISION` to verdict file.

After each agent run, read `$TMPDIR/ftb-plan-verdict.txt`:
- `APPROVED` → proceed to Phase 5
- `NEEDS_REVISION` → increment counter, repeat Phase 4

---

### Phase 5: finalise

Spawn Task agent:

> Finalise the backlog task and commit documents to the repository.
>
> Task ID: `<TASK_ID>` — Slug: `<SLUG>`
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
> Only these two files. Verify with `git status` first.
>
> **Step D — Extract DoD commands and add to task**:
> ```bash
> grep -oP '(?<=- \[ \] `)[^`]+(?=`)' $TMPDIR/ftb-plan.md \
>   > $TMPDIR/ftb-dod-cmds.txt
>
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
> **Step E — Print completion**:
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
>   /loop-backlog
> ```

---

## Constraints

- This skill outputs docs and a backlog task only — it does not implement code
- No branch creation, no worktree operations, no git push, no PR creation
- One task per feature throughout; the same TASK_ID moves through all columns
- Phase count in generated plans: minimum 1, maximum 8
- Must run from the project root of the archguard repository
- `$TMPDIR` files are ephemeral; do not reference them after Phase 5 completes
