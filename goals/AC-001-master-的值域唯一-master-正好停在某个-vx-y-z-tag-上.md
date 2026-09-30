---
id: AC-001
title: master 的值域唯一：master 正好停在某个 vX.Y.Z tag 上
status: achieved
kind: criterion
goal: GOAL-001
criterion: >-
  m=$(git rev-parse master 2>/dev/null) || { echo "CAUSE=no-master-ref — git
  rev-parse master 失败，被判定的 ref 在这个检出里不存在（仪器问题，不是判定）" >&2; exit 1; }

  tags=$(git tag --points-at "$m" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true)

  if [ -z "$tags" ]; then
    echo "CAUSE=master-not-at-a-version-tag — master=$m 不带任何 v* tag；master 唯一许可的移动是 release.yml 的 advance-master job 在全部 job 全绿后 ff 到该 tag，出现本 CAUSE 说明有人直接提交了 master，或把非发布分支合并了进去" >&2; exit 1
  fi

  exit 0
expect: master 的提交带有至少一个 vX.Y.Z tag ⇒ master == 最近一次发布点。允许的取值只有「某个版本 tag 的提交」，没有第三种。
origin: 人 2026-09-25 裁定「默认分支保 master」。依据 quay
  SPEC-release-and-hotfix-branching-2026-09-15 §3.1：master
  的唯一角色是「最近一次全绿发布」，唯一许可的前进事件是 release.yml 的 advance-master job 在全部 job 全绿后 ff 到该
  tag，禁止直接提交 / 作 merge 目标 / 任何 non-ff。本项目特有理由：master 同时是 marketplace 门面（claude
  plugin marketplace add yaleh/archguard 读默认分支的
  .claude-plugin/marketplace.json），master 不真的等于最近一次发布，门面就在说谎。2026-09-25 实测：git
  rev-parse master = a90c17b3d35a8eec9f64f0cb8bef8a609e784673，git tag
  --points-at 为空；master 落后 develop 154 个提交（git merge-base --is-ancestor 判定可 ff）。
activatedAt: 2026-09-25T14:32:09.393Z
statusLog:
  - at: 2026-09-30T02:34:37.788Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
---
