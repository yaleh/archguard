# Proposal: 面向代理的精准查询层

**状态**: Draft (rev 2)
**日期**: 2026-03-06
**关联**: [proposal-file-stats-and-cycle-expansion.md](./proposal-file-stats-and-cycle-expansion.md)

---

## 背景与动机

ArchGuard 的现有能力完全是**批量模式**：解析源代码 → 生成 ArchJSON → 渲染图表。这个流程在两类场景下工作良好：

- CI 中周期性生成架构快照
- 人工阅读 `.archguard/` 产物

但 Claude Code / Codex 这类 AI 代理在编辑代码时的需求截然不同。代理通常处于编辑循环中，需要**针对具体问题的即时答案**，而不是重新运行整个分析流程。典型问题包括：

| 代理场景 | 实际问题 | 当前能做什么 |
|----------|----------|-------------|
| 修改一个接口 | "谁实现了 `ILanguagePlugin`？" | 需重跑完整 analyze（数分钟） |
| 重构一个类 | "哪些文件依赖 `DiagramProcessor`？" | 无查询接口 |
| 评估改动影响 | "改 `ArchJSON` 类型会波及哪几层？" | 无 |
| 定位实现 | "接口 `IParser.parseProject` 的所有实现在哪？" | 无 |
| 找高耦合点 | "当前最被依赖的 5 个实体是什么？" | 需人工读 index.md |

**核心矛盾**：ArchJSON 已经包含了回答上述所有问题所需的结构化信息（实体、关系、`sourceLocation`），但它目前只作为图渲染的中间产物，在用完后被丢弃，没有暴露为可查询的工具层。

本 Proposal 的目标是将 ArchJSON 从"内部中间产物"升级为"持久化索引"，并在此基础上提供：

1. **持久化 `arch.json`**：原始 ArchJSON（聚合前的完整解析结果）在每次 analyze 后自动落盘
2. **`arch-index.json` 反向索引**：构建一次，深度 1 查询 O(1)
3. **`query` 子命令**：基于缓存数据的结构化查询，无需重新解析
4. **`search` 子命令**：基于结构特征的文件发现（孤立实体、循环依赖参与者、高耦合点等）
5. **MCP Server**：将上述工具暴露为 Claude Code 可直接调用的工具函数

---

## 现有缓存层现状

ArchGuard 已有两层缓存：

| 缓存 | 位置 | 粒度 | 生命周期 |
|------|------|------|----------|
| `ArchJsonDiskCache` | `~/.archguard/cache/archjson` | source-set SHA256 | 跨 analyze 调用 |
| `ParseCache`（内存） | 进程内 | 单文件内容 hash | 单次 analyze 会话，结束即丢弃 |

**存在的问题**：

- `ArchJsonDiskCache` 存储完整 ArchJSON，但键是不透明的 SHA256 哈希，外部工具无法定位
- ArchJSON 落盘只在 `-f json` 时发生，且路径由用户指定，不是固定约定位置
- 没有反向索引：查询"谁依赖了 X"需要线性扫描全部 `relations[]`

---

## 语言覆盖范围

| 语言 | `arch.json` 写入 | 说明 |
|------|-----------------|------|
| TypeScript | ✓ | 标准实体（class/interface/function），实体数 > 0 时写入 |
| Go（标准模式，`--no-atlas`） | ✓ | 标准实体，实体数 > 0 时写入 |
| Go（Atlas 模式，默认） | ✗ | Atlas 数据在 `extensions.goAtlas`，`entities[]` 为空或极少；写入无意义，与 `proposal-file-stats` 一致 |
| Java | ✓ | 同 TypeScript |
| Python | ✓ | 同 TypeScript |
| C++ | ✓ | 实体数 > 0 时写入；`workspaceRoot` 字段存在，文件路径归一化同 `proposal-file-stats` |

---

## 设计

### 一、rawArchJSON 的获取：`DiagramProcessor.getPrimaryArchJson()`

**现状**：`DiagramProcessor.processAll()` 仅返回 `DiagramResult[]`，内部的 `archJsonCache`（`Map<string, ArchJSON>`）是 private 字段，外部无法访问。

**选择的方案**：在 `DiagramProcessor` 上新增一个 public getter：

```typescript
// src/cli/processors/diagram-processor.ts

/**
 * Returns the "primary" rawArchJSON after processAll() completes.
 *
 * Selection rule: among all entries in archJsonCache (keyed by source hash),
 * return the one with the highest entity count. For standard projects this is
 * the root source group (e.g. './src') that covers the most files.
 *
 * Returns null if:
 * - processAll() has not been called yet
 * - all cached ArchJSONs have 0 entities (e.g. Go Atlas mode)
 * - archJsonCache is empty (all groups failed)
 */
getPrimaryArchJson(): ArchJSON | null {
  let best: ArchJSON | null = null;
  for (const archJson of this.archJsonCache.values()) {
    if (!best || archJson.entities.length > best.entities.length) {
      best = archJson;
    }
  }
  return best && best.entities.length > 0 ? best : null;
}
```

**选取规则**：实体数最多的条目 = 覆盖范围最广的根 source group。这适用于典型分析场景（一个根 `./src` + 多个派生子模块）。对于多个独立 source group 共存的情况（如 C++ 多根目录），选取最大的一个，其他忽略——此场景本就不存在单一的"全量"视图。

**调用时机**：在 `analyze.ts` 的 action handler 中，`processor.processAll()` 返回后立即调用：

```typescript
// analyze.ts — analyzeCommandHandler 中
const results = await processor.processAll();
const primaryArchJson = processor.getPrimaryArchJson();
if (primaryArchJson) {
  await persistArchArtifacts(config.outputDir, primaryArchJson);
}
```

`persistArchArtifacts` 顺序写入 `arch.json` → `arch-index.json`（见一致性节）。

### 二、持久化 `arch.json`

写入固定路径，内容为 `getPrimaryArchJson()` 返回的 rawArchJSON（聚合前，等价于完整的解析结果）：

```
.archguard/
  arch.json          ← 新增：rawArchJSON（聚合前，含完整实体/关系/成员）
  arch-index.json    ← 新增：反向索引（见下）
  overview/
  class/
  method/
  index.md
```

**与 `-f json` 模式的关系**：

`-f json` 模式下，`processDiagramWithArchJSON` 将每个图的**聚合后** ArchJSON（含 metrics）写入各自路径（如 `.archguard/class/all-classes.json`）。`arch.json` 是**独立写入的 rawArchJSON**，两者内容不同：

| 文件 | 内容 | 用途 |
|------|------|------|
| `.archguard/arch.json` | rawArchJSON（聚合前，无 metrics） | 供 `query`/`search` 查询 |
| `.archguard/class/all-classes.json` | class-level 聚合 ArchJSON（含 metrics） | 工具链消费、格式输出 |

两者并存，不冲突。`index.md` 不引用 `arch.json`。

**写入条件**：`getPrimaryArchJson()` 返回非 null 时写入。不写入的情况：

- Go Atlas 模式（`entities[]` 为空）
- 所有 source group 解析失败
- `entities.length === 0`（空项目）

### 三、`arch-index.json` 反向索引与一致性保证

#### 数据结构

```typescript
// src/cli/query/arch-index.ts

export interface ArchIndex {
  /** Schema 版本，用于格式演进 */
  version: string;                              // "1.0"

  /** 生成时间 */
  generatedAt: string;                          // ISO 8601

  /** 对应的 arch.json 内容 SHA-256，用于一致性校验 */
  archJsonHash: string;

  /** 解析语言 */
  language: string;

  /** 实体名（大小写敏感）→ entity ID 列表（处理跨模块同名） */
  nameToIds: Record<string, string[]>;

  /** 实体 ID → 源文件相对路径（来自 entity.sourceLocation.file，C++ 绝对路径已归一化） */
  idToFile: Record<string, string>;

  /** 实体 ID → entity name（供展示用，避免加载完整 arch.json） */
  idToName: Record<string, string>;

  /** 实体 ID → 反向依赖实体 ID 列表（谁依赖了它） */
  dependents: Record<string, string[]>;

  /** 实体 ID → 正向依赖实体 ID 列表（它依赖了谁） */
  dependencies: Record<string, string[]>;

  /** 关系类型 → [source ID, target ID][] */
  relationsByType: Partial<Record<import('@/types/index.js').RelationType, [string, string][]>>;

  /** 源文件相对路径 → 该文件内的 entity ID 列表 */
  fileToIds: Record<string, string[]>;

  /**
   * 非平凡 SCC（size > 1），按 size 降序。
   * 与 proposal-file-stats 的 CycleInfo 结构对齐（含 memberNames 和 files）
   * 以避免消费方还需加载完整 arch.json。
   */
  cycles: Array<{
    size: number;
    members: string[];       // entity ID 列表
    memberNames: string[];   // entity name 列表（与 members 一一对应）
    files: string[];         // 去重后的源文件路径
  }>;
}
```

注：移除了 `idToIndex`（entities[] 下标）——在 500–5000 实体规模下，O(n) 线性查找耗时可忽略，而该字段在 arch.json 与 arch-index.json 不同步时会引发难以排查的错误。

#### 一致性保证机制

`arch-index.json` 的 `archJsonHash` 字段存储写入时 `arch.json` 的 SHA-256（对文件内容）。`QueryEngine` 加载时执行以下校验：

```typescript
async function loadWithValidation(archDir: string): Promise<QueryEngine> {
  const archJsonPath = path.join(archDir, 'arch.json');
  const indexPath    = path.join(archDir, 'arch-index.json');

  // 1. arch.json 必须存在
  if (!await fs.pathExists(archJsonPath)) {
    throw new QueryDataMissingError("Run 'archguard analyze' first");
  }

  const archJsonContent = await fs.readFile(archJsonPath, 'utf-8');
  const archJsonHash = sha256(archJsonContent);

  // 2. 若 arch-index.json 不存在，临时构建内存索引（不写入磁盘）
  if (!await fs.pathExists(indexPath)) {
    return QueryEngine.fromArchJson(JSON.parse(archJsonContent));
  }

  const index = await fs.readJson(indexPath) as ArchIndex;

  // 3. 哈希不匹配：index 来自旧版 arch.json，重建内存索引
  if (index.archJsonHash !== archJsonHash) {
    return QueryEngine.fromArchJson(JSON.parse(archJsonContent));
  }

  return new QueryEngine(index, JSON.parse(archJsonContent));
}
```

**写入顺序**：`persistArchArtifacts` 先写 `arch.json`，再写 `arch-index.json`。若进程在两次写入之间被 kill，下次 `QueryEngine.load` 会检测到哈希不匹配并从 `arch.json` 重建，不会产生错误结果。

**构建代价**：对 500 实体、500 关系的项目，构建时间 < 5ms；index 文件大小约 50–100 KB。

### 四、`query` 子命令

基于磁盘上的 `arch.json` + `arch-index.json` 提供结构化查询，**无需重新解析任何源文件**：

#### 命令设计

```bash
# 查找实体（精确名称匹配；--fuzzy 支持子串匹配）
archguard query --entity "CacheManager"
archguard query --entity "Cache" --fuzzy

# 正向依赖（X 依赖了谁；--depth 指定 BFS 层数，默认 1，上限 5）
archguard query --deps-of "DiagramProcessor"
archguard query --deps-of "DiagramProcessor" --depth 2

# 反向依赖（谁依赖了 X，变更影响分析；同支持 --depth，含义为传递依赖方）
archguard query --used-by "ArchJSON"
archguard query --used-by "ArchJSON" --depth 2

# 接口/抽象类的所有实现（relation.type === 'implementation'）
archguard query --impls-of "ILanguagePlugin"

# 文件内实体列表
archguard query --file "src/cli/processors/diagram-processor.ts"

# 循环依赖（可选过滤到包含指定实体的循环）
archguard query --cycles
archguard query --cycles --entity "DiagramProcessor"

# 全局指标摘要
archguard query --summary

# 显式指定 .archguard/ 目录（分析外部项目）
archguard query --used-by "App" --source-dir /path/to/project/.archguard
```

#### 深度展开的复杂度

`--depth 1` 查询（直接依赖/被依赖）通过 `arch-index.json` 的 `dependencies`/`dependents` 字段完成，单次 O(1) map 查找。

`--depth N`（N > 1）需要 BFS 展开，复杂度为 O(nodes × avgFanOut × depth)。BFS 使用 visited 集合防止在有环依赖图中无限展开。`depth` 上限为 5（硬上限，超过此值的传递依赖集合通常过大，对代理无意义）。

#### 输出格式

默认 JSON（代理可解析），`--format text` 时输出人类可读格式：

```bash
$ archguard query --used-by "ArchJSON" --format text

ArchJSON  ←  used by 12 entities

  DiagramProcessor         src/cli/processors/diagram-processor.ts:45
  MetricsCalculator        src/parser/metrics-calculator.ts:4
  ArchJSONAggregator       src/parser/archjson-aggregator.ts:23
  MermaidDiagramGenerator  src/mermaid/diagram-generator.ts:12
  ... (8 more, use --format json for full list)
```

```bash
$ archguard query --entity "CacheManager" --format text

CacheManager  [class]  src/cli/cache-manager.ts:36
  public methods: computeFileHash, get, set, clear, getStats, getCacheSize
  depends on:  3 entities
  used by:     1 entity  (AnalyzeCommand)
```

#### 数据源选择逻辑

1. 优先读取 `{sourceDir}/arch-index.json`，校验 `archJsonHash`（见一致性节）
2. 若 index 不存在或哈希不匹配，从 `arch.json` 临时构建内存索引（不写入磁盘）
3. 若 `arch.json` 也不存在，打印 `"Run 'archguard analyze' first"`，退出码 1
4. `sourceDir` 默认为当前目录下的 `.archguard/`；`--source-dir` 可显式覆盖

**目录查找**：`query` 不向上层目录 walk（不同于 git）。若当前目录无 `.archguard/`，直接以退出码 1 退出并提示路径。

### 五、`search` 子命令

`search` 的定位与 `query` 互补：**不需要知道具体实体名称，而是按结构特征发现文件**。所有过滤均基于 `arch-index.json`，无 AST 重扫。

```bash
# 找所有调用了某实体的文件（基于 dependency relation，见精度说明）
archguard search --calls "parseProject"

# 找某 EntityType 的所有实体所在文件
archguard search --type abstract_class
archguard search --type interface --module "src/core"

# 找高入度实体（被大量实体依赖；--threshold 指定 dependents 数下限，默认 8）
archguard search --high-coupling [--threshold 8]

# 找孤立实体（dependents 为空，可能是死代码）
archguard search --orphans

# 找参与循环依赖的文件
archguard search --in-cycles
```

#### `--calls` 精度说明（重要约束）

当前 ArchJSON 的 `relations[]` 记录"A 依赖 B（实体级别）"，不记录具体调用了 B 的哪个方法。`--calls "parseProject"` 的实现是：

- 在 `arch-index.json.nameToIds` 中查找名称包含 `parseProject` 的实体 ID
- 返回所有在 `dependencies` 中引用了这些 ID 的 source 实体所在文件

**已知限制**：

1. **匹配单位是实体，不是方法调用**：若 A 依赖了类 B（B 中恰好有名为 `parseProject` 的方法），A 会出现在结果中，但 A 并不一定实际调用了 `parseProject`
2. **TypeScript 的 cross-file 解析质量**：当前 TS 解析有 45 个"undefined entity"警告（见 typescript-atlas-proposal.md）。这些悬空 relation 在 `--calls` 结果中会造成漏报。此限制在 TypeScript Atlas 提案落地后才能改善

**结论**：`--calls` 在当前版本提供的是"疑似依赖方"列表，适合作为 grep 的补充，不适合作为精确调用图使用。

#### `--type` 与 EntityType 编码

`EntityType` 的合法值来自 `src/types/index.ts`：`'class'`、`'interface'`、`'enum'`、`'struct'`、`'trait'`、`'abstract_class'`、`'function'`。

`abstract_class` 是独立的 `EntityType` 值，不是 `isAbstract + class` 的组合。`--type abstract_class` 的过滤条件为：

```typescript
entity.type === 'abstract_class' || (entity.isAbstract === true && entity.type === 'class')
```

两种编码在不同语言插件中均有出现，过滤时需同时覆盖。

#### `--high-coupling` 粒度说明

`--high-coupling` 返回的是**实体级别**的高入度（`dependents[id].length >= threshold`），展示时附带源文件路径。这不同于 `proposal-file-stats` 的 `FileStats.inDegree`（文件内所有实体的入度之和）。两者均基于 arch-index，但粒度不同：

- 实体级高入度 = 该实体被多少个其他实体引用（本 Proposal）
- 文件级高入度 = 该文件内所有实体的入度总和（proposal-file-stats）

### 六、MCP Server

将 `query` 和 `search` 能力包装为 MCP（Model Context Protocol）工具，让 Claude Code 在编辑会话中**无需切换终端**即可调用。

#### 依赖声明

MCP Server 实现需要新增运行时依赖：

```json
// package.json — 新增到 dependencies
"@modelcontextprotocol/sdk": "^1.x"
```

#### 工具列表

```typescript
tools: [
  {
    name: "archguard_find_entity",
    description: "按名称查找实体，返回类型、源文件位置、成员列表",
    inputSchema: { name: "string", fuzzy: "boolean?" }
  },
  {
    name: "archguard_get_dependents",
    description: "返回依赖了指定实体的所有实体（变更影响分析）；depth > 1 时返回传递依赖方",
    inputSchema: { entityName: "string", depth: "number? (1–5)" }
  },
  {
    name: "archguard_get_dependencies",
    description: "返回指定实体的直接或传递依赖；depth > 1 时 BFS 展开（上限 5）",
    inputSchema: { entityName: "string", depth: "number? (1–5)" }
  },
  {
    name: "archguard_find_implementations",
    description: "返回接口或抽象类的所有实现/子类（relation.type === 'implementation'）",
    inputSchema: { interfaceName: "string" }
  },
  {
    name: "archguard_get_file_entities",
    description: "返回一个文件中定义的所有实体及其公开成员",
    inputSchema: { filePath: "string" }
  },
  {
    name: "archguard_detect_cycles",
    description: "返回所有循环依赖（SCC size > 1），可选过滤到包含指定实体名的循环",
    inputSchema: { entityName: "string?" }
  },
  {
    name: "archguard_summary",
    description: "返回项目结构摘要：实体数、关系数、循环数、高入度实体 Top 5",
    inputSchema: {}
  },
]
```

#### 启动方式

```bash
# stdio 模式（MCP 标准）
archguard mcp --source-dir ./.archguard

# 显式指定外部项目
archguard mcp --source-dir /path/to/project/.archguard
```

启动时立即执行数据加载与一致性校验（同 `QueryEngine.load`）。若 `arch.json` 不存在，打印错误并以退出码 1 退出——不静默启动后在每次工具调用时返回错误。

#### 与 Claude Code 的集成

> **注意**：以下配置路径为当前已知约定，需在 Claude Code 官方 MCP 文档稳定后确认。

```json
// .mcp.json（项目根目录，路径待 Claude Code 官方确认）
{
  "mcpServers": {
    "archguard": {
      "command": "archguard",
      "args": ["mcp", "--source-dir", "./.archguard"]
    }
  }
}
```

---

## 数据流

```
archguard analyze 完成
  └─→ processor.processAll() → DiagramResult[]
  └─→ processor.getPrimaryArchJson()
        → rawArchJSON（entities 最多的 source group；Go Atlas 返回 null）
        → null 时跳过，非 null 时：

        persistArchArtifacts(outputDir, rawArchJSON)
          ├─→ 写入 arch.json
          └─→ ArchIndexBuilder.build(rawArchJSON, archJsonHash)
                └─→ 写入 arch-index.json（含 archJsonHash 字段）

archguard query --used-by "Foo"           （新进程，每次调用独立）
  └─→ QueryEngine.load(".archguard/")
        ├─ arch-index.json 存在且哈希匹配 → 直接使用 index
        ├─ index 不存在或哈希不匹配       → 从 arch.json 构建内存 index
        └─ arch.json 不存在               → 报错，退出码 1
  └─→ engine.getDependents("Foo")         ← O(1) map lookup（depth=1）
        └─→ stdout（JSON / text）

archguard mcp --source-dir ./.archguard   （常驻进程）
  └─→ QueryEngine.load()（启动时一次性加载）
  └─→ 监听 stdin（@modelcontextprotocol/sdk）
        └─→ 各工具调用 engine 方法（同上）
```

---

## 实现范围

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/cli/query/arch-index.ts` | `ArchIndex` 接口定义 |
| `src/cli/query/arch-index-builder.ts` | `ArchIndexBuilder`（纯函数：ArchJSON → ArchIndex） |
| `src/cli/query/query-engine.ts` | `QueryEngine`（加载、校验、查询方法） |
| `src/cli/query/arch-artifacts.ts` | `persistArchArtifacts(outputDir, archJson)`：写入 arch.json + arch-index.json |
| `src/cli/commands/query.ts` | `query` 子命令（Commander） |
| `src/cli/commands/search.ts` | `search` 子命令（Commander） |
| `src/cli/commands/mcp.ts` | `mcp` 子命令：启动 MCP stdio server |
| `src/cli/mcp/mcp-server.ts` | MCP server（工具注册、请求分发，依赖 `@modelcontextprotocol/sdk`） |
| `tests/unit/cli/query/arch-index-builder.test.ts` | `ArchIndexBuilder` 单元测试 |
| `tests/unit/cli/query/query-engine.test.ts` | `QueryEngine`（含 hash 校验、回退逻辑）单元测试 |
| `tests/unit/cli/commands/query.test.ts` | `query` 命令集成测试 |
| `tests/unit/cli/commands/search.test.ts` | `search` 命令集成测试 |

### 修改文件

| 文件 | 变更说明 |
|------|---------|
| `src/cli/processors/diagram-processor.ts` | 新增 public `getPrimaryArchJson(): ArchJSON \| null`；private `archJsonCache` 保持不变 |
| `src/cli/commands/analyze.ts` | `analyzeCommandHandler` 中：`processAll()` 后调用 `processor.getPrimaryArchJson()`，非 null 时调用 `persistArchArtifacts` |
| `src/cli/index.ts` | 注册 `query`、`search`、`mcp` 三个子命令 |
| `package.json` | `dependencies` 新增 `@modelcontextprotocol/sdk` |

### 不在本次范围内

- 增量缓存失效（文件级重解析）：不实现
- `--calls` 基于 AST 重扫的精确方法调用图：当前基于 entity-level dependency relation
- `search --similar`（语义相似搜索）：需 embedding，不实现
- MCP 的 HTTP transport 模式：仅实现 stdio
- `arch.json` 历史版本管理（git 时序对比）：不实现
- `arch-index.json` 与 `ArchJsonDiskCache` 的合并：两者 TTL 语义不同，暂时双写

---

## 向后兼容性

- `arch.json` 和 `arch-index.json` 是新增文件，不影响现有 `.archguard/` 内容
- `query`、`search`、`mcp` 是新增子命令，不影响现有 `analyze`、`init`、`cache`
- `DiagramProcessor.getPrimaryArchJson()` 为新增 public 方法，不改变 `processAll()` 签名，对现有调用方零影响
- `arch-index.json` 的 `version` 字段用于后续格式演进；`QueryEngine` 遇到不认识的 version 时回退到从 `arch.json` 重建，不崩溃

---

## 验收标准

### `arch.json` 持久化

1. 运行 `archguard analyze` 后，`.archguard/arch.json` 存在且为有效 JSON（TypeScript、Go 标准模式、Java、Python、C++ 项目均如此）
2. `arch.json` 的 `entities` 数量等于 `DiagramProcessor.getPrimaryArchJson()` 返回对象的 `entities.length`，与任何图的聚合级别无关
3. Go Atlas 模式（`extensions.goAtlas` 存在，`entities.length === 0`）：不生成 `arch.json`，不报错
4. 所有 source group 解析失败或 `entities` 均为空时：不生成 `arch.json`，不报错
5. `-f json` 模式下：`arch.json`（rawArchJSON）与 `.archguard/class/all-classes.json`（聚合后 ArchJSON）并存，互不干扰

### `arch-index.json` 构建与一致性

6. `arch-index.json` 中每个 entity ID 在 `nameToIds`、`idToFile`、`idToName` 中均有对应条目
7. `dependents[id]` 的集合等于 `relations[].source where target === id`（仅含 entities 集合内的端点）
8. `dependencies[id]` 的集合等于 `relations[].target where source === id`
9. `fileToIds[file]` 的集合等于 `entities[].id where sourceLocation.file === file`（C++ 绝对路径归一化为相对路径后）
10. `cycles` 仅包含 size > 1 的 SCC；`cycles[i].memberNames[k]` 与 `cycles[i].members[k]` 一一对应
11. `arch-index.json.archJsonHash` 等于写入时 `arch.json` 文件内容的 SHA-256

### 一致性与回退

12. `arch-index.json` 不存在时，`QueryEngine.load()` 从 `arch.json` 构建内存索引，查询结果正确，不写入磁盘
13. `arch-index.json.archJsonHash` 与当前 `arch.json` 哈希不匹配时，`QueryEngine.load()` 从 `arch.json` 重建，不报错，不使用过期 index 数据
14. `arch.json` 不存在时（index 也不存在），`QueryEngine.load()` 抛出 `QueryDataMissingError`，调用方打印 `"Run 'archguard analyze' first"`，退出码 1
15. MCP server 启动时若 `arch.json` 不存在，打印错误并以退出码 1 退出，不静默启动

### `query` 命令

16. `--entity "X"` 返回名称完全匹配的实体；`--fuzzy` 时返回所有 name 包含该字符串的实体
17. `--entity "X"` 找不到时返回空结果，退出码 0
18. `--used-by "X"` 与手工过滤 `arch-index.json.dependents["X"]` 结果相同（depth=1）
19. `--deps-of "X" --depth 2` 返回 X 的直接依赖及其直接依赖（BFS，visited 集合去重，不含 X 自身）；依赖图有环时不死循环
20. `--used-by "X" --depth 2` 返回 X 的直接依赖方及其直接依赖方（BFS，有环保护）
21. `--impls-of "IParser"` 返回所有 `relation.type === 'implementation' && target === IParser.id` 的 source 实体
22. `--file "src/foo.ts"` 返回该文件内所有实体；文件路径未出现在 index 时返回空结果
23. `--format json` 输出合法 JSON；`--format text` 输出人类可读文本
24. `.archguard/` 不存在时退出码 1；`--source-dir` 不存在时退出码 1（不向上层目录 walk）

### `search` 命令

25. `--type abstract_class` 返回所有满足 `entity.type === 'abstract_class' || (entity.isAbstract === true && entity.type === 'class')` 的实体所在文件
26. `--orphans` 返回所有 `dependents[id].length === 0` 的实体所在文件（不含 Go Atlas stub 实体）
27. `--in-cycles` 返回参与至少一个非平凡 SCC 的实体所在文件；无循环依赖时返回空结果
28. `--high-coupling --threshold N` 返回 `dependents[id].length >= N` 的实体及其源文件（实体级粒度，非文件级）
29. `--calls "X"` 返回 `dependencies[id] ∩ nameToIds["X"]` 非空的实体所在文件；若 X 在 index 中不存在，返回空结果

### MCP Server

30. `archguard mcp` 启动时立即加载数据（不懒加载）；数据不存在时退出码 1，不进入监听循环
31. 启动成功后响应 `initialize` 消息，返回包含所有 7 个工具的工具列表
32. `archguard_find_entity` 工具的响应结构与工具定义的 inputSchema 匹配
33. `archguard_get_dependents` 工具调用结果与 `query --used-by`（相同 depth）一致
34. `archguard_get_dependencies` 的 depth > 1 时 BFS 有环保护（visited set），不死循环

### 回归

35. 现有所有测试通过（无回归）
36. `npm run type-check` 零错误

---

## 开放问题

| 问题 | 说明 | 建议处理时机 |
|------|------|------------|
| `--calls` 精度上限 | 当前 relation 不记录具体调用的方法名；`--calls "parseProject"` 只能定位到"依赖了含 parseProject 的实体"的文件，不是精确调用图。TypeScript Atlas 提案落地（cross-file 关系解析 + function entity 提取）后可提升精度 | TypeScript Atlas 提案实现后 |
| `getPrimaryArchJson()` 在多独立 source group 下的语义 | 选取 entities 最多的 source group 是合理的启发式，但对于两个同等大小的独立根目录（如 monorepo 中两个平级包），写入其中一个会遗漏另一个。此场景下 `arch.json` 仅代表部分项目 | 后续考虑 `arch-{hash}.json` 多份并存方案 |
| `arch.json` 与 `ArchJsonDiskCache` 内容重叠 | 两者存储相同的 rawArchJSON，`arch.json` 是固定约定位置，`ArchJsonDiskCache` 是按内容 hash 的跨调用缓存。可考虑后者直接复用前者，但两者的读取路径（固定路径 vs hash 路径）和过期语义不同 | 后续 enhancement |
| MCP 配置文件路径 | `.mcp.json` 为当前已知路径，Claude Code 官方 MCP 集成文档发布后需核对 | 随官方文档更新 |
| `--depth` 上限的合理值 | 当前硬上限 5。对于 500+ 实体的项目，depth=3 已可能返回数百条结果。可考虑同时限制结果集大小（如 max 100 条）而非仅限制深度 | 实现阶段调整 |
