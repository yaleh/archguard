# npm test 真实耗时测量（无 timeout）

> **日期**: 2026-08-03
> **背景**: 之前的运行带 `timeout 300`，300s 被杀 → 退出码 124，掩盖了真实退出码。
> 本次**不带 timeout** 直接跑，拿到真实墙钟耗时、真实退出码、真实通过/失败统计。

## 执行方式

1. `bash scripts/heavy-op-token.sh --acquire archguard --timeout 0` → 拿到跨项目令牌
   （`waited_ms=0 holder=archguard acquired=yes`），避免与 quay / meta-cc 的测试互相抢占
   四核 CPU。
2. `npm test`（vitest）后台运行，bash 内置 `time` + `TIMEFORMAT` 记录墙钟，捕获退出码。
   - `/usr/bin/time` 在本机不存在（exit 127），改用 bash `time`。

## 结果

### (1) 真实墙钟耗时

| 来源 | 数值 |
|------|------|
| bash `time`（WALL） | **491.967s**（≈ 8.2 分钟）；USER 508.925s，SYS 120.625s |
| vitest 自报 Duration | **489.77s**（transform 12.70s，collect 41.52s，tests 437.30s，prepare 268ms） |

**关键结论**: 真实耗时 ≈ 492s > 300s。因此之前 `timeout 300` 的写法**必然**在测试真正跑完
之前就杀进程——它测到的是超时截断，不是测试的真实状态。

### (2) 真实退出码

**`1`**（vitest 有失败测试）。

- 注意：bash 包装命令打印的 `REAL_EXIT=1` 是 `npm test` 进程自身退出码；
  vitest 在存在失败用例时以 1 退出。
- 对比：`timeout 300` 场景下看到的 `124` 是 **timeout(1) 的击杀码**，不是测试结果。
  124 掩盖了真实的 1。

### (3) passed / failed / skipped

```
Test Files  1 failed | 291 passed | 2 skipped (294)
Tests       1 failed | 4506 passed | 13 skipped (4520)
```

| 维度 | 数量 |
|------|------|
| 测试文件 | 291 通过，**1 失败**，2 跳过（共 294） |
| 用例 | 4506 通过，**1 失败**，13 跳过（共 4520） |

### (4) 失败输出（前 30 行）

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/integration/installer-claude-user-scope.test.ts > real claude CLI boundary (isolated config) > registers the marketplace for real, cleans residue, then stops specifically at the unpublished npm E404 boundary
AssertionError: expected the npm boundary failure:
[archguard-install] removed legacy ArchGuard entry from deprecated file (other entries preserved): /tmp/archguard-installer-real-gLPyZg/claude-config/mcp.json
[archguard-install] marketplace-add: claude plugin marketplace add /home/yale/work/archguard
[archguard-install] plugin-install: claude plugin install archguard@archguard --scope user
[archguard-install] done
[archguard-install]   marketplace: archguard
[archguard-install]   plugin:      archguard@archguard v0.1.32 (enabled, user scope)
[archguard-install]   restart Claude Code to load the plugin, then verify with: claude mcp list

: expected +0 to be 1 // Object.is equality

- Expected
+ Received

- 1
+ 0

 ❯ tests/integration/installer-claude-user-scope.test.ts:725:71
    723|       const combined = `${stdout}\n${stderr}`;
    724|       // Boundary: the unpublished plugin package cannot come from the…
    725|       expect(code, `expected the npm boundary failure:\n${combined}`).…
       |                                                                       ^
    726|       expect(combined).toContain(PLUGIN_PACKAGE);
    727|       expect(combined).toMatch(/npm error code E404/i);
```

## 失败归因

`tests/integration/installer-claude-user-scope.test.ts:725` 断言失败：

- 测试期望：`claude plugin install archguard@archguard` 在**未发布的 npm 包**边界处
  以非零退出码（E404）失败，并输出 `npm error code E404`。
- 实际：命令退出码为 **0**，且安装"成功"（`archguard@archguard v0.1.32 (enabled, user scope)`）。

含义：被安装的包 `archguard@archguard` 这次**解析到了真实/可安装源**（而非触发 E404），
所以边界断言落空。这是一个真实的失败，不是超时或环境噪音——
集成测试依赖真实 `claude` CLI 的行为，边界条件在本次运行中未触发。

## 对 timeout 用法的结论

1. `npm test` 真实耗时约 **8 分钟**，任何 `timeout 300`（5 分钟）都会截断真实结果并掩盖
   退出码。若给 npm test 加 timeout，至少应 ≥ 600s（考虑四核与 quay/meta-cc 并发竞争）。
2. 真实退出码是 **1**（失败测试存在），不是 124。后续若想在 CI / 脚本里做超时保护，
   应在捕获真实退出码之外另设超时，而不是用 timeout 的退出码当结果。
3. 本次唯一失败与令牌 / 并发无关（与 claude CLI 插件安装的真实边界行为有关）。
