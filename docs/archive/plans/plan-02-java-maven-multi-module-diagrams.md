# Plan 02: Java Maven 多模块图谱检测与分组修复

## Overview

本计划落实 [proposal-java-maven-multi-module-diagrams.md](/home/yale/work/archguard/docs/proposals/proposal-java-maven-multi-module-diagrams.md) 中定义的 Java 默认分析修复，目标是让 Maven 多模块项目在默认输出中：

- 生成根级 `overview/package` 与 `class/all-classes`
- 额外生成每个 Maven 子模块的 `class/<module>`
- 让 package 图按 Maven 模块分组，而不是退化成 `Main Layer` / `Test Layer`

实现范围覆盖三条调用链：

- `normalizeToDiagrams()` 的 Java diagram 规划
- Java Maven 多模块检测器
- Mermaid `HeuristicGrouper` 的 Java/Maven grouping 逻辑

## Phases

### Phase A: Java diagram 规划与结构检测

Objectives

- 引入 Java 专属 Maven 多模块检测器
- 让 `normalizeToDiagrams()` 在 Java 场景改走专属检测器
- 保持现有 TypeScript / Python / C++ 路径不回归

Stages

1. 先补失败测试
   - 新增 `tests/unit/cli/utils/java-project-structure-detector.test.ts`
   - 扩展 `tests/unit/cli/commands/analyze.test.ts`
   - 扩展 `tests/unit/cli/utils/project-structure-detector.test.ts`
   - 先让以下断言失败：
     - Maven `<modules>` 会生成根级 package/class + 模块级 class 图
     - `--lang java` 不再走 `createProjectRootLanguageDiagrams()`
     - 通用结构检测器支持以 `['.java']` 作为 source extensions
2. 实现 Java 检测器
   - 新增 `src/cli/utils/java-project-structure-detector.ts`
   - 解析根 `pom.xml` 的 `<modules>`
   - 过滤不存在或无 `.java` 文件的模块
   - 输出带 `language: 'java'` 的 DiagramConfig 列表
3. 接入 diagram 规划
   - 修改 `src/cli/analyze/normalize-to-diagrams.ts`
   - `cliOptions.sources + --lang java` 走 `detectJavaProjectStructure()`
   - `cliOptions.lang === 'java'` 且未传 `-s` 时也走 `detectJavaProjectStructure(resolvedRoot)`
4. 泛化通用结构检测器
   - 修改 `src/cli/utils/project-structure-detector.ts`
   - `hasTopLevelSourceFiles()` / `getTopLevelModules()` 接收可选扩展名参数
   - 递归 source 检测改为基于扩展名集合，而不是硬编码 `.ts/.js`

Acceptance Criteria

- 针对带 `<modules>` 的 Maven 项目，diagram 规划输出至少包含：
  - `<label>/overview/package`
  - `<label>/class/all-classes`
  - `<label>/class/<module>`
- 所有 Java 规划出的 diagrams 都带 `language: 'java'`
- `normalizeToDiagrams()` 的 Java 分支测试通过，且 TypeScript/C++ 既有测试不回归
- 通用结构检测器新增扩展名参数后，默认行为保持原样

Dependencies

- 依赖现有 `DiagramConfig`、`normalizeToDiagrams()` 和 C++ 检测器风格
- 不依赖 Java parser 或 Mermaid renderer 改动

### Phase B: Java package 图按 Maven 模块分组

Objectives

- 修复 Java package 图把 `src/main` / `src/test` 误识别成 package 的问题
- 在不影响其他语言的前提下，为 Java 添加 Maven-aware grouping

Stages

1. 先补失败测试
   - 扩展 `tests/unit/mermaid/grouper.test.ts`
   - 构造 Java `ArchJSON`，sourceLocation 指向：
     - `jlama-core/src/main/java/...`
     - `jlama-cli/src/test/java/...`
   - 先让以下断言失败：
     - 分组名包含 `Jlama Core Layer` / `Jlama Cli Layer`
     - 不再出现 `Main Layer` / `Test Layer`
2. 实现 Java/Maven grouping
   - 修改 `src/mermaid/grouper.ts`
   - 为 `groupByPath()` 增加 Java 语言专属分支
   - 文件路径命中 `<module>/src/main/java` 或 `<module>/src/test/java` 时，返回 `<module>` 作为 grouping key
   - 未命中 Maven 模式时回退到现有 `extractPackageName()`
3. 验证格式化与兼容性
   - 确认 `formatPackageName()` 对 `jlama-core` 输出 `Jlama Core Layer`
   - 确认 TypeScript 既有 grouping 测试仍通过

Acceptance Criteria

- Java Maven 路径按模块名分组
- Java package 图不再退化成 `Main Layer` / `Test Layer`
- TypeScript 现有 grouper 测试全部通过

Dependencies

- 依赖 Phase A 不强；可独立实施
- 依赖 `HeuristicGrouper` 现有 grouping pipeline

### Phase C: 回归验证

Objectives

- 证明新实现不会破坏现有 CLI 分析主流程
- 用最小成本验证 proposal 中的关键结果

Stages

1. 跑目标单测
   - `tests/unit/cli/utils/java-project-structure-detector.test.ts`
   - `tests/unit/cli/utils/project-structure-detector.test.ts`
   - `tests/unit/cli/commands/analyze.test.ts`
   - `tests/unit/mermaid/grouper.test.ts`
2. 跑一轮相关聚合测试
   - 若 Java 或 CLI 相关测试链路存在高相关 suite，则补跑
3. 人工复核 acceptance criteria
   - 检查输出命名、language 标记、模块过滤和 package grouping 行为

Acceptance Criteria

- 所有新增与受影响单测通过
- 无新增 lint/type/test 回归
- proposal 中列出的三个问题点均被覆盖并验证

Dependencies

- 依赖 Phase A 与 Phase B 完成
