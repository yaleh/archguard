---
id: gap-ac002-release-window-untagged-bump
title: AC-002 在发布窗口内假红：发布先抬 package.json 再建 tag（主检出内 bump + runbook 显式
  --no-git-tag-version），验收读工作树 → 让 bump+tag 原子化并把发布赶出主检出
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-002
---
## Proposal

### 现象（真实 exit 1，两次独立测量）
- **2026-10-10T05:11:04.245Z 与 05:11:09.856Z**：goal gate `AC-002` verdict=fail，reason=`acceptance failed (exit 1) — CAUSE=published-version-without-a-tag — package.json version=0.1.39 没有对应的 tag v0.1.39`（`.quay/gate-events.jsonl`，actor=goal-cli）。这就是本轮「第二次测量也失败」。
- **2026-10-08T08:06:44Z–08:08:10Z**：同型失败 ×3，`version=0.1.38 没有对应的 tag v0.1.38`（`.quay/goal-round.jsonl` round 30090–30092）。同一条缝两次发布各出现一次，不是一次性误报。
- 现在状态：`v0.1.39` 已补齐，`bash scripts/check-version-has-tag.sh /data/home/yale/work/archguard` = `ok: tag v0.1.39 exists`（exit 0）；`package.json`=0.1.39，`refs/tags/v0.1.39` → release 提交 `954fd7f4`。**即失败就发生在真实发布进行中的窗口里，tag 一建好就自愈。**

### 机制（根因两条，叠加）
AC-002 的验收脚本（`goals/AC-002-每个已发布版本都留下可核对的-tag.md` 的 `criterion`）读的是**工作树**的 `package.json`：
`v=$(python3 -c "import json; print(json.load(open('package.json'))['version'])"); git rev-parse -q --verify "refs/tags/v$v"`。
而发布必须先 bump `package.json`（及另五处版本载体）再 commit、再 `git tag`。于是从「工作树被抬到 0.1.39」到「tag v0.1.39 存在」之间存在一个**未打 tag 的窗口**。0.1.39 这次窗口实测约 60–90s：`git reflog` 显示 release 提交 `954fd7f4 release: 0.1.39` 是由**主检出直接提交到 develop** 的；期间工作树 `package.json`=0.1.39、HEAD 仍是 `47d727ca`(0.1.38)、最高 tag 仍 `v0.1.38`。goal driver 每约 40s 轮询主检出工作树，稳定命中（05:10:32 pass → 05:11:04/09 fail → ~05:11:41 建 tag）。

1. **验收读工作树**，而发布自身会把工作树推进「版本已抬、tag 未建」的瞬时态；
2. **发布在主检出内进行**，且发布 runbook（见 `archguard-release-runbook` 记忆）用 `npm version patch --no-git-tag-version` **显式延后 tag**，把「bump 先于 tag」写进了流程。

### 为什么上一次修复没有守住
`gap-untagged-version-drift-guard`（已 done，`goal_ac: AC-002`）把守卫从 `prepublishOnly` 提升为常驻不变量：新增 `tests/unit/scripts/version-tag-check.test.ts` 对 `REPO_ROOT` 真实运行守卫 + `.github/workflows/ci.yml` 显式跑 `check-version-has-tag.sh`。但这两条路径观察的都是**干净的树**——CI 检出的是被 push 的提交，`npm test` 只在 `prepublishOnly`（tag 之后）跑；而 goal driver 的 AC-002 验收读的是**主检出正在变脏的瞬时工作树**。**守卫的观察面 ≠ 验收的观察面**，窗口里没有任何守卫在跑，于是「不变量成立」了、验收仍红。同型失败在 0.1.38（2026-10-08）已发生一次，确认这是一条每次发布都会复现的机制缝。

### 方案（只做 AC-002 这一面；不碰 AC-001 的 master 推进、AC-003 的载体脚本语义、AC-004、AC-005）
1. **让 bump 与 tag 原子化，消灭窗口**：新增 `scripts/release.sh X.Y.Z`，在一次非交互调用内按序完成——写/占位 CHANGELOG 条目 → 同步六处版本载体 → `bash scripts/check-version-carriers.sh` 必须 exit 0 → `git commit -m "release: X.Y.Z"` → **紧接** `git tag vX.Y.Z`，中途不插入 build/test/其他工作（build/test 留给 push 后 `release.yml` 的 verify）。脚本结束自校验 `git rev-parse -q --verify refs/tags/vX.Y.Z`，失败即 exit 1 并回滚该提交。目标：未打 tag 窗口 < 一次轮询间隔（~40s），实践 < 1s。
2. **把发布赶出主检出**：`scripts/release.sh` 在**主 worktree**（`git rev-parse --git-dir` == `git rev-parse --git-common-dir`）运行时拒绝执行，稳定错误码 `CAUSE=release-must-run-in-a-linked-worktree`，提示在 linked worktree 内做（与 runbook §1「独立 worktree」一致）。这样主检出工作树在整场发布里永远不改，验收树恒绿；主检出只在发布完成后 fast-forward 到带 tag 的 release 提交。
3. **把守卫放到窗口里真的会跑的路径上**：新增 `.githooks/pre-commit`（并在共享 git config 设 `core.hooksPath=.githooks`）：仅当**本提交把 `package.json` version 抬到一个无同名 tag 的值、且发生在主 worktree** 时拒绝提交（linked worktree 或有 tag 时放行；无关的任务提交不受影响），把「在主检出里 bump 而不建 tag」在提交那一刻钉死，不依赖任何人记得跑 `npm test`。
4. **把流程落进仓库（不再是记忆）**：`scripts/release.sh --help` 与脚本头注释写明「发布只在 linked worktree 内、用本脚本原子完成 bump+commit+tag；主检出只在发布后 ff 到带 tag 的 release 提交」；`package.json` 增加 `release` 别名指向该脚本。
5. **回归测试（复用已有的不变量测试文件）**：扩展 `tests/unit/scripts/version-tag-check.test.ts`——复用其已有的临时仓库夹具，加入 release 窗口相关用例（原子发布后 tag 立即存在、主 worktree 拒绝、pre-commit 主 worktree 无 tag bump 拒绝 / 有 tag 或 linked worktree 放行）。

<!-- dedup-ref -->
机制去重：claim 本 AC 的任务共 2 个，均 `done`——`gap-version-tag-check-prepublish-guard`（把断言放在发布边界 `prepublishOnly`）、`gap-untagged-version-drift-guard`（提升为常驻不变量，但观察面仍是干净树）。本任务修的是「**验收观察面（主检出瞬时工作树）与守卫观察面（干净树）不一致**」这一机制缝，是上一次 done 修复未守住的回归，不是重复立案。相邻但机制不同：`gap-version-carriers-consistency-check`（AC-003 六载体互相相等）、`gap-release-workflow-advance-master-ff-only`（AC-001）、`gap-release-run-ledger-recorder`（AC-005），均不改本任务的断言面。粒度：`task-granularity-advice` 对本任务 Touches 返回 `peers: []` / `mentions: []`，无合并候选。

## AC

- [ ] `bash scripts/check-version-has-tag.sh /data/home/yale/work/archguard` exit 0（基线：当前不变量已由 v0.1.39 满足）
- [ ] `scripts/release.sh` 存在且 `bash scripts/release.sh --help` exit 0；在临时仓库真实跑 `bash scripts/release.sh 9.9.9` 后 `git rev-parse -q --verify refs/tags/v9.9.9` 命中，且 `git log --format=%s -1` == `release: 9.9.9`
- [ ] 在主 worktree 内运行 `bash scripts/release.sh 9.9.9` exit≠0 且 stderr 含 `CAUSE=release-must-run-in-a-linked-worktree`
- [ ] `npx vitest run tests/unit/scripts/version-tag-check.test.ts` exit 0，覆盖：原子发布成功、linked worktree 放行、主 worktree 拒绝、pre-commit 主 worktree 无 tag bump 拒绝 / 有 tag 放行
- [ ] `.githooks/pre-commit` 存在且可执行；`git -C /data/home/yale/work/archguard config --get core.hooksPath` 输出 `.githooks`
- [ ] `npm run type-check` exit 0

## DoD

真实落地的标准不是「脚本存在 / wiring grep 命中」，而是机制被真实操作过：
- **原子发布无窗口**：在临时仓库跑 `scripts/release.sh`，另起进程每 0.2s 采样 `package.json` version 与 `refs/tags/v$v`，断言**不存在**「version 有值但对应 tag 缺失」的采样点。
- **pre-commit 拦截真实生效**：在临时仓库主 worktree 中把 version 改成无 tag 的值并 `git commit`，必须 exit≠0 且 `git log` 不增长；补上同名 tag（或在 linked worktree 内）后同一提交成功。
- **主检出不被触碰**：本任务不打 tag、不发布、不改 `package.json` 版本、不 push master。
- **真实回归对照**：实测 AC-002 验收在当前主检出 exit 0，记录命令与输出。

## Touches

- scripts/release.sh
- .githooks/pre-commit
- package.json
- tests/unit/scripts/version-tag-check.test.ts
- tasks/gap-ac002-release-window-untagged-bump.md