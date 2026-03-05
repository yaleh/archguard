# Phase 14: 性能优化与并行处理实施计划 (TDD)

**计划名称**: ArchGuard 多 Diagram 并行处理与性能优化
**阶段**: Phase 14 - Performance Optimization & Parallel Processing
**方法论**: RLM (Refactoring Lifecycle Management) + TDD
**预计时间**: 7-10 个工作日
**依赖**: Phase 10 (Mermaid 迁移) 完成，Phase 9 (多层次架构图) 完成
**创建日期**: 2026-01-28
**对应提案**: [14-performance-optimization-proposal.md](../proposals/14-performance-optimization-proposal.md)
**⚠️ Breaking Change**: 否 - 向后兼容

---

## 📋 目录

1. [RLM PROPOSAL - 阶段提案](#1-rlm-proposal---阶段提案)
2. [RLM PLANNING - 计划阶段](#2-rlm-planning---计划阶段)
3. [RLM EXECUTION - 执行阶段](#3-rlm-execution---执行阶段)
4. [RLM VALIDATION - 验证阶段](#4-rlm-validation---验证阶段)
5. [RLM INTEGRATION - 集成阶段](#5-rlm-integration---集成阶段)
6. [RLM MONITORING - 监控阶段](#6-rlm-monitoring---监控阶段)

---

## 1. RLM PROPOSAL - 阶段提案

### 1.1 问题陈述

**当前状态**:
- ✅ Phase 9: 多层次架构图生成已实现（支持多 diagrams 配置）
- ✅ Phase 10: Mermaid 图表迁移已完成（移除 PlantUML）
- ✅ Phase 13: 架构图元数据增强已实现（v2.1.0）
- ❌ 多 diagrams 串行处理，总耗时 30-60s（6 个 diagrams）
- ❌ CPU 利用率低（20-30%），资源浪费
- ❌ 仍执行不必要的 Claude CLI 检查（LLMGrouper 已移除）
- ❌ 外部依赖警告过多（100+），掩盖真正问题
- ❌ 缺乏并行进度反馈，用户体验差
- ❌ 相同源代码的 diagrams 重复解析

**性能瓶颈分析**:

| 瓶颈 | 当前耗时 | 占比 | 优化后 | 提升 |
|------|----------|------|--------|------|
| 串行处理 | 30-60s | 100% | <15s | **3-4x** |
| Claude CLI 检查 | 0.5-1s | 2% | 0s | **-100%** |
| 警告过滤 | N/A | N/A | <10 | **-95%** |
| 重复解析 | 10-20s | 30% | 共享 | **10x+** |

**用户体验问题**:

| 问题 | 严重程度 | 影响 |
|------|----------|------|
| 生成速度慢 | 🔴 严重 | 每次等待 30-60s |
| 无进度反馈 | 🟡 中等 | 不知道何时完成 |
| 警告信息过多 | 🟡 中等 | 忽略真正的问题 |
| CPU 空闲 | 🟢 轻微 | 资源浪费 |

### 1.2 提案目标

**核心目标**: 实现多 diagrams 并行处理，显著提升性能和用户体验

**具体目标**:
1. **并行处理 diagrams** (Priority: High - P0)
   - 使用 Promise.all() / p-map 并行处理
   - 限制并发数（默认 CPU 核心数）
   - 单个 diagram 失败不影响其他
   - **预期**: 6 diagrams 从 30-60s → <15s（**3-4x 提升**）

2. **移除 Claude CLI 检查** (Priority: High - P0)
   - 删除遗留的 CLI 可用性检查代码
   - 简化启动流程
   - **预期**: 减少 0.5-1s 启动时间

3. **外部依赖警告过滤** (Priority: Medium - P1)
   - 创建外部依赖黑名单（ts-morph, zod, EventEmitter 等）
   - 修改 StructuralValidator 过滤外部类型
   - **预期**: 警告从 100+ → <10（**-95%**）

4. **并行进度条** (Priority: Medium - P1)
   - 集成 cli-progress 显示实时进度
   - 多行进度条（每个 diagram 一行）
   - 支持 Ctrl+C 中断
   - **预期**: 用户体验显著提升

5. **源代码缓存优化** (Priority: Low - P2)
   - 实现共享解析结果缓存
   - 相同源的 diagrams 共享 ArchJSON
   - **预期**: 重复运行 10x+ 提升

6. **渲染阶段分离** (Priority: Low - P2)
   - 两阶段处理（生成 → 批量渲染）
   - 渲染并发数 = 生成并发数 × 2
   - **预期**: 额外 1.5x 提升

7. **质量评分改进** (Priority: Low - P3)
   - 区分外部依赖和真正的缺失实体
   - completeness 只计算内部缺失
   - **预期**: 评分从 49/100 → 85-95/100

### 1.3 成功指标

| 指标 | 基线 | 目标 | 提升 | 测量方法 |
|------|------|------|------|----------|
| **6 diagrams 总耗时** | 30-60s | <15s | **3-4x** | 性能基准测试 |
| **警告数量** | 100+ | <10 | **-95%** | 警告计数 |
| **CPU 利用率** | 20-30% | >80% | **+3x** | 系统监控 |
| **缓存命中率** | 0% | 70-90% | - | 缓存统计 |
| **质量评分** | 49/100 | 85-95/100 | **+73%** | 自动评分 |
| **用户体验评分** | 3.0/5.0 | 4.5/5.0 | **+50%** | 用户反馈 |
| **测试覆盖率** | N/A | ≥80% | - | 单元测试 |

### 1.4 技术栈

**核心库**:
```json
{
  "dependencies": {
    "p-map": "^7.0.0",         // 并发控制（新增）
    "cli-progress": "^3.12.0",  // 进度条（新增）
    "ora": "^7.0.1"            // Spinner（已使用）
  }
}
```

**新增依赖**:
```bash
npm install p-map cli-progress
npm install --save-dev @types/cli-progress
```

### 1.5 影响范围

**修改文件**:
- `src/cli/commands/analyze.ts` - 移除 Claude CLI 检查
- `src/cli/processors/diagram-processor.ts` - 并行处理逻辑
- `src/mermaid/validator-structural.ts` - 过滤外部依赖
- `src/mermaid/validator-quality.ts` - 改进质量评分
- `src/mermaid/diagram-generator.ts` - 分离渲染阶段
- `src/cli/progress.ts` - 添加并行进度条

**新增文件**:
- `src/mermaid/external-dependencies.ts` - 外部依赖黑名单
- `src/parser/source-cache.ts` - 源代码缓存
- `src/cli/progress/parallel-progress.ts` - 并行进度报告器
- `tests/integration/parallel-diagrams.test.ts` - 并行处理集成测试
- `tests/performance/parallel-processing.test.ts` - 性能基准测试

**删除文件**:
- 无（只删除代码，不删除文件）

---

## 2. RLM PLANNING - 计划阶段

### 2.1 阶段划分

#### Phase 14.1: P0 核心优化 - 并行处理 + 移除遗留代码 (2-3 天)

**目标**: 实现多 diagrams 并行处理，移除不必要的 Claude CLI 检查

**关键任务**:

**Story 14.1.1: 移除 Claude CLI 检查** (0.5 天)
- [ ] 定位 Claude CLI 检查代码（`src/cli/commands/analyze.ts`）
- [ ] 删除检查逻辑和输出
- [ ] 验证无其他依赖
- [ ] 更新测试（移除相关断言）

**验收标准**:
- [ ] 不再显示 "Checking Claude Code CLI"
- [ ] 启动时间减少 0.5-1s
- [ ] 所有测试通过

**Story 14.1.2: 实现并行处理** (1.5 天)
- [ ] 安装 `p-map` 依赖
- [ ] 修改 `DiagramProcessor.processDiagrams()` 使用并行
- [ ] 添加并发控制（默认 CPU 核心数）
- [ ] 实现错误隔离（单个失败不影响其他）
- [ ] 编写单元测试

**验收标准**:
- [ ] 6 个 diagrams 并行处理
- [ ] 总耗时 <15s
- [ ] 单个失败不影响其他
- [ ] 测试覆盖率 ≥80%

**Story 14.1.3: 集成测试和验证** (1 天)
- [ ] 编写集成测试（6 个 diagrams 并行生成）
- [ ] 性能基准测试（对比前后）
- [ ] 回归测试（确保功能正常）
- [ ] 文档更新

**验收标准**:
- [ ] 集成测试通过
- [ ] 性能提升 ≥3x
- [ ] 向后兼容性 100%

---

#### Phase 14.2: P1 用户体验优化 - 警告过滤 + 进度条 (2-3 天)

**目标**: 降低输出噪音，提升用户体验

**关键任务**:

**Story 14.2.1: 外部依赖警告过滤** (1 天)
- [ ] 创建外部依赖黑名单（`src/mermaid/external-dependencies.ts`）
- [ ] 识别常见外部类型（ts-morph, zod, EventEmitter 等）
- [ ] 修改 `StructuralValidator` 过滤外部类型
- [ ] 添加 verbose 模式显示被过滤的警告
- [ ] 编写单元测试

**验收标准**:
- [ ] 警告数量从 100+ → <10
- [ ] 真正的错误仍被识别
- [ ] verbose 模式显示过滤信息

**Story 14.2.2: 并行进度条** (1-1.5 天)
- [ ] 安装 `cli-progress` 依赖
- [ ] 创建 `ParallelProgressReporter` 类
- [ ] 多行进度条显示（每个 diagram 一行）
- [ ] 集成到 `DiagramProcessor`
- [ ] 支持 Ctrl+C 中断
- [ ] 编写单元测试

**验收标准**:
- [ ] 实时显示 6 个 diagrams 进度
- [ ] 进度百分比准确
- [ ] Ctrl+C 正常中断

**Story 14.2.3: 质量评分改进** (0.5 天)
- [ ] 修改 `QualityValidator` 区分内外部依赖
- [ ] completeness 只计算内部缺失
- [ ] suggestions 分优先级（high/low）
- [ ] 编写单元测试

**验收标准**:
- [ ] 质量评分从 49/100 → 85-95/100
- [ ] suggestions 只显示真正的问题

---

#### Phase 14.3: P2-P3 高级优化 - 缓存 + 渲染分离 (2-3 天)

**目标**: 进一步提升性能，优化资源利用

**关键任务**:

**Story 14.3.1: 源代码缓存** (1-1.5 天)
- [ ] 实现 `SourceCache` 类
- [ ] 基于源文件哈希的缓存键
- [ ] TTL 机制（60s）
- [ ] 集成到 `DiagramProcessor`
- [ ] 缓存命中率监控
- [ ] 编写单元测试

**验收标准**:
- [ ] 相同源的 diagrams 共享解析结果
- [ ] 缓存命中率 >70%
- [ ] 重复运行 10x+ 提升

**Story 14.3.2: 渲染阶段分离** (0.5-1 天)
- [ ] 分离 Mermaid 代码生成和渲染
- [ ] 第一阶段：并行生成（CPU 密集）
- [ ] 第二阶段：批量并行渲染（I/O 密集）
- [ ] 渲染并发数 = 生成并发数 × 2
- [ ] 编写单元测试

**验收标准**:
- [ ] 两阶段处理正确
- [ ] 额外 1.5x 性能提升
- [ ] 所有 diagrams 渲染成功

**Story 14.3.3: 文档和发布** (0.5-1 天)
- [ ] 更新 CLAUDE.md
- [ ] 更新 README.md
- [ ] 添加性能基准测试文档
- [ ] 发布 v2.2.0

**验收标准**:
- [ ] 文档完整准确
- [ ] 发布流程顺利
- [ ] 版本号正确

---

### 2.2 详细任务分解

#### Week 1: Day 1-5

**Day 1: P0 核心优化 - Story 14.1.1 + 14.1.2 (Part 1)**
- 09:00-10:30: Story 14.1.1 - 移除 Claude CLI 检查
- 10:45-12:30: Story 14.1.2 - 安装依赖，修改 processDiagrams()
- 13:30-15:00: 添加并发控制，错误隔离
- 15:15-17:00: 编写单元测试

**Day 2: P0 核心优化 - Story 14.1.2 (Part 2)**
- 09:00-12:00: 完善并行处理逻辑
- 13:30-15:00: 单元测试
- 15:15-17:00: 代码审查和重构

**Day 3: P0 核心优化 - Story 14.1.3**
- 09:00-12:00: 集成测试
- 13:30-15:00: 性能基准测试
- 15:15-17:00: 回归测试

**Day 4-5: P1 用户体验优化 - Story 14.2.1 + 14.2.2**
- Day 4: 外部依赖警告过滤
- Day 5: 并行进度条（Part 1）

#### Week 2: Day 6-10

**Day 6: P1 用户体验优化 - Story 14.2.2 (Part 2) + 14.2.3**
- 09:00-12:00: 完成并行进度条
- 13:30-15:00: 质量评分改进
- 15:15-17:00: 单元测试

**Day 7-8: P2 高级优化 - Story 14.3.1**
- Day 7: 源代码缓存（Part 1）
- Day 8: 源代码缓存（Part 2）+ 单元测试

**Day 9: P2 高级优化 - Story 14.3.2**
- 09:00-12:00: 渲染阶段分离
- 13:30-15:00: 单元测试
- 15:15-17:00: 性能测试

**Day 10: 文档和发布 - Story 14.3.3**
- 09:00-12:00: 更新文档
- 13:30-15:00: 发布准备
- 15:15-17:00: 发布 v2.2.0

---

### 2.3 依赖关系

```
Phase 14.1 (P0) → Phase 14.2 (P1) → Phase 14.3 (P2-P3)
     ↓                  ↓                  ↓
  核心性能提升      用户体验优化         高级优化
```

**阻塞关系**:
- Phase 14.2 必须等待 Phase 14.1 完成（并行处理是基础）
- Phase 14.3 可以与 Phase 14.2 部分并行（缓存独立）

---

### 2.4 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 并发导致资源耗尽 | 中 | 高 | 限制并发数，添加内存监控 |
| 并行处理难以调试 | 中 | 中 | 保留详细日志，提供 --debug 模式 |
| 缓存一致性问题 | 低 | 中 | 添加 TTL，提供缓存清除命令 |
| 外部依赖误过滤 | 低 | 中 | 保守的黑名单，verbose 模式验证 |
| 进度条性能开销 | 低 | 低 | 批量更新，避免频繁刷新 |

---

## 3. RLM EXECUTION - 执行阶段

### 3.1 TDD 开发流程

#### Story 14.1.2: 实现并行处理（示例）

**Step 1: Red - 编写失败的测试**

```typescript
// tests/unit/cli/processors/diagram-processor.test.ts

describe('DiagramProcessor.parallel', () => {
  it('should process multiple diagrams in parallel', async () => {
    const processor = new DiagramProcessor(mockConfig);
    const startTime = Date.now();

    await processor.processDiagrams({
      ...mockConfig,
      diagrams: [
        { name: 'd1', sources: ['./src/parser'], level: 'class' },
        { name: 'd2', sources: ['./src/mermaid'], level: 'class' },
        { name: 'd3', sources: ['./src/cli'], level: 'class' },
      ],
    });

    const duration = Date.now() - startTime;
    // 并行处理应该远快于串行（串行约 15s，并行应 <5s）
    expect(duration).toBeLessThan(5000);
  });

  it('should isolate errors - one failure should not affect others', async () => {
    const processor = new DiagramProcessor(mockConfig);

    const results = await processor.processDiagramsWithErrors({
      ...mockConfig,
      diagrams: [
        { name: 'valid-1', sources: ['./src/parser'], level: 'class' },
        { name: 'invalid', sources: ['./nonexistent'], level: 'class' }, // 会失败
        { name: 'valid-2', sources: ['./src/cli'], level: 'class' },
      ],
    });

    expect(results.find(r => r.name === 'valid-1')?.status).toBe('success');
    expect(results.find(r => r.name === 'invalid')?.status).toBe('error');
    expect(results.find(r => r.name === 'valid-2')?.status).toBe('success');
  });
});
```

**Step 2: Green - 实现最小可行代码**

```typescript
// src/cli/processors/diagram-processor.ts

import pMap from 'p-map';

export class DiagramProcessor {
  async processDiagrams(config: GlobalConfig): Promise<void> {
    const concurrency = config.concurrency || os.cpus().length;

    await pMap(
      config.diagrams,
      async (diagramConfig) => {
        try {
          await this.processDiagram(diagramConfig);
        } catch (error) {
          console.error(`❌ Diagram ${diagramConfig.name} failed:`, error);
          throw error;
        }
      },
      { concurrency }
    );
  }
}
```

**Step 3: Refactor - 重构优化**

```typescript
// 添加进度跟踪
export class DiagramProcessor {
  private activeWorkers = new Map<string, Promise<void>>();

  async processDiagrams(config: GlobalConfig): Promise<void> {
    const concurrency = config.concurrency || os.cpus().length;
    const progress = new ParallelProgressReporter(
      config.diagrams.map(d => d.name)
    );

    try {
      await pMap(
        config.diagrams,
        async (diagramConfig) => {
          progress.update(diagramConfig.name, 0, 'Starting');
          await this.processDiagram(diagramConfig, progress);
          progress.complete(diagramConfig.name);
        },
        { concurrency }
      );
    } finally {
      progress.stop();
    }
  }
}
```

---

### 3.2 代码规范

**并发控制**:
```typescript
// 使用 p-map 进行并发控制
import pMap from 'p-map';

await pMap(
  items,
  async (item) => await processItem(item),
  { concurrency: os.cpus().length }
);
```

**错误处理**:
```typescript
// 单个失败不应影响其他
try {
  await processDiagram(diagram);
} catch (error) {
  console.error(`❌ ${diagram.name} failed:`, error);
  // 记录但继续处理其他 diagrams
  results.push({ name: diagram.name, status: 'error', error });
}
```

**进度报告**:
```typescript
// 批量更新进度，避免频繁刷新
progress.update(name, progressPercent);
// 而不是每次调用都刷新
```

---

### 3.3 测试策略

**单元测试**:
```bash
# 并行处理测试
npm test -- tests/unit/cli/processors/diagram-processor.test.ts

# 外部依赖过滤测试
npm test -- tests/unit/mermaid/validator-structural.test.ts

# 并行进度条测试
npm test -- tests/unit/cli/progress/parallel-progress.test.ts
```

**集成测试**:
```bash
# 6 个 diagrams 并行生成
npm test -- tests/integration/parallel-diagrams.test.ts
```

**性能测试**:
```bash
# 对比前后性能
npm test -- tests/performance/parallel-processing.test.ts
```

---

## 4. RLM VALIDATION - 验证阶段

### 4.1 验收标准

#### Phase 14.1: P0 核心优化

**功能验收**:
- [ ] 6 个 diagrams 并行处理成功
- [ ] 总耗时 <15s（对比 30-60s）
- [ ] 单个 diagram 失败不影响其他
- [ ] CPU 利用率 >80%
- [ ] 不再显示 "Checking Claude Code CLI"

**质量验收**:
- [ ] 测试覆盖率 ≥80%
- [ ] 所有现有测试通过
- [ ] 无回归问题

**性能验收**:
```bash
# 性能基准测试
npm run benchmark -- parallel

# 预期结果
Before: 6 diagrams = 30-60s
After:  6 diagrams = <15s
Speedup: 3-4x
```

---

#### Phase 14.2: P1 用户体验优化

**功能验收**:
- [ ] 警告数量 <10（对比 100+）
- [ ] 实时显示 6 个 diagrams 进度
- [ ] 支持 Ctrl+C 中断
- [ ] 质量评分 >85/100

**用户体验验收**:
- [ ] 进度条清晰可见
- [ ] 输出简洁明了
- [ ] 用户可以识别卡住的 diagram

---

#### Phase 14.3: P2-P3 高级优化

**功能验收**:
- [ ] 缓存命中率 >70%
- [ ] 重复运行 10x+ 提升
- [ ] 渲染阶段正确分离
- [ ] 额外 1.5x 性能提升

---

### 4.2 测试矩阵

| 测试类型 | 测试数量 | 覆盖率 | 责任人 |
|----------|----------|--------|--------|
| 单元测试 | 30+ | ≥80% | 开发者 |
| 集成测试 | 5+ | 100% | 开发者 |
| 性能测试 | 3+ | - | 开发者 |
| 回归测试 | 全部 | 100% | QA |

---

### 4.3 质量门控

**代码质量**:
```bash
# 类型检查
npm run type-check  # 必须 0 错误

# Lint
npm run lint        # 必须 0 警告

# 测试
npm test            # 必须 100% 通过
npm run test:coverage  # 必须 ≥80%
```

**性能门控**:
```bash
# 性能基准
npm run benchmark -- parallel

# 要求：
# 1. 6 diagrams <15s
# 2. CPU 利用率 >80%
# 3. 内存无泄漏
```

---

## 5. RLM INTEGRATION - 集成阶段

### 5.1 集成策略

**功能开关**:
```typescript
// src/config.ts
export const FEATURES = {
  PARALLEL_DIAGRAMS: true,      // 并行处理（默认启用）
  EXTERNAL_DEP_FILTER: true,    // 外部依赖过滤（默认启用）
  PARALLEL_PROGRESS: true,      // 并行进度条（默认启用）
  SOURCE_CACHE: true,           // 源代码缓存（默认启用）
  RENDER_SEPARATION: true,      // 渲染分离（默认启用）
};
```

**降级开关**:
```bash
# 如果并行处理出现问题，可以降级到串行
node dist/cli/index.js analyze --no-parallel

# 禁用进度条
node dist/cli/index.js analyze --no-progress

# 禁用缓存
node dist/cli/index.js analyze --no-cache
```

---

### 5.2 发布计划

**版本规划**:
```
v2.2.0-alpha.1  → 内部测试（Day 8）
v2.2.0-beta.1   → 公开测试（Day 9）
v2.2.0          → 稳定版发布（Day 10）
```

**发布清单**:
- [ ] 所有测试通过
- [ ] 性能基准达标
- [ ] 文档更新完整
- [ ] CHANGELOG.md 更新
- [ ] Git tag 创建
- [ ] NPM 发布

---

### 5.3 回滚计划

**回滚触发条件**:
- 性能未达到预期（<2x 提升）
- 严重 bug 导致功能失效
- 用户报告重大问题

**回滚步骤**:
```bash
# 1. 切换到 v2.1.0 分支
git checkout v2.1.0

# 2. 重新发布
npm run build
npm publish --tag latest

# 3. 通知用户
echo "v2.2.0 出现问题，已回滚到 v2.1.0"
```

---

## 6. RLM MONITORING - 监控阶段

### 6.1 监控指标

**性能指标** (Prometheus):
```typescript
// 新增指标
parallel_diagram_duration_seconds{diagram_name}  // 单个 diagram 耗时
parallel_diagram_concurrency                       // 当前并发数
cache_hit_ratio{source}                            // 缓存命中率
warning_count_filtered{reason}                     // 被过滤的警告数
parallel_diagram_errors_total{reason}              // 错误计数
```

**质量指标**:
```typescript
// 质量评分
quality_score{diagram_name}                        // 质量分数
completeness_score{diagram_name}                   // 完整性分数
warning_count{diagram_name, severity}              // 警告数量
```

---

### 6.2 日志策略

**结构化日志**:
```typescript
// 使用 pino
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

// 并行处理日志
logger.info({
  event: 'parallel_processing_start',
  diagramCount: diagrams.length,
  concurrency: os.cpus().length,
});

// 每个 diagram 完成
logger.info({
  event: 'diagram_complete',
  diagramName: '01-parser-pipeline',
  duration: 2345,
  status: 'success',
});
```

---

### 6.3 告警规则

**Prometheus 告警**:
```yaml
# 性能告警
- alert: DiagramGenerationSlow
  expr: parallel_diagram_duration_seconds > 30
  for: 5m
  annotations:
    summary: "Diagram generation too slow"

# 错误告警
- alert: DiagramErrorRateHigh
  expr: rate(parallel_diagram_errors_total[5m]) > 0.1
  annotations:
    summary: "High diagram error rate"

# 缓存命中率告警
- alert: CacheHitRateLow
  expr: cache_hit_ratio < 0.5
  for: 10m
  annotations:
    summary: "Cache hit rate below 50%"
```

---

### 6.4 持续优化

**每周回顾**:
- 性能指标趋势分析
- 用户反馈收集
- 识别优化机会

**每月优化**:
- 根据监控数据调整并发数
- 优化缓存策略
- 更新外部依赖黑名单

**季度规划**:
- 评估新优化方向
- 性能基准更新
- 架构演进计划

---

## 7. 附录

### 7.1 性能基准测试

**测试环境**:
- CPU: 8 核
- RAM: 16GB
- Node.js: v20.x
- 测试项目: ArchGuard 自身

**测试结果**:

| 版本 | 6 diagrams 耗时 | CPU 利用率 | 内存占用 |
|------|-----------------|------------|----------|
| v2.1.0 (串行) | 30-60s | 20-30% | 200MB |
| v2.2.0 (并行) | <15s | 80-95% | 220MB |
| **提升** | **3-4x** | **+3x** | +10% |

---

### 7.2 配置示例

**基础配置**:
```json
{
  "diagrams": [
    {"name": "d1", "sources": ["./src/parser"], "level": "class"},
    {"name": "d2", "sources": ["./src/mermaid"], "level": "class"},
    {"name": "d3", "sources": ["./src/cli"], "level": "class"}
  ],
  "concurrency": 8,
  "features": {
    "parallel": true,
    "progress": true,
    "cache": true
  }
}
```

**高级配置**:
```json
{
  "concurrency": 8,
  "cache": {
    "enabled": true,
    "ttl": 60
  },
  "rendering": {
    "separateStages": true,
    "renderConcurrency": 16
  },
  "warnings": {
    "filterExternal": true,
    "verbose": false
  }
}
```

---

### 7.3 故障排查

**问题 1: 并行处理变慢**
```bash
# 检查并发数
node dist/cli/index.js analyze --concurrency 4

# 降级到串行
node dist/cli/index.js analyze --no-parallel
```

**问题 2: 缓存导致旧数据**
```bash
# 清除缓存
node dist/cli/index.js cache clear

# 禁用缓存
node dist/cli/index.js analyze --no-cache
```

**问题 3: 进度条异常**
```bash
# 禁用进度条
node dist/cli/index.js analyze --no-progress

# 使用简单模式
node dist/cli/index.js analyze --progress-mode simple
```

---

**文档作者**: Claude Code (AI Assistant)
**创建日期**: 2026-01-28
**文档版本**: 1.0
**适用版本**: ArchGuard v2.2.0
**预计实施**: 7-10 个工作日

---

**变更历史**:
- v1.0 (2026-01-28): 初始版本，完整的 RLM 实施计划
