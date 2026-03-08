# Proposal: Java Maven 多模块图谱检测与分组修复

## Problem Statement

当前 Java 项目的默认分析在两个层面明显失真：

1. `src/cli/analyze/normalize-to-diagrams.ts` 对 `--lang java` 直接调用 `createProjectRootLanguageDiagrams()`，固定只生成 `<label>/overview/package` 与 `<label>/class/all-classes` 两张根级图，不会像 C++ 的 `detectCppProjectStructure()` 那样为多模块项目拆分附加 class 图。
2. 即使回退到通用 `src/cli/utils/project-structure-detector.ts`，其 `directoryHasSourceFiles()`、`hasTopLevelSourceFiles()` 和 `getTopLevelModules()` 只识别 `.ts/.js`，因此 Java/Maven 子模块目录不会被视为 source module。
3. package 图的默认分组由 `src/mermaid/grouper.ts` 的 `extractPackageName()` 决定。该逻辑基于路径片段 `src/lib/packages/app/...` 推导“包名”，对 Maven 典型路径 `module/src/main/java/com/...` 会稳定抽到 `main` / `test`，而不是 Maven 模块名或 Java package 名，导致 `overview/package.mmd` 只剩极少分组。

这会让典型 Maven 多模块仓库在默认分析下出现两个错误信号：

- `class/` 目录只有一张巨大的 `all-classes`，缺少模块级拆分图；
- `overview/package.mmd` 的分组聚合到 `Main Layer` / `Test Layer` 等伪分层，无法表达真实模块边界。

## Goals

- 为 Java 引入 Maven 多模块感知，使默认 diagram 规划可以生成根级图以及每个 Maven 模块的 class 图。
- 让 Java 默认 package 图优先按 Maven 模块边界分组，而不是把 `src/main` / `src/test` 误当作 package。
- 保持现有 TypeScript / Python / Go / C++ 默认规划与 Mermaid 渲染行为不回归。
- 用单元测试覆盖结构检测、diagram 规划与 Java package 分组。

## Non-Goals

- 不在本次实现中支持 Gradle multi-project（`settings.gradle`）结构检测。
- 不修改 Java tree-sitter 解析器，不新增 import 级别解析，也不改变 `ArchJsonMapper` 的关系语义。
- 不为 Java 默认增加 method 级图；本次仍保持 Java 只输出 package/class 两层。
- 不重写整套 Mermaid grouping 框架；只在现有 `HeuristicGrouper` 中增加 Java/Maven 识别分支。

## Design

### 1. 新增 Java 专属结构检测器

新增 `src/cli/utils/java-project-structure-detector.ts`，职责与 `src/cli/utils/cpp-project-structure-detector.ts` 类似，但面向 Maven：

- 检测根目录 `pom.xml` 中的 `<modules>` 列表；
- 仅保留实际存在且包含 `.java` 源文件的子模块；
- 生成 diagrams：
  - `<label>/overview/package`，`sources: [projectRoot]`
  - `<label>/class/all-classes`，`sources: [projectRoot]`
  - `<label>/class/<module>`，`sources: [<absolute module path>]`
- 所有 DiagramConfig 都带 `language: 'java'`，并透传 `format` / `exclude`。

这样 Java 默认分析将与 C++ 一样具备“根级概览 + 子模块 class 图”的结构，但仍维持 Java 的两层默认输出。

### 2. 让 `normalizeToDiagrams()` 为 Java 走专属分支

在 `src/cli/analyze/normalize-to-diagrams.ts` 中：

- `cliOptions.sources + --lang java` 时，不再调用 `createProjectRootLanguageDiagrams()`；
- 改为解析 `sources[0]` 的绝对路径，并调用新的 `detectJavaProjectStructure()`；
- `cliOptions.lang === 'java'` 且未显式传 `-s` 时，也应从 `resolvedRoot` 直接调用 `detectJavaProjectStructure()`。

这能修复当前 Java 被强制压平成两张根级图的问题，同时不影响 `python` / `typescript` 的既有逻辑。

### 3. 通用结构检测器补齐扩展名可配置能力

`src/cli/utils/project-structure-detector.ts` 当前把“source file”硬编码为 `.ts/.js`。本次将其泛化为可配置扩展名：

- 导出一个默认扩展名常量，保持现有 TypeScript/JavaScript 默认行为；
- `hasTopLevelSourceFiles()`、`directoryHasSourceFiles()`、`getTopLevelModules()` 接受可选 `extensions` 参数；
- 默认参数仍为 `['.ts', '.js']`，确保现有调用和测试无需整体重写。

虽然 Java 默认规划会优先走专属检测器，但这个改动本身是必要的基础修复：它让通用检测器不再把“source”概念硬编码为 TS/JS，也为后续非 TypeScript 语言复用留下正确接口。

### 4. Java package 图按 Maven 模块分组

在 `src/mermaid/grouper.ts` 中，为 `groupByPath()` 增加 Java/Maven 路径识别：

- 当 `archJson.language === 'java'` 时，优先根据源文件路径提取 Maven 模块名；
- 识别模式：`<project>/<module>/src/main/java/...`、`<project>/<module>/src/test/java/...`；
- 命中时返回 `<module>` 作为 grouping key；
- 若文件直接位于根模块的 `src/main/java` 或 `src/test/java` 下，则回退为项目根 source dir 的直接子目录或父目录规则，而不是返回 `main` / `test`。

这样：

- Maven 多模块项目的 package 图会显示 `jlama-core`、`jlama-cli` 之类真实模块边界；
- 单模块 Java 项目若只有根 `src/main/java`，仍可回退到已有路径启发式，不会被强制命名为 `Main Layer`。

### 5. 测试策略

新增或扩展以下测试：

- `tests/unit/cli/utils/java-project-structure-detector.test.ts`
  - `pom.xml` 含 `<modules>` 时返回根级 package/class + 模块级 class 图；
  - 忽略不存在模块、无 `.java` 模块和 `target/` 等噪声目录；
  - 根级 diagrams 的 `sources[0] === projectRoot`；
  - 所有 diagrams 透传 `language` / `format` / `exclude`。
- `tests/unit/cli/commands/analyze.test.ts`
  - `--lang java` 时验证 `normalizeToDiagrams()` 调用 `detectJavaProjectStructure()`，而不是 `createProjectRootLanguageDiagrams()`。
- `tests/unit/cli/utils/project-structure-detector.test.ts`
  - 覆盖扩展名参数化行为，例如 `getTopLevelModules(..., ['.java'])` 可以识别 Java 源目录。
- `tests/unit/mermaid/grouper.test.ts`（若已有同类测试文件则复用，否则新增）
  - Java + Maven 路径时按模块名分组；
  - 不再把 `src/main/java` / `src/test/java` 聚成 `Main Layer` / `Test Layer`。

## Alternatives

### Alternative A: 只修改 `project-structure-detector.ts`

不采用。即便让通用检测器接受 `.java`，Java 默认规划仍然会因为 `normalizeToDiagrams()` 的硬编码分支而绕过它，且 package 图分组问题也不会解决。

### Alternative B: package 图直接按 Java `package` 语句第一段分组

本次不采用。对 `com.github.tjake.jlama.*` 这种仓库，第一段通常恒定为 `com`，分组价值很低；按 Maven 模块名更接近用户实际目录与构建边界。

### Alternative C: 为 Java 增加 method/<module> 图

本次不采用。Java 默认图层当前是 package/class 两层，直接新增 method 图会扩大输出规模并改变默认体验，不属于本次 bugfix 范围。

## Open Questions

- 是否需要在后续工作中支持 Gradle multi-project（`settings.gradle`）？当前代码库已经能通过 `build.gradle` 识别 Java 语言，但没有多项目结构规划；建议后续作为独立 feature。
- 根 POM 使用 `<modules>` 之外的继承/聚合模式时，是否需要额外解析 `<packaging>pom</packaging>` 或父子 POM 关系？本次先聚焦最常见且可稳定验证的 `<modules>` 列表解析。
