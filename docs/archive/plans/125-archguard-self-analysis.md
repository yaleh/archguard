# Plan: 用 ArchGuard 分析和评价本项目架构

## Context
ArchGuard is a TypeScript CLI tool that generates architecture diagrams — it should be able to analyze itself.
This task uses ArchGuard's own CLI and MCP tools to produce a self-referential architecture review,
validating both the tool's capability and identifying real structural issues in the codebase
(god packages, dependency cycles, test coverage gaps, coupling hot-spots).

## Phase 1: CLI Self-Analysis — Generate Diagrams
Run the ArchGuard CLI against its own `src/` directory to produce the 3-tier Mermaid diagram set
(package → class → method) in `docs/architecture-review/diagrams/`.

Commands to run:
```
npm run build
node dist/cli/index.js analyze -s src/ --output-dir docs/architecture-review/diagrams -v
```

Inspect the generated `index.md` and confirm all three diagram levels are present.

### DoD
- [ ] `test -f docs/architecture-review/diagrams/index.md`
- [ ] `grep -q 'overview/package' docs/architecture-review/diagrams/index.md`
- [ ] `grep -q 'class/all-classes' docs/architecture-review/diagrams/index.md`

## Phase 2: MCP Tool Data Collection — Structural Metrics
Use the available MCP tools to collect structural quality data. Run each of the following in sequence and save results to `docs/architecture-review/raw/`:

- `archguard_summary` → overall entity/relation counts
- `archguard_detect_god_packages` → packages exceeding coupling thresholds
- `archguard_detect_cycles` → circular dependency chains
- `archguard_get_package_stats` → per-package fanin/fanout table
- `archguard_get_package_fanout` for `cli`, `plugins`, `analysis`, `mermaid`, `core` packages
- `archguard_get_package_fanin` for high-fanout packages identified above
- `archguard_get_change_risk` → churn × coupling hotspots
- `archguard_get_cochange` → frequently co-changed file pairs
- `archguard_get_entity_coverage` → entity-level test linkage ratio
- `archguard_get_test_metrics` → test quality metrics per package

Save each tool's JSON output to a corresponding file under `docs/architecture-review/raw/`
(e.g., `raw/god-packages.json`, `raw/cycles.json`, `raw/package-stats.json`, etc.).

### DoD
- [ ] `test -s docs/architecture-review/raw/god-packages.json`
- [ ] `test -s docs/architecture-review/raw/cycles.json`
- [ ] `test -s docs/architecture-review/raw/package-stats.json`
- [ ] `test -s docs/architecture-review/raw/summary.json`

## Phase 3: Test Coverage CLI Check
Run the built-in test analysis CLI flags to produce coverage and issue reports,
then verify the output files exist and are non-empty.

Commands:
```
node dist/cli/index.js analyze -s src/ --include-tests --output-dir docs/architecture-review/diagrams -v
```

Check generated `test/metrics.md` and `test/issues.md` under the output directory.

### DoD
- [ ] `test -s docs/architecture-review/diagrams/test/metrics.md`
- [ ] `test -s docs/architecture-review/diagrams/test/issues.md`
- [ ] `grep -q 'entityCoverageRatio' docs/architecture-review/diagrams/test/metrics.md`

## Phase 4: Write Structured Evaluation Report
Synthesize all collected data into a single report at
`docs/architecture-review/archguard-self-analysis.md`.

The report MUST contain these exact section headings:

```
## Summary
## Architecture Diagram Quality
## Strengths
## Issues
## Recommendations
```

**Summary**: entity counts, package count, test coverage ratio, cycle count, god-package list.
**Architecture Diagram Quality**: assess whether the 3-tier diagrams accurately represent the layering
(`cli → query/processors → plugins → core/types`).
**Strengths**: well-structured areas (e.g., plugin isolation, clear core/types separation).
**Issues**: list each god package, cycle, coverage gap, and churn hotspot with specific
file/class/package references (e.g., `src/cli/query/query-engine.ts` — high fanout).
**Recommendations**: concrete, prioritised action items (extract interface, split package, add tests).

### DoD
- [ ] `test -f docs/architecture-review/archguard-self-analysis.md`
- [ ] `grep -q '## Summary' docs/architecture-review/archguard-self-analysis.md`
- [ ] `grep -q '## Issues' docs/architecture-review/archguard-self-analysis.md`
- [ ] `grep -q '## Recommendations' docs/architecture-review/archguard-self-analysis.md`
- [ ] `[ $(wc -l < docs/architecture-review/archguard-self-analysis.md) -ge 80 ]`

## Constraints
- Do NOT modify any source files in `src/` or test files — this is read-only analysis.
- Do NOT commit generated diagram files (`.archguard/` SVGs/PNGs) — only the report and raw JSON.
- Raw JSON files in `docs/architecture-review/raw/` are intermediate artifacts; keep them for traceability but do not include them in the final commit if they exceed 100 KB.
- Scope is limited to the ArchGuard project itself (`src/`); do not analyze external projects.
- The report must use specific references (file paths, class names, package names) — no generic observations.

## Acceptance Gate
- [ ] `test -f docs/architecture-review/archguard-self-analysis.md`
- [ ] `grep -q '## Summary' docs/architecture-review/archguard-self-analysis.md`
- [ ] `grep -q '## Recommendations' docs/architecture-review/archguard-self-analysis.md`
- [ ] `[ $(wc -l < docs/architecture-review/archguard-self-analysis.md) -ge 80 ]`
- [ ] `test -f docs/architecture-review/diagrams/index.md`
