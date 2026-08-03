---
id: TASK-52
title: "TASK-52: Reduce lint errors to 0"
status: todo
labels:
  - defect
  - lint
parent: null
extra:
  schema: v1
---

# TASK-52: Reduce lint errors to 0

status: todo

## Summary

`npm run lint` exits 1 with 234 errors (3853 warnings). After `eslint --fix`
reduced from 480 → 234 errors. Remaining 234 errors are mostly
`@typescript-eslint/no-unsafe-*` and `@typescript-eslint/no-explicit-any`
violations that cannot be auto-fixed.

## Evidence

```
✖ 4087 problems (234 errors, 3853 warnings)
FIX_EXIT=1
```

Detailed breakdown: `/tmp/lint-fix.log` (5194 lines). Pre-fix baseline: 480 errors / 4137 warnings.

## Contract

| Key | Value |
|---|---|
| measure | `npm run lint; echo $?` 退出码 + error count |
| band | exit 0, 0 errors（warnings 不计入阻塞） |
| invariant | 修复过程不引入新的 type-check 错误（`npm run type-check` 保持 exit 0） |
| invoke | `npm run lint`（全量验证） + `npm run type-check`（回归检查） |
| control | 修复前：234 errors；修复后目标：0 errors |
| resume | 若某条 rule 的修复代价过高（如 `no-explicit-any` 需大量类型重写），可先加 `// eslint-disable-next-line` 并建后续任务逐条清理，但总数必须降到 0 |

## Dispatch review

| Field | Value |
|---|---|
| reviewer | outer |
| at | 2026-08-03T15:31Z |
| changed | 初始创建 |
