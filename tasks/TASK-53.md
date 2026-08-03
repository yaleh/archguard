---
id: TASK-53
title: "TASK-53: AC4 — CI 三盏灯全绿"
status: todo
labels:
  - defect
  - ci
parent: null
extra:
  schema: v1
---
# TASK-53: AC4 — CI 三盏灯全绿

status: todo

## Summary

CI（`.github/workflows/ci.yml`）最近 3 次全 failure（最后一次 2026-07-31，早于 TASK-51/52 修复）。
依赖 AC2（lint 0 errors，已 done）——AC2 完成后本任务解锁。

CI 步骤：type-check → lint → format:check → build → test:coverage → coverage 阈值 → codecov 上传。

当前已知状态（外层 2026-08-03T16:10Z 实测）：
- lint ✅（TASK-52 修复，0 errors）
- format:check ✅（prettier 全过）
- type-check ✅（AC3）
- test:coverage ❓ 未在 CI 重跑过（本地 475s 全量套件 + coverage 开销可能超时）

## 任务

1. 查看最近 CI 失败明细：`gh run list --limit 5` + `gh run view <id> --log-failed`
2. 定位剩余红步（预期是 test:coverage 超时或 coverage 阈值）
3. 修复后 push，`gh run watch` 验证三盏灯绿
4. 若 test:coverage 在 GitHub runner 上超时：为 CI 的 Run tests 步骤加 `timeout-minutes`
   并确认 vitest coverage 配置（`coverage/coverage-summary.json` 是否生成、阈值判定是否生效）

## Contract

| Key | Value |
|---|---|
| measure | `gh run list --limit 1 --json conclusion,status` 的 `conclusion` |
| band | `conclusion == "success"` |
| invariant | `npm run type-check` 保持 exit 0；`npm run lint` 保持 0 errors（不破坏 TASK-52 成果） |
| invoke | `gh run list --limit 1 --json conclusion,status`；`gh run view <id> --log-failed` |
| control | 修复前：最近 3 次 conclusion=failure；修复后：最新一次 conclusion=success |
| resume | 若 CI 超时是 GitHub runner 与本地差异（无 coverage 缓存等），把实测数据写回本任务并报告外层 |

## 验证

```
gh run list --limit 1 --json conclusion,status
# 期望: "conclusion":"success"
```

## Progress（2026-08-03 四轮 CI 实测分析）

> 由内层 Claude 会话追加（外层换模型收尾前落盘，防止上下文丢失）。
> 当前状态：**未完成**，第 4 轮仍红，见下方。

### 第 1 轮 — run `30831406196`，head `be3424a`（初推 27 提交）

**红步**：Build（Node 20 失败，exit 9；Node 22 被取消）。

**根因**（`gh run view <id> --log-failed` 定位）：
```
> npm run postbuild
> npm run check:runtime-deps
> node --experimental-strip-types scripts/check-runtime-deps.ts
node: bad option: --experimental-strip-types   ← exit 9
```
`--experimental-strip-types` 仅 Node ≥22.6 支持；`package.json engines` 声明 `>=18.0.0`，
CI matrix 却是 `[20, 22]` → Node 20 根本构建不了。engines 与矩阵都落后于真实要求。

**修复**（commit `a911166`）：`engines.node` → `>=22.6.0`（package.json + package-lock 根条目），
CI matrix → `[22, 24]`，并加注释说明 Node 20 无法构建。

### 第 2 轮 — run `30831716650`，head `a911166`

**红步**：Run tests（Node 24 失败，40 files / **385 tests** 失败；Node 22 被取消）。

**根因**：`npm ci` 不装 optional peer；native `tree-sitter` 系列是
`peerDependenciesMeta.optional`（lockfile 里甚至没有条目），而测试套件**大量硬依赖**
native（kotlin/go/java/python/cpp/parser-runtime/wasm-parity 等 40+ 文件直接
`import('tree-sitter')` 或 `nativeParserBackend`）。本地能过是因为 node_modules 里有
手工装的 tree-sitter（不在 lock 里，`npm ci` 不可复现）。典型报错：
`Cannot find module 'tree-sitter'`。

关键证据：`docs/user-guide/parser-runtime.md` 明确这是**可选加速器、手动安装**
（`npm install tree-sitter tree-sitter-go`），解析器缺 native 应回退 WASM——但测试
绕过了回退逻辑直接 import native。

### 第 3 轮 — run `30832523528`，head `626a155`（错误的 devDeps 方案）

**改动**：把 6 个 native 包（tree-sitter、go/java/python/cpp 语法、kotlin 语法）加进
`devDependencies`，另加 `.npmrc legacy-peer-deps=true` 绕过 kotlin 语法的陈旧
peer 范围（`@tree-sitter-grammars/tree-sitter-kotlin@1.1.0` 声明 `tree-sitter@^0.22.4`，
与 0.25 家族冲突，npm ERESOLVE；`npm install --package-lock-only` 需 legacy 才能解析）。

**结果**：Run tests 只剩 **2 files / 1 test** 失败——反而验证了「native 装上后 40/385
全过」：
1. `tests/unit/packaging/install-policy.test.ts:188`：断言 lockfile 里 tree-sitter 必须是
   optional peer（`entry.peer===true && entry.optional===true`），我改成 dev 依赖直接违反。
2. `tests/integration/install-policy.test.ts:277`：干净室 `npm ls --all --omit=dev` 报
   `ELSPROBLEMS invalid: picomatch@2.3.2`（我改 lock 引入的一致性问题）。

**结论**：仓库有**明确的打包策略**——native tree-sitter 必须保持 optional peer，
`web-tree-sitter`(WASM) 才是发货默认。devDependencies 方案与策略冲突，回退。

### 第 4 轮 — run `30833301070`，head `f628b8f`（当前方案）

**改动**：`git checkout a911166` 恢复 package.json/package-lock（策略合规），删除
`.npmrc`；CI 在 `npm ci` 后加一步 **`--no-save --legacy-peer-deps` 安装 native**（贴合
文档化手动工作流，测试用、不进 package.json/lock）。本地验证过该命令 `--no-save` 不碰
lock（git status 干净）。

**结果**：**仍失败，且与第 2 轮完全一样**：Run tests 40 files / **385 tests** 失败，
`Cannot find module 'tree-sitter'`。

**关键线索**（`Install native tree-sitter grammars` 步骤输出）：
```
added 4 packages, and audited 632 packages in 3s
npm warn allow-scripts   @tree-sitter-grammars/tree-sitter-kotlin@1.1.0 (install: node-gyp-build)
```
只加了 **4 个包、3 秒**——太快，native 绑定（node-gyp-build）不可能已构建；且 allow-scripts
只列出 kotlin grammar 有 install 脚本，tree-sitter 核心没被安装（或 `--no-save` 装上后
又被 prune，或 allow-scripts 阻止了 node-gyp-build）。**tree-sitter 对测试仍不可解析。**

**下一步假设（待验证，会话可能中断，请接着查）**：
1. 拉第 4 轮该步骤完整输出，确认「4 packages」具体是哪些；CI 上 `node_modules/tree-sitter`
   是否存在、`tree-sitter` 的 `.node` 绑定是否构建（`require('tree-sitter')` 报错类型区分
   MODULE_NOT_FOUND vs binding 加载失败）。
2. 疑点 A：`npm ci` 用 `cache: npm` 且 `--no-save` 追加安装，可能与 npm 11 的
   allow-scripts（Phase 1，advisory，但 Node 24=npm 11）或 npm 的 prune 行为冲突。
3. 疑点 B：`--legacy-peer-deps` 会忽略 peer，但 `tree-sitter@^0.25.0` 是显式实参，理论上
   应装上——需确认它在 `npm install --no-save` 后的实际去向。
4. 备选：改用 `ARCHGUARD_NATIVE_MODULE_ROOT` 指向预装的 native 根目录（文档 Option 2），
   或给硬依赖 native 的测试加「tree-sitter 缺失即 skip」防护（范围约 40 文件/385 tests，
   侵入大但尊重「native 可选」设计）。

### 已确认事实（跨轮沉淀）

- CI 全链路现在唯一红步是 **Run tests**（type-check/lint/format/build 均已绿）。
- native tree-sitter 系列：`tree-sitter@0.25.0`、cpp `0.23.4`、go `0.25.0`、java `0.23.5`、
  python `0.25.0`、kotlin grammar `1.1.0`（本地已装，均不在 lock）。
- `check-runtime-deps`（TASK-30）只扫 `dist/**` 字面量裸导入；`native-parser-backend` 用
  `scopedRequire(RUNTIME_MODULE)` 变量动态 require，故 native 即使不在 `dependencies` 也不报错
  ——这是「native 可选项」能通过构建检查的原因。
- 环境：本地 node v26.5.0、npm 11.17.0；CI 用 setup-node@v3（Node 22→npm 10，Node 24→npm 11）。

## Dispatch review

| Field | Value |
|---|---|
| reviewer | outer |
| at | 2026-08-03T16:10Z |
| changed | 2026-08-03T16:48Z — 追加 Progress 段（第 1–4 轮分析）；任务未完成 |
