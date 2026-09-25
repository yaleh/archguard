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

- [x] `npx vitest run tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts` exit 0，新增用例：传入 `packageOf` 时按它分组，`packageCount` 等于不同目录数而不是实体数；不传时与修复前结果逐项一致（回归）
- [x] `npx vitest run tests/unit/cli/mcp/tools/arch-health-tools.test.ts` exit 0，新增用例：以无点名字、分布在 3 个目录的 TS 风格实体构造 ArchJSON，`packageCount` 为 3
- [x] `npx vitest run tests/unit/analysis/jl` exit 0（含 drift 相关回归）
- [x] 本文件记录孤儿判定与 `get_dependents` 不一致的调查结论（`grep -n "孤儿" tasks/TASK-96.md` 在 Evidence 小节有结果）
- [x] `npm run type-check && npm run lint` exit 0

## DoD

对本仓库自身（TS）做 `archguard_analyze` 后调用 `archguard_get_cluster_boundary`，`packageCount` 明显小于 `entityCount`（约等于源目录数量级），`globalBAS` 不再恒为 0，且实测输出贴入本文件 Evidence 小节。

## Touches

- `src/analysis/jl/cluster-boundary-analyzer.ts`
- `src/cli/mcp/tools/arch-health-tools.ts`
- `src/analysis/jl/adjacency-builder.ts`
- `tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts`
- `tests/unit/cli/mcp/tools/arch-health-tools.test.ts`
- `tasks/TASK-96.md`

## Evidence

### 实现（分支 task/TASK-96，commit 51561b5f）

- `ClusterBoundaryAnalyzer.analyze(matrix, names, options, packageOf?)`：新增可选第 4 参 `packageOf`（与 `entityNames` 对齐，长度不符抛错）；缺省时逐项沿用按名字切分（回归用例断言 `toEqual`）。`BoundaryAlignmentScorer.score` 同步接受可选 `packages`。孤儿剔除后 `packageOf` 同步过滤，split/fusion/cluster summary 全部改用同一份包键。
- `arch-health-tools.ts` 新增 `derivePackageOf(archJson)`：若实体名含「.」的占比 ≥ 50%（Java/Go 惯例）返回 `undefined`（保持按名字切）；否则取 `sourceLocation.file` 所在目录，并去掉所有实体共有的目录前缀（即源根），得到相对目录。TS 模式下 `packageDepth` 不再生效（已在工具描述中说明）。
- `buildClusterBoundaryReport` 传入 `derivePackageOf(archJson)`。

### 孤儿判定与 get_dependents 不一致：调查结论

对本仓库自身做 `analyze -s ./src --diagrams class`（757 个实体，1825 条关系）后检查 `.archguard/query/<scope>/arch.json`，发现两个独立原因：

1. **邻接矩阵漏边（ID 与名字不匹配）**：TS 实体 id 形如 `/abs/src/analysis/x.ts.computePackageFanMetrics`，但大量关系的 `target` 是裸名（如 `PackageGraph`）。`buildAdjacencyMatrix` 只按 `entity.id` 查找，1825 条关系里有 1489 条因端点不在 id 表中被静默丢弃（dependency 1013、composition 426、inheritance 28、implementation 22）；而 `get_dependents` 走 `ArchIndex.nameToIds` 按名字解析，所以能看到这些边。其中 1068 个缺失端点按名字可唯一解析、35 个有歧义（同名多实体）、518 个是外部类型。
   - 修复：`buildAdjacencyMatrix(archJson, { resolveByName: true })`（默认 false，见下），歧义名字与 `ArchIndex` 一致，连到所有同名实体。仅 cluster-boundary 路径开启。
   - **未改默认行为**：`drift-baseline.ts`（架构漂移）与 `analyze.ts`（内在维度）也调用 `buildAdjacencyMatrix`，默认改动会使这两条路径的矩阵变化并产生一次性伪漂移，超出本任务范围。建议另立任务评估是否对它们也开启（会牵涉 featureVersion / 历史快照的兼容）。
2. **孤儿按「行」判定，是出边为零，而非度为零**：`detectOrphans` 判定邻接矩阵零行，矩阵是有向的（`A[source][target]`），所以只被别人依赖、自身无出边的叶子实体（典型如 `escapeHtml` 这类纯工具函数）在设计上就是「孤儿」，即使 `get_dependents` 有 37 个依赖方。这不是漏边，是「孤儿」一词的语义偏窄；本任务不改（改动会触及 K-Means 输入定义，与「不改算法」约束冲突），建议另立任务：要么把孤儿改成行、列都为零，要么在报告里把它更名为「无出边实体」。
   - 备注：本次自检数据集没有名为 `escapeHtml` 的实体（原报告来自另一个 scope），所以孤儿结论是从代码与叶子实体（如测试中的 hub）推得，并在单测里固定：`bare-name relation targets count as edges (callers are not orphans)`。
3. **CLI 未同步**：`src/cli/commands/query.ts` 的 `--cluster-boundary` 仍调用旧路径（`buildAdjacencyMatrix(archJson)` + 名字切分），与 MCP 工具不再一致（ADR-007 CLI/MCP parity）。该文件不在本任务 Touches 内，建议另立小任务让它改用 `buildClusterBoundaryReport`。

### DoD 实测（本仓库自身，TS，class 级 ArchJSON）

对 `analyze -s ./src --diagrams class` 生成的全局 scope arch.json（entities 757、relations 1825）调用 `buildClusterBoundaryReport`（即 `archguard_get_cluster_boundary` 工具体内调用的函数），输出：

```
mode: direct
globalBAS: 0.4072        (修复前恒为 0)
silhouetteScore: -0.0334
clusterCount: 47
entityCount: 426         (非孤儿；另有 331 个零出边实体被剔除)
packageCount: 44         (≈ 源目录数量级；修复前 ≈ entityCount)
scoredPackages: 37, splitPackages: 7, crossDomainFusions: 5
packageScores 前几项: analysis(16, BAS 0.332), analysis/fitness(3, 0.5058), analysis/gim(4, 0.5078), analysis/git-history(14, 0.2636), analysis/jl(15, 0.2117)
```

### AC 验证

- cluster-boundary-analyzer.test.ts：新增 5 例（packageOf 分组 packageCount=3、无 packageOf 时无点名字各自成包、省略与显式 name-prefix 逐项 `toEqual`、孤儿剔除后对齐、长度不符报错），通过。
- arch-health-tools.test.ts：新增 5 例（derivePackageOf ×2、TS 风格 3 目录 `packageCount` 为 3、裸名边不产生孤儿、MCP 工具 `packageCount` 3），通过。
- `npx vitest run tests/unit/analysis/jl tests/unit/cli/mcp/tools/arch-health-tools.test.ts tests/unit/cli`：84 文件 / 1324 用例全绿。
- `npm run type-check` 无输出（exit 0）；`npm run lint`：0 errors（3960 条既有 warning）。
