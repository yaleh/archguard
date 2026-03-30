# Proposal: 分析前 LLM 语义探索 — 用项目理解替代硬编码规则

**状态**: Draft (v1)
**日期**: 2026-03-30
**关联**: [ADR-008](../adr/008-llm-semantic-exploration-before-analysis.md)、proposal-coverage-fisher-information.md、proposal-language-knowledge-registry.md

---

## 背景与动机

### 问题：硬编码规则无法覆盖项目多样性

ArchGuard 的分析管线在多个位置依赖硬编码的启发式规则：

```typescript
// fim-builder.ts — 10 个前缀无法覆盖所有非生产目录
const NON_PRODUCTION_PREFIXES = [
  'test', '__test', 'example', 'template', 'script',
  'vendor', 'doc', 'fixture', 'mock', 'bench',
];

// typescript/index.ts — 硬编码测试文件 pattern
isTestFile(filePath) {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath);
}

// extractTestStructure — 硬编码断言关键词
const assertionPatterns = ['expect(', 'assert(', '.assert'];
```

在 FIM 自分析中，这些规则的局限性直接影响了度量质量：

| 事件 | 影响 |
|------|------|
| `playground/` 未被识别为非生产 | FIM 包含无关包，κ 被扭曲 |
| barrel-file `src` 未被检测为退化包 | κ=105.8 vs 真实 κ=36.4 |
| `import type` 被计为覆盖 | `src/types` selfInfo 虚增 ~12×，4/7 耦合对虚假 |
| Mantel 在 12 包全集上运行 | 41% 零对人为抬高 r（0.761→0.747 修正） |

### 核心洞察

这些知识有一个共同特征：**对人类显而易见，但对规则引擎不可见**。

一个开发者看到 `playground/` 目录会立即知道它不是生产代码。看到 `jest.config.js` 会知道测试 pattern 写在里面。看到 `testing.h` 定义了 `t.assert_equal()` 会知道这是断言框架。

LLM 具有这种"看一眼就懂"的能力。问题是如何将它结构化地注入分析管线。

---

## 设计

### ProjectSemantics 类型

LLM 探索的输出是一个结构化的 `ProjectSemantics` 对象：

```typescript
export interface ProjectSemantics {
  /** Schema version for forward compatibility */
  version: '1.0';

  /** Directories/packages that are NOT production code */
  nonProductionPatterns: string[];
  // e.g. ["playground", "demo", "internal/testutil", "samples"]

  /** Barrel files (pure re-export, no logic) — candidates for FIM exclusion */
  barrelFiles: string[];
  // e.g. ["src/index.ts", "src/types/index.ts"]

  /** Test file patterns beyond language defaults */
  additionalTestPatterns: string[];
  // e.g. ["**/*.integration.ts", "**/*_bench_test.go"]

  /** Custom assertion functions/patterns the project uses */
  customAssertionPatterns: string[];
  // e.g. ["t.assert_equal(", "verify(", "check.That("]

  /** Architectural layer mapping (directory → semantic role) */
  architecturalLayers?: Record<string, string>;
  // e.g. { "src/domain": "domain", "src/infra": "infrastructure", "src/app": "application" }

  /** Suggested package aggregation depth (default: 2) */
  suggestedDepth?: number;

  /** Confidence score (0-1) — LLM self-assessment */
  confidence: number;

  /** Source of this configuration */
  source: 'llm-exploration' | 'user-config' | 'default';
}
```

### 探索流程

```
archguard analyze -s ./src --fim --fim-validate
    │
    ├─ [1] 检查缓存：.archguard/project-semantics.json 存在且未过期？
    │       → 是：直接使用
    │       → 否：进入 [2]
    │
    ├─ [2] 检查 LLM 可用性：claude/codex CLI 可调用？
    │       → 否：使用硬编码默认值（当前行为）
    │       → 是：进入 [3]
    │
    ├─ [3] LLM 探索调用
    │       输入：目录树 (depth 3) + 配置文件列表 + README 前 50 行
    │       输出：ProjectSemantics JSON
    │       写入：.archguard/project-semantics.json
    │
    ├─ [4] 用户覆盖合并
    │       archguard.config.json 中的 projectSemantics 字段覆盖 LLM 输出
    │
    └─ [5] 注入分析管线
            isProductionPackage() 使用 nonProductionPatterns
            isTestFile() 使用 additionalTestPatterns
            extractTestStructure() 使用 customAssertionPatterns
            derivePackageNames() 使用 suggestedDepth
            filterProductionPackages() 使用 barrelFiles
```

### LLM 调用设计

**输入 prompt**（< 2K tokens）：

```
You are analyzing a software project to extract structural conventions.

Project tree (depth 3):
{tree output}

Config files found:
{list of jest.config.js, vitest.config.ts, pytest.ini, go.mod, etc.}

README excerpt (first 50 lines):
{readme content}

Respond with JSON only, following this schema:
{ProjectSemantics schema}

Guidelines:
- nonProductionPatterns: directories that contain example code, demos, playgrounds,
  test utilities, benchmarks, documentation generators, or build scripts.
  Do NOT include standard test directories (tests/, __tests__/) — those are handled separately.
- barrelFiles: files that only re-export from other files (index.ts, mod.rs, __init__.py)
  with no logic of their own.
- customAssertionPatterns: assertion/verification functions defined in this project
  (not standard framework assertions like expect/assert).
- architecturalLayers: only if the project has clear layered architecture
  (DDD, hexagonal, clean architecture). Omit if unclear.
- confidence: your confidence that these classifications are correct (0-1).
```

**关键约束**：
- 输出必须是 valid JSON，解析失败则 fallback 到默认值
- 不传递源代码内容，只传目录结构和配置文件名
- 单次调用，不迭代

### 三层优先级

```
archguard.config.json (手写)    ← 最高优先级，用户完全控制
    ↓
.archguard/project-semantics.json (LLM 生成)
    ↓
硬编码默认值 (NON_PRODUCTION_PREFIXES 等)    ← fallback
```

配置合并规则为**数组合并、标量覆盖**：
```typescript
// nonProductionPatterns = union(user, llm, default)
// suggestedDepth = user ?? llm ?? 2
// barrelFiles = union(user, llm)  (no default)
```

### 缓存策略

- 缓存文件：`.archguard/project-semantics.json`
- 失效条件：
  1. 文件不存在
  2. 顶层目录结构变化（新增/删除一级目录）
  3. `--no-cache` 标志
- 不基于时间失效（目录结构变化频率远低于代码变化）

---

## 受影响的硬编码知识清单

| 知识 | 当前位置 | ProjectSemantics 字段 | 优先级 |
|------|---------|---------------------|--------|
| 非生产包前缀 | `fim-builder.ts` `NON_PRODUCTION_PREFIXES` | `nonProductionPatterns` | P0 |
| Barrel file 检测 | 无（手动排除） | `barrelFiles` | P0 |
| 测试文件 pattern | 各语言插件 `isTestFile()` | `additionalTestPatterns` | P1 |
| 断言关键词 | `extractTestStructure()` | `customAssertionPatterns` | P1 |
| 包聚合深度 | `derivePackageNames()` depth=2 | `suggestedDepth` | P2 |
| 架构层级 | 未实现 | `architecturalLayers` | P2 |

P0 直接影响 FIM 核心度量（κ、Mantel r），应首先实现。

---

## 与现有系统的关系

### TestPatternConfig（已有）

`TestPatternConfig` 是一个先例：MCP 工具 `archguard_detect_test_patterns` 先检测项目的测试约定，输出 `suggestedPatternConfig`，然后用户可以修改后传入后续分析。

`ProjectSemantics` 是这个模式的泛化：从"测试约定"扩展到"所有项目语义约定"。实现时可以将 `TestPatternConfig` 的相关字段（`assertionPatterns`、`testFileGlobs`）映射到 `ProjectSemantics` 的对应字段。

### Language Knowledge Registry（提案中）

Knowledge Registry 解决的是**语言/框架知识**（"Kotlin 用 `@Controller`"），是跨项目通用的。
LLM 探索解决的是**项目特异性知识**（"这个项目的 `playground/` 是演示代码"），是每个项目独有的。

两者互补：
```
                   通用 ←————————————→ 特异
                     │                  │
Knowledge Registry   ■■■■■■■■■          │
                     │                  │
LLM Exploration      │          ■■■■■■■■■
                     │                  │
Hardcoded Rules      ■■■■■              │
```

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| LLM 输出不正确（误分类生产目录为非生产） | confidence < 0.7 时降级为默认值；缓存可审查和手动修改 |
| LLM 不可用（无 API key、离线环境） | 优雅降级到硬编码默认值，行为与当前版本完全一致 |
| 输出格式不合法 | JSON schema 验证 + try/catch fallback |
| 缓存失效不及时 | 目录结构变化检测 + `--no-cache` 强制刷新 |
| 隐私顾虑（目录结构发送给 LLM） | 仅发送目录名（depth 3）和配置文件名，不发送文件内容 |
| 增加首次运行延迟 | LLM 调用 ~2-5s，后续运行走缓存，无延迟 |

---

## 实现路径

### Phase 1：ProjectSemantics 类型 + 注入点

- 定义 `ProjectSemantics` 接口（`src/types/extensions/project-semantics.ts`）
- 在 `isProductionPackage()` 中接受 `nonProductionPatterns` 参数
- 在 `filterProductionPackages()` / `filterProductionCoverage()` 中透传
- 在 `archguard.config.json` 中支持 `projectSemantics` 字段
- 不涉及 LLM 调用——纯类型 + 手动配置路径

### Phase 2：LLM 探索调用 + 缓存

- 实现 `ProjectSemanticsExplorer`（`src/analysis/project-semantics-explorer.ts`）
- 调用 claude/codex CLI 执行探索
- 输出写入 `.archguard/project-semantics.json`
- 缓存失效逻辑（目录结构 hash）
- CLI flag: `--explore`（显式触发）/ `--no-explore`（禁用）

### Phase 3：扩展到测试分析

- `additionalTestPatterns` → `isTestFile()` 注入
- `customAssertionPatterns` → `extractTestStructure()` 注入
- 与现有 `TestPatternConfig` 合并逻辑

### Phase 4：架构层级 + 深度建议

- `architecturalLayers` → 包级图的分组标签
- `suggestedDepth` → `derivePackageNames()` 参数化
- 多深度 FIM 报告（depth=2, depth=suggestedDepth）

---

## 开放问题

1. **MCP 集成**：是否通过新 MCP 工具 `archguard_explore_project` 暴露 ProjectSemantics？还是只在 CLI 管线内部使用？

2. **增量更新**：当用户手动修改 `.archguard/project-semantics.json` 后，LLM 重新探索时是否应该 merge（保留用户修改）还是 overwrite？

3. **多语言 monorepo**：一个 workspace 下有 Go + TypeScript 子项目时，应该产出一个还是多个 ProjectSemantics？

4. **LLM 选择**：是复用 ArchGuard 已有的 `--cli-command` 配置，还是允许独立的 `--explore-model` 参数？考虑到探索任务简单（< 2K tokens），可能更适合 haiku/flash 级别的小模型。
