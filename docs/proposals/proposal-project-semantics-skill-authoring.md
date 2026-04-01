# Proposal: Project Semantics Skill Authoring

**Status**: Draft
**Date**: 2026-04-01
**Related**: `docs/proposals/proposal-skill-first-project-semantics.md`, `docs/plans/plan-54-skill-first-project-semantics.md`

---

## Problem Statement

ArchGuard has already been refactored so the product only loads, validates, merges, and consumes `projectSemantics`.

What is still missing is the other half of the architecture:

- which skill is responsible for discovering repository semantics
- what evidence that skill should collect
- how that skill should persist the resulting knowledge
- how the repository ships that skill to Claude user scope

Right now the repository only ships `.agents/skills/feature-developer/`. That means the product boundary is cleaner, but the workflow that should actually produce project semantics is still implicit.

This gap matters most in the three user-prioritized knowledge areas:

1. test discovery conventions
2. assertion wrapper recognition
3. package-level Mermaid grouping knowledge

Without an explicit skill, these areas remain dependent on ad hoc prompting instead of a stable repo-owned workflow.

---

## Goals

- Add a repository-owned skill dedicated to discovering and writing project semantics
- Keep the skill aligned with the skill-first product boundary:
  - skill discovers
  - ArchGuard consumes
- Make the skill output format exactly match `ProjectSemanticsInput`
- Ship the new skill alongside existing repo skills during Claude user-scope installation
- Validate the skill assets against the current schema and against the ArchGuard repository itself

---

## Non-Goals

- Do not reintroduce runtime discovery into ArchGuard
- Do not add discovery-specific ArchGuard MCP tools
- Do not make ArchGuard depend on the existence of a specific skill implementation
- Do not attempt to automate skill execution inside the product runtime

---

## Design

### 1. Add a dedicated repository skill

Introduce a new skill under:

- `.agents/skills/project-semantics-discovery/`

The skill should tell the agent to inspect the repository and produce either:

1. `.archguard/project-semantics.json`
2. `archguard.config.json.projectSemantics`

The preferred ephemeral target is the sidecar file. Durable project-maintained knowledge may be promoted into config later.

### 2. Scope the skill to the highest-value semantics only

The skill should not try to infer every possible field on every run.

Its primary workflow should focus on:

- `additionalTestPatterns`
  - only when defaults miss real test locations
- `customAssertionPatterns`
  - only when important assertion wrappers are not covered by plugin defaults
- `architecturalLayers`
  - especially for package-level Mermaid grouping

Secondary optional outputs:

- `nonProductionPatterns`
- `barrelFiles`
- `suggestedDepth`

This keeps the skill aligned with the user’s stated priorities and avoids speculative overfitting.

### 3. Require evidence-first authoring

The skill should explicitly collect evidence before writing semantics:

- enumerate actual test file locations
- inspect plugin defaults and compare against repository-specific patterns
- search for custom assertion helpers or wrapper APIs
- inspect top-level and second-level package boundaries under `src/`
- produce only fields supported by real evidence

The skill must not invent discovery metadata, confidence scores, or hidden wrapper objects.

### 4. Ship schema-aware examples and validation hooks

The repository should include:

- the skill itself
- a reference example JSON payload matching `ProjectSemanticsInput`
- automated tests that parse the example through `ProjectSemanticsInputSchema`

This keeps the skill artifact honest: if the schema changes, the example and tests fail.

### 5. Install all repository-owned skills, not just one hard-coded skill

The current install flow only copies:

- `.agents/skills/feature-developer`

That is too narrow once project semantics discovery becomes a first-class repository skill.

The repository should instead sync all direct child skill directories from:

- `.agents/skills/`

into:

- `~/.claude/skills/`

This avoids repeating installer changes every time a new repo-owned skill is added.

### 6. ArchGuard-specific expected knowledge

For the ArchGuard repository itself, the skill should be able to discover at least the following evidence-backed knowledge.

Test discovery:

- primary tests live under `tests/**/*.test.ts`
- one in-source test subtree exists under `src/cli/utils/__tests__/`
- nested `tests/poc/**/node_modules/**` content is third-party noise and should not be treated as first-party conventions

Assertion recognition:

- the dominant assertion API is Vitest `expect(...)`
- there is no strong evidence of first-party custom assertion wrapper APIs that must be added to `customAssertionPatterns`
- therefore the correct output for ArchGuard may omit `customAssertionPatterns` entirely unless new wrappers are introduced

Package Mermaid grouping:

- `src/analysis` forms an analysis-oriented layer
- `src/cli` forms a CLI/application orchestration layer
- `src/mermaid` forms a rendering/diagram layer

Additional optional FIM-oriented hints may include:

- non-production directories such as `tests`, `docs`, `scripts`
- barrel files like `src/types/index.ts` and `src/types/extensions/index.ts`
- a suggested package depth based on the observed `src/*` / `src/*/*` structure

### 7. Validation approach

Validation should happen at three levels:

1. repository tests:
   - skill assets exist
   - example JSON parses as `ProjectSemanticsInput`
   - installer syncs all repo skills
2. real-project validation:
   - use the skill’s example semantics shape on ArchGuard itself
   - confirm package-level Mermaid grouping is affected as expected
3. architect review:
   - confirm no product-owned discovery logic is reintroduced
   - confirm the skill stays focused on repository discovery, not product runtime coupling

---

## Alternatives

### Alternative A — Keep semantics discovery inside generic feature-developer

Rejected.

That would leave project semantics discovery implicit and mixed with unrelated feature workflow concerns. The user requirement is more specific: semantics discovery should be skill-led and explicit.

### Alternative B — Add ArchGuard discovery tools for the skill

Rejected.

This contradicts the accepted boundary from the skill-first project semantics proposal. The skill should use host filesystem/search capabilities unless a future need proves otherwise.

### Alternative C — Ship no new skill, only documentation

Rejected.

Documentation alone does not create a reusable, repo-owned discovery workflow.

---

## Open Questions

- Should the repository also ship a Codex-facing copy or alias of the same skill layout, or is `.agents/skills/` plus Claude installation sufficient for now?
- Should we later add a durable checked-in example semantics file for ArchGuard itself under `docs/examples/`, or keep examples inside the skill bundle only?
