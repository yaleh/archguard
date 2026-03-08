# Plan 01: Java 构建依赖提取与抽象类实体类型修复

## Overview

本计划落实 [proposal-java-build-dependency-extraction-and-abstract-class-fix.md](/home/yale/work/archguard/docs/proposals/proposal-java-build-dependency-extraction-and-abstract-class-fix.md) 中定义的两个 P1 改动：

- 对齐 `src/plugins/java/dependency-extractor.ts` 的输出约定，使其与 Python/TypeScript 插件一致
- 修复 `src/plugins/java/archjson-mapper.ts` 对 Java 抽象类的实体类型映射

实施必须遵循 TDD：每个阶段先补充或调整失败测试，再修改实现直到测试通过。

## Phases

### Phase 1: Java 依赖提取对齐

#### Objectives

- 让 Maven/Gradle 依赖提取输出稳定的 `source` 文件名
- 明确 `extractDependencies()` 的优先级行为
- 确认 Java 插件集成层继续可用且不回归

#### Stages

1. 补充失败测试

- 修改 `tests/plugins/java/dependency-extractor.test.ts`
- 为 Maven 分支增加 `source === 'pom.xml'` 断言
- 为 Gradle 分支增加 `source === 'build.gradle'` 断言
- 新增临时目录测试，同时写入 `pom.xml` 和 `build.gradle`，先让 `extractDependencies()` 优先级断言失败

2. 实现对齐

- 修改 `src/plugins/java/dependency-extractor.ts`
- 保持现有 Maven 优先、Gradle 回退逻辑
- 将 `extractFromMaven()` / `extractFromGradle()` 生成的 `Dependency.source` 改为固定文件名

3. 回归验证

- 运行 Java 依赖提取相关单测
- 运行 `tests/integration/plugins/java-plugin.integration.test.ts` 中依赖提取场景，确认插件入口未受影响

#### Acceptance Criteria

- `extractFromMaven()` 返回的每个依赖都以 `pom.xml` 作为 `source`
- `extractFromGradle()` 返回的每个依赖都以 `build.gradle` 作为 `source`
- 当项目根目录同时存在 `pom.xml` 和 `build.gradle` 时，`extractDependencies()` 返回 Maven 结果
- Java 插件依赖提取集成测试通过

#### Dependencies

- 依赖现有 fixture：`tests/fixtures/java/pom.xml`、`tests/fixtures/java/build.gradle`
- 不依赖后续抽象类修复阶段，可独立完成

### Phase 2: 抽象类实体类型修复

#### Objectives

- 在 Java 映射层正确输出 `abstract_class`
- 保持现有 `isAbstract`、关系提取和普通类映射行为不变

#### Stages

1. 补充失败测试

- 修改 `tests/plugins/java/archjson-mapper.test.ts`
- 让已有抽象类用例额外断言 `type === 'abstract_class'`
- 在 `tests/integration/plugins/java-plugin.integration.test.ts` 增加最小抽象类用例；优先使用临时目录或内联代码，避免引入新的长期 fixture

2. 实现修复

- 修改 `src/plugins/java/archjson-mapper.ts`
- 在 `mapClass()` 中基于 `cls.isAbstract` 切换 `Entity.type`
- 不调整 `mapRelations()`、成员映射或 `JavaRawClass` 结构

3. 回归验证

- 运行 Java mapper 与插件集成测试
- 如有必要，补跑与 `abstract_class` 查询语义关联的现有单测，确认 ArchJSON 类型兼容

#### Acceptance Criteria

- Java 抽象类映射结果包含 `type: 'abstract_class'`
- 同一实体仍保留 `isAbstract: true`
- 普通 Java 类仍输出 `type: 'class'`
- Java 插件解析包含抽象类的代码时，产出的 ArchJSON 与上述约定一致

#### Dependencies

- 依赖 Phase 1 已完成的测试基线，但实现层面不依赖 Phase 1 代码
- 依赖 `src/types/index.ts` 中现有 `EntityType` 已包含 `abstract_class`

### Phase 3: 全量验证

#### Objectives

- 确认两个 P1 改动一起落地后没有引入 Java 插件回归

#### Stages

1. 运行针对性测试集

- `tests/plugins/java/dependency-extractor.test.ts`
- `tests/plugins/java/archjson-mapper.test.ts`
- `tests/integration/plugins/java-plugin.integration.test.ts`

2. 运行项目级验证命令

- 执行 `npm run type-check`
- 如前述针对性测试已通过，再执行 `npm run test -- --runInBand` 的替代等价命令并不适用 Vitest；本仓库应直接执行 `npm run test`

3. 检查结果并修补

- 若出现回归，优先修复实现或测试夹具问题
- 重新运行受影响命令直到通过

#### Acceptance Criteria

- 上述 Java 相关测试全部通过
- `npm run type-check` 通过
- `npm run test` 通过，或明确记录与本次改动无关的既有失败
- 变更与 proposal 保持一致，无额外行为漂移

#### Dependencies

- 依赖 Phase 1 与 Phase 2 都已完成
