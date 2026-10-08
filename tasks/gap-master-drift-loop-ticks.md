---
id: gap-master-drift-loop-ticks
title: master 被 loop 的 task-store tick 推离发布 tag，且 AC-001 守卫不在任何常驻路径：恢复 master 到
  v0.1.38、把主检出切回 fork_baseline、并给守卫接常驻断言（GOAL-001 / AC-001）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-001
---
## Proposal

GOAL-001 / AC-001 回归（本轮两次独立复测均为假）：工作区根（`/data/home/yale/work/archguard`，即 goal driver 评估的那棵树）的 `master` = `e63e2bc3`，`git tag --points-at master` 为空。`bash scripts/check-master-at-tag.sh /data/home/yale/work/archguard` 真实 exit 1，stderr 为 `CAUSE=master-not-at-a-version-tag: master (e63e2bc3...) carries no vX.Y.Z tag (tags pointing at it: none)`。最近一次发布点 `v0.1.38` -> `2c605b60`（2026-10-08 16:11:04），master 在它之上恰多一个提交 `e63e2bc3 tasks: gap-untagged-version-drift-guard task_write by cli:2191736`（16:12:03）：直接量 `git log --oneline v0.1.38..master` 只有这一条，`git diff --stat v0.1.38..master` 只动 `tasks/gap-untagged-version-drift-guard.md`。远端 `origin/master` 仍在 `2c605b60`（== `v0.1.38`，正确）；漂移只发生在**本地主检出的 `master` 分支**上。

为什么上一次修复（`gap-release-workflow-advance-master-ff-only`，已 `done`，`goal_ac: AC-001`）没有守住：

1. 它交付的 `advance-master` 是 `.github/workflows/release.yml` 里**由 tag push 触发的一次性前进**（全部 job 全绿后把 master ff 到该 tag）。一次性的前进在构造上**管不住 tag 之后再落到 master 上的提交**——本回归正是「tag 之后的一个提交」（一条 task-store tick）。
2. 它交付的 `scripts/check-master-at-tag.sh` 是 AC-001 判据的可执行化，却**没有接进任何常驻路径**：`npm test`、`ci.yml`、`release.yml` 都不跑它，只有它自己的单测 `tests/unit/scripts/release-workflow.test.ts` 调用。仓库状态偏离 tag 时，没有任何常驻机件变红。

根因机制（实测，非推断）：quay loop 的 task-store tick（commit message `tasks: <id> task_write by cli:<pid>`）提交到**主检出的当前分支**——driver 侧是 `git -C <root> add -- <rel> && git commit --no-verify -m <msg> -- <rel>`（`.quay/plugin/scripts/dist/worker-driver.js:32621-32622`，`root` = 主检出），随后 doc-develop-sync 把该分支推进 `develop`。主检出当前正检出 `master`（`git -C /data/home/yale/work/archguard symbolic-ref --short HEAD` = `master`），于是每一次 tick 都把 `master` 推离发布 tag 一格；而 `semanticSyncDocToDevelop(root, cur)` 对「当前分支」做的 disposable 判定与 `git reset --hard develop`（同文件 38407/38410 附近）会直接把 master 挪到 develop 的尖端——这解释了本地 `master` == `develop` == `e63e2bc3`。主检出本应停在 `fork_baseline`（`.quay/config.yml` 的 `loop.fork_baseline: develop`）；loop 文档明确预案了「主检出正检出的分支就是 `$FORK_BASELINE`」，并按 ref-level（update-ref CAS）对账（`.quay/plugin/loop/fast-mode-loop-tick.md:415-421`）。停在 `master` 是异常状态——很可能源自人在主检出上做 0.1.38 发布后没有切回。

方案（本任务只做 AC-001 这一面；不碰 AC-002 的 tag 守卫、AC-003 的载体一致、AC-004、AC-005）：

1. **立即恢复不变量**：把工作区根的本地 `master` 放回 `v0.1.38` tag 的提交（`git -C /data/home/yale/work/archguard branch -f master v0.1.38`，即 `origin/master`）。这是对**已存在 tag 的本地分支修复**，不是发布前进、不 push、不改 tag；tick 提交 `e63e2bc3` 已保留在 `develop` / `origin/develop` 上，不丢东西。
2. **拔掉漂移源**：把工作区根切到 `fork_baseline`（`git -C /data/home/yale/work/archguard checkout develop`），使 loop 的 task-store tick 从此落在 `develop` 而非 `master`。（等价机制亦可，只要 tick 不再落在 master 上；判据见 AC。）
3. **把守卫提升为常驻不变量**（与 AC-002 兄弟任务同构）：
   a. 在 `tests/unit/scripts/release-workflow.test.ts` 增加一条**真实仓库**用例：对 `REPO_ROOT` 真实运行 `check-master-at-tag.sh`，断言 exit 0；仅当该检出没有本地 `master` ref（脚本输出 `CAUSE=no-master-ref`，例如 CI 的 PR 检出）时豁免，且**任何情况下都不得出现 `CAUSE=master-not-at-a-version-tag`**。因为 `npm test` 是 loop 与 CI 的常驻路径，这使 master 一漂移测试套件立刻变红。
   b. 在 `.github/workflows/ci.yml` 增加一步：`if: github.event_name == 'push' && github.ref == 'refs/heads/master'` 时运行 `bash scripts/check-master-at-tag.sh`（该场景下 master 就是检出分支，不存在 no-master-ref 问题）。
4. **回归测试**：保留 `tests/unit/scripts/release-workflow.test.ts` 现有的临时仓库正反例（master 在 tag 上 exit 0；不在 tag 上 exit 1 + `CAUSE=master-not-at-a-version-tag`），并新增上面的真实仓库断言。
5. 范围说明：本任务不打 tag、不发布、不 push master、不改 `release.yml` 的 advance-master 逻辑。

<!-- dedup-ref -->
机制去重：AC-001 没有任何 in-flight 认领者——此前认领 AC-001 的 `gap-release-workflow-advance-master-ff-only` 已 `done`，它正是「上一次修复没守住」的证据，按回归另行立案，不是重复。相邻但机制不同：`gap-untagged-version-drift-guard`（AC-002，`ready`）修的是「package.json version 无同名 tag」的守卫位置与常驻断言，与 master 分支的值域无关；两者共享 `.github/workflows/ci.yml`（它给 ci.yml 加 develop 触发分支、本任务加一步 master 守卫），按 Touches 由调度器串行，**保持独立立案**（验收面不同：AC-002 vs AC-001；且该 peer 已 `ready`、即将派发，不宜再改写它）。`task-granularity-advice` 对本任务 Touches 返回 `peers: [gap-untagged-version-drift-guard]`、`sharedFiles: [.github/workflows/ci.yml]`。

## AC

- [ ] `git -C /data/home/yale/work/archguard tag --points-at master | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'` exit 0（master 的提交带回版本 tag）
- [ ] `bash scripts/check-master-at-tag.sh /data/home/yale/work/archguard` exit 0（工作区根上 AC-001 判据为真）
- [ ] 漂移源已除：`test "$(git -C /data/home/yale/work/archguard symbolic-ref --short HEAD)" != "master"` exit 0（loop 的 task-store tick 从此不落在 master 上；默认做法是切到 `develop`）
- [ ] `grep -Eq 'check-master-at-tag\.sh' tests/unit/scripts/release-workflow.test.ts` 命中且该文件含对 `REPO_ROOT` 的真实仓库断言，`npx vitest run tests/unit/scripts/release-workflow.test.ts` exit 0
- [ ] `grep -q 'check-master-at-tag.sh' .github/workflows/ci.yml` exit 0（ci.yml 在 push 到 master 时跑守卫）
- [ ] `npm run type-check` exit 0

## DoD

真实落地的标准不是「脚本存在 / wiring grep 命中」，而是机制被真实操作过：

- 在真实仓库上真实演示常驻断言的效力（红→绿）：临时把工作区根的 `master` 指到一个不带 tag 的提交（`git -C /data/home/yale/work/archguard update-ref refs/heads/master e63e2bc3`），运行 `npx vitest run tests/unit/scripts/release-workflow.test.ts` 必须**红**（命中 `CAUSE=master-not-at-a-version-tag`）；把 master 放回 `v0.1.38` 后必须**绿**。这一步证明新增断言把不变量真的钉进了常驻测试路径，而非只断言 wiring。
- 不变量真实的当场判据：工作区根上 `bash scripts/check-master-at-tag.sh` exit 0，且 `git tag --points-at master` 命中 `^vX.Y.Z$`。
- 漂移源真实被拔掉的判据：`git -C /data/home/yale/work/archguard symbolic-ref --short HEAD` 输出 `develop`（非 master），且在该状态下真实制造一次 task-store tick（例如 `quay task edit <本任务> --status todo` 或下一次 promotion tick）后 `git -C <main> rev-parse master` 不变、`develop` 前进一格。
- 临时仓库正反例仍真实执行（`npx vitest run tests/unit/scripts/release-workflow.test.ts` 全绿）。
- 本任务不打 tag、不发布、不 push master、不改 `release.yml`。→ 记录 worker 实际未做这些。

## Touches

- scripts/check-master-at-tag.sh
- tests/unit/scripts/release-workflow.test.ts
- .github/workflows/ci.yml
- tasks/gap-master-drift-loop-ticks.md
