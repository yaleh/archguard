# L0 Loop 调度方案

L0 Worker（`.claude/loop.md`）需要周期性触发才能消费 `agent-run` 队列。三种方案各有权衡。

## 方案 A：手动触发（当前模式）

在 Claude Code session 中直接调用：

```
@.claude/loop.md
```

**优点**：零配置，执行可观测，人工全程参与  
**限制**：需要人工每次触发，无法 unattended 运行  
**适用场景**：低频执行、需要全程监督、调试阶段

---

## 方案 B：`/schedule`（云端持久，推荐 unattended）

在 Claude Code session 中创建云端定时任务：

```
/schedule @.claude/loop.md every 5 minutes
```

**优点**：
- Session 关闭后继续运行（Anthropic 云端执行）
- 真正的 always-on 队列消费
- 通过 `/schedule` 管理（list / delete）

**限制**：
- 每次触发消耗独立 token
- 需要 Claude Code 云端权限
- 调度粒度最小 5 分钟

**适用场景**：长期 unattended 运行，Issue 加标签后自动消费

管理命令：
```
/schedule          # 列出所有定时任务
/schedule delete   # 删除指定任务
```

---

## 方案 C：系统 cron + `claude -p`（本地后台）

在系统 crontab 中配置非交互式调用：

```bash
# 编辑 crontab
crontab -e

# 每 5 分钟执行一次
*/5 * * * * cd /home/yale/work/archguard && \
  claude -p "$(cat .claude/loop.md)" >> .claude/loop.log 2>&1
```

**优点**：
- 完全本地，无云端依赖
- 日志落本地（`tail -f .claude/loop.log`）
- 不受 Claude Code session 生命周期限制

**限制**：
- 需要 Claude CLI 支持非交互模式（`-p` flag）
- 机器关机即停止
- 日志管理需手动维护

**适用场景**：本地服务器长期运行，希望完全掌控执行环境

---

## 对比

| 维度 | 方案 A 手动 | 方案 B /schedule | 方案 C cron |
|------|------------|-----------------|------------|
| 无人值守 | ❌ | ✅ | ✅ |
| Session 无关 | ❌ | ✅ | ✅ |
| 零配置 | ✅ | ✅ | ❌ |
| 本地日志 | ❌ | ❌ | ✅ |
| token 成本 | 按需 | 固定轮询 | 固定轮询 |
| 当前使用 | ✅ | — | — |

---

## 相关文档

- [L0 Agent Queue 总体说明](l0-agent-queue.md)
- Loop 执行规范：`.claude/loop.md`
