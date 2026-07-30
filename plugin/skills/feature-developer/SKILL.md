---
name: feature-developer
description: "Execute the full feature development lifecycle for a new feature or substantial change: generate a proposal from discussion or requirements, review and refine the proposal, generate and review an implementation plan, then implement the plan with TDD and validate the result. Use when given a feature discussion, requirements, or existing proposal/plan documents that should be turned into reviewed design docs and working code."
---

## Role

This skill is primarily an orchestrator for a multi-phase delivery workflow.

- Prefer delegating review and implementation work to Codex subagents or isolated worktrees when they are available.
- If subagents or worktrees are not available in the current Codex environment, perform the same steps directly rather than skipping phases.
- Do not skip phases just because the caller provides detailed implementation ideas. Treat those as input to the proposal and plan.

If the caller provides detailed design specs such as class names, method signatures, rules, or API ideas, treat that as discussion input rather than a replacement for proposal and plan documents.

## Workflow

Complete phases in order. A later phase must not begin until the prior phase's gate passes.

### Phase 3: Generate proposal

Trigger this phase when `docs/proposals/proposal-<slug>.md` does not exist.

If the proposal already exists, skip to Phase 4.

Steps:

1. Derive `<slug>` from the feature topic using lowercase hyphenated words.
2. Read the relevant source files for the affected feature area before drafting.
3. Create `docs/proposals/proposal-<slug>.md` with this structure:
   - Problem Statement
   - Goals
   - Non-Goals
   - Design
   - Alternatives
   - Open Questions
4. Ground every design decision in actual repository paths, classes, interfaces, and existing behavior.
5. Do not invent APIs, types, methods, or paths that do not exist unless the proposal is explicitly introducing them as new work.
6. Run this gate and stop if it fails:

```bash
test -f docs/proposals/proposal-<slug>.md || { echo "GATE FAILED: proposal missing"; exit 1; }
```

### Phase 4 and 5: Proposal review loop

Before starting, run:

```bash
test -f docs/proposals/proposal-<slug>.md || { echo "STOP: proposal missing, return to Phase 3"; exit 1; }
```

Run at least 2 review rounds, even if the first round finds nothing.

Before each round `N`, create a marker:

```bash
mkdir -p .agents/review && touch .agents/review/proposal-round-N.pending
```

After findings are applied, rename it:

```bash
mv .agents/review/proposal-round-N.pending .agents/review/proposal-round-N.done
```

Before leaving the loop, confirm both rounds completed:

```bash
ls .agents/review/proposal-round-1.done .agents/review/proposal-round-2.done 2>/dev/null | wc -l
```

Each round:

1. Review the proposal against the real codebase from the perspective of a strict architect (`以一个严苛的架构师的视角`).
2. Read every source file, interface, and type referenced in the proposal.
3. Verify:
   - API surface correctness
   - Interface contracts
   - Dependency accuracy
   - Implementation feasibility
   - Naming consistency with repository conventions
   - Absence of phantom types, methods, and paths
   - Edge cases, constraints, and error handling
4. Produce a prioritized issue list: `critical`, `warning`, `suggestion`.
5. Apply only confirmed fixes. Do not rewrite sections that are already correct.

Exit only when both round markers exist and no `critical` or `warning` issues remain.

### Phase 6: Generate plan

Before starting, run:

```bash
test -f docs/proposals/proposal-<slug>.md || { echo "STOP: proposal missing, return to Phase 3"; exit 1; }
```

If a plan already exists for the feature, continue from the most appropriate current plan rather than generating a duplicate unless the user asked for a new numbered plan.

Steps:

1. Determine the next plan number `NN`:

```bash
ls docs/plans/plan-*.md 2>/dev/null | sed 's/.*plan-//' | sed 's/-.*//' | sort -n | tail -1
```

2. Read the approved proposal and create `docs/plans/plan-NN-<slug>.md`.
3. Structure the plan as:
   - Overview
   - Phases
   - Per phase: objectives, stages, acceptance criteria, dependencies
4. Make each stage independently testable and TDD-first.
5. Write the immediate phase in full detail. Future phases may stay at objective level if detailed sequencing would be premature.
6. Keep all file paths, class names, and interfaces aligned with the real codebase.
7. Run this gate and stop if it fails:

```bash
test -f docs/plans/plan-NN-<slug>.md || { echo "GATE FAILED: plan missing"; exit 1; }
```

### Phase 7 and 8: Plan review loop

Before starting, run:

```bash
test -f docs/proposals/proposal-<slug>.md && test -f docs/plans/plan-NN-<slug>.md || { echo "STOP: missing files, return to appropriate phase"; exit 1; }
```

Run at least 2 review rounds.

Before each round `N`, create:

```bash
mkdir -p .agents/review && touch .agents/review/plan-round-N.pending
```

After findings are applied:

```bash
mv .agents/review/plan-round-N.pending .agents/review/plan-round-N.done
```

Before leaving the loop, confirm both rounds completed:

```bash
ls .agents/review/plan-round-1.done .agents/review/plan-round-2.done 2>/dev/null | wc -l
```

Each round:

1. Review both the proposal and the plan from the perspective of a strict architect (`以一个严苛的架构师的视角`).
2. Read all source files, interfaces, and types referenced in the plan.
3. Verify:
   - Phases are complete, non-overlapping, and correctly sequenced
   - Each stage has concrete acceptance criteria
   - Each stage has a clear test strategy
   - No implementation detail contradicts the proposal
   - All referenced files, classes, and interfaces exist or are explicitly planned additions
4. Produce a prioritized issue list: `critical`, `warning`, `suggestion`.
5. Fix confirmed issues in the plan. If a plan fix changes proposal intent, sync the proposal as well.

Exit only when both round markers exist and no `critical` or `warning` issues remain.

### Phase 9: Implementation

Before starting, run:

```bash
test -f docs/plans/plan-NN-<slug>.md || { echo "STOP: plan missing, return to Phase 6"; exit 1; }
```

Execution rules:

- Execute phases sequentially. Phase `N+1` starts only after Phase `N` tests pass.
- Within a phase, prefer parallel execution for independent stages by using isolated worktrees or parallel Codex subagents when available.
- Follow TDD for each stage: write or update a failing test first, then implement until it passes.
- Keep implementation aligned with the approved proposal and plan unless a discovered constraint requires updating those documents first.

Validation after implementation:

1. Run the project's build or validation command, for example `npm run build`, or the closest project-equivalent.
2. Verify every stage's acceptance criteria against the implementation.
3. Check for unintended regressions in existing tests and behavior.
4. If gaps remain, fix them and re-run validation until the plan converges.
