---
id: gap-version-tag-check-prepublish-guard
title: 发布前校验 package.json version 有同名 v* tag：check 脚本 + prepublishOnly
  接线（GOAL-001 / AC-002）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-002
---
## Proposal

GOAL-001 / AC-002 要求：package.json 的 version 一定有一个同名 `v<version>` tag。2026-09-25 实测漂移：npm 上 @yalehwang/archguard 与 @yalehwang/archguard-claude-plugin 均已发到 0.1.33，但本仓库 `git tag` 最高只到 v0.1.31，0.1.32 / 0.1.33 两次发布没有 tag。根因机制：当前唯一的发布入口是 `package.json` 的 `prepublishOnly`（`npm run clean && npm run build && npm test`），它只验证构建与测试，不验证「本版本已有 tag」，所以人可以先 `npm publish` 后忘了打 tag，且没有任何机件因此变红。

方案（本任务只做 AC-002 这一面：tag 留痕；不碰 release.yml / master ff（AC-001）、版本载体一致（AC-003）、精确版本依赖（AC-004）、发布台账（AC-005））：
1. 新增 `scripts/check-version-has-tag.sh`：把 AC-002 的 criterion 原样落成可执行脚本——用 python3 读 `package.json` 的 version（读不出则 stderr 输出 `CAUSE=package-version-unreadable` 并 exit 1），再 `git rev-parse -q --verify refs/tags/v$version`，不存在则 stderr 输出 `CAUSE=published-version-without-a-tag` 并 exit 1，存在则 exit 0。脚本接受可选的第一个参数作为仓库根目录（缺省为当前目录），便于测试用临时仓库验证。
2. 修改 `package.json` 的 `prepublishOnly`：在最前面串入 `bash scripts/check-version-has-tag.sh &&`，使得没有对应 tag 的版本 `npm publish` 直接失败，发布顺序被固定为「先打 tag、后发布」。
3. 新增 vitest 用例 `tests/unit/scripts/version-tag-check.test.ts`：用临时 git 仓库对脚本做正反两面验证（version 有同名 tag → exit 0；无 tag → exit 1 且 stderr 含 `CAUSE=published-version-without-a-tag`；package.json 缺失或无 version → exit 1 且含 `CAUSE=package-version-unreadable`），并断言仓库根 package.json 的 `scripts.prepublishOnly` 含 `check-version-has-tag.sh`。
4. 范围说明：本任务不打 tag、不发布、不改 version，补齐缺失的 v0.1.32 / v0.1.33 tag 属于一次真实的发布动作，由人在会话里决定并执行；loop 不触碰 tag 与 master。

<!-- dedup-ref -->
相关但机制不同：gap-release-workflow-advance-master-ff-only（AC-001）新增 `.github/workflows/release.yml` 并让 master ff 到 tag，是 tag 已存在之后的推进机制；本任务是「发布前保证 tag 存在」的本地 prepublishOnly 守卫，两者不改同一文件，本任务不碰 release.yml。

## AC

- [ ] `npx vitest run tests/unit/scripts/version-tag-check.test.ts` exit 0，其中用例覆盖：临时仓库 version 有同名 tag 时脚本 exit 0；无 tag 时 exit 1 且 stderr 含 `CAUSE=published-version-without-a-tag`；package.json 缺失时 exit 1 且 stderr 含 `CAUSE=package-version-unreadable`
- [ ] `node -e "const s=require('./package.json').scripts.prepublishOnly; if(!s.includes('scripts/check-version-has-tag.sh')) process.exit(1)"` exit 0（守卫已接入 prepublishOnly）
- [ ] `bash -n scripts/check-version-has-tag.sh` exit 0（语法合法）
- [ ] `bash scripts/test.sh tests/unit/scripts/version-tag-check.test.ts` exit 0（走 quay fan-in 的同一入口）
- [ ] `git diff --name-only $(git merge-base HEAD develop)..HEAD` 不含 `.github/workflows/release.yml`，且本任务提交中无 `git tag` / `git push` / `npm publish` 的执行记录（loop 不触碰 tag 与发布）

## DoD

真实落地的标准：不是「文件存在」，而是脚本被真实运行过。在本仓库当前状态（package.json version=0.1.33，git tag 只到 v0.1.31）上运行 `bash scripts/check-version-has-tag.sh`，必须真实 exit 1 并输出 `CAUSE=published-version-without-a-tag`，证明判据能识别当前漂移；同时用临时仓库的正例证明合法状态下 exit 0。并真实演示 `npm run prepublishOnly` 会在守卫处先失败（无需真正发布）。本任务不打 tag、不发布，补齐缺失 tag 的那次真实发布动作由人在会话中触发，之后 AC-002 的 criterion 才会转为 achieved。

## Touches

- scripts/check-version-has-tag.sh
- package.json
- tests/unit/scripts/version-tag-check.test.ts
- tasks/gap-version-tag-check-prepublish-guard.md
