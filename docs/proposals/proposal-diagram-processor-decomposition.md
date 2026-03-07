# Proposal: DiagramProcessor 拆分重构

**状态**: Draft (rev 4)
**日期**: 2026-03-07
**关联**: [proposal-agent-query-layer.md](./proposal-agent-query-layer.md)

---

## 背景与动机

`DiagramProcessor`（`src/cli/processors/diagram-processor.ts`）是 ArchGuard 的核心处理单元，经过多轮功能叠加后已演变为典型的上帝类（God Object）：

| 指标 | 数值 |
|------|------|
| 代码行数 | 958 行（第 232–1190 行） |
| 方法数 | 18 |
| 字段数 | 14 |
| 直接依赖类型 | 17（见 MCP `archguard_get_dependencies`） |

**当前职责清单**（混杂在同一个类中）：

1. **解析路由**：按语言（Go / C++ / TypeScript+moduleGraph / TypeScript）分发到对应解析器
2. **多层缓存管理**：内存缓存（`archJsonCache`）、磁盘缓存（`ArchJsonDiskCache`）、进行中 Promise（`archJsonDeferred`）、路径索引（`archJsonPathIndex`）
3. **子模块 ArchJSON 派生**：从父级结果裁剪出 sub-path 视图（`findParentCoverage`、`deriveSubModuleArchJSON`）
4. **单图处理管道**：聚合（`aggregator`）→ 路径解析 → metrics 计算 → 输出分发（`processDiagramWithArchJSON`）
5. **输出格式生成**：按语言×格式×层级分发到 4 个 `generate*Output` 方法
6. **Worker Pool 生命周期**：启动/关闭 `MermaidRenderWorkerPool`
7. **Query Scope 注册**：`registerQueryScope`、`getQuerySourceGroups`
8. **进度报告聚合**：管理 `ProgressReporter` 与 `ParallelProgressReporter`

这种集中使得：
- 单元测试必须 mock 大量不相关依赖
- 新增语言支持（如 Rust）需要改动已高度复杂的主流程
- `processSourceGroup`（217 行）和 `processDiagramWithArchJSON`（105 行）各自难以独立阅读和测试

---

## 设计目标

1. 将 `DiagramProcessor` 拆分为职责单一的三个组件，原类退化为薄协调层（目标 ≤350 行）
2. 每个新组件可以独立 mock 和测试
3. **不改变外部接口**：`DiagramProcessor` 的 `processAll()` / `getQuerySourceGroups()` 签名保持不变，`analyze.ts` 零修改
4. 拆分后仅新增/移动文件，除下文明确说明的一处防御性优化外，不改变功能行为
5. 迁移时消除三个 `generate*Output` 方法中重复的渲染选项构造逻辑

---

## 不在本次范围内

- 语言插件内部重构
- Query 层或 MCP server 改动
- ArchJSON 数据结构变更
- 性能优化

---

## 核心设计

### 调用链全貌（重构前）

在设计提取边界前，需要先清楚当前的完整调用链：

```
processAll()
  └─ pMap over source groups
       └─ processSourceGroup(sourceKey, diagrams[], pool)   ← 217 行
            ├─ [语言路由 → ArchJSON 获取（含缓存逻辑）]
            │    ├─ go 分支：parseGoProject()
            │    ├─ cpp 分支：parseCppProject() 或从父级派生
            │    ├─ ts + needsModuleGraph 分支：parseTsProject()（TypeScriptPlugin）
            │    │    needsModuleGraph = diagrams.some(d => d.level === 'package')
            │    └─ ts 通用分支：ParallelParser 直接解析
            ├─ registerQueryScope(sources, rawArchJSON, kind)
            └─ pMap over diagrams
                 └─ processDiagramWithArchJSON(diagram, rawArchJSON, pool)   ← 105 行
                      ├─ aggregator.aggregate(rawArchJSON, level)
                      ├─ metricsCalculator.calculate(aggregated, level)
                      ├─ OutputPathResolver.resolve()
                      ├─ generateOutput(aggregated+metrics, paths, format, level, diagram, pool)
                      │    ├─ go atlas → generateAtlasOutput()
                      │    ├─ ts package → generateTsModuleGraphOutput()
                      │    ├─ cpp package → generateCppPackageOutput()
                      │    └─ 其他 → MermaidDiagramGenerator
                      └─ → DiagramResult
```

**关键事实 1**：TypeScript 存在**两条**独立解析路径，不是一条：
- 路径 A（`needsModuleGraph=true`）：走 `parseTsProject()` → TypeScriptPlugin，产出含 `tsAnalysis.moduleGraph` 的 ArchJSON
- 路径 B（通用 TS）：走 `ParallelParser` 直接解析，无 moduleGraph，不经过 `parseTsProject()`

**关键事实 2**：`needsModuleGraph` 由**整个 source group** 的所有图表共同决定：
```typescript
const needsModuleGraph = diagrams.some((d) => d.level === 'package');
```
单张图表的 level 不足以判断。同一 source group 内只要有一张 `package` 级图表，整组就走 TypeScriptPlugin 路径。

---

### 责任边界划分

```
当前 DiagramProcessor (God Object)
              │
    ┌─────────┴──────────────────────┐
    │                                 │
    ▼                                 ▼
ArchJsonProvider              DiagramOutputRouter
（ArchJSON 获取层）              （输出文件生成层）
    │                                 │
    ├─ get(diagram, opts)             ├─ route(archJSON, paths, diagram, pool)
    │    ├─ go → parseGoProject()     ├─ generateAtlasOutput()
    │    ├─ cpp → parseCppProject()   ├─ generateTsModuleGraphOutput()
    │    │        或 derive           ├─ generateCppPackageOutput()
    │    ├─ ts+mg → parseTsPlugin()   └─ buildRendererOptions()  ← 新提取
    │    └─ ts → parseWithParser()
    ├─ cacheArchJson()
    ├─ registerDeferred()
    └─ findParentCoverage()

DiagramProcessor（薄协调层，≤350 行）
    ├─ processAll()              ← Worker Pool 生命周期 + pMap
    ├─ processSourceGroup()      ← 计算 needsModuleGraph，调用 provider，注册 scope，pMap over diagrams
    ├─ processDiagramWithArchJSON()  ← 聚合 + metrics + 路径解析 + outputRouter.route()
    ├─ groupDiagramsBySource() / hashSources()
    ├─ registerQueryScope() / getQuerySourceGroups()
    └─ 持有 aggregator, metricsCalculator, parallelProgress
```

**核心决策**：`processDiagramWithArchJSON` 留在 `DiagramProcessor`，理由：
- 它负责 aggregation + metrics + DiagramResult 构造，是单图处理的完整管道，不属于"输出格式路由"
- `aggregator` 和 `metricsCalculator` 与进度报告、结果收集强耦合，一起留在协调层更自然

---

### 一、`ArchJsonProvider`

负责"给定 DiagramConfig 及其所在分组的解析上下文，返回 ArchJSON 及其来源类型"。

#### 接口设计

```typescript
// src/cli/processors/arch-json-provider.ts

export interface ArchJsonProviderOptions {
  globalConfig: GlobalConfig;
  parseCache?: ParseCache;
  registry?: PluginRegistry;           // 可选，插件注册表
}

/**
 * get() 的额外上下文，无法从单张 DiagramConfig 推导，需调用方显式传入。
 */
export interface ArchJsonGetOptions {
  /**
   * 当前 source group 中是否有任何图表需要 tsAnalysis.moduleGraph。
   * 由调用方计算：diagrams.some(d => d.level === 'package')
   * 决定 TypeScript 走 TypeScriptPlugin（路径 A）还是 ParallelParser（路径 B）。
   */
  needsModuleGraph: boolean;
}

export class ArchJsonProvider {
  private archJsonCache = new Map<string, ArchJSON>();
  private archJsonPathIndex = new Map<string, string>();
  private archJsonDeferred = new Map<string, { promise: Promise<ArchJSON>; sources: string[] }>();

  private readonly diskCache: ArchJsonDiskCache;
  private readonly parseCache?: ParseCache;
  private readonly registry?: PluginRegistry;
  private readonly fileDiscovery: FileDiscoveryService;   // 在构造函数中 new FileDiscoveryService() 初始化，不通过 options 注入
  private readonly globalConfig: GlobalConfig;

  constructor(options: ArchJsonProviderOptions) { ... }

  /**
   * 获取 ArchJSON。
   *
   * 调度规则（按优先级）：
   *   go  → parseGoProject()
   *   cpp → parseCppProject() 或从父级派生
   *   ts，opts.needsModuleGraph=true  AND diagram.language 为 'typescript' 或未指定
   *        → parseTsPlugin()（TypeScriptPlugin，含 moduleGraph）
   *   其余 → parseWithParallelParser()（ParallelParser，无 moduleGraph）
   *
   * 语言守卫说明：opts.needsModuleGraph=true 必须同时满足语言为 TypeScript（或未指定）才走路径 A。
   * 这与原代码 line 560 的条件 (!firstDiagram.language || firstDiagram.language === 'typescript')
   * 保持一致——Java/Python 等语言的 package-level 图表不应调用 TypeScriptPlugin。
   *
   * 缓存策略（见下文"缓存策略说明"）：
   *   - 所有路径在入口统一检查内存缓存
   *   - Go / ts-plugin / ts-general 路径额外检查磁盘缓存
   *   - cpp / ts-general 路径检查父级覆盖（parent derivation）
   *
   * @param diagram  - 当前图表配置（提供 sources、language、exclude 等）
   * @param opts     - 来自 source group 级别的上下文（needsModuleGraph）
   * @returns { archJson, kind } — kind: 有父级派生时为 'derived'，其余为 'parsed'
   */
  async get(
    diagram: DiagramConfig,
    opts: ArchJsonGetOptions
  ): Promise<{ archJson: ArchJSON; kind: 'parsed' | 'derived' }> { ... }

  /** 暴露给 DiagramProcessor 的 debug 用途 */
  public cacheSize(): number { return this.archJsonCache.size; }

  // ---- 内部缓存工具 ----

  private hashSources(sources: string[]): string { ... }

  private cacheArchJson(sources: string[], archJson: ArchJSON): void { ... }

  private registerDeferred(sources: string[], promise: Promise<ArchJSON>): Promise<ArchJSON> { ... }

  /**
   * 返回 { deferred: Promise | null, normParentPath: string | null }。
   * 函数本身不返回 null；当无父级时两个属性均为 null。
   * 签名与原实现一致，迁移时不变。
   */
  private findParentCoverage(
    sources: string[]
  ): { deferred: Promise<ArchJSON> | null; normParentPath: string | null } { ... }

  // ---- 语言特定解析 ----

  private async parseGoProject(diagram: DiagramConfig): Promise<ArchJSON> { ... }

  private async parseCppProject(diagram: DiagramConfig): Promise<ArchJSON> { ... }

  /**
   * TypeScript 路径 A：通过 TypeScriptPlugin 解析，产出含 tsAnalysis.moduleGraph 的 ArchJSON。
   * 仅在 opts.needsModuleGraph=true AND (diagram.language === 'typescript' || diagram.language === undefined) 时调用。
   * Java/Python 即使 needsModuleGraph=true 也不进入此路径，而是继续走路径 B（ParallelParser）。
   * 原名 parseTsProject()，重命名以明确其特化用途。
   */
  private async parseTsPlugin(diagram: DiagramConfig): Promise<ArchJSON> { ... }

  /**
   * TypeScript 路径 B：接收预先 discover 好的文件列表，通过 ParallelParser 解析。
   * 职责单一：只负责解析，不处理缓存、文件发现或 length 检查。
   * 文件发现、files.length === 0 检查、磁盘缓存读写均在调用方 get() 中完成。
   */
  private async parseWithParallelParser(diagram: DiagramConfig, files: string[]): Promise<ArchJSON> { ... }
}
```

#### `get()` 内部调度逻辑（伪代码）

```
get(diagram, opts):
  key = hashSources(diagram.sources)

  // ① 统一内存缓存检查（见"缓存策略说明"）
  if archJsonCache.has(key):
    return { archJson: cached, kind: 'parsed' }

  // ② 按语言分发
  if diagram.language === 'go':
    return { archJson: await registerDeferred(sources, parseGoProject(diagram)), kind: 'parsed' }

  if diagram.language === 'cpp':
    { deferred, normParentPath } = findParentCoverage(sources)
    if deferred:
      parent = await deferred
      return { archJson: deriveSubModuleArchJSON(parent, sources[0], normParentPath), kind: 'derived' }
    elif normParentPath:
      parentKey = archJsonPathIndex.get(normParentPath)
      parent = archJsonCache.get(parentKey)
      return { archJson: deriveSubModuleArchJSON(parent, sources[0], normParentPath), kind: 'derived' }
    else:
      return { archJson: await registerDeferred(sources, parseCppProject(diagram)), kind: 'parsed' }

  // TypeScript
  // 语言守卫：仅当语言为 TypeScript（或未指定）时才走路径 A（与原代码 line 560 保持一致）
  // Java/Python 等语言的 package-level 图表 needsModuleGraph 可能为 true，但不应调用 TypeScriptPlugin
  if opts.needsModuleGraph AND (diagram.language is undefined OR diagram.language === 'typescript'):
    // 路径 A：检查磁盘缓存，否则走 TypeScriptPlugin
    files = await fileDiscovery.discoverFiles(...)
    // files.length > 0 守卫与原代码 line 569 保持一致：空文件列表时禁用磁盘缓存
    // （TypeScriptPlugin 可自行发现文件，但空列表会使 computeKey 语义不确定）
    diskKey = (diskCacheEnabled AND files.length > 0) ? await diskCache.computeKey(files) : null
    cached = diskKey ? await diskCache.get(diskKey) : null
    if cached:
      // 注：路径 A 磁盘命中后不调用 cacheArchJson——与当前代码行为（line 582）保持一致。
      // groupDiagramsBySource 保证每个 source key 在单次运行内只被 get() 一次，
      // 故路径 A 磁盘命中后内存缓存未更新不影响正确性（不会有第二次命中同一 key 的调用）。
      return { archJson: cached, kind: 'parsed' }
    archJson = await registerDeferred(
      sources,
      parseTsPlugin(diagram).then(result => { if diskKey: diskCache.set(diskKey, result); return result })
    )
    return { archJson, kind: 'parsed' }

  else:
    // 路径 B：先检查父级覆盖；无父级时做文件发现 + 磁盘缓存 + ParallelParser
    { deferred, normParentPath } = findParentCoverage(sources)
    if deferred:
      parent = await deferred
      return { archJson: deriveSubModuleArchJSON(parent, sources[0], normParentPath), kind: 'derived' }
    elif normParentPath:
      parentKey = archJsonPathIndex.get(normParentPath)
      parent = archJsonCache.get(parentKey)
      return { archJson: deriveSubModuleArchJSON(parent, sources[0], normParentPath), kind: 'derived' }
    else:
      // 无父级：发现文件、校验、查磁盘缓存、解析
      files = await fileDiscovery.discoverFiles(...)
      if files.length === 0: throw Error(...)          // 仅在无父级时校验（见"语义变更说明"）
      diskKey = diskCacheEnabled ? await diskCache.computeKey(files) : null
      diskCached = diskKey ? await diskCache.get(diskKey) : null
      if diskCached:
        cacheArchJson(sources, diskCached)             // 磁盘命中也写内存缓存
        return { archJson: diskCached, kind: 'parsed' }
      archJson = await parseWithParallelParser(diagram, files)   // 只负责解析
      if diskKey: await diskCache.set(diskKey, archJson)         // 写回磁盘缓存
      cacheArchJson(sources, archJson)
      return { archJson, kind: 'parsed' }
```

#### 缓存策略说明

**统一内存缓存检查**（伪代码步骤 ①）是对当前行为的**一处刻意优化**，不是原样迁移：

- 当前代码：Go 和 TS+moduleGraph 路径**不检查** `archJsonCache`；只有 TS 通用路径检查（第 613 行）
- 重构后：所有路径在入口统一检查

**此优化是安全的，理由有两层：**

首先，`archJsonCache` 中存储的**只有真实 parse 结果**，从不存储 derived ArchJSON——C++ 和 TS 通用路径的 deferred/normParentPath 分支直接 return，不调用 `cacheArchJson`。因此统一缓存检查返回 `kind: 'parsed'` 永远正确。

其次，不存在"不含 moduleGraph 的 TS 结果被 TS+moduleGraph 路径命中"的场景：`groupDiagramsBySource()` 按 source key 分组，同一 source key 在单次运行内由 `needsModuleGraph` 决定只走一条路径（A 或 B）。路径 B 写入 `archJsonCache` 的结果不可能在路径 A 的入口被命中，因为两条路径不会对同一 source key 在同一进程内先后执行。

---

### 二、`DiagramOutputRouter`

负责"给定**已聚合**的 ArchJSON + DiagramConfig，写出最终产物文件"，无解析状态。

```typescript
// src/cli/processors/diagram-output-router.ts

/**
 * 与 OutputPathResolver.resolve() 返回值结构对齐的路径类型。
 * 若 OutputPathResolver 已导出此类型，则直接复用；否则在此处定义。
 */
export type OutputPaths = { paths: { json: string; mmd: string; png: string; svg: string } };

export interface OutputRouterOptions {
  globalConfig: GlobalConfig;
  progress: ProgressReporter;   // 用于 MermaidDiagramGenerator(globalConfig, progress)
}

export class DiagramOutputRouter {
  private readonly globalConfig: GlobalConfig;
  private readonly progress: ProgressReporter;

  constructor(options: OutputRouterOptions) { ... }

  /**
   * 统一输出入口。
   *
   * 接收已经过 aggregator.aggregate() 处理的 ArchJSON（聚合发生在
   * DiagramProcessor.processDiagramWithArchJSON() 中，早于此调用）。
   *
   * 路由规则（按优先级）：
   * 1. format === 'json' → 直接写出 JSON 文件，返回（不进入 mermaid 分支）
   * 2. format === 'mermaid'，路由依据为 **ArchJSON extensions 和 archJSON.language**
   *    （不是 diagram.language——language 信息已内嵌到 ArchJSON 中）：
   *    - archJSON.extensions?.goAtlas 存在                              → generateAtlasOutput()
   *    - level==='package' && archJSON.extensions?.tsAnalysis?.moduleGraph → generateTsModuleGraphOutput()
   *    - level==='package' && archJSON.language==='cpp'                 → generateCppPackageOutput()
   *    - 其余                                                           → generateDefaultOutput()
   *
   * @param archJSON - 已聚合的 ArchJSON（含 metrics 字段，extensions 必须完整保留）
   * @param paths    - OutputPathResolver.resolve() 的返回值
   * @param diagram  - 原始 DiagramConfig（提供 format、level、languageSpecific 等）
   * @param pool     - 可选 Worker Pool，生命周期由 DiagramProcessor 管理，此处不存储
   */
  async route(
    archJSON: ArchJSON,
    paths: OutputPaths,
    diagram: DiagramConfig,
    pool: MermaidRenderWorkerPool | null
  ): Promise<void> { ... }

  // 以下从 DiagramProcessor 迁移；generateOutput() 重命名为 generateDefaultOutput()
  // 以区分"公开入口 route()"与"标准 classDiagram 的具体实现"
  private async generateDefaultOutput(
    archJSON: ArchJSON,
    paths: OutputPaths,
    format: OutputFormat,
    level: DetailLevel,
    diagram: DiagramConfig,
    pool: MermaidRenderWorkerPool | null
  ): Promise<void> { ... }

  private async generateAtlasOutput(
    archJSON: ArchJSON,
    paths: OutputPaths,
    diagram: DiagramConfig,
    pool: MermaidRenderWorkerPool | null
  ): Promise<void> { ... }

  private async generateTsModuleGraphOutput(
    archJSON: ArchJSON,
    paths: OutputPaths,
    _diagram: DiagramConfig,
    pool: MermaidRenderWorkerPool | null
  ): Promise<void> { ... }

  private async generateCppPackageOutput(
    archJSON: ArchJSON,
    paths: OutputPaths,
    pool: MermaidRenderWorkerPool | null
  ): Promise<void> { ... }

  /**
   * 新增：从 globalConfig 构造 IsomorphicMermaidRenderer 初始化选项。
   * 消除三个 generate* 方法中完全相同的 8–10 行重复代码。
   *
   * 实现合约（不可简化为直接透传 theme 字段）：
   *   theme: string  → { name: theme }  // IsomorphicMermaidRenderer 期望对象格式，不接受裸字符串
   *   theme: object  → 原样传入
   *   theme: undefined → 不设置 theme 键（使用渲染器默认值）
   *   transparentBackground: true  → backgroundColor = 'transparent'
   *   transparentBackground: false/undefined → 不设置 backgroundColor 键
   * 直接透传原始字符串会导致 IsomorphicMermaidRenderer 忽略主题配置，静默使用默认主题。
   */
  private buildRendererOptions(): Record<string, unknown> { ... }
}
```

**关键约束**：
- `route()` 接收的是**已聚合**的 ArchJSON，`aggregator.aggregate()` 在上游 `processDiagramWithArchJSON` 中已完成
- 聚合后的 ArchJSON 必须保留 `extensions`（goAtlas、tsAnalysis 等）以供路由判断
- Worker Pool 以参数传入，不在此类中存储或管理生命周期

---

### 三、重构后的 `DiagramProcessor`（薄协调层，≤350 行）

```typescript
// src/cli/processors/diagram-processor.ts（重构后）

export class DiagramProcessor {
  private readonly diagrams: DiagramConfig[];
  private readonly globalConfig: GlobalConfig;
  private readonly progress: ProgressReporter;
  private readonly aggregator: ArchJSONAggregator;
  private readonly metricsCalculator: MetricsCalculator;
  private parallelProgress?: ParallelProgressReporter;   // 懒初始化，非 readonly

  private readonly provider: ArchJsonProvider;
  private readonly outputRouter: DiagramOutputRouter;
  private readonly queryScopes = new Map<string, InternalQueryScope>();

  constructor(options: DiagramProcessorOptions) {
    this.provider = new ArchJsonProvider({
      globalConfig: options.globalConfig,
      parseCache: options.parseCache,
      registry: options.registry,
    });
    this.outputRouter = new DiagramOutputRouter({
      globalConfig: options.globalConfig,
      progress: options.progress,   // required: DiagramOutputRouter passes it to MermaidDiagramGenerator
    });
    // aggregator、metricsCalculator 留在此处，与 processDiagramWithArchJSON 同属
    ...
  }

  // 公开接口：签名不变
  async processAll(): Promise<DiagramResult[]> {
    // parallelProgress 懒初始化（diagrams.length > 1 时创建）
    // Worker Pool 生命周期（start / terminate in finally）
    // pMap over source groups → processSourceGroup
    // debug log: this.provider.cacheSize()
  }

  getQuerySourceGroups(): InternalQueryScope[] { ... }

  // ---- 内部 ----

  private groupDiagramsBySource(): Map<string, DiagramConfig[]> { ... }
  private hashSources(sources: string[]): string { ... }   // 见下方"技术债说明"
  private registerQueryScope(sources: string[], archJson: ArchJSON, kind: 'parsed' | 'derived'): void { ... }

  // sourceKey 由 processAll 的 pMap 解构传入，重构后在方法体内不再直接使用
  // （缓存查找已移入 ArchJsonProvider）。保留参数以维持与 processAll 的调用约定；
  // 若后续清理，可改为只在错误日志中使用。
  private async processSourceGroup(
    _sourceKey: string,
    diagrams: DiagramConfig[],
    pool: MermaidRenderWorkerPool | null
  ): Promise<DiagramResult[]> {
    // 注：当前代码在此处有一个 progress.start 调用（原 lines 491–494），
    // 在解析**之前**触发，用于单图场景的进度指示。重构后该调用不保留于此；
    // processDiagramWithArchJSON 内部已有 progress.start（解析**之后**触发）。
    // 净效果：单图运行时，解析阶段无进度提示（改为解析完成后才显示）。
    // 这是刻意接受的微小行为变更，不影响多图场景（多图走 parallelProgress）。
    try {
      // 计算 needsModuleGraph（必须从整个 group 推导，不能只看 firstDiagram）
      const needsModuleGraph = diagrams.some((d) => d.level === 'package');
      const firstDiagram = diagrams[0];

      const { archJson: rawArchJSON, kind } = await this.provider.get(firstDiagram, { needsModuleGraph });
      this.registerQueryScope(firstDiagram.sources, rawArchJSON, kind);

      return await pMap(
        diagrams,
        (diagram) => this.processDiagramWithArchJSON(diagram, rawArchJSON, pool),
        { concurrency: this.globalConfig.concurrency || os.cpus().length }
      );
    } catch (error) {
      // source group 级别的隔离：单组失败不影响其他组
      const errorMessage = error instanceof Error ? error.message : String(error);
      return diagrams.map((diagram) => ({ name: diagram.name, success: false, error: errorMessage }));
    }
  }

  private async processDiagramWithArchJSON(
    diagram: DiagramConfig,
    rawArchJSON: ArchJSON,
    pool: MermaidRenderWorkerPool | null
  ): Promise<DiagramResult> {
    // 1. aggregator.aggregate(rawArchJSON, diagram.level)
    // 2. metricsCalculator.calculate(aggregated, diagram.level)
    // 3. OutputPathResolver.resolve(...)
    // 4. outputRouter.route(aggregated+metrics, paths, diagram, pool)
    // 5. 进度上报（parallelProgress 或 progress）
    // 6. 构造并返回 DiagramResult
  }
}
```

---

## 数据流对比

### 重构前

```
processAll()
  └─ processSourceGroup(sourceKey, diagrams[], pool)    ← 全部逻辑集中在 958 行类中
       ├─ [TS/Go/C++ 解析 + 缓存（直接内联，217 行）]
       └─ pMap → processDiagramWithArchJSON()           ← 深埋其中，105 行
            ├─ aggregate / metrics / paths
            └─ generateOutput()
                 ├─ generateAtlasOutput()
                 ├─ generateTsModuleGraphOutput()
                 └─ generateCppPackageOutput()
```

### 重构后

```
processAll()                                    ← DiagramProcessor (≤350 行)
  └─ processSourceGroup(sourceKey, diagrams[], pool)
       ├─ needsModuleGraph = diagrams.some(...)  ← 在此计算，传给 provider
       ├─ provider.get(firstDiagram, {needsModuleGraph})  ← ArchJsonProvider (~350 行)
       │    ├─ ① 统一内存缓存检查
       │    ├─ go: parseGoProject()
       │    ├─ cpp: parseCppProject() 或 derive
       │    ├─ ts+mg: parseTsPlugin()           ← 路径 A（TypeScriptPlugin）
       │    └─ ts: parseWithParallelParser()    ← 路径 B（ParallelParser）
       ├─ registerQueryScope(sources, rawArchJSON, kind)
       └─ pMap → processDiagramWithArchJSON()   ← 留在 DiagramProcessor
            ├─ aggregate + metrics + paths
            └─ outputRouter.route(aggregated, paths, diagram, pool)
                 ├─ generateAtlasOutput()       ← DiagramOutputRouter (~230 行)
                 ├─ generateTsModuleGraphOutput()
                 ├─ generateCppPackageOutput()
                 └─ buildRendererOptions()      ← 消除重复
```

---

## 实现范围

### 新增文件

| 文件 | 说明 | 约估行数 |
|------|------|---------|
| `src/cli/processors/arch-json-provider.ts` | ArchJSON 获取、四路解析路由、多层缓存 | ~350 行 |
| `src/cli/processors/diagram-output-router.ts` | 输出格式生成（接收已聚合 ArchJSON） | ~230 行 |

### 修改文件

| 文件 | 变更说明 |
|------|---------|
| `src/cli/processors/diagram-processor.ts` | 从 958 行精简至 ≤350 行；构造时初始化两个新组件；`processSourceGroup` 计算 `needsModuleGraph` 后传给 provider；`archJsonCache.size` debug 日志改为 `provider.cacheSize()` |

### 不需修改

| 文件 | 原因 |
|------|------|
| `src/cli/commands/analyze.ts` | `DiagramProcessor` 外部接口不变 |
| `src/cli/query/query-artifacts.ts` | 无关 |
| 所有语言插件 | 不涉及 |
| 所有 `mermaid/` | 不涉及 |

### 细节处理

**`deriveSubModuleArchJSON`（模块级导出函数）**：移入 `arch-json-provider.ts`，在 `diagram-processor.ts` 中保留 re-export：
```typescript
export { deriveSubModuleArchJSON } from './arch-json-provider.js';
```
现有测试的 import 路径不变。

**`files.length === 0` 错误检查**：当前位于 `processSourceGroup` 第 608–610 行，在父级覆盖检查**之前**执行（先 discover → 先校验 → 再查父级）。迁移后移入 `get()` 的 TS 通用路径 else 分支（无父级覆盖时才执行），在父级覆盖检查**之后**。

这是一处**刻意的语义改进**：当源目录为空但存在父级覆盖时——
- 当前行为：抛出"No TypeScript files found"错误
- 重构后行为：成功从父级派生（`kind: 'derived'`），返回有效结果

对 C++ 子模块场景（sources 是父目录的子路径，本身无独立 `.ts` 文件）此改进尤为重要。实现时应在测试中明确覆盖此场景。

**`buildRendererOptions()` 提取**：三个 `generate*Output` 方法中完全相同的渲染选项构造逻辑（8–10 行）提取为 `DiagramOutputRouter` 私有方法，迁移时顺带完成。

---

## 迁移策略

建议采用"原地提取"（Extract Class）模式，分三步提交：

**Step 1**（提取 `ArchJsonProvider`）
- 将 `parseTsProject`（重命名为 `parseTsPlugin`）、`parseGoProject`、`parseCppProject`、`cacheArchJson`、`registerDeferred`、`findParentCoverage` 及对应字段剪切到 `ArchJsonProvider`
- 将 `processSourceGroup` 中内联的 `ParallelParser` 逻辑提取为 `parseWithParallelParser()`，将 `files.length === 0` 检查移入其中
- 同步移入 `deriveSubModuleArchJSON`，在原文件保留 re-export
- 实现 `get(diagram, opts)` 统一入口（`opts.needsModuleGraph` 替换当前各分支内联的 `needsModuleGraph` 判断）；保留原代码 line 560 的语言守卫：`needsModuleGraph` 路径 A 仅在 `diagram.language` 为 `'typescript'` 或未指定时触发，防止 Java/Python 等语言误走 TypeScriptPlugin
- `processSourceGroup` 改为：计算 `needsModuleGraph = diagrams.some(...)` → 调用 `provider.get(firstDiagram, { needsModuleGraph })` → `registerQueryScope` → `pMap`
- `processSourceGroup` 保留 catch 块（source group 级隔离保障）
- 确保所有现有测试通过后再进行下一步

**Step 2**（提取 `DiagramOutputRouter`）
- 将 4 个 `generate*Output` 方法剪切到 `DiagramOutputRouter`，提取 `buildRendererOptions()`
- 将原 `generateOutput()` 中的"标准 classDiagram"else 分支提取为私有方法 `generateDefaultOutput()`（重命名以避免与公开入口 `route()` 混淆）
- 实现 `route()` 入口：先处理 json 格式，再按 `archJSON.extensions` / `archJSON.language` / `level` 做 mermaid 路由（不依赖 `diagram.language`）
- `processDiagramWithArchJSON` 替换 `generateOutput()` 调用为 `this.outputRouter.route(...)`
- 确认 `route()` 接收的是已聚合、extensions 完整的 ArchJSON
- 确保所有现有测试通过后再进行下一步

**Step 3**（清理与补测试）
- 移除 `DiagramProcessor` 中已空的字段，更新构造函数
- 补充 `ArchJsonProvider` 和 `DiagramOutputRouter` 的独立单元测试文件

---

## 测试策略

### 现有测试（不应回归）

- `tests/unit/cli/processors/diagram-processor.test.ts` 中的所有用例
- `tests/integration/` 中依赖 `DiagramProcessor` 的集成测试

### 新增单元测试

**`ArchJsonProvider` 测试重点**：

| 场景 | 断言 |
|------|------|
| 内存缓存命中 | 无 parse 方法被调用 |
| Go：全新 source | `parseGoProject` 被调用；`kind === 'parsed'` |
| TS `needsModuleGraph=true`：磁盘缓存命中 | `parseTsPlugin` 未调用；内存缓存**不更新**（路径 A 磁盘命中不调用 `cacheArchJson`，与原代码行 582 行为一致） |
| TS `needsModuleGraph=true`：全新 source | `parseTsPlugin` 被调用；结果写入磁盘缓存 |
| TS `needsModuleGraph=false`：父级派生 | `parseWithParallelParser` 未调用；`kind === 'derived'` |
| TS `needsModuleGraph=false`：磁盘缓存命中 | `parseWithParallelParser` 未调用；内存缓存更新；`kind === 'parsed'` |
| TS `needsModuleGraph=false`：全新 source | `parseWithParallelParser` 被调用；结果写磁盘缓存；`kind === 'parsed'` |
| TS `needsModuleGraph=false`：空文件列表，无父级 | `get()` 在 else 分支抛出错误 |
| TS `needsModuleGraph=false`：空文件列表，有父级覆盖 | 成功派生；`kind === 'derived'`；不抛出错误（语义改进场景） |
| cpp：全新 source，无父级 | `parseCppProject` 被调用 |
| cpp：父级解析中（deferred） | 等待父级后派生；`kind === 'derived'` |
| 并发相同 source | 只发起一次 parse（`registerDeferred` 去重） |

**`DiagramOutputRouter` 测试重点**：

| 场景 | 断言 |
|------|------|
| `extensions.goAtlas` 存在 | 调用 `generateAtlasOutput` |
| `extensions.tsAnalysis.moduleGraph` 存在 + `level === 'package'` | 调用 `generateTsModuleGraphOutput` |
| `language === 'cpp'` + `level === 'package'` | 调用 `generateCppPackageOutput` |
| JSON 格式 | 写出 `arch.json`；不调用 mermaid renderer |
| Worker Pool 存在 | pool 参数透传到 renderer；不在 router 内存储 |
| `buildRendererOptions` | theme 和 backgroundColor 从 globalConfig 正确映射 |

---

## 风险与约束

| 风险 | 说明 | 缓解措施 |
|------|------|---------|
| `parseTsProject` 重命名为 `parseTsPlugin` | 私有方法，无外部调用，可安全重命名；若现有测试通过 spy 依赖方法名需同步更新 | Step 1 时检查所有测试文件 |
| `findParentCoverage` 返回类型 | 函数本身不返回 null，属性可为 null——迁移时保持原签名不变 | `ArchJsonProvider` 中原样保留 |
| `ArchJsonDiskCache` 与 `ParseCache` 归属 | 随 `ArchJsonProvider` 一同迁移 | 从 `DiagramProcessorOptions` 透传至 `ArchJsonProviderOptions` |
| 统一内存缓存检查的行为变更 | 对 Go 和 TS+moduleGraph 路径新增内存缓存命中路径；安全边界见上方"缓存策略说明" | Step 1 后运行完整测试套件验证 |
| `files.length === 0` 的语义变更 | 重构后检查移至"无父级覆盖"分支内，有父级时不再抛出（改为派生）；见上方"细节处理"说明 | Step 1 时补充测试用例：空源目录 + 父级覆盖场景 |
| 聚合后 ArchJSON 的 extensions 完整性 | `route()` 依赖 `extensions.goAtlas` / `extensions.tsAnalysis.moduleGraph` 判断路由；若 `aggregator` 不保留 extensions，路由会静默失效 | Step 2 前确认 `ArchJSONAggregator.aggregate()` 保留 extensions；若否，需先修复 aggregator |

### 技术债说明：`hashSources` 双份副本

`ArchJsonProvider` 和 `DiagramProcessor` 各自需要一份 `hashSources()`（逻辑完全相同：sorted sources 的 SHA-256 前 8 位）。两处用途在概念上相同（均为 source 路径集合的稳定 key），未来若实现不同步将引入隐患。

本次接受双份副本以避免引入跨模块依赖，但**这是明确的技术债**，应在后续 PR 中提取到 `src/cli/processors/utils.ts` 统一。

---

## 验收标准

1. `DiagramProcessor` 代码行数 ≤ 350 行
2. `processAll()` / `getQuerySourceGroups()` 签名不变；`analyze.ts` 零改动
3. `deriveSubModuleArchJSON` 从 `diagram-processor.ts` 的 import 路径不变（re-export 保证）
4. `ArchJsonProvider` 和 `DiagramOutputRouter` 各自有独立单元测试文件
5. 现有 2165+ 测试全部通过，`npm run type-check` 零错误
6. 自我验证：`node dist/cli/index.js analyze -v` 在重构前后输出相同的图表产物

---

## 开放问题

| 问题 | 说明 | 建议时机 |
|------|------|---------|
| `hashSources` 统一到公共 utils | 两份副本是已知技术债 | 后续独立 PR |
| `ArchJsonProvider.cacheSize()` 是否只为 debug | 当前仅服务于 `ArchGuardDebug` 日志；若日志价值不高，可直接删除 | Step 1 时决策 |
| `processDiagramWithArchJSON` 是否进一步拆分 | 当前承担聚合+metrics+paths+routing+progress+结果构造；如未来聚合层有独立需求可再提取 | 后续独立提案 |
| `OutputPaths` 类型是否在 `OutputPathResolver` 侧导出 | 目前以内联匿名类型使用；引入 `DiagramOutputRouter` 后值得统一命名 | Step 2 时决策 |
| `ArchJSONAggregator` 是否保留 extensions | `route()` 路由判断依赖 extensions 存在；需在 Step 2 前确认 | Step 2 前确认 |
