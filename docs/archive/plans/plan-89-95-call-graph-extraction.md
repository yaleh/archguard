# Plan 89-95 — Call Graph Extraction（方法级调用边）

> Proposal: `docs/proposals/proposal-call-graph-extraction.md`
> Status: **DRAFT**
> 前置依赖: Plan 82-88（`outputScope` 和 `applyOutputOptions` 已实现）
> 涉及 ADR: ADR-002（ArchJSON extensions）、ADR-006（MCP Tool 设计规范）、ADR-007（CLI/MCP 接口一致性）

---

## 总览

| Phase | 内容 | 依赖 | 预计改动量 |
|---|---|---|---|
| 89 | Schema 扩展：`RelationType += 'call'`；`Relation` 新增方法级字段；`inferenceSource` 扩展 | 无 | ~60 行 |
| 90 | OutputScope call 边过滤/聚合：`filterRelationsForScope()` + Mermaid generator 显式过滤 | Phase 89 | ~120 行 |
| 91 | Go Phase A：`mapCallRelations(flowGraph)` + `index.ts` 追加调用 | Phase 89、90 | ~130 行 |
| 92 | TypeScript Phase B：新建 `CallEdgeExtractor` + `parseProject()` 集成 | Phase 89、90 | ~200 行 |
| 93 | `archguard_find_callers` MCP 工具 + CLI `--callers` flag | Phase 90 | ~200 行 |
| 94 | Java Phase C（OPTIONAL）：tree-sitter 方法体遍历 | Phase 89、90 | ~180 行 |
| 95 | Python Phase C（OPTIONAL）：tree-sitter call 节点遍历 | Phase 89、90 | ~150 行 |

**总改动量估算（Phase 89-93 核心）**：约 710 行（含测试，排除空行和注释头）。各 Phase ≤500 行，各 Stage ≤200 行。

**测试策略（TDD）**：每个 Phase 先写失败测试，再实现，再运行确认全绿。目标覆盖率 ≥80%。使用 vitest，测试文件置于对应 `tests/unit/` 子目录。

---

## Phase 89 — Schema 扩展

**目标**：最小破坏性地扩展类型定义，建立后续所有 Phase 的类型基础。本 Phase 不包含任何功能实现，不改变运行时行为。

**依赖**：无前置 Phase。

**修改文件**：
- `src/types/index.ts`（`RelationType`、`Relation`、`inferenceSource`）

**测试文件（先写）**：
- `tests/unit/types/relation-schema.test.ts`（新增）

---

### Stage 89.1 — `RelationType` 扩展（~15 行）

**修改**：`src/types/index.ts`，在 `RelationType` union 末尾追加 `'call'`：

```typescript
export type RelationType =
  | 'inheritance'
  | 'implementation'
  | 'composition'
  | 'aggregation'
  | 'dependency'
  | 'association'
  | 'call';              // 方法级调用边
```

**影响评估**：
- `src/mermaid/generator.ts:591` 和 `src/mermaid/generator-formatting.ts:152` 的 switch 均带 `default` 兜底，`'call'` 边会被静默渲染为 dependency 箭头——**此风险由 Phase 90 消除**。
- `src/types/metric-vector.ts` 和 `src/types/index.ts` 的 `Partial<Record<RelationType, number>>` 自动扩展，行为正确，无需额外处理。

**验收**：`npm run type-check` 通过；`'call'` 可赋值给 `RelationType` 变量。

---

### Stage 89.2 — `Relation` 接口扩展（~30 行）

**修改**：`src/types/index.ts`，在 `Relation` 接口中追加可选字段，并扩展 `inferenceSource` union：

```typescript
export interface Relation {
  id: string;
  type: RelationType;
  source: string;        // entity id（class 级，不变）
  target: string;        // entity id（class 级，不变）
  confidence?: number;
  inferenceSource?: 'explicit' | 'inferred' | 'gopls' | 'call-aggregated';  // 扩展
  // 以下字段仅在 type='call' 时有效
  sourceMethod?: string;    // 调用方方法名，e.g. "save"
  targetMethod?: string;    // 被调用方方法名，e.g. "invalidate"
  callType?: 'direct' | 'interface' | 'indirect';
}
```

**向后兼容**：所有新字段均为 `optional`，现有代码对 `Relation` 的读写无需修改。`inferenceSource: 'call-aggregated'` 解决了提案审查意见中的 🔴 问题 5。

**测试要求（先写）**：`tests/unit/types/relation-schema.test.ts`

- `type='call'` 时可赋值 `sourceMethod`/`targetMethod`/`callType`（TypeScript 编译通过即验证）
- `type='dependency'` 时 `sourceMethod` 为 undefined（运行时可选验证）
- `inferenceSource: 'call-aggregated'` 可赋值给 `Relation.inferenceSource`（编译时）
- `callType: 'indirect'` 可赋值（编译时）

**验收**：`npm run type-check` 通过；测试全绿。

---

### Stage 89.3 — 向后兼容文档与注释（~15 行）

**修改**：在新字段上方添加 JSDoc 注释，说明字段的生效条件和精度限制：

```typescript
/**
 * Method-level call edge fields. Only populated when type === 'call'.
 * Precision by language:
 *   TypeScript ~85% (TypeChecker-resolved, parseProject() path only)
 *   Go         ~90% (gopls-assisted, entry-point-reachable paths only)
 *   Java       ~60% (tree-sitter heuristic, Phase 94)
 *   Python     ~40% (duck-typed indirect, Phase 95)
 */
sourceMethod?: string;
targetMethod?: string;
callType?: 'direct' | 'interface' | 'indirect';
```

**验收**：`npm run type-check` 通过；`npm run lint` 无 error。

---

## Phase 90 — OutputScope call 边过滤 + Mermaid 显式过滤

**目标**：防止 call 边污染现有 class 图输出和 Mermaid 渲染器，并实现 class scope 下的 call→dependency 聚合。

**依赖**：Phase 89（`Relation.type: 'call'` 和 `inferenceSource: 'call-aggregated'` 已定义）。

**修改文件**：
- `src/core/query/query-engine.ts`（新增 `filterRelationsForScope()`，扩展 `applyOutputOptions`）
- `src/mermaid/generator-formatting.ts`（`generateRelationLine` 显式过滤 `'call'`）
- `src/mermaid/generator.ts`（`generateRelationLine` 调用处的 relation 过滤）

**测试文件（先写）**：
- `tests/unit/core/query/call-edge-filter.test.ts`（新增）
- `tests/unit/mermaid/generator-call-edge.test.ts`（新增）

---

### Stage 90.1 — `filterRelationsForScope()` 实现（~80 行）

**修改**：`src/core/query/query-engine.ts`，在 `applyOutputOptions` 方法之前新增私有方法：

```typescript
/**
 * Filter/aggregate call edges based on outputScope.
 *
 * - 'package': discard all call edges (package-level deps already cover this)
 * - 'class':   aggregate call edges into dependency edges (one per source/target pair)
 *              skipping pairs already covered by existing dependency relations
 * - 'method':  preserve all call edges with sourceMethod/targetMethod fields
 */
private filterRelationsForScope(relations: Relation[], scope: OutputScope): Relation[] {
  if (scope === 'package') {
    return relations.filter(r => r.type !== 'call');
  }
  if (scope === 'class') {
    const callEdges    = relations.filter(r => r.type === 'call');
    const nonCallEdges = relations.filter(r => r.type !== 'call');
    const existingDeps = new Set(
      nonCallEdges
        .filter(r => r.type === 'dependency')
        .map(r => `${r.source}:${r.target}`)
    );
    const aggregated: Relation[] = [];
    const seen = new Set<string>();
    for (const edge of callEdges) {
      const key = `${edge.source}:${edge.target}`;
      if (!existingDeps.has(key) && !seen.has(key)) {
        seen.add(key);
        aggregated.push({
          id: `call-aggregated:${edge.source}:${edge.target}`,
          type: 'dependency',
          source: edge.source,
          target: edge.target,
          inferenceSource: 'call-aggregated',
        });
      }
    }
    return [...nonCallEdges, ...aggregated];
  }
  return relations;  // 'method': preserve all
}
```

在 `applyOutputOptions` 中调用 `filterRelationsForScope`，让 `serialize()` 收到正确的 relations：

```typescript
// 在 narrowed = narrowEntities(...) 之后、serialize() 之前
const filteredRelations = this.filterRelationsForScope(this.archJson.relations, scope);
if (format === 'edge-list') {
  return serialize(narrowed, filteredRelations, scope);
}
return narrowed;
```

**测试要求（先写）**：`tests/unit/core/query/call-edge-filter.test.ts`

- `scope='package'`：call 边被丢弃，非 call 边保留
- `scope='class'`：call 边聚合为 dependency，已有 dependency 不重复
- `scope='class'`：同 source+target 的多条 call 边只产生一条聚合 dependency
- `scope='method'`：全量 call 边保留（含 sourceMethod/targetMethod）
- 边界：无 call 边时，`scope='class'` 返回原 relations 不变
- 回归：非 call 边在所有 scope 下均保留

**验收**：测试全绿；`npm run type-check` 通过。

---

### Stage 90.2 — Mermaid generator 显式过滤（~40 行）

**问题**：`src/mermaid/generator-formatting.ts:generateRelationLine()` 的 `default` 分支会将 `'call'` 边静默渲染为 `source --> target` 箭头，污染类图。

**修改**：`src/mermaid/generator-formatting.ts`，在 switch 顶部插入显式返回：

```typescript
export function generateRelationLine(
  relation: Relation,
  entityIdToName: Map<string, string>
): string | null {                           // 返回类型改为 string | null
  if (relation.type === 'call') return null; // call 边不渲染到 Mermaid 类图

  const resolve = (id: string): string => ...
  switch (relation.type) {
    ...
    default:
      return `${source} --> ${target}`;
  }
}
```

**修改**：`src/mermaid/generator.ts`（调用 `generateRelationLine` 的两处），在推入结果数组前过滤 null：

```typescript
const line = generateRelationLine(relation, entityIdToName);
if (line !== null) {
  lines.push(line);
}
```

若 `generator.ts` 中 `generateRelationLine` 调用处已是 `.map().filter(Boolean)` 链式调用，则只需确保过滤 null/undefined 即可，改动量更小。

**测试要求（先写）**：`tests/unit/mermaid/generator-call-edge.test.ts`

- `generateRelationLine({ type: 'call', ... })` 返回 `null`
- `generateRelationLine({ type: 'dependency', ... })` 返回非 null 字符串
- Mermaid class diagram 输出不含 `call` 边生成的箭头（端到端 fixture 验证）

**验收**：测试全绿；`npm run type-check` 通过；`npm run lint` 无 error。

---

## Phase 91 — Go Phase A（FlowGraph CallEdge → ArchJSON Relation）

**目标**：将 Go Atlas FlowGraph 中的调用边映射到 ArchJSON `relations`，实现 Go call graph 的首个语言支持。

**依赖**：Phase 89（`Relation` 接口），Phase 90（call 边过滤已就位，不会污染现有输出）。

**修改文件**：
- `src/plugins/golang/archjson-mapper.ts`（新增 `mapCallRelations(flowGraph)` 方法）
- `src/plugins/golang/index.ts`（在 atlas 构建完成后调用 `mapCallRelations`）

**测试文件（先写）**：
- `tests/unit/plugins/golang/archjson-mapper-call-edges.test.ts`（新增）

---

### Stage 91.1 — `mapCallRelations()` 方法（~80 行）

**修改**：`src/plugins/golang/archjson-mapper.ts`，在 `ArchJsonMapper` 类中新增公开方法。

**注意（来自审查意见 🔴 问题 2）**：`CallEdge.from` 是 handler 全名（如 `"api.handleUser"`），`to` 可能是多级路径（如 `"svc.store.Save"`）。正确解析：

```typescript
/**
 * Map FlowGraph call chains to Relation[] (type='call').
 * Only covers entry-point-reachable call paths.
 * Precision ~90% for gopls-resolved paths; incomplete for non-entry functions.
 */
public mapCallRelations(flowGraph: FlowGraph | undefined): Relation[] {
  if (!flowGraph) return [];
  const relations: Relation[] = [];
  const seen = new Set<string>();

  for (const chain of flowGraph.callChains) {
    for (const edge of chain.calls) {
      // from: last '.' component = function name; prefix = package/receiver
      const fromParts    = edge.from.split('.');
      const sourceMethod = fromParts.at(-1) ?? edge.from;
      const sourceClass  = fromParts.slice(0, -1).join('.');

      // to: same pattern
      const toParts      = edge.to.split('.');
      const targetMethod = toParts.at(-1) ?? edge.to;
      const targetClass  = toParts.slice(0, -1).join('.');

      // Skip stdlib/external (no package prefix = likely external)
      if (!sourceClass || !targetClass) continue;

      const id = `call:${edge.from}:${edge.to}`;
      if (seen.has(id)) continue;
      seen.add(id);

      relations.push({
        id,
        type: 'call',
        source: sourceClass,          // package/receiver path
        target: targetClass,
        sourceMethod,
        targetMethod,
        callType: edge.type === 'indirect' ? 'interface' : edge.type,
        confidence: edge.confidence,
        inferenceSource: 'gopls',
      });
    }
  }
  return relations;
}
```

**注意（来自审查意见 🔵 风险 2）**：Go 的 `ClassifyCallType` 实际只产生 `'direct'` 和 `'interface'`，`'indirect'` 在定义中存在但不产生。此处将 `'indirect'` 映射为 `'interface'` 作为保守处理，并在注释中说明。

**测试要求（先写）**：`tests/unit/plugins/golang/archjson-mapper-call-edges.test.ts`

- fixture `FlowGraph` 含 1 条 callChain、2 条 CallEdge → `mapCallRelations` 返回 2 条 `type='call'` 关系
- `edge.from = "api.handleUser"`：`sourceMethod = "handleUser"`，`source = "api"`
- `edge.to = "svc.store.Save"`：`targetMethod = "Save"`，`target = "svc.store"`
- 重复 edge（same from/to）只生成 1 条 relation（dedup）
- 缺少包前缀的边（`edge.from = "main"`）跳过（不生成 relation）
- `flowGraph = undefined` 返回空数组
- `inferenceSource === 'gopls'`；`callType` 值来自 `edge.type`

**验收**：测试全绿；`npm run type-check` 通过。

---

### Stage 91.2 — `index.ts` 调用集成（~50 行）

**问题（来自审查意见 🔴 问题 1）**：`mapRelations()` 在 `atlas` 异步构建完成之前调用，FlowGraph 不可用。正确位置是 atlas 构建返回后追加。

**修改**：`src/plugins/golang/index.ts`，在 `parseProject`（返回 ArchJSON 的方法）中，atlas 构建完成之后：

```typescript
// 现有代码（约 line 392）：
const atlas = await this.buildAtlasFromRawData(workspaceRoot, rawData, { ... });

// 新增：将 FlowGraph 调用边追加到 relations
const callRelations = this.mapper.mapCallRelations(atlas?.layers?.flow);

return {
  ...baseArchJSON,
  relations: [...baseArchJSON.relations, ...callRelations],
  extensions: { goAtlas: atlas },
};
```

**注意**：`atlas?.layers?.flow` 使用可选链，若 atlas 未构建 FlowGraph（无入口点）则返回空数组，不影响现有行为。

**测试要求（扩展现有 Go plugin 集成测试）**：
- 有入口点的 Go fixture → ArchJSON relations 中含 `type='call'` 的边
- 无入口点的 Go fixture → relations 中无 `type='call'` 的边（行为与修改前一致）
- 现有 Go plugin 测试（`tests/unit/plugins/golang/`）全部通过（回归）

**验收**：测试全绿；`npm run type-check` 通过；`npm run build` 成功。

---

## Phase 92 — TypeScript Phase B（CallEdgeExtractor + parseProject 集成）

**目标**：通过 ts-morph TypeChecker 提取 TypeScript 项目的方法级调用边，仅在 `parseProject()` 路径（具备完整 TypeChecker）中运行。

**依赖**：Phase 89（`Relation` 接口），Phase 90（call 边过滤已就位）。

**新增文件**：
- `src/parser/call-edge-extractor.ts`

**修改文件**：
- `src/parser/typescript-parser.ts`（在 `parseProject()` 末尾调用 `CallEdgeExtractor`）

**测试文件（先写）**：
- `tests/unit/parser/call-edge-extractor.test.ts`（新增）

---

### Stage 92.1 — `CallEdgeExtractor` 类（~130 行）

**文件**：`src/parser/call-edge-extractor.ts`（新建）

**注意（来自审查意见 🔴 问题 3）**：不继承 `BaseExtractor`（后者使用 `useInMemoryFileSystem: true`，TypeChecker 无法解析类型）。`CallEdgeExtractor` 接收 `parseProject()` 传入的完整 `Project` 对象、已解析的实体集合和工作区根路径（用于将绝对路径转换为相对路径，与 `TypeScriptParser.parseProject()` 生成的 entity ID 格式一致）。

```typescript
import path from 'path';
import { Project, Node, SourceFile, SyntaxKind } from 'ts-morph';
import type { Relation, Entity } from '@/types/index.js';

export class CallEdgeExtractor {
  private projectEntityIds: Set<string>;

  constructor(
    private readonly project: Project,
    entities: Entity[],
    private readonly workspaceRoot: string   // 用于 absPath → relPath，与 TypeScriptParser 保持一致
  ) {
    // Build whitelist from project entity names for filtering stdlib/external calls
    this.projectEntityIds = new Set(entities.map(e => e.name));
  }

  extractAll(): Relation[] {
    const relations: Relation[] = [];
    const seen = new Set<string>();

    for (const sourceFile of this.project.getSourceFiles()) {
      relations.push(...this.extractFromFile(sourceFile, seen));
    }
    return relations;
  }

  /** Convert absolute path to relative path (matching TypeScriptParser.toRelPath). */
  private toRelPath(absPath: string): string {
    return path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/');
  }

  private extractFromFile(sourceFile: SourceFile, seen: Set<string>): Relation[] {
    const relations: Relation[] = [];
    const checker = this.project.getTypeChecker();
    // Use relative path so source entity IDs match the `${relPath}.${className}` format
    // produced by TypeScriptParser.parseProject().
    const relPath  = this.toRelPath(sourceFile.getFilePath());

    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName();
      if (!className) continue;

      for (const method of cls.getMethods()) {
        const methodName = method.getName();

        method.getBody()?.getDescendantsOfKind(SyntaxKind.CallExpression)
          .forEach(call => {
            const access = call.getExpression();
            if (!Node.isPropertyAccessExpression(access)) return;

            const receiverType = checker.getTypeAtLocation(access.getExpression());
            const targetClass  = receiverType.getSymbol()?.getName();
            if (!targetClass || !this.projectEntityIds.has(targetClass)) return;

            const targetMethod = access.getName();
            const id = `call:${relPath}.${className}.${methodName}:${targetClass}.${targetMethod}`;
            if (seen.has(id)) return;
            seen.add(id);

            // Determine callType via symbol flags
            const sym = receiverType.getSymbol();
            const isInterface = sym?.getDeclarations()
              .some(d => Node.isInterfaceDeclaration(d)) ?? false;

            relations.push({
              id,
              type: 'call',
              source: `${relPath}.${className}`,
              target: targetClass,
              sourceMethod: methodName,
              targetMethod,
              callType: isInterface ? 'interface' : 'direct',
              confidence: isInterface ? 0.6 : 0.85,
              inferenceSource: 'explicit',
            });
          });
      }
    }
    return relations;
  }
}
```

**测试要求（先写）**：`tests/unit/parser/call-edge-extractor.test.ts`

使用 ts-morph 的 `createProject()` + `addSourceFileAtPath`（或 `createSourceFile` 内存方式）构造 fixture；构造时传入 `workspaceRoot` 使相对路径可正确计算：

- 同文件两个 class，A.foo() 调用 B.bar()：产生 1 条 `type='call'` 关系，`sourceMethod='foo'`，`targetMethod='bar'`
- `source` entity ID 格式为 `${relPath}.A`（相对路径 + 类名），与 `TypeScriptParser` 一致
- 调用 `console.log`（非项目实体）：不产生 call 边（白名单过滤）
- 接收者为 interface 类型：`callType='interface'`，`confidence=0.6`
- 接收者为 class 实例：`callType='direct'`，`confidence=0.85`
- `inferenceSource === 'explicit'`
- 重复调用（同一 source+target+method pair）只产生 1 条 relation
- 无方法体（接口声明）：不产生 call 边

**验收**：测试全绿；`npm run type-check` 通过。

---

### Stage 92.2 — `parseProject()` 集成（~70 行）

**修改**：`src/parser/typescript-parser.ts`，在 `filterExternalRelations(merged)` 调用之后、`deduplicateRelations` 之前，追加 call 边提取：

```typescript
// 提取方法级调用边（仅在 parseProject 路径，fsProject 具备完整 TypeChecker）
// 传入 workspaceRoot（= rootDir）供 CallEdgeExtractor 将绝对路径转换为相对路径，
// 确保 source entity ID 格式与 TypeScriptParser.parseProject() 的 ${relPath}.${className} 一致。
const callEdgeExtractor = new CallEdgeExtractor(fsProject, entities, this.workspaceRoot ?? rootDir);
const callEdges = callEdgeExtractor.extractAll();

// Deduplicate relations（包含 call 边）
const uniqueRelations = this.deduplicateRelations([
  ...filtered.relations,
  ...callEdges,
]);
```

**性能注意（来自审查意见 🔵 风险 1）**：大型项目可能产生数万条 call 边。在此处加入边数量日志：

```typescript
if (callEdges.length > 5000) {
  console.warn(`[CallEdgeExtractor] Large call edge set: ${callEdges.length} edges. ` +
    `Consider call graph pruning for scope='class' output.`);
}
```

**测试要求**：在现有 `tests/unit/parser/typescript-parser.test.ts` 中新增分组：

- `parseProject()` 路径：返回 ArchJSON 中含 `type='call'` 的边
- `parseCode()` 路径：返回 ArchJSON 中无 `type='call'` 的边（call 边仅在 `parseProject` 生成）
- 现有 TypeScript parser 测试全部通过（回归）

**验收**：测试全绿；`npm run type-check` 通过；`npm run build` 成功。

---

## Phase 93 — `archguard_find_callers` MCP 工具 + CLI `--callers` flag

**目标**：基于 ArchJSON 中 `type='call'` 的边，提供"谁调用了这个实体/方法"的查询能力，支持传递追踪（BFS，depth 上限 5）。

**依赖**：Phase 90（call 边过滤，`scope='method'` 时 call 边全量可用）。

**新增文件**：
- `src/cli/mcp/tools/call-graph-tools.ts`

**修改文件**：
- `src/cli/mcp/mcp-server.ts`（注册 `registerCallGraphTools`）
- `src/cli/commands/query.ts`（新增 `--callers` flag）
- `src/core/query/query-engine.ts`（新增 `findCallers()` 方法）

**测试文件（先写）**：
- `tests/unit/core/query/find-callers.test.ts`（新增）
- `tests/unit/cli/mcp/call-graph-tools.test.ts`（新增）

---

### Stage 93.1 — `QueryEngine.findCallers()` 方法（~80 行）

**修改**：`src/core/query/query-engine.ts`，新增公开方法：

```typescript
/**
 * Find all callers of an entity or specific method using call edges (type='call').
 * Uses BFS traversal; detects cycles via visited set.
 *
 * @param entityName  Class name or 'ClassName.methodName'
 * @param depth       Max traversal depth (1 = direct callers only, max 5)
 * @returns Array of caller relation records with caller entity context
 */
findCallers(
  entityName: string,
  depth: number = 1
): Array<{ callerEntity: string; callerMethod: string; callType: string; depth: number }> {
  const maxDepth = Math.min(Math.max(depth, 1), 5);
  const [targetClass, targetMethod] = entityName.includes('.')
    ? entityName.split('.', 2)
    : [entityName, undefined];

  const callEdges = this.archJson.relations.filter(r => r.type === 'call');

  const result: Array<{
    callerEntity: string; callerMethod: string; callType: string; depth: number;
  }> = [];
  const visited = new Set<string>();
  const queue: Array<{ target: string; targetMethod?: string; currentDepth: number }> = [
    { target: targetClass, targetMethod, currentDepth: 1 },
  ];

  while (queue.length > 0) {
    const { target, targetMethod: tMethod, currentDepth } = queue.shift()!;
    if (currentDepth > maxDepth) continue;

    for (const edge of callEdges) {
      if (edge.target !== target) continue;
      if (tMethod && edge.targetMethod !== tMethod) continue;

      const callerKey = `${edge.source}.${edge.sourceMethod}@${currentDepth}`;
      if (visited.has(callerKey)) continue;
      visited.add(callerKey);

      result.push({
        callerEntity: edge.source,
        callerMethod: edge.sourceMethod ?? '',
        callType: edge.callType ?? 'direct',
        depth: currentDepth,
      });

      if (currentDepth < maxDepth) {
        queue.push({
          target: edge.source,
          targetMethod: edge.sourceMethod,
          currentDepth: currentDepth + 1,
        });
      }
    }
  }
  return result;
}
```

**测试要求（先写）**：`tests/unit/core/query/find-callers.test.ts`

- `depth=1`：只返回直接调用方
- `depth=2`：返回直接调用方 + 间接调用方（BFS 第 2 层）
- 循环调用（A→B→A）：不死循环（visited set 保护），每个节点只出现一次
- `entityName='ClassName.methodName'`：精确匹配 `targetMethod`
- `entityName='ClassName'`（无 methodName）：返回所有调用该 class 任意方法的调用方
- `depth=10`：被截断到 5
- 无 call 边时返回空数组
- `callType` 字段从边数据正确透传

**验收**：测试全绿；`npm run type-check` 通过。

---

### Stage 93.2 — `call-graph-tools.ts` MCP 工具（~80 行）

**文件**：`src/cli/mcp/tools/call-graph-tools.ts`（新建）

按照项目 MCP 注册模式（与 `test-analysis-tools.ts`、`git-history-tools.ts` 一致）：

```typescript
import path from 'path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadEngine } from '../../query/engine-loader.js';
import { resolveRoot } from '../mcp-server.js';

export function registerCallGraphTools(
  server: McpServer,
  defaultRoot: string
): void {
  server.tool(
    'archguard_find_callers',
    'Return direct and transitive callers of an entity or method using ' +
    'statically-extracted call edges. ' +
    'Precision varies by language: TypeScript ~85% (TypeChecker-resolved, ' +
    'parseProject() path only), Go ~90% (gopls-assisted, entry-point-reachable ' +
    'paths only), Java ~60% (tree-sitter heuristic, Phase 94), ' +
    'Python ~40% (duck-typed indirect, Phase 95). ' +
    'Dynamic dispatch, callbacks, and reflection are not resolved.',
    {
      entityName: z.string().describe(
        'Entity to find callers for. Format: "ClassName" or "ClassName.methodName"'
      ),
      depth: z.number().int().min(1).max(5).default(1).describe(
        'Traversal depth (1 = direct callers only, max 5)'
      ),
      projectRoot: z.string().optional().describe(
        'Project root directory. Defaults to CWD.'
      ),
    },
    async ({ entityName, depth, projectRoot }) => {
      // Follow project pattern from test-analysis-tools.ts:
      //   resolveRoot() normalises projectRoot vs defaultRoot → project root dir
      //   path.join(root, '.archguard') → archguard work dir
      //   loadEngine(archDir) → QueryEngine (pure in-memory; no static load() method)
      const root = resolveRoot(projectRoot, defaultRoot);
      const archDir = path.join(root, '.archguard');
      const engine = await loadEngine(archDir);
      const callers = engine.findCallers(entityName, depth);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ entityName, depth, callers }, null, 2),
        }],
      };
    }
  );
}
```

**修改**：`src/cli/mcp/mcp-server.ts`，在现有 `registerTestAnalysisTools` 调用之后追加：

```typescript
import { registerCallGraphTools } from './tools/call-graph-tools.js';
// 在 createMcpServer() 中：
registerCallGraphTools(server, defaultRoot);
```

**测试要求（先写）**：`tests/unit/cli/mcp/call-graph-tools.test.ts`

- 工具 schema：`entityName` 为必填 string
- 工具 schema：`depth` 默认值 1，最大值 5
- 工具 schema：`projectRoot` 为 optional
- handler：mock `loadEngine`（来自 `engine-loader`），验证 `entityName`/`depth` 正确传递给 `engine.findCallers`
- handler：返回值 JSON 含 `{ entityName, depth, callers }` 顶层结构

**验收**：测试全绿；`npm run type-check` 通过。

---

### Stage 93.3 — CLI `--callers` flag（~40 行）

**修改**：`src/cli/commands/query.ts`，新增 flag 和处理路径（与 `--output-scope` 对称，ADR-007 §4）：

在 `QueryOptions` 接口追加：
```typescript
callers?: string;     // 'ClassName' 或 'ClassName.methodName'
callersDepth?: number;
```

在 `createQueryCommand()` 追加：
```
.option('--callers <entity>', 'Find callers of entity or method (format: Class or Class.method)')
.option('--callers-depth <n>', 'Caller traversal depth (1-5, default: 1)', '1')
```

在 `queryHandler` 中处理：
```typescript
if (opts.callers) {
  const depth = parseInt(opts.callersDepth ?? '1', 10);
  const result = engine.findCallers(opts.callers, depth);
  console.log(JSON.stringify({ entityName: opts.callers, depth, callers: result }, null, 2));
  return;
}
```

**测试要求**：在现有 `tests/unit/cli/commands/query.test.ts` 新增分组：

- `--callers` 选项存在时调用 `engine.findCallers`
- `--callers-depth=3` 解析为 `depth=3`
- 缺少 `--callers` 时不触发 findCallers 路径（回归）

**验收**：测试全绿；`node dist/cli/index.js query --help` 含 `--callers` 选项。

---

## Phase 94 — Java Phase C（OPTIONAL）

> **状态**：OPTIONAL。仅在 Phase 89-93 完成且需要 Java call graph 时实施。

**目标**：通过 tree-sitter 遍历 Java `method_invocation` 节点，提取方法调用边（精度 ~60%）。

**依赖**：Phase 89（schema），Phase 90（call 边过滤）。

**修改文件**：
- `src/plugins/java/tree-sitter-bridge.ts`（新增 `extractMethodCalls()`）
- `src/plugins/java/archjson-mapper.ts`（在 `mapRelations()` 之后追加 call 边）

**测试文件（先写）**：
- `tests/unit/plugins/java/call-edge-extraction.test.ts`（新增）

**改动量**：~180 行（含测试）。

---

### Stage 94.1 — `extractMethodCalls()` 实现（~100 行）

在 `tree-sitter-bridge.ts` 的方法提取流程中，对 `method_declaration` 节点的 `block` 子树执行遍历，匹配 `method_invocation` 节点：

```
method_invocation
  ├── object: identifier / field_access  → 接收者
  └── name: identifier                   → 方法名
```

接收者类型解析策略：
1. 先查同类字段类型（`this.fieldType` map）
2. 查构造函数参数类型
3. 找不到时降级为 `confidence=0.5`，`source=当前class`，`target` 设为接收者变量名（尽力而为）

**测试要求**：
- `this.service.save()`：提取 `targetClass=Service`，`targetMethod=save`，前提是字段类型可解析
- `unknownVar.foo()`：产生 `confidence=0.5` 的模糊边，不崩溃
- 静态方法调用 `ClassName.method()`：`targetClass=ClassName`（直接可解析）
- 链式调用 `a.b().c()`：跳过（无法静态解析中间类型）

**验收**：测试全绿；`npm run type-check` 通过。

---

### Stage 94.2 — `archjson-mapper.ts` 集成（~80 行）

在 `mapRelations()` 调用之后，追加 call 边映射，只保留目标 class 在项目实体白名单中的边。

**验收**：测试全绿；现有 Java plugin 测试全部通过（回归）。

---

## Phase 95 — Python Phase C（OPTIONAL）

> **状态**：OPTIONAL。仅在 Phase 89-93 完成且需要 Python call graph 时实施。

**目标**：通过 tree-sitter 遍历 Python `call` 节点，提取方法调用边（精度 ~40%，duck typing 限制）。

**依赖**：Phase 89（schema），Phase 90（call 边过滤）。

**修改文件**：
- `src/plugins/python/tree-sitter-bridge.ts`（新增调用遍历）
- `src/plugins/python/archjson-mapper.ts`（call 边追加）

**测试文件（先写）**：
- `tests/unit/plugins/python/call-edge-extraction.test.ts`（新增）

**改动量**：~150 行（含测试）。

---

### Stage 95.1 — Python call 节点遍历（~80 行）

在 `extractFunction()`/`extractMethod()` 的 `body` 节点基础上，遍历 `call` 节点：

```
call
  ├── function: attribute  → receiver.method（self.service.save() 格式）
  └── function: identifier → 独立函数调用（跳过，无法解析 class）
```

**Duck typing 处理**：Python 无静态类型注解时，`confidence` 统一 0.4，`callType='indirect'`。有 type annotation 的参数（PEP 484）可尝试解析，`confidence` 提升到 0.6。

**测试要求**：
- `self.service.save()`：产生 `sourceMethod=<当前方法>`，`targetMethod=save`，`target=service`（class 名不可知时用变量名），`confidence=0.4`
- `someFunc()`（全局函数调用）：跳过
- `callType === 'indirect'`（全部 Python call 边）

**验收**：测试全绿；`npm run type-check` 通过；现有 Python plugin 测试全部通过（回归）。

---

## 依赖关系图

```
Phase 89 (Schema: RelationType + Relation + inferenceSource)
    │
    └──→ Phase 90 (OutputScope call 边过滤 + Mermaid 显式过滤)
              │
              ├──→ Phase 91 (Go Phase A: mapCallRelations + index.ts)
              │
              ├──→ Phase 92 (TypeScript Phase B: CallEdgeExtractor + parseProject)
              │
              ├──→ Phase 93 (MCP archguard_find_callers + CLI --callers)
              │
              ├──→ Phase 94 [OPTIONAL] (Java Phase C)
              │
              └──→ Phase 95 [OPTIONAL] (Python Phase C)
```

**可并行执行**：Phase 91、92、93、94、95 均依赖 Phase 90，但彼此独立，可并行开发。

---

## 测试文件清单

| 文件 | Phase | 类型 |
|---|---|---|
| `tests/unit/types/relation-schema.test.ts` | 89 | 新增（unit，编译期类型验证） |
| `tests/unit/core/query/call-edge-filter.test.ts` | 90 | 新增（unit） |
| `tests/unit/mermaid/generator-call-edge.test.ts` | 90 | 新增（unit） |
| `tests/unit/plugins/golang/archjson-mapper-call-edges.test.ts` | 91 | 新增（unit） |
| `tests/unit/plugins/golang/golang-plugin.test.ts` | 91 | 扩展现有（回归 + call edge 集成） |
| `tests/unit/parser/call-edge-extractor.test.ts` | 92 | 新增（unit） |
| `tests/unit/parser/typescript-parser.test.ts` | 92 | 扩展现有（parseProject call edge 回归） |
| `tests/unit/core/query/find-callers.test.ts` | 93 | 新增（unit） |
| `tests/unit/cli/mcp/call-graph-tools.test.ts` | 93 | 新增（unit） |
| `tests/unit/cli/commands/query.test.ts` | 93 | 扩展现有（--callers flag） |
| `tests/unit/plugins/java/call-edge-extraction.test.ts` | 94 | 新增（unit，OPTIONAL） |
| `tests/unit/plugins/python/call-edge-extraction.test.ts` | 95 | 新增（unit，OPTIONAL） |

---

## 改动量汇总

| Phase | 主要修改文件 | 新增测试文件 | 估计改动行数 |
|---|---|---|---|
| 89 | `src/types/index.ts`（RelationType + Relation） | `relation-schema.test.ts` | ~60 + ~20 |
| 90.1 | `src/core/query/query-engine.ts`（filterRelationsForScope） | `call-edge-filter.test.ts` | ~80 + ~60 |
| 90.2 | `src/mermaid/generator-formatting.ts` + `generator.ts` | `generator-call-edge.test.ts` | ~40 + ~30 |
| 91.1 | `src/plugins/golang/archjson-mapper.ts`（mapCallRelations） | `archjson-mapper-call-edges.test.ts` | ~80 + ~60 |
| 91.2 | `src/plugins/golang/index.ts`（追加 callRelations） | golang-plugin.test.ts（扩展） | ~50 + ~20 |
| 92.1 | `src/parser/call-edge-extractor.ts`（新建） | `call-edge-extractor.test.ts` | ~130 + ~70 |
| 92.2 | `src/parser/typescript-parser.ts`（parseProject 集成） | typescript-parser.test.ts（扩展） | ~70 + ~20 |
| 93.1 | `src/core/query/query-engine.ts`（findCallers） | `find-callers.test.ts` | ~80 + ~60 |
| 93.2 | `src/cli/mcp/tools/call-graph-tools.ts`（新建） + mcp-server.ts | `call-graph-tools.test.ts` | ~80 + ~50 |
| 93.3 | `src/cli/commands/query.ts`（--callers） | query.test.ts（扩展） | ~40 + ~20 |
| 94（OPT）| java/tree-sitter-bridge.ts + archjson-mapper.ts | java call edge test | ~180 + ~60 |
| 95（OPT）| python/tree-sitter-bridge.ts + archjson-mapper.ts | python call edge test | ~150 + ~50 |
| **合计（89-93）** | | | **~710 行** |
| **合计（89-95）** | | | **~1100 行** |

各 Phase ≤500 行，各 Stage ≤200 行，满足约束。

---

## 验收标准（Phase 93 门控）

- [ ] `npm test` 全绿，测试总数 ≥ 当前数量 + Phase 89-93 新增测试数
- [ ] `npm run type-check` 零错误
- [ ] `npm run lint` 零 error
- [ ] `npm run build` 成功
- [ ] `src/types/index.ts` 中 `RelationType` 含 `'call'`；`Relation` 含 `sourceMethod?`/`targetMethod?`/`callType?`
- [ ] `inferenceSource` union 含 `'call-aggregated'`
- [ ] Mermaid 类图输出中不含 `call` 边生成的箭头（`generateRelationLine({ type: 'call' })` 返回 null）
- [ ] Go Atlas 项目解析后 ArchJSON `relations` 含 `type='call'` 的边（需有入口点的 fixture）
- [ ] TypeScript `parseProject()` 路径产生 `type='call'` 的边；`parseCode()` 路径不产生
- [ ] `node dist/cli/index.js query --callers UserService --callers-depth=2` 返回 JSON 含 `callers` 数组
- [ ] MCP `archguard_find_callers` 工具注册成功，schema 含 `entityName`/`depth`/`projectRoot`
- [ ] `scope='class'` 时 call 边不暴露给 MCP 调用方（聚合为 dependency 或丢弃）
- [ ] `scope='method'` 时 call 边全量保留含 `sourceMethod`/`targetMethod`

---

## 精度声明（工具描述，ADR-006 §2.3 合规）

```
archguard_find_callers:
  "Return direct and transitive callers of an entity or method using
   statically-extracted call edges; precision varies by language:
   TypeScript ~85% (TypeChecker-resolved, parseProject() path only;
   parseCode/ParallelParser paths do not generate call edges),
   Go ~90% (gopls-assisted, entry-point-reachable paths only;
   functions not reachable from detected entry points are not covered),
   Java ~60% (tree-sitter heuristic, Phase 94),
   Python ~40% (duck-typed, indirect, Phase 95).
   Dynamic dispatch, callbacks, and reflection are not resolved."
```

---

## 已解决的审查意见

| 审查意见 | 解决位置 |
|---|---|
| 🔴 问题 1：FlowGraph 访问路径错误（mapRelations 先于 atlas 构建） | Stage 91.2：在 atlas 构建完成后调用 `mapCallRelations` |
| 🔴 问题 2：CallEdge.from/to 多级路径解析错误 | Stage 91.1：使用 `.at(-1)` + `.slice(0, -1).join('.')` 正确解析 |
| 🔴 问题 3：RelationExtractor 不持有 TypeChecker | Stage 92.1：新建独立 `CallEdgeExtractor` 类，接收 `parseProject` 的 `Project` |
| 🔴 问题 4：switch default 静默渲染 call 边 | Stage 90.2：`generateRelationLine` 返回 null；调用处过滤 null |
| 🔴 问题 5：`inferenceSource: 'call-aggregated'` 类型冲突 | Stage 89.2：union 扩展包含 `'call-aggregated'` |
| 🟡 遗漏 1：call 边聚合实现位置 | Stage 90.1：在 `query-engine.ts:applyOutputOptions` 中的新私有方法 |
| 🟡 遗漏 2：MCP 工具注册模式和 Zod schema | Stage 93.2：`call-graph-tools.ts` 按项目模式，含完整 Zod schema |
| 🟡 遗漏 3：FlowGraph 仅覆盖入口可达路径 | Stage 91.1 注释 + Stage 93.2 工具描述 + 验收标准精度声明 |
| 🔵 风险 1：大项目 call 边数量爆炸 | Stage 92.2：5000 边警告日志；Phase 93 门控标准含 `scope='class'` 验证 |
| 🔵 风险 2：`'indirect'` 映射语义不一致 | Stage 91.1：Go mapper 中 `'indirect'` 映射为 `'interface'`，注释说明 |
| 🔧 Plan 修正 1：`CallEdgeExtractor` 缺少 `SourceFile` import | Stage 92.1：import 行补 `SourceFile`；新增 `workspaceRoot` 参数和 `toRelPath()` 方法，确保 source entity ID 与 `TypeScriptParser` 格式（`${relPath}.${className}`）一致 |
| 🔧 Plan 修正 2：`QueryEngine.load(root)` 方法不存在 | Stage 93.2：改为 `resolveRoot()` + `path.join(root, '.archguard')` + `loadEngine(archDir)`，与 `test-analysis-tools.ts` 等现有 MCP 工具的注册模式完全一致 |
