# Plan 57: Kotlin/Android Plugin

## 目标

实现 `KotlinPlugin`，通过 `@tree-sitter-grammars/tree-sitter-kotlin` 解析 `.kt` 文件，为 Kotlin/Android 项目生成 `package`（flowchart LR）和 `class`（classDiagram）两个层级的架构图，并通过 `PluginRegistry` 自动检测 Kotlin 项目（`build.gradle.kts` / `settings.gradle.kts`）。验证目标为 AndroidMotty（90 个 Kotlin 文件，MVVM + Clean Architecture）。

## 范围

**本 Plan 覆盖阶段 1（KotlinPlugin 基础实现）**，包括：

- `@tree-sitter-grammars/tree-sitter-kotlin` 接入
- `KotlinPlugin` 全部核心方法（含 `dispose`、`parseFiles`、`isTestFile`、`extractTestStructure`）
- `detectKotlinProjectStructure`（Gradle 多模块支持）
- CLI 路由接入（`normalize-to-diagrams.ts`）
- `SupportedLanguage` 和 `DependencyType` 类型扩展
- `PluginRegistry` 检测规则（`build.gradle.kts` 优先于 `build.gradle`）
- 测试覆盖率目标 ≥ 80%

**超出本 Plan 范围**（阶段 2/3）：

- `src/plugins/kotlin/android/` 目录（`AndroidManifest.xml` 解析、四大组件检测、多模块 Gradle 依赖图）
- `supportedLevels` 追加 `'android-component'`
- Hilt/Koin DI 关系图、Room 实体关系图、Navigation 图

---

## Phase 列表

- **Phase 1**：基础设施与类型定义（Stage 1.1 ~ 1.2）
- **Phase 2**：AST 解析核心（Stage 2.1 ~ 2.3）
- **Phase 3**：ArchJSON 映射与依赖提取（Stage 3.1 ~ 3.2，含 Stage 3.1b KotlinTypeExtractor）
- **Phase 4**：插件入口与 CLI 接入（Stage 4.1 ~ 4.2，含 Stage 4.1b 项目结构探测器）

---

## Phase 1：基础设施与类型定义

### Stage 1.1：npm 依赖、类型扩展、PluginRegistry

**目标**：完成零代码逻辑的基础设施变更，使 TypeScript 编译器认识 `'kotlin'` 语言和 `'gradle-kts'` 依赖类型。

**文件变更**：

1. **`package.json`** — 添加依赖
   ```
   "@tree-sitter-grammars/tree-sitter-kotlin": "^1.1.0"
   ```
   安装命令：`npm install @tree-sitter-grammars/tree-sitter-kotlin@^1.1.0 --legacy-peer-deps`

2. **`src/types/index.ts`**（第 55 行）— `SupportedLanguage` 追加 `'kotlin'`
   ```typescript
   export type SupportedLanguage = 'typescript' | 'go' | 'java' | 'python' | 'rust' | 'cpp' | 'kotlin';
   ```

3. **`src/core/interfaces/dependency.ts`**（第 8 行）— `DependencyType` 追加 `'gradle-kts'`
   ```typescript
   export type DependencyType = 'npm' | 'gomod' | 'pip' | 'maven' | 'cargo' | 'cmake' | 'gradle-kts';
   ```

4. **`src/core/plugin-registry.ts`**（第 142 行 `DETECTION_RULES`）— 在 `pom.xml` 之后、`build.gradle` 之前插入
   ```typescript
   { file: 'build.gradle.kts', plugin: 'kotlin' },
   { file: 'settings.gradle.kts', plugin: 'kotlin' },
   ```

**验收标准**：
- `npm run type-check` 无新增错误
- `npm test` 全量测试通过（原有测试不受影响）
- `PluginRegistry.detectPluginForDirectory` 对含 `build.gradle.kts` 的目录返回 `'kotlin'`（需等 Stage 4.1 注册插件后才能集成测试，本阶段只验证规则顺序正确性）

**估计代码量**：约 10 行（4 个文件各 1-3 行）

---

### Stage 1.2：Kotlin 插件类型定义（types.ts）

**目标**：先写测试（TDD），再定义 Kotlin 插件的原始 AST 数据类型。

**Step 1（测试先行）** — 新建 `tests/unit/plugins/kotlin/types.test.ts`
- 验证 `RawKotlinFile`、`RawKotlinClass`、`RawKotlinFunction` 接口的字段完整性（类型检查测试）
- 验证 `KotlinClassKind`、`KotlinVisibility` 枚举值覆盖
- 约 30-40 行

**Step 2（实现）** — 新建 `src/plugins/kotlin/types.ts`

核心类型（参照 `src/plugins/cpp/types.ts` 结构）：

```typescript
// Kotlin 类的种类
export type KotlinClassKind =
  | 'class'
  | 'abstract_class'
  | 'interface'
  | 'data_class'
  | 'sealed_class'
  | 'sealed_interface'
  | 'object'
  | 'companion_object'
  | 'enum_class';

export type KotlinVisibility = 'public' | 'private' | 'protected' | 'internal';

export interface RawKotlinMember {
  name: string;
  kind: 'field' | 'method';
  visibility: KotlinVisibility;
  type?: string;           // 字段类型 / 返回类型
  isStatic: boolean;       // companion object 成员
  decorators: string[];    // 注解名称列表（如 '@Composable'）
  startLine: number;
  endLine: number;
}

export interface RawKotlinClass {
  name: string;
  kind: KotlinClassKind;
  visibility: KotlinVisibility;
  packageName: string;     // 从 package 语句提取
  superTypes: string[];    // ':' 后面的所有父类/接口名
  members: RawKotlinMember[];
  decorators: string[];    // 类级别注解
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface RawKotlinFunction {
  name: string;
  visibility: KotlinVisibility;
  packageName: string;
  isComposable: boolean;   // 有 @Composable 注解
  returnType?: string;
  paramTypes: string[];
  decorators: string[];
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface RawKotlinImport {
  path: string;            // 完整 import 路径
  alias?: string;
}

export interface RawKotlinFile {
  filePath: string;
  packageName: string;     // '' 表示默认包
  imports: RawKotlinImport[];
  classes: RawKotlinClass[];
  functions: RawKotlinFunction[];  // 顶层函数
}
```

**验收标准**：
- `tests/unit/plugins/kotlin/types.test.ts` 全部通过
- `npm run type-check` 无错误

**估计代码量**：实现约 70 行，测试约 40 行，合计约 110 行

---

## Phase 2：AST 解析核心

### Stage 2.1：ClassBuilder 测试与实现

**目标**：实现从 tree-sitter AST 节点提取 Kotlin 类/接口/data class/sealed/object/companion。

**Step 1（测试先行）** — 新建 `tests/unit/plugins/kotlin/class-builder.test.ts`

使用内联 Kotlin 代码字符串作为 fixture（无需文件 I/O），覆盖以下场景：
- `data class Foo(val name: String, val id: Int)` → `kind: 'data_class'`，members 含 2 个 field
- `sealed interface Result` → `kind: 'sealed_interface'`，`decorators` 含 `'sealed'`
- `class Foo : Bar(), IBar` → `superTypes: ['Bar', 'IBar']`
- `object Singleton` → `kind: 'object'`
- `companion object` → `kind: 'companion_object'`，成员 `isStatic: true`
- `enum class Status { ACTIVE, INACTIVE }` → `kind: 'enum_class'`，2 个 field member
- `abstract class Base` → `kind: 'abstract_class'`
- `@Composable fun Screen()` 顶层函数 → 不被 ClassBuilder 处理（留给 FunctionBuilder）
- 约 120-150 行

**Step 2（实现）** — 新建 `src/plugins/kotlin/builders/class-builder.ts`

关键实现点：
- 初始化 tree-sitter Parser + `@tree-sitter-grammars/tree-sitter-kotlin`
- 遍历 `class_declaration`、`object_declaration`、`enum_class_body` 等 AST 节点
- `primary_constructor` 参数 → `kind: 'field'`（data class 核心）
- `:` 后面区分类（带 `()`）和接口（无 `()`）填入 `superTypes`
- 注解收集：遍历 `annotation` 子节点
- 对未知节点类型 `console.warn` + 跳过

**验收标准**：
- `tests/unit/plugins/kotlin/class-builder.test.ts` 全部通过
- 覆盖率 ≥ 80%（对 class-builder.ts）

**估计代码量**：实现约 150 行，测试约 130 行，合计约 280 行

> **拆分说明**：合计 280 行接近但未超出 300 行单文件上限，暂不拆分。若实现中发现 `class-builder.ts` 超出 150 行（Kotlin 高级语法节点增多），可将 `companion object` 成员合并逻辑提取为独立辅助函数 `companion-merger.ts`，保持 class-builder.ts ≤ 150 行。

---

### Stage 2.2：TreeSitterBridge + ImportResolver 测试与实现

**目标**：实现文件级别 AST 解析（`tree-sitter-bridge.ts`）和 import 解析（`import-resolver.ts`）。

**Step 1（测试先行）** — 新建 `tests/unit/plugins/kotlin/import-resolver.test.ts` 和桥接测试

`import-resolver.test.ts`（约 40 行）：
- `import com.example.app.data.UserRepository` + moduleRoot `com.example.app` → 内部路径 `data/UserRepository`
- `import android.os.Bundle` → 过滤（外部依赖，非项目内部）
- `import com.squareup.okhttp3.OkHttpClient` → 过滤

树桥接集成测试放在 `tests/unit/plugins/kotlin/kotlin-tree-sitter-bridge.test.ts`（约 80 行）：
- 解析包含 `package com.example.app` 的 Kotlin 文件 → `packageName: 'com.example.app'`
- import 语句正确解析
- 顶层 data class、object、top-level function 均被提取
- 解析失败时不抛出异常（降级处理）

**Step 2（实现）**

**`src/plugins/kotlin/builders/import-resolver.ts`**（约 40 行）：
```typescript
export class ImportResolver {
  /**
   * 判断 import 是否为项目内部 import（moduleRoot 为项目包前缀）
   */
  isInternal(importPath: string, moduleRoot: string): boolean

  /**
   * 将内部 import 路径转换为相对目录路径
   * 'com.example.app.data.UserRepository' + 'com.example.app' → 'data/UserRepository'
   */
  toRelativePath(importPath: string, moduleRoot: string): string
}
```

**`src/plugins/kotlin/tree-sitter-bridge.ts`**（约 120 行）：
- `const KotlinLanguage = require('@tree-sitter-grammars/tree-sitter-kotlin')` — 注意包名
- `parseCode(code: string, filePath: string): RawKotlinFile`
  - 提取 `package_header` → `packageName`
  - 提取 `import_list` → `imports[]`
  - 调用 `ClassBuilder` 提取 `classes[]`
  - 提取顶层 `function_declaration` → `functions[]`（含 `@Composable` 检测）

**验收标准**：
- 两个测试文件全部通过
- 覆盖率 ≥ 80%（对 tree-sitter-bridge.ts、import-resolver.ts）

**估计代码量**：实现约 160 行，测试约 120 行，合计约 280 行

---

### Stage 2.3：FunctionBuilder（可选顶层函数提取）

**目标**：将顶层函数提取逻辑从 tree-sitter-bridge.ts 中分离，便于阶段 2 的 `@Composable` 扩展。

> **说明**：本 Stage 代码量较小，可与 Stage 2.2 合并实现。若 Stage 2.2 代码量已接近限额，则单独实现。

**Step 1（测试先行）** — 新建 `tests/unit/plugins/kotlin/function-builder.test.ts`（约 50 行）：
- `fun topLevel()` → `isComposable: false`
- `@Composable fun Screen(modifier: Modifier)` → `isComposable: true`，`paramTypes: ['Modifier']`
- `private fun helper(): String` → `visibility: 'private'`，`returnType: 'String'`

**Step 2（实现）** — 新建 `src/plugins/kotlin/builders/function-builder.ts`（约 60 行）

**验收标准**：
- `tests/unit/plugins/kotlin/function-builder.test.ts` 全部通过

**估计代码量**：实现约 60 行，测试约 50 行，合计约 110 行

---

## Phase 3：ArchJSON 映射与依赖提取

### Stage 3.1：ArchJsonMapper 测试与实现

**目标**：将 `RawKotlinFile[]` 映射为 `Entity[]` 和 `Relation[]`。

**Step 1（测试先行）** — 新建 `tests/unit/plugins/kotlin/archjson-mapper.test.ts`（约 150 行）

覆盖场景（使用内联 `RawKotlinFile[]` 构造，不调用 TreeSitterBridge）：

- **实体类型映射**：
  - `data class` → `EntityType: 'class'`，`decorators: [{name: 'data'}]`
  - `sealed interface` → `EntityType: 'interface'`，`decorators: [{name: 'sealed'}]`
  - `object Singleton` → `EntityType: 'class'`，`decorators: [{name: 'object'}]`
  - `enum class Status` → `EntityType: 'enum'`
  - `abstract class Base` → `EntityType: 'abstract_class'`，`isAbstract: true`
  - `@Composable fun Screen()` → `EntityType: 'function'`（阶段 1 存入 ArchJSON 但渲染时过滤）

- **关系提取**：
  - `class Foo : Bar()` → `RelationType: 'inheritance'`，source: Foo，target: Bar
  - `class Foo : IBar` → `RelationType: 'implementation'`
  - `class Foo : Bar(), IBar` → 同时产出 inheritance + implementation
  - `data class Foo(val repo: UserRepository)` → `RelationType: 'composition'`（非原始类型字段）
  - `data class Foo(val name: String)` → 无关系（String 为 Kotlin 原始/标准类型，过滤）
  - 跨包关系包含包前缀（Entity ID 格式：`package.ClassName`）

- **Entity ID 格式**：
  - `packageName: 'com.example.app.data'` + `name: 'UserRepository'` → ID: `com.example.app.data.UserRepository`

**Step 2（实现）** — 新建 `src/plugins/kotlin/archjson-mapper.ts`（约 160 行）

参照 `src/plugins/cpp/archjson-mapper.ts` 和 `BaseArchJsonMapper`：

- `mapEntities(files: RawKotlinFile[]): Entity[]`
  - 遍历每个文件的 classes 和 functions
  - `EntityType` 映射逻辑（见 Proposal 表 3.6）
  - `companion object` 合并到宿主类的 static members，不单独作为实体
  - `primary constructor` 参数 → `MemberType: 'field'`

- `mapRelations(files: RawKotlinFile[], entities: Entity[]): Relation[]`
  - 继承/实现：通过 `superTypes` 区分（带 `()` → 继承，无 `()` → 实现）
  - 组合/聚合：调用 `KotlinTypeExtractor`（Stage 3.1b）处理字段类型，过滤原始类型和标准库集合类型
  - 依赖：函数参数和返回类型中的项目内部类型
  - `KOTLIN_PRIMITIVE_TYPES` 常量定义在 `kotlin-type-extractor.ts` 中，本文件通过 import 引入

> **注意**：`mapRelations` 中的字段类型分析逻辑委托给 `KotlinTypeExtractor`（在 Stage 3.1b 中实现）。Stage 3.1 的 `archjson-mapper.ts` 对 `KotlinTypeExtractor` 声明依赖，Stage 3.1b 完成后才能运行完整的集成测试。

**验收标准**：
- `tests/unit/plugins/kotlin/archjson-mapper.test.ts` 全部通过
- 覆盖率 ≥ 80%（对 archjson-mapper.ts）

**估计代码量**：实现约 100 行，测试约 100 行，合计约 200 行（字段类型分析逻辑拆出至 Stage 3.1b）

> **拆分说明（已执行）**：310 行超出 200 行单 Stage 上限。强制执行拆分：将 `mapRelations` 中的字段组合/聚合类型分析逻辑提取为独立文件 `src/plugins/kotlin/kotlin-type-extractor.ts`（参照 `src/plugins/cpp/cpp-type-extractor.ts`），对应测试文件为 `tests/unit/plugins/kotlin/kotlin-type-extractor.test.ts`。拆分后 Stage 3.1 仅包含 `archjson-mapper.ts`（约 100 行实现 + 100 行测试），`kotlin-type-extractor.ts` 及其测试单独形成 **Stage 3.1b**（约 60 行实现 + 50 行测试）。

---

### Stage 3.1b：KotlinTypeExtractor 测试与实现

**目标**：将字段类型分析（组合/聚合分类、原始类型过滤）逻辑提取为独立模块，供 `archjson-mapper.ts` 调用，同时对应 `CppTypeExtractor` 的设计模式。

**前置依赖**：Stage 3.1（`archjson-mapper.ts` 定义了调用接口）

**Step 1（测试先行）** — 新建 `tests/unit/plugins/kotlin/kotlin-type-extractor.test.ts`（约 50 行）

覆盖场景：
- `UserRepository`（非原始类型）→ 需建立关系
- `String`、`Int`、`Boolean`、`List`、`Map`、`Pair` → 过滤（`KOTLIN_PRIMITIVE_TYPES` 集合命中）
- `val repo: UserRepository` → `classifyFieldRelation` → `'composition'`
- `val items: List<Order>` → 泛型解包 → `Order` 需建立关系
- `val ref: UserRepository?` → nullable 解包（去掉 `?`）→ `'composition'`

**Step 2（实现）** — 新建 `src/plugins/kotlin/kotlin-type-extractor.ts`（约 60 行）

```typescript
export const KOTLIN_PRIMITIVE_TYPES = new Set([
  'String', 'Int', 'Long', 'Double', 'Float', 'Boolean', 'Byte', 'Short', 'Char',
  'Unit', 'Any', 'Nothing', 'Number',
  'List', 'MutableList', 'Map', 'MutableMap', 'Set', 'MutableSet',
  'Array', 'Pair', 'Triple', 'Sequence',
  'InputStream', 'OutputStream', 'ByteArray', 'IntArray',
]);

export class KotlinTypeExtractor {
  /** 解包泛型/nullable 后提取实际类型名，过滤原始类型 */
  extractTypes(rawType: string): string[]

  /** 字段类型 → 'composition'（默认；Kotlin 无裸指针）*/
  classifyFieldRelation(rawType: string): 'composition'
}
```

**验收标准**：
- `tests/unit/plugins/kotlin/kotlin-type-extractor.test.ts` 全部通过
- `npm run type-check` 无错误

**估计代码量**：实现约 60 行，测试约 50 行，合计约 110 行

---

### Stage 3.2：DependencyExtractor 测试与实现

**目标**：解析 `build.gradle.kts`，使用正则表达式提取依赖声明。

**Step 1（测试先行）** — 新建 `tests/unit/plugins/kotlin/dependency-extractor.test.ts`（约 80 行）

覆盖场景：
- `implementation("com.squareup.okhttp3:okhttp:4.12.0")` → `{group, artifact, version, type: 'gradle-kts', scope: 'implementation'}`
- `testImplementation(libs.junit)` → `{name: 'libs.junit', type: 'gradle-kts', scope: 'testImplementation'}`（symbolic reference）
- `androidTestImplementation("androidx.test.ext:junit:1.1.5")` → scope: `'androidTestImplementation'`
- `implementation(libs.androidx.core.ktx)` → symbolic reference，名称 `libs.androidx.core.ktx`
- 注释行 `// implementation("foo:bar:1.0")` → 不匹配
- `build.gradle.kts` 文件不存在时 → 返回空列表，不抛出异常

**Step 2（实现）** — 新建 `src/plugins/kotlin/dependency-extractor.ts`（约 70 行）

接口：`IDependencyExtractor`（`type: 'gradle-kts'`）

解析逻辑（正则，无 tree-sitter）：
```typescript
// 字符串字面量格式："group:artifact:version"
/\b(implementation|testImplementation|androidTestImplementation|api|compileOnly|runtimeOnly)\s*\(\s*"([^"]+)"\s*\)/g

// Version Catalog 格式：libs.xxx.yyy（不含引号）
/\b(implementation|testImplementation|androidTestImplementation|api|compileOnly|runtimeOnly)\s*\(\s*(libs\.[a-zA-Z0-9._-]+)\s*\)/g
```

静默降级：解析失败返回空列表，通过 `console.warn` 记录。

**验收标准**：
- `tests/unit/plugins/kotlin/dependency-extractor.test.ts` 全部通过
- 覆盖率 ≥ 80%（对 dependency-extractor.ts）

**估计代码量**：实现约 70 行，测试约 80 行，合计约 150 行

---

## Phase 4：插件入口与 CLI 接入

### Stage 4.1：KotlinPlugin 入口

**目标**：实现 `KotlinPlugin`（`index.ts`）。`detectKotlinProjectStructure` 已拆分至 Stage 4.1b。

**Step 1（测试先行）** — 新建 `tests/unit/plugins/kotlin/kotlin-plugin.test.ts`（约 120 行）

使用 `vi.mock` mock TreeSitterBridge，覆盖：
- `metadata` 字段完整性（所有 8 个字段均存在且值正确）
- `initialize()` 后 `canHandle('.kt')` → true，`canHandle('.java')` → false
- `canHandle(dirWithBuildGradleKts)` → true（mock fs.existsSync）
- `parseProject` 返回 `ArchJSON` 且 `language: 'kotlin'`
- `dispose()` 后再调用方法抛出错误
- `isTestFile('FooTest.kt')` → true
- `isTestFile('src/test/FooTest.kt')` → true（路径含 `test/`）
- `isTestFile('src/androidTest/FooTest.kt')` → true
- `isTestFile('Main.kt')` → false
- `extractTestStructure` 返回非 null，含 `@Test` 注解识别

**Step 2（实现）** — 新建 `src/plugins/kotlin/index.ts`（约 160 行）

参照 `CppPlugin`（非 getter dependencyExtractor、`dispose` 模式）：

```typescript
export class KotlinPlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'kotlin',
    version: '1.0.0',
    displayName: 'Kotlin',
    fileExtensions: ['.kt', '.kts'],
    author: 'ArchGuard Team',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: true,
      dependencyExtraction: true,
      typeInference: false,
      testStructureExtraction: true,
    },
  };

  readonly supportedLevels = ['package', 'class'] as const;
  readonly dependencyExtractor: IDependencyExtractor;

  private bridge!: TreeSitterBridge;
  private mapper!: ArchJsonMapper;
  private initialized = false;

  // initialize / parseProject / parseCode / parseFiles
  // canHandle / dispose
  // isTestFile / extractTestStructure
}
```

`isTestFile` 逻辑（参照 Java 插件命名约定）：
- 文件名以 `Test.kt` 结尾，或以 `Test` 开头（如 `TestFoo.kt`）
- 路径含 `src/test/`、`src/androidTest/`、`src/sharedTest/`

`extractTestStructure` 逻辑（逐行 state machine，参照 Java 插件）：
- 检测 `@Test`、`@RunWith`、`@ExtendWith` 注解 → JUnit4/5
- 计数 `assert*`、`assertEquals`、`assertTrue`、`assertThat`、`verify*` 调用

**验收标准**：
- `tests/unit/plugins/kotlin/kotlin-plugin.test.ts` 全部通过
- `npm run type-check` 无错误

**估计代码量**：实现（index.ts）约 160 行，测试约 120 行，合计约 280 行

> **拆分执行**：`kotlin-project-structure-detector.ts`（约 100 行实现 + 约 80 行测试）已强制拆分为独立 **Stage 4.1b**（见下节），Stage 4.1 仅包含 `index.ts` 及其测试。

---

### Stage 4.1b：Kotlin 项目结构探测器

**目标**：实现 `detectKotlinProjectStructure`，为 CLI 路由提供 Kotlin 项目的图配置清单。

**Step 1（测试先行）** — 新建 `tests/unit/cli/utils/kotlin-project-structure-detector.test.ts`（约 80 行）

参照 `tests/unit/cli/utils/java-project-structure-detector.test.ts` 的结构：
- 无 `settings.gradle.kts` 时产出 2 个固定图（`overview/package` + `class/all-classes`）
- 含 `include(":app")` + `include(":core")` 的 `settings.gradle.kts` → 产出 `class/app` + `class/core` 子图（前提：目录下有 `.kt` 文件）
- 模块目录不含 `.kt` 文件 → 不产出该子图
- `options.label` 为空时使用 `path.basename(projectRoot)` 作为 label
- 产出图的 `level` 字段正确（`'package'` 和 `'class'`）

**Step 2（实现）** — 新建 `src/cli/utils/kotlin-project-structure-detector.ts`（约 100 行）

参照 `java-project-structure-detector.ts` 结构：

```typescript
export async function detectKotlinProjectStructure(
  projectRoot: string,
  options?: { label?: string; format?: DiagramConfig['format']; exclude?: string[] }
): Promise<DiagramConfig[]>
```

固定产出：
- `${label}/overview/package`（level: `'package'`，sources: `[projectRoot]`）
- `${label}/class/all-classes`（level: `'class'`，sources: `[projectRoot]`，queryRole: `'primary'`）

Gradle 多模块扩展：
- 读取 `settings.gradle.kts`，正则提取 `include(":module")` 语句
- 对每个模块目录检查是否含 `.kt` 文件（辅助函数 `directoryHasKotlinFiles`）
- 产出 `${label}/class/${moduleName}`（level: `'class'`，sources: `[path.join(projectRoot, moduleName)]`）

**验收标准**：
- `tests/unit/cli/utils/kotlin-project-structure-detector.test.ts` 全部通过
- `npm run type-check` 无错误

**估计代码量**：实现约 100 行，测试约 80 行，合计约 180 行

---

### Stage 4.2：CLI 路由接入

**目标**：在 `normalize-to-diagrams.ts` 中接入 Kotlin 语言分支。

**文件变更** — 修改 `src/cli/analyze/normalize-to-diagrams.ts`：

1. 添加 import（在 Java import 之前）：
   ```typescript
   import { detectKotlinProjectStructure } from '../utils/kotlin-project-structure-detector.js';
   ```

2. 在 `if (language === 'cpp')` 分支（第 51 行）**之前**插入 Kotlin 分支（`cpp` 和 `kotlin` 都只支持 package/class，无 method 级别）：
   ```typescript
   if (language === 'kotlin') {
     const sourcePath = path.resolve(cliOptions.sources[0]);
     return filterByLevels(
       await detectKotlinProjectStructure(sourcePath, {
         label: path.basename(sourcePath),
         format: cliOptions.format,
         exclude: cliOptions.exclude,
       }),
       cliOptions.diagrams
     );
   }
   ```

3. 在无 `cliOptions.sources` 分支（`if (cliOptions.lang === 'java')` 之前，约第 124 行）也添加对应分支：
   ```typescript
   if (cliOptions.lang === 'kotlin') {
     return filterByLevels(
       await detectKotlinProjectStructure(resolvedRoot, {
         label: path.basename(resolvedRoot),
         format: cliOptions.format,
         exclude: cliOptions.exclude,
       }),
       cliOptions.diagrams
     );
   }
   ```

4. 在 `src/core/plugin-registry.ts` 中注册 `KotlinPlugin`（需确认当前注册位置，参照 Java/C++ 插件注册方式）。

**验收标准**：
- `npm run type-check` 无错误
- `npm test` 全量测试通过
- `node dist/cli/index.js analyze -s /home/yale/work/AndroidMotty/app/src/main --lang kotlin` 生成有效的 package 图和 class 图
- AndroidMotty 主要包名出现在 package 图中（可用 `grep -r "^package " /home/yale/work/AndroidMotty --include="*.kt"` 预先核实实际包名）

**估计代码量**：约 30-40 行（normalize-to-diagrams.ts 修改 + 插件注册）

---

## 测试策略

### 测试文件清单

| 文件 | 类型 | 目标 Stage |
|---|---|---|
| `tests/unit/plugins/kotlin/types.test.ts` | 类型完整性 | Stage 1.2 |
| `tests/unit/plugins/kotlin/class-builder.test.ts` | AST → RawKotlinClass | Stage 2.1 |
| `tests/unit/plugins/kotlin/function-builder.test.ts` | 顶层函数提取 | Stage 2.3 |
| `tests/unit/plugins/kotlin/import-resolver.test.ts` | import 路径转换 | Stage 2.2 |
| `tests/unit/plugins/kotlin/kotlin-tree-sitter-bridge.test.ts` | 文件级 AST 解析 | Stage 2.2 |
| `tests/unit/plugins/kotlin/kotlin-type-extractor.test.ts` | 字段类型分析（组合/聚合） | Stage 3.1b |
| `tests/unit/plugins/kotlin/archjson-mapper.test.ts` | RawKotlinFile[] → ArchJSON | Stage 3.1 |
| `tests/unit/plugins/kotlin/dependency-extractor.test.ts` | build.gradle.kts 解析 | Stage 3.2 |
| `tests/unit/plugins/kotlin/kotlin-plugin.test.ts` | KotlinPlugin 核心功能 | Stage 4.1 |
| `tests/unit/cli/utils/kotlin-project-structure-detector.test.ts` | Gradle 多模块项目结构探测 | Stage 4.1b |

### Fixture 来源

使用内联 Kotlin 代码字符串作为 fixture（不依赖 AndroidMotty 真实文件），确保测试可离线运行。代表性代码片段：

```kotlin
// data class primary constructor → field extraction
data class UserRepository(val apiService: ApiService, val db: AppDatabase)

// sealed interface → interface + decorators: [{name: 'sealed'}]
sealed interface SerialReadResult {
  data class Success(val data: ByteArray) : SerialReadResult
  data class Error(val exception: Exception) : SerialReadResult
}

// class with inheritance and interface
class MainViewModel(repository: UserRepository) : ViewModel(), ILifecycleObserver

// companion object → static members merged to host
class AppConfig {
  companion object {
    const val BASE_URL = "https://api.example.com"
  }
}

// @Composable top-level function
@Composable
fun ProjectListScreen(viewModel: ProjectListViewModel) { ... }
```

### TDD 节奏

每个 Stage 遵循"测试先行"原则：

1. 编写测试（红灯）
2. 实现代码（绿灯）
3. 运行 `npm run type-check` + `npm test`（确认全量通过）

### 测试运行命令

```bash
# 仅运行 Kotlin 插件相关测试
npm test -- tests/unit/plugins/kotlin/

# 检查覆盖率
npm run test:coverage -- --reporter=text tests/unit/plugins/kotlin/
```

---

## 验收标准（整体）

1. **编译**：`npm run type-check` 零错误，无新增 TypeScript 编译错误
2. **全量测试**：`npm test` 全部通过（原有 3141+ 测试不回退，新增 ≥ 60 个 Kotlin 相关测试）
3. **覆盖率**：`src/plugins/kotlin/` 下各文件覆盖率 ≥ 80%
4. **插件注册**：`KotlinPlugin` 能通过 `PluginRegistry.getByExtension('.kt')` 被找到
5. **自动检测**：含 `build.gradle.kts` 的目录被自动识别为 `kotlin` 插件（优先于 `build.gradle` 的 Java 规则）
6. **AndroidMotty 验证**：
   ```bash
   # 实现后验证（需先 npm run build）
   node dist/cli/index.js analyze -s /home/yale/work/AndroidMotty/app/src/main --lang kotlin
   ```
   - 生成 `.archguard/overview/package.mmd`（package 图，含跨包 import 边）
   - 生成 `.archguard/class/all-classes.mmd`（classDiagram，含继承/实现/组合关系）
   - 实际包名出现在图中（预先用 `grep -r "^package " /home/yale/work/AndroidMotty --include="*.kt"` 核实）
   - 无未捕获的异常（解析失败文件通过 `console.warn` 记录，不中断整体分析）

---

## 风险

### R1：tree-sitter-kotlin AST 节点类型与实际不符

**来源**：`@tree-sitter-grammars/tree-sitter-kotlin@1.1.0` 为社区维护，Grammar 对 Kotlin 高级语法（`suspend fun`、`value class`、context receiver）覆盖度未知。

**缓解**：
- **编码前先调研**：用 [Tree-sitter Kotlin Playground](https://fwcd.github.io/tree-sitter-kotlin/) 对照 AndroidMotty 代表性文件（`UsbSerialModels.kt`、`ProjectListScreen.kt`）验证节点类型名称
- `tree-sitter-bridge.ts` 对未知节点类型 `console.warn` + 跳过，不中断解析
- 解析异常记录到 ArchJSON `metadata.parseErrors`

### R2：`--legacy-peer-deps` 导致 ABI 不兼容

**来源**：`tree-sitter` 核心版本与 `@tree-sitter-grammars/tree-sitter-kotlin` 的 native ABI 可能不兼容（参照历史上 C++ 插件的 segfault 修复经验）。

**缓解**：
- Stage 1.1 安装依赖后立即运行 `node -e "const P=require('tree-sitter');const K=require('@tree-sitter-grammars/tree-sitter-kotlin');p=new P();p.setLanguage(K);console.log('ok')"` 验证无 segfault
- Stage 2.1 ClassBuilder 测试首次加载 tree-sitter 时可发现问题

### R3：Kotlin 包名与目录路径不一致

**来源**：Kotlin 不强制 package 声明与文件路径对应，依赖目录推导会产生错误的 Entity ID。

**缓解**：从 `package_header` AST 节点提取 `packageName`（与 Java 插件一致），而非从 `path.dirname(filePath)` 推导。

### R4：`build.gradle.kts` 正则解析误匹配

**来源**：Version Catalog（`libs.xxx.yyy`）、多行字符串、注释中的伪代码可能干扰正则。

**缓解**：
- 多模式正则优先匹配字符串字面量格式（精度最高）
- Version Catalog 引用记录为 symbolic reference（不要求 100% 精确）
- 解析失败静默降级（返回空列表），不影响主流程

### R5：AndroidMotty 验收包名假设错误

**来源**：Plan 验收标准中的包名列举（如 `com.example.app`）来自目录约定推测，实际 `package` 声明可能不同。

**缓解**：实现前先执行 `grep -r "^package " /home/yale/work/AndroidMotty --include="*.kt" | sort | uniq` 核实真实包名，再更新验收标准中的具体包名。

---

## 一致性审查记录

**审查时间**：2026-05-02  
**审查人**：Claude Code（严苛架构师视角）

---

### C1（阻断级）— Stage 粒度超限：3.1 拆分为 3.1b

**发现**：Stage 3.1 原始估算合计约 310 行（实现 160 + 测试 150），超出 200 行单 Stage 上限。

**修改**：
- 将 `mapRelations` 中字段类型分析逻辑提取为独立文件 `src/plugins/kotlin/kotlin-type-extractor.ts`
- 新增 **Stage 3.1b**，含实现（约 60 行）+ 测试 `tests/unit/plugins/kotlin/kotlin-type-extractor.test.ts`（约 50 行），合计约 110 行
- Stage 3.1 修订后合计约 200 行（实现 100 + 测试 100）
- Phase 列表更新，`KOTLIN_PRIMITIVE_TYPES` 常量移至 `kotlin-type-extractor.ts`

---

### C2（阻断级）— Stage 粒度超限：4.1 拆分为 4.1b

**发现**：Stage 4.1 原始估算合计约 380 行（`index.ts` + `kotlin-project-structure-detector.ts` 实现 260 行 + 测试 120 行），严重超出 200 行上限。原文档的"可拆分为 Stage 4.1b"是非正式建议，未体现在正式 Stage 结构中，亦未在测试清单中列入对应测试文件。

**修改**：
- 正式新增 **Stage 4.1b：Kotlin 项目结构探测器**，含实现 `src/cli/utils/kotlin-project-structure-detector.ts`（约 100 行）+ 测试 `tests/unit/cli/utils/kotlin-project-structure-detector.test.ts`（约 80 行），合计约 180 行
- Stage 4.1 修订为仅包含 `index.ts`，合计约 280 行（实现 160 + 测试 120）——仍属合理范围
- Phase 4 列表更新以体现 Stage 4.1b
- 测试文件清单补入 `tests/unit/cli/utils/kotlin-project-structure-detector.test.ts`

---

### C3（高优先级）— 测试文件命名偏离约定：`tree-sitter-bridge.test.ts`

**发现**：原 Plan 中测试文件命名为 `tree-sitter-bridge.test.ts`。检查现有约定（`tests/unit/plugins/`）：Java 插件用 `java-plugin.test.ts`，Python 用 `python-plugin.test.ts` + `python-import-extractor.test.ts`，均以语言名为前缀。无任何插件使用裸的 `tree-sitter-bridge.test.ts`，该命名在多语言插件共存时会产生歧义（无法区分是哪个语言的桥接测试）。

**修改**：将 Plan 中所有 `tree-sitter-bridge.test.ts` 引用改为 `kotlin-tree-sitter-bridge.test.ts`，与 `kotlin-plugin.test.ts` 前缀风格一致。同步更新测试文件清单。

---

### C4（高优先级）— Proposal 插入位置描述与 Plan/实际代码不一致

**发现**：Proposal 第 3.5 节写"参照现有 `if (language === 'java')` 分支（第 61 行），在其**之前**新增"。但实际 `normalize-to-diagrams.ts` 中第 51 行是 `if (language === 'cpp')`，第 61 行才是 `if (language === 'java')`。Plan（正确）已说"在 `if (language === 'cpp')` 分支之前"。Kotlin 与 cpp 同为 package/class 两级无 method，语义上应与 cpp 同层，应置于 cpp 之前而非仅在 java 之前（两者位置不同）。

**修改**：仅修改 Proposal 第 3.5 节，将插入参考分支改为 `if (language === 'cpp')`（第 51 行），并补充原因说明（Kotlin 无 method 级，与 cpp 同层）。Plan 已正确，无需修改。

---

### C5（中优先级）— Stage 2.1 代码量接近上限

**发现**：Stage 2.1 合计约 280 行，接近 300 行；虽未超出，但若 Kotlin 高级语法节点增多（`sealed class`、`companion object` 的处理细化），实现可能突破 150 行。

**修改**：在 Stage 2.1 结尾添加拆分预案说明，建议将 `companion object` 成员合并逻辑提取为 `companion-merger.ts`（如超出则拆分）。暂不强制执行，属于预防性标注。

---

### C6（信息性）— 已确认一致的决策点

以下条目经交叉核对，两文档一致，无需修改：

| 条目 | Proposal | Plan | 结论 |
|---|---|---|---|
| npm 包名 | `@tree-sitter-grammars/tree-sitter-kotlin@^1.1.0` | 同上 | 一致 |
| `dispose()` 方法 | 第 3.2 节有描述 | Stage 4.1 有实现 | 一致 |
| `DependencyType` 新类型 | `'gradle-kts'` | `'gradle-kts'` | 一致 |
| `kotlin-project-structure-detector.ts` | 第 3.5 节、第 6 节文件清单 | Stage 4.1b（拆分后） | 一致（拆分后） |
| `DETECTION_RULES` 插入位置 | `build.gradle` 之前 | `pom.xml` 之后、`build.gradle` 之前 | 实质一致（同一位置） |
| `supportedLevels` | `['package', 'class']` | `['package', 'class'] as const` | 一致 |
| AndroidMotty 验证命令 | 第 6 节验收标准含具体命令 | 整体验收标准含具体命令 | 一致 |
