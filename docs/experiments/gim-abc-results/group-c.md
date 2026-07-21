# GIM A/B/C 实验 — 组 C 结果

## 当前状态评估

ArchGuard 已完成从单一 TypeScript 解析器到多语言架构分析平台的演进，核心能力成熟（6 语言、25+ MCP 工具、3946 测试、零循环依赖）。当前最突出的结构性问题是 **依赖集中度过高**：`src/types`（fanIn=196）和 `src/types/extensions`（fanIn=53，同时 fanOut=57）承载了全项目的类型契约，任何修改都会触发大面积连锁影响。`src/plugins/golang`（fanOut=95）高度发散，说明 Go 插件内部职责混杂。`giniInDegree=0.776` 处于高度倾斜区，表明架构正在向"上帝模块"模式退化。在扩张阶段大量叠加功能之后，现在是 **战略性收缩与重构** 的窗口期。

---

## 三项 Plan 提案

---

### Plan 53 — 类型层分层拆分（Type Stratification）

**类型标签**：`contraction`

**优先级排序理由**：`src/types`（fanIn=196）是全项目最高风险点——196 个包依赖同一个类型模块，意味着任何接口变更的影响半径覆盖整个代码库。`src/types/extensions` 同时拥有 fanIn=53 和 fanOut=57，形成"类型交换机"反模式，是架构熵增的主要来源。这是所有后续重构的前置条件：不解决类型层的耦合，其他模块的拆分都会受阻。

**具体方向**：
- 将 `src/types` 按用途分层：`src/types/core`（原语、基础接口）、`src/types/analysis`（分析结果类型）、`src/types/plugin`（插件契约类型）、`src/types/mcp`（MCP 工具 I/O 类型）
- 将 `src/types/extensions` 中的 ArchJSON 扩展类型归入 `src/types/plugin`，MCP 响应类型归入 `src/types/mcp`
- 对每一层建立单向依赖约束：`mcp` → `analysis` → `plugin` → `core`

**预期对 MetricVector 的影响**：
- `src/types` fanIn：196 → 预期降至 60-80（只有真正需要核心类型的包依赖 `core` 层）
- `giniInDegree`：0.776 → 预期降至 0.55-0.65（依赖分布更均匀）
- `packageCount`：33 → 预期增至 37-40（类型层细分）
- `sccCount`：维持 0（通过单向约束保证）

**预估工作量**：M（需要全项目 import 路径更新，但无逻辑变更；可配合 tsconfig path alias 平滑迁移）

---

### Plan 54 — Go 插件职责收敛（Golang Plugin Cohesion）

**类型标签**：`contraction`

**优先级排序理由**：`src/plugins/golang` 以 fanOut=95 位居全项目之首，远超第二名（`src/types/extensions` fanOut=57）。高 fanOut 是"上帝类"在包级别的体现——该包知道太多外部细节，任何外部变更都会穿透到 Go 插件。同时 `src/plugins/golang/atlas`（fanIn=55）作为子包被大量引用，说明 Atlas 能力应当作为独立模块对外暴露，而不是通过父包间接访问。

**具体方向**：
- 将 Go 插件拆分为三个独立包：
  - `src/plugins/golang/core`：纯解析逻辑（tree-sitter + gopls，无 Atlas 依赖）
  - `src/plugins/golang/atlas`：保持现状，但对外暴露清晰的 API 边界
  - `src/plugins/golang/index.ts`：仅作组合入口，fanOut 目标 ≤ 20
- 消除 `src/plugins/golang` 对 Atlas 内部实现的直接依赖，改为通过接口调用
- 将 Go 测试分析（`_test.go` 处理）抽取到 `src/plugins/golang/test-bridge.ts`

**预期对 MetricVector 的影响**：
- `src/plugins/golang` fanOut：95 → 预期降至 20-30
- `src/plugins/golang/atlas` fanIn：55 → 维持或略降（依赖关系更清晰）
- `maxOutDegree` 间接改善，整体 `giniInDegree` 受益

**预估工作量**：M（涉及 Go 插件内 37 个实体的重组，需同步更新 diagram-processor.ts 中的调用路径）

---

### Plan 55 — MCP 工具业务逻辑下沉（MCP Tool Logic Extraction，ADR-006 实施）

**类型标签**：`maintenance`

**优先级排序理由**：`src/cli/mcp/tools`（fanOut=47，18 个实体）目前将查询逻辑、格式化逻辑和 MCP 协议处理混写在工具层。与已有 backlog 中 ADR-006 要求直接对应。此 Plan 的价值在于：① 使 MCP 工具层退化为薄适配器，降低 fanOut；② 让 `src/core/query` 和 `src/analysis` 层可被 CLI 命令直接复用；③ 为集成测试提供干净的底层基础。

**具体方向**：
- 将每个 MCP 工具中的核心计算逻辑提取到 `src/analysis/<domain>-service.ts`
- MCP 工具层只负责：参数解析 → 调用 analysis service → 格式化 MCP 响应
- `src/core/query/arch-metrics.ts` 的拆分工作（按 domain 分文件）纳入本 Plan，与已计划的 `arch-metrics-cognitive.ts`、`arch-metrics-quality.ts`、`arch-metrics-structure.ts` 合并推进
- 目标：`src/cli/mcp/tools` fanOut ≤ 20

**预期对 MetricVector 的影响**：
- `src/cli/mcp/tools` fanOut：47 → 预期降至 15-20
- `src/core/query` fanIn：31 → 预期升至 40-50（成为真正的分析服务中心）
- `totalRelations` 可能略降（消除 MCP 层到底层实现的直接跨层依赖）
- 测试覆盖率提升（analysis service 层比 MCP 工具层更易单元测试）

**预估工作量**：S-M（已有文件骨架；主要工作是迁移和接线，估计 1-2 天）

---

## 执行建议

建议顺序：Plan 55 先行（风险最低，3-5 天见效），Plan 53 并行启动（需要全项目 import 扫描），Plan 54 最后（依赖 Plan 53 完成类型边界稳定后再动插件层）。
