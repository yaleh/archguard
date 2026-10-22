---
id: gap-enrich-stateless-classes-with-state
title: ErrorHandler / ClusterBoundaryAnalyzer / KMeansClusterer 反向富化：构造时注入并持有状态
status: ready
labels:
  - gap
  - refactor
parent: null
children: []
extra:
  schema: execution
---
## Proposal

少数无状态类其实「该有状态却没有」——每次调用都在传同一个上下文参数，把它们反向富化为持有状态的富对象，示范真正的封装。`ErrorHandler`（`src/cli/errors/index.ts`）现在无状态、每个调用点都传同一个 `verbose`；`ClusterBoundaryAnalyzer`/`BoundaryAlignmentScorer`（`src/analysis/jl/cluster-boundary-analyzer.ts`）每次方法传距离矩阵；`KMeansClusterer`（`src/analysis/jl/kmeans.ts`）每次传 k/points。改成构造时注入、实例持有。

## AC

- [ ] `ErrorHandler` 在构造时注入 `verbose`（如 `new ErrorHandler({ verbose })`），`format()` 不再每次传 `verbose`；`tests/unit/cli/error-handler.test.ts` 绿，现有调用点同步更新
- [ ] `ClusterBoundaryAnalyzer` 与 `BoundaryAlignmentScorer` 构造时注入距离/邻接矩阵并持有，方法不再每次传矩阵；`tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts` 绿
- [ ] `KMeansClusterer` 构造时注入 `k` 与点集（或等价状态），`cluster()` 不再每次传全部参数；`tests/unit/analysis/jl/kmeans.test.ts` 绿

## DoD

三个类都持有构造时注入的实例状态，公开方法签名不再重复携带同一上下文——`ErrorHandler`/`ClusterBoundaryAnalyzer`/`KMeansClusterer` 成为有状态、可复用的富对象，相关测试全绿。

## Touches

- src/cli/errors/index.ts
- src/analysis/jl/cluster-boundary-analyzer.ts
- src/analysis/jl/kmeans.ts
- tests/unit/cli/error-handler.test.ts
- tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts
- tests/unit/analysis/jl/kmeans.test.ts
- tasks/gap-enrich-stateless-classes-with-state.md