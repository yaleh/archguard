# ADR-001: GoAtlasPlugin 使用组合模式

**状态**: 已采纳
**日期**: 2026-02-24
**上下文**: Go Architecture Atlas 实施计划 Phase 4
**决策者**: ArchGuard 架构团队

---

## 上下文

在实现 Go Architecture Atlas 时，需要扩展现有 `GoPlugin` 的功能以支持：
1. 四层架构图生成（Package、Capability、Goroutine、Flow）
2. 函数体提取（用于行为分析）
3. Atlas 特定的渲染和导出功能

初步考虑使用**继承**（让 `GoAtlasPlugin` 继承 `GoPlugin`），但这会带来以下问题：

### 问题 1: 破坏封装性
```typescript
// 继承方案需要将 private 改为 protected
class GoPlugin {
  protected treeSitter!: TreeSitterBridge;
  protected matcher!: InterfaceMatcher;
  protected mapper!: ArchJsonMapper;
  protected goplsClient: GoplsClient | null = null;
}

// GoAtlasPlugin 直接访问内部实现
class GoAtlasPlugin extends GoPlugin {
  async generateAtlas() {
    const structs = this.treeSitter... // 紧耦合
    const impls = this.matcher...     // 依赖内部实现
  }
}
```

### 问题 2: 脆弱基类
- `GoPlugin` 的任何私有方法重构都会破坏 `GoAtlasPlugin`
- 基类和子类职责不清（解析 vs 生成）

### 问题 3: 违反单一职责原则
- `GoPlugin` 应该专注于"解析 Go 代码"
- `GoAtlasPlugin` 应该专注于"生成架构可视化"
- 继承会导致职责混淆

---

## 决策

**使用组合模式**：`GoAtlasPlugin` 包含 `GoPlugin` 实例，而不是继承它。

### 架构设计

```typescript
/**
 * GoAtlasPlugin - Go Architecture Atlas 专用插件
 *
 * 通过组合 GoPlugin 实现基础解析功能，
 * 通过 BehaviorAnalyzer 实现 Atlas 生成功能。
 */
export class GoAtlasPlugin implements ILanguagePlugin {
  // ========== 组合组件 ==========
  private goPlugin: GoPlugin;
  private behaviorAnalyzer: BehaviorAnalyzer;
  private atlasRenderer: AtlasRenderer;
  private functionBodyExtractor: FunctionBodyExtractor;

  // ========== 元数据 ==========
  readonly metadata: PluginMetadata = {
    name: 'golang-atlas',
    version: '2.0.0',
    displayName: 'Go Architecture Atlas',
    fileExtensions: ['.go'],
    // 扩展能力
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: false,
      dependencyExtraction: true,
      typeInference: true,
      atlasGeneration: true,  // 新增能力
    },
  };

  constructor() {
    this.goPlugin = new GoPlugin();
    this.behaviorAnalyzer = new BehaviorAnalyzer();
    this.atlasRenderer = new AtlasRenderer();
    this.functionBodyExtractor = new FunctionBodyExtractor();
  }

  // ========== ILanguagePlugin 实现 ==========
  // 委托给 GoPlugin 处理标准解析

  async initialize(config: PluginInitConfig): Promise<void> {
    // 初始化基础 Go plugin
    await this.goPlugin.initialize(config);

    // 初始化 Atlas 特定组件
    await this.functionBodyExtractor.initialize(config);
  }

  async parseProject(
    workspaceRoot: string,
    config: ParseConfig & { atlas?: AtlasConfig }
  ): Promise<ArchJSON> {
    // 如果未启用 Atlas，委托给 GoPlugin
    if (!config.atlas?.enabled) {
      return this.goPlugin.parseProject(workspaceRoot, config);
    }

    // 启用 Atlas 时，执行增强分析
    return this.parseProjectWithAtlas(workspaceRoot, config);
  }

  // ========== Atlas 特定 API ==========

  /**
   * 生成完整的 Go Architecture Atlas
   */
  async generateAtlas(
    rootPath: string,
    options: AtlasGenerationOptions
  ): Promise<GoArchitectureAtlas> {
    // 1. 获取原始数据（使用增强的 TreeSitter）
    const rawData = await this.extractRawDataWithOptions(rootPath, options);

    // 2. 构建四层架构图
    const packageGraph = await this.behaviorAnalyzer.buildPackageGraph(rawData);
    const capabilityGraph = await this.behaviorAnalyzer.buildCapabilityGraph(rawData);
    const goroutineTopology = await this.behaviorAnalyzer.buildGoroutineTopology(rawData, options);
    const flowGraph = await this.behaviorAnalyzer.buildFlowGraph(rawData, options);

    return {
      packageGraph,
      capabilityGraph,
      goroutineTopology,
      flowGraph,
      metadata: {
        generatedAt: new Date().toISOString(),
        functionBodyStrategy: options.functionBodyStrategy,
        sourceProject: rootPath,
      },
    };
  }

  /**
   * 渲染单个 Atlas 图层
   */
  async renderLayer(
    atlas: GoArchitectureAtlas,
    layer: AtlasLayer,
    format: RenderFormat
  ): Promise<RenderResult> {
    return this.atlasRenderer.renderLayer(atlas, layer, format);
  }

  // ========== 内部方法 ==========

  private async parseProjectWithAtlas(
    workspaceRoot: string,
    config: ParseConfig & { atlas: AtlasConfig }
  ): Promise<ArchJSON> {
    // 1. 生成 Atlas
    const atlas = await this.generateAtlas(workspaceRoot, {
      functionBodyStrategy: config.atlas.functionBodyStrategy,
      includeTests: config.atlas.includeTests ?? false,
      entryPointTypes: config.atlas.entryPointTypes,
      followIndirectCalls: config.atlas.followIndirectCalls ?? false,
    });

    // 2. 转换为 ArchJSON（保留原始 entities/relations）
    const baseArchJSON = await this.goPlugin.parseProject(workspaceRoot, config);

    // 3. 添加 Atlas 扩展
    return {
      ...baseArchJSON,
      extensions: {
        goAtlas: atlas,
      },
    };
  }

  private async extractRawDataWithOptions(
    rootPath: string,
    options: AtlasGenerationOptions
  ): Promise<GoRawData[]> {
    // 使用带函数体提取的 TreeSitter
    const files = await this.findGoFiles(rootPath);

    const packages = new Map<string, GoRawPackage>();

    for (const file of files) {
      const code = await fs.readFile(file, 'utf-8');

      // 根据策略选择解析方式
      let pkg: GoRawPackage;
      if (options.functionBodyStrategy === 'none') {
        pkg = this.goPlugin['treeSitter'].parseCode(code, file);
      } else {
        pkg = await this.functionBodyExtractor.parseCodeWithBodies(code, file, {
          strategy: options.functionBodyStrategy,
          selectivePatterns: options.selectiveExtraction,
        });
      }

      // 合并到 packages
      // ...
    }

    return Array.from(packages.values());
  }

  async dispose(): Promise<void> {
    await this.goPlugin.dispose();
    await this.functionBodyExtractor.dispose();
  }
}
```

### 关键设计决策

#### 1. 清晰的职责分离

| 组件 | 职责 | API |
|------|------|-----|
| `GoPlugin` | 基础 Go 代码解析 | `parseProject()`, `parseCode()` |
| `FunctionBodyExtractor` | 函数体提取（Atlas 特定） | `parseCodeWithBodies()` |
| `BehaviorAnalyzer` | 四层架构图构建 | `buildPackageGraph()`, `buildCapabilityGraph()`, ... |
| `AtlasRenderer` | Atlas 渲染和导出 | `renderLayer()` |
| `GoAtlasPlugin` | 协调者和统一入口 | 实现 `ILanguagePlugin` |

#### 2. 配置驱动的行为

```typescript
interface ParseConfig {
  // 标准配置
  filePattern?: string;
  exclude?: string[];

  // Atlas 扩展配置
  atlas?: {
    enabled: boolean;
    functionBodyStrategy: 'none' | 'selective' | 'full';
    layers?: AtlasLayer[];
    includeTests?: boolean;
    entryPointTypes?: EntryPointType[];
    followIndirectCalls?: boolean;
  };
}
```

**使用示例**：
```typescript
// 标准 Go 解析（无 Atlas）
const archJSON = await plugin.parseProject('/path/to/go/project', {
  filePattern: '**/*.go',
});

// 启用 Atlas
const atlasArchJSON = await plugin.parseProject('/path/to/go/project', {
  filePattern: '**/*.go',
  atlas: {
    enabled: true,
    functionBodyStrategy: 'selective',
    layers: ['package', 'capability'],
  },
});
```

#### 3. 独立的测试策略

```typescript
// 测试 GoPlugin（不受 Atlas 影响）
describe('GoPlugin', () => {
  it('should parse Go code', () => {
    const plugin = new GoPlugin();
    // 测试基础功能...
  });
});

// 测试 FunctionBodyExtractor（独立单元）
describe('FunctionBodyExtractor', () => {
  it('should extract function bodies with selective strategy', () => {
    const extractor = new FunctionBodyExtractor();
    // 测试函数体提取...
  });
});

// 测试 BehaviorAnalyzer（使用 mock 数据）
describe('BehaviorAnalyzer', () => {
  it('should build package graph', () => {
    const analyzer = new BehaviorAnalyzer();
    const mockData = createMockGoRawData();
    // 测试图构建...
  });
});

// 集成测试 GoAtlasPlugin
describe('GoAtlasPlugin', () => {
  it('should generate complete atlas', () => {
    const plugin = new GoAtlasPlugin();
    // 端到端测试...
  });
});
```

---

## 后果

### 正面影响

✅ **封装性**: `GoPlugin` 保持私有实现，不受 Atlas 影响
✅ **独立测试**: 每个组件可以独立测试和演进
✅ **清晰职责**: 基础解析 vs Atlas 生成职责分离
✅ **灵活组合**: 未来可以轻松替换任何组件
✅ **向后兼容**: `GoPlugin` 不受任何修改

### 负面影响

❌ **代码重复**: 需要转发一些方法（如 `canHandle()`）
```typescript
class GoAtlasPlugin {
  canHandle(targetPath: string): boolean {
    return this.goPlugin.canHandle(targetPath);
  }
}
```

❌ **配置复杂性**: 需要管理嵌套配置对象
❌ **初始化复杂度**: 需要初始化多个组件

### 缓解措施

1. **代码重复**: 使用代理模式减少样板代码
   ```typescript
   // 使用 Proxy 自动转发
   const delegatedMethods = ['canHandle', 'dependencyExtractor'];
   delegatedMethods.forEach(method => {
     this[method] = this.goPlugin[method].bind(this.goPlugin);
   });
   ```

2. **配置复杂性**: 提供配置构建器
   ```typescript
   const config = AtlasConfig.builder()
     .enableAtlas()
     .withSelectiveExtraction()
     .includeLayers(['package', 'capability'])
     .build();
   ```

3. **初始化复杂度**: 使用工厂模式
   ```typescript
   class GoAtlasPlugin {
     static async create(config: PluginInitConfig): Promise<GoAtlasPlugin> {
       const plugin = new GoAtlasPlugin();
       await plugin.initialize(config);
       return plugin;
     }
   }
   ```

---

## 替代方案

### 方案 A: 继承 + Protected 成员（已拒绝）

**问题**: 破坏封装性，脆弱基类

### 方案 B: 抽象基类 AbstractGoPlugin（已拒绝）

**问题**:
```typescript
abstract class AbstractGoPlugin {
  protected abstract parseRawProject(): Promise<GoRawData[]>;
}

class GoPlugin extends AbstractGoPlugin { /* ... */ }
class GoAtlasPlugin extends AbstractGoPlugin { /* ... */ }
```

- 引入不必要的抽象层
- `GoPlugin` 和 `GoAtlasPlugin` 共享代码不多
- 仍然有继承的缺点

### 方案 C: 完全独立的插件（已拒绝）

**问题**:
```typescript
// 两个完全不相关的插件
class GoPlugin implements ILanguagePlugin { /* ... */ }
class GoAtlasPlugin implements ILanguagePlugin { /* ... */ }
```

- 代码重复（都需要 TreeSitter、gopls）
- 用户困惑（应该用哪个？）
- 无法共享基础解析逻辑

---

## 相关决策

- [ADR-002: ArchJSON extensions 设计](./002-archjson-extensions.md)
- [Proposal 16: Go Architecture Atlas v4.0](../proposals/16-go-architecture-atlas.md)

---

## 实施计划

### Phase 4.1: 创建组合架构骨架
- [ ] 创建 `GoAtlasPlugin` 类框架
- [ ] 实现组合组件初始化
- [ ] 实现方法转发（`canHandle`, `dependencyExtractor`）

### Phase 4.2: 实现 Atlas 特定 API
- [ ] 实现 `generateAtlas()` 方法
- [ ] 实现 `renderLayer()` 方法
- [ ] 实现 `parseProjectWithAtlas()` 方法

### Phase 4.3: 集成测试
- [ ] 端到端测试
- [ ] 性能基准测试
- [ ] 向后兼容性验证

---

**文档版本**: 1.0
**最后更新**: 2026-02-24
**状态**: 已采纳 - 待实施
