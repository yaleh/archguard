# Plan 59-66 — 本征维度 × 表示粒度预注册实验(Granularity Experiment)

> Proposal: `docs/proposals/proposal-intrinsic-dimension-granularity-experiment.md`(预注册实验协议 v2.1)
> Status: Draft
> Priority: MEDIUM(实验 harness,**对 `src/` 零改动**)
> Estimated total changes: ~2,310 行实验脚本(Phase 59–63)+ ≤110 行胶水(Phase 64–66)+ ~1,430 行测试(全部位于 `experiments/granularity/`;分项见文末"行数预算核对",总数为各 Stage 之和)

---

## 总览

实现 proposal v2.1 §10 列出的全部实验产物,并按 §11 的预注册纪律执行实验。本 plan 的硬性纪律约束(违反即协议偏离,须记入最终报告):

1. **冻结 tag 是分水岭**:Phase 59–64 为 tag 之前的工作(工具构建 + 冻结前置三检 + 协议冻结);Phase 65–66 为 tag 之后的工作(事前预测落盘 + LLM 任务运行)。tag 之前与之后的工作不混入同一 Phase。
2. **事前预测严格先于 LLM 任务**:Phase 65(嵌入/维度/H0/P_GIT 落盘并 commit)完成之前,Phase 66 的任何 LLM 任务调用**不得发起**。Phase 66 的入口验收会核对 Phase 65 落盘文件的 commit 时间戳。
3. **对 ArchGuard 核心(`src/`)的改动:零**。全部产物位于 `experiments/granularity/`,与既有 `experiments/elk-layout-experiment` 平级;主 vitest 配置已排除 `experiments/**`,实验测试用目录内独立 vitest/pytest 运行。
4. **凭据零落盘**:任何脚本、配置、测试、文档中不得出现 API key。LLM 与嵌入服务凭据一律经环境变量引用:`LLM_BASE_URL`(LiteLLM 网关地址)、`LLM_API_KEY`。脚本启动时 fail-fast 校验环境变量存在,缺失即报错退出。

### 与 §11 执行顺序的对应

| §11 步骤 | 内容 | 本 plan Phase |
| --- | --- | --- |
| (工具前置) | §10 全部脚本的构建与单测 | **59–63**(构建期,tag 前) |
| 1 | 冻结前置三检:callgraph 抽查(a)/ 混淆对账(b)/ 泄漏探针(c) | **64**(Stage 64.1–64.2) |
| 2 | K ≥ 50 冻结闸门;基于三检产出的 GT 实例化 tasks.json;锁协议,打 git tag | **64**(Stage 64.3) |
| 3 | 冻结工件 SHA-256 哈希校验落盘 | **64**(Stage 64.3) |
| 4 | 生成六层级表示(L0–L5,含 L3/L4 调用边注入) | **65**(Stage 65.1) |
| 5 | 嵌入 + 维度估计 + H0/P_GIT 事前预测落盘(先于任何 LLM 任务) | **65**(Stage 65.2–65.3) |
| 6 | 跑 Experiment A(全层级 × 全任务 × k × 2 模型)→ P_oracle | **66**(Stage 66.1) |
| 7 | 按 §8.3 对账、按 §9 判定 | **66**(Stage 66.2) |
| 8 | 报告全部结果(含未达预测的) | **66**(Stage 66.3) |

### §10 产物 → Phase/Stage 映射

| 产物 | Stage |
| --- | --- |
| 脚手架(package.json / tsconfig / vitest / requirements.txt / env 校验) | 59.1 |
| `obfuscate.ts`(预计超 200 行,拆两个 Stage) | 59.2 + 59.3 |
| `callgraph.ts`(含 (i)–(iv) 口径,拆两个 Stage) | 60.1 + 60.2 |
| `ground-truth.ts`(query 包装 + 图算法 + 对账模式) | 60.3 |
| `gen-levels.sh` + 调用边注入脚本 | 61.1 |
| `probes.ts` | 61.2 |
| `predict.ts` | 61.3 |
| `embed.py` | 62.1 |
| `dimension.py` | 62.2 |
| `analyze.py` | 62.3 |
| `tasks/`(模板 + schema) | 63.1 |
| `run-tasks.ts` | 63.2 |
| `score.ts` | 63.3 |
| `requirements.txt` | 59.1(创建并钉死版本)+ 62.x(实现期如需调版,须在 64.3 冻结前完成) |

### Phase 依赖与并行性

| Phase | 内容 | 依赖 | 可并行 |
| --- | --- | --- | --- |
| **59** | 脚手架 + `obfuscate.ts` | 无 | 59.1 完成后,59.2+ 与 Phase 60/62 并行 |
| **60** | `callgraph.ts` + `ground-truth.ts` | 59.1 | 与 59.2–59.3、62 并行 |
| **61** | `gen-levels.sh` + `probes.ts` + `predict.ts` | 60(调用边格式)、59(mapping 格式) | 与 62、63 并行 |
| **62** | `embed.py` + `dimension.py` + `analyze.py` | 59.1(requirements.txt) | 与 60、61、63 并行(纯 Python,无 TS 依赖) |
| **63** | `tasks/` 模板 + `run-tasks.ts` + `score.ts` | 59.1;63.2 依赖 63.1 的任务 schema | 与 61、62 并行 |
| **64** | 三检 + K ≥ 50 闸门 + tasks.json 实例化 + **冻结 tag** | 59、60、63.1(任务模板)、63.2(64.2(c) 泄漏探针复用 `lib/llm-client.ts`);建议 61–63 全部完工后再冻结,避免 tag 后修改工具引入自由度 | 否(串行闸门) |
| **65** | 层级工件 + 嵌入/维度 + 事前预测落盘 | 64(tag)、61、62 | 65.1 与 65.2 的嵌入准备可并行;65.3 依赖 65.1+65.2 |
| **66** | LLM 任务 + 对账判定 + 报告 | **65.3 已 commit**、63 | 否(预注册顺序) |

---

## Phase 59 — 实验脚手架与符号混淆器

**依赖**:无。
**预计行数**:~470 行源码 + ~310 行测试。

### Stage 59.1 — `experiments/granularity/` 脚手架(~90 行源码 + ~40 行测试)

**文件**:
- `experiments/granularity/package.json`(新):局部安装 `tsx`、`vitest`(**不进主 `package.json`**,遵守 §14 运行时依赖决定);`ts-morph` 复用主仓库 dependencies(`^27.0.2`,§14 已核对)。scripts:`test`(vitest run)、各脚本的 `npx tsx` 入口。
- `experiments/granularity/tsconfig.json`、`vitest.config.ts`(新):独立配置,不影响主套件(主 vitest 已排除 `experiments/**`)。
- `experiments/granularity/requirements.txt`(新):`scikit-dimension`、`numpy`、`scipy`、`requests`,**版本固定**(== 钉死,随协议冻结)。
- `experiments/granularity/lib/env.ts`(新):读取 `LLM_BASE_URL` / `LLM_API_KEY`,任一缺失即抛错(fail-fast)。**不提供默认值、不写入任何文件**。
- `experiments/granularity/lib/paths.ts`(新):工件目录约定(`obf/`、`artifacts/levels/`、`artifacts/gt/`、`artifacts/predictions/`、`artifacts/runs/`)。

**测试**(`tests/env.test.ts`):env 缺失抛错、存在则返回;paths 常量稳定。

**验收标准**:
- `cd experiments/granularity && npm install && npm test` 通过;
- 主仓库 `npm test`、`npm run type-check` 不受影响(零改动验证);
- `git grep -iE 'sk-|api[_-]?key\s*[:=]' experiments/granularity/` 无凭据字面量。

### Stage 59.2 — `obfuscate.ts`:语义重命名 + mapping.json(~190 行源码 + ~160 行测试)

实现 §5 混淆步骤 1 与 6:
- 对全部 class / interface / enum / function / method / property / 顶层 const 调用 ts-morph `rename()`(引用点自动跟随);混淆名生成器确定性(种子固定),格式如 `Xq7`、`m4`;
- `mapping.json` 输出:原名 ↔ 混淆名双向映射(实体、成员、文件三个命名空间),**只用于评分与对账,不进任何 prompt**(在 run-tasks.ts 验收中复查)。

**测试**(TDD,fixture 微型 TS 项目):重命名后引用一致(编译通过)、关系结构不变(类继承/实现关系在 rename 前后同构)、映射表可逆、两次运行输出逐字节相同(确定性)。

**验收标准**:测试全过;fixture 项目混淆后 `tsc --noEmit` 零错误。

### Stage 59.3 — `obfuscate.ts`:文件移动、去注释、字符串与外部依赖替换(~190 行源码 + ~110 行测试)

实现 §5 混淆步骤 2–5:
- `sourceFile.move()` 重命名文件与目录(import 路径自动更新);
- printer `removeComments` 去注释;
- 领域强泄漏字符串字面量(`'classDiagram'`、Mermaid 错误信息等)→ `s1`/`s2` 占位,替换清单进 mapping.json;
- 外部依赖名替换(`'isomorphic-mermaid'` → `'pkg1'` 等),保持 bare specifier 形态(§5:仍被判为外部依赖)。

**测试**:文件移动后 import 解析、注释清零、字符串替换记录进映射、bare specifier 形态保持各有用例。

**验收标准**:
- 测试全过;对 `src/mermaid` + `src/parser` 实跑产出 `obf/<module>/` + `mapping.json`,混淆树 `tsc --noEmit` 零错误;
- 混淆树中 `grep -riE 'mermaid|archguard|diagram'`(排除 bare specifier 替换前清单)零命中——作为 Phase 64 泄漏探针的前置自检。

---

## Phase 60 — 调用图与 Ground Truth 工具

**依赖**:Stage 59.1。可与 59.2–59.3、Phase 62 并行。
**预计行数**:~480 行源码 + ~330 行测试。

### Stage 60.1 — `callgraph.ts` 核心:引用→调用过滤口径 (i)–(iii)(~180 行源码 + ~180 行测试)

基于 ts-morph `findReferences()` 构建 method→method 调用边,实现 §1 R1 判定口径:
- **(i)** 过滤声明自身、import 语句、纯类型位置(`isDefinition` / 语法上下文判定);
- **(ii)** 仅当引用处于 `CallExpression` / `NewExpression` 的 callee 位置记为 `call` 边;方法作为值传递(callback)记为 `reference` 边,**不进入 B 类 GT 主口径**;
- **(iii)** 边源端取引用点最近封闭函数/方法声明;模块顶层调用记 `<module-top>`。

**测试**(TDD,fixture 项目,**口径 (i)–(iii) 每条至少一组正/反用例**):
- (i):声明点不计边;import 不计边;`typeof X` / 类型注解位置不计边;
- (ii):`obj.m()` 计 call 边;`new C()` 计 call 边;`arr.map(this.m)` 计 reference 边且不入主口径;
- (iii):嵌套函数中调用归属最内层函数;顶层调用归属 `<module-top>`。

**验收标准**:测试全过;输出 JSON 含边类型(`call`/`reference`)与源/汇全限定名。

### Stage 60.2 — `callgraph.ts`:接口分发口径 (iv) 与双口径输出(~110 行源码 + ~70 行测试)

- **(iv)** 经接口类型接收者发起的调用:解析到接口成员的边记"→接口成员",同时展开到作用域内全部实现,标记 `viaInterface: true`;
- 输出**两套口径**(接口成员口径 / 展开口径)的 B 类 GT 视图,主口径选择留待 Phase 64 Stage 64.1 抽查后定死(§11 第 1 步)。

**测试**:接口 fixture(1 接口 2 实现)下,接口口径产出 1 条边、展开口径产出 2 条边且均带 `viaInterface: true`;非接口调用不受影响。

**验收标准**:测试全过;两套口径在同一输出文件中并存,可由开关选择。

### Stage 60.3 — `ground-truth.ts`:query 包装 + 图算法 + 对账模式(~190 行源码 + ~80 行测试)

- 包装 §5 表中 7 个 query CLI flag(`--deps-of`、`--used-by`、`--implementers-of`、`--subclasses-of`、`--cycles`、`--high-coupling`、`--file`),对指定树(原始/混淆)运行并落盘;
- 内置图算法:关节点(割点)与入度排名(对 ArchJSON relations,~20 行);
- **对账模式**:读取两树 GT 与 `mapping.json`,将原始树 GT 逐条翻译后与混淆树 GT 比对,输出差异清单(空 = 通过);
- 冻结工件 SHA-256 计算与落盘(供 §11 第 3 步复用)。

**测试**:关节点/入度算法在手工构造小图上的已知答案用例;对账翻译逻辑(同构 GT → 零差异、注入一处差异 → 被捕获);SHA-256 稳定性。query CLI 包装层用 mock 子进程测参数拼装,实跑留给 Phase 64(实测对账环节)。

**验收标准**:测试全过;`ground-truth.ts --reconcile` 在人为注入差异的 fixture 上正确报告差异。

---

## Phase 61 — 层级生成、探针序列化与事前预测器

**依赖**:Phase 60(调用边 JSON 格式)、Phase 59(mapping/obf 目录约定)。可与 Phase 62、63 并行。
**预计行数**:~480 行源码 + ~280 行测试。

### Stage 61.1 — `gen-levels.sh` + 调用边注入(~140 行源码 + ~70 行测试)

- `gen-levels.sh`:在 `obf/` 上跑 `analyze --no-cache` 生成 L1(package)/ L2(class)/ L3(method)Mermaid 与 L4 ArchJSON;L0 = 混淆后文件名清单;L5 = 混淆树源码(obfuscate 已去注释);
- `inject-callgraph.ts`(注入逻辑独立成 TS 以便单测):L3 末尾追加调用边 flowchart 附录;L4 注入 `callGraph` 字段。注入后 L3 与 L4 信息等价(§4)。

**测试**:注入器对 fixture 调用图的 Mermaid 附录语法有效(经主仓库 Mermaid 校验器或语法 smoke);L4 `callGraph` 字段结构与边数等于输入;两次注入幂等。

**验收标准**:测试全过;对混淆树实跑产出 L0–L5 六个工件目录,L3/L4 含调用边。

### Stage 61.2 — `probes.ts`:锚点 × 6 层级序列化(~170 行源码 + ~120 行测试)

实现 §8.1 探针:锚点集 = 两模块全部 ArchJSON 实体;对每个锚点 a 与层级 ℓ 产出 `D_ℓ(a)`:
- L0 文件名;L1 所在包 + 包级边;L2 类声明 + 公有成员 + 实体级关系;L3 = L2 + private 成员 + 调用边;L4 = ArchJSON 实体对象 + relations + callGraph 条目;L5 = 完整混淆源码;
- 每条 `D_ℓ(a)` **必含锚点混淆标识符**(防 L1 同包退化,§1 R3);
- 输出含锚点数 K 统计(供 Phase 65.2 与 64.3 冻结记录的 K 做一致性复核;K ≥ 50 闸门本身在 64.3 冻结前以混淆树 ArchJSON 实体实数判定,§8.1)。

**测试**:六个层级各有序列化规则用例;锚点标识符存在性断言(全层级);同输入两次序列化逐字节相同(确定性);L3 探针含调用边而 L2 不含(信息单调性抽查)。

**验收标准**:测试全过;实跑产出 K × 6 条探针文本及元数据(K 实数落盘)。

### Stage 61.3 — `predict.ts`:derivability 矩阵 + H0 / P_GIT(~170 行源码 + ~90 行测试)

- derivability 矩阵:对每个 (任务 × 层级) 机械判定"答案所需实体与边是否存在于该层级表示"(§6);
- **H0**:结构性充分的最粗层级(矩阵直接推出);
- **P_GIT**:按 L0→L5 扫描取第一个 `d_ℓ ≥ d_task` 的层级,实现 §3 全部边界规则——不平滑、无满足层级则 fallback L5、"不可靠"层级跳过并标记;
- 平局规则:L3/L4 信息等价时一律取 L3(§3);
- 输出带 ISO 时间戳落盘(Phase 65 的事前预测证据)。

**测试**(每条预注册规则一个用例):H0 取最粗充分层级;P_GIT 正常命中;非单调 d 序列按字面扫描;全不满足 → L5;不可靠层级跳过且被标记;L3/L4 平局 → L3;时间戳与输入哈希写入输出。

**验收标准**:测试全过;predict.ts 不依赖任何 LLM 调用(纯函数 + 文件 I/O)。

---

## Phase 62 — Python 侧:嵌入、维度估计与统计

**依赖**:Stage 59.1(requirements.txt)。可与 Phase 60、61、63 并行(纯 Python)。
**预计行数**:~460 行源码 + ~280 行测试(pytest)。

### Stage 62.1 — `embed.py`:truncate 防护 + L5 分块聚合(~160 行源码 + ~110 行测试)

实现 §8.1 嵌入规范:
- 经 `LLM_BASE_URL` 网关 `/v1/embeddings` 调用 `qwen3-embedding:4b`,鉴权头取 `LLM_API_KEY`(环境变量,代码中无字面量);
- **所有请求强制 `"truncate": false`,任何非 200 响应视为 fatal**(§13.5:防护生效前产生的向量一律作废);
- L5 探针确定性分块聚合:chunk_size=6,000 字符、overlap=0、mean pooling、post-pool L2 归一化;
- 全部嵌入元数据(model / endpoint / truncate / chunk_size / overlap / pooling / normalization)随结果落盘;
- 磁盘缓存按输入 SHA-256 索引(重跑友好,且可审计)。

**测试**(mock HTTP,不打真实网关):
- **chunk 聚合确定性测试**:固定假嵌入函数下,同一长文本两次聚合逐位相同;分块边界(恰好 6,000、6,001 字符)正确;
- mean + post-pool L2 的数值正确性(手算小例);
- 非 200 响应抛 fatal、不写缓存;请求体含 `"truncate": false` 断言;
- 环境变量缺失 fail-fast。

**验收标准**:pytest 全过;`grep -E 'sk-|Bearer [A-Za-z0-9]' embed.py` 无凭据字面量。**真实网关的确定性与 truncate 透传为已实测结论(§6/§8.1),Phase 65 实跑时以 1 个探针做 smoke 复核,不在单测中重测。**

### Stage 62.2 — `dimension.py`:TwoNN/MLE 包装 + 去重 + bootstrap(~150 行源码 + ~110 行测试)

实现 §8.1 冻结超参数:
- `skdim.id.TwoNN`(`discard_fraction=0.1` 库默认)主估计器;`skdim.id.MLE` 副估计器(K_MLE=10,断言 K_MLE < K/3);
- 估计前 `np.unique(axis=0)` 去重,记录每层级剔除点数;**去重后点数 < 0.8K → 该层级判"不可靠"**(§8.4);
- bootstrap 95% CI(1000 次重采样锚点,每次重采样后重新去重);CI 宽度 > 估计值 → 判"不可靠";
- skdim 版本号与全部超参数随结果落盘。

**测试**:
- **已知流形 sanity 测试**:均匀采样 2 维平面嵌入 10 维(d̂ ≈ 2 ± 容差)、5 维超立方(d̂ ≈ 5 ± 容差)——TwoNN 包装正确性的金标准;
- 重复点注入 → 被去重且计数正确;去重后 < 0.8K → 不可靠标记;
- bootstrap CI 输出结构与可复现性(固定随机种子);K_MLE < K/3 违反时报错。

**验收标准**:pytest 全过;已知流形用例在固定种子下稳定通过。

### Stage 62.3 — `analyze.py`:统计检验(~150 行源码 + ~60 行测试)

- 配对 Wilcoxon(A1,α=0.05,效应量 ΔF1 ≥ 0.1)、McNemar(B1/B2,α=0.05)、Spearman(B3)、argmax 序号差 bootstrap CI(A3,1000 次,题目为重采样单元);
- 输入为 score.ts 的评分落盘,输出 §9 决策表所需的全部判定位。

**测试**:每个检验用已知答案的合成数据各一组(显著/不显著两侧);A3 bootstrap 的重采样单元为题目(非调用)断言。

**验收标准**:pytest 全过;Phase 62 全部源码 pytest 覆盖率 ≥ 80%。

---

## Phase 63 — 任务模板、运行器与评分

**依赖**:Stage 59.1;63.2 依赖 63.1 的任务 schema。可与 Phase 61、62 并行。**须在 Phase 66 开始前完工;建议在 Phase 64 冻结前完工**(冻结后再改运行器/评分器属自由度行使,须记协议偏离)。
**预计行数**:~420 行源码 + ~230 行测试。

### Stage 63.1 — `tasks/` 模板与 schema(~100 行源码/模板 + ~50 行测试)

- 任务 schema(JSON Schema 或 zod):题型、模块、涉及实体(混淆名)、答案类型(集合型 F1 / 判定型 EM)、所属任务类(A/B);
- A 类模板:入度最高实体、层间依赖、循环依赖、关节点(§6);
- B 类模板:改签名影响面、谁调用进 X、被调用最多的方法(§6,GT 来自 callgraph);
- 实例化器骨架(读 GT → 填模板),实际实例化在 Phase 64 执行。

**测试**:schema 校验(合法/非法任务各一);模板实例化在 fixture GT 上产出合法任务。

**验收标准**:测试全过;模板覆盖 §6 全部题型;B 类模板标注 GT 口径字段(接口/展开,待 64.1 定死)。

### Stage 63.2 — `run-tasks.ts`:k=5 × 2 模型运行器(~190 行源码:run-tasks.ts ~140 + `lib/llm-client.ts` ~50;~120 行测试)

- 每题 × 每层级 × k=5 × 2 模型;题目与层级呈现顺序随机化(种子落盘);
- HTTP/LLM client 拆至 `lib/llm-client.ts`(计入本 Stage 行数预算;Stage 64.2(c) 泄漏探针复用之,Phase 64 不另写网关胶水);
- **采样参数分模型按 §6**:`deepseek-v4-flash` temperature=0.2;`gpt-5.4` temperature=1 + `reasoning_effort: "low"`(网关拒绝 temperature≠1,§14 修复项 2);
- derivability 矩阵中"信息不足"的 (任务 × 层级) 单元跳过(规模从 ~3,300 调用扣减);
- **gpt-5.4 基线探针**(§13.6):每批任务前发固定探针请求,记录 prompt_tokens 基线;漂移超阈值 → 当批结果标记作废待重跑;
- 凭据仅经 `lib/env.ts`;**prompt 构建路径上断言不引用 mapping.json**(混淆映射不进 prompt,§5);
- 断点续跑:已完成调用按 (任务,层级,模型,k) 键落盘,重启不重复计费。

**测试**(mock LLM client):分模型采样参数正确;随机化种子可复现;信息不足单元跳过;基线漂移触发作废标记;断点续跑不重复;prompt 内容不含 mapping 中任何原始名(fixture 断言)。

**验收标准**:测试全过;dry-run 模式(不打网关)可输出完整调用计划与规模估算。

### Stage 63.3 — `score.ts`:自动评分(~130 行源码 + ~60 行测试)

- 集合型 F1、判定型精确匹配;k=5 取多数票(判定型)/中位数(数值型);
- 评分以混淆名为准,经 mapping.json 仅做对账复核(评分本身不需要还原原名);
- 按 (任务 × 层级 × 模型) 输出长表,供 analyze.py 消费。

**测试**:F1 边界(空集、全对、半对)、多数票平票规则、中位数、与 fixture GT 的端到端评分。

**验收标准**:测试全过;Phase 59–63 的 TS 源码 vitest 覆盖率合计 ≥ 80%。

---

## Phase 64 — 冻结前置三检与协议冻结(§11 步骤 1–3,tag 前最后一个 Phase)

**依赖**:Phase 59、60、63.1;64.2(c) 泄漏探针复用 63.2 的 `lib/llm-client.ts`;建议 61–63 全部完工。本 Phase 几乎无新增代码(允许 ≤ 50 行胶水/修复),主体是**实测对账**,不是单测。
**本 Phase 内任何一检失败 → 修复对应工具(回到所属 Phase 的 Stage)→ 重测,然后才能进入下一 Stage。**

### Stage 64.1 — 三检 (a):callgraph 实测与口径定死(实测对账)

- 在**未混淆**的 `src/mermaid` + `src/parser` 上运行 `callgraph.ts`,随机抽 10 条边人工核实;
- 据抽查决定 §1 R1 (iv) 接口边主口径(预期:展开口径,§1),写回 proposal 冻结文本与 tasks/ 模板的口径字段;
- 估算动态调用遗漏率(§13.2):抽样人检若遗漏率 > 10%,**预注册降级分支生效**——B 类任务改为只使用静态可解析调用边覆盖的题目,该决定记录落盘。

**验收标准**:10 条抽查边全部核实(或差错已修复后复检通过);接口口径决定 + 遗漏率估计 + 降级分支是否触发,三项均落盘为 `artifacts/gt/callgraph-audit.md`。

### Stage 64.2 — 三检 (b) 混淆对账 + (c) 泄漏探针(实测对账)

- **(b) 混淆对账(冻结门槛)**:跑 `obfuscate.ts` → 在混淆树上重跑 ArchGuard(`--no-cache`)生成 GT → `ground-truth.ts --reconcile` 与原始树 GT 经映射翻译逐条比对;**不一致即混淆破坏解析,修复前不得冻结**。对账过程同时产出两树完整 GT(§11 第 1 步注:此即任务实例化的输入);
- **(c) 泄漏探针(冻结门槛)**:向 `deepseek-v4-flash` 与 `gpt-5.4` 各展示 L5 样本,问"这是什么项目/这个模块做什么";答出 ArchGuard / Mermaid / 图表渲染等域内概念 → 判混淆失败,修复(扩大字符串/标识符替换面)后重测。此为本 plan 中**唯一允许先于 Phase 65 的 LLM 调用**——它不是实验任务,且是冻结门槛的组成部分(§11 第 1 步)。

**验收标准**:对账差异清单为空;两模型泄漏探针回答不含域内概念(原始问答落盘存证);两树 GT 完整落盘。

### Stage 64.3 — tasks.json 实例化、协议冻结与 git tag(§11 步骤 2–3)

- **K ≥ 50 冻结闸门(§1 R3 / §8.1 / §13.1,先于实例化判定)**:以混淆树 ArchJSON 实体实数核定锚点数 K(§8.1:"冻结时以混淆树上 ArchJSON 实体实数为准");K < 50 → 追加 `src/analysis` 为第三模块,回到 64.2 对扩池后的作用域重过混淆对账与泄漏探针,再回本 Stage;追加后仍 < 50 → 记录预注册降级"仅 Experiment A"(§13.1),降级决定随协议一并冻结(此时 Phase 66 跳过 Stage 66.2 的 B 系判定,§9 第 5 行生效);
- 基于 64.2 产出的混淆树 GT 实例化 tasks.json(A/B 各 25–30 题,两模块合并):
  - 逐题人检"答案是否依赖被替换字符串",依赖者剔除(§13.3);
  - 任务实例化主动分散覆盖实体,避开 d_task < 20 实体的不可靠区(§13.8);B 类按 64.1 定死的口径与降级决定出题;
- 锁定协议:proposal v2.1 文本(含 64.1 口径回写)、tasks.json、全部 α/效应量/K 阈值/平局规则;**打 git tag(如 `granularity-freeze-v2.1`)**;
- 冻结工件哈希:两树 GT、`mapping.json`、`tasks.json`、调用图产物逐一 SHA-256 落盘(`artifacts/gt/frozen-hashes.json`);此后任何重生成必须与冻结哈希比对,不一致即报告偏离。

**验收标准**:
- K 实数与闸门判定(含是否扩池、是否降级)落盘并随 tag 冻结;
- tasks.json 通过 63.1 schema 校验;A/B 题数各 ≥ 25;人检记录落盘;
- git tag 存在且 tag 提交包含 proposal、tasks.json、frozen-hashes.json;
- **tag 之后,Phase 59–63 的任何工具改动均须记为协议偏离**(在最终报告 §66.3 列出)。

---

## Phase 65 — 层级工件与事前预测落盘(§11 步骤 4–5,tag 后、LLM 任务前)

**依赖**:Phase 64(tag)、61、62。
**纪律**:本 Phase 不发起任何 LLM 任务调用(嵌入调用不是 LLM 任务;§11 第 5 步明示嵌入在任务之前)。

### Stage 65.1 — 生成六层级表示(§11 步骤 4)

- `gen-levels.sh` 在冻结的 `obf/` 上生成 L0–L5,含 L3/L4 调用边注入;
- 与 `frozen-hashes.json` 比对输入工件哈希,一致才继续;输出工件哈希追加落盘。

**验收标准**:六层级工件齐备;L3 Mermaid 经语法校验;L4 `callGraph` 边数与冻结调用图一致;哈希比对零偏离(或偏离已记录)。

### Stage 65.2 — 嵌入与维度估计(实测,§11 步骤 5 前半)

- `probes.ts` 产出 K × 6 探针 → `embed.py` 实跑(~700 次嵌入调用;先做 1 探针 smoke 复核确定性与 truncate 行为,§13.5);
- `dimension.py` 产出各 d_ℓ 与 CI、d_task(每任务类)、全部可靠性标记;
- **K 一致性复核**:probes.ts 实测锚点数必须与 64.3 冻结记录的 K 一致(K ≥ 50 闸门本身已在 64.3 冻结前判定,本 Stage 不再扩池);不一致即协议偏离,记录并停查原因后方可继续。若冻结记录中已含"追加 `src/analysis` 后仍 < 50"的降级决定(§13.1),Phase 66 跳过 Stage 66.2 的 B 系判定,§9 第 5 行生效;
- **d_task 闸门(§13.8)**:某任务类池化实体 < 20 → 该类 d_task 判不可靠,退出 P_GIT 主分析(仅敏感性报告);
- 多数 d_ℓ 不可靠(§8.4 CI 规则 / 0.8K 规则,预期 d_L0 大概率触发,§14.3)→ 按 §9 第 5 行预期管理,如实标记。

**验收标准**:全部嵌入带 `truncate:false` 且零静默截断(非 200 即 fatal 的日志为证);d_ℓ / d_task / CI / 可靠性标记 / 嵌入元数据 / skdim 版本全部落盘;K 一致性复核记录在案。

### Stage 65.3 — 事前预测落盘(§11 步骤 5 后半,Phase 66 的硬前置)

- `predict.ts` 产出 derivability 矩阵、H0、P_GIT(含不可靠层级跳过标记、L3/L4 平局归一);
- 带时间戳落盘并 **git commit**(`artifacts/predictions/`),commit 时间即"事前"的证明;
- P_random 的随机种子同时落盘。

**验收标准**:
- predictions commit 存在,commit 哈希与文件哈希记录在案(Phase 66 入口检查将据此核对其早于一切任务运行产物);
- 此时 `artifacts/runs/` 为空(尚无任何 LLM 任务产物)——作为"事前"的另一半机械证据;
- H0/P_GIT 对每个任务类均有明确层级输出(或标记"无判定力"原因);
- 自此 Phase 66 方可开始。

---

## Phase 66 — LLM 任务运行、对账判定与报告(§11 步骤 6–8)

**依赖**:Stage 65.3 已 commit;Phase 63。
**入口检查(强制)**:核对 `artifacts/predictions/` 的 commit 时间戳早于本 Phase 一切产物;核对 git tag 后工具零改动(有改动则列偏离清单)。

### Stage 66.1 — Experiment A 实跑(§11 步骤 6)

- `run-tasks.ts` 实跑:~55 题 × 6 层 × 5 次 × 2 模型(扣除信息不足单元),凭据经 `LLM_BASE_URL`/`LLM_API_KEY`;
- 每批前 gpt-5.4 基线探针(§13.6),漂移 → 当批作废重跑并记录;
- `score.ts` 评分 → P_oracle(平局取序号较小者)与准确率–层级曲线;
- `analyze.py` 判定 A1(Wilcoxon + ΔF1≥0.1)、A2(argmax 非端点)、A3(bootstrap CI 下界 > 0)。

**验收标准**:全部调用结果与种子/采样参数/基线记录落盘;断点续跑日志完整(无重复计费);A1–A3 判定位输出(**不成立也如实落盘**);A3 不成立 → 标记 B2 预计塌缩(§7)。

### Stage 66.2 — Experiment B 对账与 §9 判定(§11 步骤 7)

- 按 §8.3 对账 B1(P_GIT vs P_random,McNemar,**且命中率不低于 H0**)、B2(判别子集 ≥ 8,P_GIT vs H0,McNemar)、B3(Spearman 负相关)、B4(L3/L4 格式敏感性,次级);
- 按 §9 五行决策表**按行序判定,命中即止**;判别子集 < 8、K < 50 或多数 d_ℓ 不可靠 → 第 5 行(仅报告 Experiment A,不作 GIT 方向性结论);
- 敏感性分析:剔除不可靠 d_ℓ 重算 P_GIT;d_task 不可靠任务类单列;B 类双口径(接口/展开)副口径结果并报。

**验收标准**:B1–B4 判定位 + §9 命中行落盘;判别子集成员清单落盘;全部敏感性分析结果落盘。

### Stage 66.3 — 最终报告(§11 步骤 8)

- 报告全部结果,**含未达预测的**;
- 协议偏离清单:tag 后工具改动、哈希不一致、作废重跑批次、降级分支触发记录、重建条款风险(§13.7/§13.9)的最终处置;
- 成本与规模实数 vs §11 估算(~3,300 任务调用 + ~700 嵌入调用)。

**验收标准**:报告落盘于 `experiments/granularity/REPORT.md`(实验产物,非项目文档);§9 判定结论与决策表行号一一对应;无任何"按结果改预测"痕迹(预测文件哈希与 65.3 commit 一致)。

---

## 测试策略

**TDD**:Phase 59–63 全部脚本先写测试再实现;TS 用目录内 vitest(`experiments/granularity/` 局部安装,不污染主套件),Python 用 pytest。**覆盖率门槛:harness 源码 ≥ 80%**(vitest coverage + pytest-cov 分别统计)。

**关键单测点(必有)**:
- `callgraph.ts` 判定口径 **(i)–(iv) 每条独立用例**(正/反两侧);
- `embed.py` **chunk 聚合的确定性测试**(固定假嵌入下逐位可复现)与边界用例;
- `dimension.py` **TwoNN 包装的已知流形 sanity 测试**(2 维平面/5 维超立方嵌入高维);
- `predict.ts` P_GIT 全部边界规则(fallback L5、不可靠跳过、L3/L4 平局)逐条用例;
- `run-tasks.ts` 分模型采样参数、断点续跑、prompt 不含 mapping 原名。

**实测对账环节(非单测,以落盘证据验收)**:
- 混淆对账(64.2b)、泄漏探针(64.2c)、callgraph 10 边人工抽查与遗漏率估计(64.1)——三检本质是对真实仓库/真实模型的对账;
- 嵌入服务确定性与 `truncate:false` 透传(§6/§8.1 已实测,65.2 仅 smoke 复核);
- gpt-5.4 隐藏注入基线(63.2 实现探针,66.1 每批实测);
- 冻结哈希比对(64.3 / 65.1)。

**凭据纪律**:全部测试用 mock HTTP/LLM client,CI 可在无凭据环境运行;实跑脚本仅经 `LLM_BASE_URL` / `LLM_API_KEY` 环境变量取凭据,任何文件不落盘 key。

## 行数预算核对

| Phase | 源码 | 测试 | Stage 上限核对 |
| --- | --- | --- | --- |
| 59 | ~470 | ~310 | 各 Stage ≤ 190 |
| 60 | ~480 | ~330 | 各 Stage ≤ 190 |
| 61 | ~480 | ~280 | 各 Stage ≤ 170 |
| 62 | ~460 | ~280 | 各 Stage ≤ 160 |
| 63 | ~420 | ~230 | 各 Stage ≤ 190 |
| 64 | ≤ 50(胶水) | — | 实测对账为主 |
| 65 | ≤ 30(胶水) | — | 实跑为主 |
| 66 | ≤ 30(胶水) | — | 实跑 + 报告 |

每个 Stage ≤ 200 行源码、每个 Phase ≤ 500 行源码,均满足;`obfuscate.ts` 与 `callgraph.ts` 因预计超限已各拆两个 Stage。
