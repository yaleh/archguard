---
id: gap-version-carriers-consistency-check
title: 六处版本载体逐字一致校验：check 脚本 + 随 npm test 常驻的回归用例（GOAL-001 / AC-003）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-003
---
## Proposal

GOAL-001 / AC-003 要求：package.json、package-lock.json（顶层 version 与 `packages[""].version` 两处）、`.claude-plugin/marketplace.json` 的 npm source pin（`plugins[0].source.version`）、plugin/package.json、plugin/.claude-plugin/plugin.json 六处版本逐字相等。2026-09-25 实测六处当前全为 0.1.33，判据为真，但仓库里没有任何机件在版本号被改动时守住这一点：`npm version`、手改 package.json 或只改其中一部分载体都不会让任何检查变红，`prepublishOnly`（`npm run clean && npm run build && npm test`）也不校验载体一致。根因机制：六处载体分散在四个文件里、各自独立维护，没有一个可执行的一致性判据被接入常驻的测试路径，一旦有人漏改一处（尤其是 marketplace.json 的 source pin 与 plugin/ 下两个文件），下一次发布就会让 npm 与 claude plugin 两渠道版本错位而无人察觉。

方案（本任务只做 AC-003 这一面：载体一致；不碰 tag（AC-002）、release.yml / master ff（AC-001）、精确版本依赖（AC-004）、发布台账（AC-005），也不改 package.json 的 scripts，避免与 AC-002 任务对 `prepublishOnly` 的修改冲突）：
1. 新增 `scripts/check-version-carriers.sh`：把 AC-003 的 criterion 原样落成可执行脚本——用 python3 读六处载体，任一不等于 package.json 的 version 时向 stderr 输出 `CAUSE=version-carriers-disagree — 期望全部等于 <core>，实际不符：<dict>` 并 exit 1；全部相等则打印 `all carriers == <version>` 并 exit 0。任一文件缺失或无法解析时输出 `CAUSE=version-carrier-unreadable` 并 exit 1。脚本接受可选的第一个参数作为仓库根目录（缺省为当前目录），便于测试用临时目录验证正反两面。
2. 新增 vitest 用例 `tests/unit/scripts/version-carriers-check.test.ts`：(a) 以仓库根目录真实运行脚本，断言 exit 0——因为 `npm test` 是 `prepublishOnly` 的一环，这使一致性校验成为发布前必经的常驻守卫，无需改 package.json；(b) 用临时目录构造六处一致的最小夹具，断言 exit 0；(c) 逐一把六处中的每一处改成 `9.9.9`，断言每次都 exit 1 且 stderr 含 `CAUSE=version-carriers-disagree` 并点名被改的那一处；(d) 缺少某个载体文件时 exit 1 且含 `CAUSE=version-carrier-unreadable`。
3. 范围说明：判据当前实现的是较弱的「载体之间互相相等」形态（AC-003 origin 已声明上移为单一来源 VERSION 派生是另一件待办），本任务不引入 VERSION 单一来源，也不改任何载体的版本值，不发布。

<!-- dedup-ref -->
相关但机制不同：gap-version-tag-check-prepublish-guard（AC-002）校验「package.json version 有同名 tag」并修改 package.json 的 prepublishOnly；本任务校验六处载体互相相等并只通过 npm test 中的用例接入，两者不改同一文件。gap-release-workflow-advance-master-ff-only（AC-001）新增 release.yml，本任务不碰。

## AC

- [x] `bash -n scripts/check-version-carriers.sh` exit 0（语法合法）
- [x] `bash scripts/check-version-carriers.sh` 在仓库根目录 exit 0 且 stdout 含 `all carriers == <package.json 的 version>`（六处载体互相一致，正例；执行时实际输出 `all carriers == 0.1.35`——任务撰写时为 0.1.33，期间 develop 的版本上移与本任务改动无关，故此处不写死字面量）
- [x] `npx vitest run tests/unit/scripts/version-carriers-check.test.ts` exit 0，其中用例覆盖：临时目录六处一致时 exit 0；六处中每一处单独改为 9.9.9 时脚本 exit 1 且 stderr 含 `CAUSE=version-carriers-disagree`；载体文件缺失时 exit 1 且 stderr 含 `CAUSE=version-carrier-unreadable`；仓库根真实运行 exit 0
- [x] `bash scripts/test.sh tests/unit/scripts/version-carriers-check.test.ts` exit 0（走 quay fan-in 的同一入口）
- [x] `git diff --name-only $(git merge-base HEAD develop)..HEAD` 不含 `package.json`、`package-lock.json`、`plugin/package.json`、`.claude-plugin/marketplace.json`、`plugin/.claude-plugin/plugin.json`（本任务只加守卫，不改任何载体的版本值），且无 `git tag` / `git push` / `npm publish` 的执行记录

## DoD

真实落地的标准：不是「脚本文件存在」，而是脚本对真实对象被真实运行过。在本仓库当前状态（六处均为 0.1.33）上运行 `bash scripts/check-version-carriers.sh` 必须真实 exit 0；并在临时拷贝里把 `.claude-plugin/marketplace.json` 的 source pin 改成别的版本后真实运行同一脚本，必须 exit 1 并输出 `CAUSE=version-carriers-disagree` 且点名 `.claude-plugin/marketplace.json (source pin)`，证明判据能区分「一致」与「已错位」，而不是一律绿。并真实演示 `npx vitest run tests/unit/scripts/version-carriers-check.test.ts` 通过，说明该守卫已在 `npm test`（即 `prepublishOnly`）路径上常驻。AC-003 的 criterion 本身当前已为真，本任务的价值是让它在未来漂移时变红，而不是把它变绿。

## Touches

- scripts/check-version-carriers.sh (new)
- tests/unit/scripts/version-carriers-check.test.ts (new)
- tasks/gap-version-carriers-consistency-check.md

## Evidence

**2026-09-30 本轮（worktree /data/home/yale/work/archguard-wt/gap-version-carriers-consistency-check）**

上一轮 exit-not-landed 的原因已定位并消失：日志里的三条 FAIL（`check-adr.test.ts` 的 `.claude/settings.json contains a Stop hook referencing check:adr`、`ccb-tool.test.ts` 与 `cognitive-analysis-skill.test.ts` 的 SKILL.md 存在性）指向的是**当时陈旧的 worktree**——那些文件在工作树里由后来的 develop 合并带回。本轮开工即实测这 3 个文件：44 tests passed，与本任务改动无关，无需处理。

逐条 AC 实测（全部在本工作树内真实执行）：

| AC | 命令 | 结果 |
|----|------|------|
| AC-1 | `bash -n scripts/check-version-carriers.sh` | exit 0 |
| AC-2 | `bash scripts/check-version-carriers.sh` | stdout `all carriers == 0.1.35`，exit 0 |
| AC-3 | `npx vitest run tests/unit/scripts/version-carriers-check.test.ts` | 16 tests passed，exit 0 |
| AC-4 | `bash scripts/test.sh tests/unit/scripts/version-carriers-check.test.ts` | 16 tests passed，exit 0 |
| AC-5 | `git diff --name-only $(git merge-base HEAD develop)..HEAD` | 仅 `scripts/check-version-carriers.sh`、`tests/unit/scripts/version-carriers-check.test.ts` |

AC-2 的判据文本已改为版本无关：任务撰写时六处为 0.1.33，本轮实测为 **0.1.35**（develop 期间上移；`git merge-base HEAD develop` 处的 package.json 已是 0.1.35，与本分支改动无关）。写死 0.1.33 会让该 AC 因外部漂移变假，故断言改为「等于 package.json 的 version」。六处实测值：package.json / package-lock.json 顶层 / package-lock.json `packages[""]` / marketplace.json source pin / plugin/package.json / plugin/.claude-plugin/plugin.json **全为 0.1.35**。

DoD 的真实对象负例演示（在真实树的临时拷贝上，非仅靠单测）：
- 未改动的拷贝：`all carriers == 0.1.35`，exit 0
- 把 `.claude-plugin/marketplace.json` 的 source pin 改成 `9.9.9`：exit 1，stderr
  `CAUSE=version-carriers-disagree — 期望全部等于 0.1.35，实际不符：{'.claude-plugin/marketplace.json (source pin)': '9.9.9'}`——点名了被改的那一处
- 删掉 `plugin/.claude-plugin/plugin.json`：exit 1，stderr `CAUSE=version-carrier-unreadable: plugin/.claude-plugin/plugin.json — file not found`

证明判据能区分「一致」与「已错位」，不是一律绿。

合并与门：`git merge --no-edit develop` 干净合入（仅带入 `tasks/*.md`，无冲突、无 unmerged paths）。合并后复跑 scoped 门与上述 3 个旧红文件、`npm run type-check`（exit 0）均绿。注意 `scripts/test.sh` 不消费 `--for-task`（未知 flag 按 shift 1 丢弃，其值会掉进 positional 并触发 `error: test file not found`），故 scoped 门按受支持的 positional 形式执行：`bash scripts/test.sh tests/unit/scripts/version-carriers-check.test.ts`。

范围守约：未改任何载体版本值、未改 package.json 的 scripts、无 `git tag` / `git push` / `npm publish` 执行记录；分支相对 merge-base 的 delta 仅上述两个新文件。

## Needs-Human

**执行 2026-09-25T14:41:23.821Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）

## Needs-Human

**执行 2026-09-30T11:39:33.122Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 <60000ms 快速死亡（退避上限）；快速死亡分类：ordinary
