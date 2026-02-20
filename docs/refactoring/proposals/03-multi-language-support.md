# ArchGuard 多语言支持实施建议

**文档版本**: 2.1
**创建日期**: 2026-01-25
**最后修改**: 2026-02-20
**关联文档**: 01-architecture-optimization-proposal.md
**分析方法**: RLM (Refactoring Lifecycle Management)

---

## 执行摘要

本文档详细规划 ArchGuard 从 TypeScript 单语言支持扩展到多语言（Java, Python, Go, Rust）的技术路线。通过插件化架构设计，实现语言扩展的低成本、高一致性。

**v2.1 主要变更**:
- 对齐 TypeScriptPlugin 实现与现有 `TypeScriptParser` API
- 新增类型迁移计划（Phase 0 前置任务）
- 统一 ArchJSON Schema 与现有类型定义
- 修复代码示例中的导入和空值检查问题
- 明确 `Relation` 字段使用 `source/target`（与现有代码一致）

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
| 现有类型定义需要迁移 | 中 | 渐进式迁移 + 向后兼容 |

---

## 2. 现有类型迁移计划（Phase 0 前置任务）

### 2.1 当前类型定义分析

现有 `src/types/index.ts` 与多语言支持存在以下不兼容：

| 字段 | 当前定义 | 目标定义 | 迁移策略 |
|------|---------|---------|---------|
| `ArchJSON.language` | `'typescript'` (字面量) | `string` | 改为联合类型，渐进扩展 |
| `Relation.source/target` | `source`, `target` | 保持不变 | 无需迁移 |
| `Relation.id` | `id: string` (必需) | 保持不变 | 无需迁移 |
| `MemberType` | `'property' \| 'method' \| 'constructor'` | 增加 `'field'` | 向后兼容扩展 |
| `RelationType` | 不含 `'association'` | 增加 `'association'` | 向后兼容扩展 |
| `Decorator.arguments` | `string[]` | `string[] \| Record<string, unknown>` | 联合类型兼容 |

### 2.2 迁移实施步骤

```typescript
// src/types/index.ts - 迁移后的类型定义

/**
 * 支持的语言类型
 * 渐进式扩展：新语言通过联合类型添加
 */
export type SupportedLanguage = 'typescript' | 'go' | 'java' | 'python' | 'rust';

/**
 * Main architecture JSON structure
 * v2.0: 支持多语言
 */
export interface ArchJSON {
  version: string;
  language: SupportedLanguage;  // 从字面量改为联合类型
  timestamp: string;
  sourceFiles: string[];
  entities: Entity[];
  relations: Relation[];
  modules?: Module[];           // 新增：模块/包结构
  metadata?: Record<string, unknown>; // 新增：语言特定元信息
}

/**
 * Entity types in the architecture
 * v2.0: 扩展支持更多语言的实体类型
 */
export type EntityType =
  | 'class'
  | 'interface'
  | 'enum'
  | 'struct'          // Go, Rust
  | 'trait'           // Rust
  | 'abstract_class'
  | 'function';       // 顶层函数（Go, Python）

/**
 * Member types
 * v2.0: 增加 'field' 用于 Go struct 字段
 */
export type MemberType = 'property' | 'method' | 'constructor' | 'field';

/**
 * Relation types between entities
 * v2.0: 增加 'association'
 */
export type RelationType =
  | 'inheritance'
  | 'implementation'
  | 'composition'
  | 'aggregation'
  | 'dependency'
  | 'association';    // 新增

/**
 * Relation between entities
 * 注意：使用 source/target 而非 from/to（与现有代码一致）
 */
export interface Relation {
  id: string;
  type: RelationType;
  source: string;     // 保持现有字段名
  target: string;     // 保持现有字段名
  label?: string;
  multiplicity?: string;
  confidence?: number;           // 新增：隐式推断的置信度
  inferenceSource?: 'explicit' | 'inferred'; // 新增：关系来源
}

/**
 * Decorator information
 * v2.0: 支持复杂参数结构
 */
export interface Decorator {
  name: string;
  arguments?: string[] | Record<string, unknown>; // 联合类型兼容
}

/**
 * Module structure (新增)
 */
export interface Module {
  name: string;
  entities: string[];
  submodules?: Module[];
}
```

### 2.3 迁移验证

```typescript
// tests/types/migration.test.ts

describe('Type Migration Compatibility', () => {
  it('should accept legacy typescript-only ArchJSON', () => {
    const legacyJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',  // 仍然有效
      // ...
    };
    expect(legacyJson.language).toBe('typescript');
  });

  it('should accept new multi-language ArchJSON', () => {
    const newJson: ArchJSON = {
      version: '1.0',
      language: 'go',  // 新语言
      // ...
    };
    expect(newJson.language).toBe('go');
  });

  it('should accept both decorator argument formats', () => {
    const legacyDecorator: Decorator = {
      name: 'Injectable',
      arguments: ['provided']  // 旧格式
    };

    const newDecorator: Decorator = {
      name: 'Injectable',
      arguments: { providedIn: 'root' }  // 新格式
    };

    expect(legacyDecorator.arguments).toEqual(['provided']);
    expect(newDecorator.arguments).toEqual({ providedIn: 'root' });
  });
});
```

---

## 3. 架构设计

### 3.1 接口体系设计（遵循 ISP 原则）

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
   * 解析单个代码字符串（可选）
   * 用于测试或小片段分析
   */
  parseCode?(code: string, filePath?: string): ArchJSON;

  /**
   * 批量解析文件列表（可选，性能优化）
   * 默认实现：使用 ParallelParser
   */
  parseFiles?(filePaths: string[]): Promise<ArchJSON>;
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
  filePattern?: string;        // glob 模式，如 '**/*.ts'
  concurrency?: number;
  languageSpecific?: Record<string, unknown>;
}
```

---

### 3.2 语言插件统一接口

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

### 3.3 依赖类型定义

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

### 3.4 验证结果类型定义

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

### 3.5 插件注册与发现

```typescript
// core/plugin-registry.ts

import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs-extra';
import type { ILanguagePlugin, PluginMetadata } from './interfaces/index.js';

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
   * 根据目录检测合适的插件
   * 检查目录中是否存在语言标识文件（如 go.mod, package.json）
   */
  async detectPluginForDirectory(dirPath: string): Promise<ILanguagePlugin | null> {
    // 检测顺序：go.mod -> package.json -> Cargo.toml -> pom.xml -> setup.py
    const detectionRules: Array<{ file: string; plugin: string }> = [
      { file: 'go.mod', plugin: 'golang' },
      { file: 'package.json', plugin: 'typescript' },
      { file: 'Cargo.toml', plugin: 'rust' },
      { file: 'pom.xml', plugin: 'java' },
      { file: 'setup.py', plugin: 'python' },
      { file: 'pyproject.toml', plugin: 'python' },
    ];

    for (const rule of detectionRules) {
      const filePath = path.join(dirPath, rule.file);
      if (await fs.pathExists(filePath)) {
        const plugin = this.plugins.get(rule.plugin)?.plugin;
        if (plugin) return plugin;
      }
    }

    return null;
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

export { PluginRegistry, PluginConflictError };
export type { RegisterOptions, PluginRegistration };
```

---

## 4. 语言适配器实现

### 4.1 TypeScript 插件（复用现有基础设施）

```typescript
// plugins/typescript/index.ts

import path from 'path';
import fs from 'fs-extra';
import { TypeScriptParser } from '@/parser/typescript-parser.js';
import { ParallelParser } from '@/parser/parallel-parser.js';
import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
  ParseConfig,
  ArchJSON,
  IDependencyExtractor,
  IValidator,
  Dependency,
  ValidationResult,
  ValidationError,
  ValidationWarning
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
  private parallelParser!: ParallelParser;
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
    this.parallelParser = new ParallelParser({
      continueOnError: true
    });
    this.initialized = true;
  }

  canHandle(targetPath: string): boolean {
    // 处理目录：检查是否存在 package.json 或 tsconfig.json
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
      return fs.existsSync(path.join(targetPath, 'package.json')) ||
             fs.existsSync(path.join(targetPath, 'tsconfig.json'));
    }

    // 处理文件：检查扩展名
    const ext = path.extname(targetPath).toLowerCase();
    return this.metadata.fileExtensions.includes(ext);
  }

  /**
   * 解析整个项目
   * 使用现有的 TypeScriptParser.parseProject 方法
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();

    // 构建 glob 模式
    const pattern = config.filePattern ?? '**/*.ts';

    // 调用现有的 parseProject 方法
    // 注意：现有方法签名是 parseProject(rootDir, pattern)
    return this.parser.parseProject(workspaceRoot, pattern);
  }

  /**
   * 解析单个代码字符串
   * 使用现有的 TypeScriptParser.parseCode 方法
   */
  parseCode(code: string, filePath: string = 'source.ts'): ArchJSON {
    this.ensureInitialized();
    return this.parser.parseCode(code, filePath);
  }

  /**
   * 批量解析文件
   * 使用现有的 ParallelParser.parseFiles 方法
   */
  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    this.ensureInitialized();
    return this.parallelParser.parseFiles(filePaths);
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

    // 对等依赖
    for (const [name, version] of Object.entries(packageJson.peerDependencies ?? {})) {
      dependencies.push({
        name,
        version: version as string,
        type: 'npm',
        scope: 'peer',
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

    // 验证 language
    if (!archJson.language) {
      errors.push({
        code: 'MISSING_LANGUAGE',
        message: 'ArchJSON language is required',
        path: 'language',
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

      if (!entity.name) {
        errors.push({
          code: 'MISSING_ENTITY_NAME',
          message: `Entity at index ${index} is missing name`,
          path: `entities[${index}].name`,
          severity: 'error'
        });
      }
    });

    // 验证 relations 引用的实体存在
    const entityIds = new Set(archJson.entities.map(e => e.id));
    archJson.relations.forEach((relation, index) => {
      // 注意：使用 source/target 字段（与现有代码一致）
      if (!entityIds.has(relation.source)) {
        warnings.push({
          code: 'DANGLING_RELATION_SOURCE',
          message: `Relation references non-existent source entity: ${relation.source}`,
          path: `relations[${index}].source`,
          severity: 'warning',
          suggestion: 'Ensure the source entity is included in the parsed scope'
        });
      }

      if (!entityIds.has(relation.target)) {
        warnings.push({
          code: 'DANGLING_RELATION_TARGET',
          message: `Relation references non-existent target entity: ${relation.target}`,
          path: `relations[${index}].target`,
          severity: 'warning',
          suggestion: 'Ensure the target entity is included in the parsed scope'
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

## 5. 实施路线图

### Phase 0: 类型迁移与接口定义 (Week 1-2)

**目标**: 迁移现有类型定义，验证插件架构的可行性

**任务**:
- [ ] 迁移 `src/types/index.ts`：扩展 `language`, `EntityType`, `MemberType`, `RelationType`
- [ ] 确保所有现有测试仍然通过（向后兼容）
- [ ] 定义 `IParser`, `IDependencyExtractor`, `IValidator` 接口
- [ ] 定义 `ILanguagePlugin` 组合接口
- [ ] 定义 `Dependency`, `ValidationResult` 类型
- [ ] 实现 `PluginRegistry` 基础版本
- [ ] 创建接口 PoC：用 mock 插件验证注册/发现流程

**验收标准**:
- 类型迁移后所有现有测试通过（370+ 测试）
- 接口定义通过 TypeScript 类型检查
- 能成功注册/获取 mock 插件
- 单元测试覆盖率 > 80%

### Phase 1: TypeScript 插件迁移 (Week 3-5)

**目标**: 将现有 TypeScript 解析器封装为插件

**任务**:
- [ ] 创建 `TypeScriptPlugin` 包装现有 `TypeScriptParser` 和 `ParallelParser`
- [ ] 实现 `dependencyExtractor` 和 `validator`
- [ ] 修改 CLI 使用 `PluginRegistry` 获取解析器
- [ ] 新增 `--lang` CLI 参数支持显式语言选择
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

## 6. 测试策略

### 6.1 类型迁移测试

```typescript
// tests/types/migration.test.ts

import { describe, it, expect } from 'vitest';
import type { ArchJSON, Relation, MemberType, EntityType } from '../../src/types/index.js';

describe('Type Migration', () => {
  it('should support new languages', () => {
    const goJson: ArchJSON = {
      version: '1.0',
      language: 'go',  // 新语言
      timestamp: new Date().toISOString(),
      sourceFiles: ['main.go'],
      entities: [],
      relations: []
    };

    expect(goJson.language).toBe('go');
  });

  it('should support field member type', () => {
    const memberType: MemberType = 'field';
    expect(memberType).toBe('field');
  });

  it('should support struct entity type', () => {
    const entityType: EntityType = 'struct';
    expect(entityType).toBe('struct');
  });

  it('should use source/target for relations', () => {
    const relation: Relation = {
      id: 'rel-1',
      type: 'dependency',
      source: 'ClassA',
      target: 'ClassB'
    };

    expect(relation.source).toBe('ClassA');
    expect(relation.target).toBe('ClassB');
  });
});
```

### 6.2 插件单元测试

```typescript
// tests/plugins/typescript.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import TypeScriptPlugin from '../../plugins/typescript/index.js';
import type { ParseConfig } from '../../core/interfaces/index.js';

describe('TypeScriptPlugin', () => {
  let plugin: TypeScriptPlugin;

  beforeEach(async () => {
    plugin = new TypeScriptPlugin();
    await plugin.initialize({ workspaceRoot: __dirname });
  });

  it('should have correct metadata', () => {
    expect(plugin.metadata.name).toBe('typescript');
    expect(plugin.metadata.fileExtensions).toContain('.ts');
  });

  it('should parse code string', () => {
    const code = `
      class UserService {
        getUser(id: string): User {
          return { id };
        }
      }
    `;

    const result = plugin.parseCode(code, 'user-service.ts');

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe('UserService');
    expect(result.language).toBe('typescript');
  });

  it('should parse project directory', async () => {
    const config: ParseConfig = {
      workspaceRoot: './fixtures/sample-project',
      excludePatterns: ['**/*.test.ts'],
      filePattern: '**/*.ts'
    };

    const result = await plugin.parseProject(config.workspaceRoot, config);

    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.language).toBe('typescript');
  });

  it('should extract npm dependencies', async () => {
    const deps = await plugin.dependencyExtractor.extractDependencies('./fixtures/sample-project');

    expect(deps.some(d => d.type === 'npm')).toBe(true);
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
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'MISSING_ENTITY_ID'
    }));
  });

  it('should handle directory detection', () => {
    expect(plugin.canHandle('./fixtures/sample-project')).toBe(true);
    expect(plugin.canHandle('./non-existent')).toBe(false);
  });
});
```

### 6.3 跨语言一致性测试

```typescript
// tests/cross-language.test.ts

import { describe, it, expect, beforeAll } from 'vitest';
import { PluginRegistry } from '../../core/plugin-registry.js';
import type { ArchJSON, ParseConfig } from '../../core/interfaces/index.js';

describe('Cross-language consistency', () => {
  let registry: PluginRegistry;

  const testCases = [
    {
      name: 'Simple class with methods',
      fixtures: {
        typescript: 'fixtures/ts/SimpleClass.ts',
        go: 'fixtures/go/simple_struct.go'
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

      for (const [lang, file] of Object.entries(testCase.fixtures)) {
        const plugin = registry.getPluginForFile(file);
        if (!plugin) {
          console.warn(`No plugin for ${lang}, skipping`);
          continue;
        }

        // 使用 parseCode 进行单文件测试（如果插件支持）
        if (plugin.parseCode) {
          const fs = await import('fs-extra');
          const code = await fs.default.readFile(file, 'utf-8');
          results[lang] = plugin.parseCode(code, file);
        } else {
          // 否则使用 parseProject
          const config: ParseConfig = {
            workspaceRoot: file,
            excludePatterns: []
          };
          results[lang] = await plugin.parseProject(file, config);
        }
      }

      // 验证所有语言提取的实体数量一致
      const entityCounts = Object.values(results).map(r => r.entities.length);
      if (entityCounts.length > 1) {
        expect(new Set(entityCounts).size).toBe(1);
      }

      // 验证方法数量一致
      for (const result of Object.values(results)) {
        if (result.entities.length > 0) {
          const methodCount = result.entities[0].members
            .filter(m => m.type === 'method').length;
          expect(methodCount).toBe(testCase.expected.methodCount);
        }
      }
    });
  }
});
```

---

## 7. CLI 扩展

### 7.1 新增 `--lang` 参数

```typescript
// src/cli/commands/analyze.ts (修改)

import { Command } from 'commander';
import { PluginRegistry } from '@/core/plugin-registry.js';

export function createAnalyzeCommand(): Command {
  return new Command('analyze')
    .description('Analyze source code and generate architecture diagrams')
    .option('-s, --sources <paths...>', 'Source directories')
    .option('-l, --level <level>', 'Detail level: package|class|method', 'class')
    .option('--lang <language>', 'Force language plugin (auto-detect if not specified)')
    .option('-v, --verbose', 'Verbose output')
    // ... 其他选项
    .action(async (options) => {
      const registry = new PluginRegistry();
      await registry.discoverPlugins('./plugins');

      let plugin;

      if (options.lang) {
        // 显式指定语言
        plugin = registry.getPluginByVersion(options.lang, 'latest');
        if (!plugin) {
          console.error(`Plugin not found: ${options.lang}`);
          process.exit(1);
        }
      } else {
        // 自动检测
        plugin = await registry.detectPluginForDirectory(options.sources[0]);
        if (!plugin) {
          // 回退到 TypeScript
          plugin = registry.getPluginForFile('.ts');
        }
      }

      // ... 使用 plugin 进行解析
    });
}
```

---

## 8. 成功指标

| 指标 | 目标 | 测量方法 |
|------|------|---------|
| 类型迁移向后兼容 | 100% | 现有测试通过率 |
| 支持语言数量 | 5+ | 已发布插件数 |
| 插件开发工作量 | < 5 人日/语言 | 时间跟踪 |
| Arch-JSON 一致性 | > 90% | 跨语言测试通过率 |
| 社区贡献插件 | 3+ | GitHub 插件仓库 |
| 性能回归 | < 5% | 基准测试对比 |

---

## 9. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 类型迁移破坏现有功能 | 中 | 高 | 使用联合类型保持向后兼容 |
| 现有 API 与插件接口不匹配 | 已确认 | 高 | Phase 0 前置类型迁移 |
| 插件接口变更频繁 | 中 | 中 | 定义 stable/unstable API 边界 |
| 跨语言一致性难以保证 | 高 | 中 | 定义最小公共特征集 + 严格的一致性测试 |

---

**下一步行动**:
1. 执行 Phase 0：迁移 `src/types/index.ts`
2. 验证所有现有测试仍然通过
3. 创建 PluginRegistry PoC
4. 开始 TypeScript 插件封装
