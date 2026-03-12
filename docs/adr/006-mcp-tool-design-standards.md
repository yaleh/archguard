# ADR-006: MCP Tool 设计规范

**状态**: Accepted
**日期**: 2026-03-12
**决策者**: ArchGuard 架构团队

---

## 上下文

ArchGuard MCP server 目前已暴露 14 个工具（10 个查询工具 + 4 个测试分析工具 + 1 个分析工具），未来随着功能扩展，工具数量还会增加。

当前代码库中工具的描述、命名、参数 schema 和输出格式缺乏一致的标准。调研发现以下问题：

1. **描述质量参差不齐** — 部分描述过于简短（如 `"Get a summary of the architecture scope"`），缺少使用时机和精度说明；部分早期描述冗余（4 句话 + "IMPORTANT" 前缀）
2. **局限性未在工具描述中体现** — 静态分析的近似性质、已知误报场景只存在于文档，LLM 在调用工具时无法感知
3. **`patternConfig` 参数文档误导** — 参数 schema 暗示在 query 时传入 patternConfig 可影响结果，但实际无效
4. **错误响应格式不一致** — 部分错误通过异常冒泡，部分通过 `textResponse("Error: ...")` 返回

MCP 工具描述是 LLM 选择和正确调用工具的唯一依据，其质量直接决定 agent 行为是否符合预期。需要建立统一规范，覆盖工具设计的全生命周期。

---

## 决策驱动因素

- LLM 依赖工具描述进行工具选择，描述质量决定 agent 调用准确率
- Claude Code 在工具数量超过上下文窗口 10% 时会启用延迟加载，此时工具描述尤为关键
- 静态分析工具存在系统性误差，必须在工具层面明确告知，而非只写在文档中
- 工具增加后，命名冲突和职责模糊的风险随之上升
- 需要可审查的、可执行的规范，而不是松散的建议

---

## 决策

建立并强制执行以下 MCP tool 设计规范，覆盖命名、描述、参数 schema、输出格式和错误处理五个维度。

---

## 规范详述

### 1. 命名规范

**格式**: `{server}_{动词}_{资源}`，全小写，下划线分隔，1–64 字符，仅允许 `[a-zA-Z0-9_-]`。

| 规则 | 正例 | 反例 |
|---|---|---|
| 加 server 前缀，避免跨 server 冲突 | `archguard_get_dependencies` | `get_dependencies` |
| 动词语义明确 | `detect_cycles`, `find_subclasses` | `cycles`, `subclasses_check` |
| 不为参数变体单独建工具 | `get_atlas_layer` + `layer` 参数 | `get_atlas_package_layer`, `get_atlas_capability_layer` |
| 查询用 `get`/`find`/`detect`，写操作用 `analyze`/`create`/`update` | `archguard_analyze` | `archguard_run` |

---

### 2. 工具描述规范

#### 2.1 长度与结构

- **1–2 句**，用分号或破折号将同一句话的并列内容连接，避免独立第三句
- **动词开头**（Return / Detect / Find / Analyze），不用 "Get" 等模糊词
- **第一句说 what**，**第二句（或分号后）说 when / limitation / workflow 依赖**

#### 2.2 前置关键信息

AI agent 可能不会读完完整描述。影响工具选择和结果解读的内容必须放在句首。

```
✅ Return per-entity coverage links inferred by static import-path matching and
   filename conventions, not runtime tracing; scores are an approximation and
   may miss coverage via path aliases or indirect imports.

❌ Get test coverage map for the analyzed project. IMPORTANT: Call
   archguard_detect_test_patterns first ...
```

#### 2.3 局限性内联

凡工具结果存在系统性近似、已知误报或语义限制，必须在描述中用分号/破折号内联说明，**不得仅写在文档中**。

```
✅ Return static-analysis test quality issues (orphan tests, zero-assertion
   files, skip accumulation); orphan_test and zero_assertion may produce false
   positives when tests use import aliases, custom assertion helpers, or long
   setup blocks.

❌ Return test quality issues for the analyzed project.
```

#### 2.4 工作流依赖

若工具 B 必须在工具 A 之后调用，必须在 B 的描述末尾声明，格式为：`Call {toolName} first.`

```
✅ "...Call archguard_detect_test_patterns first."
✅ "Call discover_required_fields('Contact') first to identify mandatory fields."
❌ "IMPORTANT: You must call archguard_detect_test_patterns first to get the
   correct patternConfig for this project."
```

#### 2.5 禁止项

- 禁止使用 "IMPORTANT:" 前缀 — 应直接写入关键约束，不需要大写强调
- 禁止在描述中罗列参数细节 — 参数说明放 schema description
- 禁止使用第一人称或命令式语气 — 使用第三人称描述性语气

---

### 3. 参数 Schema 规范

#### 3.1 每个参数必须有 `description`

```typescript
// ✅
name: z.string().describe('Entity name to search for')

// ❌
name: z.string()
```

#### 3.2 可选参数必须说明默认值和影响

```typescript
// ✅
depth: z.coerce.number().min(1).max(5).default(1)
  .describe('BFS traversal depth (1-5)')

// ✅ 带行为说明
verbose: z.boolean().default(false)
  .describe('Return full entities with members. Default false returns summary only.')
```

#### 3.3 已知无效参数必须标注

若某参数被 schema 接受但实际在当前实现中不生效，必须在 description 中注明，不得沉默接受。

```typescript
// ✅
patternConfig: patternConfigSchema.describe(
  'Pattern config for detection (informational only — re-analysis requires ' +
  'running archguard_analyze with includeTests: true; changing this field ' +
  'at query time has no effect on returned data).'
)
```

#### 3.4 使用 `enum` 约束离散值

凡参数取值有限，必须使用 `z.enum([...])` 而非 `z.string()`，帮助 LLM 生成合法调用。

---

### 4. 输出格式规范

#### 4.1 统一使用 `textResponse` 包装

所有工具返回值必须经过 `textResponse(text)` 包装，格式为：
```json
{ "content": [{ "type": "text", "text": "..." }] }
```

禁止直接返回裸字符串或其他结构。

#### 4.2 输出应为高信号信息

- 避免直接 dump 完整原始数据结构，优先返回摘要 + 关键字段
- 大结果集需要分页时，在描述或输出中说明如何限制范围
- Claude Code 在单工具输出超过 10,000 token 时会发出警告，超过 25,000 token 时截断

#### 4.3 stdout 只能输出 JSON-RPC 消息

调试日志、进度信息必须写到 `stderr`，不得污染 `stdout`。

---

### 5. 错误处理规范

#### 5.1 工具内部错误用 `textResponse` 返回，不抛异常

```typescript
// ✅
try {
  // ...
} catch (e: any) {
  return textResponse(`Error: ${e.message}`);
}

// ❌
// 让异常冒泡到 MCP SDK
```

#### 5.2 错误消息必须具体可操作

```
✅ "No query data found at /path/.archguard/query.
    Run archguard_analyze({ projectRoot: \"/path\" }) first."

✅ "No test analysis data found.
    Run archguard_analyze with includeTests: true first."

❌ "Error 500"
❌ "Something went wrong"
```

#### 5.3 前置条件未满足时给出明确的恢复指引

当工具依赖前序工具的产物（如 query scopes、test analysis data）时，未满足条件的错误消息必须包含恢复步骤。

---

## 现有工具达标情况

| 工具 | 描述长度 | 局限性内联 | 工作流依赖 | Schema 完整 |
|---|---|---|---|---|
| `archguard_summary` | ❌ 过短 | N/A | N/A | ✅ |
| `archguard_find_entity` | ❌ 过短 | N/A | N/A | ✅ |
| `archguard_get_file_entities` | ❌ 过短 | N/A | N/A | ✅ |
| `archguard_get_package_stats` | ✅ | N/A | N/A | ✅ |
| `archguard_get_dependencies` | ✅ | N/A | N/A | ✅ |
| `archguard_get_dependents` | ✅ | N/A | N/A | ✅ |
| `archguard_find_subclasses` | ✅ | N/A | N/A | ✅ |
| `archguard_find_implementers` | ✅ | N/A | N/A | ✅ |
| `archguard_detect_cycles` | ✅ | N/A | N/A | ✅ |
| `archguard_detect_test_patterns` | ✅ | N/A | N/A | ✅ |
| `archguard_get_test_metrics` | ✅ | ✅ | ✅ | ⚠️ patternConfig 待标注 |
| `archguard_get_entity_coverage` | ✅ | ✅ | ✅ | ✅ |
| `archguard_get_test_issues` | ✅ | ✅ | ✅ | ⚠️ patternConfig 待标注 |
| `archguard_analyze` | ✅ | N/A | N/A | ✅ |

待修复项：
- `archguard_summary`、`archguard_find_entity`、`archguard_get_file_entities` 描述过短
- 三个测试查询工具的 `patternConfig` 参数缺少"当前无效"说明

---

## 后果

### 正面影响

- LLM agent 调用准确率提升，减少因描述歧义导致的工具误用
- 静态分析局限性在调用层即可感知，减少对分析结果的过度解读
- 新增工具有明确设计标准，减少 PR review 中的主观争论
- 工具质量可量化评审（5 个维度逐项检查）

### 负面影响

- 存量工具需要补齐（约 3 个描述过短，3 个 schema 需补注释）
- 每次新增工具需要对照检查清单，有少量额外工作量

---

## 实施要求

### 存量修复（优先级：高）

1. 补充 `archguard_summary`、`archguard_find_entity`、`archguard_get_file_entities` 的描述，遵循本 ADR 的 2.1–2.3 规则
2. 为三个测试查询工具的 `patternConfig` 参数补充 "informational only" 说明

### 新增工具检查清单

新增或修改工具时，PR 必须通过以下检查：

- [ ] 工具名符合 `archguard_{动词}_{资源}` 格式
- [ ] 描述为 1–2 句，动词开头
- [ ] 关键局限性/误报风险已内联到描述
- [ ] 工作流依赖（若有）在句末声明
- [ ] 每个参数有 `describe()`，可选参数说明默认值
- [ ] 已知无效参数在 schema 中标注
- [ ] 错误通过 `textResponse` 返回，消息包含恢复指引
- [ ] 调试输出只写 `stderr`

---

## 代码审查规则

凡涉及 `src/cli/mcp/` 目录的 PR，评审时必须检查：

1. 新增工具描述是否符合命名规范和 1–2 句格式
2. 有局限性的工具是否已将局限性写入描述（不得仅写在 `docs/`）
3. `patternConfig` 类无效参数是否已在 schema description 中标注
4. 错误处理是否返回具体可操作的恢复指引
5. 工具输出是否在合理 token 范围内（无超大 payload dump）

---

## 相关决策

- [ADR-004: CLI 与 MCP 必须共享单一分析写盘路径](./004-single-analysis-write-path-for-cli-and-mcp.md)
- [docs/user-guide/mcp-usage.md — Known Limitations](../user-guide/mcp-usage.md#known-limitations)
