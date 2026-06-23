---
id: TASK-12
title: 'ADR compliance checker: mechanical script for ADR-006 and ADR-007'
status: 'Basic: Done'
assignee: []
created_date: '2026-06-23 06:28'
updated_date: '2026-06-23 07:28'
labels:
  - 'kind:basic'
dependencies: []
references:
  - docs/proposals/proposal-adr-compliance-checker.md
  - docs/adr/006-mcp-tool-design-standards.md
  - docs/adr/007-cli-mcp-interface-parity.md
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement a mechanical (no-LLM) TypeScript script scripts/check-adr.ts that checks ADR-006 (verb-first tool descriptions) and ADR-007 (CLI/MCP parity) on every commit. Includes suppression annotation `// adr-ok: ADR-NNN — reason`, Claude Code Stop hook integration.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: ADR Compliance Checker — mechanical script for ADR-006 and ADR-007

## Background

ArchGuard has 8 ADRs (`docs/adr/001–008`) that establish architectural contracts ranging from naming conventions to CLI/MCP parity. Compliance is currently enforced through manual review: a developer or LLM session reads the ADR text, formulates grep patterns, and reasons about whether findings are real violations. This happens episodically — roughly once per development cycle — meaning violations can accumulate undetected between sessions.

Two structural problems make manual review insufficient:

1. **High cost per check**: Each manual ADR review requires an LLM session to interpret constraints and evaluate findings. At current review frequency, the cost-per-check is high enough that checks are skipped under time pressure.
2. **LLM cannot be in the git commit hot path**: Running LLM analysis on every commit is prohibitively slow (latency) and expensive (token cost). The mechanical parts of compliance — naming patterns, structural set membership — do not require LLM reasoning and can run in milliseconds.

A concrete gap was observed on 2026-06-14: two tools (`archguard_get_file_entities`, `archguard_get_change_context`) were documented as ADR-006 violations ("Get"-prefix descriptions) in the ADR's own status table, yet no commit-time check existed to surface them. The proposal addresses this gap for the two mechanically verifiable ADRs (006 and 007), while deliberately excluding the six ADRs that require runtime or LLM-level judgment.

## Goals

1. `npm run check:adr` exits 0 on the current codebase; a commit that introduces a bare `"Get ..."` description or an MCP tool without a matching CLI flag is blocked with an actionable error message — verifiable by inspecting the exit code and output.
2. A suppression annotation `// adr-ok: ADR-NNN — <reason>` in the 3 lines preceding a violation causes `check-adr.ts` to skip that violation; bare `// adr-ok` or annotations without a reason string do not qualify — verifiable by unit tests.
3. `.claude/settings.json` contains a `Stop` hook that runs `check-adr.ts` and surfaces violation lines to the current Claude Code session; clean runs produce no hook output — verifiable by inspecting the settings file and running the hook manually.

## Proposed Approach

### Tier 1 — `scripts/check-adr.ts`

A single TypeScript script with two check functions returning a common `Violation` interface. Invoked via `npm run check:adr` (uses `tsx`). No LLM invocation.

**ADR-006 check**: Glob `src/cli/mcp/**/*.ts`, scan each line for `'description', "<text>"` patterns, flag any description whose trimmed text starts with `Get` (case-insensitive).

**ADR-007 check**: Extract MCP tool names from `src/cli/mcp/` (grep for `server.tool(` calls), extract CLI flags from `src/cli/commands/query.ts` (grep for `.option('--`). Normalize both sides: strip `archguard_` prefix, replace `_` with `-`, allow singular/plural equivalence. Flag MCP tools with no matching CLI flag.

**Suppression filter**: Before reporting, scan the 3 lines preceding each violation's line in its file for a comment matching `/\/\/\s*adr-ok:\s*ADR-\d+\s*—\s*\S+/` that also contains the specific ADR number.

**Exit behavior**: Exit 0 when all violations are suppressed or absent; exit 1 with structured output when any unsuppressed violation remains.

### Tier 2 — `package.json` script + git pre-commit hook

Add `"check:adr": "tsx scripts/check-adr.ts"` to `package.json`. Provide `.git/hooks/pre-commit` that calls `npm run check:adr` (installed manually with `chmod +x`).

### Tier 3 — Claude Code Stop hook

Add a `Stop` hook in `.claude/settings.json` that runs `npm run check:adr 2>&1 | grep -E 'violation|VIOLATION|exit 1' | head -10 || true`. Clean runs produce no output to avoid session noise.

### ADR documentation update

Add a `## Mechanical Check` section to both `docs/adr/006-mcp-tool-design-standards.md` and `docs/adr/007-cli-mcp-interface-parity.md` listing the script assertions each ADR corresponds to.

## Trade-offs and Risks

**What we are not doing**: ADRs 001–005 and 008 have no mechanical check. ADR-001 (interface impl), ADR-002 (field access patterns), ADR-003 (SVG rendering), ADR-004 (write path), ADR-005 (runtime behaviour), and ADR-008 (LLM interaction) all require integration tests or LLM reasoning over control flow — they are out of scope.

**Suppression abuse risk**: A developer could write `// adr-ok: ADR-007 — TODO` to silence a check without genuine resolution. The reason regex requires at least one non-whitespace word after `—`, which filters trivially empty reasons but does not prevent `TODO`. Code review of suppression annotations in PRs provides the human backstop.

**Name normalisation brittleness**: The ADR-007 parity check uses heuristic matching (prefix strip, singular/plural). Edge cases (abbreviations, compound words) may produce false positives. The suppression mechanism handles false positives; missed real violations are caught in periodic manual ADR review.

**Stop hook output volume**: If violations accumulate, the hook will emit output on every Claude response. The `grep -E 'violation|exit 1' | head -10 || true` pipe limits noise to 10 lines and never blocks the session.

---

# Plan: ADR compliance checker — mechanical script for ADR-006 and ADR-007

Proposal: docs/proposals/proposal-adr-compliance-checker.md

## Phase A: ADR-006 checker + suppression annotation core

### Tests (write first)

File: `tests/unit/scripts/check-adr.test.ts`

Test cases to add (all must fail before implementation):

- `checkAdr006()` returns no violations when no description starts with "Get"
- `checkAdr006()` returns a Violation when a description string starts with "Get "
- `checkAdr006()` is case-insensitive: "get " triggers violation
- `checkAdr006()` does NOT flag descriptions starting with other verbs (Return, Detect, Find)
- `hasSuppression(violation)` returns true when a valid `// adr-ok: ADR-006 — reason` annotation appears in the 3 lines before the violation
- `hasSuppression(violation)` returns false for bare `// adr-ok` (no ADR number, no reason)
- `hasSuppression(violation)` returns false for `// adr-ok: ADR-006` (missing reason after —)
- `hasSuppression(violation)` returns false when annotation has wrong ADR number (`// adr-ok: ADR-007 — reason` does not suppress an ADR-006 violation)
- `filterViolations(violations)` removes suppressed violations and keeps unsuppressed ones
- `checkAdr006()` returns 0 violations on the real `src/cli/mcp/` directory (current codebase must be clean or all violations suppressed)

### Implementation

Files to create or modify:

- **Create** `scripts/check-adr.ts`:
  - `interface Violation { adr: string; file: string; line: number; message: string; evidence: string }`
  - `function extractDescriptions(filePath: string): Array<{text: string; line: number}>` — scans file for `'description',\s*["'\`](.+?)["'\`]` pattern
  - `function checkAdr006(): Violation[]` — globs `src/cli/mcp/**/*.ts`, calls `extractDescriptions`, flags text starting with `/^get\s/i`
  - `function hasSuppression(v: Violation, fileLines: string[]): boolean` — checks 3 lines before `v.line` for `/\/\/\s*adr-ok:\s*ADR-\d+\s*—\s*\S+/` AND string contains `v.adr`
  - `function filterViolations(violations: Violation[]): Violation[]` — reads file once, applies `hasSuppression` to each violation
  - Main block: runs checks, prints results, exits 1 on any unsuppressed violation

- **Modify** `package.json`:
  - Add `"check:adr": "tsx scripts/check-adr.ts"` to `scripts`

### DoD

- [ ] `npm test -- --run tests/unit/scripts/check-adr.test.ts`
- [ ] `npm run check:adr` exits 0 on current codebase (no unsuppressed violations)
- [ ] `grep -q '"check:adr"' package.json`

---

## Phase B: ADR-007 checker (CLI/MCP parity)

### Tests (write first)

File: `tests/unit/scripts/check-adr.test.ts` (extend existing test file)

Test cases to add:

- `extractMcpToolNames()` returns all tool names found via `server.tool(` calls in `src/cli/mcp/` (at least 20 tools)
- `extractCliFlags()` returns all `--flag` names from `src/cli/commands/query.ts` (at least 15 flags)
- `toCanonical('archguard_get_atlas_layer')` returns `'atlas-layer'`
- `toCanonical('--atlas-layer')` returns `'atlas-layer'`
- `toCanonical('--atlas-layers')` returns `'atlas-layers'` (plural preserved for matching)
- `checkAdr007()` returns no violations when every MCP tool has a matching CLI flag (current codebase is fully compliant per ADR-007 table)
- `checkAdr007()` detects a missing CLI flag for a synthetic MCP tool name `archguard_fake_tool`
- `checkAdr007()` accepts plural CLI flag as match for singular MCP tool: `archguard_get_atlas_layer` matched by `--atlas-layers`
- `hasSuppression()` correctly suppresses ADR-007 violations with valid `// adr-ok: ADR-007 — reason` annotation

### Implementation

Files to modify:

- **Modify** `scripts/check-adr.ts`:
  - Add `function extractMcpToolNames(mcpDir: string): string[]` — reads all `.ts` files in `mcpDir`, greps for `server\.tool\(\s*['"]([^'"]+)['"]`, returns matched tool name strings
  - Add `function extractCliFlags(queryFile: string): string[]` — reads `queryFile`, greps for `\.option\(\s*'(--[^',\s<[]+)`, returns matched flag strings
  - Add `function toCanonical(nameOrFlag: string): string` — strips `archguard_` prefix, replaces `_` with `-`, strips leading `--`
  - Add `function checkAdr007(): Violation[]` — computes canonical MCP names, checks each against canonical CLI flags (also checks `canonical + 's'` for plural match), returns violations for unmatched tools. File is `src/cli/mcp/` (dir-level, line 0) for violations.
  - Extend main block to call `checkAdr007()` and include results in exit logic

### DoD

- [ ] `npm test -- --run tests/unit/scripts/check-adr.test.ts`
- [ ] `npm run check:adr` exits 0 on current codebase (all 22 MCP tools matched or suppressed)

---

## Phase C: Claude Code Stop hook + ADR doc updates

### Tests (write first)

File: `tests/unit/scripts/check-adr.test.ts` (extend)

Test cases to add:

- `docs/adr/006-mcp-tool-design-standards.md` contains the string `## Mechanical Check` — verifiable by reading the file
- `docs/adr/007-cli-mcp-interface-parity.md` contains the string `## Mechanical Check` — verifiable by reading the file
- `.claude/settings.json` contains a Stop hook entry referencing `check:adr` — verifiable by reading the file

File: `tests/unit/scripts/check-adr-integration.test.ts` (new file, integration-style but file-based)

Test cases to add:

- Running `check-adr.ts` with a synthetic fixture directory containing a file with `description: "Get something"` produces a violation and exits 1
- Running `check-adr.ts` with a synthetic fixture where the violation has a valid suppression annotation produces exit 0 and "suppressed" in stdout
- Running `check-adr.ts` with a clean synthetic fixture produces "all checks passed" and exits 0

### Implementation

Files to create or modify:

- **Create** `.claude/settings.json`:
  ```json
  {
    "hooks": {
      "Stop": [{
        "type": "command",
        "command": "npm run check:adr 2>&1 | grep -E 'violation|VIOLATION|exit 1' | head -10 || true"
      }]
    }
  }
  ```

- **Modify** `docs/adr/006-mcp-tool-design-standards.md`:
  - Append `## Mechanical Check` section: "ADR-006 is enforced by `scripts/check-adr.ts` via `npm run check:adr`. The check scans `src/cli/mcp/**/*.ts` for tool descriptions starting with `Get` (case-insensitive). Violations can be suppressed with `// adr-ok: ADR-006 — <reason>`."

- **Modify** `docs/adr/007-cli-mcp-interface-parity.md`:
  - Append `## Mechanical Check` section: "ADR-007 §4 (interface extension symmetry) is enforced by `scripts/check-adr.ts` via `npm run check:adr`. The check extracts MCP tool names from `src/cli/mcp/` and CLI flags from `src/cli/commands/query.ts`, normalises both sides (strip `archguard_` prefix, `_` to `-`, singular/plural equivalence), and flags MCP tools with no matching CLI flag. Violations can be suppressed with `// adr-ok: ADR-007 — <reason>`."

- Provide `.git/hooks/pre-commit` installation instructions in `scripts/check-adr.ts` header comment (no automated installation — manual step).

### DoD

- [ ] `npm test -- --run tests/unit/scripts/check-adr.test.ts`
- [ ] `npm test -- --run tests/unit/scripts/check-adr-integration.test.ts`
- [ ] `grep -q '## Mechanical Check' docs/adr/006-mcp-tool-design-standards.md`
- [ ] `grep -q '## Mechanical Check' docs/adr/007-cli-mcp-interface-parity.md`
- [ ] `grep -q 'check:adr' .claude/settings.json`

---

## Constraints

- `scripts/check-adr.ts` must use only Node.js built-ins and `tsx`-compatible TypeScript — no new npm dependencies; glob via recursive `fs.readdirSync`
- The script must complete in under 1 second on the current codebase (no process spawning, no I/O beyond file reads)
- Tests must not depend on the real `src/cli/mcp/` directory structure; fixture strings must be used for unit tests, with the real-codebase "clean run" test as a separate assertion
- No changes to existing source files in `src/` — this feature is entirely additive (scripts + docs + settings)

## Acceptance Gate

- [ ] `npm test`
- [ ] `npm run check:adr`
- [ ] `grep -q 'check:adr' package.json`
- [ ] `grep -q '## Mechanical Check' docs/adr/006-mcp-tool-design-standards.md`
- [ ] `grep -q '## Mechanical Check' docs/adr/007-cli-mcp-interface-parity.md`
- [ ] `grep -q 'check:adr' .claude/settings.json`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Proposal approved. Starting plan draft.

claimed: 2026-06-23T07:02:11Z

Completed: 2026-06-23T07:28:53Z
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/scripts/check-adr.test.ts
- [ ] #2 npm test -- --run tests/unit/scripts/check-adr-integration.test.ts
- [ ] #3 npm run check:adr
- [ ] #4 grep -q 'check:adr' package.json
- [ ] #5 grep -q '## Mechanical Check' docs/adr/006-mcp-tool-design-standards.md
- [ ] #6 grep -q '## Mechanical Check' docs/adr/007-cli-mcp-interface-parity.md
- [ ] #7 grep -q 'check:adr' .claude/settings.json
- [ ] #8 npm test
<!-- DOD:END -->
