---
id: gap-release-workflow-advance-master-ff-only
title: release.yml 的 advance-master job：全绿后才把 master ff 到 vX.Y.Z tag（GOAL-001 /
  AC-001）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-001
---
## Proposal

GOAL-001 / AC-001 要求 master 的值域唯一：master 正好停在某个 `vX.Y.Z` tag 的提交上。2026-09-25 实测 master=`a90c17b3` 不带任何 tag，落后 develop 154 个提交，且仓库里没有 `release.yml`，唯一的 workflow 是 `.github/workflows/ci.yml`（只在 push/PR 到 master|main 时触发）。所以目前没有任何机件能让 master 合法前进，也没有机件在 master 偏离 tag 时报红。依据 quay SPEC-release-and-hotfix-branching-2026-09-15 §3.1 / §6：master 唯一许可的前进事件，是 release workflow 的 `advance-master` job 在全部 job 全绿后 ff 到该 tag。

方案（本任务只做 AC-001 这一面，不碰 npm publish / 版本载体 / 台账，那些归 AC-002..AC-005）：
1. 新增 `.github/workflows/release.yml`：触发条件为 `push` 的 tags `v[0-9]+.[0-9]+.[0-9]+`（人在 Claude Code 会话里打 tag 触发，loop 不触碰 master）。包含一个 `verify` job（npm ci + build + test，Node 22），以及 `advance-master` job：`needs: [verify]`（后续 AC 新增的 job 也必须加进该 needs 列表），checkout 时 `fetch-depth: 0`，执行 `git merge-base --is-ancestor origin/master "$GITHUB_SHA"` 判定可 ff，可以才 `git push origin "$GITHUB_SHA":refs/heads/master`（不带 `--force`）；不可 ff 则 exit 1 并输出 `CAUSE=master-not-ancestor-of-tag`，禁止 merge commit、禁止 force。
2. 新增 `scripts/check-master-at-tag.sh`：把 AC-001 的 criterion 原样落成可执行脚本（`git rev-parse master` → `git tag --points-at` → 匹配 `^v[0-9]+\.[0-9]+\.[0-9]+$`；失败时输出 `CAUSE=no-master-ref` / `CAUSE=master-not-at-a-version-tag`），供 goal 判定与 CI 复用。
3. 新增 vitest 用例，用临时 git 仓库对 check 脚本做正反两面验证（master 在 tag 上 exit 0；master 不在 tag 上 exit 1 且含对应 CAUSE），并用 js-yaml 解析 `release.yml` 断言结构：`advance-master` 的 `needs` 覆盖同文件内其余全部 job，且 push 命令不含 `--force` / `-f`。
4. 范围说明：把 master 首次对齐到一个真实 tag 属于一次真实发布，须由人在会话里触发。loop 永不触碰 master，本任务不得执行对 master 的 push。

<!-- dedup-ref -->
相关但机制不同：`.github/workflows/ci.yml`（只做 PR/push 的测试，不推进 master），本任务不改它；AC-002（tag 留痕）、AC-003（版本载体一致）、AC-004（精确版本依赖）、AC-005（发布台账）各自另有机制，不在本任务内。

## AC

- [ ] `npx vitest run tests/unit/scripts/release-workflow.test.ts` exit 0，其中用例：解析 `.github/workflows/release.yml`，断言 `on.push.tags` 含 `v[0-9]+.[0-9]+.[0-9]+`、存在 `advance-master` job 且其 `needs` 覆盖同文件内全部其他 job、其 run 步骤含 `--is-ancestor` 且不含 `--force` / ` -f `
- [ ] 同一测试文件用临时 git 仓库验证 `bash scripts/check-master-at-tag.sh`：master 指向带 `v1.2.3` tag 的提交时 exit 0；master 指向无 tag 提交时 exit 1 且 stderr 含 `CAUSE=master-not-at-a-version-tag`；无 master ref 时 exit 1 且 stderr 含 `CAUSE=no-master-ref`
- [ ] `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/release.yml','utf8'))"` exit 0（YAML 合法）
- [ ] `bash scripts/test.sh tests/unit/scripts/release-workflow.test.ts` exit 0（走 quay fan-in 的同一入口）
- [ ] `git diff --name-only $(git merge-base HEAD develop)..HEAD` 不含对 `master` 分支的任何操作痕迹，且本任务的提交内容里没有 `git push` 到 master 的执行记录（loop 不触碰 master）

## DoD

真实落地的标准：不是「文件存在」，而是 check 脚本被真实运行过。在本仓库当前状态（master 不带 tag）上运行 `bash scripts/check-master-at-tag.sh`，必须真实 exit 1 并输出 `CAUSE=master-not-at-a-version-tag`，证明判据能识别当前漂移；同时用临时仓库的正例证明它在合法状态下 exit 0。`release.yml` 经 js-yaml 解析并被结构断言覆盖；本任务不推 tag、不推 master，首次把 master 对齐到真实 tag 的那次发布由人在会话中触发，之后 AC-001 的 criterion 才会转为 achieved。

## Touches

- .github/workflows/release.yml (new)
- scripts/check-master-at-tag.sh (new)
- tests/unit/scripts/release-workflow.test.ts (new)
- tasks/gap-release-workflow-advance-master-ff-only.md

## Needs-Human

**执行 2026-09-25T14:41:23.741Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）

## Needs-Human

**执行 2026-09-30T11:39:36.334Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 <60000ms 快速死亡（退避上限）；快速死亡分类：ordinary
