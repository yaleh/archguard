---
id: gap-release-run-ledger-recorder
title: 发布台账 .quay/release-runs.jsonl 的写入与校验脚本：记录 cli-publish / plugin-publish /
  install-verify 三项结论（GOAL-001 / AC-005）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-005
---
## Proposal

GOAL-001 / AC-005 要求本地存在 `.quay/release-runs.jsonl`，且其最后一行同时记录 `cli-publish=success`、`plugin-publish=success`、`install-verify=success`。2026-09-25 实测：仓库里没有任何写这个台账的机件（`grep -rn release-runs` 只命中 goals/AC-005 记录本身），`.quay/` 下没有该文件，`.gitignore` 的 `.quay/*` 使它天然是本地载体，不入库。根因机制：发布动作（`npm publish` 两个包）与「真实装得上」的验证之间没有留痕环节，「release 对象存在」或「构建成功」被误读为「发布合格」（quay SPEC §4.4 / §11）。

方案（本任务只做 AC-005 这一面：台账的写入与校验机件；不碰 release.yml / master ff（AC-001）、tag 校验与 prepublishOnly（AC-002）、版本载体一致（AC-003）、精确版本依赖（AC-004），因此也不改 package.json）：
1. 新增 `scripts/record-release-run.mjs`：命令行参数 `--tag vX.Y.Z --cli-publish <status> --plugin-publish <status> --install-verify <status>`，可选 `--ledger <path>`（缺省 `.quay/release-runs.jsonl`，父目录不存在则创建）。status 只接受 `success` / `failure` / `skipped`，tag 必须匹配 `^v[0-9]+\.[0-9]+\.[0-9]+$`，缺任一参数或取值非法则 stderr 输出 `CAUSE=invalid-release-run-args` 并 exit 1，且不写文件。合法时向台账追加恰好一行 JSON：`{"tag","cli-publish","plugin-publish","install-verify","ts"}`（ts 为 ISO 时间），只追加、不改写既有行。
2. 新增 `scripts/verify-release-install.sh <version> [--dry-run]`：真实安装验证。在临时目录里 `npm install --prefix <tmp> @yalehwang/archguard@<version> @yalehwang/archguard-claude-plugin@<version>`，然后断言两个包安装后的 `package.json` version 都等于 `<version>`；任一不符或安装失败则 stderr 输出 `CAUSE=install-verify-failed` 并 exit 1，全部一致 exit 0，退出前清理临时目录（finally / trap）。`--dry-run` 只做参数与环境检查（npm 可用、version 形如 X.Y.Z）而不联网安装，供单测使用。stdout 的最后一行打印 `install-verify=success` 或 `install-verify=failure`，便于把结果直接喂给 record-release-run.mjs。
3. 新增 `scripts/check-release-ledger.sh`：把 AC-005 的 criterion 原样落成可执行脚本（文件不存在 → `CAUSE=carrier-absent`；无记录 → `CAUSE=carrier-empty`；最后一行任一项非 success → `CAUSE=release-run-incomplete`；均为 success exit 0）。接受可选第一个参数作为台账路径，缺省为 `.quay/release-runs.jsonl`。
4. 新增 vitest 用例 `tests/unit/scripts/release-run-ledger.test.ts`：用临时目录验证 record 脚本（合法参数追加一行且字段齐全、再次调用追加第二行且第一行不变；非法 status / 非法 tag / 缺参数 → exit 1 + `CAUSE=invalid-release-run-args` 且文件未创建）、check 脚本（无文件 / 空文件 / 最后一行含 failure / 最后一行三项 success 且前一行是 failure 时 exit 0）、以及 verify-release-install.sh 的 `--dry-run` 分支（合法版本 exit 0，非法版本 exit 1）。
5. 范围说明：本任务只交付机件，不真实发布、不写真实台账行。真实的一次发布（打 tag、`npm publish` 两个包、跑 verify-release-install.sh、用 record-release-run.mjs 追加一行三项 success）由人在会话里执行；loop 不触碰 tag、master 与 npm 发布。release.yml 的 job 调用 record 脚本属于 AC-001 任务所建 workflow 的后续接线，本任务不改 release.yml。

<!-- dedup-ref -->
相关但机制不同：gap-release-workflow-advance-master-ff-only（AC-001）建 release.yml 与 master ff 推进；gap-version-tag-check-prepublish-guard（AC-002）是发布前 tag 存在性守卫；gap-version-carriers-consistency-check（AC-003）是版本载体一致性。三者均不产生也不校验 `.quay/release-runs.jsonl`，本任务不改它们的文件（release.yml、package.json 的 prepublishOnly、版本载体检查脚本）。

## AC

- [ ] `npx vitest run tests/unit/scripts/release-run-ledger.test.ts` exit 0，其中用例覆盖：record 脚本合法参数追加恰好一行且含 tag / cli-publish / plugin-publish / install-verify / ts 五个字段，二次调用追加第二行且首行字节不变；非法 status、非法 tag、缺参数均 exit 1 且 stderr 含 `CAUSE=invalid-release-run-args` 且台账文件未被创建
- [ ] 同一测试文件覆盖 `bash scripts/check-release-ledger.sh <ledger>`：文件不存在 exit 1 且 stderr 含 `CAUSE=carrier-absent`；空文件 exit 1 且含 `CAUSE=carrier-empty`；最后一行 install-verify=failure exit 1 且含 `CAUSE=release-run-incomplete`；最后一行三项均 success（前一行为 failure）exit 0
- [ ] 同一测试文件覆盖 `bash scripts/verify-release-install.sh 1.2.3 --dry-run` exit 0，`bash scripts/verify-release-install.sh not-a-version --dry-run` exit 1
- [ ] `bash -n scripts/verify-release-install.sh && bash -n scripts/check-release-ledger.sh && node --check scripts/record-release-run.mjs` exit 0（语法合法）
- [ ] `bash scripts/test.sh tests/unit/scripts/release-run-ledger.test.ts` exit 0（走 quay fan-in 的同一入口）
- [ ] `git diff --name-only $(git merge-base HEAD develop)..HEAD` 不含 `.github/workflows/release.yml` 与 `package.json`，且本任务提交中无 `git tag` / `git push` / `npm publish` 的执行记录，也不含对 `.quay/release-runs.jsonl` 的写入（loop 不触碰发布与真实台账）

## DoD

真实落地的标准：脚本被真实运行过，而不是文件存在。（1）在当前仓库状态运行 `bash scripts/check-release-ledger.sh`，必须真实 exit 1 并输出 `CAUSE=carrier-absent`，证明判据能识别现状（台账缺失）；（2）用 `--ledger` 指向临时路径，真实运行 `node scripts/record-release-run.mjs` 追加一行，再用 check 脚本读回并 exit 0，证明写入格式与判据吻合，然后清理该临时台账；（3）真实运行 `bash scripts/verify-release-install.sh 0.1.33`（npm 上已存在的版本），观察它真实安装两个包并给出 `install-verify=success`，或在网络不可用时如实记录未能联网并只保留 --dry-run 的证据。本任务不打 tag、不发布、不写真实台账行；`.quay/release-runs.jsonl` 出现且末行三项 success 的那次真实发布由人在会话中触发，之后 AC-005 的 criterion 才会转为 achieved。

## Touches

- scripts/record-release-run.mjs (new)
- scripts/verify-release-install.sh (new)
- scripts/check-release-ledger.sh (new)
- tests/unit/scripts/release-run-ledger.test.ts (new)
- tasks/gap-release-run-ledger-recorder.md

## Needs-Human

**执行 2026-09-25T14:42:16.782Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）

## Needs-Human

**执行 2026-09-30T11:39:29.928Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 <60000ms 快速死亡（退避上限）；快速死亡分类：ordinary
