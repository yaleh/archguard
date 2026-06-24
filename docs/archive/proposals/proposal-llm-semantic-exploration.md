# Proposal: 分析前 LLM 语义探索 — 用项目理解替代硬编码规则

**状态**: Draft (v2 — reviewed)
**日期**: 2026-03-30
**关联**: [ADR-008](../adr/008-llm-semantic-exploration-before-analysis.md)、proposal-coverage-fisher-information.md、proposal-language-knowledge-registry.md

---

## 架构审查记录 (v2)

> **审查人**: Architect review
> **日期**: 2026-03-30
>
> 总体评价：提案方向正确，`ProjectSemantics` 作为结构化配置注入点的设计与现有 `TestPatternConfig` 模式一致。以下是需要修正的问题、补充的缺失内容和强化的薄弱环节。所有修改已直接合并到正文中，重大变更标记为 **[REVIEW]**。

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

> **[REVIEW] 注意：`import type` 计为覆盖是 relation-extractor.ts / coverage-parser.ts 中的独立 bug，不属于本提案的 LLM 语义探索范围。** 当前 `relation-extractor.ts` 不区分 `import type` 和 `import`，所有 import 声明都产出 dependency relation。这应该作为单独的 fix 处理（在 relation-extractor 中检测 `importDecl.isTypeOnly()` 并标记 relation type），不应依赖 ProjectSemantics 来解决。保留在背景表中作为动机说明，但实现计划中不涵盖此项。

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

  /** Suggested package aggregation depth (default: 1, matching aggregateToPackageLevel) */
  suggestedDepth?: number;

  /** Confidence score (0-1) — LLM self-assessment */
  confidence: number;

  /** [REVIEW — REMOVED] `source` field removed per review: per-field provenance tracking
   *  is handled in cache metadata, not in the type itself. See review comment on Problem 4. */

  /** [REVIEW] Directory tree hash used for cache invalidation */
  _dirTreeHash?: string;

  /** [REVIEW] Timestamp of generation for diagnostics (ISO 8601) */
  _generatedAt?: string;
}
```

> **[REVIEW] ProjectSemantics 类型设计审查**
>
> **问题 1 — `barrelFiles` 无法仅凭目录树识别。** LLM 仅接收目录树 (depth 3) 和配置文件名，不接收文件内容。要判断一个 `index.ts` 是否只包含 re-export，需要读取文件内容。因此 `barrelFiles` 字段有两个选择：
> - (a) 降低为**候选列表**（LLM 猜测哪些 index 文件可能是 barrel），由分析管线做 AST 验证
> - (b) 在 prompt 输入中额外提供候选 index 文件的前 10 行内容（增加 token 成本但提高准确性）
>
> **建议采用 (a)**：将字段语义改为"barrel file 候选列表"，实现时在 `filterProductionPackages()` 中做 AST 级验证（检查是否只有 export/re-export 语句）。prompt 中指导 LLM 输出常见 barrel 文件路径模式（如 `*/index.ts`, `*/__init__.py`, `*/mod.rs`）即可。
>
> **问题 2 — `nonProductionPatterns` 语义不明确。** 当前 `isProductionPackage()` 做的是前缀匹配（`first.startsWith(prefix)`），而 `nonProductionPatterns` 字段名暗示可以是 glob pattern。需要明确：
> - 值是精确目录名前缀（与现有 `NON_PRODUCTION_PREFIXES` 行为一致）？
> - 还是 minimatch/glob pattern（更灵活但需要引入 glob 匹配逻辑）？
>
> **建议**：Phase 1 保持前缀语义（与现有代码兼容），Phase 2 扩展为 glob。在类型注释中明确记录当前语义。
>
> **问题 3 — `customAssertionPatterns` 格式不一致。** 现有 `TestPatternConfig.assertionPatterns` 是 `string[]`，但各插件对它的使用方式不同：
> - TypeScript/Python 插件：`line.includes(pattern)` — 简单子串匹配
> - C++ 插件：使用 RegExp 对象，不读取 `patternConfig`
> - MCP tools (`buildSuggestedPatternConfig`)：输出 regex 字符串（`\\bexpect\\s*\\(`）
>
> 这意味着 `customAssertionPatterns` 必须明确定义是 substring 还是 regex。**建议统一为 regex string**，与 `buildSuggestedPatternConfig` 输出一致，并在注入点统一用 `new RegExp(pattern)` 匹配。Phase 3 实现时需要同步修改 TypeScript/Python 插件的 `extractTestStructure` 来支持 regex。
>
> **问题 4 — 缺少 `source` 字段的合并语义。** 当三层配置合并后，最终对象的 `source` 应该是什么？如果用户配置覆盖了部分字段、LLM 提供了其他字段，`source` 字段无法准确反映来源。**建议**：移除顶层 `source` 字段，改为在缓存文件元数据中记录来源，或者改为 `sources: Record<string, 'user-config' | 'llm-exploration' | 'default'>` 按字段级别追踪来源。

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
            aggregateToPackageLevel() 使用 suggestedDepth
            filterProductionPackages() 使用 barrelFiles
```

> **[REVIEW] 流程补充 — 步骤 [3] 与 [4] 之间缺少 JSON Schema 验证步骤。**
>
> LLM 输出即使是 valid JSON 也可能违反 schema（例如 `confidence` 为字符串而非数字、`version` 缺失、`nonProductionPatterns` 中含有 `..` 路径遍历等）。应在 [3] 和 [4] 之间插入：
>
> ```
> ├─ [3.5] Zod schema 验证 + 安全检查
> │         → schema 不合法：fallback 到默认值，log warning
> │         → 路径遍历检测：过滤含 ".." 或绝对路径的 pattern
> │         → confidence < 0.5：fallback 到默认值
> ```
>
> 使用 Zod 而非手写验证，与项目中已有的 MCP tool schema 验证（`test-analysis-tools.ts` 使用 `z` from `zod`）保持一致。

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

> **[REVIEW] Prompt 设计问题**
>
> **问题 1 — `barrelFiles` 指导矛盾。** prompt 说 "files that only re-export" 但 LLM 无法看到文件内容（仅有目录树）。需要将指导改为："List files that are likely barrel/re-export files based on their name and position (e.g., index.ts at module root, __init__.py, mod.rs). These are candidates — actual verification will be done by the analysis pipeline."
>
> **问题 2 — 缺少输出格式硬化。** 最佳实践建议在 prompt 中提供一个完整的 JSON 示例（one-shot example），而非仅给 schema。这能显著提高 JSON 格式合规率。建议追加一个示例输出：
>
> ```
> Example output for a Go microservice project:
> {
>   "version": "1.0",
>   "nonProductionPatterns": ["examples", "tools/codegen", "testutil"],
>   "barrelFiles": [],
>   "additionalTestPatterns": ["**/*_bench_test.go"],
>   "customAssertionPatterns": ["require.Equal(", "assert.NoError("],
>   "confidence": 0.85
> }
> ```
>
> **问题 3 — temperature 未指定。** 对于 JSON 提取任务，LLM temperature 应设为 0.0-0.1 以减少格式漂移。在 CLI 调用中通过参数传递。
>
> **问题 4 — 大型项目 token 溢出。** 声称 "< 2K tokens" 但对于深度为 3 的大型 monorepo（如 chromium、kubernetes），目录树可能超过 10K tokens。需要指定：当 `tree` 输出超过阈值（如 1500 tokens / ~6KB）时，截断并追加 `... (truncated, {N} more directories)`。

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
// suggestedDepth = user ?? llm ?? 1  (matches aggregateToPackageLevel default)
// barrelFiles = union(user, llm)  (no default)
```

> **[REVIEW] 合并规则需要更精确的规范**
>
> "数组合并"存在歧义：
> - `nonProductionPatterns`: union 语义合理（更多排除 = 更安全）
> - `additionalTestPatterns`: union 语义合理
> - `customAssertionPatterns`: union 语义合理
> - `barrelFiles`: union 语义合理
>
> 但需要考虑**用户想删除 LLM 误判的条目**的情况。纯 union 无法做到这一点。建议支持前缀 `!` 排除语法：
> ```json
> {
>   "projectSemantics": {
>     "nonProductionPatterns": ["!tools"]
>   }
> }
> ```
> 含义：从 LLM + default 合并结果中移除 `tools`。这样用户可以修正 LLM 的错误分类而不需要列举所有正确值。
>
> 另外，`architecturalLayers` 是 `Record<string, string>`，"数组合并"不适用。需要明确：用户 config 的 key 覆盖 LLM 的同 key，其余 key 保留 LLM 值（即 `Object.assign(llmLayers, userLayers)`）。

### 缓存策略

- 缓存文件：`.archguard/project-semantics.json`
- 失效条件：
  1. 文件不存在
  2. 顶层目录结构变化（新增/删除一级目录）
  3. `--no-cache` 标志
- 不基于时间失效（目录结构变化频率远低于代码变化）

> **[REVIEW] 缓存策略强化**
>
> **问题 1 — "顶层目录结构变化"检测方式未定义。** 需要明确算法：
> ```typescript
> // 计算一级目录列表的稳定 hash
> const dirs = fs.readdirSync(projectRoot, { withFileTypes: true })
>   .filter(d => d.isDirectory() && !d.name.startsWith('.'))
>   .map(d => d.name)
>   .sort();
> const hash = crypto.createHash('sha256').update(dirs.join('\n')).digest('hex');
> ```
> 将 hash 存储在 `project-semantics.json` 的 `_dirTreeHash` 字段中。加载缓存时重新计算并对比。
>
> **问题 2 — 仅检测一级目录不够。** 如果用户在 `src/` 下新增了 `src/playground/` 子目录，一级目录未变化但语义已变化。建议扩展为 depth-2 目录列表 hash，与 LLM prompt 中使用的 depth-3 树保持接近。
>
> **问题 3 — 配置文件变化也应触发失效。** 如果项目新增了 `jest.config.js` 或 `pytest.ini`，测试约定可能已变，但目录结构未变。建议将配置文件列表也纳入 hash 计算：
> ```typescript
> const configFiles = ['jest.config.js', 'vitest.config.ts', 'pytest.ini',
>   'go.mod', 'Cargo.toml', 'CMakeLists.txt', 'pom.xml', 'build.gradle']
>   .filter(f => fs.existsSync(path.join(projectRoot, f)));
> const hashInput = dirs.join('\n') + '\n---\n' + configFiles.join('\n');
> ```
>
> **问题 4 — 缺少版本迁移策略。** 当 `ProjectSemantics.version` 从 `'1.0'` 升级到 `'1.1'` 时，旧缓存应自动失效。在加载逻辑中检查 `cached.version !== CURRENT_VERSION` 即可。

---

## 受影响的硬编码知识清单

| 知识 | 当前位置 | ProjectSemantics 字段 | 优先级 |
|------|---------|---------------------|--------|
| 非生产包前缀 | `fim-builder.ts` `NON_PRODUCTION_PREFIXES` | `nonProductionPatterns` | P0 |
| Barrel file 检测 | 无（手动排除） | `barrelFiles` | P0 |
| 测试文件 pattern | 各语言插件 `isTestFile()` | `additionalTestPatterns` | P1 |
| 断言关键词 | `extractTestStructure()` | `customAssertionPatterns` | P1 |
| 包聚合深度 | `aggregateToPackageLevel()` depth=1 | `suggestedDepth` | P2 |
| 架构层级 | 未实现 | `architecturalLayers` | P2 |

> **[REVIEW] 硬编码位置清单补充 — 遗漏项**
>
> | 知识 | 当前位置 | 遗漏原因 |
> |------|---------|---------|
> | 测试路径 pattern | `coverage-parser.ts` `isTestLikePath()` — 硬编码 `/(tests?\|__tests__)/` 和 `(test\|spec)\.[^.]+$` | 影响 FIM coverage matrix 的 test/source 分离 |
> | 测试目录推断 | `test-analyzer.ts` `inferTestDirs()` — 硬编码候选目录列表 | 影响测试文件发现 |
> | Go 测试文件 | `golang/index.ts` `isTestFile()` — 硬编码 `_test.go` | Go 约定极稳定，优先级低 |
> | Java 测试文件 | `java/index.ts` `isTestFile()` — 硬编码 `src/test/` 和 `Test*.java` | Maven 约定稳定，但自定义项目可能不同 |
> | C++ 测试文件 | `cpp/index.ts` `isTestFile()` — 硬编码 `test-*.cpp`/`test_*.cpp` | 无通用约定，最需要 LLM 辅助 |
> | 路径约定覆盖映射 | `test-coverage-mapper.ts` — 各语言 path-convention 硬编码 | 影响 entityCoverageRatio |
>
> 建议将 `coverage-parser.ts` 中的 `isTestLikePath()` 也列为 P1，因为它直接影响 FIM coverage matrix。

P0 直接影响 FIM 核心度量（κ、Mantel r），应首先实现。

---

## 与现有系统的关系

### TestPatternConfig（已有）

`TestPatternConfig` 是一个先例：MCP 工具 `archguard_detect_test_patterns` 先检测项目的测试约定，输出 `suggestedPatternConfig`，然后用户可以修改后传入后续分析。

`ProjectSemantics` 是这个模式的泛化：从"测试约定"扩展到"所有项目语义约定"。实现时可以将 `TestPatternConfig` 的相关字段（`assertionPatterns`、`testFileGlobs`）映射到 `ProjectSemantics` 的对应字段。

> **[REVIEW] TestPatternConfig 合并策略需要具体定义**
>
> 现有流程中 `TestPatternConfig` 通过 MCP tool 生成并传入分析。如果 `ProjectSemantics` 也定义了 `customAssertionPatterns` 和 `additionalTestPatterns`，两者冲突时如何处理？
>
> 建议的优先级链：
> ```
> MCP tool 传入的 TestPatternConfig (运行时参数)
>   > archguard.config.json 中的 projectSemantics
>     > .archguard/project-semantics.json (LLM 缓存)
>       > 硬编码默认值
> ```
>
> Phase 3 实现时，需要在 `test-analyzer.ts` 中实现合并逻辑：如果 `patternConfig` 已由 MCP caller 提供，则忽略 `ProjectSemantics` 中的测试相关字段。这保证了 MCP 工具的 Pattern-First workflow 不被破坏。

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
| LLM 输出不正确（误分类生产目录为非生产） | confidence < 0.5 时硬拒绝（fallback 到默认值）；0.5-0.7 时在 verbose 模式下发出低置信度警告；缓存可审查和手动修改 |
| LLM 不可用（无 API key、离线环境） | 优雅降级到硬编码默认值，行为与当前版本完全一致 |
| 输出格式不合法 | Zod schema 验证 + try/catch fallback |
| 缓存失效不及时 | depth-2 目录结构 + 配置文件列表 hash + schema version 检查 + `--no-cache` 强制刷新 |
| 隐私顾虑（目录结构发送给 LLM） | 仅发送目录名（depth 3）和配置文件名，不发送文件内容 |
| 增加首次运行延迟 | LLM 调用 ~2-5s，后续运行走缓存，无延迟 |

> **[REVIEW] 补充风险**
>
> | 风险 | 缓解 |
> |------|------|
> | **路径遍历/注入** — LLM 输出含 `../../etc/passwd` 或绝对路径 `/home/user/secret` | Zod 验证后做安全过滤：拒绝含 `..` 的路径、拒绝绝对路径、拒绝含 null byte 的字符串 |
> | **非确定性导致 CI 不稳定** — 不同运行产生不同 ProjectSemantics，导致 FIM 指标波动 | CI 环境应 commit `.archguard/project-semantics.json` 到仓库，或使用 `--no-explore` flag 冻结配置 |
> | **Token 成本失控** — monorepo 目录树超大 | 对 tree 输出设置硬上限（如 6KB / ~1500 tokens），超出时截断 |
> | **LLM 与默认值语义冲突** — LLM 输出的 `nonProductionPatterns` 与 `NON_PRODUCTION_PREFIXES` 的前缀匹配语义不一致 | Phase 1 文档明确语义（前缀 vs glob），在注入点统一处理 |

---

## 实现路径

### Phase 1：ProjectSemantics 类型 + 注入点

- 定义 `ProjectSemantics` 接口（`src/types/extensions/project-semantics.ts`）
- 在 `isProductionPackage()` 中接受 `nonProductionPatterns` 参数
- 在 `filterProductionPackages()` / `filterProductionCoverage()` 中透传
- 在 `archguard.config.json` 中支持 `projectSemantics` 字段
- 不涉及 LLM 调用——纯类型 + 手动配置路径

> **[REVIEW] Phase 1 补充任务**
>
> - 在 `GlobalConfig`（`src/types/config-global.ts`）中添加 `projectSemantics?: Partial<ProjectSemantics>` 字段（注：`ArchGuardConfig extends GlobalConfig`）
> - 添加 Zod schema `ProjectSemanticsSchema` 用于运行时验证
> - `isProductionPackage(name, extraPatterns?: string[])` — 签名扩展，保持向后兼容（无参数时行为不变）
> - 在 `aggregateToPackageLevel(coverage, fileIds, depth)` 中透传 `suggestedDepth`（当前默认 depth=1）
> - 编写 unit tests 验证：(a) 旧行为不变、(b) 传入自定义 patterns 时生效
> - **预计工作量**：2-3 天

### Phase 2：LLM 探索调用 + 缓存

- 实现 `ProjectSemanticsExplorer`（`src/analysis/project-semantics-explorer.ts`）
- 调用 claude/codex CLI 执行探索
- 输出写入 `.archguard/project-semantics.json`
- 缓存失效逻辑（depth-2 目录结构 + 配置文件列表 hash）
- CLI flag: `--explore`（显式触发）/ `--no-explore`（禁用）

> **[REVIEW] Phase 2 补充任务**
>
> - 实现 tree 输出截断逻辑（>= 6KB 时截断，追加摘要行）
> - 在 prompt 中添加 one-shot JSON example
> - 通过 `--cli-command` 复用现有 CLI 配置（不引入 `--explore-model`，见开放问题 4 的决定）
> - 传递 `temperature: 0` 参数（若 CLI 支持）
> - 安全过滤：路径遍历检查、绝对路径拒绝
> - 集成测试：mock LLM CLI 调用（参考 `tests/integration/` 中 `skip-helper.ts` 模式）
> - **预计工作量**：3-4 天

### Phase 3：扩展到测试分析

- `additionalTestPatterns` → 合并到 `TestPatternConfig.testFileGlobs` 后传入 `isTestFile(filePath, patternConfig)` — 注意：`isTestFile` 已接受 `patternConfig?: TestPatternConfig` 参数，无需修改接口签名
- `customAssertionPatterns` → 扩展 `TestPatternConfig` 添加 `customAssertionRegexes?: string[]` 后传入 `extractTestStructure(filePath, code, patternConfig)` — 同样无需修改接口签名
- 与现有 `TestPatternConfig` 合并逻辑

> **[REVIEW] Phase 3 补充细节**
>
> - 扩展 `TestPatternConfig`（`src/types/extensions/test-analysis.ts`）添加 `customAssertionRegexes?: string[]` 字段 — 与 `buildSuggestedPatternConfig` 输出一致
> - 在各插件 `extractTestStructure` 中，当 `patternConfig.customAssertionRegexes` 存在时，用 `new RegExp(pattern).test(line)` 追加匹配（不修改现有 substring 匹配逻辑）
> - 将 `ProjectSemantics.additionalTestPatterns` 合并到 `TestPatternConfig.testFileGlobs` 中传入 — 无需修改 `isTestFile` 接口签名（已接受 `patternConfig?: TestPatternConfig`）
> - 定义 `TestPatternConfig` vs `ProjectSemantics` 的优先级链（MCP > user config > LLM > default）
> - 修改 `coverage-parser.ts` 中的 `isTestLikePath()` 接受额外 test patterns
> - **预计工作量**：3-4 天（包含 regex 追加的回归测试，不需要迁移现有 patterns）

### Phase 4：架构层级 + 深度建议

- `architecturalLayers` → 包级图的分组标签
- `suggestedDepth` → `aggregateToPackageLevel()` 的 `depth` 参数透传
- 多深度 FIM 报告（depth=1 默认, depth=suggestedDepth 对比）

---

## 开放问题

1. **MCP 集成**：是否通过新 MCP 工具 `archguard_explore_project` 暴露 ProjectSemantics？还是只在 CLI 管线内部使用？

> **[REVIEW] 建议**：Phase 1-2 仅 CLI 管线内部使用。Phase 3+ 可考虑添加 MCP tool 以允许 LLM agent 主动触发探索或查询/修改已缓存的 ProjectSemantics。MCP tool 的 input schema 应与 `archguard.config.json` 中的 `projectSemantics` 字段一致。

2. **增量更新**：当用户手动修改 `.archguard/project-semantics.json` 后，LLM 重新探索时是否应该 merge（保留用户修改）还是 overwrite？

> **[REVIEW] 建议**：overwrite LLM 缓存，但用户修改应放在 `archguard.config.json` 中，而非直接编辑缓存文件。缓存文件头部应包含注释警告：`// Auto-generated by ArchGuard LLM exploration. Do not edit — use archguard.config.json projectSemantics to override.`（注：JSON 不支持注释，但可以使用 `_warning` 字段或采用 JSONC 格式，与项目已有的 JSONC stripping 逻辑一致）。

3. **多语言 monorepo**：一个 workspace 下有 Go + TypeScript 子项目时，应该产出一个还是多个 ProjectSemantics？

> **[REVIEW] 建议**：产出单个 ProjectSemantics，因为 `nonProductionPatterns` 和 `barrelFiles` 的路径都是 workspace-relative 的。LLM 看到的目录树是整个 workspace 的 depth-3 树，自然覆盖所有子项目。如果未来需要 per-subproject 语义，可以扩展为 `subprojects?: Record<string, Partial<ProjectSemantics>>`。

4. **LLM 选择**：是复用 ArchGuard 已有的 `--cli-command` 配置，还是允许独立的 `--explore-model` 参数？考虑到探索任务简单（< 2K tokens），可能更适合 haiku/flash 级别的小模型。

> **[REVIEW] 建议**：复用 `--cli-command`，不引入新参数。原因：(a) 减少配置复杂性、(b) 大多数用户只配置一个 LLM 入口、(c) 探索任务的 token 成本极低（< 2K），即使用较大模型也不显著增加成本。如果未来有强需求，可以通过 `archguard.config.json` 中的 `exploration: { cliCommand: "..." }` 字段支持。

5. **[REVIEW] 新增 — `import type` 分离**：`import type` 被计为覆盖的问题是 `relation-extractor.ts` 的 bug，不应由本提案解决。建议创建独立 issue 跟踪：在 `relation-extractor.ts` 中检测 `importDecl.isTypeOnly()` 并为 type-only imports 标记 `relationType: 'type-dependency'`，在 FIM coverage matrix 构建时排除。

6. **[REVIEW] 新增 — 与 `--include-tests` / `--tests-only` flag 的交互**：当用户使用 `--include-tests` 时，`nonProductionPatterns` 中的测试目录排除是否仍然生效？需要明确：`nonProductionPatterns` 影响的是 FIM 的包过滤，不影响测试分析本身。两个关注点需要解耦。
