# Proposal: `archguard_analyze` MCP Tool

**状态**: Draft (rev 3)
**日期**: 2026-03-07
**关联**: [proposal-agent-query-layer.md](./proposal-agent-query-layer.md), [proposal-diagram-processor-decomposition.md](./proposal-diagram-processor-decomposition.md)

---

## 背景

当前 MCP server（[src/cli/mcp/mcp-server.ts](/home/yale/work/archguard/src/cli/mcp/mcp-server.ts)）只暴露 8 个只读 query tools。它们依赖磁盘上的 `.archguard/query/*` 产物，而这些产物只能先通过 `archguard analyze` 生成。

这带来一个明显断点：

```text
archguard analyze   -> 写入 .archguard/query/*
archguard mcp       -> 启动 MCP server
LLM 调用 query tools
```

AI agent 无法在同一 MCP session 内完成“改代码 -> 重新分析 -> 继续查询验证”的闭环。

---

## 本轮审查结论

对照当前实现后，上一版提案存在 4 个严重问题，必须先修正：

1. **不能直接复用 CLI handler**
   [src/cli/commands/analyze.ts](/home/yale/work/archguard/src/cli/commands/analyze.ts) 的 `analyzeCommandHandler()` 会创建交互式进度输出、调用 `displayResults()`，并最终 `process.exit()`。这条路径不能在 MCP 进程内直接调用。

2. **stdout 污染面被低估**
   不仅 `ProgressReporter` 会写 stdout，[src/cli/processors/diagram-output-router.ts](/home/yale/work/archguard/src/cli/processors/diagram-output-router.ts) 也存在多处 `console.log()`；如果直接在 MCP 进程内跑分析，会破坏 stdio JSON-RPC。

3. **scope 刷新语义没有定义完整**
   query tools 当前通过 `loadEngine(archDir, scopeKey)` 加载固定 scope；若 MCP server 以 `--scope` 启动，而 analyze 产出了另一组 sources，对“分析后 query tools 立即读取新数据”的保证并不天然成立。

4. **分析成功与渲染成功被混为一谈**
   query layer 依赖的是 `.archguard/query/*`，不是 PNG/SVG 或 `index.md`。若 query scopes 已写盘而部分图渲染失败，query data 仍可能是可用的新数据。提案必须把这两类结果分开定义。

本提案以下设计以消除这 4 个问题为前提。

---

## 目标

1. 新增 `archguard_analyze` MCP tool，使 AI agent 能在同一 MCP session 内触发分析。
2. 分析完成后，query tools 能读取本次分析生成的最新 query data，而不要求重启 MCP server。
3. 不改变现有 8 个 query tools 的输入输出契约。
4. 复用现有分析核心：`normalizeToDiagrams()`、`DiagramProcessor`、`persistQueryScopes()`、`DiagramIndexGenerator`。
5. 分析失败时，MCP server 继续可用，且已有 query tools 不因本次失败而损坏。

---

## 非目标

- 不做 streaming / progress events
- 不新增 `archguard_analyze_status`
- 不引入 HTTP transport，仍使用 stdio
- 不把全部 CLI flags 暴露为 MCP tool 参数
- 不解决“跨多个 workspace 的通用分析编排”

---

## 设计原则

### 1. 不调用 CLI command handler

MCP 侧必须调用“可复用分析服务”，而不是 CLI 命令入口。

原因：

- CLI handler 带有 `process.exit()`
- CLI handler 默认面向人类终端，会写 stdout
- CLI handler 把“执行分析”“打印结果”“设置退出码”耦合在一起

因此需要把 [src/cli/commands/analyze.ts](/home/yale/work/archguard/src/cli/commands/analyze.ts) 中的核心逻辑抽出为共享函数，例如：

```typescript
export interface RunAnalysisOptions {
  sessionRoot: string;
  workDir: string;
  cliOptions: Partial<CLIOptions>;
  reporter: AnalysisReporter;
}

export interface RunAnalysisResult {
  config: Config;
  diagrams: DiagramConfig[];
  results: DiagramResult[];
  queryScopesPersisted: number;
  persistedScopeKeys: string[];
  hasDiagramFailures: boolean;
}

export async function runAnalysis(options: RunAnalysisOptions): Promise<RunAnalysisResult>
```

CLI 命令继续复用该函数，但只在 CLI 层负责：

- 终端进度展示
- 人类可读摘要输出
- `process.exit(code)`

MCP tool 也复用该函数，但只负责：

- tool 参数解析
- MCP-safe 输出格式化
- engine/scope 刷新

### 1.5 `sessionRoot` 与 `workDir` 必须分离

这是当前文档里最容易被实现错的一点。

在现有 CLI 中：

- 配置发现基于 `process.cwd()`
- 相对 `sources` 的解析语义也隐含依赖当前进程工作目录
- query data 写入位置则由 `workDir` 控制

MCP 路径不能把这三件事混成一个“workspaceRoot”。

必须明确：

- `sessionRoot`: MCP server 启动时的 `process.cwd()`；用于配置发现和相对路径解析
- `workDir`: MCP server 当前会话绑定的 `archDir`；用于 query data 与默认 output/cache 路径

因此 MCP analyze tool 必须：

1. 以 `sessionRoot` 创建 `ConfigLoader`
2. 以 `sessionRoot` 解析相对 `sources`
3. 强制把 `workDir` 固定为当前 MCP 会话的 `archDir`

如果不这样做，会出现严重分叉：

- 配置从 A 目录加载
- 相对 `sources` 从 B 目录解析
- query data 却写到 C 目录

这会让 MCP 的磁盘产物与 CLI 语义失配，也会让 query tools 刷新不到刚写出的数据。

### 2. 明确区分三类结果

分析完成后必须区分：

- **analysis failed**：核心流程异常，未产出可信 query data
- **analysis completed with diagram failures**：query data 已更新，但部分图渲染/索引失败
- **analysis completed cleanly**：query data 与图产物都成功

是否刷新 query engine，依据应是“query data 是否已成功持久化且当前 active scope 可解析”，而不是“所有 PNG/SVG 是否都成功”。

### 3. MCP 路径必须是 stdout-safe

MCP 分析路径上的所有非协议输出都必须满足：

- 要么不输出
- 要么只写 stderr

仅仅换掉 `ProgressReporter` 不够，所有可达调用链都要满足这个约束。

### 4. active scope 必须可刷新

`startMcpServer()` 里当前是固定捕获 `scopeKey`。这不足以支撑 analyze 之后的 scope 刷新。

需要改为可变引用：

```typescript
let activeScopeKey: string | undefined = initialScopeKey;

const getEngine = () => loadEngine(archDir, activeScopeKey);
const setActiveScope = (scopeKey?: string) => {
  activeScopeKey = scopeKey;
  enginePromise = null;
};
```

这样 analyze tool 才能在成功后按规则更新当前会话的 active scope。

---

## Tool 契约

### 参数

MCP tool 参数应与现有 CLI 语义保持一致，但只暴露高频项：

```typescript
{
  sources: z.array(z.string()).optional()
    .describe('Source directories. Relative paths are resolved from the MCP session root (server startup cwd).'),

  lang: z.string().optional()
    .describe('Language plugin name. Omit to auto-detect.'),

  diagrams: z.array(z.enum(['package', 'class', 'method'])).optional()
    .describe('Filter generated diagrams by level.'),

  format: z.enum(['mermaid', 'json']).optional()
    .describe('Output format override. Omit to use config/default.'),

  noCache: z.boolean().default(false)
    .describe('Disable parse cache for this run.'),
}
```

说明：

- `sources` 保持数组，而不是降级为单字符串；这与现有 `CLIOptions.sources?: string[]` 一致。
- `lang` 不写死为固定 enum，因为当前代码已经把语言选择当作可扩展插件能力。
- `format` 设为 optional，而不是默认 `'mermaid'`。否则会无意覆盖配置文件中的格式。

### 返回内容

返回 `text` content，分三种情况：

1. **成功且无严重告警**
2. **成功但带 warnings**
3. **失败**

示例：

```text
Analysis completed in 12.4s

Session root: /project
Work dir:     /project/.archguard
Output:       /project/.archguard/output
Query:        3 scopes written
Scope:        auto-select on next query

Diagrams:
  - overview/package     ok   65 entities  142 relations  5.5s
  - class/all-classes    ok  325 entities  221 relations  5.5s
  - method/cli           ok   80 entities   63 relations  5.7s

Next step: call archguard_summary or another query tool.
```

带 warning 的示例：

```text
Analysis completed with warnings in 18.1s

Warnings:
  - 2 diagrams failed to render, but query data was refreshed.
  - Active scope changed from "abcd1234" to "ef567890" for this MCP session.
```

失败示例：

```text
Analysis failed: No query scopes were persisted.
Previous query state is unchanged.
```

不在响应中承诺当前实现还拿不到的数据，例如 `render cache hits/misses`。

---

## Scope 刷新规则

这是本提案最关键的契约。

### MCP server 状态

`startMcpServer(archDir, initialScopeKey)` 维护以下状态：

```typescript
const sessionRoot = process.cwd();
let enginePromise: Promise<QueryEngine> | null = null;
let activeScopeKey: string | undefined = initialScopeKey;
```

query tools 始终读取 `activeScopeKey`。

### analyze 成功后的刷新策略

1. 如果 MCP server 启动时**没有**显式 `--scope`
   `activeScopeKey` 保持 `undefined`，只做 `enginePromise = null`。
   下一次 query 时继续走现有自动选 scope 逻辑。

2. 如果 MCP server 启动时**有**显式 `--scope`，且本次 analyze 的 `sources` 可唯一映射到一个新 scope
   将 `activeScopeKey` 更新为该 scope key，再清空 `enginePromise`。

3. 如果 MCP server 启动时**有**显式 `--scope`，但本次 analyze 无法确定新的 active scope
   不刷新 `activeScopeKey`，并在响应中明确 warning。
   这样比“盲目切到未知 scope”更安全。

### scope key 的确定

MCP analyze tool 不应只靠“推导” scope key 做切换，而应优先使用 `runAnalysis()` 返回的 `persistedScopeKeys`。

规则：

- 当 `sources` 明确，且 `persistedScopeKeys` 中恰好包含对应 source set 的 key 时，允许切换
- 当 `sources` 未传，或 `persistedScopeKeys` 无法唯一映射时，不切换固定 scope

`hashSources()` 仍可作为比对辅助，但不是最终真相；真正可信的是“已经成功写盘的 scope keys”。

### `workDir` 绑定规则

MCP analyze tool 必须强制把分析写盘目录固定到当前会话的 `archDir`。

也就是说：

- `runAnalysis({ workDir: ctx.archDir, ... })`
- query scopes 必须写到 `ctx.archDir/query/*`
- 默认 output/cache 路径也应从这个 `workDir` 推导

不能让 config file 或 tool 参数把 `workDir` 改写到别处。否则 analyze 成功后，MCP query engine 仍然会从旧 `archDir` 读取数据，形成“分析成功但查询不到”的假成功。

`outputDir` 是否允许显式自定义是次级问题；`workDir` 不允许漂移则是硬约束。

---

## 共享分析服务的职责

`runAnalysis()` 至少要覆盖今天 CLI 中已经存在的这些步骤：

1. `ConfigLoader.load()`
2. `normalizeToDiagrams()`
3. `cleanStaleDiagrams()`
4. `DiagramProcessor.processAll()`
5. `writeManifest()`（diagram manifest，非 query manifest）
6. `persistQueryScopes()`
7. `DiagramIndexGenerator.generate()`（当 results.length > 1）

这意味着 MCP 侧不是“直接拼一个 DiagramProcessor 调用”就够了；否则会悄悄绕过现有 CLI 语义。

---

## 一致性保障

未来要保证 CLI 与 MCP tool 的**磁盘文件输出始终一致**，必须把这条原则写成架构约束，而不是靠约定自觉遵守。

### 核心原则

**只允许存在一条分析写盘路径。**

也就是说：

- CLI 不能维护一套自己的写盘流程
- MCP tool 不能维护另一套自己的写盘流程
- 所有会产生磁盘副作用的分析步骤，都必须收敛到 `runAnalysis()`

### 共享核心必须独占的职责

以下写盘相关步骤只能出现在共享核心中：

1. `ConfigLoader.load()`
2. `normalizeToDiagrams()`
3. `cleanStaleDiagrams()`
4. `DiagramProcessor.processAll()`
5. `writeManifest()`
6. `persistQueryScopes()`
7. `DiagramIndexGenerator.generate()`
8. 未来新增的任何分析产物写盘逻辑

CLI 与 MCP 只是两层薄包装：

- CLI 负责参数解析、终端输出、退出码
- MCP 负责参数解析、MCP 响应、engine/scope 刷新

它们都**不得**直接 new `DiagramProcessor` 后自行拼装写盘流程，也**不得**绕过 `runAnalysis()` 直接调用 `persistQueryScopes()`、`writeManifest()` 或未来新增的持久化函数。

### 增量修改的约束

以后凡是修改分析流程，必须遵守：

1. 新的磁盘产物只能接入 `runAnalysis()`
2. 不能只在 CLI 分支补一个写盘步骤
3. 不能只在 MCP 分支补一个写盘步骤
4. 如果需要差异化行为，只允许出现在“输出展示层”，不能出现在“写盘层”

### 测试约束

为防止未来分叉，测试必须分层：

1. **共享核心产物测试**
   直接测试 `runAnalysis()`，校验 `.archguard/output/*`、`.archguard/query/*`、manifest、index 等关键产物。

2. **CLI vs MCP 等价测试**
   在同一 fixture 上，分别通过 CLI 和 MCP 触发分析，对最终磁盘产物做等价比较。

3. **归一化比较**
   比较时需忽略不稳定字段，例如时间戳、绝对路径、运行时间等；关注目录结构、scope key、核心 JSON 内容和 index 结构。

### 代码审查约束

后续 PR 评审时，凡涉及分析写盘逻辑，必须显式检查：

- 修改是否只进入共享核心
- 是否新增或更新了共享核心测试
- 是否影响 CLI/MCP 产物等价性

如果某个改动只改 CLI 写盘逻辑或只改 MCP 写盘逻辑，应视为违反本提案的架构约束。

---

## stdout / stderr 治理

### 结论

必须把 MCP 可达路径上的 stdout 输出全部移除或改到 stderr。

### 已知需要处理的点

- [src/cli/progress.ts](/home/yale/work/archguard/src/cli/progress.ts)
- [src/cli/processors/diagram-output-router.ts](/home/yale/work/archguard/src/cli/processors/diagram-output-router.ts)
- [src/cli/commands/analyze.ts](/home/yale/work/archguard/src/cli/commands/analyze.ts) 中的人类摘要输出

### 推荐做法

引入一个更小的 reporter/logger 抽象，而不是继续在分析核心中依赖 CLI 的 `ProgressReporter`：

```typescript
export interface AnalysisReporter {
  start(message: string): void;
  succeed(message: string): void;
  fail(message: string): void;
  warn(message: string): void;
  info(message: string): void;
}
```

提供两套实现：

- `CliProgressReporter`：现有 CLI 使用，可写 stdout
- `StderrReporter`：MCP 使用，只写 stderr

分析核心只依赖该接口。

如果短期内不重构 `DiagramOutputRouter` 的日志接口，则至少需要把其中所有 `console.log()` 改为 `console.error()`，并补充测试防止回归。

---

## 模块改动

### 新增 [src/cli/analyze/run-analysis.ts](/home/yale/work/archguard/src/cli/analyze/run-analysis.ts)

承载共享分析核心，不带 CLI 退出逻辑。

### 新增 [src/cli/mcp/analyze-tool.ts](/home/yale/work/archguard/src/cli/mcp/analyze-tool.ts)

职责：

- 注册 `archguard_analyze`
- 做并发保护
- 调用 `runAnalysis()`
- 依据 query scope 持久化结果刷新 `activeScopeKey` / `enginePromise`
- 组织 MCP 响应文本

建议接口：

```typescript
export interface AnalyzeToolContext {
  sessionRoot: string;
  archDir: string;
  getActiveScope(): string | undefined;
  setActiveScope(scopeKey?: string): void;
  invalidateEngine(): void;
}

export function registerAnalyzeTool(server: McpServer, ctx: AnalyzeToolContext): void
```

### 修改 [src/cli/mcp/mcp-server.ts](/home/yale/work/archguard/src/cli/mcp/mcp-server.ts)

改动：

1. `scopeKey` 从不可变入参，改为 `activeScopeKey` 会话状态
2. `getEngine()` 使用 `activeScopeKey`
3. 保持 `registerTools(server, getEngine)` 不变
4. 捕获 `sessionRoot = process.cwd()`
5. 单独调用 `registerAnalyzeTool(server, ctx)`

不建议给 `registerTools()` 再塞第三个参数。现有函数职责很清晰：只注册 8 个 query tools。

---

## 并发与失败处理

### 并发

保留 tool 级互斥锁：

```typescript
let analyzeInProgress = false;
```

理由：

- 当前 MCP 客户端多数场景串行，但不应把正确性建立在客户端行为上
- `persistQueryScopes()` 和图产物写盘都不适合并发覆盖

### 失败语义

1. `runAnalysis()` 抛错
   不刷新 engine，不改 active scope。

2. `runAnalysis()` 返回，但 `queryScopesPersisted === 0`
   视为 tool 失败；不刷新 engine。

3. `queryScopesPersisted > 0`，但存在 diagram failures
   视为成功但带 warning；刷新 engine。

4. `queryScopesPersisted > 0`，但无法安全刷新 active scope
   仅在无固定 scope 的场景下做 `invalidateEngine()`；
   若当前会话绑定了固定 scope 且无法映射新 scope，则返回 warning，保持当前 active scope 不变。

---

## 伪代码

```typescript
server.tool('archguard_analyze', description, schema, async (input) => {
  if (analyzeInProgress) {
    return text('An analysis is already running in this MCP session.');
  }

  analyzeInProgress = true;
  const startedAt = Date.now();

  try {
    const normalizedSources = input.sources?.map(s => path.resolve(ctx.sessionRoot, s));

    const result = await runAnalysis({
      sessionRoot: ctx.sessionRoot,
      workDir: ctx.archDir,
      cliOptions: {
        sources: normalizedSources,
        lang: input.lang,
        diagrams: input.diagrams,
        format: input.format,
        cache: !input.noCache,
      },
      reporter: new StderrReporter(),
    });

    if (result.queryScopesPersisted === 0) {
      return text('Analysis failed: No query scopes were persisted.\nPrevious query state is unchanged.');
    }

    const currentScope = ctx.getActiveScope();
    if (!currentScope) {
      ctx.invalidateEngine();
    } else if (normalizedSources && normalizedSources.length > 0) {
      const nextScope = hashSources(normalizedSources);
      if (result.persistedScopeKeys.includes(nextScope)) {
        ctx.setActiveScope(nextScope);
      }
    }

    return text(formatAnalyzeResponse(result, {
      elapsedMs: Date.now() - startedAt,
      previousScope: currentScope,
      currentScope: ctx.getActiveScope(),
    }));
  } catch (error) {
    return text(`Analysis failed: ${toMessage(error)}\nPrevious query state is unchanged.`);
  } finally {
    analyzeInProgress = false;
  }
});
```

---

## 测试策略

### 单元测试

新增 [tests/unit/cli/mcp/analyze-tool.test.ts](/home/yale/work/archguard/tests/unit/cli/mcp/analyze-tool.test.ts)

重点覆盖：

- 注册了 `archguard_analyze`
- analyze 成功且 `queryScopesPersisted > 0` 时调用 `invalidateEngine()`
- 有固定 scope 且 `sources` 明确时会更新 `activeScopeKey`
- analyze path 的配置发现与相对路径解析基于 `sessionRoot = process.cwd()`
- analyze path 的 query data 始终写到当前 `archDir`
- 有固定 scope 但无 `sources` 时不会盲目切 scope
- `runAnalysis()` 抛错时返回失败文本，不抛出未处理异常
- `queryScopesPersisted === 0` 时不刷新 engine
- diagram failures 只生成 warning，不阻止 query data 刷新
- 并发保护生效

### 回归测试

补充 [tests/unit/cli/mcp/mcp-server.test.ts](/home/yale/work/archguard/tests/unit/cli/mcp/mcp-server.test.ts)

- 仍只保留原有 8 个 query tools 的行为断言
- 新增对 analyze tool 注册的断言
- 新增 `activeScopeKey` 刷新后的 query reload 断言

### stdout 安全测试

新增一类面向 MCP 的输出测试：

- stub `process.stdout.write`
- 调用 analyze tool
- 断言分析期间没有业务日志写入 stdout

这是本提案的硬性验收项之一。

### CLI / MCP 产物等价测试

新增一组 integration tests：

- 同一 fixture 项目分别执行 CLI analyze 与 MCP analyze
- 比较 `.archguard/query/manifest.json`
- 比较每个 scope 下的 `arch.json` 与 `arch-index.json`
- 比较 `output/index.md` 与关键图产物清单
- 对时间戳、耗时、绝对路径做归一化后再断言

这组测试不是可选项，而是防止未来实现分叉的长期护栏。

---

## 验收标准

1. `archguard mcp` 启动后，MCP 客户端可发现 `archguard_analyze`
2. 同一 MCP session 内调用 `archguard_analyze` 后，无需重启即可继续调用 query tools
3. 若 query data 成功写盘，即使部分图渲染失败，query tools 仍能读取新数据
4. 若分析失败或未写出任何 query scope，之前的 query 状态保持不变
5. MCP analyze 路径无业务日志写入 stdout
6. `registerTools()` 仍只负责原有 8 个 query tools
7. 共享核心 `runAnalysis()` 成为 CLI 与 MCP 唯一的分析写盘入口
8. 存在 CLI / MCP 磁盘产物等价测试，并作为回归测试长期保留
9. 相关测试通过：type-check、unit tests、MCP regression tests、equivalence tests

---

## 实现顺序

1. 抽出 `runAnalysis()` 共享核心
2. 清理/隔离 stdout 输出
3. 给 MCP server 引入 `activeScopeKey` 可变状态
4. 实现 `registerAnalyzeTool()`
5. 补测试，特别是 stdout-safe 和 scope refresh

---

## 开放问题

1. `DiagramOutputRouter` 是否继续直接使用 `console.*`
   短期可改 `console.log -> console.error`；长期更合理的是注入 logger。

2. `sources` 未传且当前会话绑定固定 scope 时，analyze 完成后是否允许自动改 scope
   本提案选择“不自动改”，因为缺少确定性映射。

3. `runAnalysis()` 是否顺手返回 persisted scope keys
   本提案要求返回。否则 analyze tool 无法可靠判断 scope refresh 是否安全。
