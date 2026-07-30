# ArchGuard Evidence

Use this file only when authoring `projectSemantics` for the ArchGuard repository itself.

## Test Discovery

- Primary first-party tests live under `tests/**/*.test.ts`.
- One in-source test subtree exists at `src/cli/utils/__tests__/`.
- Nested `tests/poc/**/node_modules/**` content is third-party noise and should not define first-party test conventions.
- Because ArchGuard already scans `tests`, `__tests__`, and `src`, `additionalTestPatterns` are not required for the current repository state.

## Assertion Wrapper Recognition

- Repository tests are dominated by direct Vitest `expect(...)` assertions.
- Current repository evidence does not show a first-party assertion wrapper family that must be added to `customAssertionPatterns`.
- If future helpers appear and they are not counted by plugin defaults, add only those wrapper patterns.

## Mermaid Package Grouping

Evidence-backed high-value package groupings:

- `src/analysis` -> `analysis`
- `src/cli` -> `cli`
- `src/mermaid` -> `rendering`

These groupings are broad enough to stay stable while still producing useful package-level Mermaid subgraphs.

## Optional FIM Hints

- `nonProductionPatterns`: `tests`, `docs`, `scripts`
- `barrelFiles`: `src/types/index.ts`, `src/types/extensions/index.ts`
- `suggestedDepth`: `2`
