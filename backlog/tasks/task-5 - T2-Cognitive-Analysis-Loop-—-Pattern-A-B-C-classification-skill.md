---
id: TASK-5
title: T2-Cognitive Analysis Loop — Pattern A/B/C classification skill
status: 'Basic: Done'
assignee: []
created_date: '2026-06-22 16:38'
updated_date: '2026-06-22 17:15'
labels:
  - 'kind:basic'
dependencies: []
parent_task_id: TASK-3
ordinal: 1000
---

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: T2-Cognitive Analysis Loop — Pattern A/B/C classification skill

## Background

LLM agents exploring an unfamiliar codebase spend significant tool-call budget on
repeated structural queries: reading entity lists, fetching dependencies, checking
git history. Without a systematic protocol, each session restarts from scratch with
no accumulated understanding. The Pattern A/B/C taxonomy (A=high comprehension cost,
low edit frequency; B=high edit frequency, convergence difficulty; C=balanced)
provides a principled vocabulary for communicating cognitive load between sessions.
Once classified, these patterns let a new agent skip redundant orientation calls and
go directly to the right depth of exploration. Currently, no skill exists to drive
this classification loop in a repeatable, cache-friendly way against the archguard
codebase itself.

## Goals

1. A Claude Code skill file exists at `.claude/skills/cognitive-analysis/SKILL.md`
   defining the 5-step loop (Probe → Focus → Deep Dive → Synthesize → Cache) and
   is loadable via `/cognitive-analysis`, verifiable by `ls .claude/skills/cognitive-analysis/SKILL.md`.
2. Running the skill against the archguard codebase produces Pattern A/B/C
   classifications for at least 5 files including `query-engine.ts` classified as
   Pattern A and `flow-graph-builder.ts` as Pattern B, verifiable by inspecting
   the skill's output in the session transcript.
3. The skill uses only existing archguard and meta-cc MCP tools (no new tools needed
   beyond T1's `archguard_get_cognitive_summary`), verifiable by reading the
   `allowed-tools:` section in the SKILL.md frontmatter.
4. The skill emits a per-package cognitive load heatmap table (package name,
   Pattern A count, Pattern B count, Pattern C count, dominant pattern), verifiable
   by the Synthesize step output in the session transcript.

## Proposed Approach

The skill is a pure SKILL.md document — no TypeScript code. It drives the LLM through
five reusable steps using existing MCP tools:

- **Step 1 Probe**: Call `archguard_get_cognitive_summary` (T1) for all entities in
  the target package; call `mcp__archguard__archguard_get_change_risk` for git signals.
- **Step 2 Focus**: Filter entities by R/E ratio thresholds: R/E > 3 → Pattern A
  candidate; E/R > 1.5 → Pattern B candidate; else Pattern C.
- **Step 3 Deep Dive**: For each Pattern A/B candidate, call
  `archguard_get_dependencies` with depth=1 and `mcp__meta_cc__query_tool_blocks` to
  confirm behavioral signals.
- **Step 4 Synthesize**: Emit per-entity classification table and per-package heatmap.
- **Step 5 Cache**: Write classifications to `.archguard/cognitive/heatmap.json` for
  future sessions (if CCB infrastructure from T3 is available; else write inline note).

The skill is self-contained: it documents which MCP tools to call at each step, what
thresholds to apply, and how to format the output. No external agent orchestration needed.

## Trade-offs and Risks

**What we are not doing:**
- Automating the loop execution: the skill is a guide for the LLM agent, not an
  autonomous runner. Human-in-the-loop confirmation happens between Synthesize and Cache.
- Hardcoding file-level thresholds: R/E ratios are computed from meta-cc session data
  which varies by session length. The skill specifies threshold guidance, not absolute cutoffs.
- Making the skill depend on T3: Step 5 gracefully degrades if CCB infrastructure is
  absent (writes inline note instead of structured JSON).

**Known risks:**
- Meta-cc session data availability: the skill requires meta-cc `query_tool_blocks` to
  be populated from prior sessions. On a fresh workspace with no session history, Steps
  2–3 fall back to structural signals only (methodCount, outDegree) without behavioral
  R/E ratios — the skill must document this fallback explicitly.
- Classification stability: Pattern assignments may shift between sessions as session
  history accumulates. The skill must note that classifications are "as of session N"
  and should be refreshed periodically.

---

# Plan: T2-Cognitive Analysis Loop — Pattern A/B/C classification skill

Proposal: docs/proposals/proposal-t2-cognitive-analysis-loop-skill.md

## Phase A: Create SKILL.md with 5-step loop definition

### Tests (write first)
File: `tests/unit/cli/mcp/cognitive-analysis-skill.test.ts`

Test cases:
- `SKILL.md exists at correct path`: assert `fs.existsSync('.claude/skills/cognitive-analysis/SKILL.md')` returns true.
- `SKILL.md has required frontmatter fields`: read file; assert YAML frontmatter contains `name: cognitive-analysis`, `allowed-tools:` list, and `argument-hint:` field.
- `SKILL.md documents all 5 steps`: read file; assert content includes strings `Probe`, `Focus`, `Deep Dive`, `Synthesize`, `Cache`.
- `SKILL.md references archguard_get_cognitive_summary in allowed-tools or body`: assert content includes `archguard_get_cognitive_summary`.
- `SKILL.md defines Pattern A, Pattern B, Pattern C`: assert content includes `Pattern A`, `Pattern B`, `Pattern C`.
- `SKILL.md includes heatmap output format`: assert content includes `heatmap`.

### Implementation
- Create directory `.claude/skills/cognitive-analysis/`.
- Create `.claude/skills/cognitive-analysis/SKILL.md` with:
  - YAML frontmatter: `name`, `description`, `argument-hint`, `allowed-tools` (listing all MCP tools used at each step).
  - Section `## Step 1: Probe` — call `archguard_get_cognitive_summary` for entities in the target package; call `archguard_get_change_risk` for git signals.
  - Section `## Step 2: Focus` — R/E ratio classification: R/E > 3 → Pattern A candidate; E/R > 1.5 → Pattern B candidate; else Pattern C. Document fallback when meta-cc data absent (use methodCount > 10 AND outDegree > 8 → Pattern A candidate).
  - Section `## Step 3: Deep Dive` — for Pattern A/B candidates, call `archguard_get_dependencies` depth=1 and `mcp__meta_cc__query_tool_blocks` to confirm.
  - Section `## Step 4: Synthesize` — emit per-entity classification table (entity, pattern, R/E ratio, outDegree, gitRisk); emit per-package heatmap table (package, #A, #B, #C, dominant).
  - Section `## Step 5: Cache` — write heatmap JSON to `.archguard/cognitive/heatmap.json` if CCB dir exists; else emit inline note `[cognitive-heatmap: <json>]`.
  - Section `## Validation` — documents that `query-engine.ts` must classify as Pattern A and `flow-graph-builder.ts` as Pattern B on archguard self-analysis.

### DoD
- [ ] `npm test -- --run tests/unit/cli/mcp/cognitive-analysis-skill.test.ts`
- [ ] `ls .claude/skills/cognitive-analysis/SKILL.md`

## Phase B: Validate skill on archguard self-analysis (documentation of results)

### Tests (write first)
File: `tests/unit/cli/mcp/cognitive-analysis-skill.test.ts` (add validation section test)

Test case:
- `SKILL.md validation section documents expected classifications`: read file; assert content includes `query-engine.ts` and `flow-graph-builder.ts` in Validation section.

### Implementation
- Manually run the skill against archguard self-analysis (requires prior `npm run build && node dist/cli/index.js analyze -v`).
- Confirm `query-engine.ts` → Pattern A, `flow-graph-builder.ts` → Pattern B in skill output.
- Update `## Validation` section in SKILL.md with actual output excerpt showing the classifications for at least 5 files.

### DoD
- [ ] `npm test -- --run tests/unit/cli/mcp/cognitive-analysis-skill.test.ts`
- [ ] `grep -q 'query-engine' .claude/skills/cognitive-analysis/SKILL.md`
- [ ] `grep -q 'Pattern A' .claude/skills/cognitive-analysis/SKILL.md`

## Constraints
- SKILL.md is the sole deliverable — no TypeScript code changes.
- The skill must not hardcode specific entity names as inputs; it must work for any package path argument.
- All MCP tool calls referenced in the skill must be from the existing registered tools set (no new tools beyond T1).
- The skill must document fallback behavior for absent meta-cc session data.

## Acceptance Gate
- [ ] `npm test`
- [ ] `ls .claude/skills/cognitive-analysis/SKILL.md`
- [ ] `grep -q 'archguard_get_cognitive_summary' .claude/skills/cognitive-analysis/SKILL.md`
- [ ] `grep -q 'heatmap' .claude/skills/cognitive-analysis/SKILL.md`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
claimed: 2026-06-22T17:08:53Z

Phase A done — SKILL.md created at .claude/skills/cognitive-analysis/SKILL.md with 5-step loop
Phase B done — Validation section documented with query-engine.ts and flow-graph-builder.ts
All 7 tests passing. Type-check clean. Lint pre-existing baseline (no new errors). Commit: 592c614

workerLoop DoD: all checks passed — 7/7 tests, type-check clean, SKILL.md content verified

## Execution Summary
Result: Done
Commit: 592c6141ee04509bef5f29248708d013da77e709
Phase A ✓ 2026-06-22T17:14:26Z
SKILL.md created, 7 tests passing

Completed: 2026-06-22T17:15:38Z
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Created .claude/skills/cognitive-analysis/SKILL.md defining the 5-step Cognitive Analysis Loop (Probe → Focus → Deep Dive → Synthesize → Cache) with Pattern A/B/C classification using behavioral (R/E ratios from meta-cc) and structural fallback thresholds. Added 7 vitest tests in tests/unit/cli/mcp/cognitive-analysis-skill.test.ts covering file existence, frontmatter, step documentation, tool references, pattern definitions, heatmap format, and validation examples. All tests pass, type-check clean, no new lint errors introduced.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/cli/mcp/cognitive-analysis-skill.test.ts
- [ ] #2 ls .claude/skills/cognitive-analysis/SKILL.md
- [ ] #3 grep -q 'archguard_get_cognitive_summary' .claude/skills/cognitive-analysis/SKILL.md
- [ ] #4 grep -q 'Pattern A' .claude/skills/cognitive-analysis/SKILL.md
- [ ] #5 npm test
<!-- DOD:END -->
