---
id: gap-aux-artifacts-staleness-signal
title: 主 query manifest 增加 auxArtifacts 块：duplicates/shape-smells/git-history 的
  generatedAt+sourcesHash 过期信号
status: ready
labels:
  - gap
  - cli
  - query
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`analyze` 只重写各 scope 的 `arch.json`/`arch-index.json` 与主 manifest，不碰 `duplicates/`、`shape-smells/`（`src/cli/query/query-artifacts.ts:365-366` 注释明写 auxiliary dirs 不参与清理与重写）；`git-history/` 只有 `--include-git` 时才写。消费方无法判断这些辅助产物是否过期，会把「某次手动调用留下的旧结果」当成当前结果。

修复方向：`persistQueryScopes` 写主 manifest 时增加 `auxArtifacts` 块，逐项记录各辅助产物自身的 generatedAt 与来源（scopeKey/sourcesHash），读自各产物目录自己的 manifest。消费方据此机械判断过期，无需 archguard 顺带重算。

<!-- dedup-ref -->
相关但机制不同：`gap-query-stale-snapshot-warning`（query scope 的 generatedAt vs git HEAD）与 `gap-diagram-manifest-partial-run-stale`（diagram-manifest 写入语义）。本任务只给 duplicates/shape-smells/git-history 这些**辅助产物**补过期信号，不改 scope/diagram 语义。

## AC

- [x] `query/manifest.json` 含 `auxArtifacts` 块，形如 `{ "duplicates": [{ "scopeKey","label","generatedAt","sourcesHash" }], "shape-smells": {...}, "git-history": {...} }`；`npx vitest run tests/unit/cli/query/query-manifest.test.ts tests/unit/cli/query/query-artifacts.test.ts` exit 0，新增用例断言字段存在与结构
- [x] 当 `query/duplicates/<scopeKey>/manifest.json`、`query/shape-smells/`、`query/git-history/` 的产物 manifest 存在时，其 generatedAt 被读入对应 auxArtifacts 项；不存在时不写该项（不报错、不阻塞 analyze）
- [x] `sourcesHash` 用与 scope key 相同的 `hashSources` 公式计算，与对应 scope 的 key 一致；单测断言消费方可用「key ≠ sourcesHash」判定过期
- [x] `bash scripts/test.sh --for-task gap-aux-artifacts-staleness-signal` 通过（scoped gate）；`npm run type-check` 通过

## DoD

夹具先 analyze 生成主 manifest，再手动跑 `detect_duplicates` 写 duplicates 产物，然后改源码重跑 analyze：主 manifest 的 `generatedAt` 新于 `auxArtifacts.duplicates[].generatedAt`——「辅助产物是否过期」可机械比较，而非靠人肉对时间戳。

## Touches

- tasks/gap-aux-artifacts-staleness-signal.md
- src/cli/query/query-artifacts.ts
- src/cli/query/query-manifest.ts
- src/analysis/duplicates/persistence.ts
- src/analysis/shape-smells/persistence.ts
- src/cli/git-history/history-writer.ts
- tests/unit/cli/query/query-manifest.test.ts
- tests/unit/cli/query/query-artifacts.test.ts
