# ADR-008: 分析前 LLM 语义探索层

**Status**: Proposed
**Date**: 2026-03-30
**Context**: [proposal-llm-semantic-exploration.md](../proposals/proposal-llm-semantic-exploration.md)
**Decision Makers**: ArchGuard Team

---

## Context

ArchGuard 的多个分析模块依赖硬编码的启发式规则来区分"生产代码"与"非生产代码"。这些规则以 denylist/allowlist 的形式散布在代码中：

| 硬编码位置 | 知识类型 | 局限性 |
|-----------|---------|--------|
| `fim-builder.ts` `NON_PRODUCTION_PREFIXES` | 非生产包前缀 | 无法识别 `playground/`, `demo/`, `internal/testutil` |
| 各语言插件 `isTestFile()` | 测试文件模式 | 无法读取 `jest.config.js`、`pytest.ini` 等配置 |
| `extractTestStructure()` | 断言关键词 | 无法识别公司内部测试框架 |
| `derivePackageNames()` depth=2 | 包聚合粒度 | 一刀切，不适应 monorepo / flat layout |

这些规则有两个共同特征：
1. **项目特异性**：不同项目、语言、组织有不同的约定
2. **语义性**：需要理解项目意图（"这个目录是什么用途"），而非仅解析语法

当前的硬编码方案无法覆盖长尾项目，且每次发现新约定都需要修改源码。

### 前序事件

在 FIM 自分析中发现 `NON_PRODUCTION_PREFIXES` denylist 的问题：
- `playground/` 等非标准目录名未被识别
- barrel-file 退化包（`src` 根目录 re-export）无法自动检测
- Mantel 检验因包含非生产包的零覆盖对而被人为抬高（r=0.761→0.747 修正）

## Decision Drivers

- ArchGuard 已有 LLM 集成路径（`--cli-command claude`、MCP server）
- 语义知识的获取成本极低（单次 LLM 调用，读取目录树 + 配置文件）
- `TestPatternConfig` 已证明"外部注入分析配置"的模式可行（ADR-002 v1.2）
- 硬编码规则的维护成本随语言数量线性增长（目前 5 种语言 × N 种约定）
- 分析结果的可信度依赖于这些规则的正确性（FIM κ、Mantel r 直接受影响）

## Considered Options

### Option A: 继续扩展硬编码规则

逐语言、逐框架添加规则到 denylist/allowlist。

**Pros**:
- 零额外依赖
- 确定性结果（同输入→同输出）
- 无 LLM 成本

**Cons**:
- 规则数量无界增长
- 每个新项目布局都可能需要改代码
- 无法处理组织内部约定

### Option B: 用户手写配置文件

在 `archguard.config.json` 中添加 `projectSemantics` 字段，用户手动填写。

**Pros**:
- 零 LLM 依赖
- 用户完全控制
- 确定性

**Cons**:
- 用户需要了解 ArchGuard 内部概念（"什么是非生产包"）
- 首次使用门槛高
- 大多数用户不会配置 → 退化为 Option A

### Option C: LLM 语义探索 + 结构化配置注入

在分析管线前插入一个 LLM 探索阶段：读取项目结构 → 输出 `ProjectSemantics` 配置 → 注入分析管线。

**Pros**:
- 自适应任意项目布局
- 单次调用，成本可控（输入 < 2K tokens）
- 输出是结构化 JSON，可缓存、可审查、可手动覆盖
- 与现有 `TestPatternConfig` 模式一致

**Cons**:
- 引入 LLM 依赖（非确定性）
- 需要 fallback 到 Option A（无 LLM 时）
- 首次运行增加 ~2-5s 延迟

### Option D: Language Knowledge Registry (proposal-language-knowledge-registry.md)

用声明式 YAML 规则包替代硬编码逻辑。

**Pros**:
- 确定性，无 LLM 依赖
- 社区可贡献规则包

**Cons**:
- 解决的是语言/框架知识，不解决项目特异性问题
- 规则包仍无法知道"这个 `playground/` 目录是什么"
- 实施成本远高于 Option C

## Decision

采用 **Option C: LLM 语义探索 + 结构化配置注入**，辅以 Option A 作为 fallback，Option B 作为用户覆盖层。

三层优先级：
```
用户手写配置 > LLM 探索结果 > 硬编码默认值
```

核心设计约束：
1. **LLM 输出必须是结构化 JSON**（`ProjectSemantics`），不是自由文本
2. **输出可缓存**：写入 `.archguard/project-semantics.json`，后续运行直接读取
3. **输出可审查**：用户可以查看和修改缓存文件
4. **无 LLM 时优雅降级**：退回硬编码规则，不报错
5. **不改变分析管线内部**：仅替换规则的来源，不改变规则的消费方式

## Consequences

### Positive

- FIM/Mantel 等度量的准确性不再受限于硬编码规则的覆盖面
- 新项目零配置即可获得合理的语义分类
- 与 Option D (Knowledge Registry) 互补而非互斥——Registry 提供语言知识，LLM 提供项目知识

### Negative

- LLM 输出可能不正确（需要 validation + fallback）
- 引入 `.archguard/project-semantics.json` 缓存文件（需要 cache invalidation 策略）
- 测试中需要 mock LLM 调用

## Implementation

见 [proposal-llm-semantic-exploration.md](../proposals/proposal-llm-semantic-exploration.md)。

## Related Decisions

- [ADR-002](./002-archjson-extensions.md) — `extensions` 字段设计，`TestPatternConfig` 注入模式
- [ADR-006](./006-mcp-tool-design-standards.md) — MCP 工具设计规范（LLM 交互接口）
- [proposal-language-knowledge-registry.md](../proposals/proposal-language-knowledge-registry.md) — 声明式规则包（互补方案）
- [proposal-coverage-fisher-information.md](../proposals/proposal-coverage-fisher-information.md) — FIM 分析（受非生产包规则直接影响）
