# 晶体化：LLM 时代软件系统的稳态架构

**Crystallization: The Steady-State Architecture of Software Systems in the LLM Era**

状态：提纲 v4
日期：2026-03-31
目标受众：使用 LLM 工具的软件架构师、LLM 辅助开发工具的构建者

---

## Thesis Statement

> 你的系统一部分是确定性代码，一部分是 prompt 和 agent workflow。这不是"还没来得及统一"的过渡态——**混合共存本身就是稳态**。组件在确定性代码和统计推理之间双向移动，最终形成以确定性实现为骨架、统计推理为填充的晶体化架构。理解这一点，就能回答"这个功能该用 prompt 还是代码实现"这一类日常决策。

---

## 0. 开场：一个每天都在发生的决策

*不做理论辩护。从读者自己的困境开始。*

你正在开发一个新功能。你发现可以用 30 行 prompt 让 LLM 完成，也可以花两天写 300 行确定性代码。你选哪个？

没有框架告诉你怎么选。敏捷说"迭代"，但没说这次迭代该写 prompt 还是写代码。Clean Architecture 假设一切都是代码。LLM 工程文献假设一切都该是 prompt。

实际上，答案取决于这个组件在一条谱系上的位置——从统计推理到确定性代码。而且这个位置不是固定的：同一个组件可能从 prompt 移向代码，也可能从代码退回 prompt。Vercel v0 在同一个系统中同时做了这两件事——LLM 负责创造性生成，确定性 AST 修复负责处理可预测的错误模式。

这篇文章解释为什么，并回答你开头的那个问题。

---

## I. 核心主张：晶体化

*全文的中心论点。在这里完整展开，后续所有章节服务于这一节。*

### 1.1 不是替代，是共晶

- Karpathy 的 "Software 2.0" 暗示了一个从确定性代码到神经网络的**替代**方向。九年后我们看到的不是替代，而是**分化**——同一系统中，部分组件向确定端移动，部分向统计端移动
- Tesla FSD 是 Karpathy 自己的案例：v12 用端到端神经网络替换了 30 万行 C++ 规划代码（softening），但油门/刹车/转向的执行层仍是确定性控制回路（skeleton）。替代发生在感知和决策层，而非整个系统
- **晶体化**：系统演化为以确定性实现为骨架、统计推理为填充的混合架构
- 关键断言——**这不是过渡态，混合共存本身就是稳态**。不需要被"解决"为纯代码或纯 prompt
- 这命名了一种已经广泛存在但尚未被显式认知的架构形态

### 1.2 谱系：从 prompt 到编译型代码

- 系统中的每个组件都处于一条连续谱系上——

  `LLM/prompt ⇄ 结构化 workflow ⇄ 规则引擎/DSL ⇄ 编译型代码`

- 关键词是 **⇄**（双向箭头）。组件可以向确定端移动（hardening），也可以向统计端回退（softening）
- 移动方向的依据：该组件当前行为的确定性程度、稳定性要求、变更频率
- 同一系统中不同组件可以处于不同位置

### 1.3 两个方向的权衡

| 维度 | 统计端（prompt/agent） | 确定端（编译型代码） |
|------|----------------------|-------------------|
| 编写成本 | 低（自然语言描述） | 高（完整实现） |
| 运行时信息传输 | 高（每次需传上下文） | 低（已编译） |
| 行为方差 | 高 | 极低 |
| 灵活性 | 极高 | 低 |
| 变更成本 | 极低 | 高 |

### 1.4 晶体化的案例群

*用数量制造模式识别，而非单案例深挖。每个案例 2-3 句话，技术细节见附录 C。*

**Hardening（从统计到确定）：**

- **[Vercel v0]** LLM 生成代码的错误率约 10%。团队没有重新调用 LLM（慢且非确定性），而是构建了确定性 AST 解析 + 正则修复管线，耗时 <250ms，"double-digit increase in success rates"。可预测的错误模式被固化为确定性代码，LLM 继续负责创造性生成
  - 来源：Vercel Engineering Blog, "How we made v0 an effective coding agent"

- **[LLMOps 生产趋势]** ZenML 对 1200+ 生产部署的调查显示主导模式：安全逻辑从 prompt 中迁出，固化为确定性基础设施——guardrails、校验层、规则引擎约束 LLM 行为。初始 softening 之后是系统性 hardening
  - 来源：ZenML, "What 1,200 Production Deployments Reveal About LLMOps in 2025"

- **[案例 B]** Go Atlas behavior-analyzer：用"可恢复性真值表"量化每种行为的确定性程度（Package imports: 100%, Channel edges: <20%），只固化确定性足够高的行为。结果：4 个 graph builder，~100 个测试守护，行为方差归零。*Channel 通信未固化——诚实承认静态分析的极限*
  - 来源：commit `9897d3a`, proposal `docs/archive/refactoring/proposals/16-go-architecture-atlas.md`

- **Mermaid LLM grouping**：~2000 行 LLM 集成代码被删除，改为纯启发式分组——因为 LLM 分组"proved unreliable and slow"。行为已确定、稳定性要求高 → 向确定端移动
  - 来源：commit `d09d40f` (2026-01-28)

**Softening（从确定到统计）：**

- **[Tesla FSD v12]** 约 30 万行 C++ 手写规划代码被端到端神经网络替换。传统模块化管线（感知→规划→执行的独立确定性模块）无法处理驾驶场景的长尾复杂性。训练消耗 7 万 GPU-hours/周期，1.5PB+ 数据
  - 来源：Tesla AI Day 2023; ThinkAutonomous, "Tesla End-to-End Deep Learning"

- **[Google Search]** 从 PageRank（确定性链接分析）到 RankBrain（2015, 15% 查询）→ BERT（2019）→ AI-first 排名。手写排名信号逐步被学习到的表征替代，但 PageRank 的链接分析仍在确定性层运行
  - 来源：Search Engine Land, "How Google Search uses AI"

- **[案例 E]** Project Semantics Explorer：项目约定检测最初用硬编码默认值。跨项目验证暴露了规则无法覆盖的差异——ADR-008 记录"硬编码规则无法处理项目特定约定"。于是引入 Claude CLI 调用进行语义探索。问题域模糊 → 向统计端回退
  - 来源：`src/analysis/project-semantics-explorer.ts`, ADR-008, Plan 51

- *注：Mermaid grouping hardening 和 Project Semantics softening 发生在同一项目。同一系统、两个组件、相反方向——恰好证明双向移动和晶体化共存*

**晶体化稳态（混合共存即设计意图）：**

- **[Stripe Radar]** ML 模型对每笔支付评分（数百个网络信号），商户同时编写确定性规则（黑名单、金额阈值、频率检查）叠加在上层。两层是协同设计的，不是过渡态。之后又增加了 Payments Foundation Model，确定性规则层仍保留。结果：平均 38% 欺诈减少
  - 来源：Stripe Engineering, "How we built it: Stripe Radar"

- **[Cloudflare WAF]** 双层防御：Managed Rules（人工维护的确定性签名规则集）+ WAF Attack Score（ML 模型对所有流量评分，检测规则尚未覆盖的新型攻击）。ML 层的明确定位是"complement the WAF and detect attack bypasses"——两层互补，不互替
  - 来源：Cloudflare Blog, "Improving the WAF with Machine Learning"

- **[案例 F-1]** ArchGuard 自身的晶体化结构：确定性骨架（5 种语言插件、Mermaid 生成器、Git 历史分析、测试分析、查询引擎，3254+ 测试守护）+ 统计填充（Project Semantics Explorer、15+ MCP Tools 接口）。骨架与填充通过 JSON 类型 + 三层 merge 解耦
  - 演化证据：LLM grouping 曾是填充，被 hardened 为规则；Project Semantics 曾是骨架，被 softened 为 LLM 探索。系统整体保持晶体化稳态，内部组件在谱系上持续移动

### 1.5 相变：从一个稳态到另一个稳态

- 当多个组件同时面临 softening 压力时，骨架开始溶解——不再是逐个组件的决策，而是系统级的相变信号
- 渐进策略：保持骨架，逐个替换填充；整体迁移：承认旧骨架不再适用，重建新骨架
- 晶体化是稳态；相变是稳态之间的跃迁。触发条件是外部驱动（问题域整体变化、新技术范式），而非内部渐进演化
- **[Tesla FSD v12]**：从 HydraNet（48 个神经网络 + 确定性 C++ 规划）到端到端模型，是一次系统级相变——多个组件的 softening 压力同时达到临界点，旧的模块化骨架被整体替换。但执行层的确定性骨架保留了下来，新的稳态仍是晶体化的
- *注：Tesla 是目前已知最大规模的相变案例。多数系统的演化是组件级的渐进移动，而非系统级相变*

---

## II. 为什么有效：搜索与压缩

*解释晶体化为什么有效的底层机制。服务于 §I，不是独立论点。精简呈现，重点在可操作的洞察。*

### 2.1 开发即搜索

- 所有能通过测试、满足类型检查、符合业务规则的实现，构成一个可行解空间。开发 = 在这个空间中找到一个点；重构 = 在功能等价的前提下移动到一个更好的点
- 人类搜索带宽低但方向感强；LLM 搜索带宽高但容易漂移出可行解空间（"幻觉"）
- 晶体化的价值：确定性骨架锁定搜索空间的边界，统计填充在边界内高效探索。这解释了为什么 Stripe Radar 的确定性规则层不是冗余——它约束了 ML 模型的搜索范围
- NVIDIA NeMo Guardrails 将这个模式显式化：确定性 DSL（Colang）定义对话边界，LLM 在边界内自由推理。骨架不参与推理，只约束搜索空间
  - 来源：NVIDIA, NeMo Guardrails (arXiv:2310.10501)

### 2.2 压缩即理解

- 好的抽象 = 捕获真实的共享结构，使认知负荷减少。过度抽象 = 抽象本身的复杂度超过它消除的重复，认知负荷反增
- LLM 消费的是**可理解性压缩**的产物，不是执行效率压缩的产物。架构图有用，minified 代码没用
- **认知负荷的代理观测**（不是精确数值，是可比较的序关系）：向新人/新 LLM 解释系统需要多少概念；添加一个功能需要触碰多少文件；移除一个组件后有多少其他组件需要修改
- **[案例 A]**：DiagramProcessor 被触碰 34 次 commit，承担 6 种混合职责，变更风险评分 0.78（CRITICAL，由 ArchGuard 的 `computeRiskFactors()` 加权计算：churn 0.25 + authorCount 0.2 + ownerConcentration 0.2 + cochangeBreadth 0.15 + recency 0.2）——每一个数字都是认知负荷过高的信号。把架构图喂给 Claude Code 后，它按耦合度从低到高提取了 4 个模块（492→291 行）。架构图是损失性压缩，但它缩小了搜索范围，提升了决策质量
  - 来源：commits `99f71d3`→`429159d`→`bf6c2c6`，技术细节见附录 C

---

## III. 操作判据：何时向哪个方向移动

*从概念到可执行的 if-then 规则。*

### 3.1 Hardening / Softening 决策

```
向确定端移动（hardening）的条件:
  - 行为模式已被充分测试验证
  - 稳定性/可审计性要求高
  - 行为变更频率低

向统计端回退（softening）的条件:
  - 问题域变得更模糊或输入分布漂移
  - 统计方法在准确性/灵活性上显著优于规则
  - 规则的边界情况数量持续增长

反模式:
  - 过早 hardening：行为尚未稳定就固化 → 频繁重写
  - 拒绝 hardening：行为已确定仍用 LLM → 浪费算力 + 引入不确定性
  - 拒绝 softening：问题域已变，坚持用越来越复杂的规则 → 脆性系统
```

### 3.2 扩张与收缩的交替

- 扩张：吸收新需求、探索新方案、增加代码量
- 收缩：重构、提取共享结构、加固约束
- 健康的开发 = 有意识地交替两个相位，在多个时间尺度上（TDD 的 Red-Green-Refactor → PR 内的功能+清理 → 版本的功能扩张+架构收缩）

### 3.3 收缩信号（何时从扩张切换到收缩）

```
IF 添加新功能需要触碰的文件数显著高于近期均值
   → 模块边界可能已腐化，建议先重构
   （ArchGuard 的 cochangeBreadth 度量可检测此信号：
     cochangeBreadth = min(topCochangeNeighbors.length / 10, 1)；
     DiagramProcessor 的 cochangeBreadth 反映了 6+ 文件共变）

IF 测试失败从随机分布变为集群分布（多个失败集中在同一模块）
   → 结构性问题浮现，建议收缩

IF 同一模式在多处重复出现
   → 提取共享抽象的时机

IF 新加入者（人或 LLM）理解模块 X 需要大量前置概念
   → 认知负荷过高，需要压缩
   （代理指标：该模块的混合职责数。DiagramProcessor 承担 6 种职责
     是触发重构的直接信号）
```

- **[案例 H 侧面]**：test analysis 初始实现后 orphan 测试率 94%——集群性质量信号在功能扩张期间强制触发收缩。经四轮跨语言验证修复，orphan 率 94%→9.5%
  - 来源：Plans 40-49 commits (2026-03-13)

### 3.4 扩张信号（何时从收缩切换到扩张）

```
IF 继续重构的变更影响范围持续缩小
   → 重构收益饱和，停止

IF 外部需求队列非空且优先级高于内部压缩
   → 切换到扩张（资源约束优先于信息论判据）

IF 新增规则/测试的边际发现率趋近于零
   → 可行解空间边界已充分定义，停止加固
```

- **[案例 H 侧面]**：修复完成后，剩余 orphan 为合法边界情况（无 struct 实体的纯函数包）——新增规则的边际发现率趋近于零。切换回扩张：C++ 支持、渲染性能优化继续推进

### 3.5 LLM agent 的操作协议

*这是本文与纯方法论文档的核心差异化。*

- LLM agent 自身处于谱系的统计端。它的输出天然有行为方差
- 架构上下文的作用：缩小 agent 的搜索空间，提供可行解空间的边界信息
- agent 在扩张模式下应被允许做什么：生成新代码、探索方案、增加文件
- agent 在收缩模式下应被限制什么：不应引入新抽象层，应优先重用已有结构
- agent 如何判断自己的输出应该被 hardened：如果同一个 prompt 模式被反复使用且结果稳定 → 固化为确定性代码
- **[Vercel v0 的 autofixer]** 正是这个模式的工业实践：v0 团队观察到 LLM 反复产生相同类型的错误（utility 函数未包装、package.json 未更新），这些错误模式稳定且可预测 → 固化为确定性 AST 修复。Agent 的可预测失败模式是 hardening 的天然候选
- **[案例 G]**：*A/B/C 实验（`docs/experiments/git-methodology-ab-test.md`）已设计未执行。案例 A 提供了间接证据（架构图缩小了 Claude Code 的搜索范围，提升了重构决策质量），但尚缺直接的控制实验*

### 3.6 渐进建设：从零到晶体化

- 从零建立任何工程能力的渐进路径——这个过程本身就是沿谱系的 hardening：
  1. **无形式化能力**：所有判断依赖人工/LLM 临时审查
  2. **低精度初始覆盖**：利用 LLM 或启发式规则提供粗粒度反馈（"有比没有好"）
  3. **高频判断固化**：将反复验证的判断固化为确定性实现
  4. **持续平衡**：确定性实现覆盖高敏感区，LLM/人工审查覆盖长尾。实际系统在阶段 3 和 4 之间振荡
- 反馈驱动这个过程：测试投资优先指向**高敏感区**（变更频率高 × 耦合度高 × 修改后果大）；同一信息，获取越早价值越高
- **[案例 H 完整时间线]**：test analysis 渐进建设全过程
  - **阶段 1→2**（Plan 09）：同日设计 + 实现 5 语言插件。初始 orphan 测试率 94%（几乎全是误报）
  - **阶段 2→3**（外部项目验证驱动的规则精化）：Go 验证 orphan 95→3；Python 验证 zero_assertion 16→2；C++ 验证 zero_assertion 23→11；TS 精度修复
  - **阶段 3→4**（平衡态）：总测试 2787→3141，orphan 率 94%→9.5%。剩余 orphan 为合法边界——确定性规则覆盖高敏感区，长尾由人工判断覆盖
  - 来源：Plan 09 → Plans 40-49，技术细节见附录 C

---

## IV. 与现有思想的关系

*不做礼貌映射。只回答：用了晶体化视角，哪些决策会做出不同的选择？*

### 4.1 vs. Software 2.0

- Karpathy 预言了替代；实际发生的是共晶。晶体化是对 Software 2.0 的修正：不是 1.0 被 2.0 取代，而是两者在同一系统中找到各自的位置
- Software 2.0 的分析单位是"领域"（视觉被替代、语音被替代……）。晶体化的分析单位是**组件**——同一领域、同一系统内的不同组件可以处于谱系的不同位置
- Tesla FSD 的演化恰好提供了双面证据：v12 确实替换了 30 万行 C++ 规划代码（Karpathy 的预言部分成立），但执行层和安全约束层仍是确定性代码（晶体化的修正成立）。替代和共存同时发生在同一系统的不同层

### 4.2 vs. 敏捷/XP

- 敏捷说"迭代"，但没给出"这次迭代应该扩张还是收缩"的判据
- 晶体化视角的增量：§3.3/§3.4 的信号检测给出了相位切换的具体条件
- **实际决策案例**：test analysis 94% orphan 率的修复发生在功能扩张期间。敏捷框架下，这是一个可排优先级的 tech debt item。晶体化框架下，集群性质量信号是硬约束——修复被优先执行，之后才继续扩张
  - 来源：Plans 40-49 commits (2026-03-13)

### 4.3 vs. Wardley Maps

- Wardley Maps 的演化轴（Genesis → Commodity）描述市场成熟度，**单向**移动
- 谱系描述实现机制的确定性，**双向**移动
- 互补：Wardley 告诉你"build vs. buy"；晶体化告诉你"规则 vs. 模型"
- **实际决策案例**：Stripe Radar 在 Wardley 视角下，欺诈检测已从 Genesis 演化到 Custom-Built 阶段。但在晶体化视角下，Stripe 选择了双层架构（ML + 确定性规则），而非纯 ML 替代。Wardley 解释了"为什么 Stripe 自建而非外购"，晶体化解释了"为什么自建的系统是混合的而非纯 ML 的"

### 4.4 vs. LLM 工程（Context Engineering / Agent 框架）

- Context Engineering 关注"如何让 LLM 更好地理解系统"。晶体化的增量：将"代码系统"和"模型系统"统一为同一维度上的不同位置，而非需要不同工具链管理的两类对象
- **实际决策案例**：ArchGuard 对两个组件做出了相反的"prompt vs. code"决策——Mermaid grouping 从 LLM 移向规则（"unreliable and slow"），Project Semantics 从硬编码移向 LLM（"硬编码规则无法处理项目特定约定"）。传统框架缺少统一判据解释为什么两个相反决策都是对的；谱系模型可以
  - 来源：commit `d09d40f` + ADR-008 + Plan 51

---

## V. 回到开场：你该选 prompt 还是代码？

*回答 §0 的问题，完成叙事闭环。*

回到你开头的那个决策——30 行 prompt 还是 300 行代码？

答案不是"看情况"。答案是一组具体的判据：

1. **这个行为的确定性程度有多高？** 如果你能写出覆盖 >90% 场景的规则（如案例 B 的可恢复性真值表），hardening 是对的。如果边界情况持续增长（如案例 E 的项目约定检测），softening 是对的
2. **失败的后果是什么？** Stripe 在欺诈检测上选择了双层——因为任何单层的误判成本都太高。如果你的功能失败后果低，从 prompt 开始；后果高，先建骨架
3. **这个决策是永久的吗？** 不是。Vercel v0 从 LLM 开始，观察到可预测的错误模式后 hardened。你的 prompt 今天是对的，不意味着六个月后还是对的。反之亦然

你不需要第一次就做对。你需要的是：识别组件在谱系上的当前位置，以及它正在向哪个方向移动。

---

## VI. 工具需求与未来方向

| 能力 | 描述 | ArchGuard 现状 | 方向 |
|------|------|---------------|------|
| 架构压缩 | 源代码 → 结构化中间表示 → 多粒度投影 | **已实现**：ArchJSON + 3 层 Mermaid | 已验证——5 语言、3254+ 测试 |
| 架构度量 | 循环依赖、变更扇出、高敏感区定位 | **部分实现**：循环检测、test coverage heatmap、变更风险评分 | 缺 git churn × 耦合度的自动化趋势追踪 |
| 上下文生成 | 为 LLM agent 生成可消费的架构摘要 | **部分实现**：15+ MCP tools | 缺变更风险评估——"这次修改会影响哪些模块？" |
| 谱系可视化 | 标注组件在谱系上的位置 | **未实现** | 团队能直观看到哪些组件该被 hardened、哪些该 softened |
| 信号检测 | 自动检测 §3.3/§3.4 的扩张/收缩信号 | **未实现** | CI 管线在变更扇出突增时自动触发收缩提醒 |

---

## VII. 限制与诚实声明

### 7.1 本文不是什么

- 不是可量化验证的科学理论——Kolmogorov 复杂度不可计算，Fisher 信息在离散程序空间上缺乏严格定义
- 不提供精确的数值阈值——§3 的信号是方向性判据，不是经验定律
- 不替代资源规划——"应该重构"不等于"现在就重构"
- 不替代领域专家的判断

### 7.2 失败模式

- 以"扩张阶段"为借口拒绝所有重构——收缩信号是硬约束，不是建议
- 以"压缩"合理化过度抽象——为不存在的共享结构创造抽象会增加认知负荷
- 用术语包装常识——如果晶体化框架没有改变你的任何决策，它就是装饰
- 忽视成本约束——信息论判据和资源约束是两个独立维度，都需要满足

### 7.3 未验证的概念

- Softening：已有内部实例（案例 E）+ 外部案例（Tesla FSD、Google Search），但缺乏受控实验
- 系统级相变：Tesla FSD v12 是目前已知最佳案例，但作者无第一手数据
- §3 的操作判据：基于 ArchGuard 单项目经验 + 行业观察，未经跨项目统计验证
- A/B/C 实验（架构上下文对 LLM 决策质量的影响）：已设计，尚未执行

### 7.4 系统边界

- 以共享部署单元或共享测试套件的范围为分析边界
- 跨边界按接口契约处理
- 边界选择本身是架构决策，没有完美答案

---

## 附录

### 附录 A：术语表

| 术语 | 含义 | 等价的日常语言 |
|------|------|---------------|
| 谱系 | 从 LLM/prompt 到编译型代码的实现确定性连续体 | "从 prompt 到硬编码的光谱" |
| Hardening | 将行为从谱系统计端推向确定端 | "把反复验证的做法固化为代码" |
| Softening | 将实现从确定端回退到统计端 | "承认规则不够用，换回 LLM" |
| 晶体化 | 系统级稳态：确定性骨架 + 统计推理填充 | "系统一半是代码一半是 prompt，这是终态不是过渡态" |

### 附录 B：理论文献索引

*标注为"历史探索，非方法论规范"。索引保持不变。*

### 附录 C：案例技术细节

*正文中案例的完整技术数据集中于此。*

| 标记 | 主题 | 关键来源 | 证据类型 | 正文使用位置 |
|------|------|---------|---------|-------------|
| Vercel v0 | 确定性 AST autofixer 管线 | Vercel Engineering Blog | **外部公开** | §0 + §1.4 + §3.5 |
| ZenML 调查 | 1200+ LLM 生产部署的 hardening 趋势 | ZenML Blog | **外部公开** | §1.4 |
| Tesla FSD | HydraNet → v12 端到端：系统级相变 | Tesla AI Day, ThinkAutonomous | **外部公开** | §1.1 + §1.4 + §1.5 + §4.1 |
| Google Search | PageRank → RankBrain → BERT → AI-first | Search Engine Land | **外部公开** | §1.4 |
| Stripe Radar | ML 评分 + 确定性规则双层架构 | Stripe Engineering | **外部公开** | §1.4 + §2.1 + §4.3 |
| Cloudflare WAF | ML Attack Score + Managed Rules 双层防御 | Cloudflare Blog | **外部公开** | §1.4 |
| NeMo Guardrails | 确定性 DSL 约束 LLM 推理边界 | NVIDIA, arXiv:2310.10501 | **外部公开** | §2.1 |
| 案例 A | DiagramProcessor 分解闭环 | commits `99f71d3`→`bf6c2c6` | **内部强** | §2.2 |
| 案例 B | Go Atlas behavior-analyzer hardening | commit `9897d3a`, Plan 16 proposal | **内部强** | §1.4 |
| 案例 C | test-issue-detector Pattern-First 设计 | commits `68910ef`+`2395239`, Plan 09 | **内部强** | §1.4（附录） |
| 案例 E | Project Semantics softening + Mermaid hardening | ADR-008, commit `d09d40f` | **内部强** | §1.4 + §4.4 |
| 案例 F-1 | ArchGuard 晶体化结构 + 演化证据 | 代码库现状 | **内部强** | §1.4 |
| 案例 G | LLM 有/无架构上下文的决策对比 | `docs/experiments/git-methodology-ab-test.md` | **弱**（未执行） | §3.5 |
| 案例 H | test analysis 渐进建设 4 阶段 | Plan 09 → Plans 40-49 | **内部强** | §3.3 + §3.4 + §3.6 + §4.2 |

**案例 A 技术细节**：
- DiagramProcessor 被触碰 34 次 commit，与 6+ 高 churn 文件共变，承担 6 种混合职责
- ArchGuard 变更风险评分：0.78（CRITICAL）。评分公式：churn(0.25) + authorCount(0.2) + ownerConcentration(0.2) + cochangeBreadth(0.15) + recency(0.2)，由 `src/cli/git-history/history-aggregator.ts` 的 `computeRiskFactors()` 计算
- 执行：基于耦合分析确定提取顺序（零依赖→纯函数→有状态→最高耦合），492→291 行，4 个新模块
- 验证：FIM 实验确认文件级 κ 改善（329.69→327.64），Mantel r=0.773 p=0.011
- 来源：proposal commit `99f71d3`，实现 commit `429159d`，验证 commit `bf6c2c6` (2026-03-13 ~ 2026-03-30)

**案例 B 技术细节**：
- Proposal 中的"可恢复性真值表"：Package imports: 100%, Interface usage: ~85%, Goroutine spawn: ~70%, HTTP entry: ~70%, Channel edges: <20%
- 固化结果：PackageGraphBuilder、CapabilityGraphBuilder、GoroutineTopologyBuilder、FlowGraphBuilder，纯 tree-sitter AST 分析
- hardening 后特征：行为方差=零，执行时间=毫秒级，无 API 依赖，7 轮 TDD 迭代精化规则
- 来源：Plan 16 proposal，实现 commit `9897d3a` (2026-02-24)，质量改进 commit `fbbfdcd` (2026-02-25)

**案例 C 技术细节**：
- 4 条确定性规则：zero_assertion（testCaseCount>0 且 assertionCount=0）、orphan_test（无覆盖链接）、skip_accumulation（skipCount/testCaseCount>0.2）、assertion_poverty（assertionDensity<1）
- 架构决策：Method C（两阶段协作）——插件提供原始测试结构（AST 解析），TestAnalyzer 做跨文件聚合（确定性模式匹配），明确拒绝了"插件内全包"和"独立 AST 重解析"两个替代方案
- 来源：Plan 09 `docs/plans/plan-09-test-analysis.md`，commits `68910ef` + `2395239` (2026-03-11)

**案例 E 技术细节**：
- Softening 过程：项目约定检测（非生产目录、barrel files、自定义断言模式、架构层识别）最初用硬编码默认值。跨项目验证（meta-cc、lmdeploy、llama.cpp）暴露规则无法覆盖的项目差异
- Softening 后的架构：三层 merge（用户配置 > LLM 结果 > 硬编码默认），结果通过 `.archguard/project-semantics.json` 缓存（目录树 hash 失效）
- 对称 hardening：Mermaid LLM grouping（commit `d09d40f`, 2026-01-28）~2000 行 LLM 集成代码被删除
- 来源：`src/analysis/project-semantics-explorer.ts` (168 行), ADR-008, Plan 51

**案例 H 技术细节**：
- 阶段 2→3 度量变化：
  - Go (meta-cc): orphan_test 95→3, entityCoverageRatio 0%→100%。固化：Go 模块名导入过滤、目录匹配层、覆盖图感知的 orphan 检测
  - Python (lmdeploy): zero_assertion 16→2, unit 26→40。固化：`.assert` 断言模式、`totalPackageCount` 字段
  - C++ (llama.cpp): zero_assertion 23→11, entityCoverageRatio 0→6.2%。固化：`assert_\w+` 自定义断言框架模式、C++ 路径约定
  - TS 精度修复 (commit `dbef2af`)：断言窗口从 20 行前瞻改为大括号深度追踪、@/ 别名解析
- 来源：Plan 09 commit `68910ef`，多语言 commits `2395239`/`b2f742e`/`c5d35e2`/`f1290ec` (2026-03-11)，精度修复 Plans 40-49 commits (2026-03-13)

### 附录 D：A/B/C 实验设计

- 已设计：`docs/experiments/git-methodology-ab-test.md`
- 三组盲评对比架构上下文框架 vs. 简单规则 vs. 无框架基线
- 尚未执行。执行后结果将补充案例 G

---

## 写作备忘

### v3→v4 关键变更

1. **外部案例群**：新增 7 个外部可验证案例（Vercel v0、ZenML 调查、Tesla FSD、Google Search、Stripe Radar、Cloudflare WAF、NeMo Guardrails），分布在 hardening×2 + softening×2 + 稳态×2 + 搜索约束×1。内部案例保留但不再独撑论点
2. **术语摩擦降低**："支柱化"→"hardening"，"反向支柱化"→"softening"，"收敛谱系"→"谱系"。Hardening/softening 在工程语境中接近自解释，无需术语表即可理解。保留"晶体化"作为核心隐喻
3. **§II 压缩**：删除搜索空间类比的展开论述，保留"开发即搜索"和"压缩即理解"的核心洞察 + 可操作的认知负荷代理观测。增加 NeMo Guardrails 作为"搜索空间约束"的外部例证
4. **叙事闭环**：新增 §V 回答开场问题，给出 3 条具体判据。读者从 §0 带着问题进来，在 §V 带着答案离开
5. **阈值去数字化**：§3.3/§3.4 的硬编码数字（"2x"、"3 处以上"、"5 个概念"、"< 2 个文件"）改为方向性描述。有 ArchGuard 度量支撑的信号（cochangeBreadth、混合职责数）标注了数据来源
6. **§1.5 相变有案例了**：Tesla FSD v12 从 HydraNet 到端到端模型是目前已知最佳的系统级相变案例
7. **§4.3 Wardley Maps 有案例了**：用 Stripe Radar 说明 Wardley 和晶体化视角的互补性
8. **§6.3 更新**：softening 不再是"1 个内部实例"，有 Tesla + Google 外部案例支撑

### 质量检查清单

- [ ] 30 秒内可回答"所以你在主张什么"——晶体化：混合共存是稳态
- [ ] 术语表 ≤ 4 个术语，其中 hardening/softening 接近自解释
- [ ] 正文案例均 ≤ 3 句话，技术细节在附录
- [ ] 每个抽象声明后 2 段内出现具体案例——已补充：§1.5（Tesla 相变）、§3.5（Vercel autofixer）、§4.3（Stripe Radar）
- [ ] §IV 每个方法论对比包含实际决策案例——全部完成
- [ ] 外部案例 ≥ 内部案例——7 外部 vs 5 内部（A/B/C/E/F-1/H）
- [ ] §V 回答了 §0 的问题——叙事闭环完成
- [ ] §VII.3 诚实列出所有未经验证的概念——已更新
- [ ] 案例 G 仍为待执行状态——诚实标注
