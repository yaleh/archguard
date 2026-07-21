# GIM A/B/C 实验 — 共享上下文

本文件供三组实验 Agent（A、B、C）共用，内容完全相同。

---

## 1. 当前 MetricVector（快照：2026-06-30T05:04:41.890Z）

> 注：实验基准点为 commit ff88649（plan-52 HEAD）。当前快照与基准高度吻合，可直接使用。

```
totalPackageCount: 47
sccCount: 0（无循环依赖）
maxInDegree: 196（src/types 包）
maxOutDegree: 95（src/plugins/golang 包）
giniInDegree: 0.776（高度倾斜 — 少数包被大量依赖）
```

原始基准 MetricVector（ff88649）：
```
totalEntities: 514, totalRelations: 370
sccCount: 0, maxInDegree: 22, maxOutDegree: 16
giniInDegree: 0.776, giniPackageSize: 0.378
packageCount: 33, maxPackageSize: 24
```

---

## 2. Top-10 高 fanIn 包（按入度排序）

| 包路径 | fanIn | fanOut | cycleCount | entityCount |
|--------|-------|--------|------------|-------------|
| src/types | 196 | 53 | 0 | 34 |
| src/core/interfaces | 65 | 19 | 0 | 23 |
| src/plugins/golang/atlas | 55 | 30 | 0 | 12 |
| src/types/extensions | 53 | 57 | 0 | 40 |
| src/plugins/golang | 34 | 95 | 0 | 37 |
| src/cli/query | 31 | 13 | 0 | 13 |
| src/cli/git-history | 22 | 8 | 0 | 4 |
| src/plugins/python | 18 | 34 | 0 | 18 |
| src/cli/mcp/tools | 15 | 47 | 0 | 18 |
| src/parser | 14 | 43 | 0 | 19 |

---

## 3. 最近 10 个 Commit（当前 HEAD）

```
3678cc0 feat: add TASK-29 — GIM A/B/C experiment to validate methodology before TASK-10
687d9ea DIR-047 e2e: add default_task_status:ready to native config; TASK-29 created ready
5c136a7 fix: restore correct titles for 9 tasks with broken YAML multi-line scalars
bbb77cf refactor: move MCP tool business logic into analysis layer (ADR-006, TASK-25)
a27e5cb feat: migrate backlog tasks and ADRs to quay-native store (DIR-001, DIR-002)
2af4590 chore: promote TASK-25, DIR-001, DIR-002 to ready
d0f7d2a DIR-002: Migrate docs/adr/*.md to quay-adr/ as single source of truth
1bd6f79 DIR-001: Migrate all backlog/tasks/*.md entries into quay-native task store
a28071d quay: flip native provider to enabled (primary for dev loop)
e9f0c60 Add .quay/gates.yml — runner-agnostic DoD gate (vitest as workspace DATA)
```

*注：基准点 ff88649 附近的 commit 如下（实验原始语境）：*
```
ff88649 feat(architecture-metrics-observatory): implement Plan 52
87c4347 Add FIM per-test coverage script and update mermaid tests
7d07ecf docs(architecture-metrics-observatory): add proposal and plan
dc48733 docs(llm-semantic-exploration): add proposal and plan
489d7a3 docs(adr-008): add LLM semantic exploration before analysis
967571f fix(fim): run Mantel test on filtered production-only packages
683afe7 docs(fim): add FIM self-analysis report
269d2c2 fix(fim): P1-P3 isProductionPackage denylist
4466ff6 fix(fim): use SVD on filtered sub-matrix
6378e4a Add install script for Claude user scope
```

---

## 4. src/ 目录结构（2 层深度）

```
src/
├── analysis/
│   ├── fitness/
│   └── git-history/
├── cli/
│   ├── analyze/
│   ├── cache/
│   ├── cognitive/
│   ├── commands/
│   ├── errors/
│   ├── git-history/
│   ├── mcp/
│   ├── processors/
│   ├── progress/
│   ├── query/
│   └── utils/
├── core/
│   ├── interfaces/
│   └── query/
├── mermaid/
├── parser/
├── plugins/
│   ├── cpp/
│   ├── golang/
│   ├── java/
│   ├── kotlin/
│   ├── python/
│   ├── shared/
│   └── typescript/
├── types/
│   └── extensions/
└── utils/
```

---

## 5. 已有 Plan 列表摘要（plan-01 到 plan-52 + plan-54 起）

**核心功能 Plans（01-28）：**
- plan-01: Java build dependency extraction
- plan-02: Java Maven multi-module diagrams
- plan-03: Unified worker pool rendering
- plan-04: Structural refactor foundation
- plan-05: Multi-paradigm MCP tools
- plan-06: Package stats MCP tool
- plan-07: Golang plugin merge
- plan-08: TS plugin exclude fix
- plan-09: Test analysis system
- plan-10 ~ plan-18: 各语言分析质量修复
- plan-19: Diagram visual quality
- plan-22 ~ plan-23: TS module graph + rendering optimization
- plan-24: C++ language support
- plan-26: C++ module/class diagrams
- plan-27: File stats & cycle expansion
- plan-28: Agent query layer

**扩张阶段 Plans（29-49）：**
- plan-29: Diagram processor decomposition
- plan-30: Java multimodule test / MCP analyze tool
- plan-31: MCP stateless cross-project / test coverage redesign
- plan-32 ~ plan-36: 各语言 import 依赖边 + Java Maven
- plan-37: Split extensions by domain
- plan-38 ~ plan-39: Git history + quality fixes
- plan-40 ~ plan-49: 多语言测试分析精度、别名解析、确定性查询等

**收敛阶段 Plans（50-52）：**
- plan-50: Coverage Fisher Information Matrix（FIM）
- plan-51: LLM semantic exploration before analysis
- plan-52: Architecture metrics observatory（当前 HEAD 基准点）

**后续 Plans（plan-54+，实验基准点之后）：**
- plan-54 ~ plan-56: Skill-first project semantics（GIM 相关）
- plan-57: Kotlin/Android plugin
- plan-58: Open entity type & attribute queries
- plan-59 ~ plan-88: 内在维度实验、格式编码实验、LLM-aware 输出
- plan-89 ~ plan-100: Call graph extraction + architecture cleanup
- plan-101 ~ plan-122: Architecture quality + Atlas MCP analytics
- plan-123: QueryEngine god object refactor

---

## 6. 项目背景

ArchGuard 是一个 TypeScript CLI 工具，主要功能：
1. 解析多语言源码 → 生成 ArchJSON（实体+关系图）
2. 生成 Mermaid 架构图（package/class/method 层级）
3. 提供 MCP（Model Context Protocol）工具供 LLM 调用
4. 分析测试覆盖、循环依赖、包耦合等质量指标

**当前状态特征（plan-52 时刻）：**
- 支持语言：TypeScript、Go（含 Atlas 4 层）、Java、Python、C++、Kotlin
- MCP 工具：约 25 个，涵盖结构分析、测试分析、git 历史、包指标等
- 测试套件：3946 个测试，248 个文件
- sccCount=0（无循环依赖，良好）
- giniInDegree=0.776（src/types 包被过度依赖，集中度高）
- src/plugins/golang 包 fanOut=95（过度发散）

---

*注：以上数据截取自实际代码库，供评估使用。请基于此数据独立分析，不参考其他组的输出。*
