---
id: gap-untagged-version-drift-guard
title: 无 tag 的版本漂移无闸：把 AC-002 守卫从 prepublishOnly 提升为常驻不变量，并清除当前未发布的 0.1.38
  漂移（GOAL-001 / AC-002）
status: ready
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

GOAL-001 / AC-002 要求：package.json 的 version 一定有一个同名 `v*` tag。上一次修复（`gap-version-tag-check-prepublish-guard`，已 done，`goal_ac: AC-002`）交付了 `scripts/check-version-has-tag.sh` 并把它串进 `prepublishOnly`。但那个守卫只在 `npm publish` 那一刻运行，而且它的 vitest 用例只断言「wiring 存在」+ 临时目录正反例 —— **从不在真实仓库上运行守卫**，CI 也不跑它。于是两次发布之间，版本载体可以被抬到 tag 之前而没有任何机件变红。

本次回归实测（2026-10-08，主检出工作树）：六处版本载体（`package.json`、`package-lock.json` 顶层与 `packages[""].version`、`plugin/package.json`、`plugin/.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json` 的 npm source pin）全部被抬到 `0.1.38`，而 npm 上两个包仍是 `0.1.37`、git tag 最高 `v0.1.37`、`.quay/release-runs.jsonl` 末行是 v0.1.37、CHANGELOG 顶部是 `[0.1.37]`；这六处改动**未提交、无 CHANGELOG 条目、无任何任务认领**。直接量：`bash scripts/check-version-has-tag.sh` 现在真实 exit 1 并输出 `CAUSE=published-version-without-a-tag: package.json version 0.1.38 has no tag v0.1.38`，而 `npm test` 全绿 —— 这就是「守卫已接线」与「不变量真的成立」之间的缺口。

根因机制：守卫挂在**发布边界**（`prepublishOnly`），而不变量断言的是**仓库状态**（package.json 的 version 有 tag）。version 可以在任意时刻被抬到 tag 之前，而发布边界永远走不到，守卫因此保持沉默。上一次修复把「发布前必须已有 tag」钉死了，却没有把「仓库里不存在无 tag 的 version」钉死。

方案（本任务只做 AC-002 这一面；不碰 AC-001 的 release.yml / master 推进、AC-003 的载体一致脚本自身、AC-004、AC-005）：
1. **立即恢复不变量**：把工作区根（共享 checkout，即 goal driver 评估的那棵树）六处载体的 version 字段还原为最后一次已 tag 且已发布的值 `0.1.37`。依据：`0.1.38` 未提交、未发布（npm=0.1.37）、无 tag、无 CHANGELOG 条目、无任务认领，是一次悬空且未完成的 bump；发布按 GOAL-001 是人在会话里触发的原子动作（bump+commit+tag+publish），不变量不允许一个长期无 tag 的 bump 挂在仓库里。⚠️ 只还原 version 字段，不回退本次 bump 附带的描述性文字改动（如 skill 列表）。
2. **把守卫从「发布边界」提升为「常驻不变量」**：
   a. 在 `tests/unit/scripts/version-tag-check.test.ts` 增加一条**真实仓库**用例：对 `REPO_ROOT` 运行守卫并断言 exit 0。因为 `npm test` 同时是 `prepublishOnly` 与 CI 的一环，这使「仓库里 version 无 tag」立刻让测试套件变红，补上上一次修复留下的盲点。
   b. 在 `.github/workflows/ci.yml` 增加一步显式运行 `bash scripts/check-version-has-tag.sh`，并把 `develop` 加入 push 触发分支 —— 当前 ci.yml 只在 master|main 触发，集成线上这个不变量没有任何闸（这正是漂移能在 develop 静默发生的原因）。
3. **回归测试**：保留并确认临时仓库的正反例（无 tag → exit 1 + `CAUSE=published-version-without-a-tag`；package.json 缺失/无 version → exit 1 + `CAUSE=package-version-unreadable`），新增真实仓库断言如上。
4. 范围说明：本任务不打 tag、不发布、不碰 master；若人确实要做 0.1.38 发布，按 `npm version v0.1.38`（原子 bump+commit+tag）后再 publish，不得留下无 tag 的 bump。

<!-- dedup-ref -->
机制去重：`gap-version-tag-check-prepublish-guard`（已 done，`goal_ac: AC-002`）交付的正是同一个守卫脚本，但它把断言放在发布边界、且用例不跑真实仓库 —— 本任务修的是同一机制被放错的位置与缺失的常驻断言，属「上一个 done 任务的修复没有守住」的回归，不是重复立案。相邻但机制不同：`gap-version-carriers-consistency-check`（AC-003，六载体互相相等）、`gap-release-workflow-advance-master-ff-only`（AC-001）、`gap-release-run-ledger-recorder`（AC-005），均不改本任务的断言面。粒度决定：`task-granularity-advice` 对本任务 Touches 返回 `peers: []` / `mentions: []`，无合并候选。

## AC

- [x] 工作区根（`/data/home/yale/work/archguard`，即 goal driver 评估的那棵树）上 `bash scripts/check-version-has-tag.sh /data/home/yale/work/archguard` exit 0（漂移已清：package.json version 有同名 tag）
- [x] 六处载体逐字相等且等于最后一次已 tag 的版本：`bash scripts/check-version-carriers.sh /data/home/yale/work/archguard` exit 0
- [x] `grep -Eq 'runCheck\(REPO_ROOT\)' tests/unit/scripts/version-tag-check.test.ts` 命中（新增对真实仓库运行守卫并断言 exit 0 的用例），且 `npx vitest run tests/unit/scripts/version-tag-check.test.ts` exit 0
- [x] `grep -q 'check-version-has-tag.sh' .github/workflows/ci.yml` 命中，且 `grep -A2 '^  push:' .github/workflows/ci.yml | grep -q develop` 命中（ci.yml 的 push 触发分支包含 develop）
- [x] `node -e "const s=require('./package.json').scripts.prepublishOnly; if(!s.includes('scripts/check-version-has-tag.sh')) process.exit(1)"` exit 0（守卫仍接在发布边界上）
- [x] `npm run type-check` exit 0

## DoD

真实落地的标准不是「脚本存在 / wiring grep 命中」，而是机制被真实操作过：

- 在临时仓库（version 无同名 tag）上真实运行守卫，必须 exit 1 且 stderr 含 `CAUSE=published-version-without-a-tag`；同名 tag 存在时 exit 0（正反两面各真实跑一次）。→ 已由 `version-tag-check.test.ts` 的两条临时仓库用例真实执行（`npx vitest run` 6 passed）。
- 在**真实仓库**上真实演示常驻断言的效力：临时把 package.json 的 version 改成一个无 tag 的值（如 `9.9.9`），运行 `npx vitest run tests/unit/scripts/version-tag-check.test.ts` 必须**红**；还原为真实已 tag 的版本后必须**绿**。这一步证明新增断言把不变量真的钉进了常驻测试路径，而非只断言 wiring。→ 已实测：9.9.9 → 1 failed（exit 1）；还原 0.1.37 → 6 passed（exit 0）。
- 漂移已清的判据：在 goal driver 评估的那棵树（工作区根）上，`bash scripts/check-version-has-tag.sh` exit 0。→ 实测 `ok: tag v0.1.37 exists`（exit 0），`check-version-carriers.sh` 亦 `all carriers == 0.1.37`（exit 0）。
- 本任务不打 tag、不发布、不 push master、不改 release.yml。→ 已遵守：未打 tag、未发布、未 push；`git tag --list` 最高仍 `v0.1.37`，`release.yml` 未改。

## Touches

- package.json
- package-lock.json
- plugin/package.json
- plugin/.claude-plugin/plugin.json
- .claude-plugin/marketplace.json
- scripts/check-version-has-tag.sh
- tests/unit/scripts/version-tag-check.test.ts
- .github/workflows/ci.yml
- tasks/gap-untagged-version-drift-guard.md