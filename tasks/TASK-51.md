---
id: TASK-51
title: "TASK-51: Fix failing E404 boundary test"
status: done
labels:
  - defect
  - testing
parent: null
extra:
  schema: v1
---

# TASK-51: Fix failing E404 boundary test

status: done

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

## Completion

**Resume 路径已走**：E404 不再触发（`@yalehwang/archguard-claude-plugin` 已发布），按
`Contract.resume` 改为验证「安装成功」路径。

| Key | Value |
|---|---|
| measure | `npm test -- --run tests/integration/installer-claude-user-scope.test.ts` 退出码 = **0** |
| band | exit 0, 0 failed — 满足 |
| invariant | 单文件 33/33 通过；全量 Test Files 行 0 failed — 满足 |
| invoke | 全量 `npm test` 无回归 |
| control | 修复前 33 tests 中 1 failed → 修复后 33 tests 全通过（0 failed） |

**改动**（`tests/integration/installer-claude-user-scope.test.ts`，仅该文件）：

- 测试名：`registers the marketplace for real, cleans residue, then stops
  specifically at the unpublished npm E404 boundary` → `registers the marketplace
  for real, cleans residue, and installs the published plugin at user scope
  (success path)`
- 断言从「E404 失败路径」（`expect(code).toBe(1)` + E404/404 匹配）改为
  「安装成功路径」（`expect(code).toBe(0)` + `done` / `(enabled, user scope)` /
  PLUGIN_ID），并保留网络失败负向守卫（`ENOTFOUND|ETIMEDOUT|ECONNREFUSED|E401|E403|E404`）。
- `boundaryEnv` → `isolatedEnv`；文件头/描述块注释同步去掉"未发布/E404"措辞。

**全量验证**（2026-08-03，真实墙钟 475.78s）：

```
Test Files  292 passed | 2 skipped (294)     — 0 failed
Tests       4507 passed | 13 skipped (4520)  — 0 failed
exit code 0
```

## Dispatch review

| Field | Value |
|---|---|
| reviewer | outer |
| at | 2026-08-03T15:31Z |
| changed | 2026-08-03T15:43Z — status todo → done；补 Completion（见上） |
