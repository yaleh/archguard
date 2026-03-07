# Proposal: Stateless MCP Server with Cross-Project Support

**状态**: Draft (rev 4)
**日期**: 2026-03-07
**取代**: [proposal-mcp-analyze-tool.md](./proposal-mcp-analyze-tool.md) 中的 session/scope 管理部分（即该提案的"Scope 刷新规则""设计原则 4: active scope 必须可刷新"等章节；该提案的 `runAnalysis()` 共享核心、stdout 治理、CLI/MCP 等价测试等内容仍然有效）
**关联**: [proposal-mcp-analyze-tool.md](./proposal-mcp-analyze-tool.md), [ADR-004](../adr/004-single-analysis-write-path-for-cli-and-mcp.md)

---

## 本轮审查结论

对照当前实现后，上一版文档有 5 个严重问题；如果不先修正，这份提案会直接把实现带偏：

1. **把”当前事实”和”目标状态”写混了**
   当前 MCP server 仍然是 `archDir + scopeKey + sessionRoot` 三元组驱动的有状态实现；文档中多处把”应当改成”写成了”已经如此”。

2. **`globalScopeKey` 语义描述不准确**
   当前默认 scope 并不是简单的”实体数最多 scope”，而是 `selectGlobalScopeKey()`（`query-artifacts.ts:77`）：
   - 优先选择 `kind === 'parsed'`
   - 再按 `entityCount` 最大选择
   - 最后按 `key` 字典序取**较小值**打破平局（`localeCompare < 0`）

3. **语言检测方案写成了另一套平行逻辑**
   当前 CLI 的自动检测主要经由 `normalizeToDiagrams()`、`detectProjectStructure()` 和插件能力完成；插件注册表里的 `DETECTION_RULES` 只是其中一部分。提案若再引入一套 MCP 专用检测表，最终必然与 CLI 漂移。

4. **Go / Atlas 语义被过度简化**
   当前用户输入语言值是 `go`，插件注册表内部名字是 `golang`；Go Atlas 的”默认启用”来自 CLI 归一化逻辑，而不是简单的”检测到 go.mod 就开启”。文档必须把这个映射和复用边界写清楚。

5. **`archguard_summary` 的返回契约被静默改坏**
   当前 `archguard_summary` 返回 JSON 摘要（`entityCount`, `relationCount`, `language`, `kind`, `topDependedOn`）。原文把它改成带 prose scope 列表的文本块，却没有把这定义为显式破坏性变更，也没有解释如何兼容现有调用方。

以下设计以消除这 5 个问题为前提。

---

## 背景

当前 MCP server 的核心问题不是“没有 `analyze` tool”本身，而是**查询上下文在 server 进程内被固定住了**。

现状如下：

- `archguard mcp` 启动时通过 `--arch-dir` 和 `--scope` 绑定一个查询上下文
- `createMcpServer(archDir, scopeKey, sessionRoot)` 在闭包里保存：
  - `activeScopeKey`
  - `enginePromise`
  - `sessionRoot`
- 8 个 query tools 都从这个闭包状态读取数据
- `archguard_analyze` 也默认写回这个会话绑定的 `archDir`

这导致两个结构性问题：

1. **跨项目分析与查询不可组合**
   server 启动后，配置发现、相对路径解析、query data 读取和分析产物写盘，都默认围绕启动时的上下文展开。要在同一 MCP session 内交替处理不同项目，必须重启 server 或人为绕很深的路径覆盖逻辑。

2. **会话状态复杂度过高**
   `activeScopeKey`、`enginePromise`、analyze 后的 invalidation / refresh 规则，本质上是在维护一个小型状态机。但 query layer 的真实数据源已经在磁盘上；保留这一层进程内状态，复杂度明显高于收益。

---

## 目标

1. MCP server 支持在同一进程内查询和分析多个项目。
2. query tools 与 analyze tool 都以 `projectRoot` 作为目标项目定位参数。
3. 查询语义从“读取 MCP 会话状态”改为“按调用参数从目标项目磁盘加载”。
4. CLI 与 MCP 继续共享唯一分析写盘路径 `runAnalysis()`。
5. 设计落地后，MCP server 重启不会丢失任何“当前会话绑定”的必要状态。

---

## 非目标

- 不在本提案中引入 streaming progress
- 不在本提案中增加远程多主机编排
- 不在本提案中重做 query artifact 格式
- 不在本提案中为了性能引入新的持久缓存层
- 不要求本提案必须同时交付 scope discovery 的新返回结构

---

## 破坏性变更

本提案包含 2 个明确的 breaking changes，必须在实现与发布说明中显式列出：

1. `archguard mcp` 启动参数删除 `--arch-dir` 与 `--scope`
2. 若选择给 `archguard_summary` 追加 `scope` / `availableScopes` 字段，这属于 MCP 响应的加法扩展，必须单独记录

其中第 1 项属于本提案的核心内容；第 2 项不是核心依赖，可以延后。

### 对 `--arch-dir` 非标准路径场景的影响

当前 `--arch-dir` 允许指向任意目录（例如 `archguard mcp --arch-dir /shared/archguard`），这意味着 query data 的读取位置可以与项目目录分离。

本提案的 `projectRoot` 模型假定 `workDir` 始终为 `<projectRoot>/.archguard`，**不再支持** query data 目录与项目根目录的分离。

理由：这种分离场景在实践中极少见，且与"按项目定位"的无状态模型根本冲突。如果确实需要读取非标准位置的 query data，应通过 `projectRoot` 指向包含 `.archguard` 的父目录来实现，而不是引入第二个路径参数。

---

## 核心决策

### 1. 取消 MCP session 级查询状态

MCP server 改为**无状态路由层**：

- server 启动时只保存 `defaultRoot`
- 每次 tool 调用单独解析 `projectRoot`
- 每次 query tool 调用都执行 `loadEngine(targetArchDir, scope?)`
- 不再缓存 `enginePromise`
- 不再维护 `activeScopeKey`

也就是说，MCP 的“当前项目”不再由 server 进程记忆，而由每次 tool 调用显式指定。

### 2. `projectRoot` 是唯一项目定位参数

所有 MCP tools 都接受可选的 `projectRoot`：

```typescript
const projectRootParam = z.string().optional().describe(
  'Root directory of the target project. Defaults to the MCP server startup cwd.',
);
```

辅助函数：

```typescript
function resolveRoot(projectRoot: string | undefined, defaultRoot: string): string {
  return projectRoot ? path.resolve(projectRoot) : defaultRoot;
}
```

规则：

- 缺省时使用 `defaultRoot`
- 显式传入时使用 `path.resolve(projectRoot)`
- `projectRoot` 决定：
  - config 发现根目录
  - 相对 `sources` 的解析根目录
  - `workDir = <projectRoot>/.archguard`
  - query artifacts 的读取位置

本提案明确废弃“session root vs project root vs archDir”三套外部可见定位概念。对 MCP 调用方来说，只有一个公开定位参数：`projectRoot`。

### 3. 查询 scope 改为 per-call 参数，而非会话状态

所有 query tools 都接受可选 `scope` 参数：

```typescript
const scopeParam = z.string().optional().describe(
  'Query scope key, label fragment, or the synthetic alias \"global\". Omit to use manifest.globalScopeKey resolution.',
);
```

语义直接复用现有 `loadEngine()` / `resolveScope()`（`engine-loader.ts:44`）：

- `scope === undefined`：
  - 单 scope 时直接使用它
  - 多 scope 时使用 `manifest.globalScopeKey`
  - 多 scope 且 `globalScopeKey` 缺失时**抛错**（当前实现会要求用户显式指定 scope）
- `scope === 'global'`：显式要求 global scope；若 `globalScopeKey` 缺失则抛错
- 其他字符串：先按 key 精确匹配，再按 label 大小写不敏感子串匹配

这里不再新增 MCP 专用 scope 解析规则。

### 4. `archguard_analyze` 也改为按 `projectRoot` 执行

`archguard_analyze` 的行为调整为：

- `sessionRoot = resolvedProjectRoot`
- `workDir = path.join(resolvedProjectRoot, '.archguard')`
- `sources` 始终相对于 `resolvedProjectRoot` 解析
- 分析完成后不需要刷新任何进程内 engine 状态，因为 query tools 下次会重新从磁盘加载

这消除了 analyze 成功后“当前 MCP 会话应切到哪个 scope”的状态同步问题。

### 5. 语言检测必须复用 CLI 现有归一化链路

本提案不接受“在 MCP 层复制一套轻量 `detectLanguage(projectRoot)`”。

原因：

- CLI 当前的自动检测不止一张 marker-file 表
- Go Atlas 的默认行为来自 `normalizeToDiagrams()` 的 `go + atlas` 逻辑
- 复制检测规则会让 CLI 与 MCP 在边界项目上逐步漂移

因此约束是：

- 若 `lang` 明确传入，沿用现有 MCP/CLI 的语言值：`typescript | go | java | python | cpp`
- 若 `lang` 省略，必须复用 CLI 当前的“配置 + sources + 项目结构检测”路径
- 若后续需要抽取通用 `resolveAnalysisInputs()`，应由 CLI 和 MCP 共用，而不是 MCP 自行实现

---

## 设计细化

### 1. MCP server 构造函数

```typescript
// 之前
createMcpServer(archDir: string, scopeKey?: string, sessionRoot = process.cwd())

// 之后
createMcpServer(defaultRoot: string = process.cwd())
```

`startMcpServer` 同步调整：

```typescript
// 之前
async function startMcpServer(archDir: string, scopeKey?: string): Promise<void>

// 之后
async function startMcpServer(defaultRoot: string = process.cwd()): Promise<void>
```

对应的启动命令也应调整为：

```typescript
// 之前
archguard mcp [--arch-dir <dir>] [--scope <key>]

// 之后
archguard mcp
```

`--arch-dir` 和 `--scope` 作为启动期绑定参数应该移除；它们与”每次调用显式指定项目/范围”的设计方向冲突。

### 2. 查询 tools 的参数模型

所有查询 tools 在原有参数前增加：

```typescript
{
  projectRoot: projectRootParam,
  scope: scopeParam,
  // 原有参数保持不变
}
```

调用示例：

```typescript
archguard_summary({ projectRoot: "/repo/a" })
archguard_find_entity({ projectRoot: "/repo/b", scope: "frontend", name: "Server" })
archguard_get_dependencies({ name: "App" }) // 默认当前 MCP server 启动目录
```

### 3. 查询 tools 的加载流程

```typescript
async ({ projectRoot, scope, ...rest }) => {
  const root = resolveRoot(projectRoot, defaultRoot);
  const archDir = path.join(root, '.archguard');
  const engine = await loadEngine(archDir, scope);
  // 基于 engine 执行原有查询
}
```

注意：

- 这里不再使用闭包缓存的 `getEngine()`
- `loadEngine()` 已具备 scope 解析与 `arch-index.json` 校验/重建逻辑
- 查询期间读到旧数据是可接受的；因为 query artifact 写入本身使用原子 rename

### 4. `archguard_analyze` 参数模型

```typescript
{
  projectRoot: projectRootParam,
  sources: z.array(z.string()).optional(),
  lang: z.enum(['typescript', 'go', 'java', 'python', 'cpp']).optional(),
  diagrams: z.array(z.enum(['package', 'class', 'method'])).optional(),
  format: z.enum(['mermaid', 'json']).optional(),
  noCache: z.boolean().default(false),
}
```

这里继续沿用当前 MCP tool 的语言枚举，而不是暴露插件内部名字 `golang`。

注意 `noCache` 的转换语义：`cache: noCache ? false : undefined`。`false` 表示"显式禁用缓存"，`undefined` 表示"使用配置文件默认值"。这与 [proposal-mcp-analyze-tool.md](./proposal-mcp-analyze-tool.md) 伪代码中的 `cache: !input.noCache`（布尔值，无 undefined 分支）语义不同；本提案的写法是正确的，与当前 `analyze-tool.ts:68` 实现一致。

### 5. `archguard_analyze` 内部流程

```typescript
async ({ projectRoot, sources, lang, diagrams, format, noCache }) => {
  const root = resolveRoot(projectRoot, defaultRoot);
  const workDir = path.join(root, '.archguard');

  return await withPerProjectLock(root, async () => {
    const startedAt = Date.now();
    const normalizedSources = sources?.map(source => path.resolve(root, source));

    const result = await runAnalysis({
      sessionRoot: root,
      workDir,
      cliOptions: {
        sources: normalizedSources,
        lang,
        diagrams,
        format,
        cache: noCache ? false : undefined,
      },
      reporter: new StderrReporter(),
    });

    return formatAnalyzeResponse(result, {
      projectRoot: root,
      elapsedMs: Date.now() - startedAt,
    });
  });
}
```

关键约束：

- 不保留任何 `setActiveScope()` / `invalidateEngine()` 接口
- 不再根据 `persistedScopeKeys` 修改 server 内状态
- `runAnalysis()` 仍然是唯一写盘入口
- `formatAnalyzeResponse` 的签名从当前的 `{ elapsedMs, sessionRoot, currentScope, nextScope }` 简化为 `{ projectRoot, elapsedMs }`，移除 scope 状态相关字段

### 6. 并发控制改为 per-projectRoot

当前 analyze tool 是单个布尔锁：

```typescript
let analyzeInProgress = false;
```

目标行为应改为：

```typescript
const analyzeLocks = new Set<string>();

async function withPerProjectLock<T>(
  root: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(root);
  if (analyzeLocks.has(key)) {
    throw new Error(
      `An analysis is already running for ${key}. Wait for it to complete or analyze a different project.`,
    );
  }
  analyzeLocks.add(key);
  try {
    return await fn();
  } finally {
    analyzeLocks.delete(key);
  }
}
```

含义：

- 同一项目并发分析：拒绝，返回明确错误文本（包含项目路径）
- 不同项目并发分析：允许
- 查询与分析并发：允许
- 无超时机制；锁在 `finally` 中释放，即使分析抛错也不会泄漏

这是无状态 cross-project 设计的最低要求；否则 server 虽然能”指向多个项目”，却仍被全局单锁串行化。

---

## 关于 `archguard_summary` 的契约

上一版文档最危险的点，是把 `archguard_summary` 从 JSON 摘要偷偷改成了 prose 文本块。本提案明确禁止这样做。

约束如下：

1. `archguard_summary` 仍然返回可机读 JSON 文本。
2. 若要暴露 scope 发现信息，只能采用以下两种方式之一：
   - 向 JSON 结构**追加字段**
   - 新增专用 tool，例如 `archguard_list_scopes`
3. 不允许把现有 JSON 响应改写成面向人类的自由文本。

如果团队决定在本提案内同时解决 scope discovery，推荐方案是对 `archguard_summary` 做**加法扩展**，例如：

```json
{
  "entityCount": 335,
  "relationCount": 224,
  "language": "typescript",
  "kind": "parsed",
  "topDependedOn": [],
  "scope": {
    "key": "a1b2c3d4",
    "label": "src (typescript)"
  },
  "availableScopes": [
    { "key": "a1b2c3d4", "label": "src (typescript)", "kind": "parsed", "entityCount": 335 }
  ]
}
```

这仍然是契约变更，但它是**显式、可机读、可渐进兼容**的。

但要强调：**cross-project 无状态化本身并不依赖这个扩展**。如果该契约变更争议较大，应拆到后续提案，而不是阻塞本提案落地。

---

## 错误处理要求

### 1. 查询时无目标数据

错误信息必须带上目标项目路径，而不是只返回当前 CLI 风格文案。

期望形式：

```text
No query data found at /path/to/project/.archguard/query.
Run archguard_analyze({ projectRoot: "/path/to/project" }) first.
```

### 2. scope 解析失败

现有 `resolveScope()`（`engine-loader.ts:62,97`）的错误文案包含 `--scope`，这是 CLI 时代遗留。迁移后必须改成 MCP-neutral 文案：

```text
// 之前
'No global query scope configured. Run `archguard analyze` to regenerate a global view or use `--scope`.'
'...Use `--scope` or rerun `archguard analyze`.'

// 之后
'No global query scope configured. Run archguard_analyze to regenerate, or pass scope parameter explicitly.'
'...Pass scope parameter explicitly, or rerun archguard_analyze.'
```

不能继续向调用方暴露不存在的 CLI 参数。

### 3. 分析失败分类

- `runAnalysis()` 抛错：tool 失败，目标项目已有 query data 保持不变
- `queryScopesPersisted === 0`：视为失败，不把“图渲染部分成功”包装成成功
- `queryScopesPersisted > 0` 且部分图产物失败：视为成功但附带 warning

这部分沿用 [proposal-mcp-analyze-tool.md](./proposal-mcp-analyze-tool.md) 已经明确的区分，不再重复引入会话 scope 刷新判断。

---

## 迁移计划

### 阶段 1. 拆除会话状态

- `src/cli/mcp/mcp-server.ts`
  - 删除 `activeScopeKey`
  - 删除 `enginePromise`
  - 删除 `getEngine()` / `invalidateEngine()` / `setActiveScope()`
- `src/cli/mcp/analyze-tool.ts`
  - 删除 `AnalyzeToolContext` 中的 scope 管理接口
  - 引入 `defaultRoot` 与 per-project locks

### 阶段 2. 所有 tools 增加 `projectRoot`

- 8 个 query tools 增加 `projectRoot`
- 8 个 query tools 增加 `scope`
  - 注意：`archguard_detect_cycles` 和 `archguard_summary` 当前 schema 为空对象 `{}`，增加参数后需确保 zod schema 非空且 MCP SDK 正确序列化
- `archguard_analyze` 增加 `projectRoot`

### 阶段 3. CLI 启动参数收缩

- `src/cli/commands/mcp.ts`
  - 删除 `--arch-dir`
  - 删除 `--scope`
  - 仅以 `process.cwd()` 作为 `defaultRoot` 启动 server

### 阶段 4. 错误文案和返回契约清理

- 让 query errors 指向 `projectRoot`
- 移除 `--scope` 风格提示语，替换为 MCP-neutral 文案（见"错误处理要求"章节）
- 如确需 scope discovery，显式采用 JSON 加法扩展或新 tool；否则延后，不阻塞无状态化主线

### 阶段 5. 测试更新

- 更新 `tests/unit/cli/mcp/analyze-tool.test.ts`：移除 `AnalyzeToolContext` 中 scope 管理接口的断言，新增 `projectRoot` 和 per-project lock 断言
- 更新 `tests/unit/cli/mcp/mcp-server.test.ts`：验证 `createMcpServer(defaultRoot)` 新签名
- 新增跨项目查询测试：同一 server 实例交替查询两个不同 `projectRoot` 的 fixture
- 更新 `tests/integration/cli-mcp/analyze-equivalence.test.ts`：适配新的 `createMcpServer` 签名
- 验证 `resolveScope` 错误文案不再包含 `--scope`

---

## 验收标准

1. 同一 MCP server 进程内，可以无重启地交替查询两个项目。
2. `archguard_analyze({ projectRoot: "/other/project" })` 的配置发现、相对路径解析和写盘目标都指向该项目。
3. 所有 query tools 都支持可选 `projectRoot` 和 `scope`。
4. analyze 完成后，后续 query 不依赖任何 `invalidateEngine()` 或 `setActiveScope()`。
5. 同一项目的并发 analyze 被拒绝；不同项目的并发 analyze 被允许。
6. `archguard_summary` 仍保持 JSON 响应，不退化为 prose 文本。
7. CLI 与 MCP 继续只通过 `runAnalysis()` 共享分析写盘流程。
8. 移除 `archguard mcp` 的 `--arch-dir` 和 `--scope` 启动参数。

---

## 残余风险

1. **每次查询重载磁盘的性能回归**
   当前数据规模下问题不大，但应以真实 fixture 补一组基线测试，而不是凭估算拍板。

2. **CLI 现有“跨 sessionRoot 的 sources 会推导 workDir”语义**
   `runAnalysis()` / `analyze.ts` 目前对外部 sources 有一段特殊 workDir 推导逻辑。迁移后，MCP 路径必须明确压制这段漂移行为，保证 `workDir` 始终是 `<projectRoot>/.archguard`。

3. **`archguard_summary` 的扩展方式仍需最终定稿**
   如果团队不接受给 summary 做加法扩展，就应拆出 `archguard_list_scopes`，不要在实现阶段临时发明第三种方案。

---

## 结论

这个提案应推进的不是“给 MCP 多加几个参数”，而是**把 MCP 从会话状态机降级为按调用参数读取磁盘的路由层**。

只有这样，cross-project support、analyze 后立即可查询、server 重启无状态丢失，才会同时成立，而且不会继续放大会话状态复杂度。
