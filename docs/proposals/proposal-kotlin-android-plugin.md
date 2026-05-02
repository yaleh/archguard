# Proposal: Kotlin/Android 语言插件

**状态**：草案  
**日期**：2026-05-02  
**验证目标**：`/home/yale/work/AndroidMotty`（90 个 Kotlin 文件，MVVM + Clean Architecture，Jetpack Compose，无 Hilt/Room）

---

## 1. 背景

ArchGuard 目前通过插件体系支持 TypeScript、Go、Java、Python、C++ 五种语言。这些插件均基于 `tree-sitter` 解析 AST，遵循统一的 `ILanguagePlugin` 接口（`src/core/interfaces/language-plugin.ts`），并通过 `PluginRegistry`（`src/core/plugin-registry.ts`）注册和发现。

Android 开发已全面迁移至 Kotlin。以 AndroidMotty 为例，该项目包含：

- **data class / sealed interface / enum class**：Kotlin 特有的类型声明（如 `UsbSerialModels.kt` 中的 `sealed interface SerialReadResult`）
- **Jetpack Compose @Composable 函数**：作为 UI 层的核心构件，与传统 OOP 类体系并列
- **Gradle Kotlin DSL**（`build.gradle.kts`）：依赖配置文件，不同于 Java 世界的 `pom.xml`/`build.gradle`
- **Android 分层目录约定**：`app/src/main`、`app/src/test`、`app/src/androidTest` 三类源集

Java 插件（`src/plugins/java/index.ts`）无法处理 Kotlin，原因有两点：其一，`fileExtensions: ['.java']` 不包含 `.kt`；其二，`tree-sitter-java` 的 Grammar 无法解析 Kotlin 语法（data class primary constructor、companion object、扩展函数等均为 Kotlin 专属结构）。因此需要独立的 Kotlin 插件。

---

## 2. 目标

### 2.1 必达目标（阶段 1）
- 解析 `.kt` 文件，提取 class、interface、data class、sealed class/interface、enum class、object、companion object
- 生成 `package` 级别和 `class` 级别的架构图（flowchart LR 和 classDiagram）
- 提取继承（`:` super class）、接口实现（`:` interface list）、组合/聚合（primary constructor / property 字段类型）关系
- 解析 `build.gradle.kts`，提取 `implementation`/`testImplementation` 依赖声明（`DependencyType: 'gradle-kts'`）
- 通过 `PluginRegistry` 自动检测：存在 `build.gradle.kts` 且含 `kotlin.android` / `kotlin.jvm` plugin → 使用 KotlinPlugin

### 2.2 扩展目标（阶段 2：Android 特有层）
- 识别 `@Composable` 函数并在 `class` 级图中渲染为独立节点类型（而非普通 function 实体过滤掉）
- 解析 `AndroidManifest.xml`，提取 Activity / Service / BroadcastReceiver / ContentProvider 组件角色，作为 `android-component` 层图的锚点
- 生成模块依赖图：多模块 Gradle 项目的 `:app → :core → :data` 结构（对标 Java 插件的 `MavenCrossModuleParser`）

### 2.3 按需目标（阶段 3）
- Hilt/Koin DI 关系图（`@Inject`、`@HiltViewModel`、`@Module` 注解追踪）
- Room 实体关系图（`@Entity`、`@Dao`、`@Database` 注解提取）
- Navigation 图（`NavHost` + `composable("route")` 调用链）

---

## 3. 方案设计

### 3.1 目录结构

```
src/plugins/kotlin/
├── types.ts                     # RawKotlinFile, RawKotlinClass, RawKotlinFunction 等原始 AST 类型
├── tree-sitter-bridge.ts        # TreeSitterBridge: 调用 tree-sitter-kotlin，输出 RawKotlinFile
├── builders/
│   ├── class-builder.ts         # 从 AST 节点提取类/接口/data class/sealed/object/companion
│   ├── function-builder.ts      # 从 AST 节点提取顶层函数与 @Composable 函数
│   └── import-resolver.ts       # 将 import 语句解析为项目内部路径（对应 Java 插件的 extractJavaImports）
├── archjson-mapper.ts           # ArchJsonMapper: RawKotlinFile[] → Entity[] + Relation[]
├── dependency-extractor.ts      # 解析 build.gradle.kts（Kotlin DSL）提取依赖
├── index.ts                     # KotlinPlugin implements ILanguagePlugin（入口）
└── android/                     # 阶段 2 Android 特有层（可选）
    ├── component-detector.ts    # 识别 Activity/Service/BroadcastReceiver/ContentProvider
    ├── manifest-parser.ts       # 解析 AndroidManifest.xml
    ├── gradle-module-parser.ts  # 解析多模块 settings.gradle.kts 的 include(":module")
    └── android-layer-renderer.ts # 生成 android-component 层图
```

该结构与现有插件保持高度对称：
- `src/plugins/java/` → `tree-sitter-bridge.ts` + `archjson-mapper.ts` + `dependency-extractor.ts` + `maven-crossmodule-parser.ts`
- `src/plugins/cpp/` → `tree-sitter-bridge.ts` + `archjson-mapper.ts` + `cpp-type-extractor.ts`

### 3.2 ILanguagePlugin 接口接入点

`KotlinPlugin` 需要实现 `src/core/interfaces/language-plugin.ts` 中的 `ILanguagePlugin` 接口。以下为完整方法清单（含接口中的所有必选和可选成员）：

```
// ---- metadata（PluginMetadata，必须完整填写所有字段）----
metadata: PluginMetadata
  name: 'kotlin'
  version: '1.0.0'
  displayName: 'Kotlin'
  fileExtensions: ['.kt', '.kts']
  author: 'ArchGuard Team'
  minCoreVersion: '2.0.0'
  capabilities:
    singleFileParsing: true
    incrementalParsing: true        // parseFiles() 需同步实现
    dependencyExtraction: true
    typeInference: false
    testStructureExtraction: true

// ---- 核心方法（均为必选）----
supportedLevels: readonly string[]
  // 值：['package', 'class']（阶段 1）；阶段 2 追加 'android-component'

initialize(config: PluginInitConfig): Promise<void>
  // 初始化 TreeSitterBridge（加载 tree-sitter-kotlin 原生模块）

canHandle(targetPath: string): boolean
  // 文件级：ext === '.kt' || ext === '.kts'
  // 目录级：存在 build.gradle.kts（不需检查文件内容，与 Java 插件对齐）

parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON>
  // glob '**/*.kt'，exclude build/ .gradle/；逐文件调用 TreeSitterBridge.parseCode()
  // 汇总 → ArchJsonMapper.mapEntities() + mapRelations()
  // language: 'kotlin'（需在 SupportedLanguage 中添加）

dispose(): Promise<void>
  // 【原 proposal 遗漏】ILanguagePlugin 必选方法（见接口第 206 行）
  // 释放 TreeSitterBridge 持有的 wasm/native 资源；将 initialized 置为 false

// ---- IParser 继承方法 ----
parseCode?(code: string, filePath?: string): ArchJSON
  // IParser 中为可选（?），但 capabilities.singleFileParsing = true 时应实现
  // 单文件解析（用于增量分析和 parseFiles 调用）

parseFiles?(filePaths: string[]): Promise<ArchJSON>
  // IParser 中为可选（?），但 capabilities.incrementalParsing = true 时应实现
  // 参照 Java 插件的 parseFiles() 逐文件解析后 merge packages

// ---- 可选方法（capabilities 已声明，必须实现）----
isTestFile(filePath: string, patternConfig?: TestPatternConfig): boolean
  // src/test/ 目录 → unit test；src/androidTest/ 目录 → instrumented test
  // 文件名以 Test 结尾 → test（参照 Java 插件的 isTestFile 命名约定）

extractTestStructure(filePath, code, patternConfig?): RawTestFile | null
  // 检测 @Test（JUnit4/5）、@RunWith 注解；计数 assert* 调用
  // 与 Java 插件共享相同的 annotation 扫描逻辑（逐行 state machine）

// ---- 可选属性 ----
readonly dependencyExtractor: IDependencyExtractor
  // DependencyExtractor 解析 build.gradle.kts
  // 声明为 non-optional（参照 CppPlugin 模式，而非 JavaPlugin 的 getter）
```

> **注意**：`IParser`（定义于 `src/core/interfaces/parser.ts`）中 `parseCode` 和 `parseFiles` 均标注为 `?`（可选），但在 `PluginCapabilities.singleFileParsing = true` 和 `incrementalParsing = true` 时视为合约要求必须实现，参照 Java 和 C++ 插件的实践。

### 3.3 PluginRegistry 接入

在 `src/core/plugin-registry.ts` 的 `DETECTION_RULES` 数组（第 142 行静态常量）中，在 `build.gradle` Java 规则**之前**插入：

```typescript
{ file: 'build.gradle.kts', plugin: 'kotlin' },
{ file: 'settings.gradle.kts', plugin: 'kotlin' },
```

插入位置（当前规则顺序 `pom.xml → build.gradle → pyproject.toml...`）：

```typescript
{ file: 'pom.xml', plugin: 'java' },
{ file: 'build.gradle.kts', plugin: 'kotlin' },   // ← 插入，必须在 build.gradle 之前
{ file: 'settings.gradle.kts', plugin: 'kotlin' }, // ← 插入
{ file: 'build.gradle', plugin: 'java' },
```

顺序优先级：`detectPluginForDirectory` 返回第一个匹配项（线性扫描）。`build.gradle.kts` 必须先于 `build.gradle`，否则含有 `build.gradle.kts` 的 Android 项目会被错误识别为 Java 项目。纯 Java 项目（只有 `build.gradle` 或 `pom.xml`）不受影响。

> **注意**：`KotlinPlugin` 在注册时的 `name` 字段必须为 `'kotlin'`，与 `DETECTION_RULES` 中的 `plugin: 'kotlin'` 严格对应（`getByName(rule.plugin)` 做精确字符串匹配）。

### 3.4 SupportedLanguage 类型扩展

在 `src/types/index.ts` 第 55 行的联合类型中追加（当前值为 `'typescript' | 'go' | 'java' | 'python' | 'rust' | 'cpp'`）：

```typescript
export type SupportedLanguage = 'typescript' | 'go' | 'java' | 'python' | 'rust' | 'cpp' | 'kotlin';
```

同步影响：`ArchJSON.language` 字段类型为 `SupportedLanguage`，KotlinPlugin 的 `parseProject` 返回时需设置 `language: 'kotlin'`。

### 3.5 CLI 接入（normalize-to-diagrams.ts）

实际接入文件为 `src/cli/analyze/normalize-to-diagrams.ts`（注意：`src/cli/commands/analyze.ts` 仅做 re-export，不含路由逻辑）。

参照现有 `if (language === 'cpp')` 分支（第 51 行），在其**之前**新增（Kotlin 与 cpp 同为 package/class 两级，无 method 级；且 Kotlin 同样需要专用 detector 而非 `createProjectRootLanguageDiagrams`，故应与 cpp 同层处理）：

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

同理，在无 `cliOptions.sources` 的分支中（第 112 行附近 `if (cliOptions.lang === 'cpp')` 之前）也需添加对应的无-source 分支。

**需新建工具函数文件**（原 proposal 遗漏，未列入阶段 1 变更清单）：

- `src/cli/utils/kotlin-project-structure-detector.ts` — 实现 `detectKotlinProjectStructure()`

  对标 `java-project-structure-detector.ts`（`detectJavaProjectStructure`）的结构：
  - 固定产出 `overview/package`（level: 'package'）和 `class/all-classes`（level: 'class'）两个基础图
  - Android 多模块：扫描 `settings.gradle.kts` 中的 `include(":module")` 语句（替代 Maven 的 `<modules>` 解析），为每个含 `.kt` 文件的模块产出 `class/<module>` 子图
  - 对应的 import 语句：`normalize-to-diagrams.ts` 中需 `import { detectKotlinProjectStructure } from '../utils/kotlin-project-structure-detector.js'`

> **错误提醒**：原 proposal 提到"直接复用 `createProjectRootLanguageDiagrams(resolvedRoot, 'kotlin', ...)`"。这仅适用于 Python/TypeScript 这类无显式模块结构的语言。Android 项目具有 Gradle 多模块结构，必须实现专用探测函数，否则会丢失子模块图。

Android 项目包名从 `package com.example.xxx` 语句提取，而非从文件路径推导（与 Java 一致）。

### 3.6 实体类型映射

Kotlin 特有的类型结构映射到现有 `EntityType`（`src/types/index.ts` 第 99-106 行）：

| Kotlin 结构 | EntityType | 备注 |
|---|---|---|
| `class Foo` | `class` | 普通类 |
| `abstract class Foo` | `abstract_class` | `isAbstract: true` |
| `interface Foo` | `interface` | 普通接口 |
| `data class Foo(...)` | `class` | `decorators: [{name:'data'}]` 标记 |
| `sealed class/interface Foo` | `class` / `interface` | `decorators: [{name:'sealed'}]` 标记 |
| `object Foo` | `class` | `decorators: [{name:'object'}]` 标记；singleton 语义 |
| `companion object` | 合并到宿主类的 static members | 不单独作为实体 |
| `enum class Foo` | `enum` | 标准映射 |
| `@Composable fun Foo` | `function` | 阶段 2 才渲染；阶段 1 可过滤同 C++ 一样 |

`data class` 的 primary constructor 参数自动成为字段（`MemberType: 'field'`），这是 Kotlin 解析的核心要点，对应 Python 插件中 `@dataclass` 字段提取（`python/tree-sitter-bridge.ts`）的类似处理。

### 3.7 关系提取

- **继承**：`class Foo : Bar()` → `RelationType: 'inheritance'`，source: Foo，target: Bar
- **接口实现**：`class Foo : IBar` → `RelationType: 'implementation'`
- **Kotlin 多父类**：同一 `:` 列表中区分类（带括号调用）和接口（无括号）
- **组合/聚合**：data class primary constructor 参数类型 → 参照 `CppTypeExtractor`（`src/plugins/cpp/cpp-type-extractor.ts`）的字段类型分析逻辑，过滤原始类型（String/Int/Boolean/Long 等）和标准库类型
- **依赖**：函数参数和返回类型中的项目内部类型

### 3.8 Gradle KTS 依赖提取

`build.gradle.kts` 采用 Kotlin DSL，依赖声明格式为：

```kotlin
implementation(libs.androidx.core.ktx)
testImplementation(libs.junit)
implementation("com.squareup.okhttp3:okhttp:4.12.0")
```

`DependencyExtractor` 使用正则表达式解析（无需 tree-sitter）：
- `implementation(libs.xxx.yyy)` → 从 `libs.versions.toml` Version Catalog 中查找真实坐标（可选）
- `implementation("group:artifact:version")` → 直接解析
- 需在 `src/core/interfaces/dependency.ts` 的 `DependencyType` 中追加 `'gradle-kts'`

### 3.9 Diagram Levels

阶段 1 支持两个 level，与 Java 插件的 `supportedLevels: ['package', 'class', 'method']` 对齐（暂不支持 method 级，因 Kotlin 函数体解析复杂度较高）：

- **package**：flowchart LR，节点为 Kotlin package，边为跨包 import 依赖
- **class**：classDiagram，包含继承/实现/组合/聚合四类箭头

阶段 2 增加：
- **android-component**：针对 Android 四大组件 + ViewModel + Repository 的分层图

---

## 4. 权衡分析

### 4.1 解析技术选型

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **`@tree-sitter-grammars/tree-sitter-kotlin@1.1.0`** | 与现有插件体系完全一致；无 JVM 依赖；纯 Node.js 运行；官方 tree-sitter-grammars 组织维护；最后发布于 2025-08（距今 ~9 个月） | Grammar 覆盖度取决于社区维护质量；Kotlin 语言持续演进（context receiver、value class 等）；AST 节点类型需对照 playground 调研 | **推荐，阶段 1 采用** |
| ~~`tree-sitter-kotlin@0.3.8`（fwcd，旧版）~~ | 历史存量版本，部分文档引用该版本 | **最后发布于 2023 年（~2 年未维护）**；已迁移至 `@tree-sitter-grammars` 组织；不应再使用 | **不采用**（版本过旧） |
| kotlinc / kotlin-compiler-embeddable | 语义准确度最高；支持类型推断 | 需要 JVM 环境；启动时间长（~3-5s）；破坏现有纯 Node.js 架构；子进程通信复杂 | 不采用 |
| detekt（静态分析框架） | 现成的 Kotlin 分析规则 | Kotlin/JVM 依赖；输出格式不兼容 ArchJSON；需二次转换 | 不采用 |
| IntelliJ IDEA PSI（通过 headless 模式） | 最完整的 Kotlin 语义模型 | 极重量级依赖；非开源友好；超出 CLI 工具范畴 | 不采用 |

**结论**：阶段 1 使用 `@tree-sitter-grammars/tree-sitter-kotlin`（v1.1.0），**不使用**旧的 `tree-sitter-kotlin@0.3.8`（fwcd）。安装命令：

```bash
npm install @tree-sitter-grammars/tree-sitter-kotlin@^1.1.0 --legacy-peer-deps
```

`tree-sitter-bridge.ts` 中的 require 路径需对应更新：

```typescript
// 旧（错误）：require('tree-sitter-kotlin')
// 新（正确）：require('@tree-sitter-grammars/tree-sitter-kotlin')
const KotlinLanguage = require('@tree-sitter-grammars/tree-sitter-kotlin');
```

与 `tree-sitter-cpp`（`src/plugins/cpp/tree-sitter-bridge.ts`）、`tree-sitter-java`（`src/plugins/java/tree-sitter-bridge.ts`）保持完全一致的初始化模式。

### 4.2 独立插件 vs. 扩展 Java 插件

Java 插件（`src/plugins/java/index.ts`）的 `fileExtensions: ['.java']` 和 `tree-sitter-java` 的 Grammar 均不支持 Kotlin。强行扩展将违反单一职责原则，且需要在 Java 插件中注入大量 Kotlin 特有逻辑（data class、sealed class、companion object、@Composable）。独立 KotlinPlugin 结构更清晰，与现有 Java 插件互不干扰，且允许 Java + Kotlin 混合项目（混合 Android 项目）分别调用各自插件后合并 ArchJSON。

### 4.3 Kotlin 与 Java 混合项目

AndroidMotty 目前为纯 Kotlin 项目，但实际 Android 项目可能存在 `.java` 和 `.kt` 文件共存的场景。短期方案：KotlinPlugin 只处理 `.kt` 文件，ArchGuard 在检测到混合项目时可分别调用 JavaPlugin 和 KotlinPlugin，通过 `ArchJSONAggregator` 合并结果。长期方案可探索通用 Android 项目插件，但超出本提案范围。

### 4.4 Composable 函数的实体类型

`@Composable` 函数在 Kotlin 中本质上是顶层函数，但在 Android MVVM 架构中扮演 UI 层的核心角色，其可视化价值与类实体相当。阶段 1 采用保守策略：不过滤 `@Composable` 函数，将其以 `type: 'function'` 实体存入 ArchJSON，但在 classDiagram 渲染时与 C++ 插件一样默认过滤（`src/mermaid/generator.ts` 中的 `visibleEntities` 逻辑）。阶段 2 可在 android-component 层中单独渲染 Composable 节点。

---

## 5. 风险与缓解措施

### 5.1 tree-sitter-kotlin AST 节点覆盖度不足

**风险**：`@tree-sitter-grammars/tree-sitter-kotlin@1.1.0` 为社区维护项目（最后发布 2025-08），Kotlin 语言版本持续演进（协程、inline class、context receiver 等），Grammar 可能存在解析空白区。相比旧的 fwcd 版本，官方 grammars 组织维护的版本覆盖度更好，但仍非 JetBrains 官方实现。

**缓解**：
- 在 `tree-sitter-bridge.ts` 中对未知 AST 节点类型采用 `console.warn` + 跳过策略（参照 C++ 插件的 `catch (error) { console.warn(...) }` 模式）
- 使用 [tree-sitter-kotlin playground](https://fwcd.github.io/tree-sitter-kotlin/) 对照 AndroidMotty 的代表性语法结构（data class、sealed interface、companion object）验证 AST 节点类型名称，**在编码前先完成节点类型调研**
- 以 AndroidMotty 的 90 个文件为验证集，建立 node type 覆盖率基线
- 解析失败的文件记录到 ArchJSON `metadata.parseErrors` 字段，不中断整体分析

### 5.2 Kotlin 包名与文件路径不强制一致

**风险**：Kotlin 允许文件路径与 `package` 语句不一致（Java 则强制对应）。若依赖目录路径推导包名，会产生错误的 entity ID。

**缓解**：与 Java 插件一致，从 `package` 语句（AST `package_header` 节点）提取包名，而非从文件路径推导。AndroidMotty 均遵循标准 Android 目录约定，此问题影响范围有限。

### 5.3 `build.gradle.kts` 解析正则误匹配

**风险**：Gradle Kotlin DSL 的依赖声明形式多样（Version Catalog 引用、多行字符串、注释中的伪代码），正则解析可能产生误报。

**缓解**：
- 采用多模式正则，优先匹配字符串字面量 `"group:artifact:version"` 格式（精度最高）
- Version Catalog 引用（`libs.xxx.yyy`）记录为 symbolic reference，提供解析成功率而非要求 100% 准确
- 解析失败时静默降级（返回空依赖列表），不影响主流程

### 5.4 Android 特有层的 manifest 解析范围蔓延

**风险**：`AndroidManifest.xml` 包含权限、intent-filter、provider authorities 等大量属性，过度解析会增加复杂性，且大多数内容对架构图无意义。

**缓解**：阶段 2 仅提取四大组件的 `android:name` 属性（Activity/Service/BroadcastReceiver/ContentProvider），作为 android-component 图的节点标签，其余属性忽略。manifest 解析设为可选（`--android-components` CLI flag），默认不开启。

### 5.5 与现有 Java 检测规则冲突

**风险**：`build.gradle`（无 `.kts` 后缀）在 `DETECTION_RULES` 中匹配 `java`，部分 Android 项目同时存在 `build.gradle` 和 `build.gradle.kts`。

**缓解**：将 `build.gradle.kts` 的检测规则放置在 `build.gradle` **之前**（数组顺序决定优先级，`detectPluginForDirectory` 返回第一个匹配项）。纯 Java + Gradle 项目只有 `build.gradle`，不受影响。

---

## 6. 实施阶段

### 阶段 1：KotlinPlugin 基础（预计 2-3 天）

**目标**：在 AndroidMotty 上生成有效的 package 图和 class 图。

涉及文件变更：
- 新增 `src/plugins/kotlin/types.ts`
- 新增 `src/plugins/kotlin/tree-sitter-bridge.ts`
- 新增 `src/plugins/kotlin/builders/class-builder.ts`
- 新增 `src/plugins/kotlin/builders/function-builder.ts`
- 新增 `src/plugins/kotlin/builders/import-resolver.ts`
- 新增 `src/plugins/kotlin/archjson-mapper.ts`
- 新增 `src/plugins/kotlin/dependency-extractor.ts`
- 新增 `src/plugins/kotlin/index.ts`
- 新增 `src/cli/utils/kotlin-project-structure-detector.ts`（**原 proposal 遗漏**，见 3.5 节）
- 修改 `src/types/index.ts`：`SupportedLanguage` 追加 `'kotlin'`
- 修改 `src/core/interfaces/dependency.ts`：`DependencyType` 追加 `'gradle-kts'`
- 修改 `src/core/plugin-registry.ts`：`DETECTION_RULES` 追加 `build.gradle.kts` 和 `settings.gradle.kts`（顺序：在 `build.gradle` 之前）
- 修改 `src/cli/analyze/normalize-to-diagrams.ts`：追加 `if (language === 'kotlin')` 分支（含 import 语句）
- 新增 `package.json` 依赖：`@tree-sitter-grammars/tree-sitter-kotlin@^1.1.0`（**不是** `tree-sitter-kotlin@0.3.8`，见 4.1 节；安装方式与 `tree-sitter-cpp@0.23.4` 一致，使用 `--legacy-peer-deps`）

**验收标准**：
- `node dist/cli/index.js analyze -s /home/yale/work/AndroidMotty/app/src/main --lang kotlin` 生成有效 Mermaid
- AndroidMotty 6 个包（app、config、data.api、feature.*、ui.theme、usb）均出现在 package 图中
- class 图含继承/实现/data class 字段关系

### 阶段 2：Android 特有层（按需，预计 1-2 天）

涉及文件变更：
- 新增 `src/plugins/kotlin/android/` 目录下 4 个文件
- 修改 `src/plugins/kotlin/index.ts`：条件加载 android 子模块
- `supportedLevels` 追加 `'android-component'`

**验收标准**：
- `--diagrams android-component` 生成包含 Activity/ViewModel/Repository 节点的层次图

### 阶段 3：按需扩展（Hilt/Room/Navigation）

按各自的独立 proposal 推进，不在本提案范围内。

---

## 7. 测试策略

遵循项目现有测试约定（`tests/unit/` + `tests/integration/`，Vitest）：

- `tests/unit/plugins/kotlin/kotlin-plugin.test.ts`：KotlinPlugin 核心功能单元测试（mocked tree-sitter）
- `tests/unit/plugins/kotlin/class-builder.test.ts`：class-builder 的 AST → RawKotlinClass 转换
- `tests/unit/plugins/kotlin/archjson-mapper.test.ts`：RawKotlinFile[] → ArchJSON 映射
- `tests/unit/plugins/kotlin/dependency-extractor.test.ts`：build.gradle.kts 解析
- `tests/unit/plugins/kotlin/import-resolver.test.ts`：import 语句 → 项目内部路径转换

验证目标：以 AndroidMotty 的代表性文件（`UsbSerialModels.kt`、`ProjectListScreen.kt`、`MainActivity.kt`）作为 fixture，确保：
- `data class` primary constructor 参数映射为 `field` member
- `sealed interface` 映射为 `interface` + `decorators: [{name: 'sealed'}]`
- `: SuperClass()` 产生 `inheritance` 关系
- `: IInterface` 产生 `implementation` 关系
- `@Composable` 注解作为 decorator 保留

---

## 8. 参考

- `src/core/interfaces/language-plugin.ts`：`ILanguagePlugin` 接口定义（含 `dispose()` 等完整方法清单）
- `src/core/interfaces/parser.ts`：`IParser` 接口（`parseCode?`、`parseFiles?` 可选标注）
- `src/core/interfaces/dependency.ts`：`DependencyType` 联合类型（需追加 `'gradle-kts'`）
- `src/plugins/java/index.ts`：Java 插件参考实现（`dispose`、`isTestFile`、`extractTestStructure`、`parseFiles` 的实现模式）
- `src/plugins/cpp/index.ts`：C++ 插件参考（`dependencyExtractor` 非 getter 模式、`dispose` 模式）
- `src/plugins/cpp/tree-sitter-bridge.ts`：tree-sitter 原生模块初始化模式
- `src/plugins/cpp/cpp-type-extractor.ts`：字段类型分析（组合/聚合分类逻辑）
- `src/plugins/python/tree-sitter-bridge.ts`：dataclass 字段提取（对应 data class primary constructor）
- `src/core/plugin-registry.ts`：`DETECTION_RULES` 静态数组（第 142 行），插入顺序规则
- `src/cli/analyze/normalize-to-diagrams.ts`：语言分支路由逻辑（Java 分支在第 61 行，Kotlin 需插入其前）
- `src/cli/utils/java-project-structure-detector.ts`：`detectJavaProjectStructure` 实现参考
- `npm:@tree-sitter-grammars/tree-sitter-kotlin@1.1.0`：官方 tree-sitter-grammars 组织，MIT 许可，无 JVM 依赖，最后发布 2025-08
- [Tree-sitter Kotlin Playground](https://fwcd.github.io/tree-sitter-kotlin/)：AST 节点类型调研工具
- 验证项目：`/home/yale/work/AndroidMotty`（90 个 Kotlin 文件）

---

## 9. 架构师审查记录

**审查时间**：2026-05-02  
**审查人**：Claude Code（严苛架构师视角）

---

### 9.1 发现的问题和修改点

**P1（阻断级）— `dispose()` 方法遗漏**  
原 proposal 第 3.2 节的接口清单未列 `dispose(): Promise<void>`。该方法在 `ILanguagePlugin` 接口（`language-plugin.ts` 第 206 行）中为**必选**，不实现会导致 TypeScript 编译错误。已在第 3.2 节补全，明确其职责：释放 native wasm 资源，将 `initialized` 置 false。

**P2（阻断级）— npm 包版本错误**  
原 proposal 全文引用 `tree-sitter-kotlin@0.3.8`（fwcd），该包**最后发布于 2023 年**，已停止维护。正确包为 `@tree-sitter-grammars/tree-sitter-kotlin@1.1.0`，由官方 tree-sitter-grammars 组织接管，最后发布 2025-08。已全文替换，并在第 4.1 节增加安装命令和 `require` 路径说明。

**P3（高优先级）— 缺失 `kotlin-project-structure-detector.ts` 工具文件**  
第 3.5 节虽提到 `detectKotlinProjectStructure`，但阶段 1 变更清单（第 6 节）未列该文件。且原文建议"直接复用 `createProjectRootLanguageDiagrams`"——这对 Android 多模块项目是错误的，会丢失子模块图（Java 用的是专用 `detectJavaProjectStructure`，不是 `createProjectRootLanguageDiagrams`）。已在第 3.5 节纠正思路，在第 6 节变更清单中补入该文件。

**P4（中优先级）— `parseFiles()` 方法遗漏**  
原 proposal 未提及 `parseFiles?(filePaths: string[]): Promise<ArchJSON>`。Java 和 C++ 插件均实现了该方法，且声明了 `capabilities.incrementalParsing = true`。已在第 3.2 节补全说明。

**P5（中优先级）— `metadata` 字段不完整**  
原 proposal 的 metadata 伪代码仅列 `name`、`fileExtensions`、`capabilities` 三个字段，而 `PluginMetadata` 接口共 8 个字段（`version`、`displayName`、`author`、`minCoreVersion` 均为必填）。编译时会报错。已在第 3.2 节补全所有字段。

**P6（中优先级）— PluginRegistry 插入位置表述不精确**  
原文仅说"在 `build.gradle` Java 规则之前"，未给出具体数组位置。实际现有顺序为 `pom.xml → build.gradle`，需插入在两者之间。已在第 3.3 节提供精确的代码片段和位置说明。

**P7（低优先级）— `canHandle` 目录检测描述过度复杂**  
原文说"存在 `build.gradle.kts` 且文件内含 'kotlin.android' 或 'kotlin.jvm'"，但 Java 插件的 `canHandle` 直接检查文件存在性，不读取内容。文件内容检查增加 I/O，且 `build.gradle.kts` 存在即足以推断 Kotlin 项目。已在第 3.2 节简化为与 Java 插件对齐的逻辑。

**P8（信息性）— `SupportedLanguage` 行号标注准确**  
原文"第 55 行"经核实属实，无需修改；但补充了当前实际值以避免混淆。

---

### 9.2 已确认合理的设计决策

- **独立 KotlinPlugin 而非扩展 JavaPlugin**：正确。Java Grammar 不解析 Kotlin 语法，强行合并违反单一职责，且混合项目（Java + Kotlin）可分别调用后通过 `ArchJSONAggregator` 合并。
- **阶段 1 不支持 method 级别**：合理。Kotlin 函数体（lambda、高阶函数）的 AST 解析复杂度高，阶段 1 仅 package + class 层已足够验证架构可行性。
- **data class primary constructor 参数 → `field` member**：与 Python `@dataclass` 字段提取逻辑平行，设计一致。
- **`@Composable` 阶段 1 存入 ArchJSON 但在 classDiagram 渲染时过滤**：与 C++ `function` 实体处理方式一致（`visibleEntities` 过滤），不破坏现有渲染逻辑。
- **`build.gradle.kts` 正则解析（无 tree-sitter）**：与 C++ CMakeLists.txt 依赖提取方式一致，成本最低，可接受。
- **Kotlin 包名从 `package` 语句提取而非目录路径推导**：正确，Kotlin 不强制包名与目录对应。
- **目录结构与 `src/plugins/java/` 高度对称**：降低认知负担，新开发者可直接参照 Java 插件实现。

---

### 9.3 遗留的需关注事项

**A — tree-sitter-kotlin 对 Kotlin 高级语法的覆盖度**  
`@tree-sitter-grammars/tree-sitter-kotlin@1.1.0` 的 Grammar 对 Kotlin 协程（`suspend fun`）、inline/value class、context receiver 等 Kotlin 2.x 特性的覆盖情况未经实测。**建议编码前先用 playground 验证 AndroidMotty 中出现的所有语法结构**，避免在桥接层写无效的 AST 路径。

**B — `--legacy-peer-deps` 的长期风险**  
C++ 插件已先例，但该 flag 屏蔽了依赖冲突警告。若 `@tree-sitter-grammars/tree-sitter-kotlin` 与当前 `tree-sitter` 核心版本存在 ABI 不兼容，运行时会 segfault（参照 C++ 插件历史上的 segfault 修复）。建议实现后立即在 CI 中增加 Kotlin 解析冒烟测试。

**C — `'gradle-kts'` 与 `'gradle'` 的 DependencyType 命名**  
当前 `DependencyType` 中 Java/Android 使用 `'maven'`，没有纯 `'gradle'`。若未来需要支持 Groovy DSL 的 `build.gradle`，需再追加 `'gradle'`。建议此时直接考虑统一命名策略（`'gradle'` vs `'gradle-kts'`，或仅用 `'gradle'` 加 `scope` 区分），避免后续碎片化。

**D — 阶段 2 `'android-component'` 不在 `SupportedLanguage` 范畴**  
`'android-component'` 是 `supportedLevels` 中的 level 名称，不是新的语言类型，无需修改 `SupportedLanguage`。但 `diagram-processor.ts` 处理 kotlin 分支时需要正确路由该 level，这部分逻辑未在本 proposal 中覆盖，需在阶段 2 单独设计。

**E — AndroidMotty 验收标准中包名有待核实**  
第 6 节验收标准列出"6 个包（app、config、data.api、feature.*、ui.theme、usb）"——这些包名来自项目目录约定，实际 package 声明是否与此一致，建议在实现前先用 `grep -r "^package " /home/yale/work/AndroidMotty --include="*.kt"` 确认，以免验收标准基于错误假设。
