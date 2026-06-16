# Proposal: ADR Compliance Checker

## Background

ArchGuard currently has 8 ADRs (`docs/adr/001–008`) covering architectural constraints ranging from naming conventions and interface composition to CLI/MCP parity and extension field access patterns. Compliance with these ADRs is checked manually and episodically — typically triggered by a session dedicated to ADR review, using a 5-step workflow: read ADR → grep code → check git history → fix violations → update status table.

This approach has two structural problems:

1. **High cost per check**: Every check requires an LLM session to interpret ADR text, formulate grep patterns, and reason about whether findings are real violations. At current frequency (~once per development cycle), violations accumulate between checks.

2. **LLM cannot be in the hot path**: Running LLM analysis on every commit is prohibitively slow (latency) and expensive (tokens). The mechanical parts of compliance checking — naming patterns, structural existence, set-membership tests — do not require LLM reasoning and can run in milliseconds.

A code-review session (2026-06-14) examining PR #1 surface a concrete example of the gap: `archguard_get_atlas_layer` maps to `--atlas-layers` (CLI flag, plural form), but an automated parity check using exact name matching would flag this as an ADR-007 violation. The correct response — recognize this as a legitimate naming divergence, add a suppression annotation, and allow the commit — demonstrates the pattern this proposal formalises.

The key insight from that work: **ADR rules split cleanly into two tiers**. Most rules have a mechanical signal (grep-detectable) and a semantic residue (requires judgment). These tiers should run at different frequencies and costs.

## Goals

1. Run mechanical ADR compliance checks on every commit with zero LLM invocation and sub-second latency.
2. Surface mechanical check output to the current Claude Code session for semantic judgment when needed, without spawning a new LLM session.
3. Provide a suppression annotation mechanism (`// adr-ok`) that records human-reviewed exceptions in-source, making them auditable via git history.
4. Allow suppressed violations to pass the commit gate automatically on retry, without manual hook bypass (`--no-verify`).
5. Avoid LLM calls in git pre-commit hooks; reserve LLM for Claude Code `Stop` hook integration and manual invocation.

## Solution Design

### Tier 1 — Mechanical checker (`scripts/check-adr.ts`)

A single TypeScript script that encodes all mechanically-verifiable ADR rules. Run via `npm run check:adr`.

Each check function returns a `Violation` or `null`:

```typescript
interface Violation {
  adr: string;          // e.g. 'ADR-007'
  file: string;
  line: number;
  message: string;
  evidence: string;     // the matched text
}
```

**ADR-006 check — MCP tool description format**

ADR-006 requires tool descriptions to be verb-first and prohibit bare `"Get"` as the opening word:

```typescript
function checkAdr006(): Violation[] {
  const files = glob('src/cli/mcp/**/*.ts')
  return files.flatMap(file => {
    const lines = readFileSync(file, 'utf8').split('\n')
    return lines.flatMap((line, i) => {
      const m = line.match(/'description',\s*["'`](.+?)["'`]/)
      if (!m) return []
      if (/^Get\s/i.test(m[1].trim())) {
        return [{ adr: 'ADR-006', file, line: i + 1, message: 'description starts with bare "Get"', evidence: m[1] }]
      }
      return []
    })
  })
}
```

**ADR-007 check — CLI/MCP parity**

ADR-007 requires every MCP tool to have a corresponding CLI flag. Name matching uses a normalisation step (strip `archguard_` prefix, collapse `_` to `-`, allow plural forms):

```typescript
function checkAdr007(): Violation[] {
  const mcpTools = extractMcpToolNames('src/cli/mcp/')     // ['archguard_get_atlas_layer', ...]
  const cliFlags = extractCliFlags('src/cli/commands/analyze.ts')  // ['--atlas-layers', ...]
  return mcpTools.filter(tool => {
    const canonical = toCanonical(tool)  // 'atlas-layer' → also checks 'atlas-layers'
    return !cliFlags.some(flag => toCanonical(flag) === canonical || toCanonical(flag) === canonical + 's')
  }).map(tool => ({ adr: 'ADR-007', file: 'src/cli/mcp/', line: 0, message: `no CLI flag for ${tool}`, evidence: tool }))
}
```

**Suppression filter**

Before reporting, each violation is tested against in-source suppression annotations:

```typescript
function hasSuppression(v: Violation): boolean {
  const lines = readFileSync(v.file, 'utf8').split('\n')
  const context = lines.slice(Math.max(0, v.line - 3), v.line + 1).join('\n')
  // Must include ADR number; free-text reason required (at least one word after '—')
  return /\/\/\s*adr-ok:\s*ADR-\d+\s*—\s*\S+/.test(context)
    && context.includes(v.adr)
}
```

Suppression annotation format (enforced by the regex above):

```typescript
// adr-ok: ADR-007 — maps to --atlas-layers CLI flag (plural form)
server.tool('archguard_get_atlas_layer', ...)
```

Bare annotations are rejected:

```typescript
// adr-ok                          ← rejected: no ADR number, no reason
// adr-ok: ADR-007                 ← rejected: no reason after '—'
// adr-ok: maps to --atlas-layers  ← rejected: no ADR number
```

**Exit behaviour**

```
[check-adr] ADR-006: 0 violations
[check-adr] ADR-007: 1 candidate → 1 suppressed (adr-ok) → 0 violations
[check-adr] all checks passed
exit 0
```

```
[check-adr] ADR-006: 1 violation
  src/cli/mcp/tools/test-analysis-tools.ts:42
  description starts with bare "Get": "Get test quality metrics..."
[check-adr] exit 1
```

### Tier 2 — ADR rule catalog (one-time LLM work)

The mechanical checker must be seeded by a human-readable mapping from each ADR to its grep-verifiable assertions. This is done once per ADR (or when an ADR is updated) via manual LLM session — not automated.

| ADR | Mechanically verifiable? | Check implemented |
|-----|--------------------------|-------------------|
| ADR-001 | Partial (interface impl exists) | `implements IGoAtlas` grep |
| ADR-002 | Partial (field access patterns) | `archJson.extensions?.goAtlas` direct-access grep |
| ADR-003 | No (SVG rendering behaviour) | — |
| ADR-004 | No (runtime write path) | — |
| ADR-005 | No (runtime behaviour) | — |
| ADR-006 | Yes (naming format) | ✅ description verb-first |
| ADR-007 | Yes (set membership) | ✅ CLI/MCP parity |
| ADR-008 | No (LLM interaction pattern) | — |

ADRs 003–005, 008 are excluded from the mechanical tier; they require either integration tests or LLM reasoning over control flow.

### Tier 3 — Integration with Claude Code hooks

The `Stop` hook runs `check-adr.ts` after each Claude response and surfaces output to the current session:

```json
{
  "hooks": {
    "Stop": [{
      "type": "command",
      "command": "npm run check:adr 2>&1 | grep -E 'VIOLATION|violation|exit 1' | head -10 || true"
    }]
  }
}
```

When the hook output contains violations, the current Claude session sees them inline and can perform semantic analysis (is this a real violation or a false alarm?) without spawning a separate session. LLM reasoning stays in the existing context, not in a subprocess.

Claude Code hooks do **not** call the LLM directly. The pattern is: hook → shell command → output fed back into current session → current session's LLM decides whether to act.

### Full commit-cycle walkthrough

```
1. git commit -m "feat(mcp): add get_atlas_layer tool"

2. .git/hooks/pre-commit → npm run check:adr
   ⚠️  ADR-007: archguard_get_atlas_layer → no matching CLI flag
   exit 1 — commit blocked

3. Claude (current session) reads hook output:
   "archguard_get_atlas_layer maps to --atlas-layers (plural); legitimate naming divergence"
   → false alarm confirmed

4. Claude adds suppression annotation:
   // adr-ok: ADR-007 — maps to --atlas-layers CLI flag (plural form)
   server.tool('archguard_get_atlas_layer', ...)

5. git add src/cli/mcp/tools/atlas-analytics-tools.ts
   git commit -m "feat(mcp): add get_atlas_layer tool"

6. .git/hooks/pre-commit → npm run check:adr
   ✅ ADR-007: archguard_get_atlas_layer → suppressed (adr-ok: ADR-007)
   all checks passed — exit 0

7. Commit succeeds.
```

No `--no-verify` is used at any point. The suppression annotation is committed alongside the code and is visible in git history.

### git hook installation

```bash
# .git/hooks/pre-commit
#!/bin/sh
npm run check:adr
```

```json
// package.json
"check:adr": "tsx scripts/check-adr.ts"
```

The hook is not shared via `.githooks/` in this proposal; installation is manual (`chmod +x .git/hooks/pre-commit`). A future `npm run setup` target could automate this.

## Trade-off Analysis

| Decision | Benefit | Cost / Risk |
|----------|---------|-------------|
| Two-tier split (mechanical + semantic) | Mechanical checks are free to run on every commit; LLM reserved for judgment calls | ADRs 001–005, 008 get no automated coverage |
| Suppression annotations in source | Self-documenting; auditable via `git blame`; no separate allow-list file to maintain | Adds noise to source files; risk of developers adding annotations without reading ADR |
| `Stop` hook (not `PostToolUse`) | Appropriate frequency (per response, not per file write) | Fires even when no ADR-relevant code was changed; output may be ignored |
| No LLM in git hooks | Commit remains fast; no token cost per commit | Semantic violations in ADRs 003–005, 008 are not caught at commit time |
| Suppression requires reason string | Prevents blank pass-through annotations | Slightly more friction for developers adding legitimate suppressions |

## Risks

- **Suppression annotation abuse**: A developer could write `// adr-ok: ADR-007 — TODO` to silence a check without genuinely resolving it. Mitigation: the reason regex requires at least one non-whitespace word after `—`, which filters out `TODO` only if it is the entire reason. A code review pass on annotations in PRs provides the human backstop.

- **Name normalisation brittleness**: The ADR-007 parity check uses heuristic name matching (strip prefix, handle plurals). Edge cases (abbreviations, compound words) may produce false positives or miss real violations. Mitigation: the suppression mechanism handles false positives; missed violations are caught in periodic manual ADR review sessions.

- **Check script falls out of sync with ADR text**: If an ADR is updated without updating the script, the mechanical check may pass on code that violates the new rule. Mitigation: each ADR file should include a `## Mechanical Check` section listing the script assertions it corresponds to, making drift visible during ADR review.

- **`Stop` hook output volume**: If the check script produces verbose output, it will clutter every Claude Code session regardless of relevance. Mitigation: the hook command pipes through `grep -E 'VIOLATION|violation|exit 1'` and limits to 10 lines; clean runs produce no output.

## Acceptance Criteria

- [ ] `scripts/check-adr.ts` exists and implements ADR-006 (description verb-first) and ADR-007 (CLI/MCP parity) checks.
- [ ] `npm run check:adr` exits 0 on the current codebase with no real violations.
- [ ] A suppression annotation matching `/\/\/\s*adr-ok:\s*ADR-\d+\s*—\s*\S+/` in the 3 lines preceding a violation causes `check-adr.ts` to skip that violation.
- [ ] A bare `// adr-ok` or an annotation without ADR number is not recognised as a valid suppression (the check still fires).
- [ ] `.git/hooks/pre-commit` calls `npm run check:adr`; a commit that introduces a bare `"Get"` description is blocked.
- [ ] The same commit succeeds after adding a valid `// adr-ok: ADR-006 — ...` annotation and re-staging.
- [ ] The `Stop` hook in `.claude/settings.json` runs `check-adr.ts` and surfaces violation lines to the current session; clean runs produce no hook output.
- [ ] `docs/adr/006-mcp-tool-design-standards.md` and `docs/adr/007-cli-mcp-interface-parity.md` each include a `## Mechanical Check` section referencing the corresponding script assertion.
