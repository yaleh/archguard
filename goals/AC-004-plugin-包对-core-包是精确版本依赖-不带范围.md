---
id: AC-004
title: plugin 包对 core 包是精确版本依赖，不带范围
status: achieved
kind: criterion
goal: GOAL-001
criterion: >-
  python3 - <<'PY'

  import json, sys

  core = json.load(open('package.json'))['version']

  pp = json.load(open('plugin/package.json'))

  dep = (pp.get('dependencies') or {}).get('@yalehwang/archguard')

  if dep is None:
      sys.stderr.write('CAUSE=plugin-missing-core-dependency — plugin/package.json 没有声明 @yalehwang/archguard 依赖\n'); sys.exit(1)
  if dep != core:
      sys.stderr.write('CAUSE=plugin-core-dependency-not-exact — plugin 对 core 的依赖是 %r，core 版本是 %r；带范围会让 plugin 静默解析到另一个运行时版本\n' % (dep, core)); sys.exit(1)
  print('exact pin ok: %s' % dep)

  sys.exit(0)

  PY
expect: plugin/package.json 的 dependencies['@yalehwang/archguard'] 逐字等于
  package.json 的 version。
origin: README 记录的渠道契约：Claude Code 从 npm source 安装 plugin 包，plugin 包精确依赖
  @yalehwang/archguard，由 npm 在你的机器上解析出运行时闭包（无全局 archguard 二进制、无 vendored
  node_modules）。带范围（^ / ~）会让 plugin 静默解析到另一个运行时版本，而 README 承诺的是
  exact-match。2026-09-25 实测：dep == 0.1.33 == core，判据为真——与 AC-003
  同为负控制。已有执行面：tests/unit/packaging/plugin-package.test.ts 已机械钉住本条（『depends on
  the exact matching @yalehwang/archguard version (no range)』）。
activatedAt: 2026-09-25T14:32:20.451Z
statusLog:
  - at: 2026-09-25T14:37:06.248Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
---
