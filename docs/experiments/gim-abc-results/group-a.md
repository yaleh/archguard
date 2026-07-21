# GIM A/B/C 实验 — 组 A 结果

## 当前状态评估

ArchGuard 目前处于**扩张-收缩交界临界点**。经历 plan-01 至 plan-52 的持续扩张后，系统积累了显著的结构压力：`src/types`（fanIn=196）和 `src/types/extensions`（fanIn=53，fanOut=57）已高度**支柱化**，承载着几乎全部模块的类型依赖，正从"晶体化"演变为**瓶颈**。`src/plugins/golang`（fanOut=95）则呈现极端的**发散态**，其对外依赖广度已逼近可维护边界。sccCount=0 表明拓扑健康、无环依赖，这是收缩重组的有利时机。giniInDegree=0.776 揭示依赖分布高度偏斜，少数节点承压过重。L(X) = L(G) + L(R|G) 层面，当前 G（结构）的描述成本仍可压缩——`types/extensions` 的双高 fanIn/fanOut 是最明显的"描述长度浪费"信号。系统具备充分的测试覆盖（3946 tests，sccCount=0），**进入收缩相的条件已成熟**。

---

## 三项 Plan 提案

---

### Plan 1：`types/extensions` 职责拆分与稳定化

**类型标签**：`[收缩]`

**优先级理由**：`src/types/extensions` 同时拥有 fanIn=53 和 fanOut=57，是系统中唯一的"双高"节点——既是被依赖的核心枢纽，又对外发散 57 条出边，违反了**晶体化**节点应有的低 fanOut 稳定特征。这意味着每次扩展新语言插件，extensions.ts 都被迫膨胀，造成所有 53 个依赖方的间接耦合。按 L(R|G) 分析，该节点贡献了过高的条件描述成本。

**执行要点**：
- 将 `extensions.ts` 按能力域拆分：`test-analysis-extensions.ts`、`atlas-extensions.ts`、`git-history-extensions.ts`、`metrics-extensions.ts`
- 保留 `extensions/index.ts` 作为向后兼容的重导出桶（barrel），逐步迁移直接导入
- 为每个子扩展文件建立独立的 vitest 类型测试

**预期 MetricVector 变化**：
- `giniInDegree` 小幅下降（枢纽压力分散）
- `src/types/extensions` maxOutDegree 从 57 降至各子文件 ≤15
- packageCount +3~4，totalRelations 短期微增后随重组下降

**工作量估算**：**M**（约 3-5 天，无逻辑变更，纯重组）

---

### Plan 2：`src/plugins/golang` 内部架构收束（Atlas 与 Core 解耦）

**类型标签**：`[收缩]`

**优先级理由**：`src/plugins/golang`（fanOut=95）是系统中 fanOut 最高的节点，而 `src/plugins/golang/atlas`（fanOut=30）作为其子包已独立进入 Top-10 高 fanIn 列表（fanIn=55）。这表明 golang 插件内部发生了**隐性支柱竞争**：atlas 子系统的规模和依赖广度已足以作为独立模块存在，但仍被包裹在 golang 插件边界内，导致父包 fanOut 虚高。

**执行要点**：
- 将 `src/plugins/golang/atlas/` 提升为独立插件层：`src/plugins/golang-atlas/`，实现独立的能力接口
- GoPlugin core 仅保留 AST 解析和基础 ArchJSON 生成，Atlas 能力通过组合注入（而非继承/直接引用）
- 更新 `plugin-registry.ts` 注册逻辑，支持 capability 叠加模式

**预期 MetricVector 变化**：
- `src/plugins/golang` fanOut：95 → ≈40（Atlas 相关引用解除）
- packageCount +1，giniInDegree 小幅改善

**工作量估算**：**L**（约 1-2 周，涉及接口重设计与多处注册逻辑调整）

---

### Plan 3：`src/types` 核心类型冻结与访问层引入

**类型标签**：`[维护/收缩]`

**优先级理由**：`src/types`（fanIn=196）已是系统中无可争议的**核心晶体**，但 fanIn 持续攀升意味着任何类型变更的波及范围极广，变更成本呈超线性增长。当前阶段无需拆分 types 本身，但需建立**访问层隔离**机制，防止插件层和 CLI 层直接依赖 types 内部细节，将直接耦合转化为通过 `core/interfaces` 中转的间接耦合。

**执行要点**：
- 在 `src/core/interfaces/` 中为各插件能力建立"插件视角类型别名"，插件层仅 import from `@/core/interfaces`，不直接 import from `@/types`
- 对 `src/types` 中频繁变动的字段标注 `@internal`，通过 ESLint 规则限制跨层直接访问
- 建立类型依赖图的 CI 快照检查，在 fanIn 超过 220 时触发告警

**预期 MetricVector 变化**：
- `src/types` fanIn 增长趋势减缓（短期可能小幅下降至 170-180）
- `src/core/interfaces` fanIn 适度上升（承接部分依赖）
- 长期：L(G) 描述成本稳定，避免无序膨胀

**工作量估算**：**S**（约 2-3 天，以 lint 规则和接口补充为主，不涉及运行时逻辑）
