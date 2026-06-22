# Proposal: QueryEngine God Object 拆分 — 按查询域分解为专职服务

## Background

`src/core/query/query-engine.ts` 目前暴露 **25 个公有方法**，跨越五个不同的查询域：实体搜索（findEntity、findByType、findByAttr、findByTypeAndAttr、getFileEntities）、图遍历（getDependencies、getDependents、findImplementers、findSubclasses、findCallers）、指标与结构发现（findHighCoupling、findOrphans、findInCycles、getCycles、getSummary、getPackageStats、getPackageCoverage、getEntityCoverage）、测试覆盖（getTestAnalysis、hasTestAnalysis）以及扩展数据访问（getAtlasLayer、hasAtlasExtension、getScopeEntry、applyOutputOptions、toSummary）；另有 1 个私有方法 bfs。

这种聚合造成三类维护负担：

1. **测试隔离困难**：为实体搜索写单元测试时必须构造含完整 archIndex、extensionAccessor 和 metrics 的 QueryEngine 实例，即便被测方法完全不依赖后两者。
2. **依赖耦合风险**：任何新的查询域（如未来的 Git 历史查询）都被迫注入到已经臃肿的 QueryEngine，进一步提高了 outDegree。
3. **变更扩散**：每次调整测试覆盖逻辑或指标聚合算法，都需要修改和重测整个 QueryEngine，而不是只影响对应的服务类。

当前 `ArchMetrics`（567 行）和 `EntityQueryService`（80 行）已经是上一轮拆分（Phase 96/110）的产物，说明方向正确，但 `QueryEngine` 本身仍持有大量直接路由逻辑，是外部调用者（MCP server、CLI query command）的唯一门面，导致它依然承担过多职责。

## Goals

1. QueryEngine 的公有方法数量从 25 降至不超过 8 个（仅保留组合/路由方法：applyOutputOptions、getScopeEntry、toSummary 及必要的门面转发）；可通过 `grep -cP "^  [a-z][a-zA-Z]+\(" src/core/query/query-engine.ts` 验证（当前基线返回 25，含 constructor 1 个、不含泛型方法 getAtlasLayer；实际公有方法共 25 个，目标不超过 8）。
2. 图遍历逻辑（getDependencies、getDependents、findImplementers、findSubclasses、findCallers、bfs）迁移到独立的 `RelationQueryService` 类；可通过 `grep -l "bfs\|findCallers" src/core/query/` 验证其唯一位置。
3. 扩展数据访问方法（getAtlasLayer、hasAtlasExtension、getTestAnalysis、hasTestAnalysis）从 QueryEngine 公有接口中移除，调用方改为直接使用 `ExtensionAccessor`；可通过 `grep "engine\.getAtlasLayer\|engine\.hasAtlas" src/` 验证调用点为零。
4. 现有全部 MCP 工具和 CLI `query` 命令的对外行为不变；可通过 `npm test` 全量通过（当前基线：3969 个测试）验证。
5. 各新服务类可在不构造 QueryEngine 的前提下独立单测；可通过新增的隔离单测文件（不 import QueryEngine）验证。

## Proposed Approach

**服务拆分方案**

将 QueryEngine 当前的职责分配给以下四个专职服务，QueryEngine 退化为薄门面层：

- **`EntityQueryService`**（已存在，扩展）：承接 findEntity、findByType、findByAttr、findByTypeAndAttr、getFileEntities，以及 `getById` 供内部使用。当前实现已具备此能力，无需新建类。
- **`RelationQueryService`**（新建）：承接所有图遍历方法——getDependencies、getDependents、findImplementers、findSubclasses、findCallers，以及私有 bfs 方法。构造函数接收 `ArchJSON` + `ArchIndex`，与 EntityQueryService 平级。
- **`ArchMetrics`**（已存在，保持稳定）：保留 findHighCoupling、findOrphans、findInCycles、getCycles、getSummary、getPackageCoverage、getEntityCoverage、getPackageStats。
- **`ExtensionAccessor`**（已存在，升级为一等公民）：getAtlasLayer、hasAtlasExtension、getTestAnalysis、hasTestAnalysis 从 QueryEngine 移除后，由 MCP server 和 CLI 直接持有 ExtensionAccessor 实例访问，或通过 loadEngine 返回的结构体（见下文）。

**门面与加载层调整**

`loadEngine` 目前返回 `QueryEngine` 单一对象。调整后返回一个结构体 `QueryContext`（包含 engine、extensionAccessor、scopeEntry），调用方按需取用，减少通过 QueryEngine 转发的必要性。QueryEngine 自身保留 `applyOutputOptions`、`toSummary`、`getScopeEntry` 以及必要的组合方法（如 getCycles 直接读 index），其余方法全部委托给对应服务。

**迁移策略**

采用渐进替换：先新建 RelationQueryService 并配套单测，再将 QueryEngine 内的实现替换为委托调用，最后更新 MCP server 和 CLI query command 的调用点，将 hasAtlasExtension 等调用改为 extensionAccessor 直接访问。全程保持 CLI/MCP 接口签名不变，单测基线不回退。

## Trade-offs and Risks

**不做的事**：本次不拆分 ArchMetrics 内部的多语言分支（Go Atlas / TypeScript / OO Fallback / Kotlin）——该类的多分支复杂度是业务需要，不是职责混乱，留待后续专项优化。

**已知风险**：

- `applyOutputOptions` 目前被 QueryEngine、MCP server、CLI 三处使用，提取为独立函数后需确认 tree-shaking 不引入循环依赖。
- `loadEngine` 返回类型变更为 `QueryContext` 会影响所有调用方：当前 mcp-server.ts 中有 10 处 `await loadEngine(...)` 调用，query.ts 中有 1 处，call-graph-tools.ts 中有 1 处，test-analysis-tools.ts 中有 4 处，atlas-analytics-tools.ts 中有 3 处，共 **19 处调用点**需同步修改（5 个文件），否则会有瞬态类型错误。
- 部分集成测试直接 `new QueryEngine(...)` 构造对象，迁移后若测试直接使用 RelationQueryService，需更新测试工厂函数。

**备选方案**：维持现状，仅在 QueryEngine 顶部增加分区注释（Region 注释）。该方案无任何测试隔离收益，且随功能增长问题持续恶化，已被否定。
