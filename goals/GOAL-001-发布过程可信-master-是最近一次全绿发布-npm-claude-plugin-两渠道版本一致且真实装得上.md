---
id: GOAL-001
title: 发布过程可信：master 是最近一次全绿发布，npm + claude plugin 两渠道版本一致且真实装得上
status: achieved
kind: goal
origin: 人 2026-09-25 在会话中三项裁定：(a) 渠道不砍，保留 npm + Claude Code plugin 形态；(b) 发布由人在
  Claude Code 会话中触发；(c) 默认分支保持 master。规范依据 = quay 的
  SPEC-release-and-hotfix-branching-2026-09-15（分支模型与 §3.1 master 值域 / §4 release
  规程 / §4.4 四点同一判据 / §6 master 推进机制 / §11 闸改为真实安装 / §12 版本单一来源）与
  SPEC-goal-mechanism-2026-09-06 §11（task 层判据是一次性的，需长期维持的保证上移 goal 层）。本 goal 是
  archguard goal store 的第一条记录（goals/ 此前为空）。
activatedAt: 2026-09-25T14:32:29.436Z
statusLog:
  - at: 2026-10-03T12:33:06.971Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
---
## 背景（2026-09-25 实测，全部为直接量）

发布这一面今天是**四个互不一致的读数**，而没有任何机件因此变红：

| 面 | 读数 |
|---|---|
| npm `@yalehwang/archguard` | 0.1.33（2026-08-21） |
| npm `@yalehwang/archguard-claude-plugin` | 0.1.33（2026-08-21） |
| git tag | 最高 `v0.1.31`（2026-07-21）——0.1.32 / 0.1.33 无 tag |
| GitHub Release | 最高 `v0.1.30`（2026-07-12） |
| CHANGELOG | 顶部 `[2.0.0]`（2026-02-21），半年停更且与包版本不同制 |
| `master` | `a90c17b3`，不带任何 tag，落后 develop **154** 个提交（可 ff） |

发布动作今天是**从本地工作树手工 `npm publish`**，唯一兜底是 `prepublishOnly`（clean + build + test）
——发出去的就是本地树；CI 只在 push/PR 到 `master|main` 时触发 ⇒ **develop 推送零 CI**，集成线完全无闸；
没有 `release.yml`；分支保护 404（GitHub 原生保护不可用，与 quay SPEC §2.6 结论相同）。

## 范围

- 渠道形态：**npm 双包 + Claude Code plugin，不砍**。⚠️ 这与 quay 2026-09-16「取消 npm/SEA」的裁定
  不同，理由是结构性的：archguard 的 plugin 渠道**恰好建在 npm 上**（plugin 包精确依赖 core 包，
  README 记录该 exact-match 契约），砍掉 npm 会同时砍掉 plugin 渠道。
- 触发方式：**人在 Claude Code 会话中触发发布**——不是 tag push 隐式触发，也不是 loop 自动触发。
- 默认分支：**保持 `master`**。它同时是 marketplace 门面（`claude plugin marketplace add yaleh/archguard`
  读默认分支的 `.claude-plugin/marketplace.json`），这正是 quay §3.2.1′ 反转裁定保留 master 为默认分支的理由。

## 非目标

- ⛔ 不引入 SEA 三平台产物（本项目没有这个渠道）。
- ⛔ 不引入 `dist-plugin` 滚动渠道。
- ⛔ 不预建 hotfix 线（quay §5 实测发生率 1，降为有条件备用；master 有实义之前无基可切）。
- ⛔ loop 永不触碰 `master`、永不 publish。

## 退出条件

五条 AC 全部 `achieved`，且覆盖判定认为充分（背景中的每一项漂移都被至少一条 AC 承接）。