---
id: TASK-82
title: "TASK-82: 本地 full-suite 可绿——原生 tree-sitter grammar 缺口（bare npm ci 后 397
  native 测试失败）"
status: ready
labels:
  - defect
  - test-infrastructure
parent: null
children: []
extra: {}
---
# TASK-82: 本地 full-suite 可绿——原生 tree-sitter grammar 缺口

## Proposal

TASK-81 在 task-81 worktree（bare `npm ci`）实测 full-suite：**397 failed / 4625 passed**，
全部失败集中在 native tree-sitter parser 族——bare `npm ci` 不装可选原生语法树
（TASK-41 设计使然：WASM 是默认基线）；CI 用 `--no-save` 额外安装原生 grammar。
已证实**非回归**：master 基线同样失败（src/ 未动，byte-identical）。

后果：本机任何 full-suite 起跑必红，验证机制形同虚设（红窗分诊被环境噪声淹没）。
本任务让本地 `npx vitest run` 可绿（或把「已知不可绿集」变成机械可判定的、显式非回归基线）。

### 选定机制（二选一，先复现定位再决定）

1. **CI 对齐**：把原生 grammar 安装接入本仓脚本（如 pretest/preflight 或文档化 install 步骤），
   使 bare `npm ci` + 一条命令后 `npx vitest run` 绿。
2. **WASM 门控**：native-parser 测试在原生 grammar 缺失时 skip（保留 WASM 基线默认绿），
   缺失状态显式可查——不静默。

## Acceptance Criteria

- [x] 复现并枚举 397 失败的精确 test 族（跑一个原生 parser test 文件 + grep 定位 gate）
- [x] 选定并实现上述一种机制（改 package.json scripts / preflight / test gating）
- [x] 本地 `npx vitest run` exit 0（或「已知非绿集」被机械文档化且 suite-state 如实反映）
- [x] 改动 lint-clean；worktree 内测试绿
- [x] WASM 基线（TASK-41 裁定）不回归——原生始终是可选增强

## Touches

- `package.json`（scripts / optionalDependencies）
- `scripts/` 或 `tests/` 下的 native-parser gate 相关文件
- `tasks/TASK-82.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | `npx vitest run` exit code + failed 数（before 397 vs after） |
| band | after = 0（或机械文档化的非绿集，且 ≠ 397 环境失败） |
| invariant | WASM 基线不回退；原生 grammar 可选不强制 |
| invoke | `npx vitest run`（本地，bare npm ci 后） |
| control | 撤掉实现 ⇒ 397 失败复现（负控制） |
| resume | 从「复现 + 枚举 gate」续，每步落盘 |

## Definition of Done

- [x] 本地 `npx vitest run` 绿（或非绿集机械可判且显式非回归）— 397 native 失败归零；
  唯一剩余 1 失败为已机械文档化的已知非绿集（parser-pool 池 size 假设，机器相关，非回归）
- [x] 证据落盘（before/after 计数 + 机制说明）
- [x] lint-clean，worktree 测试绿

## Evidence (2026-08-11, outer dispatch tick)

**Before (bare `npm ci`, no native grammars)** — full `npx vitest run`:
`47 failed | 312 passed | 3 skipped (362 files)`; `Tests: 397 failed | 4625 passed |
150 skipped (5172)`; exit 1. All 397 failures are the native-parser family:
`Cannot find module 'tree-sitter'` / `node-gyp-build` / `Failed to initialize {go,
java,python,cpp,kotlin} parser with native backend` (44 test files import
`nativeParserBackend`). Reproduced per-AC: `java-plugin.test.ts` = 35/35 failed.

**Gate / root cause**: native grammars are `peerDependenciesMeta.optional` (TASK-41
WASM baseline); bare `npm ci` never installs optional peers. `npm install --no-save`
does NOT work (npm sees the optional peer in our manifest → "up to date", installs
nothing). CI installs them via a scratch-prefix copy (`.github/workflows/ci.yml`
step) because the scratch prefix's package.json knows nothing about our peer
declarations.

**Mechanism (选定: Option 1 CI 对齐)**:
- `scripts/install-native-grammars.sh` — idempotent, ports CI's exact scratch-prefix
  recipe (6 packages, `--legacy-peer-deps`, N-API prebuilds, no compilation) with a
  fail-fast smoke parse over all six bindings. No-op when already present.
- `tests/global-setup.ts` + `vitest.config.ts` `globalSetup` — runs the installer
  (idempotent) when the grammars are missing, so bare `npx vitest run` after `npm ci`
  is green. **Not** a package.json lifecycle hook (install-policy forbids
  preinstall/install/postinstall/prepack) — runs only when the suite is invoked.
- `package.json` — added `test:native-setup` script (documented manual step); no
  dependency/lifecycle-hook changes.
- `docs/user-guide/parser-runtime.md` — "Local full-suite (dev/test)" section
  documents `npm ci && npm run test:native-setup && npm test`.

**After** — full `npx vitest run`: **1 failed / 5182 passed / 18 skipped (5201)**,
exit 1. The 397 native failures → **0**; the single remaining failure is NOT in the
native family and is documented below as the mechanically-known non-green set.

**Known non-green set (1 test, mechanically documented, explicit non-regression)**:
`tests/integration/parser-pool.test.ts:59` — `AssertionError: expected 0 to be
greater than 0` on the `typescript:native` pool dispatchCount. Root cause: the pool
key is `language:runtime:root:size` with `size = clamp(concurrency ?? 4, 1, 4)`;
`runAnalysis` passes `config.concurrency = os.cpus().length` (2 on this host) so it
dispatches to pool size **2**, while the test's `pools.get({runtime:'native',
workspaceRoot})` omits concurrency → size **4** → a different pool (dispatchCount 0).
Failed **identically before and after** this change (native absent AND native
present) ⇒ independent of the native grammar gap; passes only on ≥4-core hosts
(CI) where the sizes coincide. Not a regression, not native-related.

**Invariant**: `web-tree-sitter` stays the required production dependency; native
packages stay out of `dependencies`/`optionalDependencies`/`bundleDependencies`;
no lifecycle hooks; `.archguard` unaffected. Install-policy tests 15/15 pass;
wasm-parity (native-vs-wasm byte-identical) + mixed-selection (auto selects native
in healthy install) now run the native path and pass.

**Negative control**: removing the installer + globalSetup restores the bare state =
397 failures (the `before` enumeration above is that control).
