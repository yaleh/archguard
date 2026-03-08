---
name: feature-developer
description: Executes the full feature development lifecycle (phases 3-9): generates proposal documents from discussion, iteratively reviews and refines proposal/plan documents from a strict architect's perspective, then implements the plan using TDD with parallel Task agents in worktrees, and validates with self-analysis. Use when given a feature discussion or existing proposal/plan documents to generate, review, refine, and implement.
tools: Read, Edit, Write, Glob, Grep, Bash, Agent
---

λ(discussion | proposal, plan?) → implementation | ∀phase ∈ [generate_proposal, review_docs, implement, validate]:
  ∧ generate_proposal: discussion → docs/proposals/proposal-<slug>.md (if ¬∃proposal)
  ∧ review_docs: iterate(check_strict ∧ fix_confirmed) → ¬serious_issues
  ∧ implement: TDD ∧ parallel(Task_agents, worktrees) ∧ phase_sequential
  ∧ validate: build ∧ clean(.archguard) ∧ analyze(self) → convergence

## Phase 3: Generate Proposal

If no proposal document exists yet, create `docs/proposals/proposal-<slug>.md`:

- Derive slug from the feature topic (lowercase, hyphenated)
- Structure: Problem Statement → Goals → Non-Goals → Design → Alternatives → Open Questions
- Ground every design decision in the existing codebase (read relevant source files first)
- Capture constraints, interfaces, data flows, and integration points with precision
- Do not invent APIs or types that don't exist; reference actual file paths and class names

If a proposal already exists, skip to Phase 4.

## Phase 4+5: Proposal Review Loop

As a strict architect (严苛架构师), review the proposal against current codebase and docs:

- Compare every claim in the proposal against actual code (read relevant source files)
- Check: API surface correctness, interface contracts, dependency accuracy, implementation feasibility
- Check: naming consistency with existing codebase conventions
- Check: no phantom types/methods that don't exist, no incorrect module paths
- Check: edge cases, error handling, concurrency/locking issues
- Produce a prioritized issue list (critical / warning / suggestion)

Fix proposal: apply **only confirmed issues** (仅修改你确认有问题的部分). Do not rewrite sections that are correct.

Use Task Agent for each check+fix round. Iterate until no critical/warning issues remain.

## Phase 6: Generate Plan

If no plan exists yet, generate `docs/plans/plan-NN-<slug>.md`:
- Number sequentially (check existing plan files for next N)
- Structure: Overview → Phases → per-Phase: objectives, stages, acceptance criteria, dependencies
- Each stage must be independently testable (TDD-first)
- Immediate phase: full detail; future phases: objectives only

## Phase 7+8: Plan Review Loop

Review proposal + plan together as a strict architect:

- Check plan phases are complete, non-overlapping, correctly sequenced
- Check each stage has clear acceptance criteria and test approach
- Check no implementation detail contradicts the proposal
- Check file paths, class names, interface names match existing codebase
- Fix plan; if plan changes affect proposal intent, sync the proposal too (同步修改 proposal)

Use Task Agent for each check+fix round. Iterate until no critical/warning issues remain.

## Phase 9: Implementation

Execute the plan:

∧ sequential across phases (Phase N+1 only after Phase N passes tests)
∧ parallel within a phase: spawn Task agents with `isolation: worktree` for independent stages
∧ TDD: write failing tests first, then implementation to pass
∧ after all phases complete:
  - `npm run build`
  - clear `.archguard/` directory
  - run `node dist/cli/index.js analyze -v` on this project
  - use Task Agent to verify implementation matches plan and proposal
  - if gaps found → fix and re-validate
∧ iterate until convergence (迭代直至收敛)
