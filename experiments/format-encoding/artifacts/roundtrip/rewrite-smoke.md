# Phase 76.2 — Rewrite Prompt Smoke Test

**Status: PASS**
**Date**: 2026-06-12T12:23:25.705Z
**Rewrite model**: deepseek-v4-flash
**Corpus**: 10 entities, 2 relations (first-10 slice)

## Summary

| Arm | Roundtrip | Parse Error | H-info Triggered | Deviations |
|---|---|---|---|---|
| NL-Exhaustive → Haskell-ADT | ✓ PASS | — | No | 0 |
| NL-Exhaustive → JSON-Edge-List | ✓ PASS | — | No | 0 |
| NL-Exhaustive → Clean Prose | ✗ FAIL | Parse failed: nl-exhaustive: no entity sentences found | No | 0 |

## Protocol Deviation Log

**D-76.2**: Planned rewrite model `qwen3-235b-a22b` unavailable on gateway (`/v1/models` returns 404 for this ID).
Replacement: `deepseek-v4-flash` (DeepSeek family — satisfies cross-family requirement vs Claude + Zhipu answer models).
Impact: Minor — model capability tier similar; cross-family isolation maintained.
Resolution: Use deepseek-v4-flash as rewrite model for all Exp 2 arms.

## Arm: NL-Exhaustive → Haskell-ADT

**Roundtrip**: PASS
**H-info triggered**: No
**Deviations**: 0

<details>
<summary>Rewrite output (first 2000 chars)</summary>

```
```haskell
-- | id: src/analysis/fim/cochange-matrix-builder.ts.buildfullcochangematrix
-- | name: buildFullCochangeMatrix
-- | source: src/analysis/fim/cochange-matrix-builder.ts
data BuildFullCochangeMatrix :: function = BuildFullCochangeMatrix {}

-- | id: src/analysis/fim/cochange-matrix-builder.ts.buildpackagecochangematrix
-- | name: buildPackageCochangeMatrix
-- | source: src/analysis/fim/cochange-matrix-builder.ts
data BuildPackageCochangeMatrix :: function = BuildPackageCochangeMatrix {}

-- | id: src/analysis/fim/coverage-parser.ts.buildcoveragematrixfromimports
-- | name: buildCoverageMatrixFromImports
-- | source: src/analysis/fim/coverage-parser.ts
data BuildCoverageMatrixFromImports :: function = BuildCoverageMatrixFromImports {}

-- | id: src/analysis/fim/coverage-parser.ts.istestlikepath
-- | name: isTestLikePath
-- | source: src/analysis/fim/coverage-parser.ts
data IsTestLikePath :: function = IsTestLikePath {}

-- | id: src/analysis/fim/fim-analysis.ts.computeimportapproximationfim
-- | name: computeImportApproximationFIM
-- | source: src/analysis/fim/fim-analysis.ts
data ComputeImportApproximationFIM :: function = ComputeImportApproximationFIM
  { _rel_dependency :: ["src/analysis/fim/coverage-parser.ts.buildcoveragematrixfromimports"]
  }

-- | id: src/analysis/fim/fim-analysis.ts.computeimportapproximationfimoptions
-- | name: ComputeImportApproximationFIMOptions
-- | source: src/analysis/fim/fim-analysis.ts
data ComputeImportApproximationFIMOptions :: interface = ComputeImportApproximationFIMOptions {}

-- | id: src/analysis/fim/fim-analysis.ts.packageanalysis
-- | name: PackageAnalysis
-- | source: src/analysis/fim/fim-analysis.ts
data PackageAnalysis :: interface = PackageAnalysis {}

-- | id: src/analysis/fim/fim-analysis.ts.resolveverifiedbarrelpackages
-- | name: resolveVerifiedBarrelPackages
-- | source: src/analysis/fim/fim-analysis.ts
data ResolveVerifiedBarrelPackages :: function = ResolveVerifiedBarrelPackages {}

-- | id: src/analysi...
```
</details>

## Arm: NL-Exhaustive → JSON-Edge-List

**Roundtrip**: PASS
**H-info triggered**: No
**Deviations**: 0

<details>
<summary>Rewrite output (first 2000 chars)</summary>

```
```json
{
  "entities": [
    {
      "id": "src/analysis/fim/cochange-matrix-builder.ts.buildfullcochangematrix",
      "name": "buildFullCochangeMatrix",
      "type": "function",
      "sourceFile": "src/analysis/fim/cochange-matrix-builder.ts",
      "methods": []
    },
    {
      "id": "src/analysis/fim/cochange-matrix-builder.ts.buildpackagecochangematrix",
      "name": "buildPackageCochangeMatrix",
      "type": "function",
      "sourceFile": "src/analysis/fim/cochange-matrix-builder.ts",
      "methods": []
    },
    {
      "id": "src/analysis/fim/coverage-parser.ts.buildcoveragematrixfromimports",
      "name": "buildCoverageMatrixFromImports",
      "type": "function",
      "sourceFile": "src/analysis/fim/coverage-parser.ts",
      "methods": []
    },
    {
      "id": "src/analysis/fim/coverage-parser.ts.istestlikepath",
      "name": "isTestLikePath",
      "type": "function",
      "sourceFile": "src/analysis/fim/coverage-parser.ts",
      "methods": []
    },
    {
      "id": "src/analysis/fim/fim-analysis.ts.computeimportapproximationfim",
      "name": "computeImportApproximationFIM",
      "type": "function",
      "sourceFile": "src/analysis/fim/fim-analysis.ts",
      "methods": []
    },
    {
      "id": "src/analysis/fim/fim-analysis.ts.computeimportapproximationfimoptions",
      "name": "ComputeImportApproximationFIMOptions",
      "type": "interface",
      "sourceFile": "src/analysis/fim/fim-analysis.ts",
      "methods": []
    },
    {
      "id": "src/analysis/fim/fim-analysis.ts.packageanalysis",
      "name": "PackageAnalysis",
      "type": "interface",
      "sourceFile": "src/analysis/fim/fim-analysis.ts",
      "methods": []
    },
    {
      "id": "src/analysis/fim/fim-analysis.ts.resolveverifiedbarrelpackages",
      "name": "resolveVerifiedBarrelPackages",
      "type": "function",
      "sourceFile": "src/analysis/fim/fim-analysis.ts",
      "methods": []
    },
    {
      "id": "src/analysis/fim/fim-analysis.ts.vali...
```
</details>

## Arm: NL-Exhaustive → Clean Prose

**Roundtrip**: FAIL
**H-info triggered**: No
**Parse error**: Parse failed: nl-exhaustive: no entity sentences found
**Deviations**: 0

<details>
<summary>Rewrite output (first 2000 chars)</summary>

```
The system includes the following entities. The function `buildFullCochangeMatrix` is defined in `src/analysis/fim/cochange-matrix-builder.ts`. The function `buildPackageCochangeMatrix` is defined in the same file. The function `buildCoverageMatrixFromImports` is defined in `src/analysis/fim/coverage-parser.ts`. The function `isTestLikePath` is also defined in that file. The function `computeImportApproximationFIM` is defined in `src/analysis/fim/fim-analysis.ts`, along with the interface `ComputeImportApproximationFIMOptions`, the interface `PackageAnalysis`, the function `resolveVerifiedBarrelPackages`, the function `validateFIMAgainstGit`, and the interface `ValidateFIMAgainstGitOptions`. The function `computeImportApproximationFIM` has a dependency on `buildCoverageMatrixFromImports`. The function `validateFIMAgainstGit` has a dependency on `buildPackageCochangeMatrix`.
```
</details>
