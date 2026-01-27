# ELK 布局引擎集成建议 (RLM 分析)

**文档版本**: 1.0
**创建日期**: 2026-01-27
**分析方法**: RLM (Refactoring Lifecycle Management)
**提案编号**: 012
**状态**: PROPOSAL
**优先级**: HIGH

---

## 执行摘要

本文档基于 RLM 方法提出集成 ELK (Eclipse Layout Kernel) 布局引擎到 ArchGuard 的建议，以解决当前 Mermaid 图表宽高比失控问题（如 `cli-class.mmd` 的 13.4:1 宽高比）。

**核心问题**：当前 Mermaid 渲染器无法控制图表宽高比，导致极宽或极高的图表，影响可读性。

**解决方案**：通过 Plan B (Direct ELK) 实现 100% 成功率的宽高比控制（目标范围 0.5:1 到 2:1）。

**实验验证**：ELK Layout Engine Experiment (`experiments/elk-layout-experiment/`) 已验证可行性。

---

## 1. PROPOSAL 阶段 - 问题定义与提案

### 1.1 问题描述

**当前状态**：
- ArchGuard 生成的 Mermaid 图表存在宽高比失控问题
- 案例数据：`cli-class.mmd` 生成 SVG 尺寸 16981×1266px，宽高比约 13.4:1
- 影响范围：20+ 类的中大型图表

**根本原因**：
- Mermaid 默认布局算法不提供宽高比控制
- YAML frontmatter 配置方式（Plan A）验证失败（0% 成功率）
- 缺乏对节点布局方向的精细控制

**影响分析**：
```
影响维度          | 严重程度 | 影响范围
-----------------|---------|-----------------
图表可读性        | HIGH    | 所有中大型图表
用户满意度        | MEDIUM  | 企业级项目用户
文档质量          | MEDIUM  | 生成的架构文档
工具可信度        | LOW     | 初次使用者
```

### 1.2 提案目标

**主要目标**：
1. ✅ 实现 0.5:1 到 2:1 的宽高比控制
2. ✅ 保持与现有 Mermaid 工作流的兼容性
3. ✅ 提供可选的 ELK 渲染路径

**次要目标**：
- 提升图表美观度
- 优化节点布局算法
- 支持多种布局方向（DOWN, RIGHT）

### 1.3 解决方案概述

**方案选择**：Plan B - Direct ELK Invocation

**技术路径**：
```
Mermaid Code → ArchJSON → ELK Graph → Layout → SVG/PNG
```

**关键组件**：
1. `ELKRenderer` - ELK 渲染引擎封装
2. `ArchJSONToELK` - ArchJSON 到 ELK 图格式转换器
3. `SVGGenerator` - ELK 布局结果到 SVG 转换
4. CLI 集成 - `--use-elk` 标志支持

**技术栈**：
- `elkjs` ^0.9.3 - ELK 布局引擎的 JavaScript 实现
- 现有 ArchJSON 结构
- TypeScript 类型安全

---

## 2. PLANNING 阶段 - 实施规划

### 2.1 架构设计

#### 2.1.1 组件架构

```
┌─────────────────────────────────────────────────────────┐
│                    CLI Layer                            │
│  --use-elk flag → LayoutStrategy (Mermaid | ELK)       │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
┌──────────────────┐    ┌─────────────────────────┐
│  MermaidRenderer │    │     ELKRenderer          │
│  (existing)      │    │     (new)                │
│  - isomorphic-   │    │  - elkjs                 │
│    mermaid       │    │  - Custom SVG generation │
└──────────────────┘    └──────────┬──────────────┘
                                   │
                        ┌──────────┴──────────┐
                        │                     │
                        ▼                     ▼
              ┌─────────────────┐  ┌──────────────────┐
              │ ArchJSONToELK   │  │  SVGGenerator    │
              │  (converter)    │  │  (renderer)      │
              └─────────────────┘  └──────────────────┘
```

#### 2.1.2 数据流设计

**当前流程**：
```
TypeScript Source → Parser → ArchJSON → MermaidGenerator → Mermaid Code
→ MermaidRenderer → SVG/PNG
```

**新增 ELK 流程**：
```
TypeScript Source → Parser → ArchJSON → ELKRenderer → ELK Graph
→ ELK.layout() → Laid-out Graph → SVGGenerator → SVG/PNG
```

#### 2.1.3 接口设计

```typescript
// src/mermaid/elk-renderer.ts

export interface ELKLayoutOptions {
  'elk.aspectRatio': number;      // 目标宽高比 (默认 1.5)
  'elk.direction': 'DOWN' | 'RIGHT' | 'UP' | 'LEFT';  // 布局方向
  'elk.algorithm': 'layered' | 'force' | 'mrtree';   // 布局算法
  'elk.spacing.nodeNode': string;  // 节点间距
}

export class ELKRenderer implements LayoutRenderer {
  async render(
    archjson: ArchJSON,
    options: ELKLayoutOptions
  ): Promise<RenderResult>;
}

// src/types/renderer.ts (扩展)

export type LayoutStrategy = 'mermaid' | 'elk';

export interface RenderConfig {
  strategy: LayoutStrategy;
  elk?: ELKLayoutOptions;
  mermaid?: MermaidConfig;
}
```

### 2.2 文件结构

```
src/
├── mermaid/
│   ├── elk-renderer.ts           # ELK 渲染器主类
│   ├── elk/
│   │   ├── archjson-to-elk.ts    # ArchJSON → ELK 转换
│   │   ├── svg-generator.ts      # ELK → SVG 生成
│   │   └── layout-calculator.ts  # 布局参数计算
│   └── renderer.ts               # 更新：添加 ELK 支持
├── cli/
│   └── commands/
│       └── analyze.ts            # 更新：添加 --use-elk 标志
└── types/
    └── renderer.ts               # 新增：渲染器类型定义
```

### 2.3 实施阶段

**Phase 1: 核心功能开发 (3-4 天)**
- [ ] 创建 `ELKRenderer` 类
- [ ] 实现 `ArchJSONToELK` 转换器
- [ ] 实现 `SVGGenerator`
- [ ] 单元测试 (目标: 80% 覆盖率)

**Phase 2: CLI 集成 (1-2 天)**
- [ ] 添加 `--use-elk` 标志
- [ ] 添加 `--elk-aspect-ratio` 配置
- [ ] 添加 `--elk-direction` 配置
- [ ] 更新配置文件支持

**Phase 3: 测试与验证 (2-3 天)**
- [ ] 集成测试
- [ ] 使用真实项目验证
- [ ] 性能基准测试
- [ ] 边界情况测试

**Phase 4: 文档与发布 (1 天)**
- [ ] 更新用户文档
- [ ] 更新配置示例
- [ ] 发布说明

**总计**: 7-10 天

### 2.4 风险评估

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|---------|
| ELK 布局效果不如预期 | MEDIUM | HIGH | 基于实验数据，100% 成功率 |
| 性能退化 | LOW | MEDIUM | 基准测试，缓存优化 |
| 与现有功能冲突 | LOW | MEDIUM | 功能开关，逐步推出 |
| 用户学习曲线 | LOW | LOW | 详细文档，默认关闭 |

---

## 3. EXECUTION 阶段 - 执行计划

### 3.1 开发任务清单

#### Task 3.1: 创建 ELK 渲染器基础架构
**负责人**: Core Team
**优先级**: P0
**预估工时**: 4h
**依赖**: 无

**子任务**:
- [ ] 安装 `elkjs` 依赖
- [ ] 创建 `src/mermaid/elk-renderer.ts`
- [ ] 定义 `ELKLayoutOptions` 接口
- [ ] 实现 `ELKRenderer.render()` 基础结构

**验收标准**:
- [ ] TypeScript 编译通过
- [ ] 基础接口定义完成
- [ ] 依赖安装成功

#### Task 3.2: 实现 ArchJSON 到 ELK 转换器
**负责人**: Core Team
**优先级**: P0
**预估工时**: 6h
**依赖**: Task 3.1

**子任务**:
- [ ] 创建 `src/mermaid/elk/archjson-to-elk.ts`
- [ ] 实现 `parseClassDiagram()` 解析 Mermaid 类图
- [ ] 实现 `convertToElkGraph()` 转换逻辑
- [ ] 处理节点、边、标签映射

**验收标准**:
- [ ] 正确解析 10+ 类的复杂图表
- [ ] 保留所有类关系信息
- [ ] 单元测试通过

#### Task 3.3: 实现 SVG 生成器
**负责人**: Core Team
**优先级**: P0
**预估工时**: 6h
**依赖**: Task 3.2

**子任务**:
- [ ] 创建 `src/mermaid/elk/svg-generator.ts`
- [ ] 实现 `generateSVG()` 主函数
- [ ] 实现节点渲染（矩形、文本、图标）
- [ ] 实现边渲染（直线、箭头）
- [ ] 添加主题支持（light/dark）

**验收标准**:
- [ ] 生成有效的 SVG 文件
- [ ] 支持浅色和深色主题
- [ ] 节点和边正确渲染

#### Task 3.4: CLI 集成
**负责人**: Core Team
**优先级**: P1
**预估工时**: 4h
**依赖**: Task 3.3

**子任务**:
- [ ] 添加 `--use-elk` 标志到 `analyze` 命令
- [ ] 添加 `--elk-aspect-ratio <ratio>` 配置
- [ ] 添加 `--elk-direction <DOWN|RIGHT>` 配置
- [ ] 更新 `archguard.config.json` schema

**验收标准**:
- [ ] CLI 标志正确工作
- [ ] 配置文件正确解析
- [ ] 帮助文档更新

#### Task 3.5: 测试与验证
**负责人**: QA Team
**优先级**: P1
**预估工时**: 8h
**依赖**: Task 3.4

**子任务**:
- [ ] 单元测试（目标 80% 覆盖率）
- [ ] 集成测试
- [ ] 使用 ArchGuard 自身分析测试
- [ ] 性能基准测试
- [ ] 边界情况测试

**验收标准**:
- [ ] 80% 单元测试覆盖率
- [ ] 所有集成测试通过
- [ ] 宽高比 100% 在 0.5-2.0 范围内
- [ ] 渲染时间 < 5秒/图表

### 3.2 代码示例

**ELK 渲染器核心实现**：

```typescript
// src/mermaid/elk-renderer.ts

import ELK from 'elkjs';
import { ArchJSON } from '@/types';
import { archjsonToELK } from './elk/archjson-to-elk.js';
import { generateSVG } from './elk/svg-generator.js';

export class ELKRenderer {
  private elk: ELK;

  constructor() {
    this.elk = new ELK();
  }

  async render(
    archjson: ArchJSON,
    options: ELKLayoutOptions = {}
  ): Promise<RenderResult> {
    // 默认配置
    const defaultOptions: ELKLayoutOptions = {
      'elk.aspectRatio': 1.5,
      'elk.direction': 'DOWN',
      'elk.algorithm': 'layered',
      'elk.spacing.nodeNode': '50',
      ...options
    };

    // 1. 转换 ArchJSON 到 ELK 图
    const elkGraph = archjsonToELK(archjson, defaultOptions);

    // 2. 应用 ELK 布局
    const layoutedGraph = await this.elk.layout(elkGraph, {
      layoutOptions: defaultOptions
    });

    // 3. 生成 SVG
    const svg = generateSVG(layoutedGraph);

    return {
      svg,
      width: layoutedGraph.width || 0,
      height: layoutedGraph.height || 0,
      aspectRatio: (layoutedGraph.width || 0) / (layoutedGraph.height || 1)
    };
  }
}
```

**CLI 集成示例**：

```typescript
// src/cli/commands/analyze.ts

export async function analyze(options: AnalyzeOptions) {
  // ... 现有代码 ...

  const renderConfig: RenderConfig = {
    strategy: options.useElk ? 'elk' : 'mermaid',
    elk: options.useElk ? {
      'elk.aspectRatio': options.elkAspectRatio || 1.5,
      'elk.direction': options.elkDirection || 'DOWN'
    } : undefined
  };

  const renderer = createRenderer(renderConfig);
  const result = await renderer.render(archjson);

  // ... 输出结果 ...
}
```

### 3.3 配置文件示例

**archguard.config.json**：

```json
{
  "source": "./src",
  "format": "mermaid",
  "renderer": {
    "strategy": "elk",
    "elk": {
      "aspectRatio": 1.5,
      "direction": "DOWN",
      "algorithm": "layered",
      "spacing": {
        "nodeNode": 50
      }
    }
  }
}
```

### 3.4 回滚计划

**触发条件**：
- 宽高比控制失败率 > 20%
- 性能退化 > 50%
- 关键功能回归

**回滚步骤**：
1. 通过 `--use-mermaid` 标志切换回原渲染器
2. 回滚 `package.json` 依赖
3. 恢复 CLI 配置
4. 发布回滚说明

**回滚时间**: < 2 小时

---

## 4. VALIDATION 阶段 - 验证计划

### 4.1 验证指标

| 指标类别 | 指标项 | 目标值 | 测量方法 |
|---------|--------|--------|---------|
| **功能** | 宽高比控制成功率 | ≥ 90% | 自动测试套件 |
| **功能** | DOWN 方向宽高比范围 | 0.5-2.0 | 自动测试 |
| **功能** | RIGHT 方向宽高比范围 | 0.5-2.0 | 自动测试 |
| **性能** | 渲染时间 (20+ 类) | < 5s | 性能基准 |
| **性能** | 内存占用 | < 300MB | 性能监控 |
| **质量** | 单元测试覆盖率 | ≥ 80% | coverage 工具 |
| **质量** | 集成测试通过率 | 100% | CI/CD |

### 4.2 测试策略

#### 4.2.1 单元测试

**测试范围**：
- `ELKRenderer` 类
- `ArchJSONToELK` 转换器
- `SVGGenerator` 生成器

**测试用例示例**：

```typescript
describe('ELKRenderer', () => {
  it('should control aspect ratio for DOWN direction', async () => {
    const archjson = createTestArchJSON(20); // 20 个类
    const renderer = new ELKRenderer();

    const result = await renderer.render(archjson, {
      'elk.direction': 'DOWN',
      'elk.aspectRatio': 1.5
    });

    expect(result.aspectRatio).toBeGreaterThanOrEqual(0.5);
    expect(result.aspectRatio).toBeLessThanOrEqual(2.0);
  });

  it('should control aspect ratio for RIGHT direction', async () => {
    const archjson = createTestArchJSON(20);
    const renderer = new ELKRenderer();

    const result = await renderer.render(archjson, {
      'elk.direction': 'RIGHT',
      'elk.aspectRatio': 1.5
    });

    expect(result.aspectRatio).toBeGreaterThanOrEqual(0.5);
    expect(result.aspectRatio).toBeLessThanOrEqual(2.0);
  });
});
```

#### 4.2.2 集成测试

**测试场景**：
1. 端到端渲染流程
2. CLI 标志集成
3. 配置文件解析
4. 与现有功能兼容性

**测试数据**：
- ArchGuard 自身分析 (100+ 类)
- 小型项目 (10-20 类)
- 中型项目 (30-50 类)
- 大型项目 (50+ 类)

#### 4.2.3 性能测试

**基准测试**：

| 场景 | 类数量 | Mermaid 时间 | ELK 时间 | 目标 |
|------|--------|-------------|---------|------|
| 小型 | 10 | ~2s | < 3s | 无显著退化 |
| 中型 | 30 | ~4s | < 5s | 可接受增长 |
| 大型 | 100 | ~8s | < 10s | 可接受增长 |

**性能监控**：
- CPU 使用率
- 内存占用
- 渲染时间
- 宽高比准确性

### 4.3 验收标准

**必需条件**（所有必须满足）：
- [ ] 宽高比控制成功率 ≥ 90%
- [ ] 单元测试覆盖率 ≥ 80%
- [ ] 所有集成测试通过
- [ ] 性能退化 < 50%
- [ ] 无关键功能回归

**期望条件**（至少满足 3/5）：
- [ ] 宽高比控制成功率 = 100%
- [ ] 渲染时间 < Mermaid 的 1.2x
- [ ] 用户体验提升（主观评分）
- [ ] 文档完整性
- [ ] 代码审查通过

---

## 5. INTEGRATION 阶段 - 集成计划

### 5.1 集成策略

**阶段式推出**：

```
Phase 1: 内部测试 (Week 1)
├── 团队内部使用
├── 收集反馈
└── Bug 修复

Phase 2: Beta 测试 (Week 2)
├── 功能标志默认关闭
├── 早期采用者测试
└── 性能监控

Phase 3: 正式发布 (Week 3)
├── 功能标志默认关闭
├── 文档完善
└── 用户教育

Phase 4: 默认启用 (Week 4+)
├── 评估 Beta 反馈
├── 大型图表自动启用 ELK
└── 持续优化
```

### 5.2 功能开关设计

**配置层次**：

```typescript
// 1. CLI 标志 (最高优先级)
--use-elk                          // 强制使用 ELK
--use-mermaid                      // 强制使用 Mermaid

// 2. 配置文件
{
  "renderer": {
    "strategy": "elk",             // 'mermaid' | 'elk' | 'auto'
    "elk": { ... },
    "auto": {
      "threshold": 20,             // 类数量阈值
      "aspectRatioLimit": 2.0      // 宽高比阈值
    }
  }
}

// 3. 智能模式 (auto)
if (entityCount > threshold || estimatedAspectRatio > aspectRatioLimit) {
  use ELK
} else {
  use Mermaid
}
```

### 5.3 向后兼容性

**保证**：
- [ ] 默认行为不变（Mermaid 优先）
- [ ] 现有配置文件继续工作
- [ ] CLI 标志向后兼容
- [ ] 生成的 Mermaid 代码不受影响

**迁移路径**：

```bash
# 旧方式 (继续工作)
npm run build
node dist/cli/index.js analyze

# 新方式 (可选)
node dist/cli/index.js analyze --use-elk
node dist/cli/index.js analyze --use-elk --elk-aspect-ratio 1.5

# 或配置文件
echo '{"renderer": {"strategy": "elk"}}' > archguard.config.json
```

### 5.4 文档更新

**需要更新的文档**：
1. `docs/CLAUDE.md` - 添加 ELK 渲染说明
2. `docs/CONFIGURATION.md` - 添加 renderer 配置
3. `docs/CLI-USAGE.md` - 添加 `--use-elk` 标志
4. README.md - 添加 ELK 特性说明
5. CHANGELOG.md - 记录新特性

**新文档**：
1. `docs/elk-rendering-guide.md` - ELK 渲染完整指南
2. `docs/elk-faq.md` - 常见问题解答
3. `examples/elk-config/` - 配置示例

### 5.5 发布计划

**发布检查清单**：
- [ ] 所有测试通过
- [ ] 性能基准达标
- [ ] 文档更新完成
- [ ] 示例代码就绪
- [ ] 发布说明草稿
- [ ] 向后兼容性验证

**发布说明模板**：

```markdown
## v2.1.0 - ELK Layout Engine Integration (2026-01-XX)

### ✨ New Features

- **ELK Layout Engine**: Optional ELK renderer for better aspect ratio control
  - `--use-elk` flag to enable ELK rendering
  - `--elk-aspect-ratio` to control target aspect ratio
  - `--elk-direction` to choose layout direction (DOWN/RIGHT)

### 🔧 Improvements

- Aspect ratio control for large diagrams (100% success rate)
- Automatic ELK activation for complex diagrams
- Enhanced layout algorithm for better readability

### 📚 Documentation

- Added ELK rendering guide
- Updated configuration documentation
- New examples for ELK usage

### 🐛 Bug Fixes

- Fixed extreme aspect ratios in large class diagrams
- Improved node spacing in complex diagrams

### ⚠️ Breaking Changes

None (opt-in feature)

### 🔄 Migration Guide

See [ELK Rendering Guide](docs/elk-rendering-guide.md) for details.
```

---

## 6. MONITORING 阶段 - 监控与优化

### 6.1 监控指标

**技术指标**：

```typescript
interface ELKTelemetry {
  // 使用统计
  totalRenders: number;
  elkRenders: number;
  elkAdoptionRate: number;  // elkRenders / totalRenders

  // 性能指标
  avgRenderTime: number;
  p95RenderTime: number;
  avgMemoryUsage: number;

  // 质量指标
  aspectRatioSuccessRate: number;  // 目标: ≥ 90%
  avgAspectRatio: number;           // 目标: 0.5-2.0
  aspectRatioDistribution: {
    acceptable: number;  // 0.5-2.0
    tooWide: number;     // > 2.0
    tooTall: number;     // < 0.5
  };

  // 用户反馈
  userSatisfactionScore: number;  // 1-5
  bugReports: number;
  featureRequests: number;
}
```

**数据收集方式**：
- 可选的遥测（`--telemetry` 标志）
- 匿名使用统计
- 性能日志记录

### 6.2 反馈循环

**用户反馈渠道**：
1. GitHub Issues
2. CLI 使用反馈提示
3. 文档评论区
4. 社区讨论

**反馈处理流程**：

```
用户反馈 → 分类 → 优先级排序 → 路由 → 解决 → 通知
                │
                ├─ Bug → 立即修复
                ├─ Feature Request → 产品路线图
                └─ Question → 文档更新
```

### 6.3 持续优化计划

**短期优化** (1-2 周)：
- 监控真实使用数据
- 修复常见问题
- 优化性能热点
- 完善文档

**中期优化** (1-2 月)：
- 高级 ELK 特性（节点层次、边标签）
- 自适应布局算法
- 性能优化
- 更多布局选项

**长期优化** (3-6 月)：
- 交互式图表（缩放、平移）
- 自定义样式
- 多种 ELK 算法支持
- 用户布局模板

### 6.4 成功指标

**3 个月目标**：
- ELK 采用率 > 30%（针对复杂图表）
- 用户满意度 > 4.0/5.0
- 宽高比成功率 > 95%
- 性能无显著退化

**6 个月目标**：
- ELK 成为大型图表默认渲染器
- 社区贡献改进
- 形成最佳实践文档
- 集成到其他工具

---

## 7. RLM 总结

### 7.1 各阶段成果

| 阶段 | 主要成果 | 状态 |
|------|---------|------|
| **PROPOSAL** | 问题定义、解决方案选择、实验验证 | ✅ 完成 |
| **PLANNING** | 架构设计、实施计划、风险评估 | ✅ 完成 |
| **EXECUTION** | 代码实现、单元测试、CLI 集成 | 🔄 待开始 |
| **VALIDATION** | 验证指标、测试策略、验收标准 | 🔄 待开始 |
| **INTEGRATION** | 集成策略、功能开关、文档更新 | 🔄 待开始 |
| **MONITORING** | 监控指标、反馈循环、优化计划 | 🔄 待开始 |

### 7.2 关键成功因素

1. **实验验证**：基于 `experiments/elk-layout-experiment/` 的数据
2. **渐进式集成**：功能开关，无破坏性变更
3. **性能保证**：基准测试，性能监控
4. **用户友好**：详细文档，清晰配置

### 7.3 下一步行动

**立即行动** (本周)：
- [ ] 提案审查与批准
- [ ] 组建实施团队
- [ ] 建立开发分支

**短期行动** (2-4 周)：
- [ ] 完成 Phase 1 & 2 (核心开发)
- [ ] 内部测试与反馈
- [ ] Beta 版本发布

**中期行动** (1-2 月)：
- [ ] 正式版本发布
- [ ] 用户教育与文档
- [ ] 监控与优化

---

## 8. 附录

### 8.1 实验数据参考

**实验位置**: `experiments/elk-layout-experiment/`

**关键发现**：
- Plan A (YAML): 0% 成功率 (10/10 失败)
- Plan B (Direct ELK): 100% 成功率 (4/4 成功)
- 宽高比范围：0.89:1 到 1.94:1

**详细报告**：
- `experiments/elk-layout-experiment/reports/comparison.md`
- `experiments/elk-layout-experiment/reports/plan-b-report.md`

### 8.2 技术参考

**ELK 官方文档**：
- https://www.eclipse.org/elk/documentation.html
- https://github.com/kieler/elkjs

**ArchGuard 相关**：
- `docs/architecture.md` - 系统架构
- `docs/specs.md` - 需求规格
- `docs/MIGRATION-v2.0.md` - Mermaid 迁移

### 8.3 变更历史

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|---------|------|
| 1.0 | 2026-01-27 | 初始提案创建 | Claude |
| | | | |

---

**文档状态**: ✅ Ready for Review
**下一步**: 等待提案批准 → 进入 PLANNING 执行阶段
