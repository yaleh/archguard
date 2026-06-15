# ADR-001: GoPlugin 直接实现 IGoAtlas，GoAtlasCoordinator 承担协调职责

> **注意**: 本文档反映截至 2026-06 的实际实现。原始设计（v1.2）规划了独立的 `GoAtlasPlugin` 组合类；实际实现中 `GoPlugin` 直接实现了 `ILanguagePlugin` 与 `IGoAtlas` 两个接口，协调职责由 `GoAtlasCoordinator` 承担。

**状态**: 已采纳
**日期**: 2026-02-24
**上下文**: Go Architecture Atlas 实施计划 Phase 4
**决策者**: ArchGuard 架构团队
**修订**: v1.3 - 反映实际实现（GoPlugin 直接实现 IGoAtlas，GoAtlasCoordinator 协调）

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

**GoPlugin 直接实现 `ILanguagePlugin` 与 `IGoAtlas` 两个接口**，协调职责由 `GoAtlasCoordinator`（`src/plugins/golang/go-atlas-coordinator.ts`）承担，而非由独立的 `GoAtlasPlugin` 组合类实现。

这一实现路径解决了原始组合方案中的 double-parse bug：`GoAtlasPlugin.parseProjectWithAtlas()` 会先调 `goPlugin.parseProject()` 再调 `generateAtlas()` → `goPlugin.parseToRawData()`，导致 Tree-sitter 解析执行两次。将接口直接合并到 `GoPlugin` 后，`parseToRawData()` 只在一个类内部被调用一次。

### GoPlugin 公共 API

`GoPlugin` 暴露 `parseToRawData()` 公共方法，供 `GoAtlasCoordinator` 和内部 Atlas 流程使用：

```typescript
export class GoPlugin implements ILanguagePlugin, IGoAtlas {
  // 内部成员保持 private
  private treeSitter!: TreeSitterBridge;
  private matcher!: InterfaceMatcher;
  private mapper!: ArchJsonMapper;
  private goplsClient: GoplsClient | null = null;

  /**
   * 公共方法: 解析项目为原始数据
   * 供 GoAtlasCoordinator 及 Atlas 内部流程调用。
   * 避免 double-parse：parseProject() 与 Atlas 路径共享同一次 Tree-sitter 解析。
   *
   * @param config - 支持 TreeSitterParseOptions 扩展（extractBodies, selectiveExtraction）
   */
  async parseToRawData(
    workspaceRoot: string,
    config: ParseConfig & TreeSitterParseOptions
  ): Promise<GoRawData> {
    // 文件发现、Tree-sitter 解析（传递 body 提取选项）、按 fullName 合并包
  }

  /**
   * 标准解析入口：复用 parseToRawData()
   * Atlas 启用时内部执行增强流程（仍只调用一次 parseToRawData）
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    const rawData = await this.parseToRawData(workspaceRoot, config);
    // ... 接口匹配 + ArchJSON 映射，或 Atlas 增强 ...
  }
}
```

### 架构设计（实际实现）

```typescript
// GoPlugin 同时实现两个接口
export class GoPlugin implements ILanguagePlugin, IGoAtlas {
  // 所有 Atlas 逻辑直接在此类中实现
  // ILanguagePlugin: initialize(), canHandle(), parseProject(), parseFiles(), parseCode()
  // IGoAtlas: generateAtlas(), renderLayer()
  // 内部: parseToRawData()（公共，供 GoAtlasCoordinator 调用）
}

// GoAtlasCoordinator — 协调者（src/plugins/golang/go-atlas-coordinator.ts）
// 负责 CLI/MCP 层的 Atlas 调度：选择分层策略、驱动渲染、组织输出
export class GoAtlasCoordinator {
  constructor(private plugin: GoPlugin) {}
  // 通过 plugin.parseToRawData() + plugin.generateAtlas() 完成协调
}
```

### 关键设计决策

#### 1. 清晰的职责分离（实际）

| 组件 | 职责 | API |
|------|------|-----|
| `GoPlugin` | 基础 Go 代码解析 + IGoAtlas 实现 | `parseProject()`, `parseToRawData()`, `generateAtlas()` |
| `GoAtlasCoordinator` | Atlas 调度与输出协调 | 驱动 `GoPlugin` 完成分层渲染 |
| `BehaviorAnalyzer` | 四层架构图构建 | `buildPackageGraph()`, `buildCapabilityGraph()`, ... |
| `AtlasRenderer` | Atlas 渲染和导出 | `render()` |

#### 2. 配置驱动的行为

Atlas 配置通过 `ParseConfig.languageSpecific.atlas` 传递，不修改 `ParseConfig` 接口：

```typescript
// AtlasConfig（通过 languageSpecific 传递）
interface AtlasConfig {
  enabled: boolean;
  functionBodyStrategy?: 'none' | 'selective' | 'full';
  layers?: AtlasLayer[];
  includeTests?: boolean;
  entryPointTypes?: EntryPointType[];
  followIndirectCalls?: boolean;
}
```

**使用示例**：
```typescript
// 标准 Go 解析（无 Atlas）
const archJSON = await plugin.parseProject('/path/to/go/project', {
  workspaceRoot: '/path/to/go/project',
  excludePatterns: ['**/vendor/**'],
  filePattern: '**/*.go',
});

// 启用 Atlas（通过 languageSpecific）
const atlasArchJSON = await plugin.parseProject('/path/to/go/project', {
  workspaceRoot: '/path/to/go/project',
  excludePatterns: ['**/vendor/**'],
  filePattern: '**/*.go',
  languageSpecific: {
    atlas: {
      enabled: true,
      functionBodyStrategy: 'selective',
      layers: ['package', 'capability'],
    },
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
    const rawData = await plugin.parseToRawData('/path', {
      workspaceRoot: '/path',
      excludePatterns: [],
    });
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
- **无 double-parse**: `GoPlugin` 内部只调用一次 `parseToRawData()`，消除了组合模式中的重复解析 bug
- **独立测试**: `GoAtlasCoordinator` 可独立测试，`GoPlugin` Atlas 方法亦可单元测试
- **无 hack**: 不使用 bracket notation（如 `this.goPlugin['treeSitter']`）访问私有成员
- **清晰接口边界**: `ILanguagePlugin` + `IGoAtlas` 两个接口明确划分标准解析与 Atlas 能力

### 负面影响

- **GoPlugin 职责略有扩大**: 同时实现两个接口，类体积比纯解析插件更大
- **配置复杂性**: 需要管理嵌套 Atlas 配置对象

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
- [Proposal 16: Go Architecture Atlas v5.1](../archive/refactoring/proposals/16-go-architecture-atlas.md)

---

**文档版本**: 1.3
**最后更新**: 2026-06
**状态**: 已采纳
**变更记录**:
- v1.1: 消除 `this.goPlugin['treeSitter']` bracket hack，改为使用 `GoPlugin.parseToRawData()` 公共 API；移除 `FunctionBodyExtractor` 独立组件（函数体提取集成到 TreeSitterBridge 统一 API 中）；更新版本号至 5.0.0；返回值类型对齐 ADR-002 `GoAtlasExtension`
- v1.2: 补全 PluginMetadata 必填字段 `author`/`minCoreVersion`；插件名称改为 `'golang'`（替代 GoPlugin，兼容 Registry 自动检测）；`parseToRawData()` 签名改为 `ParseConfig & TreeSitterParseOptions`（满足必填字段 + 集成 body 提取）；`dependencyExtractor` 从 getter 改为 readonly 属性；新增 `parseCode()`/`parseFiles()` 委托；Atlas 配置通过 `ParseConfig.languageSpecific.atlas` 传递；移除 `enrichWithFunctionBodies()`
- v1.3: 实际实现偏离了组合模式 — GoPlugin 直接实现 IGoAtlas 接口（解决了 parseToRawData 重复调用的 double-parse bug），GoAtlasCoordinator 承担协调职责；ADR 更新以反映现实架构
