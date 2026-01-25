# ArchGuard 多语言支持实施建议

**文档版本**: 1.0
**创建日期**: 2026-01-25
**关联文档**: 01-architecture-optimization-proposal.md
**分析方法**: RLM (Refactoring Lifecycle Management)

---

## 执行摘要

本文档详细规划 ArchGuard 从 TypeScript 单语言支持扩展到多语言（Java, Python, Go, Rust）的技术路线。通过插件化架构设计，实现语言扩展的低成本、高一致性。

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

### 2.1 插件化 Parser 接口

```typescript
// core/interfaces/language-plugin.ts

/**
 * 语言插件统一接口
 * 所有语言解析器必须实现此接口
 */
interface ILanguagePlugin {
  /** 插件元信息 */
  readonly metadata: PluginMetadata;

  /** 初始化插件（加载配置、依赖等） */
  initialize(config: PluginConfig): Promise<void>;

  /** 检查文件是否由本插件处理 */
  canHandle(filePath: string): boolean;

  /** 解析文件为统一的 Arch-JSON */
  parse(filePath: string): Promise<ArchJSON>;

  /** 批量解析（性能优化） */
  parseBatch(filePaths: string[]): Promise<ArchJSON[]>;

  /** 提取依赖关系 */
  extractDependencies(filePath: string): Promise<Dependency[]>;

  /** 验证生成的 Arch-JSON 是否有效 */
  validate(archJson: ArchJSON): ValidationResult;

  /** 清理资源 */
  dispose(): Promise<void>;
}

interface PluginMetadata {
  name: string;              // e.g., "typescript"
  version: string;           // e.g., "1.0.0"
  displayName: string;       // e.g., "TypeScript/JavaScript"
  fileExtensions: string[];  // e.g., [".ts", ".tsx", ".js", ".jsx"]
  author: string;
  repository?: string;
}

interface PluginConfig {
  workspaceRoot: string;
  excludePatterns: string[];
  languageSpecific: Record<string, any>; // 语言特定配置
}
```

---

### 2.2 插件注册与发现

```typescript
// core/plugin-registry.ts

class PluginRegistry {
  private plugins = new Map<string, ILanguagePlugin>();
  private extensionMap = new Map<string, string>(); // .ts -> "typescript"

  /**
   * 注册插件
   */
  register(plugin: ILanguagePlugin): void {
    const { name, fileExtensions } = plugin.metadata;

    // 检查冲突
    if (this.plugins.has(name)) {
      throw new Error(`Plugin ${name} already registered`);
    }

    // 注册插件
    this.plugins.set(name, plugin);

    // 建立文件扩展名映射
    for (const ext of fileExtensions) {
      if (this.extensionMap.has(ext)) {
        console.warn(`Extension ${ext} already claimed by ${this.extensionMap.get(ext)}`);
      }
      this.extensionMap.set(ext, name);
    }

    console.log(`Registered plugin: ${name} (${fileExtensions.join(', ')})`);
  }

  /**
   * 根据文件路径获取合适的插件
   */
  getPluginForFile(filePath: string): ILanguagePlugin | null {
    const ext = path.extname(filePath);
    const pluginName = this.extensionMap.get(ext);

    if (!pluginName) {
      return null;
    }

    return this.plugins.get(pluginName) || null;
  }

  /**
   * 获取所有已注册插件
   */
  getAllPlugins(): ILanguagePlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 自动发现并加载插件
   */
  async discoverPlugins(pluginsDir: string): Promise<void> {
    const pluginDirs = await fs.readdir(pluginsDir);

    for (const dir of pluginDirs) {
      try {
        const pluginPath = path.join(pluginsDir, dir, 'index.js');
        const PluginClass = require(pluginPath).default;
        const plugin = new PluginClass();

        await plugin.initialize({ workspaceRoot: process.cwd() });
        this.register(plugin);
      } catch (error) {
        console.error(`Failed to load plugin from ${dir}:`, error);
      }
    }
  }
}
```

---

### 2.3 统一的 Arch-JSON Schema

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
  language: string;          // 源语言 (typescript, java, python, go)
  timestamp: string;         // 生成时间
  sourceFiles: string[];     // 源文件列表

  entities: Entity[];        // 实体列表 (类、接口、结构体等)
  relations: Relation[];     // 关系列表
  modules?: Module[];        // 模块/包结构 (可选)

  metadata?: Record<string, any>; // 语言特定元信息
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
  metadata?: Record<string, any>;
}

type EntityType =
  | 'class'
  | 'interface'
  | 'enum'
  | 'struct'        // Go, Rust
  | 'trait'         // Rust
  | 'protocol'      // Swift
  | 'abstract_class';

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

  metadata?: Record<string, any>;
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
  arguments?: Record<string, any>;
}
```

---

## 3. 语言适配器实现

### 3.1 TypeScript 插件

```typescript
// plugins/typescript/index.ts

import { Project, SyntaxKind } from 'ts-morph';
import { ILanguagePlugin, ArchJSON, Entity } from '../../core/interfaces';

export default class TypeScriptPlugin implements ILanguagePlugin {
  readonly metadata = {
    name: 'typescript',
    version: '1.0.0',
    displayName: 'TypeScript/JavaScript',
    fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
    author: 'ArchGuard Team'
  };

  private project!: Project;

  async initialize(config: PluginConfig): Promise<void> {
    this.project = new Project({
      tsConfigFilePath: path.join(config.workspaceRoot, 'tsconfig.json')
    });
  }

  canHandle(filePath: string): boolean {
    return this.metadata.fileExtensions.includes(path.extname(filePath));
  }

  async parse(filePath: string): Promise<ArchJSON> {
    const sourceFile = this.project.addSourceFileAtPath(filePath);
    const entities: Entity[] = [];

    // 提取类
    for (const classDecl of sourceFile.getClasses()) {
      entities.push(this.parseClass(classDecl));
    }

    // 提取接口
    for (const interfaceDecl of sourceFile.getInterfaces()) {
      entities.push(this.parseInterface(interfaceDecl));
    }

    return {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles: [filePath],
      entities,
      relations: this.extractRelations(entities)
    };
  }

  private parseClass(classDecl: ClassDeclaration): Entity {
    return {
      id: this.generateId(classDecl),
      name: classDecl.getName() || 'Anonymous',
      type: classDecl.isAbstract() ? 'abstract_class' : 'class',
      visibility: this.getVisibility(classDecl),
      isAbstract: classDecl.isAbstract(),

      members: [
        ...classDecl.getMethods().map(m => this.parseMethod(m)),
        ...classDecl.getProperties().map(p => this.parseProperty(p))
      ],

      decorators: classDecl.getDecorators().map(d => ({
        name: d.getName(),
        arguments: this.parseDecoratorArgs(d)
      })),

      sourceLocation: {
        file: classDecl.getSourceFile().getFilePath(),
        startLine: classDecl.getStartLineNumber(),
        endLine: classDecl.getEndLineNumber()
      }
    };
  }

  // ... 其他辅助方法
}
```

---

### 3.2 Java 插件 (使用 JavaParser)

```typescript
// plugins/java/index.ts

import { parse } from 'java-parser';
import { ILanguagePlugin } from '../../core/interfaces';

export default class JavaPlugin implements ILanguagePlugin {
  readonly metadata = {
    name: 'java',
    version: '1.0.0',
    displayName: 'Java',
    fileExtensions: ['.java'],
    author: 'Community'
  };

  async parse(filePath: string): Promise<ArchJSON> {
    const source = await fs.readFile(filePath, 'utf-8');
    const ast = parse(source);

    const entities = this.extractEntities(ast);

    return {
      version: '1.0',
      language: 'java',
      timestamp: new Date().toISOString(),
      sourceFiles: [filePath],
      entities,
      relations: this.extractRelations(entities),

      metadata: {
        packageName: this.extractPackageName(ast),
        imports: this.extractImports(ast)
      }
    };
  }

  private extractEntities(ast: any): Entity[] {
    const entities: Entity[] = [];

    // 遍历 AST 提取类
    for (const typeDecl of ast.types || []) {
      if (typeDecl.node === 'ClassDeclaration') {
        entities.push(this.parseJavaClass(typeDecl));
      } else if (typeDecl.node === 'InterfaceDeclaration') {
        entities.push(this.parseJavaInterface(typeDecl));
      }
    }

    return entities;
  }

  private parseJavaClass(classNode: any): Entity {
    return {
      id: classNode.name.identifier,
      name: classNode.name.identifier,
      type: this.isAbstract(classNode) ? 'abstract_class' : 'class',
      visibility: this.parseModifiers(classNode.modifiers),

      members: [
        ...this.parseFields(classNode.bodyDeclarations),
        ...this.parseMethods(classNode.bodyDeclarations)
      ],

      decorators: this.parseAnnotations(classNode.modifiers),

      sourceLocation: {
        file: filePath,
        startLine: classNode.location.startLine,
        endLine: classNode.location.endLine
      },

      metadata: {
        javaSpecific: {
          modifiers: classNode.modifiers,
          extendsClass: classNode.superclassType?.name.identifier,
          implements: classNode.superInterfaceTypes?.map(t => t.name.identifier)
        }
      }
    };
  }

  // ... 其他方法
}
```

---

### 3.3 Python 插件 (使用 AST 模块)

```typescript
// plugins/python/index.ts

import { spawn } from 'child_process';
import { ILanguagePlugin } from '../../core/interfaces';

export default class PythonPlugin implements ILanguagePlugin {
  readonly metadata = {
    name: 'python',
    version: '1.0.0',
    displayName: 'Python',
    fileExtensions: ['.py'],
    author: 'Community'
  };

  async parse(filePath: string): Promise<ArchJSON> {
    // Python AST 解析使用 Python 脚本 + JSON 输出
    const astJson = await this.runPythonParser(filePath);
    return this.convertToArchJSON(astJson, filePath);
  }

  private async runPythonParser(filePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const pythonScript = `
import ast
import json
import sys

with open('${filePath}', 'r') as f:
    tree = ast.parse(f.read())

classes = []
for node in ast.walk(tree):
    if isinstance(node, ast.ClassDef):
        classes.append({
            'name': node.name,
            'bases': [b.id for b in node.bases if isinstance(b, ast.Name)],
            'methods': [
                {
                    'name': m.name,
                    'args': [a.arg for a in m.args.args],
                    'decorators': [d.id for d in m.decorator_list if isinstance(d, ast.Name)]
                }
                for m in node.body if isinstance(m, ast.FunctionDef)
            ],
            'decorators': [d.id for d in node.decorator_list if isinstance(d, ast.Name)],
            'lineno': node.lineno
        })

print(json.dumps({'classes': classes}))
      `;

      const proc = spawn('python3', ['-c', pythonScript]);
      let output = '';

      proc.stdout.on('data', data => output += data);
      proc.on('close', code => {
        if (code === 0) {
          resolve(JSON.parse(output));
        } else {
          reject(new Error(`Python parser exited with code ${code}`));
        }
      });
    });
  }

  private convertToArchJSON(astJson: any, filePath: string): ArchJSON {
    const entities: Entity[] = astJson.classes.map(cls => ({
      id: cls.name,
      name: cls.name,
      type: 'class' as const,
      visibility: this.inferVisibility(cls.name),

      members: cls.methods.map(m => ({
        name: m.name,
        type: 'method' as const,
        visibility: this.inferVisibility(m.name),
        parameters: m.args.map(a => ({ name: a, type: 'Any' })),
        returnType: 'Any'
      })),

      decorators: cls.decorators.map(d => ({ name: `@${d}` })),

      sourceLocation: {
        file: filePath,
        startLine: cls.lineno,
        endLine: cls.lineno + 10 // 近似值
      }
    }));

    return {
      version: '1.0',
      language: 'python',
      timestamp: new Date().toISOString(),
      sourceFiles: [filePath],
      entities,
      relations: this.extractRelations(entities)
    };
  }

  private inferVisibility(name: string): Visibility {
    if (name.startsWith('__')) return 'private';
    if (name.startsWith('_')) return 'protected';
    return 'public';
  }

  // ... 其他方法
}
```

---

### 3.4 Go 插件 (使用 go/parser)

```typescript
// plugins/golang/index.ts

import { execSync } from 'child_process';
import { ILanguagePlugin } from '../../core/interfaces';

export default class GoPlugin implements ILanguagePlugin {
  readonly metadata = {
    name: 'golang',
    version: '1.0.0',
    displayName: 'Go',
    fileExtensions: ['.go'],
    author: 'Community'
  };

  async parse(filePath: string): Promise<ArchJSON> {
    // 使用 Go 工具提取结构信息
    const output = execSync(`go-ast-extractor ${filePath}`).toString();
    const astData = JSON.parse(output);

    return {
      version: '1.0',
      language: 'go',
      timestamp: new Date().toISOString(),
      sourceFiles: [filePath],
      entities: this.parseStructs(astData),
      relations: []
    };
  }

  private parseStructs(astData: any): Entity[] {
    return astData.structs.map(s => ({
      id: s.name,
      name: s.name,
      type: 'struct' as const,
      visibility: s.exported ? 'public' : 'package',

      members: [
        ...s.fields.map(f => ({
          name: f.name,
          type: 'field' as const,
          fieldType: f.type,
          visibility: f.exported ? 'public' : 'private'
        })),
        ...s.methods.map(m => ({
          name: m.name,
          type: 'method' as const,
          visibility: m.exported ? 'public' : 'private',
          parameters: m.params,
          returnType: m.results
        }))
      ],

      sourceLocation: {
        file: filePath,
        startLine: s.pos.line,
        endLine: s.end.line
      },

      metadata: {
        goSpecific: {
          packageName: astData.package,
          receiverType: s.methods.map(m => m.receiver)
        }
      }
    }));
  }
}
```

---

## 4. 实施路线图

### Phase 1: 基础架构 (Week 1-2)
- [ ] 设计并实现 `ILanguagePlugin` 接口
- [ ] 开发 `PluginRegistry` 和自动发现机制
- [ ] 定义 Arch-JSON Schema v1.0

### Phase 2: 首个插件 - TypeScript (Week 3-4)
- [ ] 重构现有 TS-Scanner 为插件
- [ ] 实现完整的 TypeScript 支持
- [ ] 建立自动化测试套件

### Phase 3: 扩展语言支持 (Week 5-10)
- [ ] 开发 Java 插件（使用 java-parser）
- [ ] 开发 Python 插件（使用 Python AST）
- [ ] 开发 Go 插件（使用 go/parser 包装器）

### Phase 4: 社区生态 (Ongoing)
- [ ] 编写插件开发指南
- [ ] 发布插件开发模板
- [ ] 建立插件市场/注册表

---

## 5. 测试策略

### 5.1 单元测试

```typescript
// __tests__/plugins/typescript.test.ts

describe('TypeScriptPlugin', () => {
  let plugin: TypeScriptPlugin;

  beforeEach(() => {
    plugin = new TypeScriptPlugin();
    await plugin.initialize({ workspaceRoot: __dirname });
  });

  it('should parse a simple class', async () => {
    const filePath = '__fixtures__/SimpleClass.ts';
    const result = await plugin.parse(filePath);

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe('UserService');
    expect(result.entities[0].members).toHaveLength(2);
  });

  it('should extract decorators', async () => {
    const filePath = '__fixtures__/DecoratedClass.ts';
    const result = await plugin.parse(filePath);

    expect(result.entities[0].decorators).toContainEqual({
      name: 'Injectable',
      arguments: {}
    });
  });
});
```

### 5.2 跨语言一致性测试

```typescript
// __tests__/cross-language.test.ts

describe('Cross-language consistency', () => {
  const testCases = [
    {
      name: 'Simple class with methods',
      files: {
        typescript: '__fixtures__/ts/SimpleClass.ts',
        java: '__fixtures__/java/SimpleClass.java',
        python: '__fixtures__/py/simple_class.py'
      },
      expectedEntities: 1,
      expectedMethods: 2
    }
  ];

  for (const testCase of testCases) {
    it(`should produce consistent output for: ${testCase.name}`, async () => {
      const results = {};

      for (const [lang, file] of Object.entries(testCase.files)) {
        const plugin = registry.getPluginForFile(file);
        results[lang] = await plugin.parse(file);
      }

      // 验证所有语言提取的实体数量一致
      for (const result of Object.values(results)) {
        expect(result.entities).toHaveLength(testCase.expectedEntities);
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
export default class RustPlugin implements ILanguagePlugin {
  readonly metadata = { /* ... */ };

  async parse(filePath: string): Promise<ArchJSON> {
    // 实现解析逻辑
  }
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

1. **性能优化**: 使用批量解析而非单文件
2. **错误处理**: 捕获并记录解析错误，不阻塞流程
3. **可配置**: 通过 `archguard.config.json` 接受配置
```

---

## 7. 成功指标

| 指标 | 目标 | 测量方法 |
|------|------|---------|
| 支持语言数量 | 5+ | 已发布插件数 |
| 插件开发工作量 | < 3 人日/语言 | 时间跟踪 |
| Arch-JSON 一致性 | > 90% | 跨语言测试通过率 |
| 社区贡献插件 | 3+ | GitHub 插件仓库 |

---

**下一步行动**:
1. 评审 `ILanguagePlugin` 接口设计
2. 创建 TypeScript 插件原型
3. 编写插件开发脚手架工具
