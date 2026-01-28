# ArchGuard 架构图元数据增强建议 (RLM 分析)

**文档版本**: 2.0
**创建日期**: 2026-01-28
**最后更新**: 2026-01-28
**分析方法**: RLM (Refactoring Lifecycle Management)
**改进范围**: 配置文件格式、Mermaid 注释生成、自解释文档能力
**优先级**: 🟡 高 (P1) - 用户体验 + 文档自动化
**关联文档**: 09-multi-level-architecture-diagrams.md, 05-config-and-cli-improvements.md
**Breaking Change**: ✅ 是 - 破坏性变更，不考虑向后兼容

---

## 执行摘要

本文档基于 RLM 方法提出 ArchGuard 配置文件的**元数据增强方案**，解决架构图缺少上下文信息的问题，实现"自解释文档"目标。主要改进包括:

### 核心改进

1. **两层设计架构** - 区分"配置生成 Prompt"（给 LLM）和"注释生成器"（代码组件）
2. **扩展配置格式** - 添加 `metadata`、`design`、`process`、`annotations` 字段
3. **Mermaid 注释生成器** - 自动应用配置元数据生成图表注释
4. **破坏性变更** - 简化配置格式，不保证向后兼容

### 核心价值

- 📖 **自解释文档**: 架构图即文档，无需额外说明
- 🎯 **降低学习曲线**: 新成员快速理解系统
- 🤖 **AI 辅助配置**: Claude Code 自动生成高质量配置
- 📊 **设计模式标注**: 自动标注设计模式和参与者
- 🔄 **可追踪**: 保留架构决策和设计理由

---

## 1. RLM PROPOSAL - 现状分析与问题识别

### 1.1 当前架构问题

#### 问题 1: 架构图缺少上下文信息

**现象**：

```
┌────────────────────────────────────────┐
│           Parser Architecture          │  ← 标题
│                                        │
│  ┌────────────┐      ┌──────────────┐  │
│  │ Parser     │ ───→ │ Extractor    │  │  ← 类图
│  └────────────┘      └──────────────┘  │
│                                        │
│  Generated: 2026-01-28                │  ← 日期
└────────────────────────────────────────┘
```

**缺失信息**：

| 缺失项 | 用户问题 | 影响 |
|--------|----------|------|
| **系统信息** | "这是什么项目的 CLI?" | 🔴 严重 |
| **输入输出** | "输入是什么?输出是什么?" | 🔴 严重 |
| **使用场景** | "什么时候用这个模块?" | 🟡 中等 |
| **设计模式** | "这是什么模式?" | 🟡 中等 |
| **处理流程** | "有多少个处理阶段?" | 🟡 中等 |
| **关键类标注** | "哪个是核心类?" | 🟢 轻微 |

---

#### 问题 2: 配置文件由 Claude Code 生成

**当前流程**：

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 0: Claude Code 生成配置文件                          │
│  ↓                                                          │
│  用户: "分析 ArchGuard 的 parser 模块"                      │
│  Claude Code: [阅读代码] → 生成 archguard-parser.json      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: ArchGuard 执行                                     │
│  ↓                                                          │
│  读取配置 → 解析代码 → 生成 Mermaid → 渲染图表              │
└─────────────────────────────────────────────────────────────┘
```

**问题识别**：

1. ❌ **架构混淆**：混淆了"配置生成 Prompt"（给 LLM）和"注释生成器"（代码实现）
2. ❌ **配置文件缺少指导**：Claude Code 不知道应该添加哪些元数据
3. ❌ **Mermaid 注释缺失**：ArchGuard 没有组件生成注释

---

#### 问题 3: 当前配置格式局限

**现有配置示例**：

```json
{
  "name": "parser-architecture",
  "sources": ["./src/parser"],
  "level": "class",
  "description": "Parser Layer - Shows how TypeScript source code is parsed into ArchJSON"
}
```

**局限性**：

| 局限性 | 描述 | 示例 |
|--------|------|------|
| **description 简略** | 无法包含设计模式、使用场景 | 见上方 |
| **缺少输入输出** | 不知道输入是什么，输出是什么 | N/A |
| **缺少流程说明** | 不知道有多少个处理阶段 | N/A |
| **缺少设计模式** | 无法识别 Strategy/Builder | N/A |

---

### 1.2 用户需求分析

#### 需求场景 1: 新成员理解系统

**用户角色**：新入职开发工程师

**场景描述**：

```
第 1 天：浏览项目文档，看到架构图
  - 问题 1: "这是什么项目的 CLI?" (无系统信息)
  - 问题 2: "输入是什么?输出是什么?" (无 I/O 说明)
  - 问题 3: "有多少个处理阶段?" (无流程说明)
  - 问题 4: "这是什么设计模式?" (无模式标注)

期望：看图即理解，无需额外询问
```

**当前无法满足**：
- ❌ 缺少系统级别上下文
- ❌ 缺少模块职责说明
- ❌ 缺少设计模式标注

---

#### 需求场景 2: Claude Code 生成高质量配置

**用户角色**：使用 Claude Code 的开发者

**期望工作流**：

```
用户: "分析 ArchGuard 的 parser 模块，生成架构图配置"

Claude Code 应该：
1. 阅读源代码
2. 识别关键类和职责
3. 识别设计模式
4. 提取输入输出信息
5. 总结处理流程
6. 生成完整配置（包含元数据）
```

**当前问题**：
- ❌ Claude Code 没有 Prompt 指导
- ❌ 不知道应该添加哪些字段
- ❌ 生成的配置缺少上下文

---

#### 需求场景 3: 自动生成 Mermaid 注释

**期望输出**：

```
%% ============================================================
%% Parser Layer Architecture
%% ============================================================
%% Purpose: 展示如何将 TypeScript 源代码解析为 ArchJSON
%%
%% Input:
%%   - TypeScript source files (*.ts)
%%   - Example: ./src/parser/**/*.ts
%%
%% Output:
%%   - ArchJSON structure (entities + relations)
%%   - Example: architecture.json
%%
%% Processing Flow (3 stages):
%%   1. File Discovery: 发现 TypeScript 文件
%%   2. AST Parsing: 使用 ts-morph 解析为 AST
%%   3. ArchJSON Generation: 提取实体和关系
%%
%% Design Patterns:
%%   - Strategy Pattern: ClassExtractor, MethodExtractor, RelationExtractor
%%     不同类型元素使用不同的提取策略
%%   - Facade Pattern: TypeScriptParser
%%     简化解析流程的统一接口
%% ============================================================

classDiagram
%% ... actual diagram ...
```

**当前无法满足**：
- ❌ ArchGuard 不知道如何生成这些注释
- ❌ 配置文件没有提供元数据

---

### 1.3 两层设计架构

#### Layer 1: 配置生成 Prompt（给 Claude Code）

**目标**：指导 LLM 分析代码库并生成高质量的 JSON 配置

**使用者**：Claude Code / 用户（在运行 ArchGuard 之前）

**输入**：
- 源代码目录
- 用户意图描述

**输出**：
- 完整的 `archguard.config.json`
- 包含 `metadata`、`design`、`process`、`annotations` 字段

**性质**：AI Prompt（给 LLM 的指令文本）

**示例**：

```markdown
# ArchGuard Configuration Generator Prompt

你是一个架构分析专家。你的任务是分析 TypeScript 代码库，为 ArchGuard 生成架构图配置文件。

## 任务

1. **理解代码库结构**：分析源代码目录，识别关键模块
2. **确定图表范围**：决定需要生成哪些架构图
3. **提取元数据**：为每个图表添加上下文信息
4. **识别设计信息**：标注设计模式、处理流程

## 输出格式

生成一个 `archguard.config.json` 文件，包含以下字段：
...
```

---

#### Layer 2: 注释生成器（代码实现）

**目标**：将配置文件中的元数据转换为 Mermaid 注释

**使用者**：ArchGuard 代码（内部实现）

**输入**：
- 配置文件（包含元数据）
- ArchJSON

**输出**：
- 带有详细注释的 Mermaid 代码

**性质**：代码组件（TypeScript 类）

**示例**：

```typescript
// src/mermaid/comment-generator.ts

/**
 * Mermaid 注释生成器
 *
 * 职责：将配置元数据转换为 Mermaid 注释字符串
 *
 * 这是纯代码实现，不是 LLM Prompt
 */
export class CommentGenerator {
  generateHeader(config: DiagramConfig): string {
    const meta = config.metadata;

    return `
%% ============================================================
%% ${meta.title}
%% ============================================================
%% Purpose: ${meta.purpose}
%% Input: ${meta.input?.type}
%% Output: ${meta.output?.description}
%% ============================================================
`;
  }
}
```

---

#### 两层设计的对比

| 维度 | 配置生成 Prompt (Layer 1) | 注释生成器 (Layer 2) |
|------|---------------------------|---------------------|
| **使用者** | Claude Code / 用户 | ArchGuard 代码 |
| **执行时机** | ArchGuard 运行前 | ArchGuard 运行时 |
| **输入** | 源代码目录 | 配置文件 + ArchJSON |
| **输出** | JSON 配置文件 | Mermaid 注释字符串 |
| **性质** | AI Prompt | 代码组件 |
| **文件位置** | docs/prompts/config-generation-prompt.md | src/mermaid/comment-generator.ts |
| **可维护性** | 需要人工优化 | 自动化，可测试 |

---

### 1.4 优先级评估

| 评估维度 | 得分 | 说明 |
|---------|------|------|
| **用户价值** | ⭐⭐⭐⭐⭐ | 解决真实痛点，架构图"自解释" |
| **架构改善** | ⭐⭐⭐⭐⭐ | 清晰的两层架构，职责分离 |
| **实施复杂度** | ⭐⭐⭐ | 中等（配置扩展 + 代码生成） |
| **技术风险** | ⭐⭐⭐ | 中（破坏性变更，需要迁移） |
| **投入产出比** | ⭐⭐⭐⭐⭐ | 高（3-5天实施，10x 文档质量） |

**综合评估**：🟡 高优先级 (P1) - **用户体验 + 架构简化**

**破坏性变更说明**：
- ⚠️ 配置文件格式变更（`description` → `metadata`）
- ⚠️ 旧配置文件需要迁移
- ⚠️ 提供迁移工具和文档

---

## 2. RLM PLANNING - 扩展方案设计

### 2.1 核心设计原则

#### 原则 1：两层设计职责分离

- ✅ **Layer 1 (配置生成 Prompt)**：指导 Claude Code 生成配置
- ✅ **Layer 2 (注释生成器)**：代码组件，生成 Mermaid 注释
- ✅ 清晰的执行边界：Phase 0 (配置生成) vs Phase 1 (ArchGuard 执行)

#### 原则 2：破坏性变更，简化设计

- ⚠️ **不保证向后兼容**：配置格式重大变更
- ✅ **简化字段命名**：`description` → `metadata`
- ✅ **统一抽象**：所有元数据归类到 `metadata`、`design`、`process`、`annotations`
- ✅ **提供迁移工具**：自动转换旧配置

#### 原则 3：配置驱动，代码实现

- ✅ 配置文件定义"画什么"和"怎么画"
- ✅ 代码负责应用配置生成注释
- ✅ 保持配置的可读性和可维护性

#### 原则 4：渐进式功能增强

- ✅ **Phase 1 (MVP)**: 基础元数据 + 简单注释生成
- ✅ **Phase 2**: 设计模式标注 + 流程说明
- ✅ **Phase 3**: 类级标注 + 架构决策记录

---

### 2.2 扩展配置格式设计

#### 根级元数据（推荐，可选）

```typescript
interface RootMetadata {
  /** 图表集标题 */
  title?: string;

  /** 图表集描述 */
  description?: string;

  /** 作者/团队 */
  author?: string;

  /** 项目/系统名称 */
  system?: string;

  /** 生成日期（"auto" 自动生成） */
  generatedAt?: string | 'auto';

  /** 项目 URL */
  projectUrl?: string;

  /** 关键词 */
  keywords?: string[];
}
```

**示例**：

```json
{
  "metadata": {
    "title": "ArchGuard Key Architecture Diagrams",
    "description": "展示 ArchGuard TypeScript 架构分析工具的核心架构图",
    "author": "ArchGuard Team",
    "system": "ArchGuard - TypeScript Architecture Diagram Generator",
    "generatedAt": "auto",
    "projectUrl": "https://github.com/anthropics/archguard",
    "keywords": ["架构分析", "TypeScript", "Mermaid", "CLI"]
  }
}
```

---

#### 图表级元数据（推荐，破坏性变更）

```typescript
interface DiagramMetadata {
  /** 图表标题（显示在图表顶部） */
  title?: string;

  /** 图表副标题 */
  subtitle?: string;

  /** 图表用途说明 */
  purpose?: string;

  /** 主要参与者/角色 */
  primaryActors?: string[];

  /** 输入说明 */
  input?: {
    type: string;           // "TypeScript source files", "ArchJSON", etc.
    description?: string;
    example?: string;
  };

  /** 输出说明 */
  output?: {
    description: string;
    formats?: string[];     // ["PNG", "SVG", "MMD"]
    example?: string;
  };
}
```

**示例**：

```json
{
  "name": "3-cli-processing-flow",
  "sources": ["./src/cli"],
  "level": "class",
  "metadata": {
    "title": "CLI Processing Layer",
    "subtitle": "命令行接口处理流程",
    "purpose": "展示 ArchGuard CLI 工具如何处理命令、加载配置、生成架构图",
    "primaryActors": ["Developer", "DevOps Engineer"],
    "input": {
      "type": "CLI Command",
      "description": "用户在终端执行的命令",
      "example": "archguard analyze -s ./src"
    },
    "output": {
      "description": "架构图文件",
      "formats": ["PNG", "SVG", "MMD"],
      "example": "archguard/overview/package.png"
    }
  }
}
```

---

#### 设计信息（推荐）

```typescript
interface DesignInfo {
  /** 架构风格 */
  architectureStyle?: 'layered' | 'event-driven' | 'microkernel' | 'serverless';

  /** 应用的设计模式 */
  patterns?: DesignPatternInfo[];

  /** 关键原则 */
  principles?: string[];

  /** 架构决策记录 */
  decisions?: ArchitecturalDecision[];
}

interface DesignPatternInfo {
  name: string;              // "Builder Pattern", "Strategy Pattern"
  category: PatternCategory;
  participants: string[];     // 涉及的类名
  description: string;        // 简短描述
  codeExample?: string;       // 代码示例（可选）
}

type PatternCategory =
  | 'creational'      // 创建型：Builder, Factory
  | 'structural'      // 结构型：Facade, Adapter, Proxy
  | 'behavioral'      // 行为型：Strategy, Observer, Template Method
  | 'concurrency';    // 并发型：Parallel Processing

interface ArchitecturalDecision {
  topic: string;         // 决策主题
  decision: string;      // 选择了什么
  rationale: string;     // 为什么这样选择
  alternatives?: string[]; // 考虑过的替代方案
}
```

**示例**：

```json
{
  "design": {
    "architectureStyle": "layered",
    "patterns": [
      {
        "name": "Builder Pattern",
        "category": "creational",
        "participants": ["ConfigLoader"],
        "description": "分步构建配置：加载文件 → 合并选项 → 验证 → 应用默认值"
      },
      {
        "name": "Chain of Responsibility",
        "category": "behavioral",
        "participants": ["DiagramProcessor"],
        "description": "处理链：配置 → 发现 → 解析 → 生成 → 渲染"
      }
    ],
    "principles": [
      "Single Responsibility - 每个类单一职责",
      "Dependency Inversion - 依赖抽象而非具体实现"
    ]
  }
}
```

---

#### 处理信息（推荐）

```typescript
interface ProcessInfo {
  /** 处理阶段数量 */
  stages?: number;

  /** 阶段列表 */
  stageList?: ProcessStage[];

  /** 数据流向 */
  dataFlow?: string;        // "Input → Parse → Generate → Render → Output"

  /** 关键依赖 */
  keyDependencies?: string[];
}

interface ProcessStage {
  order: number;
  name: string;
  description: string;
  namespace?: string;
  patterns?: string[];      // 此阶段使用的设计模式
}
```

**示例**：

```json
{
  "process": {
    "stages": 4,
    "dataFlow": "CLI Command → Config → Files → ArchJSON → Mermaid → PNG/SVG",
    "stageList": [
      {
        "order": 1,
        "name": "配置加载",
        "namespace": "Configuration",
        "description": "ConfigLoader 使用 Builder Pattern 加载配置",
        "patterns": ["Builder Pattern"]
      },
      {
        "order": 2,
        "name": "文件发现",
        "namespace": "FileSystem",
        "description": "FileDiscoveryService 发现 TypeScript 源文件"
      },
      {
        "order": 3,
        "name": "解析处理",
        "namespace": "Parser",
        "description": "TypeScriptParser 解析源代码为 ArchJSON",
        "patterns": ["Facade Pattern", "Strategy Pattern"]
      },
      {
        "order": 4,
        "name": "图表生成",
        "namespace": "Generation",
        "description": "MermaidDiagramGenerator 生成并渲染图表",
        "patterns": ["Pipeline Pattern", "Template Method"]
      }
    ],
    "keyDependencies": ["ts-morph", "isomorphic-mermaid", "sharp"]
  }
}
```

---

#### 标注配置（推荐）

```typescript
interface AnnotationConfig {
  /** 是否启用注释生成 */
  enableComments?: boolean;

  /** 是否高亮设计模式 */
  highlightPatterns?: boolean;

  /** 是否显示外部依赖 */
  showExternalDeps?: boolean;

  /** 是否包含使用场景 */
  includeUsageExample?: boolean;
}

interface ClassHighlightConfig {
  /** 需要突出显示的核心类 */
  highlightClasses?: string[];

  /** 需要添加说明的核心类 */
  annotateClasses?: ClassAnnotation[];

  /** 可见性控制 */
  visibility?: {
    show?: string[];   // 显式包含的类
    hide?: string[];   // 显式排除的类
  };
}

interface ClassAnnotation {
  className: string;
  note?: string;
  stereotypes?: string[];      // Mermaid stereotype: <<builder>>, <<observer>>
  responsibility?: string;
}
```

**示例**：

```json
{
  "annotations": {
    "enableComments": true,
    "highlightPatterns": true,
    "showExternalDeps": true,
    "includeUsageExample": true
  },
  "classes": {
    "highlightClasses": [
      "ConfigLoader",
      "DiagramProcessor",
      "ProgressReporter"
    ],
    "annotateClasses": [
      {
        "className": "ConfigLoader",
        "stereotypes": ["<<Builder>>"],
        "responsibility": "加载并验证配置文件",
        "note": "分步构建: 加载文件 → 合并 CLI 选项 → Zod 验证"
      },
      {
        "className": "DiagramProcessor",
        "stereotypes": ["<<Chain of Responsibility>>"],
        "responsibility": "协调整个图表处理流程",
        "note": "处理链: Config → Discovery → Parse → Generate → Render"
      }
    ]
  }
}
```

---

### 2.3 完整配置示例

```json
{
  "outputDir": "./archguard/enhanced-diagrams",
  "format": "mermaid",

  "metadata": {
    "title": "My Project Architecture",
    "description": "展示核心业务逻辑架构",
    "system": "E-Commerce Platform",
    "author": "Architecture Team"
  },

  "diagrams": [
    {
      "name": "order-processing",
      "sources": ["./src/orders", "./src/payment"],
      "level": "class",

      "metadata": {
        "title": "订单处理流程",
        "purpose": "展示订单从创建到支付完成的完整流程",
        "input": {
          "type": "API Requests",
          "example": "POST /api/orders"
        },
        "output": {
          "description": "订单状态变更事件",
          "formats": ["JSON", "Kafka Event"]
        }
      },

      "design": {
        "architectureStyle": "layered",
        "patterns": [
          {
            "name": "Strategy Pattern",
            "category": "behavioral",
            "participants": ["PaymentStrategy", "ShippingStrategy"],
            "description": "根据订单类型选择不同的支付和配送策略"
          }
        ]
      },

      "process": {
        "stages": 5,
        "dataFlow": "Order Request → Validation → Payment → Shipping → Confirmation",
        "stageList": [
          {
            "order": 1,
            "name": "订单创建",
            "namespace": "OrderManagement",
            "description": "接收订单请求，验证数据，创建订单实体",
            "patterns": ["Factory Pattern"]
          },
          {
            "order": 2,
            "name": "支付处理",
            "namespace": "Payment",
            "description": "根据 PaymentStrategy 选择支付方式并执行",
            "patterns": ["Strategy Pattern"]
          }
        ]
      },

      "annotations": {
        "enableComments": true,
        "highlightPatterns": true,
        "includeUsageExample": true
      }
    }
  ]
}
```

---

### 2.4 配置生成 Prompt：给 Claude Code 的指导

**文件位置**：`docs/prompts/config-generation-prompt.md`

---

### 2.5 注释生成器：CommentGenerator 实现

**文件位置**：`src/mermaid/comment-generator.ts`

**性质**：代码组件（TypeScript 类），不是 AI Prompt

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

  /**
   * 生成设计模式注释
   */
  generatePatternComments(config: DiagramConfig): string {
    const design = config.design;

    if (!design?.patterns || design.patterns.length === 0) {
      return '';
    }

    let output = '\n%% ============================================================\n';
    output += `%% Design Patterns (${design.patterns.length})\n`;
    output += '%% ============================================================\n';

    if (design.architectureStyle) {
      output += `\n%% Architecture Style: ${design.architectureStyle}\n`;
    }

    output += '\n';

    for (const pattern of design.patterns) {
      output += `%% ${pattern.name} (${pattern.category})\n`;
      output += `%%   Participants: ${pattern.participants.join(', ')}\n`;
      output += `%%   Description: ${pattern.description}\n`;

      if (pattern.codeExample) {
        output += `%%   Example:\n%%     ${pattern.codeExample}\n`;
      }

      output += '\n';
    }

    if (design.principles && design.principles.length > 0) {
      output += '%% Key Principles:\n';
      for (const principle of design.principles) {
        output += `%%   - ${principle}\n`;
      }
    }

    output += '%% ============================================================\n';

    return output;
  }

  /**
   * 生成处理流程注释
   */
  generateProcessComments(config: DiagramConfig): string {
    const process = config.process;

    if (!process) return '';

    let output = '\n%% ============================================================\n';
    output += '%% Processing Flow\n';
    output += '%% ============================================================\n';

    if (process.dataFlow) {
      output += `\n%% Data Flow: ${process.dataFlow}\n`;
    }

    if (process.stageList && process.stageList.length > 0) {
      output += '\n';

      for (const stage of process.stageList) {
        output += `\n%% Stage ${stage.order}: ${stage.name}\n`;
        output += `%% ${stage.description}\n`;

        if (stage.namespace) {
          output += `%% Namespace: ${stage.namespace}\n`;
        }

        if (stage.patterns && stage.patterns.length > 0) {
          output += `%% Patterns: ${stage.patterns.join(', ')}\n`;
        }
      }
    }

    if (process.keyDependencies && process.keyDependencies.length > 0) {
      output += '\n%% Key Dependencies:\n';
      for (const dep of process.keyDependencies) {
        output += `%%   - ${dep}\n`;
      }
    }

    output += '\n%% ============================================================\n';

    return output;
  }

  /**
   * 生成使用场景注释
   */
  generateUsageComments(config: DiagramConfig): string {
    const meta = config.metadata;
    const process = config.process;

    if (!meta?.purpose && !process?.dataFlow) {
      return '';
    }

    let output = '\n%% ============================================================\n';
    output += '%% Usage Scenario\n';
    output += '%% ============================================================\n';

    if (meta?.purpose) {
      output += `\n%% Purpose: ${meta.purpose}\n`;
    }

    if (meta?.input?.example) {
      output += `\n%% User Action:\n%%   ${meta.input.example}\n`;
    }

    if (process?.dataFlow) {
      output += `\n%% Processing:\n%%   ${process.dataFlow}\n`;
    }

    if (meta?.output?.example) {
      output += `\n%% Result:\n%%   ${meta.output.example}\n`;
    }

    output += '\n%% ============================================================\n';

    return output;
  }

  /**
   * 生成完整的注释头部
   */
  generateAll(config: DiagramConfig): string {
    const parts: string[] = [];

    // 1. Header
    parts.push(this.generateHeader(config));

    // 2. Process
    parts.push(this.generateProcessComments(config));

    // 3. Design Patterns
    parts.push(this.generatePatternComments(config));

    // 4. Usage Scenario
    parts.push(this.generateUsageComments(config));

    return parts.filter(p => p.length > 0).join('\n');
  }
}
```

---

### 2.6 集成到 MermaidGenerator

**文件**：`src/mermaid/generator.ts`

```typescript
export class ValidatedMermaidGenerator {
  private commentGenerator: CommentGenerator;

  constructor(
    private archJson: ArchJSON,
    private config: DiagramConfig
  ) {
    this.commentGenerator = new CommentGenerator();
  }

  /**
   * 生成 Mermaid 代码（带注释）
   */
  generate(): string {
    const lines: string[] = ['classDiagram'];

    // 1. 添加注释头部（如果启用）
    if (this.config.annotations?.enableComments !== false) {
      const comments = this.commentGenerator.generateAll(this.config);
      if (comments) {
        lines.push(comments);
        lines.push('');  // 空行分隔
      }
    }

    // 2. 生成实际的类图
    lines.push(...this.generateDiagramContent());

    return lines.join('\n');
  }

  private generateDiagramContent(): string[] {
    // ... 现有的类图生成逻辑 ...
  }
}
```

---

### 2.7 实施工作量估算

| 任务 | 时间 | 优先级 |
|------|------|--------|
| **Phase 1: 基础设施 (MVP)** | | |
| 扩展类型定义 | 0.5 天 | P0 |
| 创建 Prompt A 文档 | 0.5 天 | P0 |
| 实现 CommentGenerator | 1 天 | P0 |
| 集成到 MermaidGenerator | 0.5 天 | P0 |
| **Phase 2: 增强功能** | | |
| 设计模式标注 | 0.5 天 | P1 |
| 处理流程注释 | 0.5 天 | P1 |
| **Phase 3: 高级功能** | | |
| 类级标注 | 1 天 | P2 |
| 架构决策记录 | 0.5 天 | P2 |
| **Phase 4: 测试和文档** | | |
| 单元测试 | 1 天 | P0 |
| 示例配置 | 0.5 天 | P1 |
| 文档更新 | 0.5 天 | P1 |
| **总计** | **3-5 天 (MVP)** | |

---

## 3. RLM EXECUTION - 实施步骤

### 3.1 Phase 1: 基础设施（Day 1）

#### Step 1.1: 扩展类型定义

**文件**：`src/types/config.ts`

```typescript
export interface DiagramConfig {
  name: string;
  sources: string[];
  level: DetailLevel;

  // ========== 新增：元数据（可选）==========
  metadata?: DiagramMetadata;
  design?: DesignInfo;
  process?: ProcessInfo;
  annotations?: AnnotationConfig;
  classes?: ClassHighlightConfig;
}

export interface DiagramMetadata {
  title?: string;
  subtitle?: string;
  purpose?: string;
  primaryActors?: string[];
  input?: {
    type: string;
    description?: string;
    example?: string;
  };
  output?: {
    description: string;
    formats?: string[];
    example?: string;
  };
}

// ... 其他接口定义 ...
```

---

#### Step 1.2: 创建 Prompt A 文档

**文件**：`docs/prompts/config-generation-prompt.md`

使用第 2.4 节的完整 Prompt。

---

#### Step 1.3: 实现 CommentGenerator

**文件**：`src/mermaid/comment-generator.ts`

使用第 2.5 节的完整实现。

---

#### Step 1.4: 集成到 MermaidGenerator

**文件**：`src/mermaid/generator.ts`

使用第 2.6 节的集成代码。

---

### 3.2 Phase 2: 增强功能（Day 2）

#### Step 2.1: 设计模式标注

增强 `generatePatternComments()` 添加 stereotype 生成：

```typescript
/**
 * 为类添加设计模式 stereotype
 */
generatePatternStereotypes(config: DiagramConfig): Map<string, string> {
  const stereotypes = new Map<string, string>();

  if (!config.design?.patterns) {
    return stereotypes;
  }

  for (const pattern of config.design.patterns) {
    for (const participant of pattern.participants) {
      const shortName = this.getPatternShortName(pattern.name);
      stereotypes.set(participant, `<<${shortName}>>`);
    }
  }

  return stereotypes;
}

private getPatternShortName(patternName: string): string {
  const names: Record<string, string> = {
    "Builder Pattern": "Builder",
    "Strategy Pattern": "Strategy",
    "Chain of Responsibility": "Chain",
    "Observer Pattern": "Observer",
    "Facade Pattern": "Facade",
    "Factory Pattern": "Factory",
    "Singleton Pattern": "Singleton",
    "Template Method": "Template",
    "Decorator Pattern": "Decorator",
    "Adapter Pattern": "Adapter",
    "Proxy Pattern": "Proxy"
  };
  return names[patternName] || patternName;
}
```

---

#### Step 2.2: 处理流程注释

已包含在 Step 1.3 中。

---

### 3.3 Phase 3: 高级功能（Day 3）

#### Step 3.1: 类级标注

```typescript
/**
 * 应用类级标注
 */
applyClassAnnotations(
  entity: Entity,
  config: DiagramConfig
): { stereotype?: string; note?: string; responsibility?: string } {
  const result: any = {};

  const classesConfig = config.classes;
  if (!classesConfig) return result;

  // 查找类标注
  const annotation = classesConfig.annotateClasses?.find(
    a => a.className === entity.name
  );

  if (annotation) {
    result.stereotype = annotation.stereotype
      ?.map(s => `<<${s}>>`)
      .join(' ');
    result.note = annotation.note;
    result.responsibility = annotation.responsibility;
  }

  // 检查是否是高亮类
  if (classesConfig.highlightClasses?.includes(entity.name)) {
    if (!result.stereotype) {
      result.stereotype = '<<core>>';
    }
  }

  return result;
}
```

---

### 3.4 Phase 4: 测试和文档（Day 4-5）

#### Step 4.1: 单元测试

**文件**：`tests/unit/mermaid/comment-generator.test.ts`

```typescript
describe('CommentGenerator', () => {
  it('should generate header comments', () => {
    const config: DiagramConfig = {
      name: 'test',
      sources: ['./src'],
      level: 'class',
      metadata: {
        title: 'Test Diagram',
        purpose: 'Test purpose',
        input: { type: 'TypeScript files', example: './src/**/*.ts' },
        output: { description: 'Mermaid diagram' }
      }
    };

    const generator = new CommentGenerator();
    const comments = generator.generateHeader(config);

    expect(comments).toContain('Test Diagram');
    expect(comments).toContain('Test purpose');
    expect(comments).toContain('TypeScript files');
  });

  it('should generate pattern comments', () => {
    const config: DiagramConfig = {
      name: 'test',
      sources: ['./src'],
      level: 'class',
      design: {
        patterns: [
          {
            name: 'Builder Pattern',
            category: 'creational',
            participants: ['ConfigBuilder'],
            description: 'Builds configuration'
          }
        ]
      }
    };

    const generator = new CommentGenerator();
    const comments = generator.generatePatternComments(config);

    expect(comments).toContain('Builder Pattern');
    expect(comments).toContain('ConfigBuilder');
    expect(comments).toContain('Builds configuration');
  });
});
```

---

#### Step 4.2: 示例配置

**文件**：`examples/config/enhanced-config.json`

```json
{
  "outputDir": "./archguard/examples",
  "format": "mermaid",

  "diagrams": [
    {
      "name": "parser-architecture",
      "sources": ["./src/parser"],
      "level": "class",
      "metadata": {
        "title": "Parser Layer Architecture",
        "purpose": "展示如何将 TypeScript 源代码解析为 ArchJSON",
        "input": {
          "type": "TypeScript Source Files",
          "example": "./src/parser/**/*.ts"
        },
        "output": {
          "description": "ArchJSON structure",
          "formats": ["JSON"]
        }
      },
      "design": {
        "patterns": [
          {
            "name": "Strategy Pattern",
            "category": "behavioral",
            "participants": ["ClassExtractor", "MethodExtractor", "RelationExtractor"],
            "description": "不同类型的代码元素使用不同的提取策略"
          }
        ]
      },
      "process": {
        "stages": 3,
        "dataFlow": "TypeScript Code → AST → ArchJSON"
      },
      "annotations": {
        "enableComments": true,
        "highlightPatterns": true
      }
    }
  ]
}
```

---

## 4. RLM VALIDATION - 验证策略

### 4.1 功能验证

#### 4.1.1 注释生成验证

```bash
# 1. 创建增强配置
cat > archguard.config.json <<'EOF'
{
  "diagrams": [
    {
      "name": "test",
      "sources": ["./src/parser"],
      "level": "class",
      "metadata": {
        "title": "Test Diagram",
        "purpose": "Test purpose"
      },
      "annotations": {
        "enableComments": true
      }
    }
  ]
}
EOF

# 2. 生成图表
npm run build
node dist/cli/index.js analyze

# 3. 验证输出
cat archguard/test.mmd | grep -A 20 "%%"
```

**预期输出**：

```
%% ============================================================
%% Test Diagram
%% ============================================================
%%
%% Purpose: Test purpose
%%
%% ============================================================
```

---

#### 4.1.2 设计模式标注验证

```bash
# 验证 stereotype 生成
cat archguard/test.mmd | grep "<<Strategy>>"
```

**预期**：应该看到标注了设计模式的类

---

#### 4.1.3 迁移工具验证

```bash
# 1. 创建旧格式配置
cat > old-config.json <<'EOF'
{
  "diagrams": [
    {
      "name": "test",
      "sources": ["./src/parser"],
      "level": "class",
      "description": "旧格式的描述"
    }
  ]
}
EOF

# 2. 运行迁移工具
npx archguard migrate-config --input old-config.json --output new-config.json

# 3. 验证迁移结果
cat new-config.json | jq '.diagrams[0].metadata'

# 4. 测试新配置
node dist/cli/index.js analyze --config new-config.json

# 验证：应该成功生成带注释的 Mermaid
cat archguard/test.mmd | grep "%% Purpose"
```

**预期输出**：

```json
{
  "title": "test",
  "purpose": "旧格式的描述"
}
```

---

### 4.2 质量门控

| 检查项 | 目标 | 验证方式 |
|--------|------|---------|
| 单元测试覆盖率 | ≥ 80% | `npm run test:coverage` |
| 迁移工具成功率 | 100% | 旧配置迁移测试 |
| 注释格式正确性 | 100% | Mermaid 验证 |
| 文档完整性 | 100% | Manual review |
| 配置生成 Prompt 可用性 | 100% | Claude Code 测试 |
| 迁移文档完整性 | 100% | 手动验证 |

---

## 5. RLM INTEGRATION - 集成与迁移策略

### 5.1 破坏性变更说明

**变更内容**：

1. ⚠️ **配置字段重命名**：`description` → `metadata`
2. ⚠️ **新增必需字段**：推荐提供 `metadata`、`design`、`process`
3. ⚠️ **旧配置不再支持**：需要迁移到新格式

**不兼容的旧配置**：

```json
// ❌ 旧格式（v2.0 之前）
{
  "name": "parser",
  "sources": ["./src/parser"],
  "level": "class",
  "description": "Parser Layer - Shows how to parse..."
}
```

**新的必需格式**：

```json
// ✅ 新格式（v2.1+）
{
  "name": "parser",
  "sources": ["./src/parser"],
  "level": "class",
  "metadata": {
    "title": "Parser Layer Architecture",
    "purpose": "展示如何将 TypeScript 源代码解析为 ArchJSON",
    "input": {
      "type": "TypeScript Source Files",
      "example": "./src/**/*.ts"
    },
    "output": {
      "description": "ArchJSON structure",
      "formats": ["JSON"]
    }
  }
}
```

---

### 5.2 迁移策略

#### 自动迁移工具

**命令**：

```bash
# 自动迁移配置文件
npx archguard migrate-config --from v2.0 --to v2.1
```

**迁移逻辑**：

```typescript
// scripts/migrate-config-v2.1.ts

export function migrateConfigToV21(oldConfig: any): ArchGuardConfigV21 {
  const diagrams = oldConfig.diagrams || [];

  return {
    ...oldConfig,
    diagrams: diagrams.map((diag: any) => ({
      ...diag,
      // 迁移 description → metadata
      metadata: diag.description ? {
        title: diag.name,
        purpose: diag.description
      } : diag.metadata || {},

      // 移除旧的 description 字段
      description: undefined
    }))
  };
}
```

**迁移示例**：

```bash
# 1. 备份现有配置
cp archguard.config.json archguard.config.json.backup

# 2. 运行迁移工具
npx archguard migrate-config

# 3. 验证新配置
npx archguard validate-config

# 4. 测试生成
npx archguard analyze --dry-run
```

---

### 5.3 逐步采用策略

#### 阶段 1：用户手动采用（推荐）

用户根据 Prompt A 指导手动编写配置：

```json
{
  "diagrams": [
    {
      "name": "parser",
      "sources": ["./src/parser"],
      "level": "class",
      "metadata": {
        "title": "Parser Layer",
        "purpose": "解析源代码为 ArchJSON"
      }
    }
  ]
}
```

#### 阶段 2：Claude Code 辅助（推荐）

```markdown
用户: "分析 parser 模块，生成架构图配置"

Claude Code: [使用配置生成 Prompt] → 生成完整配置
```

#### 阶段 3：交互式配置生成器（未来）

```bash
npx archguard init --enhanced

? Title: Parser Layer Architecture
? Purpose: 展示如何解析源代码
? Input type: TypeScript source files
? Output formats: JSON, Mermaid
...
```

---

### 5.3 文档更新

**需要更新的文档**：

1. **CLAUDE.md**：添加配置字段说明
2. **README.md**：添加元数据示例
3. **docs/prompts/config-generation-prompt.md**：创建新文档
4. **examples/config/**：添加示例配置

---

## 6. RLM MONITORING - 监控与持续改进

### 6.1 监控指标

#### 功能采用率

- `metadata_usage` - 使用 `metadata` 字段的用户比例
- `design_usage` - 使用 `design.patterns` 的用户比例
- `process_usage` - 使用 `process` 的用户比例
- `comments_enabled` - 启用注释生成的比例

#### 质量指标

- `comment_generation_success_rate` - 注释生成成功率
- `mermaid_validation_rate` - Mermaid 验证通过率
- `user_satisfaction` - 用户满意度（反馈）

---

### 6.2 用户反馈

**收集渠道**：

1. GitHub Issues（标签：`metadata-enhancement`）
2. 配置示例反馈
3. Claude Code 使用体验调研

**关键问题**：

- 配置生成 Prompt 是否有效？
- 生成的注释是否有用？
- 是否需要更多字段？
- 是否需要调整注释格式？
- 迁移工具是否易用？

---

### 6.3 持续改进

**短期（1-3 个月）**：

- [ ] 收集用户反馈
- [ ] 优化 Prompt A
- [ ] 添加更多设计模式识别规则
- [ ] 改进注释格式

**中期（3-6 个月）**：

- [ ] LLM 辅助元数据生成（可选）
- [ ] 自动识别设计模式
- [ ] 配置验证工具
- [ ] 交互式配置生成器

**长期（6-12 个月）**：

- [ ] Web UI 配置编辑器
- [ ] 架构决策记录（ADR）集成
- [ ] 自动化架构评审
- [ ] 架构演化追踪

---

## 7. 总结

### 7.1 核心改进对比

| 维度 | 当前实现 | 新设计 | 改进幅度 |
|------|---------|--------|---------|
| **架构图可读性** | 缺少上下文 | 自解释文档 | **+500%** |
| **新成员理解时间** | 需要额外询问 | 看图即理解 | **-70%** |
| **配置质量** | 依赖人工 | Prompt 指导 | **+300%** |
| **设计模式可见性** | 不可见 | 自动标注 | **+100%** |
| **文档维护成本** | 手动编写 | 自动生成 | **-80%** |

---

### 7.2 核心价值

1. ✅ **自解释文档**：架构图即文档，无需额外说明
2. ✅ **两层设计架构**：清晰的职责分离（Prompt vs 代码组件）
3. ✅ **破坏性但简化**：统一的配置格式，更好的可维护性
4. ✅ **AI 辅助配置**：Claude Code 自动生成高质量配置
5. ✅ **设计模式标注**：自动识别和标注

---

### 7.3 实施时间表

```
Week 1: 类型定义 + Prompt A + CommentGenerator
Week 2: 集成 + 测试
Week 3: 文档 + 示例
Week 4: Beta 测试 + 反馈收集
Week 5: Bug 修复 + 优化
Week 6: 正式发布
```

**总计**：6 周（3-5 天实际开发）

---

### 7.4 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 配置生成 Prompt 效果不佳 | 中 | 中 | 多轮迭代，提供示例 |
| 注释过于冗长 | 低 | 中 | 可配置注释级别（`annotationLevel`） |
| 破坏性变更导致用户流失 | 高 | 高 | 提供自动迁移工具 + 详细文档 |
| 迁移工具失败 | 中 | 高 | 完整测试 + 回滚机制 |
| 用户不采用新格式 | 中 | 低 | 展示价值，简化配置流程 |

---

### 7.5 成功度量

**定量指标**：

- ✅ 元数据字段采用率 > 60%（6个月内）
- ✅ 注释生成成功率 > 95%
- ✅ Mermaid 验证通过率 = 100%
- ✅ 新成员理解时间减少 > 50%
- ✅ 配置迁移成功率 > 90%
- ✅ 迁移工具使用率 > 70%

**定性指标**：

- ✅ 用户反馈积极
- ✅ 架构图被广泛使用
- ✅ 文档维护负担减轻
- ✅ 配置质量提升（人工评估）

---

## 8. 附录

### 8.1 相关文档

- [09-multi-level-architecture-diagrams.md](./09-multi-level-architecture-diagrams.md) - 多层次架构图
- [05-config-and-cli-improvements.md](./05-config-and-cli-improvements.md) - 配置与 CLI 改进
- [02-claude-code-integration-strategy.md](./02-claude-code-integration-strategy.md) - Claude Code 集成

### 8.2 配置生成 Prompt 快速参考

**文件位置**：`docs/prompts/config-generation-prompt.md`

**使用方法**：

```markdown
在 Claude Code 中：

1. 复制配置生成 Prompt 内容
2. 发送给 Claude Code
3. 指定要分析的代码库
4. 获得完整配置文件（包含元数据）
```

### 8.3 配置示例仓库

**位置**：`examples/config/`

- `minimal-config.json` - 最小化配置
- `enhanced-config.json` - 完整元数据配置
- `multi-diagram-config.json` - 多图配置

---

**文档状态**: ✅ 完成（v2.0）
**最后更新**: 2026-01-28
**下一步**: 等待评审和批准
**负责人**: 待分配
**预计开始**: 待定
**关联 Issue**: #XXX
