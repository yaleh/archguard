# Plan 67-72 — 本征维度 × 表示粒度实验 v2.2（Granularity Experiment v2）

> Proposal: `docs/proposals/proposal-granularity-experiment-v2.md`（实验协议 v2.2）
> 前序计划: `docs/plans/plan-59-66-intrinsic-dimension-granularity-experiment.md`（v2.1，已执行）
> v1 实验报告: `experiments/granularity/REPORT.md`（commit `64b1e53`）
> Status: Draft
> Priority: MEDIUM（实验 harness，**对 `src/` 零改动**）
> 最大 Phase 编号（v1）: 66

---

## 总览

本 plan 实现 proposal v2.2 的全部修复，针对 v1 暴露的三个根本性缺陷（传感器失明 D1、判别空间不足 D2、A 类样本不足 D3）系统性修复，并新增第三传感器（S-struct）和 C 类任务。

**执行纪律**（违反即协议偏离，须记入最终报告）：

1. **冻结 tag 是分水岭**：Phase 67–68 为 tag 之前的工作（工具构建 + 冻结前置确认 + 协议冻结）；Phase 70 的事前预测落盘严格先于 Phase 71 的任何 LLM 任务。
2. **Phase 0 门控是硬门槛**：三传感器维度分离检验结果（`dim-phase0.json`）必须在 Phase 71 LLM 任务开始前落盘；0 个传感器分离时 Phase 71（B 系列）不执行，直接进入 Phase 72 的 A 系列报告。
3. **事前预测不可事后修改**：Phase 70 的 H0、P_GIT-sem、P_GIT-struct 预测文件随 git commit 时间戳冻结，此后任何修改均须记协议偏离。
4. **对 ArchGuard 核心（`src/`）零改动**。全部产物位于 `experiments/granularity/`。
5. **凭据零落盘**：API key 一律经环境变量引用（`LLM_BASE_URL`、`LLM_API_KEY`），脚本启动时 fail-fast 校验。

### v1 可复用组件（减少重新实现）

| 文件 | 状态 | v2.2 处理方式 |
|---|---|---|
| `callgraph.ts` | 已产出，375 条 call 边（ArchGuard 参照） | 直接复用；主实验私有库须重新运行 |
| `embed.py` | 已实现，qwen3-embedding:4b + SHA-256 缓存 | 复用框架；输入文本去混淆（真名）|
| `dimension.py` | 已实现，TwoNN/MLE/bootstrap | 直接复用，无需修改 |
| `run-tasks.ts` | 已实现，需修正 k=2→k=5 + 去 L4 跳过逻辑 | 修改后复用 |
| `score.ts` | 已实现 | 直接复用 |
| `analyze.py` | 已实现，需扩充三传感器 + FDR 校正 | 修改后复用 |
| `probes.ts` | 已实现，序列化探针 | 直接复用；输入为真名层级 |
| `predict.ts` | 已实现，derivability + H0 | 修改：新增 P_GIT-struct 分支 |
| `ground-truth.ts` | 已实现 | 直接复用 |
| `artifacts/gt/callgraph.json` | 已落盘，375 call + 1 reference | S-struct 边集基础（kind='call' 过滤 = 375 条）|

### Phase 依赖关系

```
Phase 67（泄漏探针 + S-struct 可行性 + L4 token 实测）
    ↓ [67.4 判定是否继续，冻结前置条件满足]
Phase 68（任务设计：A/B/C 三类 GT + 任务文件）
    ↓ [68.4 任务哈希冻结]
Phase 69（表示层级生成：L0-L5，真名）
    ↓ [69.4 层级产物哈希]
Phase 70（嵌入 + 维度估计 + Phase 0 门控 + 事前预测冻结）
    ↓ [70.5 git commit，时间戳锁定；Phase 0 门控通过才继续]
Phase 71（LLM 任务运行，仅在 Phase 0 通过后）
    ↓
Phase 72（统计分析 + P_probe 事后诊断 + 决策表 + 报告）
```

---

## Phase 67 — 冻结前置确认：泄漏探针 + S-struct 可行性 + L4 标定

**目的**：在任何新代码实现之前，完成 proposal §11.1 规定的全部冻结前置条件（I1–I9 全部处置）。本 Phase 以**实测对账**为主，新增代码 ≤ 150 行。

**依赖**：无（v1 产物已存在，本 Phase 是验证步骤）。
**可并行**：67.1 与 67.2 可并行；67.3 依赖 67.2；67.4 依赖 67.1、67.2、67.3。

---

### Stage 67.1 — 强版本泄漏探针（实测对账）

**目的**：按 proposal §0 I3 修订后的精确定义，验证 claude-sonnet-4-6 和 deepseek-v4-flash 对 ArchGuard 的记忆程度，确定 ArchGuard 参照被试的泄漏状态。

**主要改动**（复用 `lib/llm-client.ts`，新增 ≤ 30 行胶水脚本）：

- 探针问题（精确格式）：「请列举直接调用 `MermaidGenerator` 类的调用方法（格式：`ClassName.methodName`，逗号分隔）」
- 从 `artifacts/gt/callgraph.json`（`kind='call'` 口径）提取 GT 调用者集合
- 对每个模型计算：F1(模型答案集合, GT 调用者集合)
- 判定阈值（预注册）：F1 ≥ 0.5 判泄漏
- 两个模型各独立判定；若任一泄漏，ArchGuard **不得**作为任何评分用被试（降为纯参照）

**产物**：
- `artifacts/gt/leak-probe-v2.md`：两模型原始问答 + F1 计算过程 + 判定结论
- 更新 `artifacts/gt/frozen-hashes.json`（追加 leak-probe-v2.md 哈希）

**验收标准**：
- 问答落盘，F1 计算过程透明（分子=交集大小，分母=调和平均）
- 判定结论明确（泄漏/不泄漏），与后续 Phase 的被试选择决定一致
- 本 Stage 不新增任何 TS 单元测试（实测对账，无法 mock）

---

### Stage 67.2 — S-struct 可行性：node2vec smoke test + requirements.txt 补充

**目的**：解决 proposal §0 I1（节点粒度矛盾→选定方案 α）和 §0 I2（node2vec 未声明），同时完成 §11.1 第 6 项 S-struct 可行性确认。

**主要改动**（新增 ≤ 60 行 Python 脚本）：

1. **方案 α 选定与记录**（无代码，仅文档决定）：
   - 节点粒度：固定为 method 节点全集，跨层级不变
   - L0：零边图（d_L0(S-struct) 不参与分离判定，标注"不可估计"）
   - L1：method 节点全集 + entity 级 inheritance/dependency 边（**预注册扩展规则**：entity-to-entity 关系扩展为两个 entity 的**代表方法节点**（首个 method）之间的边；若 entity 无 method，跳过该边；此规则简化扩展图密度，避免二部图完全连接）
   - L2：L1 边 + composition/aggregation 边（同上扩展规则）
   - L3/L4：L2 边 + callgraph.ts `kind='call'` 375 条边（信息等价）
   - L5：同 L3/L4

2. **`requirements.txt` 补充**：添加 `node2vec==0.4.6`（pin 版本，PyPI 实测版本）

3. **smoke test 脚本**（`experiments/granularity/tests_py/test_struct_smoke.py`）：
   - 在 ArchGuard callgraph（225 节点，375 call 边）上运行 node2vec
   - 参数：p=1.0, q=1.0, walk_length=40, num_walks=10, embedding_dim=64, seed=59
   - 验证：可正常执行，输出 embedding shape=(225, 64)，无报错

**产物**：
- `requirements.txt` 更新（追加 node2vec==0.4.6）
- `tests_py/test_struct_smoke.py`（smoke test 脚本）
- `artifacts/gt/struct-smoketest.md`：smoke test 运行日志 + 方案 α 决定记录

**验收标准**：
- `pip install -r requirements.txt` 成功
- `pytest tests_py/test_struct_smoke.py` 通过（耗时可能 30s 以内）
- `struct-smoketest.md` 落盘，含方案 α 的 L1 扩展规则精确描述

---

### Stage 67.3 — L4 缩域实测 + token 数落盘

**目的**：解决 proposal §0 I8（L4 分块策略影响嵌入锚点一致性），实测 ArchGuard L4 缩域 ArchJSON 的实际 token 数，决定是否需要分块方案。

**主要改动**（新增 `derive-l4.ts`，约 80 行）：

```typescript
// experiments/granularity/derive-l4.ts
// 字段裁剪：仅保留 version, language, entities（name/type/file），relations, callGraph
const reducedArchJson = {
  version: archJson.version,
  language: archJson.language,
  entities: archJson.entities.map(e => ({ name: e.name, type: e.type, file: e.file })),
  relations: archJson.relations,
  callGraph: callgraph,  // callgraph.ts 产物，375条 call 边
};
```

- 用 tiktoken（cl100k_base）实测裁剪后 JSON 的 token 数
- 结果落盘：`artifacts/levels/L4/token-count.txt`
- 若 token 数 ≤ 32k：L4 不分块，在 Stage 69.2 直接生成
- 若 token 数 > 32k：预注册分块方案（按模块切分，每块独立嵌入，mean pooling 聚合）

**产物**：
- `experiments/granularity/derive-l4.ts`
- `artifacts/levels/L4/token-count.txt`（含实测 token 数 + 分块决定）

**验收标准**：
- `npx tsx derive-l4.ts` 产出裁剪 JSON，token 数落盘
- `token-count.txt` 明确写明：（a）实测 token 数，（b）是否超 32k，（c）分块或不分块的决定及理由

---

### Stage 67.4 — Phase 0 门控逻辑预注册 + 预算确认

**目的**：解决 proposal §0 I4（FDR 预注册）、§0 I5（执行预算）、§0 I7（A1 配对单元）的剩余开放问题，完成冻结前置条件全部处置，为 Phase 68 解锁。

**主要改动**（无代码，约 20 行文档更新）：

1. **FDR 策略锁定**：B 系列 7 个决策检验采用 Benjamini-Hochberg FDR 控制（q=0.05）；A 系列 3 个检验独立 α=0.05；Phase 0 门控 3 个 KW 检验独立 α=0.05（不参与 B 系列 FDR 池）

2. **A1 配对单元明确**：配对单元 = 每道题的 F1 值（题目级 Wilcoxon，与 A3 bootstrap 重采样单元一致）

3. **执行预算落盘**（`artifacts/budget-v2.md`）：
   - S-lm-real 嵌入：~1002 次（6层级 × 167 锚点；可复用 v1 SHA-256 缓存命中部分）
   - S-code 嵌入：~1002 次（全新，无缓存）
   - S-struct：纯本地 node2vec，0 次 API 调用
   - LLM 任务：≥60 题 × k=5 × 2 模型 × 平均 3.26 层级（derivability 剪枝）≈ 1959 次；上界 3600 次（全 6 层级）；若 Phase 0 触发 B 系列停止，任务调用仅 A 类 ~25 题 × k=5 × 2 模型 × 平均 4 层级 ≈ 1000 次
   - 总 API 调用上界（全量）：~5604 次；B 系列停止时上界：~3004 次

4. **S-code 嵌入模型可用性预确认**：在 `budget-v2.md` 中记录 `nomic-embed-text` 回退链的当前可用性状态（通过 Ollama/LiteLLM 网关发送测试请求验证），以及 Phase 70.2 执行时须再次验证。此项不产出嵌入，仅落盘当前网络和服务状态。

5. **私有库选取决定**（若已确定）或触发 R1 风险记录（若未确定）

**产物**：
- `artifacts/budget-v2.md`（执行预算 + FDR 策略 + A1 配对单元 + 私有库决定）

**验收标准**：
- `budget-v2.md` 含上述全部项目，无 `[待确认]` 残留
- proposal §0 I1–I9 全部已有明确处置决定（修复或接受并注记风险），各项对应到 Stage 67.1–67.4（I6 在 Stage 68.2 验收，I9 在私有库选取决定中体现）
- S-code 可用性预确认记录落盘
- Phase 68 解锁条件：Stage 67.1–67.4 全部完成且验收标准通过

---

## Phase 68 — 任务设计：A/B/C 三类 Ground Truth 与任务文件

**目的**：实现 proposal §6 的三类任务（A ≥25 题，B ≥20 题，C ≥15 题），计算全自动 GT，生成并冻结任务文件。本 Phase 修复 v1 的 D2（判别空间不足）和 D3（A 类样本不足）。

**依赖**：Phase 67（泄漏探针结果确定被试；Stage 67.2 确认 callgraph 边口径；Stage 67.4 解锁 Phase 68）。
**可并行**：68.1、68.2、68.3 可并行；68.4 依赖三者全部完成。

**注**：本 Phase 主要针对**主实验私有库**（若确定）或 ArchGuard（若泄漏探针通过）。若私有库未定，以 ArchGuard 为被试，但须接受 R1 风险。

---

### Stage 68.1 — A 类任务扩充（≥25 题）

**目的**：将 v1 的 3 题 A 类扩充到 ≥25 题，修复 D3（§6.1 全部题型覆盖）。

**主要改动**（修改 `tasks/templates.ts` + 新增实例化脚本，约 120 行）：

- **题型**（复用 proposal §6.1）：
  - 入度排名：「按被调用包数量降序，前 N 的包是哪些？」（MCP `archguard_get_package_stats`）
  - 循环依赖：「以下包对中哪些形成循环？」（MCP `archguard_detect_cycles`）
  - 关节点：「移除哪个类会使包图连通分量数增加最多？」（`ground-truth.ts` 内置关节点算法）
  - 耦合热点：「与 ≥N 个其他类存在 dependency 关系的类有几个？」（MCP `archguard_analyze`）
  - 层间依赖：「[包A] 是否依赖 [包B]？最短路径是什么？」（MCP `archguard_get_dependencies`）

- **实例化约束**：
  - 每题覆盖不同实体集，避免集中于热点（目标：池化实体 ≥25 个，满足 d_task 可靠性要求 §R6）
  - GT 来源：MCP 工具（无需 LLM）+ `ground-truth.ts` 图算法
  - 答案格式：集合型 F1（实体名集合）或精确匹配（数字/布尔）

- **可推出性矩阵（A 类）**：
  - L0：仅文件名，无结构信息 → derivability=false（除最简单计数题外）
  - L1：包级 Mermaid，有包级边 → 入度/循环/层间依赖 derivability=true
  - L2/L3/L4/L5：全部 derivability=true

**产物**：
- `tasks/a-class-tasks.json`（≥25 题，含题目/GT/答案格式/可推出性标注）
- `tasks/a-class-gt.json`（GT 原始数据，MCP 调用结果）

**验收标准**：
- 题目数 ≥25，覆盖 §6.1 全部 5 种题型
- 每题有机械可计算 GT（MCP 或图算法输出，可重现）
- 逐题人检：答案不依赖标识符记忆（问题是定量属性或图关系，非"哪个类叫 Xxx"）
- 涉及实体去重后 ≥25 个（满足 d_task 池化要求）

---

### Stage 68.2 — B 类任务扩充（≥20 题）

**目的**：维持 B 类 ≥20 题规模，复用 `callgraph.ts` 375 条 call 边，确保调用边口径与 64.1 冻结决定一致。

**主要改动**（修改 `tasks/templates.ts` + 实例化，约 100 行）：

- **题型**（复用 proposal §6.2，沿用 v1 已有的 B 类 31 题框架，从中筛选精度更高的）：
  - 直接调用者：「调用 `MethodA.foo()` 的方法有哪些？」
  - 传递调用链：「从 `MethodA.foo()` 出发，N 跳内可达哪些方法？」
  - 最高被调用：「在 `[模块]` 内，被调用次数最多的方法是哪个？」
  - 变更影响：「修改 `ClassX.methodY()` 签名，直接受影响的调用方有哪些？」

- **GT 来源**：v1 `artifacts/gt/callgraph.json`（`kind='call'` 375 条），直接复用；主实验私有库须重新运行 `callgraph.ts`

- **v1 题目筛选**：从 v1 `tasks/tasks.json` 的 31 道 B 类题中筛选 GT 准确率高的（排除 v1 中发现的 GT 疑义题），保留 ≥20 题，不足则补充新题

**产物**：
- `tasks/b-class-tasks.json`（≥20 题，含题目/GT/答案格式/可推出性标注）

**验收标准**：
- 题目数 ≥20，GT 全部来自 callgraph.ts 机械计算（非人工判断）
- 调用边口径与 Stage 64.1 冻结的 (i)–(iv) 口径一致（展开口径为主）
- 每题有精确 GT：调用者集合（集合型 F1 评分）
- **§0 I6 处置落盘**：在 `tasks/b-class-tasks.json` 头部注释中明确：边集口径为 `kind='call'`（375 条），reference 边（1 条）不计入；B 类任务答案依赖此口径，主实验私有库须重新运行 `callgraph.ts` 生成对应口径的边集
- **§0 I9 处置落盘**：在 B 类任务注释中记录被试语言；若为 TypeScript，callgraph.ts 原生支持；若为其他语言，须在 `budget-v2.md` 预注册等价工具

---

### Stage 68.3 — C 类任务设计（≥15 题，v2.2 新增）

**目的**：实现 proposal §6.3 的"定向判别任务"，工程化制造 P_oracle ≠ H0 的判别空间，修复 D2（v1 判别子集仅 5 题）。

**主要改动**（新增 `gt-c-class.ts`，约 120 行）：

```typescript
// experiments/granularity/gt-c-class.ts
// C1: 过压缩拓扑推断——找 ClassA→ClassB 的具体调用方法
function findConcreteCallEdge(callgraph: CallEdge[], from: string, to: string): string[] {
  return callgraph
    .filter(e => e.callerClass === from && e.calleeClass === to)
    .map(e => `${e.callerClass}.${e.callerMethod}`);
}

// C2: 细粒度计数——ClassX 中被其他类调用次数超过 N 次的 private 方法
function findHighlyCalledPrivateMethods(
  callgraph: CallEdge[], archJson: ArchJSON, className: string, threshold: number
): string[] { ... }

// C3: 条件可达性——MethodA 调用方中，有哪些本身也被 MethodB 直接调用
function findSharedCallers(callgraph: CallEdge[], methodA: string, methodB: string): string[] { ... }
```

- **C 类可推出性矩阵（预注册）**：
  - L0/L1：derivability=false（无 method 粒度）
  - L2：derivability="partial"（有实体级依赖，无 method 级）；H0 预注册规则：取 L2（partial=最粗"有相关信息"层级）
  - L3/L4/L5：derivability=true
  - 设计目标：LLM 在 L2 的实际准确率显著低于 L3，从而 P_oracle=L3 ≠ H0=L2，扩大判别子集

- **C 类设计原则**（逐题人工验证 §R4）：
  - L2 Mermaid 图确实含相关 entity 节点（present）
  - 仅凭 L2 信息确实无法确定 method-level 答案（overcompressed）

**产物**：
- `experiments/granularity/gt-c-class.ts`
- `tasks/c-class-tasks.json`（≥15 题，含题目/GT/可推出性矩阵/人工验证记录）
- `artifacts/gt/c-class-gt.json`（C 类 GT 数据）

**C 类 GT 的 MCP 依赖说明**：`gt-c-class.ts` 中若有依赖 ArchGuard MCP 工具的 GT 计算（如 `archguard_get_dependencies`），须在调用前先在被试系统上执行 `node dist/cli/index.js analyze -f json -s <src_dir>`，使 MCP server 持有最新 ArchJSON 数据。当前 C 类任务的 GT 主要基于 `callgraph.ts` 产物机械计算（`findConcreteCallEdge`、`findHighlyCalledPrivateMethods`、`findSharedCallers`），不依赖 MCP；若后续扩充题目引入 MCP 工具调用，须在题目注释中标注"需要 MCP/pre-analyze"。

**验收标准**：
- 题目数 ≥15，覆盖 proposal §6.3 三类题型（过压缩拓扑/细粒度计数/条件可达性）
- `gt-c-class.ts` 产出 C 类 GT 可自动重现（无人工判断成分）
- 逐题人工验证：（a）L2 含相关 entity，（b）L2 无法解答 method-level 问题 → 验证记录落盘
- `npx tsx gt-c-class.ts` 产出结果与人工核实吻合（抽查 ≥5 题）

---

### Stage 68.4 — GT 哈希冻结 + 任务文件格式验证

**目的**：合并 A/B/C 三类任务，做格式校验，计算哈希，执行"协议级冻结"（打 git tag）。

**主要改动**（新增合并脚本 + schema 扩展，约 60 行）：

- 扩展 `tasks/schema.ts` 支持任务类型 `'C'` + `partial` derivability 状态
- 合并脚本 `tasks/merge-tasks.ts`：验证 A/B/C 三文件 schema，合并为 `tasks/v2-tasks.json`，逐题检查无标识符记忆依赖
- SHA-256 哈希计算：A/B/C GT 文件 + `v2-tasks.json` 哈希落盘到 `artifacts/gt/frozen-hashes-v2.json`
- **打 git tag**：`granularity-v2.2-freeze`

**产物**：
- `tasks/v2-tasks.json`（合并任务，A+B+C ≥60 题，schema 校验通过）
- `artifacts/gt/frozen-hashes-v2.json`
- git tag `granularity-v2.2-freeze`

**验收标准**：
- `tasks/merge-tasks.ts` schema 校验零错误
- A ≥25 题，B ≥20 题，C ≥15 题（总计 ≥60 题）
- `frozen-hashes-v2.json` 存在，git tag 存在且包含 v2-tasks.json 和 frozen-hashes-v2.json
- **tag 之后，Phase 68 的任何任务文件修改均须记协议偏离**

---

## Phase 69 — 表示层级生成（真名 L0-L5）

**目的**：生成被试系统的六个层级表示（v2.2 关键修复：去混淆，使用真名；L4 重新可用）。**对 src/ 零改动，纯实验侧脚本。**

**依赖**：Phase 68（任务冻结确定被试；Stage 67.3 确定 L4 是否分块）。
**可并行**：69.1、69.2、69.3 可在被试系统确定后并行执行；69.4 依赖三者完成。

---

### Stage 69.1 — L0-L3 生成（真名，复用 gen-levels.sh）

**目的**：在被试系统（私有库或 ArchGuard）的**真名源码**上生成 L0-L3，复用 v1 的 `gen-levels.sh` 和 `inject-callgraph.ts`，去掉混淆步骤。

**主要改动**（修改 `gen-levels.sh`，约 30 行）：

- 移除对 `obfuscate.ts` 的调用
- 输入目录改为被试系统原始 `src/` 目录（真名）
- 输出目录：`artifacts/levels/L0/`、`artifacts/levels/L1/`、`artifacts/levels/L2/`、`artifacts/levels/L3/`
- L0：`find <src_dir> -name '*.ts' | sort`（真名文件名清单）
- L1：`node dist/cli/index.js analyze --diagrams package --no-cache`（真名 package Mermaid）
- L2：`node dist/cli/index.js analyze --diagrams class --no-cache`（真名 class Mermaid）
- L3：`node dist/cli/index.js analyze --diagrams method --no-cache` + `inject-callgraph.ts` 注入调用边

**注意**：v2.2 去混淆后，L5（真名源码）与 L0（真名文件名）在语义嵌入空间中可区分（这是 v2.2 修复 D1 的核心）。

**产物**：
- `artifacts/levels/L0/filelist.txt`
- `artifacts/levels/L1/package.mmd`
- `artifacts/levels/L2/class.mmd`
- `artifacts/levels/L3/method-callgraph.mmd`

**验收标准**：
- L0 文件名清单为真名（非 Xq7 形式混淆名）
- L3 Mermaid 通过 ArchGuard Mermaid 校验器语法检验
- L3 末尾含调用边 flowchart 附录（边数与 callgraph.json kind='call' 一致）

---

### Stage 69.2 — L4 缩域 ArchJSON 生成

**目的**：使用 Stage 67.3 实现的 `derive-l4.ts` 生成 L4，并按 Stage 67.3 的 token 数决定是否分块。

**主要改动**（运行 `derive-l4.ts`，无新代码）：

- 输入：被试系统真名 ArchJSON（`analyze -f json` 输出）+ `callgraph.json`（375 call 边）
- 输出：裁剪 JSON（version, language, entities{name,type,file}, relations, callGraph）
- 若 token 数 ≤ 32k：直接落盘 `artifacts/levels/L4/reduced.json`
- 若 token 数 > 32k：按 Stage 67.3 预注册的分块规则分块落盘，并更新 `embed.py` 的分块聚合参数记录

**产物**：
- `artifacts/levels/L4/reduced.json`（或分块文件）
- `artifacts/levels/L4/token-count-actual.txt`（实际 token 数，与 Stage 67.3 预估对比）

**验收标准**：
- L4 JSON 字段仅含 version/language/entities(name,type,file)/relations/callGraph
- entities 中的实体名为真名（非混淆名）
- 实际 token 数落盘，与 Stage 67.3 预估差异在 ±20% 以内（或记录差异原因）

---

### Stage 69.3 — L5 原始源码（真名）

**目的**：生成 L5（去注释真名源码），替代 v1 的混淆源码。

**主要改动**（修改 v1 的 L5 生成步骤，约 20 行 shell 脚本）：

- 使用 `strip-comments`（或等价工具）对被试系统 `src/` 目录去注释
- 保留真实标识符（Anthropic、MermaidGenerator 等）
- 若 L5 token 数接近 128k context 限制：按模块（src/mermaid + src/parser）分块生成，每块独立作为 L5 的一个表示单元

**产物**：
- `artifacts/levels/L5/source-stripped.ts`（去注释真名源码，或按模块分块）
- `artifacts/levels/L5/token-count.txt`

**验收标准**：
- L5 为真名（grep 有 MermaidGenerator、ArchGuard 等领域词命中）
- L5 无注释（`grep -E '//|/\*' L5/` 基本无命中，允许字符串内例外）
- token 数 ≤ 128k（若超出须预注册分块方案）

---

### Stage 69.4 — 层级产物哈希记录

**目的**：记录 L0-L5 六个层级产物的 SHA-256 哈希，供后续 Phase 验证工件完整性。

**主要改动**（约 20 行 shell 脚本或 TS）：

- 计算 L0-L5 各层级产物文件的 SHA-256
- 追加到 `artifacts/gt/frozen-hashes-v2.json`（Level 字段）

**产物**：
- `frozen-hashes-v2.json`（Level 字段追加）

**验收标准**：
- 六个层级产物均有哈希记录
- 哈希文件随 git commit 落盘（为后续 Phase 70 提供完整性保证）

---

## Phase 70 — 嵌入 + 维度估计（三传感器）+ Phase 0 门控 + 事前预测冻结

**目的**：实现三传感器（S-lm-real + S-code + S-struct），跑 Phase 0 门控，完成事前预测落盘（H0 + P_GIT-sem + P_GIT-struct），**严格先于任何 LLM 任务**。

**依赖**：Phase 69（层级产物）；Stage 67.2（S-struct smoke test 通过，requirements.txt 已更新）。
**可并行**：70.1、70.2、70.3 三传感器嵌入可并行；70.4 依赖三者；70.5 依赖 70.4。

---

### Stage 70.1 — S-lm-real 嵌入（qwen3-embedding:4b，真名）

**目的**：在真名 L0-L5 上运行 S-lm-real 嵌入，**可部分复用 v1 缓存**（SHA-256 命中则零 API 调用）。

**主要改动**（修改 `embed.py`，约 20 行变更）：

- 输入文本改为真名层级产物（`artifacts/levels/Lx/`），而非混淆树
- 保留 v1 的 SHA-256 磁盘缓存机制（真名文本与混淆文本 SHA-256 不同，缓存命中率视被试而定）
- 输出：`artifacts/embeddings/dim-input.json`（保留 v1 文件名，追加 v2 标记）

**复用说明**：`embed.py` 框架（HTTP client、缓存、truncate 防护、L5 分块聚合）完全复用，仅输入路径变化。

**产物**：
- `artifacts/embeddings/dim-lm-real.json`（S-lm-real 嵌入结果，含元数据）

**验收标准**：
- 全部嵌入请求带 `truncate:false`（日志可验证）
- 嵌入元数据落盘（model/endpoint/chunk_size 等）
- 缓存命中率记录（与 API 实际调用次数对比）

---

### Stage 70.2 — S-code 嵌入（nomic-embed-text）

**目的**：实现第二传感器 S-code，验证代码专精嵌入模型是否对层级结构更敏感。

**前置检查（必须在本 Stage 开始前完成）**：验证 S-code 嵌入模型可用性——向 Ollama/LiteLLM 网关发送测试请求（任意短文本），确认 `nomic-embed-text` 可正常返回嵌入向量；不可用则按回退链顺序（mxbai-embed-large → text-embedding-3-small）逐级测试，记录实际使用的首个可用模型，落盘到 `artifacts/embeddings/s-code-availability.txt`。**此项检查须在 Phase 70 入口完成，不得在嵌入任务中途临时切换模型。**

**主要改动**（新增 `embed_code.py`，约 30 行，复用 embed.py 框架）：

- 复用 `embed.py` 全部逻辑（HTTP client、缓存、truncate 防护、分块聚合）
- **唯一变化**：模型名改为前置检查确认的首个可用模型（默认 `nomic-embed-text`）
- 回退链（预注册）：nomic-embed-text → mxbai-embed-large（Ollama）→ text-embedding-3-small（OpenAI 经 LiteLLM）
- 实际使用的模型名落盘到嵌入元数据

**产物**：
- `experiments/granularity/embed_code.py`
- `artifacts/embeddings/s-code-availability.txt`（可用性检查结果，含实际使用的回退链位置）
- `artifacts/embeddings/dim-code.json`

**验收标准**：
- `s-code-availability.txt` 存在，记录实际使用的模型名及回退链命中级别
- `embed_code.py` 与 `embed.py` 共享同一缓存目录（不同 model_name SHA-256 隔离）
- 实际使用的回退链位置落盘（无论命中哪级）
- 所有请求带 truncate 防护

---

### Stage 70.3 — S-struct 嵌入（node2vec，per-level 图）

**目的**：实现第三传感器 S-struct，完全绕开 LLM，在图结构上估计维度，验证信息分层结构本身是否可测。

**主要改动**（新增 `embed_struct.py`，约 120 行）：

- 从 `artifacts/gt/callgraph.json`（kind='call'，375 条）+ ArchJSON.relations（inheritance/dependency）构建各层级图
- **方案 α 的层级图构建（预注册，来自 Stage 67.2）**：
  - L0：零边图（method 节点全集，无边）→ 标记"不可估计"，跳过维度估计
  - L1：method 节点全集 + entity 级 inheritance/dependency 边（代表方法节点扩展规则）
  - L2：L1 边 + composition/aggregation 边
  - L3/L4：L2 边 + 375 条 call 边
  - L5：同 L3/L4
- 对每个层级跑 node2vec（p=1.0, q=1.0, walk_length=40, num_walks=10, embedding_dim=64, seed=59）
- 锚点不在图中（无调用边）→ 赋零向量，标记"图外点"，从维度估计中剔除
- 输出：各层级的 method 节点嵌入矩阵

**产物**：
- `experiments/granularity/embed_struct.py`
- `artifacts/embeddings/dim-struct-raw.json`（各层级 node2vec 嵌入 + 图外点标记）

**验收标准**：
- L0 标记"不可估计"（不产出有效嵌入）
- L3 和 L4 图结构一致（含 375 call 边 + inheritance/dependency），嵌入结果相似
- 各层级图节点数、边数落盘（可核验与预期一致）
- 运行 node2vec smoke test（`tests_py/test_struct_smoke.py`）在实际层级图上通过

---

### Stage 70.4 — d_ℓ 估计（三传感器 × 6 层级）

**目的**：对三个传感器各自的嵌入向量，运行 `dimension.py`（直接复用）估计各层级本征维度，产出 Phase 0 门控所需的所有 d_ℓ 数据。

**主要改动**（扩展 `dimension.py` 的输入接口，约 30 行）：

- 新增命令行参数 `--sensor S-lm-real|S-code|S-struct`，选择对应嵌入文件
- S-struct 的 L0 自动跳过（标记"不可估计"，不参与 Kruskal-Wallis 检验）
- 输出各传感器的 `{d_ℓ, CI, 可靠性标记}` 矩阵

**产物**：
- `artifacts/embeddings/dim-struct.json`（S-struct 维度估计）
- `artifacts/embeddings/dim-code.json`（S-code 维度估计，已在 70.2 命名，此处指维度估计结果）
- `artifacts/embeddings/dim-lm-real.json`（更新，追加维度估计字段）

**验收标准**：
- 三传感器各有 d_ℓ 矩阵（L0-L5），可靠性标记完整
- S-struct L0 标记"不可估计"
- 所有超参数（TwoNN discard_fraction=0.1, MLE K=10, bootstrap N=1000, seed=59）落盘

---

### Stage 70.5 — Phase 0 门控判定 + 事前预测冻结

**目的**：执行三传感器分离判定（Phase 0 门控），根据结果决定是否执行 Phase 71；同时完成 H0 + P_GIT-sem + P_GIT-struct 事前预测落盘。**本 Stage 的 git commit 时间戳是"事前"的法律证据。**

**主要改动**（修改 `predict.ts`，约 50 行变更）：

**Phase 0 门控判定**（预注册分离标准）：
- 对每个传感器 S，满足以下**至少一个**判为"S 分离"：
  - (a) d_L5 - d_L0 > 2 且两个 CI 不重叠；**S-struct 的例外**：L0 不可估计，改用 d_L5 - d_L2 > 2 且两个 CI 不重叠
  - (b) Kruskal-Wallis 跨 {L0, L2, L3, L5} 四层级 bootstrap d 分布，p < 0.05；**S-struct 的例外**：L0 不可估计，KW 检验跨 {L2, L3, L5} 三层级（预注册：S-struct 的 KW 为三层级，记入报告）
- 门控规则：
  - ≥2 个传感器分离：继续 B 系列（Phase 71 全量执行）
  - 仅 1 个分离：继续 B 系列，但仅用分离传感器做 P_GIT 计算
  - 0 个分离：停止 B 系列（Phase 71 仅执行 A 类任务），直接进入 Phase 72 A 系列报告

**事前预测落盘**（修改 `predict.ts` 新增 P_GIT-struct）：
- P_GIT-sem：用 S-lm-real d_ℓ 扫描，取第一个 d_ℓ ≥ d_task 的层级
- P_GIT-struct：用 S-struct d_ℓ 扫描（同上逻辑；L0 不可靠层级跳过）
- H0：从 derivability 矩阵推出结构充分性最粗层级
- P_random：均匀随机（种子 59）
- 平局规则（预注册）：L3/L4 信息等价时一律取 L3

**产物**：
- `artifacts/embeddings/dim-phase0.json`（Phase 0 门控结果：三传感器分离度 + 判定结论 + 时间戳）
- `artifacts/predictions/predictions-v2-TIMESTAMP.json`（H0 + P_GIT-sem + P_GIT-struct，带 ISO 时间戳）
- **git commit**（含上述两文件）

**验收标准**：
- `dim-phase0.json` 含三传感器各自的分离判定结论（分离/不分离 + 判定依据）
- `predictions-v2-*.json` 对每道题均有 H0/P_GIT-sem/P_GIT-struct 明确预测（或标记"无判定力"原因）
- predictions commit 时间戳**早于 Phase 71 任何 LLM 任务调用**（Phase 71 入口检查将据此核对）
- 若 Phase 0 判定为"0 个传感器分离"：`dim-phase0.json` 标注"B 系列停止"，Phase 71 仅执行 A 系列任务

---

## Phase 71 — LLM 任务运行（仅在 Phase 0 通过后）

**目的**：运行 LLM 任务（k=5，两模型，全层级），计算评分，产出 P_oracle。**本 Phase 仅在 Phase 70.5 的 predictions commit 已存在后启动。**

**依赖**：Stage 70.5 已 git commit（入口强制检查）；Phase 68（任务文件）。
**入口检查（强制）**：核对 predictions commit 时间戳早于本 Phase 一切产物；Phase 0 门控结果落盘。

**Phase 0 门控分支（入口处判断，不可跳过）**：
- 若 `dim-phase0.json` 标注"B 系列停止"（0 个传感器分离）：**Phase 71 仅运行 A 类任务**（≥25 题 × k=5 × 2 模型 × L0-L5），跳过 B 类和 C 类任务；Stage 71.1 和 Stage 71.3 的 dry-run 和评分也只覆盖 A 类；Phase 72 直接执行 A 系列检验（A1/A2/A3），跳过 B1–B4
- 若 `dim-phase0.json` 标注"仅 N 个传感器分离"（N=1）：Phase 71 全量执行（A+B+C），但 Phase 72 的 B 系列 P_GIT 计算仅使用分离传感器
- 若 `dim-phase0.json` 标注"≥2 个传感器分离"：Phase 71 全量执行（A+B+C 三类，k=5 × 2 模型 × 全层级）

---

### Stage 71.1 — run-tasks.ts 更新（k=5，模型回退链，C 类支持）

**目的**：修正 v1 的协议偏离（k=2→k=5；去 L4 跳过逻辑；新增 C 类 partial derivability 处理）。

**主要改动**（修改 `run-tasks.ts`，约 60 行变更）：

- **k 修正**：k=2 → k=5（多数票需奇数 k，k=5 下 3/5 多数有意义）
- **模型回退链（预注册）**：
  - 前沿模型：`claude-sonnet-4-6`（temperature=1）；不可用 → `gpt-4o`（temperature=1）
  - 小模型：`deepseek-v4-flash`（temperature=0.2）；不可用 → `deepseek-chat`（temperature=0.2）
- **L4 不再跳过**：Stage 69.2 的 L4 缩域已解决 context 超限问题
- **C 类 partial 处理**：derivability="partial" 的 (C类任务 × L2) 单元**不跳过**（partial 层级是实验关键点，需要实测准确率）
- **断点续跑**：沿用 v1 的 (任务,层级,模型,k) 键落盘机制

**产物**：
- `run-tasks.ts`（修改后）

**验收标准**：
- dry-run 模式输出调用计划，k=5 × 2 模型 × ≥60 题（扣除 derivability=false 单元）
- 调用计划包含 L4 层级（不再被跳过）
- C 类 L2（partial）单元出现在调用计划中

---

### Stage 71.2 — 任务运行（按 Phase 0 门控结果确定范围）

**目的**：实际执行 LLM 任务调用。**任务范围由 Phase 0 门控结果决定**（见 Phase 71 入口分支说明）。

**主要改动**（纯实运行，无新代码）：

- **Phase 0 分支 A（≥2 个传感器分离，全量执行）**：`run-tasks.ts` 实跑 A(≥25题) + B(≥20题) + C(≥15题) = ≥60 题 × k=5 × 2 模型 × 层级（扣除 derivability=false 单元），估算 ≈ 1959 次调用（上界 3600 次）
- **Phase 0 分支 B（仅 1 个传感器分离，全量执行但后续分析受限）**：同上，全量执行；Phase 72 的 P_GIT 计算仅用分离传感器
- **Phase 0 分支 C（0 个传感器分离，仅 A 类）**：`run-tasks.ts` 仅执行 A 类任务（≥25题 × k=5 × 2 模型 × 平均 4 层级），估算 ≈ 1000 次调用；B 类和 C 类不执行，`p-oracle-v2.json` 仅含 A 类结果
- 每批任务前验证 predictions commit 时间戳（不早于则报错停止）
- 断点续跑：已完成调用不重跑

**产物**：
- `artifacts/runs/`（各任务调用结果，按 (任务,层级,模型,k) 键组织）

**验收标准**：
- 全部调用结果落盘，含采样参数（temperature/模型名/token数）
- 断点续跑日志完整（无重复计费记录）
- 实际调用次数与预算估算对比记录

---

### Stage 71.3 — 得分计算（F1/精确匹配）

**目的**：对全部任务运行结果评分，产出 P_oracle 和准确率–层级曲线。

**主要改动**（修改 `score.ts`，约 30 行变更，支持 C 类 partial）：

- A/B 类：沿用 v1 评分逻辑（集合型 F1 / 精确匹配）
- C 类：同上，GT 来自 `gt-c-class.ts`
- k=5 多数票（判定型/精确匹配）/ 中位数（数值型）
- **P_oracle 计算**：每道题的最优层级（准确率最高的层级；平局取序号较小者）
- 输出长表：(任务 × 层级 × 模型 × 准确率)

**产物**：
- `artifacts/runs/scores-v2.json`（评分长表）
- `artifacts/runs/p-oracle-v2.json`（P_oracle：每题最优层级）

**验收标准**：
- 所有 ≥60 题均有评分记录（含 derivability=false 跳过标记）
- P_oracle 对每道题有明确层级输出
- 判别子集（P_oracle ≠ H0）计算结果落盘，计数 ≥8 才继续 B2 判定（否则记"无判定力"）

---

## Phase 72 — 统计分析 + 报告

**目的**：完成全部统计检验（A1–A3，B1–B4），执行 §10 决策表，撰写实验报告。

**依赖**：Phase 71（评分结果）；Stage 70.5（维度估计 + 事前预测）。

---

### Stage 72.1 — analyze.py 更新（三传感器 + FDR 校正 + 门控分支）

**目的**：扩充 `analyze.py`，支持三传感器消融比较、BH-FDR 校正和 Phase 0 门控分支逻辑。

**主要改动**（修改 `analyze.py`，约 80 行变更）：

**A 系列检验（独立 α=0.05）**：
- A1（干扰）：配对 Wilcoxon，`acc(L5)` vs 各任务类最优中间层级 F1，ΔF1 ≥ 0.1，配对单元=题目
- A2（倒 U）：各任务类 argmax 是否非端点
- A3（移峰）：B/C 类最优层级序号 > A 类最优层级序号；bootstrap 95% CI（1000 次，题目为重采样单元）下界 > 0

**B 系列检验（BH-FDR q=0.05，共 7 个检验）**：
- B1：P_GIT-sem 命中率 vs P_random（McNemar）；P_GIT-struct 命中率 vs P_GIT-sem（McNemar）
- B2a：P_GIT-sem vs H0 在判别子集上（McNemar）
- B2b：P_GIT-struct vs H0 在判别子集上（McNemar）
- B2c（消融）：P_GIT-sem vs P_GIT-struct（McNemar）
- B3：|d_ℓ(S-lm-real) - d_task| 与准确率的 Spearman 相关；副测：S-struct 同样 Spearman
- B4：L3 vs L4 格式敏感性（非主决策，作为附加证据报告）

**Phase 0 门控分支**：
- 若 `dim-phase0.json` 标注"B 系列停止"：跳过 B1-B4，仅输出 A 系列结果
- 若仅 1 个传感器分离：B 系列仅用分离传感器做 P_GIT；其余传感器结果作敏感性报告

**产物**：
- `artifacts/runs/analysis-v2.json`（全部检验 p 值 + FDR 调整后 p 值 + 判定位）

**验收标准**：
- 全部原始 p 值落盘（含未校正和 BH 校正后）
- 判别子集 < 8 时：B2 自动标记"无判定力"，跳过 B2a/B2b/B2c
- `analyze.py` 的 pytest 覆盖率 ≥ 80%（含新增检验的合成数据测试）

---

### Stage 72.2 — P_probe 事后诊断

**目的**：在 P_oracle 标签已知后，训练线性探针诊断 S-lm-real 嵌入空间是否能线性区分最优层级。**P_probe 明确标注为"事后诊断工具"，不参与决策表。**

**主要改动**（新增 `probe_linear.py`，约 80 行）：

- 输入：S-lm-real 嵌入向量（`dim-lm-real.json`）+ P_oracle 标签（`p-oracle-v2.json`）
- 方法：逻辑回归（scikit-learn，5-fold CV）训练线性探针，预测 P_oracle 层级标签
- 输出：各任务类的线性探针分类准确率 + confusion matrix
- **报告约束**（硬编码注释）：P_probe 使用了 P_oracle 标签（事后），不能替代事前预测器

**产物**：
- `experiments/granularity/probe_linear.py`
- `artifacts/runs/p-probe-v2.json`（线性探针结果，含"事后诊断"标注）

**验收标准**：
- `probe_linear.py` 输出结果文件含 `"is_post_hoc": true` 字段
- 报告中 P_probe 结果在独立章节，与 B 系列决策检验明确分隔

---

### Stage 72.3 — 决策表判定 + REPORT.md 撰写

**目的**：根据 Stage 72.1 的统计结果，执行 proposal §10 的六行决策表，撰写最终实验报告。

**主要改动**（纯文档，无代码）：

**§10 决策表判定（按行序，命中即止）**：
1. **Phase 0：0 个传感器分离** → 强负结果，B 系列停止，仅报告 Experiment A；不得调整传感器参数后重试
2. 判别子集 < 8，或 K < 50，或多数 d_ℓ 不可靠 → Experiment B 无判定力，降级为仅报告 Experiment A
3. B2a 且 B2b 且 B3 均成立 → GIT 从描述性升级为预测性候选
4. B2a 成立，B2b 不成立（或反之） → 单信号有效，归因分析
5. B2a/B2b 均成立，B3 不成立 → 预测力成立但梯度机制存疑
6. B2a/B2b 均不成立，B1 成立 → 维度机器为换装的启发式

**REPORT.md 结构**：
- 实验配置（v2.2 参数，与 v1 对比表）
- Phase 0 门控结果（三传感器分离度 + 判定结论）
- 维度估计结果（三传感器 × 6 层级，d_ℓ 矩阵 + CI）
- 事前预测对比表（H0 vs P_GIT-sem vs P_GIT-struct vs P_random）
- Experiment A 结果（A1/A2/A3 判定，准确率–层级曲线）
- Experiment B 结果（B1-B4，FDR 校正后 p 值，判别子集成员）
- P_probe 事后诊断（独立章节，明确标注：标签来源为 Phase 71.3 产出的 `p-oracle-v2.json`，仅在 Phase 71 完成后才可计算；P_probe 不参与 §10 决策表）
- §10 决策表判定（命中行 + 理由）
- 协议偏离清单（v2.2 执行中所有偏离记录）
- 成本实数（API 调用次数 vs 预算估算）

**产物**：
- `experiments/granularity/REPORT-v2.md`

**验收标准**：
- §10 判定行号与具体判定结论一一对应
- 无任何"按结果改预测"痕迹（predictions 文件哈希与 Stage 70.5 commit 一致，在报告中明确声明）
- 协议偏离清单完整（包含 v1 已有的 D1-D4 是否在 v2.2 中修复的说明）
- P_probe 章节明确标注"事后诊断，不参与 §10 决策"；章节中须写明 P_probe 使用的 P_oracle 标签来源（Stage 71.3 的 `p-oracle-v2.json`，产出时间晚于预测冻结时间戳），并说明 P_probe 回答的是"嵌入空间事后能否线性分离层级"，不能替代事前预测器 P_GIT-sem/P_GIT-struct 的结论

---

## 测试策略

### 实验脚本验收标准（非 TDD 单元测试）

本 plan 的核心验收标准是**脚本产出文件的内容正确**，而非 TDD 单元测试：

- **Stage 67.1**：`leak-probe-v2.md` 落盘，F1 计算过程透明
- **Stage 67.2**：`pytest tests_py/test_struct_smoke.py` 通过（node2vec smoke test）
- **Stage 67.3**：`token-count.txt` 含实测 token 数和分块决定
- **Stage 68.1–68.3**：任务文件 schema 校验通过，GT 可机械重现
- **Stage 68.4**：`merge-tasks.ts` schema 校验零错误，A≥25、B≥20、C≥15
- **Stage 69.1–69.3**：六层级产物齐备，L3 语法校验通过，L5 含真名
- **Stage 70.1–70.3**：三传感器嵌入元数据完整，S-struct L0 标注"不可估计"；`s-code-availability.txt` 落盘
- **Stage 70.5**：predictions commit 时间戳早于 Phase 71 任何调用
- **Stage 71.3**：P_oracle 落盘，判别子集计数明确
- **Stage 72.1**：全部原始 p 值 + FDR 校正后 p 值落盘

### 新增 pytest 测试（需新写）

| 测试文件 | 内容 | 所属 Stage |
|---|---|---|
| `tests_py/test_struct_smoke.py` | node2vec smoke test（225节点/375边） | 67.2 |
| `tests_py/test_embed_struct.py` | S-struct 层级图构建正确性（L1 代表节点扩展规则） | 70.3 |
| `tests_py/test_analyze_fdr.py` | BH-FDR 校正逻辑（合成数据已知答案） | 72.1 |
| `tests/gt-c-class.test.ts` | `gt-c-class.ts` 的三种查询函数（fixture callgraph） | 68.3 |

### 凭据纪律

- 全部 pytest/vitest 测试用 mock HTTP/LLM client，CI 可在无凭据环境运行
- 实跑脚本仅经 `LLM_BASE_URL` / `LLM_API_KEY` 取凭据

---

## Phase/Stage 依赖关系总表

| Phase | Stage | 依赖 | 可并行 |
|---|---|---|---|
| **67** | 67.1 泄漏探针 | 无（复用 lib/llm-client.ts） | 与 67.2 并行 |
| **67** | 67.2 S-struct smoke | 无 | 与 67.1 并行 |
| **67** | 67.3 L4 token 实测 | 无 | 与 67.1、67.2 并行 |
| **67** | 67.4 预算确认 | 67.1–67.3 全部完成 | 否（门控步骤）|
| **68** | 68.1 A 类任务 | 67.4（被试确定） | 与 68.2、68.3 并行 |
| **68** | 68.2 B 类任务 | 67.4（边口径确认） | 与 68.1、68.3 并行 |
| **68** | 68.3 C 类任务 | 67.4（callgraph.json 可用） | 与 68.1、68.2 并行 |
| **68** | 68.4 冻结 tag | 68.1+68.2+68.3 | 否（冻结串行）|
| **69** | 69.1 L0-L3 生成 | 68.4（被试确定） | 与 69.2、69.3 并行 |
| **69** | 69.2 L4 生成 | 67.3（分块决定） + 68.4 | 与 69.1、69.3 并行 |
| **69** | 69.3 L5 生成 | 68.4 | 与 69.1、69.2 并行 |
| **69** | 69.4 哈希记录 | 69.1+69.2+69.3 | 否 |
| **70** | 70.1 S-lm-real | 69.4 | 与 70.2、70.3 并行 |
| **70** | 70.2 S-code | 69.4 | 与 70.1、70.3 并行 |
| **70** | 70.3 S-struct | 69.4 + 67.2（smoke test） | 与 70.1、70.2 并行 |
| **70** | 70.4 d_ℓ 估计 | 70.1+70.2+70.3 | 否 |
| **70** | 70.5 门控+冻结 | 70.4 | 否（法律证据串行）|
| **71** | 71.1 run-tasks 更新 | 70.5 commit 存在 | 可提前于 70.5 实现，但不可运行 |
| **71** | 71.2 任务运行 | 70.5 commit + 71.1 | 否（预注册顺序）|
| **71** | 71.3 得分计算 | 71.2 | 否 |
| **72** | 72.1 analyze.py | 71.3 + 70.5 | 否 |
| **72** | 72.2 P_probe | 71.3 + 70.1（嵌入）| 可与 72.1 并行 |
| **72** | 72.3 报告 | 72.1 + 72.2 | 否 |

---

## 新增产物列表（增量于 v2.1）

```
experiments/granularity/
  # 新增脚本
  derive-l4.ts              # Stage 67.3：L4 缩域 ArchJSON 生成
  gt-c-class.ts             # Stage 68.3：C 类任务 GT 自动计算
  embed_code.py             # Stage 70.2：S-code 嵌入（nomic-embed-text）
  embed_struct.py           # Stage 70.3：S-struct node2vec 图嵌入
  probe_linear.py           # Stage 72.2：P_probe 事后线性探针

  # 修改脚本（复用 v1）
  embed.py                  # Stage 70.1：输入改为真名层级（去混淆）
  run-tasks.ts              # Stage 71.1：k=2→k=5，去 L4 跳过，加 C 类支持
  predict.ts                # Stage 70.5：新增 P_GIT-struct 分支
  analyze.py                # Stage 72.1：三传感器比较 + BH-FDR 校正
  score.ts                  # Stage 71.3：新增 C 类评分支持

  # 新增任务文件
  tasks/
    a-class-tasks.json      # Stage 68.1：A 类 ≥25 题
    b-class-tasks.json      # Stage 68.2：B 类 ≥20 题
    c-class-tasks.json      # Stage 68.3：C 类 ≥15 题
    v2-tasks.json           # Stage 68.4：合并任务文件
    merge-tasks.ts          # Stage 68.4：合并验证脚本

  # 新增 pytest 测试
  tests_py/
    test_struct_smoke.py    # Stage 67.2
    test_embed_struct.py    # Stage 70.3
    test_analyze_fdr.py     # Stage 72.1

  # 新增 vitest 测试
  tests/
    gt-c-class.test.ts      # Stage 68.3

  artifacts/
    levels/
      L0/filelist.txt               # Stage 69.1（真名文件名清单）
      L1/package.mmd                # Stage 69.1
      L2/class.mmd                  # Stage 69.1
      L3/method-callgraph.mmd       # Stage 69.1
      L4/reduced.json               # Stage 69.2（缩域 ArchJSON）
      L4/token-count.txt            # Stage 67.3（实测 token 数）
      L5/source-stripped.ts         # Stage 69.3（去注释真名源码）
    embeddings/
      dim-lm-real.json              # Stage 70.1（更新）
      s-code-availability.txt       # Stage 70.2（S-code 可用性检查结果）
      dim-code.json                 # Stage 70.2
      dim-struct-raw.json           # Stage 70.3
      dim-struct.json               # Stage 70.4
      dim-phase0.json               # Stage 70.5（Phase 0 门控结果）
    gt/
      leak-probe-v2.md              # Stage 67.1
      struct-smoketest.md           # Stage 67.2
      c-class-gt.json               # Stage 68.3
      frozen-hashes-v2.json         # Stage 68.4（任务哈希）
    predictions/
      predictions-v2-TIMESTAMP.json # Stage 70.5（带时间戳，事前冻结）
    runs/
      scores-v2.json                # Stage 71.3
      p-oracle-v2.json              # Stage 71.3
      analysis-v2.json              # Stage 72.1
      p-probe-v2.json               # Stage 72.2
    budget-v2.md                    # Stage 67.4（执行预算）
  REPORT-v2.md                      # Stage 72.3（最终实验报告）
```

---

## 行数预算核对

| Phase | 新增/修改源码 | 新增测试 | Stage 上限核对 |
|---|---|---|---|
| 67 | ≤ 150（胶水 + derive-l4.ts） | ~60（smoke test） | 各 Stage ≤ 80，满足 |
| 68 | ~400（三类任务模板 + gt-c-class.ts + merge-tasks.ts） | ~80（gt-c-class.test.ts） | 各 Stage ≤ 120，满足 |
| 69 | ~70（gen-levels.sh 修改 + L5 脚本） | 0 | 各 Stage ≤ 30，满足 |
| 70 | ~320（embed_code.py + embed_struct.py + predict.ts 修改 + dimension.py 修改） | ~80（embed_struct.py + FDR 测试） | 各 Stage ≤ 130，满足 |
| 71 | ~90（run-tasks.ts + score.ts 修改） | 0 | 各 Stage ≤ 60，满足 |
| 72 | ~160（analyze.py 修改 + probe_linear.py） | ~40（analyze_fdr 测试） | 各 Stage ≤ 80，满足 |
| **合计** | **~1190 行** | **~260 行** | 各 Phase ≤ 500，满足 |

每个 Stage ≤ 200 行源码，每个 Phase ≤ 500 行源码，均满足。`embed_struct.py` 因 node2vec 参数配置和层级图构建逻辑约 120 行，接近 Stage 上限但不超。

---

## v1 vs v2.2 修复对照

| v1 缺陷 | v2.2 修复 Stage | 验收方式 |
|---|---|---|
| D1：混淆→传感器失明 | 69.1–69.3（真名层级） | L5 grep 命中领域词 |
| D1：单传感器 | 70.1–70.3（三传感器） | dim-phase0.json 三传感器均有结果 |
| D2：判别空间不足（子集 5 < 8） | 68.3（C 类 ≥15 题） | 判别子集计数（Phase 71.3 落盘）|
| D3：A 类仅 3 题 | 68.1（A 类 ≥25 题） | tasks/a-class-tasks.json 题数 |
| k=2 协议偏离 | 71.1（k=5 修正） | dry-run 调用计划验证 |
| L4 跳过 | 67.3 + 69.2（L4 缩域） | artifacts/levels/L4/reduced.json 存在 |
| P_probe 无法事前冻结 | 72.2（明确为事后诊断）| is_post_hoc 字段 + 独立报告章节 |
| §0 I1-I9 开放问题 | Phase 67（全部处置） | budget-v2.md 无 [待确认] 残留 |
