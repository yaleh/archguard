---
id: TASK-67
title: "TASK-67: 修 full-suite-runner 的 ✖ 假阳性红检测（匹配到通过测试的 console 输出）"
status: done
labels:
  - defect
  - mechanism
  - runner
parent: null
children: []
extra:
  schema: v1
  source: outer-triage-2026-08-05
---
# TASK-67: 修 full-suite-runner 的 ✖ 假阳性红检测

## Proposal

full-suite-runner 把任何含 `✖` 的日志行判为失败（`plugin/scripts/full-suite-runner.ts:68`
`/✖/, // node:test failure glyph`），但**通过测试的 console 输出也会打印 ✖**——尤其负控制/
错误路径测试（故意喂无效输入并断言处理器正确报错，其 console.error 含 ✖）。

**实测证据（2026-08-05 12:56Z 全量套件）**：vitest 摘要 `Test Files 329 passed | 2 skipped
(331)`、`Tests 4902 passed | 13 skipped (4915)`、exit 0——**0 失败**。但 runner 因一行
`✖ Diagram test failed: Cannot destructure property 'entities' of 'archJSON' as it is
undefined.`（来自**通过**的负控制测试）触发 `FAILURE detected on stream -> state=red`，
把 `state` 写成 red，stop-dispatch 信号错误在位。外层按红窗分诊核实 vitest 摘要后手动
纠正为 green（`4902 passed / 0 failed / 0 cancelled / exit 0`）。

**根因**：runner 的判红模式按 node:test/TAP 设计（`✖` 在 node:test 里是结构化失败字形），
但本仓是 **vitest**——vitest 里 `✖` 可以是测试自身 console 输出，不一定是失败标记。
runner 需要区分「vitest 的结构化失败」（`❯ <file> (N tests | M failed)`、`Test Files ...
failed`、`Tests ... failed`）与「测试 console 输出里的 ✖」。

### 选定机制

改 `full-suite-runner.ts` 的 `isFailureLine`：判红以 vitest 的**结构化失败摘要**为准
（失败文件行 `❯ <file> (N tests | M failed)` M>0、汇总行 `Test Files X failed` /
`Tests Y failed` / `# cancelled [1-9]`），不再匹配裸 `✖` 行（除非行本身是 vitest 的
失败文件行）。保留 node:test/TAP 模式（`^not ok`、`^# fail [1-9]`）以兼容其它 runner 用法。

## Acceptance Criteria

- [x] `isFailureLine` 不再把「测试 console 输出里的裸 ✖」判为失败（用包含负控制测试的最小
      复现：一个打印 ✖ 的通过测试 → runner 报 green）
- [x] vitest 真实失败仍被抓：构造失败 suite（一个真红测试）→ runner 报 red，SUITE-RED 事件
      触发，stopSignal 在位（`--fail-fast-check` 的等价端到端验证）
- [ ] 全量套件判绿恢复：`plugin/scripts/full-suite-runner.ts --command "npx vitest run
      --maxWorkers=8"` 跑完 state=green（当前 4902 passed / 0 failed）
      （按 Contract resume 推迟到下个低负载窗口；机制已验证：真实 vitest 全绿 fixture →
      green，且判绿摘要行 `Test Files 329 passed` / `Tests 4902 passed` 直接判定不判红）
- [x] 不回归 node:test/TAP 判红（`^not ok`、`^# fail [1-9]`、`^# cancelled [1-9]` 仍判红）

## Execute evidence (scoped, TASK-67 branch)

Contract invoke `--fail-fast-check`（RED 自动触发链完好）:

```
$ node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --fail-fast-check
full-suite-runner: FAILURE detected on stream -> state=red (run still in progress)
  not ok 1 - fail-fast-check (RED auto-trigger control)
full-suite-runner: FINAL state=red durationMs=73 exit=1
fail-fast-check: suite exit=1 state=red stopSignal=true suiteRedEvent=recorded early=false events=1
fail-fast-check OK: runner wrote state=red → trigger recorded SUITE-RED → stopSignal in place
EXIT=0
```

AC1 负控制（fake：exit 0 + 裸 ✖ console 行，正是上报的假阳性形态）→ runner 报 green:

```
$ node ... full-suite-runner.ts --root <tmp> --command 'echo "✖ Diagram test failed: Cannot destructure property '\''entities'\'' of '\''archJSON'\'' as it is undefined."; exit 0'
full-suite-runner: FINAL state=green durationMs=27 exit=0
EXIT=0  STATE=green
```

AC1 真实 vitest fixture（一个通过测试 console.error 裸 ✖）→ runner 报 green（state=green exit=0）;
AC2 真实 vitest fixture（一个真红测试）→ runner 抓 `❯ tests/fail.test.ts (1 test | 1 failed)`
→ state=red exit=1；对同一 root 跑 `runOnce` 记 `SUITE-RED` 事件 + stopSignal=true。

`isFailureLine` 直接判定矩阵（18/18）：

| line | expect | got |
|---|---|---|
| `✖ Diagram test failed: Cannot destructure property 'entities'...` | false | false |
| `stderr \| tests/pass.test.ts > ✖ negative control console` | false | false |
| `✓ tests/pass.test.ts (2 tests) 14ms` | false | false |
| ` Test Files  1 passed (1)` / `      Tests  2 passed (2)` | false | false |
| ` Test Files  329 passed \| 2 skipped (331)`（全量判绿摘要参考） | false | false |
| `      Tests  4902 passed \| 13 skipped (4915)`（全量判绿摘要参考） | false | false |
| `❯ tests/fail.test.ts (1 test \| 1 failed) 31ms` | true | true |
| ` Test Files  1 failed \| 1 passed (2)` | true | true |
| `      Tests  1 failed \| 2 passed (3)` | true | true |
| `not ok 1 - ...` / `# fail 1` / `# cancelled 1` | true | true |
| `# fail 0` / `# cancelled 0` / `FULL-SUITE-EXIT=0` | false | false |

实现说明：
- `FAILURE_PATTERNS` 移除裸 `/✖/`；判红以 vitest 结构化失败为准（失败文件行 `❯ <file> (N tests | M failed)` M>0、
  汇总行 `Test Files X failed` / `Tests Y failed` X|Y>0，均容前导空白）。保留 node:test/TAP 模式与
  `FULL-SUITE-EXIT=[^0]`；非零 exit code 仍是兜底。
- 提交范围：`plugin/scripts/full-suite-runner.ts`（改动）+ `plugin/scripts/suite-state-trigger.ts`
  （runner 的 import 依赖，按任务约定原样复制进 worktree 并随提交入 git——两个文件在主仓库均为
  untracked，只在活工作树存在；不复制则本分支的 `--fail-fast-check` 在干净 checkout 上会
  ERR_MODULE_NOT_FOUND）+ `tasks/TASK-67.md`。

## Touches

- `plugin/scripts/full-suite-runner.ts`（`isFailureLine` 判红模式）
- `tasks/TASK-67.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | `plugin/scripts/full-suite-runner.ts` 的 `isFailureLine` 是否匹配裸 ✖ console 行（应否）+ `--fail-fast-check` 的 RED 触发链是否仍完好 |
| band | 裸 ✖ console 行（负控制测试输出）不判红；结构化 vitest 失败仍判红 |
| invariant | vitest 真实失败必须仍被抓（防静默绿） |
| invoke | `node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --fail-fast-check` |
| control | 构造「打印 ✖ 但全绿」的负控制测试 → runner 必须报 green（负控制：假阳性不复发） |
| resume | 改完 `--fail-fast-check` 验证链；全量验证可等下个低负载窗口 |

## Definition of Done

- [ ] `isFailureLine` 改为结构化判红（不匹配裸 ✖ console 行）
- [ ] `--fail-fast-check` 通过（RED 自动触发链完好）
- [ ] 全量套件一轮 state=green（无假阳性红）
