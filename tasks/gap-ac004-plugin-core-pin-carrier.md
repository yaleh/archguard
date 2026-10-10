---
id: gap-ac004-plugin-core-pin-carrier
title: plugin 对 core 的精确版本钉（第七处载体）不在任何齐步派生/校验面：发布窗口内滞后 0.1.38 vs 0.1.39（GOAL-001
  / AC-004）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-004
---
## Proposal

### 现象（真实 exit 1，两次独立测量）

- **2026-10-10T05:11:05.146Z 与 05:11:10.791Z**：goal gate `AC-004` verdict=fail，两条独立事件（id `feab7116-ea29-494d-a633-70830d2cdb81` / `fd5e779c-e4e6-40ca-b6bb-bbc9477ff2b4`，actor=goal-cli），reason 逐字为 `acceptance failed (exit 1) — CAUSE=plugin-core-dependency-not-exact — plugin 对 core 的依赖是 '0.1.38'，core 版本是 '0.1.39'；带范围会让 plugin 静默解析到另一个运行时版本`（`.quay/gate-events.jsonl`）。
- 同一窗口内 AC-002（05:11:04/09）与 AC-003（05:11:04/09）也各自判 fail，三条读的是同一个发布瞬时态：`0.1.39` 发布在**主检出内**先把 npm 侧抬到 `0.1.39`，plugin 侧（含本条断言的依赖钉）仍停 `0.1.38`；约 05:11:41 建 tag 并补齐后才自愈。
- 当前状态：`package.json` = `0.1.39`，`plugin/package.json` 的 `dependencies['@yalehwang/archguard']` = `0.1.39`，AC-004 的 criterion 在仓库根 exit 0（stdout `exact pin ok: 0.1.39`）；已发布 npm 包 `@yalehwang/archguard-claude-plugin@0.1.39` 的 `dependencies` 同样是精确 `0.1.39`。**即失败只发生在发布进行中的未完成 bump 窗口内，载体补齐后自愈——这正是「守卫观察面 ≠ 验收观察面」的形态。**

### 机制（根因）

AC-004 唯一断言的载体是 `plugin/package.json` 的依赖钉 `dependencies['@yalehwang/archguard']`，它**不在任何齐步派生或校验面里**：

- `scripts/check-version-carriers.sh` 枚举的是**六处版本载体**（脚本头注释与 `CARRIERS` 表逐字列出）：`package.json.version`、`package-lock.json.version`、`package-lock.json.packages[""].version`、`.claude-plugin/marketplace.json` 的 npm source pin、`plugin/package.json.version`、`plugin/.claude-plugin/plugin.json.version`。依赖区间字符串**不是这六处之一**，也没有任何生成器写它。
- 于是它是一处**完全靠手改**的载体。发布 runbook 用 `npm version patch --no-git-tag-version` 只改 npm 侧三处，plugin 侧（含本钉）由人稍后另行编辑 → 从「core 已抬」到「钉也补齐」之间存在一个载体互相不等的窗口（0.1.39 这次实测约 60–90s），goal driver 每约 40s 轮询主检出工作树，稳定命中。
- 本条 criterion 自己区分、而当前无人守的两种失败模式：依赖缺失 → `CAUSE=plugin-missing-core-dependency`；依赖存在但 ≠ core 版本（含 `^`/`~` 前导范围）→ `CAUSE=plugin-core-dependency-not-exact`。

### 为什么上一次修复没有守住

- `gap-version-carriers-consistency-check`（已 done，`goal_ac: AC-003`）交付了 `scripts/check-version-carriers.sh`，但其范围**显式排除** AC-004（原文：「本任务只做 AC-003 这一面…不碰 tag（AC-002）、release.yml / master ff（AC-001）、**精确版本依赖（AC-004）**、发布台账（AC-005）」），因此枚举里没有这条钉——**守卫存在，但它的枚举面看不见这条载体**。
- `tests/unit/packaging/plugin-package.test.ts`（TASK-31 落地）确实钉住了「精确、无范围、等于 core version」，但它只在 `npm test` / CI 的**干净树**上运行；验收读的是发布进行中的**主检出瞬时工作树**。同一条缝已在 AC-002/AC-003 上被记录为「守卫的观察面 ≠ 验收的观察面」，本条是同一缝的第三个面。
- 0.1.39 窗口内两次独立测量均为 fail，故这是该机制的**回归发作**，不是一次性误报。

### 方案（只做 AC-004 这一面）

1. **把依赖钉纳入枚举**：在 `scripts/check-version-carriers.sh` 的 `CARRIERS` 中加入该钉，并按 AC-004 criterion 的语义给出同样的 CAUSE 码——缺失 → `CAUSE=plugin-missing-core-dependency`；存在但 ≠ `package.json` 的 version（含任何 `^`/`~` 前导）→ `CAUSE=plugin-core-dependency-not-exact`；全等时维持既有 `all carriers == <version>` stdout 契约与 exit 0，使既有消费者语义不变。
2. **让钉成为派生值、而非手改值**：新增 `scripts/sync-plugin-core-pin.mjs`，从 `package.json` 的 version 幂等写出该钉（保留 2 空格缩进、二次调用字节不变），并提供 `--check` 只比对模式与 `--from-package <root>`；把它接进 bump 路径（npm `version` 生命周期，与载体同步在同一次 npm 调用内完成），使「core 已抬、钉未抬」的采样点无法存在。
3. **回归测试**：扩展 `tests/unit/packaging/plugin-package.test.ts`——临时夹具复现本次窗口树（六处版本载体 = `0.1.40`、钉留 `0.1.39`）→ `bash scripts/check-version-carriers.sh <fixture>` 必须 exit 1 且点名该钉并含 `CAUSE=plugin-core-dependency-not-exact`；范围形态 `^0.1.40` 同样 exit 1；删除 `dependencies` 整键 → exit 1 且含 `CAUSE=plugin-missing-core-dependency`；跑生成器后 check exit 0 且钉逐字等于 version；生成器二次运行字节不变；仓库根真实运行 `--check` exit 0。

范围：本任务不打 tag、不发布、不 push、不改任何载体的 version 值、不改 `release.yml`、不碰 master 推进。

<!-- dedup-ref -->
机制去重：claim AC-004 的 in-flight 任务为 0（`grep '^goal_ac:' tasks/*.md` 无 AC-004；仅有的若干 prose 提及者除 `gap-ac002-release-window-untagged-bump` 外均已 done）。本条是回归——`gap-version-carriers-consistency-check`（done，AC-003）的六载体枚举显式排除 AC-004，`tests/unit/packaging/plugin-package.test.ts` 只在干净树上跑。相邻但机制不同：`gap-version-carriers-single-source-derivation`（AC-003，`todo`）把**六处版本载体**上移到单一来源 `VERSION` 派生，其枚举同样不含这处**依赖区间字符串**——即便它全绿，钉仍可滞后（它写 `plugin/package.json.version`，不写 `dependencies`）；`gap-ac002-release-window-untagged-bump`（AC-002，`todo`）修 **tag 窗口**并把发布赶出主检出，范围亦显式排除 AC-004。`task-granularity-advice` 返回 `peers: [gap-ac002-release-window-untagged-bump（共享 package.json）, gap-version-carriers-single-source-derivation（共享 scripts/check-version-carriers.sh、package.json）]`。**决定：separate（独立立案）**——验收面不同（AC-004 的 criterion 断言的是依赖钉这一独立 JSON 字段与两种专属 CAUSE 码），且两个 peer 均已 `todo`、范围显式排除 AC-004，不宜再改写；共享文件由调度器按 Touches 串行。粒度：Touches 以既有文件为主（3 既有 / 2 新建），无合并候选。

## AC

- [ ] `bash scripts/check-version-carriers.sh` 在仓库根 exit 0，stdout 含 `all carriers == <package.json 的 version>`（第七处钉已在枚举内，当前真值成立；不写死字面量）
- [ ] 临时夹具复现本次窗口树（`package.json` 与六处版本载体 = `0.1.40`、依赖钉留 `0.1.39`）→ `bash scripts/check-version-carriers.sh <fixture>` exit 1，stderr 含 `CAUSE=plugin-core-dependency-not-exact` 且点名该钉
- [ ] 夹具中把钉写成范围 `^0.1.40` → 同样 exit 1 且含 `CAUSE=plugin-core-dependency-not-exact`；删除 `dependencies` 整键 → exit 1 且含 `CAUSE=plugin-missing-core-dependency`
- [ ] 对同一夹具跑 `node scripts/sync-plugin-core-pin.mjs --from-package <fixture>` 后钉逐字等于夹具 version，再跑 check exit 0；二次运行生成器字节不变（幂等）
- [ ] `node scripts/sync-plugin-core-pin.mjs --check` 在仓库根 exit 0
- [ ] `npx vitest run tests/unit/packaging/plugin-package.test.ts` exit 0，覆盖窗口复现 / 范围 / 缺失 / 幂等四种形态
- [ ] `node -e "const s=require('./package.json').scripts; if(!s.version||!s.version.includes('sync-plugin-core-pin')) process.exit(1)"` exit 0（bump 路径已接管该钉）
- [ ] `npm run type-check` exit 0
- [ ] `git diff --name-only $(git merge-base HEAD develop)..HEAD` 仅含 `scripts/check-version-carriers.sh`、`scripts/sync-plugin-core-pin.mjs`、`tests/unit/packaging/plugin-package.test.ts`、`package.json` 与本任务 `tasks/gap-ac004-plugin-core-pin-carrier.md`；不含任何载体 version 值改动，且无 `git tag` / `git push` / `npm publish` 执行记录

## DoD

真实落地的标准不是「脚本存在 / grep 命中」，而是机制被真实操作过：

- **复现回归形态并证明判据能识别它**：在临时夹具里构造 2026-10-10T05:11 窗口的同型树（npm 侧与六处版本载体 = `0.1.40`，钉留 `0.1.39`），运行 `bash scripts/check-version-carriers.sh <fixture>` 必须 exit 1 且点名该钉。
- **证明派生真的收敛**：对同一夹具运行 `node scripts/sync-plugin-core-pin.mjs --from-package <fixture>`，再跑 check 必须 exit 0，且钉与 version 逐字相等；连续两次运行生成器，第二次字节不变。
- **证明 bump 路径真的被接管**：在临时 git 夹具里以一次 npm `version` 生命周期调用模拟 bump，断言运行后**不存在**「core version 已变而钉仍是旧值」的采样点。
- **真实回归对照**：当前主检出上 `node scripts/sync-plugin-core-pin.mjs --check` exit 0、`bash scripts/check-version-carriers.sh` exit 0，记录命令与输出；并记录 AC-004 criterion 在补钉后仍为真（`exact pin ok: <version>`）。
- **范围守约**：不打 tag、不发布、不 push、不改任何载体 version 值、不改 `release.yml`、不碰 master。→ 记录 worker 实际未做这些。

## Touches

- scripts/check-version-carriers.sh (modified — 枚举加入第七处依赖钉 + AC-004 的两种 CAUSE 码)
- scripts/sync-plugin-core-pin.mjs (new — 从 package.json version 幂等派生该钉；`--check` / `--from-package`)
- tests/unit/packaging/plugin-package.test.ts (modified — 窗口复现 / 范围 / 缺失 / 幂等用例)
- package.json (modified — bump 路径接上钉的同步与自校验)
- tasks/gap-ac004-plugin-core-pin-carrier.md (new — self)