# Plan 101-107 — Go Atlas Flow Layer: MCP Protocol & Custom Entry Point Detection

> Proposal: `docs/proposals/proposal-atlas-flow-layer-mcp-protocol.md`
> Status: **DRAFT**
> 前置依赖: 无（基于当前 master 分支，Atlas Flow 层已实现）
> 涉及文件: `src/plugins/golang/atlas/builders/flow-graph-builder.ts`、`src/plugins/golang/atlas/framework-detector.ts`、`src/plugins/golang/atlas/types.ts`、`src/types/config-cli.ts`、`src/cli/commands/analyze.ts`、`src/cli/analyze/normalize-to-diagrams.ts`、`src/plugins/golang/atlas/renderers/atlas-renderer.ts`

---

## 总览

| Phase | 内容 | 依赖 | 预计改动量 |
|---|---|---|---|
| 101 | **前置修复**：`matchCallPattern` 尊重 `handlerArgIndex`（当前硬编码 `args[1]`）| 无 | ~20 行 |
| 102 | 添加 `mcp-go` 和 `mcp-gosdk` 框架模式表条目 | Phase 101 | ~40 行 |
| 103 | 通用工具注册启发式扫描（次级 fallback，仅当主检测结果为空时触发）| Phase 102 | ~60 行 |
| 104 | `entryPointPattern` 字段 + `--atlas-entry-pattern` CLI flag 完整接线 | Phase 101 | ~40 行 |
| 105 | 空 Flow 层诊断消息（`AtlasRenderer` / `diagram-processor.ts`）| Phase 102-104 | ~30 行 |
| 106 | 单元测试：Phase 101-104 全覆盖 | Phase 101-105 | ~250 行 |
| 107 | 集成测试：Go MCP server fixture（`mark3labs/mcp-go`）| Phase 106 | ~80 行 |

**总改动量估算**：约 520 行新增/修改。各 Phase ≤500 行，各 Stage ≤200 行。

**测试策略（TDD）**：
- Phase 101-105 实现后，Phase 106 补全单元测试（对于纯逻辑修改，测试可与实现并行）
- Phase 107 集成测试需要 Go 环境和完整 fixture 文件
- 覆盖率目标：修改涉及的文件覆盖率 ≥80%

**各 Phase 依赖关系**：
- Phase 101 是 Phase 102 的硬前置（`handlerArgIndex` 修复后 `mcp-gosdk` 模式才能正确工作）
- Phase 102/103/104 可在 Phase 101 完成后并行开发
- Phase 105 依赖 Phase 102（需要已有 MCP 框架 key 才能完整列出搜索范围）
- Phase 106 依赖 Phase 101-105 全部完成
- Phase 107 依赖 Phase 106

---

## Phase 101 — 前置修复：`handlerArgIndex` 支持

**目标**：`matchCallPattern()` 当前硬编码 `call.args?.[1]` 作为 handler 参数。`CustomCallPattern.handlerArgIndex` 字段已存在于 `types.ts` 但从未被使用。本 Phase 修复此遗漏，使后续 `mcp-gosdk`（`handlerArgIndex: 2`）模式能正确提取 handler。

**依赖**：无前置 Phase。

**修改文件**：

| 文件 | 变更 |
|------|------|
| `src/plugins/golang/atlas/builders/flow-graph-builder.ts` | 修改 `matchCallPattern` 方法，读取 `activePattern.pattern.handlerArgIndex` |

---

### Stage 101.1 — 修复 `matchCallPattern` 中的 `handlerArgIndex` 硬编码（~20 行）

**问题**：`matchCallPattern()` 第 313 行：

```typescript
const rawHandler = call.args?.[1] ?? '';
```

对于 `handlerArgIndex: 2` 的模式（go-sdk）永远提取错误的参数。

**修改**（`src/plugins/golang/atlas/builders/flow-graph-builder.ts`）：

将 `matchCallPattern` 签名所接收的 `activePatterns` 条目的 `pattern` 类型从内部 `CallPattern` 扩展为同时接受 `handlerArgIndex?: number`。由于 `CallPattern`（内部 interface）目前没有此字段，需要添加：

```typescript
// 在 CallPattern interface 中新增（第 8-14 行附近）：
interface CallPattern {
  method?: string;
  methodSuffix?: string;
  receiverContains?: string;
  protocol: string;
  httpMethod?: HttpMethod;
  handlerArgIndex?: number; // 新增：指定 handler 在 call.args 中的下标，默认 1
}
```

然后修改 `matchCallPattern` 中的提取逻辑：

```typescript
// 修改前（行 313）：
const rawHandler = call.args?.[1] ?? '';

// 修改后：
const handlerArgIdx = pattern.handlerArgIndex ?? 1;
const rawHandler = call.args?.[handlerArgIdx] ?? '';
```

同时，`path` 的提取当前硬编码 `call.args?.[0]`，这对 `mcp-gosdk`（handler at args[2]，tool at args[1]，server at args[0]）来说 path 语义不同——path 字段在 MCP 中对应 tool name（args[1] 的 `Name` 字段，但在 tree-sitter AST 中是字符串参数）。对于本 Phase，保持 `path = call.args?.[0] ?? ''` 不变（MCP 中 path 字段的值不影响正确性）。

**验收标准**：
- `npm run type-check` 零错误
- `tests/plugins/golang/atlas/flow-graph-builder.test.ts` 全绿（零回归）
- `matchCallPattern` 对 `handlerArgIndex: 0` / `1` / `2` 提取正确参数（Stage 106 补测试）

---

## Phase 102 — MCP 框架模式表条目

**目标**：为 `mark3labs/mcp-go`（`mcp-go`）和 `modelcontextprotocol/go-sdk`（`mcp-gosdk`）添加框架检测条目，使它们出现在 `GO_MOD_FRAMEWORK_MAP` 和 `FRAMEWORK_PATTERNS` 中。

**依赖**：Phase 101（`handlerArgIndex` 必须已修复，否则 `mcp-gosdk` 提取的是 args[2] 错位）。

**修改文件**：

| 文件 | 变更 |
|------|------|
| `src/plugins/golang/atlas/framework-detector.ts` | 在 `GO_MOD_FRAMEWORK_MAP` 中新增 2 条映射 |
| `src/plugins/golang/atlas/builders/flow-graph-builder.ts` | 在 `FRAMEWORK_PATTERNS` 中新增 `mcp-go` 和 `mcp-gosdk` 条目 |

---

### Stage 102.1 — `GO_MOD_FRAMEWORK_MAP` 新增 MCP SDK 条目（~10 行）

**修改**（`src/plugins/golang/atlas/framework-detector.ts`，`GO_MOD_FRAMEWORK_MAP` 末尾追加）：

```typescript
['github.com/mark3labs/mcp-go', 'mcp-go'],
['github.com/modelcontextprotocol/go-sdk', 'mcp-gosdk'],
```

**说明**：`IMPORT_PATH_FRAMEWORK_MAP` 无需修改，因为这两个 SDK 的 go.mod 路径与 import 路径相同。`detectFromImports`（Layer 2）也会扫描 `GO_MOD_FRAMEWORK_MAP`，因此 Layer 2 检测自动生效。

**验收**：`FrameworkDetector.detect()` 对含 `github.com/mark3labs/mcp-go` require 的 `ModuleInfo` 返回包含 `'mcp-go'` 的集合（Stage 106 补测试）。

---

### Stage 102.2 — `FRAMEWORK_PATTERNS` 新增 MCP 条目（~20 行）

**修改**（`src/plugins/golang/atlas/builders/flow-graph-builder.ts`，`FRAMEWORK_PATTERNS` 末尾追加）：

```typescript
'mcp-go': [
  { method: 'AddTool',      protocol: 'mcp', handlerArgIndex: 1 },
  { method: 'RegisterTool', protocol: 'mcp', handlerArgIndex: 1 },
],
'mcp-gosdk': [
  {
    method: 'AddTool',
    receiverContains: '',  // package-level function：无 receiver，不做 receiver 过滤
    protocol: 'mcp',
    handlerArgIndex: 2,
  },
],
```

**实现说明**：
- `mcp-go`：`server.AddTool(tool, handlerFunc)` — handler 在 args[1]，receiver 是 `*MCPServer`（无需 `receiverContains` 约束）
- `mcp-gosdk`：`mcp.AddTool(server, &mcp.Tool{...}, handlerFunc)` — package-level 泛型函数，handler 在 args[2]；`receiverContains: ''` 表示跳过 receiver 检查（`matchesPattern` 中的判断逻辑：`if (p.receiverContains && call.receiverType)` — 空字符串为 falsy，不触发 receiver 过滤）

**Open Question 处理**（来自 Proposal §Open Questions #1）：
tree-sitter 对 package-level 调用的 `receiverType` 可能为 `''` 或不存在。`receiverContains: ''` 的 falsy 语义已经正确跳过此检查，无需特殊处理。实现时需验证 `matchesPattern` 的 `receiverContains` 分支逻辑（当前行 68-71）：
```typescript
if (p.receiverContains && call.receiverType) {
  if (!call.receiverType.includes(p.receiverContains)) return false;
}
```
空字符串 `''` 为 falsy，分支不进入，正确。

**验收**：
- `FlowGraphBuilder.build()` 对含 `AddTool` call 的 synthetic GoRawData 且 `detectedFrameworks` 包含 `'mcp-go'` 时，返回 `protocol: 'mcp'` 的 entry point（Stage 106 补测试）
- `npm run type-check` 零错误

---

## Phase 103 — 通用工具注册启发式扫描（次级 fallback）

**目标**：当主检测（所有框架模式匹配）结果为空（`entryPoints.length === 0`）时，进行次级 fallback 扫描，基于函数名后缀/精确匹配识别常见注册调用，`protocol: 'custom'`，并发出 info 级别提示。

**依赖**：Phase 102（确保主检测逻辑完整，fallback 只在主检测无结果时触发）。

**修改文件**：

| 文件 | 变更 |
|------|------|
| `src/plugins/golang/atlas/builders/flow-graph-builder.ts` | 在 `detectEntryPoints()` 末尾添加 fallback 扫描逻辑 |

---

### Stage 103.1 — 次级 fallback 扫描实现（~60 行）

**Proposal §2 Open Question 处理**（关于 `Handle` 过于宽泛）：
采用 Proposal 建议的保守策略：
- `endsWith('HandleFunc')` — 保留（HTTP fallback，精度高）
- `endsWith('Handle')` — **不包括**（过于宽泛，误报率高）
- `endsWith('AddTool')` — 保留
- `endsWith('RegisterTool')` — 保留
- `endsWith('AddCommand')` — 保留（cobra fallback）

**修改**（`src/plugins/golang/atlas/builders/flow-graph-builder.ts`）：

在 `detectEntryPoints()` 中，manual entry points 注入之后，添加：

```typescript
// Secondary fallback: only fires when primary detection found no entry points
if (entryPoints.length === 0) {
  const fallbackEntries = this.detectGenericToolRegistrations(rawData);
  entryPoints.push(...fallbackEntries);
  // Note: no _genericHeuristicFired flag — Phase 105 detects heuristic use via
  // framework: 'generic-heuristic' marker on entry points (see Phase 105 design).
}
```

新增私有方法 `detectGenericToolRegistrations`：

```typescript
private detectGenericToolRegistrations(rawData: GoRawData): EntryPoint[] {
  const GENERIC_SUFFIXES = ['AddTool', 'RegisterTool', 'AddCommand', 'HandleFunc'];
  const found: EntryPoint[] = [];
  const scan = (pkg: GoRawPackage, calls: GoCallExpr[]) => {
    for (const call of calls) {
      const name = call.functionName;
      if (GENERIC_SUFFIXES.some((s) => name === s || name.endsWith(s))) {
        const rawHandler = call.args?.[1] ?? '';
        const handler = rawHandler.startsWith('func(') ? '' : rawHandler;
        found.push({
          id: `entry-generic-${pkg.fullName}-${call.location.startLine}`,
          protocol: 'custom',
          framework: 'generic-heuristic',
          path: call.args?.[0] ?? '',
          handler,
          middleware: [],
          package: pkg.fullName,
          location: { file: call.location.file, line: call.location.startLine },
        });
      }
    }
  };
  for (const pkg of rawData.packages) {
    for (const func of pkg.functions) {
      if (func.body) scan(pkg, func.body.calls);
    }
    for (const struct of pkg.structs || []) {
      for (const method of struct.methods || []) {
        if (method.body) scan(pkg, method.body.calls);
      }
    }
  }
  return found;
}
```

**验收标准**：
- 当 `detectedFrameworks` 中无任何 key 有对应 `FRAMEWORK_PATTERNS` 条目时，`AddTool` / `RegisterTool` 调用被识别为 `protocol: 'custom'` entry points
- 当主检测已找到 entry points 时，fallback **不触发**（Stage 106 验证）
- `npm run type-check` 零错误

---

## Phase 104 — `entryPointPattern` 字段 + CLI flag 接线

**目标**：添加 `AtlasConfig.entryPointPattern?: string` 字段，并将其作为 `--atlas-entry-pattern` CLI flag 完整接线到 `FlowBuildOptions`。

**依赖**：Phase 101（`matchCallPattern` 已支持灵活参数提取）。Phase 102/103 无依赖（可并行）。

**修改文件**：

| 文件 | 变更 |
|------|------|
| `src/plugins/golang/atlas/types.ts` | `AtlasConfig` 新增 `entryPointPattern?: string`；`FlowBuildOptions` 新增 `entryPointPattern?: string` |
| `src/types/config-cli.ts` | `CLIOptions` 新增 `atlasEntryPattern?: string` |
| `src/cli/commands/analyze.ts` | `createAnalyzeCommand()` 注册 `--atlas-entry-pattern` flag |
| `src/cli/analyze/normalize-to-diagrams.ts` | 将 `cliOptions.atlasEntryPattern` 映射到 `AtlasConfig.entryPointPattern` |
| `src/plugins/golang/atlas/builders/flow-graph-builder.ts` | `detectEntryPoints()` 消费 `options.entryPointPattern`，匹配则创建 `protocol: 'custom'` entry point |

---

### Stage 104.1 — 类型定义与 CLI flag 注册（~25 行）

**修改**（`src/plugins/golang/atlas/types.ts`）：

在 `AtlasConfig` interface 末尾追加：
```typescript
entryPointPattern?: string; // regex matched against call.functionName; protocol: 'custom'
```

在 `FlowBuildOptions` interface 末尾追加：
```typescript
entryPointPattern?: string;
```

**修改**（`src/types/config-cli.ts`）：

在 `CLIOptions` interface 末尾追加：
```typescript
atlasEntryPattern?: string;
```

**修改**（`src/cli/commands/analyze.ts`，`--atlas-protocols` option 之后）：

```typescript
.option(
  '--atlas-entry-pattern <pattern>',
  'Regex matched against call.functionName for custom entry point detection (protocol: custom)'
)
```

**验收**：`npm run type-check` 零错误。

---

### Stage 104.2 — normalize 接线 + FlowGraphBuilder 消费（~20 行）

**修改**（`src/cli/analyze/normalize-to-diagrams.ts`）：

在已有 `protocols: cliOptions.atlasProtocols?.split(',').map(...)` 行之后（两处，行 102 和行 161），追加：
```typescript
entryPointPattern: cliOptions.atlasEntryPattern,
```

**修改**（`src/plugins/golang/atlas/builders/flow-graph-builder.ts`，`detectEntryPoints()` 中 manual entry points 注入之前）：

```typescript
// entryPointPattern: regex scan across all calls
const { entryPointPattern } = options;
if (entryPointPattern) {
  let regex: RegExp;
  try {
    regex = new RegExp(entryPointPattern);
  } catch {
    // Invalid regex — silently skip (user will see no results; CLI docs cover this)
    regex = /(?!)/; // never-match
  }
  for (const pkg of rawData.packages) {
    const scanCalls = (calls: GoCallExpr[]) => {
      for (const call of calls) {
        if (regex.test(call.functionName)) {
          const rawHandler = call.args?.[1] ?? '';
          const handler = rawHandler.startsWith('func(') ? '' : rawHandler;
          entryPoints.push({
            id: `entry-pattern-${pkg.fullName}-${call.location.startLine}`,
            protocol: 'custom',
            framework: 'entry-pattern',
            path: call.args?.[0] ?? '',
            handler,
            middleware: [],
            package: pkg.fullName,
            location: { file: call.location.file, line: call.location.startLine },
          });
        }
      }
    };
    for (const func of pkg.functions) { if (func.body) scanCalls(func.body.calls); }
    for (const struct of pkg.structs || []) {
      for (const m of struct.methods || []) { if (m.body) scanCalls(m.body.calls); }
    }
  }
}
```

**Open Question 处理**（来自 Proposal §Open Questions #3 — 是否匹配 receiver）：
本实现仅匹配 `call.functionName`，与 Proposal §3 设计一致。如需 receiver 匹配，用户可在 `customFrameworks` 中使用 `receiverContains`。

**验收标准**：
- `--atlas-entry-pattern 'MyRegister'` 在命令行传入后，仅匹配 `functionName === 'MyRegister'` 的调用
- 无效正则不会 crash（回退到 never-match）
- `npm run type-check` 零错误
- 回归：现有 `normalize-to-diagrams.ts` 测试全绿

---

## Phase 105 — 空 Flow 层诊断消息

**目标**：当 Atlas Flow 层构建完成后 `entryPoints.length === 0`，向用户输出结构化诊断消息，列出已搜索的框架并提供 `--atlas-entry-pattern` 提示。当 Phase 103 的泛型启发式生效时，输出 info 级别提示。

**依赖**：Phase 102（需要 `mcp-go`/`mcp-gosdk` 已在搜索范围内）；Phase 104（诊断中引用 `--atlas-entry-pattern` flag）。

**修改文件**：

| 文件 | 变更 |
|------|------|
| `src/plugins/golang/atlas/renderers/atlas-renderer.ts` | 在 `render()` 方法的 `'flow'` case 中，当 `entryPoints.length === 0` 时打印诊断 |

---

### Stage 105.1 — 空 Flow 诊断实现（~30 行）

**选型**：诊断输出放在 `AtlasRenderer` 而非 `FlowGraphBuilder`（后者无输出通道）。`AtlasRenderer.render()` 已有 `case 'flow'` 分支（行 48-50），在此处可访问完整的 `FlowGraph`。

**修改**（`src/plugins/golang/atlas/renderers/atlas-renderer.ts`，`case 'flow':` 分支，`renderFlowGraph` 调用之前）：

```typescript
case 'flow': {
  if (!atlas.layers.flow) throw new Error('Flow layer not available');
  const flow = atlas.layers.flow;

  // Emit diagnostic when flow layer is empty
  if (flow.entryPoints.length === 0) {
    const searched = [
      'net/http', 'gin', 'gorilla/mux', 'echo', 'chi', 'cobra',
      'grpc', 'kafka-go', 'sarama', 'nats', 'cron',
      'mcp-go', 'mcp-gosdk',
    ].join(', ');
    process.stderr.write(
      `ℹ  Flow layer: no entry points detected.\n` +
      `   Frameworks searched: ${searched}\n` +
      `   Tip: use --atlas-entry-pattern '<regex>' to specify custom entry points.\n` +
      `   Tip: use --atlas-protocols to limit to a specific protocol (http, grpc, cli, mcp, message).\n`
    );
  }

  content = MermaidTemplates.renderFlowGraph(flow);
  break;
}
```

**泛型启发式诊断**：
`FlowGraphBuilder` 不暴露内部状态给 renderer，因此不引入 `_genericHeuristicFired` 状态字段。
Phase 103 通过将 `framework: 'generic-heuristic'` 写入 entry points 来传递信息——renderer 检测到此标记时输出提示：

```typescript
const hasGenericHeuristic = flow.entryPoints.some(e => e.framework === 'generic-heuristic');
if (hasGenericHeuristic) {
  process.stderr.write(
    `ℹ  Flow: entry points found via generic heuristic (not from a detected framework).\n` +
    `   Verify with --atlas-entry-pattern or --atlas-protocols if results are noisy.\n`
  );
}
```

此方法避免了在 `FlowGraphBuilder` 中引入状态字段（更简洁）。

**验收标准**：
- 空 Flow 层时 stderr 输出包含 `mcp-go` 和 `mcp-gosdk`
- 有 entry points 时无额外输出
- `npm run type-check` 零错误

---

## Phase 106 — 单元测试

**目标**：为 Phase 101-105 的所有新行为补全单元测试，覆盖率 ≥80%。

**依赖**：Phase 101-105 全部完成。

**修改文件**：

| 文件 | 变更 |
|------|------|
| `tests/plugins/golang/atlas/flow-graph-builder.test.ts` | 扩展现有文件，新增测试分组 |
| `tests/plugins/golang/atlas/framework-detector.test.ts` | 扩展现有文件，新增 MCP SDK 检测分组 |

---

### Stage 106.1 — `handlerArgIndex` 单元测试（~40 行）

**新增测试分组**（`flow-graph-builder.test.ts`，现有 1802 行文件末尾追加）：

```
describe('matchCallPattern — handlerArgIndex', () => {
  it('handlerArgIndex: 0 → extracts args[0] as handler')
  it('handlerArgIndex: 1 (default) → extracts args[1] as handler')
  it('handlerArgIndex: 2 → extracts args[2] as handler (mcp-gosdk pattern)')
  it('undefined handlerArgIndex → defaults to args[1]')
})
```

每个 test case 创建 synthetic `GoRawData` 含 `AddTool` call，通过 `FlowGraphBuilder.build()` 验证返回的 `entry.handler` 值。

---

### Stage 106.2 — MCP 框架检测单元测试（~60 行）

**新增测试分组**（`framework-detector.test.ts`，现有文件末尾追加）：

```
describe('FrameworkDetector — MCP SDKs', () => {
  it('detects mcp-go from go.mod requires')
  it('detects mcp-go from import paths')
  it('detects mcp-gosdk from go.mod requires')
  it('detects mcp-gosdk from import paths')
})
```

**新增测试分组**（`flow-graph-builder.test.ts`）：

```
describe('FlowGraphBuilder — MCP protocol', () => {
  it('detects AddTool call as mcp entry point when mcp-go detected')
  it('detects RegisterTool call as mcp entry point when mcp-go detected')
  it('detects AddTool call at args[2] as mcp entry point when mcp-gosdk detected')
  it('does not create entry points for AddTool when no mcp framework detected (primary)')
})
```

---

### Stage 106.3 — 泛型启发式 + `entryPointPattern` 单元测试（~80 行）

**新增测试分组**（`flow-graph-builder.test.ts`）：

```
describe('FlowGraphBuilder — generic heuristic fallback', () => {
  it('activates when primary detection finds no entry points')
  it('detects AddTool suffix as custom entry point')
  it('detects RegisterTool suffix as custom entry point')
  it('detects AddCommand suffix as custom entry point')
  it('detects HandleFunc suffix as custom entry point')
  it('does NOT activate when primary detection found entry points')
  it('marks generic entries with framework: generic-heuristic')
})

describe('FlowGraphBuilder — entryPointPattern', () => {
  it('matches exact functionName against provided regex')
  it('does not match non-matching calls')
  it('creates protocol: custom entry points')
  it('handles invalid regex without crash')
  it('pattern scan is independent of primary detection results')
})
```

---

### Stage 106.4 — `normalize-to-diagrams` 接线回归（~30 行）

**新增测试**（`tests/unit/cli/analyze/normalize-to-diagrams.test.ts`，已有文件扩展）：

```
it('maps atlasEntryPattern to AtlasConfig.entryPointPattern')
it('entryPointPattern is undefined when atlasEntryPattern not set')
```

**验收标准**：
- `npm test -- --reporter=verbose tests/plugins/golang/atlas/flow-graph-builder.test.ts` 全绿
- `npm test -- --reporter=verbose tests/plugins/golang/atlas/framework-detector.test.ts` 全绿
- `npm test` 全套回归全绿
- 总测试数 ≥ 当前数量 + Phase 106 新增测试数（~20+ tests）

---

## Phase 107 — 集成测试：Go MCP Server Fixture

**目标**：创建最小化 Go MCP server fixture（使用 `mark3labs/mcp-go`），并通过 Go plugin（Atlas 模式）解析验证 Flow 层输出。

**依赖**：Phase 106 全绿。需要 Go 环境（`go` command 可用）。

**新建文件**：

| 文件 | 变更 |
|------|------|
| `tests/fixtures/go-mcp-server/go.mod` | 新建（requires `github.com/mark3labs/mcp-go`）|
| `tests/fixtures/go-mcp-server/main.go` | 新建（2-3 个 `s.AddTool(tool, handler)` 调用）|
| `tests/fixtures/go-mcp-server/handlers.go` | 新建（handler 函数定义）|
| `tests/integration/plugins/golang/atlas/go-mcp-server.integration.test.ts` | 新建 |

---

### Stage 107.1 — Fixture 文件（~40 行）

**`tests/fixtures/go-mcp-server/go.mod`**：
```
module github.com/test/go-mcp-server

go 1.21

require github.com/mark3labs/mcp-go v0.8.0
```

**`tests/fixtures/go-mcp-server/main.go`**：
```go
package main

import (
  "context"
  "github.com/mark3labs/mcp-go/mcp"
  "github.com/mark3labs/mcp-go/server"
)

func main() {
  s := server.NewMCPServer("test-server", "1.0.0")
  s.AddTool(mcp.NewTool("list_files", mcp.WithDescription("List files")), listFilesHandler)
  s.AddTool(mcp.NewTool("read_file",  mcp.WithDescription("Read file")),  readFileHandler)
  server.ServeStdio(s)
}
```

**`tests/fixtures/go-mcp-server/handlers.go`**：
```go
package main

import (
  "context"
  "github.com/mark3labs/mcp-go/mcp"
)

func listFilesHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
  return mcp.NewToolResultText("[]"), nil
}

func readFileHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
  return mcp.NewToolResultText(""), nil
}
```

---

### Stage 107.2 — 集成测试（~40 行）

**新建**（`tests/integration/plugins/golang/atlas/go-mcp-server.integration.test.ts`）：

```typescript
import { describe, it, expect } from 'vitest';
import path from 'path';
import { GoPlugin } from '@/plugins/golang/index.js';
import { isGoAvailable } from '../../helpers/go-availability.js'; // 或已有的 skip-helper

describe.skipIf(!isGoAvailable())('Go MCP server — Atlas Flow integration', () => {
  const fixturePath = path.resolve('tests/fixtures/go-mcp-server');

  it('detects 2 AddTool entry points with protocol mcp', async () => {
    const plugin = new GoPlugin();
    const result = await plugin.parseProject(fixturePath, { atlas: { enabled: true } });
    const atlas = result.extensions?.goAtlas;
    expect(atlas?.layers.flow).toBeDefined();
    expect(atlas!.layers.flow!.entryPoints).toHaveLength(2);
    expect(atlas!.layers.flow!.entryPoints.every(e => e.protocol === 'mcp')).toBe(true);
  });

  it('generates non-empty call chains for detected entry points', async () => {
    const plugin = new GoPlugin();
    const result = await plugin.parseProject(fixturePath, { atlas: { enabled: true } });
    const flow = result.extensions?.goAtlas?.layers.flow;
    expect(flow?.callChains).toHaveLength(2);
  });
});
```

**验收标准**：
- 有 Go 环境时，集成测试全绿
- 无 Go 环境时，测试 skip（不报错）
- `npm test` 整体全绿

---

## 依赖关系图

```
Phase 101 (handlerArgIndex fix)
    │
    ├──→ Phase 102 (mcp-go + mcp-gosdk patterns)
    │        │
    │        ├──→ Phase 103 (generic heuristic fallback)
    │        │
    │        └──→ Phase 105 (empty flow diagnostic)
    │
    └──→ Phase 104 (entryPointPattern CLI flag)
             │
             └──→ Phase 105 (--atlas-entry-pattern mentioned in diagnostic)

Phase 102 + 103 + 104 + 105
    └──→ Phase 106 (unit tests for all phases)
             └──→ Phase 107 (integration test)
```

**可并行执行**：Phase 102、103、104 完成 Phase 101 后可并行；Phase 105 可在 Phase 102 完成后立即开始。

---

## 测试文件清单

| 文件 | Phase | 类型 |
|---|---|---|
| `tests/plugins/golang/atlas/flow-graph-builder.test.ts` | 106 | 扩展现有（新增 ~150 行，4 个 describe 分组）|
| `tests/plugins/golang/atlas/framework-detector.test.ts` | 106 | 扩展现有（新增 ~40 行，1 个 describe 分组）|
| `tests/unit/cli/analyze/normalize-to-diagrams.test.ts` | 106 | 扩展现有（新增 ~20 行，1 个 describe 分组）|
| `tests/fixtures/go-mcp-server/go.mod` | 107 | **新建**（fixture）|
| `tests/fixtures/go-mcp-server/main.go` | 107 | **新建**（fixture）|
| `tests/fixtures/go-mcp-server/handlers.go` | 107 | **新建**（fixture）|
| `tests/integration/plugins/golang/atlas/go-mcp-server.integration.test.ts` | 107 | **新建**（integration test）|

---

## 改动量汇总

| Phase | Stage | 主要修改内容 | 估计改动行数 |
|---|---|---|---|
| 101.1 | `handlerArgIndex` 修复 | `flow-graph-builder.ts`（+5 行接口字段，+3 行逻辑修改）| ~15 |
| 102.1 | GO_MOD_FRAMEWORK_MAP 新增 | `framework-detector.ts`（+2 行）| ~5 |
| 102.2 | FRAMEWORK_PATTERNS 新增 | `flow-graph-builder.ts`（+10 行）| ~15 |
| 103.1 | 泛型 fallback 实现 | `flow-graph-builder.ts`（+45 行）| ~50 |
| 104.1 | 类型定义 + CLI flag | `types.ts`（+2 行）、`config-cli.ts`（+1 行）、`analyze.ts`（+5 行）| ~15 |
| 104.2 | normalize 接线 + FlowBuilder 消费 | `normalize-to-diagrams.ts`（+2 行）、`flow-graph-builder.ts`（+30 行）| ~35 |
| 105.1 | 空 Flow 诊断 | `atlas-renderer.ts`（+20 行）| ~25 |
| 106.1-4 | 单元测试 | 3 个测试文件扩展（+210 行）| ~210 |
| 107.1-2 | 集成测试 + fixture | 3 个 fixture 文件 + 1 个测试文件（+80 行）| ~80 |
| **合计** | | | **~450 行新增/修改** |

各 Phase ≤500 行，各 Stage ≤200 行，满足约束。

---

## 验收标准（全 Phase 通用门控）

- [ ] `npm test` 全绿，测试总数 ≥ 当前数量 + Phase 106 新增测试数（约 +20 tests）
- [ ] `npm run type-check` 零错误
- [ ] `npm run lint` 零 error
- [ ] `npm run build` 成功
- [ ] `node dist/cli/index.js analyze --lang go -s /path/to/meta-cc/src -v` 输出非空 Flow 层（meta-cc 实际验证）

**Phase 101 专项**：
- [ ] `matchCallPattern` 对 `handlerArgIndex: 2` 的模式提取 `call.args[2]` 而非 `call.args[1]`
- [ ] 无 `handlerArgIndex` 时行为与修改前完全一致（回归）

**Phase 102 专项**：
- [ ] `FrameworkDetector.detect()` 对含 `github.com/mark3labs/mcp-go` 的 go.mod 返回 `'mcp-go'`
- [ ] `FrameworkDetector.detect()` 对含 `github.com/modelcontextprotocol/go-sdk` 的 go.mod 返回 `'mcp-gosdk'`
- [ ] `FlowGraphBuilder.build()` 对 `mcp-go` 框架下的 `AddTool` 调用创建 `protocol: 'mcp'` entry point

**Phase 103 专项**：
- [ ] 主检测有结果时，`generic-heuristic` 分支**不触发**
- [ ] 主检测无结果且存在 `AddTool` 调用时，创建 `protocol: 'custom'`、`framework: 'generic-heuristic'` entry point

**Phase 104 专项**：
- [ ] `--atlas-entry-pattern 'AddTool|Register'` 正确传递到 `FlowBuildOptions.entryPointPattern`
- [ ] 无效正则（如 `'[invalid'`）不 crash，返回空 entry points
- [ ] `entryPointPattern` 与 `detectedFrameworks` 主检测结果相加（不互斥）

**Phase 105 专项**：
- [ ] Flow 层为空时，stderr 输出包含框架列表和 `--atlas-entry-pattern` 提示
- [ ] 泛型启发式触发时，stderr 输出 info 提示
- [ ] Flow 层非空时，无额外 stderr 输出

**Phase 107 专项**（需要 Go 环境）：
- [ ] fixture 解析后 `flow.entryPoints.length === 2`
- [ ] 两个 entry points 的 `protocol === 'mcp'`
- [ ] `flow.callChains.length === 2`

---

## 向后兼容声明

**Phase 101**：`matchCallPattern` 行为对所有现有 `CallPattern` 条目（均未设置 `handlerArgIndex`）完全不变——`undefined ?? 1` 默认值保证回退到 `args[1]`。

**Phase 102**：纯新增框架支持，不修改任何现有框架的检测逻辑。`FRAMEWORK_PATTERNS` 和 `GO_MOD_FRAMEWORK_MAP` 仅追加，不删改。

**Phase 103**：次级 fallback 仅在主检测结果为空时激活，对任何已有框架（net/http、gin 等）的项目无影响。

**Phase 104**：`entryPointPattern` 为可选字段，不设置时行为与当前完全一致。

**Phase 105**：诊断消息输出到 stderr（不影响 stdout/文件输出）；仅在 Flow 层为空或启发式触发时出现。
