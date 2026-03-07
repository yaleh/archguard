# Proposal: Stateless MCP Server with Cross-Project Support

**状态**: Draft (rev 2)
**日期**: 2026-03-07
**取代**: [proposal-mcp-analyze-tool.md](./proposal-mcp-analyze-tool.md) 中的 session/scope 管理部分

---

## 背景

当前 MCP server 持有三层状态：

```typescript
// mcp-server.ts
let activeScopeKey: string | undefined;
let enginePromise: Promise<QueryEngine> | null;
const sessionRoot = process.cwd();   // 启动时固定
const archDir = sessionRoot + '/.archguard';  // 启动时固定
```

这个设计带来两个问题：

1. **跨项目分析无法工作**：`sessionRoot` 锁定后，外部项目分析要么失败（路径问题），要么产出写到错误位置（当前项目的 `.archguard/`），且 config、go.mod 等项目元数据都从错误位置加载。

2. **状态管理复杂度高于收益**：engine 缓存、scope 切换、invalidation 规则占了 [proposal-mcp-analyze-tool.md](./proposal-mcp-analyze-tool.md) 接近一半的篇幅，而实际收益仅是避免每次查询时 ~15ms 的 JSON 反序列化。

---

## 核心思路

**取消 session 概念。MCP server 不在内存保留分析数据。每次 tool 调用通过 `projectRoot` 参数定位目标项目，从该项目的 `.archguard/query/` 加载数据。**

```
之前: MCP server = 有状态服务（session + engine cache + scope state）
之后: MCP server = 无状态路由层（每次调用从磁盘加载）
```

---

## 性能可行性

加载路径的实际耗时（典型 ArchJSON ~300KB，~400 实体）：

| 步骤 | 耗时 |
|------|------|
| 读 manifest.json (~1KB) | <1ms |
| 读 arch.json (~300KB) | ~2ms |
| 读 arch-index.json (~50KB) | ~1ms |
| JSON.parse + 构建 entityMap | ~5ms |
| **总计** | **<10ms** |

相比之下，MCP 协议的 JSON-RPC 往返本身就有 ~10-50ms 开销。内存缓存带来的收益可忽略。

---

## 设计

### 1. 所有 MCP tool 增加 `projectRoot` 参数

```typescript
const projectRootParam = z.string().optional()
  .describe('Root directory of the target project. Defaults to MCP server CWD.');
```

**每个 tool** 都接受这个参数：

```typescript
// 分析工具
archguard_analyze({ projectRoot: "/path/to/codex-swarm" })

// 查询工具 — 同一参数，查的是该项目的分析结果
archguard_summary({ projectRoot: "/path/to/codex-swarm" })
archguard_find_entity({ projectRoot: "/path/to/codex-swarm", name: "Server" })

// 省略 projectRoot → 默认当前目录
archguard_summary({})
```

### 2. `projectRoot` 决定一切上下文

给定 `projectRoot`，所有派生路径自动确定：

```
projectRoot (缺省 = process.cwd())
  ├── archguard.config.json    ← ConfigLoader 从这里读
  ├── go.mod / CMakeLists.txt  ← 语言自动检测
  ├── .archguard/              ← workDir
  │   ├── query/
  │   │   ├── manifest.json    ← scope 索引
  │   │   └── <hash>/
  │   │       ├── arch.json    ← 分析产物
  │   │       └── arch-index.json
  │   ├── output/              ← diagram 产物
  │   └── cache/               ← 解析缓存
  └── src/ | pkg/ | cmd/       ← 源码（sources 相对于此解析）
```

**不存在 "session root vs project root" 的区分** — 只有一个 `projectRoot`。

### 3. MCP server 变为无状态

```typescript
// 之前
export function createMcpServer(archDir, scopeKey, sessionRoot): McpServer {
  let activeScopeKey = scopeKey;
  let enginePromise: Promise<QueryEngine> | null = null;
  // ... 复杂的 scope 管理
}

// 之后
export function createMcpServer(defaultRoot?: string): McpServer {
  const resolvedDefault = defaultRoot ?? process.cwd();
  // 无状态 — 每次 tool 调用独立加载
}
```

**删除的状态**：
- `activeScopeKey` — 不再需要
- `enginePromise` — 不再缓存
- `sessionRoot` — 由每次调用的 `projectRoot` 替代
- `archDir` — 由 `projectRoot + '/.archguard'` 替代

### 4. 语言自动检测

`archguard_analyze` 增加自动检测逻辑，复用已有的 `DETECTION_RULES`：

```
projectRoot 有 go.mod       → lang = 'go', atlas 默认开启
projectRoot 有 CMakeLists   → lang = 'cpp'
projectRoot 有 tsconfig     → lang = 'typescript'
projectRoot 有 pom.xml      → lang = 'java'
projectRoot 有 pyproject    → lang = 'python'
lang 参数仍可手动覆盖
```

Go 项目自动走 atlas 模式，与 CLI 行为一致。

### 5. `archguard_analyze` tool 契约

```typescript
{
  projectRoot: z.string().optional()
    .describe('Root directory of the target project. Defaults to MCP server CWD.'),

  sources: z.array(z.string()).optional()
    .describe('Source paths relative to projectRoot. Omit to auto-detect.'),

  lang: z.enum(['typescript', 'go', 'java', 'python', 'cpp']).optional()
    .describe('Language plugin. Omit to auto-detect from project structure.'),

  diagrams: z.array(z.enum(['package', 'class', 'method'])).optional()
    .describe('Diagram levels to generate.'),

  format: z.enum(['mermaid', 'json']).optional()
    .describe('Output format. Omit to use project config default.'),

  noCache: z.boolean().default(false)
    .describe('Disable analysis caches for this run.'),
}
```

**内部流程**：

```typescript
async ({ projectRoot, sources, lang, diagrams, format, noCache }) => {
  const root = path.resolve(projectRoot ?? process.cwd());
  const archDir = path.join(root, '.archguard');

  // 语言自动检测（当 lang 未指定时）
  const detectedLang = lang ?? detectLanguage(root);

  // 并发保护（per-projectRoot）
  if (analyzeLocks.has(root)) {
    return text(`Analysis already running for ${root}.`);
  }
  analyzeLocks.add(root);

  try {
    // 用目标项目的 config
    const result = await runAnalysis({
      sessionRoot: root,           // ← 目标项目，不是 MCP server CWD
      workDir: archDir,
      cliOptions: {
        sources: sources?.map(s => path.resolve(root, s)),
        lang: detectedLang,
        diagrams,
        format,
        cache: noCache ? false : undefined,
      },
      reporter: new StderrReporter(),
    });

    // 结果已写到 root/.archguard/query/ — 后续查询自动从那里读
    return formatResponse(result);
  } finally {
    analyzeLocks.delete(root);
  }
}
```

### 6. 查询工具增加 `scope` 参数

查询工具除了 `projectRoot` 之外，还接受可选的 `scope` 参数，用于选择项目内的特定分析 scope。

**背景**：一个项目可能包含多个独立分析的子模块（例如分别分析了 `src/frontend` 和 `src/backend`），每次分析会产生一个 scope（以 sources 的 hash 为 key）。缺省行为是选择 `globalScopeKey`（manifest 中实体数最多的 scope，通常是全项目分析的结果）。

```typescript
const scopeParam = z.string().optional()
  .describe('Query scope key or label. Defaults to the global scope (widest analysis). Use archguard_summary to list available scopes.');
```

**每个查询 tool** 都接受这两个定位参数：

```typescript
// 查全项目（缺省 scope）
archguard_find_entity({ projectRoot: "/path/to/project", name: "Server" })

// 查特定子模块的分析结果
archguard_find_entity({
  projectRoot: "/path/to/project",
  name: "Server",
  scope: "frontend"    // 按 label 模糊匹配，或按 key 精确匹配
})
```

**内部流程**：

```typescript
async ({ projectRoot, scope, name, verbose }) => {
  const root = path.resolve(projectRoot ?? process.cwd());
  const archDir = path.join(root, '.archguard');
  const engine = await loadEngine(archDir, scope);  // scope 传给 resolveScope()
  const results = engine.findEntity(name);
  return serialize(results, verbose);
}
```

`loadEngine(archDir, scope)` 已实现完整的 scope 解析逻辑：
- `scope` 为 `undefined` → 自动选 `globalScopeKey`
- `scope` 为具体字符串 → 按 key 精确匹配，或按 label 模糊匹配
- 找不到时返回描述性错误，列出可用 scope

**`archguard_summary` 的 scope 发现功能**：

`archguard_summary` 在返回架构概览的同时，也应列出该项目的所有可用 scope，方便 LLM 知道可以传什么值：

```text
Scope: src (typescript)  [key: a1b2c3, 335 entities, 224 relations]
Other scopes:
  - frontend (typescript)  [key: d4e5f6, 120 entities, 89 relations]
  - backend (typescript)   [key: 789abc, 215 entities, 135 relations]
```

### 7. 并发保护

**分析互斥改为 per-projectRoot**：

```typescript
// 之前：全局单锁
let analyzeInProgress = false;

// 之后：per-project 锁集合
const analyzeLocks = new Set<string>();
```

这意味着：
- 同时分析 projectA 和 projectB → **允许**
- 同一项目的两次并发分析 → **拒绝**（返回错误提示，不排队）

查询工具无需互斥——从磁盘读取是安全的，即使分析正在写入：
- `persistQueryScopes()` 使用原子写入（tmp + rename），读操作要么看到旧数据，要么看到完整的新数据
- 最坏情况是查询返回的是分析完成前的旧数据，这是可接受的

---

## 对现有 proposal 的影响

### 保留的部分（来自 proposal-mcp-analyze-tool.md）

- `runAnalysis()` 作为共享分析核心 — **保留**
- stdout/stderr 治理（MCP 路径不污染 stdout）— **保留**
- CLI/MCP 产物等价性约束 — **保留**
- 区分 analysis failure vs diagram failure — **保留**

### 删除的部分

- Scope 刷新规则（§ Scope 刷新规则）— **删除**，无 scope 状态
- `activeScopeKey` 管理 — **删除**
- `enginePromise` 缓存和 invalidation — **删除**
- `setActiveScope()` / `invalidateEngine()` 接口 — **删除**
- `AnalyzeToolContext` 接口 — **简化**（只保留 `defaultRoot`）
- "scope key 的确定" 规则 — **删除**
- "workDir 绑定规则" — **简化**（workDir = projectRoot/.archguard，永远如此）
- 全局分析互斥锁 — **替换为** per-projectRoot 锁

### 简化的部分

- MCP server 启动参数：去掉 `--scope`，去掉 `archDir` 参数
- `createMcpServer()` 签名：无参数（或只有 `defaultRoot`）
- 失败处理：不再需要 "是否刷新 engine" 的判断

---

## 模块变更

### 修改 `src/cli/mcp/mcp-server.ts`

```typescript
// 之前
export function createMcpServer(archDir, scopeKey, sessionRoot): McpServer
export async function startMcpServer(archDir, scopeKey): Promise<void>

// 之后
export function createMcpServer(defaultRoot?: string): McpServer
export async function startMcpServer(defaultRoot?: string): Promise<void>
```

- 删除 `enginePromise`、`activeScopeKey`、`getEngine`、`invalidateEngine`、`setActiveScope`
- 引入 `resolveRoot(projectRoot?: string): string` 辅助函数（解析 + 缺省处理）
- `registerTools()` 签名从 `(server, engineOrGetter)` 改为 `(server, resolveRoot)`
- 每个 tool 内部调用 `loadEngine(resolveArchDir(projectRoot), scope)` 而不是 `getEngine()`

### 修改 `src/cli/mcp/analyze-tool.ts`

```typescript
// 之前
export interface AnalyzeToolContext {
  sessionRoot: string;
  archDir: string;
  getActiveScope(): string | undefined;
  setActiveScope(scopeKey?: string): void;
  invalidateEngine(): void;
}

// 之后
export interface AnalyzeToolContext {
  defaultRoot: string;
  analyzeLocks: Set<string>;
}
```

- 删除 scope 管理逻辑
- 增加语言自动检测
- 并发保护改为 per-projectRoot
- `projectRoot` 参数决定 `runAnalysis` 的 sessionRoot 和 workDir

### 修改 `src/cli/commands/mcp.ts`

- 删除 `--scope` CLI 选项
- 简化启动流程

### 修改所有查询 tool 注册

每个 tool 增加 `projectRoot` + `scope` 参数，内部用 `loadEngine()` 替代 `getEngine()`：

```typescript
// 之前
server.tool('archguard_find_entity', ..., async ({ name, verbose }) => {
  const engine = await getEngine();  // 从闭包缓存
  ...
});

// 之后
server.tool('archguard_find_entity', ..., async ({ projectRoot, scope, name, verbose }) => {
  const archDir = resolveArchDir(projectRoot);
  const engine = await loadEngine(archDir, scope);  // 每次从磁盘加载
  ...
});
```

---

## 错误处理

### 查询时目标项目无分析数据

```typescript
// loadEngine 已有此逻辑，只需确保错误信息包含 projectRoot
try {
  const engine = await loadEngine(archDir, scope);
} catch (err) {
  // 增强错误信息：
  // "No analysis data found at /path/to/project/.archguard/.
  //  Run archguard_analyze({ projectRoot: '/path/to/project' }) first."
}
```

### 分析失败的细分

| 情况 | 行为 |
|------|------|
| `projectRoot` 目录不存在 | 返回错误，说明路径无效 |
| 解析完成但 0 实体（如 Go bug） | 返回错误 + 诊断信息（语言、文件数、可能原因） |
| query scope 写盘成功但部分 diagram 失败 | 返回成功 + warning，查询可用 |
| `runAnalysis()` 抛异常 | 返回错误，不影响目标项目已有的 query 数据 |

### scope 找不到

```text
Scope "frontend" not found in /path/to/project.
Available scopes:
  a1b2c3  src (typescript)     335 entities
  d4e5f6  pkg (go)             417 entities
```

---

## 向后兼容

- `projectRoot` 缺省为 `process.cwd()`，与当前行为一致
- 已生成的 `.archguard/query/` 产物格式不变，`loadEngine()` 无需修改
- CLI 行为完全不变（CLI 不经过 MCP server）
- `--scope` CLI 选项被删除；scope 选择改为查询工具的 `scope` 参数

---

## 验收标准

1. 所有 MCP tool 接受可选 `projectRoot` 参数
2. 所有查询 tool 接受可选 `scope` 参数
3. `archguard_analyze({ projectRoot: "/other/project" })` 使用目标项目的 config、语言检测、并写入目标项目的 `.archguard/`
4. `archguard_summary({ projectRoot: "/other/project" })` 返回目标项目的架构摘要及可用 scope 列表
5. 同一 MCP session 内可以交替查询不同项目，无需"切换"操作
6. 可以同时分析两个不同项目（per-projectRoot 互斥）
7. MCP server 重启后行为完全一致（无内存状态丢失问题）
8. Go 项目自动检测并启用 atlas 模式
9. `--scope` CLI 选项被移除
10. 测试通过：type-check、unit tests、跨项目分析 integration test

---

## 待讨论

1. **是否保留轻量级 LRU 缓存**：完全无缓存是最简设计。如果未来发现某些项目的 arch.json 很大（>5MB），可以加一个小 LRU（如 2-3 个 entry）。但这是优化，不是初始设计的一部分。

2. **`detectLanguage()` 的位置**：可以复用 `plugin-registry.ts` 的 `DETECTION_RULES`，或者在 MCP 层做一个轻量版（只检测文件是否存在，不加载插件）。
