# GIT 方法论 A/B/C 实验

## 目的

验证假说：GIT 方法论（扩张-收缩节律、支柱化/晶体化、收敛层级谱系）作为 LLM 开发工具的 system prompt，能否产出比简单规则或无框架更优的架构演进计划。

## 实验设计

### 输入（三组相同）

每个 Task Agent 接收完全相同的项目上下文：

1. **当前 MetricVector**（ff88649 HEAD）
2. **最近 10 个 commit 的 git log**
3. **当前 archguard.config.json**
4. **fileStats top 10**（按 inDegree 排序）
5. **src/ 目录结构**（2 层深度）
6. **已有 Plan 列表**（plan-01 到 plan-52）

### 三组实验

#### 组 A — GIT 方法论

System prompt 包含 GIT 框架核心概念：
- L(X) = L(G) + L(R|G) 分解
- 扩张-收缩节律判断（当前处于哪个阶段？应切换吗？）
- 五级收敛谱系（Prompt → Workflow → Model → DSL → Code）
- 支柱化/晶体化模式识别
- ℒ_S（稳定性）vs ℒ_D（描述长度）权衡

#### 组 B — 简单规则

System prompt 包含具体工程规则：
- 当 maxFileLoc > 800 时，提议拆分
- 当 sccCount > 0 时，提议消除循环
- 当 giniInDegree > 0.85 时，提议降低耦合集中度
- 当最近 5 个 plan 都是修复/重构时，提议新功能
- 当最近 5 个 plan 都是新功能时，提议重构

#### 组 C — 无框架（对照组）

System prompt 仅包含：
- "你是一个资深软件架构师"
- "根据项目当前状态，提出接下来 3 个最有价值的改进计划"

### 输出要求（三组相同）

每个 Agent 输出：
1. **当前状态评估**（100-200 字）
2. **接下来 3 个 Plan 提案**，每个包含：
   - 标题
   - 类型标签（expansion / contraction / maintenance）
   - 优先级排序理由
   - 预期对 MetricVector 的影响
   - 预估工作量（S/M/L）

### 评估标准

盲评（隐去组别标签后评估）：
1. **诊断准确性**：状态评估是否符合项目实际情况？
2. **提案相关性**：提出的 Plan 是否解决真实问题？
3. **排序合理性**：优先级是否合理？
4. **可执行性**：Plan 是否足够具体可以开始执行？
5. **视野广度**：是否发现了非显而易见的改进方向？

## 实验执行

每组使用独立 Task Agent，隔离上下文。Agent 只能读取文件，不能修改代码。

### 共享上下文数据（预先收集）

```
MetricVector:
  totalEntities: 514, totalRelations: 370
  sccCount: 0, maxInDegree: 22, maxOutDegree: 16
  giniInDegree: 0.776, giniPackageSize: 0.378
  packageCount: 33, maxPackageSize: 24

Recent commits (latest 10):
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

Existing plans: plan-01 through plan-52
  Recent: plan-50 (FIM), plan-51 (LLM semantic), plan-52 (metrics observatory)

Top files by inDegree (from fileStats):
  (to be collected at experiment start)
```

## 约束

- 三组 Agent 并行执行
- 每组完全隔离（独立 Task Agent，无共享上下文）
- Agent 可读取 src/、docs/、tests/ 目录
- Agent 不可修改任何文件
- 输出格式统一，便于盲评
