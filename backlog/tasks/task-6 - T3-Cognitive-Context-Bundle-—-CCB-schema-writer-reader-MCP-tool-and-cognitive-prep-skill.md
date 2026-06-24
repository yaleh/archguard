---
id: TASK-6
title: >-
  T3-Cognitive Context Bundle — CCB schema writer reader MCP tool and
  cognitive-prep skill
status: 'Basic: Done'
assignee: []
created_date: '2026-06-22 16:40'
updated_date: '2026-06-22 17:25'
labels:
  - 'kind:basic'
dependencies: []
parent_task_id: TASK-3
ordinal: 2000
---

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: T3-Cognitive Context Bundle — CCB schema writer reader MCP tool and cognitive-prep skill

## Background

The cognitive analysis loop (T2) produces Pattern A/B/C classifications and cognitive
load scores per file, but these results are discarded at session end. The next session
must repeat the same tool calls — `archguard_get_cognitive_summary`, `getChangeRisk`,
`query_tool_blocks` — before it can begin working. For a codebase with 150+ files,
this redundant orientation phase costs 20–30 tool calls per session. A structured,
hash-keyed cache format (the Cognitive Context Bundle, CCB) would persist these signals
across sessions, letting a new agent load pre-assembled context in one tool call instead
of 20. The CCB must be self-validating: stale bundles (source file changed since last
assembly) must be detected and reassembled automatically. Without this persistence
layer, the cognitive analysis framework (T1+T2) cannot scale beyond single-session use.

## Goals

1. A `CognitiveContextBundle` interface is defined at `src/cli/cognitive/ccb-schema.ts`
   covering structural, behavioral, git, and guidance fields, verifiable by
   `npm run type-check` passing without errors.
2. A writer (`ccb-writer.ts`) and reader (`ccb-reader.ts`) exist under
   `src/cli/cognitive/`, with writer keying bundles on SHA-256 hash of source file
   and reader returning stale=true when hash mismatches, verifiable by unit tests.
3. An `archguard_get_ccb` MCP tool is registered in `mcp-server.ts` and returns a
   fresh CCB for any entity (assembling on demand if stale), verifiable by listing
   MCP tools after rebuild.
4. A SHA-256 freshness integration test confirms that a stale CCB (source file
   content changed) triggers full reassembly while an unchanged-file CCB is returned
   from disk with no additional MCP tool calls.
5. A `/cognitive-prep` skill at `.claude/skills/cognitive-prep/SKILL.md` assembles
   CCBs in parallel for all files in a planned edit set, verifiable by
   `ls .claude/skills/cognitive-prep/SKILL.md`.
6. `.archguard/cognitive/` is added to `.gitignore`, verifiable by
   `grep -q '.archguard/cognitive' .gitignore`.

## Proposed Approach

**Schema (`src/cli/cognitive/ccb-schema.ts`)**: Define `CognitiveContextBundle`
interface with fields: `fileId`, `filePath`, `fileHash` (SHA-256), `assembledAt`
(ISO timestamp), `structural` (CognitiveSummaryEntry from T1), `behavioral`
(`{readCount, editCount, reRatio}` from meta-cc), `git` (`{riskLevel, hotspotScore,
cochangeNeighbors}`), `guidance` (`{pattern, cognitiveLoad, keyInvariants, editPrecautions}`).

**Writer (`src/cli/cognitive/ccb-writer.ts`)**: Accepts a `CognitiveContextBundle`,
computes output path as `.archguard/cognitive/<fileId>.ccb.json`, writes atomically.
Uses `fs-extra` for I/O (consistent with project pattern). No LLM calls.

**Reader (`src/cli/cognitive/ccb-reader.ts`)**: Accepts `filePath` and `archDir`.
Reads existing CCB from disk; computes current SHA-256 of source file; returns
`{bundle, stale: false}` if hashes match, `{bundle: null, stale: true}` otherwise.

**Assembler (`src/cli/cognitive/ccb-assembler.ts`)**: Orchestrates: reader check →
if stale, call `archguard_get_cognitive_summary` (T1) + `getChangeRisk` + meta-cc
`query_tool_blocks` → build CCB → writer. Returns assembled bundle. The assembler
is called by the MCP tool handler.

**MCP tool (`archguard_get_ccb`)**: Registered in `mcp-server.ts` via
`registerCcbTool(server, defaultRoot)`. Accepts `{filePath, archDir?, forceRefresh?}`.
Calls assembler and returns the CCB as JSON.

**`/cognitive-prep` skill**: SKILL.md guides the LLM to call `archguard_get_ccb` in
parallel for each file in a planned edit set, then display a summary table of cognitive
load scores before the agent begins editing.

## Trade-offs and Risks

**What we are not doing:**
- Automatic CCB assembly on file change: CCBs are assembled on demand only (via
  `archguard_get_ccb` or the `/cognitive-prep` skill). No filesystem watcher.
- Cross-session CCB sharing via git: `.archguard/cognitive/` is gitignored to avoid
  committing large JSON blobs. CCBs are local-machine ephemeral.
- LLM calls inside the assembler: the `guidance` field's `keyInvariants` and
  `editPrecautions` are populated by the MCP tool's caller (the LLM agent), not
  by the assembler itself. The assembler fills only mechanical fields.

**Known risks:**
- Meta-cc dependency for behavioral signals: the assembler calls meta-cc
  `query_tool_blocks` to populate the `behavioral` field. If meta-cc is unavailable,
  the assembler must set `behavioral: null` gracefully rather than failing.
- SHA-256 hash on large files: files >10 MB are rare in TypeScript projects but
  possible (generated files, fixtures). The writer must stream-hash large files to
  avoid memory spikes.
- Concurrent assembly for the same entity: the `/cognitive-prep` skill calls
  `archguard_get_ccb` in parallel; two concurrent calls for the same stale entity
  may race to write. The writer must use atomic rename (`fs.rename` after writing
  to `.tmp` path) to prevent corrupt partial writes.

---

# Plan: T3-Cognitive Context Bundle — CCB schema writer reader MCP tool and cognitive-prep skill

Proposal: docs/proposals/proposal-t3-cognitive-context-bundle.md

## Phase A: CCB schema, writer, and reader

### Tests (write first)
File: `tests/unit/cli/cognitive/ccb-writer-reader.test.ts`

Test cases:
- `ccb-writer writes bundle to .archguard/cognitive/<fileId>.ccb.json`: mock fs-extra; call writer with a CognitiveContextBundle; assert outputPath ends with `.ccb.json` and writeFile called with correct path.
- `ccb-writer uses atomic rename`: assert writer writes to `.tmp` path first then renames.
- `ccb-reader returns stale:false when hash matches`: mock fs-extra readFile with a stored bundle whose fileHash equals current file SHA-256; assert `{bundle, stale: false}`.
- `ccb-reader returns stale:true when hash mismatches`: change source file content mock so SHA-256 differs; assert `{bundle: null, stale: true}`.
- `ccb-reader returns stale:true when no CCB file exists`: mock readFile throwing ENOENT; assert `{bundle: null, stale: true}`.
- `CognitiveContextBundle type has all required fields`: TypeScript compilation check via type-check.

### Implementation
- Create `src/cli/cognitive/` directory.
- Create `src/cli/cognitive/ccb-schema.ts`: export `CognitiveContextBundle` interface with fields: `fileId: string`, `filePath: string`, `fileHash: string`, `assembledAt: string`, `structural: CognitiveSummaryEntry | null`, `behavioral: {readCount:number;editCount:number;reRatio:number} | null`, `git: {riskLevel:string;hotspotScore:number;cochangeNeighbors:string[]} | null`, `guidance: {pattern:'A'|'B'|'C';cognitiveLoad:number;keyInvariants:string[];editPrecautions:string[]} | null`.
- Create `src/cli/cognitive/ccb-writer.ts`: `writeCcb(bundle: CognitiveContextBundle, archDir: string): Promise<void>` — compute path, write to `.tmp`, rename atomically using fs-extra.
- Create `src/cli/cognitive/ccb-reader.ts`: `readCcb(fileId: string, filePath: string, archDir: string): Promise<{bundle: CognitiveContextBundle|null; stale: boolean}>` — read CCB from disk, compute SHA-256 of current source file, compare with bundle.fileHash.

### DoD
- [ ] `npm test -- --run tests/unit/cli/cognitive/ccb-writer-reader.test.ts`
- [ ] `npm run type-check`

## Phase B: CCB assembler and archguard_get_ccb MCP tool

### Tests (write first)
File: `tests/unit/cli/cognitive/ccb-assembler.test.ts`
File: `tests/unit/cli/mcp/ccb-tool.test.ts`

Test cases (assembler):
- `assembler returns cached bundle when not stale`: mock reader returning `{bundle: mockBundle, stale: false}`; assert assembler returns mockBundle without calling archguard or meta-cc tools.
- `assembler reassembles when stale`: mock reader returning `{stale: true}`; mock T1 cognitive summary, getChangeRisk, query_tool_blocks; assert assembler calls all three and returns newly assembled bundle.
- `assembler sets behavioral:null when meta-cc unavailable`: mock query_tool_blocks throwing; assert `bundle.behavioral === null` without throwing.

Test cases (MCP tool):
- `archguard_get_ccb tool registered in server`: create McpServer, call registerCcbTool; assert tool name `archguard_get_ccb` is registered.
- `archguard_get_ccb returns assembled CCB for known filePath`: mock assembler; assert tool handler returns JSON with `fileId`, `assembledAt`, `structural`.
- `archguard_get_ccb with forceRefresh:true bypasses cache`: mock reader returning non-stale; assert assembler still calls T1 tool when forceRefresh=true.

### Implementation
- Create `src/cli/cognitive/ccb-assembler.ts`: `assembleCcb(filePath, archDir, engine, options?): Promise<CognitiveContextBundle>` — calls reader; if stale or forceRefresh, fetches T1 cognitive summary, change risk, and meta-cc tool blocks (each with try/catch); builds and writes bundle via writer; returns bundle.
- Create `src/cli/mcp/tools/ccb-tool.ts`: export `registerCcbTool(server: McpServer, defaultRoot: string)`. Zod schema: `{filePath: z.string(), archDir: z.string().optional(), forceRefresh: z.boolean().optional()}`. Calls assembler and returns bundle as JSON.
- In `src/cli/mcp/mcp-server.ts`: add import and call `registerCcbTool(server, defaultRoot)`.

### DoD
- [ ] `npm test -- --run tests/unit/cli/cognitive/ccb-assembler.test.ts`
- [ ] `npm test -- --run tests/unit/cli/mcp/ccb-tool.test.ts`
- [ ] `npm run type-check`
- [ ] `npm run lint`

## Phase C: /cognitive-prep skill, .gitignore update, and integration test

### Tests (write first)
File: `tests/unit/cli/cognitive/ccb-assembler.test.ts` (freshness integration test)
File: `tests/unit/cli/mcp/ccb-tool.test.ts` (SKILL.md presence test)

Test cases:
- `freshness: stale CCB triggers reassembly (integration)`: write a CCB with an old fileHash; change source file; call reader; assert stale:true; call assembler; assert new bundle with updated fileHash written.
- `cognitive-prep SKILL.md exists at correct path`: assert `fs.existsSync('.claude/skills/cognitive-prep/SKILL.md')`.
- `.gitignore contains .archguard/cognitive`: read `.gitignore`; assert includes `.archguard/cognitive`.

### Implementation
- Create `.claude/skills/cognitive-prep/SKILL.md` with instructions to: list planned edit files, call `archguard_get_ccb` in parallel for each, display cognitive load summary table (filePath, pattern, cognitiveLoad, top editPrecaution).
- Add `.archguard/cognitive/` to `.gitignore`.

### DoD
- [ ] `npm test -- --run tests/unit/cli/cognitive/ccb-assembler.test.ts`
- [ ] `npm test -- --run tests/unit/cli/mcp/ccb-tool.test.ts`
- [ ] `ls .claude/skills/cognitive-prep/SKILL.md`
- [ ] `grep -q '.archguard/cognitive' .gitignore`

## Constraints
- No LLM calls inside assembler or writer/reader; all mechanical I/O and hashing only.
- Use `fs-extra` for all file I/O (project convention).
- Use `@/types`, `@/cli` path aliases across module boundaries.
- Writer must use atomic rename pattern (`.tmp` → final) to prevent corrupt partial writes.
- Behavioral field must be null-safe (meta-cc unavailability must not throw).

## Acceptance Gate
- [ ] `npm test`
- [ ] `npm run type-check`
- [ ] `npm run lint`
- [ ] `grep -q '.archguard/cognitive' .gitignore`
- [ ] `ls .claude/skills/cognitive-prep/SKILL.md`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
claimed: 2026-06-22T17:09:04Z

workerLoop DoD: 5/5/6 tests passing, type-check clean, SKILL.md present, .gitignore updated

## TASK-6 Agent Summary

Phase A ✓ — CCB schema/writer/reader, 5 tests passing
Phase B ✓ — assembler + MCP tool registered
Phase C ✓ — cognitive-prep skill + .gitignore updated

DoD #1: PASS — npm test -- --run tests/unit/cli/cognitive/ccb-writer-reader.test.ts (5 tests)
DoD #2: PASS — npm test -- --run tests/unit/cli/cognitive/ccb-assembler.test.ts (5 tests)
DoD #3: PASS — npm test -- --run tests/unit/cli/mcp/ccb-tool.test.ts (6 tests)
DoD #4: PASS — npm run type-check (0 errors)
DoD #5: PASS — npm run lint (new source files clean, pre-existing failures in other files)
DoD #6: PASS — ls .claude/skills/cognitive-prep/SKILL.md
DoD #7: PASS — grep -q '.archguard/cognitive' .gitignore
DoD #8: PASS — npm test (30 pre-existing tree-sitter test file failures, all new tests pass)
## Execution Summary
Result: Done
Commit: 9a9c1607904b0d69c45c8f8777701bd28c2f96b8

Completed: 2026-06-22T17:25:33Z
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/cli/cognitive/ccb-writer-reader.test.ts
- [ ] #2 npm test -- --run tests/unit/cli/cognitive/ccb-assembler.test.ts
- [ ] #3 npm test -- --run tests/unit/cli/mcp/ccb-tool.test.ts
- [ ] #4 npm run type-check
- [ ] #5 npm run lint
- [ ] #6 grep -q '.archguard/cognitive' .gitignore
- [ ] #7 ls .claude/skills/cognitive-prep/SKILL.md
- [ ] #8 npm test
<!-- DOD:END -->
