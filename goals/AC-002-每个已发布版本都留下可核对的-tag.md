---
id: AC-002
title: 每个已发布版本都留下可核对的 tag
status: achieved
kind: criterion
goal: GOAL-001
criterion: >-
  v=$(python3 -c "import json;
  print(json.load(open('package.json'))['version'])" 2>/dev/null) || { echo
  "CAUSE=package-version-unreadable — package.json 的 version 读不出来" >&2; exit 1;
  }

  if ! git rev-parse -q --verify "refs/tags/v$v" >/dev/null 2>&1; then
    echo "CAUSE=published-version-without-a-tag — package.json version=$v 没有对应的 tag v$v：发了版却没有留下可核对的发布点" >&2; exit 1
  fi

  exit 0
expect: package.json 的 version 一定有一个同名 v* tag。
origin: 人 2026-09-25 裁定「渠道保留 npm + Claude Code plugin 形态」⇒
  发布动作有两条腿，必须有一个共同的锚点可核对。2026-09-25 实测漂移：npm 上 @yalehwang/archguard 与
  @yalehwang/archguard-claude-plugin 均已发到 0.1.33（2026-08-21），但 git tag 最高只到
  v0.1.31（2026-07-21）——0.1.32 / 0.1.33 两次发布没有任何 tag，GitHub Release 也停在
  v0.1.30（2026-07-12）。⇒ 同一个版本号在四个面上有四个不同的读数，而没有任何机件因此变红。
activatedAt: 2026-09-25T14:32:20.020Z
statusLog:
  - at: 2026-09-30T11:33:26.759Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
---
