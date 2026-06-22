# Proposal: Java 构建依赖提取与抽象类实体类型修复

## Problem Statement

当前 Java 插件的两个基础能力与仓库现有约定不一致：

1. `src/plugins/java/dependency-extractor.ts` 虽然已经能从 `pom.xml` 和 `build.gradle` 提取基础依赖，但输出格式与仓库中 Python/TypeScript 实现不完全对齐。尤其是 `source` 字段当前写入的是传入的绝对路径，而 `src/plugins/python/dependency-extractor.ts` 与 `src/plugins/typescript/index.ts` 都使用清单文件名（如 `requirements.txt`、`pyproject.toml`、`package.json`）。这会让跨语言消费方在展示和断言时出现不一致。
2. `src/plugins/java/archjson-mapper.ts` 在 `JavaRawClass.isAbstract === true` 时仍然把实体输出为 `type: 'class'`。仓库类型系统已经支持 `abstract_class`，查询层也已有对 `abstract_class` 的语义支持（例如 `tests/unit/cli/query/query-engine.test.ts`），因此 Java 抽象类当前没有被正确归类。

这两个问题都属于 P1 基础补全，变更面小，但若不修复，会持续让 Java 插件在跨语言一致性上落后于已有插件实现。

## Goals

- 让 Java 依赖提取行为与仓库内其他语言插件保持一致，优先沿用已有模式而不是引入新的依赖模型。
- 让 `ArchJsonMapper` 在映射 Java 抽象类时输出 `type: 'abstract_class'`，同时保留 `isAbstract: true`。
- 通过单元测试和集成测试覆盖 Maven、Gradle 与抽象类映射，确保改动可回归验证。

## Non-Goals

- 不引入新的 Java 构建系统支持，例如 `build.gradle.kts`、`settings.gradle`、Maven BOM、Version Catalog。
- 不把当前正则解析器升级为 XML/TOML/Gradle AST 解析器。
- 不扩展 ArchJSON 类型系统；`abstract_class` 已经存在，本次只修复 Java 映射使用方式。
- 不调整 Java 插件的项目发现逻辑；`JavaPlugin.canHandle()` 仍只检查 `.java`、`pom.xml`、`build.gradle`。

## Design

### 1. Java 依赖提取对齐现有插件模式

`src/plugins/java/dependency-extractor.ts` 继续保留当前入口结构：

- `extractDependencies(workspaceRoot)` 先检查 `pom.xml`
- 若不存在，再检查 `build.gradle`
- 两者都不存在时返回空数组

这与 Python 插件当前“优先主清单，存在则直接采用，否则回退到次级清单”的模式一致：

- Python: `pyproject.toml` 优先于 `requirements.txt`
- Java: `pom.xml` 优先于 `build.gradle`

本次只修复输出约定，不改变该优先级。

#### 输出约定

`Dependency.source` 改为与其他插件一致的清单文件名，而不是绝对路径：

- Maven 依赖: `source: 'pom.xml'`
- Gradle 依赖: `source: 'build.gradle'`

其余字段保持当前实现语义：

- `type: 'maven'`
- `scope` 继续通过 `mapMavenScope()` / `mapGradleScope()` 映射到标准 `DependencyScope`
- `isDirect: true`

#### 测试策略

补充 `tests/plugins/java/dependency-extractor.test.ts`，明确断言：

- Maven 依赖的 `source === 'pom.xml'`
- Gradle 依赖的 `source === 'build.gradle'`
- `extractDependencies()` 在 Maven 与 Gradle 同时存在时优先返回 Maven 结果

其中：

- `extractFromMaven()` / `extractFromGradle()` 继续复用 `tests/fixtures/java/pom.xml` 与 `tests/fixtures/java/build.gradle`
- `extractDependencies()` 的优先级测试应使用测试内临时目录，同时写入 `pom.xml` 与 `build.gradle`，避免 `tests/fixtures/java` 固有结构掩盖分支覆盖意图

### 2. Java 抽象类映射为 `abstract_class`

`src/plugins/java/archjson-mapper.ts` 的 `mapClass()` 当前无条件输出 `type: 'class'`。本次改为：

- `cls.isAbstract === true` 时输出 `type: 'abstract_class'`
- 否则输出 `type: 'class'`

其他字段保持不变：

- `isAbstract` 仍输出为 `true`
- `extends`、`implements`、成员映射逻辑不调整
- 关系生成仍按类实体处理，不需要修改 `mapRelations()`

#### 测试策略

补充 `tests/plugins/java/archjson-mapper.test.ts`，在已有 “should map abstract class correctly” 用例中额外断言：

- `entities[0].type === 'abstract_class'`

再补充至少一个 Java 插件测试，验证真实 Java 代码中的抽象类经过 `JavaPlugin.parseCode()` 或 `parseProject()` 后输出 `abstract_class`。如果现有 fixture 不包含抽象类，测试应在临时目录中写入最小 Java 文件，而不是为本次改动扩增新的长期 fixture。

### 3. 风险控制

这两个改动都局限在 Java 插件内部：

- 依赖提取改动不影响解析主流程，只影响 `dependencyExtractor`
- `abstract_class` 修复只影响 Java 实体类型，不影响 TypeScript/Go/Python/C++

唯一需要注意的是测试断言和消费方对 `Dependency.source` 的兼容性。本仓库现有其他插件已经使用文件名约定，因此 Java 对齐后是降低而不是增加跨语言差异。

## Alternatives

### Alternative A: 保持 Java `source` 为绝对路径

不采用。这样虽然能保留调用方传入信息，但会继续与 Python/TypeScript 插件不一致，且测试 fixture 路径在不同机器上不稳定。

### Alternative B: 为 Java 再新增 `groupId` 字段

不采用。`Dependency` 接口当前没有该字段，本次目标是基础补全，不是扩展依赖模型。

### Alternative C: 只保留 `isAbstract: true`，不修改 `type`

不采用。仓库查询层已经把 `abstract_class` 视为独立实体类型；仅保留布尔字段会让 Java 抽象类无法被按类型查询。

## Open Questions

- 是否需要在后续工作中支持 `build.gradle.kts`？本次不做；如果用户后续提出 Kotlin Gradle 支持，应作为独立 feature 处理。
- Maven 依赖缺失 `<version>`、使用属性变量或 BOM 继承时是否需要更强解析？本次不做，继续保持当前正则提取能力范围。
