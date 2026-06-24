# Proposal: 可测本征维度能否预测最优表示粒度 — 预注册实验协议 v2.1(ArchGuard 适配版)

**判别 GIT 是"可预测理论"还是"穿了流形外衣的启发式"**

- 被试系统:ArchGuard(自分析)
- 状态:预注册草案 v2.1 — 所有预测、端点、决策规则须在跑任何 LLM 任务**之前**锁定(git tag)
- v1 → v2 修订原因:v1 协议与 ArchGuard 实际实现核对后发现三处实质冲突(见 §1),其中一处会使 B 类任务整类失效。v2 在冻结前修复这三处。
- v2 → v2.1 修订原因(架构师审查,见 §14):审查发现 **v1 文档不在仓库、也不在 git 历史中**,v2 中全部"沿用 v1 原文"的引用是悬空引用,协议在该状态下不可冻结。v2.1 将 A1–A3、B1–B3、§9 决策表、§12 排除清单**内联为自包含文本**(标注为 v2.1 重建条款),并修复审查发现的其余一致性/可行性问题。**v2.1 未改动任何已实测确认的外部服务结论(§6、§8.1、§10、§13.5、§13.6),也未改动 R1–R3 代码事实。**

---

## 1. v1 → v2 修订摘要(代码核对结论)

实验开始前对仓库做了三项事实核对,结果直接改变协议内容:

### R1(致命修复):ArchGuard 不产出 method 级调用边,B 类任务在 v1 下没有 ground truth

- `src/parser/relation-extractor.ts` 提取的全部关系是**实体级**(class/interface 之间的 inheritance / implementation / composition / dependency / aggregation)。
- `src/parser/archjson-aggregator.ts:33` 中 `case 'method': return archJSON;` —— 所谓"method 级"只是**保留全部成员签名(含 private)的类图**,不是调用图。
- 后果:v1 的 B 类任务("哪些函数调用进 X""哪个方法被最多其他方法调用")在 L1–L4 任何层级都推不出答案,且 ArchGuard 自身工具给不出金标准。B 类 argmax 将平凡地等于 L5,A3 移峰检验退化。

**修复**:新增实验侧脚本 `callgraph.ts`,基于 ts-morph `findReferences()` 在作用域模块内构建 method→method 调用边。该产物同时用于:
1. B 类任务的 ground truth;
2. 注入 L3 / L4 表示(见 §4 阶梯 v2),使 L3 在信息上严格细于 L2。

**调用边判定口径(v2.1 细化,预注册)**:`findReferences()` 返回的是**引用**而非调用——其结果包含声明自身、import 语句、纯类型位置、以及未发起调用的成员访问(如把方法作为回调传递)。`callgraph.ts` 必须:
- (i) 过滤声明自身、import、类型位置(`isDefinition` / 语法上下文判定);
- (ii) 仅当引用处于 `CallExpression` / `NewExpression` 的 callee 位置时记为调用边;方法作为值传递(callback)记为单独的 `reference` 边,不进入 B 类 ground truth 主口径;
- (iii) 边的源端取引用点的**最近封闭函数/方法声明**;模块顶层调用记源端为 `<module-top>`;
- (iv) 经接口类型接收者发起的调用,TS language service 解析到**接口成员**而非具体实现——此类边记为"→接口成员"并同时展开到作用域内全部实现(标记 `viaInterface: true`);B 类评分两种口径都报告,**主分析使用展开口径**(在冻结前由抽查核实选择,见 §11 第 1 步)。

ArchGuard 核心代码**零改动**——调用图属于实验 harness,不进入 `src/`。

### R2:L3 与 L4 在 v1 中信息内容相同,阶梯非严格单调

method 级 ArchJSON 就是完整 ArchJSON,故 v1 的 L3(method Mermaid)与 L4(完整 ArchJSON)是**同一信息的两种序列化格式**。修复:

1. v2 中 L3 与 L4 **均注入调用边**(R1 产物),二者仍信息等价、格式不同;预注册平局规则:H0 / P_GIT 在 L3/L4 平局时**取序号较小者(L3)**。
2. 把格式效应升级为一条**附加预测 B4**(见 §8.3):若 $d_{L3} \neq d_{L4}$ 且实测准确率分化方向与 $|d_\ell - d_{\text{task}}|$ 排序一致,则"消费者几何对序列化格式敏感"得到证据——这是 H0 按定义说不出的话(H0 只看实体集,实体集相同)。

### R3:TwoNN 在粗层级样本量不足,v1 的探针设计不可行

v1 探针 = "该层级的表示单元"。单模块下 L1 的单元(包)只有 2–5 个,TwoNN 在 <20 点上是噪声,而 P_GIT 恰恰最需要粗层级的 $d_\ell$。修复(两项叠加):

1. **固定锚点设计**:探针单元改为固定的 K 个锚实体(作用域模块的全部 ArchJSON 实体),每个锚点在层级 ℓ 下序列化为"该实体在 ℓ 中可见的描述" $D_\ell(a)$。每个层级点数恒为 K,跨层级可比,且消除"点数差异本身驱动维度估计差异"的混淆。
2. **模块池化**:作用域取 `src/mermaid` + `src/parser` 两个模块(实测锚点合计约 50–70)。预注册最小样本规则:**K ≥ 50**;若实测 K < 50,追加 `src/analysis` 为第三模块后再冻结。

配套规则(预注册):
- TwoNN 零距离对按 Facco–Laio 原文处理(剔除重复点);$D_\ell(a)$ 一律包含锚点自身(混淆后)标识符,避免同包锚点在 L1 退化为完全重复文本。
- 每个 $\hat{d}$ 报告 bootstrap 95% CI(重采样锚点,1000 次)。

---

## 2. 一句话的实验目的(不变)

检验一个**事前测出的本征维度** $\hat{d}$ 能否**预测**每类架构任务的最优表示粒度,并且**赢过**一行启发式"用仍然包含答案的最粗表示"。赢了,GIT 拿到第一条类 scaling-law 的预测;没赢,我们干净地知道维度机器是装饰,可以卸掉。

## 3. 核心判别问题(不变,平局规则更新)

三个对最优层级的**事前预测器**(均不运行 LLM 任务):

- **H0(启发式)**:最优层级 = 其表示的实体/关系集包含全部任务相关 ground-truth 实体与边的**最粗**层级(结构性充分)。
- **P_GIT(维度匹配)**:按 L0 → L5 顺序扫描,取**第一个**满足 $d_\ell \geq d_{\text{task}}$ 的层级。边界规则(v2.1 新增,预注册):$d_\ell$ 不保证随层级序号单调,规则按字面执行、不做平滑;若**没有任何**层级满足 $d_\ell \geq d_{\text{task}}$,则 P_GIT = L5;若扫描途中遇到被 §8.4 判"不可靠"的 $d_\ell$,该层级跳过并标记,进入敏感性分析。
- **P_random**:均匀随机选层级(下限对照)。

**P_oracle**:实测准确率最高的层级(须跑完任务获得)。

平局规则(新增,预注册):任何预测器在信息等价的 L3/L4 之间取 L3;P_oracle 在准确率并列时取序号较小者。

> 判别核心不变:在 $\text{P\_oracle} \neq \text{H0}$ 的任务子集上,P_GIT 能否点中 P_oracle。

## 4. 自变量:表示层级阶梯 v2

同一作用域、同一混淆命名空间下,六个层级。**与 v1 的差别:L3/L4 注入调用边;信息序为 L0 < L1 < L2 < L3 ≡ L4 < L5。**

| 代号 | 表示 | 生成方式 | 含调用边 |
| --- | --- | --- | --- |
| **L0** | 仅文件名清单(混淆后) | 地板对照 | 否 |
| **L1** | package 级 Mermaid | `analyze --diagrams package --no-cache` | 否 |
| **L2** | class 级 Mermaid(公有成员+实体级关系) | `--diagrams class` | 否 |
| **L3** | method 级 Mermaid(全成员含 private)**+ 调用边 flowchart 附录** | `--diagrams method` + `callgraph.ts` 注入 | 是 |
| **L4** | 完整 ArchJSON **+ `callGraph` 字段**(L3 的 JSON 序列化) | `analyze -f json` + 注入 | 是 |
| **L5** | 混淆后原始源码(去注释) | `obfuscate.ts` 输出 | 隐含 |

## 5. 被试与材料 v2

**作用域模块**(实测数据):

| 模块 | 文件 | 行数 | 体积 | 估算 tokens |
| --- | --- | --- | --- | --- |
| `src/mermaid` | 24 | 5,258 | ~170 KB | ~45k |
| `src/parser` | 13 | 2,441 | ~79 KB | ~20k |

两模块的 L5 均独立装进 128k context(满足"L5 表现差必须是干扰、不能是没装下"的反混淆设计)。任务、层级表示、混淆映射**按模块独立**生成;维度估计在池化锚点上进行(R3)。

**符号混淆(`obfuscate.ts`,基于 ts-morph,范围较 v1 扩大)**:

1. 语义重命名:对全部 class / interface / enum / function / method / property / 顶层 const 调用 ts-morph `rename()`,引用点自动跟随,关系结构不变。
2. **文件与目录重命名**:`sourceFile.move()`(`validation-pipeline.ts`、`validators/` 等名称本身就是答案泄漏),import 路径自动更新。
3. **去注释**:printer `removeComments`(注释含"renders mermaid diagram"级别的语义炸弹)。
4. **字符串字面量替换**:`'classDiagram'`、Mermaid 错误信息等领域强泄漏字符串替换为 `s1`/`s2` 占位。本实验任务全部是结构性的,不受影响;此改动在此声明。
5. **外部依赖名替换**:`import ... from 'isomorphic-mermaid'` → `'pkg1'` 等。bare specifier 仍被 `relation-extractor.ts` 判为外部依赖,不影响解析。
6. 映射表 `mapping.json` 只用于评分与对账,不进入任何 prompt。

**混淆正确性对账(冻结门槛,新增)**:在混淆树上重新跑 ArchGuard(`--no-cache`)生成 ground truth,与"原始树 ground truth 经映射表翻译"逐条比对;**不一致即混淆破坏解析,修复前不得冻结协议**。

**先验泄漏探针(冻结门槛,新增)**:正式跑之前,向每个被试模型展示 L5 样本并问"这是什么项目/这个模块做什么";若答出 ArchGuard / Mermaid / 图表渲染等域内概念,判混淆失败,修复后重测。

**Ground truth 来源**(在**混淆树**上生成,经对账校验):

| 任务需要 | 工具 |
| --- | --- |
| 出向依赖 | `query --deps-of` |
| 入向依赖 | `query --used-by` |
| 接口实现者 | `query --implementers-of` |
| 子类 | `query --subclasses-of` |
| 循环依赖 | `query --cycles` |
| 耦合热点 | `query --high-coupling` |
| 文件内实体 | `query --file` |
| 关节点 / 入度排名 | `ground-truth.ts` 内置图算法(对 ArchJSON relations,~20 行) |
| **method→method 调用边(B 类全部)** | **`callgraph.ts`(ts-morph `findReferences()`)** |

## 6. 任务集 v2

两类任务,各 25–30 题(两模块合并计数),集合型 F1、判定型精确匹配,全自动评分。

**A 类 — 模块边界/耦合(粗任务)**:与 v1 相同(入度最高实体、层间依赖、循环依赖、关节点)。ground truth 来自 query CLI + 图算法脚本。

**B 类 — 局部行为/变更影响(细任务)**:题型与 v1 相同("改 `Xq7.m4` 签名影响哪些函数""哪些函数调用进 <混淆后的 validation-pipeline>""哪个方法被最多其他方法调用"),但 v2 下:
- ground truth 来自 `callgraph.ts`;
- 答案在 L3 / L4(含调用边)与 L5 可推出,在 L0–L2 标记"信息不足"。

**可推出性矩阵(新增)**:`predict.ts` 对每个 (任务 × 层级) 机械判定"答案所需实体与边是否存在于该层级表示",产出 derivability 矩阵;判别分析只计入可推出单元,其余单独统计——该矩阵同时就是 H0 的计算依据。

每题 × 每模型 k=5 次,多数票/中位数;题目与层级呈现顺序随机化。采样参数按模型分别预注册(实测验证,见 §10):

- `deepseek-v4-flash`:temperature 0.2(实测接受);
- `gpt-5.4`:**不支持** temperature≠1(网关报 `UnsupportedParamsError`),固定 temperature=1 + `reasoning_effort: "low"`(实测接受),方差由 k=5 多数票吸收。

两模型采样规范不对称是服务端约束所致,在此声明;模型间不做跨模型直接比较(协议本就要求"全部预测分别报告")。

## 7. Experiment A:刻画曲线与移峰

> v2.1 说明:v1 原文不在仓库中(见 §14),以下为内联的完整预测文本,自本版本起以此为准并随协议冻结。

- **A1(干扰)**:至少一类任务上,$\text{acc}(L5)$ 显著低于该类任务的最优中间层级:配对 Wilcoxon 符号秩检验,$\alpha = 0.05$,且效应量 $\Delta F1 \geq 0.1$。由于两模块 L5 均已确认独立装入 128k context(§5),该差异只能解释为干扰/检索负担,不能解释为容量不足。
- **A2(倒 U)**:每类任务的准确率–层级曲线峰值不在端点:$\arg\max_\ell \text{acc} \notin \{L0, L5\}$(经 §3 平局规则归一后判定)。
- **A3(移峰)**:B 类(细任务)的最优层级序号 > A 类(粗任务)的最优层级序号;以题目为重采样单元做 bootstrap(1000 次),argmax 序号差的 95% CI 下界 > 0。

A1–A3 任一不成立都如实报告;A3 不成立时,Experiment B 的判别子集(§8.3 B2)预计塌缩,触发 §9 第 5 行。

## 8. Experiment B:可测维度的预测力 v2

### 8.1 本征维度估计器(R3 锚点设计)

**锚点集**:两模块全部 ArchJSON 实体,K ≥ 50(实测约 50–70;不足则追加 `src/analysis`)。

**探针**:对每个锚点 $a$ 与层级 $\ell$,序列化 $D_\ell(a)$ = "实体 $a$ 在层级 $\ell$ 中可见的全部信息":

- L0:文件名;
- L1:$a$ 所在包 + 该包的全部包级边;
- L2:$a$ 的类声明 + 公有成员 + 涉及 $a$ 的实体级关系;
- L3:L2 + private 成员 + 涉及 $a$ 的调用边;
- L4:$a$ 的 ArchJSON 实体对象 + 涉及 $a$ 的 relations + callGraph 条目;
- L5:$a$ 的完整源码(混淆后)。

每条 $D_\ell(a)$ 含 $a$ 的混淆标识符(防 L1 同包退化为重复文本)。

**嵌入(固定并声明,已实测验证)**:`qwen3-embedding:4b`,经 LiteLLM 网关 `/v1/embeddings`(后端 Ollama)。实测性质:2560 维、L2 归一化、**确定性**(同输入两次调用逐位相同,TwoNN 可复现)。

**静默截断防护(强制)**:Ollama 默认 `truncate=true`,超窗输入(实测有效窗口 8,000–16,000 字符,约 4k tokens)会**无声返回前缀的 embedding**。已实测确认 `truncate: false` 参数被网关透传到后端 `/api/embed`,超窗时报错而非截断。因此:

1. `embed.py` 所有请求**必须**带 `"truncate": false`,任何非 200 响应视为 fatal——不允许任何静默截断的向量进入点云;
2. **L5 探针不做整文件单次嵌入**,统一采用确定性分块聚合:

```
L5(a) = L2norm( mean( embed(chunk_1), …, embed(chunk_n) ) )
chunk_size   = 6,000 字符(留窗口安全边际)
chunk_overlap = 0
pooling      = mean
normalization = post-pool L2
```

   作用域内 `generator.ts`(37KB)等多个实体源码超窗,整文件嵌入会令头部相似的大文件被错误拉近、尾部核心逻辑完全不进入向量,系统性偏置 $d_{L5}$;
3. 全部嵌入元数据(model / endpoint / truncate / chunk_size / overlap / pooling / normalization)随结果落盘;
4. 稳健性附检(非主分析):服务端建 16k 上下文副本(`num_ctx 16384`)后,对短于 16k 的实体比较 whole-file 与 chunk-pool 两种 $d_{L5}$,作为分块策略的敏感性报告。

**估计(超参数 v2.1 冻结)**:`scikit-dimension`(`skdim.id.TwoNN` 主估计器,`discard_fraction` 冻结为库默认 0.1,即 Facco–Laio 原文剔除最大 10% 的 $\mu$ 比值;`skdim.id.MLE`(Levina–Bickel)副估计器,近邻数冻结为 K_MLE = 10,须满足 K_MLE < K/3)。**注意:skdim 不自动处理重复点**——重复点使最近邻距离 $r_1 = 0$、$\mu$ 发散;`dimension.py` 必须在估计前对点云 `np.unique(axis=0)` 去重(即"零距离对按 Facco–Laio 原文剔除"的实现口径),并记录每层级被剔除的点数;若去重后点数 < 0.8K,该层级维度直接判"不可靠"(并入 §8.4 规则)。bootstrap 95% CI(1000 次重采样锚点,每次重采样后重新去重)。skdim 版本号与全部超参数随结果落盘。

- $d_\ell = \text{TwoNN}(\{\phi(D_\ell(a))\}_{a=1}^{K})$
- $d_{\text{task}}$:每**任务类**的 ground-truth 涉及实体(跨该类全部题目池化、去重)在 L5 描述下的 TwoNN。**最小样本规则同等适用(v2.1 新增)**:R3 对 <20 点 TwoNN 的批评同样约束 $d_{\text{task}}$——若某任务类池化后涉及实体 < 20,该类 $d_{\text{task}}$ 判不可靠,该任务类退出 P_GIT 主分析(仅作敏感性报告);任务实例化时应优先覆盖足够多的不同实体以避开此规则。

锚点数核对(v2.1,grep 粗核对):`src/mermaid` + `src/parser` 顶层 class/interface/enum 共 61 个,与"实测约 50–70"一致;`src/analysis`(19 文件)另有约 23 个顶层实体,备援扩池可行。冻结时以混淆树上 ArchJSON 实体实数为准。

诚实声明不变:$\hat{d}$ 是消费者相对的(由 $\phi$ 定义);对 ArchGuard 的目标恰好对路,但必须声明且 $\phi$ 冻结。

### 8.2 预测器(见 §3,含 L3/L4 平局规则)

### 8.3 预注册预测

> v2.1 说明:B1–B3 的 v1 原文不在仓库中(见 §14),以下为内联重建文本,与 v2 中已出现的统计配对(§8.4:B1/B2 用 McNemar、B3 用 Spearman、B2 判别子集最小规模 8)逐一对齐,自本版本起以此为准并随协议冻结。

- **B1(全集预测力)**:在全部可推出任务上(derivability 矩阵口径,§6),P_GIT 的层级命中率(命中 = 预测层级经平局规则归一后等于 P_oracle 层级)显著高于 P_random(McNemar,$\alpha = 0.05$),且不低于 H0。
- **B2(判别子集,主判据)**:在判别子集($\text{P\_oracle} \neq \text{H0}$ 的任务,最小规模 8)上,P_GIT 命中率显著高于 H0(McNemar,$\alpha = 0.05$)。判别子集 < 8 时 B2 记"无判定力",触发 §9 第 5 行。
- **B3(梯度一致性)**:跨全部(任务类 × 可推出层级)单元,$|d_\ell - d_{\text{task}}|$ 与实测准确率的 Spearman 相关显著为负($\alpha = 0.05$)。
- **B4(新增,次级)**:L3 与 L4 实体集相同而格式不同。若 (i) $d_{L3}$ 与 $d_{L4}$ 的 bootstrap CI 不重叠,且 (ii) 在两个被试模型上,$|d_\ell - d_{\text{task}}|$ 较小的那一层级的实测准确率**均**更高(两模型方向一致),则记"格式敏感性证据成立"。B4 不参与 §9 主决策,只作为 H0 原则上不可表达的附加证据报告(H0 只看实体集,实体集相同时 H0 必然对 L3/L4 给出同一预测)。

### 8.4 统计

B1、B2 McNemar($\alpha=0.05$)、B3 Spearman,沿用 v1。新增预注册阈值:K ≥ 50;任一 $d_\ell$ 的 bootstrap CI 宽度 > 估计值本身时,该层级维度判"不可靠",P_GIT 涉及该层级的预测单独标记并在敏感性分析中剔除重算。

## 9. 决策规则

> v2.1 说明:v1 决策表原文不在仓库中(见 §14),以下五行为内联重建,条件项与 §8.3 的 B1–B3 一一对应,自本版本起以此为准并随协议冻结。B4 结果单列报告,不改变主判定。

| # | 条件(按行序判定,命中即止) | 判定 |
| --- | --- | --- |
| 1 | B2 成立 **且** B3 成立 | 维度匹配获得预测力 + 梯度机制证据:GIT 低维流形核从描述性升级为预测性候选,进入跨仓库复制实验 |
| 2 | B2 成立,B3 不成立 | 预测力成立但机制存疑(维度–准确率梯度未现):谨慎接受,结论限定为"P_GIT 在 H0 失效处有增益",优先补充机制实验 |
| 3 | B2 不成立,B1 成立 | P_GIT 与 H0 在判别子集上不可区分:维度机器判为**换装的启发式**,工程上保留 H0、卸掉维度机器 |
| 4 | B1 不成立,但 P_GIT 命中率 > P_random | P_GIT 弱于启发式:GIT 的可预测版本被否定,如实报告 |
| 5 | 判别子集 < 8,或 K < 50(§13.1),或多数 $d_\ell$ 被判不可靠(§8.4) | Experiment B 无判定力:降级为仅报告 Experiment A(移峰刻画),**不得**作任何 GIT 方向性结论 |

## 10. 实施:新建产物与对 ArchGuard 的改动

**对 ArchGuard 核心(`src/`)的改动:零。** 全部产物位于:

```
experiments/granularity/
  obfuscate.ts        # ts-morph:重命名+文件移动+去注释+字符串/外部依赖替换 → obf/<module>/ + mapping.json
  callgraph.ts        # findReferences() 调用图 → B 类 GT + L3/L4 注入物          ← v2 新增(R1)
  ground-truth.ts     # query CLI 包装 + 关节点/入度图算法;含混淆对账模式
  gen-levels.sh       # 在 obf/ 上跑 analyze(--no-cache)→ L0–L5 工件
  probes.ts           # 锚点 × 6 层级序列化 D_ℓ(a)                                ← v2 重设计(R3)
  embed.py            # 嵌入调用:truncate:false 强制 + 非200即fatal + L5分块聚合(§8.1)
  dimension.py        # skdim TwoNN/MLE + bootstrap CI
  predict.ts          # derivability 矩阵 + H0 / P_GIT 事前计算,带时间戳落盘
  run-tasks.ts        # k=5 × 2 模型 × 随机顺序,采样参数分模型按 §6(deepseek temp 0.2;gpt-5.4 temp 1 + reasoning_effort low)
  score.ts            # F1/EM 对 GT 自动评分
  analyze.py          # Wilcoxon / McNemar / Spearman / bootstrap
  requirements.txt    # Python 侧依赖锁定:scikit-dimension、numpy、scipy、requests(版本固定)
  tasks/              # 任务模板与实例化后的 tasks.json(冻结对象之一)
  inject-callgraph.ts # L3/L4 调用边注入(由 gen-levels.sh 调用;独立成文件以便单测)     ← 实施期拆分
  lib/                # env.ts(凭据校验)、paths.ts(工件目录约定)、llm-client.ts(run-tasks 与泄漏探针共用)
  tests/              # harness 自身测试(目录内独立 vitest / pytest;主套件已排除 experiments/**)
  artifacts/          # 运行产物(levels / gt / predictions / runs)与冻结哈希 frozen-hashes.json
```

**凭据纪律(v2.1 补充)**:LLM 与嵌入服务的网关地址与 API key 一律经环境变量 `LLM_BASE_URL` / `LLM_API_KEY` 注入;任何脚本、配置、测试、文档不得出现 key 字面量;脚本启动时 fail-fast 校验环境变量存在,缺失即报错退出。全部单测使用 mock HTTP/LLM client,可在无凭据环境运行。

**运行时依赖(v2.1 核对)**:`ts-morph@^27.0.2` 已在主仓库 `dependencies` 中,`obfuscate.ts`/`callgraph.ts` 直接复用;但仓库**没有** `tsx`/`ts-node`,TS 脚本需经 `npx tsx` 运行或在 `experiments/granularity/` 内局部安装 tsx(不进主 `package.json`)。Python 侧依赖经 `requirements.txt` 固定版本并随协议冻结。`experiments/` 目录已有先例(`elk-layout-experiment`),`granularity/` 与之平级。

**被试模型(已实测验证,经 LiteLLM 网关 `https://litellm.lrfz.com/v1`)**:

| 角色 | 模型 | 验证结论 |
| --- | --- | --- |
| 小模型 | `deepseek-v4-flash` | 可用;接受 temperature=0.2;无隐藏注入上下文(prompt_tokens 与实际输入一致);实测 64.5k tokens 输入、末尾标记正确取回 → L5(~45k)装得下 |
| 前沿模型 | `gpt-5.4` | 可用;拒绝 temperature≠1 → 固定 `reasoning_effort:"low"`(§6);**该路径每次调用有 ~2.9k tokens 隐藏注入上下文**(实测 prompt_tokens≈2,950 对 ~10 token 输入)——所有条件被同等污染,不影响层级间比较,但"准确率 vs token"曲线须扣除该固定开销 |

两模型不同家族,满足 §6 模型方差要求。嵌入模型见 §8.1(同网关,`qwen3-embedding:4b`)。

## 11. 执行顺序与预注册纪律 v2

1. **冻结前置三检(v2 新增,v2.1 明确其产物即 GT)**:(a) `callgraph.ts` 在未混淆模块上产出调用图并抽查 10 条边人工核实(同时确定 §1 R1 (iv) 接口边口径);(b) 混淆对账通过(§5)——对账过程本身已在未混淆树与混淆树上各生成一份完整 ground truth;(c) 泄漏探针通过(§5)。三检任一失败,修复后重测,**然后**才进入第 2 步。
2. 核对锚点数 K(混淆树 ArchJSON 实体实数,§8.1)≥ 50——不足则按 §1 R3 追加 `src/analysis` 为第三模块并对扩池后作用域重过第 1 步三检;追加后仍 < 50 则按 §13.1 记录降级"仅 Experiment A",降级决定随协议一并冻结。基于第 1 步产出的 ground truth 实例化 tasks.json(v2.1 修正:任务实例化依赖 GT,故 GT 生成必须先于冻结,v2 原步骤 3 的顺序不可执行);锁定本协议(含 tasks.json、全部 $\alpha$/效应量/K 阈值/平局规则;v2.1 已自包含,无任何外部 v1 引用)。冻结,打 git tag。
3. 校验冻结工件完整性:两树 ground truth、`mapping.json`、`tasks.json`、调用图产物逐一计算 SHA-256 落盘;此后任何重生成必须与冻结哈希比对,不一致即报告偏离。
4. 生成六层级表示(L0–L5,含 L3/L4 调用边注入)。
5. 跑嵌入与维度估计,算出 H0 / P_GIT / 各 $d$ 及 CI——**在跑任何 LLM 任务之前落盘这些事前预测**。
6. 跑 Experiment A(全层级 × 全任务 × k × 2 模型),得 P_oracle 与曲线。
7. 按 §8.3 对账,按 §9 判定。
8. 报告全部结果,含未达预测的。

**规模估算**:~55 题 × 6 层 × 5 次 × 2 模型 ≈ 3,300 次任务调用(扣除"信息不足"单元后更少)+ ~700 次嵌入调用(K×6 + 任务实体集 + bootstrap 为重采样无需重嵌)。成本数美元量级;新建脚本约 2–3 天工作量(v1 估"半天"未计入 `callgraph.ts` 与混淆对账)。

## 12. 明确不检验的东西

本协议**不**检验:程序空间自然梯度、元层振荡、五项损失/负熵泵/自指不动点;只检验 GIT 的可测低维流形核能否从描述性升级为预测性。(v2.1:原"沿用 v1 §11 原文"改为内联陈述,内容即 v2 中已复述的排除清单。)

## 13. 已知风险与开放问题(v2 新增,冻结前须逐项关闭或显式接受)

1. **锚点数 K 处于下限边缘**(实测 ~50–70):若加入 `src/analysis` 后仍 <50,TwoNN 主张退化,实验降级为"仅 Experiment A"(只报告移峰,不报告维度预测力)——该降级路径在此预注册。
2. **`findReferences()` 调用图不完备/口径偏差**(v2.1 扩充):(a) 动态调用(回调、事件、`this[name]()` 式分发、字符串键查表)对 language service 不可见——抽查发现遗漏率 >10% 时,B 类任务改为只使用静态可解析调用边覆盖的题目;(b) `findReferences()` 返回引用而非调用,必须按 §1 R1 (i)–(iv) 过滤与归属,否则调用图含大量假阳性(import、类型位置、回调传递);(c) 接口分发的归属口径(接口成员 vs 展开到实现)直接影响 B 类 ground truth 与 derivability 矩阵,须在冻结前按 §11 第 1 步定死。
3. **字符串替换可能改变个别任务语义**:任务实例化后逐题人检一遍"答案是否依赖被替换字符串",依赖者剔除。
4. **L1 锚点描述近重复**:同包锚点的 $D_{L1}$ 仅差标识符,TwoNN 可能系统性低估 $d_{L1}$。这本身符合"L1 是强压缩"的语义,但若 $d_{L1}$ 的 CI 不可靠,按 §8.4 规则标记剔除。
5. **嵌入静默截断(已定位根因并关闭)**:Ollama OpenAI 兼容路径 `/v1/embeddings` 对超窗输入默认 `truncate=true`,返回被截断前缀的 embedding 且不报错(实测窗口约 4k tokens;`generator.ts` 等多个 L5 实体超窗)。修复已写入 §8.1:`truncate:false` fail-fast(实测网关透传生效)+ L5 确定性分块聚合。**任何在该防护生效前产生的嵌入向量一律作废重跑。**
6. **gpt-5.4 路径的隐藏注入上下文**(~2.9k tokens/调用,内容不可控):对层级间比较无差异影响,但记入混淆控制清单;若该注入内容在实验期间变化(prompt_tokens 基线漂移),当批次 gpt-5.4 结果作废重跑。每批任务前用固定探针请求记录基线。
7. **v1 协议原文缺失(v2.1 已处置)**:v1 不在仓库且不可从 git 历史恢复,v2 的"沿用 v1 原文"全部为悬空引用。处置:A1–A3、B1–B3、§9 决策表、§12 排除清单已在 v2.1 内联为自包含文本并标注"重建"。**剩余风险**:若日后找回 v1 原文且与重建文本有实质出入,以已冻结的 v2.1 文本为准,出入作为协议偏离记录在最终报告中——预注册的效力以 git tag 时刻的文本为唯一依据。
8. **$d_{\text{task}}$ 小样本**(v2.1 新增,与 R3 同源):任务类池化实体数可能 < 20(尤其 A 类若题目集中于少数热点实体),TwoNN 在该点数下不可靠。已在 §8.1 预注册最小样本规则与退出路径;任务实例化时主动分散覆盖实体。
9. **重建条款的事后偏倚**(v2.1 新增,诚实声明):B1–B3 与 §9 决策表由审查者依据 v2 文内线索(统计配对、判别子集规模、降级路径)重建,重建发生在任何 LLM 任务、嵌入或维度估计运行**之前**,不构成结果依赖;但重建本身是一次自由度行使,故在此显式记录,且冻结后不得再改。

## 14. 审查发现(v2.1 架构师审查记录,2026-06-11)

本节为对 v2 草案的独立审查记录,审查在任何实验产物生成之前完成。

### 14.1 逐条核对通过的声称(against 仓库实际代码)

| 文档声称 | 核对结果 |
| --- | --- |
| `src/parser/archjson-aggregator.ts:33` `case 'method': return archJSON;` | 属实(行号精确,注释 "Return original - no filtering needed") |
| `src/parser/relation-extractor.ts` 仅实体级关系,无 call 边类型 | 属实(无 `call`/`invocation` 关系类型) |
| `src/mermaid` 24 文件 / 5,258 行 / ~170 KB | 属实(24 / 5,258 / 169,599 B) |
| `src/parser` 13 文件 / 2,441 行 / ~79 KB | 属实(13 / 2,441 / 78,714 B) |
| §5 ground truth 所列 query CLI flag | 全部存在:`--deps-of`、`--used-by`、`--implementers-of`、`--subclasses-of`、`--cycles`、`--high-coupling`、`--file` 均在 `query --help` 中验证 |
| ts-morph 可用 | 属实(主 `package.json` dependencies `ts-morph@^27.0.2`) |
| TS 插件支持 method 级 | 属实(`supportedLevels = ['package','class','method']`) |
| 锚点 50–70 估算 | 与 grep 粗核对一致(61 个顶层 class/interface/enum;`src/analysis` 备援约 +23) |
| skdim API | `skdim.id.TwoNN`(`discard_fraction`,默认 0.1)与 `skdim.id.MLE`(Levina–Bickel,近邻数参数)均为 scikit-dimension 实际 API;重复点不被库自动处理,须如 §8.1 预先去重 |

外部服务结论(LiteLLM 网关、deepseek-v4-flash 64.5k 实测、gpt-5.4 temperature 限制与 ~2.9k 隐藏注入、qwen3-embedding:4b 2560 维/确定性/截断行为、`truncate:false` 网关透传)为实测事实,本次审查**未触碰、未复测、未改写**。

### 14.2 发现并已在 v2.1 修复的问题

1. **(冻结阻断)v1 原文不存在**:仓库与 git 全历史均无 v1(历史中唯一相近文件 `proposal-jl-intrinsic-dimension.md` 是另一主题)。§7/§8.3/§9/§12 的"沿用 v1 原文"全部悬空。→ 已内联自包含化(§7、§8.3、§9、§12),并记风险 §13.7/§13.9。
2. **§10 与 §6 矛盾**:`run-tasks.ts` 注释写死 "temperature 0.2",与 §6 "gpt-5.4 固定 temperature=1" 冲突。→ 已改为"分模型按 §6"。
3. **P_GIT 边界未定义**:无层级满足 $d_\ell \geq d_{\text{task}}$ 时、以及 $d_\ell$ 非单调时规则歧义。→ §3 已补扫描顺序、fallback=L5、不可靠层级跳过规则。
4. **callgraph 口径缺失**:`findReferences()` 返回引用≠调用(含 import/类型位置/回调传递),且接口分发归属未定。→ §1 R1 已补 (i)–(iv) 判定口径,§13.2 扩充。
5. **skdim 实现细节未冻结**:TwoNN `discard_fraction`、MLE 近邻数、重复点须调用方自行剔除——均已写入 §8.1 并要求随结果落盘。
6. **$d_{\text{task}}$ 自相矛盾风险**:R3 批评 <20 点的 TwoNN,但 $d_{\text{task}}$ 自身点数无下限约束。→ §8.1 已补最小样本规则与退出路径,§13.8 记录。
7. **§11 执行顺序不可执行**:tasks.json 在第 2 步冻结,但其实例化所需 GT 原排在第 3 步。→ 已重排(三检产物即 GT;第 3 步改为冻结工件哈希校验)。
8. **运行时依赖未声明**:仓库无 tsx/ts-node;Python 侧 skdim/numpy/scipy 无锁定机制。→ §10 已补运行方式与 `requirements.txt`。

### 14.3 审查后保留的疑虑(不阻断冻结,但须知情)

- §8.3 B1–B3 与 §9 决策表为重建文本(§13.9):逻辑上与 v2 文内全部线索一致,但无法证明与 v1 逐字相同;预注册效力以 v2.1 冻结文本为准。
- TwoNN 在 K≈60、嵌入维度 2560 下方差仍然偏大,bootstrap CI 预计较宽;§8.4 的"CI 宽度 > 估计值"剔除规则可能触发于多个层级——这是协议自带的降级路径(§9 第 5 行),不是缺陷,但执行者应有预期。
- L0 层级各锚点描述仅为"文件名 + 锚点标识符",同文件锚点去重后可能显著少于 K;§8.1 的 0.8K 规则会捕获该情形,大概率 $d_{L0}$ 不可靠——可接受(L0 本就是地板对照)。
