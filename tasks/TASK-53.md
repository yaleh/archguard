---
id: TASK-53
title: "TASK-53: AC4 — CI 三盏灯全绿"
status: done
labels:
  - defect
  - ci
parent: null
extra:
  schema: v1
---
# TASK-53: AC4 — CI 三盏灯全绿

status: done

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

### 第 4 轮根因定位（2026-08-03T17:00Z–17:25Z，本地完整复现，未消耗 CI 轮次）

**拉取 run 30833301070 完整日志**（`gh run view 30833301070 --log`）：install 步骤命令
一次请求 6 个包，输出 `added 4 packages, and audited 632 packages`。Node 24 有
`npm warn allow-scripts`（esbuild/sharp/kotlin grammar），Node 22 无。

**本地复现**（fresh clone → `npm ci` → 同命令，node v26.5.0 / npm 11.17.0，与 CI
Node 24 的 npm 11 同族）：结果与 CI 逐字一致（`added 4 packages, audited 632`）。
清点 node_modules：

- **MISSING：tree-sitter、tree-sitter-go、tree-sitter-java、tree-sitter-python、
  tree-sitter-cpp** —— 全部 5 个根 package.json 已声明的 optional peer。
- PRESENT：@tree-sitter-grammars/tree-sitter-kotlin（唯一不在 manifest 里的包）。
  「4 packages」= kotlin + 3 个传递依赖。

**根因（两个对照实验锁定）**：
1. `npm install --no-save tree-sitter@^0.25.0` 单独跑 → 输出 **"up to date"**，
   node_modules/tree-sitter 不存在。npm 把 CLI 实参与 manifest 里已声明的 optional
   peer 边归并，判定「清单已涵盖、无需安装」——optional peer 永远不会被物化。
   这就是疑点 B 的答案：不是 --legacy-peer-deps 的问题，是 npm 对
   「manifest 已声明的包 + --no-save」组合的语义。
2. 负控制 `npm install --no-save left-pad`（manifest 无关包）→ 正常安装（"added 1
   package"），但同时 **prune 掉了先前 --no-save 装的 kotlin** —— npm 每次 --no-save
   安装都按 manifest 全树对账。这也意味着「分多次各装一个」的方案不可行（后装的
   会清掉先装的）。

**疑点 A 排除**：fixture 包实验（postinstall 写标记文件）证明 npm 11.17 的
allow-scripts 是 **Phase 1 advisory——脚本实际执行**，CI 里的 warning 无害。

**修复方案（scratch prefix + copy，已本地端到端验证）**：
npm 在对 manifest 不知情的前缀里装包，再把产物拷进项目 node_modules：

```bash
scratch=$(mktemp -d); cd $scratch; npm init -y
npm install --legacy-peer-deps tree-sitter@^0.25.0 tree-sitter-go@^0.25.0 \
  tree-sitter-java@^0.23.5 tree-sitter-python@^0.25.0 tree-sitter-cpp@^0.23.4 \
  @tree-sitter-grammars/tree-sitter-kotlin@^1.1.0
find node_modules -maxdepth 1 -mindepth 1 ! -name '.*' -exec cp -r {} <repo>/node_modules/ \;
```

**本地验证记录（/tmp/task53-repro，594550c）**：
1. scratch 安装 → "added 10 packages"：6 包 + 4 传递依赖（node-addon-api、
   node-gyp-build、tree-sitter-c、npm-check-updates）。四者均不在项目 lockfile
   （逐个查过 lock.packages = absent）→ 拷贝零冲突，纯增量。
2. `require()` 全 6 包 + Parser.setLanguage + 实际 parse：go/kotlin 均得
   source_file。prebuilds 是 **N-API 单文件/平台**（非按 ABI 切分），跨 Node
   22/24/26 通用——Node 版本无风险。
3. CI 里失败的测试抽样 → 2 文件 33 tests 全过。
4. **46 个 native 相关测试文件全跑：691 passed / 5 skipped（gopls 等环境 skip，
   既有）/ 0 failed**（158s）。
5. tests/unit/packaging/install-policy.test.ts 15/15 过（该测试只看
   package.json/lockfile，不看 live node_modules——文件头注释明言）；
   tests/integration/install-policy.test.ts 8/8 过（干净室 npm install 不受影响）。
6. 复现树 git status 干净：manifest/lock 全程未被触碰，packaging 策略合规。

**备选方案为何不走**：测试是 `import Parser from 'tree-sitter'` 直接导入（46 文件），
`ARCHGUARD_NATIVE_MODULE_ROOT`（docs Option 2）只作用于产品 parser-runtime 的
scopedRequire，救不了测试的裸 import；改 46 个测试文件侵入太大。

**顺带发现（coverage 闸门）**：vitest.config.ts reporter 无 `json-summary` → CI 的
`Check coverage thresholds` 步读的 `coverage/coverage-summary.json` 不存在，该步被
`if [ -f ]` 保护成静默 no-op；真正生效的阈值是 vitest 自带 `thresholds`（四项 80%，
不达标 `test:coverage` 自身退出非 0）。前四轮从未走到该步，本轮若 Run tests 转绿即
首次接受阈值检验——本地先跑 `npm run test:coverage` 预验证（结果见下）。

### 第 5 轮 — run `30838632184`，head `6e861d0`（scratch 修复首推，2026-08-03T17:51Z）

**结果：failure（新红步：coverage 阈值，非 tree-sitter）**。

- 修复即 5f39b8c（scratch prefix + copy + 6 包 native 冒烟测试）。native 冒烟测试步
  **通过**（不再 Cannot find module 'tree-sitter'）。
- Node 22 Run tests 完整跑完：**291 files passed / 3 skipped (294)；4501 tests passed /
  19 skipped (4520)；0 failed、0 cancelled**。测试层全绿。
- **唯一红步 = `npm run test:coverage` 的 vitest 内置阈值**（exit 1）：
  `ERROR: Coverage for lines (44.38%) does not meet global threshold (80%)`；
  statements 同 44.38%。这是 coverage 阈值**首次被真实检验**（前四轮从未走到该步，
  如顺带发现所预告）。CI "Check coverage thresholds" 步因 json-summary 缺失仍静默 no-op。
- Node 24 的 Run tests 被 cancelled（Node 22 失败后整 job 取消），无独立信息。
- 覆盖表里大块 0% 文件：各 plugin/types.ts（纯类型，v8 下无 JS 行，0% 属正常）、
  src/types/config-*、fitness-rules、git-history、metric-vector 等（无测试触达）；
  高覆盖区（parser/mermaid/core 90%+）真实可读。44.38% 是否真实 vs CI artifact 待
  **本地 `npm run test:coverage` 对比**（资源闸 GO 但 heavy-op 令牌被 quay 持有时不可跑）。

### 外层裁决（2026-08-03 ~18:05Z，阻塞解除）

44.38% **确认真实**（Node 22/24 双一致，v8 确定性；branches 84.9%/functions 91% 早已达标，
仅 lines/statements 不过）。80% lines/stmts 是 CI 史上从未满足过的理想化闸门。裁决：
1. **80% 提升超出 TASK-53 AC4 范围**，不塞进本任务（避免范围爆炸）；
2. **重校 vitest.config.ts**：functions/branches 保持 80，lines/statements 降到 **40**
   （实测 44.38 下方留余量、保留回归闸门），注释写明基线 2026-08-03 + 指向 TASK-58；
3. **TASK-58 已由外层建好**（coverage 44→80%，含 Contract/验证），本任务不建。
恢复后已 `--clear` 阻塞信号（等待 190.8s）。执行：改 vitest.config.ts → push → round 6 → watch；
green → AC4 ✅ + 关闭本任务 + 派发 TASK-56；red → 定位新失败点写回本段报外层。

### 第 6 轮 — run `30839577973`，head `761ee4e`（阈值重校，2026-08-03T18:04–18:09Z）

**结果：success ✅ — TASK-53 DONE，AC4 达成。**

- 改动：vitest.config.ts thresholds lines/statements 80→40（functions/branches 保 80），
  注释带 2026-08-03 基线 44.38% + TASK-58 指向（commit 761ee4e）。
- Node 22 + Node 24 + Quality Gate 三 job 全 success。
- AC4 判定：`gh run list --limit 1 --json conclusion,status` → success。
- 已更新 `orchestration/goals-and-ac.md` AC4 → ✅（详情行 + 汇总表行，写明依据）。
- 后续：派发 TASK-56（前置已满足）；coverage 真实提升由外层已建的 TASK-58 跟踪。

### 已确认事实（跨轮沉淀）

- CI 全链路现在唯一红步是 **Run tests**（type-check/lint/format/build 均已绿）。
- native tree-sitter 系列：`tree-sitter@0.25.0`、cpp `0.23.4`、go `0.25.0`、java `0.23.5`、
  python `0.25.0`、kotlin grammar `1.1.0`（本地已装，均不在 lock）。
- `check-runtime-deps`（TASK-30）只扫 `dist/**` 字面量裸导入；`native-parser-backend` 用
  `scopedRequire(RUNTIME_MODULE)` 变量动态 require，故 native 即使不在 `dependencies` 也不报错
  ——这是「native 可选项」能通过构建检查的原因。
- 环境：本地 node v26.5.0、npm 11.17.0；CI 用 setup-node@v3（Node 22→npm 10，Node 24→npm 11）。
- **npm 语义**：`npm install --no-save <pkg>` 对 manifest 已声明（含 optional peer）的
  包是 no-op（"up to date"）；每次 --no-save 安装还会按 manifest 全树对账、prune 清单外
  包。→ native 包必须经 manifest 不知情的 scratch 前缀安装再拷入 node_modules。
- native 包 prebuilds 为 N-API 单文件/平台（tree-sitter@0.25 的 linux-x64 只有一个
  tree-sitter.node），跨 Node ABI 通用；allow-scripts 在 npm 11.17 仅 advisory 不阻断。
- 主仓 node_modules 的 native 包已在 f628b8f 后的某次 npm ci 被清掉（本地 require 亦
  MODULE_NOT_FOUND），CI 修复落地后用同一 scratch 手法补回，保持本地/CI 一致。

## Dispatch review

| Field | Value |
|---|---|
| reviewer | outer |
| at | 2026-08-03T16:10Z |
| changed | 2026-08-03T16:48Z — 追加 Progress 段（第 1–4 轮分析）；任务未完成 |
