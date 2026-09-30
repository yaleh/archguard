---
id: bug-query-scope-no-prune-command
title: query scope 只增不减,manifest.json 无 prune/清理机制(quay 项目复测发现)
status: ready
labels:
  - defect
  - query
  - cli
parent: null
children: []
extra:
  schema: execution
---
## Proposal

外部用户(quay 项目复测)报告:`.archguard/query/manifest.json` 里的 scope 只会累积、不会被回收。观察到的实例是同一个项目积累了 11 个 scope,里面既有几周前(09-06)一次性跑出来的、entity 数明显偏小/过时的旧 scope,也有因为路径书写方式不同(`/home/yale/...` vs 实际 realpath)在 TASK-92 修复前产生的重复 scope。TASK-90/f8501297 已经改善了"选哪个 scope 当全局默认"的启发式,但从未处理过"如何让用户主动删掉一个不再需要的 scope"这件事。

代码侧确认:
```
$ grep -n "\.command(" src/cli/commands/cache.ts
21:    .command('clear')
46:    .command('stats')
```
`cache clear` 只清 `CacheManager` 管的解析缓存(`.archguard/cache/`)和 render-hash sidecar,不碰 `.archguard/query/manifest.json` 或任何 `query/<scope-key>/` 目录。全仓库搜索 prune/removeScope/cleanScope,零命中——目前**没有任何受支持的方式**能选择性移除一个 scope;唯一办法是手动删 `.archguard/query/<scope-key>/` 目录、再手改 `manifest.json` 摘掉对应条目,不是产品化的操作。

**修复方向**:
- 给 CLI 的 `cache` 命令(或单独一个 `query`/`scope` 命名空间)加一个 prune 子命令,支持:
  - 按 scope key 精确删除一个 scope(连带删除 `.archguard/query/<key>/` 目录和 manifest.json 里的条目)
  - 按"超过 N 天未使用"(参考 manifest 里每个 scope 的 `generatedAt`)批量清理陈旧 scope
  - `--dry-run` 预览会删掉哪些,不实际执行
- 在多 scope 场景下的警告/展示信息里(例如 `archguard_summary` 或 analyze 响应里已有的 scope 列表)补上每个 scope 的 `generatedAt` 和是否已经"明显过期"(比如比当前最新 scope 老很多、或所在路径已不存在)的标注,让用户在决定要不要 prune 之前先看得到。

## AC

- [ ] 新命令(如 `archguard cache prune-scopes --key <scope-key>`)能删除指定 scope:执行后 `manifest.json` 里不再含该 key 的条目,`.archguard/query/<key>/` 目录被移除
- [ ] 新命令支持按天数阈值批量清理(如 `--older-than-days <N>`),并有 `--dry-run` 只打印将被删除的 scope 列表、不执行
- [ ] 负对照:执行 prune 之后,未被选中删除的 scope 仍然可以正常查询(`archguard_summary --scope <未删除的key>` 等价调用能正常返回,不受影响)
- [ ] `archguard_summary`/`archguard analyze` 响应里的 scope 列表能看到每个 scope 的 `generatedAt`(部分工具可能已经有这个字段,需要确认并在展示层暴露出来,而不是新增)
- [ ] `npm test` 全量通过

## DoD

不是"prune 命令能执行、不报错"就算完成,而是要在一个真实积累了多个 scope 的 `.archguard/query/manifest.json` 上(可以用本仓库自身或合成一个含至少 3 个 scope 的 manifest 作为夹具)真实跑一次 prune,前后对比 manifest.json 的条目数量和 `query/` 目录下的子目录数量确实减少了指定的那些、且未指定的仍然完整可查询,而不是仅凭代码逻辑推断"应该会减少"。

## Touches

- tasks/bug-query-scope-no-prune-command.md
- src/cli/commands/cache.ts
- src/cli/query/query-artifacts.ts
- src/cli/query/query-manifest.ts
