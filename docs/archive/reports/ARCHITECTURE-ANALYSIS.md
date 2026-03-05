# ArchGuard 关键架构分析

## 架构图概览

本文档分析 ArchGuard 项目的核心架构，识别关键设计模式，并说明每个架构图的用途。

---

## 1. Parser Architecture (解析器架构)

**文件**: `archguard/key-architectures/1-parser-architecture.png`

### 核心类 (12 个)
- `TypeScriptParser` - 主解析器
- `ParallelParser` - 并行解析器
- `ClassExtractor` - 类提取器
- `InterfaceExtractor` - 接口提取器
- `EnumExtractor` - 枚举提取器
- `RelationExtractor` - 关系提取器
- `ArchJSONAggregator` - ArchJSON 聚合器

### 设计模式

#### 1.1 Strategy Pattern (策略模式)
**上下文**: 不同类型的实体提取

**实现**:
```
TypeScriptParser
  ├── ClassExtractor (策略1)
  ├── InterfaceExtractor (策略2)
  ├── EnumExtractor (策略3)
  └── RelationExtractor (策略4)
```

**代码示例**:
```typescript
// TypeScriptParser 使用多个提取器策略
private readonly classExtractor: ClassExtractor;
private readonly interfaceExtractor: InterfaceExtractor;
private readonly enumExtractor: EnumExtractor;
private readonly relationExtractor: RelationExtractor;

// 根据类型选择不同策略
for (const entity of archJson.entities) {
  if (entity.type === 'class') {
    this.classExtractor.extract(code);
  } else if (entity.type === 'interface') {
    this.interfaceExtractor.extract(code);
  }
}
```

**好处**:
- ✅ 每种提取器独立实现
- ✅ 易于添加新的实体类型
- ✅ 符合开闭原则

#### 1.2 Facade Pattern (外观模式)
**TypeScriptParser** 作为外观，简化复杂的解析流程

**实现**:
```typescript
class TypeScriptParser {
  parseCode(code: string, filePath?: string): ArchJSON {
    // 1. 创建 SourceFile
    // 2. 调用多个 Extractor
    // 3. 聚合结果
    // 4. 返回 ArchJSON
  }
}
```

**好处**:
- ✅ 隐藏内部复杂性
- ✅ 提供简单的 API
- ✅ 解耦客户端与内部实现

#### 1.3 Parallel Processing Pattern
**ParallelParser** 使用 EventEmitter 实现并行处理

**实现**:
```typescript
class ParallelParser extends EventEmitter {
  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    // 并发解析多个文件
    const promises = filePaths.map(file => this.parseFile(file));
    const results = await Promise.all(promises);
    
    // 发出进度事件
    this.emit('progress', { completed, total });
  }
}
```

**好处**:
- ✅ 提高解析速度
- ✅ 非阻塞进度报告
- ✅ 可配置并发数

### 关键流程

```
TypeScript Source Code
        ↓
  TypeScriptParser.parseCode()
        ↓
  ┌─────────────────────┐
  │  Multiple Extractors │
  │  (Strategy Pattern)  │
  └─────────────────────┘
        ↓
   ArchJSONAggregator
        ↓
     ArchJSON
```

### 关系说明

- **Composition**: TypeScriptParser *-- ClassExtractor
- **Inheritance**: ParallelParser <|-- EventEmitter
- **Dependency**: Extractor --> ts-morph

---

## 2. Mermaid Generation Flow (Mermaid 生成流程)

**文件**: `archguard/key-architectures/2-mermaid-generation-flow.png`

### 核心类 (39 个)
- `MermaidDiagramGenerator` - 主生成器
- `ValidatedMermaidGenerator` - 带验证的生成器
- `IsomorphicMermaidRenderer` - 渲染器
- `MermaidValidationPipeline` - 验证管道
- `HeuristicGrouper` - 启发式分组器
- `LLMGrouper` - LLM 分组器
- `MermaidAutoRepair` - 自动修复
- 各个 Validator

### 设计模式

#### 2.1 Pipeline Pattern (管道模式)
**上下文**: 多阶段验证流程

**实现**:
```
ArchJSON
   ↓
MermaidCodeGenerator
   ↓
  [Validation Pipeline]
   ├─→ ParseValidator (阶段1)
   ├─→ StructuralValidator (阶段2)
   ├─→ RenderValidator (阶段3)
   └─→ QualityValidator (阶段4)
   ↓
Validated Mermaid Code
   ↓
Renderer
   ↓
PNG/SVG
```

**代码示例**:
```typescript
class MermaidValidationPipeline {
  async validate(mermaidCode: string, archJson: ArchJSON) {
    // 阶段1: 解析验证
    const parseResult = await this.parseValidator.validate(mermaidCode);
    
    // 阶段2: 结构验证
    const structResult = this.structuralValidator.validate(mermaidCode, archJson);
    
    // 阶段3: 渲染验证
    const renderResult = await this.renderValidator.validate(mermaidCode);
    
    // 阶段4: 质量验证
    const qualityResult = this.qualityValidator.validate(mermaidCode, archJson);
    
    return { parse: parseResult, structural: structResult, ... };
  }
}
```

**好处**:
- ✅ 每个阶段独立
- ✅ 易于添加新的验证阶段
- ✅ 可以短路失败（早期失败原则）
- ✅ 每个阶段可以有不同的验证策略

#### 2.2 Strategy Pattern (策略模式) - Grouping
**上下文**: 不同的实体分组策略

**实现**:
```
Grouper (接口/抽象)
  ├── HeuristicGrouper (策略1: 基于启发式规则)
  └── LLMGrouper (策略2: 基于 LLM 分析)
```

**代码示例**:
```typescript
// 策略接口
interface GrouperStrategy {
  group(archJson: ArchJSON): GroupingDecision;
}

// 具体策略1
class HeuristicGrouper {
  group(archJson: ArchJSON): GroupingDecision {
    // 基于文件路径分组
    const packages = this.groupByPath(archJson.entities);
    return { packages, layout: this.generateLayout(packages) };
  }
}

// 具体策略2
class LLMGrouper {
  async group(archJson: ArchJSON): Promise<GroupingDecision> {
    // 使用 LLM 分析实体关系
    const prompt = this.buildPrompt(archJson);
    const response = await this.llm.callCLI(prompt);
    return JSON.parse(response);
  }
}

// 上下文
class MermaidDiagramGenerator {
  async generate(archJson: ArchJSON) {
    let grouping: GroupingDecision;
    
    if (this.config.enableLLMGrouping) {
      const grouper = new LLMGrouper(this.config);
      grouping = await grouper.group(archJson);
    } else {
      const grouper = new HeuristicGrouper();
      grouping = grouper.group(archJson);
    }
    
    // 使用 grouping 生成图表
  }
}
```

**好处**:
- ✅ 运行时选择策略
- ✅ 易于添加新的分组策略
- ✅ 策略可独立测试

#### 2.3 Template Method Pattern (模板方法模式)
**上下文**: Mermaid 生成器的抽象流程

**实现**:
```typescript
class ValidatedMermaidGenerator {
  generate(): string {
    // 模板方法定义算法骨架
    this.validateBeforeGenerate();  // 钩子1
    
    let code: string;
    switch (this.options.level) {
      case 'package': code = this.generatePackageLevel(); break;
      case 'class': code = this.generateClassLevel(); break;
      case 'method': code = this.generateMethodLevel(); break;
    }
    
    return this.postProcess(code);  // 钩子2
  }
  
  // 子类可以重写的钩子方法
  protected validateBeforeGenerate(): void { /* 默认实现 */ }
  protected postProcess(code: string): string { return code.trim(); }
}
```

**好处**:
- ✅ 定义算法骨架
- ✅ 子类可重写部分步骤
- ✅ 避免代码重复

### 关键流程

```
     ArchJSON
        ↓
  ┌──────────────────┐
  │ Decision Layer   │
  │  (Grouping)      │
  │ - Heuristic      │
  │ - LLM            │
  └──────────────────┘
        ↓
  ┌──────────────────┐
  │ Generation Layer │
  │  (Level-based)   │
  │ - Package        │
  │ - Class          │
  │ - Method         │
  └──────────────────┘
        ↓
  ┌──────────────────┐
  │ Validation Layer │
  │  (Pipeline)      │
  │ - Parse          │
  │ - Structural     │
  │ - Render         │
  │ - Quality        │
  └──────────────────┘
        ↓
  ┌──────────────────┐
  │ Rendering Layer  │
  │  (Isomorphic)    │
  └──────────────────┘
        ↓
     PNG/SVG
```

### 自动修复机制

```typescript
class MermaidAutoRepair {
  async repair(mermaidCode: string, errors: ValidationError[]): Promise<string> {
    // 1. 分析错误
    // 2. 应用修复策略
    // 3. 验证修复结果
    // 4. 返回修复后的代码
  }
}
```

---

## 3. CLI Processing Flow (CLI 处理流程)

**文件**: `archguard/key-architectures/3-cli-processing-flow.png`

### 核心类 (29 个)
- `ConfigLoader` - 配置加载器
- `DiagramProcessor` - 图处理器
- `FileDiscoveryService` - 文件发现服务
- `OutputPathResolver` - 输出路径解析器
- `DiagramIndexGenerator` - 索引生成器
- `CacheManager` - 缓存管理器
- `ProgressReporter` - 进度报告器
- `ErrorHandler` - 错误处理器

### 设计模式

#### 3.1 Chain of Responsibility (责任链模式)
**上下文**: 命令处理流程

**实现**:
```
CLI Command
   ↓
ConfigLoader (链节点1)
   ↓
FileDiscoveryService (链节点2)
   ↓
DiagramProcessor (链节点3)
   ├─→ Parse files
   ├─→ Generate diagrams
   ├─→ Render images
   └─→ Generate index
   ↓
Completion
```

**代码示例**:
```typescript
class DiagramProcessor {
  async processAll(): Promise<DigramResult[]> {
    const results: DiagramResult[] = [];
    
    for (const diagramConfig of this.diagrams) {
      // 责任链: 每个处理器可以决定是否继续
      try {
        const archJson = await this.parseSources(diagramConfig);
        const mermaidCode = await this.generateDiagram(archJson);
        const rendered = await this.renderDiagram(mermaidCode);
        
        results.push({ name: diagramConfig.name, success: true });
      } catch (error) {
        results.push({ name: diagramConfig.name, success: false, error });
        if (this.config.continueOnError) {
          continue;  // 继续处理下一个
        } else {
          break;  // 停止链
        }
      }
    }
    
    return results;
  }
}
```

**好处**:
- ✅ 解耦发送者和接收者
- ✅ 动态添加/删除处理步骤
- ✅ 灵活的错误处理策略

#### 3.2 Observer Pattern (观察者模式)
**上下文**: 进度报告

**实现**:
```typescript
class ProgressReporter extends EventEmitter {
  start(message: string): void {
    this.emit('stage:start', { stage: message, status: 'in-progress' });
  }
  
  update(completed: number, total: number): void {
    this.emit('progress:update', { completed, total, percentage });
  }
  
  succeed(message: string): void {
    this.emit('stage:complete', { stage: message, status: 'success' });
  }
  
  fail(message: string): void {
    this.emit('stage:complete', { stage: message, status: 'failed' });
  }
}

// 使用
const progress = new ProgressReporter();
progress.on('progress:update', (data) => {
  console.log(`Progress: ${data.percentage}%`);
});
```

**好处**:
- ✅ 松耦合
- ✅ 支持多个监听器
- ✅ 实时反馈

#### 3.3 Builder Pattern (构建器模式)
**上下文**: 配置加载

**实现**:
```typescript
class ConfigLoader {
  async load(cliOptions?: CliOptions, configPath?: string): Promise<GlobalConfig> {
    // 1. 加载配置文件
    const fileConfig = await this.loadConfigFile(configPath);
    
    // 2. 合并 CLI 选项
    const merged = this.mergeOptions(fileConfig, cliOptions);
    
    // 3. 验证配置
    const validated = this.validateConfig(merged);
    
    // 4. 应用默认值
    const withDefaults = this.applyDefaults(validated);
    
    return withDefaults;
  }
  
  private async loadConfigFile(path?: string): Promise<FileConfig> {
    // 构建配置的步骤
  }
  
  private validateConfig(config: any): GlobalConfig {
    // Zod schema validation
    return GlobalConfigSchema.parse(config);
  }
}
```

**好处**:
- ✅ 分步构建复杂对象
- ✅ 验证与构建分离
- ✅ 支持多种配置源

### 关键流程

```
   User Command
        ↓
  ┌──────────────┐
  │ ConfigLoader │
  │ (Builder)    │
  └──────────────┘
        ↓
  ┌──────────────────────┐
  │ FileDiscoveryService │
  └──────────────────────┘
        ↓
  ┌──────────────────────┐
  │ DiagramProcessor     │
  │ (Chain of Resp.)     │
  │  ├─ Parse            │
  │  ├─ Generate         │
  │  ├─ Render           │
  │  └─ Index            │
  └──────────────────────┘
        ↓
     Output Files
```

---

## 4. Core Types (核心类型定义)

**文件**: `archguard/key-architectures/4-core-types.png`

### 核心类 (12 个)
- `ArchJSON` - 架构数据模型
- `Entity` - 实体类型
- `Member` - 成员类型
- `Relation` - 关系类型
- `GroupingDecision` - 分组决策
- `GlobalConfig` - 全局配置
- `MermaidConfig` - Mermaid 配置
- 各种 Validator Result 类型

### 设计模式

#### 4.1 Data Transfer Object (DTO) Pattern
**上下文**: 跨层数据传输

**实现**:
```typescript
// ArchJSON 作为 DTO
interface ArchJSON {
  version: string;
  language: 'typescript';
  timestamp: string;
  sourceFiles: string[];
  entities: Entity[];
  relations: Relation[];
}

// Entity 作为 DTO
interface Entity {
  id: string;
  name: string;
  type: EntityType;
  members: Member[];
  sourceLocation: SourceLocation;
}
```

**好处**:
- ✅ 标准化数据格式
- ✅ 类型安全
- ✅ 易于序列化/反序列化

#### 4.2 Specification Pattern (规约模式)
**上下文**: 配置验证

**实现**:
```typescript
// Zod schema 作为规约
const GlobalConfigSchema = z.object({
  outputDir: z.string().default('./archguard'),
  format: z.enum(['mermaid', 'json']).default('mermaid'),
  mermaid: MermaidConfigSchema.optional(),
  exclude: z.array(z.string()).default([...]),
});

// 使用规约验证
class ConfigLoader {
  load(config: any): GlobalConfig {
    return GlobalConfigSchema.parse(config);  // 应用规约
  }
}
```

**好处**:
- ✅ 声明式验证
- ✅ 可复用
- ✅ 类型推导

### 类型层次结构

```
    ArchJSON (根 DTO)
        │
        ├── Entity[] (实体集合)
        │       ├── ClassEntity
        │       ├── InterfaceEntity
        │       └── EnumEntity
        │
        ├── Relation[] (关系集合)
        │       ├── InheritanceRelation
        │       ├── ImplementationRelation
        │       ├── CompositionRelation
        │       └── DependencyRelation
        │
        └── Metadata
                ├── version
                ├── language
                └── timestamp
```

---

## 设计模式总结

### 已识别的设计模式

| 模式 | 位置 | 描述 |
|------|------|------|
| **Strategy Pattern** | Parser Layer | ClassExtractor, InterfaceExtractor, EnumExtractor |
| **Strategy Pattern** | Mermaid Layer | HeuristicGrouper, LLMGrouper |
| **Facade Pattern** | Parser Layer | TypeScriptParser 简化解析流程 |
| **Pipeline Pattern** | Mermaid Layer | 多阶段验证管道 |
| **Template Method** | Mermaid Layer | ValidatedMermaidGenerator 生成流程 |
| **Chain of Responsibility** | CLI Layer | 命令处理链 |
| **Observer Pattern** | CLI Layer | ProgressReporter 事件系统 |
| **Builder Pattern** | CLI Layer | ConfigLoader 配置构建 |
| **Parallel Processing** | Parser Layer | ParallelParser 并发解析 |
| **DTO Pattern** | Types Layer | ArchJSON 数据传输对象 |
| **Specification Pattern** | CLI Layer | Zod schema 配置验证 |

### 架构原则

#### 1. 单一职责原则 (SRP)
- `ClassExtractor` 只负责类提取
- `MermaidParseValidator` 只负责解析验证
- `ConfigLoader` 只负责配置加载

#### 2. 开闭原则 (OCP)
- 可添加新的 Extractor 而不修改现有代码
- 可添加新的 Validator 而不修改管道
- 可添加新的 Grouper 策略

#### 3. 依赖倒置原则 (DIP)
- `DiagramProcessor` 依赖 `Grouper` 接口而非具体实现
- `ValidationPipeline` 依赖 `Validator` 接口

#### 4. 接口隔离原则 (ISP)
- `Extractor` 接口只定义提取方法
- `Validator` 接口只定义验证方法

---

## 架构图使用指南

### 1. Parser Architecture
**何时查看**:
- 理解如何解析 TypeScript 代码
- 添加新的实体类型支持
- 优化解析性能

**关键类**:
- `TypeScriptParser` - 入口点
- `ParallelParser` - 性能优化
- 各个 Extractor - 策略实现

### 2. Mermaid Generation Flow
**何时查看**:
- 理解图表生成流程
- 添加新的验证阶段
- 自定义分组策略

**关键类**:
- `MermaidDiagramGenerator` - 协调者
- `MermaidValidationPipeline` - 质量保证
- `HeuristicGrouper` / `LLMGrouper` - 分组策略

### 3. CLI Processing Flow
**何时查看**:
- 理解命令执行流程
- 添加新的命令
- 自定义错误处理

**关键类**:
- `DiagramProcessor` - 主流程
- `ConfigLoader` - 配置管理
- `ProgressReporter` - 用户反馈

### 4. Core Types
**何时查看**:
- 理解数据模型
- 添加新的配置选项
- 扩展 ArchJSON 格式

**关键类型**:
- `ArchJSON` - 核心数据结构
- `GlobalConfig` - 配置模型
- `Entity` / `Relation` - 架构元素

---

## 扩展指南

### 如何添加新的 Extractor

```typescript
// 1. 创建新的 Extractor 类
class TypeAliasExtractor {
  extract(code: string, filePath?: string): Entity {
    // 实现提取逻辑
  }
}

// 2. 在 TypeScriptParser 中注册
class TypeScriptParser {
  private readonly typeAliasExtractor: TypeAliasExtractor;
  
  constructor() {
    this.typeAliasExtractor = new TypeAliasExtractor();
  }
  
  parseCode(code: string): ArchJSON {
    // 使用新的 extractor
    const typeAlias = this.typeAliasExtractor.extract(code);
    // ...
  }
}
```

### 如何添加新的 Validator

```typescript
// 1. 创建新的 Validator 类
class SecurityValidator {
  validate(mermaidCode: string): ValidationResult {
    // 检查安全问题
    if (mermaidCode.includes('<script>')) {
      return { valid: false, errors: ['Potential XSS'] };
    }
    return { valid: true };
  }
}

// 2. 添加到 ValidationPipeline
class MermaidValidationPipeline {
  private readonly securityValidator: SecurityValidator;
  
  async validate(mermaidCode: string) {
    // 现有验证...
    const securityResult = this.securityValidator.validate(mermaidCode);
    
    return { 
      parse: parseResult,
      structural: structResult,
      security: securityResult,  // 新增
      quality: qualityResult
    };
  }
}
```

### 如何添加新的 Grouper 策略

```typescript
// 1. 实现新的 Grouper
class SemanticGrouper {
  group(archJson: ArchJSON): GroupingDecision {
    // 基于语义相似性分组
    const packages = this.groupBySemantics(archJson.entities);
    return { packages, layout: this.generateLayout(packages) };
  }
}

// 2. 在配置中添加选项
const config = {
  mermaid: {
    groupingStrategy: 'semantic'  // 新选项
  }
};

// 3. 在 DiagramProcessor 中使用
class MermaidDiagramGenerator {
  async generate(archJson: ArchJSON) {
    const grouper = this.createGrouper(this.config.groupingStrategy);
    const grouping = await grouper.group(archJson);
    // ...
  }
  
  private createGrouper(strategy: string): Grouper {
    switch (strategy) {
      case 'heuristic': return new HeuristicGrouper();
      case 'llm': return new LLMGrouper(this.config);
      case 'semantic': return new SemanticGrouper();  // 新增
    }
  }
}
```

---

## 总结

ArchGuard 项目展示了优秀的架构设计：

1. **清晰的分层**: Parser → Generation → CLI
2. **丰富的模式**: 11+ 种设计模式的正确应用
3. **高内聚低耦合**: 每个模块职责单一
4. **可扩展性**: 易于添加新功能
5. **可测试性**: 策略模式便于单元测试
6. **性能优化**: 并行处理提高效率

这些架构图帮助开发者快速理解项目结构，识别设计模式，并进行有效的扩展和维护。
