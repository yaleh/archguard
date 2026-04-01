# Plan 55 — Project Semantics Skill Authoring

> Proposal: `docs/proposals/proposal-project-semantics-skill-authoring.md`
> Status: Draft
> Priority: HIGH
> Test strategy: TDD per stage, plus real-project validation at each phase boundary

---

## Overview

This plan adds the repository-owned skill assets and installation flow needed to make project semantics discovery concrete.

After this plan:

- the repository ships a dedicated project semantics discovery skill
- the skill teaches an agent how to discover test conventions, assertion wrappers, and Mermaid layer knowledge
- the skill includes schema-valid examples
- the Claude user-scope installer syncs all repo-owned skills, not just one

The product boundary from Plan 54 remains unchanged:

- skills discover
- ArchGuard consumes

---

## Phase 1 — Establish skill delivery infrastructure

**Objective**

Make repository-owned skills shippable as a set instead of a single hard-coded directory.

**Dependencies**

- none

### Stage 1.1 — Add failing tests for multi-skill sync

**Files**

- `tests/unit/scripts/sync-claude-skills.test.ts` (new)
- `scripts/install-claude-user-scope.sh`

**TDD**

Write failing tests first for:

1. syncing all direct child skill directories from `.agents/skills/`
2. replacing stale target skill contents on re-sync
3. preserving unrelated directories outside the synced skill names

**Acceptance criteria**

- tests fail before implementation
- tests exercise the actual sync behavior, not just string matching in shell script

### Stage 1.2 — Implement reusable skill sync and wire installer

**Files**

- `scripts/sync-claude-skills.mjs` (new)
- `scripts/install-claude-user-scope.sh`
- `docs/user-guide/mcp-usage.md`

**Changes**

- implement a small script to sync all skills from `.agents/skills/` to a target skills dir
- update installer to invoke that script
- update docs to describe repo skill sync in plural

**Acceptance criteria**

- installer no longer hard-codes only `feature-developer`
- targeted tests pass

---

## Phase 2 — Add the project semantics discovery skill

**Objective**

Ship a dedicated skill with concise, evidence-first instructions and schema-valid examples.

**Dependencies**

- Phase 1

### Stage 2.1 — Add failing tests for skill assets and example contract

**Files**

- `tests/unit/skills/project-semantics-discovery-skill.test.ts` (new)
- `.agents/skills/project-semantics-discovery/` (new)

**TDD**

Write failing tests first for:

1. required skill files exist
2. bundled example semantics JSON parses with `ProjectSemanticsInputSchema`
3. skill instructions mention the three priority knowledge areas:
   - test discovery
   - assertion wrappers
   - package Mermaid grouping

**Acceptance criteria**

- tests fail before skill assets are created
- tests verify the real shipped artifacts

### Stage 2.2 — Implement the skill bundle

**Files**

- `.agents/skills/project-semantics-discovery/SKILL.md`
- optional references under `.agents/skills/project-semantics-discovery/references/`

**Changes**

- add the new skill
- keep `SKILL.md` concise and workflow-oriented
- move detailed examples into references if needed
- include an example sidecar payload matching current schema

**Acceptance criteria**

- tests pass
- skill does not mention product-owned discovery tools
- output contract matches Plan 54 semantics authoring contract exactly

---

## Phase 3 — Validate against the ArchGuard repository itself

**Objective**

Prove the shipped skill can guide the expected semantics authoring for this repository.

**Dependencies**

- Phase 2

### Stage 3.1 — Add or update verification for ArchGuard-specific semantics expectations

**Files**

- `tests/integration/project-semantics-sidecar.test.ts`
- `tests/unit/skills/project-semantics-discovery-skill.test.ts`

**TDD**

Write failing checks first for:

1. the skill example remains schema-valid
2. the documented ArchGuard layer mapping includes:
   - `src/analysis`
   - `src/cli`
   - `src/mermaid` or equivalent rendering layer wording

**Acceptance criteria**

- repository-specific expectations are encoded in tests or references, not left implicit

### Stage 3.2 — Real-project validation and architect review

**Validation**

Use the real ArchGuard repository to verify:

1. the skill’s documented layer knowledge produces Mermaid layer grouping
2. the documented test-discovery expectations match the repository layout
3. no evidence was found for repository-specific custom assertion wrappers unless the repo actually contains them

**Acceptance criteria**

- actual `analyze` run on ArchGuard confirms package grouping
- architect review confirms the implementation stays on the skill side of the boundary

---

## Final Acceptance Criteria

The plan is complete when all of the following are true:

- the repository ships a dedicated project semantics discovery skill
- the skill’s example semantics payload validates against `ProjectSemanticsInputSchema`
- the Claude installer syncs all repo-owned skills from `.agents/skills/`
- user docs describe the plural skill sync behavior
- real-project validation confirms the documented ArchGuard layer knowledge works in package-level Mermaid output
- no product-owned discovery path is reintroduced

---

## Verification Commands

```bash
npm test -- --reporter=verbose tests/unit/scripts/sync-claude-skills.test.ts
npm test -- --reporter=verbose tests/unit/skills/project-semantics-discovery-skill.test.ts
npm test -- --reporter=verbose tests/integration/project-semantics-sidecar.test.ts
npm run type-check
npm run build
npm test
```
