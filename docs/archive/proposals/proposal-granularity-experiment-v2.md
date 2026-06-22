# Proposal: 可测本征维度能否预测最优表示粒度 — 实验 v2.2 协议

**判别 GIT 是"可预测理论"还是"穿了流形外衣的启发式"——v1 诊断驱动的重新设计**

- 前序版本：`docs/proposals/proposal-intrinsic-dimension-granularity-experiment.md`（v2.1，冻结于 `granularity-freeze-v2.1`，commit `ab8b30b`）
- v1 实验报告：`experiments/granularity/REPORT.md`（commit `64b1e53`）
- 本版本（v2.2）修订动因：v1 实验已全量运行并出具报告；报告暴露三个根本性方法论缺陷（传感器失明、判别空间不足、混淆策略导致泄漏），v2.2 系统性修复这三个缺陷，同时剥离 Track B（git 历史预报）为独立 proposal。
- 状态：草案。**所有预测、阈值、传感器参数须在跑任何 LLM 任务之前冻结（git tag），方可执行。**

---

## §0 已知问题（审查发现，冻结前须全部处置）

以下问题由对 v1 代码与数据的直接核查发现，按严重程度排列。**冻结 git tag 前，每项须有明确处置决定（修复 or 接受并注记风险）**。

### [致命] I1：S-struct 节点粒度定义前后矛盾

§12.1 预注册 JSON 声明 `node_granularity: "method"`（每个 ArchJSON entity 的每个 method 为一个节点），但 §8.1 的层级变体描述写道：

- L0：「仅文件名节点构成的孤立图」——文件名节点 ≠ method 节点；
- L1：「仅 package 级 dependency 边（ArchJSON relations 中 `type='dependency'` 合并到包级）」——method 节点之间如何通过 package-level 边连接未定义。

**这是逻辑矛盾**：若节点粒度固定为 method，则 L0 不存在"文件名节点"——L0 应定义为「method 节点全集，零条边（孤立图）」，d_L0(S-struct) 在 node2vec 下退化为随机嵌入，须在报告中说明。L1 的 package 级边需要明确映射规则：例如，若包 A 依赖包 B，则 A 中所有 method 节点与 B 中所有 method 节点之间连边（类似二部图完全连接），但此规则使 L1 图极稠密，与稀疏图前提冲突。**必须在冻结前选择并预注册以下方案之一**：

- **方案 α（推荐）**：节点粒度在各层级保持固定为 method 节点集。L0=零边图；L1=仅 entity-level inheritance/dependency 边（每 entity 以其 primary method 代表，或展开全部 methods）；L2=L1+更多 entity 级边；L3/L4=L1/L2 的边 + callgraph call 边；L5=同 L3/L4。删除"文件名节点"描述。
- **方案 β**：多分辨率图（每层级节点粒度不同，L0=file节点, L1=package节点, L2=class节点, L3=method节点），但此方案 TwoNN 跨层级不可比（点云空间不同），§9 B3 的 Spearman 相关无意义。**方案 β 与现有统计框架不相容，应排除。**

### [致命] I2：node2vec 未在 requirements.txt 中声明

`experiments/granularity/requirements.txt` 列出了 scikit-dimension/numpy/scipy 等，但不含 `node2vec` Python 库。S-struct 传感器完全依赖此库，当前无法安装执行。须在冻结前：(a) 确认 `node2vec` PyPI 包名及版本（当前 PyPI 上有 `node2vec==0.4.6`，需实测是否支持所需 API）；(b) pin 版本并添加到 requirements.txt；(c) 运行 smoke test 确认 ArchGuard callgraph（225 个节点，375 条 call 边）上的 node2vec 游走可正常执行。

### [重要] I3：泄漏探针阈值定义不精确，且对实际 GT 可能过严或过松

§5.3 写道：「答案中 ≥50% 的实体与 callgraph.ts 实际边吻合，判泄漏」。存在两个问题：

1. **分母未定义**：是模型输出集合的精确率（precision = 命中数 / 模型输出实体数），还是 GT 集合的召回率（recall = 命中数 / GT 实际调用者数）？语义截然不同。
2. **阈值对实际数据可能失效**：对 ArchGuard `src/mermaid` + `src/parser` 范围内，`MermaidGenerator` 类的外部调用方**实际仅 1 个唯一方法**（`MermaidDiagramGenerator.generateOnly`，经 callgraph.json 核实）。若分母为召回率，50% 阈值 = 命中 0.5 个，即任意命中 1 个触发判定——阈值等效为"任意猜中一个即判泄漏"，对训练集中见过 ArchGuard 的模型几乎必然触发；若分母为精确率，模型只需在其列表中有一个正确答案即可（不管列了多少个），也极易触发。

**建议改为精确定义**：将探针问题修改为「`MermaidGenerator` 的直接调用方有哪些类或方法（请列举，用逗号分隔）？」，评判标准改为：`F1(模型答案集合, GT调用者集合) ≥ 0.5` 判泄漏（F1 同时考虑精确率和召回率，对集合大小不敏感）；或改用模型对调用关系的"知情度"探针（给出真/假关系让模型判断 True/False，命中率显著超过 50% 随机基线则判泄漏）。具体阈值须在冻结前预注册，不得事后调整。

### [重要] I4：多重比较未预注册 α 校正策略

v2.2 中参与 §10 决策表的假设检验共约 **10 个**（B1×2、B2×3、B3×2、A1×2、A3×1），Phase 0 门控额外 3 个 Kruskal-Wallis 检验（每传感器一个）。以 α=0.05 独立检验，期望因随机得到约 0.5–0.65 个假阳性，在 B2a/B2b 这类二元门控判据下有实质风险。须在冻结前预注册以下之一：

- 不做族错误率（FWER）控制，接受 α=0.05 per-test，并在报告中显式声明此局限性；
- Bonferroni 校正（α'=0.05/10≈0.005，偏保守）；
- Benjamini-Hochberg FDR 控制（推荐，对相关检验更合理）。

§9 中各 B 系列假设须列出完整假设清单与对应检验方法，在冻结文档中标注各检验的校正后阈值。

### [重要] I5：v2.2 执行预算未量化

提案未给出 v2.2 的 LLM 调用次数估算，给执行计划和成本管理带来盲区。基于 v1 数据（444 次调用，derivability 剪枝后平均每任务 3.26 个层级）的估算：

- **嵌入请求**：3 传感器 × 167 锚点 × 6 层级 = **3006 次**（v1 835 次，增加 **3.6×**）；S-lm-real 可复用 v1 缓存（同一文本 SHA-256 命中），S-code 和 S-struct 全新。
- **LLM 任务调用**：60 任务 × k=5 × 2 模型 × 3.26 层级（derivability 估算）≈ **1959 次**（v1 444 次，增加 **4.4×**）；若全部 6 层级均运行，上界 **3600 次**（增加 8.1×）。

须在冻结前在 §12 或单独的执行计划中写明这些数字，并与 API 配额/预算确认。

### [次要] I6：callgraph 边数描述有歧义（376 vs 375）

提案多处写「376 条调用边」，但 `artifacts/gt/callgraph.json` 的 `stats` 字段显示 `call=375, reference=1`，总边数 376 含 1 条 reference 边。S-struct 的边集若依据 `kind='call'` 过滤，实际为 **375 条**。应统一为 375（call 边）或明确说明边集口径含 reference 边。

### [次要] I7：A1 检验单元未明确

§7 的 A1 假设（「配对 Wilcoxon，α=0.05，ΔF1≥0.1」）未说明配对单元是题目（每道题 L5 vs 最优中间层级的 F1 差值配对）还是其他单元。§ A3 的 bootstrap 说明了「以题目为重采样单元」，A1 应补充等价说明。

### [次要] I8：L4 分块策略影响嵌入锚点的一致性

§4.1 写「若实测超过 32k，按模块分块并记录为协议参数」，但未说明分块如何影响 S-lm-real 的锚点序列化：L4 分块后，单个锚点 $D_{L4}(a)$ 的文本可能跨块分布，embed.py 的 chunk 聚合策略（6000 字符分块 + mean pooling）与此交互关系须预注册，否则不同锚点的 L4 向量由不同数量的 chunk 聚合，可能引入系统性偏差。建议：冻结前实测 ArchGuard L4 缩域 ArchJSON 的实际 token 数，若超过 32k 则预注册分块方案；若未超过则删除此分支说明。

### [次要] I9：私有库选取标准缺少语言约束

§5.2 标准未说明语言限制。若私有库为 Go 项目，`callgraph.ts`（基于 ts-morph）不适用，B 类 ground truth 的调用边口径（§6.2 预注册的 (i)–(iv) 标准）需要等价的 Go 工具替代。建议在 §5.2 补充：「首选 TypeScript 项目（callgraph.ts 原生支持）；若使用 Go 项目，须在冻结前预注册等价的 Go callgraph 工具及口径，B 类 GT 独立审查」。

---

## 1. v1 诊断：三个根本性缺陷

### D1（致命）：传感器失明——混淆导致 L0 ≡ L5

v1 对 ArchGuard 全代码混淆（`obfuscate.ts`）后跑嵌入，结果：

```
L0 (文件名)：d̂ = 15.18  CI [10.7, 17.5]
L5 (混淆源码)：d̂ = 13.52  CI [10.1, 17.5]
```

两个 CI 高度重叠，**所有层级的维度估计全部落在 13–17 区间**。根因是混淆器把所有标识符替换为 `Xq7`/`Mf2` 形式的随机串，导致：

1. L0（文件名清单）与 L5（源码体）在 qwen3-embedding:4b 的语义空间里几乎不可区分——模型以为两者都是"随机乱码"；
2. 嵌入维度由**嵌入模型对随机文本的内部几何**决定，而非由表示层级的信息结构决定；
3. P_GIT 将全部 B 类任务预测为 L1（d_L1=16.77 ≥ d_task=15.36），命中率 0%，低于随机。

**结论**：v1 的维度传感器在混淆后的文本空间里是盲的。

### D2（结构性）：判别空间不足——判别子集仅 5 < 8

v1 B 系列中 P_oracle ≠ H0 的任务仅 5 个，预设最小规模 8。这意味着 H0 本身在 85.3% 任务上已经最优，P_GIT 即使有理论优势也几乎无处施展。

根因：v1 任务设计（"哪些函数调用进 X"等）几乎全部需要调用边，而调用边**首次出现**在 L3，H0 在此类任务上天然选 L3，与 P_oracle 高度一致。任务设计未刻意制造 H0 和 P_oracle 分离的空间。

### D3（规模性）：A 类任务仅 3 题——无统计力

协议要求 25–30 题，v1 实际只有 3 题（偏离 D4）。A 类比较无意义（n=3），且 A3 移峰成立的证据主要来自 B 类曲线的内点性质，A 类本身的推断极弱。

---

## 2. v2.2 核心修复方向

| 缺陷 | v2.2 修复 |
|---|---|
| D1：传感器失明（混淆 → 随机串） | 去混淆；改用真名；泄漏风险改由任务设计防范（§5）|
| D2：判别空间不足 | 新增 C 类任务：工程化制造 P_oracle ≠ H0 的空间（§6.3）|
| D3：A 类样本不足 | A 类补到 ≥25 题（§6.1）|
| 单传感器（qwen3-embedding:4b） | 三传感器：S-lm-real + S-code + S-struct（§8.1）|
| k=2 替代 k=5 | 修正为 k=5（§7）|
| L4 跳过 | L4 缩域方案（§4.5）|
| P_probe 无法事前冻结 | 明确为事后诊断，主消融改为 P_GIT-sem vs P_GIT-struct（§8.2）|
| Track B（git 历史预报）分散焦点 | 剥离为独立 proposal（§2 末）|

**Track B 剥离声明**：v1 的 Experiment B 中隐含一个"git 历史频率预测最优粒度"的方向（P_GIT 命名来源），但该轨道与主轨（维度估计预测粒度）几乎无代码/数据依赖，且 v1 已证明 P_GIT 在混淆条件下命中率 0%，根因不明（传感器失明 vs 理论失败混淆不清）。剥离后可在重新设计的被试上单独检验。**本 proposal 不包含 Track B 的任何假设与决策规则**；P_GIT-sem 和 P_GIT-struct 作为**因子消融**出现（§8.2），目的是诊断哪种维度信号有用，而非预测 git 历史。

---

## 3. 一句话的实验目的（继承 v2.1，不变）

检验一个**事前测出的本征维度** $\hat{d}$ 能否**预测**每类架构任务的最优表示粒度，并且**赢过**一行启发式"用仍然包含答案的最粗表示"（H0）。赢了，GIT 的低维流形核从描述性升级为预测性候选；没赢，我们干净地知道维度机器是装饰，可以卸掉。

---

## 4. 自变量：表示层级阶梯 v2.2

同一被试系统的六个层级，**与 v2.1 的差别：去混淆（真名），L4 缩域使其重新可用**。

| 代号 | 表示 | 生成方式 | 含调用边 | 预估 tokens（ArchGuard src/mermaid+parser）|
|---|---|---|---|---|
| **L0** | 仅文件名清单 | `find . -name '*.ts' \| sort` | 否 | ~0.1k |
| **L1** | package 级 Mermaid（flowchart LR） | `analyze --diagrams package --no-cache` | 否 | ~2k |
| **L2** | class 级 Mermaid（公有成员+实体级关系） | `analyze --diagrams class` | 否 | ~15k |
| **L3** | method 级 Mermaid（全成员含 private）**+ 调用边 flowchart 附录** | `analyze --diagrams method` + `callgraph.ts` 注入 | 是 | ~35k |
| **L4** | **缩域 ArchJSON**：仅包含 `relations` + `callGraph` 字段，实体字段压缩为 `{name, type, file}` | `analyze -f json` + 字段过滤 + `callgraph.ts` 注入 | 是 | ~20k（预估；若超 32k 进一步按实体 chunk）|
| **L5** | 原始源码（去注释，**真名**） | `strip-comments` 输出（不混淆） | 隐含 | ~65k |

### 4.1 L4 缩域方案（修复 v1 D2 偏离）

v1 中 L4（完整 ArchJSON）因体积 424KB > context 而跳过，导致格式敏感性假设 B4 无法检验。v2.2 对 L4 采用**字段裁剪**策略：

```typescript
// 实验侧脚本（不改动 src/）：derive-l4.ts
const reducedArchJson = {
  version: archJson.version,
  language: archJson.language,
  entities: archJson.entities.map(e => ({ name: e.name, type: e.type, file: e.file })),
  relations: archJson.relations,
  callGraph: callgraph,  // callgraph.ts 产物
};
```

裁剪后预估 ~20k tokens，可纳入 context。**须在冻结前实测 ArchGuard L4 缩域 ArchJSON 的实际 token 数**（使用 tiktoken 或等价工具），并落盘到 `artifacts/levels/L4/token-count.txt`。若实测超过 32k，按模块分块（同 L5 分块策略）并预注册分块规则；须同时说明 S-lm-real 锚点向量的跨块聚合策略（不得与 embed.py 的 6000 字符分块方案隐式混用）。[见 §0 I8]

### 4.2 信息序

去混淆后信息序仍为：`L0 < L1 < L2 < L3 ≡ L4 < L5`（L3/L4 信息等价，格式不同）。

平局规则（预注册）：任何预测器在信息等价的 L3/L4 之间取序号较小者（L3）；P_oracle 在准确率并列时取序号较小者。

---

## 5. 被试系统与泄漏风险处理

### 5.1 被试系统选择

v2.2 使用**双被试设计**：

| 角色 | 系统 | 用途 |
|---|---|---|
| **主实验被试** | 私有库（待定，须满足 §5.2 标准） | Experiment A + B 主数据 |
| **参照被试** | ArchGuard `src/mermaid` + `src/parser`（真名） | Phase 0 传感器标定 + 与 v1 可比性参照 |

ArchGuard 仍作参照的原因：v1 已在此建立基线数据，v2.2 的传感器改进可在此对比效果；同时 ArchGuard 是开源已知系统，存在记忆泄漏风险（§5.3），不适合作主实验被试。

私有库选取标准：
- **首选 TypeScript 项目**（`callgraph.ts` 基于 ts-morph，原生支持；B 类 GT 口径 §6.2 已预注册）；若选 Go 项目，须在冻结前预注册等价的 Go callgraph 工具及 (i)–(iv) 口径，B 类 GT 须独立审查。[见 §0 I9]
- `src/` 规模：50–200 文件（太小锚点不足，太大 L5 context 难控）
- 不在主流 LLM 训练数据中（Github stars < 500 或私有仓）
- 有清晰的模块边界（便于 A 类任务设计）

### 5.2 记忆泄漏风险（ArchGuard 参照被试）

claude-sonnet-4-6（`experiments/granularity/lib/llm-client.ts` 使用的前沿模型）可能在训练数据中见过 ArchGuard 开源仓库。使用真名（去混淆）后，模型可能直接回忆答案而非从表示中推断。

**处理方式**：

1. **强版本泄漏探针（冻结门槛）**：在跑任何架构任务前，向每个被试模型问：
   - 直接问题：「ArchGuard 项目中，`MermaidGenerator` 类的直接调用者（caller）有哪些类或方法？」
   - 若模型答出实际调用者（与 callgraph.ts 产物对比），判为记忆泄漏，ArchGuard **不得**作为任何评分用被试。
   - 判定阈值：~~答案中 ≥50% 的实体与 callgraph.ts 实际边吻合，判泄漏~~ → **已修订**：改为计算模型答案集合与 GT 集合的 F1 ≥ 0.5 判泄漏；问题格式须明确指定答案为「ClassName.methodName」逗号分隔列表。[见 §0 I3]

2. **任务设计防捷径**：A/B/C 三类任务全部设为**定量属性或图关系属性**（而非实体名识别），且答案来自计算而非记忆：
   - 禁止题型：「哪个类叫 Xxx？」（名字即答案）
   - 允许题型：「调用 `MermaidGenerator.generate()` 的方法中，哪一个调用链最长？」（需要推理）
   - 所有题目使用**真名+真文件路径**，但答案是拓扑/数量属性，无法通过记忆标识符直接获得。

3. **私有库作主实验被试**：记忆泄漏风险对私有库为零，主要统计推断基于私有库数据。

**泄漏探针判定标准修订**（见 §0 I3，已在 Plan Stage 67.1 预注册）：探针问题须精确定义答案格式，例如「请列举直接调用 `MermaidGenerator` 类的调用方法（格式：`ClassName.methodName`，逗号分隔）」；判定改为计算模型答案集合与 callgraph.ts GT 集合的 **F1**：F1 ≥ 0.5 判泄漏（阈值已预注册，冻结前不得更改）。

### 5.3 被试材料规模（ArchGuard 参照）

沿用 v2.1 实测数据（真名，不混淆）：

| 模块 | 文件 | 行数 | L5 预估 tokens |
|---|---|---|---|
| `src/mermaid` | 24 | 5,258 | ~45k |
| `src/parser` | 13 | 2,441 | ~20k |

两模块 L5 均独立装进 128k context（v2.1 已实测验证）。

---

## 6. 任务集 v2.2

三类任务，**A 类 ≥25 题，B 类 ≥20 题，C 类 ≥15 题**，共 ≥60 题（两被试合并计数）。

### 6.1 A 类 — 模块边界/耦合（粗任务，≥25 题）

**目的**：检验粗粒度表示（L1/L2）是否足以回答模块级结构问题。

**任务类型**：
- 入度排名：「按被调用包数量降序，前 3 的包是哪些？」
- 循环依赖：「以下包对中哪些形成循环？(列出候选对)」
- 关节点：「移除哪个类会使包图连通分量数增加？」
- 耦合热点：「与 ≥5 个其他类存在 dependency 关系的类有几个？」
- 层间依赖：「[包A] 是否依赖 [包B]？经过哪些中间实体？」

**Ground Truth 来源**：ArchGuard MCP 工具（无需 LLM）：
```bash
# 入度排名
mcp__archguard__archguard_get_package_stats
# 循环依赖
mcp__archguard__archguard_detect_cycles
# 层间依赖
mcp__archguard__archguard_get_dependencies
# 耦合热点
mcp__archguard__archguard_analyze（高耦合过滤）
```

**答案格式**：集合型（F1）或精确匹配（EM）。

**任务实例化约束**：每题覆盖不同实体，避免集中于热点实体（使 d_task 池化样本 ≥20）。

### 6.2 B 类 — 局部行为/变更影响（细任务，≥20 题）

**目的**：检验调用边（L3+）是否显著优于更粗表示。

**任务类型**：
- 直接调用者：「调用 `MethodA.foo()` 的方法有哪些？」
- 传递调用链：「从 `MethodA.foo()` 出发，2 跳内可达哪些方法？」
- 最高被调用：「在 `[模块]` 内，被调用次数最多的方法是哪个？调用次数是多少？」
- 变更影响：「修改 `ClassX.methodY()` 签名，直接受影响的调用方有哪些？」

**Ground Truth 来源**：`callgraph.ts`（ts-morph `findReferences()`，v2.1 §1 R1 (i)–(iv) 口径，已产出 **375 条 call 边**（`kind='call'`），来自 `artifacts/gt/callgraph.json`；可作为 ArchGuard 参照被试的 GT 复用，主实验被试须重新生成真名版本）。[见 §0 I6]

**调用边口径（预注册，沿用 v2.1）**：
- (i) 过滤声明自身、import、类型位置；
- (ii) 仅 `CallExpression`/`NewExpression` callee 位置记为调用边；
- (iii) 源端取最近封闭函数/方法声明；
- (iv) 接口分发展开到作用域内全部实现（`viaInterface: true`），主分析使用展开口径。

### 6.3 C 类 — 定向判别任务（≥15 题，v2.2 新增）

**目的**：工程化制造 P_oracle ≠ H0 的判别空间（修复 D2）。

**设计原则**：答案在粗层级（L1/L2）中**存在但被过压缩**——即：
- H0 会选 L1 或 L2（结构上包含相关实体）；
- 但实际上 LLM 在 L1/L2 无法可靠抽取答案，需要 L3 的调用细节才能正确推断；
- P_oracle 因此 = L3，P_oracle ≠ H0。

**任务类型**：

1. **过压缩拓扑推断**：
   - 「`ClassA` → `ClassB` 的依赖是通过哪个**具体方法调用**建立的？」（L2 只有实体级边，无法定位）
   - 「从 `ClassA` 到 `ClassC` 的最短调用路径经过哪些方法？」（需要 L3 的 method 粒度）

2. **细粒度计数/排名**：
   - 「`ClassX` 中，被**其他类**调用次数超过 3 次的 private 方法有几个？」（L2 无 private 成员，L3 有）
   - 「哪个方法是 `src/mermaid` 模块中所有调用链的'汇点'（出度为 0 但入度最高）？」

3. **条件可达性**：
   - 「`MethodA.foo()` 的调用方中，有哪些本身也被 `MethodB.bar()` 直接调用？」（需要双层调用图推理）

**C 类 Ground Truth 计算**：

全自动，基于 `callgraph.ts` 产物 + ArchGuard MCP 工具：

```typescript
// experiments/granularity/gt-c-class.ts（预计新增）
// 例：C1 过压缩拓扑——找 ClassA→ClassB 的具体调用方法
function findConcreteCallEdge(callgraph: CallEdge[], from: string, to: string): string[] {
  return callgraph
    .filter(e => e.callerClass === from && e.calleeClass === to)
    .map(e => e.callerMethod);
}
```

**C 类可推出性矩阵**：`predict.ts` 对每个 (C类任务 × 层级) 机械判定：
- L0/L1：信息不足（无 method 粒度）→ derivability = false
- L2：部分可推（有实体级依赖，无 method 级）→ derivability = "partial"
- L3/L4/L5：可推 → derivability = true

H0 在 L2 partial 条件下的预注册规则：若 partial derivability 层级存在，H0 取该层级（结构上最粗的"有相关信息"层级）。C 类设计确保 L2 的 partial 层级在实测中准确率显著低于 L3，从而制造 P_oracle ≠ H0。

---

## 7. Experiment A：刻画曲线与移峰

**沿用 v2.1 的 A1–A3 假设，配置修正**：

- **A1（干扰）**：至少一类任务上，$\text{acc}(L5)$ 显著低于该类最优中间层级（配对 Wilcoxon，$\alpha = 0.05$，$\Delta F1 \geq 0.1$；配对单元：每道题的 F1 值，以题目为最小单元）。[见 §0 I7]
- **A2（倒 U）**：每类任务准确率峰值不在端点：$\arg\max_\ell \text{acc} \notin \{L0, L5\}$。
- **A3（移峰）**：B/C 类（细任务）最优层级序号 > A 类（粗任务）最优层级序号；bootstrap 95% CI（1000 次，以题目为重采样单元）下界 > 0。

**配置修正（修复 v1 偏离 D3）**：
- k = 5（v1 实际用 k=2，多数票在 k=2 时退化为直接比较）
- 被试模型：`claude-sonnet-4-6`（前沿，主分析）+ `deepseek-v4-flash`（小模型，方差参照）
- 模型参数：claude-sonnet-4-6 temperature=1（API 实测约束）；deepseek-v4-flash temperature=0.2
- 预注册模型回退链：若 `claude-sonnet-4-6` 不可用，回退到 `gpt-4o`；若 `deepseek-v4-flash` 不可用，回退到 `deepseek-chat`（回退须在冻结前锁定）

---

## 8. Experiment B：传感器改进与因子消融

### 8.1 三传感器规格（修复 D1）

v1 仅用 qwen3-embedding:4b（S-lm-obf），全层级维度不分离。v2.2 使用三个传感器，每个传感器独立估计 $d_\ell$，三者同时不分离才构成**强负结果**。

#### S-lm-real：语言模型嵌入（真名）

- **模型**：`qwen3-embedding:4b`（与 v1 相同，作为对照）
- **改变**：去混淆，使用真名（Anthropic、MermaidGenerator 等真实标识符）
- **实现**：`embed.py`（现有，`experiments/granularity/embed.py`），接口不变，输入文本去混淆
- **预期**：真名下，L0（文件名清单）与 L5（有语义的源码）在语义嵌入空间中应可区分，修复 D1 的传感器失明

#### S-code：代码专精嵌入

- **模型**：`nomic-embed-text`（Ollama 可用的代码专精嵌入，经 LiteLLM 网关 `/v1/embeddings`），或回退到 `deepseek-embedding`（若 nomic 不可用）
- **输入**：与 S-lm-real 相同的 $D_\ell(a)$ 文本
- **目的**：验证语言嵌入结果是否对代码文本具有特殊灵敏度；若 S-code 能分离而 S-lm-real 不能，说明 D1 的失明来自嵌入模型选择
- **实现**：新建 `embed_code.py`（复用 `embed.py` 框架，改 MODEL_NAME 参数）

#### S-struct：纯结构图嵌入（LLM-free）

- **目的**：完全绕开 LLM，直接在图结构上估计维度；若 S-struct 能分离，说明信息分层结构本身是可测的，LLM 嵌入只是噪声
- **节点粒度（预注册）**：method 级（与 B 类 ground truth 一致；每个 ArchJSON entity 的每个 method 为一个节点）
- **边类型（预注册）**：
  - `call`：callgraph.ts 产出的 method→method 调用边（**375 条 call 边**，来自 `artifacts/gt/callgraph.json`，`kind='call'` 口径；总边数 376 含 1 条 reference 边，不计入）[见 §0 I6]
  - `inheritance`：ArchJSON `relations` 中 `type='inheritance'`
  - `dependency`：ArchJSON `relations` 中 `type='dependency'`
  - 去重：多条同向边合并为一条（无权重）
- **游走参数（预注册，node2vec）**：
  - `p = 1.0`（回头概率，BFS/DFS 平衡）
  - `q = 1.0`（出边概率，等权）
  - `walk_length = 40`
  - `num_walks = 10`
  - `embedding_dim = 64`（比嵌入层维度低，保持 TwoNN 可靠性）
  - `window = 5`，`workers = 4`，`seed = 59`（与 v1 TwoNN 种子一致）
- **锚点投影**：每个锚点 $a$ 的 S-struct 向量 = 以 $a$ 为根节点的 node2vec 嵌入；锚点不在图中（无调用边）的赋零向量并标记"图外点"，从维度估计中剔除
- **层级变体（预注册，方案 α 已选定）**：节点粒度固定为 method 节点全集，跨层级不变；仅边集随层级变化（方案 β 已排除，理由见 §0 I1）。
  - L0：method 节点全集，**零条边**（孤立图）→ node2vec 游走退化为随机游走，d_L0(S-struct) 无意义；在报告中标注"L0 S-struct 不可估计"，从维度分离判定中排除 L0 这一点
  - L1：method 节点全集 + entity 级 inheritance / dependency 边（ArchJSON `relations` 中 `type` ∈ {inheritance, dependency}）；**扩展规则（已预注册）**：每条 entity-to-entity 关系扩展为两个 entity 的**代表方法节点**（各自第一个 method）之间的边；若 entity 无 method，跳过该边；此规则避免二部图完全连接导致的图过密
  - L2：L1 的边 + entity 级 composition / aggregation 边（ArchJSON `relations` 补充类型）
  - L3/L4：L2 的边 + callgraph.ts 的 `kind='call'` 边（信息等价）
  - L5：同 L3/L4（L5 无额外结构信息，调用边已是最细粒度）
- **实现**：新建 `embed_struct.py`（使用 `node2vec` Python 库；须先将 `node2vec` 添加到 requirements.txt，见 §0 I2）

**Phase 0 门控逻辑**：三个传感器的 d_ℓ 是否随层级分离，用以下规则判定：

### 8.2 Phase 0 门控（v2.2 新增关键步骤）

**在跑任何 LLM 任务之前**，执行传感器标定：

```
Phase 0 执行顺序：
  1. 生成 L0–L5 各层级表示（§4，真名）
  2. 分别跑 S-lm-real、S-code、S-struct 三个传感器，估计每个层级的 d_ℓ
  3. 对每个传感器，检验 d_ℓ 是否随层级分离
  4. 根据 Phase 0 门控规则决定是否继续 B 系列
```

**分离判定标准（预注册）**：对传感器 S，若以下**至少一个**成立，判"S 分离"：
- (a) $d_{L5} - d_{L0} > 2$（绝对差 > 2 维）且两个 CI 不重叠；**S-struct 例外**：L0 不可估计，改用 $d_{L5} - d_{L2} > 2$ 且两个 CI 不重叠；
- (b) Kruskal-Wallis 检验跨 {L0, L2, L3, L5} 四层级的 bootstrap d 分布，p < 0.05；**S-struct 例外**：L0 不可估计，KW 检验跨 {L2, L3, L5} 三层级（此差异须在报告中说明）

**Phase 0 门控规则**：

| 结果 | 决策 |
|---|---|
| ≥2 个传感器分离 | 继续 B 系列（主实验正常执行）|
| 仅 1 个传感器分离 | 继续 B 系列，但仅用分离传感器做 P_GIT 计算；其余传感器作敏感性报告 |
| 0 个传感器分离 | **强负结果停止 B 系列**；报告"在当前被试上，所有传感器均无法检测到跨层级维度变化"；仅报告 Experiment A |

Phase 0 结果必须落盘（`artifacts/embeddings/dim-phase0.json`）并在 Experiment A 开始前打时间戳。

### 8.3 本征维度估计（沿用 v2.1 §8.1）

- **锚点集**：被试系统全部 ArchJSON 实体，K ≥ 50（不足则扩池 `src/analysis`）
- **序列化**：对每个锚点 $a$ 与层级 $\ell$，序列化 $D_\ell(a)$（与 v2.1 §8.1 相同，去混淆版本）
- **估计器**：`skdim.id.TwoNN`（主，`discard_fraction=0.1`）+ `skdim.id.MLE`（副，K_MLE=10）
- **Bootstrap**：1000 次，重采样锚点单元
- **去重规则**：`np.unique(axis=0)` 去重后点数 < 0.8K，该层级判"不可靠"
- **实现**：`experiments/granularity/dimension.py`（现有，无需修改）

### 8.4 预测器与因子消融

**三个预测器（事前）**：

- **H0（结构充分性）**：最优层级 = 包含全部任务相关 ground-truth 实体与边的最粗层级。来自 `predict.ts` 的 derivability 矩阵。
- **P_GIT-sem（语言嵌入维度匹配）**：按 L0→L5 扫描，取第一个满足 $d_\ell^{S-lm-real} \geq d_{\text{task}}$ 的层级。P_GIT-sem 可事前算（仅依赖 S-lm-real 传感器）。
- **P_GIT-struct（结构图嵌入维度匹配，LLM-free）**：同上，但使用 $d_\ell^{S-struct}$。P_GIT-struct 可事前算（仅依赖 S-struct 传感器，完全无 LLM 参与）。

**P_random**：均匀随机选层级（下限对照，种子 59）。

**事后诊断工具（不参与事前冻结）**：

- **P_probe（线性探针，事后）**：在 S-lm-real 嵌入上训练线性探针，预测 P_oracle 标签。P_probe 需要 P_oracle 标签（来自 Experiment A 结束后），**无法事前冻结**，属于方法论上的循环（见 §8.5）。处理方式：P_probe 在报告中明确标注"事后诊断工具"，仅作为 S-lm-real 能否线性分离层级的机制诊断，**不参与 §9 主决策**。

### 8.5 P_probe 的方法论约束（必须在 proposal 中处理）

P_probe 的逻辑循环：

```
P_probe 训练数据 = (嵌入向量, P_oracle 标签)
P_oracle 来自  → Experiment A（跑完 LLM 任务后）
Experiment A 开始前 → P_probe 无法预先冻结
```

**因此**：

1. P_probe **不是**事前预测器，不参与 §9 决策表；
2. P_probe 报告的任何"预测准确率"只能说明"嵌入空间包含与任务最优层级相关的信息"，不能说明"可在不跑 LLM 任务前做出预测"；
3. **主消融对比改为 P_GIT-sem vs P_GIT-struct**：这两个预测器都可事前算，比较它们在 B2 判别子集上的命中率，可以回答"语言嵌入信号 vs 纯图结构信号，哪个对维度预测更有效"。

---

## 9. 预注册预测

**多重比较预注册**（见 §0 I4，已在 Plan Stage 67.4 锁定）：以下 §9 B1–B3 共涉及 **7 个决策相关假设检验**（B1×2, B2×3, B3×2），A 系列另有 3 个（A1×2, A3×1），Phase 0 门控 3 个 KW 检验。**预注册策略（已冻结）：对 §10 决策表直接依赖的 B1/B2/B3 共 7 个检验，采用 Benjamini-Hochberg FDR 控制（q=0.05）；A 系列 3 个检验独立 α=0.05；Phase 0 门控 3 个 KW 检验独立 α=0.05（门控检验不参与 B 系列 FDR 池）。所有原始 p 值须在报告中全部列出。**

### B1（全集预测力）

在全部可推出任务（derivability=true）上，P_GIT-sem 的层级命中率显著高于 P_random（McNemar，$\alpha=0.05$，FDR 池内），且不低于 H0。

副测：P_GIT-struct 在全集上的命中率与 P_GIT-sem 进行比较（McNemar，FDR 池内），报告两者是否有显著差异。

### B2（判别子集，主判据）

在判别子集（$P_{oracle} \neq H0$ 的任务，最小规模 ≥8 题）上：
- B2a：P_GIT-sem 命中率显著高于 H0（McNemar，FDR 池内）
- B2b：P_GIT-struct 命中率显著高于 H0（McNemar，FDR 池内）
- B2c（消融）：P_GIT-sem 与 P_GIT-struct 命中率对比（McNemar，FDR 池内，报告哪个因子信号更强）

判别子集 < 8 时 B2 记"无判定力"，触发 §10 第 5 行。

### B3（梯度一致性）

跨全部（任务类 × 可推出层级）单元，$|d_\ell^{S-lm-real} - d_{\text{task}}|$ 与实测准确率的 Spearman 相关显著为负（FDR 池内）。检验单元：每个 (任务 × 层级) 配对的准确率均值（k=5 多数票后）。

副测：对 S-struct 做相同的 Spearman 相关检验（FDR 池内）。

### B4（格式敏感性）

L3 与 L4 信息等价、格式不同。若 (i) S-lm-real 下 $d_{L3}$ 与 $d_{L4}$ 的 bootstrap CI 不重叠，且 (ii) 在两个被试模型上，$|d_\ell - d_{\text{task}}|$ 较小的层级实测准确率均更高（两模型方向一致），则记"格式敏感性证据成立"。B4 不参与 §10 主决策，作为 H0 原则上不可表达的附加证据单列报告。

---

## 10. 决策表 v2.2（门控 + 归因）

决策表按行序判定，命中即止。**Phase 0 门控（第 1 行）是绝对优先条件，必须在所有 B 系列判断之前执行**：

| # | 条件（按行序判定，命中即止） | 判定 |
|---|---|---|
| 1 | **Phase 0：0 个传感器分离** | 强负结果：传感器条件不满足，B 系列停止；仅报告 Experiment A，结论"当前被试上所有传感器均无法检测到跨层级维度变化"；**不得**作任何 GIT 方向性结论 |
| 2 | 判别子集 < 8，或 K < 50，或多数 d_ℓ 被判不可靠 | Experiment B 无判定力：降级为仅报告 Experiment A，**不得**作任何 GIT 方向性结论 |
| 3 | B2a **且** B2b **且** B3 均成立 | 语言嵌入信号与结构信号均有预测力，且梯度机制成立：GIT 从描述性升级为预测性候选，进入跨仓库复制实验 |
| 4 | B2a 成立，B2b 不成立（或反之） | 只有一种信号有效：语言嵌入 vs 图结构信号归因可分，谨慎接受 B2 成立的那个，补充机制实验 |
| 5 | B2a/B2b 均成立，B3 不成立 | 预测力成立但梯度机制存疑：结论限定为"P_GIT 在 H0 失效处有增益"，优先补充机制实验 |
| 6 | B2a/B2b 均不成立，B1 成立 | P_GIT 与 H0 在判别子集不可区分：维度机器判为**换装的启发式**，工程上保留 H0 |

**门控后不可回溯**：若第 1 行门控触发（0 个传感器分离），不得通过调整传感器参数（游走长度、embedding_dim、分离阈值等）后重试并重新进入 B 系列；任何参数调整均须另起一个独立实验并重新预注册。

---

## 11. 协议纪律与执行顺序

### 11.1 冻结前置条件（全部通过方可冻结）

以下各项与 Plan Phase 67 Stage 的对应关系：条件 1→Stage 67.1，条件 2→Stage 68.2（任务设计阶段），条件 3→Stage 67.4（budget-v2.md 记录），条件 4→Stage 68.3，条件 5→Stage 68.4，条件 6→Stage 67.2，条件 7→Stage 67.3，条件 8→Stage 67.4。

1. **泄漏探针通过（§5.3）**：向 claude-sonnet-4-6 和 deepseek-v4-flash 运行强版本泄漏探针（按 §0 I3 修订后的精确定义，F1 ≥ 0.5 判泄漏），确认两个模型对 ArchGuard 的记忆不超过泄漏阈值；若泄漏，ArchGuard 退出主实验被试（降为参照）。
2. **callgraph.ts 抽查通过**：在主实验被试上运行 `callgraph.ts`，抽查 ≥10 条边人工核实，接口边口径确认（§6.2 (i)–(iv) 四条口径，展开口径为主分析）。此步骤在 B 类任务设计阶段（Plan Stage 68.2）完成。
3. **Phase 0 传感器标定决策落盘**：Phase 0 门控的判定规则（分离阈值、KW 检验 α=0.05、S-struct L0 排除规则）须在 Phase 70 运行前落盘到 `artifacts/budget-v2.md`；实际标定结果（dim-phase0.json）在 Phase 70 才产出。
4. **GT 计算脚本验证**：C 类 GT 计算脚本（`gt-c-class.ts`）在 ArchGuard 上抽查 ≥5 道 C 类题，核实答案正确。C 类 GT 基于 `callgraph.ts` 产物自动计算，MCP 工具（`archguard_get_dependencies` 等）须在执行 `archguard analyze` 后方可调用（即须先在被试系统上运行 `node dist/cli/index.js analyze -f json`，产出被 MCP server 消费的 ArchJSON 数据）。
5. **tasks.json 实例化**：A/B/C 三类任务全部实例化，逐题人检"答案不依赖标识符记忆"。
6. **S-struct 可行性确认**（见 §0 I1, I2）：(a) 方案 α 已选定，L1 扩展规则已预注册（见 §8.1 层级变体和 §12.1）；(b) `node2vec==0.4.6` 已添加到 `requirements.txt`（Plan Stage 67.2）；(c) 在 ArchGuard callgraph（225 节点，375 call 边）上运行 node2vec smoke test 确认可执行，结果落盘 `artifacts/gt/struct-smoketest.md`。
7. **L4 token 数实测**（见 §0 I8）：生成 ArchGuard L4 缩域 ArchJSON，实测 token 数，落盘 `artifacts/levels/L4/token-count.txt`；若超 32k 预注册分块方案（含 S-lm-real 锚点向量的跨块聚合策略）。
8. **预算与 API 配额确认**（见 §0 I5）：与 §12.0 执行预算表对比，确认 API 配额充足，落盘到 `artifacts/budget-v2.md`。同时落盘 **S-code 嵌入模型可用性验证结果**：在 Phase 70 之前须确认 `nomic-embed-text`（或回退链首个可用模型）在 Ollama/LiteLLM 网关上可正常调用，产出测试嵌入并记录实际使用的回退链位置。

### 11.2 执行顺序

```
Step 0：冻结前置（§11.1 全部通过）
    ↓
Step 1：锁定本协议（tasks.json + 全部阈值/平局规则）→ git tag granularity-v2.2-freeze
    ↓
Step 2：校验冻结工件（SHA-256 落盘 frozen-hashes.json）
    ↓
Step 3：生成 L0–L5 各层级表示（真名，§4）
    ↓
Step 4：Phase 0 门控
    4a：S-lm-real、S-code、S-struct 三传感器嵌入
    4b：TwoNN 维度估计（dimension.py）
    4c：门控判定 → 决定是否继续 B 系列
    4d：落盘 dim-phase0.json + 时间戳
    ↓
Step 5：derivability 矩阵 + H0/P_GIT-sem/P_GIT-struct 事前计算（predict.ts）→ 落盘带时间戳
    ↓
Step 6：Experiment A（全层级 × 全任务 × k=5 × 2 模型）
    ↓
Step 7：P_oracle 计算，§9 B1–B4 统计检验，§10 决策表判定
    ↓
Step 8：P_probe 事后诊断（§8.4，可选）
    ↓
Step 9：报告全部结果，含未达预测的
```

**数据流约束**：Step 5 的事前预测输出（含时间戳）必须早于 Step 6 任何 LLM 任务调用；预注册效力以时间戳先后为证据。

---

## 12. 配置参数（修正 v1 偏离）

| 参数 | v1 实际值 | v2.2 预设值 | 修正原因 |
|---|---|---|---|
| k（重复采样） | 2 | 5 | 多数票在 k=2 退化（偏离 D3）|
| A 类任务数 | 3 | ≥25 | 样本不足（偏离 D4）|
| B 类任务数 | 31 | ≥20 | 维持规模 |
| C 类任务数 | 0 | ≥15 | 新增判别空间 |
| 混淆策略 | 全混淆（随机串） | 去混淆（真名） | D1 修复 |
| 传感器数 | 1（qwen3-embedding） | 3（S-lm-real + S-code + S-struct）| D1 修复 |
| L4 | 跳过（424KB > context） | 缩域 ArchJSON（~20k tokens）| 使 B4 可检验 |
| Phase 0 门控 | 无 | 三传感器分离检验 | 新增保障 |
| 主实验被试 | ArchGuard（混淆） | 私有库（主）+ ArchGuard（参照）| 记忆泄漏风险隔离 |

### 12.0 执行预算估算（见 §0 I5）

| 项目 | v1 实际 | v2.2 估算 | 说明 |
|---|---|---|---|
| LLM 嵌入请求（S-lm-real） | 835（L4 跳过） | ~1002（6 层级全跑；可复用 v1 缓存） | SHA-256 命中则零请求 |
| LLM 嵌入请求（S-code） | 0 | ~1002 | 全新，无缓存 |
| 结构嵌入（S-struct, node2vec） | 0 | ~1002 | 纯本地，无 API |
| LLM 任务调用（估算） | 444 | ~1960（derivability 剪枝后）| 上界 3600（全 6 层级）|
| **总 LLM API 调用** | **1279** | **~2962** | **约 2.3× v1；须与 API 配额确认** |

以上数字须在冻结前与 API 配额/预算确认，并落盘到执行计划文件中。

### 12.1 S-struct 预注册配置摘要

```json
{
  "sensor": "S-struct",
  "library": "node2vec",
  "library_version": "0.4.6",
  "node_granularity": "method",
  "node_set": "固定为 ArchJSON entities 的全部 method 节点，跨层级不变（方案α，见 §0 I1）",
  "edge_types": ["call", "inheritance", "dependency"],
  "call_edges_kind_filter": "kind='call'（共 375 条，见 §0 I6）",
  "call_edges_source": "experiments/granularity/callgraph.ts（须对主实验被试重新运行生成真名版本）",
  "structural_edges_source": "ArchJSON.relations",
  "L1_edge_expansion_rule": "entity-to-entity 关系扩展为各 entity 的代表方法节点（第一个 method）之间的边；entity 无 method 则跳过该边（见 §8.1 层级变体）",
  "p": 1.0,
  "q": 1.0,
  "walk_length": 40,
  "num_walks": 10,
  "embedding_dim": 64,
  "window": 5,
  "seed": 59,
  "L0_treatment": "零边图，d_L0(S-struct) 不参与维度分离判定",
  "out_of_graph_treatment": "exclude_from_estimation"
}
```

---

## 13. 产物列表（增量于 v2.1）

```
experiments/granularity/
  # 现有（继承 v2.1）
  callgraph.ts            # ts-morph 调用图（375条 call 边 + 1条 reference 边已产出，见 §0 I6）
  embed.py                # S-lm-real 嵌入（修改：去混淆输入）
  dimension.py            # TwoNN/MLE 估计（不变）
  predict.ts              # derivability 矩阵 + H0 计算（新增 P_GIT-struct 分支）
  run-tasks.ts            # k=5，模型回退链
  score.ts                # F1/EM 自动评分
  analyze.py              # 统计检验（新增 P_GIT-struct 比较、三传感器分离检验）

  # 新增（v2.2）
  embed_code.py           # S-code 嵌入（nomic-embed-text，复用 embed.py 框架）
  embed_struct.py         # S-struct node2vec 图嵌入
  derive-l4.ts            # L4 缩域 ArchJSON 生成
  gt-c-class.ts           # C 类任务 ground truth 自动计算
  tasks/c-class-tasks.json # C 类任务实例

  artifacts/
    embeddings/
      dim-phase0.json     # Phase 0 门控结果（三传感器分离度）
      dim-input.json      # S-lm-real 维度估计结果（已有）
      dim-code.json       # S-code 维度估计结果
      dim-struct.json     # S-struct 维度估计结果
    gt/
      c-class-gt.json     # C 类 ground truth
    predictions/
      predictions-v2.json # H0 + P_GIT-sem + P_GIT-struct（时间戳冻结）
```

---

## 14. 已知风险与开放问题

### R1：私有库选取

私有库必须在冻结前确定并通过 §5.2 标准核查。若无合适私有库，ArchGuard 作主实验被试，但须接受记忆泄漏风险；此时 C 类任务设计需要格外注意任务设计防捷径原则。

### R2：S-code 嵌入模型可用性

`nomic-embed-text` 依赖 Ollama 服务可用性。若不可用，回退到 `mxbai-embed-large`（Ollama 支持），或 `text-embedding-3-small`（OpenAI，经 LiteLLM 网关）。回退链须在冻结前预注册。

### R3：S-struct node2vec 在稀疏图上的可靠性与内存估算

callgraph.ts 产出 **375 条 call 边**（ArchGuard `src/mermaid` + `src/parser` 范围），涉及 225 个唯一 method 节点，平均度 ≈ 375/225×2 ≈ 3.3（有向图出度+入度平均）。[见 §0 I6] 若图过于稀疏（平均出度 < 1），node2vec 游走退化为随机游走，S-struct 可能无法区分任何层级。应对：先在 Phase 0 检验 S-struct 分离度；若不分离，单独报告"图稀疏导致 S-struct 传感器无效"而非判断维度理论失败。注意 L0、L1 在 S-struct 下本身可能无法产生有效维度估计（见 §0 I1），Phase 0 门控判定应基于 L2/L3/L5 的分离度。

**内存估算**：node2vec 的核心内存开销来自游走语料和 word2vec 训练。225 节点 × 10 游走 × 40 步长 = 90,000 步游走语料，每步存 int32 节点 ID，约 360KB；embedding 矩阵 225×64×float32 ≈ 58KB；word2vec 窗口训练额外约 5MB。6 个层级同时保存嵌入矩阵峰值 ≈ 350KB，全程总内存 < 100MB，在普通开发机上无内存风险。主实验私有库若节点数达 ~1000+，内存仍 < 500MB，可接受。

### R4：C 类 GT 的 "present-but-overcompressed" 验证

C 类设计假设 L2 中"存在答案所需实体但信息被过压缩"。需要在任务实例化后逐题人工验证：(a) L2 的 Mermaid 图确实包含相关 entity 节点，(b) 仅凭 L2 信息确实无法确定具体 method-level 答案。此验证是 C 类可推出性矩阵的前提。

### R5：P_probe 的报告边界

若 P_probe 事后诊断显示"嵌入空间能够线性区分层级"，但 P_GIT-sem（事前）命中率低，两者矛盾。报告时须明确：P_probe 使用了 P_oracle 标签（事后），P_GIT-sem 不使用任何 LLM 任务结果（事前）。两者回答的是不同问题，不可互相替代。

### R6：A 类任务的 d_task 样本量

A 类 ≥25 题，但若这 25 题集中在少数热点实体，池化后涉及实体可能 < 20，TwoNN 不可靠（v2.1 §13.8 规则）。任务实例化时主动分散覆盖实体，目标：A 类池化实体 ≥ 25 个。

---

## 15. 诚实边界

1. **d̂ 是消费者相对的**：$\hat{d}$ 由嵌入模型 $\phi$ 定义，对不同嵌入模型可能得到不同结论；三传感器设计是对此的局部响应，不能覆盖所有可能的 $\phi$。

2. **S-struct 的图是静态调用图**：动态调用（回调、事件、运行时多态）不在 `callgraph.ts` 覆盖范围内（v2.1 §13.2）；S-struct 的图嵌入代表静态结构维度，不代表运行时行为维度。

3. **P_GIT-struct 是 GIT 的弱化版本**：GIT 原始主张是信息几何的本征维度；node2vec 在稀疏图上的嵌入维度是图谱的代理指标，不等同于信息论意义的本征维度。若 P_GIT-struct 失败，只能否定"静态调用图维度预测粒度"，不能否定 GIT 的完整主张。

4. **单一被试的泛化限制**：即使在主实验被试上 P_GIT-sem 成立，结论的泛化需要跨多个代码库的复制实验（本 proposal 不包含）。

5. **C 类任务的工程化设计偏倚**：C 类是人工制造 P_oracle ≠ H0 空间的，不代表真实工程任务的自然分布。C 类成立只能说明"在此类任务上维度预测有增益"，不能自动推广到所有架构分析场景。

---

## 附录 A：与 v2.1 的完整对比表

| 方面 | v2.1（已执行） | v2.2（本 proposal）|
|---|---|---|
| 混淆策略 | 全混淆（随机串标识符）| 去混淆（真名）+ 任务设计防捷径 |
| 传感器 | 1 个（qwen3-embedding:4b）| 3 个（S-lm-real + S-code + S-struct）|
| Phase 0 门控 | 无 | 三传感器分离检验，0 个分离则停 B 系列 |
| A 类任务 | 3 题（协议偏离）| ≥25 题 |
| C 类任务 | 无 | ≥15 题（工程化制造判别空间）|
| k | 2（协议偏离）| 5 |
| L4 | 跳过（424KB > context）| 缩域 ArchJSON（~20k tokens）|
| P_probe | 未提及 | 明确为事后诊断，不参与决策表 |
| 主消融 | P_GIT vs H0 | P_GIT-sem vs P_GIT-struct（两个都可事前算）|
| 被试 | ArchGuard（混淆）| 私有库（主）+ ArchGuard（参照）|
| Track B（git 历史）| 隐含在 P_GIT 命名中 | 显式剥离为独立 proposal |
| 决策表 | 5 行（§9）| 6 行（新增 Phase 0 行，§10）|

---

## 附录 B：与 v1 实验结果的连续性

v2.2 设计直接继承 v1 已确认的正面结论：

- **A1 干扰效应**（ΔF1=0.63，p=1.26×10⁻⁶）：B 类任务 L3 显著优于 L5——此结论在 v2.2 中作为**验证目标**（预期在更大样本上复现）。
- **A2 倒 U 曲线**（B 类 argmax=L3，内点）：v2.2 预期 B 类和 C 类均呈现内点峰值。
- **A3 移峰**（argmax 序号差=3，CI 下界>0）：v2.2 的 A 类 ≥25 题提供更强的移峰检验证据。
- **H0 命中率 85.3%**：v2.2 的 C 类任务专门针对 H0 失效区间设计，预期使判别子集扩展到 ≥8 题。

v1 的失败结论：

- **P_GIT 命中率 0%**：诊断为 D1（传感器失明），v2.2 的去混淆 + 三传感器修复此问题；若修复后 P_GIT-sem 仍 0%，则 D1 假说被否定，需要其他解释。
- **判别子集 5 < 8**：诊断为 D2（任务设计未制造分离空间），v2.2 的 C 类任务专门修复。

**数据复用**：v1 的 `callgraph.ts` 产物（**375 条 call 边**，`artifacts/gt/callgraph.json`，注意该文件是真名版本，非混淆版）可作为 ArchGuard 参照被试的 S-struct 边集基础；主实验私有库须重新运行 `callgraph.ts` 生成对应真名版本。[见 §0 I6]
