# MCP Tool Budget: Consolidation and Cognitive Tool Addition

> Status: Draft (rev 1)
> Scope: Reduce MCP tool count by merging redundant tools, then add high-value cognitive
>        orientation tool; target ≤ 22 tools total
> Branch: `feat/mcp-tool-budget` (future)

---

## Background

archguard currently exposes **23 MCP tools**. All 23 are loaded into the LLM's context
simultaneously at session start.

### The real constraint: token budget, not tool count

Per ADR-006 and `proposal-multi-paradigm-mcp-tools.md` (Decision 1):

> **Budget unit is tokens, not tool count.** Claude Code warns when MCP tool definitions
> exceed **25,000 tokens** of context. "≤ 15 tools" is a common approximation, but the
> real constraint is token consumption. A tool with a 500-word description costs as much
> as five tools with one-sentence descriptions.

Client-side hard limits also apply: **Cursor enforces 40 tools, VS Code 128** (per
`meta-cc/proposal-project-split.md`). Claude Code itself activates deferred loading
(ToolSearch) when tool definitions exceed **10% of the context window** — a mitigating
mechanism, not a license for unlimited growth.

At the time of `proposal-multi-paradigm-mcp-tools.md`, 10 query tools consumed
approximately **2,000–3,000 tokens**, leaving ~8× headroom to the 25K limit and an
estimated **~4–5 additional tool slots** before reaching the warning threshold.

### Existing principle: consolidation over accumulation

The GIM methodology proposal established the pattern explicitly:

> "MCP 工具数量过度设计。3 个独立 GIM 工具...对于一个方法论解释层来说过多，已合并为 1
> 个工具。遵循已有模式中工具数量克制的原则。"

### Usage concentration

Empirical analysis of archguard's own session history shows usage is highly concentrated:

| Tool | Session calls |
|---|---|
| `archguard_get_change_risk` | 25 |
| `archguard_get_dependencies` | 8 |
| `archguard_get_test_metrics` | 8 |
| `archguard_summary` | 7 |
| `archguard_analyze` | 5 |
| `archguard_find_entity` | 5 |
| `archguard_detect_cycles` | 4 |
| `archguard_get_package_stats` | 4 |
| `archguard_analyze_git` | 3 |
| `archguard_detect_test_patterns` | 2 |
| `archguard_get_dependents` | 2 |
| `archguard_get_ownership` | 1 |
| `archguard_get_test_issues` | 1 |
| **10 tools** | **0** |

Ten tools — 43% of the set — have zero recorded calls. Some are genuinely unused; others
are shadowed by a higher-call-rate peer that overlaps in scope. Keeping them wastes token
budget on schema definitions that produce no value, while also increasing selection noise
when the LLM faces tools with similar descriptions and overlapping scope.

---

## Problem Analysis

### Redundancy: `get_change_context` vs `get_change_risk`

`archguard_get_change_risk` (25 calls) and `archguard_get_change_context` (0 calls) return
overlapping information. `get_change_risk` returns a risk score, affected entities, and
co-change neighbors — all the data an LLM needs to decide edit scope. `get_change_context`
returns a similar picture from a different axis. When both tools exist, the LLM
consistently selects the one with a clearer name (`risk`).

**Action**: deprecate `get_change_context`; ensure `get_change_risk` covers its distinct
fields if any are missing.

### Redundancy: `get_cochange` vs `get_change_risk`

`archguard_get_cochange` (0 calls) returns co-change pairs for a file — a subset of what
`get_change_risk` already returns as `topCochangeNeighbors`. No call was ever made to it
when `get_change_risk` was available.

**Action**: deprecate `get_cochange`.

### Split tools: `get_package_fanin` / `get_package_fanout`

Two tools for one concept (package coupling). An LLM has to know which direction it needs
before calling; in practice it needs both together to assess coupling health. Splitting
these forces two round-trips for a single judgment.

**Action**: merge into `archguard_get_package_coupling(direction: "in"|"out"|"both")`.

### Split tools: `find_implementers` / `find_subclasses`

Two tools that answer the same question: "what types relate to this interface/class by
inheritance or implementation?" The distinction between implements and extends is
meaningful in Java/TypeScript but should be a parameter, not two tools.

**Action**: merge into `archguard_find_related_types(relation: "implements"|"extends"|"both")`.

### Output overflow: `get_dependencies` for large entities

`archguard_get_dependencies("QueryEngine", depth=1)` returns **245,406 characters** for a
class with out-degree=20 — exceeding the LLM's inline result budget and writing to disk.
This forces an extra file-read round-trip for what should be a quick orientation query.

**Action**: add `archguard_get_cognitive_summary` as the recommended first call for
structural orientation (see `proposal-cognitive-summary-mcp.md`). `get_dependencies`
remains available for deep structural analysis.

---

## Proposed Changes

### Removals (−4 tools)

| Tool removed | Reason | Replacement |
|---|---|---|
| `archguard_get_change_context` | Redundant with `get_change_risk` | `get_change_risk` |
| `archguard_get_cochange` | Subset of `get_change_risk` output | `get_change_risk` |
| `archguard_get_package_fanin` | Merged into `get_package_coupling` | `get_package_coupling(direction="in")` |
| `archguard_get_package_fanout` | Merged into `get_package_coupling` | `get_package_coupling(direction="out")` |

### Merges (−2 tools → replaced by 2 unified tools, net −2)

| Old tools | New tool | Parameter |
|---|---|---|
| `get_package_fanin` + `get_package_fanout` | `archguard_get_package_coupling` | `direction: "in"\|"out"\|"both"` |
| `find_implementers` + `find_subclasses` | `archguard_find_related_types` | `relation: "implements"\|"extends"\|"both"` |

### Addition (+1 tool)

| New tool | Replaces | Benefit |
|---|---|---|
| `archguard_get_cognitive_summary` | `get_dependencies` for orientation | 300× smaller output, includes test + git signals |

See `proposal-cognitive-summary-mcp.md` for full design.

---

## Net Result

| State | Tool count |
|---|---|
| Current | 23 |
| After −4 removals | 19 |
| After 2 new unified tools replace 4 | 19 (unchanged: unified tools replace removed ones) |
| After +1 cognitive summary | **20** |

Final tool set: **20 tools** (down from 23). Coverage expands; noise contracts.

### Proposed Tool Inventory (post-change)

**Analysis**
- `archguard_analyze` — parse project, generate ArchJSON
- `archguard_analyze_git` — git history scan

**Entity Queries**
- `archguard_summary` — project-level summary
- `archguard_find_entity` — find entity by name
- `archguard_get_file_entities` — all entities in a file
- `archguard_get_dependencies` — full dependency BFS (for deep analysis)
- `archguard_get_dependents` — reverse dependency lookup
- `archguard_get_cognitive_summary` *(new)* — compact structural digest (for orientation)
- `archguard_find_related_types` *(unified)* — implementers + subclasses
- `archguard_find_callers` — call-graph callers
- `archguard_detect_cycles` — dependency cycle detection

**Package-Level**
- `archguard_get_package_stats` — package size, entity counts
- `archguard_get_package_coupling` *(unified)* — fan-in + fan-out in one call

**Git / Evolution**
- `archguard_get_change_risk` — risk score + co-change neighbors
- `archguard_get_ownership` — file/package ownership

**Test Analysis**
- `archguard_detect_test_patterns` — identify test types
- `archguard_get_test_metrics` — coverage metrics
- `archguard_get_test_issues` — test issues and orphans
- `archguard_get_entity_coverage` — per-entity coverage score

**Atlas (Go)**
- `archguard_get_atlas_layer` — Go architecture atlas layer

---

## Compatibility

`get_package_fanin` and `get_package_fanout` are consumed by the MCP server only (no
CLI commands expose them directly). The new `get_package_coupling` accepts the same
project root and package path parameters; callers are updated in the same PR.

`find_implementers` and `find_subclasses` are similarly MCP-only. The new
`find_related_types` with `relation="implements"` or `relation="extends"` produces
identical output to the old per-direction tools.

`get_change_context` and `get_cochange` — verify no internal callers before removing.
Expected: zero (confirmed by session history showing 0 external calls; internal callers
would also appear in session logs if any existed during development).

---

## Plan

| Phase | Work |
|---|---|
| 1 | Implement `archguard_get_package_coupling(direction)` merging fanin/fanout logic |
| 2 | Implement `archguard_find_related_types(relation)` merging implementers/subclasses |
| 3 | Verify zero internal callers of `get_change_context`, `get_cochange` |
| 4 | Remove `get_change_context`, `get_cochange`, `get_package_fanin`, `get_package_fanout` from `mcp-server.ts` |
| 5 | Implement `archguard_get_cognitive_summary` (see `proposal-cognitive-summary-mcp.md`) |
| 6 | Update `docs/user-guide/mcp-tools.md` with new tool list |
| 7 | Unit tests for `get_package_coupling` and `find_related_types` |

---

## Relationship to Other Proposals

```
proposal-cognitive-summary-mcp.md    ← ADDS the get_cognitive_summary tool (Phase 5)
proposal-cognitive-context-bundle.md ← USES get_cognitive_summary as one of its data sources
```

The consolidation (Phases 1–4) and the cognitive summary addition (Phase 5) are
independent and can be sequenced or parallelized as needed.
