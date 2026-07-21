# GIM A/B/C 实验 — 组 B 结果

## 当前状态评估

ArchGuard 整体架构健康，`sccCount=0` 表明无循环依赖，基础结构良好。然而 `giniInDegree=0.776` 处于监控区间上沿（0.7–0.85），显示依赖集中度偏高——`src/types`（fanIn=196）和 `src/types/extensions`（fanIn=53，同时 fanOut=57）是两个高负荷枢纽，任何变更都会产生广泛影响。`src/plugins/golang` 的 fanOut=95 远超警戒线 60，说明该包职责过于发散。近 5 个 commit（plan-50 至 plan-52）均为新功能扩张（FIM、LLM 语义探索、指标观测台），依据规则"最近多为新功能时应提议重构"，当前时机适合启动结构性治理。

---

## 三项改进方案

---

### Plan 53 — `src/types` 类型枢纽拆分与稳定化

**类型标签**：`contraction`（收缩 / 结构重构）

**优先级理由**：`src/types` fanIn=196，是全项目最高耦合节点，远超"高耦合支柱"阈值 50；`src/types/extensions` fanOut=57 同样超过 60 警戒线临界。两个节点共同拉高 `giniInDegree`，是降低集中度的首要抓手。

**方案描述**：
将 `src/types` 按领域拆分为以下子模块：
- `src/types/arch` — 核心 ArchJSON 数据结构（Entity、Relation、ArchJSON）
- `src/types/config` — 配置相关类型（GlobalConfig、DiagramConfig 等）
- `src/types/plugin` — 插件接口类型（ILanguagePlugin、SupportedLanguage）
- `src/types/extensions` — 保留，但清理 fanOut，将对外依赖下沉至具体插件层

每个子模块通过 `src/types/index.ts` 统一再导出，保持对外兼容性，逐步迁移内部 import 路径。

**预期 MetricVector 影响**：
- `giniInDegree`：0.776 → 预计 0.70–0.72（降至安全区间）
- `maxInDegree`：22 → 维持或略降
- `sccCount`：维持 0

**工作量估算**：`M`（需逐文件更新 import，但无逻辑变更）

---

### Plan 54 — `src/plugins/golang` fanOut 收敛重构

**类型标签**：`contraction`（收缩 / 依赖整合）

**优先级理由**：`src/plugins/golang` fanOut=95，超过阈值 60 近 60%，是全项目最发散包。Atlas 子包（fanOut=30、fanIn=55）已具备独立存在的规模，但父包仍对其保持直接耦合，形成双向依赖压力。

**方案描述**：
1. **Atlas 完全独立化**：将 `src/plugins/golang/atlas/` 提升为独立插件模块 `src/plugins/golang-atlas/`，与 `src/plugins/golang/` 平级，通过 plugin-registry 注册而非父包直接引用
2. **内部依赖收敛**：提取 golang 插件内的公共工具到 `src/plugins/shared/golang-utils.ts`，减少 golang 包对 shared 的散点式依赖
3. **入口瘦身**：`src/plugins/golang/index.ts` 只保留 ILanguagePlugin 实现，将 tree-sitter 桥接、类型提取等职责下沉到各自子文件

**预期 MetricVector 影响**：
- `src/plugins/golang` fanOut：95 → 目标 ≤50
- `packageCount`：47 → ~49（+2 新包）
- `giniInDegree`：轻微改善（约 0.76）
- `sccCount`：维持 0（需在重构中严格验证）

**工作量估算**：`L`（涉及模块边界重划、注册机制调整、全量测试验证）

---

### Plan 55 — MCP 工具层业务逻辑下沉至 Analysis 层

**类型标签**：`maintenance`（维护 / 分层治理）

**优先级理由**：`src/cli/mcp/tools` 当前 fanOut=47，逼近警戒线，且直接承载查询逻辑、格式化逻辑和业务计算。MCP 工具层应仅做"协议适配"，业务逻辑应属于 `src/analysis/` 或 `src/core/`。ADR-006 中已有此方向的要求，现在是执行时机。

**方案描述**：
1. 从 `src/cli/mcp/tools/*.ts` 中提取纯业务函数，迁移至 `src/analysis/` 对应域文件
2. MCP 工具文件退化为薄适配器：参数校验 → 调用 analysis 层 → 格式化输出
3. 为 analysis 层新增单元测试（当前 tools 层逻辑难以独立测试）
4. 建立分层约束：禁止 `src/analysis/` 反向依赖 `src/cli/`（可用 ESLint import boundary 规则守护）

**预期 MetricVector 影响**：
- `src/cli/mcp/tools` fanOut：47 → 目标 ≤20
- `src/analysis/` fanIn：提升（成为新的稳定依赖目标）
- 测试覆盖率：analysis 层新增覆盖，整体 orphan rate 下降
- `giniInDegree`：轻微改善（依赖分布更均匀）

**工作量估算**：`M`（纯搬迁 + 测试补充，无新功能）
