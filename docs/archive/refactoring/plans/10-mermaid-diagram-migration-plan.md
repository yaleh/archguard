# ArchGuard Mermaid 图表迁移 - 实施计划 (RLM PLANNING)

**文档版本**: 1.0
**创建日期**: 2026-01-26
**RLM 阶段**: PLANNING
**关联 Proposals**:
- [10-mermaid-diagram-migration.md](../proposals/10-mermaid-diagram-migration.md) (RLM 分析)
- [10-mermaid-technical-analysis.md](../proposals/10-mermaid-technical-analysis.md) (技术调研)
- [10-mermaid-validation-strategy.md](../proposals/10-mermaid-validation-strategy.md) (验证策略)

**项目代号**: MERMAID-MIGRATION-v2.0
**目标版本**: ArchGuard v2.0.0 (Breaking Change)
**预估工期**: 3 周开发 + 4 周测试/发布 = 7 周总计

---

## 执行摘要

本文档是 RLM PLANNING 阶段的详细实施计划，将 Mermaid 迁移方案转化为可执行的开发任务。这是一个**Breaking Change**，将完全替换 PlantUML 为 Mermaid，并引入混合智能架构。

### 核心目标

1. **完全迁移到 Mermaid** - 移除 PlantUML 支持，使用 Mermaid 作为唯一格式
2. **混合智能架构** - LLM 决策层 + JS 确定性生成
3. **五层验证策略** - 保障生成代码语法正确且可渲染
4. **本地渲染** - 使用 isomorphic-mermaid 实现快速渲染

### 核心改进

- **错误率**: 40-60% → <1% (**-98%**)
- **首次通过率**: ~5% → >95% (**+90%**)
- **生成速度**: 30-60s → 5-10s (**5x**)
- **LLM 成本**: -70% Token 消耗
- **维护成本**: -80% (JS 完全可控)

### 关键决策

- ⚠️ **Breaking Change**: 完全移除 PlantUML 支持（不保留向后兼容）
- ✅ **主渲染方案**: isomorphic-mermaid（轻量级，无浏览器依赖）
- ✅ **备用渲染**: mermaid-cli (mmdc)（仅用于 PNG 渲染）
- ✅ **默认启用 LLM 分组**，提供 `--no-llm-grouping` 选项
- ✅ **五层验证**: 生成、解析、结构、渲染、质量

---

## 1. 技术架构设计

### 1.1 系统架构对比

#### 当前架构（v1.x - PlantUML）

```
ArchJSON → LLM 生成完整 PlantUML → 验证 → 重试 2-3 次 → 渲染 PNG
         ↑ 完全由 LLM 生成，不确定性高    ↑ 外部渲染器慢
         成本：10,000-17,000 tokens
```

**问题**:
- ❌ 渲染错误率高（40-60%）
- ❌ 反馈慢（需重试）
- ❌ 成本高（完整 LLM 调用）
- ❌ 调试困难（错误信息模糊）

---

#### 新架构（v2.0 - Mermaid 混合智能）

```
ArchJSON → LLM 决策层 → 决策 JSON → JS 生成器 → 五层验证 → 本地渲染
         ↑ 轻量调用           ↑ 确定性    ↑ 快速验证  ↑ isomorphic
         2,000 tokens                      mermaid
```

**关键改进**:
- ✅ **确定性生成**: JS 逻辑保证语法正确性
- ✅ **快速验证**: 本地验证，无需外部工具
- ✅ **低成本**: LLM 只做分组决策（-70% token）
- ✅ **可维护**: JS 代码完全可控和测试

### 1.2 核心组件设计

```typescript
// ========== 1. LLM 决策层（可选）==========

interface GroupingDecision {
  packages: Array<{
    name: string;           // "AI Layer", "Parser Layer"
    entities: string[];     // 实体 ID 列表
    description?: string;   // 包描述
  }>;
  layout: {
    direction: 'TB' | 'LR';  // Top-Bottom 或 Left-Right
    reasoning: string;        // 为什么选择这个方向
  };
}

// ========== 2. 启发式分组器（备用）==========

class HeuristicGrouper {
  group(archJson: ArchJSON): GroupingDecision {
    // 基于文件路径自动分组
    // src/parser → "Parser Layer"
    // src/ai → "AI Layer"
  }
}

// ========== 3. Mermaid 生成器（确定性）==========

class MermaidGenerator {
  generate(archJson: ArchJSON, options: {
    level: 'package' | 'class' | 'method';
    grouping: GroupingDecision;
  }): string {
    // 确定性生成 Mermaid classDiagram 代码
  }
}

// ========== 4. 验证管道（五层验证）==========

class MermaidValidationPipeline {
  async validateFull(mermaidCode, archJson): Promise<ValidationReport> {
    // Layer 1: 生成阶段验证（ValidatedMermaidGenerator）
    // Layer 2: 语法验证（MermaidParseValidator）
    // Layer 3: 结构验证（StructuralValidator）
    // Layer 4: 渲染验证（RenderValidator）
    // Layer 5: 质量分析（QualityValidator）
  }
}

// ========== 5. 本地渲染器 ==========

class IsomorphicMermaidRenderer {
  async renderSVG(mermaidCode): Promise<string> {
    // 使用 isomorphic-mermaid 渲染 SVG
  }

  async renderPNG(mermaidCode, outputPath): Promise<void> {
    // 使用 sharp 转换 SVG → PNG
  }
}
```

### 1.3 配置设计

```typescript
// src/types/config.ts

export interface MermaidConfig {
  /** 是否启用 LLM 分组（默认: true） */
  enableLLMGrouping: boolean;

  /** 渲染器类型（默认: "isomorphic"） */
  renderer: 'isomorphic' | 'cli';

  /** 主题（默认: "default"） */
  theme: 'default' | 'forest' | 'dark' | 'neutral';

  /** 背景透明（默认: true） */
  transparentBackground: boolean;
}

export interface ArchGuardConfig {
  outputDir: string;
  format: 'mermaid';  // ✨ 新格式

  mermaid: MermaidConfig;

  diagrams: DiagramConfig[];
}
```

### 1.4 CLI 接口变更

#### 移除的格式

```bash
# ❌ 移除（不再支持）
-f plantuml
-f svg
```

#### 新增的格式

```bash
# ✅ 新增
-f mermaid
--no-llm-grouping  # 禁用 LLM 分组
--mermaid-theme <theme>  # 主题选择
```

#### 保留的参数

```bash
# ✅ 保留（兼容 Mermaid）
-s, --sources <paths...>
-n, --name <name>
-l, --level <level>
--output-dir <dir>
-e, --exclude <patterns...>
--no-cache
-c, --concurrency <num>
-v, --verbose
```

---

## 2. 实施阶段划分

### Phase 0: POC 验证（Day 1-2）

**目标**: 验证 isomorphic-mermaid 可行性，建立信心

#### 任务 0.1: 创建 POC 项目（2小时）

**目录**: `tests/poc/mermaid-poc/`

**任务清单**:
- [ ] 创建测试项目结构
- [ ] 安装依赖：`isomorphic-mermaid`, `sharp`
- [ ] 准备测试用 Mermaid 代码

**实施代码**:
```bash
cd tests/poc/mermaid-poc
npm init -y
npm install isomorphic-mermaid sharp
```

---

#### 任务 0.2: 基础渲染测试（3小时）

**文件**: `tests/poc/mermaid-poc/test-basic-rendering.ts`

**任务清单**:
- [ ] 测试 classDiagram 渲染
- [ ] 测试 namespace 语法
- [ ] 测试关系定义
- [ ] 测试泛型语法
- [ ] 验证 SVG 输出
- [ ] 验证 PNG 转换

**实施代码**:
```typescript
import mermaid from 'isomorphic-mermaid';
import sharp from 'sharp';

async function testBasicRendering() {
  const diagram = `
classDiagram
  direction TB

  namespace ParserLayer {
    class TypeScriptParser {
      +parseFiles() ArchJSON
      +parseFile() Entity[]
    }

    class ClassExtractor {
      +extract() Entity
    }
  }

  namespace AILayer {
    class ClaudeCodeWrapper {
      +generateDiagram() string
    }
  }

  ClaudeCodeWrapper --> TypeScriptParser : uses
  TypeScriptParser --> ClassExtractor : uses
`;

  // 渲染 SVG
  const { svg } = await mermaid.render('test', diagram);
  console.log('✅ SVG rendering successful!');
  console.log(`   SVG length: ${svg.length} chars`);

  // 渲染 PNG
  const buffer = Buffer.from(svg);
  await sharp(buffer).toFile('output.png');
  console.log('✅ PNG rendering successful!');

  return { svg, png: 'output.png' }
}

testBasicRendering();
```

**验收标准**:
- ✅ 成功渲染 classDiagram
- ✅ SVG 格式正确
- ✅ PNG 转换成功
- ✅ 包大小 < 50MB

---

#### 任务 0.3: 错误模式测试（3小时）

**文件**: `tests/poc/mermaid-poc/test-error-patterns.ts`

**任务清单**:
- [ ] 测试嵌套 namespace（应该失败）
- [ ] 测试 namespace 内关系（应该失败）
- [ ] 测试逗号泛型（应该失败）
- [ ] 测试自动修复逻辑

**实施代码**:
```typescript
async function testErrorPatterns() {
  const errorCases = [
    {
      name: 'Nested namespace',
      code: `
classDiagram
  namespace Outer {
    namespace Inner {
      class A { }
    }
  }
`,
      shouldFail: true,
    },
    {
      name: 'Relationship in namespace',
      code: `
classDiagram
  namespace A {
    class X
    class Y
    X --> Y
  }
`,
      shouldFail: true,
    },
    {
      name: 'Comma generic',
      code: `
classDiagram
  class Map~K, V~
`,
      shouldFail: true,
    },
  ];

  for (const testCase of errorCases) {
    console.log(`\n🧪 Testing: ${testCase.name}`);
    try {
      const { svg } = await mermaid.render('test', testCase.code);
      if (testCase.shouldFail) {
        console.log(`❌ Should have failed but passed!`);
      } else {
        console.log(`✅ Passed as expected`);
      }
    } catch (error) {
      if (testCase.shouldFail) {
        console.log(`✅ Failed as expected: ${error.message}`);
      } else {
        console.log(`❌ Unexpected failure: ${error.message}`);
      }
    }
  }
}

testErrorPatterns();
```

**验收标准**:
- ✅ 预期的错误模式被正确检测
- ✅ 错误信息清晰可读
- ✅ 自动修复逻辑工作正常

---

### Phase 1: 核心组件开发（Week 1）

**目标**: 实现基础 Mermaid 生成和验证组件

#### 任务 1.1: 创建模块结构（1小时）

**任务清单**:
- [ ] 创建 `src/mermaid/` 目录
- [ ] 创建子模块文件
- [ ] 设置 package.json type: "module"

**实施代码**:
```bash
mkdir -p src/mermaid
touch src/mermaid/{generator.ts,validator.ts,renderer.ts,grouper.ts,types.ts,index.ts}
```

**文件结构**:
```
src/mermaid/
├── generator.ts           # MermaidGenerator
├── grouper.ts             # HeuristicGrouper, LLMGrouper
├── validator.ts            # MermaidValidationPipeline
├── renderer.ts            # IsomorphicMermaidRenderer
├── types.ts               # 类型定义
└── index.ts               # 导出
```

---

#### 任务 1.2: 实现 MermaidGenerator（6小时）

**文件**: `src/mermaid/generator.ts`

**任务清单**:
- [ ] 实现 `ValidatedMermaidGenerator` 类
- [ ] 实现 `generatePackageLevel()` 方法
- [ ] 实现 `generateClassLevel()` 方法
- [ ] 实现 `generateMethodLevel()` 方法
- [ ] 实现 `generateRelations()` 方法
- [ ] 实现辅助方法（escapeId, sanitizeType, etc.）
- [ ] 添加生成前验证（validateBeforeGenerate）
- [ ] 添加生成后处理（postProcess）
- [ ] 编写单元测试

**实施代码**:
参考 `10-mermaid-validation-strategy.md` 中的完整实现代码。

**验收标准**:
- ✅ 所有三个 level 都能生成有效 Mermaid 代码
- ✅ 单元测试覆盖率 > 85%
- ✅ 生成代码通过 mermaid.parse() 验证

---

#### 任务 1.3: 实现 HeuristicGrouper（4小时）

**文件**: `src/mermaid/grouper.ts`

**任务清单**:
- [ ] 实现 `HeuristicGrouper` 类
- [ ] 实现 `group()` 方法
- [ ] 实现 `extractPackageName()` 方法
- [ ] 实现 `formatPackageName()` 方法
- [ ] 添加单元测试

**实施代码**:
```typescript
export class HeuristicGrouper {
  /**
   * 基于文件路径自动分组
   */
  group(archJson: ArchJSON): GroupingDecision {
    const packages = new Map<string, string[]>();

    for (const entity of archJson.entities) {
      const packageName = this.extractPackageName(entity.sourceLocation.file);
      if (!packages.has(packageName)) {
        packages.set(packageName, []);
      }
      packages.get(packageName)!.push(entity.id);
    }

    return {
      packages: Array.from(packages.entries()).map(([name, entities]) => ({
        name: this.formatPackageName(name),
        entities,
      })),
      layout: {
        direction: 'TB',
        reasoning: 'Default top-to-bottom layout based on file structure',
      },
    };
  }

  private extractPackageName(filePath: string): string {
    const parts = filePath.split('/');
    const srcIndex = parts.findIndex(p => ['src', 'lib', 'packages'].includes(p));
    if (srcIndex >= 0 && srcIndex + 1 < parts.length) {
      return parts[srcIndex + 1];
    }
    return 'core';
  }

  private formatPackageName(dir: string): string {
    return `${dir.charAt(0).toUpperCase() + dir.slice(1)} Layer`;
  }
}
```

**验收标准**:
- ✅ 能够基于文件路径正确分组
- ✅ 覆盖常见项目结构（src/, lib/, packages/）
- ✅ 单元测试覆盖率 > 80%

---

#### 任务 1.4: 实现 MermaidParseValidator（4小时）

**文件**: `src/mermaid/validator-parse.ts`

**任务清单**:
- [ ] 实现 `MermaidParseValidator` 类
- [ ] 实现 `validate()` 方法（使用 mermaid.parse）
- [ ] 实现 `parseError()` 错误解析
- [ ] 实现常见错误模式识别
- [ ] 添加单元测试

**实施代码**:
参考 `10-mermaid-validation-strategy.md` 中的完整实现代码。

**验收标准**:
- ✅ 能够检测所有常见语法错误
- ✅ 错误信息清晰可读
- ✅ 单元测试覆盖率 > 80%

---

#### 任务 1.5: 实现 IsomorphicMermaidRenderer（6小时）

**文件**: `src/mermaid/renderer.ts`

**任务清单**:
- [ ] 实现 `IsomorphicMermaidRenderer` 类
- [ ] 实现 `renderSVG()` 方法
- [ ] 实现 `renderPNG()` 方法（使用 sharp）
- [ ] 实现 `renderAndSave()` 方法
- [ ] 添加错误处理
- [ ] 添加单元测试

**实施代码**:
参考 `10-mermaid-technical-analysis.md` 中的完整实现代码。

**验收标准**:
- ✅ 能够渲染 SVG 和 PNG
- ✅ 支持主题和背景配置
- ✅ 正确清理临时文件
- ✅ 单元测试覆盖率 > 75%

---

### Phase 2: LLM 集成和配置（Week 2）

**目标**: 实现 LLM 分组决策和配置系统

#### 任务 2.1: 创建 LLM 分组 Prompt 模板（2小时）

**文件**: `prompts/mermaid-grouping.txt`

**任务清单**:
- [ ] 创建轻量化分组 prompt
- [ ] 定义输入摘要格式
- [ ] 定义 JSON 输出格式
- [ ] 添加分组规则说明
- [ ] 添加示例

**实施代码**:
参考 `10-mermaid-diagram-migration.md` 中的完整 prompt 模板。

**验收标准**:
- ✅ Prompt 简洁明了
- ✅ Token 消耗 < 3,000
- ✅ 输出格式可解析

---

#### 任务 2.2: 实现 LLMGrouper（4小时）

**文件**: `src/mermaid/grouper.ts`

**任务清单**:
- [ ] 实现 `LLMGrouper` 类
- [ ] 实现 `getLLMGrouping()` 方法
- [ ] 实现 JSON 解析和验证
- [ ] 实现 fallback 到启发式分组
- [ ] 添加 Token 消耗监控
- [ ] 添加单元测试

**实施代码**:
```typescript
export class LLMGrouper {
  constructor(private config: Config) {}

  async getLLMGrouping(
    archJson: ArchJSON,
    level: DetailLevel
  ): Promise<GroupingDecision> {
    const templateManager = new PromptTemplateManager();

    // 构建摘要
    const summary = {
      entityCount: archJson.entities.length,
      relationCount: archJson.relations.length,
      entities: archJson.entities.map(e => ({
        id: e.id,
        name: e.name,
        type: e.type,
        file: e.sourceLocation.file,
      })),
    };

    // 渲染 prompt
    const prompt = await templateManager.render('mermaid-grouping', {
      ENTITY_COUNT: summary.entityCount,
      RELATION_COUNT: summary.relationCount,
      ENTITIES: summary.entities,
      DETAIL_LEVEL: level,
    });

    // 调用 LLM
    const wrapper = new ClaudeCodeWrapper(this.config);
    const response = await wrapper.callCLI(prompt);

    // 解析 JSON
    const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      throw new Error('Failed to extract JSON from LLM response');
    }

    return JSON.parse(jsonMatch[1]);
  }

  /**
   * 带 fallback 的分组
   */
  async groupWithFallback(archJson: ArchJSON): Promise<GroupingDecision> {
    try {
      // 尝试 LLM 分组
      return await this.getLLMGrouping(archJson, 'class');
    } catch (error) {
      console.warn('⚠️  LLM grouping failed, falling back to heuristic:', error.message);
      // Fallback 到启发式分组
      const heuristicGrouper = new HeuristicGrouper();
      return heuristicGrouper.group(archJson);
    }
  }
}
```

**验收标准**:
- ✅ LLM 调用成功
- ✅ JSON 解析正确
- ✅ Fallback 机制工作
- ✅ Token 消耗 < 3,000

---

#### 任务 2.3: 扩展配置系统（3小时）

**文件**: `src/types/config.ts`, `src/cli/config-loader.ts`

**任务清单**:
- [ ] 添加 `MermaidConfig` 接口
- [ ] 扩展 `GlobalConfig` 添加 `mermaid` 字段
- [ ] 更新 Zod schema
- [ ] 更新默认配置
- [ ] 添加配置验证

**实施代码**:
```typescript
// src/types/config.ts

export interface MermaidConfig {
  /** 是否启用 LLM 分组（默认: true） */
  enableLLMGrouping: boolean;

  /** 渲染器类型 */
  renderer: 'isomorphic' | 'cli';

  /** 主题 */
  theme: 'default' | 'forest' | 'dark' | 'neutral';

  /** 背景透明 */
  transparentBackground: boolean;
}

export interface ArchGuardConfig extends GlobalConfig {
  /** 输出格式 */
  format: 'mermaid';

  /** Mermaid 配置 */
  mermaid?: MermaidConfig;
}
```

**验收标准**:
- ✅ 配置验证通过
- ✅ 默认值正确
- ✅ 向后兼容性检查（PlantUML 报错）

---

#### 任务 2.4: 更新 CLI 参数（3小时）

**文件**: `src/cli/commands/analyze.ts`

**任务清单**:
- [ ] 移除 `-f plantuml`, `-f svg` 选项
- [ ] 添加 `-f mermaid` 选项
- [ ] 添加 `--no-llm-grouping` 参数
- [ ] 添加 `--mermaid-theme` 参数
- [ ] 更新帮助文档

**实施代码**:
```typescript
export function createAnalyzeCommand(): Command {
  return new Command('analyze')
    .description('Analyze TypeScript project and generate architecture diagrams')

    // Format
    .option('-f, --format <type>', 'Output format: mermaid|json')

    // Mermaid 特定
    .option('--no-llm-grouping', 'Disable LLM grouping (use heuristic)')
    .option('--mermaid-theme <theme>', 'Mermaid theme: default|forest|dark|neutral')

    // ... 其他参数
    .action(analyzeCommandHandler);
}
```

**验收标准**:
- ✅ 参数解析正确
- ✅ 帮助文档更新
- ✅ 旧格式报错并提供迁移建议

---

### Phase 3: 验证管道实现（Week 2-3）

**目标**: 实现五层验证策略

#### 任务 3.1: 实现结构验证器（6小时）

**文件**: `src/mermaid/validator-structural.ts`

**任务清单**:
- [ ] 实现 `StructuralValidator` 类
- [ ] 实现 `validate()` 方法
- [ ] 实现 `checkEntityReferences()` 方法
- [ ] 实现 `checkRelationshipSymmetry()` 方法
- [ ] 实现 `checkNamespaceUsage()` 方法
- [ ] 实现 `checkCircularDependencies()` 方法
- [ ] 实现 `checkOrphanedEntities()` 方法
- [ ] 添加单元测试

**实施代码**:
参考 `10-mermaid-validation-strategy.md` 中的完整实现代码。

**验收标准**:
- ✅ 能够检测所有结构问题
- ✅ 错误信息精确
- ✅ 单元测试覆盖率 > 80%

---

#### 任务 3.2: 实现渲染验证器（4小时）

**文件**: `src/mermaid/validator-render.ts`

**任务清单**:
- [ ] 实现 `RenderValidator` 类
- [ ] 实现 `validateRender()` 方法
- [ ] 实现 SVG 格式验证
- [ ] 实现 SVG 大小检查
- [ ] 添加错误建议
- [ ] 添加单元测试

**实施代码**:
参考 `10-mermaid-validation-strategy.md` 中的完整实现代码。

**验收标准**:
- ✅ 能够检测渲染错误
- ✅ 提供修复建议
- ✅ 单元测试覆盖率 > 75%

---

#### 任务 3.3: 实现质量验证器（6小时）

**文件**: `src/mermaid/validator-quality.ts`

**任务清单**:
- [ ] 实现 `QualityValidator` 类
- [ ] 实现 `analyzeReadability()` 方法
- [ ] 实现 `analyzeComplexity()` 方法
- [ ] 实现 `checkBestPractices()` 方法
- [ ] 实现 `calculateMaxDepth()` 方法
- [ ] 添加评分逻辑
- [ ] 添加单元测试

**实施代码**:
参考 `10-mermaid-validation-strategy.md` 中的完整实现代码。

**验收标准**:
- ✅ 可读性评分准确
- ✅ 复杂度评分合理
- ✅ 单元测试覆盖率 > 75%

---

#### 任务 3.4: 实现验证管道（4小时）

**文件**: `src/mermaid/validation-pipeline.ts`

**任务清单**:
- [ ] 实现 `MermaidValidationPipeline` 类
- [ ] 实现 `validateFull()` 方法
- [ ] 实现 `validateQuick()` 方法
- [ ] 实现 `generateReport()` 方法
- [ ] 集成五个验证器
- [ ] 添加单元测试

**实施代码**:
参考 `10-mermaid-validation-strategy.md` 中的完整实现代码。

**验收标准**:
- ✅ 五层验证全部执行
- ✅ 验证报告完整
- ✅ 单元测试覆盖率 > 80%

---

#### 任务 3.5: 实现自动修复（4小时）

**文件**: `src/mermaid/auto-repair.ts`

**任务清单**:
- [ ] 实现 `MermaidAutoRepair` 类
- [ ] 实现 `repair()` 方法
- [ ] 实现常见错误修复逻辑
- [ ] 添加修复验证
- [ ] 添加单元测试

**实施代码**:
```typescript
export class MermaidAutoRepair {
  async repair(
    mermaidCode: string,
    errors: ValidationError[]
  ): Promise<string> {
    let repaired = mermaidCode;

    // 修复 1: 添加 classDiagram 声明
    if (!repaired.includes('classDiagram')) {
      repaired = 'classDiagram\n' + repaired;
    }

    // 修复 2: 移除逗号泛型
    repaired = repaired.replace(/<([^>]+),\s*([^>]*)>/g, '~$1$2~');

    // 修复 3: 转义特殊字符
    repaired = repaired.replace(/[<>]/g, '_');

    // 验证修复结果
    const validator = new MermaidParseValidator();
    const result = await validator.validate(repaired);

    if (result.valid) {
      return repaired;
    }

    // 如果仍失败，抛出错误
    throw new Error(`Cannot repair Mermaid code: ${result.errors.map(e => e.message).join(', ')}`);
  }
}
```

**验收标准**:
- ✅ 常见错误自动修复
- ✅ 修复后验证
- ✅ 单元测试覆盖率 > 70%

---

### Phase 4: 集成和测试（Week 3）

**目标**: 集成所有组件，全面测试

#### 任务 4.1: 实现 MermaidDiagramGenerator（6小时）

**文件**: `src/mermaid/diagram-generator.ts`

**任务清单**:
- [ ] 实现 `MermaidDiagramGenerator` 类
- [ ] 实现 `generateAndRender()` 主方法
- [ ] 集成 LLMGrouper 或 HeuristicGrouper
- [ ] 集成 MermaidGenerator
- [ ] 集成 MermaidValidationPipeline
- [ ] 集成 IsomorphicMermaidRenderer
- [ ] 实现自动修复逻辑
- [ ] 添加进度报告

**实施代码**:
```typescript
export class MermaidDiagramGenerator {
  async generateAndRender(
    archJson: ArchJSON,
    outputOptions: { outputDir: string; baseName: string; paths: any },
    level: DetailLevel
  ): Promise<void> {
    // 1. 决策层
    let grouping: GroupingDecision;

    if (this.config.mermaid?.enableLLMGrouping !== false) {
      grouping = await this.getLLMGrouping(archJson, level);
    } else {
      grouping = new HeuristicGrouper().group(archJson);
    }

    // 2. 确定性生成
    const generator = new ValidatedMermaidGenerator(archJson, {
      level,
      grouping,
    });

    const mermaidCode = generator.generate();

    // 3. 五层验证
    const pipeline = new MermaidValidationPipeline(this.config);
    const report = await pipeline.validateFull(mermaidCode, archJson);

    if (!report.overallValid) {
      console.error('❌ Validation failed');
      console.error(pipeline.generateReport(report));

      // 尝试自动修复
      const repaired = await this.attemptRepair(mermaidCode, report);
      if (repaired) {
        console.log('✅ Repaired successfully');
        mermaidCode = repaired;
      } else {
        throw new Error('Validation failed and cannot be repaired');
      }
    }

    // 4. 渲染
    const renderer = new IsomorphicMermaidRenderer();
    await renderer.renderAndSave(mermaidCode, {
      mmd: path.join(outputOptions.outputDir, `${outputOptions.baseName}.mmd`),
      svg: path.join(outputOptions.outputDir, `${outputOptions.baseName}.svg`),
      png: path.join(outputOptions.outputDir, `${outputOptions.baseName}.png`),
    });

    // 5. 输出质量报告
    console.log('📊 Quality Report:');
    const qualityStage = report.stages.find(s => s.name === 'quality');
    if (qualityStage) {
      const metrics = qualityStage.result as QualityMetrics;
      console.log(`  Readability: ${metrics.readability.score}/100`);
      console.log(`  Complexity: ${metrics.complexityScore.score}/100`);
    }
  }
}
```

**验收标准**:
- ✅ 完整流程工作正常
- ✅ LLM 分组和启发式分组都可用
- ✅ 验证管道执行正确
- ✅ 自动修复生效

---

#### 任务 4.2: 集成到 DiagramProcessor（4小时）

**文件**: `src/cli/processors/diagram-processor.ts`

**任务清单**:
- [ ] 更新 `processDiagram()` 方法
- [ ] 添加 `format: 'mermaid'` 支持
- [ ] 移除 PlantUML 生成逻辑
- [ ] 集成 MermaidDiagramGenerator
- [ ] 更新错误处理

**实施代码**:
```typescript
private async generateOutput(
  archJSON: ArchJSON,
  paths: { paths: any },
  format: OutputFormat,
  level: DetailLevel
): Promise<void> {
  switch (format) {
    case 'json':
      await fs.writeJson(paths.paths.json, archJSON, { spaces: 2 });
      break;

    case 'mermaid':
      const mermaidGenerator = new MermaidDiagramGenerator(this.globalConfig);
      await mermaidGenerator.generateAndRender(archJSON, {
        outputDir: path.dirname(paths.paths.mmd),
        baseName: path.basename(paths.paths.mmd, '.mmd'),
        paths: paths.paths,
      }, level);
      break;

    case 'plantuml':
    case 'svg':
      throw new Error(
        `Format ${format} is no longer supported. Please use "mermaid" instead. ` +
        'See migration guide: docs/MIGRATION.md'
      );

    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}
```

**验收标准**:
- ✅ Mermaid 格式工作正常
- ✅ PlantUML 格式报错并提供迁移建议
- ✅ 集成测试通过

---

#### 任务 4.3: 单元测试（6小时）

**测试文件**:
- `tests/unit/mermaid/generator.test.ts`
- `tests/unit/mermaid/grouper.test.ts`
- `tests/unit/mermaid/validator-parse.test.ts`
- `tests/unit/mermaid/validator-structural.test.ts`
- `tests/unit/mermaid/validator-render.test.ts`
- `tests/unit/mermaid/validator-quality.test.ts`
- `tests/unit/mermaid/renderer.test.ts`
- `tests/unit/mermaid/validation-pipeline.test.ts`
- `tests/unit/mermaid/auto-repair.test.ts`

**测试覆盖**:
- [ ] MermaidGenerator 生成逻辑（所有三个 level）
- [ ] HeuristicGrouper 分组逻辑
- [ ] MermaidParseValidator 语法验证
- [ ] StructuralValidator 结构检查
- [ ] RenderValidator 渲染验证
- [ ] QualityValidator 质量分析
- [ ] ValidationPipeline 管道流程
- [ ] AutoRepair 自动修复

**目标**:
- ✅ 单元测试覆盖率 ≥ 85%
- ✅ 所有测试通过

---

#### 任务 4.4: 集成测试（4小时）

**测试文件**:
- `tests/integration/mermaid/generation.test.ts`
- `tests/integration/mermaid/validation.test.ts`
- `tests/integration/mermaid/e2e.test.ts`

**测试场景**:
1. 从真实 ArchGuard 代码生成 Mermaid
2. LLM 分组 vs 启发式分组对比
3. 三个 level 生成验证
4. 验证管道完整流程
5. 自动修复功能测试
6. 错误模式测试（5 个已知限制）

**目标**:
- ✅ 所有集成测试通过
- ✅ 生成的图符合预期
- ✅ 验证捕获所有已知错误模式

---

#### 任务 4.5: 性能基准测试（3小时）

**测试文件**: `tests/performance/mermaid/benchmark.test.ts`

**测试场景**:
- 生成速度对比（vs PlantUML）
- Token 消耗测试
- 内存使用测试
- 验证速度测试

**目标**:
- ✅ 生成速度 < 10s (30 类)
- ✅ Token 消耗 < 3,000 (LLM 模式)
- ✅ 内存峰值 < 200MB
- ✅ 验证速度 < 2s

---

### Phase 5: 文档和迁移（Week 4-5）

**目标**: 完善文档和迁移工具

#### 任务 5.1: 更新项目文档（4小时）

**文件**: `CLAUDE.md`, `README.md`

**更新内容**:
- [ ] 更新输出格式说明（移除 PlantUML）
- [ ] 添加 Mermaid 使用说明
- [ ] 添加 LLM 分组说明
- [ ] 添加 `--no-llm-grouping` 选项
- [ ] 更新配置文件示例
- [ ] 移除 PlantUML 相关内容

**验收标准**:
- ✅ 文档完整准确
- ✅ 代码示例可运行
- ✅ 无遗留 PlantUML 引用

---

#### 任务 5.2: 编写迁移指南（3小时）

**文件**: `docs/MIGRATION-v2.0.md`

**内容清单**:
- [ ] Breaking Changes 说明
- [ ] 格式对照表（PlantUML → Mermaid）
- [ ] 配置文件迁移示例
- [ ] 常见问题解答
- [ ] 迁移步骤
- [ ] 新功能说明

**实施代码**:
```markdown
# 迁移指南：v1.x → v2.0

## Breaking Changes

### 1. 完全移除 PlantUML 支持

**旧方式**:
\`\`bash
node dist/cli/index.js analyze -f plantuml -s ./src
\`\`

**新方式**:
\`\`bash
node dist/cli/index.js analyze -f mermaid -s ./src
\`\`

### 2. 配置文件变更

**旧配置**:
\`\`json
{
  "format": "plantuml"
}
\`\`

**新配置**:
\`\`json
{
  "format": "mermaid",
  "mermaid": {
    "enableLLMGrouping": true,
    "renderer": "isomorphic"
  }
}
\`\`

## 新功能

### LLM 智能分组

默认启用 LLM 进行模块分组，显著提升图表质量。

### 五层验证

自动验证和修复生成的代码，确保语法正确。
...
```

**验收标准**:
- ✅ 迁移步骤清晰
- ✅ 覆盖所有 Breaking Changes
- ✅ 常见问题有解答

---

#### 任务 5.3: 创建自动迁移工具（3小时）

**文件**: `scripts/migrate-to-mermaid.ts`

**功能**:
- [ ] 读取旧配置文件
- [ ] 转换格式（plantuml → mermaid）
- [ ] 保存新配置
- [ ] 显示迁移报告
- [ ] 备份旧配置

**实施代码**:
```typescript
import fs from 'fs-extra';
import path from 'path';

export function migrateConfig(configPath: string): void {
  console.log(`🔄 Migrating ${configPath}...`);

  // 读取旧配置
  const oldConfig = fs.readJsonSync(configPath);

  // 检查格式
  if (oldConfig.format === 'plantuml' || oldConfig.format === 'svg') {
    console.warn('⚠️  PlantUML format is no longer supported.');
    console.log('📝 Migrating to Mermaid...');

    // 备份
    const backupPath = configPath + '.bak';
    fs.copySync(configPath, backupPath);
    console.log(`✅ Backup saved to: ${backupPath}`);

    // 转换
    const newConfig = {
      ...oldConfig,
      format: 'mermaid',
      mermaid: {
        enableLLMGrouping: true,
        renderer: 'isomorphic',
        theme: 'default',
        transparentBackground: true,
      },
    };

    // 保存
    fs.writeJsonSync(configPath, newConfig, { spaces: 2 });
    console.log('✅ Migration complete!');
  } else if (oldConfig.format === 'mermaid') {
    console.log('✅ Already using Mermaid format.');
  } else {
    console.log('ℹ️  No migration needed.');
  }
}
```

**验收标准**:
- ✅ 迁移工具可用
- ✅ 自动备份旧配置
- ✅ 迁移报告清晰

---

### Phase 6: 发布和监控（Week 6-7）

**目标**: 发布 beta 版本，收集反馈，正式发布

#### 任务 6.1: Alpha 发布（Week 6）

**清单**:
- [ ] 所有核心功能完成
- [ ] 单元测试通过（覆盖率 ≥ 85%）
- [ ] 集成测试通过
- [ ] 性能基准测试通过
- [ ] 内部自测通过（使用 ArchGuard 自己的代码）
- [ ] 发布 alpha 版本

**验证命令**:
```bash
# 1. 构建
npm run build

# 2. 自测
node dist/cli/index.js analyze -s ./src -f mermaid -n self-test
node dist/cli/index.js analyze -f mermaid --no-llm-grouping

# 3. 验证输出
ls -la archguard/
cat archguard/self-test.mmd
```

**验收标准**:
- ✅ 自测生成成功
- ✅ 生成的 Mermaid 代码有效
- ✅ 渲染的图表正确

---

#### 任务 6.2: Beta 发布（Week 6）

**清单**:
- [ ] 文档完善
- [ ] 迁移工具可用
- [ ] 发布 npm beta 版本
- [ ] 发布 GitHub 公告
- [ ] 收集社区反馈

**发布命令**:
```bash
npm version 2.0.0-beta.1
npm publish --tag beta
```

**公告内容**:
- Breaking Change 说明
- 新功能介绍（混合智能、五层验证）
- 迁移指南链接
- 反馈渠道

**验收标准**:
- ✅ npm beta 版本发布
- ✅ 文档完整
- ✅ 公告发布

---

#### 任务 6.3: RC 发布（Week 7）

**清单**:
- [ ] 社区反馈处理
- [ ] Bug 修复完成
- [ ] 性能验证通过
- [ ] 文档最终审查
- [ ] 发布 npm RC 版本

**验收标准**:
- ✅ 所有已知 bug 修复
- ✅ 性能无回归
- ✅ 文档最终审查通过

---

#### 任务 6.4: 正式发布（Week 7）

**清单**:
- [ ] 所有测试通过（单元 + 集成 + E2E）
- [ ] CHANGELOG 更新
- [ ] 发布 npm 正式版本
- [ ] 发布 GitHub Release
- [ ] 发布迁移指南
- [ ] 更新文档网站（如果有）

**发布命令**:
```bash
npm version 2.0.0
npm publish
```

**验收标准**:
- ✅ v2.0.0 正式发布
- ✅ Release Notes 发布
- ✅ 迁移指南可用

---

## 3. 质量门控

### 3.1 测试覆盖率

| 模块 | 目标覆盖率 | 验证命令 |
|------|----------|---------|
| `mermaid/generator.ts` | ≥ 85% | 覆盖率报告 |
| `mermaid/grouper.ts` | ≥ 80% | 覆盖率报告 |
| `mermaid/validator-*.ts` | ≥ 85% | 覆盖率报告 |
| `mermaid/renderer.ts` | ≥ 75% | 覆盖率报告 |
| `mermaid/validation-pipeline.ts` | ≥ 80% | 覆盖率报告 |
| **总体** | **≥ 85%** | `npm run test:coverage` |

---

### 3.2 性能基准

| 指标 | 目标 | 验证方式 |
|------|------|---------|
| 生成速度（30 类） | < 10s | E2E 时间测试 |
| Token 消耗（LLM 模式） | < 3,000 | Token 监控 |
| 内存峰值 | < 200MB | 内存监控 |
| 验证速度 | < 2s | 单元测试 |

---

### 3.3 代码质量

| 检查项 | 目标 | 验证命令 |
|--------|------|---------|
| TypeScript 编译 | 0 错误 | `npm run type-check` |
| Lint 检查 | 0 错误 | `npm run lint` |
| 格式检查 | 0 错误 | `npm run format:check` |

---

### 3.4 功能验收标准

| 功能 | 验收标准 |
|------|---------|
| **Mermaid 生成** | ✅ 三个 level 都能生成有效代码<br>✅ 生成代码通过 mermaid.parse() 验证 |
| **LLM 分组** | ✅ 能够调用 LLM 获取分组<br>✅ Token 消耗 < 3,000<br>✅ Fallback 到启发式 |
| **启发式分组** | ✅ 基于文件路径正确分组<br>✅ 覆盖常见项目结构 |
| **五层验证** | ✅ 所有五层验证执行<br>✅ 验证报告完整 |
| **自动修复** | ✅ 常见错误自动修复<br>✅ 修复后验证 |
| **本地渲染** | ✅ SVG 渲染成功<br>✅ PNG 转换成功 |
| **错误率** | ✅ < 1% (vs 当前 40-60%) |
| **首次通过率** | ✅ > 95% (vs 当前 ~5%) |

---

## 4. 风险管理

### 4.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| isomorphic-mermaid 不稳定 | 低 | 高 | Phase 0 POC 验证，保留 mermaid-cli 备用 |
| Mermaid 语法限制 | 中 | 中 | 五层验证，自动修复，文档说明 |
| LLM 分组质量不稳定 | 中 | 中 | 启发式分组作为 fallback，Token 监控 |
| 性能回归 | 低 | 中 | 基准测试，持续监控 |
| ESM only 兼容性 | 中 | 低 | 渐进式迁移，明确文档 |

---

### 4.2 项目风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Breaking Change 用户流失 | 中 | 高 | 提供自动迁移工具，详细文档，beta 测试 |
| 实施时间超期 | 中 | 中 | 预留缓冲时间，优先级管理 |
| 社区反馈负面 | 低 | 高 | 提前沟通，快速响应，迭代优化 |

---

## 5. 发布计划

### 5.1 版本路线图

| 版本 | 时间 | 内容 | 目标 |
|------|------|------|------|
| **v2.0.0-alpha.1** | Week 1 | POC 验证 | 验证技术可行性 |
| **v2.0.0-alpha.2** | Week 3 | 核心功能 | 基础生成和验证 |
| **v2.0.0-beta.1** | Week 6 | 公开测试 | 收集社区反馈 |
| **v2.0.0-rc.1** | Week 7 | 发布候选 | 最终验证 |
| **v2.0.0** | Week 7 | 正式发布 | 生产就绪 |

---

### 5.2 发布清单

#### Alpha 发布
- [ ] POC 验证完成
- [ ] 核心组件完成
- [ ] 单元测试通过
- [ ] 内部自测通过

#### Beta 发布
- [ ] 集成测试通过
- [ ] 文档完善
- [ ] 迁移工具可用
- [ ] 发布 npm beta 版本
- [ ] 发布 GitHub 公告

#### RC 发布
- [ ] 社区反馈处理
- [ ] Bug 修复完成
- [ ] 性能验证通过
- [ ] 文档最终审查

#### 正式发布
- [ ] 所有测试通过
- [ ] 文档完整
- [ ] CHANGELOG 更新
- [ ] 发布 npm 正式版本
- [ ] 发布 GitHub Release

---

## 6. 监控与持续改进

### 6.1 监控指标

#### 功能指标
- `mermaid_usage_rate` - Mermaid 格式使用率
- `llm_grouping_usage_rate` - LLM 分组使用率
- `heuristic_grouping_usage_rate` - 启发式分组使用率
- `level_distribution` - package/class/method 使用分布

#### 质量指标
- `generation_success_rate` - 生成成功率
- `validation_error_rate` - 各层验证错误率
- `auto_repair_success_rate` - 自动修复成功率
- `quality_score_avg` - 平均质量评分

#### 性能指标
- `generation_duration_ms` - 生成耗时（按类数量）
- `validation_duration_ms` - 验证耗时
- `llm_tokens_used` - LLM Token 消耗
- `render_duration_ms` - 渲染耗时

#### 成本指标
- `llm_cost_per_diagram` - 每张图的 LLM 成本
- `total_monthly_cost` - 月度总成本

---

### 6.2 反馈收集

**收集渠道**:
1. GitHub Issues（标签：`v2.0-feedback`）
2. 迁移指南讨论
3. 用户调研

**关键问题**:
- 迁移是否顺利？
- LLM 分组是否有用？
- 启发式分组是否够用？
- 图表质量是否提升？
- 验证错误信息是否清晰？

---

### 6.3 持续改进计划

**短期（1-3 个月）**:
- [ ] 优化 LLM 分组质量
- [ ] 改进启发式分组算法
- [ ] 添加更多 Mermaid 图表类型支持
- [ ] 优化验证错误信息

**中期（3-6 个月）**:
- [ ] 支持 sequence diagrams
- [ ] 支持 flowchart diagrams
- [ ] 自定义主题支持
- [ ] Web UI 预览

**长期（6-12 个月）**:
- [ ] IDE 插件（VS Code）
- [ ] 交互式图表编辑器
- [ ] 更多输出格式（PDF, DOT）

---

## 7. 总结

### 7.1 核心价值

1. ✅ **稳定性**: 五层验证确保错误率 < 1%
2. ✅ **速度**: 本地验证和渲染，生成速度 5x
3. ✅ **成本**: LLM 轻量决策，成本降低 70%
4. ✅ **可维护性**: JS 完全可控，维护成本降低 80%
5. ✅ **用户体验**: 首次通过率 >95%，无需重试

---

### 7.2 实施时间表

```
Week 1 (Day 1-5): Phase 0 + Phase 1
├─ Day 1-2: Phase 0 (POC 验证)
├─ Day 3-5: Phase 1 (核心组件开发)
│   ├─ MermaidGenerator
│   ├─ HeuristicGrouper
│   ├─ MermaidParseValidator
│   └─ IsomorphicMermaidRenderer

Week 2 (Day 6-10): Phase 2 + Phase 3
├─ Day 6-7: Phase 2 (LLM 集成和配置)
└─ Day 8-10: Phase 3 (验证管道)
    ├─ StructuralValidator
    ├─ RenderValidator
    ├─ QualityValidator
    └─ ValidationPipeline

Week 3 (Day 11-15): Phase 4 (集成和测试)
├─ Day 11-13: 集成和单元测试
├─ Day 14-15: 集成测试和性能测试

Week 4-5: Phase 5 (文档和迁移)
├─ Day 16-18: 文档编写
└─ Day 19-20: 迁移工具开发

Week 6-7: Phase 6 (发布和监控)
├─ Week 6: Alpha + Beta 发布
└─ Week 7: RC + 正式发布
```

**开发时间**: 3 周（15 个工作日）
**总时间**: 7 周（含测试和发布）

---

### 7.3 成功度量

**定量指标**:
- ✅ 错误率: 40-60% → <1% (**-98%**)
- ✅ 首次通过率: ~5% → >95% (**+90%**)
- ✅ 生成速度: 30-60s → 5-10s (**5x**)
- ✅ Token 消耗: -70%
- ✅ 测试覆盖率: ≥ 85%
- ✅ 用户满意度: > 4/5

**定性指标**:
- ✅ 用户反馈积极
- ✅ 社区认可新方案
- ✅ 被大型项目采用

---

**文档状态**: ✅ 完成（v1.0）
**下一步**: 开始 Phase 0 (POC 验证)
**负责人**: 待分配
**计划开始**: 待定
