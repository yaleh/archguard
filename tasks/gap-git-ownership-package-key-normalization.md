---
id: gap-git-ownership-package-key-normalization
title: package 级 get_ownership 统一 repo-relative / keyRoot-relative 解析，与 file 级同源
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`get_ownership(targetType:'package')` 在 `server/modules/session-hosts` 上返回 `no-commits-in-window`，而同目录 file 级正常；相对路径 `modules/...` 又被判 `outside-analyzed-paths`。根因在 `HistoryQuery.resolveKey`（`src/analysis/git-history/history-query.ts:233-241`）：package 目标要猜 repo-relative 还是 keyRoot-relative，与 file 目标的解析不一致。修法：统一 package 与 file 的目标归一化，让两种写法都命中同一 metrics key（或返回明确的「该用哪种写法」提示）。

## AC

- [ ] `HistoryQuery.getOwnership('package', 'server/modules/session-hosts')` 与 keyRoot-relative 写法解析到同一 `packageMetrics` key，且不再误报 `no-commits-in-window`；新增用例到 `tests/unit/analysis/git-history/history-query.test.ts`
- [ ] 相对路径 `modules/...` 与仓库相对 `server/modules/...` 的判定一致，not-found 时给出 `outside-analyzed-paths` / `no-commits-in-window` 及建议写法
- [ ] file 级 ownership 行为不回归（同目录 file 级仍命中）

## DoD

在含 git history 的 scope 上，`get_ownership(targetType:'package')` 对仓库相对与 keyRoot-relative 两种写法给出同一 busFactor/primaryOwner 读数——package 级不再比 file 级「差一档」无法查。

## Touches

- src/analysis/git-history/history-query.ts
- tests/unit/analysis/git-history/history-query.test.ts
- tasks/gap-git-ownership-package-key-normalization.md