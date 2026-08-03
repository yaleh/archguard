# TASK-51: Fix failing E404 boundary test

status: todo

## Summary

`tests/integration/installer-claude-user-scope.test.ts` line 725: the test
`real claude CLI boundary > registers the marketplace for real, cleans residue,
then stops specifically at the unpublished npm E404 boundary` expects exit code 1
(E404 from npm for unpublished package), but archguard@archguard v0.1.32 is now
published — the install succeeds (exit 0).

## Evidence

```
Test Files  1 failed | 291 passed | 2 skipped (294)
Tests       1 failed | 4506 passed | 13 skipped (4520)

FAIL  tests/integration/installer-claude-user-scope.test.ts > real claude CLI boundary
(isolated config) > registers the marketplace for real, cleans residue, then stops
specifically at the unpublished npm E404 boundary
AssertionError: expected +0 to be 1 // Object.is equality
```

Full details: `docs/analysis/npm-test-real-duration.md`

## Contract

| Key | Value |
|---|---|
| measure | `npm test -- --run tests/integration/installer-claude-user-scope.test.ts` 退出码 |
| band | exit 0, 0 failed |
| invariant | 修复后该测试文件的 33 tests 全部通过；全量 `npm test` 的 Test Files 行 0 failed |
| invoke | `npm test`（全量，验证无回归） |
| control | 修复前：该测试文件的 33 tests 中 1 failed；修复后：0 failed |
| resume | 若该测试的边界条件无法在已发布状态下验证（E404 不再触发），改为验证「安装成功」路径并更新测试名/描述以匹配新预期 |

## Dispatch review

| Field | Value |
|---|---|
| reviewer | outer |
| at | 2026-08-03T15:31Z |
| changed | 初始创建 |
