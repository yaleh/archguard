---
id: gap-query-scope-replace-on-reanalyze
title: query scope 只按当前路径串算身份、旧条目永不归一：同一目录留下 26 个 scope（/home vs /data、相对 vs
  绝对），replace 不 accumulate
status: todo
labels:
  - gap
  - defect
  - query
  - cli
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测）**：`/data/home/yale/work/quay/.archguard/query/manifest.json` 累计了 26 个 scope，其中同一个真实目录被多条路径串登记成不同身份：
- `26b300e9` 的 sources 是相对路径 `packages/quay/src`，`77856690` 是 `/home/yale/work/quay/packages/quay/src`，当前解析用的是 `/data/home/yale/work/quay/...`；三者 realpath 相同，却各自成 scope；
- `075f2c0c`（`packages`）与 `6e556e41`（`/home/yale/work/quay/packages`）同理；`4747cc54`（`plugin/scripts`）与 `c045940f`（`/home/yale/work/quay/plugin/scripts`）同理；
- 多条旧条目的 `generatedAt` 缺失或停在 2026-09-30 / 10-11，重新分析不会替换它们，`availableScopes` 里长期并列。

**根因（代码定位）**：
- `src/cli/processors/arch-json-utils.ts:23-30` 的 `hashSources` 已做 `realpathSync` 归一，所以**新**条目身份是稳定的；
- 但 `src/cli/query/query-artifacts.ts:156-182` 的 `persistQueryScopes` 只按 `entry.key` 做 merge：历史 manifest 里的旧条目不会被重新归一化，也不会与新条目合并；
- 清理只能靠已实现的手动 `cache prune-scopes`，不是“重新分析时自动 replace”。

**修复方向**：
1. persist 时对既有 entries 做身份归一：把每条 `sources` 重新 realpath 归一后重算 key；与新 key 相同的旧条目合并（保留最新计数与 `generatedAt`），并把旧 `query/<oldKey>/` 目录迁移/删除，避免 manifest 与磁盘目录分叉。
2. 陈旧条目回收：`sources` 全部不存在的 entry 在 persist 时移除（或迁移为明确的 stale 状态并从 `availableScopes` 隐藏——实现时二选一并写清）。
3. 负对照必须保留：源集合确实不同的 scope（例如 `packages` 与 `plugin/scripts`）仍然各自独立、可查询，不做“只留一个”的粗暴替换。

<!-- dedup-ref -->
相关但不同机制：已完成的 `bug-query-scope-no-prune-command` 提供的是显式手动清理命令（`cache prune-scopes --key/--older-than-days`）；本任务改的是**重新分析时自动归一身份并 replace**，prune 仍保留为显式清理手段，两者互补。

## AC

- [ ] 夹具 manifest 同时含 legacy 路径别名（`/home/...` 与 `/data/...` 指向同一 realpath、相对路径）与当前绝对路径条目：执行一次 persist 后同一身份只剩一条，key 等于用当前绝对 realpath 计算的值，旧 key 目录被迁移/删除、manifest 与磁盘目录一一对应
- [ ] 负对照：源集合确实不同的 scope（如 `packages` 与 `plugin/scripts`）在 persist 后仍各自保留且可正常加载查询
- [ ] 陈旧回收：`sources` 全部不存在的条目在 persist 后不再出现在 `availableScopes`（选择移除或显式 stale 标记，并在实现/测试中写清是哪一种）
- [ ] 真实数据验证：复制 `/data/home/yale/work/quay/.archguard/query` 到 `/tmp` 夹具，跑一次 persist 后 scope 数从 26 下降；断言不再存在「相同 realpath 源集合 + 相同 language」的重复身份，且所有保留 scope 的 `arch.json` 都能加载
- [ ] 不需要手工执行 `cache prune-scopes` 就能得到上述结果（prune 仍是显式清理，不替代身份归一）
- [ ] `bash scripts/test.sh --for-task gap-query-scope-replace-on-reanalyze` 与 `npm run type-check` 通过

## DoD

不是“merge 的 Map 逻辑看起来对”就算完成。要在 quay manifest 的真实副本上跑一次 persist，输出修复前后的 scope 列表（key / sources / generatedAt）与 `query/` 子目录清单，证明重复身份已合并、陈旧条目不消失得没有痕迹（该删的删、该留的留）、保留下来的每个 scope 都能被 `archguard_summary` 等价加载查询；同时用合成夹具覆盖负对照。

## Touches

- tasks/gap-query-scope-replace-on-reanalyze.md
- src/cli/query/query-artifacts.ts
- src/cli/query/query-manifest.ts
- src/cli/processors/arch-json-utils.ts
- src/cli/processors/diagram-processor.ts
- tests/unit/cli/query/query-artifacts.test.ts
- tests/unit/cli/query/query-manifest.test.ts
- tests/unit/cli/processors/diagram-processor-query-scopes.test.ts
