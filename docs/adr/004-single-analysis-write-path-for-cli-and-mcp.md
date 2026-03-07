# ADR-004: CLI 与 MCP 必须共享单一分析写盘路径

**状态**: Proposed
**日期**: 2026-03-07
**上下文**: [proposal-mcp-analyze-tool.md](../proposals/proposal-mcp-analyze-tool.md)
**决策者**: ArchGuard 架构团队

---

## 上下文

ArchGuard 目前已经有一条成熟的 CLI 分析路径：[src/cli/commands/analyze.ts](/home/yale/work/archguard/src/cli/commands/analyze.ts)。

随着 `archguard_analyze` MCP tool 的引入，系统将同时存在两种触发分析的入口：

- CLI: `archguard analyze`
- MCP: `archguard_analyze`

如果这两个入口各自维护一套分析和写盘流程，几乎必然出现以下问题：

1. 一方新增了产物，另一方漏掉
2. 一方调整了 scope 持久化，另一方仍用旧逻辑
3. 两边生成的 `.archguard/output/*` 或 `.archguard/query/*` 逐步漂移
4. 回归 bug 时，很难判断问题在“分析核心”还是“某个入口包装层”

这个风险不是理论上的。当前 CLI 路径已经把“执行分析”“打印结果”“退出码控制”耦合在一起；如果 MCP 为了绕过这些副作用而复制一份分析逻辑，分叉会从第一天开始累积。

---

## 决策驱动因素

- CLI 与 MCP 的磁盘文件输出必须保持一致
- 允许 CLI 与 MCP 的返回表现不同，但不允许写盘语义不同
- 分析流程会继续增量演化，必须有防分叉机制
- query layer 依赖 `.archguard/query/*` 的确定性与完整性
- 架构上应把“入口适配”和“分析写盘”分层

---

## 备选方案

### 方案 A: CLI 与 MCP 各自维护分析流程

**优点**

- 接入快
- 各入口可以针对自己的交互方式独立优化

**缺点**

- 磁盘产物必然漂移
- 新增写盘逻辑时需要双改
- 测试矩阵膨胀
- 代码审查难以发现隐性分叉

### 方案 B: CLI 作为权威路径，MCP 通过 subprocess 调 CLI

**优点**

- 理论上只有一条写盘路径
- 复用现有 CLI 逻辑

**缺点**

- stdio MCP 场景下 stdout 污染风险高
- 结构化结果难获取
- 错误处理、超时和路径控制更脆弱
- 仍然把 CLI 的人类终端语义绑定到 MCP 场景

### 方案 C: 抽出共享分析核心，CLI 与 MCP 作为薄包装

**优点**

- 真正只有一条分析写盘路径
- CLI 与 MCP 只在展示层和会话层分化
- 最利于长期演进与测试
- 最容易验证磁盘产物一致性

**缺点**

- 需要先做一次分析核心抽取
- 需要补齐共享核心测试和等价测试

---

## 决策

采纳**方案 C**。

建立一个共享分析核心，例如 `runAnalysis()`，并将其定义为：

- CLI 与 MCP **唯一允许**调用的分析写盘入口
- 所有分析相关磁盘副作用的唯一宿主
- 后续新增分析产物时的唯一接入点

CLI 与 MCP 只允许在以下职责上保持差异：

- 参数解析
- 交互输出
- 退出码 / MCP 响应
- MCP 会话内的 engine/scope 刷新

CLI 与 MCP **不允许**在以下方面各自实现：

- `DiagramProcessor` 驱动流程
- query scopes 持久化
- diagram manifest 写盘
- `output/index.md` 生成
- 未来任何新的分析产物写盘

---

## 后果

### 正面影响

- CLI 与 MCP 的磁盘产物一致性有明确架构边界
- 新增分析产物时只需改一处
- 问题定位更容易收敛到共享核心
- 可以建立稳定的 CLI/MCP 等价测试

### 负面影响

- 前期需要重构 [analyze.ts](/home/yale/work/archguard/src/cli/commands/analyze.ts)
- 共享核心 API 需要被认真设计，不能只是简单搬运代码
- 一些历史上散落在 CLI 层的副作用需要重新分层

---

## 实施要求

### 1. 共享核心独占写盘职责

至少包括：

1. `ConfigLoader.load()`
2. `normalizeToDiagrams()`
3. `cleanStaleDiagrams()`
4. `DiagramProcessor.processAll()`
5. `writeManifest()`
6. `persistQueryScopes()`
7. `DiagramIndexGenerator.generate()`
8. 未来新增的分析产物写盘逻辑

### 2. 禁止入口层绕过共享核心

- CLI 不得直接拼装新的写盘流程
- MCP 不得直接调用 `persistQueryScopes()` 等持久化函数
- 如果入口层需要差异化行为，只能体现在展示层，不得体现在写盘层

### 3. 建立长期回归护栏

必须保留两类测试：

- 共享核心产物测试：直接验证 `runAnalysis()` 的磁盘输出
- CLI / MCP 等价测试：同一 fixture 上比较两种入口的最终产物

比较时应归一化以下不稳定信息：

- 时间戳
- 运行耗时
- 绝对路径

---

## 代码审查规则

以后凡是修改分析流程的 PR，评审时必须检查：

1. 是否只修改了共享分析核心，而不是在 CLI/MCP 两边分开补逻辑
2. 是否新增或更新了共享核心测试
3. 是否影响 CLI / MCP 磁盘产物等价性

如果一个改动只影响 CLI 写盘逻辑或只影响 MCP 写盘逻辑，应视为违反本 ADR。

---

## 相关决策

- [proposal-mcp-analyze-tool.md](../proposals/proposal-mcp-analyze-tool.md)
