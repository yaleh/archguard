# Plan 30: `archguard_analyze` MCP Tool — Development Plan

**Source proposal**: `docs/proposals/proposal-mcp-analyze-tool.md`
**Related ADR**: `docs/adr/004-single-analysis-write-path-for-cli-and-mcp.md`
**Branch**: `feat/mcp-analyze-tool`
**Status**: Draft

## Overview

本计划按“先收敛写盘核心，再接入 MCP”的顺序推进，目标不是简单加一个 tool，而是在不破坏 CLI 现有能力的前提下，建立一条 CLI / MCP 共用的分析写盘路径。

核心约束有 4 条：

1. CLI 与 MCP 必须共享同一条分析写盘路径
2. MCP 分析路径必须 stdout-safe
3. MCP session 内必须支持 engine / scope 刷新
4. 必须建立 CLI / MCP 磁盘产物等价测试，防止后续分叉

五个 Phase：

| Phase | Scope | Dependency |
|------|------|------------|
| Phase 1 | 抽出共享分析核心 `runAnalysis()` 并让 CLI 最小化接入 | None |
| Phase 2 | stdout / stderr 治理，清理 MCP 可达路径的 stdout 输出 | Phase 1 |
| Phase 3 | MCP server 引入可变 `activeScopeKey` 与 `archguard_analyze` tool | Phase 2 |
| Phase 4 | CLI 薄包装清理与语义收口 | Phase 3 |
| Phase 5 | CLI / MCP 等价测试与回归护栏 | Phase 4 |

每个 Phase 完成后都必须至少通过：

```bash
npm run type-check
npm test
```

---

## Pre-flight

先确认当前实现事实，避免沿用错误假设：

```bash
npm run type-check
npm test
npm run build

node dist/cli/index.js analyze --help
node dist/cli/index.js mcp --help
```

基线观察点：

- [src/cli/commands/analyze.ts](/home/yale/work/archguard/src/cli/commands/analyze.ts) 当前同时承担参数解析、执行分析、终端输出、退出码控制
- [src/cli/mcp/mcp-server.ts](/home/yale/work/archguard/src/cli/mcp/mcp-server.ts) 当前只注册 8 个 query tools，且 `scopeKey` 为启动时固定值
- [src/cli/processors/diagram-output-router.ts](/home/yale/work/archguard/src/cli/processors/diagram-output-router.ts) 当前仍有多处 `console.log()`
- [src/cli/query/engine-loader.ts](/home/yale/work/archguard/src/cli/query/engine-loader.ts) 当前按 `loadEngine(archDir, scopeKey)` 加载 engine
- 当前配置发现基于 `process.cwd()`，而不是 `path.dirname(archDir)`

实施前确认项：

- 当前 `.archguard/query/*` 产物由 CLI analyze 写出
- 当前 MCP 无法在会话内触发 analyze
- 当前 analyze 失败语义以 CLI 退出码为中心，而不是以 query data 可用性为中心

---

## Phase 1 — 抽出共享分析核心

### Objectives

1. 从 CLI handler 中抽出 `runAnalysis()` 共享入口
2. 让所有分析写盘副作用都收敛到共享核心
3. 共享核心返回结构化结果，供 CLI 和 MCP 各自组织输出
4. 禁止 MCP 后续直接拼装 `DiagramProcessor` + 持久化调用链
5. 明确共享核心的 `sessionRoot` 与 `workDir` 语义

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/analyze/run-analysis.ts` | New | 共享分析核心，负责完整分析与写盘流程 |
| `src/cli/commands/analyze.ts` | Modify | CLI 命令改为调用 `runAnalysis()`，不再内嵌完整流程 |
| `src/cli/progress.ts` | Modify | 如需要，抽象出更小的 reporter 接口以便共享核心依赖 |
| `tests/unit/cli/analyze/run-analysis.test.ts` | New | 共享核心单元测试 |

### Required design constraints

`runAnalysis()` 至少要覆盖今天 CLI 中已经存在的这些步骤：

1. `ConfigLoader.load()`
2. `normalizeToDiagrams()`
3. `cleanStaleDiagrams()`
4. `DiagramProcessor.processAll()`
5. `writeManifest()`
6. `persistQueryScopes()`
7. `DiagramIndexGenerator.generate()`

建议返回结构：

```typescript
export interface RunAnalysisResult {
  config: Config;
  diagrams: DiagramConfig[];
  results: DiagramResult[];
  queryScopesPersisted: number;
  persistedScopeKeys: string[];
  hasDiagramFailures: boolean;
}
```

重要约束：

- `runAnalysis()` 是 CLI 与 MCP **唯一允许**调用的分析写盘入口
- 以后新增任何分析产物写盘逻辑，只能加在 `runAnalysis()`
- 共享核心不得调用 `process.exit()`
- 共享核心不得输出面向人类终端的摘要文本
- `sessionRoot` 表示配置发现与相对路径解析基准，MCP 下必须等于 server 启动时的 `process.cwd()`
- `workDir` 表示分析产物写盘根目录，MCP 下必须固定到当前会话的 `archDir`

建议入口签名：

```typescript
export interface RunAnalysisOptions {
  sessionRoot: string;
  workDir: string;
  cliOptions: Partial<CLIOptions>;
  reporter: AnalysisReporter;
}
```

### Verify

```bash
npm run type-check
npm test -- run-analysis
```

验收点：

- CLI 仍可通过 `analyze` 完成完整分析
- `runAnalysis()` 可在不退出进程的情况下返回结果
- `queryScopesPersisted` 与 `persistedScopeKeys` 能准确反映写盘结果
- CLI 通过 `sessionRoot = process.cwd()` 调共享核心，不改变现有配置发现语义

---

## Phase 2 — stdout / stderr 治理

### Objectives

1. 清理 MCP 可达分析路径上的 stdout 污染
2. 将分析核心依赖的进度/日志接口与 CLI 终端表现解耦
3. 确保 `archguard_analyze` 接入前，底层已满足 stdio MCP 要求

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/progress.ts` | Modify | 如保留，限定仅 CLI 层使用 |
| `src/cli/processors/diagram-output-router.ts` | Modify | 所有 MCP 可达 `console.log()` 改为 stderr 或注入 logger |
| `src/cli/analyze/run-analysis.ts` | Modify | 接收 reporter/logger 抽象 |
| `tests/unit/cli/mcp/mcp-stdout-safety.test.ts` | New | stdout 安全测试 |

### Implementation notes

推荐最小抽象：

```typescript
export interface AnalysisReporter {
  start(message: string): void;
  succeed(message: string): void;
  fail(message: string): void;
  warn(message: string): void;
  info(message: string): void;
}
```

提供两类实现：

- `CliProgressReporter`：CLI 使用，可写 stdout
- `StderrReporter`：MCP 使用，只写 stderr

至少要处理的 stdout 风险点：

- CLI progress spinner / info 输出
- `DiagramOutputRouter` 中的 Atlas 相关 `console.log()`
- 未来任何从 `runAnalysis()` 可达的 `console.log()`

### Verify

```bash
npm run type-check
npm test -- mcp-stdout-safety
```

验收点：

- 分析核心在 MCP reporter 下无业务日志写入 stdout
- stderr 允许保留调试信息，但不影响协议

---

## Phase 3 — MCP Analyze Tool 接入

### Objectives

1. 为 MCP server 新增 `archguard_analyze`
2. 引入会话级 `activeScopeKey`
3. 分析成功后支持 engine / scope 刷新
4. 失败时保持原 query 状态不变
5. 明确 `sessionRoot` 与 `archDir` 的职责分离

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/mcp/analyze-tool.ts` | New | 注册 analyze tool，组织请求/响应与并发保护 |
| `src/cli/mcp/mcp-server.ts` | Modify | 引入 `activeScopeKey` 会话状态，注册 analyze tool |
| `tests/unit/cli/mcp/analyze-tool.test.ts` | New | analyze tool 单元测试 |
| `tests/unit/cli/mcp/mcp-server.test.ts` | Modify | 覆盖 active scope refresh 与 tool 注册 |

### Required design constraints

#### 1. `registerTools()` 保持单一职责

不要把 analyze tool 塞进现有 `registerTools()`。

保留：

- `registerTools(server, getEngine)` 只注册 8 个 query tools
- `registerAnalyzeTool(server, ctx)` 单独注册 analyze tool

#### 2. `activeScopeKey` 必须是可变会话状态

`startMcpServer()` 需要从：

```typescript
loadEngine(archDir, scopeKey)
```

改为：

```typescript
let activeScopeKey: string | undefined = initialScopeKey;
let enginePromise: Promise<QueryEngine> | null = null;
```

并提供：

- `sessionRoot = process.cwd()`
- `getActiveScope()`
- `setActiveScope(scopeKey?)`
- `invalidateEngine()`

不要在 MCP analyze tool 中把 `path.dirname(archDir)` 当作配置根或相对路径基准。那会偏离现有 CLI 语义。

#### 2.5 `workDir` 必须固定到会话 `archDir`

MCP analyze tool 调用共享核心时，必须满足：

```typescript
runAnalysis({
  sessionRoot,
  workDir: archDir,
  ...
})
```

硬约束：

- query data 必须写入 `archDir/query/*`
- config file 不得把 MCP analyze 的 `workDir` 改写到别处
- 否则 query engine 会继续读旧目录，造成“分析成功但查询不到”的假成功

#### 3. scope refresh 不能靠纯推导

analyze 成功后，scope 切换要基于 `runAnalysis()` 返回的 `persistedScopeKeys`，而不是只靠 `hashSources()` 猜。

允许行为：

- 无固定 scope：只做 `invalidateEngine()`
- 有固定 scope，且 `sources` 明确且 key 已成功落盘：切到新 scope
- 无法确定新 scope：不切换，并返回 warning

#### 4. 并发保护

tool 内必须有互斥锁：

```typescript
let analyzeInProgress = false;
```

第二次并发调用直接返回 busy 文本，不进入分析流程。

### Verify

```bash
npm run type-check
npm test -- cli/mcp
```

验收点：

- `archguard_analyze` 可被 MCP 客户端发现
- 成功分析后，后续 query tools 无需重启即可读到新数据
- 分析失败时，之前的 query 状态保持不变
- 固定 scope 会话只在“可安全映射新 scope”时切换
- 相对 `sources` 与 config 发现基于 `sessionRoot`
- query data 始终落在当前会话 `archDir`

---

## Phase 4 — CLI 薄包装清理与语义收口

### Objectives

1. 清理 Phase 1 之后 CLI 中残留的重复逻辑
2. 把 CLI 特有语义限制在展示层和退出码层
3. 明确“diagram failures”与“query data 可用性”的关系
4. 确认 CLI 不再保留第二条写盘实现路径

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/commands/analyze.ts` | Modify | 移除残留重复逻辑，只保留参数解析、摘要输出、退出码控制 |
| `tests/unit/cli/commands/analyze.test.ts` | Modify | 断言 CLI 复用共享核心，而不是复制流程 |

### Implementation notes

CLI 仍然可以保留自己的退出码语义，例如：

- 全部成功 -> `0`
- 存在 diagram failures -> `1`
- 核心流程失败 -> `1`

但这只属于 CLI 展示层，不应回流污染 `runAnalysis()` 的通用契约。

必须避免的反模式：

- 在 CLI handler 中重新调用 `persistQueryScopes()`
- 在 CLI handler 中新增只对 CLI 生效的写盘副作用
- 在 CLI handler 中重新构造一套和 `runAnalysis()` 不同步的结果汇总
- 在 CLI handler 中重新引入与 `sessionRoot/workDir` 语义冲突的目录推导

### Verify

```bash
npm run type-check
npm test -- cli/commands/analyze
```

验收点：

- CLI analyze 的磁盘产物完全来自共享核心
- CLI 仍保留现有用户体验所需的摘要与退出码
- Phase 1 引入的最小接入没有在后续修改中被重新分叉

---

## Phase 5 — 等价测试与长期护栏

### Objectives

1. 建立 CLI / MCP 磁盘产物等价测试
2. 为未来增量修改建立长期回归护栏
3. 把“单一写盘路径”从文档原则变成可执行约束

### Files changed

| File | Type | Description |
|------|------|-------------|
| `tests/integration/cli-mcp/analyze-equivalence.test.ts` | New | CLI 与 MCP 分析产物等价测试 |
| `docs/adr/004-single-analysis-write-path-for-cli-and-mcp.md` | Reference | 评审约束的长期依据 |

### Required design constraints

必须比较的关键产物：

- `.archguard/query/manifest.json`
- 每个 scope 下的 `arch.json`
- 每个 scope 下的 `arch-index.json`
- `.archguard/output/index.md`
- 关键图产物清单

比较时必须做归一化：

- `generatedAt`
- `timestamp`
- 运行耗时
- 绝对路径

建议实现方式：

1. 准备同一 fixture 项目
2. 分别执行 CLI analyze 与 MCP analyze
3. 收集两套 `.archguard/` 产物
4. 归一化不稳定字段
5. 断言结构与核心内容等价

### Verify

```bash
npm run type-check
npm test -- analyze-equivalence
```

验收点：

- CLI 与 MCP 在同一输入下生成等价的 query / output 产物
- 未来若某个改动只影响一侧写盘行为，测试会直接失败

---

## Rollout sequence

建议按以下顺序合并：

1. 先提交 `runAnalysis()` 抽取、`sessionRoot/workDir` 语义固定与 CLI 最小接入
2. 再提交 stdout-safe 改造
3. 再提交 MCP analyze tool
4. 再做 CLI 薄包装清理
5. 最后补上等价测试并设为长期回归护栏

不要把全部 Phase 混成一次大改；否则很难定位行为变化源头。

---

## Final acceptance

全部完成后，应同时满足：

1. `archguard_analyze` 可在 MCP session 内触发分析
2. query tools 可在同一 MCP session 内读取新分析结果
3. CLI 与 MCP 共享同一条分析写盘路径
4. MCP analyze 路径的 config 发现与相对路径解析基于 `sessionRoot = process.cwd()`
5. MCP analyze 路径的 query data 始终写入当前会话 `archDir`
6. MCP analyze 路径无业务日志写入 stdout
7. 存在长期保留的 CLI / MCP 产物等价测试
8. 后续新增分析产物只能接入共享核心，而不能分别接入 CLI / MCP
