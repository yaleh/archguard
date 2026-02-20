# ArchGuard Go 语言支持实施建议 (Proposal)

**文档版本**: 1.0
**创建日期**: 2026-02-20
**关联文档**: 03-multi-language-support.md
**目标示例项目**: `/home/yale/work/codex-swarm`

---

## 1. 执行摘要与目标

本文档旨在规划为 ArchGuard 引入对 Go 语言（Golang）项目的架构分析支持。为了保持本项目的总体架构（基于 `ILanguagePlugin` 插件化和统一的 Arch-JSON Schema），我们将实现一个专门针对 Go 的解析器插件。

**核心目标：**
- 保持 ArchGuard 现有基于插件的分析架构。
- 增加对 Go 语言项目（如微服务结构、特定包管理机制）的无缝架构分析。
- 支持 Go 特有的配置项和执行参数。
- 采用严格的分阶段实施策略，保障每一阶段都有稳定可运行的交付物。

---

## 2. 架构设计

为保持总体架构，我们将依据 `03-multi-language-support.md` 中的 `ILanguagePlugin` 接口，创建一个 `GoPlugin`。

### 2.1 核心组件抽象
- **GoPlugin**: 实现 `ILanguagePlugin` 接口，负责判断文件处理权并调度解析任务。
- **GoASTExtractor**: 因为 Go 的 AST 较难在纯 Node.js/TS 环境中完美解析，我们将引入一个轻量级的 Go CLI 工具（或基于 WASM 的跨平台解析器）专门负责提取 Go 源码 AST，转换为标准 JSON。
- **ArchJSON Mapper**: TypeScript 端负责接收并清洗 GoASTExtractor 输出，映射为 ArchGuard 统一的 `ArchJSON` 实体和关系（如 struct 映射为 `class`/`struct`，interface 映射为 `interface`，并识别 composition 与组合关系）。

### 2.2 增加的配置与参数

针对 Go 项目特性，`ArchGuardConfig` 及 CLI 参数需扩展以下配置：

| 参数/配置项 | 类型 | 描述 |
| --- | --- | --- |
| `goModPath` | string | Go 语言入口 `go.mod` 所在相对或绝对路径，用于精确解析模块依赖。 |
| `excludeVendor` | boolean | 默认 `true`。是否排除分析 `vendor/` 目录下引入的第三方库，聚焦于业务代码。 |
| `analyzeTests` | boolean | 默认 `false`。是否分析 `_test.go` 文件中的测试用例结构。 |
| `buildTags` | string[] | 指定特定的 build tags（如 `linux`, `integration`），在解析时生效。 |

以目标示例 `/home/yale/work/codex-swarm` 为例，用户可通过以下方式运行：
```bash
archguard generate -p /home/yale/work/codex-swarm --lang go --excludeVendor true
```

---

## 3. 分阶段实施路径

为降低风险并保障持续交付，本功能将分四个阶段实施。

### 阶段 1: 基础语法解析与单个文件提取 (MVP)
**目标**: 实现对单一 `.go` 文件的基本实体提取（Structs, Interfaces, Functions）。
**任务**:
1. 初始化 `plugins/golang` 目录，实现空的 `GoPlugin` 接口。
2. 开发核心的 `GoASTExtractor`（可以通过包装原生 `go/parser` 并输出 JSON）。
3. 实现基础的 `ArchJSON` 映射器。
**可运行交付物**: 
- CLI 支持解析单个 `example.go` 文件并正确输出包含 Entities 的 `ArchJSON`。

### 阶段 2: 项目级解析与包管理支持
**目标**: 支持真实项目的多文件解析，并处理 Go 的包（Package）隔离和内部依赖引用。
**任务**:
1. 支持 `goModPath` 及工作区分析。
2. 识别不同包之间的引用关系（Relations 映射为依赖/组合）。
3. 加入 `excludeVendor` 配置项支持。
**测试用例**:
- 使用 `/home/yale/work/codex-swarm` 中的子模块进行解析测试。
**可运行交付物**: 
- CLI 能够扫描 `/home/yale/work/codex-swarm` 整个项目，并输出完整的依赖与结构 JSON，但不包含图表生成。

### 阶段 3: 图表生成与多级架构渲染支持
**目标**: 确保生成的 Go ArchJSON 可以无缝对接 ArchGuard 的图表生成器（Mermaid）。
**任务**:
1. 适配 Go 特有的组合（Struct Embedding）至 Mermaid 图的组合关系。
2. 处理包级依赖图（Package-level dependency diagram）。
**测试用例**:
- 针对 `codex-swarm` 生成模块级别的 Mermaid 类图和包依赖图。
**可运行交付物**: 
- 完整命令 `archguard generate -p /home/yale/work/codex-swarm` 成功产出包含 Go 项目架构的 Markdown 及 Mermaid 图形文件。

### 阶段 4: 性能优化与深度分析特性
**目标**: 针对大中型 Go 项目进行并行解析和分析。
**任务**:
1. 实现针对 Go 文件的 `parseBatch` 批量并行处理。
2. 支持识别复杂接口实现（Duck Typing 的隐式实现识别）。
3. 添加 `analyzeTests` 和 `buildTags` 支持。
**可运行交付物**: 
- 对 `codex-swarm` 提供全面的静态分析文档并展现解析性能优化后的执行日志。

---

## 4. 示例项目应用 (`codex-swarm`)

在实施过程中，我们将严格把控 `/home/yale/work/codex-swarm` 作为一个标准集成测试基线。

通过分析该项目，我们将提炼以下特定模式并保证支持：
- **微服务/P2P架构模式**的包依赖识别。
- **并发模式**相关实体的映射与处理机制。
- 复杂的 **接口嵌套** 与隐式实现识别。

---

## 5. 预期影响与兼容性
- **无破坏性变更**：作为 `plugins/golang` 动态挂载，不会影响现有 TypeScript 的分析逻辑。
- **对 Arch-JSON Schema 的扩展**：仅在 `Entity` 的 `type` 中深度使用 `struct` 类型，在 `metadata` 中附加 Go 特有的 receiver 信息，与现有 Schema 完全兼容。

