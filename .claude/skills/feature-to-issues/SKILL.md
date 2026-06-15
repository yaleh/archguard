---
name: feature-to-issues
description: "Converts a feature discussion into a single GitHub Issue for the L0 agent queue using a 5-phase iterative pipeline: (1) generate proposal draft, (2) add implementation details, (3) iteratively review proposal until APPROVED (max 3 attempts), (4) iteratively review goal-phase alignment until APPROVED (max 3 attempts), (5) create GitHub Issue without execution labels for human confirmation. No working-tree switching or remote-push operations."
argument-hint: [feature-topic-or-description]
allowed-tools: Read, Glob, Grep, Bash, Agent
---

## Role

This skill is an **orchestrator**. It spawns Task agents for each generation and
review phase. It does not write files or code directly.

The output is a **single GitHub Issue** in the L0 layered format (Background +
Goals + Phase A…N sections with `### Task` and `### DoD`), created without any
execution-trigger labels. The human applies those labels after reviewing the issue.

---

## Input

`/feature-to-issues <topic>`

`<topic>` describes the feature: what problem it solves, goals, any design
decisions already agreed upon. If `<topic>` is empty, print usage and stop.

---

## Phase 1: Proposal Draft (Task agent)

Spawn a Task agent with this prompt:

> You are drafting the proposal section of a GitHub Issue for the L0 agent queue.
> Write ONLY the Background and Goals sections — do NOT write any Phase, DoD,
> Constraints, or Acceptance Gate yet.
>
> Format:
> ```
> ## Background
> (3-8 lines explaining WHY this feature is needed)
>
> ## Goals
> 1. (concrete, measurable outcome)
> 2. ...
> ```
>
> Rules:
> - Background must state the problem and motivation, not just describe the feature
> - Each Goal must be verifiable — something that can be confirmed via shell command or human inspection
> - Do not include implementation details
>
> Feature topic: <topic>
>
> Output only the raw markdown (Background + Goals sections). No preamble.

Write the output to `$TMPDIR/issue-draft-proposal.md`.

---

## Phase 2: Implementation Details (Task agent)

Spawn a Task agent with this prompt:

> You are expanding a GitHub Issue draft for the L0 agent queue. You have the
> Background and Goals sections. Now add the implementation phases.
>
> Read: `$TMPDIR/issue-draft-proposal.md`
>
> Append the following sections to produce a complete issue body:
>
> ```
> ## Phase A: <title>
> ### Task
> (what to implement, which specific files to modify, 3-6 lines)
> ### DoD
> - [ ] `<executable shell command>`
> - [ ] `<executable shell command>`
>
> ## Phase B: <title>  (if needed)
> ...
>
> ## Constraints
> (global constraints applying to all phases; non-executable acceptance criteria go here)
>
> ## Acceptance Gate
> - [ ] `<final verification shell command>`
> ```
>
> DoD rules (STRICT):
> - Every `### DoD` item MUST be an executable shell command that exits 0 on success
> - Use: `test -f <file>`, `grep -q <pattern> <file>`, `npm run type-check 2>&1 | grep -c "error TS" | grep -q "^0$"`
> - Absence checks: `! grep -q <pattern> <file>` (NOT `grep -qv`)
> - Natural language criteria go in `## Constraints`, NOT in `### DoD`
> - Each phase should be ≤200 lines of code change
> - Phases must be ordered so earlier phases produce what later phases depend on
>
> Write the complete issue body (Background + Goals + Phases + Constraints + Gate)
> to `$TMPDIR/issue-draft-full.md`. Output only the raw markdown.

---

## Phase 3: Proposal Review Loop (Task agent, max 3 iterations)

Repeat until approved or 3 iterations exhausted:

Spawn a Task agent with this prompt:

> You are a strict architect reviewing the proposal sections (Background + Goals)
> of a GitHub Issue draft. Read `$TMPDIR/issue-draft-full.md`.
>
> Check:
> 1. Background: 3-8 lines? States WHY (motivation), not just WHAT?
> 2. Goals: Each numbered and concretely verifiable? No vague goals?
> 3. Background and Goals internally consistent (no contradictions)?
>
> If ALL checks pass: write exactly `APPROVED` to `$TMPDIR/proposal-review-verdict.txt` and stop.
>
> If ANY check fails:
> - Fix the Background and/or Goals sections in `$TMPDIR/issue-draft-full.md` directly
> - Write `ISSUES: <brief list of what was fixed>` to `$TMPDIR/proposal-review-verdict.txt`
>
> Do not touch Phase, DoD, Constraints, or Acceptance Gate sections.

After the agent runs, read `$TMPDIR/proposal-review-verdict.txt`:
- If it starts with `APPROVED`: proceed to Phase 4
- If it starts with `ISSUES`: increment iteration counter; if counter < 3, repeat Phase 3
- If counter reaches 3 and not yet APPROVED:
  print `ERROR: Proposal review failed after 3 attempts. Manual review required.`
  print the contents of `$TMPDIR/proposal-review-verdict.txt`
  stop

---

## Phase 4: Alignment Review Loop (Task agent, max 3 iterations)

Repeat until approved or 3 iterations exhausted:

Spawn a Task agent with this prompt:

> You are a strict architect doing a final alignment review of a GitHub Issue draft.
> Read `$TMPDIR/issue-draft-full.md`.
>
> Check:
> 1. Every Goal must be covered by at least one Phase or Acceptance Gate item
> 2. Every `### DoD` item must be an executable shell command (exit 0 = pass)
>    — flag any natural language items and move them to `## Constraints`
>    — verify logical correctness of absence checks
> 3. Phase ordering: do earlier phases produce what later phases need?
> 4. Acceptance Gate: does it verify all Goals are achieved?
> 5. No scope creep: no Phase implements something not backed by a Goal
>
> If ALL checks pass: write exactly `APPROVED` to `$TMPDIR/alignment-review-verdict.txt` and stop.
>
> If ANY check fails:
> - Fix both the proposal sections AND the affected Phase sections as needed (full alignment)
> - Write `ISSUES: <brief list of what was fixed>` to `$TMPDIR/alignment-review-verdict.txt`

After the agent runs, read `$TMPDIR/alignment-review-verdict.txt`:
- If it starts with `APPROVED`: proceed to Phase 5
- If it starts with `ISSUES`: increment iteration counter; if counter < 3, repeat Phase 4
- If counter reaches 3 and not yet APPROVED:
  print `ERROR: Alignment review failed after 3 attempts. Manual review required.`
  print the contents of `$TMPDIR/alignment-review-verdict.txt`
  stop

---

## Phase 5: Create GitHub Issue (no execution-trigger label)

Read `$TMPDIR/issue-draft-full.md` to get the final issue body.

Derive the title: take the first Goal, strip its leading number, truncate to 70
chars, prefix with `[L0] `.

```bash
gh issue create \
  --repo yaleh/archguard \
  --title "[L0] <derived-title>" \
  --body "$(cat $TMPDIR/issue-draft-full.md)"
```

Do NOT add any labels to the issue.

After creating, print:

```
Issue created: <URL>

经过两轮生成 + 两轮迭代审查，内容已就绪。

请在 GitHub 上审阅：
- 各 Phase 的 ### DoD 命令是否正确（实现后能 exit 0）
- Phase 顺序和依赖是否符合预期

确认无误后，手动添加执行触发标签以进入 L0 执行队列。
```

---

## Constraints

- This skill outputs a GitHub Issue only — it does not implement any code
- Prohibited operations in any phase: working-tree switching, branch creation, stashing, or remote pushes
- Use only `grep`, `ls`, `test -f` for any file-state checks within the skill
- Phase count in generated issues: minimum 1, maximum 8; split into multiple issues if more needed
- The skill must work from the project root of the archguard repository
- Do not create child issues — one issue per feature, all phases inline
