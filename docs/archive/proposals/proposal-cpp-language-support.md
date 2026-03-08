# ArchGuard C++ 语言支持实施建议

**文档版本**: 1.1
**创建日期**: 2026-03-05
**最后修改**: 2026-03-05（架构审查修订）
**分支**: `feat/cpp`
**关联文档**: `docs/dev-guide/plugin-development-guide.md`, `docs/adr/001-goatlas-plugin-composition.md`, `docs/adr/002-archjson-extensions.md`

---

## 1. 执行摘要

本文档规划为 ArchGuard 引入 C++ 语言支持，使其能够分析 C++ 项目的架构结构并生成架构图。

**核心目标：**
- 实现 `ILanguagePlugin` 接口，支持 C++ 项目的解析
- 基于 **Tree-sitter** 完成语法级别的实体提取（类、结构体、函数、命名空间）
- 可选集成 **clangd LSP** 提升跨文件类型推断和继承关系精度
- 生成与其他语言对齐的 ArchJSON，支持 package/class/method 三层图输出
- 支持主流构建系统（CMake、Makefile、Bazel）的项目检测

---

## 2. 技术选型分析

### 2.1 C++ 解析的核心挑战

C++ 是语义最复杂的系统语言之一，解析时面临以下挑战：

| 挑战 | 说明 | 影响 |
|------|------|------|
| 预处理器宏 | `#include`、`#define` 改变代码结构 | 纯 AST 解析结果不完整 |
| 模板元编程 | 模板实例化发生在编译期 | 运行时结构难以静态推断 |
| 隐式继承与多重继承 | `class B : public A, protected C {}` | 关系提取需精确处理 |
| 头文件 / 实现分离 | `.h`/`.hpp` 声明 + `.cpp` 实现 | 实体跨文件需合并 |
| 命名空间嵌套 | `namespace A::B::C {}` | 层级映射复杂 |

### 2.2 推荐方案：Tree-sitter（基础层）+ clangd LSP（增强层）

参照 Go 插件的 Tree-sitter + gopls 混合架构（ADR-001），C++ 插件采用分层方案：

```
┌─────────────────────────────────────────────────────────┐
│                    CppPlugin (Node.js)                   │
├──────────────────────┬──────────────────────────────────┤
│   Tree-sitter Layer  │        clangd Layer (optional)   │
│   - 类/结构体提取    │   - 跨文件类型解析               │
│   - 方法/字段提取    │   - 模板实例化分析               │
│   - 命名空间识别     │   - 虚函数覆盖检测               │
│   - #include 拓扑    │   - 精确继承链还原               │
└──────────────────────┴──────────────────────────────────┘
                         │
                   ArchJSON output
```

**选择 Tree-sitter 作为基础层的理由：**
- `tree-sitter-cpp` 是成熟的社区维护包，Node.js 绑定稳定
- 无需本地编译工具链即可运行（零外部依赖模式）
- 与现有 Go/Java/Python 插件保持技术栈一致

**clangd 作为可选增强层：**
- 与 gopls 集成模式完全对称（可参照 `src/plugins/golang/gopls-client.ts`）
- 通过 `--cpp-lsp` flag 启用，缺失时降级到仅 Tree-sitter
- clangd 是业界标准 C++ LSP，分发广泛

### 2.3 方案对比

| 方案 | 外部依赖 | 精度 | 实现复杂度 |
|------|---------|------|-----------|
| 纯 Tree-sitter | 无 | 语法级（中） | 低 |
| Tree-sitter + clangd | clangd 可选 | 语义级（高） | 中 |
| libclang WASM | 无（但包体大） | 语义级（高） | 高 |
| 调用 clang -ast-dump | clang 必须 | 语义级（高） | 中 |

**结论**：采用 Tree-sitter + 可选 clangd，与 Go 插件架构保持一致。

---

## 3. ArchJSON 映射设计

### 3.1 C++ 概念 → ArchJSON Entity 类型映射

现有 `EntityType`（`src/types/index.ts:75`）已覆盖所有需要的类型，无需新增：

| C++ 构造 | ArchJSON `type` | 说明 |
|---------|----------------|------|
| `class Foo` | `class` | 普通类 |
| `struct Bar` | `struct` | 结构体（默认成员 public，视为 class 变体） |
| `enum class E` | `enum` | 强类型枚举 |
| `enum E` | `enum` | 传统枚举 |
| `template<typename T> class Vec` | `class` | 模板类（名称保留 `Vec<T>` 后缀） |
| `namespace N` | 无 entity，映射到 module | 命名空间 → package 层 |
| 独立全局/静态函数（exported） | `function` | 与 TypeScript 插件对齐 |

### 3.2 C++ 关系 → ArchJSON Relation 类型映射

> **重要约束**：`Relation.source` 和 `Relation.target` 必须是 entity ID（`src/types/index.ts:172`），
> 不能是文件路径。`#include` 是文件级关系，不能直接产生 ArchJSON `Relation`。

| C++ 关系 | ArchJSON `type` | 提取方式 | source/target |
|---------|----------------|---------|--------------|
| `class B : public A` | `inheritance` | Tree-sitter `base_class_clause` | entity ID |
| `class B : private A` | `inheritance` | 同上 | entity ID |
| 成员变量类型引用 | `composition` | 字段类型节点解析 | entity ID |
| 方法参数/返回值类型 | `dependency` | 函数签名节点解析 | entity ID |
| 虚函数覆盖（clangd） | `implementation` | clangd `textDocument/implementation` | entity ID |

`#include "foo.h"` **不**直接映射为 `Relation`。它作为 namespace 间依赖推导的输入
存放在 `RawCppFile.includes[]`，由 `NamespaceGraphBuilder` 消费，结果进入
`CppAnalysis.namespaceGraph`（extension 槽），而非主体 `relations[]`。

clangd 增强产生的关系需要 `inferenceSource: 'clangd'`，因此需在
`src/types/index.ts:178` 的联合类型中新增该字面量：

```typescript
// src/types/index.ts — 修改
inferenceSource?: 'explicit' | 'inferred' | 'gopls' | 'clangd';  // 新增 'clangd'
```

### 3.3 命名空间 → Package 层映射

C++ 没有直接对应 Go 的 package 或 TypeScript 的 module 概念。采用以下策略：

1. **命名空间优先**：有明确命名空间的实体归入对应 package（`ns::SubNs` → `ns/SubNs`）
2. **目录回退**：无命名空间的实体按文件所在目录分组（同 TypeScript 的 `ModuleGraphBuilder`）
3. **头文件合并**：`Foo.h` 声明和 `Foo.cpp` 实现通过「相同命名空间 + 相同类名」匹配后合并为单一实体

---

## 4. 文件结构设计

### 4.1 插件文件

```
src/plugins/cpp/
├── index.ts                      # CppPlugin（ILanguagePlugin 实现）
├── types.ts                      # C++ 专用中间类型（RawCppFile、RawClass 等）
├── tree-sitter-bridge.ts         # Tree-sitter 解析封装
├── archjson-mapper.ts            # MergedCppEntity → ArchJSON 转换
├── dependency-extractor.ts       # CMake/Makefile 第三方库依赖提取（IDependencyExtractor）
├── clangd-client.ts              # clangd LSP 客户端（Phase C，参照 gopls-client.ts）
└── builders/
    ├── class-builder.ts          # 类和结构体提取（从 RawCppFile）
    ├── namespace-graph-builder.ts # 命名空间 → CppNamespaceGraph
    └── header-merger.ts          # .h/.cpp 实体合并（产生 MergedCppEntity）
```

### 4.2 类型变更

**`src/types/index.ts`**：
```typescript
// 现有（:38）
export type SupportedLanguage = 'typescript' | 'go' | 'java' | 'python' | 'rust';
// 修改为
export type SupportedLanguage = 'typescript' | 'go' | 'java' | 'python' | 'rust' | 'cpp';

// 现有（:178）
inferenceSource?: 'explicit' | 'inferred' | 'gopls';
// 修改为
inferenceSource?: 'explicit' | 'inferred' | 'gopls' | 'clangd';
```

**`src/types/extensions.ts`**：新增 C++ 扩展槽，参照 ADR-002：

```typescript
export const CPP_ANALYSIS_VERSION = '1.0';   // 新增版本常量

export interface ArchJSONExtensions {
  goAtlas?: GoAtlasExtension;
  tsAnalysis?: TsAnalysis;
  cppAnalysis?: CppAnalysis;    // NEW — Phase B 引入
}

export interface CppAnalysis {
  version: string;                   // CPP_ANALYSIS_VERSION
  namespaceGraph?: CppNamespaceGraph;
  buildSystem?: 'cmake' | 'makefile' | 'bazel' | 'unknown';
  clangdEnabled: boolean;
}

export interface CppNamespaceGraph {
  nodes: CppNamespaceNode[];
  edges: CppNamespaceDependency[];
  cycles: CppNamespaceCycle[];
}

export interface CppNamespaceNode {
  id: string;        // e.g. "engine/render"
  name: string;      // e.g. "render"
  fileCount: number;
  stats: { classes: number; structs: number; functions: number; enums: number };
}

export interface CppNamespaceDependency {
  from: string;      // namespace id
  to: string;        // namespace id
  strength: number;  // #include 数量
}

export interface CppNamespaceCycle {
  namespaces: string[];
  severity: 'warning' | 'error';
}
```

---

## 5. 核心组件详细设计

### 5.1 CppPlugin（主入口）

```typescript
// src/plugins/cpp/index.ts
import type { IDependencyExtractor } from '@/core/interfaces/dependency.js';
import { DependencyExtractor } from './dependency-extractor.js';

export class CppPlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'cpp',
    version: '1.0.0',
    displayName: 'C++',
    fileExtensions: ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hxx', '.h++'],
    // 注意：'.h' 故意排除在外（与 C 项目共用，不能仅凭扩展名判断）
    // 项目检测改用构建系统标记文件（见 DETECTION_RULES）
    author: 'ArchGuard Team',
    repository: 'https://github.com/archguard/archguard',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: false,  // .h/.cpp 合并需要完整项目上下文，同 Go 插件
      dependencyExtraction: true,
      typeInference: false,       // Tree-sitter 层：语法级，无类型推断
                                  // Phase C 启用 clangd 后改为 true
    },
  };

  // 与 ILanguagePlugin 接口对齐（:168）
  readonly supportedLevels = ['package', 'class', 'method'] as const;

  // capabilities.dependencyExtraction = true → 必须声明（参照 GoPlugin:54）
  readonly dependencyExtractor: IDependencyExtractor;

  private treeSitter!: TreeSitterBridge;
  private merger!: HeaderMerger;
  private mapper!: ArchJsonMapper;
  private clangdClient: ClangdClient | null = null;   // null 模式，参照 GoPlugin:59
  private initialized = false;
  private workspaceRoot = '';

  constructor() {
    this.dependencyExtractor = new DependencyExtractor();
  }

  async initialize(config: PluginInitConfig): Promise<void> { ... }
  canHandle(targetPath: string): boolean { ... }

  // 暴露原始数据，为未来 CppAtlas 组合预留（ADR-001 模式）
  async parseToRawData(workspaceRoot: string, config: ParseConfig): Promise<CppRawData> { ... }

  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> { ... }
  parseCode(code: string, filePath?: string): ArchJSON { ... }
  async dispose(): Promise<void> { ... }
}
```

**项目检测逻辑（`canHandle`）**：

优先级：构建系统标记 > 无歧义扩展名（`.hpp`、`.cpp` 等）。`.h` 不单独作为检测触发条件。

```typescript
canHandle(targetPath: string): boolean {
  const ext = path.extname(targetPath).toLowerCase();
  // 无歧义的 C++ 扩展名
  if (['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hxx', '.h++'].includes(ext)) {
    return true;
  }
  // 目录：检查构建系统标记
  try {
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
      return (
        fs.existsSync(path.join(targetPath, 'CMakeLists.txt')) ||
        fs.existsSync(path.join(targetPath, 'Makefile'))       ||
        fs.existsSync(path.join(targetPath, 'BUILD'))          ||
        fs.existsSync(path.join(targetPath, 'WORKSPACE'))
      );
    }
  } catch { return false; }
  return false;
}
```

### 5.2 插件注册

**不存在 `src/plugins/index.ts` 或 `PLUGIN_REGISTRY` 常量**。
实际注册机制是 `PluginRegistry`（`src/core/plugin-registry.ts`）。需修改两处：

**A. 在应用启动时注册插件**（找到调用 `registry.register()` 的位置，添加）：
```typescript
registry.register(new CppPlugin());
```

**B. 在 `PluginRegistry.DETECTION_RULES`（`:142`）添加 C++ 项目标记**：

```typescript
private static readonly DETECTION_RULES: Array<{ file: string; plugin: string }> = [
  { file: 'go.mod',          plugin: 'golang'     },
  { file: 'package.json',    plugin: 'typescript' },
  { file: 'tsconfig.json',   plugin: 'typescript' },
  { file: 'pom.xml',         plugin: 'java'       },
  { file: 'build.gradle',    plugin: 'java'       },
  { file: 'pyproject.toml',  plugin: 'python'     },
  { file: 'requirements.txt',plugin: 'python'     },
  { file: 'setup.py',        plugin: 'python'     },
  { file: 'CMakeLists.txt',  plugin: 'cpp'        },  // NEW
  { file: 'Makefile',        plugin: 'cpp'        },  // NEW（低优先级：排在最后）
];
```

注意：Makefile 排在末位是因为多语言项目也可能有 Makefile，CMakeLists.txt 更具专一性。

### 5.3 TreeSitterBridge

参照 `src/plugins/golang/tree-sitter-bridge.ts`，方法名对齐（Go 插件用 `parseCode`，不用 `parseFile`）：

```typescript
export class TreeSitterBridge {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Cpp);    // tree-sitter-cpp
  }

  // 注意：Go 插件对应方法是 parseCode()，保持一致
  parseCode(code: string, filePath: string): RawCppFile {
    const tree = this.parser.parse(code);
    return {
      filePath,
      classes:    this.extractClasses(tree.rootNode),
      structs:    this.extractStructs(tree.rootNode),
      functions:  this.extractFunctions(tree.rootNode),
      namespaces: this.extractNamespaces(tree.rootNode),
      includes:   this.extractIncludes(tree.rootNode),  // 仅用于 namespace 图，不产生 Relation
      enums:      this.extractEnums(tree.rootNode),
    };
  }
}
```

**关键 Tree-sitter 节点类型**（`tree-sitter-cpp` grammar）：

| 目标构造 | Tree-sitter 节点类型 |
|---------|---------------------|
| 类定义 | `class_specifier` |
| 结构体定义 | `struct_specifier` |
| 函数定义 | `function_definition` |
| 函数声明 | `declaration`（含 `function_declarator`） |
| 命名空间 | `namespace_definition` |
| 继承基类 | `base_class_clause` |
| `#include` | `preproc_include` |
| 枚举 | `enum_specifier` |
| 模板声明 | `template_declaration`（包裹 `class_specifier`） |

### 5.4 HeaderMerger

头文件/实现文件分离是 C++ 特有问题。合并键为 `(qualifiedNamespace + className)`，
以应对同目录下同名但不同命名空间类的歧义：

```typescript
// src/plugins/cpp/builders/header-merger.ts
export class HeaderMerger {
  merge(files: RawCppFile[]): MergedCppEntity[] {
    // 1. 按 qualifiedName（命名空间全限定类名）建立索引
    //    key = `${namespace}::${className}` 或 `${className}`（无命名空间时）
    // 2. 头文件（.h/.hpp 等）贡献声明：visibility、继承关系、字段类型
    // 3. 实现文件（.cpp/.cc 等）贡献方法体：方法参数、返回类型
    // 4. 同名 qualifiedName 合并：方法列表取并集（按 signature 去重）
    // 5. sourceLocation 以头文件为准（定义位置）
  }

  private isHeaderFile(filePath: string): boolean {
    return ['.h', '.hpp', '.hxx', '.h++'].includes(path.extname(filePath).toLowerCase());
  }
}
```

### 5.5 NamespaceGraphBuilder

```typescript
// src/plugins/cpp/builders/namespace-graph-builder.ts
export class NamespaceGraphBuilder {
  build(files: RawCppFile[], entities: MergedCppEntity[]): CppNamespaceGraph {
    // 1. 每个 entity 映射到最近命名空间（或目录路径回退）
    // 2. 构建 namespace → entity[] 索引
    // 3. 从 RawCppFile.includes[] 推导 namespace 间 include 关系
    //    （#include 路径 → 解析到头文件 → 所属 namespace → 产生 CppNamespaceDependency）
    // 4. DFS 检测循环依赖
    // 输出：CppNamespaceGraph，进入 ArchJSON.extensions.cppAnalysis
  }
}
```

### 5.6 ClangdClient（Phase C，可选）

参照 `src/plugins/golang/gopls-client.ts` 的 LSP 通信模式，包括：
进程管理、JSON-RPC framing、请求 ID 管理、pending request Map、超时处理。

```typescript
// src/plugins/cpp/clangd-client.ts
export class ClangdClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pendingRequests = new Map<number, { resolve; reject; timer }>();
  private messageBuffer = '';
  private initialized = false;
  private workspaceRoot = '';

  async initialize(workspaceRoot: string, compileDbPath?: string): Promise<void> {
    // 启动 clangd [--compile-commands-dir=<compileDbPath>]
    // 发送 initialize 请求（需要 rootUri）
    // 若 clangd 不可用，抛出以便调用方降级
  }

  isInitialized(): boolean { return this.initialized; }

  async getVirtualOverrides(uri: string, line: number, character: number): Promise<string[]> {
    // textDocument/implementation → 虚函数覆盖实现列表
  }

  async getTypeAtPosition(uri: string, line: number, character: number): Promise<string | null> {
    // textDocument/hover → 精确类型名
  }

  static async isAvailable(): Promise<boolean> {
    // execSync('which clangd') → boolean
  }

  async dispose(): Promise<void> { ... }
}
```

**降级策略**（与 GoPlugin 完全一致，`src/plugins/golang/index.ts:79-88`）：

```typescript
// CppPlugin.initialize() 内
try {
  this.clangdClient = new ClangdClient();
  // 实际初始化（含工作区根路径）在 parseProject() 中执行，同 gopls
} catch {
  console.warn('clangd not available, using Tree-sitter only mode');
  this.clangdClient = null;
}
```

---

## 6. CLI 集成

### 6.1 新增 `--lang cpp` 支持

`SupportedLanguage` 已在第 4 节说明（`src/types/index.ts`）。插件注册已在 5.2 节说明。

`--lang` 值 `'cpp'` 与 `metadata.name: 'cpp'` 必须完全一致，以通过
`PluginRegistry.getByName(lang)` 查找插件（区别于 Go：`--lang go` → `metadata.name: 'golang'`，
需要在 analyze 命令中做 `go` → `golang` 的映射；C++ 直接对齐，无需额外映射）。

### 6.2 新增 CLI flags

**`src/types/config.ts` 的 `CLIOptions` 接口**（参照 `:539-557` 的 Atlas 条目）新增：

```typescript
// ========== C++ clangd 增强 ==========

/** 启用 clangd 语义增强（Phase C，默认关闭） */
cppLsp?: boolean;

/** compile_commands.json 所在目录（clangd 需要，默认自动检测） */
cppCompileDb?: string;
```

CLI 命令行参数：

```bash
# 启用 clangd 语义增强
node dist/cli/index.js analyze -s ./src --lang cpp --cpp-lsp

# 指定 compile_commands.json 路径
node dist/cli/index.js analyze -s ./src --lang cpp --cpp-lsp --cpp-compile-db ./build
```

| Flag | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--cpp-lsp` | boolean | `false` | 启用 clangd 语义增强（Phase C） |
| `--cpp-compile-db <path>` | string | 自动检测（`./build`、项目根） | `compile_commands.json` 所在目录 |

---

## 7. 测试策略

### 7.1 测试文件结构

```
tests/plugins/cpp/
├── tree-sitter-bridge.test.ts       # 单元：AST 节点提取
├── archjson-mapper.test.ts          # 单元：实体/关系映射
├── header-merger.test.ts            # 单元：头文件合并逻辑
├── namespace-graph-builder.test.ts  # 单元：命名空间图构建
├── cpp-plugin.test.ts               # 集成：完整插件流程
└── fixtures/
    ├── basic/
    │   ├── single-class.hpp         # 单一类
    │   ├── inheritance.hpp          # 单继承、多继承
    │   └── namespace.cpp            # 命名空间嵌套
    ├── advanced/
    │   ├── templates.hpp            # 模板类（简单）
    │   ├── header-impl/             # .h + .cpp 分离示例
    │   │   ├── Foo.h
    │   │   └── Foo.cpp
    │   └── cross-file/              # 跨文件继承
    └── edge-cases/
        ├── empty.cpp
        ├── macros.hpp               # 宏定义干扰
        └── anonymous-namespace.cpp
```

### 7.2 关键测试用例

**Tree-sitter 提取（基础）**：
- `class Foo {}` → 1 个 `class` entity，`id: 'path/to/file.hpp.Foo'`（scoped ID 格式）
- `struct Bar {}` → 1 个 `struct` entity
- `class B : public A {}` → 1 个 `inheritance` relation，`source: B's ID`，`target: A's ID`
- `class C : public A, protected B {}` → 2 个 `inheritance` relations
- `namespace N { class X {} }` → entity 归入命名空间 `N`
- `#include "bar.h"` → **不**产生 ArchJSON Relation；只进入 `RawCppFile.includes[]`
- `template<typename T> class Vec {}` → 1 个 `class` entity（`name: Vec<T>`）

**头文件合并**：
- `Foo.h`（声明含 `void doWork()`）+ `Foo.cpp`（实现 `Foo::doWork()`）→ 合并为单一 entity，方法列表完整
- 同名不同命名空间类（`ns1::Foo` vs `ns2::Foo`）→ 保持独立，不合并

**命名空间图**：
- 3 个不同命名空间各含多个类 → `CppNamespaceGraph.nodes` 含 3 个节点
- `#include` 关系推导出 namespace 间边 → `CppNamespaceGraph.edges` 正确填充

**降级行为**：
- clangd 不可用时，`CppPlugin.initialize()` 不抛出，`clangdClient` 为 `null`
- `parseProject()` 正常执行，不依赖 clangd 路径

**capabilities 一致性**：
- `incrementalParsing: false` → `parseFiles()` 方法可不实现（或直接调用 `parseProject`）

---

## 8. 实施阶段

```
Phase A（基础解析）
  ├─ types.ts：RawCppFile、RawClass、CppRawData 等中间类型
  ├─ tree-sitter-bridge.ts：AST 解析，parseCode()
  ├─ builders/header-merger.ts：.h/.cpp 合并
  ├─ archjson-mapper.ts：MergedCppEntity → ArchJSON entities/relations
  ├─ dependency-extractor.ts：IDependencyExtractor（CMake 第三方库依赖）
  ├─ index.ts：CppPlugin 框架（initialize/canHandle/parseProject/parseCode/dispose）
  ├─ src/types/index.ts：SupportedLanguage 新增 'cpp'
  └─ src/core/plugin-registry.ts：DETECTION_RULES 新增 CMakeLists.txt/Makefile

Phase B（命名空间包图）
  ├─ builders/namespace-graph-builder.ts：#include 拓扑 → CppNamespaceGraph
  ├─ src/types/extensions.ts：CPP_ANALYSIS_VERSION、CppAnalysis 及相关类型
  └─ package 层 Mermaid 渲染接入（读取 extensions.cppAnalysis.namespaceGraph）

Phase C（语义增强，可选）
  ├─ clangd-client.ts：LSP 通信（参照 gopls-client.ts 的 framing/retry 模式）
  ├─ 虚函数覆盖检测 → implementation relation（inferenceSource: 'clangd'）
  ├─ src/types/index.ts：inferenceSource 联合类型新增 'clangd'
  └─ src/types/config.ts：CLIOptions 新增 cppLsp / cppCompileDb
```

**阶段依赖**：
```
Phase A（必须先完成）→ Phase B → Phase C（C 独立可选，不阻塞 A/B 发布）
```

Phase B 依赖 Phase A 的 `RawCppFile.includes[]` 数据。
Phase C 不影响 Phase A/B 的输出格式，可后续独立集成。

---

## 9. 超出范围（本提案不包含）

以下内容明确推迟到后续提案：

- **模板特化分析**：需要 clangd 或完整编译期展开，超出静态分析范围
- **宏展开语义**：`#define` 展开后的代码结构变化（需要预处理器）
- **CMake 依赖图解析**：解析 `target_link_libraries` 以提取库间依赖（超出 IDependencyExtractor 当前接口范围）
- **C++20 Modules 支持**：`import module;` 语法；tree-sitter-cpp 对 C++20 新特性支持有限
- **CppAtlas（C++ 架构图谱）**：类比 GoAtlas 的深度分析（RAII 拓扑、线程模型、信号/槽），超出本 proposal 范围

---

## 10. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解策略 |
|------|--------|------|---------|
| tree-sitter-cpp 对复杂宏/模板解析不准确 | 高 | 中 | 标记为语法级精度，文档说明局限性 |
| `.h` 文件被 `canHandle()` 误匹配 C 项目 | 高 | 中 | `.h` 从 `fileExtensions` 排除；项目检测优先构建系统标记 |
| clangd 版本差异导致 LSP 响应不兼容 | 中 | 低 | clangd 为可选项，降级透明；锁定最低版本（clangd 14+） |
| 大型 C++ 项目（10k+ 文件）解析超时 | 中 | 中 | 并发解析（concurrency 参数复用），超时时输出部分结果并告警 |
| HeaderMerger 同名类误合并 | 中 | 高 | 合并键使用全限定命名空间+类名，无命名空间时加文件目录路径区分 |

---

## 11. 参考

- [ADR-001: GoAtlas Plugin Composition](../adr/001-goatlas-plugin-composition.md)
- [ADR-002: ArchJSON Extensions](../adr/002-archjson-extensions.md)
- [Plugin Development Guide](../dev-guide/plugin-development-guide.md)
- [Go Language Support Proposal v3.2](../archive/refactoring/proposals/15-golang-support-proposal.md)
- `src/core/plugin-registry.ts` — 实际插件注册机制
- `src/plugins/golang/index.ts` — GoPlugin 实现参照（null/非 optional 模式、parseToRawData）
- `src/plugins/golang/gopls-client.ts` — LSP 客户端实现参照
- `src/types/index.ts` — SupportedLanguage、Relation.inferenceSource 定义
- `src/types/extensions.ts` — ArchJSONExtensions 容器、版本常量模式
- [tree-sitter-cpp grammar](https://github.com/tree-sitter/tree-sitter-cpp)
- [clangd Language Server Protocol](https://clangd.llvm.org/extensions)
