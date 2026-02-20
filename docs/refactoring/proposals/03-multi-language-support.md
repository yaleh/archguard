# ArchGuard 多语言支持实施建议

**文档版本**: 2.0
**创建日期**: 2026-01-25
**最后修改**: 2026-02-20
**关联文档**: 01-architecture-optimization-proposal.md
**分析方法**: RLM (Refactoring Lifecycle Management)

---

## 执行摘要

本文档详细规划 ArchGuard 从 TypeScript 单语言支持扩展到多语言（Java, Python, Go, Rust）的技术路线。通过插件化架构设计，实现语言扩展的低成本、高一致性。

**v2.0 主要变更**:
- 重新设计接口体系，遵循接口隔离原则（ISP）
- 补充 `Dependency` 类型定义
- 修复测试代码语法错误
- 调整实施路线图为更现实的时间估算
- 确保与现有代码库的兼容性

---

## 1. 多语言支持的价值

### 1.1 业务价值

- **扩大用户群**: 覆盖 Java/Spring、Python/Django、Go/微服务等生态
- **企业吸引力**: 大型企业通常使用多种语言，全栈支持是刚需
- **生态建设**: 开放插件接口，社区可贡献新语言支持

### 1.2 技术挑战

| 挑战 | 影响 | 缓解策略 |
|------|------|---------|
| 不同语言语法差异巨大 | 高 | 统一抽象层 (Arch-JSON) |
| AST 解析器各异 | 中 | 插件化 Parser 接口 |
| 语言特性不对称 | 中 | 定义最小公共特征集 |
| 测试成本倍增 | 高 | 自动化测试套件 |

---

## 2. 架构设计

### 2.1 接口体系设计（遵循 ISP 原则）

将原单一接口拆分为职责清晰的多个接口，插件可按需组合实现：

```typescript
// core/interfaces/parser.ts

/**
 * 解析能力接口 - 核心解析职责
 * 插件必须实现 parseProject，其他方法可选
 */
interface IParser {
  /**
   * 解析整个项目/模块工作区
   * 这是主要入口点，适用于需要全局语义分析的语言（Go/Java/Rust）
   */
  parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON>;

  /**
   * 解析单文件（可选）
   * 仅适用于脚本语言或局部上下文即可完成分析的场景
   * 默认实现：调用 parseProject 并过滤结果
   */
  parseFile?(filePath: string, config: ParseConfig): Promise<ArchJSON>;

  /**
   * 批量解析（可选，性能优化）
   * 默认实现：并行调用 parseFile
   */
  parseBatch?(filePaths: string[], config: ParseConfig): Promise<ArchJSON>;
}

/**
 * 依赖提取接口 - 独立于解析的依赖分析
 */
interface IDependencyExtractor {
  /**
   * 提取项目依赖关系
   * @param workspaceRoot 项目根目录
   * @returns 外部依赖列表（npm packages, go modules, pip packages 等）
   */
  extractDependencies(workspaceRoot: string): Promise<Dependency[]>;
}

/**
 * 验证接口 - ArchJSON 校验能力
 */
interface IValidator {
  /**
   * 验证生成的 ArchJSON 是否符合 Schema 和语言特定规则
   */
  validate(archJson: ArchJSON): ValidationResult;
}

/**
 * 解析配置
 */
interface ParseConfig {
  workspaceRoot: string;
  excludePatterns: string[];
  includePatterns?: string[];
  concurrency?: number;
  languageSpecific?: Record<string, unknown>;
}
```

---

### 2.2 语言插件统一接口

```typescript
// core/interfaces/language-plugin.ts

/**
 * 语言插件统一接口
 * 组合 IParser + IDependencyExtractor + IValidator
 *
 * 设计原则：
 * 1. IParser 为必需（核心解析能力）
 * 2. IDependencyExtractor 和 IValidator 为可选增强
 * 3. 生命周期管理独立于解析逻辑
 */
interface ILanguagePlugin extends IParser {
  /** 插件元信息 */
  readonly metadata: PluginMetadata;

  /** 初始化插件（加载配置、依赖等） */
  initialize(config: PluginInitConfig): Promise<void>;

  /** 检查文件或目录是否由本插件处理 */
  canHandle(targetPath: string): boolean;

  /** 清理资源 */
  dispose(): Promise<void>;

  /** 可选：依赖提取能力 */
  readonly dependencyExtractor?: IDependencyExtractor;

  /** 可选：验证能力 */
  readonly validator?: IValidator;
}

interface PluginMetadata {
  name: string;              // e.g., "typescript"
  version: string;           // e.g., "1.0.0" - 遵循 semver
  displayName: string;       // e.g., "TypeScript/JavaScript"
  fileExtensions: string[];  // e.g., [".ts", ".tsx", ".js", ".jsx"]
  author: string;
  repository?: string;

  /** 最低兼容的 ArchGuard 核心版本 */
  minCoreVersion: string;

  /** 插件能力声明 */
  capabilities: PluginCapabilities;
}

interface PluginCapabilities {
  /** 是否支持单文件解析 */
  singleFileParsing: boolean;
  /** 是否支持增量解析 */
  incrementalParsing: boolean;
  /** 是否提供依赖提取 */
  dependencyExtraction: boolean;
  /** 是否提供类型推导（用于隐式接口等） */
  typeInference: boolean;
}

interface PluginInitConfig {
  workspaceRoot: string;
  cacheDir?: string;
  verbose?: boolean;
}
```

---

### 2.3 依赖类型定义

```typescript
// core/interfaces/dependency.ts

/**
 * 外部依赖表示
 * 用于描述项目对外部包/模块的依赖关系
 */
interface Dependency {
  /** 依赖名称 (e.g., "lodash", "github.com/gin-gonic/gin") */
  name: string;

  /** 版本约束 (e.g., "^4.17.0", "v1.9.0") */
  version: string;

  /** 依赖类型 */
  type: DependencyType;

  /** 依赖范围 */
  scope: DependencyScope;

  /** 声明位置 (e.g., "package.json", "go.mod") */
  source: string;

  /** 是否为直接依赖（vs 传递依赖） */
  isDirect: boolean;
}

type DependencyType =
  | 'npm'        // Node.js
  | 'gomod'      // Go Modules
  | 'pip'        // Python
  | 'maven'      // Java
  | 'cargo';     // Rust

type DependencyScope =
  | 'runtime'      // 运行时依赖
  | 'development'  // 开发依赖
  | 'optional'     // 可选依赖
  | 'peer';        // 对等依赖
```

---

### 2.4 验证结果类型定义

```typescript
// core/interfaces/validation.ts

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];

  /** 验证耗时（毫秒） */
  durationMs: number;
}

interface ValidationError {
  code: string;           // e.g., "INVALID_ENTITY_TYPE"
  message: string;
  path?: string;          // JSON path, e.g., "entities[0].type"
  severity: 'error';
}

interface ValidationWarning {
  code: string;
  message: string;
  path?: string;
  severity: 'warning';
  suggestion?: string;    // 修复建议
}
```

---

### 2.5 插件注册与发现

```typescript
// core/plugin-registry.ts

import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs-extra';

interface PluginRegistration {
  plugin: ILanguagePlugin;
  registeredAt: Date;
  priority: number;  // 用于扩展名冲突时的优先级决策
}

class PluginRegistry {
  private plugins = new Map<string, PluginRegistration>();
  private extensionMap = new Map<string, string[]>(); // .ts -> ["typescript", "typescript-legacy"]
  private versionedPlugins = new Map<string, Map<string, PluginRegistration>>(); // name -> version -> registration

  /**
   * 注册插件
   * @param plugin 插件实例
   * @param options 注册选项
   */
  register(plugin: ILanguagePlugin, options: RegisterOptions = {}): void {
    const { name, version, fileExtensions } = plugin.metadata;
    const pluginKey = `${name}@${version}`;
    const { priority = 0, overwrite = false } = options;

    // 版本冲突检查
    if (this.versionedPlugins.has(name)) {
      const versions = this.versionedPlugins.get(name)!;
      if (versions.has(version) && !overwrite) {
        throw new PluginConflictError(
          `Plugin ${pluginKey} already registered. Use overwrite: true to replace.`
        );
      }
    } else {
      this.versionedPlugins.set(name, new Map());
    }

    const registration: PluginRegistration = {
      plugin,
      registeredAt: new Date(),
      priority
    };

    // 注册到版本映射
    this.versionedPlugins.get(name)!.set(version, registration);

    // 注册到主映射（使用最高版本作为默认）
    const latestVersion = this.getLatestVersion(name);
    if (version === latestVersion) {
      this.plugins.set(name, registration);
    }

    // 建立文件扩展名映射
    for (const ext of fileExtensions) {
      if (!this.extensionMap.has(ext)) {
        this.extensionMap.set(ext, []);
      }

      const handlers = this.extensionMap.get(ext)!;
      if (!handlers.includes(name)) {
        handlers.push(name);
        // 按优先级排序
        handlers.sort((a, b) => {
          const regA = this.plugins.get(a);
          const regB = this.plugins.get(b);
          return (regB?.priority ?? 0) - (regA?.priority ?? 0);
        });
      }
    }

    console.log(`Registered plugin: ${pluginKey} (${fileExtensions.join(', ')})`);
  }

  /**
   * 获取插件的最新版本号
   */
  private getLatestVersion(name: string): string | null {
    const versions = this.versionedPlugins.get(name);
    if (!versions || versions.size === 0) return null;

    return Array.from(versions.keys())
      .sort((a, b) => this.compareVersions(b, a))
      [0];
  }

  /**
   * 语义化版本比较
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] ?? 0;
      const numB = partsB[i] ?? 0;
      if (numA !== numB) return numA - numB;
    }
    return 0;
  }

  /**
   * 根据文件路径获取合适的插件
   * @param filePath 文件路径
   * @param preferredPlugin 优先使用的插件名
   */
  getPluginForFile(filePath: string, preferredPlugin?: string): ILanguagePlugin | null {
    const ext = path.extname(filePath).toLowerCase();
    const handlers = this.extensionMap.get(ext);

    if (!handlers || handlers.length === 0) {
      return null;
    }

    // 优先使用指定的插件
    if (preferredPlugin && handlers.includes(preferredPlugin)) {
      return this.plugins.get(preferredPlugin)?.plugin ?? null;
    }

    // 返回最高优先级的插件
    const pluginName = handlers[0];
    return this.plugins.get(pluginName)?.plugin ?? null;
  }

  /**
   * 获取特定版本的插件
   */
  getPluginByVersion(name: string, version: string): ILanguagePlugin | null {
    return this.versionedPlugins.get(name)?.get(version)?.plugin ?? null;
  }

  /**
   * 获取所有已注册插件
   */
  getAllPlugins(): ILanguagePlugin[] {
    return Array.from(this.plugins.values()).map(r => r.plugin);
  }

  /**
   * 列出插件的所有可用版本
   */
  listVersions(name: string): string[] {
    const versions = this.versionedPlugins.get(name);
    return versions ? Array.from(versions.keys()).sort(this.compareVersions) : [];
  }

  /**
   * 自动发现并加载插件（ESM 兼容）
   */
  async discoverPlugins(pluginsDir: string): Promise<void> {
    if (!await fs.pathExists(pluginsDir)) {
      console.warn(`Plugins directory not found: ${pluginsDir}`);
      return;
    }

    const pluginDirs = await fs.readdir(pluginsDir);

    for (const dir of pluginDirs) {
      const pluginPath = path.join(pluginsDir, dir, 'index.js');

      if (!await fs.pathExists(pluginPath)) {
        continue;
      }

      try {
        // 使用 ESM 动态导入
        const pluginUrl = pathToFileURL(pluginPath).href;
        const module = await import(pluginUrl);
        const PluginClass = module.default;

        if (typeof PluginClass !== 'function') {
          console.error(`Plugin ${dir}: default export is not a constructor`);
          continue;
        }

        const plugin: ILanguagePlugin = new PluginClass();

        await plugin.initialize({
          workspaceRoot: process.cwd(),
          verbose: false
        });

        this.register(plugin);
      } catch (error) {
        console.error(`Failed to load plugin from ${dir}:`, error);
      }
    }
  }
}

interface RegisterOptions {
  priority?: number;
  overwrite?: boolean;
}

class PluginConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginConflictError';
  }
}
```

---

### 2.6 统一的 Arch-JSON Schema

```typescript
// core/schema/arch-json.ts

/**
 * 架构 JSON - 跨语言统一格式
 *
 * 设计原则:
 * 1. 语言无关: 不依赖特定语言特性
 * 2. 可扩展: 支持通过 metadata 添加语言特定信息
 * 3. 语义清晰: 字段命名明确，易于 AI 理解
 */
interface ArchJSON {
  version: string;           // Schema 版本
  language: string;          // 源语言 (typescript, java, python, go, rust)
  timestamp: string;         // 生成时间
  sourceFiles: string[];     // 源文件列表

  entities: Entity[];        // 实体列表 (类、接口、结构体等)
  relations: Relation[];     // 关系列表
  modules?: Module[];        // 模块/包结构 (可选)

  metadata?: Record<string, unknown>; // 语言特定元信息
}

interface Entity {
  id: string;                // 唯一标识 (e.g., "com.example.UserService")
  name: string;              // 短名称 (e.g., "UserService")
  type: EntityType;          // 实体类型
  visibility: Visibility;    // 可见性
  isAbstract?: boolean;      // 是否抽象
  isFinal?: boolean;         // 是否 final/sealed

  members: Member[];         // 成员 (方法、字段)
  decorators?: Decorator[];  // 装饰器/注解
  genericParams?: string[];  // 泛型参数

  sourceLocation: SourceLocation;
  documentation?: string;    // 文档注释
  metadata?: Record<string, unknown>;
}

type EntityType =
  | 'class'
  | 'interface'
  | 'enum'
  | 'struct'        // Go, Rust
  | 'trait'         // Rust
  | 'protocol'      // Swift
  | 'abstract_class'
  | 'function';     // 顶层函数（Go, Python）

type Visibility = 'public' | 'protected' | 'private' | 'internal' | 'package';

interface Member {
  name: string;
  type: MemberType;
  visibility: Visibility;
  isStatic?: boolean;
  isAsync?: boolean;

  // 方法特定
  parameters?: Parameter[];
  returnType?: string;

  // 字段特定
  fieldType?: string;
  isReadonly?: boolean;

  metadata?: Record<string, unknown>;
}

type MemberType = 'method' | 'field' | 'property' | 'constructor';

interface Parameter {
  name: string;
  type: string;
  isOptional?: boolean;
  defaultValue?: string;
}

interface Relation {
  from: string;              // Entity ID
  to: string;                // Entity ID
  type: RelationType;
  label?: string;            // 关系标签
  multiplicity?: string;     // 多重性 (e.g., "1..*")

  /** 关系的置信度 (0-1)，用于隐式推断的关系 */
  confidence?: number;

  /** 关系来源说明 */
  source?: 'explicit' | 'inferred';
}

type RelationType =
  | 'inheritance'      // 继承
  | 'implementation'   // 接口实现
  | 'composition'      // 组合
  | 'aggregation'      // 聚合
  | 'dependency'       // 依赖
  | 'association';     // 关联

interface Module {
  name: string;              // 模块名 (e.g., "com.example.user")
  entities: string[];        // 包含的实体 ID
  submodules?: Module[];
}

interface SourceLocation {
  file: string;
  startLine: number;
  endLine: number;
}

interface Decorator {
  name: string;              // 装饰器名 (e.g., "@Injectable", "@Service")
  arguments?: Record<string, unknown>;
}
```

---

## 3. 语言适配器实现

### 3.1 TypeScript 插件（复用现有基础设施）

```typescript
// plugins/typescript/index.ts

import { TypeScriptParser } from '@/parser/typescript-parser.js';
import { ClassExtractor } from '@/parser/class-extractor.js';
import { InterfaceExtractor } from '@/parser/interface-extractor.js';
import { EnumExtractor } from '@/parser/enum-extractor.js';
import { RelationExtractor } from '@/parser/relation-extractor.js';
import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
  ParseConfig,
  ArchJSON,
  IDependencyExtractor,
  IValidator,
  Dependency,
  ValidationResult
} from '@/core/interfaces/index.js';

export default class TypeScriptPlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'typescript',
    version: '1.0.0',
    displayName: 'TypeScript/JavaScript',
    fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
    author: 'ArchGuard Team',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: false,
      dependencyExtraction: true,
      typeInference: true
    }
  };

  private parser!: TypeScriptParser;
  private initialized = false;

  readonly dependencyExtractor: IDependencyExtractor = {
    extractDependencies: this.extractDeps.bind(this)
  };

  readonly validator: IValidator = {
    validate: this.validateArchJson.bind(this)
  };

  async initialize(config: PluginInitConfig): Promise<void> {
    if (this.initialized) return;

    this.parser = new TypeScriptParser();
    this.initialized = true;
  }

  canHandle(targetPath: string): boolean {
    const ext = path.extname(targetPath).toLowerCase();
    return this.metadata.fileExtensions.includes(ext);
  }

  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();

    // 复用现有的 TypeScriptParser
    return await this.parser.parseDirectory(workspaceRoot, {
      exclude: config.excludePatterns,
      include: config.includePatterns
    });
  }

  async parseFile(filePath: string, config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();
    return await this.parser.parseFile(filePath);
  }

  async parseBatch(filePaths: string[], config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();
    return await this.parser.parseFiles(filePaths, {
      concurrency: config.concurrency
    });
  }

  private async extractDeps(workspaceRoot: string): Promise<Dependency[]> {
    const packageJsonPath = path.join(workspaceRoot, 'package.json');

    if (!await fs.pathExists(packageJsonPath)) {
      return [];
    }

    const packageJson = await fs.readJson(packageJsonPath);
    const dependencies: Dependency[] = [];

    // 运行时依赖
    for (const [name, version] of Object.entries(packageJson.dependencies ?? {})) {
      dependencies.push({
        name,
        version: version as string,
        type: 'npm',
        scope: 'runtime',
        source: 'package.json',
        isDirect: true
      });
    }

    // 开发依赖
    for (const [name, version] of Object.entries(packageJson.devDependencies ?? {})) {
      dependencies.push({
        name,
        version: version as string,
        type: 'npm',
        scope: 'development',
        source: 'package.json',
        isDirect: true
      });
    }

    return dependencies;
  }

  private validateArchJson(archJson: ArchJSON): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const startTime = Date.now();

    // 验证 version
    if (!archJson.version) {
      errors.push({
        code: 'MISSING_VERSION',
        message: 'ArchJSON version is required',
        path: 'version',
        severity: 'error'
      });
    }

    // 验证 entities
    archJson.entities.forEach((entity, index) => {
      if (!entity.id) {
        errors.push({
          code: 'MISSING_ENTITY_ID',
          message: `Entity at index ${index} is missing id`,
          path: `entities[${index}].id`,
          severity: 'error'
        });
      }
    });

    // 验证 relations 引用的实体存在
    const entityIds = new Set(archJson.entities.map(e => e.id));
    archJson.relations.forEach((relation, index) => {
      if (!entityIds.has(relation.from)) {
        warnings.push({
          code: 'DANGLING_RELATION',
          message: `Relation references non-existent entity: ${relation.from}`,
          path: `relations[${index}].from`,
          severity: 'warning',
          suggestion: 'Ensure the source entity is included in the parsed scope'
        });
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      durationMs: Date.now() - startTime
    };
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('TypeScriptPlugin not initialized. Call initialize() first.');
    }
  }
}
```

---

## 4. 实施路线图

### Phase 0: 接口定义与 PoC (Week 1-2)

**目标**: 验证插件架构的可行性

- [ ] 定义 `IParser`, `IDependencyExtractor`, `IValidator` 接口
- [ ] 定义 `ILanguagePlugin` 组合接口
- [ ] 定义 `Dependency`, `ValidationResult` 类型
- [ ] 实现 `PluginRegistry` 基础版本
- [ ] 创建接口 PoC：用 mock 插件验证注册/发现流程

**验收标准**:
- 接口定义通过 TypeScript 类型检查
- 能成功注册/获取 mock 插件
- 单元测试覆盖率 > 80%

### Phase 1: TypeScript 插件迁移 (Week 3-5)

**目标**: 将现有 TypeScript 解析器封装为插件

- [ ] 创建 `TypeScriptPlugin` 包装现有 `TypeScriptParser`
- [ ] 实现 `dependencyExtractor` 和 `validator`
- [ ] 修改 CLI 使用 `PluginRegistry` 获取解析器
- [ ] 完善自动发现机制（ESM 兼容）
- [ ] 编写迁移测试确保 100% 兼容

**验收标准**:
- 所有现有测试通过（370+ 测试）
- `npm run build && node dist/cli/index.js analyze` 输出与迁移前一致
- 性能回归 < 5%

### Phase 2: 第二语言支持 - Go (Week 6-10)

**目标**: 实现 Go 语言插件

- [ ] 实现 Go 插件（详见 Proposal 15）
- [ ] 处理 Go 特有的 Duck Typing
- [ ] 集成测试：codex-swarm 项目

**验收标准**:
- Go 插件通过所有定义的测试用例
- 能正确提取 codex-swarm 的架构图

### Phase 3: 其他语言扩展 (Week 11-18)

**目标**: 扩展 Java、Python 支持

- [ ] Java 插件（基于 Tree-sitter 或 JavaParser）
- [ ] Python 插件（基于 Tree-sitter）
- [ ] 跨语言一致性测试套件

### Phase 4: 社区生态 (Ongoing)

- [ ] 编写插件开发指南
- [ ] 发布插件开发模板
- [ ] 建立插件市场/注册表

---

## 5. 测试策略

### 5.1 单元测试

```typescript
// __tests__/plugins/typescript.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import TypeScriptPlugin from '../../plugins/typescript/index.js';

describe('TypeScriptPlugin', () => {
  let plugin: TypeScriptPlugin;

  // 修复：使用 async 函数
  beforeEach(async () => {
    plugin = new TypeScriptPlugin();
    await plugin.initialize({ workspaceRoot: __dirname });
  });

  it('should parse a simple class', async () => {
    const filePath = '__fixtures__/SimpleClass.ts';
    const result = await plugin.parseFile(filePath, {
      workspaceRoot: __dirname,
      excludePatterns: []
    });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe('UserService');
    expect(result.entities[0].members).toHaveLength(2);
  });

  it('should extract decorators', async () => {
    const filePath = '__fixtures__/DecoratedClass.ts';
    const result = await plugin.parseFile(filePath, {
      workspaceRoot: __dirname,
      excludePatterns: []
    });

    expect(result.entities[0].decorators).toContainEqual({
      name: 'Injectable',
      arguments: {}
    });
  });

  it('should extract npm dependencies', async () => {
    const deps = await plugin.dependencyExtractor.extractDependencies(__dirname);

    expect(deps).toContainEqual(expect.objectContaining({
      type: 'npm',
      scope: 'runtime'
    }));
  });

  it('should validate ArchJSON', () => {
    const invalidJson = {
      version: '',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles: [],
      entities: [{ name: 'Test' }], // missing id
      relations: []
    };

    const result = plugin.validator.validate(invalidJson as any);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'MISSING_VERSION'
    }));
  });
});
```

### 5.2 跨语言一致性测试

```typescript
// __tests__/cross-language.test.ts

import { describe, it, expect, beforeAll } from 'vitest';
import { PluginRegistry } from '../../core/plugin-registry.js';

describe('Cross-language consistency', () => {
  let registry: PluginRegistry;

  const testCases = [
    {
      name: 'Simple class with methods',
      files: {
        typescript: '__fixtures__/ts/SimpleClass.ts',
        java: '__fixtures__/java/SimpleClass.java',
        python: '__fixtures__/py/simple_class.py',
        go: '__fixtures__/go/simple_struct.go'
      },
      expected: {
        entityCount: 1,
        methodCount: 2,
        fieldCount: 1
      }
    }
  ];

  beforeAll(async () => {
    registry = new PluginRegistry();
    await registry.discoverPlugins('./plugins');
  });

  for (const testCase of testCases) {
    it(`should produce consistent output for: ${testCase.name}`, async () => {
      const results: Record<string, ArchJSON> = {};

      for (const [lang, file] of Object.entries(testCase.files)) {
        const plugin = registry.getPluginForFile(file);
        if (!plugin) {
          console.warn(`No plugin for ${lang}, skipping`);
          continue;
        }

        results[lang] = await plugin.parseFile(file, {
          workspaceRoot: __dirname,
          excludePatterns: []
        });
      }

      // 验证所有语言提取的实体数量一致
      const entityCounts = Object.values(results).map(r => r.entities.length);
      expect(new Set(entityCounts).size).toBe(1);
      expect(entityCounts[0]).toBe(testCase.expected.entityCount);

      // 验证方法数量一致
      for (const result of Object.values(results)) {
        const methodCount = result.entities[0].members
          .filter(m => m.type === 'method').length;
        expect(methodCount).toBe(testCase.expected.methodCount);
      }
    });
  }
});
```

---

## 6. 文档与示例

### 6.1 插件开发指南

创建 `docs/plugin-development-guide.md`:

```markdown
# ArchGuard 语言插件开发指南

## 快速开始

### 1. 使用脚手架创建插件

```bash
npm run create-plugin -- --name rust --extensions .rs
```

### 2. 实现必需接口

```typescript
import type { ILanguagePlugin, ParseConfig, ArchJSON } from '@archguard/core';

export default class RustPlugin implements ILanguagePlugin {
  readonly metadata = {
    name: 'rust',
    version: '1.0.0',
    displayName: 'Rust',
    fileExtensions: ['.rs'],
    author: 'Your Name',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: false,  // Rust 需要项目级分析
      incrementalParsing: false,
      dependencyExtraction: true,
      typeInference: true
    }
  };

  async initialize(config) { /* ... */ }
  canHandle(path) { /* ... */ }

  async parseProject(root: string, config: ParseConfig): Promise<ArchJSON> {
    // 实现解析逻辑
  }

  async dispose() { /* ... */ }
}
```

### 3. 测试插件

```bash
npm test -- plugins/rust
```

### 4. 发布插件

```bash
npm publish --access public
```

## 最佳实践

1. **性能优化**: 使用 `parseProject` 而非逐文件解析
2. **错误处理**: 捕获并记录解析错误，不阻塞整体流程
3. **可配置**: 通过 `languageSpecific` 接受语言特定配置
4. **测试覆盖**: 提供跨语言一致性测试 fixtures
```

---

## 7. 成功指标

| 指标 | 目标 | 测量方法 |
|------|------|---------|
| 支持语言数量 | 5+ | 已发布插件数 |
| 插件开发工作量 | < 5 人日/语言 | 时间跟踪 |
| Arch-JSON 一致性 | > 90% | 跨语言测试通过率 |
| 社区贡献插件 | 3+ | GitHub 插件仓库 |
| 性能回归 | < 5% | 基准测试对比 |
| 现有测试通过率 | 100% | CI 验证 |

---

## 8. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 现有功能回归 | 中 | 高 | 完整的迁移测试套件 |
| 插件接口变更频繁 | 中 | 中 | 定义 stable/unstable API 边界 |
| 跨语言一致性难以保证 | 高 | 中 | 定义最小公共特征集 + 严格的一致性测试 |
| 第三方解析器维护风险 | 低 | 高 | 优先选择活跃维护的解析器 |

---

**下一步行动**:
1. 评审本文档中的接口定义
2. 创建 Phase 0 的 PoC 分支
3. 开始 TypeScript 插件迁移的详细设计
