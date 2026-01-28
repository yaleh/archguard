# ArchGuard 实施计划 (RLM 方法)

**计划集合**: ArchGuard MVP 开发计划
**方法论**: RLM (Refactoring Lifecycle Management)
**开发方法**: TDD (Test-Driven Development)
**创建日期**: 2026-01-25

---

## 📋 计划概览

本目录包含 ArchGuard 项目的完整实施计划，遵循 RLM 方法论的六个阶段（PROPOSAL → PLANNING → EXECUTION → VALIDATION → INTEGRATION → MONITORING），采用 TDD 方法进行开发。

**核心目标**: 实现**高效代码指纹提取** + **Claude Code 命令行驱动的 PlantUML 文档生成**

---

## 📚 文档清单

### [00-implementation-plan.md](./00-implementation-plan.md)
**📊 主实施计划 - 总纲**

**内容**:
- RLM 六个阶段的完整覆盖
- 项目目标和范围
- 技术架构设计
- 迭代划分（Phase 0-3）
- TDD 开发流程
- 质量门控和验收标准
- 监控指标

**适用人群**: 所有团队成员
**阅读优先级**: ⭐⭐⭐⭐⭐ (必读)

**关键章节**:
- 第 1 章: RLM PROPOSAL - 项目提案
- 第 2 章: RLM PLANNING - 计划阶段
- 第 3 章: RLM EXECUTION - 执行阶段
- 第 4 章: RLM VALIDATION - 验证阶段
- 第 5 章: RLM INTEGRATION - 集成阶段
- 第 6 章: RLM MONITORING - 监控阶段

---

### [01-phase1-code-fingerprint.md](./01-phase1-code-fingerprint.md)
**🔍 Phase 1: 代码指纹提取 (TDD)**

**预计时间**: 3-4 天
**核心技术**: ts-morph

**内容**:
- TDD 测试用例设计（6 个 Stories）
- 红-绿-重构循环示例
- 详细的日度实施计划
- 代码结构和关键实现
- 性能优化策略
- 验收测试清单

**适用人群**: 开发者、TDD 实践者
**阅读优先级**: ⭐⭐⭐⭐⭐

**关键特性**:
- ✅ 类、接口、枚举提取
- ✅ 方法、属性、构造函数解析
- ✅ 装饰器支持
- ✅ 关系识别（继承、组合、依赖）
- ✅ 生成标准化 Arch-JSON

**验收标准**:
- 测试覆盖率 ≥ 80%
- 解析 ArchGuard 项目 < 2s
- 内存使用 < 200MB

---

### [02-phase2-claude-code-integration.md](./02-phase2-claude-code-integration.md)
**🤖 Phase 2: Claude Code CLI 集成与文档生成 (TDD)**

**预计时间**: 3-4 天
**核心技术**: Claude Code 命令行工具

**内容**:
- Claude Code CLI 封装
- 提示词模板设计
- PlantUML 生成与验证
- 输出解析与处理
- 错误处理策略
- 集成测试

**适用人群**: CLI 集成工程师、提示词工程师
**阅读优先级**: ⭐⭐⭐⭐⭐

**关键特性**:
- ✅ Claude Code CLI 封装
- ✅ 提示词模板系统
- ✅ PlantUML 语法验证
- ✅ 自动重试机制
- ✅ 输出解析器

**验收标准**:
- PlantUML 语法正确率 ≥ 95%
- CLI 调用成功率 ≥ 99%
- 输出解析准确率 100%
- 生成时间 < 10s

---

### [03-phase3-cli-optimization.md](./03-phase3-cli-optimization.md)
**🛠️ Phase 3: CLI 开发与系统优化 (TDD)**

**预计时间**: 2-3 天
**核心技术**: commander, ora, chalk, inquirer

**内容**:
- CLI 框架搭建 (commander)
- 进度显示与用户体验
- 缓存机制实现
- 错误处理优化
- 配置文件支持
- 并行处理与性能优化

**适用人群**: 开发者、DevOps 工程师
**阅读优先级**: ⭐⭐⭐⭐⭐

**关键特性**:
- ✅ 命令行界面 (analyze, init, cache)
- ✅ 实时进度指示器
- ✅ 智能缓存系统
- ✅ 友好错误提示
- ✅ 配置文件支持 (.json/.js)
- ✅ 并行文件解析

**验收标准**:
- CLI 命令正常工作
- 完整流程 < 10s
- 缓存命中率 > 80%
- 用户满意度 ≥ 4.5/5
- 测试覆盖率 ≥ 80%

---

### [04-phase4-config-cli-improvements.md](./04-phase4-config-cli-improvements.md)
**⚙️ Phase 4: 配置与 CLI 管理机制改进 (TDD)**

**预计时间**: 6-9 个工作日
**核心技术**: zod, commander, execa
**对应提案**: [05-config-and-cli-improvements.md](../proposals/05-config-and-cli-improvements.md)

**内容**:
- 可配置的 Claude CLI 命令（默认 `claude`）
- 可配置的 CLI 额外参数
- 可配置的输出目录（默认 `./archguard`）
- 完善的配置优先级机制
- 向后兼容性保证
- TDD 测试用例设计

**适用人群**: 开发者、DevOps 工程师
**阅读优先级**: ⭐⭐⭐⭐

**关键特性**:
- ✅ CLI 命令完全可配置
- ✅ 统一的输出目录管理
- ✅ 100% 向后兼容
- ✅ 配置优先级清晰（CLI > 配置文件 > 默认值）
- ✅ 深度配置合并

**验收标准**:
- 配置灵活性: 支持的配置项数量 +50%
- 测试覆盖率 ≥ 80%
- 向后兼容性 100%
- 文档完整性 100%

---

### [07-advanced-cli-features-plan.md](./07-advanced-cli-features-plan.md)
**🚀 Phase 7: 高级 CLI 功能增强实施计划**

**预计时间**: 10-12 个工作日（含 20% 缓冲）
**核心技术**: globby, commander, fs-extra
**对应提案**: [07-advanced-cli-features.md](../proposals/07-advanced-cli-features.md)

**内容**:
- 多源支持（Multi-source）- 支持多个路径和 glob 模式
- 标准输入支持（STDIN）- 管道集成
- 输出路径定制 - 灵活的输出路径解析
- 批处理模式（Batch Mode）- 多模块分析与索引生成

**适用人群**: 开发者、DevOps 工程师、Monorepo 用户
**阅读优先级**: ⭐⭐⭐⭐⭐

**核心模块**:
- `FileDiscoveryService` - 统一文件发现服务（Glob + STDIN）
- `OutputPathResolver` - 输出路径解析与冲突处理
- `BatchProcessor` - 批量分析编排器
- `IndexGenerator` - Markdown 索引页生成器

**实施阶段**:
- Phase 1: Multi-source 支持（2 天）
- Phase 2: 输出定制（2 天）
- Phase 3: STDIN 支持（3 天）
- Phase 4: 批处理模式（3 天）

**验收标准**:
- CLI 向后兼容性 100%
- 测试覆盖率 ≥ 85%
- 批处理性能: 10 模块 < 30s
- 配置文件支持所有新参数

---

### [08-claude-code-subagent-integration-plan.md](./08-claude-code-subagent-integration-plan.md)
**🤖 Phase 8: Claude Code Subagent 集成实施计划**

**预计时间**: 4-6 个工作日
**核心技术**: Claude Code Skills API
**对应提案**: [08-claude-code-subagent-integration.md](../proposals/08-claude-code-subagent-integration.md)

**内容**:
- Claude Code Skill 开发
- 智能项目类型检测（Monorepo/Microservices/Layered/Single）
- 5 阶段执行工作流（检测→扫描→分析→呈现→增量）
- 模板与示例
- 社区推广与文档

**适用人群**: Skill 开发者、ArchGuard 高级用户
**阅读优先级**: ⭐⭐⭐⭐

**核心文件**:
- `skill.json` - Skill 元数据与激活配置
- `instructions.md` - 5 阶段执行逻辑
- `templates/` - 3 个 Markdown 模板（索引、摘要、洞察）
- `examples/` - 4 个典型场景示例

**实施阶段**:
- Phase 1: 基础设施（1 天）
- Phase 2: 核心逻辑（2-3 天）
- Phase 3: 模板与示例（1 天）
- Phase 4: 测试（1-2 天）
- Phase 5: 文档与推广（1 天）

**验收标准**:
- Skill 激活成功率 > 95%
- 项目类型检测准确率 > 90%
- 完整文档和示例
- 至少 1 次社区分享

---

### [09-multi-level-architecture-diagrams-plan.md](./09-multi-level-architecture-diagrams-plan.md)
**🏗️ Phase 9: 多层次架构图生成实施计划 (v2.0 Breaking Change)**

**预计时间**: 5-7 个工作日（纯开发），7 周总计（含测试和发布）
**核心技术**: DiagramConfig 统一抽象、ArchJSONAggregator、配置驱动架构
**对应提案**: [09-multi-level-architecture-diagrams.md](../proposals/09-multi-level-architecture-diagrams.md)

**内容**:
- 统一参数机制重构（移除 --batch、-o 等参数）
- 详细程度控制（package/class/method 三级）
- 配置优先设计（diagrams[] 数组）
- 单一处理流程（DiagramProcessor）
- ArchJSON 聚合器（新组件）
- 迁移工具和文档

**适用人群**: 核心开发者、架构师、大型项目维护者
**阅读优先级**: ⭐⭐⭐⭐⭐

**核心组件**:
- `DiagramProcessor` - 统一图表处理器（替代 BatchProcessor）
- `ArchJSONAggregator` - 详细程度聚合器（package/class/method）
- `normalizeToDiagrams()` - 配置规范化函数
- 扩展的 Prompt 模板（支持 DETAIL_LEVEL）
- 迁移工具（v1.x → v2.0）

**实施阶段**:
- Phase 1: 类型定义和配置（1 天）
- Phase 2: 核心组件（2-3 天）
- Phase 3: Prompt 和 AI（1-2 天）
- Phase 4: 测试（2 天）
- Phase 5: 文档和迁移（1 天）

**验收标准**:
- 代码复杂度降低 ≥ 20%
- 测试覆盖率 ≥ 80%
- 功能采用率 > 40%（6个月内）
- 生成成功率 > 95%
- 迁移成功率 > 90%

**Breaking Changes**:
- ⚠️ 移除 `--batch`、`-o`、`--stdin` 参数
- ⚠️ 配置文件结构完全重构
- ⚠️ 需要主版本升级（v2.0.0）

---

### [10-mermaid-diagram-migration-plan.md](./10-mermaid-diagram-migration-plan.md)
**🎨 Mermaid 图表迁移 - 混合智能架构与五层验证 (v2.0 Breaking Change)**

**预计时间**: 3 周开发 + 4 周测试/发布 = 7 周总计

**核心技术**: isomorphic-mermaid、混合智能架构、五层验证策略

**关联 Proposals**:
- [10-mermaid-diagram-migration.md](../proposals/10-mermaid-diagram-migration.md) (RLM 分析)
- [10-mermaid-technical-analysis.md](../proposals/10-mermaid-technical-analysis.md) (技术调研)
- [10-mermaid-validation-strategy.md](../proposals/10-mermaid-validation-strategy.md) (验证策略)

**内容**:
- 完全移除 PlantUML，迁移到 Mermaid
- 混合智能架构：LLM 决策层 + JS 确定性生成
- 五层验证策略保障质量
  - Layer 1: 语法生成验证
  - Layer 2: 即时语法验证（mermaid.parse）
  - Layer 3: 结构完整性检查（AST）
  - Layer 4: 渲染验证（isomorphic-mermaid）
  - Layer 5: 质量分析（可读性、复杂度）
- 本地渲染（isomorphic-mermaid，轻量级无浏览器依赖）
- 完整的 RLM 六阶段分析

**适用人群**: 架构师、技术负责人、全体开发人员
**阅读优先级**: ⭐⭐⭐⭐⭐ (Breaking Change - 所有相关人员必读)

**关键章节**:
- 技术架构设计（当前 PlantUML vs 新 Mermaid 架构）
- 混合智能架构详解（LLM 分组 + JS 生成）
- 五层验证策略详解（每层实现代码示例）
- 实施阶段划分（Phase 0-6）
  - Phase 0: POC 验证（Day 1-2）
  - Phase 1: 核心组件开发（Week 1）
  - Phase 2: LLM 集成和配置（Week 2）
  - Phase 3: 验证管道实现（Week 2-3）
  - Phase 4: 集成和测试（Week 3）
  - Phase 5: 文档和迁移（Week 4-5）
  - Phase 6: 发布和监控（Week 6-7）
- 质量门控与验收标准
- 风险管理（技术风险 + 项目风险）
- 发布计划（Alpha → Beta → RC → 正式发布）
- 监控与持续改进

**核心改进**:
- ✅ 错误率：40-60% → <1% (**-98%**)
- ✅ 首次通过率：~5% → >95% (**+90%**)
- ✅ 生成速度：30-60s → 5-10s (**5x**)
- ✅ LLM 成本：-70% Token 消耗（2,000 vs 10,000-17,000）
- ✅ 维护成本：-80% (JS 完全可控，无 prompt 调优)

**Breaking Change**:
- ⚠️ 完全移除 PlantUML 支持（不保留向后兼容）
- ⚠️ 配置文件结构完全重构（必须使用 `format: "mermaid"`）
- ⚠️ 需要主版本升级（v2.0.0）
- ✅ 提供自动迁移工具和详细迁移指南

**验收标准**:
- 错误率 < 1%
- 首次通过率 > 95%
- 生成速度 < 10s (30 类)
- Token 消耗 < 3,000 (LLM 模式)
- 测试覆盖率 ≥ 85%
- 性能无回归
- 用户满意度 > 4/5

**核心组件**:
- `MermaidGenerator` - 确定性 Mermaid 代码生成
- `HeuristicGrouper` - 基于文件路径的启发式分组（备用）
- `LLMGrouper` - LLM 智能分组
- `MermaidValidationPipeline` - 五层验证管道
  - `MermaidParseValidator` - 语法验证
  - `StructuralValidator` - 结构完整性检查
  - `RenderValidator` - 渲染验证
  - `QualityValidator` - 质量分析
- `IsomorphicMermaidRenderer` - 本地渲染器（SVG/PNG）

**实施时间表**:
```
Week 1 (Day 1-5): Phase 0 + Phase 1
├─ Day 1-2: Phase 0 (POC 验证)
│   ├─ 验证 isomorphic-mermaid 可行性
│   ├─ 测试错误模式
│   └─ 验证自动修复
├─ Day 3-5: Phase 1 (核心组件开发)
│   ├─ MermaidGenerator
│   ├─ HeuristicGrouper
│   ├─ MermaidParseValidator
│   └─ IsomorphicMermaidRenderer

Week 2 (Day 6-10): Phase 2 + Phase 3
├─ Day 6-7: Phase 2 (LLM 集成和配置)
│   ├─ LLM 分组 Prompt 模板
│   ├─ LLMGrouper 实现
│   └─ 配置系统扩展
└─ Day 8-10: Phase 3 (验证管道)
    ├─ StructuralValidator
    ├─ RenderValidator
    ├─ QualityValidator
    └─ ValidationPipeline

Week 3 (Day 11-15): Phase 4 (集成和测试)
├─ Day 11-13: 集成和单元测试
├─ Day 14-15: 集成测试和性能测试

Week 4-5: Phase 5 (文档和迁移)
├─ 更新项目文档
├─ 编写迁移指南
└─ 开发自动迁移工具

Week 6-7: Phase 6 (发布和监控)
├─ Alpha + Beta 发布
└─ RC + 正式发布
```

**依赖新增**:
```json
{
  "dependencies": {
    "isomorphic-mermaid": "^0.1.1",
    "sharp": "^0.33.0"
  }
}
```

---

### [14-performance-optimization-plan.md](./14-performance-optimization-plan.md)
**⚡ Phase 14: 性能优化与并行处理实施计划 (TDD)**

**预计时间**: 7-10 个工作日
**核心技术**: p-map (并发控制), cli-progress (进度条)
**对应提案**: [14-performance-optimization-proposal.md](../proposals/14-performance-optimization-proposal.md)

**内容**:
- 多 diagrams 并行处理（Promise.all() / p-map）
- 移除不必要的 Claude CLI 检查
- 外部依赖警告过滤（黑名单机制）
- 并行进度条（cli-progress）
- 源代码缓存优化（共享解析结果）
- 渲染阶段分离（批量并行渲染）
- 质量评分改进（区分内外部依赖）
- 完整的 RLM 六阶段实施计划
- TDD 开发流程示例

**适用人群**: 性能工程师、核心开发者、所有需要生成多图的用户
**阅读优先级**: ⭐⭐⭐⭐⭐ (必读)

**关键组件**:
- `DiagramProcessor.processDiagrams()` - 并行处理逻辑
- `ParallelProgressReporter` - 多行进度条显示
- `EXTERNAL_DEPENDENCIES` - 外部依赖黑名单
- `SourceCache` - 源代码缓存
- 两阶段处理流程（生成 → 批量渲染）

**实施阶段**:
- Phase 14.1: P0 核心优化（2-3 天）
  - 并行处理 + 移除 Claude CLI 检查
- Phase 14.2: P1 用户体验优化（2-3 天）
  - 外部依赖过滤 + 并行进度条 + 质量评分
- Phase 14.3: P2-P3 高级优化（2-3 天）
  - 源代码缓存 + 渲染分离

**验收标准**:
- 6 diagrams 总耗时 <15s（对比 30-60s，**3-4x 提升**）
- CPU 利用率 >80%（对比 20-30%，**+3x**）
- 警告数量 <10（对比 100+，**-95%**）
- 缓存命中率 >70%
- 质量评分 >85/100（对比 49/100，**+73%**）
- 测试覆盖率 ≥80%
- 用户体验评分 ≥4.5/5.0

**核心改进**:
- ⚡ 性能提升：**3-4x**（并行处理）
- ⚡ 警告可读性：**+500%**（过滤外部依赖）
- ⚡ 用户体验：**显著改善**（并行进度条）
- ⚡ 资源利用率：**+3x**（CPU 利用率）
- ⚡ 重复运行：**10x+**（源代码缓存）

**新增依赖**:
```json
{
  "dependencies": {
    "p-map": "^7.0.0",
    "cli-progress": "^3.12.0"
  },
  "devDependencies": {
    "@types/cli-progress": "^3.12.0"
  }
}
```

---

## 🗺️ 阅读路线

### 路线 1: 项目经理
```
00-implementation-plan.md (全文)
  ↓
查看各 Phase 的时间表和验收标准
  ↓
监控进度和质量指标
```

### 路线 2: 技术负责人
```
00-implementation-plan.md (重点: 架构、TDD 流程)
  ↓
01-phase1-code-fingerprint.md (技术方案)
  ↓
02-phase2-claude-code-integration.md (Claude Code CLI 集成方案)
  ↓
制定技术评审计划
```

### 路线 3: 开发者
```
00-implementation-plan.md (了解全局)
  ↓
当前 Phase 的详细计划
  ↓
按照 TDD 循环开发
  ↓
遵循验收标准提交代码
```

### 路线 4: QA 工程师
```
00-implementation-plan.md (第 4 章: VALIDATION)
  ↓
各 Phase 的测试策略和验收标准
  ↓
准备测试用例和自动化测试
```

### 路线 5: 架构师 / 重构负责人
```
09-multi-level-architecture-diagrams-plan.md (完整阅读)
  ↓
理解 Breaking Change 和迁移策略
  ↓
评估对现有用户的影响
  ↓
制定发布计划和沟通策略
```

---

## 📊 项目时间表

### 核心功能开发（Phase 0-4）

```
Week 1
├─ Day 1: Phase 0 - 环境准备
├─ Day 2-4: Phase 1 Part 1 - 基础解析 (TDD)
└─ Day 5: Phase 1 Part 2 - 高级特性

Week 2
├─ Day 1-3: Phase 2 - Claude Code CLI 集成 (TDD)
├─ Day 4-5: Phase 3 - CLI 开发

Week 3
├─ Day 1-2: Phase 3 - 优化
├─ Day 3: 集成测试
├─ Day 4-5: Phase 4 - 配置与 CLI 改进 (开始)

Week 4
├─ Day 1-3: Phase 4 - 配置与 CLI 改进 (继续)
├─ Day 4: 集成测试
├─ Day 5: 文档
```

### 高级功能增强（Phase 7-8）

```
Week 5-6
├─ Day 1-2: Phase 7.1 - Multi-source 支持
├─ Day 3-4: Phase 7.2 - 输出路径定制
├─ Day 5-7: Phase 7.3 - STDIN 支持
├─ Day 8-10: Phase 7.4 - 批处理模式
└─ Day 11-12: Phase 7 - 集成测试与缓冲

Week 7
├─ Day 1: Phase 8.1 - 基础设施
├─ Day 2-4: Phase 8.2 - 核心逻辑
├─ Day 5: Phase 8.3 - 模板与示例
└─ Day 6-8: Phase 8.4-8.5 - 测试与文档

总工期: 7 周（35 个工作日）
```

---

## ✅ Phase 划分

### Phase 0: 环境准备 (1 天)
**状态**: 待开始
**负责人**: 团队

**任务**:
- [ ] 初始化 TypeScript 项目
- [ ] 配置 Vitest 测试框架
- [ ] 设置 ESLint + Prettier
- [ ] 创建项目目录结构
- [ ] 配置 CI/CD (GitHub Actions)

**交付物**:
- 项目骨架
- `package.json`
- CI 配置

---

### Phase 1: 代码指纹提取 (3-4 天)
**状态**: 待开始
**负责人**: 开发团队

**目标**: 实现高效的 TypeScript 代码解析

**详细计划**: [01-phase1-code-fingerprint.md](./01-phase1-code-fingerprint.md)

**关键里程碑**:
- Day 1: 基础类提取 ✅
- Day 2: 成员提取 ✅
- Day 3: 接口和装饰器 ✅
- Day 4: 关系提取和整合 ✅

**验收标准**:
- [ ] 测试覆盖率 ≥ 80%
- [ ] 解析 ArchGuard < 2s
- [ ] 所有功能测试通过

---

### Phase 2: Claude Code CLI 集成与文档生成 (3-4 天)
**状态**: 待开始
**依赖**: Phase 1 完成

**目标**: 集成 Claude Code CLI，生成 PlantUML

**详细计划**: [02-phase2-claude-code-integration.md](./02-phase2-claude-code-integration.md)

**关键里程碑**:
- Day 1: CLI 封装 ✅
- Day 2: 提示词模板与生成 ✅
- Day 3: 输出解析与优化 ✅
- Day 4: 集成测试 ✅

**验收标准**:
- [ ] 语法正确率 ≥ 95%
- [ ] CLI 调用成功率 ≥ 99%
- [ ] 输出解析准确率 100%
- [ ] 测试覆盖率 ≥ 80%

---

### Phase 3: CLI 与优化 (2-3 天)
**状态**: 待开始
**依赖**: Phase 2 完成

**目标**: 开发命令行工具，优化用户体验

**详细计划**: [03-phase3-cli-optimization.md](./03-phase3-cli-optimization.md)

**关键里程碑**:
- Day 1: CLI 框架 + 进度显示 ✅
- Day 2: 缓存 + 错误处理 ✅
- Day 3: 配置 + 性能优化 ✅

**验收标准**:
- [ ] CLI 命令正常工作
- [ ] 完整流程 < 10s
- [ ] 缓存命中率 > 80%
- [ ] 测试覆盖率 ≥ 80%

---

### Phase 4: 配置与 CLI 管理机制改进 (6-9 天)
**状态**: 待开始
**依赖**: Phase 1 + Phase 2 + Phase 3 完成

**目标**: 增强配置灵活性和 CLI 可配置性

**详细计划**: [04-phase4-config-cli-improvements.md](./04-phase4-config-cli-improvements.md)

**关键里程碑**:
- Day 1-2: 配置 Schema 扩展 ✅
- Day 3-4: CLI 参数集成 ✅
- Day 5-6: Claude CLI Wrapper 重构 ✅
- Day 7-8: 输出路径管理重构 ✅
- Day 9: 文档与测试 ✅

**验收标准**:
- [ ] CLI 命令可配置性 100%
- [ ] 支持多种 CLI 变体
- [ ] 向后兼容性 100%
- [ ] 测试覆盖率 ≥ 80%
- [ ] 配置灵活性 +50%

---

### Phase 7: 高级 CLI 功能增强 (10-12 天)
**状态**: 待开始
**依赖**: Phase 4 完成（推荐）

**目标**: 实现多源支持、STDIN、输出定制和批处理模式

**详细计划**: [07-advanced-cli-features-plan.md](./07-advanced-cli-features-plan.md)

**关键里程碑**:
- Day 1-2: Multi-source 支持 ✅
- Day 3-4: 输出路径定制 ✅
- Day 5-7: STDIN 支持 ✅
- Day 8-10: 批处理模式 ✅
- Day 11-12: 集成测试与缓冲 ✅

**验收标准**:
- [ ] CLI 向后兼容性 100%
- [ ] 测试覆盖率 ≥ 85%
- [ ] 批处理性能: 10 模块 < 30s
- [ ] 配置文件支持所有新参数
- [ ] STDIN 集成测试通过

---

### Phase 8: Claude Code Subagent 集成 (4-6 天)
**状态**: 待开始
**依赖**: Phase 7 批处理功能完成

**目标**: 开发 Claude Code Skill 实现自然语言架构分析

**详细计划**: [08-claude-code-subagent-integration-plan.md](./08-claude-code-subagent-integration-plan.md)

**关键里程碑**:
- Day 1: 基础设施搭建 ✅
- Day 2-4: 核心逻辑开发 ✅
- Day 5: 模板与示例 ✅
- Day 6-7: 测试 ✅
- Day 8: 文档与推广 ✅

**验收标准**:
- [ ] Skill 激活成功率 > 95%
- [ ] 项目类型检测准确率 > 90%
- [ ] 完整文档和 4 个示例
- [ ] 至少 1 次社区分享
- [ ] 用户反馈收集

---

### Phase 9: 多层次架构图生成 (5-7 天开发，7 周总计)
**状态**: 待开始
**依赖**: 无（Breaking Change，独立重构）
**⚠️ Breaking Change**: v2.0.0 主版本升级

**目标**: 统一参数机制，支持多层次架构图生成

**详细计划**: [09-multi-level-architecture-diagrams-plan.md](./09-multi-level-architecture-diagrams-plan.md)

**关键里程碑**:
- Day 1: 类型定义和配置 ✅
- Day 2-3: 核心组件（DiagramProcessor + ArchJSONAggregator） ✅
- Day 3-4: Prompt 和 AI ✅
- Day 5-6: 测试（单元 + 集成 + E2E） ✅
- Day 7: 文档和迁移工具 ✅
- Week 2-5: Beta 测试和发布 ✅

**验收标准**:
- [ ] 代码复杂度降低 ≥ 20%
- [ ] 测试覆盖率 ≥ 80%
- [ ] Package/Class/Method 三级支持
- [ ] 迁移工具可用
- [ ] 功能采用率 > 40%（6个月）
- [ ] 生成成功率 > 95%

---

## 🎯 RLM 阶段覆盖

| RLM 阶段 | 主计划 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 7 | Phase 8 | Phase 9 |
|----------|--------|---------|---------|---------|---------|---------|---------|---------|
| **PROPOSAL** | ✅ 第1章 | ✅ 目标 | ✅ 目标 | ✅ 目标 | ✅ 目标 | ✅ 提案07 | ✅ 提案08 | ✅ 提案09 |
| **PLANNING** | ✅ 第2章 | ✅ 实施计划 | ✅ 实施计划 | ✅ 实施计划 | ✅ 实施计划 | ✅ 实施计划 | ✅ 实施计划 | ✅ 实施计划 |
| **EXECUTION** | ✅ 第3章 | ✅ TDD 循环 | ✅ TDD 循环 | ✅ TDD 循环 | ✅ TDD 循环 | ✅ 迭代开发 | ✅ Skill开发 | ✅ 重构开发 |
| **VALIDATION** | ✅ 第4章 | ✅ 验收测试 | ✅ 验收测试 | ✅ 验收测试 | ✅ 验收测试 | ✅ 验收测试 | ✅ 激活测试 | ✅ 质量门控 |
| **INTEGRATION** | ✅ 第5章 | ✅ Git 流程 | ✅ CI/CD | ✅ Git 流程 | ✅ Git 流程 | ✅ Git 流程 | ✅ Skill发布 | ✅ Beta发布 |
| **MONITORING** | ✅ 第6章 | ✅ 性能监控 | ✅ 成本追踪 | ✅ 使用监控 | ✅ 配置监控 | ✅ 性能监控 | ✅ 使用监控 | ✅ 采用率监控 |

---

## 📈 成功指标

### 功能指标

| 指标 | 目标 | 测量方法 |
|------|------|---------|
| TypeScript 解析准确性 | 100% | 单元测试 |
| PlantUML 语法正确率 | ≥ 95% | 自动验证 |
| 实体完整性 | 100% | 完整性检查 |
| 关系识别准确性 | ≥ 90% | 人工验证 |

### 性能指标

| 指标 | 目标 | 测量方法 |
|------|------|---------|
| 小项目 (< 50 文件) | < 3s | 性能测试 |
| 中项目 (50-200 文件) | < 5s | 性能测试 |
| 大项目 (200-500 文件) | < 10s | 性能测试 |
| 内存使用 | < 300MB | 负载测试 |

### 质量指标

| 指标 | 目标 | 测量方法 |
|------|------|---------|
| 测试覆盖率 | ≥ 80% | Codecov |
| 代码重复率 | < 3% | SonarQube |
| ESLint 错误 | 0 | CI 检查 |
| TypeScript 错误 | 0 | 类型检查 |

### 成本指标

| 指标 | 目标 | 测量方法 |
|------|------|---------|
| 小项目 AI 成本 | < $0.01 | 成本追踪器 |
| 中项目 AI 成本 | < $0.03 | 成本追踪器 |
| 大项目 AI 成本 | < $0.10 | 成本追踪器 |
| 月度总成本 | < $50 | 账单分析 |

---

## 🛠️ TDD 实践指南

### TDD 三大原则

1. **红-绿-重构循环**
   ```
   🔴 写失败的测试
   ↓
   🟢 写最小代码让测试通过
   ↓
   ♻️ 重构改进代码
   ↓
   (重复)
   ```

2. **测试先行**
   - 所有功能都先写测试
   - 测试描述功能需求
   - 测试作为活文档

3. **小步前进**
   - 每次只实现一个小功能
   - 保持测试快速通过
   - 频繁提交

### TDD 检查清单

每次提交前确认：
- [ ] 新功能有对应测试
- [ ] 所有测试通过
- [ ] 测试覆盖率未下降
- [ ] 代码已重构优化
- [ ] 无明显代码异味

---

## 📚 参考资源

### 内部文档
- [提案文档集](../proposals/README.md)
- [架构优化建议](../proposals/01-architecture-optimization-proposal.md)
- [Claude Code CLI 集成策略](../proposals/02-claude-code-integration-strategy.md)
- [高级 CLI 功能增强提案](../proposals/07-advanced-cli-features.md)
- [Claude Code Subagent 集成提案](../proposals/08-claude-code-subagent-integration.md)

### 外部资源
- [ts-morph 文档](https://ts-morph.com/)
- [Claude API 文档](https://docs.anthropic.com/en/api)
- [PlantUML 指南](https://plantuml.com/class-diagram)
- [Vitest 文档](https://vitest.dev/)
- [TDD 入门](https://testdriven.io/)

### 工具
- [PlantUML 在线编辑器](https://www.plantuml.com/plantuml/uml/)
- [TypeScript Playground](https://www.typescriptlang.org/play)
- [Regex101](https://regex101.com/)

---

## 🚀 快速开始

### 阅读顺序

**首次阅读**:
1. 本 README（了解整体结构）
2. 00-implementation-plan.md（理解 RLM 方法）
3. 当前 Phase 的详细计划
4. 开始 TDD 开发

**每日工作流**:
1. 查看当天的任务清单
2. 遵循 TDD 循环开发
3. 运行测试确保通过
4. 提交代码并更新进度
5. 参加每日站会

### 开发环境设置

```bash
# 1. 克隆项目
git clone https://github.com/your-org/archguard.git
cd archguard

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，添加 ANTHROPIC_API_KEY

# 4. 运行测试
npm test

# 5. 开始 TDD 开发
npm run test:watch
```

---

## 📞 支持与联系

**问题反馈**: GitHub Issues
**技术讨论**: GitHub Discussions
**紧急联系**: 团队 Slack 频道

---

**版本**: 2.1
**最后更新**: 2026-01-26
**状态**: ✅ 计划完成（Phase 0-4, Phase 7-9），准备开始执行
**下一步**: Phase 0 - 环境准备（核心功能）或 Phase 7（高级功能）或 Phase 9（v2.0 重构）
