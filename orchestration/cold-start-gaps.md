# cold-start-gaps.md — archguard 冷启动差异清单

> **AC3 冷启动（2026-08-03）**：从 quay dist-plugin-archguard 分支（c9b1a452，plugin v0.3.13）
> 通过 `git archive` + `quay-init --loop` 安装。**与热拷贝（AC1）的本质区别**：文件来自 build
> artifact（`vendor/quay/dist/quay.js` 真实构建产物），不是从开发工作树 `cp`。
>
> git 历史证据链：`c8f612f`（热拷贝 3 文件）→ `654c494`（清除）→ `bb23678`（dist artifact 安装 24 文件）

分类：**已回填 / 属 archguard 特有 / 交付物缺失**

---

## 已回填（AC3 dist artifact → quay-init 安装）

以下在热拷贝（AC1）中标记为缺失的项目，现已通过 build artifact 安装到位：

| 已回填项 | 安装路径 | AC1 状态 | AC3 状态 |
|---|---|---|---|
| tick 文档（外层） | `orchestration/orchestrator-loop-tick.md` | cp 热拷贝 → 已清除 | ✅ 带占位符替换安装 |
| tick 文档（内层） | `docs/analysis/fast-mode-loop-tick.md` | cp 热拷贝 → 已清除 | ✅ 带占位符替换安装 |
| 遥测脚本 | `plugin/scripts/fast-mode-telemetry.ts` | 不存在 | ✅ |
| 内层状态监测 | `plugin/scripts/inner-state.sh` | 不存在 → Monitor 无法挂载 | ✅ |
| 内层取证工具 | `plugin/scripts/inner-forensics.mjs` | 不存在 | ✅ |
| 内层阻塞信号 | `plugin/scripts/inner-blocked-signal.ts` | 不存在 | ✅ |
| 内层空闲日志 | `plugin/scripts/inner-idle-log.ts` | 不存在 | ✅ |
| 资源闸 | `plugin/scripts/resource-gate.sh` | 不存在 | ✅ |
| 跨项目令牌 | `plugin/scripts/heavy-op-token.sh` | cp 热拷贝 → 已清除 | ✅ |
| 契约检查器 | `plugin/scripts/task-contract-check.ts` | 不存在 | ✅ |
| 任务漂移检查 | `plugin/scripts/task-status-drift-check.ts` | 不存在 | ✅ |
| 正交性检查 | `plugin/scripts/touches-orthogonality-check.ts` | 不存在 | ✅ |
| Session liveness | `plugin/scripts/session-liveness.sh` + `orchestration/session-liveness.env` | 不存在 | ✅（可执行原样复制 + 配置生成） |
| 传递依赖 | `gate-script-base.ts`, `workflow-event-schema.mjs`, `task-schema.ts`, `touches-parser.ts`, `wiring-coverage-check.ts`, `concurrent-batch-scheduler.ts`, `it0-split-or-commit-check.ts`, `pipe-exit-code-check.sh` | 不存在 | ✅ |
| 状态文件 | `.quay/quay-init-state.json` | 不存在 | ✅（pluginVersion=0.3.13, previous=none） |

**AC3 关键指标**：21 files copied, 0 skipped, 0 conflicts。19 executables verified byte-identical to source。
占位符替换：`/home/yale/work/quay` → `/home/yale/work/archguard`（6 处）、`scripts/test.sh` → `npm test`（3 处）、
`quay-0:0.0` → `archguard-2:0.0`（6 处），**0 quay 引用残留**。

### AC6/AC7 状态更新

AC6（状态工具可用）和 AC7（资源闸存在）现在有了文件。但 AC 的判定是**运行时可用**，不只是文件存在。
AC3 尚未验证这些脚本在 archguard 上实际能跑通（依赖 Node、python3、/proc/pressure/cpu 等运行时环境）。
状态更新为：文件存在但**未经运行时验证**。

---

## 交付物缺失（quay 项目专属，不在 dist artifact 范围内）

以下文件是 quay 项目自身的文档/配置，不随 dist artifact 分发——这不属于 quay 的交付物缺陷：

| 缺失项 | 说明 |
|---|---|
| `orchestration/exp6-phase1-sustained-unattended-operation.md` | quay 的 exp6 目标/AC/DoD 文档，archguard 有自己的 `goals-and-ac.md` |
| `adr/ADR-021-adaptive-budget-self-regulating-methodology.md` | quay 的 ADR，archguard 的 ADR 编号体系不同 |
| `docs/analysis/batch2-queue-state.md` | archguard 内层自报队列状态，需内层运行时才会生成 |

**注意**：quay 方法论文档不在 npm 包里的问题（`files` 字段只含 `README/CHANGELOG/LICENSE/bin/src/dist`）
**在 AC3 中已被 dist-plugin-archguard 分支解决**——该分支包含完整的 `loop/`、`scripts/`、`vendor/` 目录。
这是通过 `publish-dist-branch.sh` 构建的，不是 npm 包。

---

## 属 archguard 特有（与 quay 机制无关，archguard 自身的待修项）

| 差异 | 说明 | AC 引用 |
|---|---|---|
| CI 连红 | `gh run list` 最近 5 次全 failure，最早 2026-07-12 | AC4 |
| npm test 超时 + 1 failed | 492s 墙钟 > 300s timeout，1 failed（E404 boundary） | AC1 |
| lint 234 errors | eslint --fix 后从 480 降到 234，仍需手动修复 | AC2 |
| type-check 干净 | exit 0 | AC3 ✅ |
| 任务队列为空 | 25/25 done，0 ready——内层唤醒后无活可干 | AC5 |
| 内层模型 | deepseek-v4-flash（同 quay），但没有 quay 的 exp 历史 | — |

---

## AC3 与 AC1（热拷贝）的本质差异

| 维度 | AC1（热拷贝） | AC3（dist artifact） |
|---|---|---|
| 文件来源 | `cp` 从 quay 开发工作树 | `git archive` 从 dist-plugin-archguard 分支 |
| 文件数 | 3（tick 文档 ×2 + heavy-op-token.sh） | 24（tick 文档 + 19 executables + session-liveness + state file + .halt 删除） |
| 占位符 | 未替换（quay 实值残留） | 已替换（0 quay 引用残留） |
| 可执行验证 | 无 | 19 executables verified byte-identical |
| 是否可复现 | 否（依赖 quay 工作树状态） | 是（dist 分支 commit c9b1a452 可追溯） |
| git 证据 | 1 个 commit（c8f612f） | 3 个 commit 链（热拷贝 → 清除 → 安装） |

---

## 当前状态（2026-08-03 AC3 安装完成）

- **quay**: dist-plugin-archguard 分支就绪（c9b1a452），quay 自身可能仍在跑
- **archguard**: 机制已安装，`.halt` 已解除。AC3 第四步（差异报告）完成
- **meta-cc**: 运行中
- **本机**: 4 核
- **待做**: 第三步 `quay-init --loop` 实际运行（本次只做了安装，未启动 loop）
