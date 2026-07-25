---
id: ARCH-INVERSION-001
title: "Architectural inversion: src/types/config-global.ts imports
  FitnessConfig from src/analysis, creating a types↔analysis cycle"
status: needs-human
labels: []
---

## Finding

`src/types/config-global.ts` line 4 imports `FitnessConfig` from `../analysis/fitness/rule-types.js`, creating a `types ↔ analysis` bidirectional package dependency. The `src/types` package is a foundational contract layer that every other module (analysis, cli, core, parser, plugins) depends on. Importing back from `src/analysis` creates a circular dependency cycle that violates the project's layering invariant and prevents types from being compiled or tested in isolation.

Detected by ArchGuard self-analysis (2026-07-22): `analysis ↔ types` flagged as highest-priority structural issue among 4 bidirectional cycle pairs.

## Evidence

```
$ grep -n "from.*analysis" src/types/config-global.ts
4: import type { FitnessConfig } from '../analysis/fitness/rule-types.js';
```

The fix is to move `FitnessConfig` (and any other types that `config-global.ts` needs from analysis) into `src/types/` itself — breaking the import direction so that `analysis` imports from `types`, never the reverse.

Verify the cycle exists:
```bash
grep -rn "from.*@/analysis\|from.*\.\./analysis" src/types/ --include="*.ts"
# Should show src/types/config-global.ts:4
```

## AC

- [ ] `FitnessConfig` (or its relevant type definition) is moved into `src/types/` (e.g. `src/types/fitness.ts`) and re-exported from there
- [ ] `src/analysis/fitness/rule-types.ts` imports `FitnessConfig` from `@/types` instead of defining it
- [ ] `grep -rn "from.*analysis" src/types/ --include="*.ts"` returns no lines that cross into `src/analysis/`

## DoD

- All tests pass (`npm test`)
- The `types ↔ analysis` bidirectional cycle is eliminated
- `FitnessConfig` is importable from `@/types` by all callers
