---
id: gap-version-carriers-single-source-derivation
title: 六处版本载体的单一来源 + 齐步生成：消除发布窗口内 npm 侧先行、plugin 侧滞后的载体错位（GOAL-001 / AC-003）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-003
---
## Proposal

### 现象（真实 exit 1，两次独立测量）

- **2026-10-10T05:11:04.706Z 与 05:11:10.323Z**：goal gate `AC-003` verdict=fail，reason=`acceptance failed (exit 1) — CAUSE=version-carriers-disagree — 期望全部等于 0.1.39，实际不符：{'.claude-plugin/marketplace.json (source pin)': '0.1.38', 'plugin/package.json': '0.1.38', 'plugin/.claude-plugin/plugin.json': '0.1.38'}`（`.quay/gate-events.jsonl`，actor=goal-cli）。同一窗口内 **npm 侧三处**（package.json、package-lock.json 顶层与 `packages[""]`）已是 `0.1.39`，而 **plugin 侧三处**仍是 `0.1.38` —— 这正是「部分 bump」的特征签名（npm 侧先行、plugin 侧滞后）。
- 当前状态：六处均已 `0.1.39`，`bash scripts/check-version-carriers.sh` 输出 `all carriers == 0.1.39`（exit 0）、`node scripts/check-version-carriers.mjs` 之类尚不存在。**即失败发生在真实发布进行中的未完成 bump 窗口里，载体补齐后自愈。**

### 机制（根因）

六处载体是**四个文件里各自独立维护的字符串**：`package.json`、`package-lock.json`（顶层 + `packages[""]` 两处）、`.claude-plugin/marketplace.json` 的 npm source pin、`plugin/package.json`、`plugin/.claude-plugin/plugin.json`。没有单一来源、也没有把它们**一起写出**的生成器。发布流程用 `npm version patch --no-git-tag-version`（见 `archguard-release-runbook` 记忆），它只改 `package.json` 与 `package-lock.json`（×2），plugin 侧三处由人另行编辑。于是从「npm 侧已抬到 0.1.39」到「plugin 侧也补齐」之间存在一个**载体互相不等**的窗口；goal driver 每约 40s 轮询主检出工作树，稳定命中。手改任意子集、或只跑 `npm version`，同样制造该窗口。

### 为什么上一次修复没有守住

`gap-version-carriers-consistency-check`（已 done，`goal_ac: AC-003`）交付了 `scripts/check-version-carriers.sh` 与真实仓库用例，但它没有消除载体各自的独立维护：

1. 脚本只断言「六处互相相等」。按 AC-003 origin 自己的裁定（quay SPEC-release-and-hotfix-branching §12.2），「载体之间互相相等」是**较弱形态**，结构上看不见一棵「全体一致但全体过时」的树，也拦不住部分 bump 造成的暂时不等；
2. 它把守卫**只接在 `npm test`（干净树）**路径上，而验收读的是**发布进行中的瞬时工作树**。窗口里没有任何守卫在跑——**守卫的观察面 ≠ 验收的观察面**，于是「守卫存在」而验收仍红。

### 方案（落到 AC-003 origin 明写的长期修复：单一来源 VERSION）

1. 新增 `VERSION`（仓库根，内容为当前发布版本，即 `<package.json version>`）作为**单一来源**。
2. 新增 `scripts/sync-version-carriers.mjs` 生成器：读 `package.json` 的 version，**齐步写入** `VERSION` 与六处载体（幂等、格式稳定，保留 2 空格缩进）；`--check` 模式只比对六处与 `VERSION`，任一不等则 stderr 输出 `CAUSE=version-carriers-disagree — 期望全部等于 <VERSION>，实际不符：<dict>` 并 exit 1，全等则 `all carriers == <version>` exit 0。
3. `scripts/check-version-carriers.sh` 把判据从「互相相等」上移到**外部来源**：每处载体必须等于 `VERSION`（而不仅是等于 package.json 的 version）。保留 `CAUSE=version-carriers-disagree` / `CAUSE=version-carrier-unreadable` 与 `all carriers == <version>` 的 stdout 契约，使依赖它的既有 CI/测试路径语义不变。
4. `package.json` 增加 npm `version` 生命周期脚本：`node scripts/sync-version-carriers.mjs --from-package && bash scripts/check-version-carriers.sh`（`--from-package` 以 package.json 的新版本为输入，齐步补 VERSION 与六处，随后自校验），并加 `sync-version` 便捷别名。任何经 `npm version <x>` 的 bump 都会在**同一次 npm 调用内**把六处补齐并自校验，部分 bump 无法悬挂。
5. 回归测试扩展 `tests/unit/scripts/version-carriers-check.test.ts`（复用其临时夹具 helper）：以 `VERSION` 为比较来源；「六处互相相等但都 ≠ VERSION」→ exit 1（旧判据看不见的树，正是本次回归的形态）；六处逐一 ≠ VERSION → exit 1 且点名该处；`VERSION` 缺失 → exit 1 且含 `CAUSE=version-carrier-unreadable`；生成器把六处由 package.json 齐步写出且二次调用字节不变（幂等）；仓库根真实运行 exit 0。

范围：本任务只做 AC-003（载体单一来源与一致）。不打 tag、不发布、不碰 master、不改 `.github/workflows/release.yml`；不新建 `scripts/release.sh`、不新建 `.githooks/pre-commit`（那是 `gap-ac002-release-window-untagged-bump` 的 Touches）。

<!-- dedup-ref -->
机制去重：claim AC-003 的 in-flight 任务为 0——`gap-version-carriers-consistency-check` 已 `done`，正是「上一次修复没守住」的证据，按回归另行立案（不是重复）。相邻但机制不同：`gap-ac002-release-window-untagged-bump`（AC-002，`todo`）修的是 **tag 窗口**（bump 先于 tag）并把发布赶出主检出；本任务修的是**载体的派生与归属**（六处不再各自维护，判据改为对外部单一来源）。两者共享 `package.json`（该 peer 加 `release` 别名；本任务加 `version` 生命周期，调度器按 Touches 串行）；本任务修改的 `scripts/check-version-carriers.sh` 在该 peer 只是 prose mention、非其 Touches。按 `task-granularity-advice`：`peers: [gap-ac002-release-window-untagged-bump]`、`sharedFiles: [package.json]`。**保持独立立案**：验收面不同（AC-003 vs AC-002），且该 peer 已 `todo`、范围已明确排除 AC-003 的载体脚本语义，不宜再改写。粒度：Touches 以既有文件为主（3 既有 / 2 新建实质文件），无合并候选。

## AC

- [ ] `bash scripts/check-version-carriers.sh` 在仓库根 exit 0，stdout 含 `all carriers == <version>`，且 `VERSION` 文件存在并逐字等于该 version（判据为外部来源：六处 == VERSION）
- [ ] `node scripts/sync-version-carriers.mjs --check` 在仓库根 exit 0；反例：在临时夹具中构造「六处互相相等（均 1.2.3）但 VERSION=9.9.9」→ exit 1 且 stderr 含 `CAUSE=version-carriers-disagree`（证明判据能看见旧形态看不见的『全体一致但过时』树）
- [ ] `npx vitest run tests/unit/scripts/version-carriers-check.test.ts` exit 0，覆盖：VERSION 为比较来源；六处互相相等却 ≠ VERSION → exit 1；六处逐一 ≠ VERSION → exit 1 且点名该处；VERSION 缺失 → exit 1 含 `CAUSE=version-carrier-unreadable`；生成器齐步写出六处且二次调用字节不变；仓库根真实运行 exit 0
- [ ] `node -e "const s=require('./package.json').scripts; if(!s.version||!s.version.includes('sync-version-carriers')) process.exit(1)"` exit 0（bump 路径已由生成器接管）
- [ ] `npm run type-check` exit 0
- [ ] `git diff --name-only $(git merge-base HEAD develop)..HEAD` 仅含 `VERSION`、`scripts/sync-version-carriers.mjs`、`scripts/check-version-carriers.sh`、`tests/unit/scripts/version-carriers-check.test.ts`、`package.json` 与本任务 `tasks/gap-version-carriers-single-source-derivation.md`；不含六处载体的 version 值改动（六处仍等于当前发布版本），且无 `git tag` / `git push` / `npm publish` 执行记录

## DoD

真实落地的标准不是「脚本存在 / wiring grep 命中」，而是机制被真实操作过：

- **复现回归形态并证明判据能识别它**：在临时夹具里构造本次失败的同型树——npm 侧三处抬到 `0.1.40`、plugin 侧三处留 `0.1.39`、`VERSION=0.1.39`——运行 `bash scripts/check-version-carriers.sh <fixture>` 必须 exit 1 且点名三处不符。
- **证明生成器真的收敛**：对同一夹具运行 `node scripts/sync-version-carriers.mjs --from-package <fixture>`，再运行 `bash scripts/check-version-carriers.sh <fixture>` 必须 exit 0，且六处与 VERSION 逐字相等。
- **证明 bump 路径真的被接管**：在临时 git 夹具里，用一次 `npm version` 生命周期脚本（`npm run version` / 等价方式）模拟 bump，断言运行后**不存在**「npm 侧与 plugin 侧不等」的采样点（生成器与自校验在同一次调用内完成）。
- **真实回归对照**：当前主检出上 `bash scripts/check-version-carriers.sh` exit 0、`node scripts/sync-version-carriers.mjs --check` exit 0，记录命令与输出；并记录 AC-003 验收脚本在补 VERSION 后仍为真。
- **范围守约**：本任务不打 tag、不发布、不 push、不改 `package.json` 的 version 值、不改六处载体的 version 值、不建 `scripts/release.sh`、不建 `.githooks/pre-commit`、不改 `release.yml`。→ 记录 worker 实际未做这些。

## Touches

- VERSION (new)
- scripts/sync-version-carriers.mjs (new)
- scripts/check-version-carriers.sh (modified — 判据上移到外部来源 VERSION)
- tests/unit/scripts/version-carriers-check.test.ts (modified — VERSION 夹具与外部来源用例)
- package.json (modified — npm `version` 生命周期 + `sync-version` 别名)
- tasks/gap-version-carriers-single-source-derivation.md (new — self)
