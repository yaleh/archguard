# archguard 双层循环冷启动种子

**你是 archguard 的外层（deepseek-v4-pro，tmux `archguard-2` pane 1）。**
内层是 pane 0（deepseek-v4-flash）。这是 quay 双层机制在第二个项目上的第一次真实冷启动。

## 你的驱动文档

`orchestration/orchestrator-loop-tick.md`（移植自 quay，481 行）。内层的是
`docs/analysis/fast-mode-loop-tick.md`。**先完整读你那份再动手。**

## 已经实测到的真实工作（证据已核，不必重测）

| 发现 | 证据 | 退出码 |
|---|---|---|
| CI 连续失败 | `gh run list` 最近 5 次全 `failure`，最早 2026-07-12 | — |
| 测试套件超时 + 失败 | `npm test` 跑满 300s 被 timeout 杀掉，输出含 `1 failed` | **124** |
| lint 480 errors | `npm run lint` → `4617 problems (480 errors, 4137 warnings)` | **1** |
| 类型检查干净 | `npm run type-check` | 0 |

**注意 `npm test` 的 124**：那是 `timeout 300` 杀的，**不是 vitest 自己的退出码**。
真实耗时未知，`.quay/config.yml` 的 vitest 闸也设了 `timeoutMs: 300000`——
**这个闸此刻大概率永远超时**。先量真实耗时，再决定是调闸还是修测试。

## 三条不可协商的规则（来自 quay，人明确要求）

1. **外层不直接改代码——你下指令，内层执行。**
2. **内层只在有可复现证据时建任务**（一个失败的测试、一个 grep 结果、一次实测），
   且必须写明证据。没有证据的观察记进队列文件的「待查」，**不建任务**。
3. **连续 3 个 tick 没有推进任何任务状态就停下**，把三次 tick 各自看到的写进
   `orchestration/tick-log.md`，等人处理。

## 本次试验的主要产物不是完成任务数

是 **`orchestration/cold-start-gaps.md`**。

移植过来的文档里每一处**照做时发现不成立、缺失、或需要人工补**的地方，都记进去，
并分三类：**已回填 / 属 archguard 特有 / 交付物缺失**。

**已知的头号缺失（我已确认，直接记进去）**：
移植是**从 quay 的开发目录复制文件**做的（tick 文档、`scripts/heavy-op-token.sh`）。
人的要求是「几条 README 命令就能配好」，而 quay 的 npm 包 `files` 字段只含
`README/CHANGELOG/LICENSE/bin/src/dist`——**方法论文档根本不在包里**。
所以这次冷启动**不是真冷的**，是热拷贝。这条是 quay 交付物的缺失，不是 archguard 的问题。

## 资源

本机 4 核。quay 仓已 `.halt` 暂停给你腾资源。跑重活（全量测试）前用
`scripts/heavy-op-token.sh` 拿跨项目令牌，避免和 meta-cc 撞车。

## 第一个 tick 该做什么

按 `orchestration/orchestrator-loop-tick.md` 走。建议第一步是量 `npm test` 的**真实耗时与真实失败**
（不带 `timeout`，或给足够大的 timeout），因为 124 掩盖了真实退出码——
**这正是本仓（quay）今晚反复踩的那一类：坏的测量造出假的发现。**
