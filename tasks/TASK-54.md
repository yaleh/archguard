---
id: TASK-54
title: "TASK-54: 清理 4095 lint warnings（类型安全类）"
status: todo
labels:
  - defect
  - lint
  - cleanup
parent: null
extra:
  schema: v1
---
# TASK-54: 清理 4095 lint warnings（类型安全类）

status: todo

## Summary

TASK-52 把 lint errors 归零（0 errors / 4095 warnings，exit 0）。剩余 4095 warnings
绝大多数是 `@typescript-eslint/no-unsafe-*` 和 `@typescript-eslint/no-explicit-any`
类型安全类规则（见 TASK-52 的 Completion 段「warnings 说明」）。按 TASK-52 契约
「warnings 不计入阻塞」有意保留，但应另建任务逐条清理。

## 任务

1. 按目录/文件统计 warnings 分布，优先清理 `src/`（非 tests、非生成物）
2. 逐条把 `any` → 具体类型、消除 `no-unsafe-*` 违反
3. 保持 `npm run type-check` exit 0、`npm run lint` 0 errors
4. 若某条规则清理代价过高（如需要大规模类型重写），可先缩小范围并报告外层

## Contract

| Key | Value |
|---|---|
| measure | `npm run lint; echo $?` 的 warning 计数（`✖ N problems (0 errors, W warnings)` 的 W） |
| band | W 下降（本次清理目标：至少覆盖 src/ 下可安全改写的部分；不要求一次归零） |
| invariant | `npm run type-check` 保持 exit 0；errors 保持 0 |
| invoke | `npm run lint`（统计）+ `npm run type-check`（回归） |
| control | 修复前：4095 warnings；修复后：W < 4095 |
| resume | 若大量警告是同一模式的重复（如某个 helper 返回 any），优先修 helper 类型签名而非逐个调用点 |

## 验证

```
npm run lint 2>&1 | tail -2
# 期望: ✖ N problems (0 errors, W warnings)，W < 4095
```

## Dispatch review

| Field | Value |
|---|---|
| reviewer | outer |
| at | 2026-08-03T16:10Z |
| changed | — |

## Progress

Baseline (2026-08-04, worktree `task/TASK-54`): `npm run lint` → **4135 warnings** (0 errors).
src/ warnings = 429, tests/ warnings = 3707. Priority: src/.

### Batch 1 — mermaid validation type chain (commit 1)
- `src/mermaid/types.ts`: added `ValidationStage` discriminated union + `ValidationFullResult`; replaced `StructuralIssue.details?: any` with a typed optional record. (−1 warning)
- `src/mermaid/validation-pipeline.ts`: `constructor(_config?: any)` → `unknown`; `validateFull` returns `ValidationFullResult` (stages typed, no `result: any`); `generateReport` takes `ValidationFullResult`. (−40 warnings)
- `src/mermaid/diagram-generator.ts`: type guards `isParseStage`/`isQualityStage`; parse-error maps no longer `(e: any)`; quality block fully typed; `rendererOptions: any` → `Partial<MermaidRendererOptions>` (3 sites). (−48 warnings)
- Batch W delta: −89 (4135 → ~4046). eslint on files: 0 problems; `tsc --noEmit` exit 0.
