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

---

## 📊 项目时间表

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
├─ Day 4: 文档
└─ Day 5: 发布
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

## 🎯 RLM 阶段覆盖

| RLM 阶段 | 主计划 | Phase 1 | Phase 2 | Phase 3 |
|----------|--------|---------|---------|---------|
| **PROPOSAL** | ✅ 第1章 | ✅ 目标 | ✅ 目标 | ✅ 目标 |
| **PLANNING** | ✅ 第2章 | ✅ 实施计划 | ✅ 实施计划 | ✅ 实施计划 |
| **EXECUTION** | ✅ 第3章 | ✅ TDD 循环 | ✅ TDD 循环 | ✅ TDD 循环 |
| **VALIDATION** | ✅ 第4章 | ✅ 验收测试 | ✅ 验收测试 | ✅ 验收测试 |
| **INTEGRATION** | ✅ 第5章 | ✅ Git 流程 | ✅ CI/CD | ✅ Git 流程 |
| **MONITORING** | ✅ 第6章 | ✅ 性能监控 | ✅ 成本追踪 | ✅ 使用监控 |

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

**版本**: 1.0
**最后更新**: 2026-01-25
**状态**: ✅ 计划完成，准备开始执行
**下一步**: Phase 0 - 环境准备
