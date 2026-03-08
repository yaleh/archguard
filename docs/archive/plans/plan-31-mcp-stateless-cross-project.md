# Plan 31: Stateless MCP Server with Cross-Project Support

**Source proposal**: `docs/proposals/proposal-mcp-stateless-cross-project.md` (rev 4)
**Depends on**: Plan 30 (`archguard_analyze` MCP Tool)
**Related ADR**: `docs/adr/004-single-analysis-write-path-for-cli-and-mcp.md`
**Branch**: `feat/mcp-stateless`
**Status**: Draft

## Overview

本计划的目标是把 MCP server 从会话状态机降级为按调用参数读取磁盘的无状态路由层。完成后，同一 server 进程可以在不重启的情况下交替查询和分析多个项目。

核心约束有 3 条：

1. MCP server 不再维护 `activeScopeKey` / `enginePromise` 等进程内查询状态
2. 所有 tool 以 `projectRoot` 作为唯一项目定位参数，取代 `archDir + scopeKey + sessionRoot` 三元组
3. CLI 与 MCP 继续共享 `runAnalysis()` 作为唯一写盘入口（ADR-004）

四个 Phase：

| Phase | Scope | Dependency |
|-------|-------|------------|
| Phase 1 | 拆除 MCP 会话状态，query tools 改为 per-call 加载 | Plan 30 |
| Phase 2 | `archguard_analyze` 改为 per-projectRoot，引入 per-project 并发锁 | Phase 1 |
| Phase 3 | CLI 启动参数收缩，删除 `--arch-dir` / `--scope` | Phase 2 |
| Phase 4 | 错误文案清理与跨项目测试 | Phase 3 |

每个 Phase 完成后都必须至少通过：

```bash
npm run type-check
npm test
```

Breaking changes（必须在发布说明中列出）：

1. `archguard mcp` 启动参数删除 `--arch-dir` 与 `--scope`
2. `<projectRoot>/.archguard` 成为唯一 workDir 约定，不再支持 query data 目录与项目根目录分离

---

## Pre-flight

确认 Plan 30 已完成，当前实现的事实基线：

```bash
npm run type-check
npm test
npm run build

node dist/cli/index.js mcp --help
```

基线观察点：

- `src/cli/mcp/mcp-server.ts` 中 `createMcpServer(archDir, scopeKey, sessionRoot)` 保存 `activeScopeKey`、`enginePromise`、`getEngine()`、`invalidateEngine()`、`setActiveScope()`
- `src/cli/mcp/analyze-tool.ts` 中 `AnalyzeToolContext` 包含 `getActiveScope()`、`setActiveScope()`、`invalidateEngine()` 接口
- `src/cli/commands/mcp.ts` 注册 `--arch-dir` 和 `--scope` 启动参数
- `src/cli/query/engine-loader.ts` 中 `resolveScope()` 的错误文案包含 `--scope`（行 62, 97）
- 8 个 query tools 不接受 `projectRoot` 或 `scope` 参数
- `archguard_detect_cycles` 和 `archguard_summary` 的 zod schema 为空对象 `{}`

实施前确认项：

- `runAnalysis()` 已存在且为 CLI/MCP 共享核心（Plan 30 产物）
- MCP analyze tool 已接入 `runAnalysis()`
- stdout 治理已完成

---

## Phase 1 — 拆除会话状态，query tools 改为 per-call 加载

### Objectives

1. 从 `createMcpServer` 中删除 `activeScopeKey`、`enginePromise`、`getEngine()`、`invalidateEngine()`、`setActiveScope()`
2. `createMcpServer` 签名从 `(archDir, scopeKey?, sessionRoot?)` 改为 `(defaultRoot?)`
3. `startMcpServer` 签名从 `(archDir, scopeKey?)` 改为 `(defaultRoot?)`
4. 所有 8 个 query tools 增加可选 `projectRoot` 和 `scope` 参数
5. 每次 query tool 调用都独立执行 `loadEngine(archDir, scope)`，不再读取闭包缓存

### Shared definitions

在 `mcp-server.ts` 中引入所有 tool 共用的参数定义和辅助函数：

```typescript
const projectRootParam = z.string().optional().describe(
  'Root directory of the target project. Defaults to the MCP server startup cwd.',
);

const scopeParam = z.string().optional().describe(
  'Query scope key, label fragment, or the synthetic alias "global". Omit to use manifest.globalScopeKey resolution.',
);

function resolveRoot(projectRoot: string | undefined, defaultRoot: string): string {
  if (!projectRoot) return defaultRoot;
  return path.isAbsolute(projectRoot)
    ? projectRoot
    : path.resolve(defaultRoot, projectRoot);
}
```

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/mcp/mcp-server.ts` | Modify | 删除会话状态闭包；`createMcpServer(defaultRoot?)` 新签名；`registerTools` 改为接收 `defaultRoot` 而非 `getEngine`；所有 query tools 增加 `projectRoot` + `scope`，每次调用独立 `loadEngine` |
| `src/cli/mcp/mcp-server.ts` | Modify | `startMcpServer(defaultRoot?)` 新签名 |
| `tests/unit/cli/mcp/mcp-server.test.ts` | Modify | 适配新签名，删除 `activeScopeKey` / `enginePromise` 相关断言，新增 per-call `projectRoot` + `scope` 断言 |

### Implementation notes

query tool 的新调用流程（以 `archguard_find_entity` 为例）：

```typescript
server.tool(
  'archguard_find_entity',
  'Find architecture entities by exact name match',
  {
    projectRoot: projectRootParam,
    scope: scopeParam,
    name: z.string().describe('Entity name to search for'),
    verbose: verboseParam,
  },
  async ({ projectRoot, scope, name, verbose }) => {
    const root = resolveRoot(projectRoot, defaultRoot);
    const archDir = path.join(root, '.archguard');
    const engine = await loadEngine(archDir, scope);
    const payload = applyView(engine, engine.findEntity(name), verbose);
    return { content: [{ type: 'text' as const, text: serializeEntities(payload) }] };
  },
);
```

注意 `archguard_detect_cycles` 和 `archguard_summary` 当前 schema 为空 `{}`，增加参数后 zod schema 变为非空对象，需在集成测试中验证 MCP SDK 对非空 schema 的正确序列化。

#### 错误包装

每个 query tool 的 handler 需要 catch `loadEngine` 的错误并追加 `projectRoot` 上下文：

```typescript
async ({ projectRoot, scope, ...rest }) => {
  const root = resolveRoot(projectRoot, defaultRoot);
  const archDir = path.join(root, '.archguard');
  try {
    const engine = await loadEngine(archDir, scope);
    // ... 执行查询
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('No query data found')) {
      return textResponse(
        `No query data found at ${archDir}/query.\n` +
        `Run archguard_analyze({ projectRoot: "${root}" }) first.`
      );
    }
    return textResponse(`Query failed for ${root}: ${msg}`);
  }
}
```

建议抽取为共享 helper `withEngineErrorContext(root, archDir, fn)` 避免在 8 个 tool 中重复。

#### 性能考虑

每次 query 从磁盘加载 `arch.json` + `arch-index.json`，暂不引入缓存。需要在 Phase 4 的集成测试中验证：
- 10 个并发 query 同一项目不会产生 corrupted index
- 大型 ArchJSON（>5MB）的加载时间在可接受范围内（<100ms）

### Verify

```bash
npm run type-check
npm test -- cli/mcp
```

验收点：

- `createMcpServer` 不再接受 `archDir` / `scopeKey` / `sessionRoot`
- 所有 8 个 query tools 接受可选 `projectRoot` 和 `scope`
- 缺省 `projectRoot` 时使用 `defaultRoot`（即 `process.cwd()`）
- `scope` 缺省时走 `resolveScope` 现有自动选择逻辑
- 不存在 `activeScopeKey` / `enginePromise` / `getEngine()` / `invalidateEngine()` / `setActiveScope()`

---

## Phase 2 — `archguard_analyze` 改为 per-projectRoot

### Objectives

1. `archguard_analyze` 增加可选 `projectRoot` 参数
2. 分析目标的 `sessionRoot`、`workDir`、`sources` 解析全部基于 `resolvedProjectRoot`
3. 删除 `AnalyzeToolContext` 中的 scope 管理接口（`getActiveScope`、`setActiveScope`、`invalidateEngine`）
4. 并发锁从全局布尔值改为 per-projectRoot `Set<string>`

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/mcp/analyze-tool.ts` | Modify | 删除 `AnalyzeToolContext` 接口中的 scope 管理字段；增加 `projectRoot` 参数；引入 `withPerProjectLock`；`formatAnalyzeResponse` 签名简化为 `{ projectRoot, elapsedMs }` |
| `src/cli/mcp/mcp-server.ts` | Modify | `registerAnalyzeTool` 调用处适配新接口（只传 `defaultRoot`） |
| `tests/unit/cli/mcp/analyze-tool.test.ts` | Modify | 删除 scope 管理断言，新增 `projectRoot` 和 per-project lock 断言 |

### Implementation notes

#### 新的 `AnalyzeToolContext`

```typescript
export interface AnalyzeToolContext {
  defaultRoot: string;
}
```

从原先的 5 字段（`sessionRoot`, `archDir`, `getActiveScope`, `setActiveScope`, `invalidateEngine`）缩减为 1 字段。

#### per-projectRoot 并发锁

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

语义：

- 同一项目并发分析：拒绝，返回包含项目路径的错误文本
- 不同项目并发分析：允许
- 查询与分析并发：允许（query 读到旧数据是可接受的）
- 锁在 `finally` 中释放，分析抛错不会泄漏

限制：此锁仅在单一 MCP server 进程内有效；`path.resolve()` 不处理符号链接。详见 proposal "残余风险"。

#### analyze 内部流程

```typescript
async ({ projectRoot, sources, lang, diagrams, format, noCache }) => {
  const root = resolveRoot(projectRoot, ctx.defaultRoot);
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

- 分析完成后不刷新任何进程内状态（无 `invalidateEngine` / `setActiveScope`）
- query tools 下次调用会重新从磁盘加载，自然读到最新数据
- `workDir` 始终固定为 `<projectRoot>/.archguard`，不允许 config 或参数漂移
- `noCache` 转换语义：`cache: noCache ? false : undefined`（`false` = 显式禁用，`undefined` = 用配置默认值）

#### `formatAnalyzeResponse` 签名简化

从当前的 4 字段：
```typescript
meta: { elapsedMs: number; sessionRoot: string; currentScope?: string; nextScope?: string }
```

简化为 2 字段：
```typescript
meta: { projectRoot: string; elapsedMs: number }
```

去掉 `currentScope` / `nextScope` 的理由：无状态设计下不再有"当前 scope → 下一 scope"的状态转换。analyze 完成后 query tools 从磁盘自动加载最新 scope，调用方无需感知 scope 切换。响应文本中对应的 `Scope: xxx -> yyy` 行也应移除。

### Verify

```bash
npm run type-check
npm test -- cli/mcp
```

验收点：

- `archguard_analyze({ projectRoot: "/other/project" })` 的 `sessionRoot`、`workDir`、`sources` 解析都指向该项目
- 不存在 `getActiveScope` / `setActiveScope` / `invalidateEngine` 调用
- 同一项目并发 analyze 被拒绝，不同项目并发 analyze 被允许
- analyze 成功后无进程内 scope 状态变更

---

## Phase 3 — CLI 启动参数收缩

### Objectives

1. 删除 `archguard mcp` 的 `--arch-dir` 和 `--scope` 启动参数
2. `createMcpCommand` 只以 `process.cwd()` 作为 `defaultRoot`
3. 删除 `resolveArchDir` 在 MCP 路径中的使用（CLI query 路径仍可保留）

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/commands/mcp.ts` | Modify | 删除 `--arch-dir` / `--scope` option；`McpOptions` 接口清空；action 只传 `process.cwd()` 给 `startMcpServer` |
| `tests/unit/cli/commands/mcp.test.ts` | Modify/New | 验证命令不再接受 `--arch-dir` / `--scope` |

### Implementation notes

改动前后对比：

```typescript
// 之前
export function createMcpCommand(): Command {
  return new Command('mcp')
    .option('--arch-dir <dir>', 'ArchGuard work directory')
    .option('--scope <key>', 'Query scope key')
    .action(async (opts: McpOptions) => {
      const archDir = resolveArchDir(opts.archDir);
      const { startMcpServer } = await import('../mcp/mcp-server.js');
      await startMcpServer(archDir, opts.scope);
    });
}

// 之后
export function createMcpCommand(): Command {
  return new Command('mcp')
    .description('Start ArchGuard MCP server (stdio transport)')
    .action(async () => {
      const { startMcpServer } = await import('../mcp/mcp-server.js');
      await startMcpServer(process.cwd());
    });
}
```

这是 breaking change。用户如果之前依赖 `--arch-dir` 指向非项目内的 `.archguard` 目录，需要改为通过 `projectRoot` per-call 参数指定（见 proposal "破坏性变更"章节）。

注意：`resolveArchDir()` 函数仍然被 CLI query 命令使用（如 `archguard query --arch-dir /custom`），仅在 MCP 的 `mcp.ts` command handler 中删除引用，**不要全局删除该函数**。

### Verify

```bash
npm run type-check
npm test
node dist/cli/index.js mcp --help  # 确认不再显示 --arch-dir / --scope
```

验收点：

- `archguard mcp --help` 不再列出 `--arch-dir` 和 `--scope`
- `archguard mcp --arch-dir foo` 报错（未知选项）
- server 正常启动，`defaultRoot` 为 `process.cwd()`

---

## Phase 4 — 错误文案清理与跨项目测试

### Objectives

1. 清理 `resolveScope()` 中遗留的 `--scope` CLI 风格文案
2. query 错误信息包含目标项目路径
3. 新增跨项目查询集成测试
4. 更新已有测试适配新签名

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/query/engine-loader.ts` | Modify | `resolveScope` 行 62, 97 的 `--scope` 文案改为 MCP-neutral |
| `tests/unit/cli/query/engine-loader.test.ts` | Modify | 断言错误文案不再包含 `--scope` |
| `tests/integration/cli-mcp/analyze-equivalence.test.ts` | Modify | 适配 `createMcpServer(defaultRoot)` 新签名 |
| `tests/integration/cli-mcp/cross-project-query.test.ts` | New | 跨项目查询集成测试 |
| `tests/unit/cli/mcp/analyze-tool-concurrency.test.ts` | New | 并发场景测试（同项目拒绝、跨项目允许、lock 释放） |
| `tests/unit/cli/commands/mcp.test.ts` | Modify | 验证 `--arch-dir` / `--scope` 已被移除（反向断言） |

### Implementation notes

#### 错误文案替换

```text
// engine-loader.ts:62 之前
'No global query scope configured. Run `archguard analyze` to regenerate a global view or use `--scope`.'

// 之后
'No global query scope configured. Run archguard_analyze to regenerate, or pass scope parameter explicitly.'

// engine-loader.ts:97 之前
'No global query scope configured. Available scopes exist, but none is marked global. Use `--scope` or rerun `archguard analyze`.'

// 之后
'No global query scope configured. Available scopes exist, but none is marked global. Pass scope parameter explicitly, or rerun archguard_analyze.'
```

#### 查询无数据时的错误信息

当 `loadEngine` 在目标项目找不到 query data 时，错误信息应包含路径：

```text
No query data found at /path/to/project/.archguard/query.
Run archguard_analyze({ projectRoot: "/path/to/project" }) first.
```

实现方式参考 Phase 1 的错误包装 helper `withEngineErrorContext`。

#### 并发测试套件

新增 `tests/unit/cli/mcp/analyze-tool-concurrency.test.ts`：

1. 同一项目的并发 analyze → 第二个请求应被拒绝
2. 不同项目的并发 analyze → 应同时成功
3. query 在 analyze 进行中 → 应返回旧数据或 "no query data" 错误，但不被 analyze lock 阻塞
4. analyze 异常抛错后 → lock 正确释放，后续 analyze 可正常执行

#### 跨项目查询集成测试

准备两个 fixture 项目（各有独立的 `.archguard/query/*`），验证：

1. 同一 server 实例交替查询两个 `projectRoot`，各自返回正确数据
2. 对项目 A 的 analyze 不影响项目 B 的 query 结果
3. `projectRoot` 缺省时始终使用 `defaultRoot`

### Verify

```bash
npm run type-check
npm test
```

验收点：

- `resolveScope` 错误文案不再包含 `--scope`
- query 错误信息包含目标 `projectRoot` 路径
- 跨项目查询测试通过
- `analyze-equivalence.test.ts` 适配新签名后通过

---

## Rollout sequence

建议按以下顺序合并：

1. Phase 1: 拆除会话状态 + query tools per-call 加载（核心变更，影响面最大）
2. Phase 2: analyze per-projectRoot + per-project lock（在 Phase 1 基础上自然扩展）
3. Phase 3: CLI 参数收缩（小改动，breaking change 需要 changelog）
4. Phase 4: 错误文案 + 测试（收尾，可与 Phase 3 同一 PR）

Phase 1 和 Phase 2 可以合并为一个 PR，但建议分开 commit 以便 bisect。Phase 3 和 Phase 4 可以合并为一个 PR。

不要把 4 个 Phase 混成一次大改；Phase 1 的"拆除会话状态"是最高风险变更，必须独立验证。

注：本 plan 将 proposal 迁移计划中的 5 个阶段整合为 4 个 Phase。具体映射：
- proposal 阶段 1（拆除会话状态）+ 阶段 2（tools 增加参数）→ **Plan Phase 1**（两者在实现上紧密耦合，需同时修改 `registerTools` 签名和所有 tool schema）
- proposal 阶段 2 中 analyze 部分 → **Plan Phase 2**
- proposal 阶段 3 → **Plan Phase 3**
- proposal 阶段 4 + 阶段 5 → **Plan Phase 4**（错误文案和测试自然放在同一收尾阶段）

---

## Final acceptance

全部完成后，应同时满足：

1. 同一 MCP server 进程内，可以无重启地交替查询两个项目
2. `archguard_analyze({ projectRoot: "/other/project" })` 的配置发现、路径解析和写盘目标都指向该项目
3. 所有 query tools 都支持可选 `projectRoot` 和 `scope`
4. analyze 完成后，后续 query 不依赖任何 `invalidateEngine()` 或 `setActiveScope()`
5. 同一项目的并发 analyze 被拒绝；不同项目的并发 analyze 被允许
6. `archguard_summary` 仍保持 JSON 响应
7. CLI 与 MCP 继续只通过 `runAnalysis()` 共享分析写盘流程
8. `archguard mcp` 不再接受 `--arch-dir` 和 `--scope`
9. 错误文案不再包含 `--scope` 等 CLI 专用提示
10. 跨项目查询集成测试作为长期回归护栏保留
