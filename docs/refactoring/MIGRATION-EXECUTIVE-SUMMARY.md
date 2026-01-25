# 迁移执行摘要 - Claude Code CLI 集成

**日期**: 2026-01-25
**预计工作量**: 2-3 天 (23 小时)
**风险等级**: 中等

---

## 📊 现状评估

### 当前实现 ✅
- **架构**: 直接使用 `@anthropic-ai/sdk` (12.8 MB)
- **认证**: 需要 `ANTHROPIC_API_KEY` 环境变量
- **测试**: 323/329 通过 (98.2%)，覆盖率 80%+
- **文件**: 6 个核心 AI 文件 (`src/ai/`)
- **功能**: 完整的 PlantUML 生成、验证、成本追踪

### 新方案要求 🎯
- **架构**: 调用 Claude Code CLI (子进程)
- **认证**: 使用 Claude Code 配置，零 API Key 管理
- **工具**: 使用 `execa` 进行进程管理
- **优势**: 简化配置、降低维护成本、更好的项目上下文理解

---

## 🔍 差距分析

### 需要新增 ✨
| 组件 | 功能 | 复杂度 | 测试优先级 |
|------|------|--------|-----------|
| `claude-code-wrapper.ts` | CLI 封装 | 中 | 高 |
| `output-parser.ts` | 输出解析 | 低 | 高 |
| `prompt-template-manager.ts` | 模板管理 | 低 | 中 |
| `prompts/` 目录 | 提示词模板 | 低 | 中 |

### 需要修改 🔄
| 文件 | 变更类型 | 影响 |
|------|---------|------|
| `plantuml-generator.ts` | 重构 - 使用 ClaudeCodeWrapper | 中 |
| `prompt-builder.ts` | 重构 - 改为模板系统 | 低 |
| `analyze.ts` (CLI) | 移除 API Key，添加 CLI 检测 | 低 |
| `package.json` | 移除 @anthropic-ai/sdk，添加 execa | 低 |

### 需要移除 ❌
| 文件 | 原因 |
|------|------|
| `claude-connector.ts` | 改用 CLI wrapper |
| `cost-tracker.ts` | Claude Code CLI 自带 |
| `@anthropic-ai/sdk` 依赖 | 不再需要 |

---

## 📅 实施计划 (4 个阶段)

### Phase 0: 准备 (0.5 天)
- 添加 `execa` 依赖
- 创建目录结构 (`prompts/`, 测试框架)
- 实现 CLI 检测工具
- **交付**: 基础设施就绪

### Phase 1: CLI 封装 (1 天)
**4 个 TDD Stories:**
1. ClaudeCodeWrapper 基础 (2h) - 初始化、CLI 检测、临时文件管理
2. 提示词模板系统 (2h) - 模板加载、变量渲染
3. 输出解析器 (1.5h) - 提取 PlantUML、多格式支持
4. 错误处理与重试 (2.5h) - 重试逻辑、错误分类

**交付**: 完整的 CLI 集成层，覆盖率 ≥ 90%

### Phase 2: 集成替换 (0.5 天)
**3 个 TDD Stories:**
1. 重构 PlantUMLGenerator (1.5h) - 移除 API Key，使用 wrapper
2. 更新 CLI 命令 (1h) - 添加 CLI 检测，移除环境变量
3. 更新配置 Schema (0.5h) - 移除 apiKey 字段

**交付**: 完整集成，向后兼容

### Phase 3: 测试验证 (1 天)
**5 个验证任务:**
1. 单元测试迁移 (2h) - Mock CLI 调用，更新测试策略
2. 集成测试更新 (2h) - 环境检测，跳过策略
3. E2E 测试更新 (1h) - 完整流程验证
4. **自我验证** (2h) - 用 ArchGuard 分析自己
5. 性能基准测试 (1h) - 确保无性能退化

**交付**: 所有测试通过，性能达标

### Phase 4: 清理发布 (可选)
- 移除废弃代码
- 更新文档
- 版本发布 (0.1.0 → 0.2.0)

---

## ✅ 验收标准

### 功能完整性
- ✅ 所有现有功能保持不变
- ✅ PlantUML 生成质量不降低
- ✅ 用户无需配置 API Key

### 技术质量
- ✅ 测试覆盖率 ≥ 90%
- ✅ 所有测试通过 (目标: 330+ tests)
- ✅ 符合 ESLint 规范

### 性能指标
- ✅ 自我分析 < 10s (当前 ~7.6s)
- ✅ 内存使用 < 300MB (当前 ~25MB)
- ✅ 缓存命中率 > 80%

### 自我验证 (最终测试)
```bash
# 使用新实现分析 ArchGuard 自己
npm run build
./dist/cli/index.js analyze -s ./src -o ./docs/architecture-v2.puml -v

# 验证:
# - 27 个文件被解析
# - 47 个实体被识别
# - 79 个关系被提取
# - PlantUML 语法正确
# - 总时间 < 10s
```

---

## ⚠️ 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Claude Code CLI 不可用 | 低 | 高 | 清晰的检测和错误提示 |
| CLI 输出格式变化 | 中 | 中 | 鲁棒的解析器，支持多格式 |
| 性能下降 | 低 | 低 | 基准测试，优化 I/O |
| 测试环境配置 | 中 | 中 | Mock 策略，跳过逻辑 |

### 回退计划
- 所有变更在 feature branch
- 每个 Phase 创建 tag
- 保留 @anthropic-ai/sdk 直到 Phase 3 完成
- 触发条件: 测试失败率 > 10% 或性能下降 > 50%

---

## 📈 工作量估算

| 阶段 | 工时 | 任务数 | 测试数 | 完成标准 |
|------|------|-------|--------|---------|
| Phase 0 | 4h | 3 | 5 | 基础设施就绪 |
| Phase 1 | 8h | 4 | 50+ | CLI 封装完成，覆盖率 ≥ 90% |
| Phase 2 | 3h | 3 | 20+ | 集成完成，所有测试通过 |
| Phase 3 | 8h | 5 | 30+ | 自我验证成功，性能达标 |
| **总计** | **23h** | **15** | **105+** | **全部交付物完成** |

**日历时间**: 2-3 天 (每天 8 小时)

---

## 🎯 关键决策点

### 需要确认的问题

1. **是否立即开始迁移?**
   - ✅ 好处: 简化用户配置，降低维护成本
   - ⚠️ 考虑: 需要 2-3 天开发时间
   - 💡 建议: 确认后立即开始

2. **是否保留成本追踪功能?**
   - 当前: `cost-tracker.ts` 追踪 API 调用成本
   - 新方案: Claude Code CLI 无 token 信息
   - 💡 建议: 移除（CLI 成本包含在订阅中）

3. **是否需要向后兼容旧配置?**
   - 情况: 用户可能有 `apiKey` 在配置文件中
   - 💡 建议: 读取时忽略，添加废弃警告

4. **测试环境 Claude Code CLI 要求?**
   - CI/CD 需要安装 Claude Code CLI
   - 💡 建议: 使用 Mock，添加跳过逻辑

---

## 📝 待确认清单

- [ ] **同意迁移方案** (4 阶段计划)
- [ ] **确认时间安排** (2-3 天)
- [ ] **确认验收标准** (自我验证 + 性能基准)
- [ ] **确认风险可接受** (中等风险，有回退计划)
- [ ] **确认测试策略** (TDD，覆盖率 ≥ 90%)

---

## 📚 相关文档

- **详细计划**: [MIGRATION-TO-CLI-PLAN.md](./MIGRATION-TO-CLI-PLAN.md)
- **新架构方案**: [02-claude-code-integration-strategy.md](./proposals/02-claude-code-integration-strategy.md)
- **Phase 2 计划**: [02-phase2-claude-code-integration.md](./plans/02-phase2-claude-code-integration.md)

---

## 🚀 下一步行动

**用户确认后:**
1. 创建 feature branch: `feature/claude-code-cli-migration`
2. 开始 Phase 0: 准备阶段
3. 每个 Phase 完成后创建 PR 进行 Review
4. Phase 3 完成后进行最终验证
5. 合并到 master，发布 v0.2.0

**等待确认...**
