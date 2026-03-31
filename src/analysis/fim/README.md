# FIM Analysis — Experimental

**Status**: experimental (research/historical use only)

## What FIM measures

The Fisher Information Matrix (FIM) is computed from import-approximation test coverage.
Given a coverage matrix C (tests × source files), FIM = C^T C. Its eigenvalues describe
how evenly tests exercise the codebase: a high condition number signals fragile,
concentrated coverage; a low effective dimension signals redundant test paths.

## Validated finding

Package-level FIM correlates significantly with git co-change matrices:
**Mantel r ≈ 0.77, p < 0.02** on the ArchGuard codebase.

This validates the GIM (Geometric Information Methodology) hypothesis that
information-geometric structure of test coverage predicts real coupling.

See `docs/spikes/fim-experiment-report.md` for the full experiment report.

## How to access

FIM data is available via the `archguard_get_fim` MCP tool (read-only).
It reads a pre-computed artifact from `.archguard/fim-current.json`.

> **Note**: The `--fim` CLI flag has been removed from `archguard analyze`.
> FIM computation is no longer part of the main analysis pipeline.
> Existing artifacts remain readable via the MCP tool for historical/research use.

## Files

| File | Purpose |
|------|---------|
| `fim-analysis.ts` | Top-level orchestration: import-approximation FIM + Mantel validation |
| `fim-builder.ts` | Core linear algebra: Gram matrix, Fisher information, eigenvalues |
| `coverage-parser.ts` | Builds coverage matrix from import graph |
| `cochange-matrix-builder.ts` | Builds package co-change matrix from git history |
| `mantel-test.ts` | Mantel test with permutation null model |
| `fim-artifacts.ts` | Read/write `.archguard/fim-current.json` |
| `fim-snapshot.ts` | Read/write `.archguard/fim-history.jsonl` |
| `types.ts` | Shared types (CoverageMatrix, FIMSnapshot, etc.) |
