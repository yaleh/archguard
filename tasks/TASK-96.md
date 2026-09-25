---
id: TASK-96
title: "TASK-96: cluster_boundary 用实体名按「.」切包，对 TS
  每个实体自成一包（packageCount≈entityCount，globalBAS=0）"
status: ready
labels:
  - gap
  - defect
  - analysis
  - clustering
parent: null
children: []
extra: {}
---
## Proposal

`src/analysis/jl/cluster-boundary-analyzer.ts` 的 `BoundaryAlignmentScorer.extractPackage(entityName, depth)` 按 `.` 切实体名取前 `depth` 段作为「包」，这是为 Java 的 `com.foo.Bar` 设计的。TS 的实体名是 `escapeHtml` 这类无点名字，每个实体的「包」就是它自己：实测 `packageCount` 129 ≈ `entityCount` 131，`globalBAS` 恒为 0，且 `escapeHtml` 被列为零邻接孤儿，而 `get_dependents` 给出 37 个依赖方。已发布的 `archguard_get_cluster_boundary` 对 TS 完全无效。

根因在包的来源，不在阈值。方案：`analyzeClusterBoundary`（`src/cli/mcp/tools/arch-health-tools.ts`）传入的不再只有实体名，而是每个实体所属包的标识——用实体的 `filePath` 所在目录（相对源根）；`ClusterBoundaryAnalyzer.analyze` 接收可选的 `packageOf: string[]`，缺省时保持现有按名字切分的行为（Java/Go 及既有测试不变）。另需查明孤儿判定与 `get_dependents` 不一致的原因（邻接矩阵是否漏掉函数级实体的边），若为同一根因一并修，否则在本文件记录并另立任务。

<!-- dedup-ref -->
相关：TASK-66（cluster boundary 的原始实现，已完成，其测试是回归基线）。本任务只改包的来源，不改 K-Means 与 BAS 的算法。

## AC

- [ ] `npx vitest run tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts` exit 0，新增用例：传入 `packageOf` 时按它分组，`packageCount` 等于不同目录数而不是实体数；不传时与修复前结果逐项一致（回归）
- [ ] `npx vitest run tests/unit/cli/mcp/tools/arch-health-tools.test.ts` exit 0，新增用例：以无点名字、分布在 3 个目录的 TS 风格实体构造 ArchJSON，`packageCount` 为 3
- [ ] `npx vitest run tests/unit/analysis/jl` exit 0（含 drift 相关回归）
- [ ] 本文件记录孤儿判定与 `get_dependents` 不一致的调查结论（`grep -n "孤儿" tasks/TASK-96.md` 在 Evidence 小节有结果）
- [ ] `npm run type-check && npm run lint` exit 0

## DoD

对本仓库自身（TS）做 `archguard_analyze` 后调用 `archguard_get_cluster_boundary`，`packageCount` 明显小于 `entityCount`（约等于源目录数量级），`globalBAS` 不再恒为 0，且实测输出贴入本文件 Evidence 小节。

## Touches

- `src/analysis/jl/cluster-boundary-analyzer.ts`
- `src/cli/mcp/tools/arch-health-tools.ts`
- `src/analysis/jl/adjacency-builder.ts`
- `tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts`
- `tests/unit/cli/mcp/tools/arch-health-tools.test.ts`
- `tasks/TASK-96.md`
