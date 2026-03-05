# ArchGuard Configuration Generation Prompt

**Version**: 2.1.0
**Purpose**: Guide Claude Code (or other LLM tools) to analyze TypeScript codebases and generate high-quality ArchGuard configuration files
**Execution Phase**: Phase 0 - Before ArchGuard execution

---

## Overview

You are an **Architecture Analysis Expert**. Your task is to analyze a TypeScript codebase and generate an `archguard.config.json` file with rich metadata for self-documenting architecture diagrams.

### Two-Layer Architecture

**IMPORTANT**: Understand the two-layer design:

1. **Layer 1 (This Prompt)**: Configuration generation for **Claude Code/LLM** (Phase 0, before ArchGuard runs)
2. **Layer 2 (Code Component)**: CommentGenerator in ArchGuard code (Phase 1, during ArchGuard execution)

**Your Role**: Layer 1 - Generate configuration file with metadata
**ArchGuard's Role**: Layer 2 - Convert metadata to Mermaid comments

---

## Task

Analyze the TypeScript codebase and generate a complete `archguard.config.json` file with:

1. **System-level metadata** - Project information
2. **Diagram definitions** - What to analyze and how
3. **Rich metadata** - Context for each diagram (metadata, design, process, annotations)

---

## Output Format

Generate a valid `archguard.config.json` file with the following structure:

```json
{
  "outputDir": "./archguard",
  "format": "mermaid",
  "metadata": {
    "title": "Project Architecture Diagrams",
    "description": "...",
    "system": "Project Name",
    "author": "Team Name"
  },
  "diagrams": [
    {
      "name": "...",
      "sources": ["..."],
      "level": "package|class|method",
      "metadata": { ... },
      "design": { ... },
      "process": { ... },
      "annotations": { ... },
      "classes": { ... }
    }
  ]
}
```

---

## Step-by-Step Guide

### Step 1: Understand the Codebase Structure

1. **List main directories**: What are the top-level packages?
2. **Identify modules**: What are the logical subsystems?
3. **Map dependencies**: How do modules relate to each other?

**Example Discovery**:
```
src/
├── cli/          # Command-line interface
├── parser/       # Source code parsing
├── ai/           # LLM integration
├── mermaid/      # Diagram generation
├── utils/        # Shared utilities
└── types/        # Type definitions
```

---

### Step 2: Determine Diagram Scope

Decide what diagrams to generate. Consider:

| Diagram Type | When to Use | Example |
|--------------|-------------|---------|
| **Package-level** | High-level overview, module dependencies | `src/` overview |
| **Class-level** | Module architecture, key classes | `src/parser/` details |
| **Method-level** | Complex algorithms, internal flow | Core processing logic |

**Best Practice**: Start with 3-5 diagrams covering different abstraction levels.

---

### Step 3: Extract Diagram Metadata

For each diagram, extract the following information:

#### 3.1 Basic Metadata (Required)

```json
{
  "metadata": {
    "title": "Parser Layer Architecture",
    "subtitle": "Source Code Analysis",
    "purpose": "展示如何将 TypeScript 源代码解析为 ArchJSON",
    "primaryActors": ["Developer", "Architect"],
    "input": {
      "type": "TypeScript source files",
      "description": "*.ts files in the source directory",
      "example": "./src/**/*.ts"
    },
    "output": {
      "description": "ArchJSON structure with entities and relations",
      "formats": ["JSON"],
      "example": "architecture.json"
    }
  }
}
```

**Questions to Answer**:
- What does this module/system do? (purpose)
- Who uses it? (primaryActors)
- What does it take as input? (input)
- What does it produce? (output)

#### 3.2 Design Information (Recommended)

**Identify Design Patterns**:

Look for common patterns:
- **Creational**: Builder, Factory, Singleton
- **Structural**: Facade, Adapter, Proxy, Decorator
- **Behavioral**: Strategy, Observer, Template Method, Chain of Responsibility
- **Concurrency**: Parallel processing, Worker pools

```json
{
  "design": {
    "architectureStyle": "layered|event-driven|microkernel",
    "patterns": [
      {
        "name": "Strategy Pattern",
        "category": "behavioral",
        "participants": ["ClassExtractor", "MethodExtractor", "RelationExtractor"],
        "description": "不同类型的代码元素使用不同的提取策略"
      },
      {
        "name": "Facade Pattern",
        "category": "structural",
        "participants": ["TypeScriptParser"],
        "description": "简化解析流程的统一接口"
      }
    ],
    "principles": [
      "Single Responsibility - 每个类单一职责",
      "Dependency Inversion - 依赖抽象而非具体实现"
    ]
  }
}
```

**Pattern Recognition Tips**:

| Pattern | Code Signatures | Example |
|---------|-----------------|---------|
| **Strategy** | Interface + multiple implementations, `XxxStrategy` | `PaymentStrategy`, `CompressionStrategy` |
| **Builder** | `Builder` class, fluent API, `build()` method | `ConfigBuilder`, `RequestBuilder` |
| **Factory** | `create()`, `make()`, `XxxFactory` | `ParserFactory`, `ExtractorFactory` |
| **Facade** | Simplified interface to complex subsystem | `FileSystemFacade`, `ApiFacade` |
| **Observer** | `subscribe()`, `notify()`, event emitters | `EventEmitter`, `Observable` |
| **Singleton** | Private constructor, `getInstance()` | `ConfigManager`, `CacheManager` |

#### 3.3 Processing Information (Recommended)

**Map the Data Flow**:

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
        "description": "MermaidDiagramGenerator 生成并渲染图表"
      }
    ],
    "keyDependencies": ["ts-morph", "isomorphic-mermaid", "sharp", "zod"]
  }
}
```

**Questions to Answer**:
- What are the main processing stages?
- What is the data flow?
- What external dependencies are used?
- What patterns are used in each stage?

#### 3.4 Annotation Configuration (Optional)

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
      "TypeScriptParser"
    ],
    "annotateClasses": [
      {
        "className": "ConfigLoader",
        "note": "分步构建: 加载文件 → 合并 CLI 选项 → Zod 验证",
        "stereotypes": ["<<Builder>>"],
        "responsibility": "加载并验证配置文件"
      },
      {
        "className": "DiagramProcessor",
        "note": "处理链: Config → Discovery → Parse → Generate → Render",
        "stereotypes": ["<<Chain of Responsibility>>", "<<Core>>"],
        "responsibility": "协调整个图表处理流程"
      }
    ]
  }
}
```

---

## Complete Example

Here's a complete example for ArchGuard's CLI module:

```json
{
  "outputDir": "./archguard",
  "format": "mermaid",

  "metadata": {
    "title": "ArchGuard Key Architecture Diagrams",
    "description": "展示 ArchGuard TypeScript 架构分析工具的核心架构图",
    "system": "ArchGuard - TypeScript Architecture Diagram Generator",
    "author": "ArchGuard Team",
    "projectUrl": "https://github.com/anthropics/archguard"
  },

  "diagrams": [
    {
      "name": "1-cli-processing-flow",
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
          "example": "archguard analyze -s ./src --level class"
        },
        "output": {
          "description": "架构图文件",
          "formats": ["PNG", "SVG", "MMD"],
          "example": "archguard/overview/package.png"
        }
      },

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
          "Single Responsibility - 每个命令类单一职责",
          "Open/Closed - 通过命令扩展功能"
        ]
      },

      "process": {
        "stages": 5,
        "dataFlow": "CLI Command → Config → Files → ArchJSON → Mermaid → PNG/SVG",
        "stageList": [
          {
            "order": 1,
            "name": "命令解析",
            "namespace": "CLI",
            "description": "Commander 解析命令行参数和选项"
          },
          {
            "order": 2,
            "name": "配置加载",
            "namespace": "Configuration",
            "description": "ConfigLoader 使用 Builder Pattern 加载配置",
            "patterns": ["Builder Pattern"]
          },
          {
            "order": 3,
            "name": "文件发现",
            "namespace": "FileSystem",
            "description": "FileDiscoveryService 发现 TypeScript 源文件"
          },
          {
            "order": 4,
            "name": "解析处理",
            "namespace": "Parser",
            "description": "TypeScriptParser 解析源代码为 ArchJSON",
            "patterns": ["Facade Pattern", "Strategy Pattern"]
          },
          {
            "order": 5,
            "name": "图表生成",
            "namespace": "Generation",
            "description": "MermaidDiagramGenerator 生成并渲染图表"
          }
        ],
        "keyDependencies": ["commander", "zod", "fs-extra"]
      },

      "annotations": {
        "enableComments": true,
        "highlightPatterns": true,
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
            "note": "分步构建: 加载文件 → 合并 CLI 选项 → Zod 验证",
            "stereotypes": ["<<Builder>>"],
            "responsibility": "加载并验证配置文件"
          },
          {
            "className": "DiagramProcessor",
            "note": "处理链: Config → Discovery → Parse → Generate → Render",
            "stereotypes": ["<<Chain of Responsibility>>"],
            "responsibility": "协调整个图表处理流程"
          },
          {
            "className": "ProgressReporter",
            "note": "统一的进度报告接口",
            "stereotypes": ["<<Observer>>"],
            "responsibility": "报告处理进度和状态"
          }
        ]
      }
    }
  ]
}
```

---

## Quality Checklist

Before outputting the configuration, verify:

- [ ] All diagrams have meaningful `name` and `sources`
- [ ] Each diagram has appropriate `level` (package/class/method)
- [ ] `metadata.purpose` clearly explains what the system does
- [ ] `metadata.input` describes what goes into the system
- [ ] `metadata.output` describes what comes out
- [ ] `design.patterns` identifies actual patterns used in the code
- [ ] `process.stageList` has ordered stages with descriptions
- [ ] `classes.highlightClasses` lists the core classes (< 20 per diagram)
- [ ] JSON is valid and properly formatted

---

## Common Mistakes to Avoid

| Mistake | ❌ Wrong | ✅ Correct |
|---------|---------|-----------|
| **Too vague** | `"purpose": "This is a parser"` | `"purpose": "将 TypeScript 源代码解析为 ArchJSON 结构"` |
| **Missing I/O** | No `input`/`output` | Always include input/output descriptions |
| **Wrong pattern** | Guessing patterns | Verify by reading actual code |
| **Too many classes** | 50+ classes in diagram | Split into multiple diagrams (< 20 each) |
| **Generic stereotypes** | `<<class>>` | Use specific: `<<Builder>>`, `<<Strategy>>` |

---

## Usage in Claude Code

### Method 1: Direct Prompt

```
Read the config generation prompt from docs/prompts/config-generation-prompt.md,
then analyze the src/ directory and generate archguard.config.json
```

### Method 2: Include in System Prompt

Add the prompt content to Claude Code's system prompt for auto-generation.

---

## Version History

- **v2.1.0** (2026-01-28): Breaking change - metadata enhancement
  - Added `metadata` field (replaces simple `description`)
  - Added `design` field for patterns
  - Added `process` field for flow
  - Added `annotations` and `classes` for diagram control

- **v2.0.0** (2026-01-15): Initial version with unified DiagramConfig

---

**Document Location**: `docs/prompts/config-generation-prompt.md`
**Next Step**: Run `archguard analyze` to generate diagrams with this config
