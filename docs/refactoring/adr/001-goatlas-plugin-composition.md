# ADR-001: GoAtlasPlugin 使用组合模式

**状态**: 已采纳
**日期**: 2026-02-24
**上下文**: Go Architecture Atlas 实施计划 Phase 4
**决策者**: ArchGuard 架构团队
**修订**: v1.1 - 消除 bracket hack，使用 GoPlugin 公共 API

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

### GoPlugin 公共 API

为支持组合模式，`GoPlugin` 暴露一个公共方法：

```typescript
export class GoPlugin implements ILanguagePlugin {
  // 内部成员保持 private
  private treeSitter!: TreeSitterBridge;
  private matcher!: InterfaceMatcher;
  private mapper!: ArchJsonMapper;
  private goplsClient: GoplsClient | null = null;

  /**
   * 公共方法: 解析项目为原始数据
   * 供 GoAtlasPlugin 等组合使用者调用。
   */
  async parseToRawData(
    workspaceRoot: string,
    config: ParseConfig
  ): Promise<GoRawData> {
    // 提取自现有 parseProject() 的前半部分逻辑
    // 包括文件发现、Tree-sitter 解析、包合并
  }

  /**
   * 现有方法: 复用 parseToRawData()
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    const rawData = await this.parseToRawData(workspaceRoot, config);
    // ... 接口匹配 + ArchJSON 映射 ...
  }
}
```

### 架构设计

```typescript
/**
 * GoAtlasPlugin - Go Architecture Atlas 专用插件
 *
 * 通过组合 GoPlugin 实现基础解析功能，
 * 通过 BehaviorAnalyzer 实现 Atlas 生成功能。
 */
export class GoAtlasPlugin implements ILanguagePlugin, IGoAtlas {
  // ========== 组合组件 ==========
  private goPlugin: GoPlugin;
  private behaviorAnalyzer: BehaviorAnalyzer;
  private atlasRenderer: AtlasRenderer;
  private atlasMapper: AtlasMapper;

  // ========== 元数据 ==========
  readonly metadata: PluginMetadata = {
    name: 'golang-atlas',
    version: '5.0.0',
    displayName: 'Go Architecture Atlas',
    fileExtensions: ['.go'],
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: false,
      dependencyExtraction: true,
      typeInference: true,
    },
  };

  constructor() {
    this.goPlugin = new GoPlugin();
    this.behaviorAnalyzer = new BehaviorAnalyzer();
    this.atlasRenderer = new AtlasRenderer();
    this.atlasMapper = new AtlasMapper();
  }

  // ========== ILanguagePlugin 实现 ==========
  // 委托给 GoPlugin 处理标准解析

  async initialize(config: PluginInitConfig): Promise<void> {
    await this.goPlugin.initialize(config);
  }

  canHandle(targetPath: string): boolean {
    return this.goPlugin.canHandle(targetPath);
  }

  get dependencyExtractor() {
    return this.goPlugin.dependencyExtractor;
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

  // ========== IGoAtlas 实现 ==========

  async generateAtlas(
    rootPath: string,
    options: AtlasGenerationOptions
  ): Promise<GoArchitectureAtlas> {
    // 1. 通过 GoPlugin 公共 API 获取原始数据
    const rawData = await this.goPlugin.parseToRawData(rootPath, {});

    // 2. 如需函数体，使用增强解析
    let enrichedData = rawData;
    if (options.functionBodyStrategy && options.functionBodyStrategy !== 'none') {
      enrichedData = await this.enrichWithFunctionBodies(rawData, rootPath, options);
    }

    // 3. 并行构建四层架构图
    const [packageGraph, capabilityGraph, goroutineTopology, flowGraph] = await Promise.all([
      this.behaviorAnalyzer.buildPackageGraph(enrichedData),
      this.behaviorAnalyzer.buildCapabilityGraph(enrichedData),
      this.behaviorAnalyzer.buildGoroutineTopology(enrichedData, options),
      this.behaviorAnalyzer.buildFlowGraph(enrichedData, options),
    ]);

    return {
      version: '1.0',
      layers: { package: packageGraph, capability: capabilityGraph, goroutine: goroutineTopology, flow: flowGraph },
      metadata: this.buildAtlasMetadata(enrichedData, options, packageGraph, capabilityGraph, goroutineTopology, flowGraph),
    };
  }

  async renderLayer(
    atlas: GoArchitectureAtlas,
    layer: AtlasLayer,
    format: RenderFormat
  ): Promise<RenderResult> {
    return this.atlasRenderer.render(atlas, layer, format);
  }

  // ========== 内部方法 ==========

  private async parseProjectWithAtlas(
    workspaceRoot: string,
    config: ParseConfig & { atlas: AtlasConfig }
  ): Promise<ArchJSON> {
    // 1. 获取基础 ArchJSON
    const baseArchJSON = await this.goPlugin.parseProject(workspaceRoot, config);

    // 2. 生成 Atlas
    const atlas = await this.generateAtlas(workspaceRoot, {
      functionBodyStrategy: config.atlas.functionBodyStrategy,
      includeTests: config.atlas.includeTests ?? false,
      entryPointTypes: config.atlas.entryPointTypes,
      followIndirectCalls: config.atlas.followIndirectCalls ?? false,
    });

    // 3. 添加 Atlas 扩展
    return {
      ...baseArchJSON,
      extensions: {
        goAtlas: atlas,
      },
    };
  }

  async dispose(): Promise<void> {
    await this.goPlugin.dispose();
  }
}
```

### 关键设计决策

#### 1. 清晰的职责分离

| 组件 | 职责 | API |
|------|------|-----|
| `GoPlugin` | 基础 Go 代码解析 | `parseProject()`, `parseToRawData()` |
| `BehaviorAnalyzer` | 四层架构图构建 | `buildPackageGraph()`, `buildCapabilityGraph()`, ... |
| `AtlasRenderer` | Atlas 渲染和导出 | `render()` |
| `AtlasMapper` | Atlas → ArchJSON 映射 | `toArchJSON()` |
| `GoAtlasPlugin` | 协调者和统一入口 | 实现 `ILanguagePlugin` + `IGoAtlas` |

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

  it('should expose raw data via parseToRawData()', () => {
    const plugin = new GoPlugin();
    const rawData = await plugin.parseToRawData('/path', {});
    expect(rawData.packages).toBeDefined();
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

- **封装性**: `GoPlugin` 内部成员保持 `private`，通过公共 `parseToRawData()` API 暴露数据
- **独立测试**: 每个组件可以独立测试和演进
- **清晰职责**: 基础解析 vs Atlas 生成职责分离
- **灵活组合**: 未来可以轻松替换任何组件
- **无 hack**: 不使用 `this.goPlugin['treeSitter']` 等 bracket notation 访问私有成员

### 负面影响

- **委托样板代码**: 需要转发一些方法（如 `canHandle()`、`dependencyExtractor`）
- **配置复杂性**: 需要管理嵌套配置对象
- **初始化协调**: 需要协调多个组件的初始化

### 缓解措施

1. **委托样板代码**: 委托方法数量有限（3-5 个），手动转发即可
2. **配置复杂性**: 提供配置构建器
3. **初始化协调**: 使用工厂模式
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
- [Proposal 16: Go Architecture Atlas v5.0](../proposals/16-go-architecture-atlas.md)

---

**文档版本**: 1.1
**最后更新**: 2026-02-24
**状态**: 已采纳 - 待实施
**变更记录**:
- v1.1: 消除 `this.goPlugin['treeSitter']` bracket hack，改为使用 `GoPlugin.parseToRawData()` 公共 API；移除 `FunctionBodyExtractor` 独立组件（函数体提取集成到 TreeSitterBridge 统一 API 中）；更新版本号至 5.0.0；返回值类型对齐 ADR-002 `GoAtlasExtension`
