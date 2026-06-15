---
name: feature-to-issues
description: "Converts a feature discussion into a single GitHub Issue in the L0 layered format (Background + Goals + Phase A…N sections each with ### Task and ### DoD). Checks implementation state on master before creating each phase — skips already-implemented phases. Creates the issue with agent-run label for L0 loop execution."
argument-hint: [feature-topic-or-description]
allowed-tools: Read, Glob, Grep, Bash, Agent
---

## Role

This skill is an **orchestrator**. It spawns Task agents for proposal generation
and architect review. It does not write files or code directly.

The output of this skill is a **single GitHub Issue** in the L0 layered format,
ready for the L0 loop to execute sequentially (Phase A → B → … → N).

---

## Input

`/feature-to-issues <topic>`

`<topic>` is a description of the feature, including:
- What problem it solves
- Goals and non-goals (if known)
- Any design decisions already agreed upon

If `<topic>` is empty, print usage and stop.

---

## Phase 1: Generate Issue Body (via Task agent)

Spawn a Task agent with this prompt:

> You are drafting a GitHub Issue for the L0 agent queue. The issue format is:
>
> ```
> ## Background
> (why this feature is needed, 3-8 lines)
>
> ## Goals
> (numbered list of concrete outcomes)
>
> ## Phase A: <title>
> ### Task
> (what to implement, which files to modify, 3-6 lines)
> ### DoD
> - [ ] `<executable shell command>`
> - [ ] `<executable shell command>`
>
> ## Phase B: <title>
> ### Task
> ...
> ### DoD
> - [ ] `<executable shell command>`
>
> ## Constraints
> (global constraints applying to all phases)
>
> ## Acceptance Gate
> - [ ] `<final verification shell command>`
> ```
>
> Rules for ### DoD:
> - Every item MUST be an executable shell command that exits 0 on success
> - Use: `test -f <file>`, `grep -q <pattern> <file>`, `npm run type-check 2>&1 | grep -c "error TS" | grep -q "^0$"`
> - Non-verifiable criteria go in ## Constraints, NOT in ### DoD
> - Each phase should be ≤200 lines of code change
>
> Feature topic: <topic>
>
> Output only the raw issue body markdown. No preamble.

Store the generated body as `DRAFT_BODY`.

---

## Phase 2: Architect Review (via Task agent)

Spawn a Task agent with this prompt:

> Review the following GitHub Issue draft for an L0 agent queue task.
> Check:
> 1. Are all ### DoD items executable shell commands? If not, move them to ## Constraints.
> 2. Is each phase ≤200 lines of change? If a phase is too large, split it.
> 3. Are phases in the correct dependency order (earlier phases produce files later phases depend on)?
> 4. Is the Background accurate and the Goals measurable?
>
> Edit the draft directly and return the corrected version.
>
> Draft:
> <DRAFT_BODY>

Store the reviewed body as `FINAL_BODY`.

---

## Phase 3: Implementation State Check

For each `## Phase X` section in `FINAL_BODY`:

1. Extract the `### DoD` commands for that phase
2. Run each DoD command against the current `master` branch:
   ```bash
   git stash 2>/dev/null; git checkout master 2>/dev/null
   <dod-command>
   ```
3. If ALL DoD commands pass on master → phase is **already implemented**:
   - Replace the phase's `### DoD` section with:
     ```
     ### DoD
     - [ ] `echo "already-implemented-on-master"`
     ```
   - Add a note to `### Task`: `(Already implemented on master — this phase is a no-op.)`
4. If any DoD command fails → phase needs implementation (keep as-is)

After checking all phases, return to the working branch:
```bash
git checkout -
git stash pop 2>/dev/null || true
```

Update `FINAL_BODY` with the modified phase sections.

---

## Phase 4: Create GitHub Issue

```bash
gh issue create \
  --repo yaleh/archguard \
  --title "[L0] <feature-title>" \
  --label "agent-run" \
  --body "<FINAL_BODY>"
```

Where `<feature-title>` is a concise (≤70 chars) title derived from the topic.

Print the created issue URL.

---

## Phase 5: Human Review Prompt

After creating the issue, print:

```
Issue created: <URL>

IMPORTANT: Review the ### DoD commands in each phase before the L0 loop executes.
- Every DoD command must exit 0 when the phase is correctly implemented
- If a command is wrong, edit the issue directly on GitHub before triggering the loop
- To queue for execution: the issue already has the `agent-run` label
- To defer: remove the `agent-run` label and add it back when ready
```

---

## Constraints

- Do not apply `in-review` or `plan` labels — this skill creates execution-ready issues
- Do not create child issues — one issue per feature, all phases inline
- Do not implement any code — this skill only creates the planning artifact
- Phase count: minimum 1, maximum 8 per issue; split into multiple issues if more phases needed
- The skill must work from the project root of the archguard repository
