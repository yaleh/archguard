# Phase 13: 架构图元数据增强实施计划 (TDD)

**计划名称**: ArchGuard 架构图元数据增强与自解释文档
**阶段**: Phase 13 - Diagram Metadata Enhancement
**方法论**: RLM (Refactoring Lifecycle Management) + TDD
**预计时间**: 6-8 个工作日（纯开发），4 周总计（含测试和发布）
**依赖**: Phase 9 (多层次架构图) 完成，或 Phase 10 (Mermaid 迁移) 完成
**创建日期**: 2026-01-28
**对应提案**: [13-diagram-metadata-enhancement.md](../proposals/13-diagram-metadata-enhancement.md)
**⚠️ Breaking Change**: 是 - v2.1.0 主版本升级

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
- ✅ Phase 9: 多层次架构图生成已实现（package/class/method 三级）
- ✅ Phase 10: Mermaid 图表迁移已完成（完全移除 PlantUML）
- ❌ 架构图缺少上下文信息（系统信息、输入输出、设计模式）
- ❌ 新成员理解困难，需要额外询问
- ❌ 配置文件缺少元数据指导
- ❌ Mermaid 注释缺失或不完整
- ❌ 设计模式不可见

**用户体验问题**:

| 问题 | 当前状态 | 影响 |
|------|----------|------|
| **这是什么项目的 CLI?** | 无系统信息 | 🔴 严重 |
| **输入是什么?输出是什么?** | 无 I/O 说明 | 🔴 严重 |
| **有多少个处理阶段?** | 无流程说明 | 🟡 中等 |
| **这是什么设计模式?** | 无模式标注 | 🟡 中等 |
| **哪个是核心类?** | 无高亮标注 | 🟢 轻微 |

**架构问题**:
1. ❌ **两层设计混淆**: 混淆了"配置生成 Prompt"（给 LLM）和"注释生成器"（代码组件）
2. ❌ **配置文件缺少指导**: Claude Code 不知道应该添加哪些元数据
3. ❌ **Mermaid 注释生成缺失**: ArchGuard 没有组件生成注释
4. ❌ **配置格式不够语义化**: `description` 字段过于简略

### 1.2 提案目标

**核心目标**: 实现架构图"自解释"功能，让图表即文档

**具体目标**:
1. **两层设计架构** (Priority: High - P0)
   - Layer 1: 配置生成 Prompt（给 Claude Code）
   - Layer 2: 注释生成器 CommentGenerator（代码组件）
   - 清晰的职责分离

2. **扩展配置格式** (Priority: High - P0)
   - 新增 `metadata` 字段（标题、用途、输入输出）
   - 新增 `design` 字段（设计模式、架构风格）
   - 新增 `process` 字段（处理流程、阶段列表）
   - 新增 `annotations` 字段（注释控制、类级标注）

3. **Mermaid 注释生成器** (Priority: High - P0)
   - CommentGenerator 组件实现
   - 自动生成头部、设计模式、流程注释
   - 支持 stereotype 标注

4. **破坏性变更，简化设计** (Priority: High - P0)
   - 不保证向后兼容
   - 简化字段命名和结构
   - 提供自动迁移工具

### 1.3 成功指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 元数据字段采用率 | > 60%（6个月内） | 配置分析 |
| 注释生成成功率 | > 95% | 单元测试 |
| Mermaid 验证通过率 | 100% | 自动验证 |
| 新成员理解时间减少 | > 50% | 用户调研 |
| 配置迁移成功率 | > 90% | 迁移测试 |
| 架构图可读性提升 | +500% | 主观评估 |
| 文档维护成本降低 | -80% | 时间追踪 |

### 1.4 技术栈

**核心库**:
```json
{
  "dependencies": {
    "类型验证": "已使用 (zod)",
    "文件操作": "已使用 (fs-extra)",
    "CLI": "已使用 (commander)"
  }
}
```

**新增依赖**: 无（使用现有依赖）

### 1.5 影响范围

**新增文件**:
- `docs/prompts/config-generation-prompt.md` - 配置生成 Prompt 文档
- `src/mermaid/comment-generator.ts` - 注释生成器组件
- `tests/unit/mermaid/comment-generator.test.ts` - 单元测试
- `scripts/migrate-config-v2.1.ts` - 迁移工具脚本

**修改文件**:
- `src/types/config.ts` - 类型定义扩展（`metadata`, `design`, `process`, `annotations`）
- `src/mermaid/generator.ts` - 集成 CommentGenerator
- `src/cli/config-loader.ts` - 配置加载和验证
- `CLAUDE.md` - 添加配置字段说明
- `examples/config/enhanced-config.json` - 示例配置

**配置文件格式变更**:
```diff
# 旧格式 (v2.0)
{
  "name": "parser",
  "sources": ["./src/parser"],
  "level": "class",
- "description": "Parser Layer - Shows how to parse..."
}

# 新格式 (v2.1)
{
  "name": "parser",
  "sources": ["./src/parser"],
  "level": "class",
+ "metadata": {
+   "title": "Parser Layer Architecture",
+   "purpose": "展示如何将 TypeScript 源代码解析为 ArchJSON",
+   "input": {
+     "type": "TypeScript Source Files",
+     "example": "./src/**/*.ts"
+   },
+   "output": {
+     "description": "ArchJSON structure",
+     "formats": ["JSON"]
+   }
+ }
}
```

---

## 2. RLM PLANNING - 计划阶段

### 2.1 迭代划分

#### Phase 13.1: 基础设施（Day 1-2）

**目标**: 搭建基础架构，实现核心功能

**任务清单**:
1. [ ] 扩展类型定义（`src/types/config.ts`）
   - 新增 `DiagramMetadata` 接口
   - 新增 `DesignInfo` 接口
   - 新增 `ProcessInfo` 接口
   - 新增 `AnnotationConfig` 接口
   - 更新 `DiagramConfig` 扩展

2. [ ] 创建配置生成 Prompt（`docs/prompts/config-generation-prompt.md`）
   - 编写完整的 Prompt 模板
   - 提供填写指南和示例
   - 添加设计模式识别技巧
   - 添加处理流程提取技巧

3. [ ] 实现 CommentGenerator 基础功能（`src/mermaid/comment-generator.ts`）
   - `generateHeader()` - 生成头部注释
   - `generatePatternComments()` - 生成设计模式注释
   - `generateProcessComments()` - 生成处理流程注释
   - `generateUsageComments()` - 生成使用场景注释
   - `generateAll()` - 生成完整注释

4. [ ] 集成到 MermaidGenerator（`src/mermaid/generator.ts`）
   - 实例化 CommentGenerator
   - 在 `generate()` 方法中调用注释生成
   - 支持 `enableComments` 开关

**验收标准**:
- [ ] 类型定义编译通过
- [ ] Prompt 文档完整可用
- [ ] CommentGenerator 基础功能测试通过
- [ ] 生成带注释的 Mermaid 代码

---

#### Phase 13.2: 增强功能（Day 3）

**目标**: 实现设计模式标注和类级标注

**任务清单**:
1. [ ] 实现设计模式 stereotype 生成
   - `generatePatternStereotypes()` - 生成 Mermaid stereotype
   - `getPatternShortName()` - 模式名称缩写映射
   - 集成到类定义生成

2. [ ] 实现类级标注功能
   - `applyClassAnnotations()` - 应用类级标注
   - 支持 `stereotypes`、`note`、`responsibility`
   - 集成到 MermaidGenerator

3. [ ] 实现注释级别控制
   - 支持简短/详细/完整三种级别
   - 可通过 `annotationLevel` 配置控制

**验收标准**:
- [ ] 设计模式正确标注为 `<<Pattern>>`
- [ ] 类级注释正确显示
- [ ] 注释级别切换正常

---

#### Phase 13.3: 迁移工具（Day 4）

**目标**: 提供自动迁移工具，降低用户迁移成本

**任务清单**:
1. [ ] 实现迁移工具脚本（`scripts/migrate-config-v2.1.ts`）
   - `migrateConfigToV21()` - 迁移主函数
   - 读取旧配置
   - 转换 `description` → `metadata`
   - 验证新配置
   - 输出新配置

2. [ ] 集成迁移命令到 CLI
   - 新增 `migrate-config` 命令
   - 支持命令行参数：`--input`, `--output`, `--dry-run`
   - 提供迁移前预览

3. [ ] 更新 ConfigLoader
   - 支持旧配置自动迁移警告
   - 提供迁移提示

**验收标准**:
- [ ] 迁移工具成功转换标准配置
- [ ] 迁移后配置验证通过
- [ ] CLI 命令正常工作
- [ ] 迁移成功率 > 95%

---

#### Phase 13.4: 测试（Day 5）

**目标**: 完整的测试覆盖，确保质量

**任务清单**:
1. [ ] 单元测试（`tests/unit/mermaid/comment-generator.test.ts`）
   - 测试注释生成各个方法
   - 测试边界情况
   - 测试错误处理

2. [ ] 集成测试
   - 测试完整生成流程
   - 测试配置加载和生成
   - 测试迁移工具

3. [ ] E2E 测试
   - 手动验证生成的图表
   - 验证注释格式正确性
   - 验证 Mermaid 渲染通过

4. [ ] 性能测试
   - 注释生成性能
   - 配置文件解析性能

**验收标准**:
- [ ] 测试覆盖率 ≥ 85%
- [ ] 所有集成测试通过
- [ ] E2E 测试通过
- [ ] 性能无明显回归

---

#### Phase 13.5: 文档和发布（Day 6-8）

**目标**: 完整的文档和发布准备

**任务清单**:
1. [ ] 更新 CLAUDE.md
   - 添加配置字段说明
   - 添加元数据示例
   - 添加迁移指南

2. [ ] 更新 README.md
   - 添加元数据增强特性说明
   - 更新使用示例

3. [ ] 创建示例配置
   - `examples/config/minimal-metadata-config.json` - 最小化元数据
   - `examples/config/full-metadata-config.json` - 完整元数据
   - `examples/config/design-patterns-config.json` - 设计模式示例

4. [ ] 编写迁移指南
   - `docs/MIGRATION-v2.1.md` - 详细迁移步骤
   - 常见迁移场景
   - 故障排除

5. [ ] 发布准备
   - 更新 CHANGELOG.md
   - 准备发布说明
   - 创建 GitHub Release

**验收标准**:
- [ ] 文档完整准确
- [ ] 示例配置可运行
- [ ] 迁移指南清晰
- [ ] 发布材料完整

---

### 2.2 时间表

```
Week 1 (Day 1-5): Phase 13.1 - 13.2
├─ Day 1: 类型定义 + Prompt 文档
├─ Day 2: CommentGenerator 实现
├─ Day 3: 设计模式标注 + 类级标注
└─ Day 4: 迁移工具

Week 2 (Day 6-10): Phase 13.4 - 13.5
├─ Day 6-7: 单元测试 + 集成测试
├─ Day 8: E2E 测试 + 性能测试
├─ Day 9-10: 文档编写

Week 3-4: Beta 测试和发布
├─ Week 3: Beta 版本发布 + 用户测试
└─ Week 4: Bug 修复 + 正式发布

总工期: 6-8 个工作日（纯开发），4 周总计
```

---

### 2.3 TDD 测试用例设计

#### Story 1: 元数据字段扩展

**验收标准**:
- [ ] `DiagramMetadata` 接口定义完整
- [ ] 所有字段都是可选的（推荐提供）
- [ ] TypeScript 类型检查通过
- [ ] Zod 验证 schema 可配置

**测试用例**:
```typescript
describe('DiagramMetadata', () => {
  describe('字段验证', () => {
    it('应该接受完整的 metadata', () => {
      const metadata: DiagramMetadata = {
        title: 'Test',
        subtitle: 'Subtitle',
        purpose: 'Purpose',
        primaryActors: ['Developer'],
        input: { type: 'TS Files', example: './src/**/*.ts' },
        output: { description: 'Output', formats: ['PNG'] }
      };
      expect(validateMetadata(metadata)).toBe(true);
    });

    it('应该允许空 metadata', () => {
      const metadata: DiagramMetadata = {};
      expect(validateMetadata(metadata)).toBe(true);
    });
  });
});
```

**红-绿-重构循环**:
1. 🔴 **红**: 写测试验证 `metadata` 接口
2. 🟢 **绿**: 实现接口定义，让测试通过
3. ♻️ **重构**: 提取公共类型，优化结构

---

#### Story 2: CommentGenerator 基础功能

**验收标准**:
- [ ] `generateHeader()` 生成格式正确的头部注释
- [ ] `generatePatternComments()` 生成设计模式注释
- [ ] `generateProcessComments()` 生成流程注释
- [ ] `generateAll()` 生成完整注释

**测试用例**:
```typescript
describe('CommentGenerator', () => {
  describe('generateHeader', () => {
    it('应该生成完整的头部注释', () => {
      const config: DiagramConfig = {
        name: 'test',
        sources: ['./src'],
        level: 'class',
        metadata: {
          title: 'Test Diagram',
          purpose: 'Test purpose',
          input: { type: 'TS Files' },
          output: { description: 'Output' }
        }
      };

      const generator = new CommentGenerator();
      const output = generator.generateHeader(config);

      expect(output).toContain('%% Test Diagram');
      expect(output).toContain('%% Purpose: Test purpose');
      expect(output).toContain('%% Input:');
    });

    it('应该在无 metadata 时返回空字符串', () => {
      const config: DiagramConfig = {
        name: 'test',
        sources: ['./src'],
        level: 'class'
      };

      const generator = new CommentGenerator();
      const output = generator.generateHeader(config);

      expect(output).toBe('');
    });
  });

  describe('generatePatternComments', () => {
    it('应该生成设计模式注释', () => {
      const config: DiagramConfig = {
        name: 'test',
        sources: ['./src'],
        level: 'class',
        design: {
          patterns: [{
            name: 'Strategy Pattern',
            category: 'behavioral',
            participants: ['A', 'B'],
            description: 'Test pattern'
          }]
        }
      };

      const generator = new CommentGenerator();
      const output = generator.generatePatternComments(config);

      expect(output).toContain('%% Design Patterns');
      expect(output).toContain('%% Strategy Pattern');
      expect(output).toContain('%% Participants: A, B');
    });
  });
});
```

---

#### Story 3: 配置迁移工具

**验收标准**:
- [ ] 迁移工具成功转换 `description` → `metadata`
- [ ] 迁移工具保留所有原有配置
- [ ] 迁移后配置验证通过
- [ ] CLI 命令 `migrate-config` 正常工作

**测试用例**:
```typescript
describe('migrateConfigToV21', () => {
  it('应该迁移旧配置到新格式', () => {
    const oldConfig = {
      diagrams: [{
        name: 'test',
        sources: ['./src'],
        level: 'class',
        description: '旧格式描述'
      }]
    };

    const newConfig = migrateConfigToV21(oldConfig);

    expect(newConfig.diagrams[0].metadata).toBeDefined();
    expect(newConfig.diagrams[0].metadata?.title).toBe('test');
    expect(newConfig.diagrams[0].metadata?.purpose).toBe('旧格式描述');
    expect(newConfig.diagrams[0].description).toBeUndefined();
  });

  it('应该保留其他字段', () => {
    const oldConfig = {
      outputDir: './test',
      diagrams: [{
        name: 'test',
        sources: ['./src'],
        level: 'class',
        description: '旧格式描述'
      }]
    };

    const newConfig = migrateConfigToV21(oldConfig);

    expect(newConfig.outputDir).toBe('./test');
    expect(newConfig.diagrams[0].sources).toEqual(['./src']);
    expect(newConfig.diagrams[0].level).toBe('class');
  });
});
```

---

### 2.4 风险评估与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 配置生成 Prompt 效果不佳 | 中 | 中 | 多轮迭代，提供丰富示例 |
| 注释过于冗长 | 低 | 中 | 可配置 `annotationLevel` |
| 破坏性变更导致用户流失 | 高 | 高 | 提供自动迁移工具 + 详细文档 |
| 迁移工具失败 | 中 | 高 | 完整测试 + 回滚机制 |
| 用户不采用新格式 | 中 | 低 | 展示价值，简化配置流程 |

---

## 3. RLM EXECUTION - 执行阶段

### 3.1 开发流程

#### TDD 循环

```
每个 Story 遵循红-绿-重构循环：

1. 🔴 红阶段（30 分钟）
   - 编写失败的测试
   - 定义接口和类型
   - 示例测试用例

2. 🟢 绿阶段（1-2 小时）
   - 实现最小功能让测试通过
   - 不考虑代码质量

3. ♻️ 重构阶段（1-2 小时）
   - 提取重复代码
   - 优化代码结构
   - 确保测试仍然通过
```

#### 每日工作流

```
09:00-10:00: 查看任务清单，规划今日工作
10:00-12:00: TDD 红阶段 - 编写测试
13:00-15:00: TDD 绿阶段 + 重构阶段
15:00-16:00: 代码审查和提交
16:00-17:00: 更新文档，准备次日工作
```

---

### 3.2 代码示例

#### CommentGenerator 实现

**文件**: `src/mermaid/comment-generator.ts`

```typescript
/**
 * Mermaid 注释生成器
 *
 * 职责：将配置元数据转换为 Mermaid 注释字符串
 *
 * 设计说明：
 * - 这是纯代码实现，使用字符串拼接生成注释
 * - 不涉及 LLM 调用
 * - 可测试、可维护、性能高
 *
 * @example
 * const generator = new CommentGenerator();
 * const comments = generator.generateAll(config);
 */

export class CommentGenerator {
  /**
   * 生成图表头部注释
   */
  generateHeader(config: DiagramConfig): string {
    const meta = config.metadata;

    if (!meta) return '';

    let output = '\n%% ============================================================\n';
    output += `%% ${meta.title || config.name}\n`;

    if (meta.subtitle) {
      output += `%% ${meta.subtitle}\n`;
    }

    output += '%% ============================================================\n';

    if (meta.purpose) {
      output += `\n%% Purpose: ${meta.purpose}\n`;
    }

    if (meta.primaryActors && meta.primaryActors.length > 0) {
      output += `\n%% Primary Actors: ${meta.primaryActors.join(', ')}\n`;
    }

    // Input/Output
    if (meta.input || meta.output) {
      output += '\n%% ============================================================\n';

      if (meta.input) {
        output += `\n%% Input:\n`;
        output += `%%   Type: ${meta.input.type}\n`;
        if (meta.input.description) {
          output += `%%   Description: ${meta.input.description}\n`;
        }
        if (meta.input.example) {
          output += `%%   Example: ${meta.input.example}\n`;
        }
      }

      if (meta.output) {
        output += `\n%% Output:\n`;
        output += `%%   Description: ${meta.output.description}\n`;
        if (meta.output.formats) {
          output += `%%   Formats: ${meta.output.formats.join(', ')}\n`;
        }
        if (meta.output.example) {
          output += `%%   Example: ${meta.output.example}\n`;
        }
      }

      output += '\n%% ============================================================\n';
    }

    return output;
  }

  // ... 其他方法
}
```

---

#### 迁移工具实现

**文件**: `scripts/migrate-config-v2.1.ts`

```typescript
#!/usr/bin/env ts-node

/**
 * ArchGuard 配置迁移工具 v2.0 → v2.1
 *
 * 变更内容：
 * - description → metadata.title + metadata.purpose
 * - 保留所有其他字段
 * - 验证新配置格式
 */

import { readFile, writeFile } from 'fs/promises';
import type { ArchGuardConfig as ConfigV20 } from '../src/types/config.js';
import type { ArchGuardConfig as ConfigV21 } from '../src/types/config.js';

interface MigrationOptions {
  input: string;
  output: string;
  dryRun?: boolean;
}

/**
 * 迁移配置到 v2.1 格式
 */
export function migrateConfigToV21(oldConfig: ConfigV20): ConfigV21 {
  const diagrams = oldConfig.diagrams || [];

  return {
    ...oldConfig,
    diagrams: diagrams.map((diag: any) => {
      const newDiag: any = { ...diag };

      // 迁移 description → metadata
      if (diag.description && !diag.metadata) {
        newDiag.metadata = {
          title: diag.name,
          purpose: diag.description
        };
        delete newDiag.description;
      }

      return newDiag;
    })
  };
}

/**
 * CLI 主函数
 */
async function main(options: MigrationOptions) {
  // 读取旧配置
  const oldConfigContent = await readFile(options.input, 'utf-8');
  const oldConfig: ConfigV20 = JSON.parse(oldConfigContent);

  // 迁移
  const newConfig = migrateConfigToV21(oldConfig);

  // 输出
  if (options.dryRun) {
    console.log('[Dry Run] 新配置:');
    console.log(JSON.stringify(newConfig, null, 2));
  } else {
    await writeFile(options.output, JSON.stringify(newConfig, null, 2));
    console.log(`✅ 配置已迁移到: ${options.output}`);
  }
}

// CLI 调用
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    input: args[0] || './archguard.config.json',
    output: args[1] || './archguard.config.json',
    dryRun: args.includes('--dry-run')
  };

  main(options).catch(console.error);
}
```

---

### 3.3 核心组件设计

#### CommentGenerator 组件

**职责**:
1. 从配置元数据生成 Mermaid 注释字符串
2. 支持多种注释类型（头部、设计模式、流程、使用场景）
3. 支持注释级别控制
4. 性能优化（缓存、惰性求值）

**方法签名**:
```typescript
class CommentGenerator {
  generateHeader(config: DiagramConfig): string;
  generatePatternComments(config: DiagramConfig): string;
  generateProcessComments(config: DiagramConfig): string;
  generateUsageComments(config: DiagramConfig): string;
  generateAll(config: DiagramConfig): string;
  generatePatternStereotypes(config: DiagramConfig): Map<string, string>;
  applyClassAnnotations(entity: Entity, config: DiagramConfig): ClassAnnotations;
}
```

---

#### 迁移工具组件

**职责**:
1. 读取旧配置文件
2. 转换配置格式（description → metadata）
3. 验证新配置
4. 输出新配置

**方法签名**:
```typescript
interface ConfigMigrator {
  migrate(input: string, output: string): Promise<void>;
  validate(config: ConfigV21): ValidationResult;
  backup(input: string): Promise<string>;
}
```

---

## 4. RLM VALIDATION - 验证阶段

### 4.1 质量门控

| 检查项 | 目标 | 验证方式 | 责任人 |
|--------|------|---------|--------|
| 单元测试覆盖率 | ≥ 85% | `npm run test:coverage` | 开发者 |
| 注释格式正确性 | 100% | Mermaid 验证 | 开发者 |
| 迁移工具成功率 | > 95% | 测试用例 | 开发者 |
| 文档完整性 | 100% | Manual review | 技术写作 |
| 配置生成 Prompt 可用性 | 100% | Claude Code 测试 | AI 工程师 |
| 性能无回归 | ✓ | 基准测试 | 开发者 |

### 4.2 验收测试

#### 功能验收

```bash
# 1. 创建增强配置
cat > test-config.json <<'EOF'
{
  "diagrams": [{
    "name": "parser-test",
    "sources": ["./src/parser"],
    "level": "class",
    "metadata": {
      "title": "Parser Layer Architecture",
      "purpose": "展示如何解析源代码",
      "input": {
        "type": "TypeScript files",
        "example": "./src/**/*.ts"
      },
      "output": {
        "description": "ArchJSON structure",
        "formats": ["JSON"]
      }
    },
    "design": {
      "patterns": [{
        "name": "Strategy Pattern",
        "category": "behavioral",
        "participants": ["ClassExtractor", "MethodExtractor"],
        "description": "不同元素使用不同策略"
      }]
    }
  }]
}
EOF

# 2. 生成图表
npm run build
node dist/cli/index.js analyze --config test-config.json

# 3. 验证输出
cat archguard/parser-test.mmd | grep "%% Purpose"
cat archguard/parser-test.mmd | grep "%% Design Patterns"
cat archguard/parser-test.mmd | grep "%% Input:"
```

**预期输出**：
```
%% Purpose: 展示如何解析源代码
%% Design Patterns
%%   Strategy Pattern
%% Input:
%%   Type: TypeScript files
```

#### 迁移工具验收

```bash
# 1. 创建旧格式配置
cat > old-config.json <<'EOF'
{
  "diagrams": [{
    "name": "test",
    "sources": ["./src/parser"],
    "level": "class",
    "description": "旧格式描述"
  }]
}
EOF

# 2. 运行迁移
npx archguard migrate-config --input old-config.json --output new-config.json

# 3. 验证迁移结果
cat new-config.json | jq '.diagrams[0].metadata'

# 4. 测试新配置
node dist/cli/index.js analyze --config new-config.json
```

**预期输出**：
```json
{
  "title": "test",
  "purpose": "旧格式描述"
}
```

---

### 4.3 性能测试

**测试场景**:
- 注释生成性能（1000 个图表）
- 配置文件解析性能（大型配置）
- 迁移工具性能（1000 个配置）

**基准测试**:
```typescript
import { Benchmark } from 'benchmark';

const suite = new Benchmark.Suite();

suite
  .add('CommentGenerator#generateHeader', () => {
    const generator = new CommentGenerator();
    const config = createTestConfig();
    return () => generator.generateHeader(config);
  })
  .on('cycle', (event: any) => console.log(String(event.target)))
  .run();
```

---

## 5. RLM INTEGRATION - 集成阶段

### 5.1 集成策略

#### 版本规划

```
v2.1.0-alpha.1 (Week 1): 内部测试
  - 核心功能实现
  - 基础测试完成

v2.1.0-beta.1 (Week 2): 公开测试
  - 迁移工具可用
  - 文档完整
  - 收集用户反馈

v2.1.0-rc.1 (Week 3): Bug 修复
  - Bug 修复
  - 性能优化

v2.1.0 (Week 4): 正式发布
  - 稳定版本
  - 完整迁移指南
```

#### Breaking Change 发布流程

**1. 提前沟通（发布前 2 周）**:
- GitHub Issues 公告
- 文档标记废弃
- 提供迁移预览

**2. Beta 测试（Week 3）**:
- 内部项目测试
- 收集反馈和问题
- 修复关键 bug

**3. 正式发布（Week 4）**:
- CHANGELOG.md 更新
- Release Notes 发布
- 迁移指南发布

---

### 5.2 回滚计划

**触发条件**:
- 迁移成功率 < 80%
- 重大 bug 发现
- 用户反馈严重负面

**回滚步骤**:
1. 立即停止 v2.1 发布
2. 恢复 v2.0.0 稳定版本
3. 分析问题并修复
4. 重新发布 beta 版本

---

### 5.3 文档更新

#### 需要更新的文档

1. **CLAUDE.md**
   - 添加配置字段说明
   - 添加元数据示例
   - 添加迁移指南链接

2. **README.md**
   - 更新特性说明
   - 添加元数据增强示例
   - 更新 Breaking Change 说明

3. **docs/MIGRATION-v2.1.md**
   - 详细迁移步骤
   - 常见问题
   - 故障排除

4. **CHANGELOG.md**
   - v2.1.0 变更说明
   - Breaking Change 详情

---

## 6. RLM MONITORING - 监控阶段

### 6.1 监控指标

#### 功能采用率

- `metadata_usage` - 使用 `metadata` 字段的配置比例
- `design_usage` - 使用 `design.patterns` 的配置比例
- `process_usage` - 使用 `process` 的配置比例
- `comments_enabled` - 启用注释生成的比例

#### 质量指标

- `comment_generation_success_rate` - 注释生成成功率
- `mermaid_validation_rate` - Mermaid 验证通过率
- `migration_success_rate` - 迁移工具成功率
- `user_satisfaction` - 用户满意度（反馈）

#### 性能指标

- `comment_generation_time` - 注释生成耗时（毫秒）
- `config_parsing_time` - 配置解析耗时（毫秒）
- `migration_time` - 迁移工具耗时（秒）

---

### 6.2 用户反馈

#### 收集渠道

1. **GitHub Issues**（标签：`metadata-enhancement`）
2. **用户调研**（Beta 阶段）
3. **配置示例反馈**
4. **Claude Code 使用体验调研**

#### 关键问题

- 配置生成 Prompt 是否有效？
- 生成的注释是否有用？
- 迁移工具是否易用？
- 是否需要更多字段？
- 注释格式是否合适？

---

### 6.3 持续改进

#### 短期（1-3 个月）

- [ ] 收集用户反馈
- [ ] 优化配置生成 Prompt
- [ ] 添加更多设计模式识别规则
- [ ] 改进注释格式

#### 中期（3-6 个月）

- [ ] LLM 辅助元数据生成（可选）
- [ ] 自动识别设计模式
- [ ] 配置验证工具
- [ ] 交互式配置生成器

#### 长期（6-12 个月）

- [ ] Web UI 配置编辑器
- [ ] 架构决策记录（ADR）集成
- [ ] 自动化架构评审
- [ ] 架构演化追踪

---

## 7. 核心组件清单

### 7.1 新增组件

| 组件 | 文件路径 | 职责 |
|------|----------|------|
| **CommentGenerator** | `src/mermaid/comment-generator.ts` | 生成 Mermaid 注释 |
| **ConfigMigrator** | `src/cli/config-migrator.ts` | 配置迁移工具 |
| **配置生成 Prompt** | `docs/prompts/config-generation-prompt.md` | Claude Code 指导文档 |

### 7.2 修改组件

| 组件 | 文件路径 | 修改内容 |
|------|----------|----------|
| **类型定义** | `src/types/config.ts` | 扩展 metadata, design, process, annotations |
| **Mermaid 生成器** | `src/mermaid/generator.ts` | 集成 CommentGenerator |
| **配置加载器** | `src/cli/config-loader.ts` | 支持新字段验证 |

### 7.3 测试文件

| 测试文件 | 覆盖范围 |
|----------|----------|
| `tests/unit/mermaid/comment-generator.test.ts` | CommentGenerator 单元测试 |
| `tests/unit/types/config.test.ts` | 类型定义测试 |
| `tests/integration/migration.test.ts` | 迁移工具集成测试 |
| `tests/e2e/metadata-enhancement.test.ts` | 端到端测试 |

---

## 8. 成功指标

### 8.1 功能指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 元数据字段采用率 | > 60%（6个月内） | 配置分析 |
| 注释生成成功率 | > 95% | 单元测试 |
| Mermaid 验证通过率 | 100% | 自动验证 |
| 设计模式标注准确率 | > 90% | 人工验证 |
| 迁移工具成功率 | > 90% | 迁移测试 |

### 8.2 质量指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 测试覆盖率 | ≥ 85% | Codecov |
| 代码复杂度 | 无明显增加 | SonarQube |
| ESLint 错误 | 0 | CI 检查 |
| TypeScript 错误 | 0 | 类型检查 |

### 8.3 性能指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 注释生成时间 | < 50ms (1000 字符) | 性能测试 |
| 配置解析时间 | < 10ms (标准配置) | 性能测试 |
| 迁移工具时间 | < 1s (100 配置) | 性能测试 |

### 8.4 用户体验指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 新成员理解时间减少 | > 50% | 用户调研 |
| 文档维护成本降低 | > 80% | 时间追踪 |
| 架构图可读性提升 | +500% | 主观评估 |
| 配置质量提升 | +300% | 人工评估 |

---

## 9. 风险与缓解

### 9.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 配置生成 Prompt 效果不佳 | 中 | 中 | 多轮迭代，丰富示例 |
| 注释过于冗长 | 低 | 中 | 可配置注释级别 |
| 性能回归 | 低 | 中 | 性能测试，优化 |
| 迁移工具失败 | 中 | 高 | 完整测试，回滚机制 |

### 9.2 项目风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 破坏性变更导致用户流失 | 高 | 高 | 提供自动迁移 + 详细文档 |
| 开发时间超期 | 中 | 中 | 预留缓冲时间 |
| 资源分配不足 | 低 | 中 | 优先级调整 |

---

## 10. 发布计划

### 10.1 时间表

```
Week 1 (Jan 29 - Feb 2): Phase 13.1 - 基础设施
Week 2 (Feb 3-7): Phase 13.2 - 13.3 + 测试
Week 3 (Feb 10-14): Phase 13.5 - 文档 + Beta
Week 4 (Feb 17-21): 正式发布 + 监控
```

### 10.2 里程碑

| 里程碑 | 日期 | 交付物 |
|--------|------|--------|
| Alpha 版本 | Feb 2 | 核心功能完成，内部测试 |
| Beta 版本 | Feb 14 | 功能完整，公开测试 |
| RC 版本 | Feb 19 | Bug 修复，性能优化 |
| 正式发布 | Feb 21 | 稳定版本，完整文档 |

---

## 11. 附录

### 11.1 相关文档

**提案文档**:
- [13-diagram-metadata-enhancement.md](../proposals/13-diagram-metadata-enhancement.md) - 完整的 RLM 分析

**关联计划**:
- [09-multi-level-architecture-diagrams-plan.md](./09-multi-level-architecture-diagrams-plan.md) - Phase 9
- [10-mermaid-diagram-migration-plan.md](./10-mermaid-diagram-migration-plan.md) - Phase 10

**项目文档**:
- [CLAUDE.md](../../CLAUDE.md) - 项目使用指南
- [README.md](../../README.md) - 项目说明

### 11.2 配置示例仓库

**位置**: `examples/config/`

- `minimal-metadata-config.json` - 最小化元数据配置
- `full-metadata-config.json` - 完整元数据配置
- `design-patterns-config.json` - 设计模式示例
- `old-format-config.json` - v2.0 旧格式配置（迁移测试）

---

**文档版本**: 1.0
**最后更新**: 2026-01-28
**文档状态**: ✅ 计划完成（Phase 13）
**下一步**: 开始 Phase 13.1 - 基础设施开发
**预计开始**: 待定
**负责人**: 待分配
**关联 Issue**: #XXX
